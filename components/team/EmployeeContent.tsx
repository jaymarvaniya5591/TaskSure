"use client";

import { useState } from "react";
import EmployeeStats from "./EmployeeStats";
import EmployeeTaskList from "./EmployeeTaskList";
import { type Task } from "@/lib/types";
import { cn } from "@/lib/utils";
import { BarChart3 } from "lucide-react";

interface EmployeeContentProps {
    assignedTasks: Task[];
    commonTasks: Task[];
    otherTasks: Task[];
    employeeId: string;
    currentUserId: string;
}

export default function EmployeeContent({ assignedTasks, commonTasks, otherTasks, employeeId, currentUserId }: EmployeeContentProps) {
    const [taskFilter, setTaskFilter] = useState<"common" | "other">("common");
    const [showPerformance, setShowPerformance] = useState(false);

    return (
        <div className="space-y-4">
            {/* ── Toggle: Common Tasks / Other Tasks (same design as AllTasksClient) ── */}
            <div className="flex bg-gray-100 rounded-xl p-1">
                <button
                    onClick={() => setTaskFilter("common")}
                    className={cn(
                        "flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-sm font-semibold transition-all duration-200 whitespace-nowrap",
                        taskFilter === "common"
                            ? "bg-white text-gray-900 shadow-sm"
                            : "text-gray-500 hover:text-gray-700"
                    )}
                >
                    Common Tasks
                    <span className={cn(
                        "aspect-square p-1 inline-flex items-center justify-center text-[10px] font-bold rounded-full leading-none",
                        taskFilter === "common" ? "bg-gray-900 text-white" : "bg-gray-200 text-gray-600"
                    )}>
                        {commonTasks.length}
                    </span>
                </button>
                <button
                    onClick={() => setTaskFilter("other")}
                    className={cn(
                        "flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-sm font-semibold transition-all duration-200 whitespace-nowrap",
                        taskFilter === "other"
                            ? "bg-white text-gray-900 shadow-sm"
                            : "text-gray-500 hover:text-gray-700"
                    )}
                >
                    Other Tasks
                    <span className={cn(
                        "aspect-square p-1 inline-flex items-center justify-center text-[10px] font-bold rounded-full leading-none",
                        taskFilter === "other" ? "bg-gray-900 text-white" : "bg-gray-200 text-gray-600"
                    )}>
                        {otherTasks.length}
                    </span>
                </button>
            </div>

            {/* Task List */}
            <EmployeeTaskList
                tasks={taskFilter === "common" ? commonTasks : otherTasks}
                employeeId={employeeId}
                currentUserId={currentUserId}
                hideToggle={taskFilter === "common"}
            />

            {/* ── Performance Section ── */}
            <div className="pt-2">
                <button
                    onClick={() => setShowPerformance(!showPerformance)}
                    className={cn(
                        "w-full flex items-center justify-center gap-2 py-3 rounded-xl border text-sm font-bold transition-all duration-200",
                        showPerformance
                            ? "bg-gray-900 text-white border-gray-900"
                            : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50 hover:border-gray-300"
                    )}
                >
                    <BarChart3 className="w-4 h-4" />
                    {showPerformance ? "Hide Performance" : "View Performance"}
                </button>

                {showPerformance && (
                    <div className="mt-4 animate-fade-in-up">
                        <EmployeeStats allTasks={assignedTasks} />
                    </div>
                )}
            </div>
        </div>
    );
}
