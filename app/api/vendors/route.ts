import { NextRequest, NextResponse } from 'next/server'

export const preferredRegion = 'sin1'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCurrentUser } from '@/lib/user'
import { isRateLimited } from '@/lib/rate-limit'
import {
    normalizePhone,
    isVendorInOrg,
    isEmployeeInOrg,
    createVendorAndOnboarding,
    getOrgName,
    getVendorsByOrg,
} from '@/lib/vendor-service'
import { sendVendorApprovalTemplate } from '@/lib/whatsapp'

export async function GET() {
    const supabase = await createClient()
    const currentUser = await resolveCurrentUser(supabase)

    if (!currentUser) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const orgId = currentUser.organisation_id
    if (!orgId) {
        return NextResponse.json({ error: 'User has no organisation' }, { status: 400 })
    }

    const vendors = await getVendorsByOrg(orgId)
    return NextResponse.json({ vendors })
}

export async function POST(request: NextRequest) {
    const supabase = await createClient()

    const [currentUser, body] = await Promise.all([
        resolveCurrentUser(supabase),
        request.json(),
    ])

    if (!currentUser) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (isRateLimited('vendor_add', currentUser.id, 10, 60_000)) {
        return NextResponse.json({ error: 'Too many requests. Please slow down.' }, { status: 429 })
    }

    const orgId = currentUser.organisation_id
    if (!orgId) {
        return NextResponse.json({ error: 'User has no organisation' }, { status: 400 })
    }

    const { phone_number } = body
    if (!phone_number || typeof phone_number !== 'string') {
        return NextResponse.json({ error: 'Missing required field: phone_number' }, { status: 400 })
    }

    const normalized = normalizePhone(phone_number)
    if (normalized.length !== 10) {
        return NextResponse.json({ error: 'Invalid phone number. Must be a 10-digit Indian mobile number.' }, { status: 400 })
    }

    // Self-add prevention
    if (normalized === normalizePhone(currentUser.phone_number)) {
        return NextResponse.json({ error: 'You cannot add yourself as a vendor.' }, { status: 400 })
    }

    // Check if already a vendor
    const vendorCheck = await isVendorInOrg(orgId, normalized)
    if (vendorCheck.exists) {
        if (vendorCheck.status === 'active') {
            return NextResponse.json({ error: 'This phone number is already registered as a vendor in your organisation.' }, { status: 409 })
        }
        if (vendorCheck.status === 'pending') {
            return NextResponse.json({ error: 'A vendor request is already pending for this phone number.' }, { status: 409 })
        }
    }

    // Check for employee (warn in response but allow)
    const employeeCheck = await isEmployeeInOrg(orgId, normalized)
    const warning = employeeCheck.exists
        ? `Note: ${employeeCheck.user?.name} is already an employee in your organisation.`
        : null

    try {
        const { vendorId, onboardingId } = await createVendorAndOnboarding(orgId, normalized, currentUser.id)

        // Send approval template to vendor (fire-and-forget)
        const orgName = await getOrgName(orgId)
        const vendorPhoneIntl = `91${normalized}`
        sendVendorApprovalTemplate(
            vendorPhoneIntl,
            currentUser.name,
            orgName,
            currentUser.phone_number,
            onboardingId
        ).catch(err => console.error('[VendorAPI] Failed to send approval template:', err))

        // Audit log (fire-and-forget)
        const adminSupabase = createAdminClient()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(adminSupabase as any)
            .from('incoming_messages')
            .insert({
                phone: currentUser.phone_number,
                raw_text: `[AUDIT] vendor.invited: ${normalized}`,
                processed: true,
                intent_type: 'vendor_add',
            })
            .then(() => { /* ignore */ })
            .catch((err: unknown) => console.error('[VendorAPI] Audit log error:', err))

        return NextResponse.json({
            success: true,
            vendor_id: vendorId,
            message: `Vendor request sent to ${normalized}. Waiting for approval.`,
            ...(warning ? { warning } : {}),
        })
    } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error'
        console.error('[VendorAPI] Failed to create vendor:', errMsg)
        return NextResponse.json({ error: 'Failed to add vendor. Please try again.' }, { status: 500 })
    }
}
