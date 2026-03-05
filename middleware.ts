import { NextResponse, type NextRequest } from 'next/server'

/**
 * Middleware — Ultralight route guard. Zero network calls. ~1ms.
 *
 * WHAT IT DOES:
 *   Checks if a Supabase auth cookie exists (synchronous cookie scan).
 *   Handles both single and chunked cookie formats:
 *     - sb-<ref>-auth-token       (single cookie)
 *     - sb-<ref>-auth-token.0/1/2 (chunked cookies)
 *
 * WHAT IT DOESN'T DO:
 *   - No Supabase client creation (saves 74.5 KB → 27 KB bundle)
 *   - No getUser() network call (was 2-5s)
 *   - No getSession() call (was creating full client)
 *
 * SESSION REFRESH:
 *   Handled client-side by useAuth.ts. The browser's Supabase client
 *   automatically refreshes expired access tokens using the refresh token
 *   and writes new cookies.
 *
 * TRADEOFF:
 *   If someone has an expired cookie but valid refresh token, they briefly
 *   see the skeleton while the client refreshes. Affects <1% of pageviews
 *   and resolves in ~200ms. Worth it for <0.5s TTFB.
 */

// Routes that authenticated users should NOT see
const authRoutes = ['/login', '/signup']

export function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl

    // Check for Supabase auth cookie — handles BOTH formats:
    //   sb-<ref>-auth-token       (single cookie)
    //   sb-<ref>-auth-token.0     (chunked cookie piece 0)
    //   sb-<ref>-auth-token.1     (chunked cookie piece 1)
    const hasAuthCookie = request.cookies.getAll().some(
        (cookie) => cookie.name.startsWith('sb-') && cookie.name.includes('-auth-token')
    )

    // OPTIMISTIC EDGE CACHING:
    // We intentionally DO NOT check protected routes here.
    // By bypassing auth at the edge, Vercel can instantly serve the static 
    // HTML skeleton from the Edge CDN cache (TTFB < 50ms, 0 cold starts).
    // The client-side wrapper (useAuth.tsx) handles kicking unauthenticated users to /login.

    // Auth route + has cookie → redirect to home (already logged in)
    const isAuthRoute = authRoutes.some((route) => pathname === route)

    if (hasAuthCookie && (isAuthRoute || pathname === '/')) {
        const url = request.nextUrl.clone()
        url.pathname = '/home'
        return NextResponse.redirect(url)
    }

    return NextResponse.next()
}

// Pin middleware to Singapore (same region as Supabase ap-southeast-1)
// REMOVED: Since the middleware no longer makes network calls (synchronous cookie check),
// it should run as close to the user as possible to avoid cross-region hop latency.

export const config = {
    matcher: [
        '/((?!_next/static|_next/image|favicon.ico|api/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
    ],
}
