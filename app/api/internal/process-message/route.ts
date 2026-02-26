import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendWhatsAppMessage, downloadWhatsAppMedia, sendSigninLinkTemplate } from '@/lib/whatsapp'
import { transcribeAudio } from '@/lib/sarvam'
import { normalizePhone } from '@/lib/phone'
import { generateAuthToken } from '@/lib/auth-links'

// Phase 0 AI modules
import { classifyIntent } from '@/lib/ai/intent-classifier'
import { extractAction } from '@/lib/ai/action-extractor'
import { validateAction } from '@/lib/ai/action-rules'
import { resolveTask, findMostRecentPendingTask } from '@/lib/ai/task-resolver'
import { getNavigationHelpResponse } from '@/lib/ai/agent-reference'
import { extractUserId } from '@/lib/task-service'
import {
    notifyTaskCreated,
    notifyTaskAccepted,
    notifyTaskRejected,
    notifyTaskCompleted,
    notifyDeadlineEdited,
    notifyAssigneeChanged,
    notifyTaskCancelled,
    notifySubtaskCreated,
} from '@/lib/notifications/whatsapp-notifier'
import type { ExtractedAction } from '@/lib/ai/types'
import type { Task } from '@/lib/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface IncomingMessage {
    id: string
    phone: string
    user_id: string | null
    raw_text: string
    processed: boolean
    processing_error: string | null
    intent_type: string | null
}

interface SenderUser {
    id: string
    name: string
    phone_number: string
    organisation_id: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Supabase admin client — typed as `any` because the generated types
// don't cover our custom tables. This matches the pattern used in the
// webhook handler and the original process-message code.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseAdmin = any

async function markProcessed(
    supabase: SupabaseAdmin,
    messageId: string,
    intentType: string | null,
    error: string | null,
): Promise<void> {
    const { error: updateError } = await supabase
        .from('incoming_messages')
        .update({
            processed: true,
            intent_type: intentType,
            processing_error: error,
        })
        .eq('id', messageId)

    if (updateError) {
        console.error('[ProcessMessage] Failed to mark processed:', updateError.message)
    }
}

async function sendErrorAndMark(
    supabase: SupabaseAdmin,
    messageId: string,
    phone: string,
    userMessage: string,
    errorDetail: string,
): Promise<void> {
    console.error(`[ProcessMessage] ${errorDetail}`)
    try {
        await sendWhatsAppMessage(phone, userMessage)
    } catch (sendErr) {
        console.error('[ProcessMessage] Failed to send error WhatsApp:', sendErr)
    }
    await markProcessed(supabase, messageId, null, errorDetail)
}

/**
 * Fetch the user's active tasks from the DB.
 * Used for task resolution and status queries.
 */
async function fetchUserTasks(
    supabase: SupabaseAdmin,
    userId: string,
    orgId: string,
): Promise<Task[]> {
    const { data, error } = await supabase
        .from('tasks')
        .select('id, title, description, organisation_id, created_by:users!tasks_created_by_fkey(id, name, phone_number), assigned_to:users!tasks_assigned_to_fkey(id, name, phone_number), parent_task_id, status, deadline, committed_deadline, source, created_at, updated_at')
        .eq('organisation_id', orgId)
        .in('status', ['pending', 'accepted', 'overdue'])
        .or(`created_by.eq.${userId},assigned_to.eq.${userId}`)
        .order('created_at', { ascending: false })
        .limit(50)

    if (error) {
        console.error('[ProcessMessage] Failed to fetch user tasks:', error.message)
        return []
    }

    return (data ?? []) as unknown as Task[]
}

/**
 * Fuzzy-match a person name within the organisation.
 */
async function fuzzyMatchUser(
    supabase: SupabaseAdmin,
    orgId: string,
    name: string,
): Promise<{ id: string; name: string; phone_number?: string }[]> {
    const { data } = await supabase
        .from('users')
        .select('id, name, first_name, last_name, phone_number')
        .eq('organisation_id', orgId)
        .ilike('name', `%${name}%`)

    return (data ?? []) as { id: string; name: string; phone_number?: string }[]
}

// ---------------------------------------------------------------------------
// POST handler — the AI pipeline
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
    // 1. Auth
    const secret = request.headers.get('x-internal-secret')
    if (!secret || secret !== process.env.INTERNAL_PROCESSOR_SECRET) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // 2. Parse body
    let body: { messageId?: string; audioMediaId?: string; audioMimeType?: string }
    try {
        body = await request.json()
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const { messageId, audioMediaId, audioMimeType } = body
    if (!messageId || typeof messageId !== 'string') {
        return NextResponse.json({ error: 'Missing messageId' }, { status: 400 })
    }

    const supabase = createAdminClient() as SupabaseAdmin

    try {
        // 3. Fetch message from DB
        const { data: message, error: fetchError } = await supabase
            .from('incoming_messages')
            .select('id, phone, user_id, raw_text, processed, processing_error, intent_type')
            .eq('id', messageId)
            .single()

        if (fetchError || !message) {
            console.error('[ProcessMessage] Message not found:', messageId, fetchError?.message)
            return NextResponse.json({ status: 'not_found' }, { status: 200 })
        }

        const msg = message as IncomingMessage

        // 4. Idempotency
        if (msg.processed) {
            console.log('[ProcessMessage] Already processed:', messageId)
            return NextResponse.json({ status: 'already_processed' }, { status: 200 })
        }

        // 5. Resolve sender
        const senderPhone10 = normalizePhone(msg.phone)

        const { data: senderUser } = await supabase
            .from('users')
            .select('id, name, phone_number, organisation_id')
            .eq('phone_number', senderPhone10)
            .single()

        if (!senderUser) {
            await sendErrorAndMark(
                supabase, messageId, msg.phone,
                'Your phone number is not registered with Boldo. Please sign up first.',
                `User not found for phone: ${msg.phone}`,
            )
            return NextResponse.json({ status: 'user_not_found' }, { status: 200 })
        }

        const sender = senderUser as SenderUser

        // 6. Audio transcription (if voice note)
        let textForAI = msg.raw_text

        if (audioMediaId) {
            console.log(`[ProcessMessage] Audio detected — downloading media ${audioMediaId}`)
            try {
                const { buffer, mimeType } = await downloadWhatsAppMedia(audioMediaId)
                const transcript = await transcribeAudio(buffer, audioMimeType || mimeType)

                console.log(`[ProcessMessage] Transcription: "${transcript.substring(0, 100)}${transcript.length > 100 ? '...' : ''}"`)

                // Fire-and-forget: update DB with transcribed text
                supabase
                    .from('incoming_messages')
                    .update({ raw_text: `[audio] ${transcript}` })
                    .eq('id', messageId)
                    .then(() => { /* ignore */ })
                    .catch((err: unknown) => console.error('[ProcessMessage] Failed to update raw_text:', err))

                textForAI = transcript
            } catch (transcribeErr) {
                const errMsg = transcribeErr instanceof Error ? transcribeErr.message : 'Unknown transcription error'
                await sendErrorAndMark(
                    supabase, messageId, msg.phone,
                    "Sorry, I couldn't understand the voice note. Please try again or type your message.",
                    `Audio transcription failed: ${errMsg}`,
                )
                return NextResponse.json({ status: 'transcription_error' }, { status: 200 })
            }
        }

        // =====================================================================
        // 7. AI PIPELINE — Stage 1: Classify intent
        // =====================================================================

        console.log(`[ProcessMessage] Stage 1 — classifying intent for: "${textForAI.substring(0, 80)}"`)
        const classification = await classifyIntent(textForAI)
        console.log(`[ProcessMessage] Intent: ${classification.intent} (confidence: ${classification.confidence.toFixed(2)})`)

        // =====================================================================
        // 8. AI PIPELINE — Stage 2: Extract action data
        // =====================================================================

        const action = await extractAction(classification.intent, textForAI)
        console.log(`[ProcessMessage] Action extracted: ${action.intent}`)

        // =====================================================================
        // 9. Dispatch to intent handler
        // =====================================================================

        await dispatchIntent(supabase, messageId, msg.phone, sender, textForAI, action)

        console.log(`[ProcessMessage] Done: ${messageId} → ${action.intent}`, audioMediaId ? '(from audio)' : '')
        return NextResponse.json({ status: 'processed', intent: action.intent }, { status: 200 })

    } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown internal error'
        console.error('[ProcessMessage] Unhandled error:', errMsg)

        try {
            const { data: failMsg } = await supabase
                .from('incoming_messages')
                .select('phone')
                .eq('id', messageId)
                .single()

            if (failMsg?.phone) {
                await sendWhatsAppMessage(failMsg.phone, 'Something went wrong while processing your request.')
            }
            await markProcessed(supabase, messageId, null, errMsg)
        } catch (cleanupErr) {
            console.error('[ProcessMessage] Cleanup failed:', cleanupErr)
        }

        return NextResponse.json({ status: 'internal_error' }, { status: 200 })
    }
}

// ---------------------------------------------------------------------------
// Intent dispatcher
// ---------------------------------------------------------------------------

async function dispatchIntent(
    supabase: SupabaseAdmin,
    messageId: string,
    phone: string,
    sender: SenderUser,
    userText: string,
    action: ExtractedAction,
): Promise<void> {
    switch (action.intent) {
        case 'task_create':
            return handleTaskCreate(supabase, messageId, phone, sender, action)
        case 'todo_create':
            return handleTodoCreate(supabase, messageId, phone, sender, action)
        case 'task_accept':
            return handleTaskAccept(supabase, messageId, phone, sender, userText, action)
        case 'task_reject':
            return handleTaskReject(supabase, messageId, phone, sender, userText, action)
        case 'task_complete':
            return handleTaskComplete(supabase, messageId, phone, sender, userText, action)
        case 'task_delete':
            return handleTaskDelete(supabase, messageId, phone, sender, userText, action)
        case 'task_edit_deadline':
            return handleTaskEditDeadline(supabase, messageId, phone, sender, userText, action)
        case 'task_edit_assignee':
            return handleTaskEditAssignee(supabase, messageId, phone, sender, userText, action)
        case 'task_create_subtask':
            return handleTaskCreateSubtask(supabase, messageId, phone, sender, userText, action)
        case 'status_query':
            return handleStatusQuery(supabase, messageId, phone, sender, action)
        case 'auth_signin':
            return handleAuthSignin(supabase, messageId, phone, sender)
        case 'help_navigation':
            return handleHelpNavigation(supabase, messageId, phone, action)
        case 'reminder_create':
            return handleReminderCreate(supabase, messageId, phone, sender, action)
        case 'scheduled_message':
            return handleScheduledMessage(supabase, messageId, phone, sender, action)
        case 'unknown':
        default:
            return handleUnknown(supabase, messageId, phone, action)
    }
}

// ============================================================================
// INTENT HANDLERS
// ============================================================================

// ---------------------------------------------------------------------------
// task_create — Create a task assigned to someone
// ---------------------------------------------------------------------------

async function handleTaskCreate(
    supabase: SupabaseAdmin,
    messageId: string,
    phone: string,
    sender: SenderUser,
    action: ExtractedAction & { intent: 'task_create' },
): Promise<void> {
    let assignedToId = sender.id

    // Try to resolve assignee by name
    if (action.assignee_name) {
        const matches = await fuzzyMatchUser(supabase, sender.organisation_id, action.assignee_name)

        if (matches.length === 1) {
            assignedToId = matches[0].id
        } else if (matches.length > 1) {
            // Multiple matches — ask user to clarify
            const nameList = matches
                .map((u, i) => `${i + 1}. ${u.name}${u.phone_number ? ` (${u.phone_number})` : ''}`)
                .join('\n')

            const clarifyMsg =
                `I found multiple people named "${action.assignee_name}" in your organization:\n\n` +
                `${nameList}\n\n` +
                `Please reply with the full name of the person you want to assign this task to.`

            await sendWhatsAppReply(phone, clarifyMsg)
            await markProcessed(supabase, messageId, 'needs_clarification', null)
            return
        }
        // If no match found, assignee falls back to sender (becomes a to-do)
    }

    const { data: newTask, error: taskError } = await supabase
        .from('tasks')
        .insert({
            title: action.title,
            description: action.description,
            organisation_id: sender.organisation_id,
            created_by: sender.id,
            assigned_to: assignedToId,
            deadline: action.deadline,
            status: 'pending',
            source: 'whatsapp',
        })
        .select('id')
        .single()

    if (taskError || !newTask) {
        await sendErrorAndMark(supabase, messageId, phone,
            'Something went wrong while creating the task.',
            `Task insert failed: ${taskError?.message || 'Unknown error'}`,
        )
        return
    }

    await sendWhatsAppReply(phone, action.confirmation_message)
    await markProcessed(supabase, messageId, 'task_create', null)

    // Fire-and-forget: notify the assignee (and skip if self-assigned)
    notifyTaskCreated(supabase, {
        ownerName: sender.name,
        ownerId: sender.id,
        assigneeId: assignedToId,
        taskTitle: action.title,
        taskId: newTask.id,
        source: 'whatsapp',
    }).catch(err => console.error('[ProcessMessage] Notification error (task_create):', err))
}

// ---------------------------------------------------------------------------
// todo_create — Create a personal to-do (self-assigned)
// ---------------------------------------------------------------------------

async function handleTodoCreate(
    supabase: SupabaseAdmin,
    messageId: string,
    phone: string,
    sender: SenderUser,
    action: ExtractedAction & { intent: 'todo_create' },
): Promise<void> {
    const { error: taskError } = await supabase
        .from('tasks')
        .insert({
            title: action.title,
            description: action.description,
            organisation_id: sender.organisation_id,
            created_by: sender.id,
            assigned_to: sender.id, // Self-assigned = to-do
            deadline: action.deadline,
            committed_deadline: action.deadline, // Auto-accept to-dos
            status: action.deadline ? 'accepted' : 'pending',
            source: 'whatsapp',
        })

    if (taskError) {
        await sendErrorAndMark(supabase, messageId, phone,
            'Something went wrong while creating the to-do.',
            `Todo insert failed: ${taskError.message}`,
        )
        return
    }

    await sendWhatsAppReply(phone, action.confirmation_message)
    await markProcessed(supabase, messageId, 'todo_create', null)
}

// ---------------------------------------------------------------------------
// task_accept — Accept a pending task with committed deadline
// ---------------------------------------------------------------------------

async function handleTaskAccept(
    supabase: SupabaseAdmin,
    messageId: string,
    phone: string,
    sender: SenderUser,
    userText: string,
    action: ExtractedAction & { intent: 'task_accept' },
): Promise<void> {
    const userTasks = await fetchUserTasks(supabase, sender.id, sender.organisation_id)
    const pendingTask = findMostRecentPendingTask(sender.id, userTasks)

    if (!pendingTask) {
        await sendWhatsAppReply(phone, "You don't have any pending tasks to accept right now.")
        await markProcessed(supabase, messageId, 'task_accept', 'No pending tasks found')
        return
    }

    // Permission check
    const validation = validateAction('task_accept', pendingTask, sender.id)
    if (!validation.allowed) {
        await sendWhatsAppReply(phone, validation.reason ?? "You can't accept this task.")
        await markProcessed(supabase, messageId, 'task_accept', `Permission denied: ${validation.reason}`)
        return
    }

    const updateData: Record<string, unknown> = {
        status: 'accepted',
    }
    if (action.committed_deadline) {
        updateData.committed_deadline = action.committed_deadline
    }

    const { error } = await supabase
        .from('tasks')
        .update(updateData)
        .eq('id', pendingTask.id)

    if (error) {
        await sendErrorAndMark(supabase, messageId, phone,
            'Something went wrong while accepting the task.',
            `Task accept failed: ${error.message}`,
        )
        return
    }

    // Build a more specific confirmation
    const taskTitle = pendingTask.title
    const deadlineStr = action.committed_deadline
        ? new Date(action.committed_deadline).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
        : null
    const confirmMsg = deadlineStr
        ? `✅ Great! You've accepted "${taskTitle}" with a deadline of ${deadlineStr}. Good luck! 💪`
        : `✅ You've accepted "${taskTitle}". Remember to set a deadline when you can!`

    await sendWhatsAppReply(phone, confirmMsg)
    await markProcessed(supabase, messageId, 'task_accept', null)

    // Fire-and-forget: notify the task owner
    const ownerIdStr = extractUserId(pendingTask.created_by)
    if (ownerIdStr) {
        notifyTaskAccepted(supabase, {
            ownerId: ownerIdStr,
            assigneeId: sender.id,
            assigneeName: sender.name,
            taskTitle: taskTitle,
            committedDeadline: action.committed_deadline,
        }).catch(err => console.error('[ProcessMessage] Notification error (task_accept):', err))
    }
}

// ---------------------------------------------------------------------------
// task_reject — Reject a pending task
// ---------------------------------------------------------------------------

async function handleTaskReject(
    supabase: SupabaseAdmin,
    messageId: string,
    phone: string,
    sender: SenderUser,
    userText: string,
    action: ExtractedAction & { intent: 'task_reject' },
): Promise<void> {
    const userTasks = await fetchUserTasks(supabase, sender.id, sender.organisation_id)
    const pendingTask = findMostRecentPendingTask(sender.id, userTasks)

    if (!pendingTask) {
        await sendWhatsAppReply(phone, "You don't have any pending tasks to reject right now.")
        await markProcessed(supabase, messageId, 'task_reject', 'No pending tasks found')
        return
    }

    const validation = validateAction('task_reject', pendingTask, sender.id)
    if (!validation.allowed) {
        await sendWhatsAppReply(phone, validation.reason ?? "You can't reject this task.")
        await markProcessed(supabase, messageId, 'task_reject', `Permission denied: ${validation.reason}`)
        return
    }

    const { error } = await supabase
        .from('tasks')
        .update({ status: 'cancelled' })
        .eq('id', pendingTask.id)

    if (error) {
        await sendErrorAndMark(supabase, messageId, phone,
            'Something went wrong while rejecting the task.',
            `Task reject failed: ${error.message}`,
        )
        return
    }

    const taskTitle = pendingTask.title
    const ownerName = typeof pendingTask.created_by === 'object' ? pendingTask.created_by.name : 'the task owner'
    const reasonStr = action.reason ? ` Reason: ${action.reason}` : ''
    const confirmMsg = `Got it. I've let ${ownerName} know that you've declined "${taskTitle}".${reasonStr}`

    await sendWhatsAppReply(phone, confirmMsg)
    await markProcessed(supabase, messageId, 'task_reject', null)

    // Fire-and-forget: notify the task owner
    const ownerIdStr = extractUserId(pendingTask.created_by)
    if (ownerIdStr) {
        notifyTaskRejected(supabase, {
            ownerId: ownerIdStr,
            assigneeId: sender.id,
            assigneeName: sender.name,
            taskTitle: taskTitle,
            reason: action.reason,
        }).catch(err => console.error('[ProcessMessage] Notification error (task_reject):', err))
    }
}

// ---------------------------------------------------------------------------
// task_complete — Mark a task as completed
// ---------------------------------------------------------------------------

async function handleTaskComplete(
    supabase: SupabaseAdmin,
    messageId: string,
    phone: string,
    sender: SenderUser,
    userText: string,
    action: ExtractedAction & { intent: 'task_complete' },
): Promise<void> {
    const userTasks = await fetchUserTasks(supabase, sender.id, sender.organisation_id)

    const resolution = await resolveTask(action.task_hint, userText, userTasks)

    if (resolution.status === 'not_found') {
        await sendWhatsAppReply(phone, resolution.message)
        await markProcessed(supabase, messageId, 'task_complete', 'Task not found')
        return
    }

    if (resolution.status === 'ambiguous') {
        await sendWhatsAppReply(phone, resolution.clarificationMessage)
        await markProcessed(supabase, messageId, 'needs_clarification', null)
        return
    }

    const task = resolution.task
    const validation = validateAction('task_complete', task, sender.id)
    if (!validation.allowed) {
        await sendWhatsAppReply(phone, validation.reason ?? "You can't complete this task.")
        await markProcessed(supabase, messageId, 'task_complete', `Permission denied: ${validation.reason}`)
        return
    }

    const { error } = await supabase
        .from('tasks')
        .update({ status: 'completed' })
        .eq('id', task.id)

    if (error) {
        await sendErrorAndMark(supabase, messageId, phone,
            'Something went wrong while completing the task.',
            `Task complete failed: ${error.message}`,
        )
        return
    }

    await sendWhatsAppReply(phone, `🎉 "${task.title}" has been marked as completed. Nice work!`)
    await markProcessed(supabase, messageId, 'task_complete', null)

    // Fire-and-forget: notify the assignee
    const assigneeIdStr = extractUserId(task.assigned_to)
    if (assigneeIdStr) {
        notifyTaskCompleted(supabase, {
            ownerId: sender.id,
            ownerName: sender.name,
            assigneeId: assigneeIdStr,
            taskTitle: task.title,
        }).catch(err => console.error('[ProcessMessage] Notification error (task_complete):', err))
    }
}

// ---------------------------------------------------------------------------
// task_delete — Cancel a task (and its subtasks)
// ---------------------------------------------------------------------------

async function handleTaskDelete(
    supabase: SupabaseAdmin,
    messageId: string,
    phone: string,
    sender: SenderUser,
    userText: string,
    action: ExtractedAction & { intent: 'task_delete' },
): Promise<void> {
    const userTasks = await fetchUserTasks(supabase, sender.id, sender.organisation_id)

    const resolution = await resolveTask(action.task_hint, userText, userTasks)

    if (resolution.status === 'not_found') {
        await sendWhatsAppReply(phone, resolution.message)
        await markProcessed(supabase, messageId, 'task_delete', 'Task not found')
        return
    }

    if (resolution.status === 'ambiguous') {
        await sendWhatsAppReply(phone, resolution.clarificationMessage)
        await markProcessed(supabase, messageId, 'needs_clarification', null)
        return
    }

    const task = resolution.task
    const validation = validateAction('task_delete', task, sender.id)
    if (!validation.allowed) {
        await sendWhatsAppReply(phone, validation.reason ?? "You can't delete this task.")
        await markProcessed(supabase, messageId, 'task_delete', `Permission denied: ${validation.reason}`)
        return
    }

    // Cancel the task
    const { error } = await supabase
        .from('tasks')
        .update({ status: 'cancelled' })
        .eq('id', task.id)

    if (error) {
        await sendErrorAndMark(supabase, messageId, phone,
            'Something went wrong while deleting the task.',
            `Task delete failed: ${error.message}`,
        )
        return
    }

    // Also cancel all active subtasks
    await supabase
        .from('tasks')
        .update({ status: 'cancelled' })
        .eq('parent_task_id', task.id)
        .in('status', ['pending', 'accepted', 'overdue'])

    await sendWhatsAppReply(phone, `🗑️ "${task.title}" has been cancelled.`)
    await markProcessed(supabase, messageId, 'task_delete', null)

    // Fire-and-forget: notify the assignee
    const assigneeIdDel = extractUserId(task.assigned_to)
    if (assigneeIdDel) {
        notifyTaskCancelled(supabase, {
            ownerId: sender.id,
            ownerName: sender.name,
            assigneeId: assigneeIdDel,
            taskTitle: task.title,
        }).catch(err => console.error('[ProcessMessage] Notification error (task_delete):', err))
    }
}

// ---------------------------------------------------------------------------
// task_edit_deadline — Change deadline
// ---------------------------------------------------------------------------

async function handleTaskEditDeadline(
    supabase: SupabaseAdmin,
    messageId: string,
    phone: string,
    sender: SenderUser,
    userText: string,
    action: ExtractedAction & { intent: 'task_edit_deadline' },
): Promise<void> {
    const userTasks = await fetchUserTasks(supabase, sender.id, sender.organisation_id)

    const resolution = await resolveTask(action.task_hint, userText, userTasks)

    if (resolution.status === 'not_found') {
        await sendWhatsAppReply(phone, resolution.message)
        await markProcessed(supabase, messageId, 'task_edit_deadline', 'Task not found')
        return
    }

    if (resolution.status === 'ambiguous') {
        await sendWhatsAppReply(phone, resolution.clarificationMessage)
        await markProcessed(supabase, messageId, 'needs_clarification', null)
        return
    }

    const task = resolution.task
    const validation = validateAction('task_edit_deadline', task, sender.id)
    if (!validation.allowed) {
        await sendWhatsAppReply(phone, validation.reason ?? "You can't change this task's deadline.")
        await markProcessed(supabase, messageId, 'task_edit_deadline', `Permission denied: ${validation.reason}`)
        return
    }

    if (!action.new_deadline) {
        await sendWhatsAppReply(phone, "I couldn't determine the new deadline. Please mention a specific date, like \"Change deadline to March 5\".")
        await markProcessed(supabase, messageId, 'task_edit_deadline', 'No new deadline provided')
        return
    }

    const { error } = await supabase
        .from('tasks')
        .update({ committed_deadline: action.new_deadline })
        .eq('id', task.id)

    if (error) {
        await sendErrorAndMark(supabase, messageId, phone,
            'Something went wrong while updating the deadline.',
            `Task edit deadline failed: ${error.message}`,
        )
        return
    }

    const newDateStr = new Date(action.new_deadline).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    await sendWhatsAppReply(phone, `📅 Deadline for "${task.title}" has been changed to ${newDateStr}.`)
    await markProcessed(supabase, messageId, 'task_edit_deadline', null)

    // Fire-and-forget: notify the other party
    const dlOwnerId = extractUserId(task.created_by)
    const dlAssigneeId = extractUserId(task.assigned_to)
    if (dlOwnerId && dlAssigneeId) {
        notifyDeadlineEdited(supabase, {
            ownerId: dlOwnerId,
            assigneeId: dlAssigneeId,
            actorId: sender.id,
            actorName: sender.name,
            taskTitle: task.title,
            newDeadline: action.new_deadline,
        }).catch(err => console.error('[ProcessMessage] Notification error (task_edit_deadline):', err))
    }
}

// ---------------------------------------------------------------------------
// task_edit_assignee — Reassign a task
// ---------------------------------------------------------------------------

async function handleTaskEditAssignee(
    supabase: SupabaseAdmin,
    messageId: string,
    phone: string,
    sender: SenderUser,
    userText: string,
    action: ExtractedAction & { intent: 'task_edit_assignee' },
): Promise<void> {
    const userTasks = await fetchUserTasks(supabase, sender.id, sender.organisation_id)

    const resolution = await resolveTask(action.task_hint, userText, userTasks)

    if (resolution.status === 'not_found') {
        await sendWhatsAppReply(phone, resolution.message)
        await markProcessed(supabase, messageId, 'task_edit_assignee', 'Task not found')
        return
    }

    if (resolution.status === 'ambiguous') {
        await sendWhatsAppReply(phone, resolution.clarificationMessage)
        await markProcessed(supabase, messageId, 'needs_clarification', null)
        return
    }

    const task = resolution.task
    const validation = validateAction('task_edit_assignee', task, sender.id)
    if (!validation.allowed) {
        await sendWhatsAppReply(phone, validation.reason ?? "You can't reassign this task.")
        await markProcessed(supabase, messageId, 'task_edit_assignee', `Permission denied: ${validation.reason}`)
        return
    }

    // Resolve new assignee
    const newAssigneeMatches = await fuzzyMatchUser(supabase, sender.organisation_id, action.new_assignee_name)

    if (newAssigneeMatches.length === 0) {
        await sendWhatsAppReply(phone, `I couldn't find anyone named "${action.new_assignee_name}" in your organization.`)
        await markProcessed(supabase, messageId, 'task_edit_assignee', `Assignee not found: ${action.new_assignee_name}`)
        return
    }

    if (newAssigneeMatches.length > 1) {
        const nameList = newAssigneeMatches
            .map((u, i) => `${i + 1}. ${u.name}${u.phone_number ? ` (${u.phone_number})` : ''}`)
            .join('\n')

        await sendWhatsAppReply(phone,
            `I found multiple people named "${action.new_assignee_name}":\n\n${nameList}\n\nPlease reply with the full name of the person you want to reassign to.`)
        await markProcessed(supabase, messageId, 'needs_clarification', null)
        return
    }

    const newAssignee = newAssigneeMatches[0]
    const { error } = await supabase
        .from('tasks')
        .update({
            assigned_to: newAssignee.id,
            status: 'pending', // Reset to pending — new assignee needs to accept
            committed_deadline: null,
        })
        .eq('id', task.id)

    if (error) {
        await sendErrorAndMark(supabase, messageId, phone,
            'Something went wrong while reassigning the task.',
            `Task edit assignee failed: ${error.message}`,
        )
        return
    }

    await sendWhatsAppReply(phone, `🔄 "${task.title}" has been reassigned to ${newAssignee.name}.`)
    await markProcessed(supabase, messageId, 'task_edit_assignee', null)

    // Fire-and-forget: notify old + new assignees
    const oldAssigneeIdStr = extractUserId(task.assigned_to)
    if (oldAssigneeIdStr) {
        notifyAssigneeChanged(supabase, {
            ownerId: sender.id,
            ownerName: sender.name,
            oldAssigneeId: oldAssigneeIdStr,
            newAssigneeId: newAssignee.id,
            newAssigneeName: newAssignee.name,
            taskTitle: task.title,
        }).catch(err => console.error('[ProcessMessage] Notification error (task_edit_assignee):', err))
    }
}

// ---------------------------------------------------------------------------
// task_create_subtask — Create a subtask under a parent
// ---------------------------------------------------------------------------

async function handleTaskCreateSubtask(
    supabase: SupabaseAdmin,
    messageId: string,
    phone: string,
    sender: SenderUser,
    userText: string,
    action: ExtractedAction & { intent: 'task_create_subtask' },
): Promise<void> {
    const userTasks = await fetchUserTasks(supabase, sender.id, sender.organisation_id)

    // Resolve the parent task
    const resolution = await resolveTask(action.parent_task_hint, userText, userTasks)

    if (resolution.status === 'not_found') {
        await sendWhatsAppReply(phone, "I couldn't find the parent task. Could you describe it more clearly?")
        await markProcessed(supabase, messageId, 'task_create_subtask', 'Parent task not found')
        return
    }

    if (resolution.status === 'ambiguous') {
        await sendWhatsAppReply(phone, resolution.clarificationMessage)
        await markProcessed(supabase, messageId, 'needs_clarification', null)
        return
    }

    const parentTask = resolution.task
    const validation = validateAction('task_create_subtask', parentTask, sender.id)
    if (!validation.allowed) {
        await sendWhatsAppReply(phone, validation.reason ?? "You can't create subtasks under this task.")
        await markProcessed(supabase, messageId, 'task_create_subtask', `Permission denied: ${validation.reason}`)
        return
    }

    // Resolve subtask assignee
    let subtaskAssigneeId = sender.id
    if (action.assignee_name) {
        const matches = await fuzzyMatchUser(supabase, sender.organisation_id, action.assignee_name)
        if (matches.length === 1) {
            subtaskAssigneeId = matches[0].id
        } else if (matches.length > 1) {
            const nameList = matches
                .map((u, i) => `${i + 1}. ${u.name}${u.phone_number ? ` (${u.phone_number})` : ''}`)
                .join('\n')
            await sendWhatsAppReply(phone,
                `I found multiple people named "${action.assignee_name}":\n\n${nameList}\n\nPlease reply with the full name.`)
            await markProcessed(supabase, messageId, 'needs_clarification', null)
            return
        }
    }

    const { data: newSubtask, error } = await supabase
        .from('tasks')
        .insert({
            title: action.title,
            description: action.description,
            organisation_id: sender.organisation_id,
            created_by: sender.id,
            assigned_to: subtaskAssigneeId,
            parent_task_id: parentTask.id,
            deadline: action.deadline,
            status: 'pending',
            source: 'whatsapp',
        })
        .select('id')
        .single()

    if (error || !newSubtask) {
        await sendErrorAndMark(supabase, messageId, phone,
            'Something went wrong while creating the subtask.',
            `Subtask insert failed: ${error?.message || 'Unknown error'}`,
        )
        return
    }

    await sendWhatsAppReply(phone, `📎 Subtask "${action.title}" created under "${parentTask.title}". ✅`)
    await markProcessed(supabase, messageId, 'task_create_subtask', null)

    // Fire-and-forget: notify parent task owner + subtask assignee
    const parentOwnerId = extractUserId(parentTask.created_by)
    if (parentOwnerId) {
        notifySubtaskCreated(supabase, {
            parentTaskOwnerId: parentOwnerId,
            creatorId: sender.id,
            creatorName: sender.name,
            subtaskTitle: action.title,
            parentTaskTitle: parentTask.title,
        }).catch(err => console.error('[ProcessMessage] Notification error (subtask_create owner):', err))
    }

    // Also notify the subtask assignee (if assigned to someone other than the creator)
    if (subtaskAssigneeId !== sender.id) {
        notifyTaskCreated(supabase, {
            ownerName: sender.name,
            ownerId: sender.id,
            assigneeId: subtaskAssigneeId,
            taskTitle: action.title,
            taskId: newSubtask.id,
            source: 'whatsapp',
        }).catch(err => console.error('[ProcessMessage] Notification error (subtask_create assignee):', err))
    }
}

// ---------------------------------------------------------------------------
// status_query — Show task summary
// ---------------------------------------------------------------------------

async function handleStatusQuery(
    supabase: SupabaseAdmin,
    messageId: string,
    phone: string,
    sender: SenderUser,
    action: ExtractedAction & { intent: 'status_query' },
): Promise<void> {
    console.log(`[ProcessMessage] Status query type: ${action.query_type}`)
    const userTasks = await fetchUserTasks(supabase, sender.id, sender.organisation_id)

    if (userTasks.length === 0) {
        await sendWhatsAppReply(phone, "You don't have any active tasks right now. 🎉")
        await markProcessed(supabase, messageId, 'status_query', null)
        return
    }

    // Categorise tasks
    const owned = userTasks.filter((t) => extractUserId(t.created_by) === sender.id && extractUserId(t.assigned_to) !== sender.id)
    const assigned = userTasks.filter((t) => extractUserId(t.assigned_to) === sender.id && extractUserId(t.created_by) !== sender.id)
    const todos = userTasks.filter((t) => extractUserId(t.created_by) === sender.id && extractUserId(t.assigned_to) === sender.id)
    const overdue = userTasks.filter((t) => t.status === 'overdue')
    const pending = userTasks.filter((t) => t.status === 'pending' && !t.committed_deadline)

    let summary = `📊 *Your Task Summary*\n\n`
    summary += `📋 Total active: ${userTasks.length}\n`

    if (owned.length > 0) summary += `👤 Tasks you created: ${owned.length}\n`
    if (assigned.length > 0) summary += `📌 Tasks assigned to you: ${assigned.length}\n`
    if (todos.length > 0) summary += `📝 Personal to-dos: ${todos.length}\n`
    if (pending.length > 0) summary += `⏳ Pending acceptance: ${pending.length}\n`
    if (overdue.length > 0) summary += `⚠️ Overdue: ${overdue.length}\n`

    // Show the 5 most recent tasks
    summary += `\n*Recent tasks:*\n`
    const recent = userTasks.slice(0, 5)
    for (const task of recent) {
        const statusEmoji = task.status === 'pending' ? '🟡' : task.status === 'accepted' ? '🟢' : task.status === 'overdue' ? '🔴' : '⚪'
        summary += `${statusEmoji} ${task.title}\n`
    }

    if (userTasks.length > 5) {
        summary += `\n...and ${userTasks.length - 5} more. Check the dashboard for full details!`
    }

    await sendWhatsAppReply(phone, summary)
    await markProcessed(supabase, messageId, 'status_query', null)
}

// ---------------------------------------------------------------------------
// auth_signin — Send sign-in link
// ---------------------------------------------------------------------------

async function handleAuthSignin(
    supabase: SupabaseAdmin,
    messageId: string,
    phone: string,
    sender: SenderUser,
): Promise<void> {
    try {
        const tokenResult = await generateAuthToken(sender.phone_number, 'signin', supabase)

        if (tokenResult.success && tokenResult.token) {
            // Fire-and-forget keep-warm
            fetch(`https://${process.env.VERCEL_URL || 'www.boldoai.in'}/api/keep-warm`, { cache: 'no-store' }).catch(() => { })

            await sendSigninLinkTemplate(phone, sender.name, tokenResult.token)
        } else {
            await sendWhatsAppReply(phone, 'Something went wrong generating your sign-in link. Please try again.')
        }
    } catch (err) {
        console.error('[ProcessMessage] Auth signin error:', err)
        await sendWhatsAppReply(phone, 'Something went wrong. Please try again.')
    }

    await markProcessed(supabase, messageId, 'auth_signin', null)
}

// ---------------------------------------------------------------------------
// help_navigation — In-app navigation help
// ---------------------------------------------------------------------------

async function handleHelpNavigation(
    supabase: SupabaseAdmin,
    messageId: string,
    phone: string,
    action: ExtractedAction & { intent: 'help_navigation' },
): Promise<void> {
    const helpResponse = getNavigationHelpResponse(action.question)
    await sendWhatsAppReply(phone, helpResponse)
    await markProcessed(supabase, messageId, 'help_navigation', null)
}

// ---------------------------------------------------------------------------
// reminder_create — Save a self-reminder to the reminders table
// ---------------------------------------------------------------------------

async function handleReminderCreate(
    supabase: SupabaseAdmin,
    messageId: string,
    phone: string,
    sender: SenderUser,
    action: ExtractedAction & { intent: 'reminder_create' },
): Promise<void> {
    if (!action.subject) {
        await sendWhatsAppReply(phone, "I couldn't understand what you'd like to be reminded about. Could you try again?")
        await markProcessed(supabase, messageId, 'reminder_create', 'Empty subject')
        return
    }

    // Default to 6:00 AM IST tomorrow if no time specified
    let scheduledAt: string
    if (action.remind_at) {
        scheduledAt = action.remind_at
    } else {
        const tomorrow = new Date()
        tomorrow.setDate(tomorrow.getDate() + 1)
        // 6:00 AM IST = 00:30 UTC
        const yyyy = tomorrow.getUTCFullYear()
        const mm = String(tomorrow.getUTCMonth() + 1).padStart(2, '0')
        const dd = String(tomorrow.getUTCDate()).padStart(2, '0')
        scheduledAt = `${yyyy}-${mm}-${dd}T06:00:00+05:30`
    }

    const { error } = await supabase
        .from('reminders')
        .insert({
            user_id: sender.id,
            organisation_id: sender.organisation_id,
            entity_type: 'self_reminder',
            subject: action.subject,
            channel: 'whatsapp',
            scheduled_at: scheduledAt,
            status: 'pending',
        })

    if (error) {
        await sendErrorAndMark(supabase, messageId, phone,
            'Something went wrong while setting the reminder.',
            `Reminder insert failed: ${error.message}`,
        )
        return
    }

    // Build a friendly confirmation with the scheduled date/time
    const scheduledDate = new Date(scheduledAt)
    const dateStr = scheduledDate.toLocaleDateString('en-IN', {
        day: 'numeric', month: 'short', year: 'numeric',
        timeZone: 'Asia/Kolkata',
    })
    const timeStr = scheduledDate.toLocaleTimeString('en-IN', {
        hour: '2-digit', minute: '2-digit', hour12: true,
        timeZone: 'Asia/Kolkata',
    })

    const confirmMsg = action.confirmation_message
        || `⏰ Got it! I'll remind you on ${dateStr} at ${timeStr} to ${action.subject}.`

    await sendWhatsAppReply(phone, confirmMsg)
    await markProcessed(supabase, messageId, 'reminder_create', null)
}

// ---------------------------------------------------------------------------
// scheduled_message — Schedule a message to be sent to someone later
// ---------------------------------------------------------------------------

async function handleScheduledMessage(
    supabase: SupabaseAdmin,
    messageId: string,
    phone: string,
    sender: SenderUser,
    action: ExtractedAction & { intent: 'scheduled_message' },
): Promise<void> {
    // Validate required fields
    if (!action.recipient_name) {
        await sendWhatsAppReply(phone, "I couldn't figure out who to send the message to. Could you mention their name?")
        await markProcessed(supabase, messageId, 'scheduled_message', 'Missing recipient_name')
        return
    }

    if (!action.message_content) {
        await sendWhatsAppReply(phone, "I couldn't determine the message content. Could you tell me what message to send?")
        await markProcessed(supabase, messageId, 'scheduled_message', 'Missing message_content')
        return
    }

    // Resolve recipient by name in org
    const matches = await fuzzyMatchUser(supabase, sender.organisation_id, action.recipient_name)

    if (matches.length === 0) {
        await sendWhatsAppReply(phone, `I couldn't find anyone named "${action.recipient_name}" in your organization.`)
        await markProcessed(supabase, messageId, 'scheduled_message', `Recipient not found: ${action.recipient_name}`)
        return
    }

    if (matches.length > 1) {
        const nameList = matches
            .map((u, i) => `${i + 1}. ${u.name}${u.phone_number ? ` (${u.phone_number})` : ''}`)
            .join('\n')

        await sendWhatsAppReply(phone,
            `I found multiple people named "${action.recipient_name}":\n\n${nameList}\n\nPlease reply with the full name of the person you want to send the message to.`)
        await markProcessed(supabase, messageId, 'needs_clarification', null)
        return
    }

    const recipient = matches[0]

    // Default to 9:00 AM IST tomorrow if no time specified
    let sendAt: string
    if (action.send_at) {
        sendAt = action.send_at
    } else {
        const tomorrow = new Date()
        tomorrow.setDate(tomorrow.getDate() + 1)
        const yyyy = tomorrow.getUTCFullYear()
        const mm = String(tomorrow.getUTCMonth() + 1).padStart(2, '0')
        const dd = String(tomorrow.getUTCDate()).padStart(2, '0')
        sendAt = `${yyyy}-${mm}-${dd}T09:00:00+05:30`
    }

    // Insert into reminders table
    const { error } = await supabase
        .from('reminders')
        .insert({
            user_id: sender.id,
            organisation_id: sender.organisation_id,
            entity_type: 'scheduled_message',
            subject: action.message_content,
            message_content: action.message_content,
            recipient_phone: recipient.phone_number,
            recipient_name: recipient.name,
            channel: 'whatsapp',
            scheduled_at: sendAt,
            status: 'pending',
        })

    if (error) {
        await sendErrorAndMark(supabase, messageId, phone,
            'Something went wrong while scheduling the message.',
            `Scheduled message insert failed: ${error.message}`,
        )
        return
    }

    // Build friendly confirmation
    const scheduledDate = new Date(sendAt)
    const dateStr = scheduledDate.toLocaleDateString('en-IN', {
        day: 'numeric', month: 'short', year: 'numeric',
        timeZone: 'Asia/Kolkata',
    })
    const timeStr = scheduledDate.toLocaleTimeString('en-IN', {
        hour: '2-digit', minute: '2-digit', hour12: true,
        timeZone: 'Asia/Kolkata',
    })

    const confirmMsg = action.confirmation_message
        || `📨 Got it! I'll send your message to ${recipient.name} on ${dateStr} at ${timeStr}.`

    await sendWhatsAppReply(phone, confirmMsg)
    await markProcessed(supabase, messageId, 'scheduled_message', null)
}

// ---------------------------------------------------------------------------
// unknown — Polite fallback
// ---------------------------------------------------------------------------

async function handleUnknown(
    supabase: SupabaseAdmin,
    messageId: string,
    phone: string,
    action: ExtractedAction,
): Promise<void> {
    await sendWhatsAppReply(phone, action.confirmation_message)
    await markProcessed(supabase, messageId, 'unknown', null)
}

// ---------------------------------------------------------------------------
// WhatsApp reply helper (non-fatal on error)
// ---------------------------------------------------------------------------

async function sendWhatsAppReply(phone: string, message: string): Promise<void> {
    try {
        await sendWhatsAppMessage(phone, message)
    } catch (err) {
        console.error('[ProcessMessage] Failed to send WhatsApp reply:', err)
    }
}
