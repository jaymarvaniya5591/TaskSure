import { createAdminClient } from './lib/supabase/admin'

async function run() {
    const supabase = createAdminClient();
    const { data, error } = await supabase
        .from('incoming_messages')
        .select('id, phone, created_at, raw_text')
        .order('created_at', { ascending: false })
        .limit(10);

    if (error) { console.error('Error:', error); return; }

    console.log('Most recent messages:');
    for (const row of data) {
        console.log(row.created_at, '|', row.phone, '|', row.raw_text);
    }
}
run();
