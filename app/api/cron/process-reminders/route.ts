import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendWhatsAppMessage } from '@/lib/whatsapp'
import { notifyTaskOverdue } from '@/lib/notifications/whatsapp-notifier'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseAdmin = any

interface PendingReminder {
    id: string
    user_id: string
    entity_type: 'self_reminder' | 'scheduled_message'
    subject: string
    message_content: string | null
    recipient_phone: string | null
    recipient_name: string | null
    channel: string
    scheduled_at: string
}

interface ReminderUser {
    phone_number: string
    name: string
}

// ---------------------------------------------------------------------------
// GET handler — Vercel Cron triggers this every 5 minutes
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
    // Verify the request is from Vercel Cron
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
        console.warn('[ProcessReminders] Unauthorized cron request')
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = createAdminClient() as SupabaseAdmin

    try {
        // 1. Fetch all pending reminders whose scheduled_at has passed
        const { data: reminders, error: fetchError } = await supabase
            .from('reminders')
            .select('id, user_id, entity_type, subject, message_content, recipient_phone, recipient_name, channel, scheduled_at')
            .eq('status', 'pending')
            .lte('scheduled_at', new Date().toISOString())
            .limit(50) // Process in batches to avoid timeouts

        if (fetchError) {
            console.error('[ProcessReminders] Failed to fetch reminders:', fetchError.message)
            return NextResponse.json({ error: 'DB fetch failed', details: fetchError.message }, { status: 500 })
        }

        if (!reminders || reminders.length === 0) {
            return NextResponse.json({ status: 'ok', processed: 0 })
        }

        console.log(`[ProcessReminders] Found ${reminders.length} pending reminder(s) to process`)

        let sentCount = 0
        let failedCount = 0

        // 2. Process each reminder
        for (const reminder of reminders as PendingReminder[]) {
            try {
                if (reminder.entity_type === 'self_reminder') {
                    await processSelfReminder(supabase, reminder)
                } else if (reminder.entity_type === 'scheduled_message') {
                    await processScheduledMessage(supabase, reminder)
                } else {
                    console.warn(`[ProcessReminders] Unknown entity_type: ${reminder.entity_type}`)
                    await markReminderFailed(supabase, reminder.id, `Unknown entity_type: ${reminder.entity_type}`)
                    failedCount++
                    continue
                }
                sentCount++
            } catch (err) {
                const errMsg = err instanceof Error ? err.message : 'Unknown error'
                console.error(`[ProcessReminders] Failed to process reminder ${reminder.id}:`, errMsg)
                await markReminderFailed(supabase, reminder.id, errMsg)
                failedCount++
            }
        }

        console.log(`[ProcessReminders] Done — sent: ${sentCount}, failed: ${failedCount}`)

        // 3. Process overdue tasks
        let overdueCount = 0
        try {
            overdueCount = await processOverdueTasks(supabase)
        } catch (err) {
            console.error('[ProcessReminders] Failed to process overdue tasks:', err instanceof Error ? err.message : err)
        }

        return NextResponse.json({
            status: 'ok',
            remindersProcessed: sentCount,
            remindersFailed: failedCount,
            overdueTasksProcessed: overdueCount
        })

    } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error'
        console.error('[ProcessReminders] Unhandled error:', errMsg)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}

// ---------------------------------------------------------------------------
// Self-reminder — Send WhatsApp to the user who set it
// ---------------------------------------------------------------------------

async function processSelfReminder(
    supabase: SupabaseAdmin,
    reminder: PendingReminder,
): Promise<void> {
    // Look up the user's phone number
    const { data: user, error: userError } = await supabase
        .from('users')
        .select('phone_number, name')
        .eq('id', reminder.user_id)
        .single()

    if (userError || !user) {
        throw new Error(`User not found: ${reminder.user_id}`)
    }

    const { phone_number } = user as ReminderUser

    if (!phone_number) {
        throw new Error(`No phone number for user: ${reminder.user_id}`)
    }

    // Format the phone to international format (91XXXXXXXXXX)
    const intlPhone = phone_number.startsWith('91') ? phone_number : `91${phone_number}`

    const message = `⏰ *Reminder:* ${reminder.subject}`

    await sendWhatsAppMessage(intlPhone, message)
    await markReminderSent(supabase, reminder.id)
}

// ---------------------------------------------------------------------------
// Scheduled message — Send WhatsApp to the recipient (Phase 2.2)
// ---------------------------------------------------------------------------

async function processScheduledMessage(
    supabase: SupabaseAdmin,
    reminder: PendingReminder,
): Promise<void> {
    if (!reminder.recipient_phone) {
        throw new Error(`No recipient phone for scheduled message: ${reminder.id}`)
    }

    const intlPhone = reminder.recipient_phone.startsWith('91')
        ? reminder.recipient_phone
        : `91${reminder.recipient_phone}`

    // Look up the sender's name (the person who scheduled the message)
    let senderName = 'your colleague'
    const { data: senderUser } = await supabase
        .from('users')
        .select('name')
        .eq('id', reminder.user_id)
        .single()

    if (senderUser?.name) {
        senderName = (senderUser as ReminderUser).name
    }

    const message = reminder.message_content
        ? `📨 *Message from ${senderName}:*\n\n${reminder.message_content}`
        : `📨 Message from ${senderName}: ${reminder.subject}`

    await sendWhatsAppMessage(intlPhone, message)
    await markReminderSent(supabase, reminder.id)
}

// ---------------------------------------------------------------------------
// Status update helpers
// ---------------------------------------------------------------------------

async function markReminderSent(supabase: SupabaseAdmin, reminderId: string): Promise<void> {
    const { error } = await supabase
        .from('reminders')
        .update({
            status: 'sent',
            sent_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        })
        .eq('id', reminderId)

    if (error) {
        console.error(`[ProcessReminders] Failed to mark reminder ${reminderId} as sent:`, error.message)
    }
}

async function markReminderFailed(supabase: SupabaseAdmin, reminderId: string, reason: string): Promise<void> {
    const { error } = await supabase
        .from('reminders')
        .update({
            status: 'failed',
            failure_reason: reason,
            updated_at: new Date().toISOString(),
        })
        .eq('id', reminderId)

    if (error) {
        console.error(`[ProcessReminders] Failed to mark reminder ${reminderId} as failed:`, error.message)
    }
}

// ---------------------------------------------------------------------------
// Overdue Tasks — Phase 3.3
// ---------------------------------------------------------------------------

async function processOverdueTasks(supabase: SupabaseAdmin): Promise<number> {
    // 1. Fetch pending/accepted tasks that are past their committed_deadline
    const { data: overdueTasks, error: fetchError } = await supabase
        .from('tasks')
        .select('id, title, created_by, assigned_to, committed_deadline')
        .in('status', ['pending', 'accepted'])
        .lte('committed_deadline', new Date().toISOString())
        .limit(50) // Batch processing

    if (fetchError) {
        throw new Error(`DB fetch failed: ${fetchError.message}`)
    }

    if (!overdueTasks || overdueTasks.length === 0) {
        return 0
    }

    console.log(`[ProcessReminders] Found ${overdueTasks.length} overdue task(s) to process`)

    let processedCount = 0

    // 2. Process each overdue task
    for (const task of overdueTasks) {
        try {
            // Update status to 'overdue'
            const { error: updateError } = await supabase
                .from('tasks')
                .update({ status: 'overdue', updated_at: new Date().toISOString() })
                .eq('id', task.id)

            if (updateError) {
                console.error(`[ProcessReminders] Failed to mark task ${task.id} as overdue:`, updateError.message)
                continue
            }

            // Send notifications
            await notifyTaskOverdue(supabase, {
                ownerId: task.created_by,
                assigneeId: task.assigned_to,
                taskTitle: task.title,
                taskId: task.id,
                deadline: task.committed_deadline,
            })

            processedCount++
        } catch (err) {
            console.error(`[ProcessReminders] Failed to process overdue task ${task.id}:`, err instanceof Error ? err.message : err)
        }
    }

    return processedCount
}
