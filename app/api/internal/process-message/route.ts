import { NextRequest, NextResponse } from 'next/server'

export const preferredRegion = 'sin1'

import { createAdminClient } from '@/lib/supabase/admin'
import { sendWhatsAppMessage, downloadWhatsAppMedia } from '@/lib/whatsapp'
import { transcribeAudio } from '@/lib/sarvam'
import { normalizePhone } from '@/lib/phone'

// AI modules
import { analyzeMessage } from '@/lib/ai/message-analyzer'
import { findPhoneticMatches } from '@/lib/ai/phonetic-match'
import type { OrgUser } from '@/lib/ai/phonetic-match'
import type { AnalyzedMessage } from '@/lib/ai/types'
import { notifyTaskCreated } from '@/lib/notifications/whatsapp-notifier'

// Session-based conversation context
import {
    getActiveSession,
    createSession,
    resolveSession,
    buildIntentChangeAcknowledgment,
} from '@/lib/ai/conversation-context'
import { handleSessionReply } from '@/lib/ai/session-reply-handler'

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
            // User not in DB — send signup link (same as webhook unregistered-user flow)
            console.log(`[ProcessMessage] User not found for phone: ${msg.phone}, sending signup link`)
            const intlPhone = msg.phone.startsWith('91') ? msg.phone : `91${msg.phone}`
            try {
                const { generateAuthToken } = await import('@/lib/auth-links')
                const { sendSignupLinkTemplate } = await import('@/lib/whatsapp')
                const tokenResult = await generateAuthToken(senderPhone10, 'signup', supabase)
                if (tokenResult.success && tokenResult.token) {
                    await sendSignupLinkTemplate(intlPhone, tokenResult.token)
                } else {
                    await sendWhatsAppMessage(intlPhone,
                        '🚦 *Not Registered*\n\nThis phone number is not registered with Boldo.\n\nPlease sign up first.')
                }
            } catch (signupErr) {
                console.error('[ProcessMessage] Error sending signup link:', signupErr)
                await sendWhatsAppMessage(intlPhone,
                    '🚦 *Not Registered*\n\nThis phone number is not registered with Boldo.\n\nPlease sign up first.')
            }
            await markProcessed(supabase, messageId, 'auth_signup', `User not found for phone: ${msg.phone}`)
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
                    '🎤 *Voice Note Unclear*\n\nSorry, I couldn\'t understand the voice note.\n\nPlease try again or type your message instead.',
                    `Audio transcription failed: ${errMsg}`,
                )
                return { status: 'transcription_error' }
            }
        }

        // =====================================================================
        // 5. SESSION-BASED CONTEXT — check for active conversation session
        // =====================================================================

        const activeSession = await getActiveSession(senderPhone10, supabase)

        if (activeSession) {
            console.log(`[ProcessMessage] Active session found: ${activeSession.session_type} (${activeSession.id})`)

            // Try to handle the reply within the session context
            const sessionResult = await handleSessionReply(
                supabase, activeSession, textForAI, sender, messageId,
            )

            if (sessionResult.handled) {
                console.log(`[ProcessMessage] Session handled reply: intent=${sessionResult.intent}`)
                return { status: 'processed', intent: sessionResult.intent }
            }

            // Session couldn't handle the reply — this means the user sent something
            // that doesn't fit the current session. We need to:
            //  1. Send an acknowledgment that we're switching context
            //  2. Resolve the session
            //  3. Process the message through the normal AI pipeline

            console.log(`[ProcessMessage] Session fall-through — processing as new intent`)
            const ackMessage = buildIntentChangeAcknowledgment(activeSession)
            await sendWhatsAppReply(msg.phone, ackMessage)
            await resolveSession(activeSession.id, supabase)
        }

        // =====================================================================
        // 6. AI PIPELINE — Single Gemini call (normal path, no session)
        // =====================================================================

        console.log(`[ProcessMessage] Analyzing message: "${textForAI.substring(0, 80)}"`)
        const analysis = await analyzeMessage(textForAI, sender.name)
        console.log(`[ProcessMessage] Analysis: intent=${analysis.intent} conf=${analysis.confidence.toFixed(2)} who=${analysis.who.type}`)

        // =====================================================================
        // 7. Dispatch to handler
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
                    '⚠️ *Something Went Wrong*\n\nOur AI assistant ran into an issue while processing your message.\n\nPlease try again in a moment.\n\n_If the issue persists, try rephrasing or contact support._'
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
            `🤖 *I Can't Do That!*\n\nI can't perform this myself:\n"${analysis.what}"\n\nBut I can create a to-do for you!\n\n*Try saying:*\n"I need to ${analysis.what}"`)
        await markProcessed(supabase, messageId, 'task_create', 'WHO is agent — re-route needed')
        return
    }

    // ── VALIDATION: WHAT ──
    if (!analysis.what || analysis.what.length < 3) {
        // Create session to wait for task description
        await createSession(phone, 'awaiting_task_description', {
            original_intent: 'task_create',
            who_name: analysis.who.name,
            sender_id: sender.id,
            sender_name: sender.name,
            organisation_id: sender.organisation_id,
        }, 10, supabase)

        await sendWhatsAppReply(phone,
            '📋 *Task Description Needed*\n\nWhat task do you need done?\n\nPlease describe it.' +
            (analysis.who.name ? `\n\n_I'll assign it to ${analysis.who.name}._` : ''))
        await markProcessed(supabase, messageId, 'task_create', 'Awaiting task description via session')
        return
    }

    // ── VALIDATION: WHO — need a name ──
    if (!analysis.who.name) {
        // Create session to wait for assignee name
        await createSession(phone, 'awaiting_assignee_name', {
            original_intent: 'task_create',
            what: analysis.what,
            when_date: analysis.when.date,
            when_raw: analysis.when.raw,
            sender_id: sender.id,
            sender_name: sender.name,
            organisation_id: sender.organisation_id,
            original_message: analysis.what,
        }, 10, supabase)

        await sendWhatsAppReply(phone,
            `👤 *Who Should Do This?*\n\n*Task:*\n"${analysis.what}"\n\nPlease reply with the person's name.`)
        await markProcessed(supabase, messageId, 'task_create', 'Awaiting assignee name via session')
        return
    }

    // ── Resolve assignee via fuzzy/phonetic match ──
    const matches = await fuzzyMatchUser(supabase, sender.organisation_id, analysis.who.name)

    if (matches.length === 0) {
        // Keep session alive so the user's next reply (a corrected name) is caught
        await createSession(phone, 'awaiting_assignee_name', {
            original_intent: 'task_create',
            what: analysis.what,
            when_date: analysis.when.date,
            when_raw: analysis.when.raw,
            sender_id: sender.id,
            sender_name: sender.name,
            organisation_id: sender.organisation_id,
            original_message: analysis.what,
        }, 10, supabase)

        await sendWhatsAppReply(phone,
            `🔍 *Assignee Not Found*\n\n*No match found for:*\n${analysis.who.name}\n\nPlease try a different name or the full name.`)
        await markProcessed(supabase, messageId, 'task_create', `Assignee not found: ${analysis.who.name}`)
        return
    }

    if (matches.length > 1) {
        const nameList = matches
            .map((u, i) => `${i + 1}. ${u.name}${u.phone_number ? ` (${u.phone_number})` : ''}`)
            .join('\n')

        // Create session to wait for selection
        await createSession(phone, 'awaiting_assignee_selection', {
            original_intent: 'task_create',
            who_name: analysis.who.name,
            what: analysis.what,
            when_date: analysis.when.date,
            when_raw: analysis.when.raw,
            candidates: matches.map(u => ({ id: u.id, name: u.name, phone_number: u.phone_number })),
            sender_id: sender.id,
            sender_name: sender.name,
            organisation_id: sender.organisation_id,
        }, 10, supabase)

        const clarifyMsg =
            `👥 *Multiple Matches Found*\n\n*Searched for:*\n${analysis.who.name}\n\n` +
            `${nameList}\n\nReply with the *option number* to select.\n\n_Don't see the right person? Type their full name or phone number._`

        await sendWhatsAppReply(phone, clarifyMsg)
        await markProcessed(supabase, messageId, 'task_create', 'Awaiting assignee selection via session')
        return
    }

    // ── Single match — create the task ──
    const assignee = matches[0]

    // ── Self-assignment check: if assignee is the sender, treat as to-do ──
    if (assignee.id === sender.id) {
        return handleTodoCreate(supabase, messageId, phone, sender, analysis)
    }

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
            '❌ *Error*\n\nSomething went wrong while creating the task.\n\nPlease try again.',
            `Task insert failed: ${taskError?.message || 'Unknown error'}`,
        )
        return
    }

    const confirmMsg = `✅ *Task Created!*\n\n*Task:*\n"${analysis.what}"\n\n*Assigned to:*\n${assignee.name}\n\n_They'll receive a notification to accept it._`

    await sendWhatsAppReply(phone, confirmMsg)
    await markProcessed(supabase, messageId, 'task_create', null)

    // Notify the assignee (inline confirmation already sent to the actor above)
    await notifyTaskCreated(supabase, {
        ownerName: sender.name,
        ownerId: sender.id,
        assigneeId: assignee.id,
        taskTitle: analysis.what,
        taskId: newTask.id,
        source: 'whatsapp',
        inlineConfirmationSent: true,
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
        // Create session to wait for task description
        await createSession(phone, 'awaiting_task_description', {
            original_intent: 'todo_create',
            sender_id: sender.id,
            sender_name: sender.name,
            organisation_id: sender.organisation_id,
        }, 10, supabase)

        await sendWhatsAppReply(phone,
            '📋 *To-Do Description Needed*\n\nWhat do you want to add as a to-do?\n\nPlease describe it.')
        await markProcessed(supabase, messageId, 'todo_create', 'Awaiting task description via session')
        return
    }

    // ── VALIDATION: WHEN — deadline is mandatory for to-dos ──
    let deadline = analysis.when.date

    if (!deadline) {
        // Create session to wait for deadline
        await createSession(phone, 'awaiting_todo_deadline', {
            original_intent: 'todo_create',
            what: analysis.what,
            sender_id: sender.id,
            sender_name: sender.name,
            organisation_id: sender.organisation_id,
        }, 10, supabase)

        await sendWhatsAppReply(phone,
            `⏰ *Deadline Needed*\n\n*To-do:*\n"${analysis.what}"\n\nWhen should this be done?\n\n*Examples:*\n"tomorrow 3pm", "Friday", "March 10"`)
        await markProcessed(supabase, messageId, 'todo_create', 'Awaiting deadline via session')
        return
    }

    // ── Default time to 08:00 PM IST if only date/day is given (no time component) ──
    if (deadline && !deadline.includes('T')) {
        deadline = `${deadline}T20:00:00+05:30`
    }

    // ── Reject past deadlines — ask for a future date via session ──
    if (new Date(deadline).getTime() < Date.now()) {
        await createSession(phone, 'awaiting_todo_deadline', {
            original_intent: 'todo_create',
            what: analysis.what,
            sender_id: sender.id,
            sender_name: sender.name,
            organisation_id: sender.organisation_id,
        }, 10, supabase)

        await sendWhatsAppReply(phone,
            `⏰ *Deadline Already Passed*\n\nThe date you entered is in the past.\n\nPlease enter a *future* date and time.\n\n*Examples:*\n"tomorrow 3pm", "Friday", "March 10"`)
        await markProcessed(supabase, messageId, 'todo_create', 'Deadline in the past — awaiting new deadline')
        return
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
            '❌ *Error*\n\nSomething went wrong while creating the to-do.\n\nPlease try again.',
            `Todo insert failed: ${todoError.message}`,
        )
        return
    }

    // Build confirmation
    const d = new Date(deadline)
    const dateStr = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
    const timeStr = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })
    const confirmMsg = `✅ *To-Do Created!*\n\n*To-do:*\n"${analysis.what}"\n\n*Deadline:*\n${dateStr} at ${timeStr}`

    await sendWhatsAppReply(phone, confirmMsg)
    await markProcessed(supabase, messageId, 'todo_create', null)

    // Schedule deadline approaching notification for the to-do
    if (deadline) {
        // Need to look up the to-do ID we just created
        const { data: createdTodo } = await supabase
            .from('tasks')
            .select('id')
            .eq('created_by', sender.id)
            .eq('assigned_to', sender.id)
            .eq('title', analysis.what)
            .eq('status', 'accepted')
            .order('created_at', { ascending: false })
            .limit(1)
            .single()

        if (createdTodo) {
            await notifyTaskCreated(supabase, {
                ownerName: sender.name,
                ownerId: sender.id,
                assigneeId: sender.id,
                taskTitle: analysis.what,
                taskId: createdTodo.id,
                committedDeadline: deadline,
                source: 'whatsapp',
                inlineConfirmationSent: true,
            }).catch(err => console.error('[ProcessMessage] Notification error (todo_create):', err))
        }
    }
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
        const { generateAuthToken } = await import('@/lib/auth-links')
        const { sendWhatsAppMessage, sendSigninLinkTemplate } = await import('@/lib/whatsapp')

        const tokenResult = await generateAuthToken(sender.phone_number, 'signin', supabase)

        if (tokenResult.success && tokenResult.token) {
            const actionDesc = analysis.what || 'this action'

            const msg1 = `📋 Intended action:\n"${actionDesc}"\n\n🖥️ You can use the Boldo dashboard for this. Sharing the personalised link to access your dashboard.`
            await sendWhatsAppMessage(phone, msg1)

            await sendSigninLinkTemplate(phone, sender.name, tokenResult.token)
        } else {
            await sendWhatsAppMessage(phone,
                '🖥️ *Dashboard Required*\n\nThis action can only be completed on the dashboard.\n\nType *"signin"* to get your login link.')
        }
    } catch (err) {
        console.error('[ProcessMessage] Dashboard link error:', err)
        const { sendWhatsAppMessage } = await import('@/lib/whatsapp')
        await sendWhatsAppMessage(phone,
            '🖥️ *Dashboard Required*\n\nThis action can only be completed on the dashboard.\n\nType *"signin"* to get your login link.')
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
        '🤔 *Didn\'t Catch That!*\n\nI can help you manage tasks.\n\n*Try something like:*\n"Tell Ramesh to send the invoice"\nor\n"I need to call the client tomorrow at 3pm" 😊')
    await markProcessed(supabase, messageId, 'unknown', null)
}
