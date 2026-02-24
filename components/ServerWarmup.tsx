"use client";

import { useEffect } from "react";

/**
 * Invisible component that fires a background warm-up ping to /api/keep-warm
 * the moment the landing page is visited.
 *
 * Uses a RELATIVE URL so it works regardless of whether the user is on
 * boldoai.in or www.boldoai.in (avoids 307 redirect issues).
 */
export function ServerWarmup() {
    useEffect(() => {
        // Fire-and-forget — we don't care about the response
        fetch("/api/keep-warm", { method: "GET", cache: "no-store" }).catch(
            () => { /* silently ignore any errors */ }
        );
    }, []);

    return null; // renders nothing
}
