import QueryProvider from "@/components/providers/QueryProvider";
import { ToastProvider } from "@/components/ui/Toast";
import { DashboardClientWrapper } from "@/components/layout/DashboardClientWrapper";

/**
 * Dashboard layout — wraps all authenticated pages.
 *
 * PERFORMANCE (v3 — Static Shell):
 * This layout is now fully static — no async, no server-side data fetching.
 * It renders instantly from CDN as a static HTML shell.
 *
 * All auth resolution and data fetching is handled client-side by
 * DashboardClientWrapper, which shows a skeleton while loading.
 *
 * QueryProvider + ToastProvider are scoped here (not root layout) so
 * landing, login, and signup pages don't pay the ~31KB React Query cost.
 */
export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <QueryProvider>
            <ToastProvider>
                <DashboardClientWrapper>
                    {children}
                </DashboardClientWrapper>
            </ToastProvider>
        </QueryProvider>
    );
}
