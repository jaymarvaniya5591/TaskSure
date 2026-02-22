"use client";

/**
 * EmployeeTaskList — Active task lists for an employee.
 * Has todo/task horizontal toggle matching the pattern used across all views.
 * Color coded using the central color system.
 */

import { useState } from "react";
import { Clock } from "lucide-react";
import { getTaskColorCategory } from "@/lib/colors";
import { type Task } from "@/lib/types";
import TaskCard from "@/components/dashboard/TaskCard";
import { cn } from "@/lib/utils";
import { isTodo as checkIsTodo } from "@/lib/task-service";

interface EmployeeTaskListProps {
    tasks: Task[];
    employeeId: string;
    currentUserId: string;
    hideToggle?: boolean;
}

export default function EmployeeTaskList({
    tasks,
    employeeId,
    currentUserId,
    hideToggle = false,
}: EmployeeTaskListProps) {
    const isOwnProfile = employeeId === currentUserId;
    const [subTab, setSubTab] = useState<"tasks" | "todos">("tasks");

    // Only display active tasks
    const activeTasks = tasks.filter(
        (t) => !["completed", "cancelled"].includes(t.status)
    );

    const todos = activeTasks.filter((t) => checkIsTodo(t));
    const multiTasks = activeTasks.filter((t) => !checkIsTodo(t));

    // When toggle is hidden (common tasks), show all tasks directly (no to-dos exist)
    const currentList = hideToggle ? activeTasks : (subTab === "tasks" ? multiTasks : todos);

    return (
        <div className="bg-gray-50/50 rounded-2xl border border-gray-100 shadow-sm p-3 sm:p-4">
            {/* Todo/Task Toggle — only for "All Tasks" view */}
            {!hideToggle && (
                <div className="flex bg-gray-100 rounded-xl p-1 mb-4 max-w-sm">
                    <button
                        onClick={() => setSubTab("tasks")}
                        className={cn(
                            "flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm font-semibold transition-all duration-200",
                            subTab === "tasks"
                                ? "bg-white text-gray-900 shadow-sm border border-gray-200"
                                : "text-gray-500 hover:text-gray-700 hover:bg-white/50"
                        )}
                    >
                        Tasks
                        <span
                            className={cn(
                                "px-1.5 py-0.5 text-[10px] font-bold rounded-full",
                                subTab === "tasks"
                                    ? "bg-gray-900 text-white"
                                    : "bg-gray-200 text-gray-600"
                            )}
                        >
                            {multiTasks.length}
                        </span>
                    </button>
                    <button
                        onClick={() => setSubTab("todos")}
                        className={cn(
                            "flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm font-semibold transition-all duration-200",
                            subTab === "todos"
                                ? "bg-white text-gray-900 shadow-sm border border-gray-200"
                                : "text-gray-500 hover:text-gray-700 hover:bg-white/50"
                        )}
                    >
                        To-dos
                        <span
                            className={cn(
                                "px-1.5 py-0.5 text-[10px] font-bold rounded-full",
                                subTab === "todos"
                                    ? "bg-gray-900 text-white"
                                    : "bg-gray-200 text-gray-600"
                            )}
                        >
                            {todos.length}
                        </span>
                    </button>
                </div>
            )}

            {/* Task List */}
            {currentList.length === 0 ? (
                <div className="text-center py-8 bg-transparent rounded-xl border border-dashed border-gray-200">
                    <Clock className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                    <p className="text-sm font-medium text-gray-500">
                        No active {subTab}
                    </p>
                </div>
            ) : (
                <div className="space-y-3">
                    {currentList.map((task) => (
                        <TaskCard
                            key={task.id}
                            task={task}
                            category={getTaskColorCategory(task, employeeId)}
                            currentUserId={currentUserId}
                            isOwnProfile={isOwnProfile}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
