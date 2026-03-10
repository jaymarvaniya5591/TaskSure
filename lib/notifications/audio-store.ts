/**
 * In-memory audio store for pre-generated call audio.
 *
 * Stores MP3/WAV buffers keyed by UUID with a TTL.
 * Serving from Railway's own process gives Twilio ~100ms TTFB (vs 3s+ from Supabase CDN).
 *
 * Server-side only — never import on the client.
 */

interface AudioEntry {
    buffer: Buffer
    mimeType: string
    expires: number
}

// Module-level store — persists across requests on Railway's persistent Node.js process
const store = new Map<string, AudioEntry>()

const TTL_MS = 10 * 60 * 1000 // 10 minutes — generous for slow Twilio connections

export function storeAudio(id: string, buffer: Buffer, mimeType: string = 'audio/mpeg'): void {
    store.set(id, { buffer, mimeType, expires: Date.now() + TTL_MS })
    // Sweep expired entries periodically (every store call, cheap O(n) scan)
    if (store.size > 10) sweepExpired()
}

export function getAudio(id: string): { buffer: Buffer; mimeType: string } | null {
    const entry = store.get(id)
    if (!entry) return null
    if (entry.expires < Date.now()) {
        store.delete(id)
        return null
    }
    return { buffer: entry.buffer, mimeType: entry.mimeType }
}

export function deleteAudio(id: string): void {
    store.delete(id)
}

/** Remove all expired entries to prevent memory leaks */
function sweepExpired(): void {
    const now = Date.now()
    store.forEach((entry, id) => {
        if (entry.expires < now) store.delete(id)
    })
}
