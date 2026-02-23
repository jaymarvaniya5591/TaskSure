/**
 * Auth link generation and verification utilities.
 * Generates secure tokens stored in auth_tokens table for WhatsApp-based auth.
 * Tokens expire after 15 minutes and can only be consumed once.
 *
 * Server-side only — never import on the client.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { normalizePhone } from '@/lib/phone'
import crypto from 'crypto'

// ─── Configuration ──────────────────────────────────────────────────────────

const TOKEN_EXPIRY_MINUTES = 15

// ─── Helpers ────────────────────────────────────────────────────────────────

function generateSecureToken(): string {
    return crypto.randomUUID() + '-' + crypto.randomBytes(16).toString('hex')
}

// ─── Public API ─────────────────────────────────────────────────────────────

export type TokenType = 'signup' | 'signin'

interface GenerateTokenResult {
    success: boolean
    token?: string
    error?: string
}

interface VerifyTokenResult {
    valid: boolean
    phone?: string
    type?: TokenType
    error?: string
}

/**
 * Generate a token for signup or signin, store it in auth_tokens table.
 * Phone is normalized to 10 digits before storage.
 */
export async function generateAuthToken(
    phone: string,
    type: TokenType
): Promise<GenerateTokenResult> {
    const supabase = createAdminClient()
    const token = generateSecureToken()
    const normalizedPhone = normalizePhone(phone)
    const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_MINUTES * 60 * 1000).toISOString()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
        .from('auth_tokens')
        .insert({
            token,
            phone: normalizedPhone,
            type,
            expires_at: expiresAt,
        })

    if (error) {
        console.error('[AuthLinks] Failed to create token:', error.message)
        return { success: false, error: error.message }
    }

    return { success: true, token }
}

/**
 * Verify a token — checks it exists, hasn't expired, and hasn't been consumed.
 * Returns the phone number as 10 digits.
 */
export async function verifyAuthToken(token: string): Promise<VerifyTokenResult> {
    const supabase = createAdminClient()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
        .from('auth_tokens')
        .select('phone, type, expires_at, consumed')
        .eq('token', token)
        .single()

    if (error || !data) {
        return { valid: false, error: 'Token not found' }
    }

    if (data.consumed) {
        return { valid: false, error: 'Token already used' }
    }

    if (new Date(data.expires_at) < new Date()) {
        return { valid: false, error: 'Token expired' }
    }

    return {
        valid: true,
        phone: data.phone as string,
        type: data.type as TokenType,
    }
}

/**
 * Consume a token — marks it as used so it can't be reused.
 */
export async function consumeAuthToken(token: string): Promise<boolean> {
    const supabase = createAdminClient()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
        .from('auth_tokens')
        .update({ consumed: true })
        .eq('token', token)
        .eq('consumed', false)

    if (error) {
        console.error('[AuthLinks] Failed to consume token:', error.message)
        return false
    }

    return true
}

/**
 * Build the full URL for a signup or signin link.
 */
export function buildAuthUrl(token: string): string {
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://boldoai.in'
    return `${baseUrl}/api/auth/verify-link?token=${encodeURIComponent(token)}`
}
