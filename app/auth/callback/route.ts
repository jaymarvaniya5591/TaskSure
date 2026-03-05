import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse, type NextRequest } from 'next/server'

export const runtime = 'edge'
export const preferredRegion = 'sin1'

/**
 * /auth/callback — Server-side magic link token exchange.
 *
 * PERFORMANCE: This replaces the old client-side page.tsx which required
 * 144 KB of JS to download before it could exchange the token.
 *
 * OLD FLOW (client-side):
 *   Click link → download 144KB JS (1-2s) → hydrate → verifyOtp via proxy (500ms-1s)
 *   → window.location.href redirect → /home loads
 *   Total: 3-4s before /home starts loading
 *
 * NEW FLOW (server-side):
 *   Click link → Edge function exchanges token server-to-server (200-400ms)
 *   → 302 redirect → /home loads with inline skeleton immediately
 *   Total: ~0.5s before /home starts loading
 *
 * The token exchange happens server-to-server (Edge → Supabase, same region),
 * bypassing the client JS download AND the Supabase proxy entirely.
 */
export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url)
    const tokenHash = searchParams.get('token_hash')
    const type = searchParams.get('type') || 'magiclink'
    const next = searchParams.get('next') || '/home'

    const errorUrl = new URL('/login?error=auth_failed', request.url)

    if (!tokenHash) {
        return NextResponse.redirect(new URL('/login?error=missing_token', request.url))
    }

    // Create Supabase server client with cookie handling
    const cookieStore = await cookies()

    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() {
                    return cookieStore.getAll()
                },
                setAll(cookiesToSet) {
                    try {
                        cookiesToSet.forEach(({ name, value, options }) =>
                            cookieStore.set(name, value, options)
                        )
                    } catch {
                        // Edge case: may fail in certain server contexts
                    }
                },
            },
        }
    )

    try {
        const { error } = await supabase.auth.verifyOtp({
            type: type as 'magiclink',
            token_hash: tokenHash,
        })

        if (error) {
            console.error('[AuthCallback] Token exchange failed:', error.message)
            return NextResponse.redirect(errorUrl)
        }

        // Success — redirect to the target page
        // Cookies are automatically included in the response via setAll
        return NextResponse.redirect(new URL(next, request.url))
    } catch (err) {
        console.error('[AuthCallback] Unexpected error:', err)
        return NextResponse.redirect(errorUrl)
    }
}
