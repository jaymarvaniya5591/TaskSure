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
    mimeType: string
    expires: number
}

// Module-level store — persists across requests on Railway's persistent Node.js process
const store = new Map<string, AudioEntry>()

const TTL_MS = 5 * 60 * 1000 // 5 minutes — more than enough for a call to connect

export function storeAudio(id: string, buffer: Buffer, mimeType: string = 'audio/mpeg'): void {
    store.set(id, { buffer, mimeType, expires: Date.now() + TTL_MS })
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
