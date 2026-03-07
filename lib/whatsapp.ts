/**
 * WhatsApp Cloud API utility functions.
 * Sends messages via Meta's Graph API.
 * All tokens are server-side only — never exposed to frontend.
 */

const GRAPH_API_VERSION = 'v21.0'

interface WhatsAppSendResult {
    success: boolean
    messageId?: string
    error?: string
}

/**
 * Send a text message to a WhatsApp number via the Cloud API.
 * @param to - Recipient phone number in international format (e.g. "919876543210")
 * @param text - The message body text
 */
export async function sendWhatsAppMessage(
    to: string,
    text: string
): Promise<WhatsAppSendResult> {
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID

    if (!accessToken || !phoneNumberId) {
        console.error(
            '[WhatsApp] Missing WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID'
        )
        return { success: false, error: 'Missing WhatsApp configuration' }
    }

    const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                messaging_product: 'whatsapp',
                recipient_type: 'individual',
                to,
                type: 'text',
                text: { body: text },
            }),
        })

        if (!response.ok) {
            const errorBody = await response.text()
            console.error(
                `[WhatsApp] Send failed (${response.status}):`,
                errorBody
            )
            return {
                success: false,
                error: `HTTP ${response.status}: ${errorBody}`,
            }
        }

        const data = await response.json()
        const messageId = data?.messages?.[0]?.id

        console.log(`[WhatsApp] Message sent to ${to}, id: ${messageId}`)
        return { success: true, messageId }
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        console.error('[WhatsApp] Send error:', message)
        return { success: false, error: message }
    }
}

// ---------------------------------------------------------------------------
// Template message sender (Meta Cloud API)
// ---------------------------------------------------------------------------

interface TemplateComponent {
    type: 'header' | 'body' | 'button'
    sub_type?: 'url' | 'quick_reply'
    index?: string
    parameters: Array<{
        type: 'text' | 'payload'
        text?: string
        payload?: string
    }>
}

/**
 * Send a pre-approved template message via the WhatsApp Cloud API.
 * @param to       - Recipient phone in international format (e.g. "919876543210")
 * @param template - Approved template name (e.g. "auth_signup_link")
 * @param language - Language code the template was approved with (default "en")
 * @param components - Array of header/body/button components with parameters
 */
export async function sendWhatsAppTemplate(
    to: string,
    template: string,
    language: string = 'en',
    components: TemplateComponent[] = []
): Promise<WhatsAppSendResult> {
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID

    if (!accessToken || !phoneNumberId) {
        console.error(
            '[WhatsApp] Missing WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID'
        )
        return { success: false, error: 'Missing WhatsApp configuration' }
    }

    const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`

    const payload: Record<string, unknown> = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'template',
        template: {
            name: template,
            language: { code: language },
            ...(components.length > 0 ? { components } : {}),
        },
    }

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        })

        if (!response.ok) {
            const errorBody = await response.text()
            console.error(
                `[WhatsApp] Template send failed (${response.status}):`,
                errorBody
            )
            return {
                success: false,
                error: `HTTP ${response.status}: ${errorBody}`,
            }
        }

        const data = await response.json()
        const messageId = data?.messages?.[0]?.id

        console.log(`[WhatsApp] Template "${template}" sent to ${to}, id: ${messageId}`)
        return { success: true, messageId }
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        console.error('[WhatsApp] Template send error:', message)
        return { success: false, error: message }
    }
}

// ---------------------------------------------------------------------------
// Scenario-specific template wrappers
// ---------------------------------------------------------------------------

/**
 * Scenario 1: Unregistered user → Signup link (Visit Website button)
 * Template: auth_signup_link
 * URL button {{1}} = raw token value
 */
export async function sendSignupLinkTemplate(
    to: string,
    token: string
): Promise<WhatsAppSendResult> {
    return sendWhatsAppTemplate(to, 'auth_signup_link', 'en', [
        {
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [{ type: 'text', text: token }],
        },
    ])
}

/**
 * Scenario 2: Registered user → Signin link (Visit Website button)
 * Template: auth_signin_link
 * Body {{1}} = user's name
 * URL button {{1}} = raw token value
 */
export async function sendSigninLinkTemplate(
    to: string,
    name: string,
    token: string
): Promise<WhatsAppSendResult> {
    return sendWhatsAppTemplate(to, 'auth_signin_link', 'en', [
        {
            type: 'body',
            parameters: [{ type: 'text', text: name }],
        },
        {
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [{ type: 'text', text: token }],
        },
    ])
}

/**
 * Scenario 3: Partner → Pending join request (Quick Reply button)
 * Template: join_request_pending
 * Body {{1}} = requester name, {{2}} = requester phone
 * Quick Reply button payload = "approve_join_request::{requestId}"
 */
export async function sendJoinRequestPendingTemplate(
    to: string,
    requesterName: string,
    requesterPhone: string,
    requestId: string
): Promise<WhatsAppSendResult> {
    return sendWhatsAppTemplate(to, 'join_request_pending', 'en', [
        {
            type: 'body',
            parameters: [
                { type: 'text', text: requesterName },
                { type: 'text', text: requesterPhone },
            ],
        },
        {
            type: 'button',
            sub_type: 'quick_reply',
            index: '0',
            parameters: [
                { type: 'payload', payload: `approve_join_request::${requestId}` },
            ],
        },
    ])
}

/**
 * Scenario 4: Requester → Join request approved (Quick Reply button)
 * Template: owner_join_request_approved
 * Body {{1}} = owner name. Quick Reply button triggers signin flow.
 * Payload = "trigger_signin"
 */
export async function sendJoinRequestApprovedTemplate(
    to: string,
    partnerName: string
): Promise<WhatsAppSendResult> {
    return sendWhatsAppTemplate(to, 'owner_join_request_approved', 'en', [
        {
            type: 'body',
            parameters: [
                { type: 'text', text: partnerName },
            ],
        },
        {
            type: 'button',
            sub_type: 'quick_reply',
            index: '0',
            parameters: [
                { type: 'payload', payload: 'trigger_signin' },
            ],
        },
    ])
}

/**
 * Scenario 5: Owner assigns task to employee (Quick Reply buttons)
 * Template: task_acceptance_v2
 * Body text: {{1}} = task title, {{2}} = owner name
 * Quick Reply button 1 payload = "task_accept_prompt::{taskId}"
 * Quick Reply button 2 payload = "task_reject_prompt::{taskId}"
 */
export async function sendTaskAssignmentTemplate(
    to: string,
    ownerName: string,
    taskTitle: string,
    taskId: string
): Promise<WhatsAppSendResult> {
    return sendWhatsAppTemplate(to, 'task_acceptance_v2', 'en', [
        {
            type: 'body',
            parameters: [
                { type: 'text', text: taskTitle },
                { type: 'text', text: ownerName },
            ],
        },
        {
            type: 'button',
            sub_type: 'quick_reply',
            index: '0', // First button (Accept)
            parameters: [
                { type: 'payload', payload: `task_accept_prompt::${taskId}` },
            ],
        },
        {
            type: 'button',
            sub_type: 'quick_reply',
            index: '1', // Second button (Reject)
            parameters: [
                { type: 'payload', payload: `task_reject_prompt::${taskId}` },
            ],
        },
    ])
}

/**
 * Stage 2: Mid-task progress check with "Going Well" + "Edit Deadline" buttons
 * Template: task_progress_check
 * Body {{1}} = task title, {{2}} = deadline, {{3}} = owner name
 * Quick Reply button 0 payload = "task_going_well::{taskId}"
 * Quick Reply button 1 payload = "task_edit_deadline_prompt::{taskId}"
 */
export async function sendTaskProgressCheckTemplate(
    to: string,
    taskTitle: string,
    deadline: string,
    ownerName: string,
    taskId: string
): Promise<WhatsAppSendResult> {
    return sendWhatsAppTemplate(to, 'task_progress_check', 'en', [
        {
            type: 'body',
            parameters: [
                { type: 'text', text: taskTitle },
                { type: 'text', text: deadline },
                { type: 'text', text: ownerName },
            ],
        },
        {
            type: 'button',
            sub_type: 'quick_reply',
            index: '0',
            parameters: [
                { type: 'payload', payload: `task_going_well::${taskId}` },
            ],
        },
        {
            type: 'button',
            sub_type: 'quick_reply',
            index: '1',
            parameters: [
                { type: 'payload', payload: `task_edit_deadline_prompt::${taskId}` },
            ],
        },
    ])
}

/**
 * Stage 3a: Deadline approaching notification (Tasks → assignee)
 * Template: task_deadline_approaching
 * Body {{1}} = task title, {{2}} = owner name
 * Quick Reply button 0 payload = "task_edit_deadline_prompt::{taskId}"
 */
export async function sendTaskDeadlineApproachingTemplate(
    to: string,
    taskTitle: string,
    ownerName: string,
    taskId: string
): Promise<WhatsAppSendResult> {
    return sendWhatsAppTemplate(to, 'task_deadline_approaching', 'en', [
        {
            type: 'body',
            parameters: [
                { type: 'text', text: taskTitle },
                { type: 'text', text: ownerName },
            ],
        },
        {
            type: 'button',
            sub_type: 'quick_reply',
            index: '0',
            parameters: [
                { type: 'payload', payload: `task_edit_deadline_prompt::${taskId}` },
            ],
        },
    ])
}

/**
 * Stage 3a: Deadline approaching notification (To-Dos → owner)
 * Template: todo_deadline_approaching
 * Body {{1}} = task title
 * Quick Reply button 0 payload = "task_mark_completed::{taskId}"
 * Quick Reply button 1 payload = "todo_edit_deadline_prompt::{taskId}"
 */
export async function sendTodoDeadlineApproachingTemplate(
    to: string,
    taskTitle: string,
    taskId: string
): Promise<WhatsAppSendResult> {
    return sendWhatsAppTemplate(to, 'todo_deadline_approaching', 'en', [
        {
            type: 'body',
            parameters: [
                { type: 'text', text: taskTitle },
            ],
        },
        {
            type: 'button',
            sub_type: 'quick_reply',
            index: '0',
            parameters: [
                { type: 'payload', payload: `task_mark_completed::${taskId}` },
            ],
        },
        {
            type: 'button',
            sub_type: 'quick_reply',
            index: '1',
            parameters: [
                { type: 'payload', payload: `todo_edit_deadline_prompt::${taskId}` },
            ],
        },
    ])
}

/**
 * Stage 3b: Deadline crossed notification to owner (Tasks)
 * Template: task_overdue_owner
 * Body {{1}} = task title, {{2}} = assignee name
 * Quick Reply button 1 payload = "task_mark_completed::{taskId}"
 * Quick Reply button 2 payload = "task_notify_assignee::{taskId}"
 */
export async function sendTaskOverdueOwnerTemplate(
    to: string,
    taskTitle: string,
    assigneeName: string,
    taskId: string
): Promise<WhatsAppSendResult> {
    return sendWhatsAppTemplate(to, 'task_overdue_owner', 'en', [
        {
            type: 'body',
            parameters: [
                { type: 'text', text: taskTitle },
                { type: 'text', text: assigneeName },
            ],
        },
        {
            type: 'button',
            sub_type: 'quick_reply',
            index: '0',
            parameters: [
                { type: 'payload', payload: `task_mark_completed::${taskId}` },
            ],
        },
        {
            type: 'button',
            sub_type: 'quick_reply',
            index: '1',
            parameters: [
                { type: 'payload', payload: `task_notify_assignee::${taskId}` },
            ],
        },
    ])
}

/**
 * To-Do Stage 3: Deadline crossed notification
 * Template: todo_overdue
 * Body {{1}} = task title
 * Quick Reply button 0 payload = "task_mark_completed::{taskId}"
 * Quick Reply button 1 payload = "todo_edit_deadline_prompt::{taskId}"
 */
export async function sendTodoOverdueTemplate(
    to: string,
    taskTitle: string,
    taskId: string
): Promise<WhatsAppSendResult> {
    return sendWhatsAppTemplate(to, 'todo_overdue', 'en', [
        {
            type: 'body',
            parameters: [
                { type: 'text', text: taskTitle },
            ],
        },
        {
            type: 'button',
            sub_type: 'quick_reply',
            index: '0',
            parameters: [
                { type: 'payload', payload: `task_mark_completed::${taskId}` },
            ],
        },
        {
            type: 'button',
            sub_type: 'quick_reply',
            index: '1',
            parameters: [
                { type: 'payload', payload: `todo_edit_deadline_prompt::${taskId}` },
            ],
        },
    ])
}

// ---------------------------------------------------------------------------
// Media download (for voice notes, images, etc.)
// ---------------------------------------------------------------------------

interface MediaDownloadResult {
    buffer: Buffer
    mimeType: string
}

/**
 * Download a media file from WhatsApp Cloud API.
 * Two-step process:
 *   1. GET /v21.0/{mediaId} → retrieves a temporary download URL
 *   2. GET the download URL → retrieves the raw binary bytes
 *
 * @param mediaId - The media ID from the incoming webhook message (e.g. message.audio.id)
 * @returns Object with the raw Buffer and the MIME type
 * @throws On network errors, missing config, or failed downloads
 */
export async function downloadWhatsAppMedia(
    mediaId: string
): Promise<MediaDownloadResult> {
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN
    if (!accessToken) {
        throw new Error('Missing WHATSAPP_ACCESS_TOKEN environment variable')
    }

    // Step 1: Get the temporary download URL
    const metaUrl = `https://graph.facebook.com/${GRAPH_API_VERSION}/${mediaId}`
    const metaRes = await fetch(metaUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!metaRes.ok) {
        const errBody = await metaRes.text()
        throw new Error(`WhatsApp media meta failed (${metaRes.status}): ${errBody}`)
    }

    const metaData = await metaRes.json() as {
        url?: string
        mime_type?: string
        file_size?: number
    }

    if (!metaData.url) {
        throw new Error('WhatsApp media meta response missing download URL')
    }

    console.log(`[WhatsApp] Downloading media ${mediaId} (${metaData.mime_type}, ${metaData.file_size} bytes)`)

    // Step 2: Download the actual binary content
    const downloadRes = await fetch(metaData.url, {
        headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!downloadRes.ok) {
        const errBody = await downloadRes.text()
        throw new Error(`WhatsApp media download failed (${downloadRes.status}): ${errBody}`)
    }

    const arrayBuffer = await downloadRes.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    console.log(`[WhatsApp] Media downloaded: ${buffer.length} bytes`)

    return {
        buffer,
        mimeType: metaData.mime_type || 'audio/ogg',
    }
}

// ---------------------------------------------------------------------------
// Task Manager Flow Template
// ---------------------------------------------------------------------------

/**
 * Sends the task_manager_flow template to open the Task Dashboard Flow.
 * The user's 10-digit phone number is encoded as flow_token so our
 * endpoint can identify them without a separate DB lookup.
 *
 * @param to       - Recipient phone in international format (e.g. "919727731867")
 * @param phone10  - Normalised 10-digit phone used as flow_token
 */
export async function sendTaskManagerFlowTemplate(
    to: string,
    phone10: string
): Promise<WhatsAppSendResult> {
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID
    const flowId = process.env.WHATSAPP_FLOW_ID
    const templateName = process.env.WHATSAPP_FLOW_TEMPLATE ?? 'task_manager_flow'

    if (!accessToken || !phoneNumberId || !flowId) {
        console.error('[WhatsApp] Missing WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, or WHATSAPP_FLOW_ID')
        return { success: false, error: 'Missing WhatsApp Flow configuration' }
    }

    const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`

    const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'template',
        template: {
            name: templateName,
            language: { code: 'en' },
            components: [
                {
                    type: 'button',
                    sub_type: 'flow',
                    index: '0',
                    parameters: [
                        {
                            type: 'action',
                            action: {
                                flow_token: phone10,
                            },
                        },
                    ],
                },
            ],
        },
    }

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        })

        if (!response.ok) {
            const errorBody = await response.text()
            console.error(`[WhatsApp] Flow template send failed (${response.status}):`, errorBody)
            return { success: false, error: `HTTP ${response.status}: ${errorBody}` }
        }

        const data = await response.json()
        const messageId = data?.messages?.[0]?.id
        console.log(`[WhatsApp] Flow template sent to ${to}, id: ${messageId}`)
        return { success: true, messageId }
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        console.error('[WhatsApp] Flow template send error:', message)
        return { success: false, error: message }
    }
}

