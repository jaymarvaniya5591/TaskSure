/**
 * WhatsApp Notifier — Phase 3.1 Notification Triggers.
 *
 * Fire-and-forget notification functions for all task events.
 * Each function:
 *   1. Looks up the recipient's phone number via Supabase admin client
 *   2. Skips silently if sender === recipient (self-assigned / to-do)
 *   3. Sends a WhatsApp text message
 *   4. Never throws — logs errors internally so callers stay safe
 *
 * Usage pattern:
 *   notifyTaskCreated(supabase, { ... }).catch(err => console.error(...))
 */

import { sendWhatsAppMessage, sendTaskAssignmentTemplate } from '@/lib/whatsapp'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseAdmin = any

// ---------------------------------------------------------------------------
// Internal helper — look up a user's phone number by their ID
// ---------------------------------------------------------------------------

interface UserLookup {
    phone_number: string | null
    name: string | null
}

async function lookupUser(
    supabase: SupabaseAdmin,
    userId: string,
): Promise<UserLookup | null> {
    try {
        const { data, error } = await supabase
            .from('users')
            .select('phone_number, name')
            .eq('id', userId)
            .single()

        if (error || !data) return null
        return data as UserLookup
    } catch {
        return null
    }
}

/**
 * Format a 10-digit Indian phone number to international format (91XXXXXXXXXX).
 */
function toIntlPhone(phone: string): string {
    if (phone.startsWith('91') && phone.length > 10) return phone
    return `91${phone}`
}

/**
 * Safely send a WhatsApp notification. Never throws.
 */
async function safeSend(phone: string, message: string): Promise<void> {
    try {
        await sendWhatsAppMessage(toIntlPhone(phone), message)
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        console.error(`[Notifier] Failed to send to ${phone}:`, msg)
    }
}

// ---------------------------------------------------------------------------
// 1. Task Created — Notify assignee + owner confirmation
// ---------------------------------------------------------------------------

export async function notifyTaskCreated(
    supabase: SupabaseAdmin,
    opts: {
        ownerName: string
        ownerId: string
        assigneeId: string
        taskTitle: string
        taskId: string
        /** 'whatsapp' | 'dashboard' — changes wording slightly */
        source: 'whatsapp' | 'dashboard'
    },
): Promise<void> {
    const { ownerName, ownerId, assigneeId, taskTitle, taskId, source } = opts

    // Skip self-assigned tasks (to-dos)
    if (ownerId === assigneeId) return

    // Notify assignee
    const assignee = await lookupUser(supabase, assigneeId)
    if (assignee?.phone_number) {
        try {
            await sendTaskAssignmentTemplate(
                toIntlPhone(assignee.phone_number),
                ownerName,
                taskTitle,
                taskId
            )
        } catch (err) {
            console.error(`[Notifier] Failed to send assignment template to ${assignee.phone_number}:`, err)
        }
    }

    // Notify owner (confirmation that task was sent)
    if (source === 'dashboard') {
        const owner = await lookupUser(supabase, ownerId)
        if (owner?.phone_number) {
            const assigneeName = assignee?.name ?? 'the assignee'
            await safeSend(
                owner.phone_number,
                `✅ Task "${taskTitle}" sent to *${assigneeName}*. Waiting for acceptance.`,
            )
        }
    }
}

// ---------------------------------------------------------------------------
// 2. Task Accepted — Notify owner
// ---------------------------------------------------------------------------

export async function notifyTaskAccepted(
    supabase: SupabaseAdmin,
    opts: {
        ownerId: string
        assigneeId: string
        assigneeName: string
        taskTitle: string
        committedDeadline: string | null
    },
): Promise<void> {
    const { ownerId, assigneeId, assigneeName, taskTitle, committedDeadline } = opts

    if (ownerId === assigneeId) return

    const owner = await lookupUser(supabase, ownerId)
    if (!owner?.phone_number) return

    const deadlineStr = committedDeadline
        ? new Date(committedDeadline).toLocaleDateString('en-IN', {
            day: 'numeric', month: 'short', year: 'numeric',
            timeZone: 'Asia/Kolkata',
        })
        : null

    const msg = deadlineStr
        ? `✅ *${assigneeName}* accepted "${taskTitle}" with deadline *${deadlineStr}*.`
        : `✅ *${assigneeName}* accepted "${taskTitle}".`

    await safeSend(owner.phone_number, msg)
}

// ---------------------------------------------------------------------------
// 3. Task Rejected — Notify owner
// ---------------------------------------------------------------------------

export async function notifyTaskRejected(
    supabase: SupabaseAdmin,
    opts: {
        ownerId: string
        assigneeId: string
        assigneeName: string
        taskTitle: string
        reason: string | null
    },
): Promise<void> {
    const { ownerId, assigneeId, assigneeName, taskTitle, reason } = opts

    if (ownerId === assigneeId) return

    const owner = await lookupUser(supabase, ownerId)
    if (!owner?.phone_number) return

    const reasonStr = reason ? ` Reason: ${reason}` : ''
    await safeSend(
        owner.phone_number,
        `❌ *${assigneeName}* rejected "${taskTitle}".${reasonStr}`,
    )
}

// ---------------------------------------------------------------------------
// 4. Task Completed — Notify assignee
// ---------------------------------------------------------------------------

export async function notifyTaskCompleted(
    supabase: SupabaseAdmin,
    opts: {
        ownerId: string
        ownerName: string
        assigneeId: string
        taskTitle: string
    },
): Promise<void> {
    const { ownerId, ownerName, assigneeId, taskTitle } = opts

    if (ownerId === assigneeId) return

    const assignee = await lookupUser(supabase, assigneeId)
    if (!assignee?.phone_number) return

    await safeSend(
        assignee.phone_number,
        `🎉 *${ownerName}* marked "${taskTitle}" as completed.`,
    )
}

// ---------------------------------------------------------------------------
// 5. Deadline Edited — Notify the other party
// ---------------------------------------------------------------------------

export async function notifyDeadlineEdited(
    supabase: SupabaseAdmin,
    opts: {
        ownerId: string
        assigneeId: string
        actorId: string
        actorName: string
        taskTitle: string
        newDeadline: string
    },
): Promise<void> {
    const { ownerId, assigneeId, actorId, actorName, taskTitle, newDeadline } = opts

    if (ownerId === assigneeId) return

    // Notify the OTHER party (if actor is owner → notify assignee, and vice versa)
    const recipientId = actorId === ownerId ? assigneeId : ownerId
    const recipient = await lookupUser(supabase, recipientId)
    if (!recipient?.phone_number) return

    const dateStr = new Date(newDeadline).toLocaleDateString('en-IN', {
        day: 'numeric', month: 'short', year: 'numeric',
        timeZone: 'Asia/Kolkata',
    })

    await safeSend(
        recipient.phone_number,
        `📅 *${actorName}* changed the deadline for "${taskTitle}" to *${dateStr}*.`,
    )
}

// ---------------------------------------------------------------------------
// 6. Assignee Changed — Notify old assignee (removed) + new assignee (added)
// ---------------------------------------------------------------------------

export async function notifyAssigneeChanged(
    supabase: SupabaseAdmin,
    opts: {
        ownerId: string
        ownerName: string
        oldAssigneeId: string
        newAssigneeId: string
        newAssigneeName: string
        taskTitle: string
    },
): Promise<void> {
    const { ownerId, ownerName, oldAssigneeId, newAssigneeId, newAssigneeName, taskTitle } = opts

    // Notify old assignee (if they're not the owner — owner already knows)
    if (oldAssigneeId !== ownerId) {
        const oldAssignee = await lookupUser(supabase, oldAssigneeId)
        if (oldAssignee?.phone_number) {
            await safeSend(
                oldAssignee.phone_number,
                `🔄 "${taskTitle}" has been reassigned from you to *${newAssigneeName}* by *${ownerName}*.`,
            )
        }
    }

    // Notify new assignee (if they're not the owner)
    if (newAssigneeId !== ownerId) {
        const newAssignee = await lookupUser(supabase, newAssigneeId)
        if (newAssignee?.phone_number) {
            await safeSend(
                newAssignee.phone_number,
                `📋 "${taskTitle}" has been reassigned to you by *${ownerName}*. Reply to accept and set a deadline.`,
            )
        }
    }
}

// ---------------------------------------------------------------------------
// 7. Task Cancelled/Deleted — Notify assignee
// ---------------------------------------------------------------------------

export async function notifyTaskCancelled(
    supabase: SupabaseAdmin,
    opts: {
        ownerId: string
        ownerName: string
        assigneeId: string
        taskTitle: string
    },
): Promise<void> {
    const { ownerId, ownerName, assigneeId, taskTitle } = opts

    if (ownerId === assigneeId) return

    const assignee = await lookupUser(supabase, assigneeId)
    if (!assignee?.phone_number) return

    await safeSend(
        assignee.phone_number,
        `🗑️ *${ownerName}* cancelled "${taskTitle}".`,
    )
}

// ---------------------------------------------------------------------------
// 8. Subtask Created — Notify parent task owner
// ---------------------------------------------------------------------------

export async function notifySubtaskCreated(
    supabase: SupabaseAdmin,
    opts: {
        parentTaskOwnerId: string
        creatorId: string
        creatorName: string
        subtaskTitle: string
        parentTaskTitle: string
    },
): Promise<void> {
    const { parentTaskOwnerId, creatorId, creatorName, subtaskTitle, parentTaskTitle } = opts

    // If the creator IS the parent task owner, skip
    if (parentTaskOwnerId === creatorId) return

    const owner = await lookupUser(supabase, parentTaskOwnerId)
    if (!owner?.phone_number) return

    await safeSend(
        owner.phone_number,
        `📎 New subtask "${subtaskTitle}" created under "${parentTaskTitle}" by *${creatorName}*.`,
    )
}

// ---------------------------------------------------------------------------
// 9. Task Overdue — Notify owner and assignee
// ---------------------------------------------------------------------------

export async function notifyTaskOverdue(
    supabase: SupabaseAdmin,
    opts: {
        ownerId: string
        assigneeId: string
        taskTitle: string
        deadline: string
    },
): Promise<void> {
    const { ownerId, assigneeId, taskTitle, deadline } = opts

    const dateStr = new Date(deadline).toLocaleDateString('en-IN', {
        day: 'numeric', month: 'short', year: 'numeric',
        timeZone: 'Asia/Kolkata',
    })

    const msg = `⚠️ "${taskTitle}" is overdue! Deadline was *${dateStr}*.`

    // Notify assignee
    const assignee = await lookupUser(supabase, assigneeId)
    if (assignee?.phone_number) {
        await safeSend(assignee.phone_number, msg)
    }

    // Notify owner (if different)
    if (ownerId !== assigneeId) {
        const owner = await lookupUser(supabase, ownerId)
        if (owner?.phone_number) {
            await safeSend(owner.phone_number, msg)
        }
    }
}
