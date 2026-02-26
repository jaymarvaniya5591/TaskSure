import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { type Task } from "@/lib/types";
import {
    getParticipantCount,
    getLastActiveParticipant,
    getPendingInfo,
} from "@/lib/task-service";
import { type SeqNode } from "@/lib/timeline-utils";
import { debugLog } from "@/lib/debug-logger";

interface DashboardData {
    tasks: Task[];
    orgUsers: Array<{
        id: string;
        name: string;
        phone_number: string;
        role: string;
        reporting_manager_id: string | null;
        avatar_url: string | null;
    }>;
    allOrgTasks: Task[];
    /** Pre-fetched timeline trees keyed by root task ID (serialized as [id, node][] for JSON compat) */
    timelines?: [string, SeqNode][];
}

/**
 * React Query hook for dashboard data.
 *
 * PERFORMANCE: Accepts optional `initialData` from the server-side layout.
 * When provided, content renders immediately on hydration — no loading skeleton,
 * no client-side fetch waterfall. React Query won't refetch because staleTime is Infinity.
 */
export function useDashboardData(
    userId: string,
    orgId: string,
    serverInitialData?: DashboardData,
) {
    const supabase = createClient();

    return useQuery({
        queryKey: ["dashboard", userId, orgId],
        queryFn: async () => {
            if (!userId || !orgId) throw new Error("Missing user or org ID");
            const fetchStart = Date.now();
            debugLog("DASHBOARD_QUERYFN_START", `userId=${userId} orgId=${orgId}`);

            // Fetch tasks + org users for sidebar context
            // Each call is individually timed for mobile debugging
            const t0 = Date.now();
            const [result1, result2, result3, result4] = await Promise.all([
                supabase
                    .from("tasks")
                    .select(
                        "*, created_by:users!tasks_created_by_fkey(id, name), assigned_to:users!tasks_assigned_to_fkey(id, name)"
                    )
                    .eq("created_by", userId)
                    .not("status", "in", '("completed","cancelled")')
                    .then((r: { data: Task[] | null; error: unknown }) => {
                        debugLog("QUERY_1_CREATED_TASKS", `elapsed=${Date.now() - t0}ms rows=${r.data?.length ?? 0} err=${r.error ?? "none"}`);
                        return r;
                    }),
                supabase
                    .from("tasks")
                    .select(
                        "*, created_by:users!tasks_created_by_fkey(id, name), assigned_to:users!tasks_assigned_to_fkey(id, name)"
                    )
                    .eq("assigned_to", userId)
                    .not("status", "in", '("completed","cancelled")')
                    .then((r: { data: Task[] | null; error: unknown }) => {
                        debugLog("QUERY_2_ASSIGNED_TASKS", `elapsed=${Date.now() - t0}ms rows=${r.data?.length ?? 0} err=${r.error ?? "none"}`);
                        return r;
                    }),
                supabase
                    .from("users")
                    .select(
                        "id, name, phone_number, role, reporting_manager_id, avatar_url"
                    )
                    .eq("organisation_id", orgId)
                    .then((r: { data: unknown[] | null; error: unknown }) => {
                        debugLog("QUERY_3_ORG_USERS", `elapsed=${Date.now() - t0}ms rows=${r.data?.length ?? 0} err=${r.error ?? "none"}`);
                        return r;
                    }),
                supabase
                    .from("tasks")
                    .select(
                        "*, created_by:users!tasks_created_by_fkey(id, name), assigned_to:users!tasks_assigned_to_fkey(id, name)"
                    )
                    .eq("organisation_id", orgId)
                    .not("status", "eq", "cancelled")
                    .then((r: { data: Task[] | null; error: unknown }) => {
                        debugLog("QUERY_4_ALL_ORG_TASKS", `elapsed=${Date.now() - t0}ms rows=${r.data?.length ?? 0} err=${r.error ?? "none"}`);
                        return r;
                    }),
            ]);
            const tasksCreated = result1.data;
            const tasksAssigned = result2.data;
            const orgUsers = result3.data;
            const allOrgTasksRaw = result4.data;

            const allOrgTasks: Task[] = allOrgTasksRaw || [];

            // Deduplicate tasks
            const taskMap = new Map<string, Task>();
            [...(tasksCreated || []), ...(tasksAssigned || [])].forEach((t: Task) =>
                taskMap.set(t.id, t)
            );

            // Enrich with computed fields
            const enrichedTasks: Task[] = Array.from(taskMap.values()).map((task) => {
                const pendingInfo = getPendingInfo(task, userId, allOrgTasks);
                return {
                    ...task,
                    participant_count: getParticipantCount(task, allOrgTasks),
                    last_active_participant: getLastActiveParticipant(task, allOrgTasks),
                    pending_from: pendingInfo.isPending ? pendingInfo.pendingFrom : null,
                };
            });

            debugLog("DASHBOARD_QUERYFN_DONE", `tasks=${enrichedTasks.length} orgUsers=${(orgUsers || []).length} allOrgTasks=${allOrgTasks.length} elapsed=${Date.now() - fetchStart}ms`);
            return {
                tasks: enrichedTasks,
                orgUsers: orgUsers || [],
                allOrgTasks,
            };
        },
        staleTime: Infinity,
        enabled: Boolean(userId && orgId),
        // Server-prefetched data — renders immediately, no loading state
        ...(serverInitialData ? {
            initialData: {
                tasks: serverInitialData.tasks.map((task) => {
                    const pendingInfo = getPendingInfo(task, userId, serverInitialData.allOrgTasks);
                    return {
                        ...task,
                        participant_count: getParticipantCount(task, serverInitialData.allOrgTasks),
                        last_active_participant: getLastActiveParticipant(task, serverInitialData.allOrgTasks),
                        pending_from: pendingInfo.isPending ? pendingInfo.pendingFrom : null,
                    };
                }),
                orgUsers: serverInitialData.orgUsers,
                allOrgTasks: serverInitialData.allOrgTasks,
            },
        } : {}),
    });
}
