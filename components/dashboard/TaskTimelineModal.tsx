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
import { Loader2 } from "lucide-react";
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

function getDotColor(status: string): string {
    if (status === "created" || status === "accepted" || status === "completed") return "#10B981"; // Green
    if (status === "pending") return "#F59E0B"; // Yellow
    if (status === "rejected" || status === "cancelled" || status === "deleted") return "#EF4444"; // Red
    return "#9CA3AF"; // Grey default
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
        staleTime: Infinity,
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
        <div className="py-4 px-2 select-none">
            <SeqNodeRenderer node={treeNode} depth={0} />
        </div>
    );
}

// ─── Renderer ───────────────────────────────────────────────────────────────

function SeqNodeRenderer({
    node,
    depth,
    edgeLabel
}: {
    node: SeqNode;
    depth: number;
    edgeLabel?: string | null;
}) {
    // Top-level task (0) + initial children (1) are expanded by default
    const [isExpanded, setIsExpanded] = useState(depth <= 1);

    const hasChildren = node.childBranches && node.childBranches.length > 0;
    const isMainBranchDotted = node.isOpen;

    return (
        <div className="relative">
            {/* The horizontal line from the parent trunk entering this branch */}
            {depth > 0 && (
                <>
                    <div className="absolute left-[-24px] top-[14px] w-[24px] h-[2px] bg-gray-300" />
                    {edgeLabel && (
                        <div className="absolute left-[-16px] top-[-6px] text-[10px] text-gray-600 font-semibold bg-white px-1 leading-none rounded z-10">
                            {edgeLabel}
                        </div>
                    )}
                </>
            )}

            {/* The node row */}
            <div
                className={cn(
                    "flex flex-row items-center gap-3 relative py-2 mb-1 group rounded-md outline-none",
                    hasChildren ? "cursor-pointer hover:bg-gray-50/80 active:bg-gray-100" : ""
                )}
                onClick={() => hasChildren && setIsExpanded(!isExpanded)}
                role={hasChildren ? "button" : "presentation"}
            >
                {/* Node dot with optional +/- hint for children */}
                <div
                    className="shrink-0 rounded-full relative z-20 flex items-center justify-center transition-all duration-200"
                    style={{
                        width: 14,
                        height: 14,
                        backgroundColor: getDotColor(node.status),
                        boxShadow: node.status === "pending" ? `0 0 0 3px ${getDotColor(node.status)}33` : undefined,
                        transform: (hasChildren && !isExpanded) ? "scale(1.15)" : "scale(1)",
                    }}
                >
                    {hasChildren && (
                        <span className="text-white text-[8px] font-black leading-none user-select-none">
                            {isExpanded ? "−" : "+"}
                        </span>
                    )}
                </div>

                <div className="flex-1 flex justify-between items-center min-w-0 pr-2">
                    <span
                        className="text-[13px] font-bold truncate transition-colors"
                        style={{ color: node.status === "pending" ? "#92400E" : "#374151" }}
                    >
                        {node.userName}
                    </span>
                    <span className="text-[11px] font-medium text-gray-400 tabular-nums shrink-0 ml-2 pt-0.5">
                        {node.time ? format(new Date(node.time), "MMM d, h:mm a") : "—"}
                    </span>
                </div>
            </div>

            {/* Child branches */}
            {hasChildren && isExpanded && (
                <div className="relative pl-[28px]">
                    {/* The main vertical trunk descending from this node */}
                    <div
                        className={cn("absolute left-[6.5px] top-[-6px] bottom-5 w-0",
                            isMainBranchDotted ? "border-l-[2px] border-dashed border-gray-400 opacity-60" : "border-l-[2px] border-solid border-gray-300"
                        )}
                    />

                    {/* Render children container */}
                    <div className="flex flex-col relative z-10 ml-1">
                        {node.childBranches.map((branch, idx) => (
                            <SeqNodeRenderer
                                key={branch.node.taskId + idx}
                                node={branch.node}
                                depth={depth + 1}
                                edgeLabel={branch.edgeLabel}
                            />
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
