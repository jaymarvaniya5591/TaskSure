"use client";

import { useState } from "react";
import EmployeeStats from "./EmployeeStats";
import EmployeeTaskList from "./EmployeeTaskList";
import { type Task } from "@/lib/types";
import { cn } from "@/lib/utils";

interface EmployeeContentProps {
    assignedTasks: Task[];
    commonTasks: Task[];
    otherTasks: Task[];
    employeeId: string;
}

export default function EmployeeContent({ assignedTasks, commonTasks, otherTasks, employeeId }: EmployeeContentProps) {
    const [tab, setTab] = useState<"performance" | "tasks">("performance");
    const [taskFilter, setTaskFilter] = useState<"common" | "all">("common");

    return (
        <div className="space-y-6">
            {/* Horizontal Toggle */}
            <div className="flex items-center gap-2 p-1 bg-gray-100 rounded-xl w-full max-w-sm mx-auto sm:mx-0">
                <button
                    onClick={() => setTab("performance")}
                    className={cn(
                        "flex-1 py-2 text-sm font-bold rounded-lg transition-all duration-200",
                        tab === "performance" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
                    )}
                >
                    Performance
                </button>
                <button
                    onClick={() => setTab("tasks")}
                    className={cn(
                        "flex-1 py-2 text-sm font-bold rounded-lg transition-all duration-200",
                        tab === "tasks" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
                    )}
                >
                    Tasks
                </button>
            </div>

            {/* Content Area */}
            {tab === "performance" ? (
                <EmployeeStats allTasks={assignedTasks} />
            ) : (
                <div className="space-y-4">
                    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex sm:flex-row flex-col justify-between items-start sm:items-center gap-4">
                        <h3 className="text-sm font-bold uppercase tracking-wider text-gray-400">
                            Task List
                        </h3>
                        <div className="flex bg-gray-100 p-1 rounded-lg w-full sm:w-auto">
                            <button
                                onClick={() => setTaskFilter("common")}
                                className={cn(
                                    "px-4 py-1.5 text-xs font-bold rounded-md transition-all flex-1 sm:flex-none",
                                    taskFilter === "common" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
                                )}
                            >
                                Common Tasks ({commonTasks.length})
                            </button>
                            <button
                                onClick={() => setTaskFilter("all")}
                                className={cn(
                                    "px-4 py-1.5 text-xs font-bold rounded-md transition-all flex-1 sm:flex-none",
                                    taskFilter === "all" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
                                )}
                            >
                                Other Tasks ({otherTasks.length})
                            </button>
                        </div>
                    </div>
                    <EmployeeTaskList
                        tasks={taskFilter === "common" ? commonTasks : otherTasks}
                        employeeId={employeeId}
                        hideToggle={taskFilter === "common"}
                    />
                </div>
            )}
        </div>
    );
}
