import { NextResponse } from 'next/server'

export async function POST(request: Request) {
    try {
        const url = new URL(request.url)
        const text = url.searchParams.get('text') || 'Hello'
        const language = url.searchParams.get('language') || 'en-IN'

        let voice = 'Polly.Raveena' // standard Indian English female
        if (language.startsWith('hi')) {
            voice = 'Polly.Aditi' // Indian Hindi/English female
        }

        const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="${voice}" language="${language}">${text}</Say>
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
