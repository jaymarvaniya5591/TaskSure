import { NextRequest, NextResponse } from 'next/server'
import { getAudio } from '@/lib/notifications/audio-store'

/**
 * Serves pre-generated audio from Railway process memory.
 * Twilio's <Play> fetches this URL — serving from our own server
 * gives ~100ms TTFB vs 3s+ from Supabase CDN cold cache.
 */
export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params
    const audio = getAudio(id)

    if (!audio) {
        return new NextResponse('Not found', { status: 404 })
    }

    // Uint8Array wrapper needed for TypeScript BodyInit compatibility
    return new NextResponse(new Uint8Array(audio.buffer), {
        headers: {
            'Content-Type': audio.mimeType,
            'Content-Length': audio.buffer.length.toString(),
            'Cache-Control': 'no-store',
        },
    })
}
