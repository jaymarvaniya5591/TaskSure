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
    // 1. Fetch the root task first
    const { data: rootTask, error: rootError } = await supabase
        .from("tasks")
        .select("*")
        .eq("id", rootTaskId)
        .single();

    if (rootError || !rootTask) return null;

    // 2. Fetch all descendant tasks iteratively
    const allTasks: TaskRecord[] = [rootTask];
    let currentParentIds = [rootTaskId];

    while (currentParentIds.length > 0) {
        const { data: children } = await supabase
            .from("tasks")
            .select("*")
            .in("parent_task_id", currentParentIds);

        if (!children || children.length === 0) break;
        allTasks.push(...children);
        currentParentIds = children.map((c: TaskRecord) => c.id);
    }

    // 3. Collect unique user IDs and fetch their names
    const userIds = Array.from(new Set(allTasks.flatMap(t => [t.created_by, t.assigned_to]).filter(Boolean)));
    const userMap: Record<string, string> = {};
    if (userIds.length > 0) {
        const { data: users } = await supabase
            .from("users")
            .select("id, name")
            .in("id", userIds);
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
        .in("entity_id", allTasks.map((t: TaskRecord) => t.id));

    const logsMap: Record<string, LogRecord[]> = {};
    if (logs) {
        for (const log of logs) {
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

    // Fetch all timelines in parallel
    const results = await Promise.all(
        rootTaskIds.map(async (taskId) => {
            const node = await fetchTaskHierarchy(supabase, taskId);
            return { taskId, node };
        })
    );

    for (const { taskId, node } of results) {
        if (node) {
            timelineMap.set(taskId, node);
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
