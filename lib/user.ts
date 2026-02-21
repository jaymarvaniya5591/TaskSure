/**
 * DRY helper to resolve the logged-in auth user → users table row.
 * Handles: id-based lookup, phone fallback, test email phone extraction.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface ResolvedUser {
    id: string;
    name: string;
    phone_number: string;
    organisation_id: string;
    reporting_manager_id: string | null;
    role: string;
    avatar_url: string | null;
}

export async function resolveCurrentUser(
    supabase: SupabaseClient
): Promise<ResolvedUser | null> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    // Try by auth id first
    const { data: byId } = await supabase
        .from('users')
        .select('id, name, phone_number, organisation_id, reporting_manager_id, role, avatar_url')
        .eq('id', user.id)
        .single();

    if (byId) return byId as ResolvedUser;

    // Build phone candidates
    const phoneCandidates: string[] = [];
    if (user.phone) {
        phoneCandidates.push(user.phone);
        if (!user.phone.startsWith('+')) phoneCandidates.push(`+${user.phone}`);
    }
    // Extract phone from test email: test_919876543210@boldo.test → +919876543210
    if (user.email) {
        const match = user.email.match(/test_(\d+)@/);
        if (match) phoneCandidates.push(`+${match[1]}`);
    }

    for (const phone of phoneCandidates) {
        const { data: byPhone } = await supabase
            .from('users')
            .select('id, name, phone_number, organisation_id, reporting_manager_id, role, avatar_url')
            .eq('phone_number', phone)
            .single();
        if (byPhone) return byPhone as ResolvedUser;
    }

    return null;
}
