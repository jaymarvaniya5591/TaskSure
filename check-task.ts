import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

async function main() {
    const sb = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data, error } = await sb
        .from('tasks')
        .select('id, title, created_by, assigned_to, status, deadline, committed_deadline, created_at')
        .ilike('title', '%checking for debuging%')
        .order('created_at', { ascending: false })
        .limit(3);

    if (error) {
        console.error('Error:', error);
    } else {
        console.log('Tasks found:', JSON.stringify(data, null, 2));
    }

    process.exit(0);
}

main();
