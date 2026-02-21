"use client";

/**
 * Section 3 — Pending Actions
 * Toggle between:
 *   - "Waiting on Others": subtasks/dependencies not yet accepted
 *   - "Action Required": tasks needing user's Accept / Reject / Add Dependency
 */

import { useState } from "react";
import { Clock, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import TaskCard from "./TaskCard";
import { getTaskColorCategory } from "@/lib/colors";
import { type Task } from "@/lib/types";

interface PendingActionsProps {
    waitingOnOthers: Task[];
    actionRequired: Task[];
    currentUserId: string;
    hideTitle?: boolean;
    forceMode?: "waiting" | "action";
}

export default function PendingActions({
    waitingOnOthers,
    actionRequired,
    currentUserId,
    hideTitle,
    forceMode,
}: PendingActionsProps) {
    const [activeToggle, setActiveToggle] = useState<"waiting" | "action">("action");

    const resolveToggle = forceMode || activeToggle;
    const activeTasks = resolveToggle === "waiting" ? waitingOnOthers : actionRequired;

    return (
        <section className="animate-fade-in-up" style={{ animationDelay: "0.05s" }}>
            {!hideTitle && (
                <div className="flex items-center gap-2 mb-4">
                    <div className="p-2 rounded-xl bg-amber-500">
                        <AlertTriangle className="w-4 h-4 text-white" />
                    </div>
                    <h2 className="text-lg font-bold text-gray-900 tracking-tight">Pending Actions</h2>
                </div>
            )}

            {/* Toggle */}
            {!forceMode && (
                <div className="flex bg-gray-100 rounded-xl p-1 mb-4">
                    <button
                        onClick={() => setActiveToggle("action")}
                        className={cn(
                            "flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-sm font-semibold transition-all duration-200",
                            activeToggle === "action"
                                ? "bg-white text-gray-900 shadow-sm"
                                : "text-gray-500 hover:text-gray-700"
                        )}
                    >
                        <AlertTriangle className="w-4 h-4" />
                        Action Required
                        {actionRequired.length > 0 && (
                            <span className={cn(
                                "px-1.5 py-0.5 text-[10px] font-bold rounded-full",
                                activeToggle === "action" ? "bg-gray-900 text-white" : "bg-gray-200 text-gray-600"
                            )}>
                                {actionRequired.length}
                            </span>
                        )}
                    </button>
                    <button
                        onClick={() => setActiveToggle("waiting")}
                        className={cn(
                            "flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-sm font-semibold transition-all duration-200",
                            activeToggle === "waiting"
                                ? "bg-white text-gray-900 shadow-sm"
                                : "text-gray-500 hover:text-gray-700"
                        )}
                    >
                        <Clock className="w-4 h-4" />
                        Waiting on Others
                        {waitingOnOthers.length > 0 && (
                            <span className={cn(
                                "px-1.5 py-0.5 text-[10px] font-bold rounded-full",
                                activeToggle === "waiting" ? "bg-gray-900 text-white" : "bg-gray-200 text-gray-600"
                            )}>
                                {waitingOnOthers.length}
                            </span>
                        )}
                    </button>
                </div>
            )}

            {/* Task List */}
            {activeTasks.length === 0 ? (
                <div className="p-8 text-center bg-gray-50 rounded-2xl border border-dashed border-gray-200">
                    <p className="text-sm text-gray-500 font-medium">
                        {resolveToggle === "action"
                            ? "No actions pending on you 🙌"
                            : "No dependencies waiting on others ✨"}
                    </p>
                </div>
            ) : (
                <div className="space-y-3">
                    {activeTasks.map(task => (
                        <TaskCard
                            key={task.id}
                            task={task}
                            category={getTaskColorCategory(task, currentUserId)}
                            currentUserId={currentUserId}
                        />
                    ))}
                </div>
            )}
        </section>
    );
}
