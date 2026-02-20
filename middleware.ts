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

    if (isProtectedRoute && !user) {
        const url = request.nextUrl.clone()
        url.pathname = '/login'
        return NextResponse.redirect(url)
    }

    // Redirect authenticated users away from auth pages and landing to dashboard
    const isAuthRoute = authRoutes.some(
        (route) => pathname === route || pathname.startsWith(route + '/')
    )

    if (user && (isAuthRoute || pathname === '/')) {
        const url = request.nextUrl.clone()
        url.pathname = '/home'
        return NextResponse.redirect(url)
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
