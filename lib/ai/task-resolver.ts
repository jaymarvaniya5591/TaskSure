/**
 * AI Layer — Task Resolver (Phase 1.2).
 *
 * When a user says "mark the invoice task done", we need to figure out
 * WHICH task they mean.  This module:
 *   1. Receives the user's active tasks
 *   2. Sends the task list + user hint to Gemini
 *   3. Returns a single match, multiple matches (ambiguous), or no match
 */

import { callGemini } from '@/lib/gemini'
import type { Task } from '@/lib/types'
import { extractUserId } from '@/lib/task-service'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TaskResolverResult =
    | { status: 'resolved'; task: Task }
    | { status: 'ambiguous'; candidates: Task[]; clarificationMessage: string }
    | { status: 'not_found'; message: string }

// ---------------------------------------------------------------------------
// Compact task representation for Gemini (keep tokens low)
// ---------------------------------------------------------------------------

interface CompactTask {
    id: string
    title: string
    assignee: string
    owner: string
    status: string
    deadline: string | null
}

function toCompact(task: Task): CompactTask {
    const assigneeName =
        typeof task.assigned_to === 'object' && task.assigned_to
            ? task.assigned_to.name
            : 'Unknown'
    const ownerName =
        typeof task.created_by === 'object' && task.created_by
            ? task.created_by.name
            : 'Unknown'

    return {
        id: task.id,
        title: task.title,
        assignee: assigneeName,
        owner: ownerName,
        status: task.status,
        deadline: task.committed_deadline ?? task.deadline ?? null,
    }
}

// ---------------------------------------------------------------------------
// System prompt for task resolution
// ---------------------------------------------------------------------------

const RESOLVER_PROMPT = `You are a task-matching assistant for Boldo AI.

Given a list of tasks and a user hint, determine WHICH task the user is referring to.

OUTPUT FORMAT (valid JSON):
{
  "matched_task_ids": ["id1"],
  "confidence": 0.95,
  "reasoning": "short explanation"
}

RULES:
- If exactly ONE task clearly matches the hint, return its ID in matched_task_ids with high confidence.
- If MULTIPLE tasks could match, return ALL their IDs (max 5) with lower confidence.
- If NO task matches the hint, return an empty array.
- Match by title keywords, assignee name, description keywords, or any contextual clue.
- "my latest task" or "the last one" = the first task in the list (they are sorted by most recent first).
- Be generous with matching — partial keyword overlap is enough.`

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve a task from an ambiguous user hint.
 *
 * @param taskHint  — keywords extracted by Gemini (e.g. "invoice task")
 * @param userText  — original user message for extra context
 * @param userTasks — the user's active tasks (pre-fetched from DB)
 * @returns TaskResolverResult
 */
export async function resolveTask(
    taskHint: string,
    userText: string,
    userTasks: Task[],
): Promise<TaskResolverResult> {
    if (userTasks.length === 0) {
        return {
            status: 'not_found',
            message: "You don't have any active tasks right now.",
        }
    }

    // If only 1 task exists, auto-resolve — no need for Gemini
    if (userTasks.length === 1) {
        return { status: 'resolved', task: userTasks[0] }
    }

    // Build compact task list for Gemini
    const compactTasks = userTasks.map(toCompact)

    const userPrompt = `TASKS:\n${JSON.stringify(compactTasks, null, 2)}\n\nUSER HINT: "${taskHint}"\nORIGINAL MESSAGE: "${userText}"`

    try {
        const raw = await callGemini(RESOLVER_PROMPT, userPrompt)
        return parseResolverResponse(raw, userTasks)
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        console.error('[TaskResolver] Gemini call failed:', msg)

        // Fallback: try naive keyword matching
        return naiveKeywordMatch(taskHint, userTasks)
    }
}

/**
 * Resolve the most recent pending task for the user.
 * Used for task_accept / task_reject where no hint is needed.
 *
 * @param userId    — the acting user's ID
 * @param userTasks — all of the user's tasks
 * @returns The most recent pending task assigned to this user, or null
 */
export function findMostRecentPendingTask(
    userId: string,
    userTasks: Task[],
): Task | null {
    const pending = userTasks.filter((t) => {
        const assigneeId = extractUserId(t.assigned_to)
        return assigneeId === userId && t.status === 'pending' && !t.committed_deadline
    })

    if (pending.length === 0) return null

    // Sort by created_at descending (most recent first)
    pending.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

    return pending[0]
}

// ---------------------------------------------------------------------------
// Internal — parse Gemini response
// ---------------------------------------------------------------------------

function parseResolverResponse(raw: string, userTasks: Task[]): TaskResolverResult {
    try {
        const parsed = JSON.parse(raw)
        const matchedIds: string[] = Array.isArray(parsed.matched_task_ids)
            ? parsed.matched_task_ids
            : []

        if (matchedIds.length === 0) {
            return {
                status: 'not_found',
                message: "I couldn't find a task matching that description. Could you describe it more clearly?",
            }
        }

        // Map IDs back to full Task objects
        const matched = matchedIds
            .map((id) => userTasks.find((t) => t.id === id))
            .filter((t): t is Task => t !== undefined)

        if (matched.length === 0) {
            return {
                status: 'not_found',
                message: "I couldn't find a task matching that description. Could you describe it more clearly?",
            }
        }

        if (matched.length === 1) {
            return { status: 'resolved', task: matched[0] }
        }

        // Multiple matches — ask for clarification
        const taskList = matched
            .map((t, i) => `${i + 1}. "${t.title}"`)
            .join('\n')

        return {
            status: 'ambiguous',
            candidates: matched,
            clarificationMessage:
                `I found multiple tasks that could match:\n\n${taskList}\n\nWhich one did you mean? Please reply with the number or a clearer description.`,
        }
    } catch {
        console.error('[TaskResolver] Failed to parse Gemini JSON:', raw.substring(0, 300))
        return {
            status: 'not_found',
            message: "I couldn't identify the task. Could you describe it more clearly?",
        }
    }
}

// ---------------------------------------------------------------------------
// Fallback — naive keyword matching (no Gemini required)
// ---------------------------------------------------------------------------

function naiveKeywordMatch(hint: string, tasks: Task[]): TaskResolverResult {
    const keywords = hint.toLowerCase().split(/\s+/).filter((w) => w.length > 2)

    if (keywords.length === 0) {
        return {
            status: 'not_found',
            message: "I couldn't identify the task. Could you describe it more clearly?",
        }
    }

    const scored = tasks.map((task) => {
        const title = task.title.toLowerCase()
        const desc = (task.description ?? '').toLowerCase()
        const matchCount = keywords.filter((kw) => title.includes(kw) || desc.includes(kw)).length

        return { task, score: matchCount / keywords.length }
    })

    const matches = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score)

    if (matches.length === 0) {
        return {
            status: 'not_found',
            message: "I couldn't find a task matching that description. Could you describe it more clearly?",
        }
    }

    if (matches.length === 1 || matches[0].score > 0.6) {
        return { status: 'resolved', task: matches[0].task }
    }

    const topMatches = matches.slice(0, 5)
    const taskList = topMatches
        .map((m, i) => `${i + 1}. "${m.task.title}"`)
        .join('\n')

    return {
        status: 'ambiguous',
        candidates: topMatches.map((m) => m.task),
        clarificationMessage:
            `I found multiple tasks that could match:\n\n${taskList}\n\nWhich one did you mean?`,
    }
}
