/**
 * Shared TypeScript types for dashboard components.
 *
 * KEY CONCEPT: To-dos are tasks where created_by === assigned_to.
 * They use the same Task interface and the same `tasks` table.
 * The separate `todos` table is legacy and unused by the new UI.
 */

export interface TaskUser {
    id: string;
    name: string;
    first_name?: string | null;
    last_name?: string | null;
    phone_number?: string;
    role?: string;
    avatar_url?: string | null;
}

export interface Task {
    id: string;
    title: string;
    description?: string | null;
    organisation_id: string;
    created_by: TaskUser | string;
    assigned_to: TaskUser | string;
    parent_task_id?: string | null;
    status: string;
    priority?: string;
    deadline?: string | null;
    committed_deadline?: string | null;
    call_made?: boolean;
    source?: string;
    language?: string | null;
    created_at: string;
    updated_at?: string;
    review_requested_at?: string | null;

    // ── Computed display fields (set on the server before passing to client) ──
    /** Count of unique participants (owner + assignee + all active subtask participants) */
    participant_count?: number;
    /** Most recently added participant from the subtask chain */
    last_active_participant?: { id: string; name: string | null; first_name?: string | null; last_name?: string | null; } | null;
    /** Person from whom the next action is pending (deadline not set) */
    pending_from?: { id: string; name: string | null; first_name?: string | null; last_name?: string | null; } | null;
}

/**
 * @deprecated — The new unified model uses the `tasks` table for to-dos
 * (where created_by === assigned_to). This interface is kept for legacy
 * compatibility with the separate `todos` table.
 */
export interface Todo {
    id: string;
    user_id: string;
    title: string;
    is_completed: boolean;
    created_at: string;
    updated_at?: string;
}

// ── Vendor Management Types ──

export type VendorStatus = 'pending' | 'active' | 'inactive';
export type TicketStatus = 'pending' | 'accepted' | 'completed' | 'rejected' | 'cancelled' | 'overdue';

export interface Vendor {
    id: string;
    organisation_id: string;
    phone_number: string;
    name: string | null;
    first_name: string | null;
    last_name: string | null;
    status: VendorStatus;
    added_by: TaskUser | string;
    user_id: string | null;
    created_at: string;
    updated_at: string;
}

export interface VendorOnboarding {
    id: string;
    organisation_id: string;
    vendor_phone: string;
    requested_by: TaskUser | string;
    status: 'pending' | 'approved' | 'rejected';
    vendor_name: string | null;
    org_vendor_id: string | null;
    created_at: string;
    resolved_at: string | null;
}

export interface Ticket {
    id: string;
    organisation_id: string;
    vendor_id: string;
    vendor?: Vendor;
    subject: string;
    description: string | null;
    deadline: string | null;
    committed_deadline: string | null;
    status: TicketStatus;
    created_by: TaskUser | string;
    source: 'whatsapp' | 'dashboard';
    created_at: string;
    updated_at: string;
}
