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
 * - invalid/expired → redirects to /login?error=expired
 *
 * PERFORMANCE: Uses direct password auth instead of magic link round trip.
 * Uses findAuthUserIdByPhone() instead of listUsers() for O(1) lookups.
 */
export async function GET(request: NextRequest) {
    const token = request.nextUrl.searchParams.get('token')
    const baseUrl = request.nextUrl.origin

    if (!token) {
        return NextResponse.redirect(`${baseUrl}/login?error=missing_token`)
    }

    // 1. Verify the token
    const result = await verifyAuthToken(token)

    if (!result.valid || !result.phone || !result.type) {
        console.warn('[VerifyLink] Invalid token:', result.error)
        return NextResponse.redirect(`${baseUrl}/login?error=expired`)
    }

    // 2. Route based on token type
    if (result.type === 'signup') {
        // Don't consume yet - user needs to fill the form first
        return NextResponse.redirect(
            `${baseUrl}/signup/complete?token=${encodeURIComponent(token)}`
        )
    }

    if (result.type === 'signin') {
        // Consume token and find user in parallel — they're independent
        const [consumed, authUserId] = await Promise.all([
            consumeAuthToken(token),
            findAuthUserIdByPhone(result.phone),
        ])

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

            await supabase.auth.admin.updateUserById(authUserId, {
                email: testEmail,
                email_confirm: true,
                phone_confirm: true,
            })

            // Generate session directly via password — no magic link round trip
            const session = await generateDirectSession(phone)

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
            // Build response with session cookies
            const response = NextResponse.redirect(`${baseUrl}/home`)

            // Create a Supabase server client to properly set auth cookies
            const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
            const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

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

            // Set the session — this writes the auth cookies onto the response
            await cookieClient.auth.setSession({
                access_token: session.access_token,
                refresh_token: session.refresh_token,
            })

            return response
        } catch (err) {
            console.error('[VerifyLink] Error creating session:', err)
            return NextResponse.redirect(`${baseUrl}/login?error=auth_failed`)
        }
    }

    return NextResponse.redirect(`${baseUrl}/login?error=invalid`)
}
