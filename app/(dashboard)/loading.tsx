/**
 * Dashboard loading.tsx — Shown INSTANTLY by Next.js while the server-side
 * layout.tsx resolves (resolveCurrentUser + DB queries).
 * 
 * This is the key to "idea #1": Next.js streams this HTML immediately
 * before any server component resolves, giving <50ms shell rendering.
 */

import { DashboardShellSkeleton } from "@/components/ui/DashboardSkeleton";

export default function DashboardLoading() {
    return <DashboardShellSkeleton />;
}
