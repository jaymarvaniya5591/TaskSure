import { NextRequest, NextResponse } from "next/server";

export const runtime = 'edge';
export const preferredRegion = 'sin1';

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveCurrentUser } from "@/lib/user";
import { notifyTaskCreated, notifySubtaskCreated } from '@/lib/notifications/whatsapp-notifier'

export async function POST(request: NextRequest) {
    const supabase = await createClient();

    // PERF: Run auth and body parse in parallel
    const [currentUser, body] = await Promise.all([
        resolveCurrentUser(supabase),
        request.json(),
    ]);

    if (!currentUser) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const { assigned_to, title, description, deadline, parent_task_id } = body;

        if (!assigned_to || !title) {
            return NextResponse.json({ error: "Missing required fields: assigned_to, title" }, { status: 400 });
        }

        // Auto-detect organisation_id from the current user
        const organisationId = currentUser.organisation_id;
        if (!organisationId) {
            return NextResponse.json({ error: "User has no organisation" }, { status: 400 });
        }

        // Determine initial status: if self-assigned (todo), auto-accept
        const isSelfAssigned = assigned_to === currentUser.id;

        const { data, error } = await supabase
            .from("tasks")
            .insert({
                created_by: currentUser.id,
                assigned_to,
                organisation_id: organisationId,
                title,
                description: description || null,
                deadline: deadline || null,
                committed_deadline: isSelfAssigned ? (deadline || null) : null,
                parent_task_id: parent_task_id || null,
                status: isSelfAssigned ? "accepted" : "pending",
            })
            .select("id")
            .single();

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        // --- Audit Log (fire-and-forget — don't block response) ---
        const isSubtask = !!parent_task_id;
        const auditAction = isSubtask
            ? "subtask.created"
            : isSelfAssigned
                ? "todo.created"
                : "task.created";

        // Fire-and-forget: audit log + subtask parent log
        supabase.from("audit_log").insert({
            user_id: currentUser.id,
            organisation_id: organisationId,
            action: auditAction,
            entity_type: "task",
            entity_id: data.id,
            metadata: { title, assigned_to, parent_task_id }
        }).then(null, err => console.error('[TasksRoute] Audit log error:', err));

        if (isSubtask) {
            supabase.from("audit_log").insert({
                user_id: currentUser.id,
                organisation_id: organisationId,
                action: "subtask.created",
                entity_type: "task",
                entity_id: parent_task_id,
                metadata: {
                    subtask_id: data.id,
                    subtask_title: title,
                    assigned_to,
                }
            }).then(null, err => console.error('[TasksRoute] Subtask audit log error:', err));
        }

        // --- Notifications (fire-and-forget via admin client) ---
        const adminSupabase = createAdminClient();

        if (!isSelfAssigned) {
            await notifyTaskCreated(adminSupabase, {
                ownerName: currentUser.name || 'Your manager',
                ownerId: currentUser.id,
                assigneeId: assigned_to,
                taskTitle: title,
                taskId: data.id,
                committedDeadline: deadline || null,
                source: 'dashboard',
            }).catch(err => console.error('[TasksRoute] Notification error (task_create):', err));
        } else if (isSelfAssigned && deadline) {
            // For to-dos: schedule deadline approaching notification
            await notifyTaskCreated(adminSupabase, {
                ownerName: currentUser.name || currentUser.id,
                ownerId: currentUser.id,
                assigneeId: currentUser.id,
                taskTitle: title,
                taskId: data.id,
                committedDeadline: deadline,
                source: 'dashboard',
            }).catch(err => console.error('[TasksRoute] Notification error (todo_create):', err));
        }

        if (isSubtask && parent_task_id) {
            // Look up parent task to get owner info
            const { data: parentTask } = await supabase
                .from('tasks')
                .select('title, created_by')
                .eq('id', parent_task_id)
                .single();

            // Look up assignee name for richer notification
            let subtaskAssigneeName: string | undefined;
            if (assigned_to !== currentUser.id) {
                const { data: assigneeUser } = await adminSupabase
                    .from('users')
                    .select('name')
                    .eq('id', assigned_to)
                    .single() as { data: { name: string } | null };
                subtaskAssigneeName = assigneeUser?.name || undefined;
            }

            if (parentTask) {
                await notifySubtaskCreated(adminSupabase, {
                    parentTaskOwnerId: parentTask.created_by,
                    creatorId: currentUser.id,
                    creatorName: currentUser.name || 'A team member',
                    subtaskTitle: title,
                    parentTaskTitle: parentTask.title || 'Untitled task',
                    subtaskId: data.id,
                    subtaskAssigneeName,
                    source: 'dashboard',
                }).catch(err => console.error('[TasksRoute] Notification error (subtask_create):', err));
            }
        }

        return NextResponse.json({ success: true, task: data });
    } catch (e: unknown) {
        return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
    }
}
