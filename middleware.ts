import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * Middleware — Session-aware route guard using getSession().
 *
 * PERFORMANCE: Uses getSession() NOT getUser().
 *   - getSession() reads from cookies only — no external network call (~1ms)
 *   - Also handles token refresh if the access token expired (uses refresh token)
 *   - Writes refreshed cookies back to the response
 *
 * The old middleware used getUser() which made a 2-5s network call to
 * Supabase Auth API on EVERY request, blocking static page delivery.
 *
 * getUser() validates the token server-side (secure but slow).
 * getSession() reads the JWT from cookies (fast, handles refresh).
 * Real validation happens client-side in useAuth.ts.
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

// Routes accessible by everyone
const openRoutes = ['/signup/complete', '/auth/callback', '/join-request']

export async function middleware(request: NextRequest) {
    let supabaseResponse = NextResponse.next({ request })

    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() {
                    return request.cookies.getAll()
                },
                setAll(cookiesToSet) {
                    // Forward cookies to the request (for downstream server components)
                    cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
                    supabaseResponse = NextResponse.next({ request })
                    // Write refreshed cookies to the response (sent back to browser)
                    cookiesToSet.forEach(({ name, value, options }) =>
                        supabaseResponse.cookies.set(name, value, options)
                    )
                },
            },
        }
    )

    // getSession() reads JWT from cookies — NO network call.
    // If the access token is expired, it uses the refresh token to get a new one.
    // This is fast (~1-5ms) unlike getUser() which validates server-side (2-5s).
    const { data: { session } } = await supabase.auth.getSession()

    const { pathname } = request.nextUrl

    // Allow open routes for everyone
    const isOpenRoute = openRoutes.some(
        (route) => pathname === route || pathname.startsWith(route + '/')
    )
    if (isOpenRoute) {
        return supabaseResponse
    }

    // Protected route + no session → redirect to login
    const isProtectedRoute = protectedRoutes.some(
        (route) => pathname === route || pathname.startsWith(route + '/')
    )

    if (isProtectedRoute && !session) {
        const url = request.nextUrl.clone()
        url.pathname = '/login'
        const redirectResponse = NextResponse.redirect(url)
        // Carry over any cookie updates from the session refresh attempt
        supabaseResponse.cookies.getAll().forEach((cookie) => {
            redirectResponse.cookies.set(cookie.name, cookie.value)
        })
        return redirectResponse
    }

    // Auth route + has session → redirect to home
    const isAuthRoute = authRoutes.some((route) => pathname === route)

    if (session && (isAuthRoute || pathname === '/')) {
        const url = request.nextUrl.clone()
        url.pathname = '/home'
        const redirectResponse = NextResponse.redirect(url)
        supabaseResponse.cookies.getAll().forEach((cookie) => {
            redirectResponse.cookies.set(cookie.name, cookie.value)
        })
        return redirectResponse
    }

    return supabaseResponse
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
