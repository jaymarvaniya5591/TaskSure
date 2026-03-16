import { NextRequest, NextResponse } from "next/server";

export const preferredRegion = 'sin1';

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveCurrentUser } from "@/lib/user";
import {
    notifyTaskAccepted,
    notifyTaskRejected,
    notifyTaskCompleted,
    notifyDeadlineEdited,
    notifyAssigneeChanged,
    notifyTaskCancelled,
    notifyReviewRequested,
    notifyReviewCommentAdded,
} from '@/lib/notifications/whatsapp-notifier'
import { cancelPendingNotifications } from '@/lib/notifications/task-notification-scheduler'
import { isRateLimited } from '@/lib/rate-limit'

/**
 * PATCH /api/tasks/[taskId]
 *
 * Supported actions:
 *   accept          — Assignee accepts task by setting committed_deadline
 *   reject          — Assignee rejects task with a reason
 *   complete        — Owner marks task as completed
 *   edit_deadline   — Assignee/owner changes the deadline
 *   edit_persons    — Owner changes the assignee
 *   delete          — Owner deletes (cancels) the task and all active subtasks
 */
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ taskId: string }> }
) {
    const { taskId } = await params;
    const supabase = await createClient();

    // PERF: Run auth resolution, task fetch, and body parse in PARALLEL
    // This cuts setup from 3 sequential network calls to 2 round-trips.
    const [currentUser, taskResult, body] = await Promise.all([
        resolveCurrentUser(supabase),
        supabase
            .from("tasks")
            .select("id, title, assigned_to, created_by, status, organisation_id, deadline, committed_deadline, parent_task_id, review_requested_at")
            .eq("id", taskId)
            .single(),
        request.json(),
    ]);

    if (!currentUser) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: task, error: fetchError } = taskResult;
    const { action } = body;

    if (fetchError || !task) {
        return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const userId = currentUser.id;

    // Bug 3.2: Rate limit task mutations — 30 per minute per user (prevents cyclic reassignment loops)
    if (isRateLimited('task_patch', userId, 30, 60_000)) {
        return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });
    }

    const isAssignee = task.assigned_to === userId;
    const isCreator = task.created_by === userId;

    switch (action) {
        // ── ACCEPT: Assignee sets committed deadline ──
        case "accept": {
            if (!isAssignee) {
                return NextResponse.json({ error: "Only the assignee can accept a task" }, { status: 403 });
            }
            // BUG 2.3: Distinguish deleted task from "not pending" — return 409 for cancelled
            if (task.status === "cancelled") {
                return NextResponse.json({ error: "This task has been deleted" }, { status: 409 });
            }
            if (task.status !== "pending") {
                return NextResponse.json({ error: "Task can only be accepted when pending" }, { status: 400 });
            }
            const { committed_deadline } = body;
            if (!committed_deadline) {
                return NextResponse.json({ error: "Committed deadline is required when accepting" }, { status: 400 });
            }

            // Reject past deadlines
            if (new Date(committed_deadline).getTime() < Date.now()) {
                return NextResponse.json({ error: "Deadline cannot be in the past" }, { status: 400 });
            }

            const adminDb = createAdminClient();
            
            // 1. Perform database update FIRST
            const { data: updateData, error: updateError } = await supabase
                .from("tasks")
                .update({
                    status: "accepted",
                    committed_deadline,
                    updated_at: new Date().toISOString(),
                })
                .eq("id", taskId)
                .eq("status", "pending")
                .select("id");

            // BUG 2.1: If zero rows updated, another request already changed the status (race condition)
            if (updateError) {
                return NextResponse.json({ error: updateError.message }, { status: 500 });
            }
            if (!updateData || updateData.length === 0) {
                return NextResponse.json({ error: "Task state has already changed" }, { status: 409 });
            }

            // 2. Run audit log and notification in parallel only after successful update
            await Promise.allSettled([
                supabase.from("audit_log").insert({
                    user_id: userId,
                    organisation_id: task.organisation_id,
                    action: "task.accepted",
                    entity_type: "task",
                    entity_id: taskId,
                    metadata: { committed_deadline }
                }),
                notifyTaskAccepted(adminDb, {
                    ownerId: task.created_by,
                    assigneeId: userId,
                    assigneeName: currentUser.name || 'The assignee',
                    taskTitle: task.title || 'Untitled task',
                    taskId: taskId,
                    committedDeadline: committed_deadline,
                    source: 'dashboard',
                }).catch(err => console.error('[TaskPatch] Notification error (accept):', err)),
            ]);

            return NextResponse.json({ success: true, status: "accepted" });
        }

        // ── REJECT: Assignee rejects with a reason ──
        case "reject": {
            if (!isAssignee) {
                return NextResponse.json({ error: "Only the assignee can reject a task" }, { status: 403 });
            }
            // BUG 2.3: Distinguish deleted task from "not pending" — return 409 for cancelled
            if (task.status === "cancelled") {
                return NextResponse.json({ error: "This task has been deleted" }, { status: 409 });
            }
            if (task.status !== "pending") {
                return NextResponse.json({ error: "Task can only be rejected when pending" }, { status: 400 });
            }

            const { reject_reason } = body;

            const adminDb = createAdminClient();

            // 1. Perform database update FIRST
            const { data: updateData, error: updateError } = await supabase
                .from("tasks")
                .update({
                    status: "rejected",
                    updated_at: new Date().toISOString(),
                })
                .eq("id", taskId)
                .eq("status", "pending")
                .select("id");

            // BUG 2.1: If zero rows updated, another request already changed the status (race condition)
            if (updateError) {
                return NextResponse.json({ error: updateError.message }, { status: 500 });
            }
            if (!updateData || updateData.length === 0) {
                return NextResponse.json({ error: "Task state has already changed" }, { status: 409 });
            }

            // 2. Run comment, audit log, and notification in parallel only after successful update
            await Promise.allSettled([
                reject_reason
                    ? supabase.from("task_comments").insert({
                        task_id: taskId,
                        user_id: userId,
                        content: `Rejected: ${reject_reason}`,
                    })
                    : Promise.resolve(),
                supabase.from("audit_log").insert({
                    user_id: userId,
                    organisation_id: task.organisation_id,
                    action: "task.rejected",
                    entity_type: "task",
                    entity_id: taskId,
                    metadata: { reject_reason }
                }),
                notifyTaskRejected(adminDb, {
                    ownerId: task.created_by,
                    assigneeId: userId,
                    assigneeName: currentUser.name || 'The assignee',
                    taskTitle: task.title || 'Untitled task',
                    taskId: taskId,
                    reason: reject_reason || null,
                    source: 'dashboard',
                }).catch(err => console.error('[TaskPatch] Notification error (reject):', err)),
            ]);

            return NextResponse.json({ success: true, status: "rejected" });
        }

        // ── COMPLETE: Owner marks task as completed ──
        case "complete": {
            if (!isCreator) {
                return NextResponse.json({ error: "Only the owner (creator) can complete a task" }, { status: 403 });
            }

            // parent_task_id is already in the initial fetch — no 2nd query needed
            const isTodo = task.created_by === task.assigned_to;
            const isSubtask = !!task.parent_task_id;

            // BUG 3.2: Block subtask completion when parent task is rejected
            if (isSubtask && task.parent_task_id) {
                const { data: parentTask } = await supabase
                    .from("tasks")
                    .select("status")
                    .eq("id", task.parent_task_id)
                    .single();
                if (parentTask?.status === "rejected") {
                    return NextResponse.json({ error: "Cannot complete subtask while the parent task is rejected" }, { status: 400 });
                }
            }

            const adminDb = createAdminClient();

            // 1. Perform database update FIRST (also clear review_requested_at if set)
            const { data: updateData, error: updateError } = await supabase
                .from("tasks")
                .update({
                    status: "completed",
                    review_requested_at: null,
                    updated_at: new Date().toISOString(),
                })
                .eq("id", taskId)
                .in("status", ["accepted", "overdue"])
                .select("id");

            // If zero rows updated, task was not in an acceptable state (race condition or bad state)
            if (updateError) {
                return NextResponse.json({ error: updateError.message }, { status: 500 });
            }
            if (!updateData || updateData.length === 0) {
                return NextResponse.json({ error: "Task cannot be completed in its current state" }, { status: 409 });
            }

            // 2. Run notification and audit logs in parallel only after successful update
            await Promise.allSettled([
                supabase.from("audit_log").insert({
                    user_id: userId,
                    organisation_id: task.organisation_id,
                    action: isSubtask ? "subtask.completed" : isTodo ? "todo.completed" : "task.completed",
                    entity_type: "task",
                    entity_id: taskId
                }),
                // If subtask, also log to the parent task timeline
                isSubtask && task.parent_task_id
                    ? supabase.from("audit_log").insert({
                        user_id: userId,
                        organisation_id: task.organisation_id,
                        action: "subtask.completed",
                        entity_type: "task",
                        entity_id: task.parent_task_id,
                        metadata: {
                            subtask_id: taskId,
                            subtask_title: task.title,
                        }
                    })
                    : Promise.resolve(),
                notifyTaskCompleted(adminDb, {
                    ownerId: userId,
                    ownerName: currentUser.name || 'The task owner',
                    assigneeId: task.assigned_to,
                    taskTitle: task.title || 'Untitled task',
                    taskId: taskId,
                    source: 'dashboard',
                }).catch(err => console.error('[TaskPatch] Notification error (complete):', err)),
            ]);

            return NextResponse.json({ success: true, status: "completed" });
        }

        // ── EDIT DEADLINE: Assignee or owner changes deadline ──
        case "edit_deadline": {
            if (!isAssignee && !isCreator) {
                return NextResponse.json({ error: "Only the assignee or owner can edit the deadline" }, { status: 403 });
            }

            const { new_deadline } = body;
            if (!new_deadline) {
                return NextResponse.json({ error: "new_deadline is required" }, { status: 400 });
            }

            // Reject past deadlines
            if (new Date(new_deadline).getTime() < Date.now()) {
                return NextResponse.json({ error: "Deadline cannot be in the past" }, { status: 400 });
            }

            const updateData: Record<string, string> = {
                updated_at: new Date().toISOString(),
            };

            // Reset overdue status if the deadline is extended to the future
            if (task.status === "overdue") {
                updateData.status = "accepted";
            }

            // If the task has a committed_deadline, update that too
            if (task.committed_deadline) {
                updateData.committed_deadline = new_deadline;
            }
            updateData.deadline = new_deadline;

            const adminDb = createAdminClient();

            // 1. Perform database update FIRST
            const { data: deadlineUpdateData, error: deadlineUpdateError } = await supabase
                .from("tasks")
                .update(updateData)
                .eq("id", taskId)
                .not("status", "eq", "cancelled") // Bug 1.1: prevent editing a deleted task
                .select("id");                     // Bug 1.1: enables row-count check

            // Bug 1.1: Zero rows = task was cancelled/deleted before this write landed
            if (deadlineUpdateError) {
                return NextResponse.json({ error: deadlineUpdateError.message }, { status: 500 });
            }
            if (!deadlineUpdateData || deadlineUpdateData.length === 0) {
                return NextResponse.json({ error: "Task is no longer active and cannot be edited" }, { status: 409 });
            }

            // 2. Run audit log and notification in parallel only after successful update
            await Promise.allSettled([
                supabase.from("audit_log").insert({
                    user_id: userId,
                    organisation_id: task.organisation_id,
                    action: "task.deadline_edited",
                    entity_type: "task",
                    entity_id: taskId,
                    metadata: { old_deadline: task.deadline, new_deadline }
                }),
                notifyDeadlineEdited(adminDb, {
                    ownerId: task.created_by,
                    assigneeId: task.assigned_to,
                    actorId: userId,
                    actorName: currentUser.name || 'A team member',
                    taskTitle: task.title || 'Untitled task',
                    taskId: taskId,
                    newDeadline: new_deadline,
                    source: 'dashboard',
                }).catch(err => console.error('[TaskPatch] Notification error (edit_deadline):', err)),
            ]);

            return NextResponse.json({ success: true, deadline: new_deadline });
        }

        // ── EDIT PERSONS: Owner changes the assignee ──
        case "edit_persons": {
            if (!isCreator) {
                return NextResponse.json({ error: "Only the owner can change the assignee" }, { status: 403 });
            }
            // Bug 2.1: Block conversion of a completed task — the resulting task
            // would be created as "pending", forcing the assignee to re-complete it.
            if (task.status === "completed") {
                return NextResponse.json({ error: "Cannot reassign a completed task" }, { status: 400 });
            }

            const { new_assigned_to, old_assigned_name, new_assigned_name } = body;
            if (!new_assigned_to) {
                return NextResponse.json({ error: "new_assigned_to is required" }, { status: 400 });
            }

            // BUG 1.1: Validate new assignee exists in the same organisation
            const adminDb = createAdminClient();
            const { data: newAssigneeCheck } = await adminDb
                .from("users")
                .select("id")
                .eq("id", new_assigned_to)
                .eq("organisation_id", task.organisation_id)
                .single();
            if (!newAssigneeCheck) {
                return NextResponse.json({ error: "Assigned user not found in your organisation" }, { status: 400 });
            }

            // If changing to a different person, reset to pending so they can accept
            const isSelfAssign = new_assigned_to === userId;
            const wasToDoBeforeReassign = task.created_by === task.assigned_to;
            const nowBecomesTask = wasToDoBeforeReassign && !isSelfAssign;
            const updateData: Record<string, unknown> = {
                assigned_to: new_assigned_to,
                updated_at: new Date().toISOString(),
            };

            // BUG 2.2: Also reset when reassigning to same person who previously rejected
            if (!isSelfAssign && (new_assigned_to !== task.assigned_to || task.status === "rejected")) {
                // New assignee needs to accept → reset to pending
                updateData.status = "pending";
                updateData.committed_deadline = null;
            } else if (isSelfAssign) {
                // Converting to a to-do → auto-accept
                updateData.status = "accepted";
                if (!task.committed_deadline && task.deadline) {
                    updateData.committed_deadline = task.deadline;
                }
            }

            // Bug 3.4: When a personal To-Do is converted into a delegated Task, reset
            // created_at so SLA aging metrics start from the moment of delegation, not
            // from when the original To-Do was created days/weeks earlier.
            // Merged into updateData so both changes happen atomically in one query.
            // Requires adminDb (service role) since RLS restricts created_at updates.
            if (nowBecomesTask) {
                updateData.created_at = new Date().toISOString();
            }

            // 1. Perform database update FIRST
            // Use adminDb when nowBecomesTask so the service role can write created_at.
            const { error: personsUpdateError } = await (nowBecomesTask ? adminDb : supabase)
                .from("tasks")
                .update(updateData)
                .eq("id", taskId);

            if (personsUpdateError) {
                return NextResponse.json({ error: personsUpdateError.message }, { status: 500 });
            }

            // 2. Run audit log, and notification in parallel only after successful update.
            await Promise.allSettled([
                supabase.from("audit_log").insert({
                    user_id: userId,
                    organisation_id: task.organisation_id,
                    action: "task.reassigned",
                    entity_type: "task",
                    entity_id: taskId,
                    metadata: {
                        old_assigned_to: task.assigned_to,
                        new_assigned_to,
                        old_name: old_assigned_name,
                        new_name: new_assigned_name
                    }
                }),
                notifyAssigneeChanged(adminDb, {
                    ownerId: userId,
                    ownerName: currentUser.name || 'The task owner',
                    oldAssigneeId: task.assigned_to,
                    newAssigneeId: new_assigned_to,
                    newAssigneeName: new_assigned_name || 'the new assignee',
                    taskTitle: task.title || 'Untitled task',
                    taskId: taskId,
                    source: 'dashboard',
                }).catch(err => console.error('[TaskPatch] Notification error (edit_persons):', err)),
            ]);

            return NextResponse.json({ success: true, assigned_to: new_assigned_to });
        }

        // ── DELETE: Owner cancels the task and all active subtasks ──
        case "delete": {
            if (!isCreator) {
                return NextResponse.json({ error: "Only the owner can delete a task" }, { status: 403 });
            }

            const adminDb = createAdminClient();

            // Cancel all active subtasks recursively
            const cancelSubtasks = async (parentId: string): Promise<void> => {
                const { data: subs } = await supabase
                    .from("tasks")
                    .select("id")
                    .eq("parent_task_id", parentId)
                    .in("status", ["pending", "accepted", "overdue"]);

                if (subs && subs.length > 0) {
                    const subIds = subs.map(s => s.id);
                    await supabase
                        .from("tasks")
                        .update({
                            status: "cancelled",
                            updated_at: new Date().toISOString(),
                        })
                        .in("id", subIds);

                    // Recurse
                    for (const subId of subIds) {
                        await cancelSubtasks(subId);
                    }
                }
            };

            // 1. Perform database update for main task FIRST
            const { error: updateError } = await supabase
                .from("tasks")
                .update({
                    status: "cancelled",
                    updated_at: new Date().toISOString(),
                })
                .eq("id", taskId);

            if (updateError) {
                return NextResponse.json({ error: updateError.message }, { status: 500 });
            }

            // 2. Run subtask cancellation, audit log, notification, and pending notification
            // cancellation in parallel only after successful update.
            await Promise.allSettled([
                cancelSubtasks(taskId),
                supabase.from("audit_log").insert({
                    user_id: userId,
                    organisation_id: task.organisation_id,
                    action: "task.deleted",
                    entity_type: "task",
                    entity_id: taskId
                }),
                notifyTaskCancelled(adminDb, {
                    ownerId: userId,
                    ownerName: currentUser.name || 'The task owner',
                    assigneeId: task.assigned_to,
                    taskTitle: task.title || 'Untitled task',
                    taskId: taskId,
                    source: 'dashboard',
                }).catch(err => console.error('[TaskPatch] Notification error (delete):', err)),
                // Cancel all scheduled notifications for this task so the cron job
                // does not attempt to send reminders after deletion.
                cancelPendingNotifications(taskId, undefined, adminDb)
                    .catch(err => console.error('[TaskPatch] Failed to cancel notifications on delete:', err)),
            ]);

            return NextResponse.json({ success: true, status: "cancelled" });
        }

        // ── REQUEST REVIEW: Assignee requests owner to review their work ──
        case "request_review": {
            if (!isAssignee || isCreator) {
                return NextResponse.json({ error: "Only the assignee (not the owner) can request a review" }, { status: 403 });
            }
            if (!["accepted", "overdue"].includes(task.status)) {
                return NextResponse.json({ error: "Review can only be requested on accepted or overdue tasks" }, { status: 400 });
            }
            if (task.review_requested_at) {
                return NextResponse.json({ error: "Review has already been requested for this task" }, { status: 400 });
            }

            const adminDb = createAdminClient();

            // 1. Perform database update FIRST
            const { data: updateData, error: updateError } = await supabase
                .from("tasks")
                .update({
                    review_requested_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                })
                .eq("id", taskId)
                .is("review_requested_at", null)
                .select("id");

            if (updateError) {
                return NextResponse.json({ error: updateError.message }, { status: 500 });
            }
            if (!updateData || updateData.length === 0) {
                return NextResponse.json({ error: "Review has already been requested" }, { status: 409 });
            }

            // 2. Run audit log and notification in parallel
            await Promise.allSettled([
                supabase.from("audit_log").insert({
                    user_id: userId,
                    organisation_id: task.organisation_id,
                    action: "task.review_requested",
                    entity_type: "task",
                    entity_id: taskId,
                }),
                notifyReviewRequested(adminDb, {
                    ownerId: task.created_by,
                    assigneeId: userId,
                    assigneeName: currentUser.name || 'The assignee',
                    taskTitle: task.title || 'Untitled task',
                    taskId: taskId,
                    source: 'dashboard',
                }).catch(err => console.error('[TaskPatch] Notification error (request_review):', err)),
            ]);

            return NextResponse.json({ success: true, review_requested: true });
        }

        // ── ADD REVIEW COMMENT: Owner sends feedback to assignee ──
        case "add_review_comment": {
            if (!isCreator) {
                return NextResponse.json({ error: "Only the owner can add a review comment" }, { status: 403 });
            }
            if (!["accepted", "overdue"].includes(task.status)) {
                return NextResponse.json({ error: "Cannot add comment on a task that is not active" }, { status: 400 });
            }
            if (!task.review_requested_at) {
                return NextResponse.json({ error: "No review has been requested for this task" }, { status: 400 });
            }

            const { comment } = body;
            if (!comment || typeof comment !== 'string' || comment.trim().length === 0) {
                return NextResponse.json({ error: "Comment is required" }, { status: 400 });
            }

            const trimmedComment = comment.trim();
            const adminDb = createAdminClient();

            // 1. Perform all DB operations in parallel
            const [updateResult] = await Promise.all([
                supabase
                    .from("tasks")
                    .update({
                        review_requested_at: null,
                        updated_at: new Date().toISOString(),
                    })
                    .eq("id", taskId)
                    .select("id"),
                supabase.from("task_comments").insert({
                    task_id: taskId,
                    user_id: userId,
                    content: trimmedComment,
                    comment_type: 'review_comment',
                }),
                supabase.from("audit_log").insert({
                    user_id: userId,
                    organisation_id: task.organisation_id,
                    action: "task.review_comment_added",
                    entity_type: "task",
                    entity_id: taskId,
                    metadata: { comment: trimmedComment },
                }),
            ]);

            if (updateResult.error) {
                return NextResponse.json({ error: updateResult.error.message }, { status: 500 });
            }

            // 2. Send notification (fire-and-forget)
            notifyReviewCommentAdded(adminDb, {
                ownerId: userId,
                ownerName: currentUser.name || 'The task owner',
                assigneeId: task.assigned_to,
                taskTitle: task.title || 'Untitled task',
                taskId: taskId,
                comment: trimmedComment,
                source: 'dashboard',
            }).catch(err => console.error('[TaskPatch] Notification error (add_review_comment):', err));

            return NextResponse.json({ success: true, comment_added: true });
        }

        default:
            return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
}
