
/**
 * GET /api/keep-warm
 *
 * Lightweight public endpoint that keeps the sin1 serverless function
 * container warm. Called by:
 *  1. Landing page (boldoai.in) on every visit — fires a background fetch
 *  2. WhatsApp webhook — fires when an auth link is sent out
 *  3. External cron (cron-job.org or UptimeRobot) — optional free ping
 *
 * No auth required — it does nothing sensitive, just returns a timestamp.
 */
export const preferredRegion = 'sin1'

export function GET() {
    return Response.json({
        status: 'warm',
        region: process.env.VERCEL_REGION || 'local',
        timestamp: new Date().toISOString(),
    })
}
