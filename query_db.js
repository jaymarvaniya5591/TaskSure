const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
    const phone = '9035451160';
    const phone_91 = '919035451160';
    const phone_plus91 = '+919035451160';

    console.log("--- auth.users ---");
    const { data: authUsers, error: err1 } = await supabase.auth.admin.listUsers();
    if (err1) console.error(err1);
    else console.log(authUsers.users.filter(u => u.phone && u.phone.includes(phone)));

    console.log("--- profiles ---");
    const { data: profiles, error: err2 } = await supabase.from('profiles').select('*').or(`phone.eq.${phone},phone.eq.${phone_91},phone.eq.${phone_plus91}`);
    if (err2) console.error(err2);
    else console.log(profiles);

    console.log("--- employees ---");
    const { data: employees, error: err3 } = await supabase.from('employees').select('*, profiles(*)');
    if (err3) console.error(err3);
    else console.log(employees.filter(e => e.profiles && e.profiles.phone && e.profiles.phone.includes(phone)));

    console.log("--- whatsapp_sessions ---");
    const { data: waSessions, error: err4 } = await supabase.from('whatsapp_sessions').select('*').or(`phone_number.eq.${phone},phone_number.eq.${phone_91},phone_number.eq.${phone_plus91}`);
    if (err4) console.error(err4);
    else console.log(waSessions);
}

main().catch(console.error);
