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
    makeCall(phone: string, text: string, language: string): Promise<CallResult>
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
                speaker: 'anushka',
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
// Exotel Provider
// ---------------------------------------------------------------------------

const exotelProvider: CallingProvider = {
    name: 'exotel',

    async makeCall(phone: string, text: string, language: string): Promise<CallResult> {
        const apiKey = process.env.EXOTEL_API_KEY
        const apiToken = process.env.EXOTEL_API_TOKEN
        const accountSid = process.env.EXOTEL_ACCOUNT_SID || apiKey // Many times account SID is the API key, or separate
        const callerId = process.env.EXOTEL_CALLER_ID

        if (!apiKey || !apiToken || !accountSid || !callerId) {
            console.error('[CallingService] Missing Exotel credentials (EXOTEL_API_KEY, EXOTEL_API_TOKEN, EXOTEL_CALLER_ID)')
            return { success: false, status: 'error', error: 'Missing Exotel configuration' }
        }

        // Exotel typically prefers numbers without the leading + (e.g., 919876543210)
        // or with no formatting. But we'll strip the leading + just to be safe.
        const to = phone.startsWith('+') ? phone.slice(1) : phone
        const from = callerId.startsWith('+') ? callerId.slice(1) : callerId

        // Build the answer_url pointing to our Exotel answer endpoint, passing text and language
        const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://boldoai.in'
        const answerUrl = `${baseUrl}/api/internal/exotel-answer?text=${encodeURIComponent(text)}&language=${encodeURIComponent(language)}`

        const subdomain = process.env.EXOTEL_SUBDOMAIN || 'api.exotel.com'
        const apiUrl = `https://${subdomain}/v1/Accounts/${accountSid}/Calls/connect.json`

        try {
            // Exotel uses x-www-form-urlencoded rather than JSON for its payloads
            const formParams = new URLSearchParams()
            formParams.append('From', to) // The customer's number
            formParams.append('CallerId', from) // Your assigned ExoPhone
            formParams.append('Url', answerUrl) // Webhook for ExoML

            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Authorization': `Basic ${Buffer.from(`${apiKey}:${apiToken}`).toString('base64')}`,
                },
                body: formParams,
            })

            if (!response.ok) {
                const errorBody = await response.text()
                console.error(`[CallingService] Exotel call failed (${response.status}):`, errorBody)
                return { success: false, status: 'error', error: `Exotel ${response.status}: ${errorBody}` }
            }

            const data = await response.json()
            console.log(`[CallingService] Exotel call initiated:`, data)

            return {
                success: true,
                callId: data?.Call?.Sid || '',
                status: 'connected', // Will be updated by callback
            }
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : 'Unknown error'
            console.error('[CallingService] Exotel call error:', errMsg)
            return { success: false, status: 'error', error: errMsg }
        }
    },
}

// ---------------------------------------------------------------------------
// Active Provider Selection
// ---------------------------------------------------------------------------

/**
 * Get the currently configured calling provider.
 * Defaults to Exotel.
 */
function getProvider(): CallingProvider {
    return exotelProvider
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

    // Step 1: Make the call via the provider, which will use the webhook to generate TTS
    const provider = getProvider()
    const result = await provider.makeCall(phone, message, language)

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
