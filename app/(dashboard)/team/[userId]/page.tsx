"use client";

/**
 * Employee Page — 0ms data fetch via UserContext
 *
 * Derives ALL data from the cached allOrgUsers + allOrgTasks in UserContext.
 * No Supabase queries needed — content renders instantly on navigation.
 */

import { useMemo } from "react";
import { useParams } from "next/navigation";
import { useUserContext } from "@/lib/user-context";
import { type Task } from "@/lib/types";
import EmployeeProfile from "@/components/team/EmployeeProfile";
import EmployeeContent from "@/components/team/EmployeeContent";

export default function EmployeePage() {
    const params = useParams();
    const employeeId = params.userId as string;
    const { userId: currentUserId, allOrgUsers, allOrgTasks } = useUserContext();

    const data = useMemo(() => {
        if (!employeeId || !allOrgUsers.length) return null;

        // Employee profile from cached org users
        const employee = allOrgUsers.find(u => u.id === employeeId);
        if (!employee) return null;

        // Manager from cached org users
        const manager = employee.reporting_manager_id
            ? allOrgUsers.find(u => u.id === employee.reporting_manager_id) || null
            : null;

        // All assigned tasks (for performance stats — includes completed)
        const assignedTasks = allOrgTasks.filter(t => {
            const assigneeId = typeof t.assigned_to === "object" ? t.assigned_to.id : t.assigned_to;
            return assigneeId === employeeId && t.status !== "cancelled";
        }) as Task[];

        // Active tasks created by or assigned to this employee
        const activeStatuses = new Set(["cancelled", "completed"]);
        const activeTaskMap = new Map<string, Task>();

        allOrgTasks.forEach((t: Task) => {
            if (activeStatuses.has(t.status)) return;
            const creatorId = typeof t.created_by === "object" ? t.created_by.id : t.created_by;
            const assigneeId = typeof t.assigned_to === "object" ? t.assigned_to.id : t.assigned_to;
            if (creatorId === employeeId || assigneeId === employeeId) {
                activeTaskMap.set(t.id, t);
            }
        });

        const activeTasks = Array.from(activeTaskMap.values());

        // Common tasks: multi-participant tasks where the current viewer is also involved
        const commonTasks = activeTasks.filter(t => {
            const creatorId = typeof t.created_by === "object" ? t.created_by.id : t.created_by;
            const assigneeId = typeof t.assigned_to === "object" ? t.assigned_to.id : t.assigned_to;
            if (creatorId === assigneeId) return false; // Skip to-dos
            return creatorId === currentUserId || assigneeId === currentUserId;
        });

        const commonTaskIds = new Set(commonTasks.map(t => t.id));
        const otherTasks = activeTasks.filter(t => !commonTaskIds.has(t.id));

        return {
            employee,
            manager,
            assignedTasks,
            commonTasks,
            otherTasks,
        };
    }, [employeeId, currentUserId, allOrgUsers, allOrgTasks]);

    // If employee not found (shouldn't happen for valid org members)
    if (!data) {
        return (
            <div className="flex items-center justify-center h-[50vh] text-gray-500 font-medium">
                Employee not found
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <EmployeeProfile employee={data.employee} manager={data.manager} />
            <EmployeeContent
                assignedTasks={data.assignedTasks}
                commonTasks={data.commonTasks}
                otherTasks={data.otherTasks}
                employeeId={employeeId}
                currentUserId={currentUserId}
            />
        </div>
    );
}
