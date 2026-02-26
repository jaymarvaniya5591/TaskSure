/**
 * Timeline utilities — shared logic for fetching and caching task timelines.
 *
 * `fetchTaskHierarchy` builds the SeqNode tree for a single root task.
 * `fetchAllTimelines` batch-fetches timelines for all visible tasks.
 * `invalidateTaskTimelineChain` walks the ancestor chain to invalidate caches.
 */

import { type QueryClient } from "@tanstack/react-query";
import { type Task } from "@/lib/types";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SeqNode {
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any;

// ─── Fetch a single task's timeline tree ────────────────────────────────────

export async function fetchTaskHierarchy(
    supabase: SupabaseClient,
    rootTaskId: string,
): Promise<SeqNode | null> {
    const { data, error } = await supabase.rpc('get_timeline_data', { root_task_ids: [rootTaskId] });
    if (error || !data) {
        console.error("Error fetching timeline data:", error);
        return null;
    }
    return buildTimelineFromGraph(rootTaskId, data.tasks, data.users, data.logs);
}

// ─── Shared Timeline Builder ────────────────────────────────────────────────

function buildTimelineFromGraph(
    rootTaskId: string,
    allTasks: TaskRecord[],
    users: { id: string, name: string }[],
    logs: LogRecord[]
): SeqNode | null {
    const rootTask = allTasks.find(t => t.id === rootTaskId);
    if (!rootTask) return null;

    const userMap: Record<string, string> = {};
    for (const u of users) {
        userMap[u.id] = u.name;
    }

    const logsMap: Record<string, LogRecord[]> = {};
    for (const log of logs) {
        if (!logsMap[log.entity_id]) logsMap[log.entity_id] = [];
        logsMap[log.entity_id].push(log);
    }

    // Recursive function to build the tree node for a given task
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
        userName: userMap[rootTask.created_by] || "Unknown",
        status: "created",
        time: rootTask.created_at,
        childBranches: [
            {
                edgeLabel: null,
                node: buildNodeForTask(rootTask)
            }
        ],
        isOpen: true,
    };

    rootCreatorNode.isOpen = rootCreatorNode.childBranches[0].node.isOpen;

    return rootCreatorNode;
}

// ─── Batch-fetch timelines for multiple tasks ───────────────────────────────

/**
 * Fetches timeline trees for all given root-level task IDs.
 * Returns a Map of taskId → SeqNode.
 */
export async function fetchAllTimelines(
    supabase: SupabaseClient,
    rootTaskIds: string[],
): Promise<Map<string, SeqNode>> {
    const timelineMap = new Map<string, SeqNode>();

    if (!rootTaskIds || rootTaskIds.length === 0) {
        return timelineMap;
    }

    const { data, error } = await supabase.rpc('get_timeline_data', { root_task_ids: rootTaskIds });
    if (error || !data) {
        console.error("Error fetching batch timelines:", error);
        return timelineMap;
    }

    for (const rootTaskId of rootTaskIds) {
        const node = buildTimelineFromGraph(rootTaskId, data.tasks, data.users, data.logs);
        if (node) {
            timelineMap.set(rootTaskId, node);
        }
    }

    return timelineMap;
}

// ─── Seed React Query cache with pre-fetched timelines ──────────────────────

/**
 * Seeds individual ["task-sequential-timeline", taskId] cache entries
 * from a pre-fetched timeline map. Called after dashboard data loads.
 */
export function seedTimelineCache(
    queryClient: QueryClient,
    timelineMap: Map<string, SeqNode>,
) {
    const entries = Array.from(timelineMap.entries());
    for (const [taskId, node] of entries) {
        queryClient.setQueryData(
            ["task-sequential-timeline", taskId],
            node,
        );
    }
}

// ─── Smart invalidation — full ancestor chain ───────────────────────────────

/**
 * Walks from the acted-on task up through parent_task_id to the root,
 * invalidating each ancestor's timeline cache. This ensures every card
 * in the chain gets an updated tree visualization.
 */
export function invalidateTaskTimelineChain(
    queryClient: QueryClient,
    taskId: string,
    allOrgTasks: Task[],
) {
    const taskMap = new Map(allOrgTasks.map(t => [t.id, t]));
    let currentId: string | null | undefined = taskId;
    while (currentId) {
        queryClient.invalidateQueries({ queryKey: ["task-sequential-timeline", currentId] });
        currentId = taskMap.get(currentId)?.parent_task_id;
    }
}
