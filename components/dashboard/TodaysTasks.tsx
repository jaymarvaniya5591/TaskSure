"use client";

/**
 * Section 2 — Today's Tasks
 * Tasks where the logged-in user is a participant and deadline is today.
 * Color coded using the central color system.
 */

import { CalendarCheck } from "lucide-react";
import TaskCard from "./TaskCard";
import { getTaskColorCategory } from "@/lib/colors";
import { type Task } from "@/lib/types";

interface TodaysTasksProps {
    tasks: Task[];
    currentUserId: string;
    hideTitle?: boolean;
}

export default function TodaysTasks({ tasks, currentUserId, hideTitle }: TodaysTasksProps) {
    return (
        <section className="animate-fade-in-up">
            {!hideTitle && (
                <div className="flex items-center gap-2 mb-4">
                    <div className="p-2 rounded-xl bg-gray-900">
                        <CalendarCheck className="w-4 h-4 text-white" />
                    </div>
                    <h2 className="text-lg font-bold text-gray-900 tracking-tight">Today&apos;s Tasks</h2>
                    {tasks.length > 0 && (
                        <span className="ml-auto px-2.5 py-0.5 text-xs font-bold rounded-full bg-gray-900 text-white">
                            {tasks.length}
                        </span>
                    )}
                </div>
            )}

            {tasks.length === 0 ? (
                <div className="p-8 text-center bg-gray-50 rounded-2xl border border-dashed border-gray-200">
                    <p className="text-sm text-gray-500 font-medium">No tasks due today — you&apos;re all clear 🎉</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {tasks.map(task => (
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
