import { NextRequest, NextResponse } from 'next/server'
import { generateTTS } from '@/lib/notifications/calling-service'

export const preferredRegion = 'sin1';

/**
 * Sarvam Audio Streaming Endpoint
 *
 * Receives text and language, generates the TTS audio via Sarvam API,
 * and streams it back as an audio/wav response.
 * This is used by the Exotel webhook to play dynamic TTS without hitting
 * URL length limits with base64 data URIs.
 */

export async function GET(request: NextRequest) {
    const text = request.nextUrl.searchParams.get('text')
    const language = request.nextUrl.searchParams.get('language') || 'en-IN'

    if (!text) {
        return new NextResponse('Missing text parameter', { status: 400 })
    }

    try {
        const ttsResult = await generateTTS(text, language)

        if (!ttsResult || !ttsResult.audioBase64) {
            console.error('[SarvamAudioEndpoint] Failed to generate TTS')
            return new NextResponse('Failed to generate audio', { status: 500 })
        }

        // Convert base64 to binary buffer
        const audioBuffer = Buffer.from(ttsResult.audioBase64, 'base64')

        // Return as streaming audio response
        return new NextResponse(audioBuffer, {
            headers: {
                'Content-Type': 'audio/wav',
                'Content-Length': audioBuffer.length.toString(),
                'Cache-Control': 'public, max-age=86400', // Cache for 24 hours
            },
        })
    } catch (error) {
        console.error('[SarvamAudioEndpoint] Error:', error)
        return new NextResponse('Internal Server Error', { status: 500 })
    }
}
