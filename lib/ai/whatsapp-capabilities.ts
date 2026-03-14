/**
 * WhatsApp Capabilities Reference
 *
 * Single source of truth for what the WhatsApp agent can and cannot do.
 * This file is used:
 *   1. By the Gemini system prompt — so the AI knows which intents to match
 *   2. By developers — to track what's implemented and what's webapp-only
 *
 * When adding support for a new action via WhatsApp, move it from
 * WEBAPP_ONLY_ACTIONS to WHATSAPP_ACTIONS and implement its handler.
 */

// ---------------------------------------------------------------------------
// Actions available via WhatsApp bot
// ---------------------------------------------------------------------------

export const WHATSAPP_ACTIONS = [
    {
        id: 'task_create',
        label: 'Create a task',
        description: 'Create a task assigned to someone else in the organisation',
        examples: [
            'Tell Ramesh to send the invoice by Friday',
            'Ask Priya to prepare the report',
            'Assign the design review to Arjun',
        ],
    },
    {
        id: 'todo_create',
        label: 'Create a to-do',
        description: 'Create a personal to-do item for yourself (self-assigned task)',
        examples: [
            'I need to call the client tomorrow at 3pm',
            'Remind me to buy groceries on Saturday',
            'Note to self: review the presentation before Monday',
        ],
    },
    {
        id: 'vendor_add',
        label: 'Add a vendor',
        description: 'Register a new vendor (supplier, contractor) in the organisation by phone number',
        examples: [
            'Add vendor 9876543210',
            'Register new supplier Ramesh, his number is 98765 43210',
            'Add a new vendor',
            'I want to add a vendor to my organisation',
        ],
    },
    {
        id: 'ticket_create',
        label: 'Create a ticket for a vendor',
        description: 'Create a tracking ticket for a vendor (shipment, payment, invoice follow-up). Vendors are external suppliers/contractors, NOT employees.',
        examples: [
            'Create ticket for Ramesh about invoice pending by Friday',
            'Track shipment from Kumar Supplies, deadline next week',
            'New ticket: payment follow-up with Sharma ji by March 20th',
            'Create a ticket for vendor Priya about the delayed order',
        ],
    },
] as const

// ---------------------------------------------------------------------------
// Actions available ONLY on the webapp dashboard (not via WhatsApp yet)
// ---------------------------------------------------------------------------

export const WEBAPP_ONLY_ACTIONS = [
    {
        id: 'task_complete',
        label: 'Mark a task as completed',
        description: 'The task owner marks a task as done',
    },
    {
        id: 'task_delete',
        label: 'Delete / cancel a task',
        description: 'The task owner cancels a task and all its subtasks',
    },
    {
        id: 'task_edit_deadline',
        label: 'Edit task deadline',
        description: 'Change the committed deadline of a task',
    },
    {
        id: 'task_edit_assignee',
        label: 'Reassign a task',
        description: 'Change who a task is assigned to',
    },
    {
        id: 'task_create_subtask',
        label: 'Create a subtask',
        description: 'Add a subtask under an existing task',
    },
    {
        id: 'status_query',
        label: 'View task status / dashboard',
        description: 'See a summary of pending, overdue, and active tasks',
    },
    {
        id: 'help_navigation',
        label: 'Get help navigating the app',
        description: 'Find where things are in the dashboard',
    },
    {
        id: 'scheduled_message',
        label: 'Schedule a message',
        description: 'Send a message to someone at a future time',
    },
    {
        id: 'team_management',
        label: 'Manage team members',
        description: 'Add or remove people from the organisation',
    },
    {
        id: 'view_calendar',
        label: 'View calendar',
        description: 'See the calendar view of tasks and deadlines',
    },
    {
        id: 'view_stats',
        label: 'View performance stats',
        description: 'See performance metrics and analytics',
    },
    {
        id: 'profile_settings',
        label: 'Update profile / settings',
        description: 'Change name, phone, notifications, or other settings',
    },
] as const

// ---------------------------------------------------------------------------
// Special intents handled by the bot outside of Gemini classification
// ---------------------------------------------------------------------------

export const BUTTON_DRIVEN_ACTIONS = [
    {
        id: 'task_accept',
        label: 'Accept a task',
        description: 'Assignee accepts a pending task by setting a deadline — triggered by tapping the "Accept" button in the task assignment notification',
    },
    {
        id: 'task_reject',
        label: 'Reject a task',
        description: 'Assignee rejects a pending task with a reason — triggered by tapping the "Reject" button in the task assignment notification',
    },
    {
        id: 'auth_signin',
        label: 'Sign in to dashboard',
        description: 'Get a sign-in link — triggered by typing "signin" or tapping "Sign in" button',
    },
] as const

// ---------------------------------------------------------------------------
// Helper: build the intent list string for the Gemini prompt
// ---------------------------------------------------------------------------

export function getWhatsAppActionsForPrompt(): string {
    const lines: string[] = []

    lines.push('## Actions available via WhatsApp (match these):')
    for (const a of WHATSAPP_ACTIONS) {
        lines.push(`- **${a.id}**: ${a.description}`)
        lines.push(`  Examples: ${a.examples.map(e => `"${e}"`).join(', ')}`)
    }

    lines.push('')
    lines.push('## Actions available ONLY on the webapp dashboard (if user wants any of these, respond with send_dashboard_link):')
    for (const a of WEBAPP_ONLY_ACTIONS) {
        lines.push(`- **${a.id}**: ${a.description}`)
    }

    return lines.join('\n')
}
