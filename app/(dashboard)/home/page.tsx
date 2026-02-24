"use client";

import { useMemo } from "react";

import { useUserContext } from "@/lib/user-context";
import DashboardClient from "./dashboard-client";
import {
    isTodo,
    isActive,
    extractUserId,
    getPendingInfo,
} from "@/lib/task-service";
import { endOfDay } from "date-fns";
import { DashboardHomeSkeleton } from "@/components/ui/DashboardSkeleton";

export default function HomePage() {
    const { userId, tasks: allTasks, allOrgTasks, isLoading } = useUserContext();

    const { assignedToMe, waitingOnOthers, overdueTasks } = useMemo(() => {
        if (isLoading || !allTasks.length) {
            return { assignedToMe: [], waitingOnOthers: [], overdueTasks: [] };
        }

        const now = new Date();
        const todayEnd = endOfDay(now);

        // Assigned to me: tasks for today where I am NOT the owner (creator)
        // Uses d <= todayEnd so overdue assigned tasks (deadline < today) are included
        const assigned = allTasks.filter((t) => {
            if (!isActive(t) || isTodo(t)) return false;
            const creatorId = extractUserId(t.created_by);
            if (creatorId === userId) return false; // I own it, skip
            const dl = t.committed_deadline || t.deadline;
            if (!dl) return false;
            const d = new Date(dl);
            return d <= todayEnd;
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

        return { assignedToMe: assigned, waitingOnOthers: waitingOthers, overdueTasks: overdue };
    }, [allTasks, allOrgTasks, userId, isLoading]);

    // Show skeleton while data is loading
    if (isLoading) {
        return <DashboardHomeSkeleton />;
    }



    return (
        <DashboardClient
            currentUserId={userId}
            allTasks={allTasks}
            assignedToMe={assignedToMe}
            waitingOnOthers={waitingOnOthers}
            overdueTasks={overdueTasks}
        />
    );
}
