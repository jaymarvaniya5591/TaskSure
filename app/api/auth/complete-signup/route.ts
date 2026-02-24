import { NextRequest, NextResponse } from 'next/server'
import { verifyAuthToken, consumeAuthToken, findAuthUserIdByPhone, generateDirectSession } from '@/lib/auth-links'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizePhone } from '@/lib/phone'

// Co-locate this function with Supabase (ap-southeast-1 / Singapore)
export const preferredRegion = 'sin1'

/**
 * POST /api/auth/complete-signup
 *
 * Completes the signup process after the user fills the signup form.
 * Creates the auth user, organisation, and users table row.
 *
 * PERFORMANCE: Uses findAuthUserIdByPhone() instead of listUsers(),
 * and generateDirectSession() instead of magic link round trip.
 *
 * Body: {
 *   token: string,
 *   firstName: string,
 *   lastName: string,
 *   action: 'create' | 'join',
 *   companyName?: string,        // required for action='create'
 *   role?: 'key_partner' | 'other_partner',  // required for action='join'
 *   partnerPhone?: string,       // required for role='key_partner'
 *   managerPhone?: string,       // required for role='other_partner'
 * }
 */
export async function POST(request: NextRequest) {
    let body: {
        token?: string
        firstName?: string
        lastName?: string
        action?: 'create' | 'join'
        companyName?: string
        role?: 'key_partner' | 'other_partner'
        partnerPhone?: string
        managerPhone?: string
    }

    try {
        body = await request.json()
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const { token, firstName, lastName, action } = body

    // ─── Validate required fields ────────────────────────────────────────
    if (!token || typeof token !== 'string') {
        return NextResponse.json({ error: 'Token is required' }, { status: 400 })
    }
    if (!firstName?.trim()) {
        return NextResponse.json({ error: 'First name is required' }, { status: 400 })
    }
    if (!lastName?.trim()) {
        return NextResponse.json({ error: 'Last name is required' }, { status: 400 })
    }
    if (!action || !['create', 'join'].includes(action)) {
        return NextResponse.json({ error: 'Action must be create or join' }, { status: 400 })
    }

    // ─── Verify token ────────────────────────────────────────────────────
    const tokenResult = await verifyAuthToken(token)
    if (!tokenResult.valid || !tokenResult.phone) {
        return NextResponse.json(
            { error: tokenResult.error || 'Invalid or expired link' },
            { status: 400 }
        )
    }

    const phone = normalizePhone(tokenResult.phone) // always 10 digits
    const fullName = `${firstName.trim()} ${lastName.trim()}`
    const supabase = createAdminClient()

    try {
        // ─── Create or find auth user ────────────────────────────────────
        const testEmail = `test_${phone}@boldo.test`

        // Fast lookup: check users table first (indexed query)
        let authUserId = await findAuthUserIdByPhone(phone)

        if (!authUserId) {
            // Create new auth user
            const { data: newUser, error: createErr } =
                await supabase.auth.admin.createUser({
                    phone,
                    email: testEmail,
                    email_confirm: true,
                    phone_confirm: true,
                    password: 'TestPassword123!',
                })

            if (createErr) {
                // If already registered, try to find by getUserById fallback
                if (!createErr.message.includes('already registered')) {
                    console.error('[CompleteSignup] Failed to create auth user:', createErr)
                    return NextResponse.json(
                        { error: 'Failed to create account' },
                        { status: 500 }
                    )
                }
            } else if (newUser?.user) {
                authUserId = newUser.user.id
            }
        } else {
            // Ensure email is set for session generation
            await supabase.auth.admin.updateUserById(authUserId, {
                email: testEmail,
                email_confirm: true,
                phone_confirm: true,
            })
        }

        if (!authUserId) {
            return NextResponse.json(
                { error: 'Failed to create auth user' },
                { status: 500 }
            )
        }

        // ─── Handle action: 'create' — Create new company ───────────────
        if (action === 'create') {
            const companyName = body.companyName?.trim()
            if (!companyName) {
                return NextResponse.json(
                    { error: 'Company name is required' },
                    { status: 400 }
                )
            }

            // Check uniqueness (case-insensitive)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data: existing } = await (supabase as any)
                .from('organisations')
                .select('id')
                .ilike('name', companyName)
                .maybeSingle()

            if (existing) {
                return NextResponse.json(
                    { error: 'A company with this name already exists' },
                    { status: 409 }
                )
            }

            // Create organisation
            const slug = companyName
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/(^-|-$)+/g, '')

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data: orgData, error: orgErr } = await (supabase as any)
                .from('organisations')
                .insert({ name: companyName, slug })
                .select('id')
                .single()

            if (orgErr || !orgData) {
                console.error('[CompleteSignup] Failed to create org:', orgErr)
                return NextResponse.json(
                    { error: 'Failed to create company' },
                    { status: 500 }
                )
            }

            // Create user row
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { error: userErr } = await (supabase as any)
                .from('users')
                .insert({
                    id: authUserId,
                    name: fullName,
                    first_name: firstName.trim(),
                    last_name: lastName.trim(),
                    phone_number: phone,
                    organisation_id: orgData.id,
                    role: 'owner',
                })

            if (userErr) {
                if (userErr.code === '23505') {
                    // Duplicate — user already exists, proceed
                } else {
                    console.error('[CompleteSignup] Failed to create user:', userErr)
                    return NextResponse.json(
                        { error: 'Failed to create user profile' },
                        { status: 500 }
                    )
                }
            }

            // Consume token
            await consumeAuthToken(token)

            // Generate session directly via password auth
            const session = await generateDirectSession(phone)
            if (!session) {
                return NextResponse.json(
                    { error: 'Account created but failed to generate session. Please sign in.' },
                    { status: 500 }
                )
            }

            return NextResponse.json({
                status: 'created',
                access_token: session.access_token,
                refresh_token: session.refresh_token,
            })
        }

        // ─── Handle action: 'join' ──────────────────────────────────────
        if (action === 'join') {
            const role = body.role
            if (!role || !['key_partner', 'other_partner'].includes(role)) {
                return NextResponse.json(
                    { error: 'Role is required (key_partner or other_partner)' },
                    { status: 400 }
                )
            }

            // ── Key Partner: needs approval ─────────────────────────────
            if (role === 'key_partner') {
                const partnerPhone = body.partnerPhone?.trim()
                if (!partnerPhone) {
                    return NextResponse.json(
                        { error: 'Partner phone number is required' },
                        { status: 400 }
                    )
                }

                // Normalise phone to 10 digits
                const normalizedPartner = normalizePhone(partnerPhone)

                // Verify partner exists
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const { data: partner } = await (supabase as any)
                    .from('users')
                    .select('id, name, organisation_id')
                    .eq('phone_number', normalizedPartner)
                    .single()

                if (!partner) {
                    return NextResponse.json(
                        { error: 'No user found with that phone number. Please check and try again.' },
                        { status: 404 }
                    )
                }

                // Create join request
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const { error: reqErr } = await (supabase as any)
                    .from('join_requests')
                    .insert({
                        requester_phone: phone,
                        requester_name: fullName,
                        partner_phone: normalizedPartner,
                        role: 'owner',
                    })

                if (reqErr) {
                    console.error('[CompleteSignup] Failed to create join request:', reqErr)
                    return NextResponse.json(
                        { error: 'Failed to create join request' },
                        { status: 500 }
                    )
                }

                // Don't consume token yet — they may need to retry if partner rejects
                return NextResponse.json({
                    status: 'pending_approval',
                    message: `Your request to join has been sent to ${partner.name}. You will receive a link on WhatsApp once they approve.`,
                })
            }

            // ── Other Partner: joins immediately via manager ─────────────
            if (role === 'other_partner') {
                const managerPhone = body.managerPhone?.trim()
                if (!managerPhone) {
                    return NextResponse.json(
                        { error: 'Manager phone number is required' },
                        { status: 400 }
                    )
                }

                const normalizedManager = normalizePhone(managerPhone)

                // Find manager
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const { data: manager } = await (supabase as any)
                    .from('users')
                    .select('id, name, organisation_id')
                    .eq('phone_number', normalizedManager)
                    .single()

                if (!manager) {
                    return NextResponse.json(
                        { error: 'No user found with that phone number. Please check and try again.' },
                        { status: 404 }
                    )
                }

                // Create user row with manager's org
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const { error: userErr } = await (supabase as any)
                    .from('users')
                    .insert({
                        id: authUserId,
                        name: fullName,
                        first_name: firstName.trim(),
                        last_name: lastName.trim(),
                        phone_number: phone,
                        organisation_id: manager.organisation_id,
                        role: 'member',
                        reporting_manager_id: manager.id,
                    })

                if (userErr) {
                    if (userErr.code === '23505') {
                        // Already exists
                    } else {
                        console.error('[CompleteSignup] Failed to create user:', userErr)
                        return NextResponse.json(
                            { error: 'Failed to create user profile' },
                            { status: 500 }
                        )
                    }
                }

                // Consume token
                await consumeAuthToken(token)

                // Generate session directly via password auth
                const session = await generateDirectSession(phone)
                if (!session) {
                    return NextResponse.json(
                        { error: 'Account created but failed to generate session. Please sign in.' },
                        { status: 500 }
                    )
                }

                return NextResponse.json({
                    status: 'created',
                    access_token: session.access_token,
                    refresh_token: session.refresh_token,
                })
            }
        }

        return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        console.error('[CompleteSignup] Unhandled error:', msg)
        return NextResponse.json({ error: msg }, { status: 500 })
    }
}
