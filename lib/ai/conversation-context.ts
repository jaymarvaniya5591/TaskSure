/**
 * Conversation Context — Session-based multi-turn state machine.
 *
 * Replaces the fragmented context markers (clarification_needed, awaiting_accept_deadline, etc.)
 * with a single, clean session model. Each user can have at most ONE active session at a time.
 *
 * Sessions are stored in the `conversation_sessions` table with a 10-minute TTL.
 *
 * Session types:
 *   - awaiting_assignee_name:      task_create — bot asked "who should do this?"
 *   - awaiting_assignee_selection:  task_create — bot showed multiple name matches
 *   - awaiting_task_description:    task/todo   — bot knows who, needs what
 *   - awaiting_todo_deadline:       todo_create — bot knows what, needs when
 *   - awaiting_accept_deadline:     accept flow — user tapped Accept, bot needs deadline
 *   - awaiting_reject_reason:       reject flow — user tapped Reject, bot needs reason
 */

import { createAdminClient } from '@/lib/supabase/admin'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseAdmin = any

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SessionType =
    | 'awaiting_assignee_name'
    | 'awaiting_assignee_selection'
    | 'awaiting_task_description'
    | 'awaiting_todo_deadline'
    | 'awaiting_accept_deadline'
    | 'awaiting_reject_reason'
    | 'awaiting_edit_deadline'
    | 'awaiting_vendor_phone'
    | 'awaiting_vendor_name'
    | 'awaiting_ticket_vendor'
    | 'awaiting_ticket_subject'
    | 'awaiting_ticket_deadline'
    | 'awaiting_ticket_new_deadline'
    | 'awaiting_review_task_selection'
    | 'awaiting_review_comment'

export interface ConversationSession {
    id: string
    phone: string
    session_type: SessionType
    context_data: SessionContextData
    created_at: string
    expires_at: string
    resolved: boolean
}

/**
 * context_data JSON shape — carries all intermediate state.
 * Not all fields are used by every session type.
 */
export interface SessionContextData {
    /** The original intent that started this session */
    original_intent?: string
    /** Extracted assignee name from the original message */
    who_name?: string | null
    /** Extracted task description */
    what?: string | null
    /** Extracted deadline */
    when_date?: string | null
    when_raw?: string | null
    /** Candidate users for disambiguation */
    candidates?: Array<{ id: string; name: string; phone_number?: string }>
    /** Task ID for accept/reject flows */
    task_id?: string | null
    /** The original raw user message that started the flow */
    original_message?: string | null
    /** Sender info for creating tasks */
    sender_id?: string | null
    sender_name?: string | null
    organisation_id?: string | null
    /** Vendor onboarding fields */
    vendor_phone?: string | null
    vendor_name?: string | null
    onboarding_id?: string | null
    /** Name collection retry count */
    name_retries?: number
    /** Ticket creation fields */
    vendor_id?: string | null
    ticket_subject?: string | null
    /** Detected BCP 47 language code for the task (e.g. "gu-IN") */
    task_language?: string | null
    /** Task owner info (for review flows) */
    owner_id?: string | null
    owner_name?: string | null
    /** Candidate tasks for review disambiguation */
    task_candidates?: Array<{ id: string; title: string; owner_name: string }>
}

const DEFAULT_TTL_MINUTES = 10

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get the currently active (non-expired, non-resolved) session for a phone number.
 * Returns null if no session exists or all sessions have expired.
 */
export async function getActiveSession(
    phone: string,
    supabase?: SupabaseAdmin,
): Promise<ConversationSession | null> {
    const sb = supabase || createAdminClient()

    const { data, error } = await sb
        .from('conversation_sessions')
        .select('*')
        .eq('phone', phone)
        .eq('resolved', false)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .single()

    if (error || !data) return null
    return data as ConversationSession
}

/**
 * Create a new session for a user. Any existing active session is auto-resolved first.
 */
export async function createSession(
    phone: string,
    sessionType: SessionType,
    contextData: SessionContextData,
    ttlMinutes: number = DEFAULT_TTL_MINUTES,
    supabase?: SupabaseAdmin,
): Promise<ConversationSession> {
    const sb = supabase || createAdminClient()

    // Auto-resolve any existing active session for this user
    await sb
        .from('conversation_sessions')
        .update({ resolved: true })
        .eq('phone', phone)
        .eq('resolved', false)

    const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString()

    const { data, error } = await sb
        .from('conversation_sessions')
        .insert({
            phone,
            session_type: sessionType,
            context_data: contextData,
            expires_at: expiresAt,
        })
        .select('*')
        .single()

    if (error) {
        console.error('[ConversationContext] Failed to create session:', error.message)
        throw new Error(`Failed to create conversation session: ${error.message}`)
    }

    console.log(`[ConversationContext] Session created: ${sessionType} for ${phone} (expires ${expiresAt})`)
    return data as ConversationSession
}

/**
 * Mark a session as resolved (consumed). Called after successful processing.
 */
export async function resolveSession(
    sessionId: string,
    supabase?: SupabaseAdmin,
): Promise<void> {
    const sb = supabase || createAdminClient()

    const { error } = await sb
        .from('conversation_sessions')
        .update({ resolved: true })
        .eq('id', sessionId)

    if (error) {
        console.error('[ConversationContext] Failed to resolve session:', error.message)
    } else {
        console.log(`[ConversationContext] Session resolved: ${sessionId}`)
    }
}

/**
 * Resolve all active sessions for a phone number.
 * Used when a user explicitly starts a completely new flow.
 */
export async function resolveAllSessions(
    phone: string,
    supabase?: SupabaseAdmin,
): Promise<void> {
    const sb = supabase || createAdminClient()

    await sb
        .from('conversation_sessions')
        .update({ resolved: true })
        .eq('phone', phone)
        .eq('resolved', false)
}

// ---------------------------------------------------------------------------
// Intent-change acknowledgment messages
// ---------------------------------------------------------------------------

/**
 * Build a concise acknowledgment message when we detect the user has abandoned
 * a previous flow and started a new one.
 */
export function buildIntentChangeAcknowledgment(session: ConversationSession): string {
    switch (session.session_type) {
        case 'awaiting_assignee_name':
        case 'awaiting_assignee_selection':
            return `↩️ *Flow Interrupted*\n\nI was waiting for a person's name for...\n\n*Task:*\n"${session.context_data.what || 'your task'}"\n\nSince you sent a new message,\nI'll process that instead.\n\n_You can always create this task again._`

        case 'awaiting_task_description':
            return '↩️ *Flow Interrupted*\n\nI was waiting for a task description.\n\nSince you sent a new message,\nI\'ll process that instead.'

        case 'awaiting_todo_deadline':
            return `↩️ *Flow Interrupted*\n\nI was waiting for a deadline for...\n\n*To-do:*\n"${session.context_data.what || 'your to-do'}"\n\nSince you sent a new message,\nI'll process that instead.\n\n_You can always create this to-do again._`

        case 'awaiting_accept_deadline':
            return '↩️ *Task NOT Accepted*\n\nI was waiting for a deadline to accept the task.\n\n⚠️ The task has *not* been accepted.\n\nTap "Accept" again when you\'re ready.\n\n_Processing your new message now..._'

        case 'awaiting_reject_reason':
            return '↩️ *Task NOT Rejected*\n\nI was waiting for a rejection reason.\n\n⚠️ The task has *not* been rejected.\n\nYou can reject it from the dashboard.\n\n_Processing your new message now..._'

        case 'awaiting_edit_deadline':
            return '↩️ *Deadline NOT Changed*\n\nI was waiting for a new deadline date.\n\n⚠️ The deadline has *not* been updated.\n\nYou can edit it by tapping "Edit Deadline" again.\n\n_Processing your new message now..._'

        case 'awaiting_vendor_phone':
            return '↩️ *Vendor Addition Cancelled*\n\nI was waiting for a vendor\'s phone number.\n\nSince you sent a new message, I\'ll process that instead.\n\n_You can add a vendor again anytime._'

        case 'awaiting_vendor_name':
            return '↩️ *Name Collection Cancelled*\n\nI was waiting for your name to complete vendor registration.\n\n_Processing your new message now..._'

        case 'awaiting_ticket_vendor':
            return `↩️ *Ticket Creation Cancelled*\n\nI was waiting for a vendor name for your ticket.\n\nSince you sent a new message, I'll process that instead.\n\n_You can create a ticket again anytime._`

        case 'awaiting_ticket_subject':
            return '↩️ *Ticket Creation Cancelled*\n\nI was waiting for a ticket subject.\n\nSince you sent a new message, I\'ll process that instead.\n\n_You can create a ticket again anytime._'

        case 'awaiting_ticket_deadline':
            return `↩️ *Ticket Creation Cancelled*\n\nI was waiting for a deadline for your ticket.\n\nSince you sent a new message, I'll process that instead.\n\n_You can create a ticket again anytime._`

        case 'awaiting_review_task_selection':
            return '↩️ *Review Request Cancelled*\n\nI was waiting for you to select a task for review.\n\nSince you sent a new message, I\'ll process that instead.\n\n_You can request a review again anytime._'

        case 'awaiting_review_comment':
            return '↩️ *Comment Not Sent*\n\nI was waiting for your feedback on the task.\n\n⚠️ Your comment has *not* been sent.\n\n_Processing your new message now..._'

        default:
            return '↩️ *Flow Interrupted*\n\nI was in the middle of something.\nI\'ll process your new message instead.'
    }
}
