import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { normalizePhone } from '@/lib/phone';
import { sendJoinRequestPendingTemplate } from '@/lib/whatsapp';

export const preferredRegion = 'sin1';

/**
 * POST /api/test-register — Creates a new test user (auth + public.users row)
 * Body: { phone: "9727711111", name: "Test User", company_name: "My Co", reporting_manager_id?: "uuid" }
 *
 * Returns { success, user_id } or { error }
 */
export async function POST(request: NextRequest) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
        return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    try {
        const body = await request.json();
        const { phone, firstName, lastName, action, companyName, role, partnerPhone, managerPhone } = body;

        // ─── PHASE 1: PRE-VALIDATION ──────────────────────────────────────────

        if (!phone || !firstName?.trim() || !lastName?.trim() || !action) {
            return NextResponse.json(
                { error: 'phone, firstName, lastName, and action are required' },
                { status: 400 }
            );
        }

        if (!['create', 'join'].includes(action)) {
            return NextResponse.json({ error: 'Action must be create or join' }, { status: 400 });
        }

        const phone10 = normalizePhone(phone);
        if (phone10.length !== 10) {
            return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 });
        }

        const supabase = createClient(supabaseUrl, serviceRoleKey, {
            auth: { autoRefreshToken: false, persistSession: false }
        });

        const fullName = `${firstName.trim()} ${lastName.trim()}`;

        const validationData: {
            manager?: { id: string, name: string, organisation_id: string }
            partner?: { id: string, name: string, role: string, organisation_id: string }
            companySlug?: string
        } = {};

        if (action === 'create') {
            if (!companyName?.trim()) {
                return NextResponse.json({ error: 'Company name is required' }, { status: 400 });
            }

            const { data: existingOrg } = await supabase
                .from('organisations')
                .select('id')
                .ilike('name', companyName.trim())
                .maybeSingle();

            if (existingOrg) {
                return NextResponse.json({ error: 'A company with this name already exists' }, { status: 409 });
            }

            validationData.companySlug = companyName.trim()
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/(^-|-$)+/g, '');

        } else if (action === 'join') {
            if (!role || !['key_partner', 'other_partner'].includes(role)) {
                return NextResponse.json({ error: 'Role is required (key_partner or other_partner)' }, { status: 400 });
            }

            if (role === 'key_partner') {
                if (!partnerPhone?.trim()) {
                    return NextResponse.json({ error: 'Partner phone number is required' }, { status: 400 });
                }

                const normalizedPartner = normalizePhone(partnerPhone);
                const { data: partner } = await supabase
                    .from('users')
                    .select('id, name, role, organisation_id')
                    .eq('phone_number', normalizedPartner)
                    .single();

                if (!partner) {
                    return NextResponse.json({ error: 'No user found with that phone number.' }, { status: 404 });
                }

                validationData.partner = partner;

            } else if (role === 'other_partner') {
                if (!managerPhone?.trim()) {
                    return NextResponse.json({ error: 'Manager phone number is required' }, { status: 400 });
                }

                const normalizedManager = normalizePhone(managerPhone);
                const { data: manager } = await supabase
                    .from('users')
                    .select('id, name, organisation_id')
                    .eq('phone_number', normalizedManager)
                    .single();

                if (!manager) {
                    return NextResponse.json({ error: 'No user found with that manager phone number.' }, { status: 404 });
                }
                validationData.manager = manager;
            }
        }

        // ─── PHASE 2: EXECUTION ───────────────────────────────────────────────

        // 1. Create or Find Auth user
        const phoneE164 = `+91${phone10}`;
        const testEmail = `test_91${phone10}@boldo.test`;

        // Check auth user first securely via listUsers or just try to create
        const { data: newAuthUser, error: authError } = await supabase.auth.admin.createUser({
            phone: phoneE164,
            email: testEmail,
            email_confirm: true,
            phone_confirm: true,
            password: 'TestPassword123!',
        });

        let authUserId: string;
        if (authError) {
            const { data: listData } = await supabase.auth.admin.listUsers();
            const found = listData?.users?.find(
                u => normalizePhone(u.phone || '') === phone10 || u.email === testEmail
            );
            if (found) {
                authUserId = found.id;
            } else {
                return NextResponse.json(
                    { error: `Auth user creation failed: ${authError.message}` },
                    { status: 500 }
                );
            }
        } else {
            authUserId = newAuthUser.user.id;
        }

        // 2. Perform table inserts based on action
        if (action === 'create') {
            const { data: orgData, error: orgErr } = await supabase
                .from('organisations')
                .insert({ name: companyName.trim(), slug: validationData.companySlug })
                .select('id').single();

            if (orgErr || !orgData) {
                return NextResponse.json({ error: 'Failed to create company' }, { status: 500 });
            }

            const { error: userErr } = await supabase.from('users').insert({
                id: authUserId,
                name: fullName,
                first_name: firstName.trim(),
                last_name: lastName.trim(),
                phone_number: phone10,
                organisation_id: orgData.id,
                role: 'owner'
            });

            if (userErr) {
                await supabase.from('organisations').delete().eq('id', orgData.id);
                if (userErr.code === '23505') {
                    return NextResponse.json({ error: 'An account with this phone number already exists.' }, { status: 409 });
                }
                return NextResponse.json({ error: `User insert failed: ${userErr.message}` }, { status: 500 });
            }

            return NextResponse.json({ success: true, user_id: authUserId });

        } else if (action === 'join' && role === 'key_partner') {
            const { error: userErr } = await supabase.from('users').insert({
                id: authUserId,
                name: fullName,
                first_name: firstName.trim(),
                last_name: lastName.trim(),
                phone_number: phone10,
                organisation_id: validationData.partner!.organisation_id,
                role: 'owner'
            });

            if (userErr) {
                if (userErr.code === '23505') {
                    return NextResponse.json({ error: 'An account with this phone number already exists.' }, { status: 409 });
                }
                return NextResponse.json({ error: `User insert failed: ${userErr.message}` }, { status: 500 });
            }

            return NextResponse.json({ success: true, user_id: authUserId });

        } else if (action === 'join' && role === 'other_partner') {
            const { error: userErr } = await supabase.from('users').insert({
                id: authUserId,
                name: fullName,
                first_name: firstName.trim(),
                last_name: lastName.trim(),
                phone_number: phone10,
                organisation_id: validationData.manager!.organisation_id,
                role: 'member',
                reporting_manager_id: validationData.manager!.id
            });

            if (userErr) {
                if (userErr.code === '23505') {
                    return NextResponse.json({ error: 'An account with this phone number already exists.' }, { status: 409 });
                }
                return NextResponse.json({ error: `Member insert failed: ${userErr.message}` }, { status: 500 });
            }

            return NextResponse.json({ success: true, user_id: authUserId });
        }

        return NextResponse.json({ error: 'Invalid action/role combination' }, { status: 400 });

    } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
