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
 *   - Same recipient logic as Scenario 1, but the actor is EXCLUDED from
 *     notifications because the bot already sent them an acknowledgement.
 *
 * ## Parent Chain:
 *   - Walks up parent_task_id links collecting created_by + assigned_to
 *   - Limited to 3 parent levels max (excluding the actor)
 *   - Deduplicates users to avoid circular references
 */

import { sendWhatsAppMessage, sendTaskAssignmentTemplate } from '@/lib/whatsapp'

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
    return new Date(dateStr).toLocaleDateString('en-IN', {
        day: 'numeric', month: 'short', year: 'numeric',
        timeZone: 'Asia/Kolkata',
    })
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
 *      - 'whatsapp': exclude actor (they got the bot acknowledgement)
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

    // Source filtering: for WhatsApp, exclude the actor (they got the acknowledgement)
    if (source === 'whatsapp') {
        recipientSet.delete(actorId)
    }

    return Array.from(recipientSet)
}

// ---------------------------------------------------------------------------
// Message Builder
// ---------------------------------------------------------------------------

function buildNotificationMessage(opts: NotifyTaskEventOpts): string {
    const {
        eventType, taskTitle, actorName,
        assigneeName, committedDeadline, newDeadline,
        reason, subtaskTitle, subtaskAssigneeName,
        parentTaskTitle, ownerName,
        newAssigneeName, oldAssigneeName,
    } = opts

    switch (eventType) {
        case 'task_created': {
            if (assigneeName) {
                return `📋 *${actorName}* created a new task "${taskTitle}" for *${assigneeName}*. Waiting for acceptance.`
            }
            return `📋 *${actorName}* created a new task "${taskTitle}".`
        }

        case 'task_accepted': {
            const deadlineStr = committedDeadline ? formatDate(committedDeadline) : null
            const byWhom = `*${actorName}*`
            if (deadlineStr) {
                return `✅ ${byWhom} accepted "${taskTitle}" with deadline *${deadlineStr}*.`
            }
            return `✅ ${byWhom} accepted "${taskTitle}".`
        }

        case 'task_rejected': {
            const reasonStr = reason ? ` Reason: ${reason}` : ''
            return `❌ *${actorName}* rejected "${taskTitle}".${reasonStr}`
        }

        case 'task_completed': {
            const assigneeInfo = assigneeName ? ` (assigned to *${assigneeName}*)` : ''
            return `🎉 *${actorName}* marked "${taskTitle}"${assigneeInfo} as completed.`
        }

        case 'deadline_edited': {
            const dateStr = newDeadline ? formatDate(newDeadline) : 'a new date'
            const assigneeInfo = assigneeName ? ` (assigned to *${assigneeName}*)` : ''
            return `📅 *${actorName}* changed the deadline for "${taskTitle}"${assigneeInfo} to *${dateStr}*.`
        }

        case 'assignee_changed': {
            const from = oldAssigneeName || 'someone'
            const to = newAssigneeName || 'someone'
            return `🔄 *${actorName}* reassigned "${taskTitle}" from *${from}* to *${to}*.`
        }

        case 'task_cancelled': {
            const assigneeInfo = assigneeName ? ` (was assigned to *${assigneeName}*)` : ''
            return `🗑️ *${actorName}* cancelled "${taskTitle}"${assigneeInfo}.`
        }

        case 'subtask_created': {
            const title = subtaskTitle || taskTitle
            const parentInfo = parentTaskTitle ? ` under "${parentTaskTitle}"` : ''
            const assigneeInfo = subtaskAssigneeName ? ` and assigned it to *${subtaskAssigneeName}*` : ''
            const creatorInfo = actorName || 'Someone'
            return `📎 *${creatorInfo}* created subtask "${title}"${parentInfo}${assigneeInfo}.`
        }

        case 'task_overdue': {
            const assigneeInfo = assigneeName ? ` Assigned to: *${assigneeName}*.` : ''
            const ownerInfo = ownerName ? ` Created by: *${ownerName}*.` : ''
            return `⚠️ "${taskTitle}" is overdue!${assigneeInfo}${ownerInfo}`
        }

        default:
            return `📌 An update was made to "${taskTitle}" by *${actorName}*.`
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
        // For task_created with a non-self-assigned task, use the assignment template
        // for the assignee (they get a special interactive message)
        if (opts.eventType === 'task_created' && opts.assigneeId && opts.assigneeId !== opts.actorId) {
            await sendAssignmentTemplateToAssignee(supabase, opts)
        }

        // Compute all recipients
        const recipientIds = await computeRecipientIds(supabase, opts)

        if (recipientIds.length === 0) return

        // Look up all recipients in one query
        const recipients = await lookupUsers(supabase, recipientIds)

        // Build the notification message
        const message = buildNotificationMessage(opts)

        // Send to all recipients (except the assignee of a new task who got the template)
        const skipTemplateRecipient = opts.eventType === 'task_created' ? opts.assigneeId : null

        const sends = recipients
            .filter(r => r.phone_number)
            .filter(r => r.id !== skipTemplateRecipient) // Assignee already got the template
            .map(r => safeSend(r.phone_number!, message))

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
): Promise<void> {
    if (!opts.assigneeId) return

    const assignee = await lookupUser(supabase, opts.assigneeId)
    if (!assignee?.phone_number) return

    try {
        await sendTaskAssignmentTemplate(
            toIntlPhone(assignee.phone_number),
            opts.actorName,
            opts.taskTitle,
            opts.taskId,
        )
    } catch (err) {
        console.error(`[Notifier] Failed to send assignment template:`, err)
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
        source: 'whatsapp' | 'dashboard'
    },
): Promise<void> {
    if (opts.ownerId === opts.assigneeId) return // Skip todos

    // Look up assignee name for richer messages
    const assignee = await lookupUser(supabase, opts.assigneeId)

    return notifyTaskEvent(supabase, {
        eventType: 'task_created',
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
    if (opts.ownerId === opts.assigneeId) return

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
    if (opts.ownerId === opts.assigneeId) return

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
    if (opts.ownerId === opts.assigneeId) return

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
