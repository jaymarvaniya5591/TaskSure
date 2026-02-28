import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from '@vercel/functions';
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
} from '@/lib/notifications/whatsapp-notifier'

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
    const currentUser = await resolveCurrentUser(supabase);

    if (!currentUser) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { action } = body;

    // Fetch the task
    const { data: task, error: fetchError } = await supabase
        .from("tasks")
        .select("id, title, assigned_to, created_by, status, organisation_id, deadline, committed_deadline")
        .eq("id", taskId)
        .single();

    if (fetchError || !task) {
        return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const userId = currentUser.id;
    const isAssignee = task.assigned_to === userId;
    const isCreator = task.created_by === userId;

    switch (action) {
        // ── ACCEPT: Assignee sets committed deadline ──
        case "accept": {
            if (!isAssignee) {
                return NextResponse.json({ error: "Only the assignee can accept a task" }, { status: 403 });
            }
            if (task.status !== "pending") {
                return NextResponse.json({ error: "Task can only be accepted when pending" }, { status: 400 });
            }
            const { committed_deadline } = body;
            if (!committed_deadline) {
                return NextResponse.json({ error: "Committed deadline is required when accepting" }, { status: 400 });
            }

            const { error } = await supabase
                .from("tasks")
                .update({
                    status: "accepted",
                    committed_deadline,
                    updated_at: new Date().toISOString(),
                })
                .eq("id", taskId);

            if (error) return NextResponse.json({ error: error.message }, { status: 500 });

            await supabase.from("audit_log").insert({
                user_id: userId,
                organisation_id: task.organisation_id,
                action: "task.accepted",
                entity_type: "task",
                entity_id: taskId,
                metadata: { committed_deadline }
            });

            // Notify all participants
            const adminDb = createAdminClient();
            waitUntil(
                notifyTaskAccepted(adminDb, {
                    ownerId: task.created_by,
                    assigneeId: userId,
                    assigneeName: currentUser.name || 'The assignee',
                    taskTitle: task.title || 'Untitled task',
                    taskId: taskId,
                    committedDeadline: committed_deadline,
                    source: 'dashboard',
                }).catch(err => console.error('[TaskPatch] Notification error (accept):', err))
            );

            return NextResponse.json({ success: true, status: "accepted" });
        }

        // ── REJECT: Assignee rejects with a reason ──
        case "reject": {
            if (!isAssignee) {
                return NextResponse.json({ error: "Only the assignee can reject a task" }, { status: 403 });
            }
            if (task.status !== "pending") {
                return NextResponse.json({ error: "Task can only be rejected when pending" }, { status: 400 });
            }

            const { error } = await supabase
                .from("tasks")
                .update({
                    status: "rejected",
                    updated_at: new Date().toISOString(),
                })
                .eq("id", taskId);

            if (error) return NextResponse.json({ error: error.message }, { status: 500 });

            // Store rejection reason as a task comment
            const { reject_reason } = body;
            if (reject_reason) {
                await supabase.from("task_comments").insert({
                    task_id: taskId,
                    user_id: userId,
                    content: `Rejected: ${reject_reason}`,
                });
            }

            await supabase.from("audit_log").insert({
                user_id: userId,
                organisation_id: task.organisation_id,
                action: "task.rejected",
                entity_type: "task",
                entity_id: taskId,
                metadata: { reject_reason }
            });

            // Notify all participants
            const adminDb = createAdminClient();
            waitUntil(
                notifyTaskRejected(adminDb, {
                    ownerId: task.created_by,
                    assigneeId: userId,
                    assigneeName: currentUser.name || 'The assignee',
                    taskTitle: task.title || 'Untitled task',
                    taskId: taskId,
                    reason: reject_reason || null,
                    source: 'dashboard',
                }).catch(err => console.error('[TaskPatch] Notification error (reject):', err))
            );

            return NextResponse.json({ success: true, status: "rejected" });
        }

        // ── COMPLETE: Owner marks task as completed ──
        case "complete": {
            if (!isCreator) {
                return NextResponse.json({ error: "Only the owner (creator) can complete a task" }, { status: 403 });
            }

            // Fetch the full task to check if it's a subtask and get the title
            const { data: fullTask } = await supabase
                .from("tasks")
                .select("title, parent_task_id")
                .eq("id", taskId)
                .single();

            const isTodo = task.created_by === task.assigned_to;
            const isSubtask = !!fullTask?.parent_task_id;

            // Notify all participants BEFORE updating status
            const adminDb = createAdminClient();
            await notifyTaskCompleted(adminDb, {
                ownerId: userId,
                ownerName: currentUser.name || 'The task owner',
                assigneeId: task.assigned_to,
                taskTitle: fullTask?.title || task.title || 'Untitled task',
                taskId: taskId,
                source: 'dashboard',
            }).catch(err => console.error('[TaskPatch] Notification error (complete):', err));

            // Now update the task status
            const { error } = await supabase
                .from("tasks")
                .update({
                    status: "completed",
                    updated_at: new Date().toISOString(),
                })
                .eq("id", taskId);

            if (error) return NextResponse.json({ error: error.message }, { status: 500 });

            await supabase.from("audit_log").insert({
                user_id: userId,
                organisation_id: task.organisation_id,
                action: isSubtask ? "subtask.completed" : isTodo ? "todo.completed" : "task.completed",
                entity_type: "task",
                entity_id: taskId
            });

            // If this is a subtask, also log to the parent task so the branch
            // merges visually in the parent's timeline.
            if (isSubtask && fullTask?.parent_task_id) {
                await supabase.from("audit_log").insert({
                    user_id: userId,
                    organisation_id: task.organisation_id,
                    action: "subtask.completed",
                    entity_type: "task",
                    entity_id: fullTask.parent_task_id,
                    metadata: {
                        subtask_id: taskId,
                        subtask_title: fullTask.title,
                    }
                });
            }

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

            const updateData: Record<string, string> = {
                updated_at: new Date().toISOString(),
            };

            // If the task has a committed_deadline, update that too
            if (task.committed_deadline) {
                updateData.committed_deadline = new_deadline;
            }
            updateData.deadline = new_deadline;

            const { error } = await supabase
                .from("tasks")
                .update(updateData)
                .eq("id", taskId);

            if (error) return NextResponse.json({ error: error.message }, { status: 500 });

            await supabase.from("audit_log").insert({
                user_id: userId,
                organisation_id: task.organisation_id,
                action: "task.deadline_edited",
                entity_type: "task",
                entity_id: taskId,
                metadata: { old_deadline: task.deadline, new_deadline }
            });

            // Notify all participants
            const adminDb = createAdminClient();
            waitUntil(
                notifyDeadlineEdited(adminDb, {
                    ownerId: task.created_by,
                    assigneeId: task.assigned_to,
                    actorId: userId,
                    actorName: currentUser.name || 'A team member',
                    taskTitle: task.title || 'Untitled task',
                    taskId: taskId,
                    newDeadline: new_deadline,
                    source: 'dashboard',
                }).catch(err => console.error('[TaskPatch] Notification error (edit_deadline):', err))
            );

            return NextResponse.json({ success: true, deadline: new_deadline });
        }

        // ── EDIT PERSONS: Owner changes the assignee ──
        case "edit_persons": {
            if (!isCreator) {
                return NextResponse.json({ error: "Only the owner can change the assignee" }, { status: 403 });
            }

            const { new_assigned_to, old_assigned_name, new_assigned_name } = body;
            if (!new_assigned_to) {
                return NextResponse.json({ error: "new_assigned_to is required" }, { status: 400 });
            }

            // If changing to a different person, reset to pending so they can accept
            const isSelfAssign = new_assigned_to === userId;
            const updateData: Record<string, unknown> = {
                assigned_to: new_assigned_to,
                updated_at: new Date().toISOString(),
            };

            if (!isSelfAssign && new_assigned_to !== task.assigned_to) {
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

            const { error } = await supabase
                .from("tasks")
                .update(updateData)
                .eq("id", taskId);

            if (error) return NextResponse.json({ error: error.message }, { status: 500 });

            await supabase.from("audit_log").insert({
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
            });

            // Notify all participants
            const adminDb = createAdminClient();
            waitUntil(
                notifyAssigneeChanged(adminDb, {
                    ownerId: userId,
                    ownerName: currentUser.name || 'The task owner',
                    oldAssigneeId: task.assigned_to,
                    newAssigneeId: new_assigned_to,
                    newAssigneeName: new_assigned_name || 'the new assignee',
                    taskTitle: task.title || 'Untitled task',
                    taskId: taskId,
                    source: 'dashboard',
                }).catch(err => console.error('[TaskPatch] Notification error (edit_persons):', err))
            );

            return NextResponse.json({ success: true, assigned_to: new_assigned_to });
        }

        // ── DELETE: Owner cancels the task and all active subtasks ──
        case "delete": {
            if (!isCreator) {
                return NextResponse.json({ error: "Only the owner can delete a task" }, { status: 403 });
            }

            // Notify all participants BEFORE cancelling
            const adminDb = createAdminClient();
            await notifyTaskCancelled(adminDb, {
                ownerId: userId,
                ownerName: currentUser.name || 'The task owner',
                assigneeId: task.assigned_to,
                taskTitle: task.title || 'Untitled task',
                taskId: taskId,
                source: 'dashboard',
            }).catch(err => console.error('[TaskPatch] Notification error (delete):', err));

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

            await cancelSubtasks(taskId);

            // Cancel the task itself
            const { error } = await supabase
                .from("tasks")
                .update({
                    status: "cancelled",
                    updated_at: new Date().toISOString(),
                })
                .eq("id", taskId);

            if (error) return NextResponse.json({ error: error.message }, { status: 500 });

            await supabase.from("audit_log").insert({
                user_id: userId,
                organisation_id: task.organisation_id,
                action: "task.deleted",
                entity_type: "task",
                entity_id: taskId
            });

            return NextResponse.json({ success: true, status: "cancelled" });
        }

        default:
            return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
}
