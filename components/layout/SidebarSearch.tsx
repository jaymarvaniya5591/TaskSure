"use client";

/**
 * SidebarSearch — Organisation search in the sidebar.
 * Search employees by name. Hierarchy rank filtered.
 * Clicking navigates to Employee Page (Feature 3 placeholder).
 */

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Search, User, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { type OrgUser, getUsersAtOrBelowRank } from "@/lib/hierarchy";

interface SidebarSearchProps {
    orgUsers: OrgUser[];
    currentUserId: string;
}

export default function SidebarSearch({ orgUsers, currentUserId }: SidebarSearchProps) {
    const router = useRouter();
    const [query, setQuery] = useState("");
    const [isFocused, setIsFocused] = useState(false);

    const visibleUsers = useMemo(
        () => getUsersAtOrBelowRank(orgUsers, currentUserId).filter(u => u.id !== currentUserId),
        [orgUsers, currentUserId]
    );

    const results = useMemo(() => {
        if (!query.trim()) return [];
        const q = query.toLowerCase();
        return visibleUsers.filter(u => u.name.toLowerCase().includes(q)).slice(0, 5);
    }, [query, visibleUsers]);

    const showResults = isFocused && query.trim().length > 0;

    return (
        <div className="relative">
            <div className={cn(
                "flex items-center gap-2 rounded-xl border transition-all duration-200 px-2.5 py-2",
                isFocused ? "border-gray-400 bg-white shadow-sm" : "border-gray-200 bg-gray-50 hover:border-gray-300"
            )}>
                <Search className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                <input
                    type="text"
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    onFocus={() => setIsFocused(true)}
                    onBlur={() => setTimeout(() => setIsFocused(false), 200)}
                    placeholder="Search employee..."
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    className="flex-1 text-xs font-medium text-gray-700 placeholder:text-gray-400 bg-transparent outline-none"
                />
            </div>

            {showResults && (
                <div className="absolute z-30 top-full left-0 right-0 mt-1 bg-white rounded-xl border border-gray-200 shadow-lg overflow-hidden">
                    {results.length === 0 ? (
                        <p className="text-[11px] text-gray-400 text-center py-3">No results</p>
                    ) : (
                        <ul>
                            {results.map(user => (
                                <li key={user.id}>
                                    <button
                                        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 transition-colors text-left group"
                                        onClick={() => {
                                            router.push(`/team/${user.id}`);
                                            setQuery("");
                                        }}
                                    >
                                        <div className="w-6 h-6 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                                            <User className="w-3.5 h-3.5 text-gray-500" />
                                        </div>
                                        <span className="text-xs font-medium text-gray-700 truncate flex-1">{user.name}</span>
                                        <ChevronRight className="w-3 h-3 text-gray-300 shrink-0" />
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
        </div>
    );
}
