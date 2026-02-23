/**
 * Gemini 2.5 Flash API helper.
 * Calls Google's Generative Language REST API via fetch — no SDK required.
 * Server-side only — never import on the client.
 */

const GEMINI_MODEL = 'gemini-2.5-flash'
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

interface GeminiResponse {
    candidates?: Array<{
        content?: {
            parts?: Array<{ text?: string }>
        }
    }>
    error?: {
        code: number
        message: string
        status: string
    }
}

/**
 * Call Gemini 2.5 Flash with a system instruction and user text.
 * Returns the raw text response from the model.
 * Throws on network or API errors.
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

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
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
        }),
    })

    if (!response.ok) {
        const errorBody = await response.text()
        throw new Error(`Gemini API error (${response.status}): ${errorBody}`)
    }

    const data: GeminiResponse = await response.json()

    if (data.error) {
        throw new Error(`Gemini API error: ${data.error.message}`)
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) {
        throw new Error('Empty response from Gemini')
    }

    return text
}
