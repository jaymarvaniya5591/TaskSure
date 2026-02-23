"use client";

/**
 * /auth/callback — handles magic link token hash exchange to set user session.
 * The verify-link API redirects here with ?token_hash=xxx&type=magiclink&next=/home
 */

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Suspense } from "react";

function CallbackContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const supabase = createClient();
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const tokenHash = searchParams.get("token_hash");
        const type = searchParams.get("type");
        const next = searchParams.get("next") || "/home";

        if (!tokenHash) {
            setError("Missing authentication token");
            return;
        }

        const exchangeToken = async () => {
            try {
                // Exchange the token hash for a session
                const { data, error: verifyErr } = await supabase.auth.verifyOtp({
                    type: (type as "magiclink") || "magiclink",
                    token_hash: tokenHash,
                });

                if (verifyErr) {
                    console.error("[AuthCallback] Token exchange failed:", verifyErr);
                    // Try password fallback — extract email from session attempt
                    setError("Authentication failed. Please try signing in again.");
                    setTimeout(() => router.push("/login?error=auth_failed"), 2000);
                    return;
                }

                if (data.session) {
                    // Hard navigate to destroy any stale state
                    window.location.href = next;
                } else {
                    setError("Session creation failed. Please try again.");
                    setTimeout(() => router.push("/login?error=auth_failed"), 2000);
                }
            } catch (err) {
                console.error("[AuthCallback] Error:", err);
                setError("Something went wrong. Redirecting...");
                setTimeout(() => router.push("/login?error=auth_failed"), 2000);
            }
        };

        exchangeToken();
    }, [searchParams, supabase, router]);

    return (
        <main className="min-h-screen flex items-center justify-center p-4 bg-background">
            <div className="text-center">
                {error ? (
                    <div>
                        <p className="text-red-500 font-medium text-lg">{error}</p>
                        <p className="text-zinc-400 mt-2">Redirecting to login...</p>
                    </div>
                ) : (
                    <div className="flex flex-col items-center gap-4">
                        <div className="w-10 h-10 border-4 border-zinc-200 border-t-yellow-500 rounded-full animate-spin" />
                        <p className="text-zinc-500 font-medium text-lg">
                            Signing you in...
                        </p>
                    </div>
                )}
            </div>
        </main>
    );
}

export default function AuthCallbackPage() {
    return (
        <Suspense
            fallback={
                <main className="min-h-screen flex items-center justify-center p-4 bg-background">
                    <div className="w-10 h-10 border-4 border-zinc-200 border-t-yellow-500 rounded-full animate-spin" />
                </main>
            }
        >
            <CallbackContent />
        </Suspense>
    );
}
