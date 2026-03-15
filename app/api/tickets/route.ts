import { NextRequest, NextResponse } from 'next/server'

export const preferredRegion = 'sin1'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCurrentUser } from '@/lib/user'
import { isRateLimited } from '@/lib/rate-limit'
import { getTicketsByOrg, createTicket } from '@/lib/ticket-service'
import { getOrgName } from '@/lib/vendor-service'
import { sendTicketAssignmentTemplate } from '@/lib/whatsapp'

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

    const tickets = await getTicketsByOrg(orgId)
    return NextResponse.json({ tickets })
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

    if (isRateLimited('ticket_create', currentUser.id, 20, 60_000)) {
        return NextResponse.json({ error: 'Too many requests. Please slow down.' }, { status: 429 })
    }

    const orgId = currentUser.organisation_id
    if (!orgId) {
        return NextResponse.json({ error: 'User has no organisation' }, { status: 400 })
    }

    const { vendor_id, subject, description, deadline } = body

    if (!vendor_id || typeof vendor_id !== 'string') {
        return NextResponse.json({ error: 'Missing required field: vendor_id' }, { status: 400 })
    }
    if (!subject || typeof subject !== 'string') {
        return NextResponse.json({ error: 'Missing required field: subject' }, { status: 400 })
    }

    try {
        const ticket = await createTicket({
            orgId,
            vendorId: vendor_id,
            subject,
            description,
            deadline,
            createdBy: currentUser.id,
            source: 'dashboard',
        })

        // Send WhatsApp notification to vendor
        try {
            const orgName = await getOrgName(orgId)
            const vendorPhone = ticket.vendor?.phone_number
            if (vendorPhone) {
                const vendorPhoneIntl = vendorPhone.startsWith('91') ? vendorPhone : `91${vendorPhone}`
                let deadlineStr = 'No deadline'
                if (ticket.deadline) {
                    const d = new Date(ticket.deadline)
                    deadlineStr = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
                }
                
                sendTicketAssignmentTemplate(
                    vendorPhoneIntl,
                    orgName,
                    ticket.subject || 'New Ticket',
                    currentUser.name || 'Team Member',
                    deadlineStr,
                    ticket.id
                ).catch((err: unknown) => console.error('[TicketAPI] Async template send error:', err))
            }
        } catch (err) {
            console.error('[TicketAPI] Failed to prepare ticket assignment template:', err)
        }

        // Audit log (fire-and-forget)
        const adminSupabase = createAdminClient()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(adminSupabase as any)
            .from('incoming_messages')
            .insert({
                phone: currentUser.phone_number,
                raw_text: `[AUDIT] ticket.created: ${ticket.id} for vendor ${vendor_id}`,
                processed: true,
                intent_type: 'ticket_create',
            })
            .then(() => { /* ignore */ })
            .catch((err: unknown) => console.error('[TicketAPI] Audit log error:', err))

        return NextResponse.json({ success: true, ticket })
    } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error'
        console.error('[TicketAPI] Failed to create ticket:', errMsg)

        // Return validation errors as 400
        if (errMsg.includes('not found') || errMsg.includes('must be') || errMsg.includes('required') || errMsg.includes('characters')) {
            return NextResponse.json({ error: errMsg }, { status: 400 })
        }

        return NextResponse.json({ error: 'Failed to create ticket. Please try again.' }, { status: 500 })
    }
}
