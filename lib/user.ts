/**
 * DRY helper to resolve the logged-in auth user → users table row.
 * Handles: id-based lookup, phone fallback, test email phone extraction.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizePhone } from '@/lib/phone';

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

    // Build phone candidates (all normalized to 10 digits)
    const phoneCandidates: string[] = [];
    if (user.phone) {
        phoneCandidates.push(normalizePhone(user.phone));
    }
    // Extract phone from test email: test_9876543210@boldo.test → 9876543210
    if (user.email) {
        const match = user.email.match(/test_(\d+)@/);
        if (match) phoneCandidates.push(normalizePhone(match[1]));
    }

    for (const phone of phoneCandidates) {
        if (!phone) continue;
        const { data: byPhone } = await supabase
            .from('users')
            .select('id, name, phone_number, organisation_id, reporting_manager_id, role, avatar_url')
            .eq('phone_number', phone)
            .single();
        if (byPhone) return byPhone as ResolvedUser;
    }

    return null;
}

/**
 * Fast user resolution when the auth user ID is already known
 * (e.g. from middleware). Skips the getUser() network call entirely.
 */
export async function resolveUserById(
    supabase: SupabaseClient,
    userId: string
): Promise<ResolvedUser | null> {
    const { data } = await supabase
        .from('users')
        .select('id, name, phone_number, organisation_id, reporting_manager_id, role, avatar_url')
        .eq('id', userId)
        .single();

    return data as ResolvedUser | null;
}
