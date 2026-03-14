/**
 * Ticket Service — Central business logic for ticket operations.
 *
 * Consumed by API routes and (future) WhatsApp bot handlers.
 * All DB operations use the admin client (service role key).
 *
 * Note: Supabase types don't include ticket tables yet (pre-migration),
 * so we cast the client to `any` for ticket table queries.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import type { Ticket } from '@/lib/types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseAdmin = any

// ---------------------------------------------------------------------------
// Ticket queries
// ---------------------------------------------------------------------------

/**
 * List tickets for an org, joined with vendor data.
 * Excludes cancelled tickets by default.
 */
export async function getTicketsByOrg(orgId: string): Promise<Ticket[]> {
    const sb: SupabaseAdmin = createAdminClient()
    const { data, error } = await sb
        .from('tickets')
        .select(`
            *,
            vendor:org_vendors!vendor_id (
                id,
                name,
                phone_number,
                status
            )
        `)
        .eq('organisation_id', orgId)
        .neq('status', 'cancelled')
        .order('created_at', { ascending: false })

    if (error) {
        console.error('[TicketService] getTicketsByOrg error:', error.message)
        return []
    }

    return (data as Ticket[]) || []
}

/**
 * Get a single ticket by ID, org-scoped.
 */
export async function getTicketById(
    ticketId: string,
    orgId: string
): Promise<Ticket | null> {
    const sb: SupabaseAdmin = createAdminClient()
    const { data } = await sb
        .from('tickets')
        .select(`
            *,
            vendor:org_vendors!vendor_id (
                id,
                name,
                phone_number,
                status
            )
        `)
        .eq('id', ticketId)
        .eq('organisation_id', orgId)
        .single()

    return (data as Ticket) || null
}

/**
 * Create a new ticket.
 */
export async function createTicket(params: {
    orgId: string
    vendorId: string
    subject: string
    description?: string
    deadline?: string
    createdBy: string
    source?: 'whatsapp' | 'dashboard'
}): Promise<Ticket> {
    const sb: SupabaseAdmin = createAdminClient()

    // Validate vendor is active in org
    const { data: vendor } = await sb
        .from('org_vendors')
        .select('id, status')
        .eq('id', params.vendorId)
        .eq('organisation_id', params.orgId)
        .single()

    if (!vendor) {
        throw new Error('Vendor not found in your organisation')
    }
    if (vendor.status !== 'active') {
        throw new Error('Vendor must be active to create a ticket')
    }

    // Validate subject
    if (!params.subject || params.subject.trim().length === 0) {
        throw new Error('Subject is required')
    }
    if (params.subject.length > 200) {
        throw new Error('Subject must be 200 characters or less')
    }

    // Validate deadline is in the future
    if (params.deadline) {
        const deadlineDate = new Date(params.deadline)
        if (deadlineDate <= new Date()) {
            throw new Error('Deadline must be in the future')
        }
    }

    const { data: ticket, error } = await sb
        .from('tickets')
        .insert({
            organisation_id: params.orgId,
            vendor_id: params.vendorId,
            subject: params.subject.trim(),
            description: params.description?.trim() || null,
            deadline: params.deadline || null,
            status: 'pending',
            created_by: params.createdBy,
            source: params.source || 'dashboard',
        })
        .select(`
            *,
            vendor:org_vendors!vendor_id (
                id,
                name,
                phone_number,
                status
            )
        `)
        .single()

    if (error || !ticket) {
        throw new Error(`Failed to create ticket: ${error?.message}`)
    }

    return ticket as Ticket
}

/**
 * Update a ticket's subject and/or deadline.
 */
export async function updateTicket(
    ticketId: string,
    orgId: string,
    updates: { subject?: string; deadline?: string }
): Promise<void> {
    const sb: SupabaseAdmin = createAdminClient()

    const updateData: Record<string, unknown> = {}

    if (updates.subject !== undefined) {
        if (!updates.subject.trim()) {
            throw new Error('Subject cannot be empty')
        }
        if (updates.subject.length > 200) {
            throw new Error('Subject must be 200 characters or less')
        }
        updateData.subject = updates.subject.trim()
    }

    if (updates.deadline !== undefined) {
        if (updates.deadline) {
            const deadlineDate = new Date(updates.deadline)
            if (deadlineDate <= new Date()) {
                throw new Error('Deadline must be in the future')
            }
        }
        updateData.deadline = updates.deadline || null
    }

    if (Object.keys(updateData).length === 0) {
        throw new Error('No fields to update')
    }

    const { error } = await sb
        .from('tickets')
        .update(updateData)
        .eq('id', ticketId)
        .eq('organisation_id', orgId)

    if (error) {
        throw new Error(`Failed to update ticket: ${error.message}`)
    }
}

/**
 * Mark a ticket as completed.
 */
export async function completeTicket(
    ticketId: string,
    orgId: string
): Promise<void> {
    const sb: SupabaseAdmin = createAdminClient()

    const { error } = await sb
        .from('tickets')
        .update({ status: 'completed' })
        .eq('id', ticketId)
        .eq('organisation_id', orgId)

    if (error) {
        throw new Error(`Failed to complete ticket: ${error.message}`)
    }
}

/**
 * Cancel a ticket (soft delete).
 */
export async function cancelTicket(
    ticketId: string,
    orgId: string
): Promise<void> {
    const sb: SupabaseAdmin = createAdminClient()

    const { error } = await sb
        .from('tickets')
        .update({ status: 'cancelled' })
        .eq('id', ticketId)
        .eq('organisation_id', orgId)

    if (error) {
        throw new Error(`Failed to cancel ticket: ${error.message}`)
    }
}

/**
 * Check if a ticket is overdue (client-side helper).
 */
export function isTicketOverdue(ticket: Ticket): boolean {
    if (!ticket.deadline) return false
    if (!['pending', 'accepted'].includes(ticket.status)) return false
    return new Date(ticket.deadline) < new Date()
}
