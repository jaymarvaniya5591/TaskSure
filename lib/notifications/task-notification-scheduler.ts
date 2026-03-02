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

import { adjustToBusinessHours } from './business-hours'
import { createAdminClient } from '@/lib/supabase/admin'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseAdmin = any

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NotificationRow {
    task_id: string
    stage: 'acceptance' | 'reminder' | 'escalation'
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
 * Followups at: +10min, +1hr, +3hr (adjusted to business hours)
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
        const offsets = [
            10 * 60 * 1000,       // +10 minutes
            60 * 60 * 1000,       // +1 hour
            3 * 60 * 60 * 1000,   // +3 hours
        ]

        const rows: NotificationRow[] = []

        for (let i = 0; i < offsets.length; i++) {
            const rawTime = new Date(now.getTime() + offsets[i])
            const scheduledAt = adjustToBusinessHours(rawTime)

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

            // Owner notification: status update about the call
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
            console.log(`[Scheduler] Scheduled ${rows.length} acceptance followup notifications for task ${taskId}`)
        }
    } catch (err) {
        console.error('[Scheduler] Error scheduling acceptance followups:', err instanceof Error ? err.message : err)
    }
}

// ---------------------------------------------------------------------------
// Stage 2: Mid-Task Reminders
// ---------------------------------------------------------------------------

/**
 * Compute the number of reminders and their timing based on days to deadline.
 *
 * Formula:
 *   D = 0 (same day):  1 reminder at midpoint of remaining hours (min 30 min from now)
 *   D = 1:             1 reminder at midpoint
 *   D = 2–3:           2 reminders, evenly spaced, ≥1 day apart
 *   D = 4–6:           3 reminders, evenly spaced, ≥1 day apart
 *   D ≥ 7:             4 reminders, evenly spaced, ≥1 day apart
 */
function computeReminderTimes(acceptedAt: Date, deadline: Date): Date[] {
    const totalMs = deadline.getTime() - acceptedAt.getTime()
    if (totalMs <= 0) return [] // Deadline already passed

    const totalDays = totalMs / (24 * 60 * 60 * 1000)

    let count: number
    if (totalDays < 1) {
        count = 1 // Same day
    } else if (totalDays < 2) {
        count = 1
    } else if (totalDays < 4) {
        count = 2
    } else if (totalDays < 7) {
        count = 3
    } else {
        count = 4
    }

    const reminders: Date[] = []
    const intervalMs = totalMs / (count + 1) // Divide span into count+1 segments

    for (let i = 1; i <= count; i++) {
        const reminderTime = new Date(acceptedAt.getTime() + intervalMs * i)
        // Ensure minimum 30 min from now and within business hours
        const minTime = new Date(Date.now() + 30 * 60 * 1000)
        const finalTime = reminderTime.getTime() < minTime.getTime() ? minTime : reminderTime
        reminders.push(adjustToBusinessHours(finalTime))
    }

    return reminders
}

/**
 * Schedule mid-task reminders after a task is accepted.
 * Each reminder sends a template with "Yes, on track" button.
 * If button not clicked within 1hr, a call escalation is triggered
 * (handled by the processor checking acknowledgment).
 */
export async function scheduleTaskReminders(
    taskId: string,
    assigneeId: string,
    ownerId: string,
    acceptedAt: Date,
    deadline: Date,
    taskTitle: string,
    ownerName: string,
    supabase?: SupabaseAdmin,
): Promise<void> {
    const sb = supabase || createAdminClient()

    try {
        const reminderTimes = computeReminderTimes(acceptedAt, deadline)

        if (reminderTimes.length === 0) {
            console.log(`[Scheduler] No reminders needed for task ${taskId} (deadline already passed or too close)`)
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
// Stage 3: Post-Deadline Escalations
// ---------------------------------------------------------------------------

/**
 * Schedule 3 escalation notifications to the task owner after deadline is crossed.
 *
 * Timing:
 *   1. Immediately (when deadline is detected as crossed)
 *   2. +1 day
 *   3. +3 days
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

        const rows: NotificationRow[] = offsets.map((offset, i) => {
            const rawTime = new Date(now.getTime() + offset)
            const scheduledAt = offset === 0 ? rawTime : adjustToBusinessHours(rawTime)
            return {
                task_id: taskId,
                stage: 'escalation' as const,
                stage_number: i + 1,
                target_user_id: ownerId,
                target_role: 'owner' as const,
                channel: 'whatsapp' as const,
                scheduled_at: scheduledAt.toISOString(),
                metadata: {
                    task_title: taskTitle,
                    assignee_id: assigneeId,
                    assignee_name: assigneeName,
                    deadline: deadline.toISOString(),
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
    stage?: 'acceptance' | 'reminder' | 'escalation',
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
 * Called by the processor when a reminder template was sent but the "Yes, on track"
 * button was not clicked within 1 hour.
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
