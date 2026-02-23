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
