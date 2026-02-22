"use client";

import { useUserContext } from "@/lib/user-context";
import AllTasksClient from "@/components/tasks/AllTasksClient";
import { isTodo } from "@/lib/task-service";

export default function AllTasksPage() {
    const { userId, tasks: allUniqueTasks } = useUserContext();

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
