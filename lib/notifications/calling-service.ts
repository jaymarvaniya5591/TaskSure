/**
 * Calling Service — Pluggable telephony abstraction layer.
 *
 * Default provider: Plivo
 * Architecture: Provider-agnostic interface so the telephony backend
 * can be swapped (Plivo → Exotel → Twilio) without changing callers.
 *
 * Flow:
 *   1. Generate TTS audio via Sarvam Bulbul v3
 *   2. Make outbound call via configured telephony provider
 *   3. Return call status (connected, not_connected, error)
 *
 * Server-side only — never import on the client.
 */

import { createAdminClient } from '@/lib/supabase/admin'

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
    makeCall(phone: string, audioUrl: string): Promise<CallResult>
}

// ---------------------------------------------------------------------------
// Language Detection
// ---------------------------------------------------------------------------

// Map incoming_messages language_detected values to Sarvam TTS language codes
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
                model: 'bulbul:v2',
                speaker: 'meera',
                pitch: 0,
                pace: 1.1,
                loudness: 1.5,
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
// Plivo Provider (Default)
// ---------------------------------------------------------------------------

const plivoProvider: CallingProvider = {
    name: 'plivo',

    async makeCall(phone: string, audioUrl: string): Promise<CallResult> {
        const authId = process.env.PLIVO_AUTH_ID
        const authToken = process.env.PLIVO_AUTH_TOKEN
        const plivoPhone = process.env.PLIVO_PHONE_NUMBER

        if (!authId || !authToken || !plivoPhone) {
            console.error('[CallingService] Missing Plivo credentials (PLIVO_AUTH_ID, PLIVO_AUTH_TOKEN, PLIVO_PHONE_NUMBER)')
            return { success: false, status: 'error', error: 'Missing Plivo configuration' }
        }

        // Plivo expects E.164 format: +91XXXXXXXXXX
        const to = phone.startsWith('+') ? phone : `+${phone}`
        const from = plivoPhone.startsWith('+') ? plivoPhone : `+${plivoPhone}`

        // Build the answer_url pointing to our Plivo answer endpoint
        const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://boldoai.in'
        const answerUrl = `${baseUrl}/api/internal/plivo-answer?audio=${encodeURIComponent(audioUrl)}`

        const apiUrl = `https://api.plivo.com/v1/Account/${authId}/Call/`

        try {
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Basic ${Buffer.from(`${authId}:${authToken}`).toString('base64')}`,
                },
                body: JSON.stringify({
                    from: from,
                    to: to,
                    answer_url: answerUrl,
                    answer_method: 'GET',
                    ring_timeout: 30,
                    time_limit: 60,
                    machine_detection: 'true',
                }),
            })

            if (!response.ok) {
                const errorBody = await response.text()
                console.error(`[CallingService] Plivo call failed (${response.status}):`, errorBody)
                return { success: false, status: 'error', error: `Plivo ${response.status}: ${errorBody}` }
            }

            const data = await response.json()
            console.log(`[CallingService] Plivo call initiated:`, data)

            return {
                success: true,
                callId: data.request_uuid || data.api_id,
                status: 'connected', // Will be updated by callback
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
 * Defaults to Plivo. Change this to switch providers.
 */
function getProvider(): CallingProvider {
    // Future: read from env or config to switch providers
    // const providerName = process.env.CALLING_PROVIDER || 'plivo'
    return plivoProvider
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Make an automated call to a phone number with a spoken message.
 *
 * Flow:
 *   1. Generate TTS audio from the message text
 *   2. Make outbound call via the configured provider
 *
 * @param phone   - Phone number in international format (e.g. "919876543210")
 * @param message - Text to speak to the recipient
 * @param language - Language code for TTS (e.g. "hi-IN", "en-IN")
 */
export async function makeAutomatedCall(
    phone: string,
    message: string,
    language: string = DEFAULT_LANGUAGE,
): Promise<CallResult> {
    console.log(`[CallingService] Making automated call to ${phone} in ${language}`)

    // Step 1: Generate TTS audio
    const ttsResult = await generateTTS(message, language)
    if (!ttsResult) {
        return {
            success: false,
            status: 'error',
            error: 'Failed to generate TTS audio',
        }
    }

    // Step 2: We need a hosted URL for the audio. Store it temporarily.
    // For now, we use a data URI approach or a temporary upload.
    // TODO: Upload the audio to a temporary storage (e.g., Supabase Storage)
    // and get a public URL. For now, we'll use a placeholder approach.
    const audioUrl = `data:${ttsResult.mimeType};base64,${ttsResult.audioBase64}`

    // Step 3: Make the call via the provider
    const provider = getProvider()
    const result = await provider.makeCall(phone, audioUrl)

    console.log(`[CallingService] Call result for ${phone}:`, result)
    return result
}

/**
 * Build a concise call script for task acceptance followups.
 */
export function buildAcceptanceCallScript(
    ownerName: string,
    taskSummary: string,
): string {
    // Keep it under 15 words — extremely concise
    const trimmedTask = taskSummary.length > 50
        ? taskSummary.substring(0, 50).trim() + '...'
        : taskSummary
    return `Hi! You have a task from ${ownerName}. They asked you to: ${trimmedTask}. Please accept it.`
}

/**
 * Build a call script for Stage 2 reminder acknowledgment.
 */
export function buildReminderCallScript(
    taskTitle: string,
    ownerName: string,
): string {
    const trimmedTask = taskTitle.length > 40
        ? taskTitle.substring(0, 40).trim() + '...'
        : taskTitle
    return `Hi! Quick check on your task: ${trimmedTask}. Is everything on track? Please let ${ownerName} know if there are any issues.`
}
