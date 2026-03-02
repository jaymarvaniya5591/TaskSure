import { NextRequest, NextResponse } from 'next/server'

/**
 * Plivo Answer URL Endpoint
 *
 * When Plivo connects an outbound call, it hits this endpoint to get
 * the XML instructions for what to do during the call.
 *
 * We play the pre-generated TTS audio URL twice with a pause in between.
 */

export async function GET(request: NextRequest) {
    const audioUrl = request.nextUrl.searchParams.get('audio')

    if (!audioUrl) {
        // Fallback: just say a generic message
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Speak>You have a pending task. Please check your WhatsApp messages.</Speak>
</Response>`
        return new NextResponse(xml, {
            headers: { 'Content-Type': 'application/xml' },
        })
    }

    // Play the TTS audio twice with a 2-second pause
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Play>${audioUrl}</Play>
    <Wait length="2"/>
    <Play>${audioUrl}</Play>
</Response>`

    return new NextResponse(xml, {
        headers: { 'Content-Type': 'application/xml' },
    })
}
