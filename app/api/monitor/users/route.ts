import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function GET(request: NextRequest) {
    const orgId = request.nextUrl.searchParams.get("orgId");

    if (!orgId) {
        return NextResponse.json({ error: "orgId is required" }, { status: 400 });
    }

    const supabase = createAdminClient();
    const db = supabase as any;

    // Fetch all users in the organisation
    const { data: users, error } = await db
        .from("users")
        .select("id, name, first_name, last_name, phone_number, role, reporting_manager_id, created_at, avatar_url")
        .eq("organisation_id", orgId)
        .order("created_at", { ascending: true });

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Resolve manager names from the same user list
    const userMap: Record<string, string> = {};
    for (const u of (users || []) as any[]) {
        userMap[u.id] = u.name || `${u.first_name || ""} ${u.last_name || ""}`.trim() || "Unknown";
    }

    // Count tasks per user (as creator or assignee)
    const { data: tasks } = await db
        .from("tasks")
        .select("created_by, assigned_to, status")
        .eq("organisation_id", orgId);

    const taskCountMap: Record<string, { created: number; assigned: number; active: number }> = {};
    for (const t of (tasks || []) as any[]) {
        const creatorId = t.created_by as string;
        const assigneeId = t.assigned_to as string;
        const isActive = !["completed", "cancelled", "rejected"].includes(t.status);

        if (creatorId) {
            if (!taskCountMap[creatorId]) taskCountMap[creatorId] = { created: 0, assigned: 0, active: 0 };
            taskCountMap[creatorId].created++;
            if (isActive) taskCountMap[creatorId].active++;
        }
        if (assigneeId && assigneeId !== creatorId) {
            if (!taskCountMap[assigneeId]) taskCountMap[assigneeId] = { created: 0, assigned: 0, active: 0 };
            taskCountMap[assigneeId].assigned++;
            if (isActive) taskCountMap[assigneeId].active++;
        }
    }

    const enrichedUsers = ((users || []) as any[]).map((u: any) => ({
        ...u,
        manager_name: u.reporting_manager_id ? userMap[u.reporting_manager_id] || null : null,
        task_stats: taskCountMap[u.id] || { created: 0, assigned: 0, active: 0 },
    }));

    return NextResponse.json({ users: enrichedUsers });
}
