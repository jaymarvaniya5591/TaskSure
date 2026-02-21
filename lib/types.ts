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
    created_at: string;
    updated_at?: string;

    // ── Computed display fields (set on the server before passing to client) ──
    /** Count of unique participants (owner + assignee + all active subtask participants) */
    participant_count?: number;
    /** Most recently added participant from the subtask chain */
    last_active_participant?: { id: string; name: string | null } | null;
    /** Person from whom the next action is pending (deadline not set) */
    pending_from?: { id: string; name: string | null } | null;
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
