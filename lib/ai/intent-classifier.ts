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
        return parseClassification(raw)
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        console.error('[IntentClassifier] Gemini call failed:', msg)
        return { ...UNKNOWN_FALLBACK, reasoning: `Gemini error: ${msg}` }
    }
}

// ---------------------------------------------------------------------------
// Internal parser
// ---------------------------------------------------------------------------

function parseClassification(raw: string): ClassifiedIntent {
    try {
        const parsed = JSON.parse(raw)

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

        return { intent: intent as IntentType, confidence, reasoning }
    } catch {
        console.error('[IntentClassifier] Failed to parse Gemini JSON:', raw.substring(0, 300))
        return { ...UNKNOWN_FALLBACK, reasoning: 'Invalid JSON from Gemini.' }
    }
}
