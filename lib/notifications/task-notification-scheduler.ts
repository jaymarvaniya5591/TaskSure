/**
 * Task Notification Scheduler — Computes and inserts notification
 * schedules into the task_notifications table.
 *
 * Called at task lifecycle events (create, accept, overdue).
 * All operations are fire-and-forget — never throws.
 *
 * Scheduling is lightweight: just DB inserts with computed timestamps.
 * The actual sending is handled by the cron-driven processor.
 */

import { adjustToBusinessHours, setToFixed8AM, getISTDate } from './business-hours'
import { createAdminClient } from '@/lib/supabase/admin'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseAdmin = any

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NotificationRow {
    task_id: string
    stage: 'acceptance' | 'reminder' | 'escalation' | 'deadline_approaching'
    stage_number: number
    target_user_id: string
    target_role: 'assignee' | 'owner'
    channel: 'whatsapp' | 'call' | 'both'
    scheduled_at: string
    metadata?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Stage 1: Acceptance Followups
// ---------------------------------------------------------------------------

/**
 * Schedule 3 acceptance followup notifications for a new task.
 * Called when a task is created with created_by ≠ assigned_to.
 *
 * Followups at: +10min, +1hr, +3hr (adjusted to business hours 9AM-9PM)
 * Each followup sends a call to assignee + status update to owner.
 */
export async function scheduleAcceptanceFollowups(
    taskId: string,
    assigneeId: string,
    ownerId: string,
    taskTitle: string,
    ownerName: string,
    supabase?: SupabaseAdmin,
): Promise<void> {
    const sb = supabase || createAdminClient()

    try {
        const now = new Date()

        // Gaps between consecutive followups (not absolute offsets from now).
        // Followup 1: now + 10 min
        // Followup 2: followup1_adjusted + 50 min  (so the gap from raw F1→F2 is 1 hr)
        // Followup 3: followup2_adjusted + 2 hr    (so the gap from raw F2→F3 is 2 hr)
        //
        // Each subsequent time is computed from the ADJUSTED time of the previous one,
        // so a business-hours shift on followup 1 propagates forward to 2 and 3,
        // preventing all three from landing at the same time.
        const gaps = [
            10 * 60 * 1000,       // +10 min from now
            50 * 60 * 1000,       // +50 min from prev adjusted (total gap ~1 hr from F1)
            2 * 60 * 60 * 1000,   // +2 hr from prev adjusted (total gap ~3 hr from F1)
        ]

        const rows: NotificationRow[] = []
        let prevAdjusted = now // start from now; first gap +10 min gives F1

        for (let i = 0; i < gaps.length; i++) {
            const rawTime = new Date(prevAdjusted.getTime() + gaps[i])
            const scheduledAt = adjustToBusinessHours(rawTime)
            prevAdjusted = scheduledAt // next followup chains from this adjusted time

            // Assignee notification: call + send acceptance template
            rows.push({
                task_id: taskId,
                stage: 'acceptance',
                stage_number: i + 1,
                target_user_id: assigneeId,
                target_role: 'assignee',
                channel: 'both', // call + whatsapp template
                scheduled_at: scheduledAt.toISOString(),
                metadata: { task_title: taskTitle, owner_name: ownerName, owner_id: ownerId },
            })

            // Owner notification: status update about the call (same time as assignee notification)
            rows.push({
                task_id: taskId,
                stage: 'acceptance',
                stage_number: i + 1,
                target_user_id: ownerId,
                target_role: 'owner',
                channel: 'whatsapp',
                scheduled_at: scheduledAt.toISOString(),
                metadata: { task_title: taskTitle, assignee_id: assigneeId },
            })
        }

        const { error } = await sb
            .from('task_notifications')
            .insert(rows)

        if (error) {
            console.error('[Scheduler] Failed to schedule acceptance followups:', error.message)
        } else {
            const times = rows
                .filter(r => r.target_role === 'assignee')
                .map((r, i) => `  F${i + 1}: ${r.scheduled_at}`)
                .join('\n')
            console.log(`[Scheduler] Scheduled ${rows.length} acceptance followup notifications for task ${taskId}:\n${times}`)
        }
    } catch (err) {
        console.error('[Scheduler] Error scheduling acceptance followups:', err instanceof Error ? err.message : err)
    }
}

// ---------------------------------------------------------------------------
// Stage 2: Mid-Task Reminders (Tasks only — NOT for to-dos)
// ---------------------------------------------------------------------------

/**
 * Compute reminder days for Stage 2 based on creation date and deadline.
 *
 * Rules:
 *   - Eligible days: strictly between creation day and deadline day (excluding both)
 *   - If gap ≤ 1 day (same day or next day) → 0 reminders
 *   - Max 4 reminders, distributed evenly across eligible days
 *   - Min 2-day gap between consecutive reminders
 *   - All reminders at 8:00 AM IST
 */
function computeReminderDays(createdAt: Date, deadline: Date): Date[] {
    const createdIST = getISTDate(createdAt)
    const deadlineIST = getISTDate(deadline)

    // Build list of eligible calendar days (strictly between creation and deadline day)
    const eligibleDays: Date[] = []
    const oneDayMs = 24 * 60 * 60 * 1000

    // Start from the day AFTER creation
    const startDate = new Date(createdAt.getTime())
    // Set to start of the next IST day
    const createdDayStart = new Date(Date.UTC(createdIST.year, createdIST.month, createdIST.day) - (5.5 * 60 * 60 * 1000))
    let currentDay = new Date(createdDayStart.getTime() + oneDayMs)

    // The deadline day start in UTC
    const deadlineDayStart = new Date(Date.UTC(deadlineIST.year, deadlineIST.month, deadlineIST.day) - (5.5 * 60 * 60 * 1000))

    while (currentDay.getTime() < deadlineDayStart.getTime()) {
        eligibleDays.push(new Date(currentDay.getTime()))
        currentDay = new Date(currentDay.getTime() + oneDayMs)
    }

    if (eligibleDays.length === 0) return []

    // Determine how many reminders (max 4)
    const maxReminders = Math.min(4, eligibleDays.length)

    // Now distribute reminders evenly with min 2-day gap
    // Use greedy approach: pick evenly spaced days, then enforce minimum gap
    if (maxReminders === 1) {
        // Single reminder: pick the middle day
        const mid = Math.floor(eligibleDays.length / 2)
        return [setToFixed8AM(eligibleDays[mid])]
    }

    // For multiple reminders: distribute evenly
    const reminders: Date[] = []
    const step = eligibleDays.length / (maxReminders)

    for (let i = 0; i < maxReminders; i++) {
        const idx = Math.min(Math.floor(step * i + step / 2), eligibleDays.length - 1)
        reminders.push(eligibleDays[idx])
    }

    // Enforce minimum 2-day gap between consecutive reminders
    const filtered: Date[] = [reminders[0]]
    for (let i = 1; i < reminders.length; i++) {
        const prevIST = getISTDate(filtered[filtered.length - 1])
        const currIST = getISTDate(reminders[i])

        // Calculate day difference
        const prevDayStart = new Date(Date.UTC(prevIST.year, prevIST.month, prevIST.day))
        const currDayStart = new Date(Date.UTC(currIST.year, currIST.month, currIST.day))
        const dayDiff = Math.round((currDayStart.getTime() - prevDayStart.getTime()) / oneDayMs)

        if (dayDiff >= 2) {
            filtered.push(reminders[i])
        }
    }

    return filtered.map(d => setToFixed8AM(d))
}

/**
 * Schedule mid-task reminders after a task is accepted.
 * Each reminder sends a template with "Going Well" + "Edit Deadline" buttons.
 * If neither button clicked within 1hr, a call escalation is triggered.
 * If still no response after 2hr, owner is notified.
 *
 * Only for delegated tasks (NOT to-dos).
 */
export async function scheduleTaskReminders(
    taskId: string,
    assigneeId: string,
    ownerId: string,
    createdAt: Date,
    deadline: Date,
    taskTitle: string,
    ownerName: string,
    supabase?: SupabaseAdmin,
): Promise<void> {
    const sb = supabase || createAdminClient()

    try {
        const reminderTimes = computeReminderDays(createdAt, deadline)

        if (reminderTimes.length === 0) {
            console.log(`[Scheduler] No reminders needed for task ${taskId} (deadline too close to creation)`)
            return
        }

        const rows: NotificationRow[] = reminderTimes.map((time, i) => ({
            task_id: taskId,
            stage: 'reminder' as const,
            stage_number: i + 1,
            target_user_id: assigneeId,
            target_role: 'assignee' as const,
            channel: 'whatsapp' as const,
            scheduled_at: time.toISOString(),
            metadata: {
                task_title: taskTitle,
                owner_name: ownerName,
                owner_id: ownerId,
                deadline: deadline.toISOString(),
            },
        }))

        const { error } = await sb
            .from('task_notifications')
            .insert(rows)

        if (error) {
            console.error('[Scheduler] Failed to schedule task reminders:', error.message)
        } else {
            console.log(`[Scheduler] Scheduled ${rows.length} reminder(s) for task ${taskId}`)
        }
    } catch (err) {
        console.error('[Scheduler] Error scheduling task reminders:', err instanceof Error ? err.message : err)
    }
}

// ---------------------------------------------------------------------------
// Stage 3a: Deadline Approaching (30 min before)
// ---------------------------------------------------------------------------

/**
 * Schedule a "deadline approaching" notification 30 minutes before the deadline.
 *
 * For tasks: sent to the assignee with "Edit Deadline" button.
 * For to-dos: sent to the owner with "Mark Completed" + "Edit Deadline" buttons.
 *
 * No business hour restrictions.
 */
export async function scheduleDeadlineApproaching(
    taskId: string,
    assigneeId: string,
    ownerId: string,
    deadline: Date,
    taskTitle: string,
    ownerName: string,
    supabase?: SupabaseAdmin,
): Promise<void> {
    const sb = supabase || createAdminClient()

    try {
        const scheduledAt = new Date(deadline.getTime() - 30 * 60 * 1000) // 30 min before

        // If the scheduled time is already in the past, skip
        if (scheduledAt.getTime() <= Date.now()) {
            console.log(`[Scheduler] Deadline approaching time already passed for task ${taskId}, skipping`)
            return
        }

        const isTodo = ownerId === assigneeId

        const row: NotificationRow = {
            task_id: taskId,
            stage: 'deadline_approaching',
            stage_number: 1,
            target_user_id: isTodo ? ownerId : assigneeId,
            target_role: isTodo ? 'owner' : 'assignee',
            channel: 'whatsapp',
            scheduled_at: scheduledAt.toISOString(),
            metadata: {
                task_title: taskTitle,
                deadline: deadline.toISOString(),
                is_todo: isTodo,
                assignee_id: assigneeId,
                owner_id: ownerId,
                owner_name: ownerName,
            },
        }

        const { error } = await sb
            .from('task_notifications')
            .insert(row)

        if (error) {
            console.error('[Scheduler] Failed to schedule deadline approaching:', error.message)
        } else {
            console.log(`[Scheduler] Scheduled deadline approaching notification for task ${taskId} at ${scheduledAt.toISOString()}`)
        }
    } catch (err) {
        console.error('[Scheduler] Error scheduling deadline approaching:', err instanceof Error ? err.message : err)
    }
}

// ---------------------------------------------------------------------------
// Stage 3b: Post-Deadline Escalations
// ---------------------------------------------------------------------------

/**
 * Schedule 3 escalation notifications after deadline is crossed.
 *
 * Timing:
 *   1. Immediately (when deadline is detected as crossed)
 *   2. +1 day
 *   3. +3 days
 *
 * No business hour restrictions for either tasks or to-dos.
 *
 * For tasks: sent to the owner.
 * For to-dos: sent to the owner (who is also the assignee).
 */
export async function scheduleEscalations(
    taskId: string,
    assigneeId: string,
    ownerId: string,
    deadline: Date,
    taskTitle: string,
    assigneeName: string,
    supabase?: SupabaseAdmin,
): Promise<void> {
    const sb = supabase || createAdminClient()

    try {
        const now = new Date()
        const offsets = [
            0,                        // Immediately
            24 * 60 * 60 * 1000,      // +1 day
            3 * 24 * 60 * 60 * 1000,  // +3 days
        ]

        const isTodo = ownerId === assigneeId

        const rows: NotificationRow[] = offsets.map((offset, i) => {
            const scheduledAt = new Date(now.getTime() + offset)

            return {
                task_id: taskId,
                stage: 'escalation' as const,
                stage_number: i + 1,
                // To-Dos go to the assignee (who is the owner). Regular tasks go to the owner.
                target_user_id: isTodo ? assigneeId : ownerId,
                target_role: isTodo ? 'assignee' : 'owner',
                channel: 'whatsapp' as const,
                scheduled_at: scheduledAt.toISOString(),
                metadata: {
                    task_title: taskTitle,
                    assignee_id: assigneeId,
                    assignee_name: assigneeName,
                    deadline: deadline.toISOString(),
                    is_todo: isTodo,
                },
            }
        })

        const { error } = await sb
            .from('task_notifications')
            .insert(rows)

        if (error) {
            console.error('[Scheduler] Failed to schedule escalations:', error.message)
        } else {
            console.log(`[Scheduler] Scheduled ${rows.length} escalation(s) for task ${taskId}`)
        }
    } catch (err) {
        console.error('[Scheduler] Error scheduling escalations:', err instanceof Error ? err.message : err)
    }
}

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------

/**
 * Cancel all pending notifications for a task.
 * Optionally filter by stage (e.g., cancel only 'acceptance' followups).
 */
export async function cancelPendingNotifications(
    taskId: string,
    stage?: 'acceptance' | 'reminder' | 'escalation' | 'deadline_approaching',
    supabase?: SupabaseAdmin,
): Promise<void> {
    const sb = supabase || createAdminClient()

    try {
        let query = sb
            .from('task_notifications')
            .update({ status: 'cancelled', updated_at: new Date().toISOString() })
            .eq('task_id', taskId)
            .eq('status', 'pending')

        if (stage) {
            query = query.eq('stage', stage)
        }

        const { error, count } = await query

        if (error) {
            console.error('[Scheduler] Failed to cancel notifications:', error.message)
        } else {
            console.log(`[Scheduler] Cancelled ${count ?? '?'} pending notification(s) for task ${taskId}${stage ? ` (stage: ${stage})` : ''}`)
        }
    } catch (err) {
        console.error('[Scheduler] Error cancelling notifications:', err instanceof Error ? err.message : err)
    }
}

/**
 * Schedule a one-off call escalation for a Stage 2 reminder that was not acknowledged.
 * Called by the processor when a reminder template was sent but neither button
 * was clicked within 1 hour.
 */
export async function scheduleReminderCallEscalation(
    taskId: string,
    assigneeId: string,
    stageNumber: number,
    taskTitle: string,
    ownerName: string,
    supabase?: SupabaseAdmin,
): Promise<void> {
    const sb = supabase || createAdminClient()

    try {
        const callTime = adjustToBusinessHours(new Date(Date.now() + 5 * 60 * 1000)) // +5 min (already 1hr has passed)

        const { error } = await sb
            .from('task_notifications')
            .insert({
                task_id: taskId,
                stage: 'reminder',
                stage_number: stageNumber,
                target_user_id: assigneeId,
                target_role: 'assignee',
                channel: 'call',
                scheduled_at: callTime.toISOString(),
                metadata: { task_title: taskTitle, owner_name: ownerName, is_call_escalation: true },
            })

        if (error) {
            console.error('[Scheduler] Failed to schedule reminder call escalation:', error.message)
        } else {
            console.log(`[Scheduler] Scheduled reminder call escalation for task ${taskId}`)
        }
    } catch (err) {
        console.error('[Scheduler] Error scheduling reminder call:', err instanceof Error ? err.message : err)
    }
}

/**
 * Schedule a one-off owner notification for a Stage 2 reminder that was not responded to
 * after 2 hours. Tells the owner that the assignee didn't reply.
 */
export async function scheduleOwnerNoReplyNotification(
    taskId: string,
    ownerId: string,
    stageNumber: number,
    taskTitle: string,
    assigneeName: string,
    supabase?: SupabaseAdmin,
): Promise<void> {
    const sb = supabase || createAdminClient()

    try {
        // Schedule for now + 5 min (the 2 hours have already passed by the time this is called)
        const notifyTime = new Date(Date.now() + 5 * 60 * 1000)

        const { error } = await sb
            .from('task_notifications')
            .insert({
                task_id: taskId,
                stage: 'reminder',
                stage_number: stageNumber,
                target_user_id: ownerId,
                target_role: 'owner',
                channel: 'whatsapp',
                scheduled_at: notifyTime.toISOString(),
                metadata: {
                    task_title: taskTitle,
                    assignee_name: assigneeName,
                    is_owner_no_reply: true,
                },
            })

        if (error) {
            console.error('[Scheduler] Failed to schedule owner no-reply notification:', error.message)
        } else {
            console.log(`[Scheduler] Scheduled owner no-reply notification for task ${taskId}`)
        }
    } catch (err) {
        console.error('[Scheduler] Error scheduling owner no-reply:', err instanceof Error ? err.message : err)
    }
}
