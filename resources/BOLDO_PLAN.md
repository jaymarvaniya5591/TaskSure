# Boldo AI Assistant — 20-DAY MVP BUILD PLAN
> **Format:** This file is both a build plan and a living document.
> Update `[ ]` checkboxes to `[x]` as you complete tasks.
> Update `**Status:**` fields as you progress.
> If you fall behind, reschedule by moving incomplete items to the next day and noting the slip.
> If you finish early, pull items from the next day.
> Share this file with any AI (Antigravity, Claude, etc.) for instant context on where you are.

---

## HOW TO USE THIS FILE

**At the start of every Antigravity session, paste this prompt:**
```
Read BOLDO_CONTEXT.md and Boldo AI Assistant_PLAN.md from the project root before doing anything.
BOLDO_CONTEXT.md has the full product vision, schema, and principles.
Boldo AI Assistant_PLAN.md has the day-by-day build plan. Check what day we are on and what is left to build.
All decisions must align with BOLDO_CONTEXT.md.
```

**Daily routine:**
1. Open this file. Find today's day.
2. Read the tasks and the Antigravity prompts for the day.
3. Paste the prompts into Antigravity one by one as you work through the tasks.
4. Check off completed items.
5. Update the STATUS field at the top of the day block.

---

## BEFORE DAY 1 — ANTIGRAVITY + MCP SETUP
> Do this once. Takes ~45 minutes. Every MCP you install here will be used throughout all 20 days.

**Status:** `[ ] Not done`

### Install These MCPs in Antigravity

| MCP / Extension | Install Method | Why You Need It |
|---|---|---|
| Sequential Thinking MCP | MCP Store (1-click) | Makes Antigravity plan before coding. Critical for a non-technical builder. |
| Context7 MCP | Custom JSON config | Gives Antigravity live official docs for Next.js, Supabase, Sarvam, Gemini. Prevents outdated code. |
| Supabase MCP | Custom JSON config | Antigravity can directly create tables, run queries, check your DB. No copy-pasting SQL. |
| Vercel MCP | Custom JSON config | Antigravity can deploy and check logs without you touching a terminal. |
| GitHub MCP | Custom JSON config | Auto-backup your code. Version history. |
| Snyk Extension | Extensions panel (1-click) | Auto-scans AI-generated code for security holes. Runs silently. |
| Browser Agent | Project Settings (built-in) | Antigravity opens Chrome and tests your running app. Your QA engineer. |

### Antigravity Setup Prompts

```
PROMPT 1 — Sequential Thinking MCP:
"Open the MCP Store in Antigravity (Agent panel → '...' → MCP Servers → MCP Store).
Search for 'Sequential Thinking' and install it. Confirm it is active."
```

```
PROMPT 2 — Context7 MCP:
"Open MCP Store → Manage MCP Servers → View raw config (mcp_config.json).
Add this entry exactly:
{
  "context7": {
    "command": "npx",
    "args": ["-y", "@upstash/context7-mcp"]
  }
}
Save and restart the MCP server."
```

```
PROMPT 3 — Supabase MCP:
"Add this to mcp_config.json:
{
  'supabase': {
    'command': 'npx',
    'args': ['-y', '@supabase/mcp-server-supabase@latest', '--access-token', 'YOUR_SUPABASE_TOKEN']
  }
}
I will get my Supabase token from: supabase.com → Account → Access Tokens.
Replace YOUR_SUPABASE_TOKEN with the real token."
```

```
PROMPT 4 — Vercel MCP:
"Add to mcp_config.json:
{
  'vercel': {
    'command': 'npx',
    'args': ['-y', '@vercel/mcp-server'],
    'env': { 'VERCEL_TOKEN': 'YOUR_VERCEL_TOKEN' }
  }
}
I will get the token from: vercel.com → Settings → Tokens."
```

```
PROMPT 5 — GitHub MCP:
"Add to mcp_config.json:
{
  'github': {
    'command': 'npx',
    'args': ['-y', '@modelcontextprotocol/server-github'],
    'env': { 'GITHUB_TOKEN': 'YOUR_PAT' }
  }
}
I will create a GitHub account and get a Personal Access Token from:
GitHub → Settings → Developer Settings → Personal Access Tokens → Tokens (classic)."
```

```
PROMPT 6 — Snyk + Browser Agent:
"In the Antigravity Extensions panel (sidebar), search for 'Snyk Security' and install it.
Say YES to auto-scan AI-generated code.
Then go to Project Settings and enable the Browser Agent.
Install the Chrome extension when prompted."
```

> ⚠️ **Tool limit:** Antigravity recommends max 50 active tools. Disable Vercel MCP when not deploying. Disable GitHub MCP when not committing. Toggle in Agent panel → '...' → MCP Servers.

---

## PHASE 1 — WEB APP FOUNDATION
### Days 1–4: Project setup, database, auth, app shell, core pages

---

### DAY 1 — Project Setup & Database
**Date:** ___________
**Status:** `[ ] Not started` → `[ ] In progress` → `[ ] Complete`
**Goal:** Next.js project running locally. All 11 database tables created with correct schema and RLS. GitHub repo live.

#### Accounts to Create Today (before coding)
- [ ] Supabase — supabase.com
- [ ] Vercel — vercel.com
- [ ] Sarvam AI — sarvam.ai (comes with Rs. 1,000 free credit)
- [ ] Google AI Studio — aistudio.google.com (get Gemini 2.5 Flash API key)
- [ ] Exotel — exotel.com
- [ ] Wati — wati.io (start 7-day free trial)
- [ ] GitHub — github.com
- [ ] Order new SIM — Airtel or Jio website, doorstep delivery, keep unactivated on WhatsApp

#### Tasks
- [ ] Install Node.js from nodejs.org (download and run installer)
- [ ] Create Next.js 14 project with TypeScript, Tailwind CSS, App Router
- [ ] Install packages: @supabase/supabase-js, @supabase/auth-helpers-nextjs, recharts, lucide-react
- [ ] Create all 11 database tables in Supabase with correct schema from BOLDO_CONTEXT.md
- [ ] Enable RLS on all tables. Write RLS policies.
- [ ] Create all required indexes (listed in BOLDO_CONTEXT.md schema section)
- [ ] Create Supabase client files: lib/supabase/client.ts and lib/supabase/server.ts
- [ ] Create private GitHub repo and push initial project
- [ ] Set up .env.local with all environment variables

#### Antigravity Prompts

```
PROMPT 1 — Project creation:
"Read BOLDO_CONTEXT.md first. Then:
Using Context7 MCP, look up the official Next.js 14 App Router setup documentation.
Create a new Next.js 14 project called 'Boldo AI Assistant' with:
- App Router (not Pages Router)
- TypeScript enabled
- Tailwind CSS enabled
- ESLint enabled
Then install these additional packages:
- @supabase/supabase-js
- @supabase/auth-helpers-nextjs
- recharts
- lucide-react
Show me the final folder structure."
```

```
PROMPT 2 — Database tables (run this as one prompt):
"Using the Supabase MCP, create all the following tables in my Supabase project.
Use the exact schema from BOLDO_CONTEXT.md Section 7.
Create tables in this order (to respect foreign key dependencies):
1. organisations
2. users (self-referential FK on reporting_manager_id — create the FK after the table)
3. tasks (parent_task_id self-referential — create FK after table)
4. task_comments
5. todos
6. reminders
7. contacts
8. payments
9. incoming_messages
10. notifications
11. audit_log
After creating all tables, enable Row Level Security on every single one.
Then create these RLS policies:
- todos: user_id = auth.uid() for SELECT, INSERT, UPDATE, DELETE
- tasks: organisation_id = (SELECT organisation_id FROM users WHERE id = auth.uid())
- organisations: id = (SELECT organisation_id FROM users WHERE id = auth.uid())
- users: organisation_id = (SELECT organisation_id FROM users WHERE id = auth.uid())
- notifications: user_id = auth.uid()
- audit_log: READ ONLY for members of same org. No UPDATE or DELETE policy.
- reminders: user_id = auth.uid()
- contacts: organisation_id matches user's org
- payments: organisation_id matches user's org
- task_comments: task is in user's org"
```

```
PROMPT 3 — Indexes:
"Using the Supabase MCP, create all the indexes listed in BOLDO_CONTEXT.md
under 'Required Database Indexes'. Run them now."
```

```
PROMPT 4 — Supabase client:
"Using Context7 MCP, look up the Supabase JavaScript client v2 setup for Next.js 14 App Router.
Create:
- lib/supabase/client.ts (browser client using createBrowserClient)
- lib/supabase/server.ts (server client using createServerClient with cookies)
Use environment variables NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.
Also create a .env.local.example file listing all required environment variables."
```

```
PROMPT 5 — GitHub:
"Using GitHub MCP, create a private repository called 'Boldo AI Assistant'.
Push my current project to it.
Create a proper .gitignore for Next.js that excludes .env.local and node_modules.
Confirm the push was successful."
```

#### End of Day Check
- [ ] `npm run dev` runs without errors at localhost:3000
- [ ] All 11 tables visible in Supabase Table Editor
- [ ] RLS enabled (green lock icon) on all tables
- [ ] GitHub repo has initial commit

---

### DAY 2 — Authentication & Onboarding Flow
**Date:** ___________
**Status:** `[ ] Not started` → `[ ] In progress` → `[ ] Complete`
**Goal:** A new user can sign up with phone OTP, create or join an org, set their reporting manager, and log in on subsequent visits.

#### Tasks
- [ ] Build /login page — phone number input, sends OTP via Supabase Auth
- [ ] Build /login/verify page — 6-digit OTP entry and verification
- [ ] Build /signup page — collect name, org (create new or join existing), reporting manager name
- [ ] Org logic: check if org name exists → join it; if not → create it
- [ ] Reporting manager logic: look up by name in same org → link if found; flag as pending if not found
- [ ] Build auth middleware — redirects unauthenticated users from any /dashboard/* route to /login
- [ ] Build /auth/callback route for Supabase OAuth redirect handling
- [ ] Test complete signup and login flow end-to-end

#### Antigravity Prompts

```
PROMPT 1 — Auth pages:
"Using Context7 MCP, look up Supabase Auth documentation for phone number OTP sign-in in Next.js 14.
Build a complete authentication system with these pages:

1. app/login/page.tsx
   - Phone number input field (Indian format, +91 prefix)
   - 'Send OTP' button
   - Calls Supabase signInWithOtp({ phone })
   - On success: redirect to /login/verify

2. app/login/verify/page.tsx
   - 6-digit OTP input (auto-focus, auto-advance between digits)
   - 'Verify' button
   - Calls Supabase verifyOtp({ phone, token, type: 'sms' })
   - On success: check if user exists in our users table
     - If YES: redirect to /dashboard/home
     - If NO (first time): redirect to /signup

3. app/signup/page.tsx
   - Full Name field
   - Organisation section: radio buttons 'Create new org' / 'Join existing org'
     - If create: text field for org name
     - If join: text field to search existing org by name
   - Reporting Manager Name field (optional — with note: 'Leave blank if you are the owner')
   - Submit button

On signup submit:
   - If creating org: INSERT into organisations, then INSERT into users with organisation_id
   - If joining org: SELECT org by name, then INSERT into users with that organisation_id
   - If reporting manager name provided: SELECT user by name in same org, set reporting_manager_id
   - If reporting manager not found: INSERT user anyway, store pending manager name in metadata, flag for later resolution
   - Redirect to /dashboard/home

Use Tailwind CSS for all styling. Clean, minimal, mobile-friendly."
```

```
PROMPT 2 — Auth middleware:
"Using Context7 MCP, look up Next.js 14 middleware documentation and Supabase auth-helpers middleware.
Create middleware.ts in the project root that:
- Protects all routes starting with /dashboard/*
- Unauthenticated requests to /dashboard/* are redirected to /login
- Authenticated requests to /login are redirected to /dashboard/home
- The /api/* routes are NOT protected by this middleware (they handle auth themselves)
- Public routes: /, /login, /login/verify, /signup, /auth/callback"
```

```
PROMPT 3 — Test data:
"Using Supabase MCP, insert test data so I can develop without needing real WhatsApp:
- 2 organisations: 'Mehta Traders' and 'Shah Industries'
- 4 users in Mehta Traders: Vikram Mehta (owner), Priya Shah (manager, reports to Vikram),
  Ramesh Patel (member, reports to Priya), Suresh Kumar (member, reports to Priya)
- 5 tasks in various statuses assigned between these users
- 3 todos for Vikram (private)
Use realistic Indian names and Gujarati business context."
```

#### End of Day Check
- [ ] Can sign up as a new user with phone OTP
- [ ] Org is created in Supabase on signup
- [ ] Can log in as an existing user
- [ ] Visiting /dashboard/home while logged out redirects to /login

---

### DAY 3 — App Shell & Home Dashboard
**Date:** ___________
**Status:** `[ ] Not started` → `[ ] In progress` → `[ ] Complete`
**Goal:** Main dashboard layout with sidebar navigation live. Home dashboard showing real data from Supabase.

#### Tasks
- [ ] Build dashboard layout with sidebar at app/(dashboard)/layout.tsx
- [ ] Sidebar: links to Home, My Tasks, Tasks I Assigned, Todos, Calendar, Team, Stats, Settings
- [ ] Sidebar: shows logged-in user name, org name, avatar/initials
- [ ] Sidebar: active link highlighted, mobile collapses to hamburger menu
- [ ] Top navbar: page title, notification bell with unread count, user avatar
- [ ] Build home dashboard at app/(dashboard)/home/page.tsx
- [ ] Home sections: Greeting, Today's Tasks, Pending Acceptance, Tasks I Own Needing Action, 7-day calendar strip
- [ ] All data fetched server-side from Supabase using server components
- [ ] Test layout on desktop (1280px), tablet (768px), mobile (375px)

#### Antigravity Prompts

```
PROMPT 1 — App shell:
"Using Context7 MCP, look up Next.js 14 App Router layout documentation and Tailwind CSS docs.
Build the main dashboard layout at app/(dashboard)/layout.tsx.

Requirements:
- Left sidebar (240px wide on desktop)
- Sidebar nav links with icons (use lucide-react for icons):
  Home (House icon), My Tasks (CheckSquare), Tasks I Assigned (ClipboardList),
  Todos (ListTodo), Calendar (Calendar), Team (Users), Stats (BarChart2),
  Settings (Settings)
- Active link: highlighted with blue background, white text
- Bottom of sidebar: user avatar (initials if no photo), name, org name
- Mobile (< 768px): sidebar hidden, hamburger menu button in top-left opens it as overlay
- Top navbar (60px height): page title on left, notification bell icon on right, user avatar
- Notification bell shows a red badge with unread count (hardcode as 0 for now — we will wire it up later)
- Main content area: fills remaining space, scrollable, padding 24px
- Use a clean, professional colour scheme: white sidebar, light grey main background (#F5F7FA),
  dark navy accent (#1A3C5E) for active states
- Fully mobile responsive"
```

```
PROMPT 2 — Home dashboard:
"Build the home dashboard page at app/(dashboard)/home/page.tsx.
Fetch all data server-side using the Supabase server client.
The logged-in user's ID comes from Supabase auth session.

Sections to build:

1. GREETING ROW
   'Good morning, [First Name]' — dynamic based on time of day (morning/afternoon/evening)
   Today's date shown below in format: 'Wednesday, 5 March 2025'

2. TODAY'S TASKS (card)
   Tasks where assigned_to = me AND deadline is today AND status IN (pending, accepted, overdue)
   Each item: task title, assigned by (manager name), deadline time, status badge
   Status badge colours: pending=yellow, accepted=blue, overdue=red, completed=green

3. PENDING ACCEPTANCE (card)
   Tasks where assigned_to = me AND status = 'pending'
   Each item: task title, who assigned it, when it was assigned (e.g. '2 hours ago')
   'ACCEPT' and 'REJECT' buttons (wire up on Day 6)

4. TASKS I OWN NEEDING ACTION (card)
   Tasks where created_by = me AND status = 'pending' (waiting for employee to accept)
   Each item: task title, assigned to (employee name), time since assigned

5. 7-DAY CALENDAR STRIP
   Show Mon to Sun for current week
   Each day: day name, date number, coloured dot if tasks are due that day
   Dot colours: red if any overdue, orange if due today, blue if upcoming
   Clicking a day does nothing for now (we build the full calendar on Day 4)

Use Tailwind for all styling. Use Next.js server components — fetch data on the server.
If any section has no items, show a friendly empty state (e.g. 'No pending tasks today 🎉')."
```

```
PROMPT 3 — Mobile test:
"Open the Browser Agent. Navigate to localhost:3000/dashboard/home.
Take a screenshot at viewport width 375px (mobile).
Tell me everything that looks broken, cramped, or unreadable on mobile.
Give me a prioritised list of fixes."
```

#### End of Day Check
- [ ] Sidebar visible and all links working
- [ ] Home dashboard shows real data from test users
- [ ] Mobile hamburger menu opens/closes correctly
- [ ] Empty states show when no tasks exist

---

### DAY 4 — My Tasks, Assigned Tasks & Calendar
**Date:** ___________
**Status:** `[ ] Not started` → `[ ] In progress` → `[ ] Complete`
**Goal:** Three core pages live with real data. Task detail drawer working. Calendar shows tasks per day.

#### Tasks
- [ ] Build /my-tasks page with tab bar, task cards, task detail drawer
- [ ] Task detail drawer: description, sub-tasks, comments, accept (deadline picker) and reject (reason input) buttons
- [ ] Build /assigned-tasks page with task cards and full detail view
- [ ] Detail view shows: employee's acceptance status, committed deadline, rejection reason, sub-task chain
- [ ] Build /calendar page with monthly grid, coloured dots, day click shows task list
- [ ] Calendar toggle: My Tasks view vs Team Tasks view
- [ ] Commit all code to GitHub

#### Antigravity Prompts

```
PROMPT 1 — My Tasks page:
"Build the My Tasks page at app/(dashboard)/my-tasks/page.tsx.

Tab bar at top: All | Pending | Accepted | Completed | Overdue
Each tab filters the task list. Fetch tasks where assigned_to = current user's ID.

Task card (list item) shows:
- Task title (bold)
- Assigned by: [Manager Name]
- Deadline: formatted as '5 Mar, 3:00 PM' (or 'Today 3:00 PM' if today)
- Status badge (colour-coded)
- 'View Details' button

When 'View Details' is clicked, open a right-side drawer (slides in from right, overlays main content).
The drawer shows:
- Task title and description
- Assigned by: [name], Assigned on: [date]
- Original deadline: [date]
- Committed deadline: [date] (shown if task is accepted)
- Status badge
- Sub-tasks section: list of sub-tasks with their status (empty state if none)
- Comments section: thread of comments with timestamps (empty state if none)
- Action buttons at bottom:
  - If status = 'pending': ACCEPT button (opens inline deadline date/time picker) + REJECT button (opens inline text input for reason)
  - If status = 'accepted': MARK DONE button
  - If status = 'completed' or 'overdue': no action buttons, show read-only history

Wire up the ACCEPT flow:
- User picks a datetime with the date/time picker
- Call a server action that updates task: status='accepted', committed_deadline=[picked datetime]
- Show success toast notification
- Update the UI immediately without page refresh

Wire up the REJECT flow:
- User types a reason
- Call a server action that inserts a row in task_comments with the reason, updates task: status='rejected'
- Show success toast
- Update UI immediately

Wire up MARK DONE:
- Check if all sub-tasks of this task are status='completed' (query Supabase)
- If sub-tasks are not all done: show error message 'Cannot complete — sub-task assigned to [name] is still pending'
- If all done (or no sub-tasks): update task status='completed'
- Show success toast

Use Tailwind. Make the drawer mobile-friendly (full screen on mobile)."
```

```
PROMPT 2 — Assigned Tasks page:
"Build the Tasks I Assigned page at app/(dashboard)/assigned-tasks/page.tsx.
Fetch tasks where created_by = current user's ID.

Task card shows:
- Task title
- Assigned to: [Employee Name + avatar/initials]
- Original deadline
- Committed deadline (shown only if accepted — 'Committed to: 5 Mar 5pm')
- Status badge
- 'View Details' button

Detail drawer (same side-drawer pattern as My Tasks) shows:
- Task title, description
- Assigned to: [name], assigned on: [date]
- Original deadline vs committed deadline (show both if different)
- Status and status history (e.g. 'Accepted on 5 Mar at 2pm')
- If rejected: rejection reason in a highlighted box
- Sub-tasks: list with each sub-task's assignee, status, deadline
- Comments thread
- Action buttons:
  - If status = 'pending' (employee hasn't accepted): CANCEL TASK button
  - If status = 'accepted': CANCEL TASK button (with confirmation prompt)
  - If status = 'rejected': REASSIGN button (opens a user picker to reassign to someone else)

Wire up CANCEL: update task status = 'cancelled', cancel all pending reminders for this task
Wire up REASSIGN: update assigned_to to new user, reset status to 'pending'"
```

```
PROMPT 3 — Calendar page:
"Build the Calendar page at app/(dashboard)/calendar/page.tsx.

Display a full month grid (Monday to Sunday columns, weeks as rows).
Show current month by default. Previous/next month navigation arrows.

For each day cell:
- Day number
- Coloured dots below (one dot per task due that day):
  - Red dot: overdue tasks
  - Orange dot: tasks due today
  - Blue dot: tasks due on a future day
- Max 3 dots visible, '+N more' if more than 3

Toggle at top: 'My Tasks' (tasks assigned to me) vs 'Team Tasks' (tasks I assigned to others)

When user clicks a day: show a panel below the calendar (on mobile) or a side panel (on desktop)
listing all tasks due that day with title, assignee/assigner, and status badge.

Fetch all tasks for the current month in a single Supabase query.
Do NOT make a separate query per day cell (that would be N queries).
Filter client-side by date after the initial fetch.

Make it mobile-responsive. On mobile, the grid cells are smaller but still readable."
```

```
PROMPT 4 — GitHub commit:
"Using GitHub MCP, commit all of today's work with message:
'Day 4: My Tasks, Assigned Tasks, Calendar pages complete'
Tag this commit as v0.1.0-core-pages"
```

#### End of Day Check
- [ ] My Tasks page shows tasks with correct tab filtering
- [ ] Accept and reject flows update Supabase and show success feedback
- [ ] Assigned Tasks page shows task details including committed deadlines
- [ ] Calendar shows coloured dots for tasks and detail panel on day click
- [ ] All pages tested on mobile

---

## PHASE 2 — WEB APP ADVANCED FEATURES
### Days 5–8: Team, Stats, Todos, Real-time, Notifications, Create Task

---

### DAY 5 — Team, Stats & Settings Pages
**Date:** ___________
**Status:** `[ ] Not started` → `[ ] In progress` → `[ ] Complete`
**Goal:** Org chart, performance stats, and settings all live with role-based access.

#### Tasks
- [ ] Build /team page with visual org chart (CSS tree, no external library)
- [ ] Each person card: name, role, tasks completed this month, tasks delayed this month
- [ ] Clicking a person (managers only) shows their task list
- [ ] Build /stats page with Recharts bar chart + performance table
- [ ] Stats: per-employee tasks assigned, completed, delayed, avg delay hrs, on-time %
- [ ] Stats only visible to manager/owner role. Employees see own stats only.
- [ ] Build /settings page with 3 tabs: Profile, Organisation, Notifications
- [ ] Profile tab: edit name, upload avatar to Supabase Storage
- [ ] Organisation tab (owner only): view members, change roles, remove members
- [ ] Notifications tab: toggle switches saved to notification_prefs in Supabase

#### Antigravity Prompts

```
PROMPT 1 — Team org chart:
"Build the Team page at app/(dashboard)/team/page.tsx.

Fetch all users in the current user's organisation.
Build a tree data structure client-side: each user is a node, parent = reporting_manager_id.
Users with no reporting_manager_id (or reporting_manager_id pointing to someone outside the org) are root nodes.

Display as a CSS indented tree:
- Root level: no indent
- Each level of reporting: indent by 32px
- Each person: a card showing name, role badge, tasks completed this month (green), tasks delayed (red)
- Role badge colours: owner=navy, manager=blue, member=grey
- Clicking a person's card (only if current user is manager/owner): show their task list in a drawer

Also show a search bar above the tree to find any team member by name.

Fetch task counts using a Supabase query:
SELECT assigned_to, 
  COUNT(*) FILTER (WHERE status='completed' AND updated_at >= date_trunc('month', NOW())) as completed_this_month,
  COUNT(*) FILTER (WHERE status='overdue' AND updated_at >= date_trunc('month', NOW())) as delayed_this_month
FROM tasks
WHERE organisation_id = [current org id]
GROUP BY assigned_to"
```

```
PROMPT 2 — Stats page:
"Build the Stats page at app/(dashboard)/stats/page.tsx.

Role-based access:
- If current user role = 'member': show only their own stats (single row, no bar chart comparison)
- If current user role = 'manager' or 'owner': show all users in their reporting chain

Date range filter: buttons for 'This Week' | 'This Month' | 'Last 3 Months' | 'Custom'

Bar chart (using Recharts BarChart):
- X axis: employee names
- Two bars per employee: 'Completed' (green) and 'Delayed' (orange)
- Tooltip on hover showing exact numbers

Table below chart:
| Employee | Assigned | Completed | Delayed | Avg Delay (hrs) | On-Time % |

Calculate on-time % as: (completed tasks where completed_at <= committed_deadline) / total completed * 100

Fetch all required data in 2-3 Supabase queries. Do not make per-employee queries."
```

```
PROMPT 3 — Settings page:
"Build the Settings page at app/(dashboard)/settings/page.tsx with 3 tabs.

TAB 1 — Profile:
- Name field (editable, saves to users table on submit)
- Avatar upload (upload to Supabase Storage bucket called 'avatars', save public URL to users.avatar_url)
- Phone number shown (read-only in MVP)
- Save button with loading state

TAB 2 — Organisation (only visible if current user role = 'owner'):
- Org name field (editable)
- Members list: table with Name | Role | Actions
- Actions per member: change role dropdown (member/manager) + Remove button
- Removing a member: set organisation_id = NULL on that user row (soft remove, does not delete)

TAB 3 — Notifications:
- Toggle switch: WhatsApp Reminders (task accept/reject reminders)
- Toggle switch: Call Reminders (AI voice call reminders for urgent tasks)
- Toggle switch: Overdue Alerts (alerts when tasks go overdue)
- Toggle switch: To-Do Reminders (personal to-do WhatsApp reminders)
Each toggle: UPDATE users SET notification_prefs = jsonb_set(notification_prefs, ...) on change.
Show a small loading spinner on each toggle while saving."
```

#### End of Day Check
- [ ] Team org chart renders correctly with real user hierarchy
- [ ] Stats page shows bar chart and table with real task data
- [ ] Regular members cannot see the Organisation tab in settings
- [ ] Notification toggles save correctly to Supabase

---

### DAY 6 — Todos Page, Create Task, Real-Time & Notifications
**Date:** ___________
**Status:** `[ ] Not started` → `[ ] In progress` → `[ ] Complete`
**Goal:** Private todos fully working. Create task from web app. Real-time updates across all pages. Notification bell and page live.

#### Tasks
- [ ] Build /todos page — private to current user, no one else can access
- [ ] Todo creation: title, optional description, remind_at (datetime picker), due_at (date picker)
- [ ] Todo list: pending, done, overdue tabs
- [ ] Marking todo done: updates status, cancels pending reminders for that todo
- [ ] Build floating Create Task button on all dashboard pages
- [ ] Create Task modal: title, description, assign to (autocomplete from org users), deadline picker
- [ ] On submit: insert task, insert reminder rows, send optimistic UI update
- [ ] Add Supabase real-time subscriptions to dashboard — status changes update all tabs instantly
- [ ] Build notifications table with database trigger (auto-insert on task status change)
- [ ] Build notification bell in navbar with real-time unread count
- [ ] Build /notifications page with full notification history

#### Antigravity Prompts

```
PROMPT 1 — Todos page:
"Build the Todos page at app/(dashboard)/todos/page.tsx.

CRITICAL PRIVACY REQUIREMENT: This page must ONLY show todos where user_id = current user's ID.
The Supabase RLS policy enforces this at the database level, but also add a WHERE clause in every query.
There is NO sharing, NO visibility to managers, NO stats collection from this page.

Tab bar: Pending | Done | Overdue

Todo creation (inline form at top of page, NOT a modal):
- Title field (required)
- 'When do you want to be reminded?' — date + time picker → saves to remind_at
- 'What is the due date?' — date picker (defaults to today) → saves to due_at
- Submit button: inserts into todos table
- After insert: create 2 rows in reminders table:
  1. entity_type='todo', entity_id=[new todo id], user_id=[me], channel='whatsapp',
     scheduled_at=[remind_at value]
  2. entity_type='todo', entity_id=[new todo id], user_id=[me], channel='whatsapp',
     scheduled_at=[due_at date at 20:00]  (8pm EOD fallback)
  Skip creating the 8pm reminder if remind_at is already past 7pm on the same day.

Todo card:
- Checkbox on left (clicking marks as done)
- Title
- Remind at: [time]
- Due: [date]
- Delete button (deletes todo AND sets status='cancelled' on its pending reminders)

On mark done:
- UPDATE todos SET status='done', updated_at=NOW()
- UPDATE reminders SET status='cancelled' WHERE entity_id=[todo id] AND status='pending'
- Show strikethrough animation on the todo card then move to Done tab"
```

```
PROMPT 2 — Create Task modal:
"Add a floating circular '+' button (fixed position, bottom-right, 56px diameter, navy background)
that appears on all dashboard pages (add it to the dashboard layout).

Clicking it opens a modal with:
- Task Title (required text input)
- Description (optional textarea, 3 rows)
- Assign To (required — autocomplete input):
  - As user types, fetch matching users from current org (by name)
  - Show dropdown with matching results: avatar/initials + name + role
  - Selecting a user fills the field
- Deadline (required — date + time picker)
- Cancel and Create Task buttons

On Create Task submit:
1. INSERT into tasks: title, description, assigned_to, organisation_id, created_by, deadline, status='pending', source='web'
2. INSERT into task_comments if description is non-empty (as initial description comment)
3. INSERT 2 rows into reminders for this task:
   - {entity_type:'task', entity_id:[new id], user_id:[assignee id], channel:'whatsapp', scheduled_at: NOW()+10min}
   - {entity_type:'task', entity_id:[new id], user_id:[assignee id], channel:'call', scheduled_at: NOW()+30min}
4. INSERT into notifications: {user_id:[assignee], type:'task_assigned', message:'[Manager] assigned you: [title]', entity_type:'task', entity_id:[task id]}
5. INSERT into audit_log: {action:'task.created', entity_type:'task', entity_id:[task id], user_id:[creator], organisation_id:[org id]}
6. Close modal, show success toast 'Task assigned to [name]'
7. Update task lists on current page optimistically (add the new task without page refresh)"
```

```
PROMPT 3 — Real-time subscriptions:
"Using Context7 MCP, look up Supabase real-time JavaScript subscriptions for Next.js.
Create a React context provider at providers/RealtimeProvider.tsx that:

1. Subscribes to changes on the 'tasks' table filtered by organisation_id = current user's org
2. Subscribes to changes on the 'notifications' table filtered by user_id = current user
3. On any task INSERT or UPDATE: updates the task lists in the dashboard without page refresh
4. On any notification INSERT: increments the unread count on the notification bell
5. Shows a toast notification when:
   - A task assigned to me changes status (someone accepted/rejected/completed something I own)
   - A new task is assigned to me

Wrap the dashboard layout (app/(dashboard)/layout.tsx) with this provider.

Also update the notification bell in the navbar to:
- Show count from notifications table where user_id = me AND is_read = false
- Update in real-time via the subscription above"
```

```
PROMPT 4 — Notifications page:
"Build the Notifications page at app/(dashboard)/notifications/page.tsx.

Also add a notification dropdown to the bell icon in the navbar (shows last 5 unread).
Clicking the bell opens the dropdown. 'View All' link at bottom goes to /notifications page.

Notification page shows full list, newest first:
- Unread notifications: white background with blue left border
- Read notifications: grey background
- Each item: icon (based on type), message text, time ago, task title as link
- 'Mark all as read' button at top
- Clicking any notification: marks it as read (UPDATE is_read=true), navigates to relevant task

Notification types and their icons (use lucide-react):
- task_assigned: ClipboardList icon
- task_accepted: CheckCircle icon (green)
- task_rejected: XCircle icon (red)
- task_completed: CheckSquare icon (green)
- task_overdue: AlertTriangle icon (orange)
- todo_due: Bell icon"
```

```
PROMPT 5 — GitHub commit:
"Using GitHub MCP, commit all of today's work:
'Day 6: Todos, Create Task, Real-time subscriptions, Notifications complete'
Tag as v0.2.0-webapp-complete"
```

#### End of Day Check
- [ ] Todos page shows only my todos — cannot see anyone else's
- [ ] Creating a todo inserts reminder rows in Supabase correctly
- [ ] Create Task modal works end-to-end — task appears in assignee's My Tasks
- [ ] Opening two browser windows — status change in one updates the other in real-time
- [ ] Notification bell count updates in real-time

---

### DAY 7 — Web App Polish, Mobile & Deploy
**Date:** ___________
**Status:** `[ ] Not started` → `[ ] In progress` → `[ ] Complete`
**Goal:** Web app is pixel-perfect on mobile. Deployed to Vercel production. Full end-to-end browser test passing.

#### Tasks
- [ ] Full mobile audit of every page (375px viewport) — fix all issues
- [ ] Full end-to-end test as a new user using Browser Agent
- [ ] Fix top issues found in test
- [ ] Deploy to Vercel production with all environment variables set
- [ ] Set up Vercel error alerts (email notification on function crash)
- [ ] Buffer time — catch up on anything incomplete from Days 1–6

#### Antigravity Prompts

```
PROMPT 1 — Mobile audit:
"Open the Browser Agent.
Go through each of these pages at 375px viewport width (mobile):
1. /login
2. /signup
3. /dashboard/home
4. /dashboard/my-tasks
5. /dashboard/assigned-tasks
6. /dashboard/todos
7. /dashboard/calendar
8. /dashboard/team
9. /dashboard/stats
10. /dashboard/settings
11. /dashboard/notifications

For each page: take a screenshot and list every UI issue (overlapping elements,
text too small, buttons too small to tap, content cut off, horizontal scroll issues,
sidebar not collapsing correctly).

Then fix all issues in priority order:
1. Anything that breaks core functionality on mobile
2. Anything that looks unprofessional
3. Minor spacing/sizing issues"
```

```
PROMPT 2 — End-to-end test:
"Open the Browser Agent and test the complete web app flow as a new user.
Do NOT use existing test data — simulate a truly fresh signup.

Test flow:
1. Go to /login → enter a test phone number → verify OTP
2. Complete /signup → create org 'Test Company' → set no reporting manager (owner)
3. Land on /dashboard/home → verify greeting and empty states
4. Create a task assigned to test user 2 (first invite them if needed)
5. Switch to test user 2's session → see task in Pending Acceptance
6. Accept the task with a deadline 1 hour from now
7. Switch back to user 1 → verify real-time update shows task accepted
8. Switch back to user 2 → mark task as DONE
9. Verify user 1 gets a notification
10. Check /stats → verify task appears in completed count
11. Add a personal todo → verify it's private and appears on /todos

Screenshot every step. Give me a final verdict: pass or fail per step."
```

```
PROMPT 3 — Vercel deploy:
"Using Vercel MCP, deploy my Boldo AI Assistant project to production.
Set these environment variables in Vercel:
- NEXT_PUBLIC_SUPABASE_URL (from Supabase project settings)
- NEXT_PUBLIC_SUPABASE_ANON_KEY (from Supabase project settings)
- SUPABASE_SERVICE_ROLE_KEY (from Supabase project settings → KEEP THIS SERVER-SIDE ONLY)
- GEMINI_API_KEY (from Google AI Studio)
- SARVAM_API_KEY (from Sarvam AI dashboard)
- WATI_API_KEY (from Wati dashboard)
- WATI_API_URL (from Wati dashboard)
- EXOTEL_SID (from Exotel dashboard)
- EXOTEL_TOKEN (from Exotel dashboard)

After deploy: check the Vercel function logs for any startup errors.
Return the live production URL."
```

#### End of Day Check
- [ ] All pages look correct on 375px mobile viewport
- [ ] End-to-end test: all steps pass
- [ ] Live production URL working
- [ ] Vercel error alerts configured

---

## PHASE 3 — WHATSAPP BOT
### Days 8–13: Webhook, transcription, intent classification, task flows, todo flows, reminder system

---

### DAY 8 — Webhook Setup & Voice Transcription
**Date:** ___________
**Status:** `[ ] Not started` → `[ ] In progress` → `[ ] Complete`
**Goal:** WhatsApp messages (text and voice) arrive in our system and are logged. Voice notes transcribed accurately in Gujarati.

> ⚠️ Your new SIM should have arrived by now. Activate it and register it with Wati before starting this day.

#### Tasks
- [ ] Register new SIM with Wati, complete Meta WhatsApp Business API verification
- [ ] Build /api/webhook route handling GET (verification) and POST (incoming messages)
- [ ] Deploy webhook URL to Vercel, paste into Wati → Settings → Webhook
- [ ] Verify test messages arrive in Vercel logs
- [ ] Build lib/transcribe.ts using Sarvam Saaras v3 with Gujarati + code_mix support
- [ ] Test with 5 Gujarati voice notes — verify accurate transcripts
- [ ] Test with 5 Hinglish voice notes
- [ ] Store all incoming messages in incoming_messages table

#### Antigravity Prompts

```
PROMPT 1 — Webhook route:
"Using Context7 MCP, look up the Wati WhatsApp API webhook documentation.
Build app/api/webhook/route.ts that:

Handles GET requests (Wati webhook verification):
- Wati sends: ?hub.mode=subscribe&hub.verify_token=YOUR_TOKEN&hub.challenge=RANDOM_STRING
- Verify that hub.verify_token matches env var WATI_VERIFY_TOKEN
- If match: return hub.challenge as plain text response with status 200
- If no match: return 403

Handles POST requests (incoming messages):
- Immediately return { status: 'ok' } with HTTP 200 (MUST be within 200ms)
- After returning: process the message asynchronously
- Extract from Wati payload: sender phone number, message type ('text' or 'audio'), text content or audio URL
- Log to Supabase incoming_messages table: { phone, raw_text: text or '[audio]', language_detected: null, intent_type: null, processed: false }
- If message type is 'audio': call lib/transcribe.ts asynchronously
- If message type is 'text': proceed directly to intent classification (lib/classifyIntent.ts — we build this tomorrow)

Add a WATI_VERIFY_TOKEN environment variable with value 'BOLDO_webhook_2025'"
```

```
PROMPT 2 — Voice transcription:
"Using Context7 MCP, look up the Sarvam AI Saaras v3 Speech-to-Text API documentation.
Build lib/transcribe.ts:

export async function transcribeAudio(audioUrl: string): Promise<string> {
  // 1. Download audio file from audioUrl using fetch
  // 2. Convert to the format Sarvam expects (check docs for required format)
  // 3. Send to Sarvam Saaras v3 API with these parameters:
  //    - language_code: 'gu-IN' (Gujarati India)
  //    - model: 'saaras:v3'
  //    - With_timestamps: false
  //    - code_switching: true  (handles Gujarati + English mixed speech)
  // 4. Return the transcript text
  // 5. On any error: throw a descriptive error that includes the Sarvam error message
}

Use environment variable SARVAM_API_KEY.
Add proper TypeScript types.
Add retry logic: if Sarvam fails, retry once after 2 seconds before throwing."
```

```
PROMPT 3 — Integration test:
"Update app/api/webhook/route.ts to use lib/transcribe.ts.
When an audio message arrives:
1. Download the audio file
2. Call transcribeAudio()
3. UPDATE the incoming_messages row: raw_text = transcript, language_detected = 'gu'
4. If transcription fails: UPDATE incoming_messages: processing_error = error message
   And send WhatsApp back to sender via Wati: 'Sorry, I could not process your voice note. Please try again or send as text.'

To send a WhatsApp message via Wati, build lib/sendWhatsApp.ts:
export async function sendWhatsApp(phone: string, message: string): Promise<void>
Use WATI_API_URL and WATI_API_KEY environment variables.
Look up Wati send message API docs using Context7 MCP."
```

#### End of Day Check
- [ ] WhatsApp messages arrive in Vercel function logs within 2 seconds
- [ ] Voice note in Gujarati is transcribed and stored in incoming_messages.raw_text
- [ ] Transcription error sends a friendly WhatsApp back to the sender
- [ ] Text messages are logged to incoming_messages table correctly

---

### DAY 9 — Intent Classification & Task Creation Flow
**Date:** ___________
**Status:** `[ ] Not started` → `[ ] In progress` → `[ ] Complete`
**Goal:** Gemini correctly classifies every message as task, todo, reply, or unknown. Task creation via WhatsApp fully working end-to-end.

#### Tasks
- [ ] Build lib/classifyIntent.ts using Gemini 2.5 Flash
- [ ] Classification categories: task_create, todo_create, task_reply, payment_create, unknown
- [ ] Build lib/extractTask.ts — extracts assignee, description, deadline from task_create messages
- [ ] Build lib/processTaskCreation.ts — full orchestration: lookup user → create task → send WhatsApp → insert reminders
- [ ] Handle: user not found, no deadline, low confidence extraction
- [ ] Test with 10 diverse messages (Gujarati, Hinglish, English)

#### Antigravity Prompts

```
PROMPT 1 — Intent classification:
"Using Context7 MCP, look up Google Gemini 2.5 Flash API documentation for structured JSON output.
Build lib/classifyIntent.ts:

export async function classifyIntent(text: string): Promise<{
  intent: 'task_create' | 'todo_create' | 'task_reply' | 'payment_create' | 'unknown';
  confidence: 'high' | 'medium' | 'low';
  raw_reply_keyword?: string;  // if task_reply: the actual keyword used (ACCEPT, REJECT, DONE etc.)
}>

Use Gemini 2.5 Flash (non-thinking mode) with this system prompt:
'You are an intent classifier for an Indian business WhatsApp bot. Classify the message.

Return ONLY a JSON object. No explanation.

Intent options:
- task_create: message assigns work to another named person (e.g. Tell Ramesh to..., Ask Priya to send...)
- todo_create: message is a personal reminder for the SENDER (e.g. Remind me to..., I need to..., Maro kaam chhe...)
- task_reply: message is a reply keyword (ACCEPT, REJECT, DONE, DELEGATE, STATUS, HELP, CANCEL, EXTEND, TEAM, MY TASKS)
- payment_create: message is about collecting or paying money (e.g. Collect Rs X from..., Mehta ne paise apava...)
- unknown: cannot clearly classify

Examples:
Input: Ramesh ne file 5 vaage moklavani chhe → {intent: task_create, confidence: high}
Input: Remind me to call Mehta at 3pm → {intent: todo_create, confidence: high}
Input: ACCEPT → {intent: task_reply, confidence: high, raw_reply_keyword: ACCEPT}
Input: Flowers lava javu chhe aaje → {intent: todo_create, confidence: high}
Input: hello → {intent: unknown, confidence: high}

Message: [USER_MESSAGE]'

Use GEMINI_API_KEY environment variable.
CRITICAL INSTRUCTION IN EVERY GEMINI CALL: Include 'Return null for uncertain fields. Do not guess.'"
```

```
PROMPT 2 — Task extraction:
"Build lib/extractTask.ts:

export async function extractTask(text: string): Promise<{
  assignee_name: string | null;
  task_description: string | null;
  deadline_iso: string | null;
  confidence: 'high' | 'medium' | 'low';
}>

Use Gemini 2.5 Flash with this system prompt:
'You are a task detail extractor for an Indian SMB WhatsApp bot.
Extract task details from the message.
Return ONLY a JSON object. No explanation.

Fields:
- assignee_name: the name of the person who should DO the task (not the sender). null if not mentioned.
- task_description: what needs to be done. null if unclear.
- deadline_iso: the deadline as ISO 8601 datetime string (use today's date if only time is mentioned,
  use current year for relative dates like kal/tomorrow). null if not mentioned.
- confidence: high (all fields clear), medium (some ambiguity), low (very unclear)

CRITICAL: Return null for ANY field you are not certain about. Do not guess. Do not infer.
A null field is always better than a wrong value.

Current datetime: [INJECT CURRENT DATETIME HERE]

Examples:
Input: Ramesh ne aaje 5 vaage sales report moklavani chhe
Output: {assignee_name: Ramesh, task_description: Send the sales report, deadline_iso: [today]T17:00:00, confidence: high}

Input: file bhejo
Output: {assignee_name: null, task_description: Send the file, deadline_iso: null, confidence: low}

Message: [USER_MESSAGE]'"
```

```
PROMPT 3 — Task creation orchestration:
"Build lib/processTaskCreation.ts:

export async function processTaskCreation(
  senderPhone: string,
  messageId: string,
  extractedTask: { assignee_name: string | null, task_description: string | null, deadline_iso: string | null, confidence: string }
): Promise<void>

Logic:
1. Look up sender in users table by phone_number → get their user ID and organisation_id
   If sender not in users table: send WhatsApp 'You are not registered in Boldo AI Assistant. Please sign up at [URL]' and return.

2. If confidence = 'low' or assignee_name is null:
   Send WhatsApp to sender: 'I could not understand who should do this task. Please mention the person's name clearly.'
   UPDATE incoming_messages SET processing_error = 'low_confidence', processed = true
   Return.

3. If task_description is null:
   Send WhatsApp: 'I understood you want to assign a task to [name] but I could not understand what the task is. Please be more specific.'
   Return.

4. Look up assignee by name in users table WHERE organisation_id = sender's org
   (Case-insensitive match, also try partial name match)
   If not found: send WhatsApp 'I could not find [assignee_name] in your organisation. Please check the spelling or ask them to sign up at [URL].'
   Return.

5. If deadline_iso is null:
   Send WhatsApp 'Task noted! What is the deadline for this task? Please reply with a date and time (e.g. 15 March, 5pm).'
   Store partial task in a temporary session (store in incoming_messages metadata or a pending_tasks table)
   Return and wait for the deadline reply.
   (For now, skip the session handling — just ask for deadline and let them re-send the full message with deadline)

6. INSERT into tasks: { title: task_description, description: task_description, organisation_id, created_by: sender_id, assigned_to: assignee_id, status: 'pending', deadline: deadline_iso, source: 'whatsapp' }

7. INSERT 2 rows into reminders:
   - { entity_type:'task', entity_id: new_task_id, user_id: assignee_id, channel:'whatsapp', scheduled_at: NOW()+10min }
   - { entity_type:'task', entity_id: new_task_id, user_id: assignee_id, channel:'call', scheduled_at: NOW()+30min }

8. INSERT into notifications: { user_id: assignee_id, type:'task_assigned', message:'[Sender Name] assigned you: [task_description]', entity_type:'task', entity_id: new_task_id }

9. INSERT into audit_log: { action:'task.created', entity_type:'task', entity_id: new_task_id, user_id: sender_id, organisation_id, metadata: { source: 'whatsapp' } }

10. Send WhatsApp to assignee:
'Hi [Assignee Name] 👋
[Sender Name] has assigned you a task:
📋 *[task_description]*
â° Deadline: [formatted deadline]
Please reply *ACCEPT* or *REJECT*'

11. Send WhatsApp to sender:
'✅ Task assigned to [Assignee Name]!
Deadline: [formatted deadline]
I will notify you once they accept.'

12. UPDATE incoming_messages: processed = true"
```

#### End of Day Check
- [ ] Gujarati voice note "Ramesh ne file 5 vaage moklavani chhe" creates a task correctly
- [ ] English text "Tell Priya to prepare slides by tomorrow 5pm" creates a task correctly
- [ ] Message with no name sends back a clarification WhatsApp
- [ ] Task appears in both manager's /assigned-tasks and employee's /my-tasks in real-time

---

### DAY 10 — Task Reply Flows & Todo Creation
**Date:** ___________
**Status:** `[ ] Not started` → `[ ] In progress` → `[ ] Complete`
**Goal:** ACCEPT, REJECT, DONE, DELEGATE, HELP, STATUS commands working. Todo creation via WhatsApp working.

#### Tasks
- [ ] Build lib/processTaskReply.ts handling all reply keywords
- [ ] ACCEPT flow: ask for deadline → parse response → update task → notify manager
- [ ] REJECT flow: ask for reason → save to task_comments → update task → notify manager
- [ ] DONE flow: check sub-tasks complete → mark done → notify manager
- [ ] DELEGATE flow: parse delegation target and sub-task → create sub-task → notify delegate
- [ ] HELP command: list all commands
- [ ] STATUS command: show user's active tasks
- [ ] Build lib/processTodoCreation.ts — creates todo and reminder rows from WhatsApp
- [ ] Test all commands end-to-end

#### Antigravity Prompts

```
PROMPT 1 — Task reply handler:
"Build lib/processTaskReply.ts:

export async function processTaskReply(senderPhone: string, message: string, rawKeyword: string): Promise<void>

Handle these keywords:

ACCEPT:
- Find sender's user ID by phone
- Find their most recent pending task (status='pending', assigned_to=sender_id)
- If no pending task: reply 'You have no pending tasks waiting for acceptance.'
- Store 'awaiting_deadline' state: UPDATE users SET metadata = jsonb_set(metadata, '{awaiting_deadline_for_task}', [task_id])
  (Add a metadata jsonb column to users if not present)
- Reply: 'Great! Please reply with your deadline for this task (e.g. 15 March, 5pm or 5 vaage)'

[On next message from same user, if awaiting_deadline_for_task is set]:
- Parse deadline from message using Gemini (same extraction approach, just deadline field)
- UPDATE task: status='accepted', committed_deadline=[parsed deadline]
- Clear the awaiting_deadline_for_task from user metadata
- Cancel the call reminder: UPDATE reminders SET status='cancelled' WHERE entity_type='task' AND entity_id=[task_id] AND channel='call'
- Keep the whatsapp reminder but reschedule it for 1hr before committed_deadline
- INSERT notification for task creator: type='task_accepted'
- INSERT audit_log: action='task.accepted'
- Reply to assignee: 'Perfect! Task accepted. Deadline set to [formatted deadline]. Good luck! 💪'
- Reply to task creator: '[Name] has accepted your task and committed to [deadline].'

REJECT:
- Find most recent pending task
- Store 'awaiting_reject_reason' in user metadata
- Reply: 'Please reply with your reason for rejecting this task.'

[On next message if awaiting_reject_reason is set]:
- INSERT into task_comments: { task_id, user_id: sender_id, content: message }
- UPDATE task: status='rejected'
- Clear metadata
- Cancel all pending reminders for this task
- INSERT notification for task creator: type='task_rejected'
- INSERT audit_log: action='task.rejected'
- Reply to assignee: 'Rejection noted. I have notified [manager name].'
- Reply to task creator: 'âŒ [Name] rejected the task. Reason: [reason]. The task is back to pending.'

DONE:
- Find sender's most recent accepted task
- Check if all sub-tasks (tasks WHERE parent_task_id=[task_id]) are status='completed'
- If sub-tasks incomplete: reply 'Cannot complete yet — [sub-assignee name]'s sub-task is still pending.'
- If all good: UPDATE task status='completed'
- Cancel all pending reminders for this task
- INSERT notification for task creator: type='task_completed'
- INSERT audit_log: action='task.completed'
- Reply to sender: '🎉 Task marked as complete!'
- Reply to task creator: '✅ [Name] has completed the task: [task title]'

HELP:
- Reply with formatted list:
'Boldo AI Assistant Commands:
✅ *ACCEPT* — Accept a task assigned to you
âŒ *REJECT* — Reject a task (will ask for reason)
✅ *DONE* — Mark your task as complete
📤 *DELEGATE* — Delegate to a team member (e.g. DELEGATE to Priya: get invoice by 3pm)
📋 *STATUS* — See your active tasks
â“ *HELP* — Show this list'

STATUS:
- Fetch sender's tasks where status IN (pending, accepted) AND assigned_to = sender_id
- Reply with formatted list:
'Your active tasks:
1. [task title] — [status] — Due: [deadline]
2. [task title] — [status] — Due: [deadline]
(none if empty)'

DELEGATE:
- Parse: 'DELEGATE to [name]: [sub-task description] by [deadline]'
- Use Gemini to extract: delegate_name, sub_task_description, deadline_iso
- Find delegate by name in same org
- Find sender's current accepted task
- INSERT sub-task: { parent_task_id: [sender's task], title: sub_task_description, assigned_to: delegate_id, status: 'pending', deadline }
- INSERT reminder rows for delegate
- Notify delegate via WhatsApp with ACCEPT/REJECT flow
- Reply to sender: 'Sub-task delegated to [name]. I will let you know when they accept.'"
```

```
PROMPT 2 — Todo creation via WhatsApp:
"Build lib/processTodoCreation.ts:

export async function processTodoCreation(senderPhone: string, messageId: string, text: string): Promise<void>

1. Look up sender by phone in users table
2. Use Gemini 2.5 Flash to extract:
   { title: string | null, remind_at: string | null (ISO datetime), due_at: string | null (ISO date) }
   Prompt: 'Extract todo details from this personal reminder message.
   title: what needs to be done (required, infer clearly)
   remind_at: when they want to be reminded (ISO datetime, use today if only time given)
   due_at: due date (ISO date, default to today if not specified)
   Current datetime: [NOW]
   Message: [TEXT]
   CRITICAL: Return null only if genuinely unclear. For todos, infer title generously.'

3. If title is null: reply 'I could not understand what you want to be reminded about. Please be more specific.'

4. INSERT into todos: { user_id: sender_id, title, status: 'pending', remind_at, due_at, source: 'whatsapp' }

5. INSERT into reminders:
   - If remind_at is set: { entity_type:'todo', entity_id: todo_id, user_id: sender_id, channel:'whatsapp', scheduled_at: remind_at }
   - Always: { entity_type:'todo', entity_id: todo_id, user_id: sender_id, channel:'whatsapp', scheduled_at: [due_at date at 20:00] }
   (Skip the 8pm reminder if remind_at is the same day and after 7pm)

6. INSERT audit_log: { action:'todo.created', entity_type:'todo', entity_id: todo_id, user_id: sender_id }

7. Reply to sender:
   If remind_at set: 'Got it! I will remind you to [title] at [formatted remind_at]. ðŸ“'
   If no remind_at: 'Got it! Added to your to-dos: [title]. I will remind you at 8pm tonight. ðŸ“'

8. UPDATE incoming_messages: processed = true"
```

```
PROMPT 3 — Wire everything into webhook:
"Update app/api/webhook/route.ts to use the full processing pipeline:

After transcription (if audio) or directly (if text):
1. UPDATE incoming_messages with the text (raw_text = transcript or original text)
2. Call classifyIntent(text)
3. UPDATE incoming_messages: intent_type = classified intent

Route to:
- task_create → processTaskCreation()
- todo_create → processTodoCreation()
- task_reply → processTaskReply()
- unknown → sendWhatsApp(phone, 'I did not understand that. Reply HELP for a list of commands.')

Also check: before classifying intent, check if the user has a pending state
(awaiting_deadline_for_task or awaiting_reject_reason in their metadata).
If yes: skip intent classification and route directly to processTaskReply() with the message as the continuation.

All processing happens after the 200 OK is returned.
Use Promise callbacks or a background queue pattern — do not await in the main handler."
```

#### End of Day Check
- [ ] ACCEPT → deadline prompt → deadline reply → task accepted → manager notified
- [ ] REJECT → reason prompt → reason reply → task rejected → manager notified
- [ ] DONE → task completed → manager notified
- [ ] DELEGATE → sub-task created → delegate notified → ACCEPT blocks parent
- [ ] "Remind me to call Mehta at 3pm" → todo created → reminder row inserted in Supabase

---

### DAY 11 — Reminder System (Cron Job)
**Date:** ___________
**Status:** `[ ] Not started` → `[ ] In progress` → `[ ] Complete`
**Goal:** Automated reminder cron job running every 5 minutes. WhatsApp and voice call reminders firing correctly. Overdue detection working.

#### Tasks
- [ ] Build /api/cron/reminders route — the main cron job
- [ ] Query pending reminders table and send via WhatsApp or Sarvam+Exotel voice call
- [ ] Build lib/makeVoiceCall.ts using Sarvam Samvaad + Exotel
- [ ] Overdue detection: mark tasks overdue, alert both parties
- [ ] Cancel reminders when tasks are completed or cancelled
- [ ] Set up Vercel Cron to run every 5 minutes
- [ ] Test: create task, wait for reminders to fire

#### Antigravity Prompts

```
PROMPT 1 — Voice call function:
"Using Context7 MCP, look up the Sarvam AI Samvaad voice agent API and Exotel outbound call API.
Build lib/makeVoiceCall.ts:

export async function makeVoiceCall(phone: string, message: string, language: 'gu' | 'hi' | 'en' = 'gu'): Promise<{ success: boolean; call_id?: string; error?: string }>

This function should:
1. Use Exotel to initiate an outbound call to [phone] from your Exotel virtual number
2. Configure the call to use Sarvam Samvaad as the voice agent
3. Pass [message] as the script to be spoken in [language]
4. Return success/failure with call ID for logging

For the Gujarati call script, the message will be pre-formatted by the caller.
Example message: 'Kem cho Ramesh bhai, aapne Vikram bhai tarafthi ek task assign thayo chhe. 
Please WhatsApp par ACCEPT lakhine reply karo.'

Use EXOTEL_SID, EXOTEL_TOKEN, EXOTEL_VIRTUAL_NUMBER, SARVAM_API_KEY environment variables."
```

```
PROMPT 2 — Cron job:
"Build app/api/cron/reminders/route.ts:

This route is called by Vercel Cron every 5 minutes.
Secure it: check that the request has header Authorization: Bearer [CRON_SECRET_KEY].

STEP 1 — Process pending reminders:
SELECT * FROM reminders WHERE status = 'pending' AND scheduled_at <= NOW()
For each reminder:
  - Fetch the entity (task or todo) to get current status
  - If task is completed/cancelled/overdue: mark reminder as cancelled, skip
  - If todo is done: mark reminder as cancelled, skip
  - If channel = 'whatsapp':
    - Fetch the user's phone number
    - Build appropriate message based on entity_type and context
    - Call sendWhatsApp(phone, message)
    - On success: UPDATE reminders SET status='sent', sent_at=NOW()
    - On failure: UPDATE reminders SET status='failed', failure_reason=[error]
  - If channel = 'call':
    - Check user's notification_prefs.call_reminders = true (skip if false)
    - Fetch user phone
    - Build Gujarati message based on task context
    - Call makeVoiceCall(phone, message, 'gu')
    - On success: UPDATE reminders SET status='sent', sent_at=NOW()
    - Also: UPDATE tasks SET call_made=true WHERE id=[task_id]
    - On failure: UPDATE reminders SET status='failed', failure_reason=[error]
      Then: INSERT new reminder row with scheduled_at = NOW()+5min (retry once)

WhatsApp message templates:
- Task not accepted (10 min): 'Hi [name] 👋 You have a task waiting for your response from [manager]. Reply ACCEPT or REJECT on this WhatsApp.'
- Task deadline approaching (1 hr): '⚠️ Reminder: Your task "[title]" is due at [time]. Please complete it on time!'
- Todo reminder: 'ðŸ“ Reminder: [todo title]'
- Todo EOD: '🌙 End of day reminder: [todo title] — was this completed? Reply DONE if yes.'

Gujarati voice call scripts:
- Task not accepted: 'Kem cho [name] bhai/ben, aapne [manager] tarafthi ek task assign thayo chhe: [task title]. Khapashe WhatsApp par ACCEPT lakhine reply karo.'
- Deadline approaching: 'Hello [name], aapni task ni deadline aave chhe [time] vaage. Task: [title]. Khapashe time par puro karo.'

STEP 2 — Overdue detection:
SELECT * FROM tasks 
WHERE status = 'accepted' AND committed_deadline < NOW()
For each:
  - UPDATE tasks SET status='overdue', updated_at=NOW()
  - INSERT notification for created_by: type='task_overdue'
  - INSERT notification for assigned_to: type='task_overdue'
  - Send WhatsApp to assigned_to: '🚨 Your task "[title]" is now overdue! Please complete it immediately or contact [manager name].'
  - Send WhatsApp to created_by: '🚨 OVERDUE: [assignee name] has not completed "[title]" by [committed_deadline].'
  - INSERT audit_log: { action:'task.overdue' }

STEP 3 — Log job run:
INSERT audit_log: { action:'system.cron_run', metadata: { reminders_processed: N, tasks_marked_overdue: M } }"
```

```
PROMPT 3 — Vercel Cron setup:
"Create vercel.json in the project root:
{
  'crons': [
    {
      'path': '/api/cron/reminders',
      'schedule': '*/5 * * * *'
    }
  ]
}

Also add CRON_SECRET_KEY to Vercel environment variables.
The cron route should verify: request.headers.get('authorization') === 'Bearer ' + process.env.CRON_SECRET_KEY

Using Vercel MCP, deploy the updated code to production and confirm the cron job is listed in the Vercel dashboard."
```

#### End of Day Check
- [ ] Create a task, wait 10 minutes — WhatsApp reminder received
- [ ] Wait 30 minutes total — voice call received (check Exotel call logs)
- [ ] Set a task deadline 1 minute in the past — it appears as overdue within 5 minutes
- [ ] Complete a task — its pending reminders are cancelled in Supabase

---

### DAY 12 — Gujarati Testing & WhatsApp Polish
**Date:** ___________
**Status:** `[ ] Not started` → `[ ] In progress` → `[ ] Complete`
**Goal:** 30 test messages processed correctly. All bot messages rewritten to sound natural. All commands working.

#### Tasks
- [ ] Test 30 diverse messages across all intent types — document pass/fail
- [ ] Fix top failures (improve Gemini prompts, handle edge cases)
- [ ] Rewrite all WhatsApp bot messages to sound warm, natural, and Indian (not robotic)
- [ ] Add CANCEL command (manager cancels a task)
- [ ] Add EXTEND command (manager extends a deadline)
- [ ] Add TEAM command (quick team summary for managers)
- [ ] Add welcome message for first-time WhatsApp contacts

#### Antigravity Prompts

```
PROMPT 1 — 30-message test suite:
"Using the Browser Agent, test my WhatsApp webhook with 30 different messages.
Send each as a simulated Wati webhook POST request.
Test these messages:

TASK_CREATE (10):
1. Gujarati voice (simulate): 'Ramesh ne aaje 5 vaage sales report moklavani chhe'
2. Hindi: 'Priya ko bol do slides kal 3 baje tak ready karni hai'
3. English: 'Tell Suresh to send the invoice by end of day'
4. Hinglish: 'Mehta bhai ko call karo aur bolo report 10 tak bhejo'
5. No name: 'File bhejo 5 vaage'
6. No deadline: 'Ramesh ne report moklavi'
7. Two tasks in one: 'Priya slides banavo ane Suresh report mokle kal tak'
8. Misspelled name: 'Rammesh ne file moklavi' (Ramesh exists)
9. Very long: 'Aaje meeting ma decide thayelu ke Priya ane Suresh malkine client presentation taiyar karshe next Friday 3pm sudi ane Vikram bhai approve karshe'
10. All caps: 'TELL PRIYA TO SEND REPORT BY 5PM TODAY'

TODO_CREATE (8):
11. 'Remind me to call Mehta at 3pm'
12. 'Aaje flowers lava javu chhe'
13. 'Maro kaam: report review karvanu chhe kal 11 vaage'
14. 'Don't forget to pay electricity bill today'
15. 'I need to call bank by 4pm'
16. 'Remind me about the client meeting tomorrow morning'
17. 'Buy chai for office tomorrow'
18. 'Check inventory report end of day'

TASK_REPLY (7):
19. 'ACCEPT'
20. 'accept' (lowercase)
21. 'REJECT'
22. 'DONE'
23. 'DELEGATE to Priya: get the signed document by 4pm'
24. 'STATUS'
25. 'HELP'

EDGE CASES (5):
26. Empty message (just a space)
27. 'Hello'
28. Voice note < 1 second (silence)
29. Unknown language (type in French)
30. Message from a phone number not registered in the system

For each message: show intent classified, extraction result, action taken, WhatsApp reply sent.
Mark each PASS or FAIL. Give me the top 5 failures to fix."
```

```
PROMPT 2 — Fix failures and polish messages:
"Based on the test results, fix the top failures by improving the Gemini prompts in
lib/classifyIntent.ts and lib/extractTask.ts.

Then rewrite ALL WhatsApp messages the bot sends to sound warm and natural.
Guidelines:
- Write as if a helpful Indian business assistant is speaking
- Use appropriate emoji (not too many — 1-2 per message max)
- Mix of English and light Hinglish is fine for non-Gujarati messages
- For Gujarati users: use 'aap', 'bhai/ben' appropriately
- Never sound robotic or corporate
- Keep messages concise — max 3-4 lines

After rewriting, add these new commands:

CANCEL (for managers/owners only):
- Manager sends: 'CANCEL [task keyword]'
- Use Gemini to identify which task they mean (match by title keywords)
- If found: UPDATE status='cancelled', cancel all pending reminders, notify assignee
- Reply: 'Task cancelled. [Assignee name] has been notified.'

EXTEND (for managers/owners only):
- Manager sends: 'EXTEND [task keyword] to [new deadline]'
- Use Gemini to extract task reference and new deadline
- UPDATE task: deadline = new deadline
- Reschedule reminders for new deadline
- Notify assignee: '[Manager] has extended your deadline for [task] to [new deadline].'
- Reply to manager: 'Deadline updated. [Name] has been notified.'

TEAM (for managers/owners only):
- Reply with quick summary:
'Your team's open tasks:
â€¢ Ramesh: 2 pending, 1 overdue ⚠️
• Priya: 3 accepted, due today: 1
• Suresh: 1 pending (not accepted yet)'

WELCOME MESSAGE (for any new phone number messaging the bot for first time):
- Check if incoming phone exists in users table
- If not found: reply with welcome message introducing Boldo AI Assistant and the signup URL
'Hello! 👋 I'm Boldo AI Assistant — your team's task management assistant.
It looks like you're new here!
Your manager may have added you to a team. Please sign up at: [URL]
Or ask your manager to share the invite link.
Reply HELP anytime to see what I can do!'"
```

#### End of Day Check
- [ ] 25+ of 30 test messages pass correctly
- [ ] CANCEL and EXTEND commands working
- [ ] TEAM command gives correct summary
- [ ] Bot messages sound warm and natural, not robotic
- [ ] Welcome message sent to unregistered numbers

---

## PHASE 4 — SECURITY, TESTING & LAUNCH
### Days 13–20: Security hardening, beta testing, bug fixes, launch

---

### DAY 13 — Security Hardening & Full System Audit
**Date:** ___________
**Status:** `[ ] Not started` → `[ ] In progress` → `[ ] Complete`
**Goal:** Security audit passed. RLS verified. All API keys server-side. Rate limiting active. Snyk clean.

#### Tasks
- [ ] Test RLS: Org A user cannot see Org B data under any query
- [ ] Test todos RLS: user cannot query another user's todos even with raw SQL attempts
- [ ] Verify all API routes return 401 for unauthenticated requests
- [ ] Run full Snyk security scan — fix all HIGH severity issues
- [ ] Confirm no API keys in client-side code (especially SUPABASE_SERVICE_ROLE_KEY)
- [ ] Verify rate limiting on webhook (30 msg/phone/min)
- [ ] Check Vercel function logs for any recurring errors
- [ ] Add input sanitisation to all user-facing text fields

#### Antigravity Prompts

```
PROMPT 1 — RLS verification:
"Using Supabase MCP, run these security tests:

TEST 1 — Cross-org task isolation:
Run this SQL as a user from Organisation A (use their JWT token):
SET request.jwt.claim.sub = '[org-a-user-id]';
SELECT * FROM tasks WHERE organisation_id = '[org-b-id]';
Expected result: 0 rows. If any rows return: the RLS policy is broken. Fix it.

TEST 2 — Todo privacy:
Run this SQL as user A:
SET request.jwt.claim.sub = '[user-a-id]';
SELECT * FROM todos WHERE user_id = '[user-b-id]';
Expected result: 0 rows. This is non-negotiable.

TEST 3 — Auth route protection:
Using Browser Agent, visit these URLs without being logged in:
/dashboard/home, /dashboard/my-tasks, /api/tasks
All should redirect to /login or return 401. Screenshot results.

TEST 4 — Service role key exposure:
Search the entire codebase for the string 'service_role'.
It should ONLY appear in server-side files (files in app/api/ or lib/).
It should NEVER appear in any file under app/(dashboard)/ or any client component.
If found in client code: flag it as a critical security issue and fix immediately.

Fix any issues found."
```

```
PROMPT 2 — Snyk + rate limiting:
"Run a full Snyk security scan on the entire codebase.
Show me all HIGH and MEDIUM severity vulnerabilities.
Fix all HIGH severity issues immediately.
For MEDIUM issues: fix any related to authentication, injection, or data exposure.

Then verify rate limiting on the webhook:
The webhook should track message counts per phone number using an in-memory Map or Supabase counter.
If a phone sends >30 messages within 60 seconds: return HTTP 429 and do not process.
Test this by simulating 35 rapid requests from the same phone number using the Browser Agent.
Confirm the 31st request gets a 429 response."
```

```
PROMPT 3 — GitHub commit:
"Using GitHub MCP, commit all security fixes:
'Day 13: Security hardening — RLS verified, Snyk clean, rate limiting active'
Tag as v0.3.0-security"
```

#### End of Day Check
- [ ] RLS tests pass — zero cross-org data leakage
- [ ] Todo privacy test passes — zero cross-user todo visibility
- [ ] Snyk shows zero HIGH severity vulnerabilities
- [ ] Service role key appears only in server-side code
- [ ] Rate limiting returns 429 after 30 messages per minute

---

### DAY 14 — Performance & Final Pre-Beta Polish
**Date:** ___________
**Status:** `[ ] Not started` → `[ ] In progress` → `[ ] Complete`
**Goal:** All pages load under 2 seconds. All edge cases handled. App ready for real users.

#### Tasks
- [ ] Measure home dashboard load time — optimise if over 2 seconds
- [ ] Check and fix any N+1 query problems (fetching per-user in a loop)
- [ ] Verify cron job completes in under 60 seconds with 50 test tasks
- [ ] Add loading skeleton states to all data-fetching pages
- [ ] Add proper error pages: 404, 500, auth error
- [ ] Final full mobile test — fix any remaining issues
- [ ] Test on Safari mobile (iOS) specifically — often has different behaviour
- [ ] Make sure the web app's Create Task flow and WhatsApp bot stay in sync (same data)

#### Antigravity Prompts

```
PROMPT 1 — Performance audit:
"Using Browser Agent and the Vercel MCP, run a performance audit.

Check 1 — Page load times:
Open Browser Agent. Navigate to each dashboard page and measure the time from navigation start to content visible.
Flag any page taking over 2 seconds.

Check 2 — N+1 queries:
Review these files for loops that make Supabase queries inside them:
- lib/processTaskCreation.ts
- app/(dashboard)/team/page.tsx
- app/api/cron/reminders/route.ts
Replace any per-item queries with batch queries (SELECT ... WHERE id IN (...) or JOIN).

Check 3 — Cron job performance:
Insert 50 test tasks with pending reminders into Supabase.
Trigger the cron job manually by calling /api/cron/reminders.
Measure how long it takes to complete. Should be under 60 seconds.
If it takes longer: parallelise the reminder sending (Promise.all instead of sequential await).

Check 4 — Missing indexes:
Using Supabase MCP, run EXPLAIN ANALYZE on the most common queries:
- SELECT * FROM tasks WHERE assigned_to = X AND status IN (...)
- SELECT * FROM reminders WHERE status='pending' AND scheduled_at <= NOW()
Check that each uses an index scan (not a sequential scan). If sequential: add the missing index."
```

```
PROMPT 2 — Polish and error pages:
"Add loading skeleton states to all pages that fetch data.
A skeleton state is a grey pulsing placeholder shown while data loads.
Use a simple CSS animation: animate-pulse with grey rounded rectangles.
Add skeletons to: home dashboard, my-tasks, assigned-tasks, calendar, team, stats, notifications.

Build these error pages:
- app/not-found.tsx: friendly 404 page with 'Go to Dashboard' button
- app/error.tsx: friendly 500 page with 'Try Again' and 'Go to Dashboard' buttons
- app/(dashboard)/not-found.tsx: for dashboard-specific not-found cases

Using Browser Agent, test the app on Safari mobile (simulate iOS Safari at 375px):
- Test sign in flow
- Test home dashboard
- Test creating a task from the modal
- Test the drawer opening on My Tasks
Report any Safari-specific issues (Safari handles some CSS and JS differently than Chrome)."
```

#### End of Day Check
- [ ] Home dashboard loads under 2 seconds (verified by Browser Agent)
- [ ] No N+1 query patterns remain
- [ ] Skeleton loading states visible on all data pages
- [ ] 404 and 500 error pages built and working
- [ ] Safari mobile test passing

---

### DAY 15 — Beta User Onboarding
**Date:** ___________
**Status:** `[ ] Not started` → `[ ] In progress` → `[ ] Complete`
**Goal:** 2-3 real Indian SMB business owners using the product. Bug list from real usage documented.

#### Tasks
- [ ] Find 2-3 SMB business owners in your network willing to test for free
- [ ] Schedule 30-minute onboarding call per beta user
- [ ] Walk each through: web app signup, WhatsApp bot, creating first task
- [ ] Goal for them: create 5+ real tasks over next 3 days
- [ ] Set up a WhatsApp group with beta testers for bug reports
- [ ] Monitor Supabase and Vercel logs every 2-3 hours
- [ ] Document every bug, confusion point, and positive feedback
- [ ] Do NOT fix anything today — only observe and document

#### Antigravity Prompts

```
PROMPT 1 — Pre-beta monitoring setup:
"Using Supabase MCP, create a monitoring query I can run every 2 hours to check beta health.
Show me:
1. SELECT COUNT(*), status FROM tasks WHERE organisation_id IN ([beta org ids]) GROUP BY status
2. SELECT COUNT(*), status FROM reminders WHERE created_at > NOW()-interval '24 hours' GROUP BY status
3. SELECT phone, COUNT(*), MAX(created_at) FROM incoming_messages GROUP BY phone ORDER BY COUNT DESC
4. SELECT action, COUNT(*) FROM audit_log WHERE created_at > NOW()-interval '24 hours' GROUP BY action
5. SELECT processing_error, COUNT(*) FROM incoming_messages WHERE processing_error IS NOT NULL GROUP BY processing_error

Also: using Vercel MCP, set up an alert that emails me when any function returns a 500 error."
```

```
PROMPT 2 — Onboarding guide creation:
"Create a simple onboarding guide for beta users. Format as a WhatsApp-friendly message (plain text, short).
Include:
1. How to sign up (URL + steps)
2. How to create a task via WhatsApp (example voice note script in Gujarati and English)
3. How to accept/reject as an employee
4. How to view the dashboard
5. How to add personal to-dos
6. WhatsApp number to send tasks to
Keep it under 20 lines. Indian business owner friendly language."
```

#### Day 15 Evening — Document Findings
After beta testing:
- [ ] List all bugs found
- [ ] List all features that confused users
- [ ] List all positive feedback
- [ ] Prioritise bugs by severity: Critical (blocks use) / Major (frustrating) / Minor (cosmetic)

---

### DAY 16 — Beta Bug Fixes (Round 1)
**Date:** ___________
**Status:** `[ ] Not started` → `[ ] In progress` → `[ ] Complete`
**Goal:** All critical bugs fixed. Major bugs fixed. Live version stable.

#### Tasks
- [ ] Fix all Critical bugs from beta testing
- [ ] Fix all Major bugs
- [ ] Make deadline format more flexible (accept '3pm', 'kal 5 baje', 'tomorrow evening', 'EOD', '5 o clock')
- [ ] Deploy fixed version to Vercel production
- [ ] Notify beta testers: fixes deployed, please re-test
- [ ] Continue monitoring for new issues

#### Antigravity Prompts

```
PROMPT 1 — Flexible deadline parsing:
"Improve the deadline extraction in lib/extractTask.ts and lib/processTodoCreation.ts.
The current Gemini prompt needs to handle these additional formats:
'3pm', '3 PM', '3 o clock', 'kal 5 vaage' (Gujarati: tomorrow 5pm), 
'aaje 5 vaage' (Gujarati: today 5pm), 'tomorrow evening', 'tonight', 
'end of day', 'EOD', 'by lunch', 'morning', 'next week Monday',
'15 tarikh' (Gujarati: 15th of current month), 'mahine no pahelo din' (1st of month)

Update the Gemini extraction prompt to include examples of all these formats
and how they map to ISO datetime strings.
Test with 10 of these ambiguous deadline phrases and show me the extracted datetimes."
```

```
PROMPT 2 — Fix critical bugs:
"Here are the critical bugs reported by beta users: [PASTE YOUR BUG LIST HERE]
Using Sequential Thinking MCP, think through the root cause of each bug before fixing it.
For each bug:
1. Identify the root cause
2. Identify which file(s) need to change
3. Implement the fix
4. Write a one-line description of the fix for the commit message

After all fixes, give me a deployment checklist: list every file changed."
```

```
PROMPT 3 — Deploy and verify:
"Using Vercel MCP, deploy the bug-fixed version to production.
After deployment: check Vercel function logs for any new errors in the past 10 minutes.
Confirm the deployment was successful and show me the live URL."
```

---

### DAY 17 — Beta Bug Fixes (Round 2) & Monitoring
**Date:** ___________
**Status:** `[ ] Not started` → `[ ] In progress` → `[ ] Complete`
**Goal:** All beta feedback addressed. System stable for 24+ hours. No new critical bugs.

#### Tasks
- [ ] Fix any new bugs reported after Round 1 fixes
- [ ] Monitor Supabase and Vercel for 4 hours of stable operation
- [ ] Check that cron job has been running every 5 minutes reliably (check audit_log for system.cron_run entries)
- [ ] Verify reminders are actually being received by beta users (check reminder_log table)
- [ ] Fix any reminder delivery failures
- [ ] Buffer day — use remaining time to address any leftover items from earlier days

#### Antigravity Prompts

```
PROMPT 1 — System health check:
"Using Supabase MCP, run a full system health check:

1. Cron job reliability:
SELECT metadata->>'reminders_processed' as count, created_at
FROM audit_log WHERE action='system.cron_run' ORDER BY created_at DESC LIMIT 20
Are there entries every 5 minutes? Any gaps? Any with 0 reminders when there should be some?

2. Reminder delivery rate:
SELECT status, COUNT(*) FROM reminders WHERE created_at > NOW()-interval '48 hours' GROUP BY status
What percentage are 'sent'? If 'failed' is high: investigate failure_reason values.

3. Task flow completion:
SELECT status, COUNT(*) FROM tasks WHERE organisation_id IN ([beta org ids]) GROUP BY status
How many tasks are stuck in 'pending' for over 1 hour? These may indicate the accept flow is broken.

4. Error rate:
SELECT processing_error, COUNT(*) FROM incoming_messages 
WHERE processing_error IS NOT NULL AND created_at > NOW()-interval '48 hours'
GROUP BY processing_error ORDER BY COUNT DESC
What are the most common errors?

Based on the results, identify and fix the top 3 issues."
```

---

### DAY 18 — Landing Page & Onboarding UX
**Date:** ___________
**Status:** `[ ] Not started` → `[ ] In progress` → `[ ] Complete`
**Goal:** Public landing page live. Onboarding flow polished. Demo video recorded.

#### Tasks
- [ ] Build public landing page at app/page.tsx
- [ ] Landing page: hero headline, how it works (3 steps), key features, sign up CTA
- [ ] Polish the signup flow based on beta user confusion points
- [ ] Record a 3-minute Loom demo video (loom.com — free)
- [ ] Write 1-page onboarding guide (WhatsApp-forward-friendly format)
- [ ] Update Boldo AI Assistant_PLAN.md with current build status

#### Antigravity Prompts

```
PROMPT 1 — Landing page:
"Using Context7 MCP, look up Next.js 14 page component documentation.
Build a clean, professional public landing page at app/page.tsx.

The landing page should have these sections:

HERO SECTION:
Headline: 'Manage your team on WhatsApp. No new app needed.'
Sub-headline: 'Boldo AI Assistant turns your WhatsApp voice notes into tracked tasks with automatic follow-ups — built for Indian businesses.'
CTA button: 'Start Free' → links to /signup
Small trust note: 'Works in Gujarati, Hindi, and English'

HOW IT WORKS (3 steps with icons):
1. 🎤 Send a voice note — Tell the bot who should do what and by when
2. ✅ Employee accepts — They commit to a deadline on WhatsApp
3. 📊 You track everything — Dashboard shows all tasks, deadlines, and performance

KEY FEATURES (3 feature cards):
- Voice-first in Gujarati/Hindi — No typing required
- Automatic follow-ups — Calls and WhatsApp reminders without you lifting a finger
- Performance analytics — Know who delivers and who delays

FOOTER:
Company name, contact email, link to /login

Design requirements:
- Mobile-first, clean and professional
- Colour scheme: white background, navy (#1A3C5E) accents, clean typography
- No external images — use emoji and CSS for visual elements
- Page must load in under 1 second (no heavy assets)"
```

```
PROMPT 2 — Update plan file:
"Update the Current Build Status section in Boldo AI Assistant_PLAN.md.
Mark all completed items with [x].
Update the Current version to 'v0.4.0-beta'
Update the Live URL to [actual Vercel URL]
Update Beta users to the count of actual beta users.

Also add a new section at the bottom called BETA FEEDBACK LOG with two subsections:
ISSUES FIXED: [list all bugs we fixed]
OPEN ITEMS: [list anything still pending]"
```

---

### DAY 19 — Final QA & Pre-Launch Checklist
**Date:** ___________
**Status:** `[ ] Not started` → `[ ] In progress` → `[ ] Complete`
**Goal:** Complete system QA passing. Pre-launch checklist fully checked. Ready to launch.

#### Tasks
- [ ] Complete end-to-end test covering all features (web app + WhatsApp bot)
- [ ] Verify all 11 database tables have correct data after testing
- [ ] Final Snyk security scan — must be clean
- [ ] Verify Vercel environment variables are all set correctly in production
- [ ] Check that RLS is still active on all tables (verify in Supabase dashboard)
- [ ] Verify cron job is running every 5 minutes in Vercel dashboard
- [ ] Create GitHub release tag v1.0.0-mvp
- [ ] Share with 5 more potential users

#### Antigravity Prompts

```
PROMPT 1 — Complete end-to-end QA:
"Open Browser Agent and run the complete QA test suite.
Test the full product as 3 different user roles simultaneously (use 3 browser windows):
Window 1: Owner (Vikram)
Window 2: Employee A (Ramesh)
Window 3: Employee B (Priya)

FLOW 1 — Web App Task:
1. Vikram creates a task for Ramesh via the Create Task modal on /dashboard/home
2. Ramesh sees it appear in real-time on his /dashboard/home pending acceptance section
3. Ramesh opens My Tasks, views task details, clicks ACCEPT, sets deadline for 30 minutes from now
4. Vikram sees real-time notification: 'Ramesh accepted your task'
5. Ramesh sends DONE via WhatsApp before the deadline
6. Vikram gets WhatsApp notification and sees task completed in dashboard
PASS or FAIL each step.

FLOW 2 — WhatsApp Voice Task (simulate with text):
1. Vikram sends WhatsApp: 'Priya ne aaje 5 vaage client presentation moklavi'
2. Priya gets WhatsApp: task assigned notification
3. Priya replies ACCEPT
4. Priya is asked for deadline, replies '5 vaage' (system parses to today 5pm)
5. Vikram gets WhatsApp: Priya accepted with deadline 5pm
6. Dashboard reflects accepted status in real-time
PASS or FAIL each step.

FLOW 3 — Personal Todo:
1. Ramesh sends WhatsApp: 'Remind me to call the supplier at 11am tomorrow'
2. Todo is created (verify in Supabase todos table — only visible to Ramesh)
3. Ramesh opens /todos — sees his todo (private)
4. Vikram opens /todos — does NOT see Ramesh's todo
PASS or FAIL each step.

FLOW 4 — Reminder Escalation:
1. Vikram creates a task for Priya
2. Priya does NOT respond for 10 minutes
3. Priya receives WhatsApp reminder (verify from reminder_log)
4. Priya still does not respond for 30 minutes total
5. Priya receives a voice call (verify from Exotel call logs)
PASS or FAIL each step.

Give me a final QA score: X/4 flows passing."
```

```
PROMPT 2 — Pre-launch checklist:
"Run through this pre-launch checklist and verify each item:

SECURITY:
[ ] RLS enabled on all 11 tables (check in Supabase → Authentication → Policies)
[ ] SUPABASE_SERVICE_ROLE_KEY not in any client-side code (search codebase)
[ ] All environment variables set in Vercel (check Vercel → Settings → Environment Variables)
[ ] Webhook has rate limiting active
[ ] Snyk shows 0 HIGH severity issues (run scan now)

FUNCTIONALITY:
[ ] Webhook receiving messages (send a test message and check Vercel logs)
[ ] Voice transcription working (send a Gujarati voice note and check incoming_messages)
[ ] Task creation end-to-end working (create via WhatsApp, verify in Supabase)
[ ] Accept/reject flow working
[ ] Todo creation working (verify it's private)
[ ] Cron job last ran within 5 minutes (check audit_log)
[ ] Reminders being sent (check reminder_log for sent entries)

INFRASTRUCTURE:
[ ] Vercel production URL accessible
[ ] Vercel error alerts configured
[ ] GitHub repo is up to date with latest code
[ ] vercel.json cron configuration is correct

Mark each item with PASS or FAIL. Fix any FAIL items before proceeding to Day 20."
```

```
PROMPT 3 — GitHub release:
"Using GitHub MCP:
1. Commit any remaining changes with message 'Day 19: Final QA complete, pre-launch checks passed'
2. Create a release tag v1.0.0-mvp
3. Write release notes that include:
   - What was built (web app features list, WhatsApp bot features list)
   - Known limitations (what is not in MVP)
   - Tech stack used
   - How to set up the development environment
4. Push the tag to GitHub"
```

#### End of Day Check
- [ ] All 4 QA flows pass
- [ ] Pre-launch checklist: all items marked PASS
- [ ] GitHub release v1.0.0-mvp created

---

### DAY 20 — LAUNCH DAY
**Date:** ___________
**Status:** `[ ] Not started` → `[ ] In progress` → `[ ] Complete`
**Goal:** MVP launched. First paying customers contacted. Public presence live.

#### Tasks
- [ ] Final production deploy
- [ ] Share with 10 potential customers (WhatsApp, personal network, LinkedIn)
- [ ] Send demo video + sign-up link to each
- [ ] Post in relevant WhatsApp groups (business owners, entrepreneurship communities)
- [ ] Update BOLDO_CONTEXT.md: update build status, live URL, user count
- [ ] Update Boldo AI Assistant_PLAN.md: mark all items complete
- [ ] Write your 'next 10 features' list for post-MVP based on beta feedback
- [ ] Decide on pricing strategy based on beta user conversations

#### Antigravity Prompts

```
PROMPT 1 — Final deploy:
"Using Vercel MCP:
1. Deploy the final version to production
2. Verify deployment succeeded (check function logs for any startup errors)
3. Return the final live URL
4. Check that the Vercel cron job is active and will run in the next 5 minutes

Using GitHub MCP:
1. Commit any last changes with message 'Day 20: MVP Launch — Boldo AI Assistant v1.0.0'
2. Push to main branch"
```

```
PROMPT 2 — Update context files:
"Update BOLDO_CONTEXT.md Section 12 (Current Build Status):
- Mark all items as [x] complete
- Set Current version: v1.0.0-mvp (launched)
- Set Live URL: [actual URL]
- Set Beta users: [actual count]

Update Boldo AI Assistant_PLAN.md:
- Add a new section at the bottom: ## POST-LAUNCH — WHAT'S NEXT
- List the 10 features to build next (based on what you learned in beta testing)
- Add a METRICS TO TRACK section: DAU, tasks created per day, WhatsApp message volume, task completion rate

These files will now serve as the context for Phase 2 development."
```

```
PROMPT 3 — Post-MVP planning prompt (save this for future use):
"[Save this prompt for your first post-MVP Antigravity session]

Read BOLDO_CONTEXT.md and Boldo AI Assistant_PLAN.md.
We have launched the MVP. Now we are starting Phase 2.
The top priority features from beta feedback are:
[paste your list from today]

Before building anything new:
1. Confirm the feature aligns with the Core Product Principles in BOLDO_CONTEXT.md
2. Confirm it is not in the 'What We Are NOT Building' section
3. Check if the database schema already supports it (it likely does — schema was built for scale)
4. Then implement it following all the same architecture patterns established in Phase 1."
```

#### 🎉 MVP Complete

---

## APPENDIX A — ENVIRONMENT VARIABLES REFERENCE

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=         # SERVER-SIDE ONLY — never expose to client

# Sarvam AI
SARVAM_API_KEY=                    # Used for Saaras v3 (STT) and Samvaad (voice calls)

# Google Gemini
GEMINI_API_KEY=                    # From aistudio.google.com

# Wati (WhatsApp API)
WATI_API_KEY=
WATI_API_URL=
WATI_VERIFY_TOKEN=BOLDO_webhook_2025

# Exotel (voice calls)
EXOTEL_SID=
EXOTEL_TOKEN=
EXOTEL_VIRTUAL_NUMBER=             # Your Exotel virtual phone number

# Security
CRON_SECRET_KEY=                   # Random string, used to secure the cron endpoint
```

---

## APPENDIX B — FILE STRUCTURE REFERENCE

```
Boldo AI Assistant/
├── app/
│   ├── page.tsx                        # Public landing page
│   ├── layout.tsx                      # Root layout
│   ├── login/
│   │   ├── page.tsx                    # Phone number entry
│   │   └── verify/page.tsx             # OTP verification
│   ├── signup/
│   │   └── page.tsx                    # Org + manager setup
│   ├── auth/
│   │   └── callback/route.ts           # Supabase auth callback
│   ├── (dashboard)/
│   │   ├── layout.tsx                  # Sidebar + navbar layout
│   │   ├── home/page.tsx               # Home dashboard
│   │   ├── my-tasks/page.tsx           # My Tasks
│   │   ├── assigned-tasks/page.tsx     # Tasks I Assigned
│   │   ├── todos/page.tsx              # Personal To-Dos (private)
│   │   ├── calendar/page.tsx           # Calendar
│   │   ├── team/page.tsx               # Org Chart
│   │   ├── stats/page.tsx              # Performance Stats
│   │   ├── notifications/page.tsx      # Notifications
│   │   └── settings/page.tsx           # Settings
│   └── api/
│       ├── webhook/route.ts            # WhatsApp webhook (Wati)
│       └── cron/
│           └── reminders/route.ts      # Reminder cron job (every 5 min)
├── lib/
│   ├── supabase/
│   │   ├── client.ts                   # Browser Supabase client
│   │   └── server.ts                   # Server Supabase client
│   ├── transcribe.ts                   # Sarvam Saaras v3 STT
│   ├── classifyIntent.ts               # Gemini 2.5 Flash intent classification
│   ├── extractTask.ts                  # Gemini 2.5 Flash task extraction
│   ├── sendWhatsApp.ts                 # Wati WhatsApp message sender
│   ├── makeVoiceCall.ts                # Sarvam Samvaad + Exotel outbound call
│   ├── processTaskCreation.ts          # Task creation orchestration
│   ├── processTaskReply.ts             # ACCEPT/REJECT/DONE/DELEGATE handler
│   └── processTodoCreation.ts          # Todo creation orchestration
├── providers/
│   └── RealtimeProvider.tsx            # Supabase real-time context
├── middleware.ts                       # Auth route protection
├── vercel.json                         # Cron job configuration
├── BOLDO_CONTEXT.md                 # Project vision & schema (source of truth)
├── Boldo AI Assistant_PLAN.md                    # This file — build plan
└── .env.local                          # Environment variables (never commit)
```

---

## APPENDIX C — IF YOU FALL BEHIND

**Fell behind by 1 day:** Pull the most important task from the next day into today. Drop the least critical task from today's remaining list.

**Fell behind by 2-3 days:** Combine Days 15+16 (beta setup + first round of fixes) into one day. Combine Days 17+18 into one day. Cut the landing page (Day 18) — you can add it after launch.

**Fell behind by 4+ days:** Cut Day 14 (performance optimisation) — it can be done post-launch. Cut Day 19 (full QA) — do a condensed 30-minute manual check instead. Launch with known minor issues and fix post-launch. Shipping is more important than perfection at MVP stage.

**Got ahead by 1 day:** Use the time to add WhatsApp onboarding (users can sign up entirely through WhatsApp without opening the web app). This was flagged as a high-value post-MVP feature.

---

*Last updated: Pre-development*
*Current version: Not started*
*Live URL: Not deployed yet*
*Beta users: 0*

