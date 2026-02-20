import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

// POST /api/check-phone — Checks if a phone number exists in the users table
// This uses the service role key to bypass RLS since the caller is unauthenticated.
// Returns { exists: boolean }
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { phone } = body;

        if (!phone || typeof phone !== 'string') {
            return NextResponse.json(
                { error: 'Phone number is required' },
                { status: 400 }
            );
        }

        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (!supabaseUrl || !serviceRoleKey) {
            return NextResponse.json(
                { error: 'Server configuration error' },
                { status: 500 }
            );
        }

        const supabase = createClient(supabaseUrl, serviceRoleKey, {
            auth: { autoRefreshToken: false, persistSession: false }
        });

        const { data, error } = await supabase
            .from('users')
            .select('id')
            .eq('phone_number', phone)
            .maybeSingle();

        if (error) {
            console.error('check-phone error:', error);
            return NextResponse.json(
                { error: 'Failed to check phone number' },
                { status: 500 }
            );
        }

        return NextResponse.json({ exists: !!data });
    } catch {
        return NextResponse.json(
            { error: 'Invalid request' },
            { status: 400 }
        );
    }
}
