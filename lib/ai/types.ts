/**
 * AI Layer — Shared type definitions.
 *
 * Defines the 15 intent types, pipeline stage outputs, and
 * the discriminated union for extracted actions.
 */

// ---------------------------------------------------------------------------
// Intent types
// ---------------------------------------------------------------------------

export type IntentType =
    | 'task_create'
    | 'todo_create'
    | 'task_accept'
    | 'task_reject'
    | 'task_complete'
    | 'task_delete'
    | 'task_edit_deadline'
    | 'task_edit_assignee'
    | 'task_create_subtask'
    | 'reminder_create'
    | 'scheduled_message'
    | 'auth_signin'
    | 'help_navigation'
    | 'status_query'
    | 'unknown'

// ---------------------------------------------------------------------------
// Stage 1 — Intent classification output
// ---------------------------------------------------------------------------

export interface ClassifiedIntent {
    intent: IntentType
    confidence: number       // 0–1 scale
    reasoning: string        // short explanation for logging / debugging
}

// ---------------------------------------------------------------------------
// Stage 2 — Extracted action data (discriminated union)
// ---------------------------------------------------------------------------

export interface TaskCreateAction {
    intent: 'task_create'
    title: string
    description: string | null
    assignee_name: string | null
    deadline: string | null            // ISO 8601
    confirmation_message: string
}

export interface TodoCreateAction {
    intent: 'todo_create'
    title: string
    description: string | null
    deadline: string | null
    confirmation_message: string
}

export interface TaskAcceptAction {
    intent: 'task_accept'
    committed_deadline: string | null  // ISO 8601 — user may say "I'll do it" without a date
    confirmation_message: string
}

export interface TaskRejectAction {
    intent: 'task_reject'
    reason: string | null
    confirmation_message: string
}

export interface TaskCompleteAction {
    intent: 'task_complete'
    task_hint: string                  // description used to fuzzy-match the correct task
    confirmation_message: string
}

export interface TaskDeleteAction {
    intent: 'task_delete'
    task_hint: string
    confirmation_message: string
}

export interface TaskEditDeadlineAction {
    intent: 'task_edit_deadline'
    task_hint: string
    new_deadline: string | null        // ISO 8601
    confirmation_message: string
}

export interface TaskEditAssigneeAction {
    intent: 'task_edit_assignee'
    task_hint: string
    new_assignee_name: string
    confirmation_message: string
}

export interface TaskCreateSubtaskAction {
    intent: 'task_create_subtask'
    parent_task_hint: string
    title: string
    description: string | null
    assignee_name: string | null
    deadline: string | null
    confirmation_message: string
}

export interface ReminderCreateAction {
    intent: 'reminder_create'
    subject: string                    // what to remind about
    remind_at: string | null           // ISO 8601 — defaults to 6 AM IST if missing
    confirmation_message: string
}

export interface ScheduledMessageAction {
    intent: 'scheduled_message'
    recipient_name: string
    message_content: string
    send_at: string | null             // ISO 8601
    confirmation_message: string
}

export interface AuthSigninAction {
    intent: 'auth_signin'
    confirmation_message: string
}

export interface HelpNavigationAction {
    intent: 'help_navigation'
    question: string                   // the original navigation question
    confirmation_message: string
}

export interface StatusQueryAction {
    intent: 'status_query'
    query_type: 'my_tasks' | 'pending' | 'overdue' | 'general'
    confirmation_message: string
}

export interface UnknownAction {
    intent: 'unknown'
    confirmation_message: string
}

/**
 * Discriminated union of all possible extracted actions.
 * Use `action.intent` to narrow the type.
 */
export type ExtractedAction =
    | TaskCreateAction
    | TodoCreateAction
    | TaskAcceptAction
    | TaskRejectAction
    | TaskCompleteAction
    | TaskDeleteAction
    | TaskEditDeadlineAction
    | TaskEditAssigneeAction
    | TaskCreateSubtaskAction
    | ReminderCreateAction
    | ScheduledMessageAction
    | AuthSigninAction
    | HelpNavigationAction
    | StatusQueryAction
    | UnknownAction

// ---------------------------------------------------------------------------
// Permission validation
// ---------------------------------------------------------------------------

export interface ActionValidationResult {
    allowed: boolean
    reason?: string          // friendly message when disallowed
}
