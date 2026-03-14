import { NextRequest, NextResponse } from 'next/server'

export const preferredRegion = 'sin1'

import { createClient } from '@/lib/supabase/server'
import { resolveCurrentUser } from '@/lib/user'
import { updateTicket, completeTicket, cancelTicket, getTicketById } from '@/lib/ticket-service'

export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ ticketId: string }> }
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

    const { ticketId } = await params
    const body = await request.json()

    // Validate ticket exists in user's org
    const ticket = await getTicketById(ticketId, orgId)
    if (!ticket) {
        return NextResponse.json({ error: 'Ticket not found in your organisation' }, { status: 404 })
    }

    try {
        // Handle status change to completed
        if (body.status === 'completed') {
            await completeTicket(ticketId, orgId)
            return NextResponse.json({ success: true })
        }

        // Handle field updates (subject, deadline)
        const updates: { subject?: string; deadline?: string } = {}
        if (body.subject !== undefined) updates.subject = body.subject
        if (body.deadline !== undefined) updates.deadline = body.deadline

        if (Object.keys(updates).length === 0) {
            return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
        }

        await updateTicket(ticketId, orgId, updates)
        return NextResponse.json({ success: true })
    } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error'
        console.error('[TicketAPI] Failed to update ticket:', errMsg)

        if (errMsg.includes('must be') || errMsg.includes('cannot') || errMsg.includes('characters')) {
            return NextResponse.json({ error: errMsg }, { status: 400 })
        }

        return NextResponse.json({ error: 'Failed to update ticket' }, { status: 500 })
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ ticketId: string }> }
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

    const { ticketId } = await params

    // Validate ticket exists in user's org
    const ticket = await getTicketById(ticketId, orgId)
    if (!ticket) {
        return NextResponse.json({ error: 'Ticket not found in your organisation' }, { status: 404 })
    }

    try {
        await cancelTicket(ticketId, orgId)
        return NextResponse.json({ success: true })
    } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error'
        console.error('[TicketAPI] Failed to cancel ticket:', errMsg)
        return NextResponse.json({ error: 'Failed to cancel ticket' }, { status: 500 })
    }
}
