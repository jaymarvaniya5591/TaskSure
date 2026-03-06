import { NextResponse } from 'next/server'

export async function GET(request: Request) {
    try {
        const url = new URL(request.url)
        const text = url.searchParams.get('text') || 'Hello'
        const language = url.searchParams.get('language') || 'en-IN'

        // Plivo uses AWS Polly for neural voices
        let voice = 'Polly.Raveena'
        if (language.startsWith('hi')) {
            voice = 'Polly.Aditi'
        }

        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Speak voice="${voice}" language="${language}">${text}</Speak>
</Response>`

        return new NextResponse(xml, {
            status: 200,
            headers: { 'Content-Type': 'text/xml' }
        })
    } catch (error) {
        console.error('[Plivo Webhook] Error:', error)
        return new NextResponse('Error generating XML', { status: 500 })
    }
}

export async function POST(request: Request) {
    return GET(request)
}
