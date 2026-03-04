/**
 * TEMPORARY DEBUG ENDPOINT — Remove once mobile bugs are resolved.
 *
 * POST: Receives batched client-side debug events, logs them, and stores them.
 * GET:  Returns all stored debug events (last 200) for inspection.
 */

import { NextResponse } from "next/server";

export const preferredRegion = 'sin1';

// In-memory ring buffer (survives within a single serverless invocation)
// For cross-invocation persistence we'll also log to console
const MAX_EVENTS = 200;
const eventBuffer: unknown[] = [];

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const entries = body?.entries;

        if (Array.isArray(entries)) {
            for (const entry of entries) {
                const logLine = `[MOBILE-DEBUG] ${entry.action} | device=${entry.device} | online=${entry.online} | vis=${entry.visibility} | ${entry.detail ?? ""} | ts=${entry.ts}`;
                console.log(logLine);
                eventBuffer.push({ ...entry, _serverTs: new Date().toISOString() });
                if (eventBuffer.length > MAX_EVENTS) eventBuffer.shift();
            }
        }

        return NextResponse.json({ ok: true, stored: eventBuffer.length });
    } catch {
        return NextResponse.json({ ok: false }, { status: 400 });
    }
}

export async function GET() {
    return NextResponse.json({
        count: eventBuffer.length,
        events: eventBuffer,
        note: "Events only persist within a single serverless invocation. Check console.log in Vercel Logs for cross-invocation data.",
    });
}
