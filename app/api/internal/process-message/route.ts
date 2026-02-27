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
import { findPhoneticMatches } from '@/lib/ai/phonetic-match'
import type { OrgUser } from '@/lib/ai/phonetic-match'
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
 * Fuzzy + phonetic match a person name within the organisation.
 * Handles first-name-only, last-name-only, and full-name lookups.
 * Uses both SQL ILIKE (for exact substring) and phonetic similarity
 * (for Indian name pronunciation variations from voice transcription).
 */
async function fuzzyMatchUser(
    supabase: SupabaseAdmin,
    orgId: string,
    name: string,
): Promise<{ id: string; name: string; phone_number?: string }[]> {
    // Fetch all org users for phonetic comparison
    const { data: allUsers } = await supabase
        .from('users')
        .select('id, name, first_name, last_name, phone_number')
        .eq('organisation_id', orgId)

    if (!allUsers || allUsers.length === 0) return []

    const orgUsers = allUsers as OrgUser[]

    // Use phonetic matching — threshold at 0.7 for broad matches
    const phoneticResults = findPhoneticMatches(name, orgUsers, 0.7)

    if (phoneticResults.length > 0) {
        // If we have any exact matches (score 1.0), only return those
        const exactMatches = phoneticResults.filter(r => r.score >= 1.0)
        if (exactMatches.length > 0) {
            return exactMatches.map(r => ({
                id: r.user.id,
                name: r.user.name,
                phone_number: r.user.phone_number,
            }))
        }

        // Otherwise return all phonetic matches above threshold
        return phoneticResults.map(r => ({
            id: r.user.id,
            name: r.user.name,
            phone_number: r.user.phone_number,
        }))
    }

    return []
}

// ---------------------------------------------------------------------------
// Core processing logic — callable directly from webhook via waitUntil
// ---------------------------------------------------------------------------

export async function processMessageInline(
    messageId: string,
    audioMediaId?: string,
    audioMimeType?: string,
): Promise<{ status: string; intent?: string }> {
    const supabase = createAdminClient() as SupabaseAdmin

    try {
        // 1. Fetch message from DB
        const { data: message, error: fetchError } = await supabase
            .from('incoming_messages')
            .select('id, phone, user_id, raw_text, processed, processing_error, intent_type')
            .eq('id', messageId)
            .single()

        if (fetchError || !message) {
            console.error('[ProcessMessage] Message not found:', messageId, fetchError?.message)
            return { status: 'not_found' }
        }

        const msg = message as IncomingMessage

        // 2. Idempotency
        if (msg.processed) {
            console.log('[ProcessMessage] Already processed:', messageId)
            return { status: 'already_processed' }
        }

        // 3. Resolve sender
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
            return { status: 'user_not_found' }
        }

        const sender = senderUser as SenderUser

        // 4. Audio transcription (if voice note)
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
                return { status: 'transcription_error' }
            }
        }

        // =====================================================================
        // 5. AI PIPELINE — Stage 1: Classify intent
        // =====================================================================

        console.log(`[ProcessMessage] Stage 1 — classifying intent for: "${textForAI.substring(0, 80)}"`)
        const classification = await classifyIntent(textForAI)
        console.log(`[ProcessMessage] Intent: ${classification.intent} (confidence: ${classification.confidence.toFixed(2)})`)

        // =====================================================================
        // 6. AI PIPELINE — Stage 2: Extract action data
        // =====================================================================

        let action = await extractAction(classification.intent, textForAI)
        console.log(`[ProcessMessage] Action extracted: ${action.intent}`)

        // ── Pipeline resilience: ActionExtractor failed but IntentClassifier succeeded ──
        // If Stage 2 returns 'unknown' but Stage 1 gave a valid intent,
        // create a fallback action from the raw text so we don't lose the classification.
        const extractionError = ((action as unknown) as Record<string, unknown>)._extractionError as string | undefined
        if (action.intent === 'unknown' && classification.intent !== 'unknown') {
            console.warn(`[ProcessMessage] ⚠️ ActionExtractor returned unknown but IntentClassifier said "${classification.intent}". Creating fallback action.`)
            console.warn(`[ProcessMessage] Extraction error: ${extractionError ?? 'none (JSON parse failure)'}`)

            if (classification.intent === 'task_create') {
                action = {
                    intent: 'task_create',
                    title: textForAI.substring(0, 120),
                    description: textForAI,
                    assignee_name: null,
                    deadline: null,
                    who_type: 'unknown' as const,
                    when_type: 'none' as const,
                }
                console.log(`[ProcessMessage] Fallback task_create action created from raw text.`)
            } else if (classification.intent === 'todo_create') {
                action = {
                    intent: 'todo_create',
                    title: textForAI.substring(0, 120),
                    description: textForAI,
                    deadline: null,
                    when_type: 'none' as const,
                }
                console.log(`[ProcessMessage] Fallback todo_create action created from raw text.`)
            } else if (classification.intent === 'reminder_create') {
                action = {
                    intent: 'reminder_create',
                    subject: textForAI.substring(0, 120),
                    remind_at: null,
                    when_type: 'none' as const,
                }
                console.log(`[ProcessMessage] Fallback reminder_create action created from raw text.`)
            } else {
                // For other intents, we can't create a meaningful fallback.
                // Send a specific AI-error message instead of the generic unknown.
                console.error(`[ProcessMessage] Cannot create fallback for intent "${classification.intent}". Sending AI error message.`)
                await sendWhatsAppReply(msg.phone, "⚠️ Our AI assistant is temporarily having trouble processing your request. Please try sending your message again in a moment. If this keeps happening, try rephrasing your message.")
                await markProcessed(supabase, messageId, classification.intent as string, `ActionExtractor failed: ${extractionError ?? 'unknown'}`)
                return { status: 'ai_extraction_error', intent: classification.intent }
            }
        }

        // =====================================================================
        // 7. Dispatch to intent handler
        // =====================================================================

        await dispatchIntent(supabase, messageId, msg.phone, sender, textForAI, action)

        console.log(`[ProcessMessage] Done: ${messageId} → ${action.intent}`, audioMediaId ? '(from audio)' : '')
        return { status: 'processed', intent: action.intent }

    } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown internal error'
        const errStack = err instanceof Error ? err.stack : ''
        console.error('[ProcessMessage] ❌ Unhandled error:', errMsg)
        console.error('[ProcessMessage] Stack:', errStack)
        console.error(`[ProcessMessage] Context: messageId=${messageId}, audioMediaId=${audioMediaId ?? 'none'}`)

        try {
            const { data: failMsg } = await supabase
                .from('incoming_messages')
                .select('phone')
                .eq('id', messageId)
                .single()

            if (failMsg?.phone) {
                await sendWhatsAppMessage(
                    failMsg.phone,
                    "⚠️ Our AI assistant ran into an issue while processing your message. Please try again in a moment. If the problem persists, try rephrasing your message or contact support."
                )
            }
            await markProcessed(supabase, messageId, null, errMsg)
        } catch (cleanupErr) {
            console.error('[ProcessMessage] Cleanup failed:', cleanupErr)
        }

        return { status: 'internal_error' }
    }
}

// ---------------------------------------------------------------------------
// POST handler — backwards-compatible HTTP endpoint
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

    const result = await processMessageInline(messageId, audioMediaId, audioMimeType)
    return NextResponse.json(result, { status: 200 })
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
            return handleUnknown(supabase, messageId, phone)
        case 'clarification_needed':
            await sendWhatsAppReply(phone, action.clarification_message || "I need a bit more information. Could you clarify your request?")
            await markProcessed(supabase, messageId, 'clarification_needed', null)
            return
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
    // ── VALIDATION 1: WHAT — is there a clear task? ──────────────────
    if (!action.title || action.title === 'Untitled task') {
        await sendWhatsAppReply(phone, "Please tell me what task you need done. For example: \"Tell Ramesh to send the invoice by Friday\"")
        await markProcessed(supabase, messageId, 'clarification_needed', 'Missing WHAT: no task title')
        return
    }

    // ── VALIDATION 2: WHO — who should do the task? ──────────────────

    // Case A: who_type is 'bot' — user expects the bot to do something
    // Re-route to a to-do/reminder since bot can't perform the task itself
    if (action.who_type === 'bot') {
        await sendWhatsAppReply(phone,
            `I can't do "${action.title}" myself, but I can remind you about it! ` +
            `Would you like me to set a reminder? Just say "Remind me to ${action.title}".`)
        await markProcessed(supabase, messageId, 'clarification_needed', 'WHO is bot — re-route needed')
        return
    }

    // Case B: who_type is 'self' — user wants to do it themselves → create a to-do
    if (action.who_type === 'self') {
        // Convert to self-assigned task (to-do)
        const { error: todoError } = await supabase
            .from('tasks')
            .insert({
                title: action.title,
                description: action.description,
                organisation_id: sender.organisation_id,
                created_by: sender.id,
                assigned_to: sender.id,
                deadline: action.deadline,
                committed_deadline: action.deadline,
                status: action.deadline ? 'accepted' : 'pending',
                source: 'whatsapp',
            })

        if (todoError) {
            await sendErrorAndMark(supabase, messageId, phone,
                'Something went wrong while creating the to-do.',
                `Todo insert failed: ${todoError.message}`,
            )
            return
        }

        const deadlineStr = action.deadline
            ? new Date(action.deadline).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
            : null
        const confirmMsg = deadlineStr
            ? `✅ To-do created: "${action.title}". Deadline: ${deadlineStr}.`
            : `✅ To-do created: "${action.title}".`

        await sendWhatsAppReply(phone, confirmMsg)
        await markProcessed(supabase, messageId, 'todo_create', null)
        return
    }

    // Case C: who_type is 'person' or 'unknown' — try to resolve the assignee
    let assignedToId: string | null = null
    let resolvedAssigneeName: string | null = null

    if (action.assignee_name) {
        const matches = await fuzzyMatchUser(supabase, sender.organisation_id, action.assignee_name)

        if (matches.length === 1) {
            assignedToId = matches[0].id
            resolvedAssigneeName = matches[0].name
        } else if (matches.length > 1) {
            // Multiple matches — ask user to clarify
            const nameList = matches
                .map((u, i) => `${i + 1}. ${u.name}${u.phone_number ? ` (${u.phone_number})` : ''}`)
                .join('\n')

            const clarifyMsg =
                `I found multiple people matching "${action.assignee_name}" in your organization:\n\n` +
                `${nameList}\n\n` +
                `Please reply with the full name of the person you want to assign "${action.title}" to.`

            await sendWhatsAppReply(phone, clarifyMsg)
            await markProcessed(supabase, messageId, 'needs_clarification', null)
            return
        } else {
            // NO MATCH FOUND — this is the critical fix!
            // Do NOT silently self-assign. Tell the user.
            await sendWhatsAppReply(phone,
                `I couldn't find anyone named "${action.assignee_name}" in your organization. ` +
                `Please check the name and try again, or say the full name of the person.`)
            await markProcessed(supabase, messageId, 'task_create', `Assignee not found: ${action.assignee_name}`)
            return
        }
    } else {
        // No assignee name extracted at all
        // If who_type is explicitly 'unknown', ask for clarification
        await sendWhatsAppReply(phone,
            `I understood the task "${action.title}", but I'm not sure who should do it. ` +
            `Please mention the person's name. For example: "Tell [person name] to ${action.title}".`)
        await markProcessed(supabase, messageId, 'clarification_needed', 'Missing WHO: no assignee name')
        return
    }

    // ── At this point: WHAT ✓, WHO ✓ (single match) ─────────────────

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

    // Build post-execution confirmation
    const confirmMsg = `✅ Task created: "${action.title}" assigned to ${resolvedAssigneeName}.`

    await sendWhatsAppReply(phone, confirmMsg)
    await markProcessed(supabase, messageId, 'task_create', null)

    // Fire-and-forget: notify the assignee
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

    // Build post-execution confirmation
    let confirmMsg = `✅ To-do created: "${action.title}".`
    if (action.deadline) {
        const d = new Date(action.deadline)
        const dateStr = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
        const timeStr = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })
        confirmMsg = `✅ To-do created: "${action.title}". Deadline: ${dateStr} at ${timeStr}.`
    }

    await sendWhatsAppReply(phone, confirmMsg)
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
    let confirmMsg = `✅ You've accepted "${taskTitle}". Remember to set a deadline when you can!`

    if (action.committed_deadline) {
        const d = new Date(action.committed_deadline)
        const dateStr = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
        const timeStr = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })
        confirmMsg = `✅ Great! You've accepted "${taskTitle}" with a deadline of ${dateStr} at ${timeStr}. Good luck! 💪`
    }

    await sendWhatsAppReply(phone, confirmMsg)
    await markProcessed(supabase, messageId, 'task_accept', null)

    // Fire-and-forget: notify all participants (actor excluded by source='whatsapp')
    const ownerIdStr = extractUserId(pendingTask.created_by)
    if (ownerIdStr) {
        notifyTaskAccepted(supabase, {
            ownerId: ownerIdStr,
            assigneeId: sender.id,
            assigneeName: sender.name,
            taskTitle: taskTitle,
            taskId: pendingTask.id,
            committedDeadline: action.committed_deadline,
            source: 'whatsapp',
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

    // Fire-and-forget: notify all participants
    const ownerIdStr = extractUserId(pendingTask.created_by)
    if (ownerIdStr) {
        notifyTaskRejected(supabase, {
            ownerId: ownerIdStr,
            assigneeId: sender.id,
            assigneeName: sender.name,
            taskTitle: taskTitle,
            taskId: pendingTask.id,
            reason: action.reason,
            source: 'whatsapp',
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

    // Fire-and-forget: notify all participants
    const assigneeIdStr = extractUserId(task.assigned_to)
    if (assigneeIdStr) {
        notifyTaskCompleted(supabase, {
            ownerId: sender.id,
            ownerName: sender.name,
            assigneeId: assigneeIdStr,
            taskTitle: task.title,
            taskId: task.id,
            source: 'whatsapp',
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

    // Fire-and-forget: notify all participants
    const assigneeIdDel = extractUserId(task.assigned_to)
    if (assigneeIdDel) {
        notifyTaskCancelled(supabase, {
            ownerId: sender.id,
            ownerName: sender.name,
            assigneeId: assigneeIdDel,
            taskTitle: task.title,
            taskId: task.id,
            source: 'whatsapp',
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

    const d = new Date(action.new_deadline)
    const dateStr = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
    const timeStr = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })
    await sendWhatsAppReply(phone, `📅 Deadline for "${task.title}" has been changed to ${dateStr} at ${timeStr}.`)
    await markProcessed(supabase, messageId, 'task_edit_deadline', null)

    // Fire-and-forget: notify all participants
    const dlOwnerId = extractUserId(task.created_by)
    const dlAssigneeId = extractUserId(task.assigned_to)
    if (dlOwnerId && dlAssigneeId) {
        notifyDeadlineEdited(supabase, {
            ownerId: dlOwnerId,
            assigneeId: dlAssigneeId,
            actorId: sender.id,
            actorName: sender.name,
            taskTitle: task.title,
            taskId: task.id,
            newDeadline: action.new_deadline,
            source: 'whatsapp',
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

    // Fire-and-forget: notify all participants
    const oldAssigneeIdStr = extractUserId(task.assigned_to)
    if (oldAssigneeIdStr) {
        notifyAssigneeChanged(supabase, {
            ownerId: sender.id,
            ownerName: sender.name,
            oldAssigneeId: oldAssigneeIdStr,
            newAssigneeId: newAssignee.id,
            newAssigneeName: newAssignee.name,
            taskTitle: task.title,
            taskId: task.id,
            source: 'whatsapp',
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

    // Fire-and-forget: notify all participants via unified engine
    // The subtask assignee will be notified through the Task Created event below
    const parentOwnerId = extractUserId(parentTask.created_by)

    // Look up assignee name for richer notification
    let subtaskAssigneeNameStr: string | undefined
    if (subtaskAssigneeId !== sender.id) {
        const { data: assigneeUser } = await supabase
            .from('users')
            .select('name')
            .eq('id', subtaskAssigneeId)
            .single() as { data: { name: string } | null }
        subtaskAssigneeNameStr = assigneeUser?.name || undefined
    }

    if (parentOwnerId) {
        notifySubtaskCreated(supabase, {
            parentTaskOwnerId: parentOwnerId,
            creatorId: sender.id,
            creatorName: sender.name,
            subtaskTitle: action.title,
            parentTaskTitle: parentTask.title,
            subtaskId: newSubtask.id,
            subtaskAssigneeName: subtaskAssigneeNameStr,
            source: 'whatsapp',
        }).catch(err => console.error('[ProcessMessage] Notification error (subtask_create):', err))
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
// reminder_create — Store as a self-assigned to-do (shows on dashboard)
// Also inserts a reminder row if a formal date is given.
// ---------------------------------------------------------------------------

async function handleReminderCreate(
    supabase: SupabaseAdmin,
    messageId: string,
    phone: string,
    sender: SenderUser,
    action: ExtractedAction & { intent: 'reminder_create' },
): Promise<void> {
    // ── VALIDATION: WHAT ─────────────────────────────────────────────
    if (!action.subject) {
        await sendWhatsAppReply(phone, "I couldn't understand what you'd like to be reminded about. Could you try again?")
        await markProcessed(supabase, messageId, 'reminder_create', 'Empty subject')
        return
    }

    // ── VALIDATION: WHEN — reminders need a formal date ──────────────
    if (action.when_type === 'informal') {
        await sendWhatsAppReply(phone,
            `I understood you want to be reminded to "${action.subject}", but I need a specific date or time to set the reminder. ` +
            `Please include a date, for example: "Remind me to ${action.subject} on Monday" or "Remind me to ${action.subject} at 3 PM tomorrow".`)
        await markProcessed(supabase, messageId, 'clarification_needed', 'Informal date for reminder')
        return
    }

    // Default to 6:00 AM IST tomorrow if when_type is 'none'
    let deadlineStr: string
    if (action.remind_at) {
        deadlineStr = action.remind_at
    } else {
        const tomorrow = new Date()
        tomorrow.setDate(tomorrow.getDate() + 1)
        const yyyy = tomorrow.getUTCFullYear()
        const mm = String(tomorrow.getUTCMonth() + 1).padStart(2, '0')
        const dd = String(tomorrow.getUTCDate()).padStart(2, '0')
        deadlineStr = `${yyyy}-${mm}-${dd}T06:00:00+05:30`
    }

    // ── Store as a self-assigned task (to-do) so it shows on dashboard ──
    const { data: newTodo, error: todoError } = await supabase
        .from('tasks')
        .insert({
            title: action.subject,
            description: `[Reminder] ${action.subject}`,
            organisation_id: sender.organisation_id,
            created_by: sender.id,
            assigned_to: sender.id,
            deadline: deadlineStr,
            committed_deadline: deadlineStr,
            status: 'accepted',
            source: 'whatsapp',
        })
        .select('id')
        .single()

    if (todoError || !newTodo) {
        await sendErrorAndMark(supabase, messageId, phone,
            'Something went wrong while setting the reminder.',
            `Reminder-as-todo insert failed: ${todoError?.message || 'Unknown error'}`,
        )
        return
    }

    // ── ALSO insert into reminders table for the cron job to send a WhatsApp ping ──
    supabase
        .from('reminders')
        .insert({
            user_id: sender.id,
            organisation_id: sender.organisation_id,
            entity_type: 'self_reminder',
            entity_id: newTodo.id,
            subject: action.subject,
            channel: 'whatsapp',
            scheduled_at: deadlineStr,
            status: 'pending',
        })
        .then(() => { /* fire-and-forget */ })
        .catch((err: unknown) => console.error('[ProcessMessage] Failed to insert reminder row:', err))

    // Build a friendly confirmation
    const scheduledDate = new Date(deadlineStr)
    const dateDisplay = scheduledDate.toLocaleDateString('en-IN', {
        day: 'numeric', month: 'short', year: 'numeric',
        timeZone: 'Asia/Kolkata',
    })
    const timeDisplay = scheduledDate.toLocaleTimeString('en-IN', {
        hour: '2-digit', minute: '2-digit', hour12: true,
        timeZone: 'Asia/Kolkata',
    })

    const confirmMsg = `⏰ Got it! I'll remind you on ${dateDisplay} at ${timeDisplay} to ${action.subject}. This is also saved as a to-do on your dashboard.`

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

    const confirmMsg = `📨 Got it! I'll send your message to ${recipient.name} on ${dateStr} at ${timeStr}.`

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
): Promise<void> {
    console.log(`[ProcessMessage] Handling unknown intent for message ${messageId}`)
    await sendWhatsAppReply(phone, "I'm not sure I understood that. I can help you manage tasks — try saying something like \"Tell Ramesh to send the invoice\" or \"Show my pending tasks\". 😊")
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
