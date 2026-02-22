"use client";

import { useUserContext } from "@/lib/user-context";
import AllTasksClient from "@/components/tasks/AllTasksClient";
import { isTodo } from "@/lib/task-service";
import { AllTasksSkeleton } from "@/components/ui/DashboardSkeleton";

export default function AllTasksPage() {
    const { userId, tasks: allUniqueTasks, isLoading } = useUserContext();

    if (isLoading) {
        return <AllTasksSkeleton />;
    }

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
