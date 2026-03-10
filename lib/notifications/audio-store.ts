/**
 * In-memory audio store for pre-generated call audio.
 *
 * Stores MP3 buffers keyed by UUID with a short TTL.
 * Serving from Railway's own process gives Twilio ~100ms TTFB (vs 3s+ from Supabase CDN).
 * Twilio streams MP3 progressively, so audio starts playing within ~300ms of call connect.
 *
 * Server-side only — never import on the client.
 */

interface AudioEntry {
    buffer: Buffer
    expires: number
}

// Module-level store — persists across requests on Railway's persistent Node.js process
const store = new Map<string, AudioEntry>()

const TTL_MS = 5 * 60 * 1000 // 5 minutes — more than enough for a call to connect

export function storeAudio(id: string, buffer: Buffer): void {
    store.set(id, { buffer, expires: Date.now() + TTL_MS })
}

export function getAudio(id: string): Buffer | null {
    const entry = store.get(id)
    if (!entry) return null
    if (entry.expires < Date.now()) {
        store.delete(id)
        return null
    }
    return entry.buffer
}

export function deleteAudio(id: string): void {
    store.delete(id)
}
