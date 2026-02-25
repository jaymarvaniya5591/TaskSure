"use client";

import { useCallback, useMemo, useEffect } from "react";
import { useDashboardData } from "@/lib/hooks/useDashboardData";
import { UserProvider } from "@/lib/user-context";
import { SidebarProvider } from "@/components/layout/SidebarProvider";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { getUsersAtOrBelowRank } from "@/lib/hierarchy";
import { useQueryClient } from "@tanstack/react-query";
import { type Task } from "@/lib/types";
import { seedTimelineCache, type SeqNode } from "@/lib/timeline-utils";

interface DashboardInitialData {
    tasks: Task[];
    orgUsers: Array<{
        id: string;
        name: string;
        phone_number: string;
        role: string;
        reporting_manager_id: string | null;
        avatar_url: string | null;
    }>;
    allOrgTasks: Task[];
    timelines?: [string, SeqNode][];
}

export function DashboardClientWrapper({
    children,
    userId,
    userName,
    orgId,
    userPhoneNumber,
    reportingManagerId,
    initialData,
}: {
    children: React.ReactNode;
    userId: string;
    userName: string;
    orgId: string;
    userPhoneNumber: string;
    reportingManagerId: string | null;
    initialData?: DashboardInitialData;
}) {
    // Use React Query with server-prefetched initialData.
    // On first render, data is available immediately (no loading state).
    // React Query will NOT refetch because staleTime is Infinity.
    const { data, isLoading, isError } = useDashboardData(userId, orgId, initialData);
    const queryClient = useQueryClient();

    const refreshData = useCallback(async () => {
        // Await only the main dashboard data refresh
        await queryClient.invalidateQueries({ queryKey: ["dashboard", userId, orgId] });
        // Fire-and-forget: timeline caches refresh lazily in the background
        // so they don't block the refresh button from completing
        queryClient.invalidateQueries({ queryKey: ["task-sequential-timeline"] });
    }, [queryClient, userId, orgId]);

    // Seed per-task timeline caches from pre-fetched data
    useEffect(() => {
        if (data?.timelines) {
            const timelineMap = new Map<string, SeqNode>(data.timelines);
            seedTimelineCache(queryClient, timelineMap);
        }
    }, [data?.timelines, queryClient]);

    const userContextValue = useMemo(() => ({
        userId,
        userName,
        orgId,
        userPhoneNumber,
        reportingManagerId,
        orgUsers: data ? getUsersAtOrBelowRank(data.orgUsers, userId) : [],
        allOrgUsers: data ? data.orgUsers : [],
        tasks: data ? data.tasks : [],
        allOrgTasks: data ? data.allOrgTasks : [],
        isLoading,
        refreshData,
    }), [userId, userName, orgId, userPhoneNumber, reportingManagerId, data, isLoading, refreshData]);

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
