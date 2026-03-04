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
 * PERFORMANCE (v3 — Static Shell + CSR):
 * This component now owns auth resolution AND data fetching entirely
 * on the client side. The server layout is a static shell that renders
 * instantly from CDN, and this component hydrates with:
 *   1. useAuth() — reads session from cookie (no network call)
 *   2. useDashboardData() — fetches tasks/org data via Supabase client
 *
 * This eliminates TTFB as a bottleneck (~50ms instead of ~7s).
 */
export function DashboardClientWrapper({
    children,
}: {
    children: React.ReactNode;
}) {
    const { user: authUser, isLoading: authLoading } = useAuth();
    const queryClient = useQueryClient();

    // Only start data fetching once auth is resolved
    const userId = authUser?.userId ?? "";
    const orgId = authUser?.orgId ?? "";

    const { data, isLoading: dataLoading, isError } = useDashboardData(
        userId,
        orgId,
        // No server-prefetched initialData in CSR mode
    );

    const isLoading = authLoading || dataLoading;

    const refreshData = useCallback(async () => {
        debugLog("REFRESH_DATA_START", "invalidating dashboard query");
        await queryClient.invalidateQueries({ queryKey: ["dashboard", userId, orgId] });
        debugLog("REFRESH_DATA_DASHBOARD_DONE", "dashboard query refreshed");
        queryClient.invalidateQueries({ queryKey: ["task-sequential-timeline"] });
        debugLog("REFRESH_DATA_TIMELINES_FIRED", "timeline invalidation dispatched (fire-and-forget)");
    }, [queryClient, userId, orgId]);

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
        userName: authUser?.userName ?? "User",
        orgId,
        userPhoneNumber: authUser?.userPhoneNumber ?? "",
        reportingManagerId: authUser?.reportingManagerId ?? null,
        orgUsers: data ? getUsersAtOrBelowRank(data.orgUsers, userId) : [],
        allOrgUsers: data ? data.orgUsers : [],
        tasks: data ? data.tasks : [],
        allOrgTasks: data ? data.allOrgTasks : [],
        isLoading,
        refreshData,
    }), [userId, authUser, orgId, data, isLoading, refreshData]);

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
