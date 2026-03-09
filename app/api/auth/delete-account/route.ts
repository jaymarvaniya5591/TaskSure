import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const preferredRegion = 'sin1';
export async function POST(req: NextRequest) {
    try {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (!supabaseUrl || !serviceRoleKey) {
            console.error("Missing SUPABASE env vars.");
            return NextResponse.json(
                { success: false, error: "Server configuration error" },
                { status: 500 }
            );
        }

        const supabase = await createClient();

        // 1. Verify user is authenticated
        const { data: userData, error: userError } = await supabase.auth.getUser();

        if (userError || !userData?.user) {
            console.error("Auth error:", userError);
            return NextResponse.json(
                { success: false, error: "Unauthorized or session expired" },
                { status: 401 }
            );
        }

        const userId = userData.user.id;

        // 2. Fetch the user's details from public.users to verify the first name match
        const { data: dbUser, error: dbUserError } = await supabase
            .from("users")
            .select("first_name, organisation_id, role")
            .eq("id", userId)
            .single();

        if (dbUserError || !dbUser) {
            console.error("Failed to fetch user details:", dbUserError);
            return NextResponse.json(
                { success: false, error: "User record not found" },
                { status: 404 }
            );
        }

        // 3. Parse and validate the payload (the entered first name to confirm)
        const body = await req.json();
        const { confirmFirstName } = body;

        if (!confirmFirstName) {
            return NextResponse.json(
                { success: false, error: "Confirmation first name is required" },
                { status: 400 }
            );
        }

        if (confirmFirstName.trim().toLowerCase() !== dbUser.first_name?.trim().toLowerCase()) {
            return NextResponse.json(
                { success: false, error: "First name does not match. Deletion aborted." },
                { status: 400 }
            );
        }

        // Prevent the last owner from deleting their account — it would lock the organisation.
        if (dbUser.role === 'owner' && dbUser.organisation_id) {
            const { count: ownerCount } = await supabase
                .from("users")
                .select("id", { count: "exact", head: true })
                .eq("organisation_id", dbUser.organisation_id)
                .eq("role", "owner");

            if (ownerCount === 1) {
                return NextResponse.json(
                    {
                        success: false,
                        error: "You are the only admin of this organisation. You cannot delete your account without first assigning admin rights to another member.",
                    },
                    { status: 400 }
                );
            }
        }

        console.log(`User ${userId} requested deletion and passed name validation.`);

        // 4. Call the cascade_delete_user SQL function to atomically clean up
        //    all dependent records, re-link the reporting chain, and delete the user.
        const adminClient = createAdminClient();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const adminAny = adminClient as any; // service-role client needs 'as any' for schema inference

        // Bug 2.1: Reassign tasks created by this user to another org owner/admin before
        // the cascade fires. The tasks.created_by FK has ON DELETE CASCADE, so without
        // this step, deleting the user row would silently wipe all tasks they created.
        if (dbUser.organisation_id) {
            // Prefer another owner; fall back to any remaining org member.

            const { data: newOwner } = await adminAny
                .from('users')
                .select('id')
                .eq('organisation_id', dbUser.organisation_id)
                .eq('role', 'owner')
                .neq('id', userId)
                .limit(1)
                .single() as { data: { id: string } | null };

            let fallbackAdminId: string | undefined;
            if (!newOwner) {
                const { data: fb } = await adminAny
                    .from('users')
                    .select('id')
                    .eq('organisation_id', dbUser.organisation_id)
                    .neq('id', userId)
                    .limit(1)
                    .single() as { data: { id: string } | null };
                fallbackAdminId = fb?.id;
            }

            const inheritingUserId = newOwner?.id ?? fallbackAdminId;

            if (inheritingUserId) {
                await adminAny
                    .from('tasks')
                    .update({ created_by: inheritingUserId, updated_at: new Date().toISOString() })
                    .eq('created_by', userId)
                    .not('status', 'eq', 'cancelled');
            }
            // If no other member exists (single-member org), the cascade deletes those
            // tasks — acceptable since the entire org effectively ceases to operate.
        }

        // Bug 2.2: Reassign active subtasks assigned to this user to their parent task's
        // owner. Without this, subtasks become permanently locked to a ghost UUID after
        // the user is removed — nobody can complete or reassign them.
        const { data: orphanedSubtasks } = await adminAny
            .from('tasks')
            .select('id, parent_task_id')
            .eq('assigned_to', userId)
            .not('parent_task_id', 'is', null)
            .in('status', ['pending', 'accepted', 'overdue']) as { data: Array<{ id: string; parent_task_id: string }> | null };

        if (orphanedSubtasks && orphanedSubtasks.length > 0) {
            const parentIds = Array.from(new Set(orphanedSubtasks.map(s => s.parent_task_id)));
            const { data: parentTasks } = await adminAny
                .from('tasks')
                .select('id, created_by')
                .in('id', parentIds) as { data: Array<{ id: string; created_by: string }> | null };

            const parentOwnerMap = new Map(parentTasks?.map(p => [p.id, p.created_by]) ?? []);

            await Promise.all(
                orphanedSubtasks.map((subtask: { id: string; parent_task_id: string }) => {
                    const newAssignee = parentOwnerMap.get(subtask.parent_task_id);
                    if (!newAssignee) return Promise.resolve();
                    return adminAny
                        .from('tasks')
                        .update({
                            assigned_to: newAssignee,
                            status: 'pending',
                            committed_deadline: null,
                            updated_at: new Date().toISOString(),
                        })
                        .eq('id', subtask.id);
                })
            );
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: rpcResult, error: rpcError } = await (adminClient as any)
            .rpc("cascade_delete_user", { target_user_id: userId });

        if (rpcError) {
            console.error("Error in cascade_delete_user RPC:", rpcError);
            return NextResponse.json(
                { success: false, error: "Failed to delete user profile data." },
                { status: 500 }
            );
        }

        if (rpcResult && !rpcResult.success) {
            console.error("cascade_delete_user returned failure:", rpcResult.error);
            return NextResponse.json(
                { success: false, error: rpcResult.error || "Failed to delete user profile data." },
                { status: 500 }
            );
        }

        console.log(`cascade_delete_user completed for ${userId}:`, rpcResult);

        // 5. Delete the user from auth.users using the admin api
        const { error: deleteAuthError } = await adminClient.auth.admin.deleteUser(userId);

        if (deleteAuthError) {
            console.error("Error deleting user from auth:", deleteAuthError);
            return NextResponse.json(
                { success: false, error: "Failed to delete authentication account." },
                { status: 500 }
            );
        }

        console.log(`Successfully deleted user account ${userId}.`);

        return NextResponse.json({ success: true, message: "Account deleted successfully." });

    } catch (error: unknown) {
        console.error("Unexpected error deleting account:", error);

        const errorMessage = error instanceof Error ? error.message : "An unexpected error occurred.";

        return NextResponse.json(
            { success: false, error: errorMessage },
            { status: 500 }
        );
    }
}
