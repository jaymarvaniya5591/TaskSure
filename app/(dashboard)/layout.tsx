import QueryProvider from "@/components/providers/QueryProvider";
import { ToastProvider } from "@/components/ui/Toast";
import { DashboardClientWrapper } from "@/components/layout/DashboardClientWrapper";

/**
 * Dashboard layout — wraps all authenticated pages.
 *
 * PERFORMANCE (v4 — Instant App Shell):
 * Includes an INLINE HTML/CSS skeleton that renders before JS downloads.
 * This eliminates the 2-3s blank screen on mobile.
 *
 * Flow:
 *   1. HTML arrives → inline skeleton visible immediately (< 200ms)
 *   2. CSS loads → Tailwind styles available
 *   3. JS loads → React hydrates → DashboardClientWrapper removes inline shell
 *   4. React skeleton (DashboardShellSkeleton) takes over while data loads
 *
 * The inline shell uses ONLY inline styles — zero dependency on CSS/JS files.
 */
export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <>
            {/* ─── Inline App Shell ───
                 Pure HTML/CSS skeleton that shows BEFORE any JS loads.
                 Removed by DashboardClientWrapper on mount.
                 Uses inline styles only — no Tailwind, no external CSS needed. */}
            <div id="app-shell" aria-hidden="true">
                <style dangerouslySetInnerHTML={{
                    __html: `
                    @keyframes app-shell-shimmer {
                        0% { opacity: 0.5; }
                        50% { opacity: 0.8; }
                        100% { opacity: 0.5; }
                    }
                    #app-shell {
                        position: fixed;
                        inset: 0;
                        z-index: 9999;
                        background: #f9fafb;
                        display: flex;
                        flex-direction: column;
                    }
                    #app-shell .sh-bar {
                        background: #e5e7eb;
                        border-radius: 8px;
                        animation: app-shell-shimmer 1.5s ease-in-out infinite;
                    }
                    .hydrated #app-shell {
                        display: none !important;
                    }
                `}} />
                {/* Header */}
                <div style={{
                    height: 64,
                    background: 'rgba(255,255,255,0.9)',
                    borderBottom: '1px solid #f3f4f6',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0 16px',
                    flexShrink: 0,
                }}>
                    <div className="sh-bar" style={{ width: 32, height: 32 }} />
                    <div className="sh-bar" style={{ width: 160, height: 36 }} />
                    <div style={{ display: 'flex', gap: 8 }}>
                        <div className="sh-bar" style={{ width: 32, height: 32 }} />
                        <div className="sh-bar" style={{ width: 32, height: 32 }} />
                    </div>
                </div>
                {/* Content area */}
                <div style={{ flex: 1, padding: '32px 16px', maxWidth: 768, width: '100%', margin: '0 auto' }}>
                    {/* Title + month */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div className="sh-bar" style={{ width: 24, height: 24 }} />
                            <div className="sh-bar" style={{ width: 160, height: 28 }} />
                        </div>
                        <div className="sh-bar" style={{ width: 100, height: 20 }} />
                    </div>
                    {/* Calendar strip */}
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(7, 1fr)',
                        gap: 6,
                        marginBottom: 24,
                        background: 'rgba(255,255,255,0.7)',
                        borderRadius: 16,
                        padding: 8,
                        border: '1px solid rgba(255,255,255,0.5)',
                    }}>
                        {Array.from({ length: 7 }).map((_, i) => (
                            <div key={i} style={{
                                display: 'flex',
                                flexDirection: 'column' as const,
                                alignItems: 'center',
                                gap: 6,
                                padding: '8px 4px',
                                borderRadius: 12,
                            }}>
                                <div className="sh-bar" style={{ width: 28, height: 12 }} />
                                <div className="sh-bar" style={{ width: 24, height: 24, borderRadius: 8 }} />
                            </div>
                        ))}
                    </div>
                    {/* Tab toggle */}
                    <div style={{
                        display: 'flex',
                        background: 'rgba(255,255,255,0.7)',
                        borderRadius: 16,
                        padding: 4,
                        marginBottom: 16,
                        border: '1px solid rgba(255,255,255,0.5)',
                    }}>
                        <div className="sh-bar" style={{ flex: 1, height: 40, borderRadius: 12, background: 'rgba(255,255,255,0.8)' }} />
                        <div className="sh-bar" style={{ flex: 1, height: 40, borderRadius: 12, marginLeft: 4, background: 'rgba(255,255,255,0.3)' }} />
                    </div>
                    {/* Task cards */}
                    <div style={{
                        background: 'rgba(255,255,255,0.7)',
                        borderRadius: 16,
                        padding: 16,
                        border: '1px solid rgba(255,255,255,0.5)',
                    }}>
                        {/* Filter chips */}
                        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                            <div className="sh-bar" style={{ width: 80, height: 32, borderRadius: 99 }} />
                            <div className="sh-bar" style={{ width: 96, height: 32, borderRadius: 99 }} />
                            <div className="sh-bar" style={{ width: 64, height: 32, borderRadius: 99 }} />
                        </div>
                        {/* Card skeletons */}
                        {Array.from({ length: 3 }).map((_, i) => (
                            <div key={i} style={{
                                borderRadius: 16,
                                border: '1px solid #f3f4f6',
                                background: 'white',
                                padding: 16,
                                marginBottom: i < 2 ? 12 : 0,
                            }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                    <div style={{ flex: 1 }}>
                                        <div className="sh-bar" style={{ width: '75%', height: 16, marginBottom: 10 }} />
                                        <div style={{ display: 'flex', gap: 8 }}>
                                            <div className="sh-bar" style={{ width: 80, height: 12 }} />
                                            <div className="sh-bar" style={{ width: 64, height: 12 }} />
                                        </div>
                                    </div>
                                    <div className="sh-bar" style={{ width: 32, height: 32, flexShrink: 0 }} />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* ─── React App ─── */}
            <QueryProvider>
                <ToastProvider>
                    <DashboardClientWrapper>
                        {children}
                    </DashboardClientWrapper>
                </ToastProvider>
            </QueryProvider>
        </>
    );
}
