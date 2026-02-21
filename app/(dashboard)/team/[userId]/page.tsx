import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveCurrentUser } from "@/lib/user";
import { type Task } from "@/lib/types";
import EmployeeProfile from "@/components/team/EmployeeProfile";
import EmployeeContent from "@/components/team/EmployeeContent";

interface EmployeePageProps {
    params: Promise<{ userId: string }>;
}

export default async function EmployeePage({ params }: EmployeePageProps) {
    const { userId } = await params;
    const supabase = await createClient();
    const currentUser = await resolveCurrentUser(supabase);
    if (!currentUser) redirect("/login");

    // Fetch the employee
    const { data: employee } = await supabase
        .from("users")
        .select("id, name, phone_number, role, reporting_manager_id, avatar_url")
        .eq("id", userId)
        .eq("organisation_id", currentUser.organisation_id)
        .single();

    if (!employee) notFound();

    // Fetch reporting manager
    let manager = null;
    if (employee.reporting_manager_id) {
        const { data } = await supabase
            .from("users")
            .select("id, name, phone_number, role, reporting_manager_id, avatar_url")
            .eq("id", employee.reporting_manager_id)
            .single();
        manager = data;
    }

    // Two query sets:
    //   1. ALL tasks assigned to employee (for performance stats — needs completed count)
    //   2. ACTIVE tasks only (for task lists — excludes completed/cancelled)
    const [{ data: allAssigned }, { data: activeCreated }, { data: activeAssigned }] =
        await Promise.all([
            // Performance: all statuses for this assignee
            supabase
                .from("tasks")
                .select("*, created_by:users!tasks_created_by_fkey(id, name), assigned_to:users!tasks_assigned_to_fkey(id, name)")
                .eq("assigned_to", userId)
                .not("status", "eq", "cancelled"),
            // Task lists: active only, created by
            supabase
                .from("tasks")
                .select("*, created_by:users!tasks_created_by_fkey(id, name), assigned_to:users!tasks_assigned_to_fkey(id, name)")
                .eq("created_by", userId)
                .not("status", "in", '("completed","cancelled")'),
            // Task lists: active only, assigned to
            supabase
                .from("tasks")
                .select("*, created_by:users!tasks_created_by_fkey(id, name), assigned_to:users!tasks_assigned_to_fkey(id, name)")
                .eq("assigned_to", userId)
                .not("status", "in", '("completed","cancelled")'),
        ]);

    // Performance stats — all assigned tasks (includes completed)
    const assignedTasks: Task[] = allAssigned || [];

    // Task lists — deduplicated active tasks
    const taskMap = new Map<string, Task>();
    [...(activeCreated || []), ...(activeAssigned || [])].forEach((t: Task) => taskMap.set(t.id, t));
    const activeTasks = Array.from(taskMap.values());

    // Common tasks between the viewer and this employee
    // MUST be multi-participant (not to-dos) — to-dos are personal, can't be "common"
    const commonTasks = activeTasks.filter(t => {
        const creatorId = typeof t.created_by === "object" ? t.created_by.id : t.created_by;
        const assigneeId = typeof t.assigned_to === "object" ? t.assigned_to.id : t.assigned_to;
        if (creatorId === assigneeId) return false;
        return creatorId === currentUser.id || assigneeId === currentUser.id;
    });

    // Other tasks = active tasks that are NOT common with the viewer
    const commonTaskIds = new Set(commonTasks.map(t => t.id));
    const otherTasks = activeTasks.filter(t => !commonTaskIds.has(t.id));

    return (
        <div className="space-y-6">
            <EmployeeProfile employee={employee} manager={manager} />
            <EmployeeContent
                assignedTasks={assignedTasks}
                commonTasks={commonTasks}
                otherTasks={otherTasks}
                employeeId={userId}
                currentUserId={currentUser.id}
            />
        </div>
    );
}
