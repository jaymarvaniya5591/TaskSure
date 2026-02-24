import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
    sendWhatsAppMessage,
    sendSignupLinkTemplate,
    sendSigninLinkTemplate,
    sendJoinRequestPendingTemplate,
} from '@/lib/whatsapp'
import { generateAuthToken } from '@/lib/auth-links'
import { normalizePhone } from '@/lib/phone'

// Co-locate this function with Supabase (ap-southeast-1 / Singapore)
export const preferredRegion = 'sin1'

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
// In-memory known-users cache (10-minute TTL)
// Avoids a DB round-trip for every repeated message from the same user.
// ---------------------------------------------------------------------------
const KNOWN_USERS_TTL_MS = 10 * 60_000

interface CachedUser {
    id: string
    name: string
    organisation_id: string | null
    cachedAt: number
}

const knownUsersCache = new Map<string, CachedUser | null>()

/** Look up a user, checking cache first. Returns user or null. */
async function getCachedUser(
    phone10: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: any
): Promise<CachedUser | null> {
    const now = Date.now()
    const cached = knownUsersCache.get(phone10)

    if (cached !== undefined) {
        // Cache hit — check TTL
        if (cached === null || now - cached.cachedAt < KNOWN_USERS_TTL_MS) {
            return cached
        }
        // Expired — fall through to DB
        knownUsersCache.delete(phone10)
    }

    // Cache miss — query DB
    const { data: user } = await supabase
        .from('users')
        .select('id, name, phone_number, organisation_id')
        .eq('phone_number', phone10)
        .single()

    if (user) {
        const entry: CachedUser = {
            id: user.id,
            name: user.name,
            organisation_id: user.organisation_id,
            cachedAt: now,
        }
        knownUsersCache.set(phone10, entry)
        return entry
    }

    // Not registered — cache the negative result for a shorter time (60s)
    // so we re-check soon in case they sign up
    knownUsersCache.set(phone10, null)
    setTimeout(() => knownUsersCache.delete(phone10), 60_000)
    return null
}

// Periodically clean up expired cache entries (every 5 min)
setInterval(() => {
    const now = Date.now()
    const entries = Array.from(knownUsersCache.entries())
    for (const [phone, entry] of entries) {
        if (entry && now - entry.cachedAt >= KNOWN_USERS_TTL_MS) {
            knownUsersCache.delete(phone)
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
// Async webhook processor (optimised for speed)
// ---------------------------------------------------------------------------
async function processWebhook(body: Record<string, unknown>): Promise<void> {
    const t0 = Date.now()
    const supabase = createAdminClient()

        // 1. Log full raw payload — FIRE-AND-FORGET (non-critical)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ; (supabase as any)
            .from('incoming_messages')
            .insert({
                phone: '_raw_webhook_',
                raw_text: '_raw_payload_log_',
                payload: body,
            })
            .then(() => { /* ignore */ })
            .catch((err: unknown) => console.error('[Webhook] Error logging raw payload:', err))

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
                    button?: { text: string; payload: string }
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
                const buttonPayload = message.button?.payload ?? ''

                // --- Rate limiting ---
                if (isRateLimited(senderPhone10)) {
                    console.warn(`[Webhook] Rate limited: ${senderPhone10}`)
                    await sendWhatsAppMessage(rawSenderPhone, 'You are sending messages too quickly. Please wait a moment.')
                    continue
                }

                console.log('[Webhook] Message received:', { senderPhone10, messageType, messageId, textBody: textBody || null, buttonPayload: buttonPayload || null })

                // --- STEP 0: Handle Quick Reply button payloads ---
                if (messageType === 'button' && buttonPayload) {

                    // Scenario 3 payload: partner taps "Approve Request"
                    if (buttonPayload.startsWith('approve_join_request::')) {
                        const requestId = buttonPayload.replace('approve_join_request::', '')
                        console.log(`[Webhook] Quick Reply: approve join request ${requestId} from ${senderPhone10}`)

                        try {
                            const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://boldoai.in'
                            const res = await fetch(`${baseUrl}/api/auth/accept-join`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    requestId,
                                    action: 'accept',
                                    acceptorPhone: senderPhone10,
                                }),
                            })

                            if (res.ok) {
                                await sendWhatsAppMessage(rawSenderPhone, 'Request approved successfully.')
                            } else {
                                const errBody = await res.text()
                                console.error('[Webhook] Accept-join call failed:', errBody)
                                await sendWhatsAppMessage(rawSenderPhone, 'Could not process the approval. The request may have already been handled.')
                            }
                        } catch (err) {
                            console.error('[Webhook] Error calling accept-join:', err)
                            await sendWhatsAppMessage(rawSenderPhone, 'Something went wrong. Please try again.')
                        }

                        continue
                    }

                    // Scenario 4 payload: requester taps "Access Dashboard"
                    if (buttonPayload === 'trigger_signin') {
                        console.log(`[Webhook] Quick Reply: trigger signin for ${senderPhone10}`)

                        try {
                            const user = await getCachedUser(senderPhone10, supabase)

                            if (user) {
                                const tokenResult = await generateAuthToken(senderPhone10, 'signin', supabase)
                                if (tokenResult.success && tokenResult.token) {
                                    fetch(`https://${process.env.VERCEL_URL || 'www.boldoai.in'}/api/keep-warm`, { cache: 'no-store' }).catch(() => { })
                                    await sendSigninLinkTemplate(rawSenderPhone, user.name, tokenResult.token)
                                } else {
                                    await sendWhatsAppMessage(rawSenderPhone, 'Something went wrong. Please try again.')
                                }
                            } else {
                                await sendWhatsAppMessage(rawSenderPhone, 'Your account was not found. Please contact support.')
                            }
                        } catch (err) {
                            console.error('[Webhook] Error handling trigger_signin:', err)
                            await sendWhatsAppMessage(rawSenderPhone, 'Something went wrong. Please try again.')
                        }

                        continue
                    }

                    console.log(`[Webhook] Unknown button payload: ${buttonPayload}`)
                    continue
                }

                // --- EARLY TEXT CHECK: detect signin/login BEFORE DB lookup ---
                const normalizedText = textBody.replace(/\s+/g, '').toLowerCase()
                const isSignin = normalizedText === 'signin' || normalizedText === 'login'

                // --- STEP A: Check if sender is a registered user (cached) ---
                const tLookup = Date.now()
                const registeredUser = await getCachedUser(senderPhone10, supabase)
                console.log(`[Webhook] User lookup took ${Date.now() - tLookup}ms (cached=${knownUsersCache.has(senderPhone10)})`)

                // --- STEP B: UNREGISTERED USER → send signup link ---
                if (!registeredUser) {
                    console.log(`[Webhook] Unregistered user: ${senderPhone10}, sending signup link`)

                    try {
                        const tokenResult = await generateAuthToken(senderPhone10, 'signup', supabase)
                        if (tokenResult.success && tokenResult.token) {
                            await sendSignupLinkTemplate(rawSenderPhone, tokenResult.token)
                        } else {
                            await sendWhatsAppMessage(rawSenderPhone, 'Something went wrong. Please try again later.')
                        }
                    } catch (err) {
                        console.error('[Webhook] Error sending signup link:', err)
                    }

                    // Log as auth_signup — FIRE-AND-FORGET
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    ; (supabase as any)
                        .from('incoming_messages')
                        .insert({
                            phone: senderPhone10,
                            raw_text: textBody || `[${messageType}]`,
                            payload: body,
                            processed: true,
                            intent_type: 'auth_signup',
                        })
                        .then(() => { /* ignore */ })
                        .catch((logErr: unknown) => console.error('[Webhook] Error logging:', logErr))

                    console.log(`[Webhook] Total time: ${Date.now() - t0}ms`)
                    continue
                }

                // --- STEP C: REGISTERED USER + strict "signin" / "login" → FAST PATH ---
                if (isSignin) {
                    console.log(`[Webhook] Signin request from registered user: ${senderPhone10}`)

                    try {
                        // Generate token (reuse supabase client)
                        const tToken = Date.now()
                        const tokenResult = await generateAuthToken(senderPhone10, 'signin', supabase)
                        console.log(`[Webhook] Token generation took ${Date.now() - tToken}ms`)

                        if (tokenResult.success && tokenResult.token) {
                            // Fire-and-forget keep-warm
                            fetch(`https://${process.env.VERCEL_URL || 'www.boldoai.in'}/api/keep-warm`, { cache: 'no-store' }).catch(() => { })

                            // Send the signin link (this is the critical await)
                            const tSend = Date.now()
                            await sendSigninLinkTemplate(rawSenderPhone, registeredUser.name, tokenResult.token)
                            console.log(`[Webhook] Template send took ${Date.now() - tSend}ms`)
                        } else {
                            console.error('[Webhook] Token generation failed:', tokenResult.error)
                            await sendWhatsAppMessage(rawSenderPhone, 'Something went wrong. Please try again.')
                        }
                    } catch (err) {
                        console.error('[Webhook] Error sending signin link:', err)
                    }

                    // Log as auth_signin — FIRE-AND-FORGET (don't hold up response)
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    ; (supabase as any)
                        .from('incoming_messages')
                        .insert({
                            phone: senderPhone10,
                            raw_text: textBody || `[${messageType}]`,
                            payload: body,
                            processed: true,
                            intent_type: 'auth_signin',
                        })
                        .then(() => { /* ignore */ })
                        .catch((logErr: unknown) => console.error('[Webhook] Error logging:', logErr))

                    console.log(`[Webhook] Total signin time: ${Date.now() - t0}ms`)
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
                            await sendJoinRequestPendingTemplate(
                                rawSenderPhone,
                                req.requester_name,
                                req.requester_phone,
                                req.id
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
