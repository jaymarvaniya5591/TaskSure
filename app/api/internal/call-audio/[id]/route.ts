import { NextRequest, NextResponse } from 'next/server'
import { getAudio, deleteAudio } from '@/lib/notifications/audio-store'

/**
 * Streams a pre-generated MP3 directly from Railway process memory.
 * Serving from our own server gives Twilio ~100ms TTFB, vs 3s+ from Supabase CDN cold cache.
 * Twilio plays MP3 progressively as it receives frames, so audio starts in ~300ms.
 */
export async function GET(
    _request: NextRequest,
    { params }: { params: { id: string } }
) {
    const buffer = getAudio(params.id)

    if (!buffer) {
        return new NextResponse('Not found', { status: 404 })
    }

    // Serve once then clean up
    deleteAudio(params.id)

    return new NextResponse(new Uint8Array(buffer), {
        status: 200,
        headers: {
            'Content-Type': 'audio/mpeg',
            'Content-Length': buffer.length.toString(),
            'Cache-Control': 'no-store',
        },
    })
}
