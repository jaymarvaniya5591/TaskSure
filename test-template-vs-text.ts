import { config } from 'dotenv';
config({ path: '.env.local' });

const GRAPH_API = 'https://graph.facebook.com/v21.0';
const TOKEN = process.env.WHATSAPP_ACCESS_TOKEN!;
const PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID!;
const TO = '919727731867';

async function sendText(text: string) {
    const res = await fetch(`${GRAPH_API}/${PHONE_ID}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: TO,
            type: 'text',
            text: { body: text },
        }),
    });
    const json = await res.json();
    console.log(`[TEXT] Status: ${res.status}`, JSON.stringify(json, null, 2));
    return json;
}

async function sendTemplate(templateName: string, components: any[]) {
    const res = await fetch(`${GRAPH_API}/${PHONE_ID}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: TO,
            type: 'template',
            template: {
                name: templateName,
                language: { code: 'en' },
                components,
            },
        }),
    });
    const json = await res.json();
    console.log(`[TEMPLATE:${templateName}] Status: ${res.status}`, JSON.stringify(json, null, 2));
    return json;
}

async function main() {
    console.log('=== DEFINITIVE TEMPLATE vs TEXT TEST ===');
    console.log(`Time: ${new Date().toISOString()}`);
    console.log(`Target: ${TO}\n`);

    // Test 1: Plain text (this works — deletion messages arrive)
    console.log('--- Test 1: Plain text message ---');
    await sendText('🧪 Test from script: This is a plain TEXT message. If you see this, text works!');

    // Wait 2 seconds
    await new Promise(r => setTimeout(r, 2000));

    // Test 2: hello_world template (Meta's built-in test template)
    console.log('\n--- Test 2: hello_world template ---');
    await sendTemplate('hello_world', []);

    // Wait 2 seconds
    await new Promise(r => setTimeout(r, 2000));

    // Test 3: task_assignment template (the one that's failing)
    console.log('\n--- Test 3: task_assignment template ---');
    await sendTemplate('task_assignment', [
        {
            type: 'header',
            parameters: [{ type: 'text', text: 'Test Owner' }],
        },
        {
            type: 'body',
            parameters: [{ type: 'text', text: 'Testing template delivery' }],
        },
        {
            type: 'button',
            sub_type: 'quick_reply',
            index: '0',
            parameters: [{ type: 'payload', payload: 'task_accept_prompt::test-id-123' }],
        },
        {
            type: 'button',
            sub_type: 'quick_reply',
            index: '1',
            parameters: [{ type: 'payload', payload: 'task_reject_prompt::test-id-123' }],
        },
    ]);

    console.log('\n=== ALL SENT. Please check your phone:');
    console.log('  - Did you receive the plain text? (Test 1)');
    console.log('  - Did you receive hello_world template? (Test 2)');
    console.log('  - Did you receive task_assignment template? (Test 3)');

    process.exit(0);
}

main();
