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
// lamejs has a module scope bug (MPEGMode not in scope) when loaded via index.js.
// Loading lame.all.js (the self-contained bundle) and injecting a collector object
// is the only reliable way to get Mp3Encoder working in Node.js.
/* eslint-disable @typescript-eslint/no-require-imports */
const _lamejsSrc: string = require('fs').readFileSync(
    require('path').join(process.cwd(), 'lib/vendor/lame.all.js'),
    'utf8'
)
/* eslint-enable @typescript-eslint/no-require-imports */
// eslint-disable-next-line no-eval
const lamejs: { Mp3Encoder: new (channels: number, sampleRate: number, kbps: number) => { encodeBuffer: (samples: Int16Array) => Int8Array; flush: () => Int8Array } } = eval(
    '(function(){var lamejs={};' +
    _lamejsSrc.replace('lamejs();', 'lamejs_fn(lamejs);').replace('function lamejs()', 'function lamejs_fn(lamejs)') +
    ';return lamejs;})()'
)

// ---------------------------------------------------------------------------
// WAV → MP3 Conversion
// ---------------------------------------------------------------------------

/**
 * Convert a WAV buffer to MP3 using lamejs.
 * WAV from Sarvam TTS is ~720KB for a 15s clip; MP3 @64kbps is ~120KB.
 * Twilio downloads the entire file before playing, so 6x smaller = 6x faster start.
 */
function convertWavToMp3(wavBuffer: Buffer): Buffer {
    // Parse WAV header fields (standard RIFF layout)
    const channels = wavBuffer.readUInt16LE(22)
    const sampleRate = wavBuffer.readUInt32LE(24)

    // PCM data starts at byte 44 (44-byte standard RIFF header)
    const pcmData = wavBuffer.subarray(44)
    const samples = new Int16Array(pcmData.buffer, pcmData.byteOffset, pcmData.byteLength / 2)

    const encoder = new lamejs.Mp3Encoder(channels, sampleRate, 64) // 64 kbps — good for speech
    const mp3Chunks: Buffer[] = []
    const blockSize = 1152 // lamejs standard block size

    for (let i = 0; i < samples.length; i += blockSize) {
        const chunk = samples.subarray(i, i + blockSize)
        const mp3buf = encoder.encodeBuffer(chunk)
        if (mp3buf.length > 0) mp3Chunks.push(Buffer.from(mp3buf))
    }

    const finalBuf = encoder.flush()
    if (finalBuf.length > 0) mp3Chunks.push(Buffer.from(finalBuf))

    return Buffer.concat(mp3Chunks)
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

            // Store in Railway process memory — serving from our own server gives Twilio
            // ~100ms TTFB vs 3s+ from Supabase CDN cold cache. Twilio plays MP3 progressively
            // so audio starts within ~300ms of call connect.
            const audioId = crypto.randomUUID()
            storeAudio(audioId, mp3Buffer)
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
