"use client";

/**
 * EmployeeProfile — Profile card for the employee detail page.
 * Shows name, role badge, reporting manager, phone number, and avatar.
 */

import { Crown, Shield, Users, User, Phone } from "lucide-react";
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
    const role = employee.role || "member";
    const config = roleConfig[role] || roleConfig.member;
    const RoleIcon = config.icon;

    return (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 sm:p-8 flex flex-col sm:flex-row items-center sm:items-start gap-6">
            {/* Avatar */}
            <div className={cn(
                "w-24 h-24 rounded-2xl flex items-center justify-center shadow-[inset_0_2px_4px_rgba(0,0,0,0.06)] shrink-0",
                config.bg
            )}>
                {employee.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={employee.avatar_url} alt="" className="w-full h-full rounded-2xl object-cover" />
                ) : (
                    <User className={cn("w-12 h-12", config.color)} />
                )}
            </div>

            <div className="flex-1 min-w-0 flex flex-col items-center sm:items-start text-center sm:text-left">
                <h2 className="text-3xl font-extrabold text-gray-900 tracking-tight">{employee.name}</h2>
                <div className="mt-3 flex flex-wrap items-center justify-center sm:justify-start gap-3">
                    <span className={cn(
                        "inline-flex items-center gap-1.5 px-3 py-1 rounded-lg border text-xs font-bold uppercase tracking-wider",
                        config.bg, config.color
                    )}>
                        <RoleIcon className="w-3.5 h-3.5" />
                        {config.label}
                    </span>
                    {manager && (
                        <div className="flex items-center gap-1.5 text-sm text-gray-500 bg-gray-50 px-3 py-1 rounded-lg border border-gray-100">
                            <span>Reports to</span>
                            <span className="font-semibold text-gray-900">{manager.name}</span>
                        </div>
                    )}
                </div>

                {employee.phone_number && (
                    <div className="mt-5 flex items-center justify-center sm:justify-start gap-2 text-gray-700 font-medium bg-gray-50 rounded-xl border border-gray-100 px-4 py-2 w-fit">
                        <Phone className="w-4 h-4 text-gray-400" />
                        <span className="font-mono text-sm">{employee.phone_number}</span>
                    </div>
                )}
            </div>
        </div>
    );
}
