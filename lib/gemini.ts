/**
 * Gemini 2.5 Flash API helper.
 * Calls Google's Generative Language REST API via fetch — no SDK required.
 * Server-side only — never import on the client.
 *
 * Includes:
 * - Comprehensive logging for debugging
 * - Retry logic for transient failures (429, 500, 502, 503)
 */

const GEMINI_MODEL = 'gemini-2.5-flash'
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

const MAX_RETRIES = 2
const RETRY_DELAY_MS = 1500
const RETRYABLE_STATUS_CODES = [429, 500, 502, 503]

interface GeminiResponse {
    candidates?: Array<{
        content?: {
            parts?: Array<{ text?: string }>
        }
        finishReason?: string
    }>
    error?: {
        code: number
        message: string
        status: string
    }
    promptFeedback?: {
        blockReason?: string
        safetyRatings?: Array<{
            category: string
            probability: string
        }>
    }
}

/**
 * Call Gemini 2.5 Flash with a system instruction and user text.
 * Returns the raw text response from the model.
 * Throws on network or API errors after retries are exhausted.
 */
export async function callGemini(
    systemInstruction: string,
    userText: string
): Promise<string> {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
        throw new Error('Missing GEMINI_API_KEY environment variable')
    }

    const url = `${GEMINI_API_BASE}/${GEMINI_MODEL}:generateContent?key=${apiKey}`

    const requestBody = {
        system_instruction: {
            parts: [{ text: systemInstruction }],
        },
        contents: [
            {
                role: 'user',
                parts: [{ text: userText }],
            },
        ],
        generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 1024,
            responseMimeType: 'application/json',
        },
    }

    let lastError: Error | null = null

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (attempt > 0) {
            const delayMs = RETRY_DELAY_MS * attempt // Linear backoff: 1500ms, 3000ms
            console.warn(`[Gemini] Retry attempt ${attempt}/${MAX_RETRIES} after ${delayMs}ms delay...`)
            await new Promise(resolve => setTimeout(resolve, delayMs))
        }

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody),
            })

            // ── Handle non-200 responses ───────────────────────────
            if (!response.ok) {
                const errorBody = await response.text()
                const errMsg = `Gemini API HTTP ${response.status}: ${errorBody.substring(0, 500)}`
                console.error(`[Gemini] ${errMsg}`)

                if (RETRYABLE_STATUS_CODES.includes(response.status)) {
                    lastError = new Error(errMsg)
                    console.warn(`[Gemini] Retryable status ${response.status}, will retry...`)
                    continue // Try again
                }

                // Non-retryable HTTP error (400, 401, 403, etc.)
                throw new Error(errMsg)
            }

            // ── Parse response JSON ────────────────────────────────
            const data: GeminiResponse = await response.json()

            // Check for API-level error
            if (data.error) {
                const errMsg = `Gemini API error (code=${data.error.code}): ${data.error.message}`
                console.error(`[Gemini] ${errMsg}`)
                throw new Error(errMsg)
            }

            // Check for blocked prompts
            if (data.promptFeedback?.blockReason) {
                const reason = data.promptFeedback.blockReason
                console.error(`[Gemini] Prompt blocked by safety filter: ${reason}`, JSON.stringify(data.promptFeedback.safetyRatings))
                throw new Error(`Gemini prompt blocked: ${reason}`)
            }

            // Check for empty/missing candidates
            const candidate = data.candidates?.[0]
            if (!candidate) {
                const errMsg = `Gemini returned no candidates. Full response: ${JSON.stringify(data).substring(0, 500)}`
                console.error(`[Gemini] ${errMsg}`)
                lastError = new Error(errMsg)
                continue // Retry — empty candidates can be transient
            }

            // Check for non-STOP finish reasons
            if (candidate.finishReason && candidate.finishReason !== 'STOP') {
                console.warn(`[Gemini] Non-STOP finishReason: "${candidate.finishReason}"`)
                if (candidate.finishReason === 'SAFETY') {
                    throw new Error(`Gemini response blocked by safety filter (finishReason=SAFETY)`)
                }
            }

            // Extract text
            const text = candidate.content?.parts?.[0]?.text
            if (!text) {
                const errMsg = `Gemini returned empty text. Candidate: ${JSON.stringify(candidate).substring(0, 500)}`
                console.error(`[Gemini] ${errMsg}`)
                lastError = new Error(errMsg)
                continue // Retry — empty text can be transient
            }

            console.log(`[Gemini] Success (attempt ${attempt + 1}). Response length: ${text.length} chars`)
            return text

        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Unknown fetch error'

            // If it's a network error (TypeError from fetch), retry
            if (err instanceof TypeError) {
                console.error(`[Gemini] Network error (attempt ${attempt + 1}): ${msg}`)
                lastError = err instanceof Error ? err : new Error(msg)
                continue
            }

            // For all other errors, re-throw immediately (non-retryable)
            throw err
        }
    }

    // All retries exhausted
    const finalMsg = `Gemini failed after ${MAX_RETRIES + 1} attempts. Last error: ${lastError?.message ?? 'unknown'}`
    console.error(`[Gemini] ${finalMsg}`)
    throw new Error(finalMsg)
}
