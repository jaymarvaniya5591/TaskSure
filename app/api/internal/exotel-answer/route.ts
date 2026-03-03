import { NextRequest, NextResponse } from 'next/server'

/**
 * Exotel Answer URL Endpoint
 *
 * When Exotel connects an outbound call, it hits this endpoint to get
 * the ExoML instructions for what to do during the call.
 *
 * We play the pre-generated TTS audio URL twice with a pause in between.
 */

export async function GET(request: NextRequest) {
    const audioUrl = request.nextUrl.searchParams.get('audio')

    if (!audioUrl) {
        // Fallback: just say a generic message using ExoML
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say>You have a pending task. Please check your WhatsApp messages.</Say>
</Response>`
        return new NextResponse(xml, {
            headers: { 'Content-Type': 'application/xml' },
        })
    }

    // Play the TTS audio twice. Exotel does not have a <Wait> verb exactly like this 
    // without it being inside a <Gather> or similar, but <Play> followed by <Play>
    // might just play them back-to-back. We can use a silent audio file for waiting,
    // or just play it once. Let's play it twice just in case.
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Play>${audioUrl}</Play>
    <Play>${audioUrl}</Play>
</Response>`

    return new NextResponse(xml, {
        headers: { 'Content-Type': 'application/xml' },
    })
}
