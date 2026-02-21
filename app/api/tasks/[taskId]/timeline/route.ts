import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveCurrentUser } from "@/lib/user";

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ taskId: string }> }
) {
    const { taskId } = await params;
    const supabase = await createClient();
    const currentUser = await resolveCurrentUser(supabase);

    if (!currentUser) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Fetch audit logs (no FK join — constraint was dropped for testing)
    const { data: rawLogs, error } = await supabase
        .from("audit_log")
        .select("id, action, metadata, created_at, user_id")
        .eq("entity_type", "task")
        .eq("entity_id", taskId)
        .order("created_at", { ascending: true });

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Resolve user names in a single batch query
    const allUserIds = (rawLogs || []).map(l => l.user_id).filter(Boolean) as string[];
    const userIds = allUserIds.filter((id, idx) => allUserIds.indexOf(id) === idx);
    const userMap: Record<string, { id: string; name: string; avatar_url: string | null }> = {};

    if (userIds.length > 0) {
        const { data: users } = await supabase
            .from("users")
            .select("id, name, avatar_url")
            .in("id", userIds);

        if (users) {
            for (const u of users) {
                userMap[u.id] = u;
            }
        }
    }

    // Attach user info to each log
    const logs = (rawLogs || []).map(log => ({
        ...log,
        users: log.user_id ? userMap[log.user_id] || null : null,
    }));

    return NextResponse.json({ success: true, logs });
}
