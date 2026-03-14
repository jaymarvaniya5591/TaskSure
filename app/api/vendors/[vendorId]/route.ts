import { NextRequest, NextResponse } from 'next/server'

export const preferredRegion = 'sin1'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCurrentUser } from '@/lib/user'

export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ vendorId: string }> }
) {
    const supabase = await createClient()
    const currentUser = await resolveCurrentUser(supabase)

    if (!currentUser) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const orgId = currentUser.organisation_id
    if (!orgId) {
        return NextResponse.json({ error: 'User has no organisation' }, { status: 400 })
    }

    const { vendorId } = await params
    const body = await request.json()
    const { name, status } = body

    const adminSupabase = createAdminClient()

    // Validate vendor belongs to user's org
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: vendor } = await (adminSupabase as any)
        .from('org_vendors')
        .select('id, organisation_id')
        .eq('id', vendorId)
        .eq('organisation_id', orgId)
        .single()

    if (!vendor) {
        return NextResponse.json({ error: 'Vendor not found in your organisation' }, { status: 404 })
    }

    // Build update object
    const updates: Record<string, unknown> = {}
    if (name !== undefined) {
        updates.name = name
        const parts = name.trim().split(/\s+/)
        updates.first_name = parts[0]
        updates.last_name = parts.slice(1).join(' ') || null
    }
    if (status !== undefined) {
        if (!['active', 'inactive'].includes(status)) {
            return NextResponse.json({ error: 'Invalid status. Must be "active" or "inactive".' }, { status: 400 })
        }
        updates.status = status
    }

    if (Object.keys(updates).length === 0) {
        return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (adminSupabase as any)
        .from('org_vendors')
        .update(updates)
        .eq('id', vendorId)

    if (error) {
        console.error('[VendorAPI] Failed to update vendor:', error.message)
        return NextResponse.json({ error: 'Failed to update vendor' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ vendorId: string }> }
) {
    const supabase = await createClient()
    const currentUser = await resolveCurrentUser(supabase)

    if (!currentUser) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const orgId = currentUser.organisation_id
    if (!orgId) {
        return NextResponse.json({ error: 'User has no organisation' }, { status: 400 })
    }

    const { vendorId } = await params
    const adminSupabase = createAdminClient()

    // Validate vendor belongs to user's org
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: vendor } = await (adminSupabase as any)
        .from('org_vendors')
        .select('id, organisation_id')
        .eq('id', vendorId)
        .eq('organisation_id', orgId)
        .single()

    if (!vendor) {
        return NextResponse.json({ error: 'Vendor not found in your organisation' }, { status: 404 })
    }

    // Check for active tickets
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { count } = await (adminSupabase as any)
        .from('tickets')
        .select('id', { count: 'exact', head: true })
        .eq('vendor_id', vendorId)
        .in('status', ['pending', 'accepted'])

    if (count && count > 0) {
        return NextResponse.json({
            error: `This vendor has ${count} active ticket(s). Please resolve or cancel them before removing the vendor.`,
            active_tickets: count,
        }, { status: 409 })
    }

    // Soft delete: set status to inactive
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (adminSupabase as any)
        .from('org_vendors')
        .update({ status: 'inactive' })
        .eq('id', vendorId)

    if (error) {
        console.error('[VendorAPI] Failed to deactivate vendor:', error.message)
        return NextResponse.json({ error: 'Failed to remove vendor' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
}
