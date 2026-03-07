/**
 * WhatsApp Flows — Screen Response Builders
 *
 * Each function builds the encrypted screen data returned to WhatsApp.
 * Called by the Flow endpoint route handler.
 */

import {
    FlowView,
    resolveUserByPhone,
    getTasksForView,
    getTaskDetail,
    getEmployees,
    executeTaskAction,
} from './task-queries'

// ─── Types ────────────────────────────────────────────────────────────────────

type ScreenResponse =
    | { screen: string; data: Record<string, unknown> }
    | { screen: 'ERROR'; data: { error_message: string } }

// ─── INIT → DASHBOARD ────────────────────────────────────────────────────────

export async function handleInit(phone10: string): Promise<ScreenResponse> {
    const user = await resolveUserByPhone(phone10)
    if (!user || !user.organisation_id) {
        return errorScreen('Your account could not be found. Please sign up first.')
    }

    // Use today_assigned as default to compute summary
    const { summary } = await getTasksForView('today_assigned', user.id, user.organisation_id)

    return {
        screen: 'DASHBOARD',
        data: {
            summary,
            filter_options: staticFilterOptions(),
        },
    }
}

// ─── LOAD_TASKS → TASK_LIST ───────────────────────────────────────────────────

export async function handleLoadTasks(
    phone10: string,
    view: string
): Promise<ScreenResponse> {
    const user = await resolveUserByPhone(phone10)
    if (!user || !user.organisation_id) {
        return errorScreen('Account not found.')
    }

    const validView = isValidView(view) ? (view as FlowView) : 'today_assigned'
    const { tasks, label } = await getTasksForView(validView, user.id, user.organisation_id)

    const isEmpty = tasks.length === 0
    return {
        screen: 'TASK_LIST',
        data: {
            view_label: label,
            tasks: isEmpty ? [{ id: '__empty__', title: 'No tasks', description: '' }] : tasks,
            tasks_visible: !isEmpty,
            empty_visible: isEmpty,
            empty_message: emptyMessage(validView),
        },
    }
}

// ─── LOAD_TASK → TASK_DETAIL ──────────────────────────────────────────────────

export async function handleLoadTask(
    phone10: string,
    taskId: string
): Promise<ScreenResponse> {
    const user = await resolveUserByPhone(phone10)
    if (!user || !user.organisation_id) {
        return errorScreen('Account not found.')
    }
    if (!taskId) {
        return errorScreen('Please select a task first.')
    }

    const detail = await getTaskDetail(taskId, user.id, user.organisation_id)
    if (!detail) {
        return errorScreen('Task not found. It may have been deleted.')
    }

    return {
        screen: 'TASK_DETAIL',
        data: {
            task_id: detail.taskId,
            task_title: detail.title,
            task_info: detail.info,
            actions: detail.actions,
        },
    }
}

// ─── PREPARE_ACTION → ACTION_EXECUTE ─────────────────────────────────────────

export async function handlePrepareAction(
    phone10: string,
    taskId: string,
    selectedAction: string
): Promise<ScreenResponse> {
    const user = await resolveUserByPhone(phone10)
    if (!user || !user.organisation_id) {
        return errorScreen('Account not found.')
    }

    switch (selectedAction) {
        case 'edit_deadline':
        case 'accept':
            return {
                screen: 'ACTION_EXECUTE',
                data: {
                    task_id: taskId,
                    action_type: selectedAction,
                    confirm_message: '',
                    show_confirm: false,
                    show_date_picker: true,
                    show_employee_search: false,
                    show_error: false,
                    error_message: '',
                    employees: [],
                },
            }

        case 'edit_persons': {
            const employees = await getEmployees(user.organisation_id)
            return {
                screen: 'ACTION_EXECUTE',
                data: {
                    task_id: taskId,
                    action_type: 'edit_persons',
                    confirm_message: '',
                    show_confirm: false,
                    show_date_picker: false,
                    show_employee_search: true,
                    show_error: false,
                    error_message: '',
                    employees,
                },
            }
        }

        case 'complete':
            return confirmScreen(taskId, 'complete',
                'This will mark the task as completed. The other party will be notified.')

        case 'delete':
            return confirmScreen(taskId, 'delete',
                '⚠️ This will permanently delete the task and cancel all pending notifications.')

        case 'reject':
            return confirmScreen(taskId, 'reject',
                'This will reject the task. The owner will be notified.')

        case 'send_followup':
            return confirmScreen(taskId, 'send_followup',
                'This will send a follow-up reminder to the pending person.')

        default:
            return errorScreen('Unknown action selected.')
    }
}

// ─── COMMIT_ACTION → SUCCESS ──────────────────────────────────────────────────

export async function handleCommitAction(
    phone10: string,
    taskId: string,
    actionType: string,
    payload: {
        newDeadline?: string
        selectedEmployee?: string
        employeeSearch?: string
    }
): Promise<ScreenResponse> {
    const user = await resolveUserByPhone(phone10)
    if (!user || !user.organisation_id) {
        return errorScreen('Account not found.')
    }

    // Employee search: if search text present but no selection → filter list and return back to ACTION_EXECUTE
    if (actionType === 'edit_persons' && payload.employeeSearch && !payload.selectedEmployee) {
        const employees = await getEmployees(user.organisation_id, payload.employeeSearch)
        return {
            screen: 'ACTION_EXECUTE',
            data: {
                task_id: taskId,
                action_type: 'edit_persons',
                confirm_message: '',
                show_confirm: false,
                show_date_picker: false,
                show_employee_search: true,
                show_error: employees.length === 0,
                error_message: employees.length === 0 ? 'No employees found. Try a different name.' : '',
                employees: employees.length > 0 ? employees : [],
            },
        }
    }

    const result = await executeTaskAction(
        taskId,
        user.id,
        user.organisation_id,
        actionType,
        payload
    )

    if (!result.success) {
        // Return back to ACTION_EXECUTE with error shown
        return {
            screen: 'ACTION_EXECUTE',
            data: {
                task_id: taskId,
                action_type: actionType,
                confirm_message: '',
                show_confirm: false,
                show_date_picker: actionType === 'edit_deadline' || actionType === 'accept',
                show_employee_search: actionType === 'edit_persons',
                show_error: true,
                error_message: result.message,
                employees: actionType === 'edit_persons'
                    ? await getEmployees(user.organisation_id)
                    : [],
            },
        }
    }

    // Send notification if needed (fire and forget)
    if (result.notifyPhone && result.notifyMessage) {
        notifyAsync(result.notifyPhone, result.notifyMessage)
    }

    return {
        screen: 'SUCCESS',
        data: {
            success_message: result.message,
        },
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function errorScreen(message: string): ScreenResponse {
    return {
        screen: 'ERROR' as string,
        data: { error_message: message },
    }
}

function confirmScreen(taskId: string, actionType: string, message: string): ScreenResponse {
    return {
        screen: 'ACTION_EXECUTE',
        data: {
            task_id: taskId,
            action_type: actionType,
            confirm_message: message,
            show_confirm: true,
            show_date_picker: false,
            show_employee_search: false,
            show_error: false,
            error_message: '',
            employees: [],
        },
    }
}

function staticFilterOptions() {
    return [
        { id: 'today_assigned', title: '📥  Today — Assigned to Me' },
        { id: 'today_owned', title: '👑  Today — Owned by Me' },
        { id: 'action_required', title: '⚡  Action Required from Me' },
        { id: 'pending_others', title: '⏳  Waiting on Others' },
        { id: 'overdue', title: '🔴  Overdue Tasks' },
        { id: 'todos', title: '✅  My To-Dos' },
        { id: 'future', title: '📆  Upcoming Tasks' },
    ]
}

function isValidView(view: string): boolean {
    return ['today_assigned', 'today_owned', 'action_required', 'pending_others', 'overdue', 'todos', 'future'].includes(view)
}

function emptyMessage(view: FlowView): string {
    switch (view) {
        case 'today_assigned': return '✅  No tasks assigned to you today.'
        case 'today_owned': return '✅  No tasks owned by you today.'
        case 'action_required': return '✅  No action required from you right now.'
        case 'pending_others': return '✅  Nothing is waiting on others.'
        case 'overdue': return '🎉  No overdue tasks. Great work!'
        case 'todos': return '✅  No to-dos found.'
        case 'future': return '📆  No upcoming tasks in the next 30 days.'
    }
}

// Fire-and-forget WhatsApp notification (import lazily to avoid circular deps)
function notifyAsync(phone: string, message: string) {
    import('@/lib/whatsapp').then(({ sendWhatsAppMessage }) => {
        sendWhatsAppMessage(phone, message).catch(err =>
            console.error('[FlowScreens] Failed to send notification:', err)
        )
    }).catch(() => { /* ignore */ })
}
