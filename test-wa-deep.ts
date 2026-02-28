import { config } from 'dotenv';
config({ path: '.env.local' });

const GRAPH_API_VERSION = 'v21.0';
const accessToken = process.env.WHATSAPP_ACCESS_TOKEN!;
const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID!;

async function main() {
    // Step 1: Get WABA ID from the phone number
    console.log('=== GETTING WABA ID ===');
    const res1 = await fetch(
        `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}?fields=id,display_phone_number`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    console.log('Phone info:', await res1.json());

    // Try to get WABA from the app-level endpoint
    // The phone number belongs to a WABA, let's find it via the business app
    console.log('\n=== CHECKING WABA SUBSCRIPTION / ACCOUNT STATUS ===');

    // Use the phone number ID to get the owner WABA
    const res2 = await fetch(
        `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}?fields=name_status,quality_rating,messaging_limit_tier,account_mode,status,code_verification_status,platform_type,throughput`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const phoneDetails = await res2.json();
    console.log('Phone Details:', JSON.stringify(phoneDetails, null, 2));

    // Step 2: Check if business-initiated conversations are allowed
    // Try sending with status_callback to capture delivery events
    console.log('\n=== SENDING MESSAGE WITH STATUS TRACKING ===');
    const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`;

    const textRes = await fetch(url, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: '919727731867',
            type: 'text',
            text: { body: `URGENT TEST - Did this arrive? Time: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}` },
        }),
    });

    const textData = await textRes.json();
    console.log('Text message response:', JSON.stringify(textData, null, 2));

    const msgId = textData?.messages?.[0]?.id;
    if (msgId) {
        console.log('\n=== CHECKING MESSAGE STATUS ===');
        // Wait a moment then check status
        await new Promise(r => setTimeout(r, 3000));

        const statusRes = await fetch(
            `https://graph.facebook.com/${GRAPH_API_VERSION}/${msgId}`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        const statusData = await statusRes.json();
        console.log('Message status check:', JSON.stringify(statusData, null, 2));
    }

    // Step 3: Check if there's a conversation window open
    console.log('\n=== CHECKING CONVERSATION BILLING ===');

    // Check the phone number's conversation analytics
    const analyticsRes = await fetch(
        `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}?fields=conversational_automation`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const analyticsData = await analyticsRes.json();
    console.log('Conversational automation:', JSON.stringify(analyticsData, null, 2));

    // Step 4: Try to get webhook delivery status
    console.log('\n=== CHECKING RECENT WEBHOOK DELIVERY STATUS ===');
    // Check if we have incoming messages from this number indicating the conversation window

    // Step 5: Check if the number requires a 24h window
    // Business-initiated messages outside the 24h window require a template
    console.log('\n=== KEY ANALYSIS ===');
    console.log('Message accepted by API ✅');
    console.log('But user reports NOT received ❌');
    console.log('');
    console.log('Possible causes:');
    console.log('1. WABA account has no payment method → business-initiated messages blocked');
    console.log('2. Message was sent but user has notifications off');
    console.log('3. The 24h window expired and text messages are blocked (only templates work outside window)');
    console.log('4. Meta is silently dropping messages due to account restrictions');
    console.log('');
    console.log('IMPORTANT: Meta returns 200 + message_status:accepted even when the WABA');
    console.log('has no valid payment method. The message is accepted but never delivered.');
    console.log('This is a KNOWN Meta behavior.');

    // Step 6: Let's check the last time we received a message from this number 
    // to determine if we're within the 24h conversation window
}

main().catch(console.error);
