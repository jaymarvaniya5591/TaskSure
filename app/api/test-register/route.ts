import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { normalizePhone } from '@/lib/phone';

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
        const { phone, name, company_name, reporting_manager_id } = body;

        if (!phone || !name || !company_name) {
            return NextResponse.json(
                { error: 'phone, name, and company_name are required' },
                { status: 400 }
            );
        }

        const phone10 = normalizePhone(phone);
        if (phone10.length !== 10) {
            return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 });
        }

        const supabase = createClient(supabaseUrl, serviceRoleKey, {
            auth: { autoRefreshToken: false, persistSession: false }
        });

        // 1. Check if user already exists in public.users
        const { data: existing } = await supabase
            .from('users')
            .select('id')
            .eq('phone_number', phone10)
            .maybeSingle();

        if (existing) {
            return NextResponse.json({ error: 'User already exists', user_id: existing.id }, { status: 409 });
        }

        // 2. Create or find the organisation
        let orgId: string;
        const { data: existingOrg } = await supabase
            .from('organisations')
            .select('id')
            .eq('name', company_name)
            .maybeSingle();

        if (existingOrg) {
            orgId = existingOrg.id;
        } else {
            const slug = company_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
            const { data: newOrg, error: orgError } = await supabase
                .from('organisations')
                .insert({ name: company_name, slug })
                .select('id')
                .single();

            if (orgError || !newOrg) {
                return NextResponse.json(
                    { error: `Failed to create organisation: ${orgError?.message || 'Unknown'}` },
                    { status: 500 }
                );
            }
            orgId = newOrg.id;
        }

        // 3. Create Auth user — use E.164 format (+91) for phone
        const phoneE164 = `+91${phone10}`;
        const testEmail = `test_91${phone10}@boldo.test`;
        const { data: newAuthUser, error: authError } = await supabase.auth.admin.createUser({
            phone: phoneE164,
            email: testEmail,
            email_confirm: true,
            phone_confirm: true,
            password: 'TestPassword123!',
        });

        let authUserId: string;
        if (authError) {
            // User might exist in auth but not in public.users — find them
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

        // 4. Insert into public.users
        const { error: userInsertError } = await supabase.from('users').insert({
            id: authUserId,
            name,
            phone_number: phone10,
            organisation_id: orgId,
            role: 'member',
            reporting_manager_id: reporting_manager_id || null,
        });

        if (userInsertError) {
            return NextResponse.json(
                { error: `Failed to create user record: ${userInsertError.message}` },
                { status: 500 }
            );
        }

        return NextResponse.json({ success: true, user_id: authUserId });
    } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
