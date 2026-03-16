/**
 * Message Analyzer — Single-call Gemini pipeline.
 *
 * Replaces the 2-stage pipeline (intent-classifier + action-extractor)
 * with a single Gemini call that extracts WHO, WHAT, WHEN and classifies
 * intent in one pass.
 */

import { callGemini } from '@/lib/gemini'
import { getUnifiedAnalysisPrompt } from './system-prompts'
import type { AnalyzedMessage, WhatsAppIntent } from './types'

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Analyze a user message with a single Gemini call.
 * Returns structured who/what/when + intent classification.
 */
export async function analyzeMessage(
    userText: string,
    senderName: string,
): Promise<AnalyzedMessage> {
    const systemPrompt = getUnifiedAnalysisPrompt(senderName)

    console.log(`[MessageAnalyzer] Analyzing: "${userText.substring(0, 100)}"`)

    let rawResponse: string
    try {
        rawResponse = await callGemini(systemPrompt, userText)
    } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown Gemini error'
        console.error(`[MessageAnalyzer] Gemini call failed: ${errMsg}`)
        return createFallback(userText, `Gemini error: ${errMsg}`)
    }

    // Parse the JSON response
    try {
        const cleaned = rawResponse
            .replace(/```json\s*/gi, '')
            .replace(/```\s*/gi, '')
            .trim()

        const parsed = JSON.parse(cleaned)

        // Validate required fields
        const intent = validateIntent(parsed.intent)
        const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0

        const result: AnalyzedMessage = {
            who: {
                type: validateWhoType(parsed.who?.type),
                name: parsed.who?.name || null,
            },
            what: parsed.what || userText,
            when: {
                date: parsed.when?.date || null,
                raw: parsed.when?.raw || null,
            },
            intent,
            confidence,
            reasoning: parsed.reasoning || '',
        }

        console.log(`[MessageAnalyzer] Result: intent=${result.intent} conf=${result.confidence.toFixed(2)} who=${result.who.type}/${result.who.name} when=${result.when.date || 'none'}`)

        // Apply confidence threshold — below 0.9 → unknown
        if (result.confidence < 0.9 && result.intent !== 'unknown') {
            console.log(`[MessageAnalyzer] Confidence ${result.confidence} < 0.9 threshold, falling back to unknown`)
            result.intent = 'unknown'
        }

        return result
    } catch {
        console.error(`[MessageAnalyzer] Failed to parse Gemini response: ${rawResponse.substring(0, 300)}`)
        return createFallback(userText, 'JSON parse failure')
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_INTENTS: Set<string> = new Set([
    'task_create',
    'todo_create',
    'vendor_add',
    'ticket_create',
    'review_request',
    'send_dashboard_link',
    'unknown',
])

function validateIntent(raw: unknown): WhatsAppIntent {
    if (typeof raw === 'string' && VALID_INTENTS.has(raw)) {
        return raw as WhatsAppIntent
    }
    return 'unknown'
}

const VALID_WHO_TYPES: Set<string> = new Set(['self', 'person', 'agent'])

function validateWhoType(raw: unknown): 'self' | 'person' | 'agent' {
    if (typeof raw === 'string' && VALID_WHO_TYPES.has(raw)) {
        return raw as 'self' | 'person' | 'agent'
    }
    return 'agent'
}

function createFallback(userText: string, reason: string): AnalyzedMessage {
    return {
        who: { type: 'agent', name: null },
        what: userText,
        when: { date: null, raw: null },
        intent: 'unknown',
        confidence: 0,
        reasoning: `Fallback: ${reason}`,
    }
}
