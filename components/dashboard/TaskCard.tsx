"use client";

/**
 * TaskCard — Reusable color-coded task card used across all dashboard sections.
 * Shows title, deadline (or "NA"), last active participant, participant count.
 * Color-coded left border based on category.
 * Includes TaskActions with role-based action support.
 * Info icon toggles an inline activity timeline dropdown.
 */

import { useState } from "react";
import { format } from "date-fns";
import { Clock, User, Users, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { type TaskColorCategory, getCategoryStyles } from "@/lib/colors";
import { type Task } from "@/lib/types";
import TaskActions from "./TaskActions";
import TaskTimeline from "./TaskTimelineModal";

interface TaskCardProps {
    task: Task;
    category: TaskColorCategory;
    currentUserId: string;
    showOwner?: boolean;
    compact?: boolean;
    isOwnProfile?: boolean;
}

export default function TaskCard({
    task,
    category,
    currentUserId,
    showOwner = true,
    compact = false,
    isOwnProfile = true,
}: TaskCardProps) {
    const [showTimeline, setShowTimeline] = useState(false);

    const styles = getCategoryStyles(category);
    const effectiveDeadline = task.committed_deadline || task.deadline;

    // Determine who to show: last_active_participant (computed), or fallback to assigned_to/created_by
    const lastActive = task.last_active_participant;
    const displayPerson =
        lastActive?.name ||
        (typeof task.assigned_to === "object" ? task.assigned_to?.name : null) ||
        (typeof task.created_by === "object" ? task.created_by?.name : null);

    // Pending from info
    const pendingFrom = task.pending_from;

    return (
        <div
            className={cn(
                "group relative rounded-2xl border transition-all duration-200",
                "z-10 focus-within:z-20 hover:z-20",
                "hover:shadow-md hover:-translate-y-0.5",
                styles.bg,
                styles.border
            )}
        >
            {/* Color accent bar */}
            <div
                className={cn(
                    "absolute left-0 top-3 bottom-3 w-1 rounded-full",
                    styles.accent
                )}
            />

            {/* Main row */}
            <div className={cn("flex items-center justify-between", compact ? "p-3" : "p-4")}>
                <div className="flex flex-col gap-1 pl-3 flex-1 min-w-0">
                    <p className="font-semibold text-[15px] pr-2 text-gray-900 line-clamp-2">
                        {task.title}
                    </p>
                    <div className="flex items-center gap-2 flex-wrap">
                        {/* Deadline or NA */}
                        <span className="text-xs text-gray-500 flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                            {effectiveDeadline
                                ? format(
                                    new Date(effectiveDeadline),
                                    "MMM d, h:mm a"
                                )
                                : "NA"}
                        </span>

                        {/* Person display */}
                        {showOwner && displayPerson && (
                            <>
                                <span className="w-1 h-1 rounded-full bg-gray-300" />
                                <span className="text-xs text-gray-500 flex items-center gap-1">
                                    <User className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                                    {displayPerson}
                                </span>
                            </>
                        )}

                        {/* Participant count (only for multi-participant tasks) */}
                        {task.participant_count && task.participant_count > 1 && (
                            <>
                                <span className="w-1 h-1 rounded-full bg-gray-300" />
                                <span className="text-xs text-gray-500 flex items-center gap-1">
                                    <Users className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                                    {task.participant_count}
                                </span>
                            </>
                        )}

                        {/* Category badge — ownership labels only on own profile; overdue always shows */}
                        {(isOwnProfile || category === "overdue") && (
                            <span
                                className={cn(
                                    "px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase tracking-wide",
                                    styles.badge
                                )}
                            >
                                {styles.label}
                            </span>
                        )}

                        {/* Pending from indicator */}
                        {pendingFrom && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700 border border-amber-200 uppercase tracking-wide">
                                Pending: {pendingFrom.name || "..."}
                            </span>
                        )}
                    </div>
                </div>

                <div className="shrink-0 ml-2 flex items-center">
                    {/* Timeline toggle button */}
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            setShowTimeline(!showTimeline);
                        }}
                        className={cn(
                            "p-2 mr-1 rounded-xl transition-all duration-200",
                            showTimeline
                                ? "bg-gray-900 text-white"
                                : "text-gray-400 hover:text-gray-600 hover:bg-gray-100"
                        )}
                        title="Activity Timeline"
                    >
                        <ChevronDown
                            className={cn(
                                "w-4 h-4 transition-transform duration-200",
                                showTimeline && "rotate-180"
                            )}
                        />
                    </button>
                    <TaskActions task={task} currentUserId={currentUserId} />
                </div>
            </div>

            {/* Inline Timeline Dropdown */}
            {showTimeline && (
                <div className="border-t border-gray-100 mx-4 mb-3">
                    <TaskTimeline taskId={task.id} />
                </div>
            )}
        </div>
    );
}
