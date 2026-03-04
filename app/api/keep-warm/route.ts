import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * GET /api/keep-warm
 *
 * Lightweight public endpoint that keeps the sin1 serverless function
 * container and the Supabase database connection pool warm. Called by:
 *  1. Landing page (boldoai.in) on every visit — fires a background fetch
 *  2. External cron (cron-job.org or UptimeRobot) — hits this and /login every 5 mins
 *
 * No auth required — it does nothing sensitive, just returns a timestamp.
 */
export const preferredRegion = 'sin1'
export const runtime = 'edge'

export async function GET() {
    const supabase = createAdminClient()

    // Lightweight DB query to keep the PostgREST connection pool hot
    const t0 = Date.now()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from('users').select('id').limit(1)
    const t1 = Date.now()

    return Response.json({
        status: 'warm',
        region: process.env.VERCEL_REGION || 'local',
        db_latency_ms: t1 - t0,
        timestamp: new Date().toISOString(),
    })
}
