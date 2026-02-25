"use client";

/**
 * TaskTimeline — Interactive Sequential Tree-based Timeline
 * 
 * Design Principles:
 * - Structural/Sequential: Traces user assignments, not raw audit logs.
 * - Interactive: Expandable/collapsible task branches (depth <= 1 expanded by default).
 * - Visuals: Only colored dots (Green=Done/Accepted, Yellow=Pending, Red=Rejected).
 * - Branches: Solid grey paths. Main trunk is dotted if tasks are incomplete.
 *   Subtask titles label the horizontal branch arms.
 * - Date/Time: Shows the precise moment of the status event.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Loader2, Check, Clock, X, CornerDownRight, ChevronRight, ChevronDown } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

// ─── Types ──────────────────────────────────────────────────────────────────

interface SeqNode {
    taskId: string;
    userName: string;
    status: string; // 'created', 'pending', 'accepted', 'completed', 'rejected', 'cancelled'
    time: string | null;
    isOpen: boolean;
    childBranches: {
        edgeLabel: string | null;
        node: SeqNode;
    }[];
}

interface TaskRecord {
    id: string;
    parent_task_id: string | null;
    created_by: string;
    assigned_to: string;
    title: string;
    status: string;
    created_at: string;
    updated_at: string;
}

interface LogRecord {
    action: string;
    created_at: string;
    entity_id: string;
}

// ─── Logic ──────────────────────────────────────────────────────────────────

function StatusIcon({ status }: { status: string }) {
    if (status === 'pending') {
        return (
            <div className="w-6 h-6 flex items-center justify-center rounded-full bg-amber-50 text-amber-500 ring-4 ring-white border border-amber-200 z-10 shadow-sm shrink-0">
                <Clock className="w-3.5 h-3.5" strokeWidth={2.5} />
            </div>
        )
    }
    if (status === 'rejected' || status === 'cancelled') {
        return (
            <div className="w-6 h-6 flex items-center justify-center rounded-full bg-red-50 text-red-500 ring-4 ring-white border border-red-200 z-10 shadow-sm shrink-0">
                <X className="w-3.5 h-3.5" strokeWidth={2.5} />
            </div>
        )
    }
    return (
        <div className="w-6 h-6 flex items-center justify-center rounded-full bg-emerald-50 text-emerald-500 ring-4 ring-white border border-emerald-200 z-10 shadow-sm shrink-0">
            <Check className="w-3.5 h-3.5" strokeWidth={2.5} />
        </div>
    )
}

async function fetchTaskHierarchy(supabase: ReturnType<typeof createClient>, rootTaskId: string): Promise<SeqNode | null> {
    // 1. Fetch the root task first
    const { data: rootTask, error: rootError } = await supabase
        .from("tasks")
        .select("*")
        .eq("id", rootTaskId)
        .single();

    if (rootError || !rootTask) return null;

    // 2. Fetch all descendant tasks iteratively
    const allTasks = [rootTask];
    let currentParentIds = [rootTaskId];

    while (currentParentIds.length > 0) {
        const { data: children } = await supabase
            .from("tasks")
            .select("*")
            .in("parent_task_id", currentParentIds);

        if (!children || children.length === 0) break;
        allTasks.push(...(children as TaskRecord[]));
        currentParentIds = (children as TaskRecord[]).map(c => c.id);
    }

    // 3. Collect unique user IDs and fetch their names
    const userIds = Array.from(new Set(allTasks.flatMap(t => [t.created_by, t.assigned_to]).filter(Boolean)));
    const userMap: Record<string, string> = {};
    if (userIds.length > 0) {
        const { data: users } = await supabase.from("users").select("id, name").in("id", userIds);
        if (users) {
            for (const u of users) {
                userMap[u.id] = u.name;
            }
        }
    }

    // 4. Fetch audit logs for precise status times
    const { data: logs } = await supabase
        .from("audit_log")
        .select("action, created_at, entity_id")
        .eq("entity_type", "task")
        .in("entity_id", allTasks.map(t => t.id));

    const logsMap: Record<string, LogRecord[]> = {};
    if (logs) {
        for (const log of (logs as LogRecord[])) {
            if (!logsMap[log.entity_id]) logsMap[log.entity_id] = [];
            logsMap[log.entity_id].push(log);
        }
    }

    // 5. Recursive function to build the tree node for a given task
    function buildNodeForTask(task: TaskRecord): SeqNode {
        const childTasks = allTasks.filter(t => t.parent_task_id === task.id);

        const childBranches = childTasks.map(ct => ({
            edgeLabel: ct.title,
            node: buildNodeForTask(ct)
        }));

        // Sort children chronological by created_at
        childBranches.sort((a, b) => {
            const timeA = allTasks.find(t => t.id === a.node.taskId)?.created_at || "";
            const timeB = allTasks.find(t => t.id === b.node.taskId)?.created_at || "";
            return new Date(timeA).getTime() - new Date(timeB).getTime();
        });

        // Determine precise time based on status
        let time = null;
        if (task.status === "pending") {
            time = null; // Spec: NA for pending
        } else {
            // Find the log that matches the status (e.g. task.accepted)
            const relevantLog = logsMap[task.id]?.find(l => l.action.endsWith(task.status));
            time = relevantLog ? relevantLog.created_at : task.updated_at;
        }

        const selfOpen = task.status === "pending" || task.status === "accepted";
        const childrenOpen = childBranches.some(b => b.node.isOpen);
        const isOpen = selfOpen || childrenOpen;

        return {
            taskId: task.id,
            userName: userMap[task.assigned_to] || "Unknown",
            status: task.status,
            time,
            isOpen,
            childBranches
        };
    }

    // Root node represents the CREATOR of the root task
    const rootCreatorNode: SeqNode = {
        taskId: `creator-${rootTaskId}`,
        userName: userMap[(rootTask as TaskRecord).created_by] || "Unknown",
        status: "created",
        time: (rootTask as TaskRecord).created_at,
        childBranches: [
            {
                edgeLabel: null, // Initial grey line between jay and beta
                node: buildNodeForTask(rootTask as TaskRecord)
            }
        ],
        isOpen: true,
    };

    rootCreatorNode.isOpen = rootCreatorNode.childBranches[0].node.isOpen;

    return rootCreatorNode;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function TaskTimeline({ taskId }: { taskId: string }) {
    const supabase = createClient();

    const { data: treeNode, isLoading, error } = useQuery({
        queryKey: ["task-sequential-timeline", taskId],
        queryFn: () => fetchTaskHierarchy(supabase, taskId),
        staleTime: Infinity, // Pre-seeded from system cache; only re-fetched on explicit invalidation
    });

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-6">
                <Loader2 className="w-5 h-5 animate-spin text-gray-300" />
            </div>
        );
    }

    if (error || !treeNode) {
        return (
            <div className="py-4 text-center text-xs font-medium text-red-400">
                {(error as Error)?.message || "Failed to load timeline."}
            </div>
        );
    }

    return (
        <div className="py-2 px-1 select-none overflow-x-auto overflow-y-hidden pb-8 w-full scrollbar-thin scrollbar-thumb-gray-200">
            <div className="min-w-max pr-8">
                <SeqNodeRenderer node={treeNode} depth={0} isLastChild={true} />
            </div>
        </div>
    );
}

// ─── Renderer ───────────────────────────────────────────────────────────────

function SeqNodeRenderer({
    node,
    depth,
    edgeLabel,
    isLastChild
}: {
    node: SeqNode;
    depth: number;
    edgeLabel?: string | null;
    isLastChild?: boolean;
}) {
    // Top-level task + initial children are expanded by default
    const [isExpanded, setIsExpanded] = useState(depth <= 1);

    const hasChildren = node.childBranches && node.childBranches.length > 0;
    const isMainBranchDotted = node.isOpen;

    return (
        <div className="flex relative items-stretch w-full mt-2">
            {/* Horizontal Line from Parent */}
            {depth > 0 && (
                <div
                    className="absolute h-[2px] bg-gray-200 z-0"
                    style={{ left: -24, width: 24, top: 11 }}
                />
            )}

            {/* Trailing Line Mask for Last Child's connection to parent */}
            {depth > 0 && isLastChild && (
                <div
                    className="absolute w-[8px] bg-white z-[1]"
                    style={{ left: -28, top: 13, bottom: -24 }}
                />
            )}

            {/* Left Column (Icon + Vertical Line) */}
            <div className="flex flex-col items-center shrink-0 w-[24px]">
                <StatusIcon status={node.status} />

                {/* Vertical Line bridging to its own children */}
                {hasChildren && isExpanded && (
                    <div
                        className={cn(
                            "w-[2px] flex-1 mt-1 z-0",
                            isMainBranchDotted ? "border-l-[2px] border-dashed border-gray-300 bg-transparent opacity-70" : "bg-gray-200"
                        )}
                    />
                )}
            </div>

            {/* Right Column (Card + Children) */}
            <div className="flex-none pl-3 pb-3">
                {/* Content Card */}
                <div
                    className={cn(
                        "rounded-xl border p-3 w-[260px] sm:w-[320px] transition-all shadow-sm relative",
                        hasChildren ? "cursor-pointer hover:border-gray-300 active:scale-[0.99]" : "",
                        node.status === "pending" ? "bg-amber-50/30 border-amber-200/60" : "bg-white border-gray-100/80"
                    )}
                    onClick={() => hasChildren && setIsExpanded(!isExpanded)}
                    role={hasChildren ? "button" : "presentation"}
                >
                    <div className="flex justify-between items-start gap-2">
                        <span className="text-[14px] font-bold text-gray-900 truncate">
                            {node.userName}
                        </span>
                        <span className="text-[11px] font-medium text-gray-500 tabular-nums shrink-0 mt-0.5 whitespace-nowrap bg-gray-50/80 px-1.5 py-0.5 rounded-md">
                            {node.time ? format(new Date(node.time), "MMM d, h:mm a") : "—"}
                        </span>
                    </div>

                    {edgeLabel && (
                        <div className="flex items-center gap-1.5 text-gray-500 mt-1.5">
                            <CornerDownRight className="w-3.5 h-3.5 shrink-0 text-gray-400" />
                            <span className="text-[12px] font-medium truncate">{edgeLabel}</span>
                        </div>
                    )}

                    {hasChildren && (
                        <div className="mt-3 pt-2.5 border-t border-gray-100 flex items-center justify-between text-[10px] font-bold tracking-wider uppercase">
                            <div className="flex items-center gap-1.5 text-gray-400 hover:text-gray-600 transition-colors">
                                {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                                <span>{isExpanded ? "Hide Subtasks" : `Show ${node.childBranches.length} Task${node.childBranches.length > 1 ? 's' : ''}`}</span>
                            </div>
                        </div>
                    )}
                </div>

                {/* Children Wrapper */}
                {hasChildren && isExpanded && (
                    <div className="flex flex-col">
                        {node.childBranches.map((child, idx) => (
                            <SeqNodeRenderer
                                key={child.node.taskId + idx}
                                node={child.node}
                                depth={depth + 1}
                                edgeLabel={child.edgeLabel}
                                isLastChild={idx === node.childBranches.length - 1}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
