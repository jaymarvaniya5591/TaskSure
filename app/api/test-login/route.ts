import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

// POST /api/test-login — Generates a valid session for test users
// This bypasses OTP by creating a session via the admin API
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

        // Check if user exists in our users table
        const { data: userProfile } = await supabase
            .from('users')
            .select('id, name')
            .eq('phone_number', phone)
            .maybeSingle();

        if (!userProfile) {
            return NextResponse.json(
                { error: 'No test user found for this phone number' },
                { status: 404 }
            );
        }

        // Generate a magic link using the admin API
        // We set up the user with an email first, then generate a magic link
        const testEmail = `test_${phone.replace(/\+/g, '')}@boldo.test`;

        // Ensure the auth user has an email
        await supabase.auth.admin.updateUserById(userProfile.id, {
            email: testEmail,
            email_confirm: true,
        });

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

        // The link data contains the hashed token and verification properties
        // We can exchange this for a session using the OTP verification
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
            return NextResponse.json(
                { error: `Failed to create session: ${verifyError?.message || 'No session returned'}` },
                { status: 500 }
            );
        }

        // Return the session tokens so the client can set them
        return NextResponse.json({
            success: true,
            access_token: verifyData.session.access_token,
            refresh_token: verifyData.session.refresh_token,
            userId: userProfile.id,
            userName: userProfile.name,
        });
    } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
