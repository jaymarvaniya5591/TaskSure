/**
 * AI Layer — Action Rules (Permission Validation).
 *
 * Bridges the AI intent system with the existing `task-service.ts`
 * permission model.  Before executing any task-modifying intent,
 * this module checks whether the user is allowed to perform it.
 */

import { getAvailableActions } from '@/lib/task-service'
import type { Task } from '@/lib/types'
import type { IntentType, ActionValidationResult } from './types'

// ---------------------------------------------------------------------------
// Intent → task-service action type mapping
// ---------------------------------------------------------------------------

/**
 * Maps each task-modifying intent to the `TaskActionType` string
 * used by `getAvailableActions()` in task-service.ts.
 *
 * Intents not in this map (task_create, todo_create, reminder_create,
 * scheduled_message, auth_signin, help_navigation, status_query, unknown)
 * do NOT require task-level permission checks — they either create
 * new entities or are informational.
 */
const INTENT_TO_ACTION_TYPE: Partial<Record<IntentType, string>> = {
    task_accept: 'accept',
    task_reject: 'reject',
    task_complete: 'complete',
    task_delete: 'delete',
    task_edit_deadline: 'edit_deadline',
    task_edit_assignee: 'edit_persons',
    task_create_subtask: 'create_subtask',
}

// ---------------------------------------------------------------------------
// Friendly denial messages
// ---------------------------------------------------------------------------

const DENIAL_MESSAGES: Partial<Record<IntentType, string>> = {
    task_accept:
        'Sorry, you can only accept tasks that are assigned to you and are still pending.',
    task_reject:
        'Sorry, you can only reject tasks that are assigned to you and are still pending.',
    task_complete:
        'Sorry, only the person who created this task can mark it as completed.',
    task_delete:
        'Sorry, only the person who created this task can delete or cancel it.',
    task_edit_deadline:
        "Sorry, you don't have permission to change this task's deadline.",
    task_edit_assignee:
        'Sorry, only the task creator can reassign this task to someone else.',
    task_create_subtask:
        "Sorry, you don't have permission to create subtasks under this task.",
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check whether a user is allowed to perform the given intent on a task.
 *
 * @param intent — the classified AI intent
 * @param task   — the resolved task (null for intents that create new entities)
 * @param userId — the acting user's ID
 * @returns `{ allowed: true }` or `{ allowed: false, reason: '...' }`
 */
export function validateAction(
    intent: IntentType,
    task: Task | null,
    userId: string,
): ActionValidationResult {
    const requiredAction = INTENT_TO_ACTION_TYPE[intent]

    // Intent doesn't require task-level permission (e.g. task_create, todo_create)
    if (!requiredAction) {
        return { allowed: true }
    }

    // If the intent requires a task but none was resolved
    if (!task) {
        return {
            allowed: false,
            reason: "I couldn't find the task you're referring to. Could you describe it more clearly?",
        }
    }

    // Check against the canonical permission rules in task-service.ts
    const availableActions = getAvailableActions(task, userId)
    const isAllowed = availableActions.some((a) => a.type === requiredAction)

    if (isAllowed) {
        return { allowed: true }
    }

    return {
        allowed: false,
        reason: getPermissionDeniedMessage(intent),
    }
}

/**
 * Returns a friendly, natural-language message explaining why
 * the action is not permitted.
 */
export function getPermissionDeniedMessage(intent: IntentType): string {
    return (
        DENIAL_MESSAGES[intent] ??
        "Sorry, you don't have permission to perform this action on the task."
    )
}
