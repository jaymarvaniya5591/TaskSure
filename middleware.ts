import { NextResponse, type NextRequest } from 'next/server'

/**
 * Middleware — Lightweight route guard with ZERO network calls.
 *
 * PERFORMANCE: This middleware does NOT call supabase.auth.getUser().
 * That was a 2-5s network call to Supabase that blocked static page delivery.
 *
 * Instead, we check if the Supabase auth cookie EXISTS (synchronous, ~1ms).
 * Real session validation happens client-side via useAuth.ts hook.
 *
 * Tradeoff: Users with expired cookies briefly see the skeleton before
 * useAuth.ts redirects them to /login (~500ms). Affects <1% of users.
 */

// Routes that require authentication
const protectedRoutes = [
    '/home',
    '/my-tasks',
    '/assigned-tasks',
    '/todos',
    '/calendar',
    '/team',
    '/stats',
    '/settings',
    '/notifications',
    '/profile',
    '/tasks',
]

// Routes that authenticated users should NOT see
const authRoutes = ['/login', '/signup']

export function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl

    // Check for Supabase auth cookie — NO network call, just cookie inspection
    const hasAuthCookie = request.cookies.getAll().some(
        (cookie) => cookie.name.startsWith('sb-') && cookie.name.endsWith('-auth-token')
    )

    // Protected route + no cookie → redirect to login
    const isProtectedRoute = protectedRoutes.some(
        (route) => pathname === route || pathname.startsWith(route + '/')
    )

    if (isProtectedRoute && !hasAuthCookie) {
        const url = request.nextUrl.clone()
        url.pathname = '/login'
        return NextResponse.redirect(url)
    }

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
export const preferredRegion = 'sin1'

export const config = {
    matcher: [
        /*
         * Match all request paths except for the ones starting with:
         * - _next/static (static files)
         * - _next/image (image optimization files)
         * - favicon.ico (favicon file)
         * - api/ (API routes, they handle their own auth)
         */
        '/((?!_next/static|_next/image|favicon.ico|api/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
    ],
}
