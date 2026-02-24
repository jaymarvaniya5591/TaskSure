import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { normalizePhone } from '@/lib/phone';

// POST /api/test-auth — Generates a valid session for any user bypassing OTP
// Body: { phone: "+919876543210" }
export async function POST(request: NextRequest) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
        return NextResponse.json(
            { error: 'Server configuration error' },
            { status: 500 }
        );
    }

    try {
        const body = await request.json();
        const { phone } = body;

        if (!phone || typeof phone !== 'string') {
            return NextResponse.json({ error: 'Phone number is required' }, { status: 400 });
        }

        // Normalize to 10 digits for consistency
        const phone10 = normalizePhone(phone);
        // Build the canonical +91 format for Supabase auth lookups
        const phoneE164 = `+91${phone10}`;

        const supabase = createClient(supabaseUrl, serviceRoleKey, {
            auth: { autoRefreshToken: false, persistSession: false }
        });

        // Build the test email deterministically from the 10-digit phone
        const testEmail = `test_91${phone10}@boldo.test`;

        // 1. Try to find existing auth user
        let authUserId: string | null = null;

        // Fast path: lookup via public.users table (avoids listing all auth users)
        const { data: userLookup } = await supabase
            .from('users')
            .select('id')
            .eq('phone_number', phone10)
            .maybeSingle();

        if (userLookup) {
            // We found the public.users record — use its ID (same as auth user ID)
            authUserId = userLookup.id;
        }

        if (!authUserId) {
            // Fallback: search auth users by phone or email
            // Use paginated search to handle large user bases
            let page = 1;
            const perPage = 100;
            let found = false;
            while (!found) {
                const { data: listData, error: listError } = await supabase.auth.admin.listUsers({
                    page,
                    perPage,
                });
                if (listError || !listData?.users?.length) break;

                const user = listData.users.find(
                    u => normalizePhone(u.phone || '') === phone10 || u.email === testEmail
                );
                if (user) {
                    authUserId = user.id;
                    found = true;
                }

                if (listData.users.length < perPage) break;
                page++;
            }
        }

        if (!authUserId) {
            // Create a new auth user with consistent phone format
            const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
                phone: phoneE164,
                email: testEmail,
                email_confirm: true,
                phone_confirm: true,
                password: 'TestPassword123!'
            });
            if (createError) {
                return NextResponse.json(
                    { error: `Failed to create auth user: ${createError.message}` },
                    { status: 500 }
                );
            }
            authUserId = newUser.user.id;
        } else {
            // Ensure the auth user has the test email set and confirmed
            await supabase.auth.admin.updateUserById(authUserId, {
                email: testEmail,
                email_confirm: true,
                phone_confirm: true,
                phone: phoneE164,
            });
        }

        // Generate a magic link token
        const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
            type: 'magiclink',
            email: testEmail,
        });

        if (linkError || !linkData) {
            return NextResponse.json(
                { error: `Failed to generate link: ${linkError?.message || 'Unknown'}` },
                { status: 500 }
            );
        }

        const tokenHash = linkData.properties?.hashed_token;
        if (!tokenHash) {
            return NextResponse.json(
                { error: 'No token hash in generated link' },
                { status: 500 }
            );
        }

        // Use a separate client to verify the token and get a session
        const sessionClient = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || serviceRoleKey, {
            auth: { autoRefreshToken: false, persistSession: false }
        });

        const { data: verifyData, error: verifyError } = await sessionClient.auth.verifyOtp({
            type: 'magiclink',
            token_hash: tokenHash,
        });

        if (verifyError || !verifyData.session) {
            // Fallback: Try password
            const { data: pwdData, error: pwdError } = await sessionClient.auth.signInWithPassword({
                email: testEmail,
                password: 'TestPassword123!'
            });

            if (pwdError || !pwdData.session) {
                return NextResponse.json(
                    { error: `Failed to create session: ${verifyError?.message || 'No session returned'}. Password fallback also failed: ${pwdError?.message || 'unknown'}` },
                    { status: 500 }
                );
            }

            return NextResponse.json({
                success: true,
                access_token: pwdData.session.access_token,
                refresh_token: pwdData.session.refresh_token,
            });
        }

        // Return the session tokens so the client can set them
        return NextResponse.json({
            success: true,
            access_token: verifyData.session.access_token,
            refresh_token: verifyData.session.refresh_token,
        });
    } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
