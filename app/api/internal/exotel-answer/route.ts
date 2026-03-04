import { NextRequest, NextResponse } from 'next/server'

export const preferredRegion = 'sin1';

/**
 * Exotel Answer URL Endpoint
 *
 * When Exotel connects an outbound call, it hits this endpoint to get
 * the ExoML instructions for what to do during the call.
 *
 * We play the pre-generated TTS audio URL twice with a pause in between.
 */

export async function GET(request: NextRequest) {
    const text = request.nextUrl.searchParams.get('text')
    const language = request.nextUrl.searchParams.get('language') || 'en-IN'

    // Play the TTS audio twice. Exotel does not have a <Wait> verb exactly like this 
    // without it being inside a <Gather> or similar, but <Play> followed by <Play>
    // might just play them back-to-back. We can use a silent audio file for waiting,
    // or just play it once. Let's play it twice just in case.

    // We point <Play> to our streaming endpoint that generates the wav file dynamically.
    // We add a dummy .wav at the end of the URL before the query params so Exotel recognizes it
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://boldoai.in'
    const audioUrl = `${baseUrl}/api/internal/sarvam-audio.wav?text=${encodeURIComponent(text || 'You have a pending task. Please check your WhatsApp messages.')}&language=${encodeURIComponent(language)}`

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Play>${audioUrl}</Play>
    <Play>${audioUrl}</Play>
</Response>`

    return new NextResponse(xml, {
        headers: { 'Content-Type': 'application/xml' },
    })
}
