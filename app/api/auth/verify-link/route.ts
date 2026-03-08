import { NextRequest, NextResponse } from 'next/server'
import { verifyAuthToken, consumeAuthToken, findAuthUserIdByPhone, generateDirectSession } from '@/lib/auth-links'
import { createAdminClient } from '@/lib/supabase/admin'
import { createServerClient } from '@supabase/ssr'

/**
 * GET /api/auth/verify-link?token=xxx
 *
 * PERFORMANCE FIX: Instead of returning a bare 302 redirect (which shows
 * a blank screen while the server processes), this route now has TWO modes:
 *
 * 1. INSTANT REDIRECT MODE (?token=xxx, no &_verified=1):
 *    - Immediately redirects to /auth/callback?token=xxx
 *    - The callback PAGE shows the skeleton instantly from CDN
 *    - The callback page then calls this API with &_verified=1
 *
 * 2. PROCESSING MODE (?token=xxx&_verified=1, called from callback page):
 *    - Does the actual token verification and session creation
 *    - Returns JSON with redirect URL
 *
 * This eliminates the blank screen because the user sees the skeleton
 * immediately while auth processing happens in the background.
 */

// Co-locate this function with Supabase (ap-southeast-1 / Singapore)
export const preferredRegion = 'sin1'

export async function GET(request: NextRequest) {
    const token = request.nextUrl.searchParams.get('token')
    const isApiCall = request.nextUrl.searchParams.get('_api') === '1'
    const baseUrl = request.nextUrl.origin
    const t0 = Date.now()

    if (!token) {
        if (isApiCall) {
            return NextResponse.json({ redirect: '/login?error=missing_token' })
        }
        return NextResponse.redirect(`${baseUrl}/login?error=missing_token`)
    }

    // If this is a direct browser navigation (clicking the WhatsApp link),
    // redirect INSTANTLY to the callback page which shows the skeleton,
    // and let the callback page call us back as an API call.
    if (!isApiCall) {
        return NextResponse.redirect(
            `${baseUrl}/auth/callback?verify_token=${encodeURIComponent(token)}`
        )
    }

    // ─── API MODE: Called from the callback page via fetch() ───

    // 1. Verify the token
    const t1 = Date.now()
    const result = await verifyAuthToken(token)
    const t2 = Date.now()
    console.log(`[VerifyLink] verifyAuthToken: ${t2 - t1}ms`)

    if (!result.valid || !result.phone || !result.type) {
        console.warn('[VerifyLink] Invalid token:', result.error)

        // FALLBACK: Token is expired/consumed, but the user may already have
        // a valid session in their browser cookies from a previous sign-in.
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
            // Return JSON with redirect + cookies
            const jsonResponse = NextResponse.json({ redirect: '/home' })
            sessionResponse.cookies.getAll().forEach((cookie) => {
                jsonResponse.cookies.set(cookie.name, cookie.value)
            })
            return jsonResponse
        }

        return NextResponse.json({ redirect: '/login?error=expired' })
    }

    // 2. Route based on token type
    if (result.type === 'signup') {
        console.log(`[VerifyLink] Signup redirect total: ${Date.now() - t0}ms`)
        return NextResponse.json({
            redirect: `/signup/complete?token=${encodeURIComponent(token)}`
        })
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
            return NextResponse.json({ redirect: '/login?error=expired' })
        }

        if (!authUserId) {
            return NextResponse.json({ redirect: '/login?error=no_account' })
        }

        try {
            // Ensure auth user has correct email for password auth
            const supabase = createAdminClient()
            const phone = result.phone
            const testEmail = `test_${phone}@boldo.test`

            const t5 = Date.now()
            const updatePromise = supabase.auth.admin.updateUserById(authUserId, {
                email: testEmail,
                email_confirm: true,
                phone_confirm: true,
            }).then(() => {
                const t6 = Date.now()
                console.log(`[VerifyLink] updateUserById: ${t6 - t5}ms`)
            }).catch(e => console.error('[VerifyLink] updateUserById failed:', e));

            updatePromise;

            // Generate session directly via password — no magic link round trip
            const t7 = Date.now()
            let session = await generateDirectSession(phone)
            const t8 = Date.now()
            console.log(`[VerifyLink] generateDirectSession (1st try): ${t8 - t7}ms`)

            if (!session) {
                console.log('[VerifyLink] 1st session attempt failed, waiting for user update and retrying...');
                await updatePromise;
                session = await generateDirectSession(phone);
                console.log(`[VerifyLink] generateDirectSession (retried): ${Date.now() - t8}ms`);
            }

            if (!session) {
                console.error('[VerifyLink] Direct session failed, falling back to magic link')
                // Fallback: use magic link approach
                const { data: linkData, error: linkError } =
                    await supabase.auth.admin.generateLink({
                        type: 'magiclink',
                        email: testEmail,
                    })

                if (linkError || !linkData?.properties?.hashed_token) {
                    return NextResponse.json({ redirect: '/login?error=auth_failed' })
                }

                return NextResponse.json({
                    redirect: `/auth/callback?token_hash=${encodeURIComponent(linkData.properties.hashed_token)}&type=magiclink&next=/home`
                })
            }

            // Set session cookies directly and return JSON redirect
            const response = NextResponse.json({ redirect: '/home' })

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
            return NextResponse.json({ redirect: '/login?error=auth_failed' })
        }
    }

    return NextResponse.json({ redirect: '/login?error=invalid' })
}
