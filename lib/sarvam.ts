/**
 * Sarvam AI — Saaras v3 Speech-to-Text helper.
 * Calls the Sarvam REST API to transcribe audio into text.
 * Uses `translate` mode to always output English — ideal for
 * structured extraction by Gemini downstream.
 * Server-side only — never import on the client.
 */

const SARVAM_API_URL = 'https://api.sarvam.ai/speech-to-text'
const SARVAM_MODEL = 'saaras:v3'

interface SarvamResponse {
    transcript?: string
    language_code?: string
    error?: {
        message?: string
        code?: string
    }
}

/**
 * Transcribe an audio buffer using Sarvam AI Saaras v3.
 *
 * @param audioBuffer  - Raw audio bytes (e.g. from WhatsApp media download)
 * @param mimeType     - MIME type of the audio (e.g. "audio/ogg; codecs=opus")
 * @returns The English translation / transcription text
 * @throws On network/API errors — callers should catch and send a fallback message
 */
export async function transcribeAudio(
    audioBuffer: Buffer,
    mimeType: string
): Promise<{ text: string, languageCode: string }> {
    const apiKey = process.env.SARVAM_API_KEY
    if (!apiKey) {
        throw new Error('Missing SARVAM_API_KEY environment variable')
    }

    // Determine file extension from MIME type for the filename hint
    const ext = mimeType.includes('ogg')
        ? 'ogg'
        : mimeType.includes('mp3') || mimeType.includes('mpeg')
            ? 'mp3'
            : mimeType.includes('mp4') || mimeType.includes('m4a')
                ? 'm4a'
                : mimeType.includes('wav')
                    ? 'wav'
                    : mimeType.includes('webm')
                        ? 'webm'
                        : 'ogg' // default — WhatsApp voice notes are always OGG

    // Clean the MIME type to remove parameters (e.g., "audio/ogg; codecs=opus" -> "audio/ogg")
    const cleanMimeType = mimeType.split(';')[0].trim()

    // Build multipart form data
    const formData = new FormData()
    const blob = new Blob([new Uint8Array(audioBuffer)], { type: cleanMimeType })
    formData.append('file', blob, `audio.${ext}`)
    formData.append('model', SARVAM_MODEL)
    formData.append('mode', 'transcribe')          // Output native text
    formData.append('language_code', 'unknown')    // Auto-detect spoken language

    console.log(`[Sarvam] Transcribing ${audioBuffer.length} bytes (${mimeType}) with model=${SARVAM_MODEL}, mode=transcribe`)
    const t0 = Date.now()

    const response = await fetch(SARVAM_API_URL, {
        method: 'POST',
        headers: {
            'api-subscription-key': apiKey,
        },
        body: formData,
    })

    if (!response.ok) {
        const errorBody = await response.text()
        throw new Error(`Sarvam API error (${response.status}): ${errorBody}`)
    }

    const data: SarvamResponse = await response.json()

    if (data.error) {
        throw new Error(`Sarvam API error: ${data.error.message || data.error.code || 'Unknown'}`)
    }

    const transcript = data.transcript?.trim()
    if (!transcript) {
        throw new Error('Empty transcript from Sarvam — audio may be silent or too noisy')
    }

    console.log(`[Sarvam] Transcription completed in ${Date.now() - t0}ms — language: ${data.language_code || 'hi-IN'}, length: ${transcript.length} chars`)

    return {
        text: transcript,
        languageCode: data.language_code || 'hi-IN'
    }
}

/**
 * Translate text using Sarvam AI Translation API.
 * Output is English by default.
 */
export async function translateText(
    text: string,
    sourceLanguageCode: string
): Promise<string> {
    const apiKey = process.env.SARVAM_API_KEY
    if (!apiKey) {
        throw new Error('Missing SARVAM_API_KEY environment variable')
    }

    const payload = {
        input: text,
        source_language_code: sourceLanguageCode,
        target_language_code: 'en-IN',
        speaker_gender: 'Male',
        mode: 'formal',
        model: 'sarvam-translate:v1'
    }

    console.log(`[Sarvam] Translating text of length: ${text.length} chars`)
    const t0 = Date.now()

    const response = await fetch('https://api.sarvam.ai/translate', {
        method: 'POST',
        headers: {
            'api-subscription-key': apiKey,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    })

    if (!response.ok) {
        const errorBody = await response.text()
        throw new Error(`Sarvam Translation API error (${response.status}): ${errorBody}`)
    }

    const data = await response.json()

    // We expect { translated_text: "..." }
    const translatedText = data.translated_text?.trim()
    if (!translatedText) {
        throw new Error('Empty translated text from Sarvam')
    }

    console.log(`[Sarvam] Translation completed in ${Date.now() - t0}ms`)
    return translatedText
}
