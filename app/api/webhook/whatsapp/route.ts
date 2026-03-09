import { NextRequest, NextResponse } from 'next/server'


import { createAdminClient } from '@/lib/supabase/admin'
import {
    sendWhatsAppMessage,
    sendSignupLinkTemplate,
    sendSigninLinkTemplate,
    sendTaskManagerFlowTemplate,
} from '@/lib/whatsapp'
import { generateAuthToken } from '@/lib/auth-links'
import { normalizePhone } from '@/lib/phone'
import { processMessageInline } from '@/app/api/internal/process-message/route'
import { createSession } from '@/lib/ai/conversation-context'

// Co-locate this function with Supabase (ap-southeast-1 / Singapore)
export const preferredRegion = 'sin1'

// Allow up to 60s for the full AI pipeline (audio download + Sarvam + Gemini x2)
export const maxDuration = 60

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
// In-memory message deduplication (5-minute TTL)
// Meta retries webhooks if we are slow. This prevents processing the same
// WhatsApp message ID twice, which would create duplicate sessions/tasks.
// ---------------------------------------------------------------------------
const DEDUP_TTL_MS = 5 * 60_000
const processedMessageIds = new Map<string, number>() // messageId → timestamp

function isAlreadyProcessed(messageId: string): boolean {
    const seenAt = processedMessageIds.get(messageId)
    if (seenAt !== undefined && Date.now() - seenAt < DEDUP_TTL_MS) return true
    processedMessageIds.set(messageId, Date.now())
    return false
}

// Evict expired dedup entries every 5 min alongside the rate-limit cleanup
setInterval(() => {
    const cutoff = Date.now() - DEDUP_TTL_MS
    for (const [id, ts] of Array.from(processedMessageIds.entries())) {
        if (ts < cutoff) processedMessageIds.delete(id)
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

const knownUsersCache = new Map<string, CachedUser>()

/** Look up a user, checking cache first. Returns user or null. */
async function getCachedUser(
    phone10: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: any,
    forceDbCheck: boolean = false
): Promise<CachedUser | null> {
    const now = Date.now()
    const cached = knownUsersCache.get(phone10)

    if (!forceDbCheck && cached !== undefined) {
        // Cache hit — check TTL (only positive results are cached)
        if (now - cached.cachedAt < KNOWN_USERS_TTL_MS) {
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

    // Not registered — do NOT cache negative results.
    // This ensures that if the user signs up, the very next message
    // will find them in the DB without any stale-cache issues.
    return null
}

// Periodically clean up expired cache entries (every 5 min)
setInterval(() => {
    const now = Date.now()
    const entries = Array.from(knownUsersCache.entries())
    for (const [phone, entry] of entries) {
        if (now - entry.cachedAt >= KNOWN_USERS_TTL_MS) {
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
                    audio?: { id: string; mime_type: string }
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
            // Check for message delivery status updates (e.g., failed deliveries from Meta)
            if (change.field === 'messages' && change.value?.statuses) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                for (const statusObj of change.value.statuses as any[]) {
                    if (statusObj.status === 'failed') {
                        console.error('[Webhook] Template delivery FAILED:', JSON.stringify(statusObj));
                        // Log to DB for persistent tracking
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        ; (supabase as any)
                            .from('incoming_messages')
                            .insert({
                                phone: statusObj.recipient_id || 'unknown',
                                raw_text: `[STATUS] FAILED: ${JSON.stringify(statusObj.errors)}`,
                                payload: statusObj,
                                processed: true,
                            })
                            .then(() => { })
                            .catch((err: unknown) => console.error('[Webhook] Failed to log status error:', err));
                    }
                }
            }

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
                    await sendWhatsAppMessage(rawSenderPhone, '⏳ *Slow Down!*\n\nYou\'re sending messages too quickly.\nPlease wait a moment before trying again.')
                    continue
                }

                // --- Deduplication (Meta retries on slow responses) ---
                if (messageId && isAlreadyProcessed(messageId)) {
                    console.warn(`[Webhook] Duplicate message skipped: ${messageId}`)
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
                                await sendWhatsAppMessage(rawSenderPhone, '✅ *Request Approved!*\n\nThe join request has been approved successfully.')
                            } else {
                                const errBody = await res.text()
                                console.error('[Webhook] Accept-join call failed:', errBody)
                                await sendWhatsAppMessage(rawSenderPhone, '⚠️ *Could Not Approve*\n\nThis request may have already been handled.\nPlease check and try again.')
                            }
                        } catch (err) {
                            console.error('[Webhook] Error calling accept-join:', err)
                            await sendWhatsAppMessage(rawSenderPhone, '❌ *Error*\n\nSomething went wrong.\nPlease try again.')
                        }

                        continue
                    }

                    // Scenario 4 payload: requester taps "Access Dashboard"
                    if (buttonPayload === 'trigger_signin') {
                        console.log(`[Webhook] Quick Reply: trigger signin for ${senderPhone10}`)

                        try {
                            const user = await getCachedUser(senderPhone10, supabase, true)

                            if (user) {
                                const tokenResult = await generateAuthToken(senderPhone10, 'signin', supabase)
                                if (tokenResult.success && tokenResult.token) {
                                    await sendSigninLinkTemplate(rawSenderPhone, user.name, tokenResult.token)
                                } else {
                                    await sendWhatsAppMessage(rawSenderPhone, '❌ *Error*\n\nSomething went wrong.\nPlease try again.')
                                }
                            } else {
                                await sendWhatsAppMessage(rawSenderPhone, '🔍 *Account Not Found*\n\nWe couldn\'t find your account.\nPlease contact support.')
                            }
                        } catch (err) {
                            console.error('[Webhook] Error handling trigger_signin:', err)
                            await sendWhatsAppMessage(rawSenderPhone, '❌ *Error*\n\nSomething went wrong.\nPlease try again.')
                        }

                        continue
                    }

                    // Scenario 5 payload: assignee taps "Accept" on task assignment
                    if (buttonPayload.startsWith('task_accept_prompt::')) {
                        const taskId = buttonPayload.replace('task_accept_prompt::', '')
                        console.log(`[Webhook] Quick Reply: task_accept_prompt ${taskId} from ${senderPhone10}`)

                        try {
                            // Check task status before creating session
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            const { data: task } = await (supabase as any)
                                .from('tasks')
                                .select('status')
                                .eq('id', taskId)
                                .single()

                            if (!task) {
                                await sendWhatsAppMessage(rawSenderPhone, '⚠️ *Task Not Found*\n\nThis task could not be found.\n\n_It may have been deleted._')
                                continue
                            }

                            if (task.status !== 'pending') {
                                await sendWhatsAppMessage(rawSenderPhone, 'ℹ️ *Already Handled*\n\nThis task has already been ' + (task.status === 'accepted' ? 'accepted' : task.status === 'cancelled' ? 'rejected' : task.status) + '.\n\n_No further action is needed._')
                                continue
                            }

                            // Run session creation + WA message in parallel — message text is fixed
                            // regardless of session outcome. Session errors are caught independently.
                            await Promise.all([
                                createSession(senderPhone10, 'awaiting_accept_deadline', {
                                    task_id: taskId,
                                    original_intent: 'task_accept',
                                }, 10, supabase).catch((err: unknown) => console.error('[Webhook] Failed to create accept session:', err)),
                                sendWhatsAppMessage(
                                    rawSenderPhone,
                                    '🎯 *When Can You Complete This?*\n\nPlease reply with a date.\n\n*Examples:*\n"tomorrow", "Friday", "Feb 28"'
                                ),
                            ])
                        } catch (err) {
                            console.error('[Webhook] Error in task_accept_prompt:', err)
                        }

                        continue
                    }

                    // Scenario 5 payload: assignee taps "Reject" on task assignment
                    if (buttonPayload.startsWith('task_reject_prompt::')) {
                        const taskId = buttonPayload.replace('task_reject_prompt::', '')
                        console.log(`[Webhook] Quick Reply: task_reject_prompt ${taskId} from ${senderPhone10}`)

                        try {
                            // Check task status before creating session
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            const { data: task } = await (supabase as any)
                                .from('tasks')
                                .select('status')
                                .eq('id', taskId)
                                .single()

                            if (!task) {
                                await sendWhatsAppMessage(rawSenderPhone, '⚠️ *Task Not Found*\n\nThis task could not be found.\n\n_It may have been deleted._')
                                continue
                            }

                            if (task.status !== 'pending') {
                                await sendWhatsAppMessage(rawSenderPhone, 'ℹ️ *Already Handled*\n\nThis task has already been ' + (task.status === 'accepted' ? 'accepted' : task.status === 'cancelled' ? 'rejected' : task.status) + '.\n\n_No further action is needed._')
                                continue
                            }

                            // Run session creation + WA message in parallel — message text is fixed
                            // regardless of session outcome. Session errors are caught independently.
                            await Promise.all([
                                createSession(senderPhone10, 'awaiting_reject_reason', {
                                    task_id: taskId,
                                    original_intent: 'task_reject',
                                }, 10, supabase).catch((err: unknown) => console.error('[Webhook] Failed to create reject session:', err)),
                                sendWhatsAppMessage(
                                    rawSenderPhone,
                                    '📝 *Reason Required*\n\nPlease reply with a brief reason for rejecting this task.\n\n_I\'ll pass it along to the task owner._'
                                ),
                            ])
                        } catch (err) {
                            console.error('[Webhook] Error in task_reject_prompt:', err)
                        }

                        continue
                    }

                    // Stage 2 payload: assignee taps "Going Well" on progress check
                    if (buttonPayload.startsWith('task_going_well::')) {
                        const taskId = buttonPayload.replace('task_going_well::', '')
                        console.log(`[Webhook] Quick Reply: task_going_well ${taskId} from ${senderPhone10}`)

                        // Mark the reminder notification as acknowledged
                        try {
                            // Check task status first — must validate before acting
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            const { data: taskCheck } = await (supabase as any)
                                .from('tasks')
                                .select('status')
                                .eq('id', taskId)
                                .single()

                            if (!taskCheck) {
                                await sendWhatsAppMessage(rawSenderPhone, '⚠️ *Task Not Found*\n\nThis task could not be found.\n\n_It may have been deleted._')
                                continue
                            }

                            if (['completed', 'cancelled'].includes(taskCheck.status)) {
                                await sendWhatsAppMessage(rawSenderPhone, 'ℹ️ *Task Already ' + (taskCheck.status === 'completed' ? 'Completed' : 'Cancelled') + '*\n\nThis task is already ' + taskCheck.status + '.\n\n_No further action is needed._')
                                continue
                            }

                            // Run all 3 operations in parallel — the WA send (~200ms) dominates,
                            // so the DB ops complete within that window at no extra cost.
                            await Promise.all([
                                // Branch A: acknowledge reminder notification (select → conditional update, sequential within branch)
                                (async () => {
                                    try {
                                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                        const { data: reminderNotifs } = await (supabase as any)
                                            .from('task_notifications')
                                            .select('id, metadata')
                                            .eq('task_id', taskId)
                                            .eq('stage', 'reminder')
                                            .eq('channel', 'whatsapp')
                                            .eq('status', 'sent')
                                            .order('sent_at', { ascending: false })
                                            .limit(1)

                                        if (reminderNotifs && reminderNotifs.length > 0) {
                                            const notif = reminderNotifs[0]
                                            const updatedMetadata = { ...(notif.metadata || {}), acknowledged: true, acknowledged_at: new Date().toISOString() }
                                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                            await (supabase as any)
                                                .from('task_notifications')
                                                .update({ metadata: updatedMetadata, updated_at: new Date().toISOString() })
                                                .eq('id', notif.id)
                                        }
                                    } catch (ackErr) {
                                        console.error('[Webhook] Error acknowledging reminder notification:', ackErr)
                                    }
                                })(),
                                // Branch B: cancel pending call escalations (independent of Branch A)
                                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                (supabase as any)
                                    .from('task_notifications')
                                    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
                                    .eq('task_id', taskId)
                                    .eq('stage', 'reminder')
                                    .eq('channel', 'call')
                                    .eq('status', 'pending'),
                                // Branch C: send "Noted!" message (independent — doesn't need DB results)
                                sendWhatsAppMessage(rawSenderPhone, '👍 *Noted!*\n\nThings are on track.\n_Keep it up!_'),
                            ])
                        } catch (err) {
                            console.error('[Webhook] Error acknowledging reminder:', err)
                        }

                        continue
                    }

                    // Stage 2/3a payload: assignee taps "Edit Deadline" on task reminder or deadline approaching
                    if (buttonPayload.startsWith('task_edit_deadline_prompt::')) {
                        const taskId = buttonPayload.replace('task_edit_deadline_prompt::', '')
                        console.log(`[Webhook] Quick Reply: task_edit_deadline_prompt ${taskId} from ${senderPhone10}`)

                        try {
                            // Check task status before creating session
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            const { data: task } = await (supabase as any)
                                .from('tasks')
                                .select('status')
                                .eq('id', taskId)
                                .single()

                            if (!task) {
                                await sendWhatsAppMessage(rawSenderPhone, '⚠️ *Task Not Found*\n\nThis task could not be found.\n\n_It may have been deleted._')
                                continue
                            }

                            if (['completed', 'cancelled'].includes(task.status)) {
                                await sendWhatsAppMessage(rawSenderPhone, 'ℹ️ *Cannot Edit*\n\nThis task is already ' + task.status + '.\n\n_The deadline cannot be changed._')
                                continue
                            }

                            // Run session creation + WA message in parallel — message text is fixed
                            // regardless of session outcome. Session errors are caught independently.
                            await Promise.all([
                                createSession(senderPhone10, 'awaiting_edit_deadline', {
                                    task_id: taskId,
                                    original_intent: 'edit_deadline',
                                }, 10, supabase).catch((err: unknown) => console.error('[Webhook] Failed to create edit deadline session:', err)),
                                sendWhatsAppMessage(
                                    rawSenderPhone,
                                    '📅 *New Deadline?*\n\nPlease reply with a new date.\n\n*Examples:*\n"tomorrow", "Friday", "March 10"'
                                ),
                            ])
                        } catch (err) {
                            console.error('[Webhook] Error in task_edit_deadline_prompt:', err)
                        }

                        continue
                    }

                    // To-Do payload: owner taps "Edit Deadline" on to-do deadline approaching
                    if (buttonPayload.startsWith('todo_edit_deadline_prompt::')) {
                        const taskId = buttonPayload.replace('todo_edit_deadline_prompt::', '')
                        console.log(`[Webhook] Quick Reply: todo_edit_deadline_prompt ${taskId} from ${senderPhone10}`)

                        try {
                            // Check task status before creating session
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            const { data: task } = await (supabase as any)
                                .from('tasks')
                                .select('status')
                                .eq('id', taskId)
                                .single()

                            if (!task) {
                                await sendWhatsAppMessage(rawSenderPhone, '⚠️ *Task Not Found*\n\nThis task could not be found.\n\n_It may have been deleted._')
                                continue
                            }

                            if (['completed', 'cancelled'].includes(task.status)) {
                                await sendWhatsAppMessage(rawSenderPhone, 'ℹ️ *Cannot Edit*\n\nThis to-do is already ' + task.status + '.\n\n_The deadline cannot be changed._')
                                continue
                            }

                            // Run session creation + WA message in parallel — message text is fixed
                            // regardless of session outcome. Session errors are caught independently.
                            await Promise.all([
                                createSession(senderPhone10, 'awaiting_edit_deadline', {
                                    task_id: taskId,
                                    original_intent: 'edit_deadline',
                                }, 10, supabase).catch((err: unknown) => console.error('[Webhook] Failed to create todo edit deadline session:', err)),
                                sendWhatsAppMessage(
                                    rawSenderPhone,
                                    '📅 *New Deadline?*\n\nPlease reply with a new date.\n\n*Examples:*\n"tomorrow", "Friday", "March 10"'
                                ),
                            ])
                        } catch (err) {
                            console.error('[Webhook] Error in todo_edit_deadline_prompt:', err)
                        }

                        continue
                    }

                    // Stage 3 payload: owner taps "Mark Completed" on overdue notification
                    if (buttonPayload.startsWith('task_mark_completed::')) {
                        const taskId = buttonPayload.replace('task_mark_completed::', '')
                        console.log(`[Webhook] Quick Reply: task_mark_completed ${taskId} from ${senderPhone10}`)

                        try {
                            // Phase 1: Fetch task — needed for validation + notification content
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            const { data: task } = await (supabase as any)
                                .from('tasks')
                                .select('title, assigned_to, created_by, status')
                                .eq('id', taskId)
                                .single()

                            if (!task) {
                                await sendWhatsAppMessage(rawSenderPhone, '⚠️ *Task Not Found*\n\nThis task could not be found.\n\n_It may have been deleted._')
                                continue
                            }

                            if (['completed', 'cancelled'].includes(task.status)) {
                                await sendWhatsAppMessage(rawSenderPhone, 'ℹ️ *Already Handled*\n\nThis task is already completed or cancelled.')
                                continue
                            }

                            // Phase 2: Parallel — update task + cancel notifications + prefetch other user.
                            // All three only need data already available from Phase 1.
                            /* eslint-disable @typescript-eslint/no-explicit-any */
                            const [updateResult, , otherUserResult] = await Promise.all([
                                // A: Mark task completed — Bug 1.2: guard with status check to prevent
                                // a race where admin deletes the task between our preflight fetch and
                                // this write. Without .in(), a cancelled task can be revived as 'completed'.
                                (supabase as any)
                                    .from('tasks')
                                    .update({ status: 'completed', updated_at: new Date().toISOString() })
                                    .eq('id', taskId)
                                    .in('status', ['accepted', 'overdue'])
                                    .select('id'),
                                // B: Cancel remaining escalation notifications
                                (supabase as any)
                                    .from('task_notifications')
                                    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
                                    .eq('task_id', taskId)
                                    .eq('status', 'pending'),
                                // C: Prefetch other user's contact info (skip for self-todos)
                                task.assigned_to !== task.created_by
                                    ? (async () => {
                                        try {
                                            const sender = await getCachedUser(senderPhone10, supabase)
                                            const isOwner = sender && sender.id === task.created_by
                                            const otherUserId = isOwner ? task.assigned_to : task.created_by
                                            const { data: otherUser } = await (supabase as any)
                                                .from('users')
                                                .select('phone_number, name')
                                                .eq('id', otherUserId)
                                                .single()
                                            return { sender, otherUser, isOwner }
                                        } catch {
                                            return null
                                        }
                                    })()
                                    : Promise.resolve(null),
                            ])
                            /* eslint-enable @typescript-eslint/no-explicit-any */

                            // Bug 1.2: Zero rows = task was deleted or status changed between
                            // the preflight check and this write (complete vs. delete race)
                            if (!updateResult.error && (!updateResult.data || updateResult.data.length === 0)) {
                                await sendWhatsAppMessage(rawSenderPhone, 'ℹ️ *Task No Longer Available*\n\nThis task has been deleted or is no longer in an active state.')
                            } else if (updateResult.error) {
                                console.error('[Webhook] Failed to mark task completed:', updateResult.error.message)
                                await sendWhatsAppMessage(rawSenderPhone, '❌ *Error*\n\nSomething went wrong.\nPlease try again.')
                            } else {
                                // Phase 3: Confirm to sender immediately (task is already updated in DB)
                                await sendWhatsAppMessage(rawSenderPhone, '🎊 *Task Completed!*\n\nThe task has been marked as completed.')

                                // Fire-and-forget: notify the other party.
                                // Task is already completed in DB — other party sees correct status on their next query.
                                // This matches the fire-and-forget pattern used throughout whatsapp-notifier.ts.
                                if (otherUserResult?.otherUser?.phone_number) {
                                    const { sender, otherUser, isOwner } = otherUserResult
                                    const otherPhone = otherUser.phone_number.startsWith('91')
                                        ? otherUser.phone_number
                                        : `91${otherUser.phone_number}`
                                    const completerName = sender?.name || 'Someone'
                                    const roleLabel = isOwner ? 'Task owner' : 'Assignee'
                                    sendWhatsAppMessage(
                                        otherPhone,
                                        `✅ *Task Completed!*\n\n*Task:*\n"${task.title}"\n\n*Completed by:*\n${completerName} (${roleLabel})`
                                    ).catch((notifyErr: unknown) => console.error('[Webhook] Error notifying other party about completion:', notifyErr))
                                }
                            }
                        } catch (err) {
                            console.error('[Webhook] Error marking task completed:', err)
                            await sendWhatsAppMessage(rawSenderPhone, '❌ *Error*\n\nSomething went wrong.\nPlease try again.')
                        }
                        continue
                    }

                    // Stage 3 payload: owner taps "Notify Assignee" on overdue notification
                    if (buttonPayload.startsWith('task_notify_assignee::')) {
                        const taskId = buttonPayload.replace('task_notify_assignee::', '')
                        console.log(`[Webhook] Quick Reply: task_notify_assignee ${taskId} from ${senderPhone10}`)

                        try {
                            // Fetch task details + assignee info
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            const { data: task } = await (supabase as any)
                                .from('tasks')
                                .select('title, assigned_to, created_by, status')
                                .eq('id', taskId)
                                .single()

                            if (!task) {
                                await sendWhatsAppMessage(rawSenderPhone, '⚠️ *Task Not Found*\n\nThis task could not be found.\n\n_It may have been deleted._')
                                continue
                            }

                            // Check if task is already completed or cancelled
                            if (['completed', 'cancelled'].includes(task.status)) {
                                await sendWhatsAppMessage(rawSenderPhone, 'ℹ️ *Task Already Handled*\n\nThis task is already ' + task.status + '.\n\n_No notification was sent._')
                                continue
                            }

                            // Look up owner name and assignee phone
                            /* eslint-disable @typescript-eslint/no-explicit-any */
                            const [ownerData, assigneeData] = await Promise.all([
                                (supabase as any).from('users').select('name').eq('id', task.created_by).single(),
                                (supabase as any).from('users').select('phone_number, name').eq('id', task.assigned_to).single(),
                            ])
                            /* eslint-enable @typescript-eslint/no-explicit-any */

                            const ownerName = ownerData?.data?.name || 'Your manager'
                            const assigneePhone = assigneeData?.data?.phone_number

                            if (!assigneePhone) {
                                await sendWhatsAppMessage(rawSenderPhone, '⚠️ *Assignee Unreachable*\n\nCould not find the assignee\'s contact info.')
                                continue
                            }

                            const assigneeIntlPhone = assigneePhone.startsWith('91') ? assigneePhone : `91${assigneePhone}`

                            const assigneeMessage =
                                `⚠️ *Deadline Crossed!*\n\n*Task:*\n"${task.title}"\n\n*Requested by:*\n${ownerName}\n\nPlease get in touch with them about this task.`

                            await sendWhatsAppMessage(assigneeIntlPhone, assigneeMessage)
                            await sendWhatsAppMessage(rawSenderPhone, `📨 *Assignee Pinged!*\n\n*Notified:*\n${assigneeData?.data?.name || 'the assignee'}\n\n_They've been asked to get in touch with you._`)
                        } catch (err) {
                            console.error('[Webhook] Error notifying assignee:', err)
                            await sendWhatsAppMessage(rawSenderPhone, '❌ *Error*\n\nSomething went wrong.\nPlease try again.')
                        }
                        continue
                    }

                    console.log(`[Webhook] Unknown button payload: ${buttonPayload}`)
                    continue
                }

                // --- EARLY TEXT CHECK: detect signin/login/list BEFORE DB lookup ---
                const normalizedText = textBody.replace(/\s+/g, '').toLowerCase()
                const isSignin = normalizedText === 'signin' || normalizedText === 'login' || normalizedText === 'dashboard' || normalizedText === 'website'
                const isList = normalizedText === 'list'

                // --- SIGNIN FAST PATH: parallelize user lookup + token generation ---
                if (isSignin) {
                    console.log(`[Webhook] Signin fast-path for: ${senderPhone10}`)

                    try {
                        // Run user lookup and token generation IN PARALLEL
                        // Token is generated optimistically — if user doesn't exist, token is unused (expires naturally)
                        const tParallel = Date.now()
                        const [registeredUser, tokenResult] = await Promise.all([
                            getCachedUser(senderPhone10, supabase, true),
                            generateAuthToken(senderPhone10, 'signin', supabase),
                        ])
                        console.log(`[Webhook] Parallel lookup+token took ${Date.now() - tParallel}ms`)

                        if (!registeredUser) {
                            // Not registered — send signup link instead
                            console.log(`[Webhook] Unregistered user tried signin: ${senderPhone10}`)
                            const signupToken = await generateAuthToken(senderPhone10, 'signup', supabase)
                            if (signupToken.success && signupToken.token) {
                                await sendSignupLinkTemplate(rawSenderPhone, signupToken.token)
                            } else {
                                await sendWhatsAppMessage(rawSenderPhone, '❌ *Error*\n\nSomething went wrong.\nPlease try again later.')
                            }

                            // Fire-and-forget log
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            ; (supabase as any)
                                .from('incoming_messages')
                                .insert({ phone: senderPhone10, raw_text: textBody || `[${messageType}]`, payload: body, processed: true, intent_type: 'auth_signup' })
                                .then(() => { /* ignore */ })
                                .catch((logErr: unknown) => console.error('[Webhook] Error logging:', logErr))
                            continue
                        }

                        if (tokenResult.success && tokenResult.token) {
                            // Send the signin link (critical await)
                            const tSend = Date.now()
                            await sendSigninLinkTemplate(rawSenderPhone, registeredUser.name, tokenResult.token)
                            console.log(`[Webhook] Template send took ${Date.now() - tSend}ms`)
                        } else {
                            console.error('[Webhook] Token generation failed:', tokenResult.error)
                            await sendWhatsAppMessage(rawSenderPhone, '❌ *Error*\n\nSomething went wrong.\nPlease try again.')
                        }
                    } catch (err) {
                        console.error('[Webhook] Error in signin fast-path:', err instanceof Error ? err.message : err, err instanceof Error ? err.stack : '')
                    }

                    // Log as auth_signin — FIRE-AND-FORGET
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    ; (supabase as any)
                        .from('incoming_messages')
                        .insert({ phone: senderPhone10, raw_text: textBody || `[${messageType}]`, payload: body, processed: true, intent_type: 'auth_signin' })
                        .then(() => { /* ignore */ })
                        .catch((logErr: unknown) => console.error('[Webhook] Error logging:', logErr))

                    console.log(`[Webhook] Total signin time: ${Date.now() - t0}ms`)
                    continue
                }

                // --- NON-SIGNIN: regular user lookup (needed for list + AI processor) ---
                const tLookup = Date.now()
                const registeredUser = await getCachedUser(senderPhone10, supabase)
                console.log(`[Webhook] User lookup took ${Date.now() - tLookup}ms`)

                // --- LIST FAST PATH: send task manager flow ---
                if (isList) {
                    if (!registeredUser) {
                        await sendWhatsAppMessage(rawSenderPhone, '🔐 *Not Registered*\n\nPlease sign up first to use the task dashboard.\n\nReply *signin* to get started.')
                    } else {
                        console.log(`[Webhook] List trigger for: ${senderPhone10}`)
                        await sendTaskManagerFlowTemplate(rawSenderPhone, senderPhone10)
                    }
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    ; (supabase as any)
                        .from('incoming_messages')
                        .insert({ phone: senderPhone10, raw_text: textBody || `[${messageType}]`, payload: body, processed: true, intent_type: 'flow_list' })
                        .then(() => { /* ignore */ })
                        .catch((logErr: unknown) => console.error('[Webhook] Error logging:', logErr))
                    console.log(`[Webhook] List total time: ${Date.now() - t0}ms`)
                    continue
                }

                // --- STEP B: UNREGISTERED USER → send signup link ---
                if (!registeredUser) {
                    console.log(`[Webhook] Unregistered user: ${senderPhone10}, sending signup link`)

                    try {
                        const tokenResult = await generateAuthToken(senderPhone10, 'signup', supabase)
                        if (tokenResult.success && tokenResult.token) {
                            await sendSignupLinkTemplate(rawSenderPhone, tokenResult.token)
                        } else {
                            await sendWhatsAppMessage(rawSenderPhone, '❌ *Error*\n\nSomething went wrong.\nPlease try again later.')
                        }
                    } catch (err) {
                        console.error('[Webhook] Error sending signup link:', err)
                    }

                    // Log as auth_signup — FIRE-AND-FORGET
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    ; (supabase as any)
                        .from('incoming_messages')
                        .insert({ phone: senderPhone10, raw_text: textBody || `[${messageType}]`, payload: body, processed: true, intent_type: 'auth_signup' })
                        .then(() => { /* ignore */ })
                        .catch((logErr: unknown) => console.error('[Webhook] Error logging:', logErr))

                    console.log(`[Webhook] Total time: ${Date.now() - t0}ms`)
                    continue
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
                            whatsapp_message_id: messageId,
                        })
                        .select('id')
                        .single()

                    if (insertError) {
                        // 23505 = unique_violation: Meta retried a webhook we already processed — skip silently.
                        if (insertError.code === '23505') {
                            console.log(`[Webhook] Duplicate wamid skipped: ${messageId}`)
                            continue
                        }
                        console.error('[Webhook] Failed to log message:', insertError.message)
                        await sendWhatsAppMessage(rawSenderPhone, '❌ *Error*\n\nSomething went wrong.\nPlease try again.')
                    } else if (insertedMsg?.id) {
                        // Build the processor payload — include audio info if this is a voice note
                        const processorPayload: Record<string, string> = { messageId: insertedMsg.id }
                        if (messageType === 'audio' && message.audio?.id) {
                            processorPayload.audioMediaId = message.audio.id
                            processorPayload.audioMimeType = message.audio.mime_type || 'audio/ogg'
                        }

                        processMessageInline(
                            insertedMsg.id,
                            processorPayload.audioMediaId,
                            processorPayload.audioMimeType,
                        ).catch((err) => {
                            console.error('[Webhook] Background processing error:', err)
                        })
                    }
                } catch (err) {
                    console.error('[Webhook] Error inserting message:', err)
                    try {
                        await sendWhatsAppMessage(rawSenderPhone, '❌ *Error*\n\nSomething went wrong.\nPlease try again.')
                    } catch (sendErr) {
                        console.error('[Webhook] Failed to send error message:', sendErr)
                    }
                }
            }
        }
    }
}
