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

export interface UserProfile {
    id: string;
    name: string;
    phone_number: string;
    organisation_id: string;
    reporting_manager_id: string | null;
}

interface DashboardData {
    profile: UserProfile;
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
 * PERFORMANCE (v2 — Waterfall Elimination):
 *   OLD: useAuth fetches profile (serial) → THEN useDashboardData starts
 *   NEW: Profile + my-tasks fetch in parallel → THEN org-level queries
 *
 * Two-phase parallel fetch:
 *   Phase 1 (parallel): profile + my created tasks + my assigned tasks
 *   Phase 2 (parallel): org users + all org tasks (needs orgId from profile)
 *
 * This eliminates one full network round-trip from the waterfall.
 */
export function useDashboardData(
    userId: string,
    serverInitialData?: DashboardData,
) {
    const supabase = createClient();

    return useQuery({
        queryKey: ["dashboard", userId],
        queryFn: async () => {
            if (!userId) throw new Error("Missing user ID");
            const fetchStart = Date.now();
            debugLog("DASHBOARD_QUERYFN_START", `userId=${userId}`);

            const t0 = Date.now();

            // ── Phase 1: Profile + my tasks in PARALLEL ──
            // Only needs userId (from session), not orgId
            const [profileResult, result1, result2] = await Promise.all([
                supabase
                    .from("users")
                    .select("id, name, phone_number, organisation_id, reporting_manager_id")
                    .eq("id", userId)
                    .single()
                    .then((r: { data: UserProfile | null; error: unknown }) => {
                        debugLog("QUERY_0_PROFILE", `elapsed=${Date.now() - t0}ms err=${r.error ?? "none"}`);
                        return r;
                    }),
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
            ]);

            if (profileResult.error || !profileResult.data) {
                throw new Error(`Profile fetch failed: ${profileResult.error?.message ?? "no data"}`);
            }

            const profile = profileResult.data as UserProfile;
            const orgId = profile.organisation_id;
            debugLog("PHASE_1_DONE", `profile+tasks done in ${Date.now() - t0}ms, orgId=${orgId}`);

            // ── Phase 2: Org-level queries (need orgId from profile) ──
            const t1 = Date.now();
            const [result3, result4] = await Promise.all([
                supabase
                    .from("users")
                    .select(
                        "id, name, phone_number, role, reporting_manager_id, avatar_url"
                    )
                    .eq("organisation_id", orgId)
                    .then((r: { data: unknown[] | null; error: unknown }) => {
                        debugLog("QUERY_3_ORG_USERS", `elapsed=${Date.now() - t1}ms rows=${r.data?.length ?? 0} err=${r.error ?? "none"}`);
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
                        debugLog("QUERY_4_ALL_ORG_TASKS", `elapsed=${Date.now() - t1}ms rows=${r.data?.length ?? 0} err=${r.error ?? "none"}`);
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
                profile,
                tasks: enrichedTasks,
                orgUsers: orgUsers || [],
                allOrgTasks,
            };
        },
        enabled: Boolean(userId),
        ...(serverInitialData ? {
            initialData: {
                profile: serverInitialData.profile,
                tasks: serverInitialData.tasks.map((task) => {
                    const userId = serverInitialData.profile.id;
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
