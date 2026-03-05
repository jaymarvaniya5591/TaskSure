"use client";

/**
 * /auth/callback — Instant skeleton + background auth processing.
 *
 * TWO ENTRY POINTS:
 *   1. ?verify_token=xxx — Redirected here instantly by /api/auth/verify-link.
 *      Shows skeleton immediately, calls the API back via fetch() for processing.
 *   2. ?token_hash=xxx — Legacy Supabase magic link flow (fallback).
 *      Shows skeleton immediately, exchanges token client-side.
 *
 * The skeleton is baked into the static HTML at build time (no JS needed to render).
 * Auth processing happens in background JS while the user sees the skeleton.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/** Inline skeleton that matches the dashboard layout — renders before JS */
function InlineSkeleton({ message }: { message: string }) {
    return (
        <div style={{
            position: 'fixed',
            inset: 0,
            background: '#f9fafb',
            display: 'flex',
            flexDirection: 'column' as const,
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            zIndex: 9999,
        }}>
            <style dangerouslySetInnerHTML={{
                __html: `
                @keyframes cb-shimmer {
                    0% { opacity: 0.5; }
                    50% { opacity: 0.8; }
                    100% { opacity: 0.5; }
                }
                @keyframes cb-spin {
                    to { transform: rotate(360deg); }
                }
                .cb-bar {
                    background: #e5e7eb;
                    border-radius: 8px;
                    animation: cb-shimmer 1.5s ease-in-out infinite;
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
                <div className="cb-bar" style={{ width: 32, height: 32 }} />
                <div className="cb-bar" style={{ width: 160, height: 36 }} />
                <div style={{ display: 'flex', gap: 8 }}>
                    <div className="cb-bar" style={{ width: 32, height: 32 }} />
                    <div className="cb-bar" style={{ width: 32, height: 32 }} />
                </div>
            </div>
            {/* Content area */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column' as const, alignItems: 'center', padding: '32px 16px' }}>
                {/* Signing in message */}
                <div style={{
                    display: 'flex',
                    flexDirection: 'column' as const,
                    alignItems: 'center',
                    gap: 16,
                    marginBottom: 32,
                }}>
                    <div style={{
                        width: 40,
                        height: 40,
                        border: '4px solid #e5e7eb',
                        borderTopColor: '#eab308',
                        borderRadius: '50%',
                        animation: 'cb-spin 0.8s linear infinite',
                    }} />
                    <p style={{
                        color: '#6b7280',
                        fontSize: 16,
                        fontWeight: 500,
                        margin: 0,
                    }}>{message}</p>
                </div>
                {/* Dashboard preview skeleton */}
                <div style={{ width: '100%', maxWidth: 768 }}>
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
                            }}>
                                <div className="cb-bar" style={{ width: 28, height: 12 }} />
                                <div className="cb-bar" style={{ width: 24, height: 24, borderRadius: 8 }} />
                            </div>
                        ))}
                    </div>
                    {/* Task cards */}
                    <div style={{
                        background: 'rgba(255,255,255,0.7)',
                        borderRadius: 16,
                        padding: 16,
                        border: '1px solid rgba(255,255,255,0.5)',
                    }}>
                        {Array.from({ length: 3 }).map((_, i) => (
                            <div key={i} style={{
                                borderRadius: 16,
                                border: '1px solid #f3f4f6',
                                background: 'white',
                                padding: 16,
                                marginBottom: i < 2 ? 12 : 0,
                            }}>
                                <div className="cb-bar" style={{ width: '75%', height: 16, marginBottom: 10 }} />
                                <div style={{ display: 'flex', gap: 8 }}>
                                    <div className="cb-bar" style={{ width: 80, height: 12 }} />
                                    <div className="cb-bar" style={{ width: 64, height: 12 }} />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}

export default function AuthCallbackPage() {
    const router = useRouter();
    const supabase = createClient();
    const [message, setMessage] = useState("Signing you in securely...");

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);

        // ─── Flow 1: verify_token (from /api/auth/verify-link instant redirect) ───
        const verifyToken = params.get("verify_token");
        if (verifyToken) {
            handleVerifyToken(verifyToken);
            return;
        }

        // ─── Flow 2: token_hash (legacy Supabase magic link fallback) ───
        const tokenHash = params.get("token_hash");
        if (tokenHash) {
            handleMagicLink(tokenHash, params.get("type"), params.get("next") || "/home");
            return;
        }

        // No valid params
        setMessage("Missing authentication token");
        setTimeout(() => router.push("/login?error=missing_token"), 2000);
    }, []);

    /** Call /api/auth/verify-link with _api=1 to process in the background */
    async function handleVerifyToken(token: string) {
        try {
            const res = await fetch(`/api/auth/verify-link?token=${encodeURIComponent(token)}&_api=1`, {
                credentials: 'include', // Send/receive cookies
            });

            if (!res.ok) {
                setMessage("Authentication failed. Redirecting...");
                setTimeout(() => router.push("/login?error=auth_failed"), 2000);
                return;
            }

            const data = await res.json();

            if (data.redirect) {
                setMessage("You're in! Loading your workspace...");
                // Use hard navigation to pick up new cookies
                window.location.href = data.redirect;
            } else {
                setMessage("Something went wrong. Redirecting...");
                setTimeout(() => router.push("/login?error=auth_failed"), 2000);
            }
        } catch (err) {
            console.error("[AuthCallback] verify-link API error:", err);
            setMessage("Connection error. Redirecting...");
            setTimeout(() => router.push("/login?error=auth_failed"), 2000);
        }
    }

    /** Exchange a Supabase magic link token hash */
    async function handleMagicLink(tokenHash: string, type: string | null, next: string) {
        try {
            const { data, error: verifyErr } = await supabase.auth.verifyOtp({
                type: (type as "magiclink") || "magiclink",
                token_hash: tokenHash,
            });

            if (verifyErr) {
                console.error("[AuthCallback] Magic link exchange failed:", verifyErr);
                setMessage("Link expired. Redirecting to login...");
                setTimeout(() => router.push("/login?error=auth_failed"), 2000);
                return;
            }

            if (data.session) {
                setMessage("You're in! Loading your workspace...");
                window.location.href = next;
            } else {
                setMessage("Session failed. Redirecting...");
                setTimeout(() => router.push("/login?error=auth_failed"), 2000);
            }
        } catch (err) {
            console.error("[AuthCallback] Error:", err);
            setMessage("Something went wrong. Redirecting...");
            setTimeout(() => router.push("/login?error=auth_failed"), 2000);
        }
    }

    return <InlineSkeleton message={message} />;
}
