"use client";

/**
 * TaskTimeline — Visual tree-based timeline for a task.
 *
 * Design principles:
 *   - Each event is a colored DOT (no text labels like "Created" / "Accepted")
 *   - Green shades = created/accepted/completed
 *   - Red = rejected
 *   - Yellow = pending (awaiting action)
 *   - Violet = reassigned
 *   - Orange = deadline changed
 *   - Person name + time shown next to each dot
 *   - Subtask names appear on branch edges
 *   - Recursive subtask branches
 *   - Synthetic pending nodes for tasks awaiting acceptance
 */

import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

// ─── Types ──────────────────────────────────────────────────────────────────

interface TimelineLog {
    id: string;
    action: string;
    metadata: Record<string, unknown>;
    created_at: string;
    user_id: string;
    entity_id?: string;
    users?: {
        id: string;
        name: string;
        avatar_url: string | null;
    };
}

interface SubtaskInfo {
    id: string;
    title: string;
    status: string;
    assigned_to: string;
    assignee_name: string;
}

interface TreeNode {
    type: "event" | "pending";
    action: string;
    personName: string;
    time: string | null; // null for pending
    dotColor: string;
    branches: TreeBranch[];
}

interface TreeBranch {
    subtaskTitle: string;
    nodes: TreeNode[];
}

// ─── Dot colors ─────────────────────────────────────────────────────────────

const DOT_COLORS: Record<string, string> = {
    "task.created": "#10B981",
    "todo.created": "#10B981",
    "subtask.created": "#10B981",
    "task.accepted": "#059669",
    "task.completed": "#047857",
    "todo.completed": "#047857",
    "subtask.completed": "#047857",
    "task.rejected": "#EF4444",
    "task.reassigned": "#8B5CF6",
    "task.deadline_edited": "#F97316",
    "task.deleted": "#EF4444",
    pending: "#F59E0B",
};

function getDotColor(action: string): string {
    return DOT_COLORS[action] || "#9CA3AF";
}

// ─── Branch line colors (cycle for nested branches) ─────────────────────────

const BRANCH_LINE_COLORS = [
    "#14B8A6", // teal
    "#8B5CF6", // violet
    "#F59E0B", // amber
    "#3B82F6", // blue
    "#F43F5E", // rose
];

// ─── Component ──────────────────────────────────────────────────────────────

interface TaskTimelineProps {
    taskId: string;
}

export default function TaskTimeline({ taskId }: TaskTimelineProps) {
    const supabase = createClient();

    const { data: tree, isLoading, error } = useQuery({
        queryKey: ["task-timeline-tree", taskId],
        queryFn: async () => {
            return await buildTaskTree(supabase, taskId);
        },
        staleTime: Infinity,
    });

    if (isLoading) {
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

    if (!tree || tree.length === 0) {
        return (
            <div className="py-4 text-center text-xs font-medium text-gray-400">
                No activity yet
            </div>
        );
    }

    return (
        <div className="py-3 px-1">
            <TreeRenderer nodes={tree} depth={0} />
        </div>
    );
}

// ─── Recursive tree builder ─────────────────────────────────────────────────

async function buildTaskTree(
    supabase: ReturnType<typeof createClient>,
    taskId: string
): Promise<TreeNode[]> {
    // 1. Fetch audit logs for this task (not subtask-entity logs)
    const { data: rawLogs, error } = await supabase
        .from("audit_log")
        .select("id, action, metadata, created_at, user_id, entity_id, users:user_id(id, name, avatar_url)")
        .eq("entity_type", "task")
        .eq("entity_id", taskId)
        .order("created_at", { ascending: true });

    if (error) throw new Error(error.message);

    const logs: TimelineLog[] = (rawLogs || []).map((log: Record<string, unknown>) => ({
        ...log,
        users: Array.isArray(log.users) ? log.users[0] : log.users,
    })) as TimelineLog[];

    // 2. Fetch direct subtasks
    const { data: subtasks } = await supabase
        .from("tasks")
        .select("id, title, status, assigned_to")
        .eq("parent_task_id", taskId) as { data: { id: string; title: string; status: string; assigned_to: string }[] | null };

    // 3. Resolve assignee names for subtasks
    const subtaskInfos: SubtaskInfo[] = [];
    if (subtasks && subtasks.length > 0) {
        const assigneeIds = Array.from(new Set(subtasks.map(s => s.assigned_to).filter(Boolean)));
        const userMap: Record<string, string> = {};
        if (assigneeIds.length > 0) {
            const { data: users } = await supabase
                .from("users")
                .select("id, name")
                .in("id", assigneeIds);
            if (users) {
                for (const u of users) {
                    userMap[u.id] = u.name;
                }
            }
        }
        for (const s of subtasks) {
            subtaskInfos.push({
                ...s,
                assignee_name: userMap[s.assigned_to] || "Unknown",
            });
        }
    }

    // 4. Build a map of subtask_id → SubtaskInfo
    const subtaskMap = new Map<string, SubtaskInfo>();
    subtaskInfos.forEach(s => subtaskMap.set(s.id, s));

    // 5. Build the tree nodes
    const nodes: TreeNode[] = [];
    const processedSubtaskIds = new Set<string>();

    for (const log of logs) {
        // Skip subtask.created events that are logged on the parent — these become branches
        if (log.action === "subtask.created" && log.metadata?.subtask_id) {
            const subtaskId = log.metadata.subtask_id as string;
            if (!processedSubtaskIds.has(subtaskId)) {
                processedSubtaskIds.add(subtaskId);

                // Recursively build the subtask's tree
                const subtaskTree = await buildTaskTree(supabase, subtaskId);
                const subtaskTitle = (log.metadata?.subtask_title as string) ||
                    subtaskMap.get(subtaskId)?.title || "Subtask";
                const info = subtaskMap.get(subtaskId);

                // If subtask is still pending, add a synthetic pending node at the end
                if (info && info.status === "pending") {
                    subtaskTree.push({
                        type: "pending",
                        action: "pending",
                        personName: info.assignee_name,
                        time: null,
                        dotColor: getDotColor("pending"),
                        branches: [],
                    });
                }

                // Add the branch to the PREVIOUS node (or create a standalone if first)
                const lastNode = nodes[nodes.length - 1];
                const branch: TreeBranch = {
                    subtaskTitle,
                    nodes: subtaskTree,
                };

                if (lastNode) {
                    lastNode.branches.push(branch);
                } else {
                    // Edge case: subtask created before any event (shouldn't happen)
                    nodes.push({
                        type: "event",
                        action: log.action,
                        personName: log.users?.name || "Unknown",
                        time: log.created_at,
                        dotColor: getDotColor(log.action),
                        branches: [branch],
                    });
                }
                continue;
            }
            continue;
        }

        // Skip subtask.completed events on parent — the subtask's own tree handles it
        if (log.action === "subtask.completed") {
            continue;
        }

        nodes.push({
            type: "event",
            action: log.action,
            personName: log.users?.name || "Unknown",
            time: log.created_at,
            dotColor: getDotColor(log.action),
            branches: [],
        });
    }

    // 6. Check if the main task itself is pending — add synthetic pending node
    // (Only if this task has a task.created event but no task.accepted/task.rejected)
    const hasCreated = logs.some(l => l.action === "task.created" || l.action === "subtask.created");
    const hasResponse = logs.some(l =>
        l.action === "task.accepted" || l.action === "task.rejected"
    );
    if (hasCreated && !hasResponse) {
        // Get the assignee info from the task itself
        const { data: taskData } = await supabase
            .from("tasks")
            .select("assigned_to, status")
            .eq("id", taskId)
            .single();

        if (taskData && taskData.status === "pending") {
            const { data: assigneeUser } = await supabase
                .from("users")
                .select("name")
                .eq("id", taskData.assigned_to)
                .single();

            nodes.push({
                type: "pending",
                action: "pending",
                personName: assigneeUser?.name || "Unknown",
                time: null,
                dotColor: getDotColor("pending"),
                branches: [],
            });
        }
    }

    return nodes;
}

// ─── Tree Renderer ──────────────────────────────────────────────────────────

function TreeRenderer({ nodes, depth }: { nodes: TreeNode[]; depth: number }) {
    const branchColor = BRANCH_LINE_COLORS[depth % BRANCH_LINE_COLORS.length];

    return (
        <div className="relative">
            {nodes.map((node, i) => {
                const isLast = i === nodes.length - 1;
                const hasBranches = node.branches.length > 0;

                return (
                    <div key={`${node.action}-${node.personName}-${i}`}>
                        {/* ── Node row ── */}
                        <div className="flex items-center gap-3 relative" style={{ minHeight: 28 }}>
                            {/* Vertical connector line from previous node */}
                            {i > 0 && (
                                <div
                                    className="absolute"
                                    style={{
                                        left: 5,
                                        top: -14,
                                        bottom: "50%",
                                        width: 2,
                                        backgroundColor: depth === 0 ? "#D1D5DB" : branchColor,
                                        opacity: depth === 0 ? 1 : 0.5,
                                    }}
                                />
                            )}
                            {/* Vertical connector to next node or branches */}
                            {(!isLast || hasBranches) && (
                                <div
                                    className="absolute"
                                    style={{
                                        left: 5,
                                        top: "50%",
                                        bottom: -14,
                                        width: 2,
                                        backgroundColor: depth === 0 ? "#D1D5DB" : branchColor,
                                        opacity: depth === 0 ? 1 : 0.5,
                                    }}
                                />
                            )}

                            {/* Dot */}
                            <div
                                className="shrink-0 rounded-full relative z-10"
                                style={{
                                    width: 12,
                                    height: 12,
                                    backgroundColor: node.dotColor,
                                    boxShadow: node.type === "pending"
                                        ? `0 0 0 3px ${node.dotColor}33, 0 0 8px ${node.dotColor}55`
                                        : `0 0 0 3px ${node.dotColor}22`,
                                }}
                            />

                            {/* Person name + time */}
                            <div className="flex-1 flex items-center justify-between min-w-0">
                                <span
                                    className="text-xs font-semibold truncate"
                                    style={{
                                        color: node.type === "pending" ? "#92400E" : "#374151",
                                    }}
                                >
                                    {node.personName}
                                    {node.type === "pending" && (
                                        <span className="text-[10px] font-normal text-amber-500 ml-1.5">
                                            awaiting
                                        </span>
                                    )}
                                </span>
                                <span className="text-[10px] font-medium text-gray-400 shrink-0 ml-2 tabular-nums">
                                    {node.time
                                        ? format(new Date(node.time), "h:mm a")
                                        : "—"
                                    }
                                </span>
                            </div>
                        </div>

                        {/* ── Branches ── */}
                        {hasBranches && (
                            <div className="relative">
                                {node.branches.map((branch, bi) => (
                                    <BranchRenderer
                                        key={`branch-${bi}-${branch.subtaskTitle}`}
                                        branch={branch}
                                        depth={depth}
                                        isLastBranch={bi === node.branches.length - 1 && isLast}
                                        parentBranchColor={depth === 0 ? "#D1D5DB" : branchColor}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

// ─── Branch Renderer ────────────────────────────────────────────────────────

function BranchRenderer({
    branch,
    depth,
    isLastBranch,
    parentBranchColor,
}: {
    branch: TreeBranch;
    depth: number;
    isLastBranch: boolean;
    parentBranchColor: string;
}) {
    const newDepth = depth + 1;
    const branchColor = BRANCH_LINE_COLORS[newDepth % BRANCH_LINE_COLORS.length];

    return (
        <div className="relative" style={{ paddingLeft: 20, marginTop: 2, marginBottom: 2 }}>
            {/* Vertical line from parent continuing down */}
            {!isLastBranch && (
                <div
                    className="absolute"
                    style={{
                        left: 5,
                        top: 0,
                        bottom: 0,
                        width: 2,
                        backgroundColor: parentBranchColor,
                        opacity: depth === 0 ? 1 : 0.5,
                    }}
                />
            )}

            {/* Horizontal connector from parent trunk to branch */}
            <div
                className="absolute"
                style={{
                    left: 5,
                    top: 16,
                    width: 15,
                    height: 2,
                    backgroundColor: branchColor,
                    opacity: 0.7,
                }}
            />

            {/* Branch fork indicator (small circle at fork point) */}
            <div
                className="absolute rounded-full z-10"
                style={{
                    left: 2,
                    top: 12,
                    width: 8,
                    height: 8,
                    backgroundColor: branchColor,
                    opacity: 0.5,
                }}
            />

            {/* Branch edge label (subtask title) */}
            <div
                className="text-[10px] font-bold truncate mb-1"
                style={{
                    color: branchColor,
                    paddingLeft: 16,
                    paddingTop: 2,
                    lineHeight: "20px",
                }}
            >
                {branch.subtaskTitle}
            </div>

            {/* Branch content */}
            <div style={{ paddingLeft: 0 }}>
                <TreeRenderer nodes={branch.nodes} depth={newDepth} />
            </div>
        </div>
    );
}
