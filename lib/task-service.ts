/**
 * Task Service — Central helper library for task logic.
 *
 * All functions are pure and operate on task data + context.
 * Designed to be consumed by:
 *   1. Frontend components (action dropdowns, card rendering, filtering)
 *   2. AI agents (via API routes that call these methods)
 *
 * TERMINOLOGY:
 *   - "Owner" = created_by (the person who created the task)
 *   - "Assignee" = assigned_to (the person assigned to complete the task)
 *   - "To-do" = a task where created_by === assigned_to (single participant)
 *   - "Task" = a task where created_by !== assigned_to (multi-participant)
 *   - "Active" = status is not 'completed' or 'cancelled'
 *   - "Pending" = committed_deadline is not set (assignee hasn't accepted yet)
 */

import { type Task, type TaskUser } from "./types";

// ─── ID Extraction ──────────────────────────────────────────────────────────

/**
 * Extract a user ID from a Supabase join result.
 * Handles: plain string, { id }, [{ id }], or nested object.
 */
export function extractUserId(
    userRef: string | TaskUser | TaskUser[] | unknown
): string | null {
    if (!userRef) return null;
    if (typeof userRef === "string") return userRef;
    if (Array.isArray(userRef)) return userRef[0]?.id || null;
    if (typeof userRef === "object" && userRef !== null && "id" in userRef)
        return (userRef as Record<string, unknown>).id as string;
    return null;
}

/**
 * Extract user name from a Supabase join result.
 */
export function extractUserName(
    userRef: string | TaskUser | TaskUser[] | unknown
): string | null {
    if (!userRef) return null;
    if (typeof userRef === "string") return null; // just an ID, no name
    if (Array.isArray(userRef)) return userRef[0]?.name || null;
    if (typeof userRef === "object" && userRef !== null && "name" in userRef)
        return (userRef as Record<string, unknown>).name as string;
    return null;
}

// ─── Classification ─────────────────────────────────────────────────────────

/**
 * A to-do is a task where the owner and assignee are the same person.
 */
export function isTodo(task: Task): boolean {
    const creatorId = extractUserId(task.created_by);
    const assigneeId = extractUserId(task.assigned_to);
    return creatorId === assigneeId;
}

/**
 * Active = not completed and not cancelled.
 */
export function isActive(task: Task): boolean {
    return !["completed", "cancelled"].includes(task.status);
}

/**
 * Overdue = has a deadline that has passed and is not completed/cancelled.
 */
export function isOverdue(task: Task): boolean {
    if (!isActive(task)) return false;
    if (task.status === "overdue") return true;
    const dl = task.committed_deadline || task.deadline;
    if (!dl) return false;
    return new Date(dl) < new Date();
}

/**
 * Whether the task has been accepted (assignee set a committed_deadline).
 */
export function isAccepted(task: Task): boolean {
    return task.status === "accepted" || !!task.committed_deadline;
}

/**
 * Whether the task is pending acceptance (assigned to someone, no committed_deadline yet).
 */
export function isPendingAcceptance(task: Task): boolean {
    return task.status === "pending" && !isTodo(task);
}

// ─── Role Detection ─────────────────────────────────────────────────────────

export function isOwner(task: Task, userId: string): boolean {
    return extractUserId(task.created_by) === userId;
}

export function isAssignee(task: Task, userId: string): boolean {
    return extractUserId(task.assigned_to) === userId;
}

// ─── Participant Computation ────────────────────────────────────────────────

/**
 * Get all active subtasks of a given task from the full tasks list.
 */
export function getActiveSubtasks(taskId: string, allTasks: Task[]): Task[] {
    return allTasks.filter(
        (t) => t.parent_task_id === taskId && isActive(t)
    );
}

/**
 * Recursively compute the count of unique participants for a task.
 * Participants = owner + assignee + assignees of all active subtasks (recursive).
 */
export function getParticipantCount(task: Task, allTasks: Task[]): number {
    const participants = new Set<string>();

    function collectParticipants(t: Task) {
        const ownerId = extractUserId(t.created_by);
        const assigneeId = extractUserId(t.assigned_to);
        if (ownerId) participants.add(ownerId);
        if (assigneeId) participants.add(assigneeId);

        // Recurse into active subtasks
        const subtasks = getActiveSubtasks(t.id, allTasks);
        for (const sub of subtasks) {
            collectParticipants(sub);
        }
    }

    collectParticipants(task);
    return participants.size;
}

/**
 * Get the "last active participant" — the most recently added participant.
 * This is the assignee of the most recently created active subtask,
 * or the task's own assignee if no subtasks exist.
 */
export function getLastActiveParticipant(
    task: Task,
    allTasks: Task[]
): { id: string; name: string | null } | null {
    // Recursively collect all active subtasks with timestamps
    const allSubtasks: Task[] = [];
    function collectAll(parentId: string) {
        const subs = getActiveSubtasks(parentId, allTasks);
        for (const s of subs) {
            allSubtasks.push(s);
            collectAll(s.id);
        }
    }
    collectAll(task.id);

    if (allSubtasks.length > 0) {
        // Sort by created_at descending → most recent first
        allSubtasks.sort(
            (a, b) =>
                new Date(b.created_at).getTime() -
                new Date(a.created_at).getTime()
        );
        const mostRecent = allSubtasks[0];
        const id = extractUserId(mostRecent.assigned_to);
        const name = extractUserName(mostRecent.assigned_to);
        return id ? { id, name } : null;
    }

    // No subtasks → last active is the direct assignee
    const id = extractUserId(task.assigned_to);
    const name = extractUserName(task.assigned_to);
    return id ? { id, name } : null;
}

// ─── Pending Action Detection ───────────────────────────────────────────────

export interface PendingInfo {
    /** Whether there's a pending action on this task tree */
    isPending: boolean;
    /** Whether the current user is the one who needs to act */
    isPendingFromMe: boolean;
    /** The person from whom the action is pending */
    pendingFrom: { id: string; name: string | null } | null;
}

/**
 * Determine if a task has a pending action (deadline not yet set).
 *
 * A task is "pending" if:
 *   - Its committed_deadline is NULL (assignee hasn't accepted) AND it's not a todo
 *   OR
 *   - Any active subtask in its tree has committed_deadline = NULL
 *
 * Returns who the action is pending from.
 */
export function getPendingInfo(
    task: Task,
    userId: string,
    allTasks: Task[]
): PendingInfo {
    // For todos, there's no pending action concept (owner sets their own deadline)
    if (isTodo(task)) {
        return { isPending: false, isPendingFromMe: false, pendingFrom: null };
    }

    // If the task itself doesn't have a committed deadline and is active
    if (!task.committed_deadline && isActive(task) && task.status === "pending") {
        const assigneeId = extractUserId(task.assigned_to);
        const assigneeName = extractUserName(task.assigned_to);
        return {
            isPending: true,
            isPendingFromMe: assigneeId === userId,
            pendingFrom: assigneeId
                ? { id: assigneeId, name: assigneeName }
                : null,
        };
    }

    // Check subtasks recursively for any pending deadlines
    function findPendingInSubtrees(parentId: string): PendingInfo | null {
        const subs = getActiveSubtasks(parentId, allTasks);
        for (const sub of subs) {
            if (
                !sub.committed_deadline &&
                isActive(sub) &&
                sub.status === "pending" &&
                !isTodo(sub)
            ) {
                const aId = extractUserId(sub.assigned_to);
                const aName = extractUserName(sub.assigned_to);
                return {
                    isPending: true,
                    isPendingFromMe: aId === userId,
                    pendingFrom: aId ? { id: aId, name: aName } : null,
                };
            }
            const deeper = findPendingInSubtrees(sub.id);
            if (deeper) return deeper;
        }
        return null;
    }

    const subtreePending = findPendingInSubtrees(task.id);
    if (subtreePending) return subtreePending;

    return { isPending: false, isPendingFromMe: false, pendingFrom: null };
}

// ─── Available Actions ──────────────────────────────────────────────────────

export type TaskActionType =
    | "accept"
    | "reject"
    | "complete"
    | "edit_deadline"
    | "create_subtask"
    | "edit_persons"
    | "delete";

export interface TaskAction {
    type: TaskActionType;
    label: string;
    /** Description for AI agents */
    description: string;
}

/**
 * Returns the list of available actions for a task given the current user.
 *
 * Rules:
 *   ASSIGNEE + status 'pending' (not accepted):
 *     - accept (must set deadline)
 *     - reject (must add remark)
 *     - create_subtask
 *
 *   ASSIGNEE + status 'accepted':
 *     - edit_deadline
 *     - create_subtask
 *
 *   OWNER (created_by !== assigned_to):
 *     - complete
 *     - edit_persons (change assignee)
 *     - delete
 *
 *   TODO (created_by === assigned_to === currentUser):
 *     - complete
 *     - edit_deadline
 *     - edit_persons (add person → converts to task)
 */
export function getAvailableActions(
    task: Task,
    userId: string
): TaskAction[] {
    // Cancelled tasks truly have no actions
    if (task.status === "cancelled") return [];

    const actions: TaskAction[] = [];
    const userIsOwner = isOwner(task, userId);
    const userIsAssignee = isAssignee(task, userId);
    const taskIsTodo = isTodo(task); // created_by === assigned_to
    const taskIsCompleted = task.status === "completed";

    // ── Completed tasks — limited actions ──
    if (taskIsCompleted) {
        if (userIsOwner) {
            actions.push({
                type: "delete",
                label: "Delete Task",
                description: "Delete this completed task permanently.",
            });
        }
        return actions;
    }

    // ── To-do actions (created_by === assigned_to) ──
    if (taskIsTodo) {
        if (userIsOwner) { // Only the single 'todo owner' can act
            actions.push({
                type: "complete",
                label: "Mark as Completed",
                description: "Marks this to-do as completed.",
            });
            actions.push({
                type: "edit_deadline",
                label: "Edit Deadline",
                description: "Change the deadline for this to-do.",
            });
            actions.push({
                type: "edit_persons",
                label: "Edit Persons",
                description: "Change the assignee. Adding a different person converts this to-do into a task.",
            });
            actions.push({
                type: "delete",
                label: "Delete To-do",
                description: "Delete this to-do permanently.",
            });
        }
        return actions;
    }

    // ── Task (Multi-participant) actions ──

    // Assignee actions (if I am the assignee, BUT not the owner of this multi-person task)
    if (userIsAssignee && !userIsOwner) {
        if (task.status === "pending") {
            // Not yet accepted
            actions.push({
                type: "accept",
                label: "Accept Task",
                description: "Accept this task by setting a committed deadline.",
            });
            actions.push({
                type: "reject",
                label: "Reject Task",
                description: "Reject this task with a reason/remark.",
            });
            actions.push({
                type: "create_subtask",
                label: "Create Subtask",
                description: "Create a subtask assigned to someone else before accepting.",
            });
        } else {
            // Already accepted / overdue
            actions.push({
                type: "edit_deadline",
                label: "Edit Deadline",
                description: "Change the committed deadline for this task.",
            });
            actions.push({
                type: "create_subtask",
                label: "Create Subtask",
                description: "Create a subtask as a dependency for this task.",
            });
        }
    }

    // Owner actions (if I created this multi-person task)
    if (userIsOwner && !userIsAssignee) {
        actions.push({
            type: "complete",
            label: "Mark as Completed",
            description: "Mark this task as completed.",
        });
        actions.push({
            type: "edit_persons",
            label: "Edit Persons",
            description: "Change the assignee of this task. Removing the assignee converts it to a to-do.",
        });
        actions.push({
            type: "delete",
            label: "Delete Task",
            description: "Delete this task. Cancels the task and all active subtasks.",
        });
    }

    return actions;
}

// ─── Effective Deadline Display ─────────────────────────────────────────────

/**
 * Returns the display-ready deadline string.
 * Returns "NA" if no deadline is set.
 */
export function getEffectiveDeadline(task: Task): string | null {
    return task.committed_deadline || task.deadline || null;
}
