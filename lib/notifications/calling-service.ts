/**
 * Calling Service — Pluggable telephony abstraction layer.
 *
 * Default provider: Twilio (Trial) / Plivo (Future)
 * Architecture: Provider-agnostic interface so the telephony backend
 * can be swapped without changing callers.
 *
 * Flow:
 *   1. Make outbound call via configured telephony provider
 *   2. Return call status (connected, not_connected, error)
 *
 * Server-side only — never import on the client.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { storeAudio } from '@/lib/notifications/audio-store'

// ---------------------------------------------------------------------------
// WAV → MP3 Conversion (lazy — never crashes the server on startup)
// ---------------------------------------------------------------------------

type LamejsEncoder = { encodeBuffer: (s: Int16Array) => Int8Array; flush: () => Int8Array }
type LamejsLib = { Mp3Encoder: new (channels: number, sampleRate: number, kbps: number) => LamejsEncoder }

// null = not yet loaded, false = failed to load
let _lamejs: LamejsLib | null | false = null

function getLamejs(): LamejsLib | null {
    if (_lamejs === false) return null
    if (_lamejs) return _lamejs
    try {
        // @breezystack/lamejs is listed in serverExternalPackages so Next.js
        // won't bundle it — it's require()'d at runtime from node_modules.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        _lamejs = require('@breezystack/lamejs') as LamejsLib
        return _lamejs
    } catch (err) {
        console.warn('[CallingService] @breezystack/lamejs unavailable — MP3 encoding disabled:', err)
        _lamejs = false
        return null
    }
}

/**
 * Convert a WAV buffer to MP3 at 64 kbps.
 * Returns null if lamejs is unavailable (caller falls back to serving WAV).
 */
function convertWavToMp3(wavBuffer: Buffer): Buffer | null {
    const lame = getLamejs()
    if (!lame) return null
    try {
        const channels = wavBuffer.readUInt16LE(22)
        const sampleRate = wavBuffer.readUInt32LE(24)
        const pcmData = wavBuffer.subarray(44)
        const samples = new Int16Array(pcmData.buffer, pcmData.byteOffset, pcmData.byteLength / 2)

        const encoder = new lame.Mp3Encoder(channels, sampleRate, 64)
        const mp3Chunks: Buffer[] = []
        const blockSize = 1152

        for (let i = 0; i < samples.length; i += blockSize) {
            const chunk = samples.subarray(i, i + blockSize)
            const mp3buf = encoder.encodeBuffer(chunk)
            if (mp3buf.length > 0) mp3Chunks.push(Buffer.from(mp3buf))
        }

        const finalBuf = encoder.flush()
        if (finalBuf.length > 0) mp3Chunks.push(Buffer.from(finalBuf))

        return Buffer.concat(mp3Chunks)
    } catch (err) {
        console.error('[CallingService] WAV→MP3 conversion failed:', err)
        return null
    }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CallResult {
    success: boolean
    callId?: string
    status: 'connected' | 'not_connected' | 'error'
    durationSeconds?: number
    error?: string
}

export interface CallingProvider {
    name: string
    makeCall(phone: string, text: string, language: string, audioUrl?: string): Promise<CallResult>
}

// ---------------------------------------------------------------------------
// Language Detection
// ---------------------------------------------------------------------------

// Map incoming_messages language_detected values to standard TTS language codes
const LANGUAGE_MAP: Record<string, string> = {
    'hi': 'hi-IN',
    'hindi': 'hi-IN',
    'en': 'en-IN',
    'english': 'en-IN',
    'bn': 'bn-IN',
    'bengali': 'bn-IN',
    'ta': 'ta-IN',
    'tamil': 'ta-IN',
    'te': 'te-IN',
    'telugu': 'te-IN',
    'gu': 'gu-IN',
    'gujarati': 'gu-IN',
    'kn': 'kn-IN',
    'kannada': 'kn-IN',
    'ml': 'ml-IN',
    'malayalam': 'ml-IN',
    'mr': 'mr-IN',
    'marathi': 'mr-IN',
    'pa': 'pa-IN',
    'punjabi': 'pa-IN',
    'or': 'or-IN',
    'odia': 'or-IN',
}

const DEFAULT_LANGUAGE = 'en-IN'

/**
 * Get the language code for TTS based on the user's last WhatsApp message.
 * Falls back to English if no language detected or user has no messages.
 */
export async function getUserLanguage(
    userId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase?: any,
): Promise<string> {
    const sb = supabase || createAdminClient()

    try {
        // Find the user's phone number first
        const { data: user } = await sb
            .from('users')
            .select('phone_number')
            .eq('id', userId)
            .single()

        if (!user?.phone_number) return DEFAULT_LANGUAGE

        // Get the last message with a detected language
        const { data: msg } = await sb
            .from('incoming_messages')
            .select('language_detected')
            .eq('phone', user.phone_number)
            .not('language_detected', 'is', null)
            .order('created_at', { ascending: false })
            .limit(1)
            .single()

        if (!msg?.language_detected) return DEFAULT_LANGUAGE

        const lang = msg.language_detected.toLowerCase().trim()
        return LANGUAGE_MAP[lang] || DEFAULT_LANGUAGE
    } catch {
        return DEFAULT_LANGUAGE
    }
}

// ---------------------------------------------------------------------------
// Sarvam TTS — Generate audio from text
// ---------------------------------------------------------------------------

const SARVAM_TTS_URL = 'https://api.sarvam.ai/text-to-speech'

/**
 * Generate speech audio from text using Sarvam Bulbul v3.
 * Returns a base64-encoded audio string.
 */
export async function generateTTS(
    text: string,
    language: string = DEFAULT_LANGUAGE,
): Promise<{ audioBase64: string; mimeType: string } | null> {
    const apiKey = process.env.SARVAM_API_KEY
    if (!apiKey) {
        console.error('[CallingService] Missing SARVAM_API_KEY')
        return null
    }

    try {
        const response = await fetch(SARVAM_TTS_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'api-subscription-key': apiKey,
            },
            body: JSON.stringify({
                inputs: [text],
                target_language_code: language,
                model: 'bulbul:v3',
                speaker: 'sunny',
                pace: 1.0,
                enable_preprocessing: true,
            }),
        })

        if (!response.ok) {
            const errorBody = await response.text()
            console.error(`[CallingService] Sarvam TTS failed (${response.status}):`, errorBody)
            return null
        }

        const data = await response.json()
        const audioBase64 = data?.audios?.[0]

        if (!audioBase64) {
            console.error('[CallingService] Sarvam TTS returned no audio')
            return null
        }

        return { audioBase64, mimeType: 'audio/wav' }
    } catch (err) {
        console.error('[CallingService] Sarvam TTS error:', err instanceof Error ? err.message : err)
        return null
    }
}

// ---------------------------------------------------------------------------
// Twilio Provider
// ---------------------------------------------------------------------------

const twilioProvider: CallingProvider = {
    name: 'twilio',

    async makeCall(phone: string, text: string, language: string, audioUrl?: string): Promise<CallResult> {
        const accountSid = process.env.TWILIO_ACCOUNT_SID
        const authToken = process.env.TWILIO_AUTH_TOKEN
        const callerId = process.env.TWILIO_PHONE_NUMBER

        if (!accountSid || !authToken || !callerId) {
            console.error('[CallingService] Missing Twilio credentials')
            return { success: false, status: 'error', error: 'Missing Twilio configuration (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER)' }
        }

        const to = phone.startsWith('+') ? phone : `+${phone}`
        const from = callerId.startsWith('+') ? callerId : `+${callerId}`

        const apiUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`

        try {
            const formParams = new URLSearchParams()
            formParams.append('To', to)
            formParams.append('From', from)

            if (audioUrl) {
                // Use inline TwiML with pre-generated Supabase audio URL
                // This eliminates the webhook roundtrip entirely = 0 latency
                const twiml = `<Response><Play>${audioUrl}</Play></Response>`
                formParams.append('Twiml', twiml)
                console.log(`[CallingService] Using inline TwiML with audio: ${audioUrl}`)
            } else {
                // Fallback: use webhook to generate TTS on-the-fly
                const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://boldoai.in'
                const answerUrl = `${baseUrl}/api/internal/twilio-answer?text=${encodeURIComponent(text)}&language=${encodeURIComponent(language)}`
                formParams.append('Url', answerUrl)
            }

            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Authorization': `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
                },
                body: formParams,
            })

            const data = await response.json()

            if (!response.ok) {
                console.error(`[CallingService] Twilio call failed (${response.status}):`, data)
                return { success: false, status: 'error', error: data.message || `Twilio ${response.status}` }
            }

            console.log(`[CallingService] Twilio call initiated:`, data.sid)

            return {
                success: true,
                callId: data.sid,
                status: 'connected',
            }
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : 'Unknown error'
            console.error('[CallingService] Twilio call error:', errMsg)
            return { success: false, status: 'error', error: errMsg }
        }
    },
}

// ---------------------------------------------------------------------------
// Plivo Provider (Ready for future switch)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const plivoProvider: CallingProvider = {
    name: 'plivo',

    async makeCall(phone: string, text: string, language: string, audioUrl?: string): Promise<CallResult> {
        const authId = process.env.PLIVO_AUTH_ID
        const authToken = process.env.PLIVO_AUTH_TOKEN
        const callerId = process.env.PLIVO_PHONE_NUMBER

        if (!authId || !authToken || !callerId) {
            console.error('[CallingService] Missing Plivo credentials')
            return { success: false, status: 'error', error: 'Missing Plivo configuration' }
        }

        const to = phone.startsWith('+') ? phone : `+${phone}`

        const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://boldoai.in'
        let answerUrl = `${baseUrl}/api/internal/plivo-answer?text=${encodeURIComponent(text)}&language=${encodeURIComponent(language)}`
        if (audioUrl) {
            answerUrl += `&audioUrl=${encodeURIComponent(audioUrl)}`
        }

        const apiUrl = `https://api.plivo.com/v1/Account/${authId}/Call/`

        try {
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Basic ${Buffer.from(`${authId}:${authToken}`).toString('base64')}`,
                },
                body: JSON.stringify({
                    to: to,
                    from: callerId,
                    answer_url: answerUrl,
                    answer_method: 'GET'
                }),
            })

            const data = await response.json()

            if (!response.ok) {
                console.error(`[CallingService] Plivo call failed (${response.status}):`, data)
                return { success: false, status: 'error', error: data.error || `Plivo ${response.status}` }
            }

            console.log(`[CallingService] Plivo call initiated:`, data.request_uuid)

            return {
                success: true,
                callId: data.request_uuid,
                status: 'connected',
            }
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : 'Unknown error'
            console.error('[CallingService] Plivo call error:', errMsg)
            return { success: false, status: 'error', error: errMsg }
        }
    },
}

// ---------------------------------------------------------------------------
// Active Provider Selection
// ---------------------------------------------------------------------------

/**
 * Get the currently configured calling provider.
 * Currently set to Twilio.
 * To switch to Plivo, just return plivoProvider here once the account is approved!
 */
function getProvider(): CallingProvider {
    return twilioProvider
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function makeAutomatedCall(
    phone: string,
    message: string,
    language: string = 'hi-IN',
): Promise<CallResult> {
    console.log(`[CallingService] Making automated call to ${phone} in ${language}`)

    // Generate Sarvam TTS before making the call to achieve <0.2s latency upon pickup
    let audioUrl: string | undefined = undefined
    try {
        console.log(`[CallingService] Pre-generating Sarvam TTS...`)
        const tts = await generateTTS(message, language)
        if (tts && tts.audioBase64) {
            const wavBuffer = Buffer.from(tts.audioBase64, 'base64')
            const mp3Buffer = convertWavToMp3(wavBuffer)
            // Fall back to WAV if MP3 encoding unavailable — still fast since served from memory
            const audioBuffer = mp3Buffer ?? wavBuffer
            const mimeType = mp3Buffer ? 'audio/mpeg' : 'audio/wav'

            // Store in Railway process memory — serving from our own server gives Twilio
            // ~100ms TTFB vs 3s+ from Supabase CDN cold cache.
            const audioId = crypto.randomUUID()
            storeAudio(audioId, audioBuffer, mimeType)
            const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://boldoai.in'
            audioUrl = `${baseUrl}/api/internal/call-audio/${audioId}`
            console.log(`[CallingService] Pre-generated TTS stored in memory: ${audioUrl}`)
        }
    } catch (err) {
        console.error(`[CallingService] TTS pre-generation error:`, err)
    }

    const provider = getProvider()
    const result = await provider.makeCall(phone, message, language, audioUrl)

    console.log(`[CallingService] Call result for ${phone}:`, result)
    return result
}

export function buildAcceptanceCallScript(
    ownerName: string,
    taskSummary: string,
): string {
    const trimmedTask = taskSummary.length > 500
        ? taskSummary.substring(0, 500).trim() + '...'
        : taskSummary
    return `नमस्ते! आपको एक नया काम दिया है, ${ownerName} ने। काम है: ${trimmedTask}। कृपया इसे WhatsApp पर स्वीकार करें।`
}

export function buildReminderCallScript(
    taskTitle: string,
    ownerName: string,
): string {
    const trimmedTask = taskTitle.length > 500
        ? taskTitle.substring(0, 500).trim() + '...'
        : taskTitle
    return `नमस्ते! यह आपके काम का रिमाइंडर है from, ${ownerName}। काम है: ${trimmedTask}। हमने आपको WhatsApp पर मैसेज भेजा है। कृपया वहां बताएं कि काम ठीक से चल रहा है, या अगर जरूरत हो तो आप डेडलाइन भी बदल सकते हैं। धन्यवाद।`
}
