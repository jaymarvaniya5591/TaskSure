import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveCurrentUser } from "@/lib/user";

export async function GET() {
    const supabase = await createClient();
    const currentUser = await resolveCurrentUser(supabase);

    if (!currentUser) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const organisationId = currentUser.organisation_id;
        if (!organisationId) {
            return NextResponse.json({ error: "User has no organisation" }, { status: 400 });
        }

        const { data, error } = await supabase
            .from("users")
            .select("id, name, avatar_url")
            .eq("organisation_id", organisationId)
            .order("name");

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ users: data });
    } catch (e: unknown) {
        return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
    }
}
