import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendWhatsAppMessage, downloadWhatsAppMedia } from '@/lib/whatsapp'
import { transcribeAudio } from '@/lib/sarvam'
import { normalizePhone } from '@/lib/phone'

// New single-call AI module
import { analyzeMessage } from '@/lib/ai/message-analyzer'
import { findPhoneticMatches } from '@/lib/ai/phonetic-match'
import type { OrgUser } from '@/lib/ai/phonetic-match'
import type { AnalyzedMessage } from '@/lib/ai/types'
import {
    notifyTaskCreated,
} from '@/lib/notifications/whatsapp-notifier'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface IncomingMessage {
    id: string
    phone: string
    user_id: string | null
    raw_text: string
    processed: boolean
    processing_error: string | null
    intent_type: string | null
}

interface SenderUser {
    id: string
    name: string
    phone_number: string
    organisation_id: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseAdmin = any

async function markProcessed(
    supabase: SupabaseAdmin,
    messageId: string,
    intentType: string | null,
    error: string | null,
): Promise<void> {
    const { error: updateError } = await supabase
        .from('incoming_messages')
        .update({
            processed: true,
            intent_type: intentType,
            processing_error: error,
        })
        .eq('id', messageId)

    if (updateError) {
        console.error('[ProcessMessage] Failed to mark processed:', updateError.message)
    }
}

async function sendErrorAndMark(
    supabase: SupabaseAdmin,
    messageId: string,
    phone: string,
    userMessage: string,
    errorDetail: string,
): Promise<void> {
    console.error(`[ProcessMessage] ${errorDetail}`)
    try {
        await sendWhatsAppMessage(phone, userMessage)
    } catch (sendErr) {
        console.error('[ProcessMessage] Failed to send error WhatsApp:', sendErr)
    }
    await markProcessed(supabase, messageId, null, errorDetail)
}

async function sendWhatsAppReply(phone: string, message: string): Promise<void> {
    try {
        await sendWhatsAppMessage(phone, message)
    } catch (err) {
        console.error('[ProcessMessage] Failed to send WhatsApp reply:', err)
    }
}

/**
 * Multi-turn context: check if this user's most recent processed message
 * (within the last 5 minutes) was a clarification request.
 */
async function fetchRecentClarification(
    supabase: SupabaseAdmin,
    phone: string,
    currentMessageId: string,
): Promise<{ raw_text: string; processing_error: string | null } | null> {
    const { data, error } = await supabase
        .from('incoming_messages')
        .select('raw_text, processing_error')
        .eq('phone', phone)
        .neq('id', currentMessageId)
        .in('intent_type', ['clarification_needed', 'needs_clarification'])
        .eq('processed', true)
        .gte('created_at', new Date(Date.now() - 5 * 60_000).toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .single()

    if (error || !data) return null
    return data as { raw_text: string; processing_error: string | null }
}

/**
 * Check if this user recently tapped Accept or Reject on a task.
 * We store this context in the incoming_messages table via intent_type
 * 'awaiting_accept_deadline' or 'awaiting_reject_reason' with the
 * task_id in processing_error.
 */
async function fetchPendingButtonContext(
    supabase: SupabaseAdmin,
    phone: string,
    currentMessageId: string,
): Promise<{ type: 'accept' | 'reject'; taskId: string } | null> {
    const { data, error } = await supabase
        .from('incoming_messages')
        .select('intent_type, processing_error')
        .eq('phone', phone)
        .neq('id', currentMessageId)
        .in('intent_type', ['awaiting_accept_deadline', 'awaiting_reject_reason'])
        .eq('processed', true)
        .gte('created_at', new Date(Date.now() - 10 * 60_000).toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .single()

    if (error || !data) return null

    const intentType = data.intent_type as string
    const taskId = data.processing_error as string

    if (!taskId) return null

    if (intentType === 'awaiting_accept_deadline') {
        return { type: 'accept', taskId }
    }
    if (intentType === 'awaiting_reject_reason') {
        return { type: 'reject', taskId }
    }
    return null
}

/**
 * Fuzzy + phonetic match a person name within the organisation.
 */
async function fuzzyMatchUser(
    supabase: SupabaseAdmin,
    orgId: string,
    name: string,
): Promise<{ id: string; name: string; phone_number?: string }[]> {
    const { data: allUsers } = await supabase
        .from('users')
        .select('id, name, first_name, last_name, phone_number')
        .eq('organisation_id', orgId)

    if (!allUsers || allUsers.length === 0) return []

    const orgUsers = allUsers as OrgUser[]
    const phoneticResults = findPhoneticMatches(name, orgUsers, 0.7)

    if (phoneticResults.length > 0) {
        const exactMatches = phoneticResults.filter(r => r.score >= 1.0)
        if (exactMatches.length > 0) {
            return exactMatches.map(r => ({
                id: r.user.id,
                name: r.user.name,
                phone_number: r.user.phone_number,
            }))
        }

        return phoneticResults.map(r => ({
            id: r.user.id,
            name: r.user.name,
            phone_number: r.user.phone_number,
        }))
    }

    return []
}

/**
 * Parse a date from free-form text (for accept deadline responses).
 * Uses simple Gemini call to extract just the date.
 */
async function parseDateFromText(text: string): Promise<string | null> {
    // Try to import and use Gemini for date parsing
    try {
        const { callGemini } = await import('@/lib/gemini')

        const now = new Date()
        const istOffset = 5.5 * 60 * 60_000
        const ist = new Date(now.getTime() + istOffset + now.getTimezoneOffset() * 60_000)
        const iso = ist.toISOString().split('T')[0]
        const dayName = ist.toLocaleDateString('en-IN', { weekday: 'long' })

        const prompt = `You are a date parser. Today is ${dayName}, ${iso} (IST).
Convert the user's text into an ISO 8601 datetime string in IST timezone (+05:30).
If only a date/day is given (no time), default to 18:00:00+05:30 (6 PM IST).
If only a time is given (no date), assume today if the time hasn't passed, otherwise tomorrow.
"kal" = tomorrow, "parso" = day after tomorrow, "aaj" = today.
"by Friday" = next Friday at 18:00:00+05:30.

Return ONLY a JSON object: { "date": "ISO 8601 string or null" }`

        const result = await callGemini(prompt, text)
        const parsed = JSON.parse(result.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim())
        return parsed.date || null
    } catch {
        return null
    }
}

// ---------------------------------------------------------------------------
// Core processing logic
// ---------------------------------------------------------------------------

export async function processMessageInline(
    messageId: string,
    audioMediaId?: string,
    audioMimeType?: string,
): Promise<{ status: string; intent?: string }> {
    const supabase = createAdminClient() as SupabaseAdmin

    try {
        // 1. Fetch message from DB
        const { data: message, error: fetchError } = await supabase
            .from('incoming_messages')
            .select('id, phone, user_id, raw_text, processed, processing_error, intent_type')
            .eq('id', messageId)
            .single()

        if (fetchError || !message) {
            console.error('[ProcessMessage] Message not found:', messageId, fetchError?.message)
            return { status: 'not_found' }
        }

        const msg = message as IncomingMessage

        // 2. Idempotency
        if (msg.processed) {
            console.log('[ProcessMessage] Already processed:', messageId)
            return { status: 'already_processed' }
        }

        // 3. Resolve sender
        const senderPhone10 = normalizePhone(msg.phone)

        const { data: senderUser } = await supabase
            .from('users')
            .select('id, name, phone_number, organisation_id')
            .eq('phone_number', senderPhone10)
            .single()

        if (!senderUser) {
            await sendErrorAndMark(
                supabase, messageId, msg.phone,
                'Your phone number is not registered with Boldo. Please sign up first.',
                `User not found for phone: ${msg.phone}`,
            )
            return { status: 'user_not_found' }
        }

        const sender = senderUser as SenderUser

        // 4. Audio transcription (if voice note)
        let textForAI = msg.raw_text

        if (audioMediaId) {
            console.log(`[ProcessMessage] Audio detected — downloading media ${audioMediaId}`)
            try {
                const { buffer, mimeType } = await downloadWhatsAppMedia(audioMediaId)
                const transcript = await transcribeAudio(buffer, audioMimeType || mimeType)

                console.log(`[ProcessMessage] Transcription: "${transcript.substring(0, 100)}${transcript.length > 100 ? '...' : ''}"`)

                // Fire-and-forget: update DB with transcribed text
                supabase
                    .from('incoming_messages')
                    .update({ raw_text: `[audio] ${transcript}` })
                    .eq('id', messageId)
                    .then(() => { /* ignore */ })
                    .catch((err: unknown) => console.error('[ProcessMessage] Failed to update raw_text:', err))

                textForAI = transcript
            } catch (transcribeErr) {
                const errMsg = transcribeErr instanceof Error ? transcribeErr.message : 'Unknown transcription error'
                await sendErrorAndMark(
                    supabase, messageId, msg.phone,
                    "Sorry, I couldn't understand the voice note. Please try again or type your message.",
                    `Audio transcription failed: ${errMsg}`,
                )
                return { status: 'transcription_error' }
            }
        }

        // =====================================================================
        // 4b. BUTTON CONTEXT — check if user is replying to Accept/Reject
        // =====================================================================

        const buttonContext = await fetchPendingButtonContext(supabase, senderPhone10, messageId)
        if (buttonContext) {
            console.log(`[ProcessMessage] Button context found: ${buttonContext.type} for task ${buttonContext.taskId}`)

            if (buttonContext.type === 'accept') {
                return await handleAcceptDeadlineReply(supabase, messageId, msg.phone, sender, textForAI, buttonContext.taskId)
            } else {
                return await handleRejectReasonReply(supabase, messageId, msg.phone, sender, textForAI, buttonContext.taskId)
            }
        }

        // =====================================================================
        // 4c. MULTI-TURN CONTEXT — check for recent clarification
        // =====================================================================

        const recentClarification = await fetchRecentClarification(supabase, senderPhone10, messageId)
        if (recentClarification) {
            const prevText = recentClarification.raw_text.replace(/^\[audio\] /, '')
            const reason = recentClarification.processing_error || 'more info needed'
            textForAI = `[CONTEXT: The user previously said: "${prevText}". The bot asked for clarification because: ${reason}. The user is now replying with:] ${textForAI}`
            console.log(`[ProcessMessage] Multi-turn context applied. Combined text: "${textForAI.substring(0, 200)}..."`)
        }

        // =====================================================================
        // 5. AI PIPELINE — Single Gemini call
        // =====================================================================

        console.log(`[ProcessMessage] Analyzing message: "${textForAI.substring(0, 80)}"`)
        const analysis = await analyzeMessage(textForAI, sender.name)
        console.log(`[ProcessMessage] Analysis: intent=${analysis.intent} conf=${analysis.confidence.toFixed(2)} who=${analysis.who.type}`)

        // =====================================================================
        // 6. Dispatch to handler
        // =====================================================================

        switch (analysis.intent) {
            case 'task_create':
                await handleTaskCreate(supabase, messageId, msg.phone, sender, analysis)
                break

            case 'todo_create':
                await handleTodoCreate(supabase, messageId, msg.phone, sender, analysis)
                break

            case 'send_dashboard_link':
                await handleSendDashboardLink(supabase, messageId, msg.phone, sender, analysis)
                break

            case 'unknown':
            default:
                await handleUnknown(supabase, messageId, msg.phone)
                break
        }

        console.log(`[ProcessMessage] Done: ${messageId} → ${analysis.intent}`, audioMediaId ? '(from audio)' : '')
        return { status: 'processed', intent: analysis.intent }

    } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown internal error'
        const errStack = err instanceof Error ? err.stack : ''
        console.error('[ProcessMessage] ❌ Unhandled error:', errMsg)
        console.error('[ProcessMessage] Stack:', errStack)
        console.error(`[ProcessMessage] Context: messageId=${messageId}, audioMediaId=${audioMediaId ?? 'none'}`)

        try {
            const { data: failMsg } = await supabase
                .from('incoming_messages')
                .select('phone')
                .eq('id', messageId)
                .single()

            if (failMsg?.phone) {
                await sendWhatsAppMessage(
                    failMsg.phone,
                    "⚠️ Our AI assistant ran into an issue while processing your message. Please try again in a moment. If the problem persists, try rephrasing your message or contact support."
                )
            }
            await markProcessed(supabase, messageId, null, errMsg)
        } catch (cleanupErr) {
            console.error('[ProcessMessage] Cleanup failed:', cleanupErr)
        }

        return { status: 'internal_error' }
    }
}

// ---------------------------------------------------------------------------
// POST handler — backwards-compatible HTTP endpoint
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
    // 1. Auth
    const secret = request.headers.get('x-internal-secret')
    if (!secret || secret !== process.env.INTERNAL_PROCESSOR_SECRET) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // 2. Parse body
    let body: { messageId?: string; audioMediaId?: string; audioMimeType?: string }
    try {
        body = await request.json()
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const { messageId, audioMediaId, audioMimeType } = body
    if (!messageId || typeof messageId !== 'string') {
        return NextResponse.json({ error: 'Missing messageId' }, { status: 400 })
    }

    const result = await processMessageInline(messageId, audioMediaId, audioMimeType)
    return NextResponse.json(result, { status: 200 })
}

// ============================================================================
// INTENT HANDLERS
// ============================================================================

// ---------------------------------------------------------------------------
// task_create — Create a task assigned to someone else
// ---------------------------------------------------------------------------

async function handleTaskCreate(
    supabase: SupabaseAdmin,
    messageId: string,
    phone: string,
    sender: SenderUser,
    analysis: AnalyzedMessage,
): Promise<void> {
    // ── WHO is "self"? Convert to to-do ──
    if (analysis.who.type === 'self') {
        return handleTodoCreate(supabase, messageId, phone, sender, analysis)
    }

    // ── WHO is "agent"? Can't do tasks ──
    if (analysis.who.type === 'agent') {
        await sendWhatsAppReply(phone,
            `I can't do "${analysis.what}" myself, but I can help you create a to-do! ` +
            `Just say something like "I need to ${analysis.what}".`)
        await markProcessed(supabase, messageId, 'clarification_needed', 'WHO is agent — re-route needed')
        return
    }

    // ── VALIDATION: WHAT ──
    if (!analysis.what || analysis.what.length < 3) {
        await sendWhatsAppReply(phone, 'Please tell me what task you need done. For example: "Tell Ramesh to send the invoice by Friday"')
        await markProcessed(supabase, messageId, 'clarification_needed', 'Missing WHAT: no task description')
        return
    }

    // ── VALIDATION: WHO — need a name ──
    if (!analysis.who.name) {
        await sendWhatsAppReply(phone,
            `I understood the task "${analysis.what}", but I'm not sure who should do it. ` +
            `Please mention the person's name. For example: "Tell [person name] to ${analysis.what}".`)
        await markProcessed(supabase, messageId, 'clarification_needed', 'Missing WHO: no assignee name')
        return
    }

    // ── Resolve assignee via fuzzy/phonetic match ──
    const matches = await fuzzyMatchUser(supabase, sender.organisation_id, analysis.who.name)

    if (matches.length === 0) {
        await sendWhatsAppReply(phone,
            `I couldn't find anyone named "${analysis.who.name}" in your organization. ` +
            `Please check the name and try again, or say the full name of the person.`)
        await markProcessed(supabase, messageId, 'task_create', `Assignee not found: ${analysis.who.name}`)
        return
    }

    if (matches.length > 1) {
        const nameList = matches
            .map((u, i) => `${i + 1}. ${u.name}${u.phone_number ? ` (${u.phone_number})` : ''}`)
            .join('\n')

        const clarifyMsg =
            `I found multiple people matching "${analysis.who.name}" in your organization:\n\n` +
            `${nameList}\n\n` +
            `Please reply with the full name of the person you want to assign "${analysis.what}" to.`

        await sendWhatsAppReply(phone, clarifyMsg)
        await markProcessed(supabase, messageId, 'needs_clarification', null)
        return
    }

    // ── Single match — create the task ──
    const assignee = matches[0]

    // NOTE: We do NOT set deadline during task creation.
    // The assignee sets the deadline when they accept the task.
    // The deadline info is preserved in the title/what text.
    const { data: newTask, error: taskError } = await supabase
        .from('tasks')
        .insert({
            title: analysis.what,
            description: analysis.what,
            organisation_id: sender.organisation_id,
            created_by: sender.id,
            assigned_to: assignee.id,
            status: 'pending',
            source: 'whatsapp',
        })
        .select('id')
        .single()

    if (taskError || !newTask) {
        await sendErrorAndMark(supabase, messageId, phone,
            'Something went wrong while creating the task.',
            `Task insert failed: ${taskError?.message || 'Unknown error'}`,
        )
        return
    }

    const confirmMsg = `✅ Task created: "${analysis.what}" assigned to ${assignee.name}. They'll receive a notification to accept it.`

    await sendWhatsAppReply(phone, confirmMsg)
    await markProcessed(supabase, messageId, 'task_create', null)

    // Fire-and-forget: notify the assignee
    notifyTaskCreated(supabase, {
        ownerName: sender.name,
        ownerId: sender.id,
        assigneeId: assignee.id,
        taskTitle: analysis.what,
        taskId: newTask.id,
        source: 'whatsapp',
    }).catch(err => console.error('[ProcessMessage] Notification error (task_create):', err))
}

// ---------------------------------------------------------------------------
// todo_create — Create a personal to-do (self-assigned)
// ---------------------------------------------------------------------------

async function handleTodoCreate(
    supabase: SupabaseAdmin,
    messageId: string,
    phone: string,
    sender: SenderUser,
    analysis: AnalyzedMessage,
): Promise<void> {
    // ── VALIDATION: WHAT ──
    if (!analysis.what || analysis.what.length < 3) {
        await sendWhatsAppReply(phone, 'Please tell me what you want to add as a to-do. For example: "I need to call the client tomorrow at 3pm"')
        await markProcessed(supabase, messageId, 'clarification_needed', 'Missing WHAT for to-do')
        return
    }

    // ── VALIDATION: WHEN — deadline is mandatory for to-dos ──
    let deadline = analysis.when.date

    if (!deadline) {
        await sendWhatsAppReply(phone,
            `I understood the to-do "${analysis.what}", but I need a deadline to create it. ` +
            `Please include a date, for example: "${analysis.what} by Friday" or "${analysis.what} tomorrow at 3pm".`)
        await markProcessed(supabase, messageId, 'clarification_needed', 'Missing WHEN: deadline required for to-do')
        return
    }

    // ── Default time to 6 AM IST if only date/day is given (no time component) ──
    // The Gemini prompt already defaults to 06:00:00+05:30, but double-check
    if (deadline && !deadline.includes('T')) {
        deadline = `${deadline}T06:00:00+05:30`
    }

    // ── Create the to-do ──
    const { error: todoError } = await supabase
        .from('tasks')
        .insert({
            title: analysis.what,
            description: analysis.what,
            organisation_id: sender.organisation_id,
            created_by: sender.id,
            assigned_to: sender.id, // Self-assigned = to-do
            deadline: deadline,
            committed_deadline: deadline, // Auto-commit for to-dos
            status: 'accepted', // Auto-accept to-dos
            source: 'whatsapp',
        })

    if (todoError) {
        await sendErrorAndMark(supabase, messageId, phone,
            'Something went wrong while creating the to-do.',
            `Todo insert failed: ${todoError.message}`,
        )
        return
    }

    // Build confirmation
    const d = new Date(deadline)
    const dateStr = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
    const timeStr = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })
    const confirmMsg = `✅ To-do created: "${analysis.what}". Deadline: ${dateStr} at ${timeStr}.`

    await sendWhatsAppReply(phone, confirmMsg)
    await markProcessed(supabase, messageId, 'todo_create', null)
}

// ---------------------------------------------------------------------------
// send_dashboard_link — Redirect user to webapp for unsupported actions
// ---------------------------------------------------------------------------

async function handleSendDashboardLink(
    supabase: SupabaseAdmin,
    messageId: string,
    phone: string,
    sender: SenderUser,
    analysis: AnalyzedMessage,
): Promise<void> {
    try {
        const { generateAuthToken, buildAuthUrl } = await import('@/lib/auth-links')
        const { sendWhatsAppMessage } = await import('@/lib/whatsapp')

        const tokenResult = await generateAuthToken(sender.phone_number, 'signin', supabase)

        if (tokenResult.success && tokenResult.token) {
            const actionDesc = analysis.what || 'this action'
            const dashboardUrl = buildAuthUrl(tokenResult.token)

            const msg = `For "${actionDesc}", please use the Boldo dashboard:\n\n🔗 ${dashboardUrl}\n\nThis link will log you in automatically and is valid for 10 minutes.`

            await sendWhatsAppMessage(phone, msg)
        } else {
            await sendWhatsAppMessage(phone,
                'I understand what you need, but this action can only be done on the dashboard. Type "signin" to get your dashboard link!')
        }
    } catch (err) {
        console.error('[ProcessMessage] Dashboard link error:', err)
        const { sendWhatsAppMessage } = await import('@/lib/whatsapp')
        await sendWhatsAppMessage(phone,
            'I understand what you need, but this action can only be done on the dashboard. Type "signin" to get your dashboard link!')
    }

    await markProcessed(supabase, messageId, 'send_dashboard_link', null)
}

// ---------------------------------------------------------------------------
// unknown — Polite fallback
// ---------------------------------------------------------------------------

async function handleUnknown(
    supabase: SupabaseAdmin,
    messageId: string,
    phone: string,
): Promise<void> {
    console.log(`[ProcessMessage] Handling unknown intent for message ${messageId}`)
    await sendWhatsAppReply(phone,
        "I'm not sure I understood that. I can help you manage tasks — try saying something like " +
        "\"Tell Ramesh to send the invoice\" or \"I need to call the client tomorrow at 3pm\". 😊")
    await markProcessed(supabase, messageId, 'unknown', null)
}

// ============================================================================
// BUTTON-DRIVEN HANDLERS (Accept / Reject follow-up replies)
// ============================================================================

/**
 * Handle the user's reply after tapping "Accept" on a task.
 * The reply should contain a deadline. We parse it and accept the task.
 */
async function handleAcceptDeadlineReply(
    supabase: SupabaseAdmin,
    messageId: string,
    phone: string,
    sender: SenderUser,
    userText: string,
    taskId: string,
): Promise<{ status: string; intent?: string }> {
    // Fetch the task
    const { data: task, error: fetchError } = await supabase
        .from('tasks')
        .select('id, title, assigned_to, created_by, status, organisation_id')
        .eq('id', taskId)
        .single()

    if (fetchError || !task) {
        await sendWhatsAppReply(phone, "I couldn't find the task you're trying to accept. It may have been deleted.")
        await markProcessed(supabase, messageId, 'task_accept', 'Task not found')
        return { status: 'processed', intent: 'task_accept' }
    }

    // Verify permissions
    if (task.assigned_to !== sender.id) {
        await sendWhatsAppReply(phone, "You can only accept tasks assigned to you.")
        await markProcessed(supabase, messageId, 'task_accept', 'Not the assignee')
        return { status: 'processed', intent: 'task_accept' }
    }

    if (task.status !== 'pending') {
        await sendWhatsAppReply(phone, "This task has already been accepted or is no longer pending.")
        await markProcessed(supabase, messageId, 'task_accept', `Task status is ${task.status}`)
        return { status: 'processed', intent: 'task_accept' }
    }

    // Parse deadline from user text
    const deadline = await parseDateFromText(userText)

    // ── Date parsing failed — don't accept, notify user ──
    if (!deadline) {
        // Clear the awaiting context so the next message goes through normal pipeline
        await supabase
            .from('incoming_messages')
            .update({ intent_type: 'accept_deadline_expired' })
            .eq('phone', sender.phone_number)
            .eq('intent_type', 'awaiting_accept_deadline')

        await sendWhatsAppReply(phone,
            `⚠️ I couldn't detect a date in your reply. The task "${task.title}" has NOT been accepted yet.\n\n` +
            `If you were trying to set a deadline, please tap the Accept button again and reply with a date ` +
            `(e.g., "tomorrow", "Friday", "March 5th").\n\n` +
            `If you were trying to send something else (like a new task), please send that message again — ` +
            `it wasn't processed because I was looking for a deadline. ` +
            `You can accept this task anytime from the dashboard.`)
        await markProcessed(supabase, messageId, 'task_accept', 'Date parse failed — task not accepted')
        return { status: 'processed', intent: 'task_accept' }
    }

    // ── Date parsed successfully — accept the task ──
    const { error } = await supabase
        .from('tasks')
        .update({
            status: 'accepted',
            committed_deadline: deadline,
            updated_at: new Date().toISOString(),
        })
        .eq('id', taskId)

    if (error) {
        await sendErrorAndMark(supabase, messageId, phone,
            'Something went wrong while accepting the task.',
            `Task accept failed: ${error.message}`,
        )
        return { status: 'processed', intent: 'task_accept' }
    }

    const d = new Date(deadline)
    const dateStr = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
    const timeStr = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })
    const confirmMsg = `✅ Great! You've accepted "${task.title}" with a deadline of ${dateStr} at ${timeStr}. Good luck! 💪`

    await sendWhatsAppReply(phone, confirmMsg)
    await markProcessed(supabase, messageId, 'task_accept', null)

    // Clear the awaiting context
    await supabase
        .from('incoming_messages')
        .update({ intent_type: 'accept_deadline_expired' })
        .eq('phone', sender.phone_number)
        .eq('intent_type', 'awaiting_accept_deadline')

    // Fire-and-forget: notify the task owner
    const { notifyTaskAccepted } = await import('@/lib/notifications/whatsapp-notifier')
    notifyTaskAccepted(supabase, {
        ownerId: task.created_by,
        assigneeId: sender.id,
        assigneeName: sender.name,
        taskTitle: task.title || 'Untitled task',
        taskId: taskId,
        committedDeadline: deadline,
        source: 'whatsapp',
    }).catch((err: unknown) => console.error('[ProcessMessage] Notification error (task_accept):', err))

    return { status: 'processed', intent: 'task_accept' }
}

/**
 * Handle the user's reply after tapping "Reject" on a task.
 * The reply should contain a rejection reason.
 */
async function handleRejectReasonReply(
    supabase: SupabaseAdmin,
    messageId: string,
    phone: string,
    sender: SenderUser,
    userText: string,
    taskId: string,
): Promise<{ status: string; intent?: string }> {
    // Fetch the task
    const { data: task, error: fetchError } = await supabase
        .from('tasks')
        .select('id, title, assigned_to, created_by, status, organisation_id')
        .eq('id', taskId)
        .single()

    if (fetchError || !task) {
        await sendWhatsAppReply(phone, "I couldn't find the task you're trying to reject. It may have been deleted.")
        await markProcessed(supabase, messageId, 'task_reject', 'Task not found')
        return { status: 'processed', intent: 'task_reject' }
    }

    // Verify permissions
    if (task.assigned_to !== sender.id) {
        await sendWhatsAppReply(phone, "You can only reject tasks assigned to you.")
        await markProcessed(supabase, messageId, 'task_reject', 'Not the assignee')
        return { status: 'processed', intent: 'task_reject' }
    }

    if (task.status !== 'pending') {
        await sendWhatsAppReply(phone, "This task has already been rejected or is no longer pending.")
        await markProcessed(supabase, messageId, 'task_reject', `Task status is ${task.status}`)
        return { status: 'processed', intent: 'task_reject' }
    }

    // Update status to cancelled
    const { error } = await supabase
        .from('tasks')
        .update({
            status: 'cancelled',
            updated_at: new Date().toISOString(),
        })
        .eq('id', taskId)

    if (error) {
        await sendErrorAndMark(supabase, messageId, phone,
            'Something went wrong while rejecting the task.',
            `Task reject failed: ${error.message}`,
        )
        return { status: 'processed', intent: 'task_reject' }
    }

    // Store rejection reason as comment
    if (userText) {
        await supabase.from('task_comments').insert({
            task_id: taskId,
            user_id: sender.id,
            content: `Rejected: ${userText}`,
        }).catch((err: unknown) => console.error('[ProcessMessage] Failed to store rejection comment:', err))
    }

    // Resolve owner name for message
    const { data: ownerData } = await supabase
        .from('users')
        .select('name')
        .eq('id', task.created_by)
        .single()

    const ownerName = ownerData?.name || 'the task owner'
    const reasonStr = userText ? ` Reason: ${userText}` : ''
    const confirmMsg = `Got it. I've let ${ownerName} know that you've declined "${task.title}".${reasonStr}`

    await sendWhatsAppReply(phone, confirmMsg)
    await markProcessed(supabase, messageId, 'task_reject', null)

    // Fire-and-forget: notify the task owner
    const { notifyTaskRejected } = await import('@/lib/notifications/whatsapp-notifier')
    notifyTaskRejected(supabase, {
        ownerId: task.created_by,
        assigneeId: sender.id,
        assigneeName: sender.name,
        taskTitle: task.title || 'Untitled task',
        taskId: taskId,
        reason: userText || null,
        source: 'whatsapp',
    }).catch((err: unknown) => console.error('[ProcessMessage] Notification error (task_reject):', err))

    return { status: 'processed', intent: 'task_reject' }
}
