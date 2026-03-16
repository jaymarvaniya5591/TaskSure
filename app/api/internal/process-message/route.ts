import { NextRequest, NextResponse } from 'next/server'

export const preferredRegion = 'sin1'

import { createAdminClient } from '@/lib/supabase/admin'
import { sendWhatsAppMessage, downloadWhatsAppMedia } from '@/lib/whatsapp'
import { transcribeAudio, translateText } from '@/lib/sarvam'
import { normalizePhone } from '@/lib/phone'
import { SARVAM_TO_BCP47, detectTextLanguage } from '@/lib/language-utils'

// AI modules
import { analyzeMessage } from '@/lib/ai/message-analyzer'
import { findPhoneticMatches } from '@/lib/ai/phonetic-match'
import type { OrgUser } from '@/lib/ai/phonetic-match'
import type { AnalyzedMessage } from '@/lib/ai/types'
import { notifyTaskCreated, notifyReviewRequested } from '@/lib/notifications/whatsapp-notifier'
import { resolveTask } from '@/lib/ai/task-resolver'

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
    whatsapp_message_id: string | null
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

function isValidDate(dateStr: string): boolean {
    return !isNaN(new Date(dateStr).getTime())
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
                        '🚦 *Not Registered*\n\nThis phone number is not registered with Boldo.\n\nPlease sign up using the link above.\n\n_Previously had an account? Ask your admin to update your phone number in team settings._')
                }
            } catch (signupErr) {
                console.error('[ProcessMessage] Error sending signup link:', signupErr)
                await sendWhatsAppMessage(intlPhone,
                    '🚦 *Not Registered*\n\nThis phone number is not registered with Boldo.\n\nPlease sign up using the link above.\n\n_Previously had an account? Ask your admin to update your phone number in team settings._')
            }
            await markProcessed(supabase, messageId, 'auth_signup', `User not found for phone: ${msg.phone}`)
            return { status: 'user_not_found' }
        }

        const sender = senderUser as SenderUser

        // 4. Audio transcription (if voice note)
        let textForAI = msg.raw_text
        let taskLanguage: string | null = null

        if (audioMediaId) {
            console.log(`[ProcessMessage] Audio detected — downloading media ${audioMediaId}`)
            try {
                const { buffer, mimeType } = await downloadWhatsAppMedia(audioMediaId)

                // 4a. Transcribe Audio (to native language, e.g. Gujarati)
                const { text: transcript, languageCode } = await transcribeAudio(buffer, audioMimeType || mimeType)
                console.log(`[ProcessMessage] Native Transcription: "${transcript.substring(0, 100)}${transcript.length > 100 ? '...' : ''}"`)

                // Capture detected language from Sarvam (authoritative for audio)
                taskLanguage = SARVAM_TO_BCP47[languageCode] ?? null
                console.log(`[ProcessMessage] Detected language: ${languageCode} → ${taskLanguage}`)

                // 4b. Translate to English using Sarvam (for Gemini accuracy)
                const englishTranslation = await translateText(transcript, languageCode)
                console.log(`[ProcessMessage] English Translation: "${englishTranslation.substring(0, 100)}${englishTranslation.length > 100 ? '...' : ''}"`)

                // 4c. Ensure character limits bounds for AI processing downstream
                // Limit to 2000 chars roughly - Sarvam translates up to large tokens but we bounds check just in case
                const safeTranslation = englishTranslation.substring(0, 3000)

                // Fire-and-forget: update DB with translated text to persist the English standard form
                supabase
                    .from('incoming_messages')
                    .update({ raw_text: `[audio] ${safeTranslation}` })
                    .eq('id', messageId)
                    .then(() => { /* ignore */ })
                    .catch((err: unknown) => console.error('[ProcessMessage] Failed to update raw_text:', err))

                textForAI = safeTranslation
            } catch (transcribeErr) {
                const errMsg = transcribeErr instanceof Error ? transcribeErr.message : 'Unknown transcription error'
                await sendErrorAndMark(
                    supabase, messageId, msg.phone,
                    '🎤 *Voice Note Unclear*\n\nSorry, I couldn\'t understand the voice note.\n\nPlease try again or type your message instead.',
                    `Audio transcription failed: ${errMsg}`,
                )
                return { status: 'transcription_error' }
            }
        } else {
            // Text message: detect language from Unicode script ranges (instant, no API call)
            const detectedLang = detectTextLanguage(msg.raw_text)
            if (detectedLang) {
                taskLanguage = detectedLang
                console.log(`[ProcessMessage] Text language detected: ${detectedLang}`)
                // Translate non-Latin script to English for Gemini accuracy
                if (detectedLang !== 'en-IN') {
                    try {
                        // Map BCP47 back to the 2-letter code Sarvam expects as source
                        const sarvamCode = Object.entries(SARVAM_TO_BCP47).find(([, v]) => v === detectedLang)?.[0] ?? detectedLang
                        const englishText = await translateText(msg.raw_text.substring(0, 3000), sarvamCode)
                        textForAI = englishText.substring(0, 4000)
                        console.log(`[ProcessMessage] Text translated to English for AI: "${textForAI.substring(0, 80)}"`)
                    } catch (translateErr) {
                        console.warn('[ProcessMessage] Text pre-translation failed, using original:', translateErr)
                        // Non-fatal: Gemini can still handle many Indian language scripts
                    }
                }
            }
        }

        // ── Truncate oversized text to prevent Gemini token overrun / timeout ──
        const MAX_AI_TEXT_LENGTH = 4000
        if (textForAI.length > MAX_AI_TEXT_LENGTH) {
            console.warn(`[ProcessMessage] Text truncated: ${textForAI.length} → ${MAX_AI_TEXT_LENGTH} chars`)
            textForAI = textForAI.substring(0, MAX_AI_TEXT_LENGTH)
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
        // 7. Back-translate task title to detected language
        //    Gemini works in English for accuracy; Sarvam translates the result
        //    back to the user's language so the task title is stored natively.
        // =====================================================================

        let taskTitle = analysis.what
        if (taskLanguage && taskLanguage !== 'en-IN' && analysis.what) {
            try {
                taskTitle = await translateText(analysis.what, 'en-IN', taskLanguage)
                console.log(`[ProcessMessage] Task title translated to ${taskLanguage}: "${taskTitle.substring(0, 80)}"`)
            } catch (translateErr) {
                console.warn('[ProcessMessage] Back-translation failed, using English title:', translateErr)
                // Non-fatal: fall back to English title
            }
        }

        // =====================================================================
        // 8. Dispatch to handler
        // =====================================================================

        switch (analysis.intent) {
            case 'task_create':
                await handleTaskCreate(supabase, messageId, msg.phone, sender, analysis, taskTitle, taskLanguage)
                break

            case 'todo_create':
                await handleTodoCreate(supabase, messageId, msg.phone, sender, analysis, taskTitle, taskLanguage)
                break

            case 'vendor_add':
                await handleVendorAdd(supabase, messageId, msg.phone, sender, analysis)
                break

            case 'ticket_create':
                await handleTicketCreate(supabase, messageId, msg.phone, sender, analysis, taskTitle, taskLanguage)
                break

            case 'review_request':
                await handleReviewRequest(supabase, messageId, msg.phone, sender, analysis)
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
    taskTitle: string = analysis.what,
    language: string | null = null,
): Promise<void> {
    // ── WHO is "self"? Convert to to-do ──
    if (analysis.who.type === 'self') {
        return handleTodoCreate(supabase, messageId, phone, sender, analysis, taskTitle, language)
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
            task_language: language,
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
            what: taskTitle,
            when_date: analysis.when.date,
            when_raw: analysis.when.raw,
            sender_id: sender.id,
            sender_name: sender.name,
            organisation_id: sender.organisation_id,
            original_message: taskTitle,
            task_language: language,
        }, 10, supabase)

        await sendWhatsAppReply(phone,
            `👤 *Who Should Do This?*\n\n*Task:*\n"${taskTitle}"\n\nPlease reply with the person's name.`)
        await markProcessed(supabase, messageId, 'task_create', 'Awaiting assignee name via session')
        return
    }

    // ── Resolve assignee via fuzzy/phonetic match ──
    const matches = await fuzzyMatchUser(supabase, sender.organisation_id, analysis.who.name)

    if (matches.length === 0) {
        // Keep session alive so the user's next reply (a corrected name) is caught
        await createSession(phone, 'awaiting_assignee_name', {
            original_intent: 'task_create',
            what: taskTitle,
            when_date: analysis.when.date,
            when_raw: analysis.when.raw,
            sender_id: sender.id,
            sender_name: sender.name,
            organisation_id: sender.organisation_id,
            original_message: taskTitle,
            task_language: language,
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
            what: taskTitle,
            when_date: analysis.when.date,
            when_raw: analysis.when.raw,
            candidates: matches.map(u => ({ id: u.id, name: u.name, phone_number: u.phone_number })),
            sender_id: sender.id,
            sender_name: sender.name,
            organisation_id: sender.organisation_id,
            task_language: language,
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
        return handleTodoCreate(supabase, messageId, phone, sender, analysis, taskTitle, language)
    }

    const { data: newTask, error: taskError } = await supabase
        .from('tasks')
        .insert({
            title: taskTitle,
            description: taskTitle,
            organisation_id: sender.organisation_id,
            created_by: sender.id,
            assigned_to: assignee.id,
            status: 'pending',
            source: 'whatsapp',
            language: language ?? null,
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

    const confirmMsg = `✅ *Task Created!*\n\n*Task:*\n"${taskTitle}"\n\n*Assigned to:*\n${assignee.name}\n\n_They'll receive a notification to accept it._`

    await sendWhatsAppReply(phone, confirmMsg)
    await markProcessed(supabase, messageId, 'task_create', null)

    // Notify the assignee (inline confirmation already sent to the actor above)
    await notifyTaskCreated(supabase, {
        ownerName: sender.name,
        ownerId: sender.id,
        assigneeId: assignee.id,
        taskTitle,
        taskId: newTask.id,
        source: 'whatsapp',
        inlineConfirmationSent: true,
        language: language ?? undefined,
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
    taskTitle: string = analysis.what,
    language: string | null = null,
): Promise<void> {
    // ── VALIDATION: WHAT ──
    if (!analysis.what || analysis.what.length < 3) {
        // Create session to wait for task description
        await createSession(phone, 'awaiting_task_description', {
            original_intent: 'todo_create',
            sender_id: sender.id,
            sender_name: sender.name,
            organisation_id: sender.organisation_id,
            task_language: language,
        }, 10, supabase)

        await sendWhatsAppReply(phone,
            '📋 *To-Do Description Needed*\n\nWhat do you want to add as a to-do?\n\nPlease describe it.')
        await markProcessed(supabase, messageId, 'todo_create', 'Awaiting task description via session')
        return
    }

    // ── VALIDATION: WHEN — deadline is mandatory for to-dos ──
    let deadline = analysis.when.date

    // ── Apply T-append + validate in one guarded block to catch LLM hallucinations ──
    if (deadline) {
        if (!deadline.includes('T')) {
            deadline = `${deadline}T20:00:00+05:30`
        }
        if (!isValidDate(deadline)) {
            console.warn(`[ProcessMessage] Invalid date from LLM: "${deadline}" — treating as missing deadline`)
            deadline = null
        }
    }

    if (!deadline) {
        // Create session to wait for deadline
        await createSession(phone, 'awaiting_todo_deadline', {
            original_intent: 'todo_create',
            what: taskTitle,
            sender_id: sender.id,
            sender_name: sender.name,
            organisation_id: sender.organisation_id,
            task_language: language,
        }, 10, supabase)

        await sendWhatsAppReply(phone,
            `⏰ *Deadline Needed*\n\n*To-do:*\n"${taskTitle}"\n\nWhen should this be done?\n\n*Examples:*\n"tomorrow 3pm", "Friday", "March 10"`)
        await markProcessed(supabase, messageId, 'todo_create', 'Awaiting deadline via session')
        return
    }

    // ── Reject past deadlines — ask for a future date via session ──
    if (new Date(deadline).getTime() < Date.now()) {
        await createSession(phone, 'awaiting_todo_deadline', {
            original_intent: 'todo_create',
            what: taskTitle,
            sender_id: sender.id,
            sender_name: sender.name,
            organisation_id: sender.organisation_id,
            task_language: language,
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
            title: taskTitle,
            description: taskTitle,
            organisation_id: sender.organisation_id,
            created_by: sender.id,
            assigned_to: sender.id, // Self-assigned = to-do
            deadline: deadline,
            committed_deadline: deadline, // Auto-commit for to-dos
            status: 'accepted', // Auto-accept to-dos
            source: 'whatsapp',
            language: language ?? null,
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
    const confirmMsg = `✅ *To-Do Created!*\n\n*To-do:*\n"${taskTitle}"\n\n*Deadline:*\n${dateStr} at ${timeStr}`

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
            .eq('title', taskTitle)
            .eq('status', 'accepted')
            .order('created_at', { ascending: false })
            .limit(1)
            .single()

        if (createdTodo) {
            await notifyTaskCreated(supabase, {
                ownerName: sender.name,
                ownerId: sender.id,
                assigneeId: sender.id,
                taskTitle,
                taskId: createdTodo.id,
                committedDeadline: deadline,
                source: 'whatsapp',
                inlineConfirmationSent: true,
                language: language ?? undefined,
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
// vendor_add — Add a vendor to the organisation
// ---------------------------------------------------------------------------

async function handleVendorAdd(
    supabase: SupabaseAdmin,
    messageId: string,
    phone: string,
    sender: SenderUser,
    analysis: AnalyzedMessage,
): Promise<void> {
    const {
        extractPhoneFromText,
        isVendorInOrg,
        isEmployeeInOrg,
        createVendorAndOnboarding,
        getOrgName,
    } = await import('@/lib/vendor-service')
    const { sendVendorApprovalTemplate } = await import('@/lib/whatsapp')

    // Try to extract a phone number from the message text
    const vendorPhone = extractPhoneFromText(analysis.what || '')

    if (!vendorPhone) {
        // No phone found — ask for it via session
        await createSession(phone, 'awaiting_vendor_phone', {
            original_intent: 'vendor_add',
            sender_id: sender.id,
            sender_name: sender.name,
            organisation_id: sender.organisation_id,
        }, 10, supabase)

        await sendWhatsAppReply(phone,
            '📱 *Vendor Phone Number Needed*\n\nPlease send the vendor\'s phone number.\n\nYou can type the number or share a contact.')
        await markProcessed(supabase, messageId, 'vendor_add', 'Awaiting vendor phone via session')
        return
    }

    // Self-add prevention
    const senderPhone10 = normalizePhone(sender.phone_number)
    if (vendorPhone === senderPhone10) {
        await sendWhatsAppReply(phone,
            '❌ *Can\'t Add Yourself*\n\nYou can\'t add yourself as a vendor.')
        await markProcessed(supabase, messageId, 'vendor_add', 'Self-add attempt blocked')
        return
    }

    // Check if already a vendor in the org
    const vendorCheck = await isVendorInOrg(sender.organisation_id, vendorPhone)
    if (vendorCheck.exists) {
        if (vendorCheck.status === 'active') {
            await sendWhatsAppReply(phone,
                `ℹ️ *Already Registered*\n\n${vendorCheck.vendor?.name || vendorPhone} is already a vendor in your organisation.`)
        } else if (vendorCheck.status === 'pending') {
            await sendWhatsAppReply(phone,
                `⏳ *Request Already Pending*\n\nA vendor request is already pending for ${vendorPhone}.`)
        } else {
            // Inactive — allow re-adding by continuing the flow
            // (handled by the EXCLUDE constraint on vendor_onboarding for pending only)
        }
        if (vendorCheck.status === 'active' || vendorCheck.status === 'pending') {
            await markProcessed(supabase, messageId, 'vendor_add', `Vendor already exists: ${vendorCheck.status}`)
            return
        }
    }

    // Check if this phone is an employee in the same org (warn but allow)
    const employeeCheck = await isEmployeeInOrg(sender.organisation_id, vendorPhone)
    if (employeeCheck.exists) {
        await sendWhatsAppReply(phone,
            `ℹ️ *Note:* ${employeeCheck.user?.name} (${vendorPhone}) is already an employee in your organisation.\n\nProceeding with vendor addition anyway.`)
    }

    // Create vendor (pending) + onboarding request
    try {
        const { onboardingId } = await createVendorAndOnboarding(
            sender.organisation_id, vendorPhone, sender.id
        )

        // Send approval template to vendor
        const orgName = await getOrgName(sender.organisation_id)
        const vendorPhoneIntl = `91${vendorPhone}`
        await sendVendorApprovalTemplate(
            vendorPhoneIntl,
            sender.name,
            orgName,
            sender.phone_number,
            onboardingId
        )

        // Confirm to the user
        await sendWhatsAppReply(phone,
            `✅ *Vendor Request Sent!*\n\nA request has been sent to ${vendorPhone}.\nWaiting for their approval.`)
        await markProcessed(supabase, messageId, 'vendor_add', null)
    } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error'
        await sendErrorAndMark(supabase, messageId, phone,
            '❌ *Error*\n\nSomething went wrong while adding the vendor.\n\nPlease try again.',
            `Vendor add failed: ${errMsg}`,
        )
    }
}

// ---------------------------------------------------------------------------
// ticket_create — Create a ticket for a vendor
// ---------------------------------------------------------------------------

async function handleTicketCreate(
    supabase: SupabaseAdmin,
    messageId: string,
    phone: string,
    sender: SenderUser,
    analysis: AnalyzedMessage,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _taskTitle: string = analysis.what,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _language: string | null = null,
): Promise<void> {
    const { createTicket } = await import('@/lib/ticket-service')
    const { getOrgName } = await import('@/lib/vendor-service')
    const { sendTicketAssignmentTemplate } = await import('@/lib/whatsapp')

    // ── Fetch active vendors for the org ──
    const { data: vendors } = await supabase
        .from('org_vendors')
        .select('id, name, first_name, last_name, phone_number')
        .eq('organisation_id', sender.organisation_id)
        .eq('status', 'active')

    if (!vendors || vendors.length === 0) {
        await sendWhatsAppReply(phone,
            "❌ *No Vendors Found*\n\nYou don't have any vendors registered in your organisation yet.\n\nSay *'add vendor'* to register a vendor first.")
        await markProcessed(supabase, messageId, 'ticket_create', 'No active vendors in org')
        return
    }

    // ── STEP 1: Resolve vendor (WHO) ──
    let vendorId: string | null = null
    let vendorName: string | null = null
    let vendorPhone: string | null = null

    if (analysis.who.name) {
        const vendorUsers = vendors.map((v: { id: string; name: string | null; first_name?: string; last_name?: string; phone_number?: string }) => ({
            id: v.id,
            name: v.name || '',
            first_name: v.first_name,
            last_name: v.last_name,
            phone_number: v.phone_number,
        })) as OrgUser[]

        const phoneticResults = findPhoneticMatches(analysis.who.name, vendorUsers, 0.7)
        const matches = phoneticResults.map(r => ({
            id: r.user.id,
            name: r.user.name,
            phone_number: r.user.phone_number,
        }))

        if (matches.length === 0) {
            await createSession(phone, 'awaiting_ticket_vendor', {
                original_intent: 'ticket_create',
                what: analysis.what,
                when_date: analysis.when.date,
                sender_id: sender.id,
                sender_name: sender.name,
                organisation_id: sender.organisation_id,
            }, 10, supabase)

            await sendWhatsAppReply(phone,
                `🔍 *Vendor Not Found*\n\nI couldn't find a vendor named "${analysis.who.name}" in your organisation.\n\nPlease send the vendor's name or phone number.\n\n_To add a new vendor, say 'add vendor'._`)
            await markProcessed(supabase, messageId, 'ticket_create', `Vendor not found: ${analysis.who.name}`)
            return
        }

        if (matches.length > 1) {
            const nameList = matches
                .map((v, i) => `${i + 1}. ${v.name}${v.phone_number ? ` (${v.phone_number})` : ''}`)
                .join('\n')

            await createSession(phone, 'awaiting_ticket_vendor', {
                original_intent: 'ticket_create',
                what: analysis.what,
                when_date: analysis.when.date,
                candidates: matches.map(v => ({ id: v.id, name: v.name, phone_number: v.phone_number })),
                sender_id: sender.id,
                sender_name: sender.name,
                organisation_id: sender.organisation_id,
            }, 10, supabase)

            await sendWhatsAppReply(phone,
                `👥 *Multiple Vendors Found*\n\nWhich vendor did you mean?\n\n${nameList}\n\n_Reply with the number or name._`)
            await markProcessed(supabase, messageId, 'ticket_create', 'Awaiting vendor selection via session')
            return
        }

        // Single match
        vendorId = matches[0].id
        vendorName = matches[0].name
        vendorPhone = matches[0].phone_number || null
    } else {
        // No vendor name mentioned — ask for it
        await createSession(phone, 'awaiting_ticket_vendor', {
            original_intent: 'ticket_create',
            what: analysis.what,
            when_date: analysis.when.date,
            sender_id: sender.id,
            sender_name: sender.name,
            organisation_id: sender.organisation_id,
        }, 10, supabase)

        await sendWhatsAppReply(phone,
            "👤 *Which Vendor?*\n\nPlease send the vendor's name or phone number for this ticket.")
        await markProcessed(supabase, messageId, 'ticket_create', 'Awaiting vendor name via session')
        return
    }

    // ── STEP 2: Validate subject (WHAT) ──
    const subject = analysis.what
    if (!subject || subject.length < 3) {
        await createSession(phone, 'awaiting_ticket_subject', {
            original_intent: 'ticket_create',
            vendor_id: vendorId,
            when_date: analysis.when.date,
            sender_id: sender.id,
            sender_name: sender.name,
            organisation_id: sender.organisation_id,
        }, 10, supabase)

        await sendWhatsAppReply(phone,
            "📋 *Ticket Subject Needed*\n\nWhat is this ticket about?\n\n_Example: 'Invoice #1234 follow-up' or 'Shipment tracking for Order 567'_")
        await markProcessed(supabase, messageId, 'ticket_create', 'Awaiting ticket subject via session')
        return
    }

    // ── STEP 3: Validate deadline (WHEN) — optional, but validate if present ──
    const deadline = analysis.when.date
    if (deadline && isValidDate(deadline) && new Date(deadline) <= new Date()) {
        await createSession(phone, 'awaiting_ticket_deadline', {
            original_intent: 'ticket_create',
            vendor_id: vendorId,
            ticket_subject: subject,
            sender_id: sender.id,
            sender_name: sender.name,
            organisation_id: sender.organisation_id,
        }, 10, supabase)

        await sendWhatsAppReply(phone,
            "⚠️ That deadline is in the past.\n\nPlease provide a future date.\n\n_Example: 'by Friday', 'next week'_")
        await markProcessed(supabase, messageId, 'ticket_create', 'Deadline in the past — awaiting new deadline via session')
        return
    }

    // ── STEP 4: All params ready — create ticket ──
    try {
        const ticket = await createTicket({
            orgId: sender.organisation_id,
            vendorId: vendorId!,
            subject,
            deadline: deadline || undefined,
            createdBy: sender.id,
            source: 'whatsapp',
        })

        // Format deadline for display
        const deadlineStr = deadline
            ? new Date(deadline).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
            : 'No deadline'

        // Notify vendor (fire-and-forget)
        if (vendorPhone) {
            const orgName = await getOrgName(sender.organisation_id)
            sendTicketAssignmentTemplate(
                `91${vendorPhone}`,
                orgName,
                subject,
                sender.name,
                deadlineStr,
                ticket.id,
            ).catch(err => console.error('[ProcessMessage] Ticket vendor notification error:', err))
        }

        // Confirm to user
        const confirmMsg = `✅ *Ticket Created!*\n\nSubject: _${subject}_\nVendor: ${vendorName || vendorPhone}\nDeadline: ${deadlineStr}\n\nWaiting for vendor to accept.`
        await sendWhatsAppReply(phone, confirmMsg)
        await markProcessed(supabase, messageId, 'ticket_create', null)
    } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error'
        await sendErrorAndMark(supabase, messageId, phone,
            '❌ *Error*\n\nSomething went wrong while creating the ticket.\n\nPlease try again.',
            `Ticket create failed: ${errMsg}`,
        )
    }
}

// ---------------------------------------------------------------------------
// review_request — Assignee says they've completed work, wants owner to review
// ---------------------------------------------------------------------------

async function handleReviewRequest(
    supabase: SupabaseAdmin,
    messageId: string,
    phone: string,
    sender: SenderUser,
    analysis: AnalyzedMessage,
): Promise<void> {
    // 1. Fetch all active tasks assigned to this sender that are eligible for review
    const { data: eligibleTasks } = await supabase
        .from('tasks')
        .select('id, title, status, assigned_to, created_by, review_requested_at, committed_deadline, deadline, description, created_at, updated_at')
        .eq('assigned_to', sender.id)
        .in('status', ['accepted', 'overdue'])
        .is('review_requested_at', null)
        .order('created_at', { ascending: false })

    // Also fetch owner info for each task (created_by is a user ID)
    let tasks = (eligibleTasks || []) as Array<{
        id: string; title: string; status: string;
        assigned_to: string; created_by: string;
        review_requested_at: string | null;
        committed_deadline: string | null; deadline: string | null;
        description: string | null; created_at: string; updated_at: string;
    }>

    // Filter out self-assigned tasks (todos) — review doesn't apply to them
    tasks = tasks.filter(t => t.created_by !== t.assigned_to)

    if (tasks.length === 0) {
        await sendWhatsAppReply(phone,
            "ℹ️ *No Tasks Eligible*\n\nYou don't have any active tasks that are ready for a review request.\n\n_Tasks must be accepted and not already pending review._")
        await markProcessed(supabase, messageId, 'review_request', 'No eligible tasks')
        return
    }

    // 2. Owner resolution — if a name was mentioned, filter tasks by owner
    if (analysis.who.name && analysis.who.type === 'person') {
        const ownerMatches = await fuzzyMatchUser(supabase, sender.organisation_id, analysis.who.name)

        if (ownerMatches.length > 0) {
            const ownerIds = new Set(ownerMatches.map(m => m.id))
            const filtered = tasks.filter(t => ownerIds.has(t.created_by))

            if (filtered.length > 0) {
                tasks = filtered
            }
            // If no tasks match the owner filter, fall through to use all tasks
        }
    }

    // 3. Task resolution
    if (tasks.length === 1) {
        // Single task — execute directly
        await executeReviewRequest(supabase, messageId, phone, sender, tasks[0])
        return
    }

    // Multiple tasks — try to resolve using task hint
    if (analysis.what && analysis.what.trim().length > 0) {
        // Enrich tasks with owner names for the resolver
        const ownerIds = Array.from(new Set(tasks.map(t => t.created_by)))
        const { data: owners } = await supabase
            .from('users')
            .select('id, name')
            .in('id', ownerIds)

        const ownerMap = new Map<string, string>((owners || []).map((o: { id: string; name: string }) => [o.id, o.name]))

        const enrichedTasks = tasks.map(t => ({
            ...t,
            created_by: { id: t.created_by, name: ownerMap.get(t.created_by) ?? 'Unknown' },
            assigned_to: { id: t.assigned_to, name: sender.name },
        }))

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const resolverResult = await resolveTask(analysis.what, analysis.what, enrichedTasks as any)

        if (resolverResult.status === 'resolved') {
            const matched = tasks.find(t => t.id === resolverResult.task.id)
            if (matched) {
                await executeReviewRequest(supabase, messageId, phone, sender, matched)
                return
            }
        }
    }

    // 4. Disambiguation — show numbered list
    const ownerIds = Array.from(new Set(tasks.map(t => t.created_by)))
    const { data: ownerData } = await supabase
        .from('users')
        .select('id, name')
        .in('id', ownerIds)

    const ownerNameMap = new Map<string, string>((ownerData || []).map((o: { id: string; name: string }) => [o.id, o.name]))

    const displayTasks = tasks.slice(0, 8) // Limit to 8 for readability
    const taskList = displayTasks
        .map((t, i) => `${i + 1}. "${t.title}" _(from ${ownerNameMap.get(t.created_by) ?? 'Unknown'})_`)
        .join('\n')

    await createSession(phone, 'awaiting_review_task_selection', {
        original_intent: 'review_request',
        task_candidates: displayTasks.map(t => ({
            id: t.id,
            title: t.title,
            owner_name: ownerNameMap.get(t.created_by) ?? 'Unknown',
        })),
        sender_id: sender.id,
        sender_name: sender.name,
        organisation_id: sender.organisation_id,
    }, 10, supabase)

    await sendWhatsAppReply(phone,
        `📋 *Which Task?*\n\nI found multiple tasks you could request review for:\n\n${taskList}\n\n_Reply with the number._`)
    await markProcessed(supabase, messageId, 'review_request', 'Awaiting task selection via session')
}

async function executeReviewRequest(
    supabase: SupabaseAdmin,
    messageId: string,
    phone: string,
    sender: SenderUser,
    task: { id: string; title: string; created_by: string },
): Promise<void> {
    // Race-guarded update
    const { data: updated, error: updateErr } = await supabase
        .from('tasks')
        .update({ review_requested_at: new Date().toISOString() })
        .eq('id', task.id)
        .is('review_requested_at', null)
        .in('status', ['accepted', 'overdue'])
        .select('id')

    if (updateErr || !updated || updated.length === 0) {
        await sendWhatsAppReply(phone,
            'ℹ️ *Already Requested*\n\nA review has already been requested for this task, or the task is no longer active.')
        await markProcessed(supabase, messageId, 'review_request', 'Race guard: already requested or inactive')
        return
    }

    // Audit log
    supabase
        .from('audit_log')
        .insert({
            task_id: task.id,
            user_id: sender.id,
            action: 'task.review_requested',
            metadata: { source: 'whatsapp' },
        })
        .then(() => { /* fire-and-forget */ })
        .catch((err: unknown) => console.error('[ProcessMessage] Audit log error:', err))

    // Look up owner name for the confirmation message
    const { data: owner } = await supabase
        .from('users')
        .select('name')
        .eq('id', task.created_by)
        .single()

    const ownerName = owner?.name || 'the task owner'

    // Confirm to assignee
    await sendWhatsAppReply(phone,
        `✅ *Review Requested!*\n\n*Task:*\n"${task.title}"\n\n${ownerName} has been notified to review your work.`)

    // Notify owner (fire-and-forget)
    notifyReviewRequested(supabase, {
        ownerId: task.created_by,
        assigneeId: sender.id,
        assigneeName: sender.name,
        taskTitle: task.title,
        taskId: task.id,
        source: 'whatsapp',
        inlineConfirmationSent: true,
    }).catch((err: unknown) => console.error('[ProcessMessage] Review notification error:', err))

    await markProcessed(supabase, messageId, 'review_request', null)
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
