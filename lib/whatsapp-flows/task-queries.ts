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
    extractUserId,
    isTodo,
    isActive,
    isOverdue,
    isOwner,
    isAssignee,
    getAvailableActions,
    getPendingInfo,
    getEffectiveDeadline,
} from '@/lib/task-service'
import {
    notifyTaskAccepted,
    notifyTaskRejected,
    notifyTaskCompleted,
    notifyDeadlineEdited,
    notifyAssigneeChanged,
    notifyTaskCancelled,
} from '@/lib/notifications/whatsapp-notifier'
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
        ? `${label}  ·  (showing first 20)`
        : label

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
}

/**
 * Execute a task action and return the success message.
 * Notifications and Audit Logs are dispatched fire-and-forget in the background.
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

    const userIdIsOwner = isOwner(t, userId)
    const userIdIsAssignee = isAssignee(t, userId)
    const isTaskTodo = isTodo(t)
    const isSubtask = !!t.parent_task_id
    const tAssigneeId = extractUserId(t.assigned_to) as string
    const tOwnerId = extractUserId(t.created_by) as string

    // Fetch user details for audit logs and notifications
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: currentUserData } = await (supabase as any)
        .from('users')
        .select('name')
        .eq('id', userId)
        .single()
    const currentUserName = currentUserData?.name || 'A team member'

    switch (actionType) {
        case 'complete': {
            if (!userIdIsOwner) {
                return { success: false, message: 'Only the owner can complete a task.' }
            }

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { error } = await (supabase as any)
                .from('tasks')
                .update({ status: 'completed', updated_at: new Date().toISOString() })
                .eq('id', taskId)

            if (error) return { success: false, message: 'Failed to complete task. Please try again.' }

            const [updateResult] = await Promise.allSettled([
                // Cancel pending notifications
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (supabase as any)
                    .from('task_notifications')
                    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
                    .eq('task_id', taskId)
                    .eq('status', 'pending'),
                // Audit log for completion
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (supabase as any).from("audit_log").insert({
                    user_id: userId,
                    organisation_id: orgId,
                    action: isSubtask ? "subtask.completed" : isTaskTodo ? "todo.completed" : "task.completed",
                    entity_type: "task",
                    entity_id: taskId
                }),
                // If subtask, also log to the parent task timeline
                isSubtask && t.parent_task_id
                    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (supabase as any).from("audit_log").insert({
                        user_id: userId,
                        organisation_id: orgId,
                        action: "subtask.completed",
                        entity_type: "task",
                        entity_id: t.parent_task_id,
                        metadata: {
                            subtask_id: taskId,
                            subtask_title: t.title,
                        }
                    })
                    : Promise.resolve(),
                // Fire central notification
                notifyTaskCompleted(supabase, {
                    ownerId: userId,
                    ownerName: currentUserName,
                    assigneeId: tAssigneeId,
                    taskTitle: t.title || 'Untitled task',
                    taskId: taskId,
                    source: 'whatsapp',
                }).catch(err => console.error('[FlowQueries] Notification error (complete):', err))
            ])

            if (updateResult.status === 'rejected') {
                console.error('[FlowQueries] Promise error (complete):', updateResult.reason);
            }

            return { success: true, message: `"${t.title}" marked as completed!` }
        }

        case 'edit_deadline': {
            if (!userIdIsAssignee && !userIdIsOwner) {
                return { success: false, message: 'Only the assignee or owner can edit the deadline.' }
            }
            if (!payload.newDeadline) {
                return { success: false, message: 'No deadline provided.' }
            }
            // DatePicker returns string in YYYY-MM-DDTHH:MM:00 (without TZ) so we append IST timezone
            const deadlineISO = new Date(payload.newDeadline + '+05:30').toISOString()

            // Reject past deadlines
            if (new Date(deadlineISO).getTime() < Date.now()) {
                return { success: false, message: 'Deadline cannot be in the past.' }
            }

            const updateData: Record<string, string> = {
                updated_at: new Date().toISOString(),
                deadline: deadlineISO
            }

            // Sync with web route logic: only modify committed_deadline if it already exists
            if (t.committed_deadline) {
                updateData.committed_deadline = deadlineISO
            }

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { error } = await (supabase as any)
                .from('tasks')
                .update(updateData)
                .eq('id', taskId)

            if (error) return { success: false, message: 'Failed to update deadline.' }

            const [updateResult] = await Promise.allSettled([
                // Audit log for deadline edit
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (supabase as any).from("audit_log").insert({
                    user_id: userId,
                    organisation_id: orgId,
                    action: "task.deadline_edited",
                    entity_type: "task",
                    entity_id: taskId,
                    metadata: { old_deadline: t.deadline, new_deadline: deadlineISO }
                }),
                // Fire central notification
                notifyDeadlineEdited(supabase, {
                    ownerId: tOwnerId,
                    assigneeId: tAssigneeId,
                    actorId: userId,
                    actorName: currentUserName,
                    taskTitle: t.title || 'Untitled task',
                    taskId: taskId,
                    newDeadline: deadlineISO,
                    source: 'whatsapp',
                }).catch(err => console.error('[FlowQueries] Notification error (edit_deadline):', err))
            ])

            if (updateResult.status === 'rejected') {
                console.error('[FlowQueries] Promise error (edit_deadline):', updateResult.reason);
            }

            const formatted = format(new Date(deadlineISO), 'MMM d, yyyy h:mm a')
            return { success: true, message: `Deadline updated to ${formatted}.` }
        }

        case 'edit_persons': {
            if (!userIdIsOwner) {
                return { success: false, message: 'Only the owner can change the assignee.' }
            }
            if (!payload.selectedEmployee) {
                return { success: false, message: 'No employee selected.' }
            }

            // Look up the new assignee
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data: newAssignee } = await (supabase as any)
                .from('users')
                .select('id, name')
                .eq('id', payload.selectedEmployee)
                .single()

            if (!newAssignee) return { success: false, message: 'Employee not found.' }

            // Sync with web route logic: if assigning to self (creator), it's a To-do and auto-accepts
            const isSelfAssign = payload.selectedEmployee === userId;
            const updateData: Record<string, unknown> = {
                assigned_to: newAssignee.id,
                updated_at: new Date().toISOString(),
            }

            if (!isSelfAssign && newAssignee.id !== t.assigned_to) {
                updateData.status = 'pending'
                updateData.committed_deadline = null
            } else if (isSelfAssign) {
                updateData.status = 'accepted'
                if (!t.committed_deadline && t.deadline) {
                    updateData.committed_deadline = t.deadline
                }
            }

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { error } = await (supabase as any)
                .from('tasks')
                .update(updateData)
                .eq('id', taskId)

            if (error) return { success: false, message: 'Failed to update assignee.' }

            const oldAssigneeName = extractUserName(t.assigned_to)

            const [updateResult] = await Promise.allSettled([
                // Audit log for reassignment
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (supabase as any).from("audit_log").insert({
                    user_id: userId,
                    organisation_id: orgId,
                    action: "task.reassigned",
                    entity_type: "task",
                    entity_id: taskId,
                    metadata: {
                        old_assigned_to: tAssigneeId,
                        new_assigned_to: newAssignee.id,
                        old_name: oldAssigneeName,
                        new_name: newAssignee.name
                    }
                }),
                // Fire central notification
                notifyAssigneeChanged(supabase, {
                    ownerId: userId,
                    ownerName: currentUserName,
                    oldAssigneeId: tAssigneeId,
                    newAssigneeId: newAssignee.id,
                    newAssigneeName: newAssignee.name || 'the new assignee',
                    taskTitle: t.title || 'Untitled task',
                    taskId: taskId,
                    source: 'whatsapp',
                }).catch(err => console.error('[FlowQueries] Notification error (edit_persons):', err))
            ])

            if (updateResult.status === 'rejected') {
                console.error('[FlowQueries] Promise error (edit_persons):', updateResult.reason);
            }

            return {
                success: true,
                message: `Task reassigned to ${newAssignee.name}. They will be notified.`,
            }
        }

        case 'delete': {
            if (!userIdIsOwner) {
                return { success: false, message: 'Only the owner can delete a task.' }
            }

            // Cancel all active subtasks recursively (sync with web route)
            const cancelSubtasks = async (parentId: string): Promise<void> => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const { data: subs } = await (supabase as any)
                    .from("tasks")
                    .select("id")
                    .eq("parent_task_id", parentId)
                    .in("status", ["pending", "accepted", "overdue"]);

                if (subs && subs.length > 0) {
                    const subIds = subs.map((s: { id: string }) => s.id);
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    await (supabase as any)
                        .from("tasks")
                        .update({
                            status: "cancelled",
                            updated_at: new Date().toISOString(),
                        })
                        .in("id", subIds);

                    for (const subId of subIds) {
                        await cancelSubtasks(subId);
                    }
                }
            };

            const [updateResult] = await Promise.allSettled([
                cancelSubtasks(taskId),
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (supabase as any)
                    .from('tasks')
                    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
                    .eq('id', taskId),
                // Cancel pending notifications
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (supabase as any)
                    .from('task_notifications')
                    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
                    .eq('task_id', taskId)
                    .eq('status', 'pending'),
                // Audit log for deletion
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (supabase as any).from("audit_log").insert({
                    user_id: userId,
                    organisation_id: orgId,
                    action: "task.deleted",
                    entity_type: "task",
                    entity_id: taskId
                }),
                // Fire central notification
                notifyTaskCancelled(supabase, {
                    ownerId: userId,
                    ownerName: currentUserName,
                    assigneeId: tAssigneeId,
                    taskTitle: t.title || 'Untitled task',
                    taskId: taskId,
                    source: 'whatsapp',
                }).catch(err => console.error('[FlowQueries] Notification error (delete):', err))
            ])

            if (updateResult.status === 'rejected') {
                console.error('[FlowQueries] Promise error (delete):', updateResult.reason);
                return { success: false, message: 'Failed to delete task.' }
            }

            return { success: true, message: `"${t.title}" has been deleted.` }
        }

        case 'accept': {
            if (!userIdIsAssignee) {
                return { success: false, message: 'Only the assignee can accept a task.' }
            }
            if (t.status !== 'pending') {
                return { success: false, message: 'Task can only be accepted when pending.' }
            }
            if (!payload.newDeadline) {
                return { success: false, message: 'Please provide a deadline to accept this task.' }
            }
            // Add IST timezone for proper parsing
            const deadlineISO = new Date(payload.newDeadline + '+05:30').toISOString()

            if (new Date(deadlineISO).getTime() < Date.now()) {
                return { success: false, message: 'Deadline cannot be in the past.' }
            }

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

            const [updateResult] = await Promise.allSettled([
                // Audit log for accept
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (supabase as any).from("audit_log").insert({
                    user_id: userId,
                    organisation_id: orgId,
                    action: "task.accepted",
                    entity_type: "task",
                    entity_id: taskId,
                    metadata: { committed_deadline: deadlineISO }
                }),
                // Fire central notification
                notifyTaskAccepted(supabase, {
                    ownerId: tOwnerId,
                    assigneeId: userId,
                    assigneeName: currentUserName,
                    taskTitle: t.title || 'Untitled task',
                    taskId: taskId,
                    committedDeadline: deadlineISO,
                    source: 'whatsapp',
                }).catch(err => console.error('[FlowQueries] Notification error (accept):', err))
            ])

            if (updateResult.status === 'rejected') {
                console.error('[FlowQueries] Promise error (accept):', updateResult.reason);
            }

            const formatted = format(new Date(deadlineISO), 'MMM d, yyyy h:mm a')
            return { success: true, message: `Task accepted! Committed to ${formatted}.` }
        }

        case 'reject': {
            if (!userIdIsAssignee) {
                return { success: false, message: 'Only the assignee can reject a task.' }
            }
            if (t.status !== 'pending') {
                return { success: false, message: 'Task can only be rejected when pending.' }
            }

            // Flow currently doesn't prompt for a reject reason string, so use null
            const rejectReason = null

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { error } = await (supabase as any)
                .from('tasks')
                .update({ status: 'rejected', updated_at: new Date().toISOString() })
                .eq('id', taskId)

            if (error) return { success: false, message: 'Failed to reject task.' }

            const [updateResult] = await Promise.allSettled([
                // Audit log for reject
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (supabase as any).from("audit_log").insert({
                    user_id: userId,
                    organisation_id: orgId,
                    action: "task.rejected",
                    entity_type: "task",
                    entity_id: taskId,
                    metadata: { reject_reason: rejectReason }
                }),
                // Fire central notification
                notifyTaskRejected(supabase, {
                    ownerId: tOwnerId,
                    assigneeId: userId,
                    assigneeName: currentUserName,
                    taskTitle: t.title || 'Untitled task',
                    taskId: taskId,
                    reason: rejectReason,
                    source: 'whatsapp',
                }).catch(err => console.error('[FlowQueries] Notification error (reject):', err))
            ])

            if (updateResult.status === 'rejected') {
                console.error('[FlowQueries] Promise error (reject):', updateResult.reason);
            }

            return { success: true, message: 'Task rejected. The owner has been notified.' }
        }

        // Send follow up hasn't changed its core logic, still needs central unification if feasible,
        // but 'route.ts' doesn't support 'send_followup'. It's a flow-exclusive action right now.
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
            const msg = `⏰ *Reminder*\n\n"${t.title}"\n\nRequested by: ${ownerName}\n\nPlease respond to this task at your earliest.`

            // Fire and forget text via whatsapp direct (since send_followup is not a native notification event type)
            // Need lazy import to avoid circular dependency
            import('@/lib/whatsapp')
                .then(({ sendWhatsAppMessage }) => {
                    sendWhatsAppMessage(theirPhone, msg).catch(err =>
                        console.error('[FlowQueries] Failed to send followup notification:', err)
                    )
                })
                .catch(() => { /* ignore */ })

            return {
                success: true,
                message: `Follow-up sent to ${pendingUser.name ?? 'the assignee'}.`,
            }
        }

        default:
            return { success: false, message: 'Unknown action.' }
    }
}


