/**
 * Hierarchy rank computation.
 *
 * Rank 1 = owners (no reporting_manager_id).
 * Rank 2 = direct reports to owners.
 * Rank N = reports to rank N-1.
 *
 * Multiple owners each form separate trees, all starting at rank 1.
 * Rank is never displayed publicly — it only controls access.
 */

export interface OrgUser {
    id: string;
    name: string;
    phone_number?: string;
    role?: string;
    reporting_manager_id: string | null;
    avatar_url?: string | null;
}

/**
 * BFS from root nodes (users with no reporting_manager_id) to compute
 * hierarchy rank for every user in the organisation.
 */
export function computeHierarchyRanks(users: OrgUser[]): Map<string, number> {
    const ranks = new Map<string, number>();
    const childrenMap = new Map<string, string[]>();

    // Build adjacency
    for (const user of users) {
        if (user.reporting_manager_id) {
            const children = childrenMap.get(user.reporting_manager_id) || [];
            children.push(user.id);
            childrenMap.set(user.reporting_manager_id, children);
        }
    }

    // BFS from roots (owners / top-level)
    const roots = users.filter(u => !u.reporting_manager_id);
    const queue: { id: string; rank: number }[] = roots.map(u => ({ id: u.id, rank: 1 }));

    while (queue.length > 0) {
        const { id, rank } = queue.shift()!;
        ranks.set(id, rank);

        const children = childrenMap.get(id) || [];
        for (const childId of children) {
            if (!ranks.has(childId)) {
                queue.push({ id: childId, rank: rank + 1 });
            }
        }
    }

    return ranks;
}

/**
 * Returns all users whose rank is equal to or lower (numerically >= )
 * than the current user's rank, i.e. users the current user can view.
 */
export function getUsersAtOrBelowRank(
    users: OrgUser[],
    currentUserId: string
): OrgUser[] {
    const ranks = computeHierarchyRanks(users);
    const currentRank = ranks.get(currentUserId);

    if (currentRank === undefined) return [];

    return users.filter(u => {
        const r = ranks.get(u.id);
        return r !== undefined && r >= currentRank;
    });
}
