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
import { SARVAM_TO_BCP47 } from '@/lib/language-utils'

// ---------------------------------------------------------------------------
// WAV → MP3 Conversion (lazy — never crashes the server on startup)
// ---------------------------------------------------------------------------

type LamejsEncoder = { encodeBuffer: (left: Int16Array, right?: Int16Array) => Int8Array; flush: () => Int8Array }
type LamejsLib = { Mp3Encoder: new (channels: number, sampleRate: number, kbps: number) => LamejsEncoder }

// null = not yet loaded, false = failed to load
let _lamejs: LamejsLib | null | false = null

function getLamejs(): LamejsLib | null {
    if (_lamejs === false) return null
    if (_lamejs) return _lamejs
    try {
        // Use vendored lame.all.js (self-contained IIFE bundle).
        // require('@breezystack/lamejs') fails with ERR_REQUIRE_ESM (ESM-only package).
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const fs = require('fs')
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const path = require('path')
        const src = fs.readFileSync(path.join(process.cwd(), 'lib', 'vendor', 'lame.all.js'), 'utf8')
        // eslint-disable-next-line no-eval
        _lamejs = eval(
            '(function(){var lamejs={};' +
            src.replace('lamejs();', 'lamejs_fn(lamejs);').replace('function lamejs()', 'function lamejs_fn(lamejs)') +
            ';return lamejs;})()'
        ) as LamejsLib
        console.warn('[CallingService] lamejs loaded via vendored file')
        return _lamejs
    } catch (err) {
        console.warn('[CallingService] lamejs unavailable — MP3 disabled:', err)
        _lamejs = false
        return null
    }
}

/**
 * Find the 'data' chunk in a WAV buffer.
 * Standard RIFF WAV has data at byte 44, but extra chunks (LIST, fact, etc.)
 * can push it further. This scans for the actual 'data' chunk ID.
 */
function findWavDataOffset(wav: Buffer): number {
    let offset = 12 // Skip RIFF header (4) + file size (4) + WAVE (4)
    while (offset < wav.length - 8) {
        const chunkId = wav.toString('ascii', offset, offset + 4)
        const chunkSize = wav.readUInt32LE(offset + 4)
        if (chunkId === 'data') return offset + 8
        offset += 8 + chunkSize
    }
    return 44 // Fallback to standard offset
}

/**
 * Convert a WAV buffer to MP3 at 64 kbps.
 * Handles mono/stereo, non-standard WAV headers, and buffer alignment.
 * Returns null if lamejs is unavailable (caller falls back to serving WAV).
 */
function convertWavToMp3(wavBuffer: Buffer): Buffer | null {
    const lame = getLamejs()
    if (!lame) return null
    try {
        const channels = wavBuffer.readUInt16LE(22)
        const sampleRate = wavBuffer.readUInt32LE(24)
        const dataOffset = findWavDataOffset(wavBuffer)

        // Copy PCM data to a fresh buffer — ensures Int16Array byte alignment
        // (Node.js pooled Buffers can have odd byteOffset → RangeError)
        const pcmData = Buffer.from(wavBuffer.subarray(dataOffset))
        const samples = new Int16Array(pcmData.buffer, pcmData.byteOffset, pcmData.byteLength / 2)

        const encoder = new lame.Mp3Encoder(channels, sampleRate, 64)
        const mp3Chunks: Buffer[] = []
        const blockSize = 1152

        if (channels === 1) {
            for (let i = 0; i < samples.length; i += blockSize) {
                const chunk = samples.subarray(i, i + blockSize)
                const mp3buf = encoder.encodeBuffer(chunk)
                if (mp3buf.length > 0) mp3Chunks.push(Buffer.from(mp3buf))
            }
        } else {
            // Stereo: deinterleave into L/R channels for lamejs
            const samplesPerChannel = Math.floor(samples.length / channels)
            const left = new Int16Array(samplesPerChannel)
            const right = new Int16Array(samplesPerChannel)
            for (let i = 0; i < samplesPerChannel; i++) {
                left[i] = samples[i * 2]
                right[i] = samples[i * 2 + 1]
            }
            for (let i = 0; i < samplesPerChannel; i += blockSize) {
                const mp3buf = encoder.encodeBuffer(
                    left.subarray(i, i + blockSize),
                    right.subarray(i, i + blockSize),
                )
                if (mp3buf.length > 0) mp3Chunks.push(Buffer.from(mp3buf))
            }
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

// Re-export shared map under the legacy name so existing code keeps working
const LANGUAGE_MAP = SARVAM_TO_BCP47

const DEFAULT_LANGUAGE = 'en-IN'

// ---------------------------------------------------------------------------
// Multilingual Call Script Templates
// ---------------------------------------------------------------------------

type ScriptFn = (ownerName: string, task: string) => string

const ACCEPTANCE_TEMPLATES: Record<string, ScriptFn> = {
    'hi-IN': (o, t) => `नमस्ते! आपको एक नया काम दिया है, ${o} ने। काम है: ${t}। कृपया इसे WhatsApp पर स्वीकार करें।`,
    'gu-IN': (o, t) => `નમસ્તે! ${o} એ તમને એક નવું કામ સોંપ્યું છે. કામ છે: ${t}. WhatsApp પર સ્વીકારો.`,
    'mr-IN': (o, t) => `नमस्ते! ${o} यांनी तुम्हाला नवीन काम दिले. काम: ${t}. WhatsApp वर स्वीकार करा.`,
    'pa-IN': (o, t) => `ਸਤ ਸ੍ਰੀ ਅਕਾਲ! ${o} ਨੇ ਤੁਹਾਨੂੰ ਕੰਮ ਦਿੱਤਾ। ਕੰਮ: ${t}। WhatsApp ਤੇ ਸਵੀਕਾਰ ਕਰੋ।`,
    'bn-IN': (o, t) => `নমস্কার! ${o} আপনাকে কাজ দিয়েছেন। কাজ: ${t}। WhatsApp-এ গ্রহণ করুন।`,
    'ta-IN': (o, t) => `வணக்கம்! ${o} உங்களுக்கு வேலை ஒதுக்கியுள்ளார். வேலை: ${t}. WhatsApp-ல் ஏற்றுக்கொள்ளுங்கள்.`,
    'te-IN': (o, t) => `నమస్కారం! ${o} మీకు పని ఇచ్చారు. పని: ${t}. WhatsApp లో అంగీకరించండి.`,
    'kn-IN': (o, t) => `ನಮಸ್ಕಾರ! ${o} ನಿಮಗೆ ಕೆಲಸ ನಿಯೋಜಿಸಿದ್ದಾರೆ. ಕೆಲಸ: ${t}. WhatsApp ನಲ್ಲಿ ಸ್ವೀಕರಿಸಿ.`,
    'ml-IN': (o, t) => `നമസ്കാരം! ${o} നിങ്ങൾക്ക് ജോലി ഏൽപ്പിച്ചു. ജോലി: ${t}. WhatsApp-ൽ സ്വീകരിക്കുക.`,
    'en-IN': (o, t) => `Hello! ${o} has assigned you a task: ${t}. Please accept it on WhatsApp.`,
}

const REMINDER_TEMPLATES: Record<string, ScriptFn> = {
    'hi-IN': (o, t) => `नमस्ते! यह आपके काम का रिमाइंडर है, ${o} की तरफ से। काम है: ${t}। WhatsApp पर जाएं और बताएं कि काम चल रहा है, या डेडलाइन बदल सकते हैं। धन्यवाद।`,
    'gu-IN': (o, t) => `નમસ્તે! ${o} ના કામ માટે આ રિમાઇન્ડર છે. કામ: ${t}. WhatsApp પર જઈ અપડેટ આપો. આભાર.`,
    'mr-IN': (o, t) => `नमस्ते! ${o} यांच्या कामाची आठवण. काम: ${t}. WhatsApp वर जाऊन अपडेट करा. धन्यवाद.`,
    'pa-IN': (o, t) => `ਸਤ ਸ੍ਰੀ ਅਕਾਲ! ${o} ਦੇ ਕੰਮ ਦੀ ਯਾਦ। ਕੰਮ: ${t}। WhatsApp ਤੇ ਜਾ ਕੇ ਅਪਡੇਟ ਕਰੋ। ਧੰਨਵਾਦ।`,
    'bn-IN': (o, t) => `নমস্কার! ${o}-এর কাজের রিমাইন্ডার। কাজ: ${t}। WhatsApp-এ গিয়ে আপডেট করুন। ধন্যবাদ।`,
    'ta-IN': (o, t) => `வணக்கம்! ${o}-இன் வேலைக்கான நினைவூட்டல். வேலை: ${t}. WhatsApp-ல் சென்று புதுப்பிக்கவும். நன்றி.`,
    'te-IN': (o, t) => `నమస్కారం! ${o} పని గుర్తుచేయడం. పని: ${t}. WhatsApp కి వెళ్ళి అప్‌డేట్ చేయండి. ధన్యవాదాలు.`,
    'kn-IN': (o, t) => `ನಮಸ್ಕಾರ! ${o} ರ ಕೆಲಸದ ನೆನಪು. ಕೆಲಸ: ${t}. WhatsApp ಗೆ ಹೋಗಿ ಅಪ್‌ಡೇಟ್ ಮಾಡಿ. ಧನ್ಯವಾದ.`,
    'ml-IN': (o, t) => `നമസ്കാരം! ${o}-ന്റെ ജോലി ഓർമ്മ. ജോലി: ${t}. WhatsApp-ൽ പോയി അപ്‌ഡേറ്റ് ചെയ്യൂ. നന്ദി.`,
    'en-IN': (o, t) => `Hello! This is a reminder for your task from ${o}: ${t}. Please update on WhatsApp. Thank you.`,
}

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
 * Split text into chunks at sentence boundaries, respecting a max character limit.
 * Sarvam API has a per-request text limit (~500 chars). For long messages (500+ words),
 * we split into chunks and concatenate the resulting WAV audio.
 */
const SARVAM_CHUNK_LIMIT = 500

function splitTextIntoChunks(text: string, maxChars: number = SARVAM_CHUNK_LIMIT): string[] {
    if (text.length <= maxChars) return [text]

    const chunks: string[] = []
    let remaining = text

    while (remaining.length > 0) {
        if (remaining.length <= maxChars) {
            chunks.push(remaining)
            break
        }
        // Find the last sentence boundary (।, ., !, ?) within the limit
        let splitAt = -1
        for (let i = maxChars - 1; i >= maxChars / 2; i--) {
            if ('।.?!'.includes(remaining[i])) {
                splitAt = i + 1
                break
            }
        }
        // Fallback: split at last space within limit
        if (splitAt === -1) {
            splitAt = remaining.lastIndexOf(' ', maxChars)
            if (splitAt <= 0) splitAt = maxChars // Hard split as last resort
        }
        chunks.push(remaining.substring(0, splitAt).trim())
        remaining = remaining.substring(splitAt).trim()
    }

    return chunks.filter(c => c.length > 0)
}

/**
 * Concatenate multiple WAV buffers (same format) into one.
 * Copies the first WAV's header and appends all PCM data sections.
 */
function concatenateWavBuffers(buffers: Buffer[]): Buffer {
    if (buffers.length === 1) return buffers[0]

    // Collect PCM data from each WAV (skip headers)
    const pcmParts: Buffer[] = []
    const headerBuf = buffers[0].subarray(0, 44) // Use first WAV's header as template

    for (const wav of buffers) {
        const dataOffset = findWavDataOffset(wav)
        pcmParts.push(wav.subarray(dataOffset))
    }

    const totalPcmSize = pcmParts.reduce((sum, p) => sum + p.length, 0)

    // Build new WAV: header + all PCM data
    const header = Buffer.from(headerBuf)
    // Update RIFF chunk size (file size - 8)
    header.writeUInt32LE(36 + totalPcmSize, 4)
    // Update data chunk size
    header.writeUInt32LE(totalPcmSize, 40)

    return Buffer.concat([header, ...pcmParts])
}

/**
 * Call Sarvam TTS API for a single text chunk.
 */
async function callSarvamChunk(
    text: string,
    language: string,
    apiKey: string,
): Promise<string | null> {
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
    return data?.audios?.[0] || null
}

/**
 * Generate speech audio from text using Sarvam Bulbul v3.
 * Automatically chunks long text (>500 chars) and concatenates the audio.
 * Returns a base64-encoded WAV audio string.
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
        const chunks = splitTextIntoChunks(text)

        if (chunks.length === 1) {
            // Single chunk — simple path
            const audioBase64 = await callSarvamChunk(chunks[0], language, apiKey)
            if (!audioBase64) {
                console.error('[CallingService] Sarvam TTS returned no audio')
                return null
            }
            return { audioBase64, mimeType: 'audio/wav' }
        }

        // Multiple chunks — generate each, concatenate WAV buffers
        console.warn(`[CallingService] Long text (${text.length} chars) → ${chunks.length} TTS chunks`)
        const wavBuffers: Buffer[] = []
        for (const chunk of chunks) {
            const audioBase64 = await callSarvamChunk(chunk, language, apiKey)
            if (!audioBase64) {
                console.error(`[CallingService] Sarvam TTS chunk failed: "${chunk.substring(0, 50)}..."`)
                return null
            }
            wavBuffers.push(Buffer.from(audioBase64, 'base64'))
        }

        const combined = concatenateWavBuffers(wavBuffers)
        return { audioBase64: combined.toString('base64'), mimeType: 'audio/wav' }
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

            const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://boldoai.in'
            if (audioUrl) {
                // Use inline TwiML with pre-generated Supabase audio URL
                // This eliminates the webhook roundtrip entirely = 0 latency
                const twiml = `<Response><Play>${audioUrl}</Play></Response>`
                formParams.append('Twiml', twiml)
                console.log(`[CallingService] Using inline TwiML with audio: ${audioUrl}`)
            } else {
                // Fallback: use webhook to generate TTS on-the-fly
                const answerUrl = `${baseUrl}/api/internal/twilio-answer?text=${encodeURIComponent(text)}&language=${encodeURIComponent(language)}`
                formParams.append('Url', answerUrl)
            }
            formParams.append('StatusCallback', `${baseUrl}/api/internal/twilio-status`)
            formParams.append('StatusCallbackEvent', 'completed')

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
            console.warn(`[CallingService] Audio stored: ${mimeType}, ${audioBuffer.length} bytes, id=${audioId}`)
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
    language: string = 'hi-IN',
): string {
    const trimmedTask = taskSummary.length > 500
        ? taskSummary.substring(0, 500).trim() + '...'
        : taskSummary
    const fn = ACCEPTANCE_TEMPLATES[language] ?? ACCEPTANCE_TEMPLATES['hi-IN']
    return fn(ownerName, trimmedTask)
}

export function buildReminderCallScript(
    taskTitle: string,
    ownerName: string,
    language: string = 'hi-IN',
): string {
    const trimmedTask = taskTitle.length > 500
        ? taskTitle.substring(0, 500).trim() + '...'
        : taskTitle
    const fn = REMINDER_TEMPLATES[language] ?? REMINDER_TEMPLATES['hi-IN']
    return fn(ownerName, trimmedTask)
}
