import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import * as fs from 'fs'

dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey)

async function main() {
    const { data: timesData } = await supabase
        .from('task_notifications')
        .select('updated_at')
        .in('status', ['sent', 'cancelled', 'error'])
        .order('updated_at', { ascending: false })
        .limit(20)

    const times = timesData?.map(d => new Date(d.updated_at).toLocaleString()) || []

    const { data: failedCall } = await supabase
        .from('task_notifications')
        .select('id, task_id, status, call_status, failure_reason')
        .eq('id', '3dfcf941-ea10-493d-9bb5-2eaac6574736')
        .single()
        
    fs.writeFileSync('cron_status.json', JSON.stringify({
        recentUpdates: times,
        failedCall
    }, null, 2))
    
    console.log("Wrote to cron_status.json")
}

main().catch(console.error)
