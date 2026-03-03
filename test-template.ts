import { loadEnvConfig } from '@next/env';
import { sendWhatsAppTemplate } from './lib/whatsapp';

const projectDir = process.cwd();
loadEnvConfig(projectDir);

// Test the template against the known phone number
const testNumber = '919035451160';

console.log(`Testing sendJoinRequestApprovedTemplate with number: ${testNumber}`);

(async () => {
    try {
        // Calling sendWhatsAppTemplate manually to test the parameter fix
        const res = await sendWhatsAppTemplate(testNumber, 'owner_join_request_approved', 'en', [
            {
                type: 'body',
                parameters: [
                    { type: 'text', text: 'Jay Marvaniya' },
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
        ]);
        console.log('Template test executed. Check response.');
        console.log(JSON.stringify(res, null, 2));
    } catch (err) {
        console.error('Test failed:', err);
    }
})();
