/**
 * Phone number normalization utility.
 *
 * ALL phone numbers entering the database must be 10 digits only.
 * This utility strips country codes, +, spaces, dashes, etc.
 *
 * Examples:
 *   "+919727731867"  → "9727731867"
 *   "919727731867"   → "9727731867"
 *   "9727731867"     → "9727731867"
 *   "+91 97277 31867" → "9727731867"
 *   "09727731867"    → "9727731867"
 */

/**
 * Normalize ANY phone number to its last 10 digits.
 * This is the ONLY function that should be used to clean phone numbers
 * before storing in DB or comparing against DB values.
 *
 * FAST: pure string operations, no async, no DB calls.
 */
export function normalizePhone(raw: string | null | undefined): string {
    if (!raw) return ''

    // Strip all non-digit characters
    const digits = raw.replace(/\D/g, '')

    // Take last 10 digits (handles +91, 91, 0 prefixes)
    if (digits.length >= 10) {
        return digits.slice(-10)
    }

    // If less than 10 digits, return as-is (invalid but don't crash)
    return digits
}

/**
 * Check if a normalized phone number looks valid (exactly 10 digits).
 */
export function isValidPhone(phone: string): boolean {
    return /^\d{10}$/.test(phone)
}

/**
 * Format a 10-digit phone number for display with +91 prefix.
 * Only for UI display — never store this format.
 */
export function formatPhoneDisplay(phone: string): string {
    const normalized = normalizePhone(phone)
    if (!normalized) return ''
    return `+91 ${normalized.slice(0, 5)} ${normalized.slice(5)}`
}
