"use client";

/**
 * /auth/callback — Instant skeleton + background auth processing.
 *
 * ENTRY POINTS:
 *   1. ?verify_token=xxx — From WhatsApp sign-in link (direct, no API hop).
 *      Shows skeleton immediately, calls API via fetch() for session creation.
 *   2. ?token_hash=xxx — Legacy Supabase magic link fallback.
 *
 * The skeleton is baked into static HTML at build time — visible before JS loads.
 * Auth processing happens in background JS while user sees the skeleton.
 *
 * PERFORMANCE: WhatsApp links now point directly here (not to /api/auth/verify-link),
 * eliminating one full network round trip. CDN → HTML in < 200ms.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Auth skeleton — matches the project's design language:
 * dotted background, black text, bold typography, clean minimalism.
 * Uses ONLY inline styles — renders before any CSS/JS loads.
 */
function AuthSkeleton({ message }: { message: string }) {
    return (
        <div style={{
            position: 'fixed',
            inset: 0,
            background: '#fdfdfd',
            backgroundImage: 'radial-gradient(circle, #b0b0bc 1.2px, transparent 1.2px)',
            backgroundSize: '18px 18px',
            display: 'flex',
            flexDirection: 'column' as const,
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            zIndex: 9999,
        }}>
            <style dangerouslySetInnerHTML={{
                __html: `
                @keyframes auth-spin {
                    to { transform: rotate(360deg); }
                }
                @keyframes auth-fade-in {
                    from { opacity: 0; transform: translateY(8px); }
                    to { opacity: 1; transform: translateY(0); }
                }
            `}} />

            {/* Main card */}
            <div style={{
                background: 'rgba(255, 255, 255, 0.85)',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                borderRadius: 24,
                padding: '48px 40px',
                maxWidth: 380,
                width: '90%',
                textAlign: 'center' as const,
                boxShadow: '0 4px 24px rgba(0,0,0,0.06), 0 1px 4px rgba(0,0,0,0.04)',
                border: '1px solid rgba(0,0,0,0.06)',
                animation: 'auth-fade-in 0.3s ease-out',
            }}>
                {/* Logo / Brand */}
                <div style={{
                    fontSize: 28,
                    fontWeight: 800,
                    color: '#000',
                    letterSpacing: '-0.5px',
                    marginBottom: 32,
                }}>
                    Boldo
                </div>

                {/* Spinner */}
                <div style={{
                    width: 44,
                    height: 44,
                    border: '4px solid #e5e7eb',
                    borderTopColor: '#000',
                    borderRadius: '50%',
                    animation: 'auth-spin 0.7s linear infinite',
                    margin: '0 auto 24px',
                }} />

                {/* Status message */}
                <p style={{
                    color: '#000',
                    fontSize: 18,
                    fontWeight: 600,
                    margin: '0 0 8px',
                    letterSpacing: '-0.3px',
                }}>{message}</p>

                <p style={{
                    color: '#6b7280',
                    fontSize: 14,
                    fontWeight: 400,
                    margin: 0,
                    lineHeight: 1.4,
                }}>This will only take a moment</p>
            </div>
        </div>
    );
}

export default function AuthCallbackPage() {
    const router = useRouter();
    const supabase = createClient();
    const [message, setMessage] = useState("Signing you in...");

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);

        // ─── Flow 1: verify_token (WhatsApp sign-in link, direct) ───
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
        setMessage("Missing token");
        setTimeout(() => router.push("/login?error=missing_token"), 2000);
    }, []);

    /** Call /api/auth/verify-link with _api=1 for server-side auth processing */
    async function handleVerifyToken(token: string) {
        try {
            const res = await fetch(`/api/auth/verify-link?token=${encodeURIComponent(token)}&_api=1`, {
                credentials: 'include',
            });

            if (!res.ok) {
                setMessage("Authentication failed");
                setTimeout(() => router.push("/login?error=auth_failed"), 2000);
                return;
            }

            const data = await res.json();

            if (data.redirect) {
                setMessage("You're in!");
                window.location.href = data.redirect;
            } else {
                setMessage("Something went wrong");
                setTimeout(() => router.push("/login?error=auth_failed"), 2000);
            }
        } catch (err) {
            console.error("[AuthCallback] verify-link API error:", err);
            setMessage("Connection error");
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
                console.error("[AuthCallback] Magic link failed:", verifyErr);
                setMessage("Link expired");
                setTimeout(() => router.push("/login?error=auth_failed"), 2000);
                return;
            }

            if (data.session) {
                setMessage("You're in!");
                window.location.href = next;
            } else {
                setMessage("Session failed");
                setTimeout(() => router.push("/login?error=auth_failed"), 2000);
            }
        } catch (err) {
            console.error("[AuthCallback] Error:", err);
            setMessage("Something went wrong");
            setTimeout(() => router.push("/login?error=auth_failed"), 2000);
        }
    }

    return <AuthSkeleton message={message} />;
}
