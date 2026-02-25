"use client";

import { useUserContext } from "@/lib/user-context";
import DashboardClient from "./dashboard-client";
import { DashboardHomeSkeleton } from "@/components/ui/DashboardSkeleton";

export default function HomePage() {
    const { userId, tasks: allTasks, allOrgTasks, isLoading } = useUserContext();

    // Show skeleton while data is loading
    if (isLoading) {
        return <DashboardHomeSkeleton />;
    }

    return (
        <DashboardClient
            currentUserId={userId}
            allTasks={allTasks}
            allOrgTasks={allOrgTasks}
        />
    );
}
