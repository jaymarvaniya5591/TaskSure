import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendWhatsAppMessage } from '@/lib/whatsapp'
import { generateAuthToken, buildAuthUrl, TEST_PHONE_OVERRIDE } from '@/lib/auth-links'
import { normalizePhone } from '@/lib/phone'

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
    let body: Record<string, unknown>
    try {
        body = await request.json()
    } catch {
        console.error('[Webhook] Invalid JSON body')
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    try {
        await processWebhook(body)
    } catch (err) {
        console.error('[Webhook] Unhandled error in async processing:', err)
    }

    return NextResponse.json({ status: 'ok' }, { status: 200 })
}

// ---------------------------------------------------------------------------
// Async webhook processor
// ---------------------------------------------------------------------------
async function processWebhook(body: Record<string, unknown>): Promise<void> {
    const supabase = createAdminClient()

    // 1. Log full raw payload
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase as any)
            .from('incoming_messages')
            .insert({
                phone: '_raw_webhook_',
                raw_text: '_raw_payload_log_',
                payload: body,
            })
    } catch (err) {
        console.error('[Webhook] Error logging raw payload:', err)
    }

    // 2. Extract messages
    if (body.object !== 'whatsapp_business_account') return

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

    if (!entries || !Array.isArray(entries)) return

    for (const entry of entries) {
        if (!entry.changes || !Array.isArray(entry.changes)) continue

        for (const change of entry.changes) {
            if (change.field !== 'messages') continue

            const messages = change.value?.messages
            if (!messages || !Array.isArray(messages)) continue

            for (const message of messages) {
                const rawSenderPhone = message.from // e.g. "919727731867"
                const senderPhone10 = normalizePhone(rawSenderPhone) // e.g. "9727731867"
                const messageType = message.type
                const messageId = message.id
                const textBody = message.text?.body ?? ''

                // --- Rate limiting ---
                if (isRateLimited(senderPhone10)) {
                    console.warn(`[Webhook] Rate limited: ${senderPhone10}`)
                    await sendWhatsAppMessage(rawSenderPhone, 'You are sending messages too quickly. Please wait a moment.')
                    continue
                }

                console.log('[Webhook] Message received:', { senderPhone10, messageType, messageId, textBody: textBody || null })

                // --- STEP A: Check if sender is a registered user (10-digit lookup) ---
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const { data: registeredUser } = await (supabase as any)
                    .from('users')
                    .select('id, name, phone_number, organisation_id')
                    .eq('phone_number', senderPhone10)
                    .single()

                // --- STEP B: UNREGISTERED USER → send signup link ---
                if (!registeredUser) {
                    console.log(`[Webhook] Unregistered user: ${senderPhone10}, sending signup link`)

                    try {
                        const tokenResult = await generateAuthToken(senderPhone10, 'signup')
                        if (tokenResult.success && tokenResult.token) {
                            const signupUrl = buildAuthUrl(tokenResult.token)

                            // ⚠️ TEST MODE: Send to test phone (raw format for WhatsApp API)
                            const sendTo = `91${TEST_PHONE_OVERRIDE}`

                            await sendWhatsAppMessage(
                                sendTo,
                                `👋 Welcome to Boldo AI!\n\nYour number is not registered yet. Click the link below to sign up:\n\n${signupUrl}\n\nThis link expires in 15 minutes.`
                            )
                        } else {
                            await sendWhatsAppMessage(rawSenderPhone, 'Something went wrong. Please try again later.')
                        }
                    } catch (err) {
                        console.error('[Webhook] Error sending signup link:', err)
                    }

                    // Log as auth_signup
                    try {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        await (supabase as any)
                            .from('incoming_messages')
                            .insert({
                                phone: senderPhone10,
                                raw_text: textBody || `[${messageType}]`,
                                payload: body,
                                processed: true,
                                intent_type: 'auth_signup',
                            })
                    } catch (logErr) {
                        console.error('[Webhook] Error logging:', logErr)
                    }

                    continue
                }

                // --- STEP C: REGISTERED USER + strict "signin" / "login" → send dashboard link ---
                const normalizedText = textBody.replace(/\s+/g, '').toLowerCase()
                const isSignin = normalizedText === 'signin' || normalizedText === 'login'

                if (isSignin) {
                    console.log(`[Webhook] Signin request from registered user: ${senderPhone10}`)

                    try {
                        const tokenResult = await generateAuthToken(senderPhone10, 'signin')
                        if (tokenResult.success && tokenResult.token) {
                            const signinUrl = buildAuthUrl(tokenResult.token)

                            // ⚠️ TEST MODE: Send to test phone
                            const sendTo = `91${TEST_PHONE_OVERRIDE}`

                            await sendWhatsAppMessage(
                                sendTo,
                                `👋 Welcome back, ${registeredUser.name}!\n\n(You already have an account with us.)\n\nClick below to access your dashboard:\n\n${signinUrl}\n\nThis link expires in 15 minutes.`
                            )
                        } else {
                            console.error('[Webhook] Token generation failed:', tokenResult.error)
                            await sendWhatsAppMessage(rawSenderPhone, 'Something went wrong. Please try again.')
                        }
                    } catch (err) {
                        console.error('[Webhook] Error sending signin link:', err)
                    }

                    // Log as auth_signin
                    try {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        await (supabase as any)
                            .from('incoming_messages')
                            .insert({
                                phone: senderPhone10,
                                raw_text: textBody || `[${messageType}]`,
                                payload: body,
                                processed: true,
                                intent_type: 'auth_signin',
                            })
                    } catch (logErr) {
                        console.error('[Webhook] Error logging:', logErr)
                    }

                    continue
                }

                // --- STEP D: Check for pending join requests ---
                try {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const { data: pendingRequests } = await (supabase as any)
                        .from('join_requests')
                        .select('id, requester_name, requester_phone')
                        .eq('partner_phone', senderPhone10)
                        .eq('status', 'pending')

                    if (pendingRequests && pendingRequests.length > 0) {
                        for (const req of pendingRequests) {
                            const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://boldoai.in'
                            const approveUrl = `${baseUrl}/join-request?id=${req.id}&action=accept`

                            const sendTo = `91${TEST_PHONE_OVERRIDE}`
                            await sendWhatsAppMessage(
                                sendTo,
                                `📩 Join Request\n\n${req.requester_name} (${req.requester_phone}) wants to join your company.\n\nApprove: ${approveUrl}`
                            )
                        }
                    }
                } catch (err) {
                    console.error('[Webhook] Error checking join requests:', err)
                }

                // --- STEP E: REGISTERED USER + normal message → AI processor ---
                try {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const { data: insertedMsg, error: insertError } = await (supabase as any)
                        .from('incoming_messages')
                        .insert({
                            phone: senderPhone10,
                            raw_text: textBody || `[${messageType}]`,
                            payload: body,
                        })
                        .select('id')
                        .single()

                    if (insertError) {
                        console.error('[Webhook] Failed to log message:', insertError.message)
                        await sendWhatsAppMessage(rawSenderPhone, 'Something went wrong. Please try again.')
                    } else if (insertedMsg?.id) {
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
                        await sendWhatsAppMessage(rawSenderPhone, 'Something went wrong. Please try again.')
                    } catch (sendErr) {
                        console.error('[Webhook] Failed to send error message:', sendErr)
                    }
                }
            }
        }
    }
}
