import { config } from 'dotenv';
config({ path: '.env.local' });

const GRAPH_API_VERSION = 'v21.0';
const accessToken = process.env.WHATSAPP_ACCESS_TOKEN!;
const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID!;

async function main() {
    console.log('=== GETTING ACCOUNT ID ===');
    const res1 = await fetch(
        `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}?fields=name_status,status`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    console.log('Phone details:', await res1.json());

    // NOTE: According to earlier API errors, `whatsapp_business_account` field fetch fails for this specific access token 
    // Let's get incoming messages for a WABA ID, or let's try the /whatsapp_business_profile endpoint first.
    const wabaRes = await fetch(
        `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/whatsapp_business_profile`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    console.log('WABA Data:', await wabaRes.json());
}

main().catch(console.error);
