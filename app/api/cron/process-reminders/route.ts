import { NextResponse } from 'next/server'
import { processTaskNotifications } from '@/lib/notifications/task-notification-processor'
import { processDailySummaries } from '@/lib/notifications/daily-summary'

export const dynamic = 'force-dynamic';
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

    const t0 = Date.now()

    try {
        // Run Daily Summaries strictly before other task notifications
        // Check if IST time is 8:00 AM - 8:05 AM
        const now = new Date()
        const istTime = new Date(now.getTime() + 5.5 * 60 * 60 * 1000)
        const istHour = istTime.getUTCHours()
        const istMinute = istTime.getUTCMinutes()

        let summaryStats = { sent: 0, failed: 0 }
        // Extended window to 8:15 AM to ensure it runs after deployment finishes
        if (istHour === 8 && istMinute <= 15) {
            summaryStats = await processDailySummaries()
            console.log(`[Cron] Daily Summaries processed — sent: ${summaryStats.sent}, failed: ${summaryStats.failed}`)
        }

        const stats = await processTaskNotifications()

        const duration = Date.now() - t0
        console.log(
            `[Cron] Completed in ${duration}ms — ` +
            `processed: ${stats.processed}, failed: ${stats.failed}, ` +
            `overdue: ${stats.overdue}, reminder escalations: ${stats.reminderEscalations}`
        )

        return NextResponse.json({
            status: 'ok',
            duration_ms: duration,
            ...stats,
        })
    } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error'
        console.error('[Cron] Unhandled error:', errMsg)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}
