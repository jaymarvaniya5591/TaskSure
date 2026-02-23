import { createClient } from '@supabase/supabase-js'

/**
 * Supabase admin client using the service role key.
 * Bypasses RLS — use ONLY in server-side API routes.
 * Never import this in client-side code.
 */

let adminClient: ReturnType<typeof createClient> | null = null

export function createAdminClient() {
    if (!adminClient) {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL
        const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

        if (!url || !serviceRoleKey) {
            throw new Error(
                'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables'
            )
        }

        adminClient = createClient(url, serviceRoleKey, {
            auth: {
                autoRefreshToken: false,
                persistSession: false,
            },
        })
    }
    return adminClient
}
