/**
 * Vendor Service — Central business logic for vendor operations.
 *
 * Consumed by WhatsApp bot handlers, session reply handlers, and API routes.
 * All DB operations use the admin client (service role key).
 *
 * Note: Supabase types don't include vendor tables yet (pre-migration),
 * so we cast the client to `any` for vendor table queries.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import type { Vendor, VendorOnboarding } from '@/lib/types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseAdmin = any

// ---------------------------------------------------------------------------
// Phone normalization & extraction
// ---------------------------------------------------------------------------

/**
 * Normalize a phone number to 10-digit Indian format.
 * Strips +91, 91, 0 prefixes and non-digit characters.
 */
export function normalizePhone(input: string): string {
    const digits = input.replace(/\D/g, '')
    if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2)
    if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1)
    if (digits.length === 10) return digits
    return digits.slice(-10)
}

/**
 * Try to extract an Indian phone number from free-form text.
 * Returns 10-digit normalized number or null.
 */
export function extractPhoneFromText(text: string): string | null {
    const cleaned = text.replace(/[\s\-\.()]/g, '')
    const match = cleaned.match(/(?:\+?91)?(\d{10})/)
    return match ? match[1] : null
}

/**
 * Extract phone number from a WhatsApp contacts message payload.
 * Tries first phone, falls back to subsequent if not a valid Indian mobile.
 */
export function extractPhoneFromContact(
    contacts: Array<{ phones?: Array<{ phone?: string }>; name?: { formatted_name?: string } }>
): { phone: string | null; name: string | null } {
    const contact = contacts[0]
    if (!contact?.phones?.length) return { phone: null, name: null }

    const name = contact.name?.formatted_name || null

    for (const p of contact.phones) {
        if (!p.phone) continue
        const normalized = normalizePhone(p.phone)
        if (normalized.length === 10) {
            return { phone: normalized, name }
        }
    }
    return { phone: null, name }
}

// ---------------------------------------------------------------------------
// Vendor lookups
// ---------------------------------------------------------------------------

/**
 * Check if a phone number is already a vendor in the given org.
 */
export async function isVendorInOrg(
    orgId: string,
    phone: string
): Promise<{ exists: boolean; vendor?: Vendor; status?: string }> {
    const sb: SupabaseAdmin = createAdminClient()
    const { data } = await sb
        .from('org_vendors')
        .select('*')
        .eq('organisation_id', orgId)
        .eq('phone_number', phone)
        .limit(1)
        .single()

    if (!data) return { exists: false }
    return { exists: true, vendor: data as Vendor, status: data.status }
}

/**
 * Check if a phone number belongs to an employee in the given org.
 */
export async function isEmployeeInOrg(
    orgId: string,
    phone: string
): Promise<{ exists: boolean; user?: { id: string; name: string; phone_number: string } }> {
    const sb: SupabaseAdmin = createAdminClient()
    const { data } = await sb
        .from('users')
        .select('id, name, phone_number')
        .eq('organisation_id', orgId)
        .eq('phone_number', phone)
        .limit(1)
        .single()

    if (!data) return { exists: false }
    return { exists: true, user: data }
}

/**
 * Look up a user by phone number across all orgs.
 * Used during vendor approval to auto-populate name.
 */
export async function getUserByPhone(
    phone: string
): Promise<{ id: string; name: string; phone_number: string; organisation_id: string } | null> {
    const sb: SupabaseAdmin = createAdminClient()
    const { data } = await sb
        .from('users')
        .select('id, name, phone_number, organisation_id')
        .eq('phone_number', phone)
        .limit(1)
        .single()

    return data || null
}

// ---------------------------------------------------------------------------
// Vendor onboarding operations
// ---------------------------------------------------------------------------

/**
 * Create a vendor record (pending) and an onboarding request.
 * Returns both IDs for subsequent template sending.
 */
export async function createVendorAndOnboarding(
    orgId: string,
    phone: string,
    addedBy: string
): Promise<{ vendorId: string; onboardingId: string }> {
    const sb: SupabaseAdmin = createAdminClient()

    // Create org_vendors row (pending)
    const { data: vendor, error: vendorErr } = await sb
        .from('org_vendors')
        .insert({
            organisation_id: orgId,
            phone_number: phone,
            status: 'pending',
            added_by: addedBy,
        })
        .select('id')
        .single()

    if (vendorErr || !vendor) {
        throw new Error(`Failed to create vendor: ${vendorErr?.message}`)
    }

    // Create vendor_onboarding row (pending)
    const { data: onboarding, error: onboardingErr } = await sb
        .from('vendor_onboarding')
        .insert({
            organisation_id: orgId,
            vendor_phone: phone,
            requested_by: addedBy,
            status: 'pending',
            org_vendor_id: vendor.id,
        })
        .select('id')
        .single()

    if (onboardingErr || !onboarding) {
        throw new Error(`Failed to create onboarding request: ${onboardingErr?.message}`)
    }

    return { vendorId: vendor.id, onboardingId: onboarding.id }
}

/**
 * Complete vendor onboarding — set vendor to active with name.
 * Called when vendor approves and name is available.
 */
export async function completeOnboarding(
    onboardingId: string,
    vendorName: string,
    firstName: string,
    lastName: string,
    userId?: string | null
): Promise<void> {
    const sb: SupabaseAdmin = createAdminClient()

    // Get the onboarding row to find the linked vendor
    const { data: onboarding } = await sb
        .from('vendor_onboarding')
        .select('org_vendor_id, organisation_id')
        .eq('id', onboardingId)
        .single()

    if (!onboarding) {
        throw new Error(`Onboarding request not found: ${onboardingId}`)
    }

    // Update org_vendors to active
    await sb
        .from('org_vendors')
        .update({
            status: 'active',
            name: vendorName,
            first_name: firstName,
            last_name: lastName,
            ...(userId ? { user_id: userId } : {}),
        })
        .eq('id', onboarding.org_vendor_id)

    // Update onboarding to approved
    await sb
        .from('vendor_onboarding')
        .update({
            status: 'approved',
            vendor_name: vendorName,
            resolved_at: new Date().toISOString(),
        })
        .eq('id', onboardingId)
}

/**
 * Reject a vendor onboarding request.
 * Sets onboarding to rejected and vendor to inactive.
 */
export async function rejectOnboarding(onboardingId: string): Promise<void> {
    const sb: SupabaseAdmin = createAdminClient()

    const { data: onboarding } = await sb
        .from('vendor_onboarding')
        .select('org_vendor_id')
        .eq('id', onboardingId)
        .single()

    if (!onboarding) {
        throw new Error(`Onboarding request not found: ${onboardingId}`)
    }

    // Update vendor to inactive
    await sb
        .from('org_vendors')
        .update({ status: 'inactive' })
        .eq('id', onboarding.org_vendor_id)

    // Update onboarding to rejected
    await sb
        .from('vendor_onboarding')
        .update({
            status: 'rejected',
            resolved_at: new Date().toISOString(),
        })
        .eq('id', onboardingId)
}

/**
 * Get a pending onboarding request by ID.
 * Returns null if not found or already resolved.
 */
export async function getPendingOnboarding(
    onboardingId: string
): Promise<VendorOnboarding | null> {
    const sb: SupabaseAdmin = createAdminClient()
    const { data } = await sb
        .from('vendor_onboarding')
        .select('*')
        .eq('id', onboardingId)
        .eq('status', 'pending')
        .single()

    return (data as VendorOnboarding) || null
}

/**
 * Get the org name for display in messages.
 */
export async function getOrgName(orgId: string): Promise<string> {
    const sb: SupabaseAdmin = createAdminClient()
    const { data } = await sb
        .from('organisations')
        .select('name')
        .eq('id', orgId)
        .single()

    return data?.name || 'your organisation'
}

/**
 * Get a user's name and phone for notification messages.
 */
export async function getUserInfo(
    userId: string
): Promise<{ name: string; phone_number: string } | null> {
    const sb: SupabaseAdmin = createAdminClient()
    const { data } = await sb
        .from('users')
        .select('name, phone_number')
        .eq('id', userId)
        .single()

    return data || null
}

/**
 * List vendors for an org (active + pending).
 */
export async function getVendorsByOrg(orgId: string): Promise<Vendor[]> {
    const sb: SupabaseAdmin = createAdminClient()
    const { data } = await sb
        .from('org_vendors')
        .select('*')
        .eq('organisation_id', orgId)
        .in('status', ['active', 'pending'])
        .order('created_at', { ascending: false })

    return (data as Vendor[]) || []
}
