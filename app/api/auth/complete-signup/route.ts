import { NextRequest, NextResponse } from 'next/server'
import { verifyAuthToken, consumeAuthToken, findAuthUserIdByPhone, generateDirectSession } from '@/lib/auth-links'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizePhone } from '@/lib/phone'
import { sendJoinRequestPendingTemplate } from '@/lib/whatsapp'

// Co-locate this function with Supabase (ap-southeast-1 / Singapore)
export const preferredRegion = 'sin1'

/**
 * POST /api/auth/complete-signup
 *
 * Completes the signup process after the user fills the signup form.
 * Creates the auth user, organisation, and users table row.
 * Refactored to perform strict validation (Phase 1) BEFORE any database writes (Phase 2).
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

    // ─── PHASE 1: PRE-VALIDATION (Purely Read Operations) ────────────────────

    // 1. Validate basic required fields
    if (!token || typeof token !== 'string') {
        return NextResponse.json({ error: 'Token is required' }, { status: 400 })
    }
    if (!firstName?.trim()) {
        return NextResponse.json({ error: 'First name is required' }, { status: 400 })
    }
    if (firstName.trim().length > 50) {
        return NextResponse.json({ error: 'First name must be 50 characters or fewer' }, { status: 400 })
    }
    if (!lastName?.trim()) {
        return NextResponse.json({ error: 'Last name is required' }, { status: 400 })
    }
    if (lastName.trim().length > 50) {
        return NextResponse.json({ error: 'Last name must be 50 characters or fewer' }, { status: 400 })
    }
    if (!action || !['create', 'join'].includes(action)) {
        return NextResponse.json({ error: 'Action must be create or join' }, { status: 400 })
    }

    // 2. Verify token
    const tokenResult = await verifyAuthToken(token)
    if (!tokenResult.valid || !tokenResult.phone) {
        return NextResponse.json(
            { error: tokenResult.error || 'Invalid or expired link' },
            { status: 400 }
        )
    }

    // Initialize required variables for Phase 2
    const phone = normalizePhone(tokenResult.phone)
    const fullName = `${firstName.trim()} ${lastName.trim()}`
    const testEmail = `test_${phone}@boldo.test`
    const supabase = createAdminClient()

    const validationData: {
        manager?: { id: string, name: string, organisation_id: string }
        partner?: { id: string, name: string, role: string }
        companySlug?: string
    } = {}

    // 3. Validate specific action fields and database state
    try {
        if (action === 'create') {
            const companyName = body.companyName?.trim()
            if (!companyName) {
                return NextResponse.json({ error: 'Company name is required' }, { status: 400 })
            }
            if (companyName.length > 100) {
                return NextResponse.json({ error: 'Company name must be 100 characters or fewer' }, { status: 400 })
            }

            // Guard: if this phone already has a pending join request, block company creation
            // to prevent orphaned pending requests.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data: pendingRequest } = await (supabase as any)
                .from('join_requests')
                .select('id')
                .eq('requester_phone', phone)
                .eq('status', 'pending')
                .maybeSingle()

            if (pendingRequest) {
                return NextResponse.json(
                    {
                        error: 'You have a pending join request awaiting approval. Please wait for it to be accepted or rejected before creating a new company.',
                    },
                    { status: 409 }
                )
            }

            // Check company uniqueness (case-insensitive)
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

            validationData.companySlug = companyName
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/(^-|-$)+/g, '')

        } else if (action === 'join') {
            const role = body.role
            if (!role || !['key_partner', 'other_partner'].includes(role)) {
                return NextResponse.json(
                    { error: 'Role is required (key_partner or other_partner)' },
                    { status: 400 }
                )
            }

            if (role === 'key_partner') {
                const partnerPhone = body.partnerPhone?.trim()
                if (!partnerPhone) {
                    return NextResponse.json({ error: 'Partner phone number is required' }, { status: 400 })
                }

                const normalizedPartner = normalizePhone(partnerPhone)
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const { data: partner } = await (supabase as any)
                    .from('users')
                    .select('id, name, role')
                    .eq('phone_number', normalizedPartner)
                    .single()

                if (!partner) {
                    return NextResponse.json(
                        { error: 'No user found with that phone number. Please check and try again.' },
                        { status: 404 }
                    )
                }

                // SECURITY CHECK: Must be an owner to approve key partners
                if (partner.role !== 'owner') {
                    return NextResponse.json(
                        { error: 'This user is not an owner and cannot approve partner access requests.' },
                        { status: 403 }
                    )
                }
                validationData.partner = partner

            } else if (role === 'other_partner') {
                const managerPhone = body.managerPhone?.trim()
                if (!managerPhone) {
                    return NextResponse.json({ error: 'Manager phone number is required' }, { status: 400 })
                }

                const normalizedManager = normalizePhone(managerPhone)
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const { data: manager } = await (supabase as any)
                    .from('users')
                    .select('id, name, organisation_id')
                    .eq('phone_number', normalizedManager)
                    .single()

                if (!manager) {
                    return NextResponse.json(
                        { error: 'No user found with that manager phone number. Please check and try again.' },
                        { status: 404 }
                    )
                }
                validationData.manager = manager
            }
        }
    } catch (err) {
        console.error('[CompleteSignup] Validation error:', err)
        return NextResponse.json({ error: 'Failed to validate signup information' }, { status: 500 })
    }

    // ─── PHASE 2: EXECUTION (Write Operations) ───────────────────────────────
    // From here on, validation has perfectly succeeded so it is safe to write.

    try {
        // 1. Create or Find Auth User
        let authUserId = await findAuthUserIdByPhone(phone)

        if (!authUserId) {
            const { data: newUser, error: createErr } =
                await supabase.auth.admin.createUser({
                    phone,
                    email: testEmail,
                    email_confirm: true,
                    phone_confirm: true,
                    password: 'TestPassword123!',
                })

            if (createErr) {
                if (!createErr.message.includes('already registered') && !createErr.message.includes('already been registered')) {
                    console.error('[CompleteSignup] Failed to create auth user:', createErr)
                    return NextResponse.json({ error: 'Failed to create account' }, { status: 500 })
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
                    console.error('[CompleteSignup] Fallback sign-in failed:', fallbackErr)
                    return NextResponse.json({ error: 'Failed to resolve existing account' }, { status: 500 })
                }
            } else if (newUser?.user) {
                authUserId = newUser.user.id
            }
        } else {
            await supabase.auth.admin.updateUserById(authUserId, {
                email: testEmail, email_confirm: true, phone_confirm: true,
            })
        }

        if (!authUserId) throw new Error('Failed to resolve authUserId')

        // 2. Perform table inserts based on action
        if (action === 'create') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data: orgData, error: orgErr } = await (supabase as any)
                .from('organisations')
                .insert({ name: body.companyName?.trim(), slug: validationData.companySlug })
                .select('id').single()

            if (orgErr || !orgData) throw new Error('Failed to create company')

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { error: userErr } = await (supabase as any).from('users').insert({
                id: authUserId, name: fullName, first_name: firstName.trim(), last_name: lastName.trim(),
                phone_number: phone, organisation_id: orgData.id, role: 'owner'
            })

            if (userErr) {
                // ROLLBACK: delete the org we just created so it doesn't become orphaned
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                await (supabase as any).from('organisations').delete().eq('id', orgData.id)
                // ROLLBACK: best-effort delete the auth user so they aren't permanently orphaned
                // (auth user with no public.users row = unrecoverable login state)
                try { await supabase.auth.admin.deleteUser(authUserId) } catch (e) {
                    console.error('[CompleteSignup] Failed to rollback auth user:', e)
                }
                if (userErr.code === '23505') {
                    return NextResponse.json(
                        { error: 'An account with this phone number already exists. Please sign in instead.' },
                        { status: 409 }
                    )
                }
                throw new Error(`User insert failed: ${userErr.message}`)
            }

            await consumeAuthToken(token)
            const session = await generateDirectSession(phone)
            if (!session) {
                // Account created successfully but session generation failed.
                // Don't throw — the account exists. Tell the client to redirect to login.
                console.warn('[CompleteSignup] Session generation failed, returning created_no_session')
                return NextResponse.json({ status: 'created_no_session' })
            }

            return NextResponse.json({ status: 'created', access_token: session.access_token, refresh_token: session.refresh_token })

        } else if (action === 'join' && body.role === 'key_partner') {
            const partnerPhone = normalizePhone(body.partnerPhone!)

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data: reqData, error: reqErr } = await (supabase as any).from('join_requests').insert({
                requester_phone: phone, requester_name: fullName, partner_phone: partnerPhone, role: 'owner'
            }).select('id').single()

            if (reqErr) throw new Error(`Join request failure: ${reqErr.message}`)

            // Await to ensure the edge function doesn't die before the template is sent
            await sendJoinRequestPendingTemplate(`91${partnerPhone}`, fullName, phone, reqData.id)
                .catch(err => console.error('[CompleteSignup] Failed to send join request notification:', err))

            // Don't consume token yet — they may need to retry if partner rejects
            return NextResponse.json({
                status: 'pending_approval',
                message: `Your request to join has been sent. You will receive a link on WhatsApp once they approve.`
            })

        } else if (action === 'join' && body.role === 'other_partner') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { error: userErr } = await (supabase as any).from('users').insert({
                id: authUserId, name: fullName, first_name: firstName.trim(), last_name: lastName.trim(),
                phone_number: phone, organisation_id: validationData.manager!.organisation_id,
                role: 'member', reporting_manager_id: validationData.manager!.id
            })

            if (userErr) {
                if (userErr.code === '23505') {
                    return NextResponse.json(
                        { error: 'An account with this phone number already exists. Please sign in instead.' },
                        { status: 409 }
                    )
                }
                // ROLLBACK: best-effort delete the auth user so they aren't permanently orphaned
                try { await supabase.auth.admin.deleteUser(authUserId) } catch (e) {
                    console.error('[CompleteSignup] Failed to rollback auth user (join):', e)
                }
                throw new Error(`Member insert failed: ${userErr.message}`)
            }

            await consumeAuthToken(token)
            const session = await generateDirectSession(phone)
            if (!session) {
                console.warn('[CompleteSignup] Session generation failed for join, returning created_no_session')
                return NextResponse.json({ status: 'created_no_session' })
            }

            return NextResponse.json({ status: 'created', access_token: session.access_token, refresh_token: session.refresh_token })
        }

        // Fallback for invalid action/role combination if it somehow reaches here
        return NextResponse.json({ error: 'Invalid action or role combination' }, { status: 400 })

    } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        console.error('[CompleteSignup] Execution error:', msg)
        return NextResponse.json({ error: msg }, { status: 500 })
    }
}
