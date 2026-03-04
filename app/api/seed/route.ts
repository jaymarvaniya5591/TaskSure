import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export const preferredRegion = 'sin1';

// POST /api/seed — Seeds test data into Supabase
// This endpoint creates Supabase Auth users (with phone_confirm: true)
// and inserts matching records into the users, organisations, tasks, and todos tables.
// Safe to run multiple times — uses ON CONFLICT DO NOTHING.
export async function POST() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
        return NextResponse.json(
            { error: 'Missing SUPABASE_SERVICE_ROLE_KEY in .env.local. Go to Supabase Dashboard → Settings → API → service_role secret key.' },
            { status: 500 }
        );
    }

    // Admin client with service role key — bypasses RLS
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false }
    });

    const results: string[] = [];

    try {
        // ═══════════════════════════════════════════════════
        //  1. Create Organisations
        // ═══════════════════════════════════════════════════
        const orgMehta = '11111111-1111-1111-1111-111111111111';
        const orgShah = '22222222-2222-2222-2222-222222222222';

        const { error: orgError } = await supabase.from('organisations').upsert([
            { id: orgMehta, name: 'Mehta Traders', slug: 'mehta-traders' },
            { id: orgShah, name: 'Shah Industries', slug: 'shah-industries' },
        ], { onConflict: 'id' });

        if (orgError) throw new Error(`Orgs: ${orgError.message}`);
        results.push('✅ Organisations created');

        // ═══════════════════════════════════════════════════
        //  2. Create Auth Users (phone-confirmed)
        // ═══════════════════════════════════════════════════
        const testUsers = [
            { phone: '9876543210', name: 'Vikram Mehta', role: 'owner', managerId: null },
            { phone: '9876543211', name: 'Priya Shah', role: 'manager', managerId: null },
            { phone: '9876543212', name: 'Ramesh Patel', role: 'member', managerId: null },
            { phone: '9876543213', name: 'Suresh Kumar', role: 'member', managerId: null },
        ];

        const authUserIds: Record<string, string> = {};

        // Helper: normalize phone for Supabase Auth comparison
        const stripPlus = (p: string) => p.replace(/^\+/, '');

        for (const u of testUsers) {
            // Try to create the auth user first
            const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
                phone: u.phone,
                phone_confirm: true,
            });

            if (newUser?.user) {
                // Successfully created
                authUserIds[u.phone] = newUser.user.id;
                results.push(`✅ Auth user ${u.name} created (${newUser.user.id})`);
            } else if (createError) {
                // User likely already exists — find them by paging through all users
                let found = false;
                let page = 1;
                const perPage = 100;

                while (!found) {
                    const { data: listData } = await supabase.auth.admin.listUsers({
                        page,
                        perPage,
                    });

                    if (!listData?.users || listData.users.length === 0) break;

                    const match = listData.users.find(
                        (eu) => stripPlus(eu.phone || '') === stripPlus(u.phone)
                    );
                    if (match) {
                        authUserIds[u.phone] = match.id;
                        results.push(`ℹ️  Auth user ${u.name} already exists (${match.id})`);
                        found = true;
                    }

                    if (listData.users.length < perPage) break;
                    page++;
                }

                if (!found) {
                    throw new Error(`Auth ${u.name}: ${createError.message} — and could not find existing user`);
                }
            }
        }

        const vikramId = authUserIds['9876543210'];
        const priyaId = authUserIds['9876543211'];
        const rameshId = authUserIds['9876543212'];
        const sureshId = authUserIds['9876543213'];

        // ═══════════════════════════════════════════════════
        //  3. Clean up stale data & insert users
        // ═══════════════════════════════════════════════════
        // Old test data may exist with different UUIDs. Clean up in order:
        // todos → tasks → users (respecting foreign key constraints)
        const testPhones = ['9876543210', '9876543211', '9876543212', '9876543213'];

        // Find old user IDs by phone number
        const { data: oldUsers } = await supabase
            .from('users')
            .select('id')
            .in('phone_number', testPhones);

        if (oldUsers && oldUsers.length > 0) {
            const oldIds = oldUsers.map(u => u.id);
            // Delete todos for these users
            await supabase.from('todos').delete().in('user_id', oldIds);
            // Delete tasks created by or assigned to these users
            await supabase.from('tasks').delete().in('created_by', oldIds);
            await supabase.from('tasks').delete().in('assigned_to', oldIds);
            // Delete the old user rows
            await supabase.from('users').delete().in('id', oldIds);
            results.push(`🧹 Cleaned up ${oldUsers.length} old user rows`);
        }

        // Insert fresh users with IDs matching auth.uid()
        const { error: usersError } = await supabase.from('users').insert([
            { id: vikramId, name: 'Vikram Mehta', phone_number: '9876543210', organisation_id: orgMehta, role: 'owner', reporting_manager_id: null },
            { id: priyaId, name: 'Priya Shah', phone_number: '9876543211', organisation_id: orgMehta, role: 'manager', reporting_manager_id: vikramId },
            { id: rameshId, name: 'Ramesh Patel', phone_number: '9876543212', organisation_id: orgMehta, role: 'member', reporting_manager_id: priyaId },
            { id: sureshId, name: 'Suresh Kumar', phone_number: '9876543213', organisation_id: orgMehta, role: 'member', reporting_manager_id: priyaId },
        ]);

        if (usersError) throw new Error(`Users: ${usersError.message}`);
        results.push('✅ Users inserted into public.users');

        // ═══════════════════════════════════════════════════
        //  4. Insert Tasks (5 tasks)
        // ═══════════════════════════════════════════════════
        const now = new Date();
        const twoDaysLater = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString();
        const oneDayLater = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000).toISOString();
        const fiveDaysLater = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000).toISOString();
        const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();

        const tasks = [
            {
                id: 'b3333333-0000-4000-8000-111111111111',
                title: 'Prepare monthly GST report',
                description: 'Compile all invoices for February GST filing.',
                organisation_id: orgMehta,
                created_by: vikramId,
                assigned_to: priyaId,
                status: 'pending',
                deadline: twoDaysLater,
            },
            {
                id: 'b3333333-0000-4000-8000-222222222222',
                title: 'Dispatch 50 boxes to Surat client',
                description: 'Ensure the tracking details are shared once dispatched.',
                organisation_id: orgMehta,
                created_by: priyaId,
                assigned_to: rameshId,
                status: 'accepted',
                deadline: oneDayLater,
                committed_deadline: oneDayLater,
            },
            {
                id: 'b3333333-0000-4000-8000-333333333333',
                title: 'Collect payment from distributor in Vapi',
                description: 'Rs. 50,000 pending from original invoice.',
                organisation_id: orgMehta,
                created_by: priyaId,
                assigned_to: sureshId,
                status: 'completed',
            },
            {
                id: 'b3333333-0000-4000-8000-444444444444',
                title: 'Check inventory levels in warehouse B',
                description: 'Need physical count of raw materials.',
                organisation_id: orgMehta,
                created_by: priyaId,
                assigned_to: rameshId,
                status: 'overdue',
                deadline: twoDaysAgo,
                committed_deadline: twoDaysAgo,
            },
            {
                id: 'b3333333-0000-4000-8000-555555555555',
                title: 'Finalize new distributor agreement',
                description: 'Review the terms with legal team.',
                organisation_id: orgMehta,
                created_by: vikramId,
                assigned_to: priyaId,
                status: 'pending',
                deadline: fiveDaysLater,
            },
        ];

        const { error: tasksError } = await supabase.from('tasks').upsert(tasks, { onConflict: 'id' });
        if (tasksError) throw new Error(`Tasks: ${tasksError.message}`);
        results.push('✅ 5 tasks inserted');

        // ═══════════════════════════════════════════════════
        //  5. Insert Todos (Vikram's private todos)
        // ═══════════════════════════════════════════════════
        const eightHoursLater = new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString();
        const fourHoursLater = new Date(now.getTime() + 4 * 60 * 60 * 1000).toISOString();
        const twelveHoursLater = new Date(now.getTime() + 12 * 60 * 60 * 1000).toISOString();
        const oneDayAgo = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString();

        const todos = [
            {
                id: 'c4444444-0000-4000-8000-111111111111',
                user_id: vikramId,
                title: 'Call CA about advance tax',
                description: 'Determine Q4 liability',
                status: 'pending',
                due_at: eightHoursLater,
                remind_at: fourHoursLater,
            },
            {
                id: 'c4444444-0000-4000-8000-222222222222',
                user_id: vikramId,
                title: 'Buy sweets for office pooja tomorrow',
                description: 'Kaju Katli from local shop',
                status: 'pending',
                due_at: oneDayLater,
                remind_at: twelveHoursLater,
            },
            {
                id: 'c4444444-0000-4000-8000-333333333333',
                user_id: vikramId,
                title: 'Renew car insurance',
                description: 'Policy expires next week',
                status: 'done',
                due_at: oneDayAgo,
                remind_at: null,
            },
        ];

        const { error: todosError } = await supabase.from('todos').upsert(todos, { onConflict: 'id' });
        if (todosError) throw new Error(`Todos: ${todosError.message}`);
        results.push('✅ 3 todos inserted for Vikram Mehta');

        // ═══════════════════════════════════════════════════
        //  Summary
        // ═══════════════════════════════════════════════════
        return NextResponse.json({
            success: true,
            results,
            userMapping: {
                'Vikram Mehta (+919876543210)': vikramId,
                'Priya Shah (+919876543211)': priyaId,
                'Ramesh Patel (+919876543212)': rameshId,
                'Suresh Kumar (+919876543213)': sureshId,
            },
            loginInstructions: 'Use any of the above phone numbers to log in. OTP for testing is 123456.',
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return NextResponse.json(
            { success: false, error: message, resultsBeforeError: results },
            { status: 500 }
        );
    }
}
