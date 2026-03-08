import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';
import { normalizePhone } from '@/lib/phone';

export const preferredRegion = 'sin1';

/**
 * GET /api/test-auth?phone=9876543210
 * 
 * Creates an auth session and redirects to /home with session cookies set.
 * Must be navigated to directly (not via fetch) so the browser receives Set-Cookie headers.
 * 
 * This mirrors the pattern used by /api/auth/verify-link.
 */

export async function GET(request: NextRequest) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://boldoai.in';

    if (!supabaseUrl || !serviceRoleKey || !anonKey) {
        return NextResponse.redirect(`${baseUrl}/huehue?error=config`);
    }

    const phoneParam = request.nextUrl.searchParams.get('phone');
    if (!phoneParam) {
        return NextResponse.redirect(`${baseUrl}/huehue?error=missing_phone`);
    }

    const phone10 = normalizePhone(phoneParam);
    const phoneE164 = `+91${phone10}`;

    try {
        // Admin client for user management
        const adminClient = createClient(supabaseUrl, serviceRoleKey, {
            auth: { autoRefreshToken: false, persistSession: false }
        });

        // Use SAME email format as generateDirectSession() in auth-links.ts
        const testEmail = `test_${phone10}@boldo.test`;

        // 1. Find existing auth user via public.users table (fast path)
        let authUserId: string | null = null;

        const { data: userLookup } = await adminClient
            .from('users')
            .select('id')
            .eq('phone_number', phone10)
            .maybeSingle();

        if (userLookup) {
            authUserId = userLookup.id;
        }

        if (!authUserId) {
            // Fallback: paginated auth user search
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
                return NextResponse.redirect(`${baseUrl}/huehue?error=create_failed`);
            }
            authUserId = newUser.user.id;
        } else {
            // Ensure the auth user has the correct test email and password
            await adminClient.auth.admin.updateUserById(authUserId, {
                email: testEmail,
                email_confirm: true,
                phone_confirm: true,
                phone: phoneE164,
                password: 'TestPassword123!',
            });
        }

        // 2. Generate session via password auth (same as generateDirectSession)
        const sessionClient = createClient(supabaseUrl, anonKey, {
            auth: { autoRefreshToken: false, persistSession: false }
        });

        const { data: loginData, error: loginError } = await sessionClient.auth.signInWithPassword({
            email: testEmail,
            password: 'TestPassword123!'
        });

        if (loginError || !loginData.session) {
            console.error('[test-auth] Password login failed:', loginError?.message);
            return NextResponse.redirect(`${baseUrl}/huehue?error=login_failed`);
        }

        // 3. Create redirect response with session cookies (mirrors verify-link pattern)
        const response = NextResponse.redirect(`${baseUrl}/home`);

        const cookieClient = createServerClient(supabaseUrl, anonKey, {
            cookies: {
                getAll() {
                    return request.cookies.getAll();
                },
                setAll(cookiesToSet) {
                    cookiesToSet.forEach(({ name, value, options }) => {
                        response.cookies.set(name, value, options);
                    });
                },
            },
        });

        await cookieClient.auth.setSession({
            access_token: loginData.session.access_token,
            refresh_token: loginData.session.refresh_token,
        });

        console.log(`[test-auth] Session created for ${phone10}, redirecting to /home`);
        return response;
    } catch (error) {
        console.error('[test-auth] Error:', error);
        return NextResponse.redirect(`${baseUrl}/huehue?error=unknown`);
    }
}
