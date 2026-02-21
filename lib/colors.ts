/**
 * Central Color System — used across all dashboard features.
 *
 * Categories:
 *   todo     — Self-assigned tasks (created_by === assigned_to) — Violet
 *   owned    — Tasks I created for others — Teal
 *   assigned — Tasks others created for me — Amber
 *   overdue  — Deadline has passed — Rose (overrides other categories)
 */

export type TaskColorCategory = 'todo' | 'owned' | 'assigned' | 'overdue';

interface TaskLike {
    created_by: string | { id: string };
    assigned_to: string | { id: string };
    status?: string;
    deadline?: string | null;
    committed_deadline?: string | null;
}

function extractId(field: string | { id: string }): string {
    return typeof field === 'string' ? field : field.id;
}

/**
 * Determines the color category for a task relative to the current user.
 * Overdue takes priority over all other categories.
 */
export function getTaskColorCategory(
    task: TaskLike,
    currentUserId: string
): TaskColorCategory {
    // Check overdue first — deadline has passed
    const effectiveDeadline = task.committed_deadline || task.deadline;
    if (
        task.status === 'overdue' ||
        (effectiveDeadline && new Date(effectiveDeadline) < new Date() && task.status !== 'completed')
    ) {
        return 'overdue';
    }

    const createdBy = extractId(task.created_by);
    const assignedTo = extractId(task.assigned_to);

    // Self-assigned → to-do
    if (createdBy === assignedTo && createdBy === currentUserId) {
        return 'todo';
    }

    // I created it for someone else → owned
    if (createdBy === currentUserId) {
        return 'owned';
    }

    // Someone else created it, I'm the assignee → assigned
    return 'assigned';
}

/**
 * Returns Tailwind class names for a task color category.
 */
export function getCategoryStyles(category: TaskColorCategory) {
    const styles = {
        todo: {
            bg: 'bg-todo-50',
            border: 'border-todo-200',
            accent: 'bg-todo-500',
            text: 'text-todo-700',
            badge: 'bg-todo-100 text-todo-700 border-todo-200',
            dot: 'bg-todo-500',
            label: 'To-do',
        },
        owned: {
            bg: 'bg-assigned-50',
            border: 'border-assigned-200',
            accent: 'bg-assigned-500',
            text: 'text-assigned-700',
            badge: 'bg-assigned-100 text-assigned-700 border-assigned-200',
            dot: 'bg-assigned-500',
            label: 'Owned',
        },
        assigned: {
            bg: 'bg-owned-50',
            border: 'border-owned-200',
            accent: 'bg-owned-500',
            text: 'text-owned-700',
            badge: 'bg-owned-100 text-owned-700 border-owned-200',
            dot: 'bg-owned-500',
            label: 'Assigned to me',
        },
        overdue: {
            bg: 'bg-overdue-50',
            border: 'border-overdue-200',
            accent: 'bg-overdue-500',
            text: 'text-overdue-700',
            badge: 'bg-overdue-100 text-overdue-700 border-overdue-200',
            dot: 'bg-overdue-500',
            label: 'Overdue',
        },
    };
    return styles[category];
}
