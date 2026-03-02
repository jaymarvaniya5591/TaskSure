/**
 * Task Notification Processor — Processes due notifications from
 * the task_notifications table.
 *
 * Called by the cron job every 5 minutes. Handles:
 *   - Stage 1 (acceptance): Make call + send template to assignee, status to owner
 *   - Stage 2 (reminder): Send template with "on track" button, check for ack timeout
 *   - Stage 3 (escalation): Send overdue template to owner
 *
 * All operations are idempotent and never throw.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { sendWhatsAppMessage, sendTaskAssignmentTemplate, sendTaskReminderTemplate, sendTaskOverdueOwnerTemplate } from '@/lib/whatsapp'
import { makeAutomatedCall, buildAcceptanceCallScript, buildReminderCallScript, getUserLanguage } from './calling-service'
import { scheduleReminderCallEscalation, scheduleEscalations } from './task-notification-scheduler'
import { isWithinBusinessHours } from './business-hours'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseAdmin = any

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TaskNotification {
    id: string
    task_id: string
    stage: 'acceptance' | 'reminder' | 'escalation'
    stage_number: number
    target_user_id: string
    target_role: 'assignee' | 'owner'
    channel: 'whatsapp' | 'call' | 'both'
    scheduled_at: string
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
                const language = await getUserLanguage(notif.target_user_id, supabase)
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
// Stage 2: Reminder Processing
// ---------------------------------------------------------------------------

async function processTaskReminder(
    supabase: SupabaseAdmin,
    notif: TaskNotification,
): Promise<void> {
    const meta = notif.metadata
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
                const language = await getUserLanguage(notif.target_user_id, supabase)
                const script = buildReminderCallScript(taskTitle, ownerName)
                await makeAutomatedCall(phone, script, language)
            } catch (err) {
                console.error(`[Processor] Reminder call failed:`, err)
            }
        }
        await markNotificationSent(supabase, notif.id)
        return
    }

    // Send reminder template with "Yes, on track" button
    const deadlineFormatted = deadline ? formatDate(deadline) : 'soon'
    try {
        await sendTaskReminderTemplate(phone, taskTitle, deadlineFormatted, ownerName, notif.task_id)
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
 * Check for sent Stage 2 reminders where the "Yes, on track" button
 * was NOT clicked within 1 hour. Schedule a call escalation for those.
 */
async function checkReminderAcknowledgmentTimeouts(supabase: SupabaseAdmin): Promise<number> {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()

    // Find sent WhatsApp reminders that were sent >1hr ago and don't have
    // a corresponding call escalation already scheduled
    const { data: unackedReminders, error } = await supabase
        .from('task_notifications')
        .select('id, task_id, target_user_id, stage_number, metadata')
        .eq('stage', 'reminder')
        .eq('channel', 'whatsapp')
        .eq('status', 'sent')
        .lt('sent_at', oneHourAgo)

    if (error || !unackedReminders || unackedReminders.length === 0) return 0

    let escalatedCount = 0

    for (const reminder of unackedReminders as TaskNotification[]) {
        // Check if acknowledgment was received (metadata.acknowledged = true)
        if (reminder.metadata?.acknowledged) continue

        // Check task is still active
        const { data: task } = await supabase
            .from('tasks')
            .select('status')
            .eq('id', reminder.task_id)
            .single()

        if (!task || !['accepted'].includes(task.status)) continue

        // Check if a call escalation already exists for this reminder
        const { data: existing } = await supabase
            .from('task_notifications')
            .select('id')
            .eq('task_id', reminder.task_id)
            .eq('stage', 'reminder')
            .eq('stage_number', reminder.stage_number)
            .eq('channel', 'call')
            .limit(1)

        if (existing && existing.length > 0) continue

        // Schedule call escalation
        const meta = reminder.metadata || {}
        await scheduleReminderCallEscalation(
            reminder.task_id,
            reminder.target_user_id,
            reminder.stage_number,
            (meta.task_title as string) || 'a task',
            (meta.owner_name as string) || 'your manager',
            supabase,
        )
        escalatedCount++
    }

    return escalatedCount
}

// ---------------------------------------------------------------------------
// Stage 3: Escalation Processing
// ---------------------------------------------------------------------------

async function processEscalation(
    supabase: SupabaseAdmin,
    notif: TaskNotification,
): Promise<void> {
    const meta = notif.metadata
    const taskTitle = (meta.task_title as string) || 'a task'
    const assigneeName = (meta.assignee_name as string) || 'the assignee'

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
        await sendTaskOverdueOwnerTemplate(phone, taskTitle, assigneeName, notif.task_id)
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
                // Escalations already exist, skip
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

            // Cancel any remaining reminder notifications
            const { cancelPendingNotifications } = await import('./task-notification-scheduler')
            await cancelPendingNotifications(task.id, 'reminder', supabase)

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
        // 1. Fetch all due pending notifications
        const { data: notifications, error } = await sb
            .from('task_notifications')
            .select('*')
            .eq('status', 'pending')
            .lte('scheduled_at', new Date().toISOString())
            .order('scheduled_at', { ascending: true })
            .limit(50)

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

        // 3. Check for unacknowledged reminders (Stage 2 → call escalation)
        stats.reminderEscalations = await checkReminderAcknowledgmentTimeouts(sb)

    } catch (err) {
        console.error('[Processor] Unhandled error:', err instanceof Error ? err.message : err)
    }

    return stats
}
