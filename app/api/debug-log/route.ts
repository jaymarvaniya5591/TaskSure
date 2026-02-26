/**
 * TEMPORARY DEBUG ENDPOINT — Remove once mobile bugs are resolved.
 *
 * Receives batched client-side debug events and logs them to the
 * Vercel runtime log (console.log) so they appear in Vercel → Logs.
 */

import { NextResponse } from "next/server";

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const entries = body?.entries;

        if (Array.isArray(entries)) {
            for (const entry of entries) {
                console.log(
                    `[MOBILE-DEBUG] ${entry.action} | device=${entry.device} | online=${entry.online} | vis=${entry.visibility} | ${entry.detail ?? ""} | ts=${entry.ts}`
                );
            }
        }

        return NextResponse.json({ ok: true });
    } catch {
        return NextResponse.json({ ok: false }, { status: 400 });
    }
}
