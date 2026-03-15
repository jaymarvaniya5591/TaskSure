import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import * as fs from 'fs'

dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey)

async function main() {
    const { data, error } = await supabase
        .from('task_notifications')
        .select('*')
        .eq('stage', 'acceptance')
        .eq('stage_number', 1)
        .eq('target_role', 'assignee')

    if (error) {
        console.error("Error fetching notifications", error)
        return
    }

    fs.writeFileSync('stage1_calls.json', JSON.stringify(data, null, 2))
    console.log("Wrote metadata to stage1_calls.json")
}

main().catch(console.error)
