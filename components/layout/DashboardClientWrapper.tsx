"use client";

import { useCallback } from "react";
import { useDashboardData } from "@/lib/hooks/useDashboardData";
import { UserProvider } from "@/lib/user-context";
import { SidebarProvider } from "@/components/layout/SidebarProvider";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { getUsersAtOrBelowRank } from "@/lib/hierarchy";
import { useQueryClient } from "@tanstack/react-query";

export function DashboardClientWrapper({
    children,
    userId,
    userName,
    orgId,
}: {
    children: React.ReactNode;
    userId: string;
    userName: string;
    orgId: string;
}) {
    const { data, isLoading, isError } = useDashboardData(userId, orgId);
    const queryClient = useQueryClient();

    const refreshData = useCallback(async () => {
        await queryClient.invalidateQueries({ queryKey: ["dashboard", userId, orgId] });
    }, [queryClient, userId, orgId]);

    const userContextValue = {
        userId,
        userName,
        orgId,
        orgUsers: data ? getUsersAtOrBelowRank(data.orgUsers, userId) : [],
        allOrgUsers: data ? data.orgUsers : [],
        tasks: data ? data.tasks : [],
        allOrgTasks: data ? data.allOrgTasks : [],
        isLoading,
        refreshData,
    };

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
