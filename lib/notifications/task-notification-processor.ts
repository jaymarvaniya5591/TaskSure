/**
 * Task Notification Processor — Processes due notifications from
 * the task_notifications table.
 *
 * Called by the cron job every 5 minutes. Handles:
 *   - Stage 1 (acceptance): Make call + send template to assignee, status to owner
 *   - Stage 2 (reminder): Send "Going Well / Edit Deadline" template, check ack timeouts
 *   - Stage 3a (deadline_approaching): Send deadline warning to assignee/owner
 *   - Stage 3b (escalation): Send overdue template to owner
 *
 * Also detects overdue tasks and approaching deadlines.
 * All operations are idempotent and never throw.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import {
    sendWhatsAppMessage,
    sendTaskAssignmentTemplate,
    sendTaskProgressCheckTemplate,
    sendTaskOverdueOwnerTemplate,
    sendTaskDeadlineApproachingTemplate,
    sendTodoDeadlineApproachingTemplate,
    sendTodoOverdueTemplate
} from '@/lib/whatsapp'
import { makeAutomatedCall, buildAcceptanceCallScript, buildReminderCallScript } from './calling-service'
import {
    scheduleReminderCallEscalation,
    scheduleOwnerNoReplyNotification,
    scheduleEscalations,
    cancelPendingNotifications,
} from './task-notification-scheduler'
import { isWithinBusinessHours } from './business-hours'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseAdmin = any

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TaskNotification {
    id: string
    task_id: string
    stage: 'acceptance' | 'reminder' | 'escalation' | 'deadline_approaching'
    stage_number: number
    target_user_id: string
    target_role: 'assignee' | 'owner'
    channel: 'whatsapp' | 'call' | 'both'
    scheduled_at: string
    sent_at?: string
    status: string
    metadata: Record<string, unknown>
}

interface UserInfo {
    id: string
    phone_number: string | null
    name: string | null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toIntlPhone(phone: string): string {
    if (phone.startsWith('91') && phone.length > 10) return phone
    return `91${phone}`
}

async function lookupUser(supabase: SupabaseAdmin, userId: string): Promise<UserInfo | null> {
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

function formatDate(dateStr: string): string {
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-IN', {
        day: 'numeric', month: 'short', year: 'numeric',
        timeZone: 'Asia/Kolkata',
    }) + ' at ' + d.toLocaleTimeString('en-IN', {
        hour: '2-digit', minute: '2-digit', hour12: true,
        timeZone: 'Asia/Kolkata',
    })
}

async function markNotificationSent(
    supabase: SupabaseAdmin,
    notifId: string,
    extra: Record<string, unknown> = {},
): Promise<void> {
    await supabase
        .from('task_notifications')
        .update({
            status: 'sent',
            sent_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            ...extra,
        })
        .eq('id', notifId)
}

async function markNotificationFailed(
    supabase: SupabaseAdmin,
    notifId: string,
    reason: string,
): Promise<void> {
    await supabase
        .from('task_notifications')
        .update({
            status: 'failed',
            failure_reason: reason,
            updated_at: new Date().toISOString(),
        })
        .eq('id', notifId)
}

// ---------------------------------------------------------------------------
// Stage 1: Acceptance Followup Processing
// ---------------------------------------------------------------------------

async function processAcceptanceFollowup(
    supabase: SupabaseAdmin,
    notif: TaskNotification,
): Promise<void> {
    const meta = notif.metadata
    const taskTitle = (meta.task_title as string) || 'a task'

    // First check if the task is still pending acceptance
    const { data: task } = await supabase
        .from('tasks')
        .select('status, created_by, assigned_to')
        .eq('id', notif.task_id)
        .single()

    if (!task || task.status !== 'pending') {
        console.log(`[Processor] Task ${notif.task_id} is no longer pending (${task?.status}), skipping acceptance followup`)
        await markNotificationSent(supabase, notif.id)
        return
    }

    const targetUser = await lookupUser(supabase, notif.target_user_id)
    if (!targetUser?.phone_number) {
        await markNotificationFailed(supabase, notif.id, 'Target user has no phone number')
        return
    }

    const phone = toIntlPhone(targetUser.phone_number)

    if (notif.target_role === 'assignee') {
        // --- ASSIGNEE: Make call + send acceptance template ---
        const ownerName = (meta.owner_name as string) || 'your manager'
        let callResult: { success: boolean; status: 'connected' | 'not_connected' | 'error'; durationSeconds?: number; error?: string } = {
            success: false, status: 'error', durationSeconds: 0, error: 'Call not attempted',
        }

        // Only make call if within business hours right now
        if (isWithinBusinessHours(new Date())) {
            try {
                const language = 'hi-IN' // Call scripts are in Hindi
                const script = buildAcceptanceCallScript(ownerName, taskTitle)
                callResult = await makeAutomatedCall(phone, script, language)
            } catch (err) {
                callResult = { success: false, status: 'error', durationSeconds: 0, error: err instanceof Error ? err.message : 'Call failed' }
            }
        } else {
            callResult = { success: false, status: 'error', durationSeconds: 0, error: 'Outside business hours' }
        }

        // Send the acceptance template regardless of call result
        try {
            let timeAgo = 'recently'
            if (notif.stage_number === 1) timeAgo = '10 mins'
            else if (notif.stage_number === 2) timeAgo = '1 hour'
            else if (notif.stage_number === 3) timeAgo = '3 hours'

            const followupText = `This is a followup on the task assigned to you ${timeAgo} ago. Please accept/reject it by clicking on the message below.`
            await sendWhatsAppMessage(phone, followupText)

            await sendTaskAssignmentTemplate(phone, ownerName, taskTitle, notif.task_id)
        } catch (err) {
            console.error(`[Processor] Failed to send acceptance template:`, err)
        }

        await markNotificationSent(supabase, notif.id, {
            call_status: callResult.status,
            call_duration_seconds: callResult.durationSeconds || 0,
        })

        // Now find and process the paired owner notification
        // (owner gets a status update about the call)
        const { data: ownerNotifs } = await supabase
            .from('task_notifications')
            .select('id, target_user_id')
            .eq('task_id', notif.task_id)
            .eq('stage', 'acceptance')
            .eq('stage_number', notif.stage_number)
            .eq('target_role', 'owner')
            .eq('status', 'pending')
            .limit(1)

        if (ownerNotifs && ownerNotifs.length > 0) {
            const ownerNotif = ownerNotifs[0]
            const owner = await lookupUser(supabase, ownerNotif.target_user_id)

            if (owner?.phone_number) {
                // Build status message for owner
                const callStatusEmoji = callResult.status === 'connected' ? '✅' : callResult.status === 'not_connected' ? '❌' : '⚠️'
                const callStatusText = callResult.status === 'connected'
                    ? `Connected (${callResult.durationSeconds || 0}s)`
                    : callResult.status === 'not_connected'
                        ? 'Not connected'
                        : `Error: ${callResult.error || 'Unknown'}`

                const ownerMessage =
                    `📞 *Acceptance Followup #${notif.stage_number}*\n\n*Task:*\n"${taskTitle}"\n\n*Call to:*\n${targetUser.name || 'assignee'}\n\n*Call Status:*\n${callStatusEmoji} ${callStatusText}\n\n_Task acceptance reminder has been re-sent._`

                try {
                    await sendWhatsAppMessage(toIntlPhone(owner.phone_number), ownerMessage)
                } catch (err) {
                    console.error(`[Processor] Failed to send owner status:`, err)
                }
            }

            await markNotificationSent(supabase, ownerNotif.id)
        }

    } else if (notif.target_role === 'owner') {
        // Owner notifications are processed as part of the assignee flow above.
        // If we reach here, it means the assignee notification was already processed
        // or this is an orphaned owner notification. Just mark as sent.
        await markNotificationSent(supabase, notif.id)
    }
}

// ---------------------------------------------------------------------------
// Stage 2: Reminder Processing (Tasks only)
// ---------------------------------------------------------------------------

async function processTaskReminder(
    supabase: SupabaseAdmin,
    notif: TaskNotification,
): Promise<void> {
    const meta = notif.metadata || {}
    const taskTitle = (meta.task_title as string) || 'a task'
    const ownerName = (meta.owner_name as string) || 'your manager'
    const deadline = (meta.deadline as string) || ''

    // Check task is still active (accepted status)
    const { data: task } = await supabase
        .from('tasks')
        .select('status')
        .eq('id', notif.task_id)
        .single()

    if (!task || !['accepted', 'overdue'].includes(task.status)) {
        console.log(`[Processor] Task ${notif.task_id} is no longer active (${task?.status}), skipping reminder`)
        await markNotificationSent(supabase, notif.id)
        return
    }

    const targetUser = await lookupUser(supabase, notif.target_user_id)
    if (!targetUser?.phone_number) {
        await markNotificationFailed(supabase, notif.id, 'Target user has no phone number')
        return
    }

    const phone = toIntlPhone(targetUser.phone_number)

    if (notif.channel === 'call') {
        // This is a call escalation (button wasn't clicked within 1hr)
        if (isWithinBusinessHours(new Date())) {
            try {
                const language = 'hi-IN' // Call scripts are in Hindi
                const script = buildReminderCallScript(taskTitle, ownerName)
                await makeAutomatedCall(phone, script, language)
            } catch (err) {
                console.error(`[Processor] Reminder call failed:`, err)
            }
        }

        // As requested by the user, also send the WhatsApp template again alongside the call
        const deadlineFormatted = deadline ? formatDate(deadline) : 'soon'
        try {
            await sendTaskProgressCheckTemplate(phone, taskTitle, deadlineFormatted, ownerName, notif.task_id)
        } catch (err) {
            console.error(`[Processor] Failed to send progress check template alongside call:`, err)
        }

        await markNotificationSent(supabase, notif.id)
        return
    }

    // Check if this is an owner no-reply notification
    if (meta.is_owner_no_reply === true) {
        const assigneeName = (meta.assignee_name as string) || 'the assignee'
        const message = `⚠️ *No Response to Reminder*\n\n*Task:*\n"${taskTitle}"\n\n*Assignee:*\n${assigneeName}\n\nThe assignee didn't respond to the task progress check.\n\n_You may want to check in with them directly._`
        try {
            await sendWhatsAppMessage(phone, message)
        } catch (err) {
            console.error(`[Processor] Failed to send owner no-reply message:`, err)
        }
        await markNotificationSent(supabase, notif.id)
        return
    }

    // Send progress check template with "Going Well" + "Edit Deadline" buttons
    const deadlineFormatted = deadline ? formatDate(deadline) : 'soon'
    try {
        await sendTaskProgressCheckTemplate(phone, taskTitle, deadlineFormatted, ownerName, notif.task_id)
        await markNotificationSent(supabase, notif.id)
    } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error'
        await markNotificationFailed(supabase, notif.id, errMsg)
    }
}

// ---------------------------------------------------------------------------
// Stage 2: Acknowledgment Timeout Check
// ---------------------------------------------------------------------------

/**
 * Check for sent Stage 2 reminders where neither "Going Well" nor "Edit Deadline"
 * was clicked.
 *
 * At 1hr: schedule call to assignee
 * At 2hr: schedule owner notification
 */
async function checkReminderAcknowledgmentTimeouts(supabase: SupabaseAdmin): Promise<number> {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()

    // Find sent WhatsApp reminders that were sent >1hr ago and don't have
    // a corresponding call escalation already scheduled
    const { data: unackedReminders, error } = await supabase
        .from('task_notifications')
        .select('id, task_id, target_user_id, stage_number, metadata, sent_at')
        .eq('stage', 'reminder')
        .eq('channel', 'whatsapp')
        .eq('target_role', 'assignee')
        .eq('status', 'sent')
        .lt('sent_at', oneHourAgo)

    if (error || !unackedReminders || unackedReminders.length === 0) return 0

    let escalatedCount = 0

    for (const reminder of unackedReminders as TaskNotification[]) {
        // Check if acknowledgment was received (metadata.acknowledged = true)
        if (reminder.metadata?.acknowledged) continue

        // Skip owner no-reply notifications and call escalations
        if (reminder.metadata?.is_owner_no_reply === true) continue

        // Check task is still active
        const { data: task } = await supabase
            .from('tasks')
            .select('status')
            .eq('id', reminder.task_id)
            .single()

        if (!task || !['accepted', 'overdue'].includes(task.status)) continue

        const meta = reminder.metadata || {}
        const sentAt = reminder.sent_at ? new Date(reminder.sent_at).getTime() : 0

        // --- 1-hour mark: Schedule call escalation ---
        // Check if a call escalation already exists for this reminder
        const { data: existingCall } = await supabase
            .from('task_notifications')
            .select('id')
            .eq('task_id', reminder.task_id)
            .eq('stage', 'reminder')
            .eq('stage_number', reminder.stage_number)
            .eq('channel', 'call')
            .in('status', ['pending', 'sent'])  // failed/cancelled → allow retry
            .limit(1)

        if (!existingCall || existingCall.length === 0) {
            await scheduleReminderCallEscalation(
                reminder.task_id,
                reminder.target_user_id,
                reminder.stage_number,
                (meta.task_title as string) || 'a task',
                (meta.owner_name as string) || 'your manager',
                (meta.deadline as string) || '',
                supabase,
            )
            escalatedCount++
        }

        // --- 2-hour mark: Schedule owner notification ---
        if (sentAt > 0 && sentAt < new Date(twoHoursAgo).getTime()) {
            // Check if owner no-reply notification already exists
            const { data: existingOwnerNotify } = await supabase
                .from('task_notifications')
                .select('id')
                .eq('task_id', reminder.task_id)
                .eq('stage', 'reminder')
                .eq('stage_number', reminder.stage_number)
                .eq('target_role', 'owner')
                .limit(1)

            if (!existingOwnerNotify || existingOwnerNotify.length === 0) {
                const ownerId = meta.owner_id as string
                if (ownerId) {
                    // Only schedule if the owner user still exists
                    const ownerUser = await lookupUser(supabase, ownerId)
                    if (ownerUser) {
                        // Look up assignee name for the owner message
                        const assignee = await lookupUser(supabase, reminder.target_user_id)
                        await scheduleOwnerNoReplyNotification(
                            reminder.task_id,
                            ownerId,
                            reminder.stage_number,
                            (meta.task_title as string) || 'a task',
                            assignee?.name || 'the assignee',
                            supabase,
                        )
                        escalatedCount++
                    } else {
                        console.log(`[Processor] Skipping owner no-reply for task ${reminder.task_id}: owner ${ownerId} no longer exists`)

                        // Mark this notification as acknowledged so we don't keep trying to process it
                        try {
                            const newMeta = { ...meta, acknowledged: true }
                            await supabase
                                .from('task_notifications')
                                .update({ metadata: newMeta })
                                .eq('id', reminder.id)
                        } catch (e) {
                            console.error(`[Processor] Failed to mark reminder as acknowledged for deleted owner ${ownerId}:`, e)
                        }
                    }
                }
            }
        }
    }

    return escalatedCount
}

// ---------------------------------------------------------------------------
// Stage 3a: Deadline Approaching Processing
// ---------------------------------------------------------------------------

async function processDeadlineApproaching(
    supabase: SupabaseAdmin,
    notif: TaskNotification,
): Promise<void> {
    const meta = notif.metadata || {}
    const taskTitle = (meta.task_title as string) || 'a task'
    const isTodo = meta.is_todo === true

    // Check task is still active
    const { data: task } = await supabase
        .from('tasks')
        .select('status')
        .eq('id', notif.task_id)
        .single()

    if (!task || ['completed', 'cancelled'].includes(task.status)) {
        console.log(`[Processor] Task ${notif.task_id} is ${task?.status}, skipping deadline approaching`)
        await markNotificationSent(supabase, notif.id)
        return
    }

    const targetUser = await lookupUser(supabase, notif.target_user_id)
    if (!targetUser?.phone_number) {
        await markNotificationFailed(supabase, notif.id, 'Target user has no phone number')
        return
    }

    const phone = toIntlPhone(targetUser.phone_number)

    // Look up owner name for task deadline approaching template
    const ownerName = (meta.owner_name as string) || 'your manager'

    try {
        if (isTodo) {
            // To-do: owner gets "Mark Completed" + "Edit Deadline" (only taskTitle)
            await sendTodoDeadlineApproachingTemplate(phone, taskTitle, notif.task_id)
        } else {
            // Task: assignee gets "Edit Deadline" (taskTitle + ownerName)
            await sendTaskDeadlineApproachingTemplate(phone, taskTitle, ownerName, notif.task_id)
        }
        await markNotificationSent(supabase, notif.id)
    } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error'
        await markNotificationFailed(supabase, notif.id, errMsg)
    }
}

// ---------------------------------------------------------------------------
// Stage 3b: Escalation Processing
// ---------------------------------------------------------------------------

async function processEscalation(
    supabase: SupabaseAdmin,
    notif: TaskNotification,
): Promise<void> {
    const meta = notif.metadata || {}
    const taskTitle = (meta.task_title as string) || 'a task'
    const assigneeName = (meta.assignee_name as string) || 'the assignee'
    const isTodo = meta.is_todo === true

    // Check task is still overdue/active
    const { data: task } = await supabase
        .from('tasks')
        .select('status')
        .eq('id', notif.task_id)
        .single()

    if (!task || ['completed', 'cancelled'].includes(task.status)) {
        console.log(`[Processor] Task ${notif.task_id} is ${task?.status}, skipping escalation`)
        await markNotificationSent(supabase, notif.id)
        return
    }

    const targetUser = await lookupUser(supabase, notif.target_user_id)
    if (!targetUser?.phone_number) {
        await markNotificationFailed(supabase, notif.id, 'Target user has no phone number')
        return
    }

    const phone = toIntlPhone(targetUser.phone_number)

    try {
        if (isTodo) {
            await sendTodoOverdueTemplate(phone, taskTitle, notif.task_id)
        } else {
            await sendTaskOverdueOwnerTemplate(phone, taskTitle, assigneeName, notif.task_id)
        }
        await markNotificationSent(supabase, notif.id)
    } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error'
        await markNotificationFailed(supabase, notif.id, errMsg)
    }
}

// ---------------------------------------------------------------------------
// Overdue Task Detection
// ---------------------------------------------------------------------------

/**
 * Detect tasks that have crossed their deadline and schedule escalations.
 * Also updates task status to 'overdue'.
 */
async function detectOverdueTasks(supabase: SupabaseAdmin): Promise<number> {
    const { data: overdueTasks, error } = await supabase
        .from('tasks')
        .select('id, title, created_by, assigned_to, committed_deadline')
        .eq('status', 'accepted')
        .not('committed_deadline', 'is', null)
        .lte('committed_deadline', new Date().toISOString())
        .limit(50)

    if (error || !overdueTasks || overdueTasks.length === 0) return 0

    let count = 0

    for (const task of overdueTasks) {
        try {
            // Update status to overdue
            await supabase
                .from('tasks')
                .update({ status: 'overdue', updated_at: new Date().toISOString() })
                .eq('id', task.id)

            // Check if escalations already scheduled
            const { data: existingEsc } = await supabase
                .from('task_notifications')
                .select('id')
                .eq('task_id', task.id)
                .eq('stage', 'escalation')
                .limit(1)

            if (existingEsc && existingEsc.length > 0) {
                continue
            }

            // Look up assignee name
            const assignee = await lookupUser(supabase, task.assigned_to)

            // Schedule escalation notifications
            await scheduleEscalations(
                task.id,
                task.assigned_to,
                task.created_by,
                new Date(task.committed_deadline),
                task.title,
                assignee?.name || 'the assignee',
                supabase,
            )

            // Cancel any remaining reminder/deadline_approaching notifications
            await cancelPendingNotifications(task.id, 'reminder', supabase)
            await cancelPendingNotifications(task.id, 'deadline_approaching', supabase)

            count++
        } catch (err) {
            console.error(`[Processor] Failed to process overdue task ${task.id}:`, err)
        }
    }

    return count
}

// ---------------------------------------------------------------------------
// Main Entry Point
// ---------------------------------------------------------------------------

/**
 * Process all due task notifications.
 * Called by the cron job every 5 minutes.
 *
 * Returns processing stats.
 */
export async function processTaskNotifications(
    supabase?: SupabaseAdmin,
): Promise<{
    processed: number
    failed: number
    overdue: number
    reminderEscalations: number
}> {
    const sb = supabase || createAdminClient()
    const stats = { processed: 0, failed: 0, overdue: 0, reminderEscalations: 0 }

    try {
        // 1. Atomically claim due notifications by marking them 'processing'.
        // This prevents a server restart mid-run from re-sending already-dispatched
        // notifications on the next cron tick.
        const { data: notifications, error } = await sb
            .from('task_notifications')
            .update({ status: 'processing', updated_at: new Date().toISOString() })
            .eq('status', 'pending')
            .lte('scheduled_at', new Date().toISOString())
            .order('scheduled_at', { ascending: true })
            .limit(50)
            .select('*')

        if (error) {
            console.error('[Processor] Failed to fetch notifications:', error.message)
            return stats
        }

        if (notifications && notifications.length > 0) {
            console.log(`[Processor] Processing ${notifications.length} due notification(s)`)

            for (const notif of notifications as TaskNotification[]) {
                try {
                    switch (notif.stage) {
                        case 'acceptance':
                            await processAcceptanceFollowup(sb, notif)
                            break
                        case 'reminder':
                            await processTaskReminder(sb, notif)
                            break
                        case 'deadline_approaching':
                            await processDeadlineApproaching(sb, notif)
                            break
                        case 'escalation':
                            await processEscalation(sb, notif)
                            break
                        default:
                            console.warn(`[Processor] Unknown stage: ${notif.stage}`)
                            await markNotificationFailed(sb, notif.id, `Unknown stage: ${notif.stage}`)
                            stats.failed++
                            continue
                    }
                    stats.processed++
                } catch (err) {
                    const errMsg = err instanceof Error ? err.message : 'Unknown error'
                    console.error(`[Processor] Failed to process notification ${notif.id}:`, errMsg)
                    await markNotificationFailed(sb, notif.id, errMsg)
                    stats.failed++
                }
            }
        }

        // 2. Detect overdue tasks and schedule escalations
        stats.overdue = await detectOverdueTasks(sb)

        // 3. Check for unacknowledged reminders (Stage 2 → call + owner notification)
        stats.reminderEscalations = await checkReminderAcknowledgmentTimeouts(sb)

    } catch (err) {
        console.error('[Processor] Unhandled error:', err instanceof Error ? err.message : err)
    }

    return stats
}
