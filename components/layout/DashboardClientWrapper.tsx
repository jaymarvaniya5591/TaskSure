"use client";

import { useCallback, useMemo, useEffect, useRef } from "react";
import { useDashboardData } from "@/lib/hooks/useDashboardData";
import { useAuth } from "@/lib/hooks/useAuth";
import { UserProvider } from "@/lib/user-context";
import { SidebarProvider } from "@/components/layout/SidebarProvider";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { getUsersAtOrBelowRank } from "@/lib/hierarchy";
import { useQueryClient } from "@tanstack/react-query";
import { debugLog, debugTestSupabaseConnectivity } from "@/lib/debug-logger";
import { DashboardShellSkeleton } from "@/components/ui/DashboardSkeleton";

/**
 * DashboardClientWrapper — The client-side shell for all dashboard pages.
 *
 * PERFORMANCE (v4 — Waterfall Elimination):
 *   useAuth() only calls getSession() (~5ms, no network).
 *   useDashboardData() fetches profile + tasks + org in two parallel phases.
 *   This eliminates the auth→profile→data waterfall.
 *
 * OLD: getSession(5ms) → profile(500ms) → THEN 4 data queries(500ms) = ~1s serial
 * NEW: getSession(5ms) → profile + 2 task queries(500ms) → 2 org queries(500ms) = ~500ms
 */
export function DashboardClientWrapper({
    children,
}: {
    children: React.ReactNode;
}) {
    const { user: authUser, isLoading: authLoading } = useAuth();
    const queryClient = useQueryClient();

    // Only start data fetching once auth is resolved (just need userId)
    const userId = authUser?.userId ?? "";

    const { data, isLoading: dataLoading, isError } = useDashboardData(userId);

    const isLoading = authLoading || dataLoading;

    // Extract profile data from dashboard query result
    const profile = data?.profile;
    const orgId = profile?.organisation_id ?? "";

    const refreshData = useCallback(async () => {
        debugLog("REFRESH_DATA_START", "invalidating dashboard query");
        await queryClient.invalidateQueries({ queryKey: ["dashboard", userId] });
        debugLog("REFRESH_DATA_DASHBOARD_DONE", "dashboard query refreshed");
        queryClient.invalidateQueries({ queryKey: ["task-sequential-timeline"] });
        debugLog("REFRESH_DATA_TIMELINES_FIRED", "timeline invalidation dispatched (fire-and-forget)");
    }, [queryClient, userId]);

    // TEMP DEBUG: Test Supabase connectivity from this device on mount
    const hasLoggedRef = useRef(false);
    useEffect(() => {
        if (!hasLoggedRef.current && userId) {
            debugLog("DASHBOARD_MOUNT", `userId=${userId} orgId=${orgId}`);
            debugTestSupabaseConnectivity();
            hasLoggedRef.current = true;
        }
    }, [userId, orgId]);

    const userContextValue = useMemo(() => ({
        userId,
        userName: profile?.name ?? "User",
        orgId,
        userPhoneNumber: profile?.phone_number ?? "",
        reportingManagerId: profile?.reporting_manager_id ?? null,
        orgUsers: data ? getUsersAtOrBelowRank(data.orgUsers, userId) : [],
        allOrgUsers: data ? data.orgUsers : [],
        tasks: data ? data.tasks : [],
        allOrgTasks: data ? data.allOrgTasks : [],
        isLoading,
        refreshData,
    }), [userId, profile, orgId, data, isLoading, refreshData]);

    // Show skeleton while auth is resolving or data is loading for the first time
    if (authLoading || (!data && dataLoading)) {
        return <DashboardShellSkeleton />;
    }

    return (
        <SidebarProvider>
            <UserProvider value={userContextValue}>
                <div className="min-h-screen bg-gray-50/50">
                    <Sidebar />
                    <div className="lg:pl-72 flex flex-col min-h-screen">
                        <Header />
                        <main className="flex-1 py-8">
                            <div className="px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
                                {isError && !data ? (
                                    <div className="flex flex-col items-center justify-center text-center px-4 h-[50vh]">
                                        <p className="text-red-500 font-medium">Failed to load workspace data.</p>
                                        <button
                                            onClick={() => window.location.reload()}
                                            className="mt-4 px-4 py-2 bg-gray-900 text-white rounded-xl font-medium"
                                        >
                                            Try Again
                                        </button>
                                    </div>
                                ) : (
                                    children
                                )}
                            </div>
                        </main>
                    </div>
                </div>
            </UserProvider>
        </SidebarProvider>
    );
}
