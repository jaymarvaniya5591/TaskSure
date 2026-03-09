/**
 * WhatsApp Flows — Screen Response Builders
 *
 * Each function builds the encrypted screen data returned to WhatsApp.
 * Called by the Flow endpoint route handler.
 *
 * Flow structure (v2 — single-click navigation):
 *   DASHBOARD → on-select → TASK_LIST → on-select → TASK_DETAIL
 *   TASK_DETAIL → on-select → [DEADLINE_SCREEN | PERSONS_SCREEN | SUCCESS]
 *   DEADLINE_SCREEN → footer → SUCCESS
 *   PERSONS_SCREEN  → footer → SUCCESS
 */

import {
    FlowView,
    resolveUserByPhone,
    getTasksForView,
    getTaskDetail,
    getEmployees,
    executeTaskAction,
} from './task-queries'

// ─── COMMIT_ACTION Deduplication ─────────────────────────────────────────────
// Prevents duplicate side-effects when slow connectivity causes the same action
// to be submitted multiple times. Mirrors the processedMessageIds pattern in
// app/api/webhook/whatsapp/route.ts.
const COMMIT_DEDUP_TTL_MS = 30_000 // 30-second window
const commitDedupMap = new Map<string, number>()

function isDuplicateCommit(phone10: string, actionType: string, taskId: string): boolean {
    const key = `${phone10}:${actionType}:${taskId}`
    const seenAt = commitDedupMap.get(key)
    if (seenAt !== undefined && Date.now() - seenAt < COMMIT_DEDUP_TTL_MS) return true
    commitDedupMap.set(key, Date.now())
    return false
}

setInterval(() => {
    const cutoff = Date.now() - COMMIT_DEDUP_TTL_MS
    for (const [key, ts] of Array.from(commitDedupMap.entries())) {
        if (ts < cutoff) commitDedupMap.delete(key)
    }
}, 5 * 60_000)

// ─── Types ────────────────────────────────────────────────────────────────────

type ScreenResponse = { screen: string; data: Record<string, unknown> }

// ─── INIT → DASHBOARD ────────────────────────────────────────────────────────

export async function handleInit(phone10: string): Promise<ScreenResponse> {
    const user = await resolveUserByPhone(phone10)
    if (!user || !user.organisation_id) {
        return dashboardFallback('Your account could not be found. Please sign up first.')
    }

    // DASHBOARD is fully static — the options are hardcoded in the Flow JSON.
    // We return an empty data object so the screen renders immediately.
    return {
        screen: 'DASHBOARD',
        data: {},
    }
}

// ─── LOAD_TASKS → TASK_LIST ───────────────────────────────────────────────────

export async function handleLoadTasks(
    phone10: string,
    view: string
): Promise<ScreenResponse> {
    const user = await resolveUserByPhone(phone10)
    if (!user || !user.organisation_id) {
        return dashboardFallback('Account not found.')
    }

    const validView = isValidView(view) ? (view as FlowView) : 'today_assigned'
    const { tasks, label } = await getTasksForView(validView, user.id, user.organisation_id)

    const isEmpty = tasks.length === 0
    if (isEmpty) {
        return {
            screen: 'EMPTY_TASK_LIST',
            data: {
                view_label: label,
                empty_message: emptyMessage(validView),
            }
        }
    }

    return {
        screen: 'TASK_LIST',
        data: {
            view_label: label,
            view_state: validView,
            tasks: tasks.map(t => ({ ...t, enabled: true })),
        },
    }
}

// ─── LOAD_TASK → TASK_DETAIL ──────────────────────────────────────────────────

export async function handleLoadTask(
    phone10: string,
    taskId: string,
    viewState?: string
): Promise<ScreenResponse> {
    const user = await resolveUserByPhone(phone10)
    if (!user || !user.organisation_id) {
        return dashboardFallback('Account not found.')
    }
    if (!taskId || taskId === '__empty__') {
        return dashboardFallback('Please select a valid task.')
    }

    const detail = await getTaskDetail(taskId, user.id, user.organisation_id)
    if (!detail) {
        return dashboardFallback('Task not found. It may have been deleted.')
    }

    return {
        screen: 'TASK_DETAIL',
        data: {
            task_id: detail.taskId,
            view_state: viewState || '',
            task_title: detail.title,
            task_info: detail.info,
            actions: detail.actions.map(a => ({ ...a, enabled: true })),
        },
    }
}

// ─── PREPARE_ACTION → (commit immediately OR collect input) ───────────────────
//
// Simple actions (complete, delete, reject, send_followup):
//   Execute immediately → return SUCCESS screen.
// Deadline actions (edit_deadline, accept):
//   Return DEADLINE_SCREEN so user can pick a date.
// Person action (edit_persons):
//   Fetch employee list → return PERSONS_SCREEN.

export async function handlePrepareAction(
    phone10: string,
    taskId: string,
    selectedAction: string,
    viewState?: string
): Promise<ScreenResponse> {
    const user = await resolveUserByPhone(phone10)
    if (!user || !user.organisation_id) {
        return dashboardFallback('Account not found.')
    }

    switch (selectedAction) {
        // ── Deadline input required ─────────────────────────────────────────
        case 'edit_deadline':
        case 'accept': {
            // min_date = 'YYYY-MM-DD'
            const minDate = new Date().toISOString().split('T')[0]

            // Create time options (every 30 mins)
            const timeOptions = []
            for (let h = 0; h < 24; h++) {
                for (let m = 0; m < 60; m += 30) {
                    const ampm = h >= 12 ? 'PM' : 'AM'
                    const hour12 = h % 12 || 12
                    const minStr = m === 0 ? '00' : '30'
                    const timeId = `${h.toString().padStart(2, '0')}:${minStr}`
                    const timeLabel = `${hour12}:${minStr} ${ampm}`
                    timeOptions.push({ id: timeId, title: timeLabel })
                }
            }

            // Fetch task title for the sub-heading
            const detail = await getTaskDetail(taskId, user.id, user.organisation_id)
            return {
                screen: 'DEADLINE_SCREEN',
                data: {
                    task_id: taskId,
                    task_title: detail?.title ?? 'Task',
                    action_type: selectedAction,
                    view_state: viewState || '',
                    min_date: minDate,
                    time_options: timeOptions,
                },
            }
        }

        // ── Person selection required ───────────────────────────────────────
        case 'edit_persons': {
            const [employees, detail] = await Promise.all([
                getEmployees(user.organisation_id),
                getTaskDetail(taskId, user.id, user.organisation_id),
            ])
            const filteredEmployees = detail?.isTodo
                ? employees.filter(e => e.id !== user.id)
                : employees
            return {
                screen: 'PERSONS_SCREEN',
                data: {
                    task_id: taskId,
                    task_title: detail?.title ?? 'Task',
                    action_type: selectedAction,
                    view_state: viewState || '',
                    employees: filteredEmployees.map(e => ({ ...e, enabled: true })),
                },
            }
        }

        // ── Simple 1-click actions — commit immediately ─────────────────────
        case 'complete':
        case 'delete':
        case 'reject':
        case 'send_followup': {
            if (isDuplicateCommit(phone10, selectedAction, taskId)) {
                return {
                    screen: 'SUCCESS',
                    data: { success_message: 'Action already processed.', view_state: viewState || '' },
                }
            }
            return commitAndRespond(
                taskId, user.id, user.organisation_id,
                selectedAction, {}, viewState
            )
        }

        default:
            return dashboardFallback('Unknown action selected.')
    }
}

// ─── COMMIT_ACTION → SUCCESS ──────────────────────────────────────────────────
// Called from DEADLINE_SCREEN and PERSONS_SCREEN footer buttons.

export async function handleCommitAction(
    phone10: string,
    taskId: string,
    actionType: string,
    payload: {
        new_deadline_date?: string
        new_deadline_time?: string
        selectedEmployee?: string
        employeeSearch?: string
    },
    viewState?: string
): Promise<ScreenResponse> {
    const user = await resolveUserByPhone(phone10)
    if (!user || !user.organisation_id) {
        return dashboardFallback('Account not found.')
    }

    // Dedup: reject repeated COMMIT_ACTIONs for the same phone+action+task within 30s
    if (isDuplicateCommit(phone10, actionType, taskId)) {
        return {
            screen: 'SUCCESS',
            data: { success_message: 'Action already processed.', view_state: viewState || '' },
        }
    }

    let mergedDeadline: string | undefined
    if (payload.new_deadline_date && payload.new_deadline_time) {
        let dateString = payload.new_deadline_date

        // If it's a numeric epoch string (e.g. "1710000000000")
        if (!isNaN(Number(payload.new_deadline_date))) {
            const dateObj = new Date(Number(payload.new_deadline_date))
            const yyyy = dateObj.getFullYear()
            const mm = String(dateObj.getMonth() + 1).padStart(2, '0')
            const dd = String(dateObj.getDate()).padStart(2, '0')
            dateString = `${yyyy}-${mm}-${dd}`
        }

        // Merge into a single local ISO string format that native parseISO/endOfDay can handle
        mergedDeadline = `${dateString}T${payload.new_deadline_time}:00`
    }

    return commitAndRespond(
        taskId, user.id, user.organisation_id,
        actionType,
        {
            newDeadline: mergedDeadline,
            selectedEmployee: payload.selectedEmployee,
            employeeSearch: payload.employeeSearch
        },
        viewState
    )
}

// ─── Shared commit helper ─────────────────────────────────────────────────────

async function commitAndRespond(
    taskId: string,
    userId: string,
    orgId: string,
    actionType: string,
    payload: { newDeadline?: string; selectedEmployee?: string; employeeSearch?: string },
    viewState?: string
): Promise<ScreenResponse> {
    const result = await executeTaskAction(taskId, userId, orgId, actionType, payload)

    // On failure we still show SUCCESS but with the error as the message —
    // there is no good way to show an error without navigating backward in Flows.
    return {
        screen: 'SUCCESS',
        data: {
            success_message: result.success
                ? result.message
                : `⚠️ ${result.message}`,
            view_state: viewState || '',
        },
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Falls back to the DASHBOARD screen with an empty data set.
 * We can't show a proper error screen without a dedicated ERROR screen in the Flow;
 * returning DASHBOARD at least keeps the user in the flow.
 */
function dashboardFallback(_message: string): ScreenResponse {
    // Log for server debugging
    console.error('[FlowScreens] Fallback error message:', _message)
    return {
        screen: 'ERROR_SCREEN',
        data: {
            error_message: _message
        },
    }
}

function isValidView(view: string): boolean {
    return [
        'today_assigned', 'today_owned', 'action_required',
        'pending_others', 'overdue', 'todos', 'future',
    ].includes(view)
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

