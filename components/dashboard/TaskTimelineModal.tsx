"use client";

/**
 * TaskTimeline — Inline expandable vertical timeline for a task.
 * Supports branched timelines for subtasks:
 *   - `subtask.created` starts a visual branch (indented with colored border)
 *   - Subtask activity appears within the branch
 *   - `subtask.completed` merges the branch back to the main timeline
 */

import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
    Loader2,
    CheckCircle2,
    XCircle,
    Calendar,
    UserPlus,
    Trash2,
    PlusCircle,
    Circle,
    GitBranch,
    GitMerge,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface TimelineLog {
    id: string;
    action: string;
    metadata: Record<string, unknown>;
    created_at: string;
    user_id: string;
    users?: {
        id: string;
        name: string;
        avatar_url: string | null;
    };
    // Used to group subtask entries into branches
    entity_id?: string;
}

// ─── Action styling ─────────────────────────────────────────────────────────

const ACTION_STYLE: Record<
    string,
    { label: string; icon: typeof Circle; iconColor: string; bgColor: string }
> = {
    "task.created": {
        label: "Created",
        icon: PlusCircle,
        iconColor: "text-emerald-500",
        bgColor: "bg-emerald-50",
    },
    "todo.created": {
        label: "Created",
        icon: PlusCircle,
        iconColor: "text-emerald-500",
        bgColor: "bg-emerald-50",
    },
    "subtask.created": {
        label: "Subtask Created",
        icon: GitBranch,
        iconColor: "text-teal-500",
        bgColor: "bg-teal-50",
    },
    "task.accepted": {
        label: "Accepted",
        icon: CheckCircle2,
        iconColor: "text-emerald-500",
        bgColor: "bg-emerald-50",
    },
    "task.rejected": {
        label: "Rejected",
        icon: XCircle,
        iconColor: "text-red-400",
        bgColor: "bg-red-50",
    },
    "task.completed": {
        label: "Completed",
        icon: CheckCircle2,
        iconColor: "text-emerald-500",
        bgColor: "bg-emerald-50",
    },
    "todo.completed": {
        label: "Completed",
        icon: CheckCircle2,
        iconColor: "text-emerald-500",
        bgColor: "bg-emerald-50",
    },
    "subtask.completed": {
        label: "Subtask Completed",
        icon: GitMerge,
        iconColor: "text-emerald-600",
        bgColor: "bg-emerald-50",
    },
    "task.deadline_edited": {
        label: "Deadline Updated",
        icon: Calendar,
        iconColor: "text-amber-500",
        bgColor: "bg-amber-50",
    },
    "task.reassigned": {
        label: "Reassigned",
        icon: UserPlus,
        iconColor: "text-violet-500",
        bgColor: "bg-violet-50",
    },
    "task.deleted": {
        label: "Deleted",
        icon: Trash2,
        iconColor: "text-red-400",
        bgColor: "bg-red-50",
    },
};

const DEFAULT_STYLE = {
    label: "Activity",
    icon: Circle,
    iconColor: "text-gray-400",
    bgColor: "bg-gray-50",
};

function getStyle(action: string) {
    return ACTION_STYLE[action] || DEFAULT_STYLE;
}

// ─── Branch Colors ──────────────────────────────────────────────────────────
// Cycle through these for different subtask branches
const BRANCH_COLORS = [
    { border: "border-teal-300", bg: "bg-teal-50/50", text: "text-teal-700" },
    { border: "border-violet-300", bg: "bg-violet-50/50", text: "text-violet-700" },
    { border: "border-amber-300", bg: "bg-amber-50/50", text: "text-amber-700" },
    { border: "border-blue-300", bg: "bg-blue-50/50", text: "text-blue-700" },
    { border: "border-rose-300", bg: "bg-rose-50/50", text: "text-rose-700" },
];

// ─── Component ──────────────────────────────────────────────────────────────

interface TaskTimelineProps {
    taskId: string;
}

import { createClient } from "@/lib/supabase/client";

// Helper to extract subtask_id from metadata
function getSubtaskId(log: TimelineLog): string | null {
    return (log.metadata?.subtask_id as string) || null;
}

export default function TaskTimeline({ taskId }: TaskTimelineProps) {
    const supabase = createClient();

    const { data: logs, isLoading: loading, error } = useQuery({
        queryKey: ["task-timeline", taskId],
        queryFn: async () => {
            // Fetch all audit_log entries for this task (includes subtask.created/completed events
            // which were written with entity_id = this task's ID)
            const { data, error } = await supabase
                .from("audit_log")
                .select("id, action, metadata, created_at, user_id, entity_id, users:user_id(id, name, avatar_url)")
                .eq("entity_type", "task")
                .eq("entity_id", taskId)
                .order("created_at", { ascending: true }); // ascending for branch grouping

            if (error) throw new Error(error.message);

            // Also fetch subtask IDs from this task to load their individual timelines
            const { data: subtasks } = await supabase
                .from("tasks")
                .select("id, title")
                .eq("parent_task_id", taskId) as { data: { id: string; title: string }[] | null };

            let subtaskLogs: TimelineLog[] = [];
            if (subtasks && subtasks.length > 0) {
                const subtaskIds = subtasks.map((s: { id: string }) => s.id);
                const { data: sLogs } = await supabase
                    .from("audit_log")
                    .select("id, action, metadata, created_at, user_id, entity_id, users:user_id(id, name, avatar_url)")
                    .eq("entity_type", "task")
                    .in("entity_id", subtaskIds)
                    .order("created_at", { ascending: true });

                if (sLogs) {
                    subtaskLogs = sLogs.map((log: Record<string, unknown>) => ({
                        ...log,
                        users: Array.isArray(log.users) ? log.users[0] : log.users
                    })) as TimelineLog[];
                }
            }

            // Map single user object to be compatible with existing component structure
            const mainLogs = data.map((log: Record<string, unknown>) => ({
                ...log,
                users: Array.isArray(log.users) ? log.users[0] : log.users
            })) as TimelineLog[];

            return { mainLogs, subtaskLogs, subtasks: (subtasks || []) as { id: string; title: string }[] };
        },
        staleTime: Infinity,
    });

    if (loading) {
        return (
            <div className="flex items-center justify-center py-6">
                <Loader2 className="w-5 h-5 animate-spin text-gray-300" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="py-4 text-center text-xs font-medium text-red-400">
                {(error as Error)?.message || "Network error"}
            </div>
        );
    }

    const mainLogs = logs?.mainLogs || [];
    const subtaskLogs = logs?.subtaskLogs || [];
    const subtasks = logs?.subtasks || [];

    if (mainLogs.length === 0 && subtaskLogs.length === 0) {
        return (
            <div className="py-4 text-center text-xs font-medium text-gray-400">
                No activity yet
            </div>
        );
    }

    // Build a map of subtask_id → branch color
    const subtaskColorMap = new Map<string, typeof BRANCH_COLORS[0]>();
    subtasks.forEach((s, i) => {
        subtaskColorMap.set(s.id, BRANCH_COLORS[i % BRANCH_COLORS.length]);
    });

    // Build a map of subtask_id → title
    const subtaskTitleMap = new Map<string, string>();
    subtasks.forEach(s => subtaskTitleMap.set(s.id, s.title));

    // Group subtask logs by entity_id
    const subtaskLogsByEntity = new Map<string, TimelineLog[]>();
    subtaskLogs.forEach(log => {
        const entityId = log.entity_id || "";
        if (!subtaskLogsByEntity.has(entityId)) {
            subtaskLogsByEntity.set(entityId, []);
        }
        subtaskLogsByEntity.get(entityId)!.push(log);
    });

    // Build the merged timeline: main events + inline subtask branches
    // We show the timeline in reverse-chronological order (newest first) for display
    const reversedMainLogs = [...mainLogs].reverse();

    return (
        <div className="py-3 px-1">
            {reversedMainLogs.map((log, i) => {
                const style = getStyle(log.action);
                const Icon = style.icon;
                const isLast = i === reversedMainLogs.length - 1;
                const subtaskId = getSubtaskId(log);

                // Check if this is a subtask.created event — render the branch inline
                if (log.action === "subtask.created" && subtaskId) {
                    const branchColor = subtaskColorMap.get(subtaskId) || BRANCH_COLORS[0];
                    const branchLogs = subtaskLogsByEntity.get(subtaskId) || [];
                    const subtaskTitle = (log.metadata?.subtask_title as string) || subtaskTitleMap.get(subtaskId) || "Subtask";

                    return (
                        <div key={log.id}>
                            {/* Branch start indicator */}
                            <div className="flex items-stretch gap-3">
                                <div className="flex flex-col items-center w-7 shrink-0">
                                    <div className={cn("w-7 h-7 rounded-full flex items-center justify-center shrink-0", style.bgColor)}>
                                        <Icon className={cn("w-3.5 h-3.5", style.iconColor)} />
                                    </div>
                                    <div className="w-px flex-1 bg-gray-200 min-h-[16px]" />
                                </div>
                                <div className="flex-1 flex items-start justify-between min-w-0 pb-2">
                                    <div className="min-w-0">
                                        <span className={cn("text-xs font-semibold", style.iconColor)}>
                                            {style.label}
                                        </span>
                                        <p className={cn("text-[11px] font-bold mt-0.5 truncate", branchColor.text)}>
                                            {subtaskTitle}
                                        </p>
                                        {log.users?.name && (
                                            <p className="text-[11px] text-gray-400 font-medium mt-0.5">
                                                by {log.users.name}
                                            </p>
                                        )}
                                    </div>
                                    <div className="text-right shrink-0 ml-3">
                                        <span className="text-[11px] font-medium text-gray-400 block">
                                            {format(new Date(log.created_at), "d MMM")}
                                        </span>
                                        <span className="text-[10px] text-gray-300 font-medium">
                                            {format(new Date(log.created_at), "h:mm a")}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {/* Branch body — indented logs from the subtask */}
                            {branchLogs.length > 0 && (
                                <div className="flex gap-3">
                                    {/* Connector line on the main stem */}
                                    <div className="flex flex-col items-center w-7 shrink-0">
                                        <div className="w-px flex-1 bg-gray-200" />
                                    </div>
                                    <div className={cn(
                                        "flex-1 ml-0.5 mb-2 rounded-xl border-l-2 pl-3 py-2",
                                        branchColor.border,
                                        branchColor.bg,
                                    )}>
                                        {branchLogs.map((bLog, bi) => {
                                            const bStyle = getStyle(bLog.action);
                                            const BIcon = bStyle.icon;
                                            const isBranchLast = bi === branchLogs.length - 1;

                                            return (
                                                <div key={bLog.id} className="flex items-stretch gap-2.5">
                                                    <div className="flex flex-col items-center w-5 shrink-0">
                                                        <div className={cn("w-5 h-5 rounded-full flex items-center justify-center shrink-0", bStyle.bgColor)}>
                                                            <BIcon className={cn("w-2.5 h-2.5", bStyle.iconColor)} />
                                                        </div>
                                                        {!isBranchLast && (
                                                            <div className={cn("w-px flex-1 min-h-[10px]", branchColor.border.replace("border-", "bg-").replace("-300", "-200"))} />
                                                        )}
                                                    </div>
                                                    <div className={cn("flex-1 flex items-start justify-between min-w-0", isBranchLast ? "pb-0" : "pb-2")}>
                                                        <div className="min-w-0">
                                                            <span className={cn("text-[10px] font-semibold", bStyle.iconColor)}>
                                                                {bStyle.label}
                                                            </span>
                                                            {bLog.users?.name && (
                                                                <p className="text-[10px] text-gray-400 font-medium truncate">
                                                                    by {bLog.users.name}
                                                                </p>
                                                            )}
                                                        </div>
                                                        <div className="text-right shrink-0 ml-2">
                                                            <span className="text-[10px] font-medium text-gray-400">
                                                                {format(new Date(bLog.created_at), "d MMM")}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                }

                // Check if this is a subtask.completed event — render merge indicator
                if (log.action === "subtask.completed") {
                    const branchColor = subtaskId ? (subtaskColorMap.get(subtaskId) || BRANCH_COLORS[0]) : BRANCH_COLORS[0];
                    const subtaskTitle = (log.metadata?.subtask_title as string) || "Subtask";

                    return (
                        <div key={log.id} className="flex items-stretch gap-3">
                            <div className="flex flex-col items-center w-7 shrink-0">
                                <div className={cn("w-7 h-7 rounded-full flex items-center justify-center shrink-0", style.bgColor)}>
                                    <Icon className={cn("w-3.5 h-3.5", style.iconColor)} />
                                </div>
                                {!isLast && (
                                    <div className="w-px flex-1 bg-gray-200 min-h-[16px]" />
                                )}
                            </div>
                            <div className={cn("flex-1 flex items-start justify-between min-w-0", isLast ? "pb-0" : "pb-3")}>
                                <div className="min-w-0">
                                    <span className={cn("text-xs font-semibold", style.iconColor)}>
                                        {style.label}
                                    </span>
                                    <p className={cn("text-[11px] font-bold mt-0.5 truncate", branchColor.text)}>
                                        ✓ {subtaskTitle}
                                    </p>
                                    {log.users?.name && (
                                        <p className="text-[11px] text-gray-400 font-medium mt-0.5">
                                            by {log.users.name}
                                        </p>
                                    )}
                                </div>
                                <div className="text-right shrink-0 ml-3">
                                    <span className="text-[11px] font-medium text-gray-400 block">
                                        {format(new Date(log.created_at), "d MMM")}
                                    </span>
                                    <span className="text-[10px] text-gray-300 font-medium">
                                        {format(new Date(log.created_at), "h:mm a")}
                                    </span>
                                </div>
                            </div>
                        </div>
                    );
                }

                // Regular main-stem events (created, accepted, rejected, etc.)
                return (
                    <div key={log.id} className="flex items-stretch gap-3">
                        <div className="flex flex-col items-center w-7 shrink-0">
                            <div className={cn("w-7 h-7 rounded-full flex items-center justify-center shrink-0", style.bgColor)}>
                                <Icon className={cn("w-3.5 h-3.5", style.iconColor)} />
                            </div>
                            {!isLast && (
                                <div className="w-px flex-1 bg-gray-200 min-h-[16px]" />
                            )}
                        </div>
                        <div className={cn("flex-1 flex items-start justify-between min-w-0", isLast ? "pb-0" : "pb-3")}>
                            <div className="min-w-0">
                                <span className={cn("text-xs font-semibold", style.iconColor)}>
                                    {style.label}
                                </span>
                                {log.action === "task.reassigned" && (log.metadata as { old_name?: string; new_name?: string })?.new_name ? (
                                    <div className="mt-1 flex flex-col gap-0.5">
                                        {(log.metadata as { old_name?: string; new_name?: string }).old_name && (
                                            <span className="text-[11px] text-red-500 line-through font-medium leading-tight break-words">
                                                {(log.metadata as { old_name?: string; new_name?: string }).old_name}
                                            </span>
                                        )}
                                        <span className="text-[11px] text-emerald-500 font-medium leading-tight break-words">
                                            {(log.metadata as { old_name?: string; new_name?: string }).old_name ? "→ " : ""}
                                            {(log.metadata as { old_name?: string; new_name?: string }).new_name}
                                        </span>
                                    </div>
                                ) : log.users?.name ? (
                                    <p className="text-[11px] text-gray-400 font-medium truncate mt-0.5">
                                        by {log.users.name}
                                    </p>
                                ) : null}
                            </div>
                            <div className="text-right shrink-0 ml-3">
                                <span className="text-[11px] font-medium text-gray-400 block">
                                    {format(new Date(log.created_at), "d MMM")}
                                </span>
                                <span className="text-[10px] text-gray-300 font-medium">
                                    {format(new Date(log.created_at), "h:mm a")}
                                </span>
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
