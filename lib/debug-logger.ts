/**
 * TEMPORARY DEBUG LOGGER — Remove once mobile bugs are resolved.
 *
 * Captures detailed client-side diagnostics and sends them to the
 * Vercel runtime log via a POST to /api/debug-log so we can see exactly
 * what happens on mobile devices.
 *
 * Every log line includes: device, browser, timestamp, online status,
 * visibility state, and the custom message.
 */

interface DebugEntry {
    ts: string;             // ISO timestamp
    device: string;         // e.g. "Android / Chrome 145"
    online: boolean;        // navigator.onLine
    visibility: string;     // document.visibilityState
    action: string;         // e.g. "REFRESH_START"
    detail?: string;        // free-form context
}

function getDeviceInfo(): string {
    if (typeof navigator === "undefined") return "server";
    const ua = navigator.userAgent;
    const isMobile = /Mobi|Android|iPhone|iPad/i.test(ua);
    const browserMatch = ua.match(/(Chrome|Firefox|Safari|Edge|OPR|SamsungBrowser|UCBrowser|Comet|WhatsApp)\/(\d+)/);
    const browser = browserMatch ? `${browserMatch[1]} ${browserMatch[2]}` : "Unknown";
    const platform = isMobile
        ? (/iPhone|iPad/.test(ua) ? "iOS" : "Android")
        : "Desktop";
    return `${platform} / ${browser}`;
}

const LOG_BUFFER: DebugEntry[] = [];
let flushScheduled = false;

function scheduleFlush() {
    if (flushScheduled) return;
    flushScheduled = true;
    // Batch logs — flush every 2 seconds or when buffer hits 10 entries
    setTimeout(flush, 2000);
}

async function flush() {
    flushScheduled = false;
    if (LOG_BUFFER.length === 0) return;
    const entries = LOG_BUFFER.splice(0);
    try {
        await fetch("/api/debug-log", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ entries }),
        });
    } catch {
        // Silently fail — don't break the app for logging
    }
}

/**
 * Log a debug event. This is cheap to call — entries are batched.
 */
export function debugLog(action: string, detail?: string) {
    if (typeof window === "undefined") return;

    const entry: DebugEntry = {
        ts: new Date().toISOString(),
        device: getDeviceInfo(),
        online: navigator.onLine,
        visibility: document.visibilityState,
        action,
        detail,
    };

    // Always log to console for immediate DevTools access
    console.log(`[DEBUG] ${action}`, detail ?? "", {
        online: entry.online,
        visibility: entry.visibility,
        device: entry.device,
    });

    LOG_BUFFER.push(entry);
    if (LOG_BUFFER.length >= 10) {
        flush();
    } else {
        scheduleFlush();
    }
}

/**
 * Run a quick Supabase connectivity smoke-test from the browser.
 * Logs the result so we can see if the client can actually reach Supabase.
 */
export async function debugTestSupabaseConnectivity() {
    if (typeof window === "undefined") return;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
        debugLog("SUPABASE_CONNECTIVITY_TEST", "SKIP — missing env vars");
        return;
    }

    const start = Date.now();
    try {
        // Simple health check — fetch the auth user (requires valid session)
        const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
            headers: {
                "apikey": supabaseKey,
                "Authorization": `Bearer ${document.cookie.match(/sb-[^-]+-auth-token\.0=([^;]+)/)?.[1] ?? "no-token"}`,
            },
            signal: AbortSignal.timeout(5000),
        });
        const elapsed = Date.now() - start;
        debugLog("SUPABASE_CONNECTIVITY_TEST", `status=${res.status} elapsed=${elapsed}ms`);
    } catch (err) {
        const elapsed = Date.now() - start;
        debugLog("SUPABASE_CONNECTIVITY_TEST", `FAILED elapsed=${elapsed}ms err=${err instanceof Error ? err.message : String(err)}`);
    }
}
