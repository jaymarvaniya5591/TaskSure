import { NextRequest, NextResponse } from 'next/server'
import { verifyAuthToken } from '@/lib/auth-links'

// Co-locate this function with Supabase (ap-southeast-1 / Singapore)
export const preferredRegion = 'sin1'

/**
 * GET /api/auth/validate-token?token=xxx
 *
 * Lightweight token validation endpoint for the signup completion form.
 * Returns { valid: boolean, phone?: string, type?: string, error?: string }
 */
export async function GET(request: NextRequest) {
    const token = request.nextUrl.searchParams.get('token')

    if (!token) {
        return NextResponse.json({ valid: false, error: 'Missing token' })
    }

    const result = await verifyAuthToken(token)

    return NextResponse.json({
        valid: result.valid,
        phone: result.phone || null,
        type: result.type || null,
        error: result.error || null,
    })
}
