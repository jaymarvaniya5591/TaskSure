"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

export default function QueryProvider({ children }: { children: React.ReactNode }) {
    const [queryClient] = useState(
        () =>
            new QueryClient({
                defaultOptions: {
                    queries: {
                        staleTime: Infinity,           // Data stays fresh for entire session
                        gcTime: Infinity,              // Never garbage-collect cached data
                        refetchOnWindowFocus: false,   // Don't refetch when returning to tab
                        refetchOnMount: false,         // Don't refetch on component remount
                        refetchOnReconnect: false,     // Don't refetch on network reconnect
                        retry: 1,                      // Only retry once on failure
                    },
                },
            })
    );

    return (
        <QueryClientProvider client={queryClient}>
            {children}
        </QueryClientProvider>
    );
}
