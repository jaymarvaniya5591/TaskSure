"use client";

import { useMemo } from "react";
import { format } from "date-fns";
import { useUserContext } from "@/lib/user-context";
import DashboardClient from "./dashboard-client";
import {
    isTodo,
    isActive,
    extractUserId,
    getPendingInfo,
} from "@/lib/task-service";
import { DashboardHomeSkeleton } from "@/components/ui/DashboardSkeleton";

export default function HomePage() {
    const { userId, userName, tasks: allTasks, allOrgTasks, isLoading } = useUserContext();

    const { actionRequired, waitingOnOthers, overdueTasks } = useMemo(() => {
        if (isLoading || !allTasks.length) {
            return { actionRequired: [], waitingOnOthers: [], overdueTasks: [] };
        }

        const now = new Date();

        const actionReq = allTasks.filter((t) => {
            if (!isActive(t) || isTodo(t)) return false;
            const assigneeId = extractUserId(t.assigned_to);
            if (assigneeId === userId && t.status === "pending" && !t.committed_deadline) {
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

        const waitingOthers = allTasks.filter((t) => {
            if (!isActive(t) || isTodo(t)) return false;
            const pending = getPendingInfo(t, userId, allOrgTasks);
            return pending.isPending && !pending.isPendingFromMe;
        });

        const overdue = allTasks.filter((t) => {
            const dl = t.committed_deadline || t.deadline;
            if (!dl) return false;
            return (
                t.status === "overdue" ||
                (new Date(dl) < now && t.status !== "completed")
            );
        });

        return { actionRequired: actionReq, waitingOnOthers: waitingOthers, overdueTasks: overdue };
    }, [allTasks, allOrgTasks, userId, isLoading]);

    // Show skeleton while data is loading
    if (isLoading) {
        return <DashboardHomeSkeleton />;
    }

    const now = new Date();
    const hour = now.getHours();
    let greeting = "Good evening";
    if (hour < 12) greeting = "Good morning";
    else if (hour < 17) greeting = "Good afternoon";

    const firstName = userName?.split(" ")[0] || "User";

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
