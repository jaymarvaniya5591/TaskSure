import { NextRequest, NextResponse } from 'next/server'
import { verifyAuthToken, consumeAuthToken } from '@/lib/auth-links'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * GET /api/auth/verify-link?token=xxx
 *
 * Validates the auth token and redirects:
 * - signin token → creates/finds Supabase auth user, sets session, redirects to /home
 * - signup token → redirects to /signup/complete?token=xxx
 * - invalid/expired → redirects to /login?error=expired
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
        // Consume the token immediately
        const consumed = await consumeAuthToken(token)
        if (!consumed) {
            return NextResponse.redirect(`${baseUrl}/login?error=expired`)
        }

        // Create or find auth user, generate session
        const supabase = createAdminClient()
        const phone = result.phone  // already 10 digits from auth_tokens
        const testEmail = `test_${phone}@boldo.test`

        try {
            // Find existing auth user by phone or email
            let authUserId: string | null = null
            const { data: existingUsers } = await supabase.auth.admin.listUsers()
            if (existingUsers?.users) {
                const user = existingUsers.users.find(
                    (u) => u.phone === phone || u.email === testEmail
                )
                if (user) authUserId = user.id
            }

            if (!authUserId) {
                // This shouldn't happen for signin (user should exist), but handle gracefully
                return NextResponse.redirect(`${baseUrl}/login?error=no_account`)
            }

            // Ensure email exists for magic link generation
            await supabase.auth.admin.updateUserById(authUserId, {
                email: testEmail,
                email_confirm: true,
                phone_confirm: true,
            })

            // Generate a magic link and exchange for session
            const { data: linkData, error: linkError } =
                await supabase.auth.admin.generateLink({
                    type: 'magiclink',
                    email: testEmail,
                })

            if (linkError || !linkData) {
                console.error('[VerifyLink] Failed to generate magic link:', linkError)
                return NextResponse.redirect(`${baseUrl}/login?error=auth_failed`)
            }

            const tokenHash = linkData.properties?.hashed_token
            if (!tokenHash) {
                return NextResponse.redirect(`${baseUrl}/login?error=auth_failed`)
            }

            // Build redirect URL that the client will use to set the session
            // We redirect to a client page that handles session setup
            return NextResponse.redirect(
                `${baseUrl}/auth/callback?token_hash=${encodeURIComponent(tokenHash)}&type=magiclink&next=/home`
            )
        } catch (err) {
            console.error('[VerifyLink] Error creating session:', err)
            return NextResponse.redirect(`${baseUrl}/login?error=auth_failed`)
        }
    }

    return NextResponse.redirect(`${baseUrl}/login?error=invalid`)
}
