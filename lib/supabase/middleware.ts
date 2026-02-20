import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
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

    // TEMPORARY BYPASS: Since we are using a mock Supabase URL for UI testing,
    // making a network request to verify the session will hang indefinitely.
    /*
    const {
        data: { user },
    } = await supabase.auth.getUser()
    */
    const user = null;

    const isAuthRoute = request.nextUrl.pathname.startsWith('/login') ||
        request.nextUrl.pathname.startsWith('/signup');
    const isDashboardRoute = request.nextUrl.pathname.startsWith('/dashboard');

    if (!user && isDashboardRoute) {
        // Unauthenticated user trying to access dashboard -> redirect to login
        const url = request.nextUrl.clone()
        url.pathname = '/login'
        return NextResponse.redirect(url)
    }

    if (user && isAuthRoute) {
        // Authenticated user trying to access login/signup -> redirect to dashboard
        const url = request.nextUrl.clone()
        url.pathname = '/dashboard/home'
        // Preserve any search params like phone if they exist, to prevent loss, but usually not needed when redirecting away from auth
        return NextResponse.redirect(url)
    }

    return supabaseResponse
}
