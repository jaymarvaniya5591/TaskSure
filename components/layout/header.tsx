"use client";

import { useState } from "react";
import { Menu, RefreshCw } from "lucide-react";

function WhatsAppIcon({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
        </svg>
    );
}
import { useSidebar } from "@/components/layout/SidebarProvider";
import { useUserContext } from "@/lib/user-context";
import SearchEmployee from "@/components/dashboard/SearchEmployee";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/ui/Toast";
import { debugLog } from "@/lib/debug-logger";

export function Header() {
    const { toggleMobileSidebar } = useSidebar();
    const { orgUsers, userId, refreshData, isLoading } = useUserContext();
    const isFetching = useIsFetching({ queryKey: ["dashboard"] });
    const queryClient = useQueryClient();
    const { showToast } = useToast();
    const [isManualRefresh, setIsManualRefresh] = useState(false);

    const isRefreshing = isFetching > 0 || isLoading || isManualRefresh;

    const handleRefresh = async () => {
        debugLog("REFRESH_START", `isFetching=${isFetching} isLoading=${isLoading} isManualRefresh=${isManualRefresh}`);
        setIsManualRefresh(true);
        try {
            // Safety timeout: stop spinner after 10s max to prevent infinite spinning
            // if a Supabase call hangs on slow mobile networks
            const timeout = new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error("timeout")), 10000)
            );
            debugLog("REFRESH_AWAITING", "calling refreshData()");
            await Promise.race([refreshData(), timeout]);
            debugLog("REFRESH_SUCCESS", "data refreshed");
            showToast("Data refreshed!", "success");
        } catch (err) {
            const msg = err instanceof Error && err.message === "timeout"
                ? "Refresh timed out — please try again"
                : "Refresh failed";
            debugLog("REFRESH_ERROR", `msg=${msg} err=${err instanceof Error ? err.message : String(err)}`);

            // If timed out, cancel lingering in-flight queries so isFetching resets to 0
            // and the spinner doesn't keep spinning forever
            if (err instanceof Error && err.message === "timeout") {
                debugLog("REFRESH_CANCEL", "cancelling stale dashboard queries");
                queryClient.cancelQueries({ queryKey: ["dashboard"] });
            }

            showToast(msg, "error");
        } finally {
            // Keep spinning for at least 600ms so the user can see it
            setTimeout(() => {
                setIsManualRefresh(false);
                debugLog("REFRESH_DONE", `isFetching=${isFetching}`);
            }, 600);
        }
    };

    return (
        <div className="sticky top-4 sm:top-6 z-30 flex items-center justify-between backdrop-blur-xl bg-white/60 border border-white/40 shadow-sm p-1 gap-0.5 sm:gap-1 mx-4 sm:mx-6 lg:mx-8 rounded-2xl mb-4 sm:mb-6">
            {/* Hamburger Menu (Mobile Only) */}
            <button
                type="button"
                className="lg:hidden flex items-center justify-center p-2 sm:p-2.5 bg-white shadow-md rounded-xl text-gray-600 hover:text-gray-900 transition-all duration-200 shrink-0"
                onClick={toggleMobileSidebar}
            >
                <span className="sr-only">Open sidebar</span>
                <Menu className="h-5 w-5" aria-hidden="true" />
            </button>

            {/* Global Search Employee — flexes to consume maximum available width (~70%) */}
            <div className="flex-1 mx-0.5 sm:mx-1 min-w-0">
                <SearchEmployee orgUsers={orgUsers} currentUserId={userId} isHeader />
            </div>

            {/* Actions group */}
            <div className="flex items-center gap-0.5 shrink-0">
                {/* Refresh Button */}
                <button
                    type="button"
                    onClick={handleRefresh}
                    className="flex items-center justify-center p-2 sm:p-2.5 bg-white shadow-md rounded-xl text-gray-600 hover:text-gray-900 transition-all duration-200 shrink-0"
                    title="Refresh dashboard"
                    disabled={isManualRefresh}
                >
                    <span className="sr-only">Refresh</span>
                    <RefreshCw
                        className={`h-5 w-5 transition-all duration-300 ${isRefreshing ? "animate-spin text-blue-500" : ""}`}
                        aria-hidden="true"
                    />
                </button>

                {/* WhatsApp */}
                <a
                    href="https://wa.me/919620131867"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center p-2 sm:p-2.5 bg-white shadow-md rounded-xl text-[#25D366] hover:text-green-600 transition-all duration-200 shrink-0"
                    title="Contact us on WhatsApp"
                >
                    <span className="sr-only">Contact us on WhatsApp</span>
                    <WhatsAppIcon className="h-5 w-5" />
                </a>
            </div>
        </div>
    );
}
