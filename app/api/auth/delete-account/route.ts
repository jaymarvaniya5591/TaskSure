import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

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
            .select("first_name, organisation_id")
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

        console.log(`User ${userId} requested deletion and passed name validation.`);

        // 4. Proceed with account deletion using the Admin API
        const adminClient = createAdminClient();

        // Delete from public.users first to avoid orphaned auth accounts.
        const { error: deleteRecordError } = await adminClient
            .from("users")
            .delete()
            .eq("id", userId);

        if (deleteRecordError) {
            console.error("Error deleting user record from DB:", deleteRecordError);
            return NextResponse.json(
                { success: false, error: "Failed to delete user profile data." },
                { status: 500 }
            );
        }

        // 5. Clean up orphaned organisation if this was the last member
        if (dbUser.organisation_id) {
            const { count } = await adminClient
                .from("users")
                .select("id", { count: "exact", head: true })
                .eq("organisation_id", dbUser.organisation_id);

            if (count === 0) {
                const { error: deleteOrgError } = await adminClient
                    .from("organisations")
                    .delete()
                    .eq("id", dbUser.organisation_id);

                if (deleteOrgError) {
                    // Log but don't fail the request — user is already deleted
                    console.error("Error cleaning up orphaned organisation:", deleteOrgError);
                } else {
                    console.log(`Cleaned up orphaned organisation ${dbUser.organisation_id}`);
                }
            }
        }

        // 6. Delete the user from auth.users using the admin api
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
