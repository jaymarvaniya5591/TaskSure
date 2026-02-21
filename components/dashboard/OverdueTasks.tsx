"use client";

/**
 * Section 6 — Overdue Tasks
 * All tasks where the logged-in user is a participant/owner
 * and the deadline has passed.
 */

import { AlertCircle } from "lucide-react";
import { type Task } from "@/lib/types";
import TaskCard from "./TaskCard";

interface OverdueTasksProps {
    tasks: Task[];
    currentUserId: string;
    hideTitle?: boolean;
}

export default function OverdueTasks({ tasks, currentUserId, hideTitle }: OverdueTasksProps) {
    if (tasks.length === 0) return null;

    return (
        <section className="animate-fade-in-up" style={{ animationDelay: "0.2s" }}>
            {!hideTitle && (
                <div className="flex items-center gap-2 mb-4">
                    <div className="p-2 rounded-xl bg-overdue-500">
                        <AlertCircle className="w-4 h-4 text-white" />
                    </div>
                    <h2 className="text-lg font-bold text-gray-900 tracking-tight">Overdue</h2>
                    <span className="ml-auto px-2.5 py-0.5 text-xs font-bold rounded-full bg-overdue-100 text-overdue-700 border border-overdue-200">
                        {tasks.length}
                    </span>
                </div>
            )}

            <div className="space-y-3">
                {tasks.map(task => (
                    <TaskCard
                        key={task.id}
                        task={task}
                        category="overdue"
                        currentUserId={currentUserId}
                    />
                ))}
            </div>
        </section>
    );
}
