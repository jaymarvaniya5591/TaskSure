import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey)

async function main() {
    const nowLocal = new Date()
    const minutes = nowLocal.getMinutes()
    const nextCronMinute = Math.ceil((minutes + 1) / 5) * 5
    
    // We want the scheduled time to be right now so the next cron picks it up
    const scheduledTime = new Date()

    const { error } = await supabase
        .from('task_notifications')
        .update({ 
            status: 'pending', 
            call_status: null, 
            failure_reason: null,
            scheduled_at: scheduledTime.toISOString(),
            retry_count: 0
        })
        .eq('task_id', '405fb297-ee2a-4408-8efb-e356882783f7')
        .eq('stage', 'acceptance')
        .eq('stage_number', 1)

    if (error) {
        console.error("Error resetting notification", error)
    } else {
        const nextTime = new Date();
        nextTime.setMinutes(nextCronMinute, 0, 0);
        console.log(`Successfully reset Aditya's stage 1 notification. It will be picked up at exactly ${nextTime.toLocaleTimeString()}`)
    }
}

main().catch(console.error)
