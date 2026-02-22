"use client";

/**
 * Employee Page — 100% Client-Side Rendering
 * 
 * Converted from server component to client component for 0ms page transitions.
 * Data is fetched via React Query (session-cached) while skeleton shows instantly.
 * The skeleton renders from the local JS bundle — no server round-trip needed.
 */

import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useUserContext } from "@/lib/user-context";
import { type Task } from "@/lib/types";
import EmployeeProfile from "@/components/team/EmployeeProfile";
import EmployeeContent from "@/components/team/EmployeeContent";
import { EmployeeSkeleton } from "@/components/ui/DashboardSkeleton";

export default function EmployeePage() {
    const params = useParams();
    const employeeId = params.userId as string;
    const { userId: currentUserId, orgId } = useUserContext();
    const supabase = createClient();

    const { data, isLoading } = useQuery({
        queryKey: ["employee-page", employeeId],
        queryFn: async () => {
            if (!employeeId || !orgId) throw new Error("Missing IDs");

            // Fetch employee + all tasks in parallel
            const [employeeResult, allAssignedResult, activeCreatedResult, activeAssignedResult] =
                await Promise.all([
                    // Employee profile
                    supabase
                        .from("users")
                        .select("id, name, phone_number, role, reporting_manager_id, avatar_url")
                        .eq("id", employeeId)
                        .eq("organisation_id", orgId)
                        .single(),
                    // All assigned tasks (for performance stats — includes completed)
                    supabase
                        .from("tasks")
                        .select("*, created_by:users!tasks_created_by_fkey(id, name), assigned_to:users!tasks_assigned_to_fkey(id, name)")
                        .eq("assigned_to", employeeId)
                        .not("status", "eq", "cancelled"),
                    // Active tasks created by this employee
                    supabase
                        .from("tasks")
                        .select("*, created_by:users!tasks_created_by_fkey(id, name), assigned_to:users!tasks_assigned_to_fkey(id, name)")
                        .eq("created_by", employeeId)
                        .not("status", "in", '("completed","cancelled")'),
                    // Active tasks assigned to this employee
                    supabase
                        .from("tasks")
                        .select("*, created_by:users!tasks_created_by_fkey(id, name), assigned_to:users!tasks_assigned_to_fkey(id, name)")
                        .eq("assigned_to", employeeId)
                        .not("status", "in", '("completed","cancelled")'),
                ]);

            const employee = employeeResult.data;
            if (!employee) throw new Error("Employee not found");

            // Fetch manager (depends on employee data)
            let manager = null;
            if (employee.reporting_manager_id) {
                const { data: mgrData } = await supabase
                    .from("users")
                    .select("id, name, phone_number, role, reporting_manager_id, avatar_url")
                    .eq("id", employee.reporting_manager_id)
                    .single();
                manager = mgrData;
            }

            // Deduplicate active tasks
            const taskMap = new Map<string, Task>();
            [...(activeCreatedResult.data || []), ...(activeAssignedResult.data || [])]
                .forEach((t: Task) => taskMap.set(t.id, t));
            const activeTasks = Array.from(taskMap.values());

            // Common tasks: multi-participant tasks where the current viewer is also involved
            const commonTasks = activeTasks.filter(t => {
                const creatorId = typeof t.created_by === "object" ? t.created_by.id : t.created_by;
                const assigneeId = typeof t.assigned_to === "object" ? t.assigned_to.id : t.assigned_to;
                if (creatorId === assigneeId) return false; // Skip to-dos
                return creatorId === currentUserId || assigneeId === currentUserId;
            });

            const commonTaskIds = new Set(commonTasks.map(t => t.id));
            const otherTasks = activeTasks.filter(t => !commonTaskIds.has(t.id));

            return {
                employee,
                manager,
                assignedTasks: (allAssignedResult.data || []) as Task[],
                commonTasks,
                otherTasks,
            };
        },
        enabled: !!employeeId && !!orgId,
    });

    // Instant skeleton from JS bundle — no server round-trip
    if (isLoading || !data) {
        return <EmployeeSkeleton />;
    }

    return (
        <div className="space-y-6">
            <EmployeeProfile employee={data.employee} manager={data.manager} />
            <EmployeeContent
                assignedTasks={data.assignedTasks}
                commonTasks={data.commonTasks}
                otherTasks={data.otherTasks}
                employeeId={employeeId}
                currentUserId={currentUserId}
            />
        </div>
    );
}
