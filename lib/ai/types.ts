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
    who_type: 'person' | 'bot' | 'self' | 'unknown'
    when_type: 'formal' | 'informal' | 'none'
}

export interface TodoCreateAction {
    intent: 'todo_create'
    title: string
    description: string | null
    deadline: string | null
    when_type: 'formal' | 'informal' | 'none'
}

export interface TaskAcceptAction {
    intent: 'task_accept'
    committed_deadline: string | null  // ISO 8601 — user may say "I'll do it" without a date
}

export interface TaskRejectAction {
    intent: 'task_reject'
    reason: string | null
}

export interface TaskCompleteAction {
    intent: 'task_complete'
    task_hint: string                  // description used to fuzzy-match the correct task
}

export interface TaskDeleteAction {
    intent: 'task_delete'
    task_hint: string
}

export interface TaskEditDeadlineAction {
    intent: 'task_edit_deadline'
    task_hint: string
    new_deadline: string | null        // ISO 8601
}

export interface TaskEditAssigneeAction {
    intent: 'task_edit_assignee'
    task_hint: string
    new_assignee_name: string
}

export interface TaskCreateSubtaskAction {
    intent: 'task_create_subtask'
    parent_task_hint: string
    title: string
    description: string | null
    assignee_name: string | null
    deadline: string | null
}

export interface ReminderCreateAction {
    intent: 'reminder_create'
    subject: string                    // what to remind about
    remind_at: string | null           // ISO 8601 — defaults to 6 AM IST if missing
    when_type: 'formal' | 'informal' | 'none'
}

export interface ScheduledMessageAction {
    intent: 'scheduled_message'
    recipient_name: string
    message_content: string
    send_at: string | null             // ISO 8601
}

export interface AuthSigninAction {
    intent: 'auth_signin'
}

export interface HelpNavigationAction {
    intent: 'help_navigation'
    question: string                   // the original navigation question
}

export interface StatusQueryAction {
    intent: 'status_query'
    query_type: 'my_tasks' | 'pending' | 'overdue' | 'general'
}

export interface UnknownAction {
    intent: 'unknown'
}

export interface ClarificationNeededAction {
    intent: 'clarification_needed'
    missing_fields: string[]           // which criteria are missing: 'what', 'who', 'when'
    clarification_message: string      // the message to send to the user
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
    | ClarificationNeededAction

// ---------------------------------------------------------------------------
// Permission validation
// ---------------------------------------------------------------------------

export interface ActionValidationResult {
    allowed: boolean
    reason?: string          // friendly message when disallowed
}

// ===========================================================================
// NEW — Single-call pipeline types (MVP)
// ===========================================================================

/** The intents the WhatsApp bot can match via Gemini */
export type WhatsAppIntent =
    | 'task_create'
    | 'todo_create'
    | 'vendor_add'
    | 'ticket_create'
    | 'send_dashboard_link'
    | 'unknown'

/** Output of the single-call message analyzer */
export interface AnalyzedMessage {
    who: {
        type: 'self' | 'person' | 'agent'
        name: string | null
    }
    what: string
    when: {
        date: string | null       // ISO 8601 or null
        raw: string | null        // original time reference from user text
    }
    intent: WhatsAppIntent
    confidence: number            // 0–1
    reasoning: string
}
