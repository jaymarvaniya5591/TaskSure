import { NextResponse } from 'next/server'

export async function POST(request: Request) {
    try {
        const url = new URL(request.url)
        const text = url.searchParams.get('text') || 'Hello'
        const language = url.searchParams.get('language') || 'en-IN'

        const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://boldoai.in'
        const audioUrl = `${baseUrl}/api/internal/sarvam-audio.wav?text=${encodeURIComponent(text)}&language=${encodeURIComponent(language)}`

        const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Play>${audioUrl}</Play>
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
