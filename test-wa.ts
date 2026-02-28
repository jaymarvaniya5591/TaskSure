import { config } from 'dotenv';
config({ path: '.env.local' });
import { sendTaskAssignmentTemplate } from './lib/whatsapp';
import { createAdminClient } from './lib/supabase/admin';

async function testWa() {
    const result = await sendTaskAssignmentTemplate(
        '919727731867', // jay marvaniya
        'Beta Tester',
        'checking if this goes to waba account',
        'eeb29629-3d67-4448-ae12-3e5890dfab04'
    );
    console.log("Send result:", result);
}

testWa().catch(console.error);
