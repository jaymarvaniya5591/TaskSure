"use client";

import { useState } from "react";
import { Menu, RefreshCw } from "lucide-react";
import { FaWhatsapp } from "react-icons/fa";
import { useSidebar } from "@/components/layout/SidebarProvider";
import { useUserContext } from "@/lib/user-context";
import SearchEmployee from "@/components/dashboard/SearchEmployee";
import { useIsFetching } from "@tanstack/react-query";
import { useToast } from "@/components/ui/Toast";

export function Header() {
    const { toggleMobileSidebar } = useSidebar();
    const { orgUsers, userId, refreshData, isLoading } = useUserContext();
    const isFetching = useIsFetching();
    const { showToast } = useToast();
    const [isManualRefresh, setIsManualRefresh] = useState(false);

    const isRefreshing = isFetching > 0 || isLoading || isManualRefresh;

    const handleRefresh = async () => {
        setIsManualRefresh(true);
        try {
            await refreshData();
            showToast("Data refreshed!", "success");
        } catch {
            showToast("Refresh failed", "error");
        } finally {
            // Keep spinning for at least 600ms so the user can see it
            setTimeout(() => setIsManualRefresh(false), 600);
        }
    };

    return (
        <div className="sticky top-0 z-40 flex h-16 sm:h-20 shrink-0 items-center border-b border-gray-100 bg-white/70 shadow-sm backdrop-blur-lg px-3 sm:px-4 lg:px-8 gap-3 sm:gap-4">
            {/* Hamburger Menu (Mobile Only) */}
            <button
                type="button"
                className="p-2 text-gray-700 lg:hidden shrink-0"
                onClick={toggleMobileSidebar}
            >
                <span className="sr-only">Open sidebar</span>
                <Menu className="h-6 w-6" aria-hidden="true" />
            </button>

            {/* Global Search Employee — fills all remaining space */}
            <div className="flex-1 min-w-0">
                <SearchEmployee orgUsers={orgUsers} currentUserId={userId} isHeader />
            </div>

            {/* Refresh Button — spins while data is being fetched, shows toast when done */}
            <button
                type="button"
                onClick={handleRefresh}
                className="p-2 text-gray-500 hover:text-gray-900 transition-colors shrink-0"
                title="Refresh dashboard"
                disabled={isManualRefresh}
            >
                <span className="sr-only">Refresh</span>
                <RefreshCw
                    className={`h-5 w-5 transition-all duration-300 ${isRefreshing ? "animate-spin text-blue-500" : ""}`}
                    aria-hidden="true"
                />
            </button>

            {/* WhatsApp — symmetric padding to hamburger */}
            <a
                href="https://wa.me/919620131867"
                target="_blank"
                rel="noopener noreferrer"
                className="p-2 text-[#25D366] hover:text-green-600 transition-colors shrink-0"
                title="Contact us on WhatsApp"
            >
                <span className="sr-only">Contact us on WhatsApp</span>
                <FaWhatsapp className="h-6 w-6" aria-hidden="true" />
            </a>
        </div>
    );
}
