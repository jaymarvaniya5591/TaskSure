/**
 * AI Layer — Stage 2: Action Extractor.
 *
 * Given a classified intent and the user's message, calls Gemini
 * with the intent-specific prompt to extract structured action data.
 *
 * For lightweight intents (auth_signin, help_navigation, unknown)
 * no second Gemini call is needed — we return immediately.
 */

import { callGemini } from '@/lib/gemini'
import { getActionExtractionPrompt } from './system-prompts'
import type { IntentType, ExtractedAction } from './types'

/**
 * Extract structured action data from a user message based on
 * the already-classified intent.
 *
 * @param intent  — the classified intent from Stage 1
 * @param userText — original user message
 * @returns ExtractedAction — a discriminated union keyed by `intent`
 */
export async function extractAction(
    intent: IntentType,
    userText: string,
): Promise<ExtractedAction> {
    // ── Intents that don't need a second Gemini call ──────────────

    if (intent === 'auth_signin') {
        return {
            intent: 'auth_signin',
        }
    }

    if (intent === 'help_navigation') {
        return {
            intent: 'help_navigation',
            question: userText,
        }
    }

    if (intent === 'unknown') {
        return {
            intent: 'unknown',
        }
    }

    // ── All other intents — call Gemini Stage 2 ───────────────────

    const prompt = getActionExtractionPrompt(intent)
    if (!prompt) {
        // Safety fallback — should never happen if prompts map is complete
        console.error(`[ActionExtractor] No prompt found for intent: ${intent}`)
        return {
            intent: 'unknown',
        }
    }

    try {
        const raw = await callGemini(prompt, userText)
        console.log(`[ActionExtractor] Raw Gemini response for "${intent}" (${raw.length} chars): ${raw.substring(0, 300)}`)
        return parseExtractedAction(intent, raw)
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        console.error(`[ActionExtractor] Gemini call THREW for intent="${intent}". Error: ${msg}`)
        console.error(`[ActionExtractor] User text was: "${userText.substring(0, 200)}"`)
        return {
            intent: 'unknown',
            _extractionError: msg, // Attach error info for pipeline to use
        } as ExtractedAction & { _extractionError?: string }
    }
}

// ---------------------------------------------------------------------------
// Internal parser — validates required fields per intent
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

    // 4. Nothing worked — return as-is (will fail JSON.parse with a clear error)
    return cleaned
}

function parseExtractedAction(intent: IntentType, raw: string): ExtractedAction {
    try {
        const cleanedRaw = extractJSON(raw)
        console.log(`[ActionExtractor] Cleaned JSON for "${intent}" (${cleanedRaw.length} chars): ${cleanedRaw.substring(0, 200)}`)

        const p = JSON.parse(cleanedRaw)

        switch (intent) {
            case 'task_create':
                return {
                    intent: 'task_create',
                    title: expectString(p.title, 'Untitled task'),
                    description: p.description ?? null,
                    assignee_name: p.assignee_name ?? null,
                    deadline: p.deadline ?? null,
                    who_type: ['person', 'bot', 'self', 'unknown'].includes(p.who_type)
                        ? p.who_type
                        : (p.assignee_name ? 'person' : 'unknown'),
                    when_type: ['formal', 'informal', 'none'].includes(p.when_type)
                        ? p.when_type
                        : (p.deadline ? 'formal' : 'none'),
                }

            case 'todo_create':
                return {
                    intent: 'todo_create',
                    title: expectString(p.title, 'Untitled to-do'),
                    description: p.description ?? null,
                    deadline: p.deadline ?? null,
                    when_type: ['formal', 'informal', 'none'].includes(p.when_type)
                        ? p.when_type
                        : (p.deadline ? 'formal' : 'none'),
                }

            case 'task_accept':
                return {
                    intent: 'task_accept',
                    committed_deadline: p.committed_deadline ?? null,
                }

            case 'task_reject':
                return {
                    intent: 'task_reject',
                    reason: p.reason ?? null,
                }

            case 'task_complete':
                return {
                    intent: 'task_complete',
                    task_hint: expectString(p.task_hint, ''),
                }

            case 'task_delete':
                return {
                    intent: 'task_delete',
                    task_hint: expectString(p.task_hint, ''),
                }

            case 'task_edit_deadline':
                return {
                    intent: 'task_edit_deadline',
                    task_hint: expectString(p.task_hint, ''),
                    new_deadline: p.new_deadline ?? null,
                }

            case 'task_edit_assignee':
                return {
                    intent: 'task_edit_assignee',
                    task_hint: expectString(p.task_hint, ''),
                    new_assignee_name: expectString(p.new_assignee_name, ''),
                }

            case 'task_create_subtask':
                return {
                    intent: 'task_create_subtask',
                    parent_task_hint: expectString(p.parent_task_hint, ''),
                    title: expectString(p.title, 'Untitled subtask'),
                    description: p.description ?? null,
                    assignee_name: p.assignee_name ?? null,
                    deadline: p.deadline ?? null,
                }

            case 'reminder_create':
                return {
                    intent: 'reminder_create',
                    subject: expectString(p.subject, ''),
                    remind_at: p.remind_at ?? null,
                    when_type: ['formal', 'informal', 'none'].includes(p.when_type)
                        ? p.when_type
                        : (p.remind_at ? 'formal' : 'none'),
                }

            case 'scheduled_message':
                return {
                    intent: 'scheduled_message',
                    recipient_name: expectString(p.recipient_name, ''),
                    message_content: expectString(p.message_content, ''),
                    send_at: p.send_at ?? null,
                }

            case 'status_query':
                return {
                    intent: 'status_query',
                    query_type: ['my_tasks', 'pending', 'overdue', 'general'].includes(p.query_type)
                        ? p.query_type
                        : 'general',
                }

            default:
                return {
                    intent: 'unknown',
                }
        }
    } catch (parseErr) {
        const errMsg = parseErr instanceof Error ? parseErr.message : 'Unknown parse error'
        console.error(`[ActionExtractor] JSON parse FAILED for intent="${intent}". Parse error: ${errMsg}`)
        console.error(`[ActionExtractor] Raw input (first 500 chars): ${raw.substring(0, 500)}`)
        return {
            intent: 'unknown',
        }
    }
}

// ---------------------------------------------------------------------------
// Tiny helper
// ---------------------------------------------------------------------------

function expectString(value: unknown, fallback: string): string {
    return typeof value === 'string' && value.trim() ? value.trim() : fallback
}
