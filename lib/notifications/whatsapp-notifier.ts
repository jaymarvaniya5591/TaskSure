/**
 * WhatsApp Notifier — Unified Notification Engine.
 *
 * Central notification system for all task events. Handles:
 *   1. Determining who should be notified (active participants + parent chain)
 *   2. Building rich, detailed notification messages
 *   3. Differentiating between webapp (Scenario 1) and WhatsApp bot (Scenario 2) sources
 *   4. Fire-and-forget delivery — never throws
 *
 * ## Notification Rules:
 *
 * **Scenario 1 — Webapp (source='dashboard'):**
 *   - Edit by task owner → notify ALL active participants (including the owner)
 *   - Edit by non-owner → notify actor + full parent chain (up to 3 levels)
 *
 * **Scenario 2 — WhatsApp bot (source='whatsapp'):**
 *   - Same recipient logic as Scenario 1. Actors receive identical text notifications 
 *     for their actions to maintain a consistent chat history log.
 *
 * ## Parent Chain:
 *   - Walks up parent_task_id links collecting created_by + assigned_to
 *   - Limited to 3 parent levels max (excluding the actor)
 *   - Deduplicates users to avoid circular references
 */

import { sendWhatsAppMessage, sendTaskAssignmentTemplate } from '@/lib/whatsapp'
import {
    scheduleAcceptanceFollowups,
    scheduleTaskReminders,
    scheduleDeadlineApproaching,
    cancelPendingNotifications,
} from './task-notification-scheduler'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseAdmin = any

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TaskEventType =
    | 'task_created'
    | 'task_accepted'
    | 'task_rejected'
    | 'task_completed'
    | 'deadline_edited'
    | 'assignee_changed'
    | 'task_cancelled'
    | 'subtask_created'
    | 'task_overdue'

export interface NotifyTaskEventOpts {
    eventType: TaskEventType
    taskId: string
    taskTitle: string
    actorId: string
    actorName: string
    source: 'dashboard' | 'whatsapp'

    // Event-specific fields
    assigneeId?: string
    assigneeName?: string
    ownerId?: string
    ownerName?: string
    oldAssigneeId?: string
    oldAssigneeName?: string
    newAssigneeId?: string
    newAssigneeName?: string
    parentTaskId?: string
    parentTaskTitle?: string
    committedDeadline?: string | null
    newDeadline?: string
    reason?: string | null
    subtaskTitle?: string
    subtaskAssigneeName?: string
}

interface UserInfo {
    id: string
    phone_number: string | null
    name: string | null
}

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

async function lookupUser(
    supabase: SupabaseAdmin,
    userId: string,
): Promise<UserInfo | null> {
    try {
        const { data, error } = await supabase
            .from('users')
            .select('id, phone_number, name')
            .eq('id', userId)
            .single()

        if (error || !data) return null
        return data as UserInfo
    } catch {
        return null
    }
}

async function lookupUsers(
    supabase: SupabaseAdmin,
    userIds: string[],
): Promise<UserInfo[]> {
    if (userIds.length === 0) return []
    try {
        const { data, error } = await supabase
            .from('users')
            .select('id, phone_number, name')
            .in('id', userIds)

        if (error || !data) return []
        return data as UserInfo[]
    } catch {
        return []
    }
}

function toIntlPhone(phone: string): string {
    if (phone.startsWith('91') && phone.length > 10) return phone
    return `91${phone}`
}

async function safeSend(phone: string, message: string): Promise<void> {
    try {
        await sendWhatsAppMessage(toIntlPhone(phone), message)
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        console.error(`[Notifier] Failed to send to ${phone}:`, msg)
    }
}

function formatDate(dateStr: string): string {
    const d = new Date(dateStr)
    const datePart = d.toLocaleDateString('en-IN', {
        day: 'numeric', month: 'short', year: 'numeric',
        timeZone: 'Asia/Kolkata',
    })
    const timePart = d.toLocaleTimeString('en-IN', {
        hour: '2-digit', minute: '2-digit', hour12: true,
        timeZone: 'Asia/Kolkata',
    })
    return `${datePart} at ${timePart}`
}

// ---------------------------------------------------------------------------
// Parent Chain Traversal
// ---------------------------------------------------------------------------

/**
 * Walk up the parent_task_id chain, collecting created_by and assigned_to
 * user IDs at each level. Limited to MAX_PARENT_DEPTH levels.
 * Returns deduplicated user IDs.
 */
const MAX_PARENT_DEPTH = 3

async function getParentChainUserIds(
    supabase: SupabaseAdmin,
    taskId: string,
): Promise<string[]> {
    const userIds = new Set<string>()
    const visitedTaskIds = new Set<string>()
    let currentTaskId: string | null = taskId
    let depth = 0

    // First, get the parent_task_id of the starting task
    const { data: startTask } = await supabase
        .from('tasks')
        .select('parent_task_id')
        .eq('id', currentTaskId)
        .single() as { data: { parent_task_id: string | null } | null }

    if (!startTask?.parent_task_id) return []
    currentTaskId = startTask.parent_task_id

    while (currentTaskId && depth < MAX_PARENT_DEPTH) {
        // Guard against circular references
        if (visitedTaskIds.has(currentTaskId)) break
        visitedTaskIds.add(currentTaskId)

        const { data: parentTask } = await supabase
            .from('tasks')
            .select('id, created_by, assigned_to, parent_task_id')
            .eq('id', currentTaskId)
            .single() as { data: { id: string; created_by: string; assigned_to: string; parent_task_id: string | null } | null }

        if (!parentTask) break

        if (parentTask.created_by) userIds.add(parentTask.created_by)
        if (parentTask.assigned_to) userIds.add(parentTask.assigned_to)

        // Move up to the next parent
        currentTaskId = parentTask.parent_task_id
        depth++
    }

    return Array.from(userIds)
}

// ---------------------------------------------------------------------------
// Recipient Computation
// ---------------------------------------------------------------------------

/**
 * Compute the list of user IDs that should receive a notification.
 *
 * Rules:
 *   1. If the actor IS the task owner (Scenario 1a/1b):
 *      - For task_created: owner + assignee (post-creation participants)
 *      - For other events: all active participants (owner + assignee + parent chain)
 *
 *   2. If the actor is NOT the task owner:
 *      - Actor + full parent chain (up the tree)
 *
 *   3. Source filtering:
 *      - 'dashboard': include actor in notifications
 *      - 'whatsapp': include actor in notifications (for chat history logging)
 */
async function computeRecipientIds(
    supabase: SupabaseAdmin,
    opts: NotifyTaskEventOpts,
): Promise<string[]> {
    const { eventType, taskId, actorId, source, ownerId, assigneeId } = opts
    const recipientSet = new Set<string>()

    // Always include the direct task participants (owner + assignee)
    if (ownerId) recipientSet.add(ownerId)
    if (assigneeId) recipientSet.add(assigneeId)

    // For assignee_changed, also include old and new assignees
    if (eventType === 'assignee_changed') {
        if (opts.oldAssigneeId) recipientSet.add(opts.oldAssigneeId)
        if (opts.newAssigneeId) recipientSet.add(opts.newAssigneeId)
    }

    // If the actor is NOT the task owner, walk up the parent chain
    // (the user's Scenario 1 case 2: "everyone from the user to the chain of parents")
    // Also walk parent chain for subtask events regardless of actor
    const isActorOwner = actorId === ownerId
    if (!isActorOwner || eventType === 'subtask_created') {
        const parentChainIds = await getParentChainUserIds(supabase, taskId)
        for (const id of parentChainIds) {
            recipientSet.add(id)
        }
    }

    // Always include the actor in the set initially
    recipientSet.add(actorId)

    return Array.from(recipientSet)
}

// ---------------------------------------------------------------------------
// Message Builder
// ---------------------------------------------------------------------------

function buildNotificationMessage(opts: NotifyTaskEventOpts, recipientId?: string): string {
    const {
        eventType, taskTitle, actorName,
        assigneeName, assigneeId, committedDeadline, newDeadline,
        reason, subtaskTitle, subtaskAssigneeName,
        parentTaskTitle, ownerName,
        newAssigneeName, oldAssigneeName,
    } = opts

    switch (eventType) {
        case 'task_created': {
            if (recipientId && recipientId === assigneeId) {
                // If the recipient is the assignee (and they are receiving this text as a fallback)
                return `📝 *New Task Assigned!*\n\n*Assigned by:*\n${actorName || ownerName || 'Someone'}\n\n*Task:*\n"${taskTitle}"\n\n_Please check your dashboard to accept or reject it._`
            } else if (assigneeName) {
                // If the recipient is the creator
                return `✅ *Task Created!*\n\n*Assigned to:*\n${assigneeName}\n\n*Task:*\n"${taskTitle}"\n\n_Waiting for them to accept._`
            }
            return `✅ *To-Do Noted!*\n\n*To-do:*\n"${taskTitle}"\n\n_I'll keep track of it for you!_`
        }

        case 'task_accepted': {
            const deadlineStr = formatDate(committedDeadline!)
            return `✅ *Task Accepted!*\n\n*Accepted by:*\n${actorName}\n\n*Task:*\n"${taskTitle}"\n\n*Deadline:*\n${deadlineStr}`
        }

        case 'task_rejected': {
            const reasonStr = reason ? `\n\n*Reason:*\n${reason}` : ''
            return `❌ *Task Rejected!*\n\n*Rejected by:*\n${actorName}\n\n*Task:*\n"${taskTitle}"${reasonStr}`
        }

        case 'task_completed': {
            const assigneeInfo = assigneeName ? `\n\n*Assigned to:*\n${assigneeName}` : ''
            return `🎊 *Task Completed!*\n\n*Marked by:*\n${actorName}\n\n*Task:*\n"${taskTitle}"${assigneeInfo}`
        }

        case 'deadline_edited': {
            const dateStr = newDeadline ? formatDate(newDeadline) : 'a new date'
            const assigneeInfo = assigneeName ? `\n\n*Assigned to:*\n${assigneeName}` : ''
            return `📅 *Deadline Changed!*\n\n*Changed by:*\n${actorName}\n\n*Task:*\n"${taskTitle}"\n\n*New Deadline:*\n${dateStr}${assigneeInfo}`
        }

        case 'assignee_changed': {
            const from = oldAssigneeName || 'someone'
            const to = newAssigneeName || 'someone'
            return `🔄 *Task Reassigned!*\n\n*Reassigned by:*\n${actorName}\n\n*Task:*\n"${taskTitle}"\n\n*From:*\n${from}\n\n*To:*\n${to}`
        }

        case 'task_cancelled': {
            const assigneeInfo = assigneeName ? `\n\n*Assigned to:*\n${assigneeName}` : ''
            return `🗑️ *Task Cancelled!*\n\n*Cancelled by:*\n${actorName}\n\n*Task:*\n"${taskTitle}"${assigneeInfo}`
        }

        case 'subtask_created': {
            const title = subtaskTitle || taskTitle
            const parentInfo = parentTaskTitle ? `\n\n*Under:*\n"${parentTaskTitle}"` : ''
            const assigneeInfo = subtaskAssigneeName ? `\n\n*Assigned to:*\n${subtaskAssigneeName}` : ''
            const creatorInfo = actorName || 'Someone'
            return `📎 *Subtask Created!*\n\n*Created by:*\n${creatorInfo}\n\n*Subtask:*\n"${title}"${parentInfo}${assigneeInfo}`
        }

        case 'task_overdue': {
            const assigneeInfo = assigneeName ? `\n\n*Assigned to:*\n${assigneeName}` : ''
            const ownerInfo = ownerName ? `\n\n*Owner:*\n${ownerName}` : ''
            return `⚠️ *Task is Overdue!*\n\n*Task:*\n"${taskTitle}"${assigneeInfo}${ownerInfo}`
        }

        default:
            return `📌 *Task Updated!*\n\n*Task:*\n"${taskTitle}"\n\n*Updated by:*\n${actorName}`
    }
}

// ---------------------------------------------------------------------------
// Main Entry Point
// ---------------------------------------------------------------------------

/**
 * Unified notification function. Replaces all individual notify* functions.
 *
 * 1. Computes who should be notified
 * 2. Builds the notification message
 * 3. Sends WhatsApp messages to all recipients
 * 4. Never throws
 */
export async function notifyTaskEvent(
    supabase: SupabaseAdmin,
    opts: NotifyTaskEventOpts,
): Promise<void> {
    try {
        console.log(`[Notifier] notifyTaskEvent triggered for ${opts.eventType}. actorId: ${opts.actorId}, assigneeId: ${opts.assigneeId}`);
        // For task_created with a non-self-assigned task, use the assignment template
        // for the assignee (they get a special interactive message)
        let templateSentToAssignee = false;
        if (opts.eventType === 'task_created' && opts.assigneeId && opts.assigneeId !== opts.actorId) {
            console.log(`[Notifier] Calling sendAssignmentTemplateToAssignee for assignee: ${opts.assigneeId}`);
            templateSentToAssignee = await sendAssignmentTemplateToAssignee(supabase, opts)
        }

        // Compute all recipients
        let recipientIds = await computeRecipientIds(supabase, opts)
        console.log(`[Notifier] Computed recipient IDs:`, recipientIds);

        // Fallback text message filtering: exclude the assignee if template was sent successfully
        if (templateSentToAssignee && opts.assigneeId) {
            recipientIds = recipientIds.filter(id => id !== opts.assigneeId)
        }

        if (recipientIds.length === 0) return

        // Look up all recipients in one query
        const recipients = await lookupUsers(supabase, recipientIds)

        // Build and send the personalized notification message for each recipient
        const sends = recipients
            .filter(r => r.phone_number)
            .map(r => {
                const message = buildNotificationMessage(opts, r.id)
                return safeSend(r.phone_number!, message)
            })

        await Promise.all(sends)
    } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error'
        console.error(`[Notifier] notifyTaskEvent failed for ${opts.eventType}:`, errMsg)
    }
}

/**
 * Send the special WhatsApp assignment template to the assignee of a new task.
 * This is a structured template message with action buttons.
 */
async function sendAssignmentTemplateToAssignee(
    supabase: SupabaseAdmin,
    opts: NotifyTaskEventOpts,
): Promise<boolean> {
    console.log(`[Notifier] sendAssignmentTemplateToAssignee started. assigneeId: ${opts.assigneeId}`);
    if (!opts.assigneeId) return false

    const assignee = await lookupUser(supabase, opts.assigneeId)
    console.log(`[Notifier] Looked up assignee:`, assignee);
    if (!assignee?.phone_number) {
        console.log(`[Notifier] Assignee has no phone number, aborting template send.`);
        return false;
    }

    try {
        console.log(`[Notifier] Sending task_assignment template to ${assignee.phone_number}`);
        const result = await sendTaskAssignmentTemplate(
            toIntlPhone(assignee.phone_number),
            opts.actorName,
            opts.taskTitle, // Only pass the raw title without any extra formatting or \n
            opts.taskId,
        )
        console.log(`[Notifier] Template send result:`, result);
        return result.success;
    } catch (err) {
        console.error(`[Notifier] Failed to send assignment template:`, err)
        return false;
    }
}

// ---------------------------------------------------------------------------
// Legacy Wrappers (for gradual migration — these all call notifyTaskEvent)
// ---------------------------------------------------------------------------

export async function notifyTaskCreated(
    supabase: SupabaseAdmin,
    opts: {
        ownerName: string
        ownerId: string
        assigneeId: string
        taskTitle: string
        taskId: string
        committedDeadline?: string | null
        source: 'whatsapp' | 'dashboard'
    },
): Promise<void> {
    const isTodo = opts.ownerId === opts.assigneeId

    if (isTodo) {
        // To-dos: only schedule deadline approaching (no acceptance followups)
        if (opts.committedDeadline) {
            await scheduleDeadlineApproaching(
                opts.taskId,
                opts.assigneeId,
                opts.ownerId,
                new Date(opts.committedDeadline),
                opts.taskTitle,
                opts.ownerName,
                supabase,
            ).catch(err => console.error('[Notifier] Failed to schedule todo deadline approaching:', err))
        }
        return
    }

    // Look up assignee name for richer messages
    const assignee = await lookupUser(supabase, opts.assigneeId)

    // Fire-and-forget: Schedule acceptance followup notifications (Stage 1)
    await scheduleAcceptanceFollowups(
        opts.taskId,
        opts.assigneeId,
        opts.ownerId,
        opts.taskTitle,
        opts.ownerName,
        supabase,
    ).catch(err => console.error('[Notifier] Failed to schedule acceptance followups:', err))

    return notifyTaskEvent(supabase, {
        eventType: 'task_created',
        taskId: opts.taskId,
        taskTitle: opts.taskTitle,
        actorId: opts.ownerId,
        actorName: opts.ownerName,
        source: opts.source,
        ownerId: opts.ownerId,
        ownerName: opts.ownerName,
        assigneeId: opts.assigneeId,
        assigneeName: assignee?.name || 'the assignee',
    })
}

export async function notifyTaskAccepted(
    supabase: SupabaseAdmin,
    opts: {
        ownerId: string
        assigneeId: string
        assigneeName: string
        taskTitle: string
        taskId: string
        committedDeadline: string | null
        source: 'whatsapp' | 'dashboard'
    },
): Promise<void> {
    if (opts.ownerId === opts.assigneeId) return

    // Fire-and-forget: Cancel acceptance followups (Stage 1) now that task is accepted
    await cancelPendingNotifications(opts.taskId, 'acceptance', supabase)
        .catch(err => console.error('[Notifier] Failed to cancel acceptance followups:', err))

    // Fire-and-forget: Schedule mid-task reminders (Stage 2) and deadline approaching (Stage 3a) if there's a deadline
    if (opts.committedDeadline) {
        const owner = await lookupUser(supabase, opts.ownerId)

        // Fetch task creation date so reminders span from creation to deadline
        let createdAt = new Date()
        try {
            const { data: taskData } = await supabase
                .from('tasks')
                .select('created_at')
                .eq('id', opts.taskId)
                .single()
            if (taskData?.created_at) {
                createdAt = new Date(taskData.created_at)
            }
        } catch {
            // fallback to now
        }

        await scheduleTaskReminders(
            opts.taskId,
            opts.assigneeId,
            opts.ownerId,
            createdAt,
            new Date(opts.committedDeadline),
            opts.taskTitle,
            owner?.name || 'your manager',
            supabase,
        ).catch(err => console.error('[Notifier] Failed to schedule task reminders:', err))

        // Schedule deadline approaching notification (30 min before)
        await scheduleDeadlineApproaching(
            opts.taskId,
            opts.assigneeId,
            opts.ownerId,
            new Date(opts.committedDeadline),
            opts.taskTitle,
            owner?.name || 'your manager',
            supabase,
        ).catch(err => console.error('[Notifier] Failed to schedule deadline approaching:', err))
    }

    return notifyTaskEvent(supabase, {
        eventType: 'task_accepted',
        taskId: opts.taskId,
        taskTitle: opts.taskTitle,
        actorId: opts.assigneeId,
        actorName: opts.assigneeName,
        source: opts.source,
        ownerId: opts.ownerId,
        assigneeId: opts.assigneeId,
        assigneeName: opts.assigneeName,
        committedDeadline: opts.committedDeadline,
    })
}

export async function notifyTaskRejected(
    supabase: SupabaseAdmin,
    opts: {
        ownerId: string
        assigneeId: string
        assigneeName: string
        taskTitle: string
        taskId: string
        reason: string | null
        source: 'whatsapp' | 'dashboard'
    },
): Promise<void> {
    if (opts.ownerId === opts.assigneeId) return

    // Fire-and-forget: Cancel all pending notifications for this task
    await cancelPendingNotifications(opts.taskId, undefined, supabase)
        .catch(err => console.error('[Notifier] Failed to cancel notifications on reject:', err))

    return notifyTaskEvent(supabase, {
        eventType: 'task_rejected',
        taskId: opts.taskId,
        taskTitle: opts.taskTitle,
        actorId: opts.assigneeId,
        actorName: opts.assigneeName,
        source: opts.source,
        ownerId: opts.ownerId,
        assigneeId: opts.assigneeId,
        assigneeName: opts.assigneeName,
        reason: opts.reason,
    })
}

export async function notifyTaskCompleted(
    supabase: SupabaseAdmin,
    opts: {
        ownerId: string
        ownerName: string
        assigneeId: string
        taskTitle: string
        taskId: string
        source: 'whatsapp' | 'dashboard'
    },
): Promise<void> {

    // Fire-and-forget: Cancel all pending notifications for this task
    await cancelPendingNotifications(opts.taskId, undefined, supabase)
        .catch(err => console.error('[Notifier] Failed to cancel notifications on complete:', err))

    // Look up assignee name for richer messages
    const assignee = await lookupUser(supabase, opts.assigneeId)

    return notifyTaskEvent(supabase, {
        eventType: 'task_completed',
        taskId: opts.taskId,
        taskTitle: opts.taskTitle,
        actorId: opts.ownerId,
        actorName: opts.ownerName,
        source: opts.source,
        ownerId: opts.ownerId,
        assigneeId: opts.assigneeId,
        assigneeName: assignee?.name || 'the assignee',
    })
}

export async function notifyDeadlineEdited(
    supabase: SupabaseAdmin,
    opts: {
        ownerId: string
        assigneeId: string
        actorId: string
        actorName: string
        taskTitle: string
        taskId: string
        newDeadline: string
        source: 'whatsapp' | 'dashboard'
    },
): Promise<void> {

    // Look up assignee name
    const assignee = await lookupUser(supabase, opts.assigneeId)

    return notifyTaskEvent(supabase, {
        eventType: 'deadline_edited',
        taskId: opts.taskId,
        taskTitle: opts.taskTitle,
        actorId: opts.actorId,
        actorName: opts.actorName,
        source: opts.source,
        ownerId: opts.ownerId,
        assigneeId: opts.assigneeId,
        assigneeName: assignee?.name || 'the assignee',
        newDeadline: opts.newDeadline,
    })
}

export async function notifyAssigneeChanged(
    supabase: SupabaseAdmin,
    opts: {
        ownerId: string
        ownerName: string
        oldAssigneeId: string
        newAssigneeId: string
        newAssigneeName: string
        taskTitle: string
        taskId: string
        source: 'whatsapp' | 'dashboard'
    },
): Promise<void> {
    // Look up old assignee name
    const oldAssignee = await lookupUser(supabase, opts.oldAssigneeId)

    return notifyTaskEvent(supabase, {
        eventType: 'assignee_changed',
        taskId: opts.taskId,
        taskTitle: opts.taskTitle,
        actorId: opts.ownerId,
        actorName: opts.ownerName,
        source: opts.source,
        ownerId: opts.ownerId,
        oldAssigneeId: opts.oldAssigneeId,
        oldAssigneeName: oldAssignee?.name || 'someone',
        newAssigneeId: opts.newAssigneeId,
        newAssigneeName: opts.newAssigneeName,
    })
}

export async function notifyTaskCancelled(
    supabase: SupabaseAdmin,
    opts: {
        ownerId: string
        ownerName: string
        assigneeId: string
        taskTitle: string
        taskId: string
        source: 'whatsapp' | 'dashboard'
    },
): Promise<void> {

    // Fire-and-forget: Cancel all pending notifications for this task
    await cancelPendingNotifications(opts.taskId, undefined, supabase)
        .catch(err => console.error('[Notifier] Failed to cancel notifications on cancel:', err))

    // Look up assignee name
    const assignee = await lookupUser(supabase, opts.assigneeId)

    return notifyTaskEvent(supabase, {
        eventType: 'task_cancelled',
        taskId: opts.taskId,
        taskTitle: opts.taskTitle,
        actorId: opts.ownerId,
        actorName: opts.ownerName,
        source: opts.source,
        ownerId: opts.ownerId,
        assigneeId: opts.assigneeId,
        assigneeName: assignee?.name || 'the assignee',
    })
}

export async function notifySubtaskCreated(
    supabase: SupabaseAdmin,
    opts: {
        parentTaskOwnerId: string
        creatorId: string
        creatorName: string
        subtaskTitle: string
        parentTaskTitle: string
        subtaskId: string
        subtaskAssigneeName?: string
        source: 'whatsapp' | 'dashboard'
    },
): Promise<void> {
    return notifyTaskEvent(supabase, {
        eventType: 'subtask_created',
        taskId: opts.subtaskId,
        taskTitle: opts.subtaskTitle,
        actorId: opts.creatorId,
        actorName: opts.creatorName,
        source: opts.source,
        ownerId: opts.parentTaskOwnerId,
        parentTaskId: opts.subtaskId,
        parentTaskTitle: opts.parentTaskTitle,
        subtaskTitle: opts.subtaskTitle,
        subtaskAssigneeName: opts.subtaskAssigneeName,
    })
}

export async function notifyTaskOverdue(
    supabase: SupabaseAdmin,
    opts: {
        ownerId: string
        assigneeId: string
        taskTitle: string
        taskId: string
        deadline: string
    },
): Promise<void> {
    // Look up names
    const [owner, assignee] = await Promise.all([
        lookupUser(supabase, opts.ownerId),
        lookupUser(supabase, opts.assigneeId),
    ])

    return notifyTaskEvent(supabase, {
        eventType: 'task_overdue',
        taskId: opts.taskId,
        taskTitle: opts.taskTitle,
        actorId: 'system', // System-generated event
        actorName: 'System',
        source: 'dashboard', // Include everyone (no bot ack to exclude)
        ownerId: opts.ownerId,
        ownerName: owner?.name || 'the owner',
        assigneeId: opts.assigneeId,
        assigneeName: assignee?.name || 'the assignee',
        newDeadline: opts.deadline,
    })
}
