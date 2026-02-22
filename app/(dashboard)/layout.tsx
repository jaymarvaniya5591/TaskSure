import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveCurrentUser } from "@/lib/user";
import { DashboardClientWrapper } from "@/components/layout/DashboardClientWrapper";

export default async function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const supabase = await createClient();
    const currentUser = await resolveCurrentUser(supabase);
    if (!currentUser) redirect("/login");

    return (
        <DashboardClientWrapper
            userId={currentUser.id}
            userName={currentUser.name || "User"}
            orgId={currentUser.organisation_id}
        >
            {children}
        </DashboardClientWrapper>
    );
}
