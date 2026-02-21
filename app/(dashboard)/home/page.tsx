import { redirect } from "next/navigation";
import { format } from "date-fns";
import { createClient } from "@/lib/supabase/server";
import { resolveCurrentUser } from "@/lib/user";
import { type Task } from "@/lib/types";
import DashboardClient from "./dashboard-client";
import {
    isTodo,
    isActive,
    getParticipantCount,
    getLastActiveParticipant,
    getPendingInfo,
    extractUserId,
} from "@/lib/task-service";

/**
 * Home Dashboard — Server Component
 * Fetches all data server-side for performance (<2s target).
 * Computes participant info and pending actions before passing to client.
 */

export default async function HomePage() {
    const supabase = await createClient();

    // 1. Resolve current user
    const currentUser = await resolveCurrentUser(supabase);
    if (!currentUser) redirect("/login");

    const userId = currentUser.id;

    // 2. Fetch all tasks where user is a participant (created_by OR assigned_to)
    const [{ data: tasksCreated }, { data: tasksAssigned }] = await Promise.all([
        supabase
            .from("tasks")
            .select(
                "*, created_by:users!tasks_created_by_fkey(*), assigned_to:users!tasks_assigned_to_fkey(*)"
            )
            .eq("created_by", userId)
            .not("status", "in", '("completed","cancelled")'),
        supabase
            .from("tasks")
            .select(
                "*, created_by:users!tasks_created_by_fkey(*), assigned_to:users!tasks_assigned_to_fkey(*)"
            )
            .eq("assigned_to", userId)
            .not("status", "in", '("completed","cancelled")'),
    ]);

    // Merge and deduplicate
    const allTasksMap = new Map<string, Task>();
    [...(tasksCreated || []), ...(tasksAssigned || [])].forEach((t: Task) => {
        allTasksMap.set(t.id, t);
    });

    // Also fetch all org tasks for subtask computation
    const orgId = currentUser.organisation_id;
    const { data: orgTasks } = await supabase
        .from("tasks")
        .select(
            "*, created_by:users!tasks_created_by_fkey(id, name), assigned_to:users!tasks_assigned_to_fkey(id, name)"
        )
        .eq("organisation_id", orgId)
        .not("status", "eq", "cancelled");

    const allOrgTasks: Task[] = orgTasks || [];

    // 3. Enrich tasks with computed fields
    const allTasks: Task[] = Array.from(allTasksMap.values()).map((task) => {
        const participantCount = getParticipantCount(task, allOrgTasks);
        const lastActive = getLastActiveParticipant(task, allOrgTasks);
        const pending = getPendingInfo(task, userId, allOrgTasks);

        return {
            ...task,
            participant_count: participantCount,
            last_active_participant: lastActive,
            pending_from: pending.isPending ? pending.pendingFrom : null,
        };
    });

    const now = new Date();

    // 4. Pending Actions — based on deadline not set (committed_deadline = NULL)
    const actionRequired = allTasks.filter((t) => {
        if (!isActive(t) || isTodo(t)) return false;
        const assigneeId = extractUserId(t.assigned_to);
        // Action required from ME: I'm the assignee AND I haven't set a deadline
        if (assigneeId === userId && t.status === "pending" && !t.committed_deadline) {
            // Check that there are no subtasks I created that are still pending
            // (if I have pending subtasks, I'm waiting on others first)
            const mySubsPending = allOrgTasks.some(
                (sub) =>
                    sub.parent_task_id === t.id &&
                    extractUserId(sub.created_by) === userId &&
                    sub.status === "pending" &&
                    !sub.committed_deadline
            );
            return !mySubsPending;
        }
        return false;
    });

    // Waiting on Others: tasks I'm part of, but the pending action is NOT from me
    const waitingOnOthers = allTasks.filter((t) => {
        if (!isActive(t) || isTodo(t)) return false;
        const pending = getPendingInfo(t, userId, allOrgTasks);
        return pending.isPending && !pending.isPendingFromMe;
    });

    // 5. Overdue tasks
    const overdueTasks = allTasks.filter((t) => {
        const dl = t.committed_deadline || t.deadline;
        if (!dl) return false;
        return (
            t.status === "overdue" ||
            (new Date(dl) < now && t.status !== "completed")
        );
    });

    // 6. Greeting
    const hour = now.getHours();
    let greeting = "Good evening";
    if (hour < 12) greeting = "Good morning";
    else if (hour < 17) greeting = "Good afternoon";

    const firstName = currentUser.name?.split(" ")[0] || "User";

    return (
        <DashboardClient
            greeting={greeting}
            firstName={firstName}
            dateString={format(now, "EEEE, d MMMM yyyy")}
            currentUserId={userId}
            allTasks={allTasks}
            actionRequired={actionRequired}
            waitingOnOthers={waitingOnOthers}
            overdueTasks={overdueTasks}
        />
    );
}
