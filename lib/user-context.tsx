"use client";

/**
 * UserContext — Provides current user info + org data to all dashboard components.
 * Populated server-side in the dashboard layout, consumed client-side by sidebar etc.
 * Includes `isLoading` for skeleton/shimmer states and `refreshData` for manual refresh.
 */

import { createContext, useContext, type ReactNode } from "react";
import { type OrgUser } from "@/lib/hierarchy";
import { type Task } from "@/lib/types";

export interface UserContextValue {
    userId: string;
    userName: string;
    orgId: string;
    /** Org users filtered by hierarchy rank (for sidebar/header search). */
    orgUsers: OrgUser[];
    /** All org users without hierarchy filtering (for task/subtask creation search). */
    allOrgUsers: OrgUser[];
    tasks: Task[];
    allOrgTasks: Task[];
    /** True while the initial data fetch is in progress */
    isLoading: boolean;
    /** Manually trigger a data refresh (the refresh button in header) */
    refreshData: () => Promise<void>;
}

const UserCtx = createContext<UserContextValue | null>(null);

export function UserProvider({
    value,
    children,
}: {
    value: UserContextValue;
    children: ReactNode;
}) {
    return <UserCtx.Provider value={value}>{children}</UserCtx.Provider>;
}

export function useUserContext(): UserContextValue {
    const ctx = useContext(UserCtx);
    if (!ctx) throw new Error("useUserContext must be used inside <UserProvider>");
    return ctx;
}
