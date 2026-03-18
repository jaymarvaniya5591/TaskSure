import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function GET(request: NextRequest) {
    const userId = request.nextUrl.searchParams.get("userId");

    if (!userId) {
        return NextResponse.json({ error: "userId is required" }, { status: 400 });
    }

    const supabase = createAdminClient();

    // Get user's phone number for incoming_messages lookup
    const { data: userRow } = await supabase
        .from("users")
        .select("id, name, phone_number, organisation_id")
        .eq("id", userId)
        .single();

    if (!userRow) {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const user = userRow as { id: string; name: string; phone_number: string; organisation_id: string };

    // Use any-casted client for tables that may not be in generated types
    const db = supabase as any;

    // Parallel queries for all activity data
    const [auditResult, messagesResult, notificationsResult, tasksCreatedResult, tasksAssignedResult] = await Promise.all([
        db.from("audit_log")
            .select("id, action, entity_type, entity_id, metadata, created_at")
            .eq("user_id", userId)
            .order("created_at", { ascending: false })
            .limit(200),

        db.from("incoming_messages")
            .select("id, phone, raw_text, intent_type, processed, processing_error, whatsapp_message_id, created_at")
            .eq("phone", user.phone_number)
            .order("created_at", { ascending: false })
            .limit(100),

        db.from("task_notifications")
            .select("id, task_id, stage, stage_number, target_role, channel, status, scheduled_at, sent_at, failure_reason, retry_count, metadata, created_at")
            .eq("target_user_id", userId)
            .order("created_at", { ascending: false })
            .limit(100),

        db.from("tasks")
            .select("id, title, status, deadline, committed_deadline, created_at, updated_at, assigned_to, source, parent_task_id")
            .eq("created_by", userId)
            .order("created_at", { ascending: false }),

        db.from("tasks")
            .select("id, title, status, deadline, committed_deadline, created_at, updated_at, created_by, source, parent_task_id")
            .eq("assigned_to", userId)
            .order("created_at", { ascending: false }),
    ]);

    // Resolve user names for tasks
    const allUserIds = new Set<string>();
    for (const t of (tasksCreatedResult.data || []) as any[]) {
        if (t.assigned_to) allUserIds.add(t.assigned_to);
    }
    for (const t of (tasksAssignedResult.data || []) as any[]) {
        if (t.created_by) allUserIds.add(t.created_by);
    }

    const userNameMap: Record<string, string> = {};
    if (allUserIds.size > 0) {
        const { data: relatedUsers } = await supabase
            .from("users")
            .select("id, name, first_name, last_name")
            .in("id", Array.from(allUserIds));

        for (const u of (relatedUsers || []) as any[]) {
            userNameMap[u.id] = u.name || `${u.first_name || ""} ${u.last_name || ""}`.trim() || "Unknown";
        }
    }

    // Enrich tasks with names
    const tasksCreated = ((tasksCreatedResult.data || []) as any[]).map((t: any) => ({
        ...t,
        role: "owner",
        other_person: t.assigned_to ? userNameMap[t.assigned_to] || "Unknown" : null,
    }));

    const tasksAssigned = ((tasksAssignedResult.data || []) as any[]).map((t: any) => ({
        ...t,
        role: "assignee",
        other_person: t.created_by ? userNameMap[t.created_by] || "Unknown" : null,
    }));

    // Deduplicate tasks (a todo has created_by === assigned_to, so it appears in both)
    const taskMap = new Map<string, any>();
    for (const t of tasksCreated) taskMap.set(t.id, t);
    for (const t of tasksAssigned) {
        if (!taskMap.has(t.id)) taskMap.set(t.id, t);
        else {
            const existing = taskMap.get(t.id)!;
            taskMap.set(t.id, { ...existing, role: "todo" });
        }
    }
    const tasks = Array.from(taskMap.values());

    // Build unified timeline
    const timeline: Array<{
        type: "audit" | "message" | "notification";
        timestamp: string;
        data: Record<string, unknown>;
    }> = [];

    for (const a of (auditResult.data || []) as any[]) {
        timeline.push({ type: "audit", timestamp: a.created_at, data: a });
    }
    for (const m of (messagesResult.data || []) as any[]) {
        timeline.push({ type: "message", timestamp: m.created_at, data: m });
    }
    for (const n of (notificationsResult.data || []) as any[]) {
        timeline.push({ type: "notification", timestamp: n.created_at, data: n });
    }

    // Sort desc
    timeline.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return NextResponse.json({
        user,
        tasks,
        timeline,
        counts: {
            audit: auditResult.data?.length || 0,
            messages: messagesResult.data?.length || 0,
            notifications: notificationsResult.data?.length || 0,
            tasks: tasks.length,
        },
    });
}
