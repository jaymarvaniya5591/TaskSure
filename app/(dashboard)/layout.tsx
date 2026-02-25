import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveUserById, resolveCurrentUser } from "@/lib/user";
import { DashboardClientWrapper } from "@/components/layout/DashboardClientWrapper";
import QueryProvider from "@/components/providers/QueryProvider";
import { ToastProvider } from "@/components/ui/Toast";
import { type Task } from "@/lib/types";

/**
 * Dashboard layout — wraps all authenticated pages.
 *
 * PERFORMANCE: Reads user ID from middleware header (x-user-id) to skip
 * the duplicate getUser() call. Prefetches dashboard data server-side
 * so client renders content immediately on hydration.
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

    let currentUser;
    if (middlewareUserId) {
        // Fast path: middleware already validated auth, just look up the users table
        currentUser = await resolveUserById(supabase, middlewareUserId);
    } else {
        // Fallback: full resolution (e.g. if middleware didn't set header)
        currentUser = await resolveCurrentUser(supabase);
    }

    if (!currentUser) redirect("/login");

    // Prefetch dashboard data server-side — this eliminates the client-side
    // fetch waterfall where React Query fires 4 queries after hydration.
    const [
        { data: tasksCreated },
        { data: tasksAssigned },
        { data: orgUsers },
        { data: allOrgTasksRaw },
    ] = await Promise.all([
        supabase
            .from("tasks")
            .select(
                "*, created_by:users!tasks_created_by_fkey(id, name), assigned_to:users!tasks_assigned_to_fkey(id, name)"
            )
            .eq("created_by", currentUser.id)
            .not("status", "in", '("completed","cancelled")'),
        supabase
            .from("tasks")
            .select(
                "*, created_by:users!tasks_created_by_fkey(id, name), assigned_to:users!tasks_assigned_to_fkey(id, name)"
            )
            .eq("assigned_to", currentUser.id)
            .not("status", "in", '("completed","cancelled")'),
        supabase
            .from("users")
            .select(
                "id, name, phone_number, role, reporting_manager_id, avatar_url"
            )
            .eq("organisation_id", currentUser.organisation_id),
        supabase
            .from("tasks")
            .select(
                "*, created_by:users!tasks_created_by_fkey(id, name), assigned_to:users!tasks_assigned_to_fkey(id, name)"
            )
            .eq("organisation_id", currentUser.organisation_id)
            .not("status", "eq", "cancelled"),
    ]);

    // Deduplicate tasks (user may have created AND been assigned the same task)
    const taskMap = new Map<string, Task>();
    [...(tasksCreated || []), ...(tasksAssigned || [])].forEach((t: Task) =>
        taskMap.set(t.id, t)
    );

    const initialData = {
        tasks: Array.from(taskMap.values()),
        orgUsers: orgUsers || [],
        allOrgTasks: (allOrgTasksRaw || []) as Task[],
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
