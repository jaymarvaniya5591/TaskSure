import type { NextRequest } from 'next/server'

/**
 * GET /api/keep-warm
 *
 * Lightweight endpoint that Vercel cron hits every 5 minutes to prevent
 * cold starts on serverless functions in the sin1 (Singapore) region.
 * This keeps the function container warm so auth link requests are instant.
 */

// Co-locate with Supabase
export const preferredRegion = 'sin1'

export function GET(request: NextRequest) {
    const authHeader = request.headers.get('authorization')

    // In production, Vercel cron sends this header automatically
    if (
        process.env.CRON_SECRET &&
        authHeader !== `Bearer ${process.env.CRON_SECRET}`
    ) {
        return new Response('Unauthorized', { status: 401 })
    }

    return Response.json({
        status: 'warm',
        region: process.env.VERCEL_REGION || 'local',
        timestamp: new Date().toISOString(),
    })
}
