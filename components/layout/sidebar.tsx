"use client";

/**
 * Sidebar — Persistent side navigation bar (Feature 2).
 *
 * Two main sections:
 * 1. ALL TASKS — To-dos (single participant) + Tasks (multiple participants), color coded
 * 2. ORGANISATION — Search Employee + View Tree
 *
 * Uses UserContext for data (populated by layout server component).
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useSidebar } from "./SidebarProvider";
import {
    Home,
    ListChecks,
    X
} from "lucide-react";

const pageNav = [
    { name: "Home", href: "/home", icon: Home },
];

export function Sidebar() {
    const pathname = usePathname();
    const { isMobileOpen, setIsMobileOpen } = useSidebar();

    return (
        <>
            {/* Mobile backdrop */}
            {isMobileOpen && (
                <div
                    className="fixed inset-0 z-40 bg-gray-900/80 backdrop-blur-sm lg:hidden transition-opacity"
                    onClick={() => setIsMobileOpen(false)}
                />
            )}

            {/* Sidebar container */}
            <div className={cn(
                "fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-white border-r border-gray-100 transition-transform duration-300 ease-in-out lg:translate-x-0",
                isMobileOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full"
            )}>
                {/* Logo & Mobile Close Button */}
                <div className="flex h-16 shrink-0 items-center justify-between px-6">
                    <Link href="/home" className="flex items-center gap-2 font-bold text-xl tracking-tight text-foreground" onClick={() => setIsMobileOpen(false)}>
                        <div className="w-7 h-7 rounded-lg bg-accent-500 flex items-center justify-center text-white">
                            <span className="text-base font-bold">B</span>
                        </div>
                        Boldo AI
                    </Link>
                    <button
                        type="button"
                        className="-m-2.5 p-2.5 text-gray-400 hover:text-gray-500 lg:hidden"
                        onClick={() => setIsMobileOpen(false)}
                    >
                        <span className="sr-only">Close sidebar</span>
                        <X className="h-6 w-6" aria-hidden="true" />
                    </button>
                </div>

                {/* Scrollable content */}
                <div className="flex-1 overflow-y-auto px-4 pb-4">

                    {/* Page Navigation */}
                    <nav className="mb-4">
                        <ul className="space-y-0.5">
                            {pageNav.map(item => {
                                const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
                                return (
                                    <li key={item.name}>
                                        <Link
                                            href={item.href}
                                            onClick={() => setIsMobileOpen(false)}
                                            className={cn(
                                                isActive
                                                    ? "bg-gray-900 text-white"
                                                    : "text-gray-600 hover:text-gray-900 hover:bg-gray-50",
                                                "group flex gap-x-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-all duration-200"
                                            )}
                                        >
                                            <item.icon
                                                className={cn(
                                                    isActive ? "text-white" : "text-gray-400 group-hover:text-gray-600",
                                                    "h-5 w-5 shrink-0 transition-colors"
                                                )}
                                                aria-hidden="true"
                                            />
                                            {item.name}
                                        </Link>
                                    </li>
                                );
                            })}
                        </ul>
                    </nav>

                    <div className="w-full h-px bg-gray-100 mb-4" />

                    {/* ── SECTION 1: ALL TASKS ── */}
                    <div className="mb-4">
                        <Link
                            href="/tasks"
                            onClick={() => setIsMobileOpen(false)}
                            className={cn(
                                pathname.startsWith("/tasks")
                                    ? "bg-gray-900 text-white"
                                    : "text-gray-600 hover:text-gray-900 hover:bg-gray-50",
                                "group flex items-center justify-between rounded-xl px-3 py-2.5 text-sm font-semibold transition-all duration-200"
                            )}
                        >
                            <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider">
                                <ListChecks className={cn("w-4 h-4", pathname.startsWith("/tasks") ? "text-white" : "text-gray-400 group-hover:text-gray-600")} />
                                All Tasks
                            </span>
                        </Link>
                    </div>

                </div>
            </div>
        </>
    );
}
