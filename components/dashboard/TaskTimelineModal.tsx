"use client";

/**
 * TaskTimeline — Inline expandable vertical timeline for a task.
 * Drops down inside the task card, no modal/popup.
 * Minimal design inspired by "Process timeline" cards.
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

// ─── Component ──────────────────────────────────────────────────────────────

interface TaskTimelineProps {
    taskId: string;
}

import { createClient } from "@/lib/supabase/client";

export default function TaskTimeline({ taskId }: TaskTimelineProps) {
    const supabase = createClient();

    const { data: logs, isLoading: loading, error } = useQuery({
        queryKey: ["task-timeline", taskId],
        queryFn: async () => {
            const { data, error } = await supabase
                .from("audit_log")
                .select("id, action, metadata, created_at, user_id, users:user_id(id, name, avatar_url)")
                .eq("item_id", taskId)
                .order("created_at", { ascending: false });

            if (error) throw new Error(error.message);

            // Map single user object to be compatible with existing component structure
            return data.map(log => ({
                ...log,
                users: Array.isArray(log.users) ? log.users[0] : log.users
            })) as TimelineLog[];
        },
        staleTime: 5 * 60 * 1000,
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

    if (!logs || logs.length === 0) {
        return (
            <div className="py-4 text-center text-xs font-medium text-gray-400">
                No activity yet
            </div>
        );
    }

    return (
        <div className="py-3 px-1">
            {logs.map((log, i) => {
                const style = getStyle(log.action);
                const Icon = style.icon;
                const isLast = i === logs.length - 1;

                return (
                    <div key={log.id} className="flex items-stretch gap-3">
                        {/* Icon column + connector line */}
                        <div className="flex flex-col items-center w-7 shrink-0">
                            <div
                                className={cn(
                                    "w-7 h-7 rounded-full flex items-center justify-center shrink-0",
                                    style.bgColor
                                )}
                            >
                                <Icon className={cn("w-3.5 h-3.5", style.iconColor)} />
                            </div>
                            {!isLast && (
                                <div className="w-px flex-1 bg-gray-200 min-h-[16px]" />
                            )}
                        </div>

                        {/* Content */}
                        <div className={cn("flex-1 flex items-start justify-between min-w-0", isLast ? "pb-0" : "pb-3")}>
                            <div className="min-w-0">
                                <span
                                    className={cn(
                                        "text-xs font-semibold",
                                        style.iconColor
                                    )}
                                >
                                    {style.label}
                                </span>
                                {log.users?.name && (
                                    <p className="text-[11px] text-gray-400 font-medium truncate mt-0.5">
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
            })}
        </div>
    );
}
