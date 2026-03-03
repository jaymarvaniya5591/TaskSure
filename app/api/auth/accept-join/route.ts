import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { findAuthUserIdByPhone } from '@/lib/auth-links'
import { sendJoinRequestApprovedTemplate } from '@/lib/whatsapp'
import { normalizePhone } from '@/lib/phone'

// Co-locate this function with Supabase (ap-southeast-1 / Singapore)
export const preferredRegion = 'sin1'

/**
 * POST /api/auth/accept-join
 *
 * Accepts or rejects a partner join request.
 * Only the partner (identified by phone) can accept.
 *
 * PERFORMANCE: Uses findAuthUserIdByPhone() instead of listUsers().
 *
 * Body: { requestId: string, action: 'accept' | 'reject', acceptorPhone: string }
 */
export async function POST(request: NextRequest) {
    let body: {
        requestId?: string
        action?: 'accept' | 'reject'
        acceptorPhone?: string
    }

    try {
        body = await request.json()
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const { requestId, action, acceptorPhone } = body

    if (!requestId || !action || !['accept', 'reject'].includes(action)) {
        return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }

    const supabase = createAdminClient()

    try {
        // Fetch the join request
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: joinReq, error: fetchErr } = await (supabase as any)
            .from('join_requests')
            .select('*')
            .eq('id', requestId)
            .eq('status', 'pending')
            .single()

        if (fetchErr || !joinReq) {
            return NextResponse.json(
                { error: 'Join request not found or already processed' },
                { status: 404 }
            )
        }

        // Verify the acceptor is the partner
        if (acceptorPhone && joinReq.partner_phone !== acceptorPhone) {
            return NextResponse.json(
                { error: 'You are not authorized to act on this request' },
                { status: 403 }
            )
        }

        if (action === 'reject') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (supabase as any)
                .from('join_requests')
                .update({ status: 'rejected', updated_at: new Date().toISOString() })
                .eq('id', requestId)

            return NextResponse.json({ status: 'rejected' })
        }

        // ─── Accept: create account for the requester ────────────────────

        // Get partner's org info
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: partner } = await (supabase as any)
            .from('users')
            .select('id, organisation_id')
            .eq('phone_number', joinReq.partner_phone)
            .single()

        if (!partner) {
            return NextResponse.json(
                { error: 'Partner user not found in system' },
                { status: 500 }
            )
        }

        // Fast lookup: check if auth user already exists via users table
        const normalizedRequesterPhone = normalizePhone(joinReq.requester_phone)
        const testEmail = `test_${normalizedRequesterPhone}@boldo.test`

        let authUserId = await findAuthUserIdByPhone(joinReq.requester_phone)

        if (!authUserId) {
            const { data: newUser, error: createErr } =
                await supabase.auth.admin.createUser({
                    phone: normalizedRequesterPhone,
                    email: testEmail,
                    email_confirm: true,
                    phone_confirm: true,
                    password: 'TestPassword123!',
                })

            if (createErr) {
                if (!createErr.message.includes('already registered') && !createErr.message.includes('already been registered')) {
                    console.error('[AcceptJoin] Failed to create auth user:', createErr)
                    return NextResponse.json(
                        { error: 'Failed to create account' },
                        { status: 500 }
                    )
                }

                // FALLBACK: User exists in Auth but not in public.users table.
                // Fetch their Auth ID securely via password sign in.
                try {
                    const { createClient } = await import('@supabase/supabase-js')
                    const sessionClient = createClient(
                        process.env.NEXT_PUBLIC_SUPABASE_URL!,
                        process.env.SUPABASE_SERVICE_ROLE_KEY!,
                        { auth: { autoRefreshToken: false, persistSession: false } }
                    )

                    const { data: signInData } = await sessionClient.auth.signInWithPassword({
                        email: testEmail,
                        password: 'TestPassword123!',
                    })

                    if (signInData?.user) {
                        authUserId = signInData.user.id
                    } else {
                        throw new Error('Fallback sign-in returned no user')
                    }
                } catch (fallbackErr) {
                    console.error('[AcceptJoin] Fallback sign-in failed:', fallbackErr)
                    return NextResponse.json({ error: 'Failed to resolve existing account' }, { status: 500 })
                }
            } else if (newUser?.user) {
                authUserId = newUser.user.id
            }
        }

        if (!authUserId) {
            return NextResponse.json(
                { error: 'Failed to create auth user' },
                { status: 500 }
            )
        }

        // Parse requester name into first/last
        const nameParts = joinReq.requester_name.trim().split(/\s+/)
        const firstName = nameParts[0] || joinReq.requester_name
        const lastName = nameParts.slice(1).join(' ') || ''

        // Create user row
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: userErr } = await (supabase as any)
            .from('users')
            .insert({
                id: authUserId,
                name: joinReq.requester_name,
                first_name: firstName,
                last_name: lastName,
                phone_number: normalizedRequesterPhone,
                organisation_id: partner.organisation_id,
                role: joinReq.role,
                reporting_manager_id: null,  // Key partner has no manager
            })

        if (userErr && userErr.code !== '23505') {
            console.error('[AcceptJoin] Failed to create user:', userErr)
            return NextResponse.json(
                { error: 'Failed to create user profile' },
                { status: 500 }
            )
        }

        // Mark join request as accepted
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase as any)
            .from('join_requests')
            .update({ status: 'accepted', updated_at: new Date().toISOString() })
            .eq('id', requestId)

        // Send Scenario 4 template: Quick Reply button triggers signin flow
        const sendTo = joinReq.requester_phone.replace(/\+/g, '')
        await sendJoinRequestApprovedTemplate(sendTo)

        return NextResponse.json({ status: 'accepted' })
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        console.error('[AcceptJoin] Error:', msg)
        return NextResponse.json({ error: msg }, { status: 500 })
    }
}
