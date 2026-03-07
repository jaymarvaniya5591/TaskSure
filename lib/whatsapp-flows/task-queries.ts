/**
 * WhatsApp Flows — Task Queries
 *
 * Server-side functions that fetch and filter tasks for each of the 7 Flow views.
 * Mirrors the filter logic from dashboard-client.tsx, but runs on the server
 * using the Supabase admin client (bypasses RLS via phone → user lookup).
 */

import { createAdminClient } from '@/lib/supabase/admin'
import {
    extractUserName,
    isTodo,
    isActive,
    isOverdue,
    isOwner,
    isAssignee,
    getAvailableActions,
    getPendingInfo,
    getEffectiveDeadline,
} from '@/lib/task-service'
import { type Task } from '@/lib/types'
import { format, endOfDay, addDays } from 'date-fns'

// ─── Types ───────────────────────────────────────────────────────────────────

export type FlowView =
    | 'today_assigned'
    | 'today_owned'
    | 'action_required'
    | 'pending_others'
    | 'overdue'
    | 'todos'
    | 'future'

export interface FlowTaskItem {
    id: string
    title: string
    description: string // deadline + status shown as subtitle
}

export interface FlowEmployee {
    id: string
    title: string // name shown in list
}

// ─── User Resolution ─────────────────────────────────────────────────────────

/**
 * Resolve a phone number (10-digit) into user id + org id.
 */
export async function resolveUserByPhone(
    phone10: string
): Promise<{ id: string; name: string; organisation_id: string } | null> {
    const supabase = createAdminClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any)
        .from('users')
        .select('id, name, organisation_id')
        .eq('phone_number', phone10)
        .single()
    return data ?? null
}

// ─── Task Fetching ───────────────────────────────────────────────────────────

/**
 * Fetch all active tasks for the user's organisation that involve this user
 * (either as owner or assignee), excluding cancelled tasks.
 */
async function fetchUserTasks(
    userId: string,
    orgId: string
): Promise<Task[]> {
    const supabase = createAdminClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
        .from('tasks')
        .select(`
            id, title, description, organisation_id, status, priority,
            deadline, committed_deadline, parent_task_id, created_at, updated_at,
            created_by:users!tasks_created_by_fkey(id, name, phone_number),
            assigned_to:users!tasks_assigned_to_fkey(id, name, phone_number)
        `)
        .eq('organisation_id', orgId)
        .not('status', 'in', '("cancelled")')
        .or(`created_by.eq.${userId},assigned_to.eq.${userId}`)

    if (error) {
        console.error('[FlowQueries] Error fetching tasks:', error.message)
        return []
    }
    return (data ?? []) as Task[]
}

// ─── Deadline formatter for task subtitles ────────────────────────────────────

function formatDeadlineLabel(task: Task): string {
    const dl = getEffectiveDeadline(task)
    if (!dl) return 'No deadline'
    try {
        return format(new Date(dl), 'MMM d')
    } catch {
        return 'No deadline'
    }
}

function statusLabel(task: Task): string {
    if (task.status === 'completed') return 'Completed'
    if (task.status === 'overdue') return 'Overdue'
    if (task.status === 'pending') return 'Pending'
    if (task.status === 'accepted') return 'Accepted'
    return task.status
}

function buildTaskItem(task: Task): FlowTaskItem {
    return {
        id: task.id,
        title: task.title,
        description: `${formatDeadlineLabel(task)}  ·  ${statusLabel(task)}`,
    }
}

// ─── View Filters ─────────────────────────────────────────────────────────────

function isTopLevelTask(task: Task): boolean {
    return !task.parent_task_id
}

export async function getTasksForView(
    view: FlowView,
    userId: string,
    orgId: string
): Promise<{ tasks: FlowTaskItem[]; label: string; summary: string }> {
    const allTasks = await fetchUserTasks(userId, orgId)
    const now = new Date()
    const todayEnd = endOfDay(now)

    let filtered: Task[] = []
    let label = ''

    switch (view) {
        case 'today_assigned': {
            // Tasks assigned to me (not owned by me), deadline ≤ end of today
            label = 'Today — Assigned to Me'
            filtered = allTasks.filter(t => {
                if (!isActive(t)) return false
                if (!isTopLevelTask(t)) return false
                if (isTodo(t)) return false
                if (!isAssignee(t, userId)) return false
                if (isOwner(t, userId)) return false
                const dl = getEffectiveDeadline(t)
                if (!dl) return true // no deadline = show in today's view
                return new Date(dl) <= todayEnd
            })
            break
        }

        case 'today_owned': {
            // Tasks owned by me (not to-do), deadline ≤ end of today
            label = 'Today — Owned by Me'
            filtered = allTasks.filter(t => {
                if (!isActive(t)) return false
                if (!isTopLevelTask(t)) return false
                if (isTodo(t)) return false
                if (!isOwner(t, userId)) return false
                const dl = getEffectiveDeadline(t)
                if (!dl) return true
                return new Date(dl) <= todayEnd
            })
            break
        }

        case 'action_required': {
            // Tasks where I am the pending person (I need to accept)
            label = 'Action Required from Me'
            filtered = allTasks.filter(t => {
                if (!isActive(t)) return false
                if (!isTopLevelTask(t)) return false
                const info = getPendingInfo(t, userId, allTasks)
                return info.isPending && info.isPendingFromMe
            })
            break
        }

        case 'pending_others': {
            // Tasks where someone else needs to act (pending from others)
            label = 'Waiting on Others'
            filtered = allTasks.filter(t => {
                if (!isActive(t)) return false
                if (!isTopLevelTask(t)) return false
                const info = getPendingInfo(t, userId, allTasks)
                return info.isPending && !info.isPendingFromMe
            })
            break
        }

        case 'overdue': {
            // All overdue tasks involving me
            label = 'Overdue Tasks'
            filtered = allTasks.filter(t => {
                if (!isTopLevelTask(t)) return false
                return isOverdue(t)
            })
            break
        }

        case 'todos': {
            // To-dos: tasks where created_by === assigned_to === me
            label = 'My To-Dos'
            filtered = allTasks.filter(t => {
                if (!isActive(t)) return false
                if (!isTopLevelTask(t)) return false
                return isTodo(t) && isOwner(t, userId)
            })
            break
        }

        case 'future': {
            // Tasks with deadline strictly after today (next 30 days)
            label = 'Upcoming Tasks'
            const futureEnd = endOfDay(addDays(now, 30))
            filtered = allTasks.filter(t => {
                if (!isActive(t)) return false
                if (!isTopLevelTask(t)) return false
                const dl = getEffectiveDeadline(t)
                if (!dl) return false
                const d = new Date(dl)
                return d > todayEnd && d <= futureEnd
            })
            break
        }
    }

    // Sort: overdue first, then by deadline ascending
    filtered.sort((a, b) => {
        const aDl = getEffectiveDeadline(a)
        const bDl = getEffectiveDeadline(b)
        if (!aDl && !bDl) return 0
        if (!aDl) return 1
        if (!bDl) return -1
        return new Date(aDl).getTime() - new Date(bDl).getTime()
    })

    // Cap at 20 tasks (WA Flows list limit)
    const capped = filtered.slice(0, 20)
    const total = filtered.length
    const displayLabel = total > 20
        ? `${label}  ·  ${total} tasks (showing first 20)`
        : `${label}${total > 0 ? `  ·  ${total} task${total !== 1 ? 's' : ''}` : ''}`

    return {
        tasks: capped.map(buildTaskItem),
        label: displayLabel,
        summary: buildSummary(allTasks, userId),
    }
}

// ─── Dashboard summary ────────────────────────────────────────────────────────

function buildSummary(allTasks: Task[], userId: string): string {
    const now = new Date()
    const todayEnd = endOfDay(now)

    const todayCount = allTasks.filter(t => {
        if (!isActive(t)) return false
        if (!isTopLevelTask(t)) return false
        const dl = getEffectiveDeadline(t)
        if (!dl) return false
        return new Date(dl) <= todayEnd
    }).length

    const overdueCount = allTasks.filter(t => {
        if (!isTopLevelTask(t)) return false
        return isOverdue(t)
    }).length

    const actionCount = allTasks.filter(t => {
        if (!isActive(t)) return false
        if (!isTopLevelTask(t)) return false
        const info = getPendingInfo(t, userId, allTasks)
        return info.isPending && info.isPendingFromMe
    }).length

    const parts: string[] = []
    if (todayCount > 0) parts.push(`${todayCount} due today`)
    if (overdueCount > 0) parts.push(`${overdueCount} overdue`)
    if (actionCount > 0) parts.push(`${actionCount} need your action`)

    return parts.length > 0 ? parts.join('  ·  ') : 'You\'re all caught up!'
}

// ─── Task Detail ──────────────────────────────────────────────────────────────

export interface FlowTaskDetail {
    taskId: string
    title: string
    info: string   // multi-line formatted string
    actions: Array<{ id: string; title: string }>
}

export async function getTaskDetail(
    taskId: string,
    userId: string,
    orgId: string
): Promise<FlowTaskDetail | null> {
    const supabase = createAdminClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: task, error } = await (supabase as any)
        .from('tasks')
        .select(`
            id, title, description, organisation_id, status, priority,
            deadline, committed_deadline, parent_task_id, created_at, updated_at,
            created_by:users!tasks_created_by_fkey(id, name, phone_number),
            assigned_to:users!tasks_assigned_to_fkey(id, name, phone_number)
        `)
        .eq('id', taskId)
        .eq('organisation_id', orgId)
        .single()

    if (error || !task) return null

    const t = task as Task
    const dl = getEffectiveDeadline(t)
    const deadlineStr = dl ? format(new Date(dl), 'MMM d, yyyy') : 'No deadline'
    const ownerName = extractUserName(t.created_by) ?? 'Unknown'
    const assigneeName = extractUserName(t.assigned_to) ?? 'Unknown'
    const isTaskTodo = isTodo(t)

    const infoLines: string[] = [
        `📅  Due: ${deadlineStr}`,
        `📌  Status: ${statusLabel(t)}`,
    ]
    if (!isTaskTodo) {
        infoLines.push(`👑  Owner: ${ownerName}`)
        infoLines.push(`👤  Assignee: ${assigneeName}`)
    }

    // Get available actions from shared task-service logic
    const rawActions = getAvailableActions(t, userId)

    // Exclude create_subtask from Flow (future feature)
    const flowActions = rawActions
        .filter(a => a.type !== 'create_subtask')
        .map(a => ({
            id: a.type,
            title: actionEmoji(a.type) + '  ' + a.label,
        }))

    // Add "Send Follow-up Reminder" if there's a pending action from someone else
    // Fetch all org tasks to compute pendingInfo
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: orgTasks } = await (supabase as any)
        .from('tasks')
        .select('id, created_by, assigned_to, status, committed_deadline, parent_task_id')
        .eq('organisation_id', orgId)

    const pending = getPendingInfo(t, userId, (orgTasks ?? []) as Task[])
    if (pending.isPending && !pending.isPendingFromMe && pending.pendingFrom) {
        flowActions.push({
            id: 'send_followup',
            title: `📨  Send Follow-up to ${pending.pendingFrom.name ?? 'Assignee'}`,
        })
    }

    return {
        taskId: t.id,
        title: t.title,
        info: infoLines.join('\n'),
        actions: flowActions,
    }
}

function actionEmoji(type: string): string {
    switch (type) {
        case 'complete': return '✅'
        case 'edit_deadline': return '📅'
        case 'edit_persons': return '👤'
        case 'delete': return '🗑️'
        case 'accept': return '👍'
        case 'reject': return '👎'
        case 'send_followup': return '📨'
        default: return '•'
    }
}

// ─── Employee Search ──────────────────────────────────────────────────────────

export async function getEmployees(
    orgId: string,
    searchQuery?: string
): Promise<FlowEmployee[]> {
    const supabase = createAdminClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (supabase as any)
        .from('users')
        .select('id, name')
        .eq('organisation_id', orgId)
        .order('name', { ascending: true })
        .limit(20)

    if (searchQuery && searchQuery.trim().length > 0) {
        query = query.ilike('name', `%${searchQuery.trim()}%`)
    }

    const { data } = await query
    return ((data ?? []) as Array<{ id: string; name: string }>).map(u => ({
        id: u.id,
        title: u.name,
    }))
}

// ─── Task Actions ─────────────────────────────────────────────────────────────

export interface ActionResult {
    success: boolean
    message: string
    notifyPhone?: string
    notifyMessage?: string
}

/**
 * Execute a task action and return the success message + any party to notify.
 */
export async function executeTaskAction(
    taskId: string,
    userId: string,
    orgId: string,
    actionType: string,
    payload: {
        newDeadline?: string    // ISO date string from DatePicker
        selectedEmployee?: string  // userId of new assignee
        employeeSearch?: string    // search string (triggers re-query instead of commit)
    }
): Promise<ActionResult> {
    const supabase = createAdminClient()

    // Fetch the task first
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: task, error: fetchError } = await (supabase as any)
        .from('tasks')
        .select(`
            id, title, status, committed_deadline, deadline, organisation_id,
            created_by:users!tasks_created_by_fkey(id, name, phone_number),
            assigned_to:users!tasks_assigned_to_fkey(id, name, phone_number)
        `)
        .eq('id', taskId)
        .eq('organisation_id', orgId)
        .single()

    if (fetchError || !task) {
        return { success: false, message: 'Task not found or already deleted.' }
    }

    const t = task as Task

    // Verify the user has permission for this action
    const allowedActions = getAvailableActions(t, userId).map(a => a.type)
    if (actionType !== 'send_followup' && !allowedActions.includes(actionType as never)) {
        return { success: false, message: 'You don\'t have permission to perform this action.' }
    }

    switch (actionType) {
        case 'complete': {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { error } = await (supabase as any)
                .from('tasks')
                .update({ status: 'completed', updated_at: new Date().toISOString() })
                .eq('id', taskId)

            if (error) return { success: false, message: 'Failed to complete task. Please try again.' }

            // Cancel pending notifications
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (supabase as any)
                .from('task_notifications')
                .update({ status: 'cancelled', updated_at: new Date().toISOString() })
                .eq('task_id', taskId)
                .eq('status', 'pending')

            // Notify the other party
            const otherUser = isOwner(t, userId)
                ? extractOtherUserPhone(t.assigned_to)
                : extractOtherUserPhone(t.created_by)

            if (otherUser && !isTodo(t)) {
                return {
                    success: true,
                    message: `"${t.title}" marked as completed! The other party has been notified.`,
                    notifyPhone: otherUser.phone,
                    notifyMessage: `✅ *Task Completed!*\n\n"${t.title}"\n\nMarked as completed.`,
                }
            }
            return { success: true, message: `"${t.title}" marked as completed!` }
        }

        case 'edit_deadline': {
            if (!payload.newDeadline) {
                return { success: false, message: 'No deadline provided.' }
            }
            // DatePicker returns YYYY-MM-DD — convert to end-of-day ISO
            const deadlineISO = new Date(payload.newDeadline + 'T20:00:00').toISOString()

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { error } = await (supabase as any)
                .from('tasks')
                .update({
                    committed_deadline: deadlineISO,
                    status: t.status === 'pending' ? 'accepted' : t.status,
                    updated_at: new Date().toISOString()
                })
                .eq('id', taskId)

            if (error) return { success: false, message: 'Failed to update deadline.' }

            const formatted = format(new Date(deadlineISO), 'MMM d, yyyy')
            const ownerUser = extractOtherUserPhone(t.created_by)
            if (ownerUser && !isTodo(t) && !isOwner(t, userId)) {
                return {
                    success: true,
                    message: `Deadline updated to ${formatted}.`,
                    notifyPhone: ownerUser.phone,
                    notifyMessage: `📅 *Deadline Updated*\n\n"${t.title}"\n\nNew deadline: ${formatted}`,
                }
            }
            return { success: true, message: `Deadline updated to ${formatted}.` }
        }

        case 'edit_persons': {
            if (!payload.selectedEmployee) {
                return { success: false, message: 'No employee selected.' }
            }
            // Look up the new assignee
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data: newAssignee } = await (supabase as any)
                .from('users')
                .select('id, name, phone_number')
                .eq('id', payload.selectedEmployee)
                .single()

            if (!newAssignee) return { success: false, message: 'Employee not found.' }

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { error } = await (supabase as any)
                .from('tasks')
                .update({
                    assigned_to: newAssignee.id,
                    status: 'pending',
                    committed_deadline: null,
                    updated_at: new Date().toISOString()
                })
                .eq('id', taskId)

            if (error) return { success: false, message: 'Failed to update assignee.' }

            const newPhone = newAssignee.phone_number?.startsWith('91')
                ? newAssignee.phone_number
                : `91${newAssignee.phone_number}`

            return {
                success: true,
                message: `Task reassigned to ${newAssignee.name}. They'll be notified.`,
                notifyPhone: newPhone,
                notifyMessage: `📋 *Task Assigned to You*\n\n"${t.title}"\n\nPlease reply to confirm your deadline.`,
            }
        }

        case 'delete': {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { error } = await (supabase as any)
                .from('tasks')
                .update({ status: 'cancelled', updated_at: new Date().toISOString() })
                .eq('id', taskId)

            if (error) return { success: false, message: 'Failed to delete task.' }

            // Cancel pending notifications
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (supabase as any)
                .from('task_notifications')
                .update({ status: 'cancelled', updated_at: new Date().toISOString() })
                .eq('task_id', taskId)
                .eq('status', 'pending')

            const otherUser = !isOwner(t, userId)
                ? extractOtherUserPhone(t.created_by)
                : extractOtherUserPhone(t.assigned_to)

            if (otherUser && !isTodo(t)) {
                return {
                    success: true,
                    message: `"${t.title}" has been deleted.`,
                    notifyPhone: otherUser.phone,
                    notifyMessage: `🗑️ *Task Deleted*\n\n"${t.title}"\n\nThis task has been deleted.`,
                }
            }
            return { success: true, message: `"${t.title}" has been deleted.` }
        }

        case 'accept': {
            if (!payload.newDeadline) {
                return { success: false, message: 'Please provide a deadline to accept this task.' }
            }
            const deadlineISO = new Date(payload.newDeadline + 'T20:00:00').toISOString()
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { error } = await (supabase as any)
                .from('tasks')
                .update({
                    committed_deadline: deadlineISO,
                    status: 'accepted',
                    updated_at: new Date().toISOString()
                })
                .eq('id', taskId)

            if (error) return { success: false, message: 'Failed to accept task.' }

            const formatted = format(new Date(deadlineISO), 'MMM d, yyyy')
            const ownerUser = extractOtherUserPhone(t.created_by)
            if (ownerUser) {
                return {
                    success: true,
                    message: `Task accepted! You've committed to ${formatted}.`,
                    notifyPhone: ownerUser.phone,
                    notifyMessage: `👍 *Task Accepted*\n\n"${t.title}"\n\nCommitted deadline: ${formatted}`,
                }
            }
            return { success: true, message: `Task accepted! Committed to ${formatted}.` }
        }

        case 'reject': {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { error } = await (supabase as any)
                .from('tasks')
                .update({ status: 'cancelled', updated_at: new Date().toISOString() })
                .eq('id', taskId)

            if (error) return { success: false, message: 'Failed to reject task.' }

            const ownerUser = extractOtherUserPhone(t.created_by)
            if (ownerUser) {
                return {
                    success: true,
                    message: 'Task rejected. The owner has been notified.',
                    notifyPhone: ownerUser.phone,
                    notifyMessage: `👎 *Task Rejected*\n\n"${t.title}"\n\nThe assignee has rejected this task.`,
                }
            }
            return { success: true, message: 'Task rejected.' }
        }

        case 'send_followup': {
            // Fetch pending info to find who to ping
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data: orgTasks } = await (supabase as any)
                .from('tasks')
                .select('id, created_by, assigned_to, status, committed_deadline, parent_task_id')
                .eq('organisation_id', orgId)

            const pending = getPendingInfo(t, userId, (orgTasks ?? []) as Task[])
            if (!pending.isPending || !pending.pendingFrom) {
                return { success: false, message: 'No pending action found to follow up on.' }
            }

            // Look up their phone
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data: pendingUser } = await (supabase as any)
                .from('users')
                .select('phone_number, name')
                .eq('id', pending.pendingFrom.id)
                .single()

            if (!pendingUser?.phone_number) {
                return { success: false, message: 'Could not find contact info for the pending person.' }
            }

            const theirPhone = pendingUser.phone_number.startsWith('91')
                ? pendingUser.phone_number
                : `91${pendingUser.phone_number}`

            const ownerName = extractUserName(t.created_by) ?? 'Your manager'

            return {
                success: true,
                message: `Follow-up sent to ${pendingUser.name ?? 'the assignee'}.`,
                notifyPhone: theirPhone,
                notifyMessage: `⏰ *Reminder*\n\n"${t.title}"\n\nRequested by: ${ownerName}\n\nPlease respond to this task at your earliest.`,
            }
        }

        default:
            return { success: false, message: 'Unknown action.' }
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractOtherUserPhone(
    userRef: unknown
): { phone: string; name: string } | null {
    if (!userRef || typeof userRef !== 'object') return null
    const u = userRef as Record<string, unknown>
    const phone = u.phone_number as string | undefined
    const name = u.name as string | undefined
    if (!phone) return null
    const intlPhone = phone.startsWith('91') ? phone : `91${phone}`
    return { phone: intlPhone, name: name ?? 'Unknown' }
}
