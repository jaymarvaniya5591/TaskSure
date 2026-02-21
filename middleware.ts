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
]

// Routes that authenticated users should NOT see (they get redirected to /home)
const authRoutes = ['/login', '/signup']

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

    const {
        data: { user },
    } = await supabase.auth.getUser()

    const { pathname } = request.nextUrl

    // Protect dashboard routes — redirect unauthenticated users to login
    const isProtectedRoute = protectedRoutes.some(
        (route) => pathname === route || pathname.startsWith(route + '/')
    )

    // Check if the user is authenticated but missing a public profile 
    // We do a lightweight check via the client we just created
    let profileExists = false;
    let authUserPhone = user?.phone || "";

    if (user) {
        // Try to get phone from test email if it's a test user
        if (!user.phone && user.email) {
            const match = user.email.match(/test_(\d+)@/);
            if (match) authUserPhone = `+${match[1]}`;
        }

        const { data: profile } = await supabase
            .from('users')
            .select('id')
            .eq('id', user.id)
            .single()

        profileExists = !!profile;

        // Secondary check by phone just in case (like our resolveCurrentUser logic)
        if (!profileExists && authUserPhone) {
            const { data: profileByPhone } = await supabase
                .from('users')
                .select('id')
                .eq('phone_number', authUserPhone)
                .single()

            profileExists = !!profileByPhone;
        }
    }

    // SCENARIO 1: Authenticated, NO PROFILE -> MUST go to /signup/profile
    if (user && !profileExists && pathname !== '/signup/profile') {
        const url = request.nextUrl.clone()
        url.pathname = '/signup/profile'
        if (authUserPhone) url.searchParams.set('phone', authUserPhone);

        const redirectResponse = NextResponse.redirect(url)
        supabaseResponse.cookies.getAll().forEach((cookie) => {
            redirectResponse.cookies.set(cookie.name, cookie.value)
        })
        return redirectResponse
    }

    // SCENARIO 2: Unauthenticated trying to access protected -> Login
    if (isProtectedRoute && !user) {
        const url = request.nextUrl.clone()
        url.pathname = '/login'
        const redirectResponse = NextResponse.redirect(url)
        supabaseResponse.cookies.getAll().forEach((cookie) => {
            redirectResponse.cookies.set(cookie.name, cookie.value)
        })
        return redirectResponse
    }

    // SCENARIO 3: Authenticated AND Has Profile -> Redirect away from auth routes to Home
    const isAuthRoute = authRoutes.some(
        (route) => pathname === route || pathname.startsWith(route + '/')
    )

    if (user && profileExists && (isAuthRoute || pathname === '/')) {
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
         * Feel free to modify this pattern to include more paths.
         */
        '/((?!_next/static|_next/image|favicon.ico|api/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
    ],
}
