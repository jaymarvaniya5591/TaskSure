"use client";

/**
 * MagicLinkLoader — Tiny client component that checks for token_hash
 * and dynamically mounts MagicLinkHandler only when needed.
 *
 * This is the ONLY client component on the auth callback page.
 * It renders null immediately (no UI blocking) and only loads the
 * Supabase SDK when token_hash is present in the URL.
 */

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";

const MagicLinkHandler = dynamic(() => import("./MagicLinkHandler"), {
    ssr: false,
    loading: () => null,
});

export default function MagicLinkLoader() {
    const [params, setParams] = useState<{
        tokenHash: string;
        type: string;
        next: string;
    } | null>(null);

    useEffect(() => {
        const sp = new URLSearchParams(window.location.search);
        const h = sp.get("token_hash");
        if (h) {
            setParams({
                tokenHash: h,
                type: sp.get("type") || "magiclink",
                next: sp.get("next") || "/home",
            });
        }
    }, []);

    if (!params) return null;

    return (
        <MagicLinkHandler
            tokenHash={params.tokenHash}
            type={params.type}
            next={params.next}
        />
    );
}
