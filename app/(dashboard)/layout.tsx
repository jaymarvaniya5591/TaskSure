import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveCurrentUser } from "@/lib/user";
import { type Task } from "@/lib/types";
import { getUsersAtOrBelowRank } from "@/lib/hierarchy";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { UserProvider } from "@/lib/user-context";
import { SidebarProvider } from "@/components/layout/SidebarProvider";
import {
    getParticipantCount,
    getLastActiveParticipant,
    getPendingInfo,
} from "@/lib/task-service";

export default async function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const supabase = await createClient();
    const currentUser = await resolveCurrentUser(supabase);
    if (!currentUser) redirect("/login");

    const userId = currentUser.id;
    const orgId = currentUser.organisation_id;

    // Fetch tasks + org users for sidebar context
    const [{ data: tasksCreated }, { data: tasksAssigned }, { data: orgUsers }] =
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
        ]);

    // Also fetch all org tasks for subtask computation
    const { data: allOrgTasksRaw } = await supabase
        .from("tasks")
        .select(
            "*, created_by:users!tasks_created_by_fkey(id, name), assigned_to:users!tasks_assigned_to_fkey(id, name)"
        )
        .eq("organisation_id", orgId)
        .not("status", "eq", "cancelled");

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

    const userContextValue = {
        userId,
        userName: currentUser.name || "User",
        orgId,
        orgUsers: getUsersAtOrBelowRank(orgUsers || [], userId),
        allOrgUsers: orgUsers || [],
        tasks: enrichedTasks,
    };

    return (
        <SidebarProvider>
            <UserProvider value={userContextValue}>
                <div className="min-h-screen bg-gray-50/50">
                    <Sidebar />
                    <div className="lg:pl-72 flex flex-col min-h-screen">
                        <Header />
                        <main className="flex-1 py-8">
                            <div className="px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
                                {children}
                            </div>
                        </main>
                    </div>
                </div>
            </UserProvider>
        </SidebarProvider>
    );
}
