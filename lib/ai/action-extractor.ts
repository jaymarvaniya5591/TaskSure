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
            confirmation_message: 'Sure! Let me send you a sign-in link. 🔐',
        }
    }

    if (intent === 'help_navigation') {
        return {
            intent: 'help_navigation',
            question: userText,
            confirmation_message: '',  // will be filled by the navigation-help handler
        }
    }

    if (intent === 'unknown') {
        return {
            intent: 'unknown',
            confirmation_message:
                "I'm not sure I understood that. I can help you manage tasks — try saying something like \"Tell Ramesh to send the invoice\" or \"Show my pending tasks\". 😊",
        }
    }

    // ── All other intents — call Gemini Stage 2 ───────────────────

    const prompt = getActionExtractionPrompt(intent)
    if (!prompt) {
        // Safety fallback — should never happen if prompts map is complete
        console.error(`[ActionExtractor] No prompt found for intent: ${intent}`)
        return {
            intent: 'unknown',
            confirmation_message: 'Something went wrong. Please try again.',
        }
    }

    try {
        const raw = await callGemini(prompt, userText)
        return parseExtractedAction(intent, raw)
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        console.error(`[ActionExtractor] Gemini call failed for ${intent}:`, msg)
        return {
            intent: 'unknown',
            confirmation_message: 'Something went wrong while processing your request. Please try again.',
        }
    }
}

// ---------------------------------------------------------------------------
// Internal parser — validates required fields per intent
// ---------------------------------------------------------------------------

function parseExtractedAction(intent: IntentType, raw: string): ExtractedAction {
    try {
        const p = JSON.parse(raw)

        switch (intent) {
            case 'task_create':
                return {
                    intent: 'task_create',
                    title: expectString(p.title, 'Untitled task'),
                    description: p.description ?? null,
                    assignee_name: p.assignee_name ?? null,
                    deadline: p.deadline ?? null,
                    confirmation_message: expectString(p.confirmation_message, 'Task noted! ✅'),
                }

            case 'todo_create':
                return {
                    intent: 'todo_create',
                    title: expectString(p.title, 'Untitled to-do'),
                    description: p.description ?? null,
                    deadline: p.deadline ?? null,
                    confirmation_message: expectString(p.confirmation_message, 'To-do noted! ✅'),
                }

            case 'task_accept':
                return {
                    intent: 'task_accept',
                    committed_deadline: p.committed_deadline ?? null,
                    confirmation_message: expectString(p.confirmation_message, 'Task accepted! ✅'),
                }

            case 'task_reject':
                return {
                    intent: 'task_reject',
                    reason: p.reason ?? null,
                    confirmation_message: expectString(p.confirmation_message, 'Task rejected.'),
                }

            case 'task_complete':
                return {
                    intent: 'task_complete',
                    task_hint: expectString(p.task_hint, ''),
                    confirmation_message: expectString(p.confirmation_message, 'Marked as completed! 🎉'),
                }

            case 'task_delete':
                return {
                    intent: 'task_delete',
                    task_hint: expectString(p.task_hint, ''),
                    confirmation_message: expectString(p.confirmation_message, 'Task cancelled.'),
                }

            case 'task_edit_deadline':
                return {
                    intent: 'task_edit_deadline',
                    task_hint: expectString(p.task_hint, ''),
                    new_deadline: p.new_deadline ?? null,
                    confirmation_message: expectString(p.confirmation_message, 'Deadline updated! 📅'),
                }

            case 'task_edit_assignee':
                return {
                    intent: 'task_edit_assignee',
                    task_hint: expectString(p.task_hint, ''),
                    new_assignee_name: expectString(p.new_assignee_name, ''),
                    confirmation_message: expectString(p.confirmation_message, 'Assignee updated!'),
                }

            case 'task_create_subtask':
                return {
                    intent: 'task_create_subtask',
                    parent_task_hint: expectString(p.parent_task_hint, ''),
                    title: expectString(p.title, 'Untitled subtask'),
                    description: p.description ?? null,
                    assignee_name: p.assignee_name ?? null,
                    deadline: p.deadline ?? null,
                    confirmation_message: expectString(p.confirmation_message, 'Subtask created! ✅'),
                }

            case 'reminder_create':
                return {
                    intent: 'reminder_create',
                    subject: expectString(p.subject, ''),
                    remind_at: p.remind_at ?? null,
                    confirmation_message: expectString(p.confirmation_message, 'Reminder set! ⏰'),
                }

            case 'scheduled_message':
                return {
                    intent: 'scheduled_message',
                    recipient_name: expectString(p.recipient_name, ''),
                    message_content: expectString(p.message_content, ''),
                    send_at: p.send_at ?? null,
                    confirmation_message: expectString(p.confirmation_message, 'Message scheduled! 📨'),
                }

            case 'status_query':
                return {
                    intent: 'status_query',
                    query_type: ['my_tasks', 'pending', 'overdue', 'general'].includes(p.query_type)
                        ? p.query_type
                        : 'general',
                    confirmation_message: expectString(p.confirmation_message, 'Let me check...'),
                }

            default:
                return {
                    intent: 'unknown',
                    confirmation_message: 'Something went wrong. Please try again.',
                }
        }
    } catch {
        console.error(`[ActionExtractor] Failed to parse JSON for ${intent}:`, raw.substring(0, 300))
        return {
            intent: 'unknown',
            confirmation_message: "Sorry, I couldn't process that. Please try rephrasing.",
        }
    }
}

// ---------------------------------------------------------------------------
// Tiny helper
// ---------------------------------------------------------------------------

function expectString(value: unknown, fallback: string): string {
    return typeof value === 'string' && value.trim() ? value.trim() : fallback
}
