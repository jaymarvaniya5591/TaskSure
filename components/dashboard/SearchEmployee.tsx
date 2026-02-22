"use client";

/**
 * Section 5 — Search Employee
 * Prominent search bar. Searches org users by name.
 * Only shows users at equal or lower hierarchy rank.
 * Clicking a result navigates to Employee Page (Feature 3 placeholder).
 */

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Search, ChevronRight, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { type OrgUser } from "@/lib/hierarchy";

interface SearchEmployeeProps {
    orgUsers: OrgUser[];
    currentUserId: string;
    isHeader?: boolean;
    /** When true, the current user will appear in search results (used in task/subtask creation). */
    includeSelf?: boolean;
    onSelect?: (user: OrgUser) => void;
}

export default function SearchEmployee({ orgUsers, currentUserId, isHeader = false, includeSelf = false, onSelect }: SearchEmployeeProps) {
    const router = useRouter();
    const [query, setQuery] = useState("");
    const [isFocused, setIsFocused] = useState(false);

    const visibleUsers = useMemo(
        () => includeSelf ? orgUsers : orgUsers.filter(u => u.id !== currentUserId),
        [orgUsers, currentUserId, includeSelf]
    );

    const results = useMemo(() => {
        if (!query.trim()) return [];
        const q = query.toLowerCase();
        return visibleUsers.filter(u => u.name.toLowerCase().includes(q)).slice(0, 6);
    }, [query, visibleUsers]);

    const showResults = isFocused && query.trim().length > 0;

    return (
        <section className={cn("relative", !isHeader && "animate-fade-in-up")} style={!isHeader ? { animationDelay: "0.15s" } : {}}>
            {!isHeader && (
                <div className="flex items-center gap-2 mb-4">
                    <div className="p-2 rounded-xl bg-violet-600">
                        <Search className="w-4 h-4 text-white" />
                    </div>
                    <h2 className="text-lg font-bold text-gray-900 tracking-tight">Search Employee</h2>
                </div>
            )}

            <div className="relative">
                <div className={cn(
                    "relative flex items-center rounded-2xl border transition-all duration-200 bg-white",
                    isHeader ? "border-transparent bg-gray-100 hover:bg-gray-200/80 focus-within:bg-white focus-within:border-violet-500 focus-within:ring-2 focus-within:ring-violet-200" : "border-2",
                    (!isHeader && isFocused) ? "border-gray-900 shadow-lg shadow-gray-900/10" : "border-gray-200 hover:border-gray-300"
                )}>
                    <Search className={cn(
                        "w-5 h-5 ml-4 shrink-0 transition-colors",
                        isFocused ? "text-gray-900" : "text-gray-400"
                    )} />
                    <input
                        type="text"
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        onFocus={() => setIsFocused(true)}
                        onBlur={() => setTimeout(() => setIsFocused(false), 200)}
                        placeholder="Search Employee..."
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck={false}
                        className={cn("flex-1 min-w-0 text-ellipsis px-2 sm:px-3 text-sm font-medium text-gray-900 placeholder:text-gray-500 bg-transparent outline-none", isHeader ? "py-2.5 lg:py-2" : "py-4")}
                    />
                    {query && (
                        <button
                            onClick={() => setQuery("")}
                            className="mr-3 text-xs font-medium text-gray-400 hover:text-gray-600 transition-colors"
                        >
                            Clear
                        </button>
                    )}
                </div>

                {/* Results dropdown */}
                {showResults && (
                    <div className="absolute z-[9999] top-full left-0 right-0 sm:min-w-0 min-w-[260px] mt-2 bg-white rounded-2xl border border-gray-200 shadow-xl shadow-gray-900/10 overflow-hidden animate-fade-in-up" style={{ animationDuration: '0.2s' }}>                     {results.length === 0 ? (
                        <div className="p-6 text-center">
                            <p className="text-sm text-gray-500">No employees found for &ldquo;{query}&rdquo;</p>
                        </div>
                    ) : (
                        <ul>
                            {results.map(user => (
                                <li key={user.id}>
                                    <button
                                        className="w-full flex items-center gap-3 p-4 hover:bg-gray-50 transition-colors text-left group"
                                        onClick={(e) => {
                                            e.preventDefault();
                                            if (onSelect) {
                                                onSelect(user);
                                            } else {
                                                router.push(`/team/${user.id}`);
                                            }
                                            setQuery("");
                                        }}
                                    >
                                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center shrink-0">
                                            <User className="w-5 h-5 text-gray-500" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-semibold text-gray-900 truncate">{user.name}</p>
                                            <p className="text-xs text-gray-500 capitalize">{user.role || "member"}</p>
                                        </div>
                                        <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-gray-500 transition-colors shrink-0" />
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                    </div>
                )}
            </div>
        </section>
    );
}
