import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Routes that require authentication (dashboard pages via (dashboard) route group)
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

// Routes that authenticated users should NOT see (they get redirected to /home)
// NOTE: Only exact matches — sub-routes like /signup/verify and /signup/profile
// are needed DURING the signup flow (user is authenticated but has no profile yet).
const authRoutes = ['/login', '/signup']

// Sub-routes that authenticated users ARE allowed to visit during signup
const signupFlowRoutes = ['/signup/verify', '/signup/profile']

export async function middleware(request: NextRequest) {
    let supabaseResponse = NextResponse.next({
        request,
    })

    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() {
                    return request.cookies.getAll()
                },
                setAll(cookiesToSet) {
                    cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
                    supabaseResponse = NextResponse.next({
                        request,
                    })
                    cookiesToSet.forEach(({ name, value, options }) =>
                        supabaseResponse.cookies.set(name, value, options)
                    )
                },
            },
        }
    )

    // Only validate auth session — NO database queries here.
    // Profile resolution happens in the dashboard layout (resolveCurrentUser).
    const {
        data: { user },
    } = await supabase.auth.getUser()

    const { pathname } = request.nextUrl

    // Protect dashboard routes — redirect unauthenticated users to login
    const isProtectedRoute = protectedRoutes.some(
        (route) => pathname === route || pathname.startsWith(route + '/')
    )

    // SCENARIO 1: Unauthenticated trying to access protected -> Login
    if (isProtectedRoute && !user) {
        const url = request.nextUrl.clone()
        url.pathname = '/login'
        const redirectResponse = NextResponse.redirect(url)
        supabaseResponse.cookies.getAll().forEach((cookie) => {
            redirectResponse.cookies.set(cookie.name, cookie.value)
        })
        return redirectResponse
    }

    // Allow authenticated users to stay on signup sub-routes (verify, profile)
    // They need these pages to complete the signup flow after OTP verification.
    const isSignupFlowRoute = signupFlowRoutes.some(
        (route) => pathname === route || pathname.startsWith(route + '/')
    )

    // SCENARIO 2: Authenticated -> Redirect away from auth routes to Home
    // But NOT if they are on a signup flow sub-route (verify/profile)
    const isAuthRoute = !isSignupFlowRoute && authRoutes.some(
        (route) => pathname === route || pathname.startsWith(route + '/')
    )

    if (user && (isAuthRoute || pathname === '/')) {
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
