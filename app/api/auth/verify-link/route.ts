import { NextRequest, NextResponse } from 'next/server'
import { verifyAuthToken, consumeAuthToken, findAuthUserIdByPhone, generateDirectSession } from '@/lib/auth-links'
import { createAdminClient } from '@/lib/supabase/admin'
import { createServerClient } from '@supabase/ssr'

/**
 * GET /api/auth/verify-link?token=xxx
 *
 * Validates the auth token and redirects:
 * - signin token → generates session directly, sets cookies, redirects to /home
 * - signup token → redirects to /signup/complete?token=xxx
 * - invalid/expired but session active → redirects to /home (reusable links!)
 * - invalid/expired and no session → redirects to /login?error=expired
 *
 * PERFORMANCE: Uses direct password auth instead of magic link round trip.
 * Uses findAuthUserIdByPhone() instead of listUsers() for O(1) lookups.
 * Co-located with Supabase via preferredRegion.
 */

// Co-locate this function with Supabase (ap-southeast-1 / Singapore)
export const preferredRegion = 'sin1'

export async function GET(request: NextRequest) {
    const token = request.nextUrl.searchParams.get('token')
    const baseUrl = request.nextUrl.origin
    const t0 = Date.now()

    if (!token) {
        return NextResponse.redirect(`${baseUrl}/login?error=missing_token`)
    }

    // 1. Verify the token
    const t1 = Date.now()
    const result = await verifyAuthToken(token)
    const t2 = Date.now()
    console.log(`[VerifyLink] verifyAuthToken: ${t2 - t1}ms`)

    if (!result.valid || !result.phone || !result.type) {
        console.warn('[VerifyLink] Invalid token:', result.error)

        // FALLBACK: Token is expired/consumed, but the user may already have
        // a valid session in their browser cookies from a previous sign-in.
        // This lets users re-click old WhatsApp links to access the dashboard
        // instantly without typing "sign in" again.
        // Security: signOut() clears session cookies, so old links stop working.
        let sessionResponse = NextResponse.next({ request })
        const sessionClient = createServerClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            {
                cookies: {
                    getAll() {
                        return request.cookies.getAll()
                    },
                    setAll(cookiesToSet) {
                        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
                        sessionResponse = NextResponse.next({ request })
                        cookiesToSet.forEach(({ name, value, options }) =>
                            sessionResponse.cookies.set(name, value, options)
                        )
                    },
                },
            }
        )

        const { data: { user } } = await sessionClient.auth.getUser()

        if (user) {
            console.log(`[VerifyLink] Token invalid but session active for ${user.id}, redirecting to /home (${Date.now() - t0}ms)`)
            const redirectResponse = NextResponse.redirect(`${baseUrl}/home`)
            // Carry over any refreshed session cookies
            sessionResponse.cookies.getAll().forEach((cookie) => {
                redirectResponse.cookies.set(cookie.name, cookie.value)
            })
            return redirectResponse
        }

        return NextResponse.redirect(`${baseUrl}/login?error=expired`)
    }

    // 2. Route based on token type
    if (result.type === 'signup') {
        console.log(`[VerifyLink] Signup redirect total: ${Date.now() - t0}ms`)
        return NextResponse.redirect(
            `${baseUrl}/signup/complete?token=${encodeURIComponent(token)}`
        )
    }

    if (result.type === 'signin') {
        // Consume token and find user in parallel — they're independent
        const t3 = Date.now()
        const [consumed, authUserId] = await Promise.all([
            consumeAuthToken(token),
            findAuthUserIdByPhone(result.phone),
        ])
        const t4 = Date.now()
        console.log(`[VerifyLink] parallel consume+lookup: ${t4 - t3}ms`)

        if (!consumed) {
            return NextResponse.redirect(`${baseUrl}/login?error=expired`)
        }

        if (!authUserId) {
            return NextResponse.redirect(`${baseUrl}/login?error=no_account`)
        }

        try {
            // Ensure auth user has correct email for password auth
            const supabase = createAdminClient()
            const phone = result.phone
            const testEmail = `test_${phone}@boldo.test`

            const t5 = Date.now()
            await supabase.auth.admin.updateUserById(authUserId, {
                email: testEmail,
                email_confirm: true,
                phone_confirm: true,
            })
            const t6 = Date.now()
            console.log(`[VerifyLink] updateUserById: ${t6 - t5}ms`)

            // Generate session directly via password — no magic link round trip
            const t7 = Date.now()
            const session = await generateDirectSession(phone)
            const t8 = Date.now()
            console.log(`[VerifyLink] generateDirectSession: ${t8 - t7}ms`)

            if (!session) {
                console.error('[VerifyLink] Direct session failed, falling back to magic link')
                // Fallback: use magic link approach
                const { data: linkData, error: linkError } =
                    await supabase.auth.admin.generateLink({
                        type: 'magiclink',
                        email: testEmail,
                    })

                if (linkError || !linkData?.properties?.hashed_token) {
                    return NextResponse.redirect(`${baseUrl}/login?error=auth_failed`)
                }

                return NextResponse.redirect(
                    `${baseUrl}/auth/callback?token_hash=${encodeURIComponent(linkData.properties.hashed_token)}&type=magiclink&next=/home`
                )
            }

            // Set session cookies directly and redirect to /home
            const response = NextResponse.redirect(`${baseUrl}/home`)

            const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
            const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

            const t9 = Date.now()
            const cookieClient = createServerClient(supabaseUrl, supabaseAnonKey, {
                cookies: {
                    getAll() {
                        return request.cookies.getAll()
                    },
                    setAll(cookiesToSet) {
                        cookiesToSet.forEach(({ name, value, options }) => {
                            response.cookies.set(name, value, options)
                        })
                    },
                },
            })

            await cookieClient.auth.setSession({
                access_token: session.access_token,
                refresh_token: session.refresh_token,
            })
            const t10 = Date.now()
            console.log(`[VerifyLink] setSession+cookies: ${t10 - t9}ms`)

            console.log(`[VerifyLink] TOTAL signin: ${t10 - t0}ms | region: ${process.env.VERCEL_REGION || 'local'}`)
            return response
        } catch (err) {
            console.error('[VerifyLink] Error creating session:', err)
            return NextResponse.redirect(`${baseUrl}/login?error=auth_failed`)
        }
    }

    return NextResponse.redirect(`${baseUrl}/login?error=invalid`)
}
