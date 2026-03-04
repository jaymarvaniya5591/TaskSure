/**
 * Session Reply Handler — routes follow-up replies to the correct session handler.
 *
 * When a user has an active session and sends a follow-up message (e.g., a name
 * after being asked "who should do this?"), this module processes the reply in
 * the context of the active session.
 *
 * Each session type has its own handler that:
 *  1. Attempts to use the reply to complete the flow
 *  2. Returns { handled: true } if successful
 *  3. Returns { handled: false, fallThrough: true } if the reply doesn't fit
 *     the session (e.g., user sent a new intent instead of answering)
 */

import { sendWhatsAppMessage } from '@/lib/whatsapp'
import { findPhoneticMatches, type OrgUser } from '@/lib/ai/phonetic-match'
import {
    notifyTaskCreated,
    notifyTaskAccepted,
    notifyTaskRejected,
} from '@/lib/notifications/whatsapp-notifier'
import type { ConversationSession, SessionContextData } from './conversation-context'
import { createSession, resolveSession } from './conversation-context'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseAdmin = any

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionResult {
    /** Whether the session handled the reply */
    handled: boolean
    /** The intent that was processed */
    intent?: string
    /** If false, the reply should be processed through the normal AI pipeline */
    fallThrough?: boolean
}

interface SenderUser {
    id: string
    name: string
    phone_number: string
    organisation_id: string
}

// ---------------------------------------------------------------------------
// Main dispatcher
// ---------------------------------------------------------------------------

/**
 * Handle a user's reply in the context of their active session.
 */
export async function handleSessionReply(
    supabase: SupabaseAdmin,
    session: ConversationSession,
    userText: string,
    sender: SenderUser,
    messageId: string,
): Promise<SessionResult> {
    console.log(`[SessionReply] Handling ${session.session_type} for ${session.phone}. Reply: "${userText.substring(0, 80)}"`)

    switch (session.session_type) {
        case 'awaiting_assignee_name':
            return handleAwaitingAssigneeName(supabase, session, userText, sender, messageId)

        case 'awaiting_assignee_selection':
            return handleAwaitingAssigneeSelection(supabase, session, userText, sender, messageId)

        case 'awaiting_task_description':
            return handleAwaitingTaskDescription(supabase, session, userText, sender, messageId)

        case 'awaiting_todo_deadline':
            return handleAwaitingTodoDeadline(supabase, session, userText, sender, messageId)

        case 'awaiting_accept_deadline':
            return handleAwaitingAcceptDeadline(supabase, session, userText, sender, messageId)

        case 'awaiting_reject_reason':
            return handleAwaitingRejectReason(supabase, session, userText, sender, messageId)

        case 'awaiting_edit_deadline':
            return handleAwaitingEditDeadline(supabase, session, userText, sender, messageId)

        default:
            console.warn(`[SessionReply] Unknown session type: ${session.session_type}`)
            return { handled: false, fallThrough: true }
    }
}

// ---------------------------------------------------------------------------
// Session handlers
// ---------------------------------------------------------------------------

/**
 * awaiting_assignee_name — user was asked "who should do this?"
 * The reply should contain a person's name.
 */
async function handleAwaitingAssigneeName(
    supabase: SupabaseAdmin,
    session: ConversationSession,
    userText: string,
    sender: SenderUser,
    messageId: string,
): Promise<SessionResult> {
    const ctx = session.context_data
    const orgId = ctx.organisation_id || sender.organisation_id

    // Guard: if the reply looks like a new task/command rather than just a name,
    // abandon the session and let the normal AI pipeline handle it.
    const looksLikeNewIntent = await isNewTaskIntent(userText)
    if (looksLikeNewIntent) {
        await resolveSession(session.id, supabase)
        return { handled: false, fallThrough: true }
    }

    // Fuzzy-match the reply as a person name
    const matches = await fuzzyMatchUser(supabase, orgId, userText.trim())

    if (matches.length === 0) {
        // No match — ask again, keep session alive
        await sendReply(session.phone,
            `🔍 *Not Found*\n\n*No match found for:*\n${userText.trim()}\n\nPlease try the full name, or say "cancel" to start over.`)
        return { handled: true, intent: 'task_create' }
    }

    if (matches.length > 1) {
        // Multiple matches — switch to selection mode
        const nameList = matches
            .map((u, i) => `${i + 1}. ${u.name}${u.phone_number ? ` (${u.phone_number})` : ''}`)
            .join('\n')

        await createSession(session.phone, 'awaiting_assignee_selection', {
            ...ctx,
            candidates: matches.map(u => ({ id: u.id, name: u.name, phone_number: u.phone_number })),
        }, 10, supabase)

        await resolveSession(session.id, supabase)

        await sendReply(session.phone,
            `👥 *Multiple Matches Found*\n\n*Searched for:*\n${userText.trim()}\n\n${nameList}\n\nPlease reply with the number or the full name to continue.`)

        return { handled: true, intent: 'task_create' }
    }

    // Single match — create the task
    await resolveSession(session.id, supabase)
    return await createTaskWithAssignee(supabase, session.phone, sender, matches[0], ctx, messageId)
}

/**
 * awaiting_assignee_selection — bot showed numbered list, user picks one.
 */
async function handleAwaitingAssigneeSelection(
    supabase: SupabaseAdmin,
    session: ConversationSession,
    userText: string,
    sender: SenderUser,
    messageId: string,
): Promise<SessionResult> {
    const ctx = session.context_data
    const candidates = ctx.candidates || []

    if (candidates.length === 0) {
        await resolveSession(session.id, supabase)
        return { handled: false, fallThrough: true }
    }

    const trimmed = userText.trim()

    // Try to match by number (e.g., "1", "2")
    const num = parseInt(trimmed, 10)
    if (!isNaN(num) && num >= 1 && num <= candidates.length) {
        const selected = candidates[num - 1]
        await resolveSession(session.id, supabase)
        return await createTaskWithAssignee(supabase, session.phone, sender, selected, ctx, messageId)
    }

    // Try to match by name against the candidates
    const lowerReply = trimmed.toLowerCase()
    const nameMatch = candidates.find(c =>
        c.name.toLowerCase().includes(lowerReply) ||
        lowerReply.includes(c.name.toLowerCase())
    )

    if (nameMatch) {
        await resolveSession(session.id, supabase)
        return await createTaskWithAssignee(supabase, session.phone, sender, nameMatch, ctx, messageId)
    }

    // Try phonetic match against just the candidates
    const orgId = ctx.organisation_id || sender.organisation_id
    const allUsers = await fetchOrgUsers(supabase, orgId)
    const phoneticMatches = findPhoneticMatches(trimmed, allUsers, 0.7)

    if (phoneticMatches.length === 1) {
        // Check if this single match is one of our candidates
        const matchedUser = phoneticMatches[0].user
        const candidateMatch = candidates.find(c => c.id === matchedUser.id)
        if (candidateMatch) {
            await resolveSession(session.id, supabase)
            return await createTaskWithAssignee(supabase, session.phone, sender, candidateMatch, ctx, messageId)
        }
        // Match found but not in candidates — still use it (user might have clarified with a different name)
        await resolveSession(session.id, supabase)
        return await createTaskWithAssignee(
            supabase, session.phone, sender,
            { id: matchedUser.id, name: matchedUser.name, phone_number: matchedUser.phone_number },
            ctx, messageId,
        )
    }

    // Could not match — let the user try again, keep session alive
    const nameList = candidates
        .map((c, i) => `${i + 1}. ${c.name}`)
        .join('\n')

    await sendReply(session.phone,
        `❌ *Invalid Selection*\n\n*Couldn't match:*\n"${trimmed}"\n\nPlease reply with the number:\n\n${nameList}`)

    return { handled: true, intent: 'task_create' }
}

/**
 * awaiting_task_description — bot knows who, needs what.
 */
async function handleAwaitingTaskDescription(
    supabase: SupabaseAdmin,
    session: ConversationSession,
    userText: string,
    sender: SenderUser,
    messageId: string,
): Promise<SessionResult> {
    const ctx = session.context_data
    const trimmed = userText.trim()

    if (trimmed.length < 3) {
        await sendReply(session.phone,
            `📋 *More Details Needed*\n\nPlease provide a task description (at least a few words).\n\nWhat needs to be done?`)
        return { handled: true, intent: ctx.original_intent || 'task_create' }
    }

    // Update context with the task description
    ctx.what = trimmed
    await resolveSession(session.id, supabase)

    if (ctx.original_intent === 'todo_create' || ctx.who_name === null) {
        // This is a self-todo — but we still need a deadline
        await createSession(session.phone, 'awaiting_todo_deadline', ctx, 10, supabase)
        await sendReply(session.phone,
            `⏰ *Deadline Needed*\n\n*To-do:*\n"${trimmed}"\n\nWhen should this be done?\n\n*Examples:*\n"tomorrow 3pm", "Friday", "March 10"`)
        return { handled: true, intent: 'todo_create' }
    }

    // This is a task for someone — do we have a name?
    if (ctx.who_name) {
        const matches = await fuzzyMatchUser(supabase, ctx.organisation_id || sender.organisation_id, ctx.who_name)
        if (matches.length === 1) {
            return await createTaskWithAssignee(supabase, session.phone, sender, matches[0], ctx, messageId)
        }
    }

    // Fallback to normal pipeline
    return { handled: false, fallThrough: true }
}

/**
 * awaiting_todo_deadline — bot knows what, needs when.
 */
async function handleAwaitingTodoDeadline(
    supabase: SupabaseAdmin,
    session: ConversationSession,
    userText: string,
    sender: SenderUser,
    messageId: string,
): Promise<SessionResult> {
    const ctx = session.context_data

    // Parse date from the user's reply
    const deadline = await parseDateFromText(userText)

    if (!deadline) {
        await sendReply(session.phone,
            `⏰ *Date Unclear*\n\nI couldn't detect a date in your reply.\n\n*Try something like:*\n"tomorrow", "Friday 3pm", or "March 10"`)
        return { handled: true, intent: 'todo_create' }
    }

    // Create the to-do
    await resolveSession(session.id, supabase)

    let normalizedDeadline = deadline
    if (!normalizedDeadline.includes('T')) {
        normalizedDeadline = `${normalizedDeadline}T20:00:00+05:30`
    }

    const { data: createdTodo, error: todoError } = await supabase
        .from('tasks')
        .insert({
            title: ctx.what,
            description: ctx.what,
            organisation_id: ctx.organisation_id || sender.organisation_id,
            created_by: sender.id,
            assigned_to: sender.id,
            deadline: normalizedDeadline,
            committed_deadline: normalizedDeadline,
            status: 'accepted',
            source: 'whatsapp',
        })
        .select('id')
        .single()

    if (todoError) {
        console.error('[SessionReply] Todo insert failed:', todoError.message)
        await sendReply(session.phone, '❌ *Error*\n\nSomething went wrong while creating the to-do.\n\nPlease try again.')
        return { handled: true, intent: 'todo_create' }
    }

    const d = new Date(normalizedDeadline)
    const dateStr = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
    const timeStr = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })

    await sendReply(session.phone,
        `✅ *To-Do Created!*\n\n*To-do:*\n"${ctx.what}"\n\n*Deadline:*\n${dateStr} at ${timeStr}`)

    await markProcessed(supabase, messageId, 'todo_create', null)

    if (createdTodo) {
        await notifyTaskCreated(supabase, {
            ownerName: sender.name,
            ownerId: sender.id,
            assigneeId: sender.id,
            taskTitle: ctx.what || 'Untitled to-do',
            taskId: createdTodo.id,
            committedDeadline: normalizedDeadline,
            source: 'whatsapp',
        }).catch(err => console.error('[SessionReply] Notification error (todo_create):', err))
    }

    return { handled: true, intent: 'todo_create' }
}

/**
 * awaiting_accept_deadline — user tapped Accept, bot needs a deadline date.
 * If the reply doesn't look like a date, we fall through to normal pipeline
 * and send a clarification message.
 */
async function handleAwaitingAcceptDeadline(
    supabase: SupabaseAdmin,
    session: ConversationSession,
    userText: string,
    sender: SenderUser,
    messageId: string,
): Promise<SessionResult> {
    const ctx = session.context_data
    const taskId = ctx.task_id

    if (!taskId) {
        await resolveSession(session.id, supabase)
        return { handled: false, fallThrough: true }
    }

    // First, check if the message is actually a deadline response or a new intent.
    // If it looks like a full sentence with a subject/verb/action, treat it as a
    // new intent rather than a deadline reply.
    const looksLikeDeadline = await isDeadlineResponse(userText)
    if (!looksLikeDeadline) {
        // The user sent a different intent — resolve session and fall through.
        await resolveSession(session.id, supabase)
        return { handled: false, fallThrough: true }
    }

    // Try to parse a date
    const deadline = await parseDateFromText(userText)

    if (!deadline) {
        // Not a date — resolve session and fall through to normal pipeline.
        // The process-message handler will send the clarification message.
        await resolveSession(session.id, supabase)
        return { handled: false, fallThrough: true }
    }

    // Date parsed — accept the task
    const { data: task, error: fetchError } = await supabase
        .from('tasks')
        .select('id, title, assigned_to, created_by, status')
        .eq('id', taskId)
        .single()

    if (fetchError || !task) {
        await resolveSession(session.id, supabase)
        await sendReply(session.phone, '⚠️ *Task Not Found*\n\nThis task could not be found.\n\n_It may have been deleted._')
        await markProcessed(supabase, messageId, 'task_accept', 'Task not found')
        return { handled: true, intent: 'task_accept' }
    }

    if (task.assigned_to !== sender.id) {
        await resolveSession(session.id, supabase)
        await sendReply(session.phone, '🚫 *Action Denied*\n\nYou can only accept or reject tasks\nthat are assigned to you.')
        await markProcessed(supabase, messageId, 'task_accept', 'Not the assignee')
        return { handled: true, intent: 'task_accept' }
    }

    if (task.status !== 'pending') {
        await resolveSession(session.id, supabase)
        await sendReply(session.phone, 'ℹ️ *Already Handled*\n\nThis task has already been accepted/rejected\nor is no longer pending.')
        await markProcessed(supabase, messageId, 'task_accept', `Task status is ${task.status}`)
        return { handled: true, intent: 'task_accept' }
    }

    // Accept the task with the deadline
    const { error } = await supabase
        .from('tasks')
        .update({
            status: 'accepted',
            committed_deadline: deadline,
            updated_at: new Date().toISOString(),
        })
        .eq('id', taskId)

    if (error) {
        await resolveSession(session.id, supabase)
        await sendReply(session.phone, '❌ *Error*\n\nSomething went wrong while accepting the task.\n\nPlease try again.')
        await markProcessed(supabase, messageId, 'task_accept', `Task accept failed: ${error.message}`)
        return { handled: true, intent: 'task_accept' }
    }

    await resolveSession(session.id, supabase)

    const d = new Date(deadline)
    const dateStr = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
    const timeStr = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })
    await sendReply(session.phone,
        `✅ *Task Accepted!* 💪\n\n*Task:*\n"${task.title}"\n\n*Your Deadline:*\n${dateStr} at ${timeStr}\n\n_Good luck!_`)

    await markProcessed(supabase, messageId, 'task_accept', null)

    // Notify task owner
    await notifyTaskAccepted(supabase, {
        ownerId: task.created_by,
        assigneeId: sender.id,
        assigneeName: sender.name,
        taskTitle: task.title || 'Untitled task',
        taskId: taskId,
        committedDeadline: deadline,
        source: 'whatsapp',
    }).catch((err: unknown) => console.error('[SessionReply] Notification error (task_accept):', err))

    return { handled: true, intent: 'task_accept' }
}

/**
 * awaiting_edit_deadline — user tapped "Edit Deadline", bot needs a new date.
 * Mirrors handleAwaitingAcceptDeadline:
 *   1. ​isDeadlineResponse guard
 *   2. parseDateFromText
 *   3. Update committed_deadline
 *   4. Resolve session + reply + acknowledge reminder
 */
async function handleAwaitingEditDeadline(
    supabase: SupabaseAdmin,
    session: ConversationSession,
    userText: string,
    sender: SenderUser,
    messageId: string,
): Promise<SessionResult> {
    const ctx = session.context_data
    const taskId = ctx.task_id

    if (!taskId) {
        await resolveSession(session.id, supabase)
        return { handled: false, fallThrough: true }
    }

    // Check if the message is a date response or a new intent
    const looksLikeDeadline = await isDeadlineResponse(userText)
    if (!looksLikeDeadline) {
        // Not a date — resolve session and fall through
        await resolveSession(session.id, supabase)
        return { handled: false, fallThrough: true }
    }

    // Try to parse a date
    const deadline = await parseDateFromText(userText)

    if (!deadline) {
        // Couldn't parse — resolve session and fall through
        await resolveSession(session.id, supabase)
        return { handled: false, fallThrough: true }
    }

    // Date parsed — update the task deadline
    const { data: task, error: fetchError } = await supabase
        .from('tasks')
        .select('id, title, assigned_to, created_by, status, committed_deadline')
        .eq('id', taskId)
        .single()

    if (fetchError || !task) {
        await resolveSession(session.id, supabase)
        await sendReply(session.phone, '⚠️ *Task Not Found*\n\nThis task could not be found.\n\n_It may have been deleted._')
        await markProcessed(supabase, messageId, 'edit_deadline', 'Task not found')
        return { handled: true, intent: 'edit_deadline' }
    }

    if (['completed', 'cancelled'].includes(task.status)) {
        await resolveSession(session.id, supabase)
        await sendReply(session.phone, 'ℹ️ *Cannot Edit*\n\nThis task is already completed or cancelled.')
        await markProcessed(supabase, messageId, 'edit_deadline', `Task status is ${task.status}`)
        return { handled: true, intent: 'edit_deadline' }
    }

    // Update the deadline
    const { error } = await supabase
        .from('tasks')
        .update({
            committed_deadline: deadline,
            updated_at: new Date().toISOString(),
        })
        .eq('id', taskId)

    if (error) {
        await resolveSession(session.id, supabase)
        await sendReply(session.phone, '❌ *Error*\n\nSomething went wrong while updating the deadline.\n\nPlease try again.')
        await markProcessed(supabase, messageId, 'edit_deadline', `Deadline update failed: ${error.message}`)
        return { handled: true, intent: 'edit_deadline' }
    }

    await resolveSession(session.id, supabase)

    const d = new Date(deadline)
    const dateStr = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
    const timeStr = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })
    await sendReply(session.phone,
        `✅ *Deadline Updated!* 📅\n\n*Task:*\n"${task.title}"\n\n*New Deadline:*\n${dateStr} at ${timeStr}`)

    await markProcessed(supabase, messageId, 'edit_deadline', null)

    // Mark the latest reminder as acknowledged (if applicable)
    try {
        const { data: reminderNotifs } = await supabase
            .from('task_notifications')
            .select('id, metadata')
            .eq('task_id', taskId)
            .in('stage', ['reminder', 'deadline_approaching'])
            .eq('channel', 'whatsapp')
            .eq('status', 'sent')
            .order('sent_at', { ascending: false })
            .limit(1)

        if (reminderNotifs && reminderNotifs.length > 0) {
            const notif = reminderNotifs[0]
            const updatedMetadata = { ...(notif.metadata || {}), acknowledged: true, acknowledged_at: new Date().toISOString() }
            await supabase
                .from('task_notifications')
                .update({ metadata: updatedMetadata, updated_at: new Date().toISOString() })
                .eq('id', notif.id)
        }

        // Cancel any pending call escalation for this task's reminders
        await supabase
            .from('task_notifications')
            .update({ status: 'cancelled', updated_at: new Date().toISOString() })
            .eq('task_id', taskId)
            .eq('stage', 'reminder')
            .eq('channel', 'call')
            .eq('status', 'pending')
    } catch (err) {
        console.error('[SessionReply] Error acknowledging reminder after deadline edit:', err)
    }

    // Notify owner about deadline change (if the editor is the assignee, not the owner)
    if (task.assigned_to === sender.id && task.created_by !== sender.id) {
        try {
            const owner = await supabase
                .from('users')
                .select('phone_number, name')
                .eq('id', task.created_by)
                .single()

            if (owner?.data?.phone_number) {
                const ownerPhone = owner.data.phone_number.startsWith('91') ? owner.data.phone_number : `91${owner.data.phone_number}`
                const { sendWhatsAppMessage: sendMsg } = await import('@/lib/whatsapp')
                await sendMsg(
                    ownerPhone,
                    `📅 *Deadline Updated*\n\n*Task:*\n"${task.title}"\n\n*Updated by:*\n${sender.name}\n\n*New Deadline:*\n${dateStr} at ${timeStr}`
                )
            }
        } catch (err) {
            console.error('[SessionReply] Error notifying owner about deadline change:', err)
        }
    }

    return { handled: true, intent: 'edit_deadline' }
}

/**
 * awaiting_reject_reason — user tapped Reject, bot expects a reason.
 * Mirrors the handleAwaitingAcceptDeadline flow exactly:
 *   1. isRejectionReason guard (like isDeadlineResponse)
 *   2. Fetch + validate task
 *   3. Update DB
 *   4. Resolve session + reply + notify
 */
async function handleAwaitingRejectReason(
    supabase: SupabaseAdmin,
    session: ConversationSession,
    userText: string,
    sender: SenderUser,
    messageId: string,
): Promise<SessionResult> {
    const ctx = session.context_data
    const taskId = ctx.task_id

    if (!taskId) {
        await resolveSession(session.id, supabase)
        return { handled: false, fallThrough: true }
    }

    // First, check if the message is actually a rejection reason or a new intent.
    // If it looks like a new task/command, treat it as a new intent and fall through.
    const looksLikeReason = await isRejectionReason(userText)
    if (!looksLikeReason) {
        // The user sent a different intent — resolve session and fall through.
        await resolveSession(session.id, supabase)
        return { handled: false, fallThrough: true }
    }

    // Reason validated — reject the task
    const { data: task, error: fetchError } = await supabase
        .from('tasks')
        .select('id, title, assigned_to, created_by, status')
        .eq('id', taskId)
        .single()

    if (fetchError || !task) {
        await resolveSession(session.id, supabase)
        await sendReply(session.phone, '⚠️ *Task Not Found*\n\nThis task could not be found.\n\n_It may have been deleted._')
        await markProcessed(supabase, messageId, 'task_reject', 'Task not found')
        return { handled: true, intent: 'task_reject' }
    }

    if (task.assigned_to !== sender.id) {
        await resolveSession(session.id, supabase)
        await sendReply(session.phone, '🚫 *Action Denied*\n\nYou can only accept or reject tasks\nthat are assigned to you.')
        await markProcessed(supabase, messageId, 'task_reject', 'Not the assignee')
        return { handled: true, intent: 'task_reject' }
    }

    if (task.status !== 'pending') {
        await resolveSession(session.id, supabase)
        await sendReply(session.phone, 'ℹ️ *Already Handled*\n\nThis task has already been accepted/rejected\nor is no longer pending.')
        await markProcessed(supabase, messageId, 'task_reject', `Task status is ${task.status}`)
        return { handled: true, intent: 'task_reject' }
    }

    // Reject the task
    const { error } = await supabase
        .from('tasks')
        .update({
            status: 'cancelled',
            updated_at: new Date().toISOString(),
        })
        .eq('id', taskId)

    if (error) {
        await resolveSession(session.id, supabase)
        await sendReply(session.phone, '❌ *Error*\n\nSomething went wrong while rejecting the task.\n\nPlease try again.')
        await markProcessed(supabase, messageId, 'task_reject', `Task reject failed: ${error.message}`)
        return { handled: true, intent: 'task_reject' }
    }

    await resolveSession(session.id, supabase)

    const reasonStr = userText ? `\n\n*Reason:*\n${userText}` : ''
    await sendReply(session.phone,
        `❌ *Task Declined*\n\n*Task:*\n"${task.title}"${reasonStr}\n\n_The task owner has been notified._`)

    await markProcessed(supabase, messageId, 'task_reject', null)

    // Fire-and-forget: store rejection comment
    if (userText) {
        supabase.from('task_comments').insert({
            task_id: taskId,
            user_id: sender.id,
            content: `Rejected: ${userText}`,
        }).then(() => { /* ignore */ })
            .catch((err: unknown) => console.error('[SessionReply] Failed to store rejection comment:', err))
    }

    // Notify task owner
    await notifyTaskRejected(supabase, {
        ownerId: task.created_by,
        assigneeId: sender.id,
        assigneeName: sender.name,
        taskTitle: task.title || 'Untitled task',
        taskId: taskId,
        reason: userText || null,
        source: 'whatsapp',
    }).catch((err: unknown) => console.error('[SessionReply] Notification error (task_reject):', err))

    return { handled: true, intent: 'task_reject' }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function createTaskWithAssignee(
    supabase: SupabaseAdmin,
    phone: string,
    sender: SenderUser,
    assignee: { id: string; name: string; phone_number?: string },
    ctx: SessionContextData,
    messageId: string,
): Promise<SessionResult> {
    const { data: newTask, error: taskError } = await supabase
        .from('tasks')
        .insert({
            title: ctx.what,
            description: ctx.what,
            organisation_id: ctx.organisation_id || sender.organisation_id,
            created_by: sender.id,
            assigned_to: assignee.id,
            status: 'pending',
            source: 'whatsapp',
        })
        .select('id')
        .single()

    if (taskError || !newTask) {
        console.error('[SessionReply] Task insert failed:', taskError?.message)
        await sendReply(phone, '❌ *Error*\n\nSomething went wrong while creating the task.\n\nPlease try again.')
        await markProcessed(supabase, messageId, 'task_create', `Task insert failed: ${taskError?.message}`)
        return { handled: true, intent: 'task_create' }
    }

    await sendReply(phone,
        `✅ *Task Created!*\n\n*Task:*\n"${ctx.what}"\n\n*Assigned to:*\n${assignee.name}\n\n_They'll receive a notification to accept it._`)

    await markProcessed(supabase, messageId, 'task_create', null)

    // Notify assignee
    await notifyTaskCreated(supabase, {
        ownerName: sender.name,
        ownerId: sender.id,
        assigneeId: assignee.id,
        taskTitle: ctx.what || 'Untitled task',
        taskId: newTask.id,
        source: 'whatsapp',
    }).catch(err => console.error('[SessionReply] Notification error (task_create):', err))

    return { handled: true, intent: 'task_create' }
}

async function sendReply(phone: string, message: string): Promise<void> {
    try {
        await sendWhatsAppMessage(phone, message)
    } catch (err) {
        console.error('[SessionReply] Failed to send WhatsApp reply:', err)
    }
}

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
        console.error('[SessionReply] Failed to mark processed:', updateError.message)
    }
}

async function fuzzyMatchUser(
    supabase: SupabaseAdmin,
    orgId: string,
    name: string,
): Promise<{ id: string; name: string; phone_number?: string }[]> {
    const allUsers = await fetchOrgUsers(supabase, orgId)

    const phoneticResults = findPhoneticMatches(name, allUsers, 0.7)

    if (phoneticResults.length > 0) {
        const exactMatches = phoneticResults.filter(r => r.score >= 1.0)
        if (exactMatches.length > 0) {
            return exactMatches.map(r => ({
                id: r.user.id,
                name: r.user.name,
                phone_number: r.user.phone_number,
            }))
        }

        return phoneticResults.map(r => ({
            id: r.user.id,
            name: r.user.name,
            phone_number: r.user.phone_number,
        }))
    }

    return []
}

async function fetchOrgUsers(supabase: SupabaseAdmin, orgId: string): Promise<OrgUser[]> {
    const { data: allUsers } = await supabase
        .from('users')
        .select('id, name, first_name, last_name, phone_number')
        .eq('organisation_id', orgId)

    if (!allUsers || allUsers.length === 0) return []
    return allUsers as OrgUser[]
}

/**
 * Determine if a message looks like a fully-formed new task/todo command
 * (e.g. "Tell Ramesh to prepare the report") vs. a simple person name reply
 * (e.g. "Ramesh", "Beta tester", "the new guy").
 *
 * Returns true if the message should be treated as a new intent, not a name.
 */
async function isNewTaskIntent(text: string): Promise<boolean> {
    // Fast path: short inputs (≤4 words) are almost certainly just names
    const wordCount = text.trim().split(/\s+/).length
    if (wordCount <= 4) return false

    try {
        const { callGemini } = await import('@/lib/gemini')

        const prompt = `You are an intent classifier for a WhatsApp task-management bot.
The bot asked the user: "Who should do this task? Please reply with a name."

Determine if the user's reply is PURELY providing a person's name, OR if it is a
new task/command instruction that should be treated as a completely new request.

A reply is a NAME if it:
- Is just a person's name or role: "Ramesh", "Beta tester", "the intern", "john smith"
- Has a small qualifier: "the new guy", "my colleague Priya"

A reply is a NEW TASK INTENT if it:
- Contains a subject + verb + action: "Tell Ramesh to send the report"
- Describes something to be done by someone: "Ask John to prepare the slides by Friday"
- Is clearly a new instruction, not just a name

Return ONLY a JSON object: { "is_new_intent": true } or { "is_new_intent": false }`

        const result = await callGemini(prompt, text)
        const parsed = JSON.parse(result.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim())
        return parsed.is_new_intent === true
    } catch {
        // On error, be conservative: treat as a name, let fuzzy match handle it
        return false
    }
}

/**
 * Determine if a message is genuinely a deadline response (e.g. "tomorrow",
 * "next Friday 5pm") vs. a new intent/sentence (e.g. "Ask beta tester to get
 * the file ready by tomorrow").
 *
 * Returns true only if the message's PRIMARY purpose is to communicate a date/time.
 */
async function isDeadlineResponse(text: string): Promise<boolean> {
    try {
        const { callGemini } = await import('@/lib/gemini')

        const prompt = `You are an intent classifier for a WhatsApp task-management bot.
The bot asked the user: "When is your deadline for this task?"

Determine if the user's reply is PURELY providing a deadline (date/time), or if it is
a new/unrelated message that just happens to mention a time word (like "tomorrow").

A reply is a DEADLINE RESPONSE if it:
- Is just a date or time expression: "tomorrow", "Friday 5pm", "March 10", "next week"
- Confirms a time: "by tomorrow", "end of day", "tonight"

A reply is NOT a deadline response if it:
- Contains a subject + verb + action: "Ask John to send the file by tomorrow"
- Describes something to be done: "Get the report ready by Friday"
- Is clearly a new instruction or task

Return ONLY a JSON object: { "is_deadline": true } or { "is_deadline": false }`

        const result = await callGemini(prompt, text)
        const parsed = JSON.parse(result.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim())
        return parsed.is_deadline === true
    } catch {
        // On error, be conservative: let parseDateFromText handle it
        return true
    }
}

/**
 * Parse a date from free-form text using Gemini.
 */
async function parseDateFromText(text: string): Promise<string | null> {
    try {
        const { callGemini } = await import('@/lib/gemini')

        const now = new Date()
        const istOffset = 5.5 * 60 * 60_000
        const ist = new Date(now.getTime() + istOffset + now.getTimezoneOffset() * 60_000)
        const iso = ist.toISOString().split('T')[0]
        const dayName = ist.toLocaleDateString('en-IN', { weekday: 'long' })
        const timeStr = ist.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })

        const prompt = `You are a date parser. Today is ${dayName}, ${iso}. Current time: ${timeStr} IST.
Convert the user's text into an ISO 8601 datetime string in IST timezone (+05:30).
If only a date/day is given (no time), default to 20:00:00+05:30 (08:00 PM IST, i.e. end of that day).
If only a time is given (no date), assume today if the time hasn't passed, otherwise tomorrow.
"in X minutes/hours" or "X mins from now" = add X minutes/hours to the CURRENT time shown above.
"kal" = tomorrow, "parso" = day after tomorrow, "aaj" = today.
"by Friday" = next Friday at 20:00:00+05:30.

Return ONLY a JSON object: { "date": "ISO 8601 string or null" }`

        const result = await callGemini(prompt, text)
        const parsed = JSON.parse(result.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim())
        return parsed.date || null
    } catch {
        return null
    }
}

/**
 * Determine if a message is genuinely a rejection reason (e.g. "I'm too busy",
 * "Not my responsibility") vs. a new unrelated intent (e.g. "Tell Ramesh to
 * send the report", "Show my tasks").
 *
 * Returns true only if the message's PRIMARY purpose is to explain why the
 * user is rejecting the task.
 */
async function isRejectionReason(text: string): Promise<boolean> {
    try {
        const { callGemini } = await import('@/lib/gemini')

        const prompt = `You are an intent classifier for a WhatsApp task-management bot.
The bot asked the user: "Please reply with a brief reason for rejecting this task."

Determine if the user's reply is PURELY providing a reason/explanation for rejection,
OR if it is a new/unrelated message (like a new task, command, greeting, etc).

A reply is a REJECTION REASON if it:
- Explains why they can't do or don't want the task: "I'm too busy", "This isn't my job"
- Provides any form of excuse, complaint, or rationale: "Don't have time", "Not my responsibility"
- Is a short justification: "No", "Can't do it", "Wrong person"
- Expresses refusal or objection about the task or the person who assigned it
- Is a complaint about the task owner or assignment: "Diksha only gives order", "I don't report to him"

A reply is NOT a rejection reason if it:
- Describes a new task for someone: "Tell Ramesh to send the report"
- Is a greeting or unrelated text: "Hello", "Good morning"
- Asks the bot to do something: "Show my tasks", "Open dashboard"
- Is clearly a new instruction unrelated to rejecting the current task

Return ONLY a JSON object: { "is_reason": true } or { "is_reason": false }`

        const result = await callGemini(prompt, text)
        const parsed = JSON.parse(result.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim())
        return parsed.is_reason === true
    } catch {
        // On error, be conservative: treat as a reason to avoid losing the rejection
        return true
    }
}
