"use client";

/**
 * TaskCard — Reusable color-coded task card used across all dashboard sections.
 * Shows title, deadline (or "NA"), last active participant, participant count.
 * Color-coded left border based on category.
 * Includes TaskActions with role-based action support.
 * Info icon toggles an inline activity timeline dropdown.
 */

import { memo, useState } from "react";
import dynamic from "next/dynamic";
import { format } from "date-fns";
import { Clock, User, Users, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { type TaskColorCategory, getCategoryStyles } from "@/lib/colors";
import { type Task } from "@/lib/types";

// Dynamic imports: TaskActions (45KB) + TaskTimelineModal (8.6KB)
// Only loaded when user interacts with a task card
const TaskActions = dynamic(
    () => import("./TaskActions").then(m => ({ default: m.TaskActions })),
    { ssr: false, loading: () => <div className="w-8 h-8" /> }
);
const TaskTimeline = dynamic(
    () => import("./TaskTimelineModal"),
    { ssr: false }
);

interface TaskCardProps {
    task: Task;
    category: TaskColorCategory;
    currentUserId: string;
    showOwner?: boolean;
    compact?: boolean;
    isOwnProfile?: boolean;
    tags?: TaskColorCategory[];
}

export const TaskCard = memo(function TaskCard({
    task,
    category,
    currentUserId,
    showOwner = true,
    compact = false,
    isOwnProfile = true,
    tags,
}: TaskCardProps) {
    const [showTimeline, setShowTimeline] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);

    const styles = getCategoryStyles(category);
    // For tasks with a separate owner/assignee: show committed_deadline only (set on acceptance)
    // For self-assigned tasks (todos): show deadline directly (owner IS the assignee)
    const isSelfAssigned = typeof task.created_by === 'string'
        ? task.created_by === task.assigned_to
        : typeof task.assigned_to === 'string'
            ? task.created_by?.id === task.assigned_to
            : task.created_by?.id === task.assigned_to?.id;
    const effectiveDeadline = isSelfAssigned
        ? (task.committed_deadline || task.deadline)
        : task.committed_deadline;

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
                "bg-white",
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
            <div className={cn("flex items-start justify-between gap-2", compact ? "p-3" : "p-3 sm:p-4")}>
                <div className="flex flex-col gap-1.5 pl-3 flex-1 min-w-0">
                    <p
                        onClick={(e) => {
                            e.stopPropagation();
                            setIsExpanded(!isExpanded);
                        }}
                        className={cn(
                            "font-semibold text-sm sm:text-[15px] pr-1 text-gray-900 break-words cursor-pointer transition-all duration-200",
                            !isExpanded && "line-clamp-2"
                        )}
                        title={!isExpanded ? "Click to see full task" : "Click to collapse"}
                    >
                        {task.title}
                    </p>
                    <div className="flex items-center gap-x-2 gap-y-1 flex-wrap">
                        {/* Deadline or NA */}
                        <span className="text-xs text-gray-500 flex items-center gap-1 whitespace-nowrap">
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
                                <span className="w-1 h-1 rounded-full bg-gray-300 hidden sm:block" />
                                <span className="text-xs text-gray-500 flex items-center gap-1">
                                    <User className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                                    <span className="break-words">{displayPerson}</span>
                                </span>
                            </>
                        )}

                        {/* Participant count (only for multi-participant tasks) */}
                        {task.participant_count && task.participant_count > 1 && (
                            <>
                                <span className="w-1 h-1 rounded-full bg-gray-300 hidden sm:block" />
                                <span className="text-xs text-gray-500 flex items-center gap-1">
                                    <Users className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                                    {task.participant_count}
                                </span>
                            </>
                        )}

                        {/* Category badges — show all applicable tags when available */}
                        {tags && tags.length > 0 ? (
                            tags.filter(tag => isOwnProfile || tag === 'overdue').map(tag => {
                                const tagStyles = getCategoryStyles(tag);
                                return (
                                    <span
                                        key={tag}
                                        className={cn(
                                            "px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase tracking-wide whitespace-nowrap",
                                            tagStyles.badge
                                        )}
                                    >
                                        {tagStyles.label}
                                    </span>
                                );
                            })
                        ) : (
                            (isOwnProfile || category === "overdue") && (
                                <span
                                    className={cn(
                                        "px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase tracking-wide whitespace-nowrap",
                                        styles.badge
                                    )}
                                >
                                    {styles.label}
                                </span>
                            )
                        )}
                    </div>
                    {/* Pending from indicator — on its own row for full visibility */}
                    {pendingFrom && (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-100 text-amber-700 border border-amber-200 uppercase tracking-wide self-start max-w-full truncate block">
                            Pending: {("first_name" in pendingFrom && pendingFrom.first_name) ? `${pendingFrom.first_name} ${pendingFrom.last_name || ''}`.trim() : (pendingFrom.name || "...")}
                        </span>
                    )}
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
});

export default TaskCard;
