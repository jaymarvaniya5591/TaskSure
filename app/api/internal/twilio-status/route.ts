import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { finalizeCallStatus } from '@/lib/notifications/task-notification-processor'

// Twilio webhooks are POST requests with form-data
export async function POST(request: NextRequest) {
    try {
        const formData = await request.formData()
        
        const callSid = formData.get('CallSid') as string
        const twilioStatus = formData.get('CallStatus') as string
        const durationVal = formData.get('DialCallDuration') || formData.get('CallDuration')
        const durationStr = durationVal ? durationVal.toString() : '0'
        const durationSeconds = parseInt(durationStr, 10)
        
        if (!callSid || !twilioStatus) {
            console.warn('[TwilioWebhook] Missing CallSid or CallStatus')
            return NextResponse.json({ error: 'Missing parameters' }, { status: 400 })
        }
        
        console.log(`[TwilioWebhook] Call ${callSid} finished with status ${twilioStatus} (${durationSeconds}s)`)
        
        // Map Twilio status to our internal system status
        let status: 'connected' | 'not_connected' | 'error' = 'error'
        if (twilioStatus === 'completed') {
            status = 'connected'
        } else if (['busy', 'no-answer', 'canceled'].includes(twilioStatus)) {
            status = 'not_connected'
        } else if (['failed'].includes(twilioStatus)) {
            status = 'error'
        }
        
        const supabase = createAdminClient()
        
        await finalizeCallStatus(
            supabase,
            callSid,
            status,
            durationSeconds,
            twilioStatus // pass the raw twilio status as errorReason if any
        )
        
        // Return empty TwiML response to acknowledge the webhook without taking further call actions
        return new NextResponse('<Response></Response>', {
            status: 200,
            headers: { 'Content-Type': 'text/xml' }
        })
        
    } catch (err) {
        console.error('[TwilioWebhook] Failed to process status callback:', err)
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}
