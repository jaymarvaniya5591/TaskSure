import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveCurrentUser } from "@/lib/user";
import AllTasksClient from "@/components/tasks/AllTasksClient";
import { type Task } from "@/lib/types";
import {
    isTodo,
    getParticipantCount,
    getLastActiveParticipant,
    getPendingInfo,
} from "@/lib/task-service";

export const metadata = {
    title: "All Tasks | Boldo AI",
};

export default async function AllTasksPage() {
    const supabase = await createClient();
    const currentUser = await resolveCurrentUser(supabase);
    if (!currentUser) redirect("/login");

    const userId = currentUser.id;
    const orgId = currentUser.organisation_id;

    const [{ data: tasksCreated }, { data: tasksAssigned }, { data: orgTasks }] =
        await Promise.all([
            supabase
                .from("tasks")
                .select(
                    "*, created_by:users!tasks_created_by_fkey(id, name), assigned_to:users!tasks_assigned_to_fkey(id, name)"
                )
                .eq("created_by", userId),
            supabase
                .from("tasks")
                .select(
                    "*, created_by:users!tasks_created_by_fkey(id, name), assigned_to:users!tasks_assigned_to_fkey(id, name)"
                )
                .eq("assigned_to", userId),
            supabase
                .from("tasks")
                .select(
                    "*, created_by:users!tasks_created_by_fkey(id, name), assigned_to:users!tasks_assigned_to_fkey(id, name)"
                )
                .eq("organisation_id", orgId)
                .not("status", "eq", "cancelled"),
        ]);

    const allOrgTasks: Task[] = orgTasks || [];

    // Deduplicate tasks
    const taskMap = new Map<string, Task>();
    [...(tasksCreated || []), ...(tasksAssigned || [])].forEach((t: Task) =>
        taskMap.set(t.id, t)
    );

    // Enrich with computed fields and sort
    const allUniqueTasks = Array.from(taskMap.values())
        .map((task) => {
            const participantCount = getParticipantCount(task, allOrgTasks);
            const lastActive = getLastActiveParticipant(task, allOrgTasks);
            const pending = getPendingInfo(task, userId, allOrgTasks);
            return {
                ...task,
                participant_count: participantCount,
                last_active_participant: lastActive,
                pending_from: pending.isPending ? pending.pendingFrom : null,
            };
        })
        .sort(
            (a, b) =>
                new Date(b.created_at).getTime() -
                new Date(a.created_at).getTime()
        );

    const collaborativeTasks = allUniqueTasks.filter((t) => !isTodo(t));
    const personalTasks = allUniqueTasks.filter((t) => isTodo(t));

    return (
        <AllTasksClient
            todos={personalTasks}
            tasks={collaborativeTasks}
            currentUserId={userId}
        />
    );
}
