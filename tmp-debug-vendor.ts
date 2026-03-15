import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function run() {
    const { data } = await sb.from('org_vendors').select('*').eq('phone_number', '9035451160');
    console.log('vendors', JSON.stringify(data, null, 2));
    const { data: onboarding } = await sb.from('vendor_onboarding').select('*').eq('vendor_phone', '9035451160');
    console.log('onboarding', JSON.stringify(onboarding, null, 2));
}

run();
