import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendWhatsAppMessage, downloadWhatsAppMedia } from '@/lib/whatsapp'
import { callGemini } from '@/lib/gemini'
import { transcribeAudio } from '@/lib/sarvam'
import { normalizePhone } from '@/lib/phone'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GeminiTaskResult {
    intent: 'create_task' | 'update_task' | 'personal_todo' | 'unknown'
    title: string
    description: string | null
    due_date: string | null
    assignee_name: string | null
    confirmation_message: string
}

interface IncomingMessage {
    id: string
    phone: string
    user_id: string | null
    raw_text: string
    processed: boolean
    processing_error: string | null
    intent_type: string | null
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SYSTEM_INSTRUCTION = `You are Boldo AI. Extract structured task data from the user message. Output ONLY valid JSON.

The JSON must have these exact fields:
{
  "intent": "create_task" | "update_task" | "personal_todo" | "unknown",
  "title": "string - concise task title",
  "description": "string | null - optional details",
  "due_date": "string | null - ISO 8601 date if mentioned, e.g. 2026-02-25T18:00:00Z",
  "assignee_name": "string | null - the name of a person mentioned to assign the task to",
  "confirmation_message": "string - friendly WhatsApp confirmation to send back to the user"
}`

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Mark an incoming message as processed, optionally with an error.
 */
async function markProcessed(
    supabase: ReturnType<typeof createAdminClient>,
    messageId: string,
    intentType: string | null,
    error: string | null
): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: updateError } = await (supabase as any)
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

/**
 * Send an error message to the user and mark the message as processed.
 */
async function handleError(
    supabase: ReturnType<typeof createAdminClient>,
    messageId: string,
    phone: string,
    userMessage: string,
    errorDetail: string
): Promise<void> {
    console.error(`[ProcessMessage] ${errorDetail}`)

    try {
        await sendWhatsAppMessage(phone, userMessage)
    } catch (sendErr) {
        console.error('[ProcessMessage] Failed to send error WhatsApp:', sendErr)
    }

    await markProcessed(supabase, messageId, null, errorDetail)
}

/**
 * Safely parse Gemini's JSON response.
 */
function parseGeminiResponse(raw: string): GeminiTaskResult | null {
    try {
        const parsed = JSON.parse(raw)

        // Validate required fields
        if (
            typeof parsed.intent !== 'string' ||
            typeof parsed.title !== 'string' ||
            typeof parsed.confirmation_message !== 'string'
        ) {
            return null
        }

        return {
            intent: parsed.intent,
            title: parsed.title,
            description: parsed.description ?? null,
            due_date: parsed.due_date ?? null,
            assignee_name: parsed.assignee_name ?? null,
            confirmation_message: parsed.confirmation_message,
        }
    } catch {
        return null
    }
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
    // 1. Auth — validate internal secret
    const secret = request.headers.get('x-internal-secret')
    if (!secret || secret !== process.env.INTERNAL_PROCESSOR_SECRET) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // 2. Parse request body
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

    const supabase = createAdminClient()

    try {
        // 3. Fetch message from DB
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: message, error: fetchError } = await (supabase as any)
            .from('incoming_messages')
            .select('id, phone, user_id, raw_text, processed, processing_error, intent_type')
            .eq('id', messageId)
            .single()

        if (fetchError || !message) {
            console.error('[ProcessMessage] Message not found:', messageId, fetchError?.message)
            return NextResponse.json({ status: 'not_found' }, { status: 200 })
        }

        const msg = message as IncomingMessage

        // 4. Idempotency — already processed
        if (msg.processed) {
            console.log('[ProcessMessage] Already processed:', messageId)
            return NextResponse.json({ status: 'already_processed' }, { status: 200 })
        }

        // 5. Resolve sender user by phone number (10-digit normalized)
        const senderPhone10 = normalizePhone(msg.phone)

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: senderUser } = await (supabase as any)
            .from('users')
            .select('id, name, phone_number, organisation_id')
            .eq('phone_number', senderPhone10)
            .single()

        if (!senderUser) {
            await handleError(
                supabase,
                messageId,
                msg.phone,
                'Your phone number is not registered with Boldo. Please sign up first.',
                `User not found for phone: ${msg.phone}`
            )
            return NextResponse.json({ status: 'user_not_found' }, { status: 200 })
        }

        // 6. Audio transcription step (if this is a voice note)
        let textForGemini = msg.raw_text

        if (audioMediaId) {
            console.log(`[ProcessMessage] Audio message detected — downloading media ${audioMediaId}`)
            try {
                // Download audio from WhatsApp
                const { buffer, mimeType } = await downloadWhatsAppMedia(audioMediaId)

                // Transcribe via Sarvam AI
                const transcript = await transcribeAudio(buffer, audioMimeType || mimeType)

                console.log(`[ProcessMessage] Transcription result: "${transcript.substring(0, 100)}${transcript.length > 100 ? '...' : ''}"`)

                    // Update the incoming_messages record with the transcribed text
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    ; (supabase as any)
                        .from('incoming_messages')
                        .update({ raw_text: `[audio] ${transcript}` })
                        .eq('id', messageId)
                        .then(() => { /* ignore */ })
                        .catch((err: unknown) => console.error('[ProcessMessage] Failed to update raw_text with transcript:', err))

                textForGemini = transcript
            } catch (transcribeErr) {
                const errMsg = transcribeErr instanceof Error ? transcribeErr.message : 'Unknown transcription error'
                await handleError(
                    supabase,
                    messageId,
                    msg.phone,
                    "Sorry, I couldn't understand the voice note. Please try again or type your message.",
                    `Audio transcription failed: ${errMsg}`
                )
                return NextResponse.json({ status: 'transcription_error' }, { status: 200 })
            }
        }

        // 7. Call Gemini 2.5 Flash
        let geminiRaw: string
        try {
            geminiRaw = await callGemini(SYSTEM_INSTRUCTION, textForGemini)
        } catch (geminiErr) {
            const errMsg = geminiErr instanceof Error ? geminiErr.message : 'Unknown Gemini error'
            await handleError(
                supabase,
                messageId,
                msg.phone,
                'Something went wrong while processing your request.',
                `Gemini API call failed: ${errMsg}`
            )
            return NextResponse.json({ status: 'gemini_error' }, { status: 200 })
        }

        // 8. Parse Gemini response
        const result = parseGeminiResponse(geminiRaw)
        if (!result) {
            await handleError(
                supabase,
                messageId,
                msg.phone,
                "Sorry, I couldn't understand that. Please rephrase.",
                `Failed to parse Gemini response: ${geminiRaw.substring(0, 500)}`
            )
            return NextResponse.json({ status: 'parse_error' }, { status: 200 })
        }

        // 9. Handle intent: create_task
        if (result.intent === 'create_task' || result.intent === 'personal_todo') {
            let assignedToId = senderUser.id as string

            // Try to resolve assignee by name within the same org
            if (result.assignee_name && result.intent === 'create_task') {
                // Case-insensitive partial match on name, first_name, or last_name
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const { data: matchingUsers } = await (supabase as any)
                    .from('users')
                    .select('id, name, first_name, last_name, phone_number')
                    .eq('organisation_id', senderUser.organisation_id)
                    .ilike('name', `%${result.assignee_name}%`)

                if (matchingUsers && matchingUsers.length === 1) {
                    // Exact single match — use this user
                    assignedToId = matchingUsers[0].id as string
                } else if (matchingUsers && matchingUsers.length > 1) {
                    // Multiple matches — ask user to clarify
                    const nameList = matchingUsers
                        .map((u: { name: string; phone_number?: string }, i: number) =>
                            `${i + 1}. ${u.name}${u.phone_number ? ` (${u.phone_number})` : ''}`
                        )
                        .join('\n')

                    const clarifyMsg =
                        `I found multiple people named "${result.assignee_name}" in your organization:\n\n` +
                        `${nameList}\n\n` +
                        `Please reply with the full name of the person you want to assign this task to.`

                    try {
                        await sendWhatsAppMessage(msg.phone, clarifyMsg)
                    } catch (sendErr) {
                        console.error('[ProcessMessage] Failed to send clarification:', sendErr)
                    }

                    // Mark processed but don't create the task — user needs to clarify
                    await markProcessed(supabase, messageId, 'needs_clarification', null)
                    return NextResponse.json(
                        { status: 'needs_clarification', matches: matchingUsers.length },
                        { status: 200 }
                    )
                }
                // If no match found, falls back to sender (personal to-do)
            }

            // Insert task
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { error: taskError } = await (supabase as any)
                .from('tasks')
                .insert({
                    title: result.title,
                    description: result.description,
                    organisation_id: senderUser.organisation_id,
                    created_by: senderUser.id,
                    assigned_to: assignedToId,
                    deadline: result.due_date,
                    status: 'pending',
                    source: 'whatsapp',
                })

            if (taskError) {
                await handleError(
                    supabase,
                    messageId,
                    msg.phone,
                    'Something went wrong while processing your request.',
                    `Task insert failed: ${taskError.message}`
                )
                return NextResponse.json({ status: 'task_insert_error' }, { status: 200 })
            }
        }

        // 10. Send confirmation via WhatsApp
        try {
            await sendWhatsAppMessage(msg.phone, result.confirmation_message)
        } catch (sendErr) {
            console.error('[ProcessMessage] Failed to send confirmation:', sendErr)
            // Non-fatal — task was already created
        }

        // 11. Mark as processed
        await markProcessed(supabase, messageId, result.intent, null)

        console.log('[ProcessMessage] Successfully processed:', messageId, 'intent:', result.intent, audioMediaId ? '(from audio)' : '')
        return NextResponse.json({ status: 'processed', intent: result.intent }, { status: 200 })
    } catch (err) {
        // 11. Catch-all error handler
        const errMsg = err instanceof Error ? err.message : 'Unknown internal error'
        console.error('[ProcessMessage] Unhandled error:', errMsg)

        // Try to send error message and mark processed
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data: msg } = await (supabase as any)
                .from('incoming_messages')
                .select('phone')
                .eq('id', messageId)
                .single()

            if (msg?.phone) {
                await sendWhatsAppMessage(
                    msg.phone,
                    'Something went wrong while processing your request.'
                )
            }

            await markProcessed(supabase, messageId, null, errMsg)
        } catch (cleanupErr) {
            console.error('[ProcessMessage] Cleanup failed:', cleanupErr)
        }

        return NextResponse.json({ status: 'internal_error' }, { status: 200 })
    }
}
