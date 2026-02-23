import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateAuthToken, buildAuthUrl, TEST_PHONE_OVERRIDE } from '@/lib/auth-links'
import { sendWhatsAppMessage } from '@/lib/whatsapp'

/**
 * POST /api/auth/accept-join
 *
 * Accepts or rejects a partner join request.
 * Only the partner (identified by phone) can accept.
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

        // Create auth user for the requester
        const testEmail = `test_${joinReq.requester_phone.replace(/\+/g, '')}@boldo.test`

        let authUserId: string | null = null
        const { data: existingUsers } = await supabase.auth.admin.listUsers()
        if (existingUsers?.users) {
            const existing = existingUsers.users.find(
                (u) =>
                    u.phone === joinReq.requester_phone ||
                    u.email === testEmail
            )
            if (existing) authUserId = existing.id
        }

        if (!authUserId) {
            const { data: newUser, error: createErr } =
                await supabase.auth.admin.createUser({
                    phone: joinReq.requester_phone,
                    email: testEmail,
                    email_confirm: true,
                    phone_confirm: true,
                    password: 'TestPassword123!',
                })
            if (createErr && !createErr.message.includes('already registered')) {
                console.error('[AcceptJoin] Failed to create auth user:', createErr)
                return NextResponse.json(
                    { error: 'Failed to create account' },
                    { status: 500 }
                )
            }
            if (newUser?.user) authUserId = newUser.user.id
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
                phone_number: joinReq.requester_phone,
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

        // Generate a signin link for the new user to access their dashboard
        const tokenResult = await generateAuthToken(joinReq.requester_phone, 'signin')
        if (tokenResult.success && tokenResult.token) {
            const dashboardUrl = buildAuthUrl(tokenResult.token)

            // ⚠️ TEST MODE: Send to test phone instead of actual user
            const sendTo = `91${TEST_PHONE_OVERRIDE}`

            await sendWhatsAppMessage(
                sendTo,
                `Great news — you're in! 🎉\n\nYour request was approved. Welcome to the team.\nHead over to your dashboard and make yourself at home:\n${dashboardUrl}`
            )
        }

        return NextResponse.json({ status: 'accepted' })
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        console.error('[AcceptJoin] Error:', msg)
        return NextResponse.json({ error: msg }, { status: 500 })
    }
}
