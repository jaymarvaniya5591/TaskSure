"use client";

/**
 * EmployeeProfile — Compact header for the employee detail page.
 * Shows name as heading with an info dropdown for role, manager, phone.
 */

import { useState, useRef, useEffect } from "react";
import { Crown, Shield, Users, User, Phone, Info, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { type OrgUser } from "@/lib/hierarchy";

interface EmployeeProfileProps {
    employee: OrgUser;
    manager: OrgUser | null;
}

const roleConfig: Record<string, { icon: typeof Crown; label: string; color: string; bg: string }> = {
    owner: { icon: Crown, label: "Owner", color: "text-amber-700", bg: "bg-amber-50 border-amber-200" },
    manager: { icon: Shield, label: "Manager", color: "text-blue-700", bg: "bg-blue-50 border-blue-200" },
    member: { icon: Users, label: "Member", color: "text-gray-600", bg: "bg-gray-50 border-gray-200" },
};

export default function EmployeeProfile({ employee, manager }: EmployeeProfileProps) {
    const [showInfo, setShowInfo] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const role = employee.role || "member";
    const config = roleConfig[role] || roleConfig.member;
    const RoleIcon = config.icon;

    useEffect(() => {
        function handleClick(e: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setShowInfo(false);
            }
        }
        if (showInfo) document.addEventListener("mousedown", handleClick);
        return () => document.removeEventListener("mousedown", handleClick);
    }, [showInfo]);

    return (
        <div className="flex items-center justify-between gap-3">
            {/* Name heading */}
            <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight truncate">
                {employee.name}
            </h1>

            {/* Info dropdown */}
            <div className="relative shrink-0" ref={dropdownRef}>
                <button
                    onClick={() => setShowInfo(!showInfo)}
                    className={cn(
                        "flex items-center gap-1.5 px-3 py-2 rounded-xl border text-sm font-semibold transition-all duration-200",
                        showInfo
                            ? "bg-gray-900 text-white border-gray-900"
                            : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50 hover:border-gray-300"
                    )}
                >
                    <Info className="w-4 h-4" />
                    <span className="hidden sm:inline">Profile</span>
                    <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", showInfo && "rotate-180")} />
                </button>

                {showInfo && (
                    <div className="absolute right-0 top-full mt-2 w-72 bg-white rounded-2xl shadow-xl border border-gray-100 p-4 z-50 animate-fade-in-up origin-top-right">
                        <div className="flex items-center justify-between mb-4">
                            <span className="text-xs font-bold uppercase tracking-wider text-gray-400">Employee Info</span>
                            <button onClick={() => setShowInfo(false)} className="p-1 hover:bg-gray-100 rounded-lg transition-colors">
                                <X className="w-4 h-4 text-gray-400" />
                            </button>
                        </div>

                        <div className="space-y-3">
                            {/* Avatar + Name row */}
                            <div className="flex items-center gap-3">
                                <div className={cn(
                                    "w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
                                    config.bg
                                )}>
                                    {employee.avatar_url ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img src={employee.avatar_url} alt="" className="w-full h-full rounded-xl object-cover" />
                                    ) : (
                                        <User className={cn("w-5 h-5", config.color)} />
                                    )}
                                </div>
                                <div className="min-w-0">
                                    <p className="text-sm font-bold text-gray-900 truncate">{employee.name}</p>
                                    <span className={cn(
                                        "inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider",
                                        config.color
                                    )}>
                                        <RoleIcon className="w-3 h-3" />
                                        {config.label}
                                    </span>
                                </div>
                            </div>

                            {/* Manager */}
                            {manager && (
                                <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-xl border border-gray-100">
                                    <span className="text-xs text-gray-500">Reports to</span>
                                    <span className="text-xs font-bold text-gray-900">{manager.name}</span>
                                </div>
                            )}

                            {/* Phone */}
                            {employee.phone_number && (
                                <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-xl border border-gray-100">
                                    <Phone className="w-3.5 h-3.5 text-gray-400" />
                                    <span className="font-mono text-xs text-gray-700">{employee.phone_number}</span>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
