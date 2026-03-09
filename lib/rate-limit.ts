/**
 * Shared in-memory rate limiter.
 *
 * Uses the same sliding-window Map pattern as the inline limiter in
 * app/api/webhook/whatsapp/route.ts, extracted here so API routes can
 * share a single implementation without duplicating logic.
 *
 * NOTE: State is per-process. On Vercel serverless, multiple warm instances
 * each maintain their own counter — this is best-effort protection consistent
 * with the webhook's existing approach, not a hard distributed guarantee.
 */

interface RateLimitEntry {
    count: number;
    resetAt: number;
}

// One Map per namespace so different routes don't share counters.
const stores = new Map<string, Map<string, RateLimitEntry>>();

/**
 * Check (and increment) a rate-limit counter.
 *
 * @param namespace  Bucket identifier, e.g. "task_create" or "task_patch"
 * @param key        Per-entity key, e.g. a user ID
 * @param max        Maximum allowed calls within the window
 * @param windowMs   Window duration in milliseconds
 * @returns true if the caller has exceeded the limit and should be blocked
 */
export function isRateLimited(
    namespace: string,
    key: string,
    max: number,
    windowMs: number
): boolean {
    let store = stores.get(namespace);
    if (!store) {
        store = new Map<string, RateLimitEntry>();
        stores.set(namespace, store);
    }

    const now = Date.now();
    const entry = store.get(key);

    if (!entry || now >= entry.resetAt) {
        store.set(key, { count: 1, resetAt: now + windowMs });
        return false;
    }

    entry.count += 1;
    return entry.count > max;
}

// Evict stale entries every 5 minutes to prevent unbounded memory growth.
// Mirrors the cleanup interval already used in the webhook.
setInterval(() => {
    const now = Date.now();
    for (const store of Array.from(stores.values())) {
        for (const [k, entry] of Array.from(store.entries())) {
            if (now >= entry.resetAt) store.delete(k);
        }
    }
}, 5 * 60_000);
