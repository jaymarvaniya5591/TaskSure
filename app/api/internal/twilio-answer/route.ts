import { NextResponse } from 'next/server'

export async function POST(request: Request) {
    try {
        const url = new URL(request.url)
        const text = url.searchParams.get('text') || 'Hello'
        const language = url.searchParams.get('language') || 'en-IN'

        const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://boldoai.in'
        let finalUrl = `${baseUrl}/api/internal/sarvam-audio.wav?text=${encodeURIComponent(text)}&language=${encodeURIComponent(language)}`

        // If an audioUrl was provided, use that for 0-latency playback
        const providedAudioUrl = url.searchParams.get('audioUrl')
        if (providedAudioUrl) {
            finalUrl = providedAudioUrl
        }

        const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Play>${finalUrl}</Play>
</Response>`

        return new NextResponse(twiml, {
            status: 200,
            headers: { 'Content-Type': 'text/xml' }
        })
    } catch (error) {
        console.error('[Twilio Webhook] Error:', error)
        return new NextResponse('Error generating TwiML', { status: 500 })
    }
}

export async function GET(request: Request) {
    return POST(request)
}
