"use client";

import { useEffect } from "react";

const KEEP_WARM_URL = `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/api/keep-warm`;

/**
 * Invisible component that fires a background warm-up ping to /api/keep-warm
 * the moment the landing page is visited.
 *
 * The ~20-60s window between landing page → auth → home page is MORE than
 * enough to warm the Singapore serverless function container.
 * Zero visible impact to the user.
 */
export function ServerWarmup() {
    useEffect(() => {
        // Fire-and-forget — we don't care about the response
        fetch(KEEP_WARM_URL, { method: "GET", cache: "no-store" }).catch(
            () => { /* silently ignore any errors */ }
        );
    }, []);

    return null; // renders nothing
}
