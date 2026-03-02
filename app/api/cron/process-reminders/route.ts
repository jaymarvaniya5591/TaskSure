import { NextResponse } from 'next/server'
import { processTaskNotifications } from '@/lib/notifications/task-notification-processor'

// ---------------------------------------------------------------------------
// GET handler — Vercel Cron triggers this every 5 minutes
//
// Processes all due task notifications from the task_notifications table:
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
