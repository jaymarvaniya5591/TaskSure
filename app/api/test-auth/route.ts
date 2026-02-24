import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';
import { normalizePhone } from '@/lib/phone';
import { cookies } from 'next/headers';

// POST /api/test-auth — Generates a valid session for any user bypassing OTP
// Sets session cookies directly so the browser can navigate to /home immediately.
// Body: { phone: "+919876543210" } or { phone: "9876543210" }
export async function POST(request: NextRequest) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !serviceRoleKey || !anonKey) {
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
        const phoneE164 = `+91${phone10}`;

        // Admin client for user management
        const adminClient = createClient(supabaseUrl, serviceRoleKey, {
            auth: { autoRefreshToken: false, persistSession: false }
        });

        // Build the test email deterministically from the 10-digit phone
        const testEmail = `test_91${phone10}@boldo.test`;

        // 1. Try to find existing auth user
        let authUserId: string | null = null;

        // Fast path: lookup via public.users table
        const { data: userLookup } = await adminClient
            .from('users')
            .select('id')
            .eq('phone_number', phone10)
            .maybeSingle();

        if (userLookup) {
            authUserId = userLookup.id;
        }

        if (!authUserId) {
            // Fallback: search auth users by phone or email with pagination
            let page = 1;
            const perPage = 100;
            let found = false;
            while (!found) {
                const { data: listData, error: listError } = await adminClient.auth.admin.listUsers({
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
            // Create a new auth user
            const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
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
            await adminClient.auth.admin.updateUserById(authUserId, {
                email: testEmail,
                email_confirm: true,
                phone_confirm: true,
                phone: phoneE164,
            });
        }

        // Generate a magic link token
        const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
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

        // Create a server-side Supabase client that writes cookies into the response
        const cookieStore = await cookies();
        const response = NextResponse.json({ success: true });

        const serverClient = createServerClient(supabaseUrl, anonKey, {
            cookies: {
                getAll() {
                    return cookieStore.getAll();
                },
                setAll(cookiesToSet) {
                    cookiesToSet.forEach(({ name, value, options }) => {
                        // Set on the outgoing NextResponse
                        response.cookies.set(name, value, {
                            ...options,
                            // Ensure cookies work on the full domain
                            path: '/',
                        });
                    });
                },
            },
        });

        // Verify OTP to create a real session — cookies are written to `response`
        const { data: verifyData, error: verifyError } = await serverClient.auth.verifyOtp({
            type: 'magiclink',
            token_hash: tokenHash,
        });

        if (verifyError || !verifyData.session) {
            // Fallback: try password login
            const { data: pwdData, error: pwdError } = await serverClient.auth.signInWithPassword({
                email: testEmail,
                password: 'TestPassword123!'
            });

            if (pwdError || !pwdData.session) {
                return NextResponse.json(
                    { error: `Failed to create session: ${verifyError?.message || 'No session'}. Password fallback: ${pwdError?.message || 'no session'}` },
                    { status: 500 }
                );
            }
        }

        // The response already has Set-Cookie headers from the serverClient
        return response;
    } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
