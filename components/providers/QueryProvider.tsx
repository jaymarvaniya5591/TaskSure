"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { useState } from "react";

export default function QueryProvider({ children }: { children: React.ReactNode }) {
    const [queryClient] = useState(
        () =>
            new QueryClient({
                defaultOptions: {
                    queries: {
                        staleTime: 1000 * 60 * 5,      // Data stays "fresh" for 5 minutes. After that, it refetches in background.
                        gcTime: 1000 * 60 * 60 * 24,   // Keep in cache for 24 hours for offline availability (gcTime replaced cacheTime in v5)
                        refetchOnWindowFocus: true,    // Refresh silently when users come back to tab/app
                        refetchOnMount: true,          // Refresh silently when component remounts
                        refetchOnReconnect: true,      // Auto-refresh when mobile regains network
                        retry: 1,                      // Only retry once on failure
                    },
                },
            })
    );

    const [persister] = useState<ReturnType<typeof createSyncStoragePersister> | null>(() => {
        // Only safely initialize localStorage on the client
        if (typeof window !== "undefined") {
            return createSyncStoragePersister({
                storage: window.localStorage,
                key: "REACT_QUERY_OFFLINE_CACHE",
            });
        }
        return null;
    });

    // Render children IMMEDIATELY. Previously this returned null,
    // blocking the entire dashboard UI for ~50-100ms.
    // Upgrade to PersistQueryClientProvider if persister exists.
    if (!persister) {
        return (
            <QueryClientProvider client={queryClient}>
                {children}
            </QueryClientProvider>
        );
    }

    return (
        <PersistQueryClientProvider
            client={queryClient}
            persistOptions={{ persister }}
        >
            {children}
        </PersistQueryClientProvider>
    );
}

