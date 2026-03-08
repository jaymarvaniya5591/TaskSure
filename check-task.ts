import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing Supabase credentials");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkTask() {
    const { data: users, error: userError } = await supabase
        .from('users')
        .select('id, phone_number, name')
        .like('phone_number', '%9727731867%');

    if (userError || !users || users.length === 0) {
        console.error("User not found", userError);
        return;
    }

    const userId = users[0].id;

    const { data: tasks, error: taskError } = await supabase
        .from('tasks')
        .select('*')
        .eq('created_by', userId)
        .ilike('title', '%checking if notif comes with railway todo%')
        .order('created_at', { ascending: false })
        .limit(1);

    if (taskError || !tasks || tasks.length === 0) {
        console.error("Task not found", taskError);
        return;
    }

    const task = tasks[0];

    const { data: notifs } = await supabase
        .from('task_notifications')
        .select('*')
        .eq('task_id', task.id);

    const result = {
        Task: {
            Title: task.title,
            ID: task.id,
            CreatedAt_UTC: task.created_at,
            CreatedAt_Local: new Date(task.created_at).toLocaleString(),
            Deadline_UTC: task.committed_deadline,
            Deadline_Local: task.committed_deadline ? new Date(task.committed_deadline).toLocaleString() : 'N/A',
            Status: task.status
        },
        Notifications: notifs ? notifs.map(n => ({
            Stage: n.stage,
            TargetRole: n.target_role,
            Channel: n.channel,
            Status: n.status,
            ScheduledAt_UTC: n.scheduled_at,
            SentAt_UTC: n.sent_at
        })) : []
    };
    fs.writeFileSync('output.json', JSON.stringify(result, null, 2));
}

checkTask();
