import { createAdminClient } from '@/lib/supabase/admin'
import { sendWhatsAppMessage } from '@/lib/whatsapp'
import { getISTDate } from './business-hours'
import { type Task } from '@/lib/types'
import { getLastActiveParticipant, getPendingInfo, isTodo } from '@/lib/task-service'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseAdmin = any



function formatDateAndTime(dateStr: string): string {
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-IN', {
        day: 'numeric', month: 'short',
        timeZone: 'Asia/Kolkata',
    }) + ', ' + d.toLocaleTimeString('en-IN', {
        hour: '2-digit', minute: '2-digit', hour12: true,
        timeZone: 'Asia/Kolkata',
    })
}

export async function processDailySummaries(supabaseAdmin?: SupabaseAdmin): Promise<{ sent: number; failed: number }> {
    const sb = supabaseAdmin || createAdminClient()
    const stats = { sent: 0, failed: 0 }

    try {
        const now = new Date()
        const istNow = getISTDate(now)
        const todayStr = `${istNow.year}-${String(istNow.month + 1).padStart(2, '0')}-${String(istNow.day).padStart(2, '0')}`
        const todayStart = new Date(Date.UTC(istNow.year, istNow.month, istNow.day) - (5.5 * 60 * 60 * 1000))
        const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000)

        // 1. Check if already run today
        const { data: existing } = await sb
            .from('audit_log')
            .select('id')
            .eq('action', 'daily_summary_run')
            .eq('metadata->>date', todayStr)
            .limit(1)

        if (existing && existing.length > 0) {
            console.log(`[DailySummary] Already run today (${todayStr}), skipping`)
            return stats
        }

        // Insert lock record BEFORE sending any messages.
        // If this fails, abort rather than risk sending duplicate messages.
        const { error: insertError } = await sb.from('audit_log').insert({
            action: 'daily_summary_run',
            metadata: { date: todayStr }
        })

        if (insertError) {
            console.error(`[DailySummary] Failed to mark run in audit_log — aborting to prevent duplicate sends:`, insertError)
            return stats
        }

        console.log(`[DailySummary] Processing daily summaries for ${todayStr}`)

        // 2. Fetch users with phones
        const { data: usersData } = await sb
            .from('users')
            .select('id, phone_number, name')
            .not('phone_number', 'is', null)

        if (!usersData || usersData.length === 0) return stats
        const users = usersData as Array<{ id: string; phone_number: string; name: string }>

        // 3. Fetch all active tasks
        const { data: tasksData, error } = await sb
            .from('tasks')
            .select('*, created_by:users!tasks_created_by_fkey(id, name), assigned_to:users!tasks_assigned_to_fkey(id, name)')
            .not('status', 'in', '("completed","cancelled")')

        if (error || !tasksData) {
            console.error('[DailySummary] Failed to fetch tasks:', error?.message)
            return stats
        }
        const allTasks = tasksData as Task[]

        for (const user of users) {
            // Find tasks where user is participant
            const userTasks = allTasks.filter(t =>
                (t.created_by && typeof t.created_by === 'object' && t.created_by.id === user.id) ||
                (t.assigned_to && typeof t.assigned_to === 'object' && t.assigned_to.id === user.id)
            )

            if (userTasks.length === 0) continue

            // Lists
            const todayOwned: Task[] = []
            const todayAssigned: Task[] = []
            const overdueTasks: Task[] = []
            const pendingTasks: Task[] = []

            for (const task of userTasks) {
                const isOwner = task.created_by && typeof task.created_by === 'object' && task.created_by.id === user.id
                const isAssignee = task.assigned_to && typeof task.assigned_to === 'object' && task.assigned_to.id === user.id
                const isSelfAssigned = isTodo(task)

                // Effective deadline for the user
                const effectiveDeadline = isSelfAssigned ? (task.committed_deadline || task.deadline) : task.committed_deadline
                const deadlineDate = effectiveDeadline ? new Date(effectiveDeadline) : null

                const isToday = deadlineDate && deadlineDate >= todayStart && deadlineDate < todayEnd
                const isPast = deadlineDate && deadlineDate < todayStart

                // Active tasks today
                if (isToday && ['accepted', 'pending'].includes(task.status)) {
                    // For todos, goes to owned
                    if (isOwner) todayOwned.push(task)
                    else if (isAssignee) todayAssigned.push(task)
                }

                // Overdue
                if (task.status === 'overdue' || (isPast && task.status === 'accepted')) {
                    overdueTasks.push(task)
                }

                // Pending from me
                const pendingInfo = getPendingInfo(task, user.id, allTasks)
                if (pendingInfo.isPendingFromMe) {
                    pendingTasks.push(task)
                }
            }

            const getPocId = (task: Task) => {
                const poc = getLastActiveParticipant(task, allTasks)
                return poc?.id || null
            }

            // Sort arrays: tasks where POC is the user come first
            const sortByPoc = (a: Task, b: Task) => {
                const aIsMe = getPocId(a) === user.id ? 1 : 0
                const bIsMe = getPocId(b) === user.id ? 1 : 0
                return bIsMe - aIsMe
            }

            todayOwned.sort(sortByPoc)
            todayAssigned.sort(sortByPoc)
            overdueTasks.sort(sortByPoc)
            pendingTasks.sort(sortByPoc)

            // Formatting helper
            const formatTaskLine = (task: Task) => {
                const pocId = getPocId(task)
                const poc = getLastActiveParticipant(task, allTasks)
                const pocName = pocId === user.id ? 'You' : (poc?.name || 'Unknown')
                return `"${task.title}"\n_POC: ${pocName}_`
            }

            const formatOverdueLine = (task: Task) => {
                const pocId = getPocId(task)
                const poc = getLastActiveParticipant(task, allTasks)
                const pocName = pocId === user.id ? 'You' : (poc?.name || 'Unknown')
                const isSelfAssigned = isTodo(task)
                const effectiveDeadline = isSelfAssigned ? (task.committed_deadline || task.deadline) : task.committed_deadline
                const deadlineText = effectiveDeadline ? formatDateAndTime(effectiveDeadline) : 'NA'
                return `"${task.title}"\n_Deadline: ${deadlineText}_\n_POC: ${pocName}_`
            }

            // Build Message 1: Today's Tasks
            let msg1 = ''
            if (todayOwned.length > 0 || todayAssigned.length > 0) {
                msg1 += `📅 TODAY'S TASKS\n───────────────\n`
                if (todayOwned.length > 0) {
                    msg1 += `\n👤 *Owned By You*\n\n` + todayOwned.map(formatTaskLine).join('\n\n')
                }
                if (todayAssigned.length > 0) {
                    msg1 += `\n\n🧑‍💻 *Assigned To You*\n\n` + todayAssigned.map(formatTaskLine).join('\n\n')
                }
            }

            // Build Message 2: Overdue + Not Accepted
            let msg2 = ''
            if (overdueTasks.length > 0 || pendingTasks.length > 0) {
                // 18 chars + emoji -> 20 dashes
                msg2 += `🚨 ATTENTION REQUIRED\n────────────────────\n`
                if (overdueTasks.length > 0) {
                    msg2 += `\n⚠️ *Overdue Tasks*\n\n` + overdueTasks.map(formatOverdueLine).join('\n\n')
                }
                if (pendingTasks.length > 0) {
                    msg2 += `\n\n⏳ *Not Accepted Tasks*\n\n` + pendingTasks.map(formatTaskLine).join('\n\n')
                }
            }

            // Empty state message
            if (!msg1 && !msg2) {
                // 15 chars + emoji -> 16 dashes
                msg1 = `✅ ALL CAUGHT UP!\n────────────────\n\nYou have no tasks due today and no pending actions. Have a great day!`
            }

            // Send Messages
            let phone = user.phone_number
            if (!phone.startsWith('91') || phone.length === 10) phone = `91${phone}`

            try {
                if (msg1) {
                    await sendWhatsAppMessage(phone, msg1)
                }
                if (msg2) {
                    await sendWhatsAppMessage(phone, msg2)
                }
                if (msg1 || msg2) {
                    stats.sent++
                }
            } catch (e) {
                console.error(`[DailySummary] Failed to send to ${user.id}:`, e)
                stats.failed++
            }
        }

    } catch (e) {
        console.error('[DailySummary] Unhandled error:', e)
    }

    return stats
}
