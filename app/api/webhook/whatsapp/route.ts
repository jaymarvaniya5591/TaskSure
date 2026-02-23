import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendWhatsAppMessage } from '@/lib/whatsapp'

// ---------------------------------------------------------------------------
// In-memory rate limiter: 30 messages per 60 seconds per sender phone number
// ---------------------------------------------------------------------------
const RATE_LIMIT_MAX = 30
const RATE_LIMIT_WINDOW_MS = 60_000

const rateLimitMap = new Map<
    string,
    { count: number; resetAt: number }
>()

function isRateLimited(phone: string): boolean {
    const now = Date.now()
    const entry = rateLimitMap.get(phone)

    if (!entry || now >= entry.resetAt) {
        rateLimitMap.set(phone, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
        return false
    }

    entry.count += 1
    return entry.count > RATE_LIMIT_MAX
}

// Periodically clean up stale entries to prevent memory leaks (every 5 min)
setInterval(() => {
    const now = Date.now()
    const keys = Array.from(rateLimitMap.keys())
    for (const phone of keys) {
        const entry = rateLimitMap.get(phone)
        if (entry && now >= entry.resetAt) {
            rateLimitMap.delete(phone)
        }
    }
}, 5 * 60_000)

// ---------------------------------------------------------------------------
// GET — Meta webhook verification
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams
    const mode = searchParams.get('hub.mode')
    const token = searchParams.get('hub.verify_token')
    const challenge = searchParams.get('hub.challenge')

    if (
        mode === 'subscribe' &&
        token === process.env.WHATSAPP_VERIFY_TOKEN
    ) {
        console.log('[Webhook] Verification successful')
        return new Response(challenge, { status: 200 })
    }

    console.warn('[Webhook] Verification failed — token mismatch or invalid mode')
    return new Response('Forbidden', { status: 403 })
}

// ---------------------------------------------------------------------------
// POST — Receive webhook events from WhatsApp Cloud API
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
    // Parse body immediately (needed before sending response)
    let body: Record<string, unknown>
    try {
        body = await request.json()
    } catch {
        console.error('[Webhook] Invalid JSON body')
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    // Await async processing — in Vercel Serverless, execution stops once response is returned
    try {
        await processWebhook(body)
    } catch (err) {
        console.error('[Webhook] Unhandled error in async processing:', err)
    }

    // Return 200 OK after processing completes
    return NextResponse.json({ status: 'ok' }, { status: 200 })
}

// ---------------------------------------------------------------------------
// Async webhook processor — runs after 200 OK is sent
// ---------------------------------------------------------------------------
async function processWebhook(body: Record<string, unknown>): Promise<void> {
    const supabase = createAdminClient()

    // 1. Log full raw payload to incoming_messages
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: logError } = await (supabase as any)
            .from('incoming_messages')
            .insert({
                phone: '_raw_webhook_',
                raw_text: '_raw_payload_log_',
                payload: body,
            })

        if (logError) {
            console.error('[Webhook] Failed to log raw payload:', logError.message)
        }
    } catch (err) {
        console.error('[Webhook] Error logging raw payload:', err)
    }

    // 2. Extract messages from Meta webhook body structure
    //
    // Meta webhook body format:
    // {
    //   "object": "whatsapp_business_account",
    //   "entry": [{
    //     "id": "...",
    //     "changes": [{
    //       "value": {
    //         "messaging_product": "whatsapp",
    //         "metadata": { "display_phone_number": "...", "phone_number_id": "..." },
    //         "messages": [{ "from": "919876543210", "id": "wamid.xxx", "type": "text", "text": { "body": "..." } }]
    //       },
    //       "field": "messages"
    //     }]
    //   }]
    // }

    if (body.object !== 'whatsapp_business_account') {
        console.log('[Webhook] Ignoring non-WhatsApp event:', body.object)
        return
    }

    const entries = body.entry as Array<{
        id: string
        changes: Array<{
            value: {
                messaging_product: string
                metadata: { display_phone_number: string; phone_number_id: string }
                messages?: Array<{
                    from: string
                    id: string
                    timestamp: string
                    type: string
                    text?: { body: string }
                }>
                statuses?: unknown[]
            }
            field: string
        }>
    }> | undefined

    if (!entries || !Array.isArray(entries)) {
        console.log('[Webhook] No entries in body')
        return
    }

    for (const entry of entries) {
        if (!entry.changes || !Array.isArray(entry.changes)) continue

        for (const change of entry.changes) {
            if (change.field !== 'messages') continue

            const messages = change.value?.messages
            if (!messages || !Array.isArray(messages)) continue

            for (const message of messages) {
                const senderPhone = message.from
                const messageType = message.type   // text, audio, image, etc.
                const messageId = message.id

                // --- Rate limiting ---
                if (isRateLimited(senderPhone)) {
                    console.warn(
                        `[Webhook] Rate limited: ${senderPhone} (>${RATE_LIMIT_MAX} msgs/min)`
                    )
                    await sendWhatsAppMessage(
                        senderPhone,
                        'You are sending messages too quickly. Please wait a moment.'
                    )
                    continue // skip further processing for this message
                }

                // --- Log extracted info ---
                console.log('[Webhook] Message received:', {
                    senderPhone,
                    messageType,
                    messageId,
                    textBody: message.text?.body ?? null,
                })

                // --- Log structured data to incoming_messages ---
                try {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const { data: insertedMsg, error: insertError } = await (supabase as any)
                        .from('incoming_messages')
                        .insert({
                            phone: senderPhone,
                            raw_text: message.text?.body ?? `[${messageType}]`,
                            payload: body,
                        })
                        .select('id')
                        .single()

                    if (insertError) {
                        console.error(
                            '[Webhook] Failed to log message:',
                            insertError.message
                        )
                        // Send user-facing error via WhatsApp
                        await sendWhatsAppMessage(
                            senderPhone,
                            'Something went wrong. Please try again.'
                        )
                    } else if (insertedMsg?.id) {
                        // Fire-and-forget to the internal processor
                        fetch('https://boldoai.in/api/internal/process-message', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'x-internal-secret': process.env.INTERNAL_PROCESSOR_SECRET || '',
                            },
                            body: JSON.stringify({ messageId: insertedMsg.id }),
                        }).catch((err) => {
                            console.error('[Webhook] Failed to trigger internal processor:', err)
                        })
                    }
                } catch (err) {
                    console.error('[Webhook] Error inserting message:', err)
                    try {
                        await sendWhatsAppMessage(
                            senderPhone,
                            'Something went wrong. Please try again.'
                        )
                    } catch (sendErr) {
                        console.error(
                            '[Webhook] Failed to send error message to user:',
                            sendErr
                        )
                    }
                }
            }
        }
    }
}
