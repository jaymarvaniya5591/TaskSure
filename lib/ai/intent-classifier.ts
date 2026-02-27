/**
 * AI Layer — Stage 1: Intent Classifier.
 *
 * Calls Gemini with the user's message and returns one of 15
 * intent categories along with a confidence score.
 */

import { callGemini } from '@/lib/gemini'
import { getIntentClassifierPrompt } from './system-prompts'
import type { ClassifiedIntent, IntentType } from './types'

// All valid intent strings — used for runtime validation
const VALID_INTENTS: ReadonlySet<string> = new Set<IntentType>([
    'task_create',
    'todo_create',
    'task_accept',
    'task_reject',
    'task_complete',
    'task_delete',
    'task_edit_deadline',
    'task_edit_assignee',
    'task_create_subtask',
    'reminder_create',
    'scheduled_message',
    'auth_signin',
    'help_navigation',
    'status_query',
    'unknown',
])

const UNKNOWN_FALLBACK: ClassifiedIntent = {
    intent: 'unknown',
    confidence: 0,
    reasoning: 'Could not classify the message.',
}

/**
 * Classify a user's message into one of 15 intent categories.
 *
 * @param userText — the plain-text message (already transcribed if audio)
 * @returns ClassifiedIntent with the best-matching intent, confidence, and reasoning
 */
export async function classifyIntent(userText: string): Promise<ClassifiedIntent> {
    if (!userText.trim()) {
        return { ...UNKNOWN_FALLBACK, reasoning: 'Empty message.' }
    }

    try {
        const raw = await callGemini(getIntentClassifierPrompt(), userText)
        console.log(`[IntentClassifier] Raw Gemini response (${raw.length} chars): ${raw.substring(0, 300)}`)
        return parseClassification(raw)
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        console.error(`[IntentClassifier] Gemini call THREW. Error: ${msg}`)
        console.error(`[IntentClassifier] User text was: "${userText.substring(0, 200)}"`)
        return { ...UNKNOWN_FALLBACK, reasoning: `Gemini error: ${msg}` }
    }
}

// ---------------------------------------------------------------------------
// Internal parser
// ---------------------------------------------------------------------------

/**
 * Cleans raw Gemini text output and extracts JSON content.
 * Handles: clean JSON, markdown-wrapped JSON, JSON embedded in prose.
 */
function extractJSON(raw: string): string {
    const cleaned = raw.trim()

    // 1. Check if it's already valid JSON
    try {
        JSON.parse(cleaned)
        return cleaned
    } catch {
        // Not clean JSON, try other methods
    }

    // 2. Try to find a JSON block inside markdown backticks
    const backtickMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
    if (backtickMatch && backtickMatch[1]) {
        return backtickMatch[1].trim()
    }

    // 3. Fallback: extract outermost { ... }
    const firstBrace = cleaned.indexOf('{')
    const lastBrace = cleaned.lastIndexOf('}')
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        return cleaned.substring(firstBrace, lastBrace + 1).trim()
    }

    // 4. Nothing worked — return as-is
    return cleaned
}

function parseClassification(raw: string): ClassifiedIntent {
    try {
        const cleanedRaw = extractJSON(raw)
        console.log(`[IntentClassifier] Cleaned JSON (${cleanedRaw.length} chars): ${cleanedRaw.substring(0, 200)}`)

        const parsed = JSON.parse(cleanedRaw)

        const intent = typeof parsed.intent === 'string' ? parsed.intent : 'unknown'
        const confidence = typeof parsed.confidence === 'number'
            ? Math.max(0, Math.min(1, parsed.confidence))
            : 0
        const reasoning = typeof parsed.reasoning === 'string'
            ? parsed.reasoning
            : ''

        // Validate intent is one of the known types
        if (!VALID_INTENTS.has(intent)) {
            console.warn(`[IntentClassifier] Unknown intent from Gemini: "${intent}", falling back to unknown`)
            return { ...UNKNOWN_FALLBACK, reasoning: `Unrecognised intent: ${intent}` }
        }

        // Low-confidence guard — treat as unknown
        if (confidence < 0.7) {
            console.log(`[IntentClassifier] Low confidence (${confidence}) for intent "${intent}": ${reasoning}`)
            return {
                intent: 'unknown',
                confidence,
                reasoning: `Low confidence (${confidence.toFixed(2)}): ${reasoning}`,
            }
        }

        console.log(`[IntentClassifier] Classified as "${intent}" (confidence: ${confidence.toFixed(2)}). Reasoning: ${reasoning}`)
        return { intent: intent as IntentType, confidence, reasoning }
    } catch (parseErr) {
        const errMsg = parseErr instanceof Error ? parseErr.message : 'Unknown parse error'
        console.error(`[IntentClassifier] JSON parse FAILED. Parse error: ${errMsg}`)
        console.error(`[IntentClassifier] Raw input (first 500 chars): ${raw.substring(0, 500)}`)
        return { ...UNKNOWN_FALLBACK, reasoning: 'Invalid JSON from Gemini.' }
    }
}
