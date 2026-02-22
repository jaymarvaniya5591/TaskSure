import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveCurrentUser } from "@/lib/user";

export async function POST(request: NextRequest) {
    const supabase = await createClient();
    const currentUser = await resolveCurrentUser(supabase);

    if (!currentUser) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const body = await request.json();
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

        // --- Audit Log ---
        await supabase.from("audit_log").insert({
            user_id: currentUser.id,
            organisation_id: organisationId,
            action: isSelfAssigned ? "todo.created" : "task.created",
            entity_type: "task", // under the hood, all are stored in 'tasks' table
            entity_id: data.id,
            metadata: { title, assigned_to, parent_task_id }
        });


        return NextResponse.json({ success: true, task: data });
    } catch (e: unknown) {
        return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
    }
}
