import { createAdminClient } from './lib/supabase/admin'

interface IncomingMessage {
    id: string
    phone: string
    created_at: string
    raw_text: string
}

async function run() {
    const supabase = createAdminClient();
    const { data, error } = await supabase
        .from('incoming_messages')
        .select('id, phone, created_at, raw_text')
        .order('created_at', { ascending: false })
        .limit(10);

    if (error) { console.error('Error:', error); return; }

    const messages = data as IncomingMessage[];

    console.log('Most recent messages:');
    for (const row of messages) {
        console.log(row.created_at, '|', row.phone, '|', row.raw_text);
    }
}
run();
