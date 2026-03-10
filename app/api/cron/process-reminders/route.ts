import { NextResponse } from 'next/server'
import { processTaskNotifications } from '@/lib/notifications/task-notification-processor'
import { processDailySummaries } from '@/lib/notifications/daily-summary'

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Concurrency guard — prevents two simultaneous cron runs on the same process.
//
// Railway runs a single Node.js instance. If two HTTP requests arrive at the
// same time (e.g. duplicate cron-job.org entries), the second is skipped.
//
// NOTE: Does NOT protect across multiple Railway instances/replicas.
// If Railway is ever scaled to >1 replica, replace with a Postgres advisory
// lock (pg_try_advisory_lock) via a Supabase RPC.
// ---------------------------------------------------------------------------
let isRunning = false
// ---------------------------------------------------------------------------
// GET handler — Vercel Cron triggers this every 5 minutes
//
// Processes all due task notifications from the task_notifications table:
//   - Daily Summaries: sent at 8:00 AM IST strictly before other reminders
//   - Stage 1: Acceptance followups (calls + templates)
//   - Stage 2: Mid-task reminders (templates + call escalation on timeout)
//   - Stage 3: Post-deadline escalations (owner templates)
//   - Overdue detection: marks tasks as overdue and schedules escalations
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
    // Verify the request is from Vercel Cron
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
        console.warn('[Cron] Unauthorized request')
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (isRunning) {
        console.warn('[Cron] Skipping: previous run is still in progress')
        return NextResponse.json({ status: 'skipped', reason: 'already_running' })
    }
    isRunning = true

    const t0 = Date.now()

    try {
        // Check IST time for daily summary window
        const now = new Date()
        const istTime = new Date(now.getTime() + 5.5 * 60 * 60 * 1000)
        const istHour = istTime.getUTCHours()
        const istMinute = istTime.getUTCMinutes()

        // Phase 1: Daily Summaries (isolated — failure here must NOT block Phase 2)
        let summaryStats = { sent: 0, failed: 0 }
        if (istHour === 8 && istMinute <= 15) {
            try {
                const t1 = Date.now()
                summaryStats = await processDailySummaries()
                console.log(`[Cron] Daily Summaries completed in ${Date.now() - t1}ms — sent: ${summaryStats.sent}, failed: ${summaryStats.failed}`)
            } catch (err) {
                console.error('[Cron] Daily summary failed (continuing to task notifications):', err instanceof Error ? err.message : err)
            }
        }

        // Phase 2: Task Notifications (always runs, independent of Phase 1)
        let stats = { processed: 0, failed: 0, overdue: 0, reminderEscalations: 0 }
        try {
            const t2 = Date.now()
            stats = await processTaskNotifications()
            console.log(
                `[Cron] Task notifications completed in ${Date.now() - t2}ms — ` +
                `processed: ${stats.processed}, failed: ${stats.failed}, ` +
                `overdue: ${stats.overdue}, reminder escalations: ${stats.reminderEscalations}`
            )
        } catch (err) {
            console.error('[Cron] Task notifications failed:', err instanceof Error ? err.message : err)
        }

        const duration = Date.now() - t0
        console.log(`[Cron] Total completed in ${duration}ms`)

        return NextResponse.json({
            status: 'ok',
            duration_ms: duration,
            summary: summaryStats,
            ...stats,
        })
    } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error'
        console.error('[Cron] Unhandled error:', errMsg)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    } finally {
        isRunning = false
    }
}
