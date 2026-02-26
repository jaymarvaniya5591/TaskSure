const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
    const phone_10 = '9035451160';
    const { data, error } = await supabase.from('users').select('*').eq('phone_number', phone_10);
    console.log("Users with phone_number 9035451160:", data);
}

main().catch(console.error);
