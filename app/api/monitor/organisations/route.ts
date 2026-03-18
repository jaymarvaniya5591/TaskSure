import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function GET() {
    const supabase = createAdminClient();
    const db = supabase as any;

    // Fetch all organisations
    const { data: orgs, error: orgError } = await db
        .from("organisations")
        .select("id, name, slug, created_at")
        .order("created_at", { ascending: false });

    if (orgError) {
        return NextResponse.json({ error: orgError.message }, { status: 500 });
    }

    // Fetch user counts per org
    const { data: userCounts, error: ucError } = await db
        .from("users")
        .select("organisation_id");

    if (ucError) {
        return NextResponse.json({ error: ucError.message }, { status: 500 });
    }

    // Fetch task counts per org
    const { data: taskCounts, error: tcError } = await db
        .from("tasks")
        .select("organisation_id, status");

    if (tcError) {
        return NextResponse.json({ error: tcError.message }, { status: 500 });
    }

    // Aggregate user counts
    const userCountMap: Record<string, number> = {};
    for (const u of (userCounts || []) as any[]) {
        userCountMap[u.organisation_id] = (userCountMap[u.organisation_id] || 0) + 1;
    }

    // Aggregate task counts
    const taskCountMap: Record<string, { active: number; total: number }> = {};
    for (const t of (taskCounts || []) as any[]) {
        if (!taskCountMap[t.organisation_id]) {
            taskCountMap[t.organisation_id] = { active: 0, total: 0 };
        }
        taskCountMap[t.organisation_id].total++;
        if (!["completed", "cancelled", "rejected"].includes(t.status)) {
            taskCountMap[t.organisation_id].active++;
        }
    }

    const organisations = ((orgs || []) as any[]).map((org: any) => ({
        ...org,
        user_count: userCountMap[org.id] || 0,
        active_task_count: taskCountMap[org.id]?.active || 0,
        total_task_count: taskCountMap[org.id]?.total || 0,
    }));

    return NextResponse.json({ organisations });
}
