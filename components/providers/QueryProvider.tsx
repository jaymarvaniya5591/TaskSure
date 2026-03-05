"use client";

import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { useState, useEffect } from "react";

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

    const [persister, setPersister] = useState<ReturnType<typeof createSyncStoragePersister> | null>(null);

    useEffect(() => {
        // Only safely initialize localStorage on the client
        if (typeof window !== "undefined") {
            const syncPersister = createSyncStoragePersister({
                storage: window.localStorage,
                key: "REACT_QUERY_OFFLINE_CACHE",
            });
            setPersister(syncPersister);
        }
    }, []);

    // During SSR or before hydration, render a normal provider (or wait for persister)
    if (!persister) return null; // Wait for persister to avoid hydration mismatches

    return (
        <PersistQueryClientProvider
            client={queryClient}
            persistOptions={{ persister }}
        >
            {children}
        </PersistQueryClientProvider>
    );
}
