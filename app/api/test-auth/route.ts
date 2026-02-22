import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

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

        const supabase = createClient(supabaseUrl, serviceRoleKey, {
            auth: { autoRefreshToken: false, persistSession: false }
        });

        // 1. Check if user exists in AUTH table (not just public.users)
        // Since we don't know the exact auth user id, we will generate a magic link.
        // For new signups, the auth user might not exist yet. Let's create a dummy email to ensure they exist in auth.
        const testEmail = `test_${phone.replace(/\+/g, '')}@boldo.test`;

        // We must ensure the auth user exists and has this email.
        // If they already exist with a phone but no email, this might fail to find them easily via admin API without listing users.
        // Instead of pure magic link, let's use the admin API to manually generate a link.

        // First, try to find an existing auth user by phone (not strictly supported by admin API directly)
        // Let's just create/update a user with this email and phone.

        // Use admin.createUser (fails if email/phone exists)
        let authUserId = null;
        const { data: existingUsers, error: listError } = await supabase.auth.admin.listUsers();
        if (!listError && existingUsers.users) {
            const user = existingUsers.users.find(u => u.phone === phone || u.email === testEmail);
            if (user) {
                authUserId = user.id;
            }
        }

        if (!authUserId) {
            // Create user
            const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
                phone,
                email: testEmail,
                email_confirm: true,
                phone_confirm: true,
                password: 'TestPassword123!'
            });
            if (createError && createError.message.includes("already registered")) {
                // Ignore, we will rely on signInWithPassword if needed
            } else if (newUser.user) {
                authUserId = newUser.user.id;
            }
        } else {
            // Ensure email exists for magic link
            await supabase.auth.admin.updateUserById(authUserId, {
                email: testEmail,
                email_confirm: true,
                phone_confirm: true,
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
                    { error: `Failed to create session: ${verifyError?.message || 'No session returned'}. Password fallback also failed.` },
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
