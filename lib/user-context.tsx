"use client";

/**
 * UserContext — Provides current user info + org data to all dashboard components.
 * Populated server-side in the dashboard layout, consumed client-side by sidebar etc.
 */

import { createContext, useContext, type ReactNode } from "react";
import { type OrgUser } from "@/lib/hierarchy";
import { type Task } from "@/lib/types";

export interface UserContextValue {
    userId: string;
    userName: string;
    orgId: string;
    orgUsers: OrgUser[];
    tasks: Task[];
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
