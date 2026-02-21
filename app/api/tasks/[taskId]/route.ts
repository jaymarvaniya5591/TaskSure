import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveCurrentUser } from "@/lib/user";

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
        .select("*")
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

            return NextResponse.json({ success: true, status: "rejected" });
        }

        // ── COMPLETE: Owner marks task as completed ──
        case "complete": {
            if (!isCreator) {
                return NextResponse.json({ error: "Only the owner (creator) can complete a task" }, { status: 403 });
            }

            const { error } = await supabase
                .from("tasks")
                .update({
                    status: "completed",
                    updated_at: new Date().toISOString(),
                })
                .eq("id", taskId);

            if (error) return NextResponse.json({ error: error.message }, { status: 500 });
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
            return NextResponse.json({ success: true, deadline: new_deadline });
        }

        // ── EDIT PERSONS: Owner changes the assignee ──
        case "edit_persons": {
            if (!isCreator) {
                return NextResponse.json({ error: "Only the owner can change the assignee" }, { status: 403 });
            }

            const { new_assigned_to } = body;
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
            return NextResponse.json({ success: true, assigned_to: new_assigned_to });
        }

        // ── DELETE: Owner cancels the task and all active subtasks ──
        case "delete": {
            if (!isCreator) {
                return NextResponse.json({ error: "Only the owner can delete a task" }, { status: 403 });
            }

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
            return NextResponse.json({ success: true, status: "cancelled" });
        }

        default:
            return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
}
