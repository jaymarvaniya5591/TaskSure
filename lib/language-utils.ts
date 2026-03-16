/**
 * Shared language utilities for multi-language support.
 * Used by the message processor and calling service.
 */

/** Maps Sarvam language codes (ISO 639-1 + aliases) to BCP 47 tags */
export const SARVAM_TO_BCP47: Record<string, string> = {
    'hi': 'hi-IN', 'hindi': 'hi-IN',
    'gu': 'gu-IN', 'gujarati': 'gu-IN',
    'mr': 'mr-IN', 'marathi': 'mr-IN',
    'pa': 'pa-IN', 'punjabi': 'pa-IN',
    'bn': 'bn-IN', 'bengali': 'bn-IN',
    'ta': 'ta-IN', 'tamil': 'ta-IN',
    'te': 'te-IN', 'telugu': 'te-IN',
    'kn': 'kn-IN', 'kannada': 'kn-IN',
    'ml': 'ml-IN', 'malayalam': 'ml-IN',
    'en': 'en-IN', 'english': 'en-IN',
    'or': 'or-IN', 'odia': 'or-IN',
}

export const DEFAULT_LANGUAGE = 'hi-IN'

/**
 * Detect the language of a text string via Unicode script ranges.
 * Returns a BCP 47 code if a regional Indian script is detected,
 * or null for Latin / transliterated text (treat as English).
 *
 * Zero API calls — instant.
 */
export function detectTextLanguage(text: string): string | null {
    if (/[\u0A80-\u0AFF]/.test(text)) return 'gu-IN'   // Gujarati
    if (/[\u0900-\u097F]/.test(text)) return 'hi-IN'   // Devanagari (Hindi / Marathi)
    if (/[\u0B80-\u0BFF]/.test(text)) return 'ta-IN'   // Tamil
    if (/[\u0C00-\u0C7F]/.test(text)) return 'te-IN'   // Telugu
    if (/[\u0980-\u09FF]/.test(text)) return 'bn-IN'   // Bengali
    if (/[\u0C80-\u0CFF]/.test(text)) return 'kn-IN'   // Kannada
    if (/[\u0D00-\u0D7F]/.test(text)) return 'ml-IN'   // Malayalam
    if (/[\u0A00-\u0A7F]/.test(text)) return 'pa-IN'   // Gurmukhi (Punjabi)
    if (/[\u0B00-\u0B7F]/.test(text)) return 'or-IN'   // Odia
    return null // Latin / transliterated — treat as English
}
