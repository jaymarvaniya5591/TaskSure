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
// Twilio Provider
// ---------------------------------------------------------------------------

const twilioProvider: CallingProvider = {
    name: 'twilio',

    async makeCall(phone: string, text: string, language: string): Promise<CallResult> {
        const accountSid = process.env.TWILIO_ACCOUNT_SID
        const authToken = process.env.TWILIO_AUTH_TOKEN
        const callerId = process.env.TWILIO_PHONE_NUMBER

        if (!accountSid || !authToken || !callerId) {
            console.error('[CallingService] Missing Twilio credentials')
            return { success: false, status: 'error', error: 'Missing Twilio configuration (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER)' }
        }

        const to = phone.startsWith('+') ? phone : `+${phone}`
        const from = callerId.startsWith('+') ? callerId : `+${callerId}`

        const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://boldoai.in'
        const answerUrl = `${baseUrl}/api/internal/twilio-answer?text=${encodeURIComponent(text)}&language=${encodeURIComponent(language)}`

        const apiUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`

        try {
            const formParams = new URLSearchParams()
            formParams.append('To', to)
            formParams.append('From', from)
            formParams.append('Url', answerUrl)

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

    async makeCall(phone: string, text: string, language: string): Promise<CallResult> {
        const authId = process.env.PLIVO_AUTH_ID
        const authToken = process.env.PLIVO_AUTH_TOKEN
        const callerId = process.env.PLIVO_PHONE_NUMBER

        if (!authId || !authToken || !callerId) {
            console.error('[CallingService] Missing Plivo credentials')
            return { success: false, status: 'error', error: 'Missing Plivo configuration' }
        }

        const to = phone.startsWith('+') ? phone : `+${phone}`

        const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://boldoai.in'
        const answerUrl = `${baseUrl}/api/internal/plivo-answer?text=${encodeURIComponent(text)}&language=${encodeURIComponent(language)}`

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
    language: string = DEFAULT_LANGUAGE,
): Promise<CallResult> {
    console.log(`[CallingService] Making automated call to ${phone} in ${language}`)

    const provider = getProvider()
    const result = await provider.makeCall(phone, message, language)

    console.log(`[CallingService] Call result for ${phone}:`, result)
    return result
}

export function buildAcceptanceCallScript(
    ownerName: string,
    taskSummary: string,
): string {
    const trimmedTask = taskSummary.length > 50
        ? taskSummary.substring(0, 50).trim() + '...'
        : taskSummary
    return `Hi! This call is regarding a task given to you by ${ownerName}. Please look into it. They asked you to: ${trimmedTask}. We have sent you the task on WhatsApp as well. Please accept it.`
}

export function buildReminderCallScript(
    taskTitle: string,
    ownerName: string,
): string {
    const trimmedTask = taskTitle.length > 40
        ? taskTitle.substring(0, 40).trim() + '...'
        : taskTitle
    return `Hi! Quick check on your task: ${trimmedTask}. Is everything on track? Please let ${ownerName} know if there are any issues.`
}
