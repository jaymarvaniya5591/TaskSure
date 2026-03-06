"use client";

/**
 * MagicLinkHandler — Thin client component for the magic link fallback flow.
 * 
 * This is dynamically imported (next/dynamic) by the auth callback page,
 * so the Supabase SDK is NOT included in the initial page bundle.
 * Only loaded when ?token_hash is present in the URL.
 *
 * AUTH LOGIC: Identical to the original handleMagicLink function.
 * Same supabase.auth.verifyOtp() call, same error handling, same redirects.
 */

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

export default function MagicLinkHandler({
    tokenHash,
    type,
    next,
}: {
    tokenHash: string;
    type: string;
    next: string;
}) {
    const supabase = createClient();

    useEffect(() => {
        const s = document.getElementById("auth-status");

        async function handleMagicLink() {
            try {
                const { data, error: verifyErr } = await supabase.auth.verifyOtp({
                    type: (type as "magiclink") || "magiclink",
                    token_hash: tokenHash,
                });

                if (verifyErr) {
                    console.error("[AuthCallback] Magic link failed:", verifyErr);
                    if (s) s.textContent = "Link expired";
                    setTimeout(() => { location.href = "/login?error=auth_failed"; }, 2000);
                    return;
                }

                if (data.session) {
                    if (s) s.textContent = "You're in!";
                    location.href = next;
                } else {
                    if (s) s.textContent = "Session failed";
                    setTimeout(() => { location.href = "/login?error=auth_failed"; }, 2000);
                }
            } catch (err) {
                console.error("[AuthCallback] Error:", err);
                if (s) s.textContent = "Something went wrong";
                setTimeout(() => { location.href = "/login?error=auth_failed"; }, 2000);
            }
        }

        handleMagicLink();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return null;
}
