import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { type Task } from "@/lib/types";
import {
    getParticipantCount,
    getLastActiveParticipant,
    getPendingInfo,
} from "@/lib/task-service";

export function useDashboardData(userId: string, orgId: string) {
    const supabase = createClient();

    return useQuery({
        queryKey: ["dashboard", userId, orgId],
        queryFn: async () => {
            if (!userId || !orgId) throw new Error("Missing user or org ID");

            // Fetch tasks + org users for sidebar context
            const [{ data: tasksCreated }, { data: tasksAssigned }, { data: orgUsers }, { data: allOrgTasksRaw }] =
                await Promise.all([
                    supabase
                        .from("tasks")
                        .select(
                            "*, created_by:users!tasks_created_by_fkey(id, name), assigned_to:users!tasks_assigned_to_fkey(id, name)"
                        )
                        .eq("created_by", userId)
                        .not("status", "in", '("completed","cancelled")'),
                    supabase
                        .from("tasks")
                        .select(
                            "*, created_by:users!tasks_created_by_fkey(id, name), assigned_to:users!tasks_assigned_to_fkey(id, name)"
                        )
                        .eq("assigned_to", userId)
                        .not("status", "in", '("completed","cancelled")'),
                    supabase
                        .from("users")
                        .select(
                            "id, name, phone_number, role, reporting_manager_id, avatar_url"
                        )
                        .eq("organisation_id", orgId),
                    supabase
                        .from("tasks")
                        .select(
                            "*, created_by:users!tasks_created_by_fkey(id, name), assigned_to:users!tasks_assigned_to_fkey(id, name)"
                        )
                        .eq("organisation_id", orgId)
                        .not("status", "eq", "cancelled")
                ]);

            const allOrgTasks: Task[] = allOrgTasksRaw || [];

            // Deduplicate tasks
            const taskMap = new Map<string, Task>();
            [...(tasksCreated || []), ...(tasksAssigned || [])].forEach((t: Task) =>
                taskMap.set(t.id, t)
            );

            // Enrich with computed fields
            const enrichedTasks: Task[] = Array.from(taskMap.values()).map((task) => ({
                ...task,
                participant_count: getParticipantCount(task, allOrgTasks),
                last_active_participant: getLastActiveParticipant(task, allOrgTasks),
                pending_from: getPendingInfo(task, userId, allOrgTasks).isPending
                    ? getPendingInfo(task, userId, allOrgTasks).pendingFrom
                    : null,
            }));

            return {
                tasks: enrichedTasks,
                orgUsers: orgUsers || [],
                allOrgTasks,
            };
        },
        staleTime: 5 * 60 * 1000,
        enabled: Boolean(userId && orgId),
    });
}
