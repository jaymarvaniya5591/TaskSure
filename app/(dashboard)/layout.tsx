import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DashboardClientWrapper } from "@/components/layout/DashboardClientWrapper";
import QueryProvider from "@/components/providers/QueryProvider";
import { ToastProvider } from "@/components/ui/Toast";
import { type Task } from "@/lib/types";

/**
 * Dashboard layout — wraps all authenticated pages.
 *
 * PERFORMANCE (v2): Uses a single Supabase RPC `get_dashboard_data` that
 * returns user + tasks + org data in ONE database round-trip instead of 5.
 * Timeline fetching is deferred to client-side (not visible above the fold).
 *
 * QueryProvider + ToastProvider are scoped here (not root layout) so
 * landing, login, and signup pages don't pay the ~31KB React Query cost.
 */
export default async function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const supabase = await createClient();

    // Read user ID from middleware header (set after getUser() already validated)
    const headersList = await headers();
    const middlewareUserId = headersList.get("x-user-id");

    if (!middlewareUserId) {
        // Fallback: middleware didn't set header, do full auth check
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) redirect("/login");
        // Shouldn't reach here normally, but handle gracefully
        redirect("/login");
    }

    // ⚡ SINGLE RPC: Replaces 5 separate PostgREST queries with 1 function call.
    // Saves ~1-2 seconds by eliminating 4 extra network round-trips.
    const { data: dashboardData, error } = await supabase.rpc('get_dashboard_data', {
        p_user_id: middlewareUserId,
    });

    if (error || !dashboardData || !dashboardData.current_user) {
        console.error("Dashboard RPC error:", error);
        redirect("/login");
    }

    const currentUser = dashboardData.current_user;

    // Deduplicate tasks (user may have created AND been assigned the same task)
    const taskMap = new Map<string, Task>();
    [...(dashboardData.tasks_created || []), ...(dashboardData.tasks_assigned || [])].forEach((t: Task) =>
        taskMap.set(t.id, t)
    );

    const initialData = {
        tasks: Array.from(taskMap.values()),
        orgUsers: dashboardData.org_users || [],
        allOrgTasks: (dashboardData.all_org_tasks || []) as Task[],
        // Timelines are now deferred to client-side fetching (not visible above fold)
    };

    return (
        <QueryProvider>
            <ToastProvider>
                <DashboardClientWrapper
                    userId={currentUser.id}
                    userName={currentUser.name || "User"}
                    orgId={currentUser.organisation_id}
                    userPhoneNumber={currentUser.phone_number || ""}
                    reportingManagerId={currentUser.reporting_manager_id}
                    initialData={initialData}
                >
                    {children}
                </DashboardClientWrapper>
            </ToastProvider>
        </QueryProvider>
    );
}
