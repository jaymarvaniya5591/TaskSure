# Boldo AI Assistant — PROJECT CONTEXT & VISION DOCUMENT
> **This file is the single source of truth for this project.**
> Every architectural decision, every feature implementation, and every design choice must align with what is written here.
> When in doubt about anything — refer back to this document first.
> Do not modify sections 2, 3, 5, 6, 7, or 8 without a deliberate product decision.

---

## 1. PROJECT VISION (NON-NEGOTIABLE NORTH STAR)

Boldo AI Assistant exists for one reason: **to eliminate the phone call culture of Indian SMB task management without asking anyone to change their behaviour.**

Indian small and medium business owners spend 2–4 hours every day doing three things on the phone:
1. Assigning tasks to employees
2. Following up on whether tasks were accepted
3. Chasing updates when deadlines are missed

This happens entirely over WhatsApp voice notes and phone calls. Tools like Jira, Asana, Slack, and Monday.com exist — but Indian SMBs do not use them. Not because they are expensive. Because they require behaviour change. The business owner has to convince 15 employees to download a new app, learn it, use it daily, and remember to update it. This never works.

**Boldo AI Assistant's core insight:** The problem is not a lack of tools. It is a lack of accountability infrastructure layered on top of tools people already use.

The vision is: **A manager sends a WhatsApp voice note. Everything else is automatic.**

The task gets created. The employee gets notified. The deadline gets committed. If nothing happens — the system follows up. Not the manager. The manager opens a web dashboard to see the entire team's task status at a glance, with no manual data entry ever required.

Beyond team tasks, Boldo AI Assistant also serves as a **personal productivity layer** for both owners and employees — private to-dos, personal reminders, and notes that only the creator can see. And in the future, it will extend into **vendor and payment management**, so the same voice-note-first approach applies to collecting money and tracking business relationships.

**In one line:** Boldo AI Assistant is the accountability and productivity layer that Indian SMBs are missing — built on WhatsApp, so no one has to change how they work.

---

## 2. TARGET USER DEFINITION

### Primary User — The Business Owner / Manager
- Runs a business with 5–50 employees in India
- Industries: manufacturing, trading, retail, logistics, construction, agencies, family businesses
- Age: 30–55 years old
- Tech comfort: Uses WhatsApp heavily. Has a smartphone. Not comfortable with complex software.
- Current pain: Spends too much time on calls assigning and chasing tasks. No visibility into team productivity. Cannot objectively evaluate performance. Also struggles with vendor payment collection — has to personally call vendors to follow up on money owed.
- **What they want:** To give a task and forget it. To trust that the system will follow up. To also manage their personal reminders and vendor obligations in the same place without switching apps.
- **What they do NOT want:** To learn new software. To force their employees to learn new software. To do data entry. To manage a tool on top of managing a business.

### Secondary User — The Employee
- Works in the same SMB. May be on the shop floor, at a client site, or in an office.
- Tech comfort: WhatsApp is their entire digital life. May not be comfortable with web browsers or apps.
- Language: Primarily Gujarati or Hindi. May mix English words.
- **What they want:** Clear instructions. To know exactly what is expected and by when. To manage their own personal reminders privately without anyone seeing their personal to-do list.
- **What they do NOT want:** To install a new app. To have their personal to-dos visible to their manager.

### User Psychology Non-Negotiables
- **Friction = Death.** Every extra step costs adoption.
- **WhatsApp is home.** Task creation and response must work entirely within WhatsApp. The web app is for visibility, not daily operations.
- **Voice is king.** In Gujarati SMB culture, people speak — they don't type. Voice note support is the foundation of the product, not a feature.
- **Accountability must feel fair, not surveillance.** Performance stats are positioned as decision-support tools — not monitoring. Tone matters everywhere.
- **Personal stays personal.** To-dos are private and never visible to managers or colleagues. This is a trust non-negotiable.

---

## 3. CORE PRODUCT PRINCIPLES

These principles guide every feature decision. A proposed feature that violates one of these should not be built.

### P1 — WhatsApp First, App Second
The WhatsApp bot is the primary interface for creating tasks, todos, and future payment records. The web app is for visibility and management. A user who never opens the web app should still be able to use the core product via WhatsApp alone.

### P2 — Zero Friction for Creation
Creating a task, a to-do, or a payment reminder must never take more than one action: send a WhatsApp message or voice note. No forms. No multi-step confirmation flows. The AI handles all parsing and structure.

### P3 — Accountability is Automatic
The system is responsible for follow-up — not the manager. If an employee does not respond, the system escalates. If a vendor payment is not received, the system sends reminders. The manager should not have to do anything to get accountability.

### P4 — Commitments are Explicit
Employees do not just "receive" tasks. They must explicitly ACCEPT (with a deadline they choose) or REJECT (with a reason). This transforms an assignment into a commitment and is the core accountability mechanism.

### P5 — Language is Native
The product works in Gujarati, Hindi, Hinglish, and English without the user specifying which. Voice transcription and AI extraction handle code-mixed speech. Bot messages are warm and natural.

### P6 — Data Serves Decisions, Not Surveillance
Performance stats exist to help business owners make better promotion and delegation decisions. Vendor data exists to help them collect money. The product must never feel like a spying or debt-collection tool.

### P7 — Simple Until Proven Otherwise
Every feature starts at its simplest viable form. Add complexity only when real users demonstrate a need. An SMB owner does not need Gantt charts. They need to know: did Ramesh finish the job or not?

### P8 — One Org, One Truth
All task and org data lives in a single shared database. Real-time consistency is mandatory. When a status changes, everyone sees it immediately.

### P9 — Personal is Private
To-dos belong only to the person who created them. No manager, no admin, and no system process should ever expose a user's personal to-dos to anyone else. This is enforced at the database level via RLS, not just at the application level.

### P10 — Schema Scales, Features Don't Have To
The database schema must be designed for the 3-year vision even if the features are built incrementally. Tables for contacts, payments, and reminders must exist from Day 1 even if the features that use them are built later. This prevents painful migrations.

---

## 4. FEATURE SCOPE — THREE HORIZONS

### Horizon 1 — MVP (Build Now)
- WhatsApp bot: task creation via voice note or text, Gujarati/Hinglish/English support
- Task accept/reject flow with mandatory deadline commitment from assignee
- Sub-task delegation and dependency blocking (parent task cannot complete until sub-tasks done)
- Two-tier reminder system: WhatsApp (standard) + Sarvam AI voice call in Gujarati (urgent)
- **Personal to-dos:** Private reminders for any user. "Remind me to call Mehta at 3pm." "Bring flowers for wife today." WhatsApp reminder at specified time. EOD reminder at 8pm if todo not marked done. Web app view of personal todo list (private).
- Web app: home dashboard, my tasks, assigned tasks, todos (private), calendar, team org chart, stats, notifications, settings
- Org hierarchy: self-reported reporting manager on signup, auto-builds hierarchy
- Performance analytics: per-employee tasks completed, delayed, avg delay, on-time rate

### Horizon 2 — Post-MVP (Build After Product-Market Fit)
- **Vendor & Payment Management:**
  - Owner says via voice: "Collect Rs. 50,000 from Mehta by 15th March"
  - System creates a payment record linked to Mehta as a contact
  - If owner does not mark payment as received by due date: escalating WhatsApp reminders to owner
  - Option to send automated WhatsApp reminders directly to the vendor
  - Contacts directory: vendors, clients, partners
  - Payment dashboard: total outstanding, overdue, received this month
- Recurring tasks
- Employee self-created tasks (assigned to others, not just manager-down)
- WhatsApp-based onboarding (sign up without ever opening web app)

### Horizon 3 — Long-Term Vision
- Mobile app (iOS and Android)
- Multi-language web app UI
- Public API for integrations
- Advanced analytics and productivity insights
- Client portal (external stakeholders can see task status)

---

## 5. THE DISTINCTION BETWEEN TASKS AND TO-DOS

This is a fundamental product distinction that must be maintained throughout the entire codebase.

| Dimension | Task | To-Do |
|---|---|---|
| Created by | Manager or owner role | Any user (all roles) |
| Assigned to | Another person in the org | The creator themselves only |
| Visibility | Creator, assignee, and their managers | Only the creator. Ever. |
| Accept/Reject flow | Mandatory | Does not exist |
| Deadline commitment | Set by assignee on acceptance | Set by creator at creation |
| Delegation | Can delegate via sub-tasks | Cannot be delegated |
| Reminders | Automated system reminders for both parties | Personal WhatsApp reminders to creator only |
| Appears in stats | Yes — affects performance analytics | No — never in stats or analytics |
| WhatsApp trigger | Names another person as subject: "Tell Ramesh to...", "Ask Priya to..." | Self-referential: "Remind me to...", "I need to...", "Don't forget to..." |

**How Gemini classifies intent:**
- Message names another person as the one doing the work → **task**
- Message is self-referential (I, me, remind me, I need to) → **to-do**
- Ambiguous → ask user: "Is this a task for someone else or a personal reminder for you?"

---

## 6. ARCHITECTURE OVERVIEW

### System Components

```
┌──────────────────────────────────────────────────────────────────┐
│                        BOLDO SYSTEM                           │
├──────────────┬────────────────────────┬──────────────────────────┤
│  WHATSAPP    │     WEB APP            │   BACKGROUND JOBS        │
│  BOT LAYER   │     (Next.js 14)       │                          │
│              │                        │                          │
│  Wati API    │  /home                 │  Reminder scheduler      │
│  Webhook     │  /my-tasks             │  (every 5 mins)          │
│  Handler     │  /assigned-tasks       │                          │
│              │  /todos  (private)     │  Overdue detection       │
│  Sarvam      │  /calendar             │                          │
│  Saaras v3   │  /team                 │  WhatsApp tier-1         │
│  (STT)       │  /stats                │  reminders               │
│              │  /notifications        │                          │
│  Gemini      │  /settings             │  Voice call tier-2       │
│  2.5 Flash   │                        │  (Sarvam + Exotel)       │
│  (intent +   │  [future]              │                          │
│  extraction) │  /contacts             │  Payment due alerts      │
│              │  /payments             │  [future]                │
│              │                        │                          │
│              │  Auth: Supabase OTP    │                          │
│              │  (phone number)        │                          │
└──────┬───────┴──────────┬─────────────┴───────────┬─────────────┘
       │                  │                          │
       └──────────────────▼──────────────────────────┘
                     SUPABASE
          (Database + Auth + Real-time + Storage)
```

### Data Flow — Task Creation via WhatsApp
```
Manager sends WhatsApp voice note
  → Wati delivers to /api/webhook
  → Sarvam Saaras v3 transcribes audio (gu-IN, code_mix=true)
  → Gemini 2.5 Flash classifies intent: task_create | todo_create | task_reply | unknown
  → If task_create: extract assignee_name, task_description, deadline_iso
  → Look up assignee by name in users table (filtered by organisation_id)
  → Insert row in tasks table (status = 'pending')
  → Insert row in reminders table (scheduled_at = now + 10 mins, channel = whatsapp)
  → Insert row in reminders table (scheduled_at = now + 30 mins, channel = call)
  → Send WhatsApp to assignee via Wati
  → Send confirmation WhatsApp to manager
  → Dashboard updates in real-time via Supabase subscriptions
```

### Data Flow — To-Do Creation via WhatsApp
```
User sends "Remind me to call Mehta at 3pm"
  → Sarvam transcribes
  → Gemini classifies: todo_create
  → Gemini extracts: title, remind_at (3pm today), due_at (EOD today)
  → Insert row in todos table (user_id = sender, no organisation_id)
  → Insert row in reminders table (entity_type = 'todo', scheduled_at = 3pm)
  → Insert row in reminders table (entity_type = 'todo', scheduled_at = 8pm EOD fallback)
  → Confirm to user: "Got it! I'll remind you to call Mehta at 3pm today."
  → No one else can see this todo. Ever.
```

### Data Flow — Reminder Cron Job (runs every 5 minutes)
```
Query: SELECT * FROM reminders WHERE status = 'pending' AND scheduled_at <= NOW()
  → For each pending reminder:
      → If channel = 'whatsapp': send WhatsApp via Wati
      → If channel = 'call': trigger Sarvam Samvaad + Exotel outbound call
      → UPDATE reminders SET status = 'sent', sent_at = NOW()
      → On failure: SET status = 'failed', failure_reason = error message
  → Separately: query tasks past deadline with status != 'completed'
      → Mark status = 'overdue'
      → Insert notifications for owner and assignee
      → Insert WhatsApp reminder in reminders table
```

### Technology Stack (Final)

| Layer | Technology | Reason |
|---|---|---|
| Frontend + Backend | Next.js 14 (App Router) | Full-stack, Supabase integration, Vercel-native |
| Database + Auth + Real-time | Supabase | Built-in auth, RLS, real-time subscriptions, free tier |
| Voice Transcription | Sarvam AI — Saaras v3 | Best for Gujarati + Indian languages. Code-mix aware. Rs. 30/hr. |
| AI Intent + Extraction | Gemini 2.5 Flash (non-thinking mode) | Lowest hallucination on structured extraction. Fastest. Cheapest (~$0.30/M tokens). |
| WhatsApp API | Wati | Developer-friendly. Indian company. Good API docs. |
| AI Voice Calls | Sarvam AI — Samvaad | Same vendor as STT. Speaks naturally in Gujarati/Hindi. |
| Telephony | Exotel | TRAI compliant. Bills in INR. 30–40% cheaper than Twilio. |
| Hosting + Cron | Vercel | Seamless Next.js deploy. Native cron jobs. Free for MVP. |
| Code Backup | GitHub | Private repo. Auto-deploy from main branch. |
| Security Scanning | Snyk | Auto-scans AI-generated code. Runs in background in Antigravity. |

---

## 7. DATABASE SCHEMA (FINAL — SCALABLE VERSION)

> Tables marked `[future]` are created now but only populated when that Horizon 2 feature is built.
> This prevents painful schema migrations later. Do not skip creating these tables.

### `organisations`
```sql
id          uuid        PRIMARY KEY DEFAULT gen_random_uuid()
name        text        NOT NULL
slug        text        UNIQUE  -- URL-friendly e.g. "mehta-traders"
settings    jsonb       DEFAULT '{}'  -- org-level config, extensible
created_at  timestamptz DEFAULT now()
updated_at  timestamptz DEFAULT now()
```

### `users`
```sql
id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid()
name                  text        NOT NULL
phone_number          text        UNIQUE NOT NULL
email                 text        UNIQUE
organisation_id       uuid        REFERENCES organisations(id)
reporting_manager_id  uuid        REFERENCES users(id)  -- self-referential
role                  text        DEFAULT 'member'  -- owner | manager | member
avatar_url            text
notification_prefs    jsonb       DEFAULT '{
                                    "whatsapp_reminders": true,
                                    "call_reminders": true,
                                    "overdue_alerts": true,
                                    "todo_reminders": true
                                  }'
created_at            timestamptz DEFAULT now()
updated_at            timestamptz DEFAULT now()

-- notification_prefs keys are explicitly defined here.
-- Do not add arbitrary keys at runtime.
```

### `tasks`
```sql
id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid()
title               text        NOT NULL
description         text
organisation_id     uuid        NOT NULL REFERENCES organisations(id)
created_by          uuid        NOT NULL REFERENCES users(id)
assigned_to         uuid        NOT NULL REFERENCES users(id)
parent_task_id      uuid        REFERENCES tasks(id)  -- NULL = top-level task; set = sub-task
status              text        DEFAULT 'pending'
                                -- pending | accepted | rejected | completed | overdue | cancelled
priority            text        DEFAULT 'normal'  -- low | normal | high | urgent
deadline            timestamptz  -- the deadline the MANAGER specifies
committed_deadline  timestamptz  -- the deadline the ASSIGNEE commits to on acceptance
call_made           boolean     DEFAULT false
source              text        DEFAULT 'web'  -- web | whatsapp | api
created_at          timestamptz DEFAULT now()
updated_at          timestamptz DEFAULT now()

-- IMPORTANT: sub_tasks are stored in THIS same table using parent_task_id.
-- The old separate sub_tasks table is removed.
-- This allows unlimited nesting depth and simpler queries.
-- A task where parent_task_id IS NULL is a top-level task.
-- A task where parent_task_id IS NOT NULL is a sub-task.
```

### `task_comments`
```sql
id          uuid        PRIMARY KEY DEFAULT gen_random_uuid()
task_id     uuid        NOT NULL REFERENCES tasks(id) ON DELETE CASCADE
user_id     uuid        NOT NULL REFERENCES users(id)
content     text        NOT NULL
created_at  timestamptz DEFAULT now()

-- Renamed from task_remarks. ON DELETE CASCADE ensures cleanup when task is deleted.
```

### `todos`
```sql
id          uuid        PRIMARY KEY DEFAULT gen_random_uuid()
user_id     uuid        NOT NULL REFERENCES users(id)
title       text        NOT NULL
description text
status      text        DEFAULT 'pending'  -- pending | done | snoozed
due_at      timestamptz  -- when the to-do is due (used for EOD fallback reminder)
remind_at   timestamptz  -- when to send the primary WhatsApp reminder
source      text        DEFAULT 'web'  -- web | whatsapp
created_at  timestamptz DEFAULT now()
updated_at  timestamptz DEFAULT now()

-- CRITICAL: This table has NO organisation_id. Todos are personal, not org-scoped.
-- RLS policy: user_id = auth.uid() for ALL operations — read, insert, update, delete.
-- No manager, admin, or system query should ever return another user's todos.
-- This is enforced at the database level, not the application level.
```

### `reminders`
```sql
id              uuid        PRIMARY KEY DEFAULT gen_random_uuid()
entity_type     text        NOT NULL  -- task | todo | payment
entity_id       uuid        NOT NULL  -- ID of the task, todo, or payment row
user_id         uuid        NOT NULL REFERENCES users(id)  -- who receives the reminder
channel         text        NOT NULL  -- whatsapp | call
scheduled_at    timestamptz NOT NULL  -- when this reminder should fire
sent_at         timestamptz           -- NULL until sent
status          text        DEFAULT 'pending'  -- pending | sent | failed | cancelled
failure_reason  text                  -- populated if status = 'failed'
created_at      timestamptz DEFAULT now()

-- This is a SCHEDULER, not a log. The cron job queries:
--   WHERE status = 'pending' AND scheduled_at <= NOW()
-- On completion: UPDATE status = 'sent', sent_at = NOW()
-- When a task is completed early: UPDATE status = 'cancelled' on its pending reminders
-- This design enables: retry logic, cancellation, full audit of what was sent and when.
```

### `contacts` [used in MVP for basic vendor phone storage; fully used in Horizon 2]
```sql
id                uuid        PRIMARY KEY DEFAULT gen_random_uuid()
organisation_id   uuid        NOT NULL REFERENCES organisations(id)
name              text        NOT NULL
phone_number      text
email             text
type              text        DEFAULT 'other'  -- vendor | client | partner | other
notes             text
created_by        uuid        REFERENCES users(id)
created_at        timestamptz DEFAULT now()
updated_at        timestamptz DEFAULT now()

-- In MVP: exists but mostly empty. May store vendor numbers for future payment reminders.
-- In Horizon 2: fully populated and used for vendor management.
-- Creating this now prevents a migration when Horizon 2 is built.
```

### `payments` [created now; populated in Horizon 2 only]
```sql
id                uuid          PRIMARY KEY DEFAULT gen_random_uuid()
organisation_id   uuid          NOT NULL REFERENCES organisations(id)
contact_id        uuid          NOT NULL REFERENCES contacts(id)
created_by        uuid          NOT NULL REFERENCES users(id)
amount            numeric(12,2) NOT NULL
currency          text          DEFAULT 'INR'
type              text          DEFAULT 'receivable'  -- receivable | payable
status            text          DEFAULT 'pending'  -- pending | partial | received | overdue | written_off
due_date          date          NOT NULL
received_date     date          -- populated when owner marks as received
notes             text
source            text          DEFAULT 'web'  -- web | whatsapp
created_at        timestamptz   DEFAULT now()
updated_at        timestamptz   DEFAULT now()

-- In Horizon 2: "Collect Rs. 50,000 from Mehta by 15 March" creates a row here.
-- Reminders for this payment are created in the reminders table with entity_type = 'payment'.
-- Do not build UI for this table in MVP. Just ensure the table exists.
```

### `incoming_messages`
```sql
id                uuid        PRIMARY KEY DEFAULT gen_random_uuid()
phone             text        NOT NULL
user_id           uuid        REFERENCES users(id)  -- NULL if sender not yet registered
raw_text          text        NOT NULL
language_detected text
intent_type       text
                  -- task_create | todo_create | task_reply | payment_create | unknown
                  -- Set by Gemini after classification step
processed         boolean     DEFAULT false
processing_error  text        -- populated if Gemini or any downstream step failed
created_at        timestamptz DEFAULT now()

-- intent_type drives routing:
-- task_create    → processTaskCreation()
-- todo_create    → processTodoCreation()
-- task_reply     → processTaskReply()   (ACCEPT, REJECT, DONE, DELEGATE, STATUS, HELP)
-- payment_create → processPaymentCreation()  [Horizon 2 — classify now, process later]
-- unknown        → send clarification WhatsApp back to user
```

### `notifications`
```sql
id            uuid        PRIMARY KEY DEFAULT gen_random_uuid()
user_id       uuid        NOT NULL REFERENCES users(id)
type          text        NOT NULL
              -- task_assigned | task_accepted | task_rejected | task_completed
              -- task_overdue | todo_due | sub_task_completed | payment_overdue
message       text        NOT NULL
entity_type   text        -- task | todo | payment
entity_id     uuid        -- ID in the relevant table
is_read       boolean     DEFAULT false
created_at    timestamptz DEFAULT now()
```

### `audit_log`
```sql
id              uuid        PRIMARY KEY DEFAULT gen_random_uuid()
user_id         uuid        REFERENCES users(id)
organisation_id uuid        REFERENCES organisations(id)
action          text        NOT NULL
                -- task.created | task.accepted | task.rejected | task.completed | task.overdue
                -- todo.created | todo.completed | user.joined | user.invited
                -- payment.created | payment.received  [future]
                -- system.error | system.reminder_sent
entity_type     text
entity_id       uuid
metadata        jsonb       DEFAULT '{}'  -- relevant snapshot data at time of action
created_at      timestamptz DEFAULT now()

-- APPEND-ONLY. Never update or delete rows.
-- Purpose 1: Production debugging (see exactly what happened and when)
-- Purpose 2: Trust — business owner can verify task was accepted at 14:32 on 5th March
-- RLS: members can read their own org's logs. No delete or update policy exists.
```

### Schema Changes vs. Original Design

| Original | Change | Reason |
|---|---|---|
| `sub_tasks` (separate table) | **Removed.** Merged into `tasks` via `parent_task_id`. | Simpler queries. Unlimited nesting depth. No join needed. |
| `task_remarks` | **Renamed** to `task_comments`. Added `ON DELETE CASCADE`. | Clearer name. Cleanup on task delete. |
| `reminder_log` | **Replaced** by `reminders`. Now a scheduling table. | Enables retry, rescheduling, cancellation — not just logging. |
| `user_preferences` on users | **Renamed** to `notification_prefs` with defined keys. Added `updated_at`. | Prevents key sprawl. Trackable. |
| `incoming_messages` | Added `intent_type`, `user_id`, `processed`, `processing_error`. | Enables routing. Debugging. Retry logic. |
| `notifications` | Added `entity_type`. | Generic linking to any entity type. |
| `tasks` | Added `parent_task_id`, `committed_deadline`, `priority`, `source`, `updated_at`. | Sub-tasks merged in. Richer data. |
| `organisations` | Added `slug`, `settings`, `updated_at`. | URL routing. Extensible config. |
| **NEW: `todos`** | Personal private reminders. | Core MVP feature. Fundamentally different from tasks. |
| **NEW: `contacts`** | External people (vendors, clients). | Foundation for Horizon 2. Avoid future migration. |
| **NEW: `payments`** | Receivables and payables. | Foundation for Horizon 2. Avoid future migration. |
| **NEW: `audit_log`** | Append-only action log. | Debugging + trust + compliance. |

### Required Database Indexes
```sql
-- tasks: most queries filter by org and status
CREATE INDEX idx_tasks_organisation_id ON tasks(organisation_id);
CREATE INDEX idx_tasks_assigned_to ON tasks(assigned_to);
CREATE INDEX idx_tasks_created_by ON tasks(created_by);
CREATE INDEX idx_tasks_parent_task_id ON tasks(parent_task_id);
CREATE INDEX idx_tasks_status ON tasks(status);

-- reminders: cron job queries by status + scheduled_at
CREATE INDEX idx_reminders_status_scheduled ON reminders(status, scheduled_at);
CREATE INDEX idx_reminders_entity ON reminders(entity_type, entity_id);

-- todos: always queried by user_id
CREATE INDEX idx_todos_user_id ON todos(user_id);

-- notifications: always queried by user_id
CREATE INDEX idx_notifications_user_id ON notifications(user_id, is_read);

-- audit_log: queried by org
CREATE INDEX idx_audit_log_organisation_id ON audit_log(organisation_id);
```

---

## 8. SYSTEM DESIGN PHILOSOPHY

### On AI Intent Classification
Gemini must classify intent FIRST before attempting any extraction. The two-step process is:

**Step 1 — Classify:**
```
Is this a task_create (assigns work to another named person)?
Is this a todo_create (self-referential: I, me, remind me)?
Is this a task_reply (ACCEPT, REJECT, DONE, DELEGATE, STATUS, HELP)?
Is this a payment_create (collect or pay money from/to someone)?
Is it unknown/ambiguous?
```

**Step 2 — Extract** (only after intent is confirmed):
- For `task_create`: assignee_name, task_description, deadline_iso
- For `todo_create`: title, remind_at, due_at
- For `payment_create`: contact_name, amount, currency, due_date, type (receivable/payable)

**The single most important instruction in the entire codebase — always include this in every Gemini prompt:**
> "Return null for any field you are not certain about. Do not guess. Do not infer. Do not assume. A null field triggers a clarification request, which is always better than a wrong value."

### On the Reminders Table as a Job Queue
```
Cron runs every 5 minutes:
  SELECT * FROM reminders WHERE status = 'pending' AND scheduled_at <= NOW()
  → Send via WhatsApp or voice call
  → UPDATE status = 'sent', sent_at = NOW()
  → On failure: UPDATE status = 'failed', failure_reason = [error]

When a task is completed before its reminders fire:
  UPDATE reminders SET status = 'cancelled'
  WHERE entity_type = 'task' AND entity_id = [task_id] AND status = 'pending'
```

### On Security
- RLS on ALL tables — non-negotiable
- `todos` RLS strictly: `user_id = auth.uid()` — no exceptions, not even for service role in application code
- `tasks` RLS: `organisation_id = (SELECT organisation_id FROM users WHERE id = auth.uid())`
- `audit_log` RLS: read-only for org members, no update/delete policy at all
- All API keys are server-side environment variables. Zero exceptions.
- All dashboard routes protected by Supabase Auth middleware. Unauthenticated = 401.
- Webhook rate limiting: max 30 messages per phone per minute.

### On Error Handling
- Every external API call (Sarvam, Gemini, Wati, Exotel) wrapped in try/catch
- On failure: log to `audit_log` with `action = 'system.error'`, set `processing_error` on `incoming_messages` row, send human-readable WhatsApp to user
- Never surface technical errors to end users

### On Performance
- Home dashboard: under 2 seconds. Use Next.js server components and server-side Supabase queries.
- Webhook: return 200 OK within 200ms. All heavy processing (transcription, AI) runs async after acknowledgement.
- Cron job: complete full cycle under 60 seconds.
- Use the indexes defined above. Never run unindexed queries on `tasks` or `reminders` in production.

### On Mobile
- All web app pages must be fully functional at 375px viewport.
- Minimum 44px tap targets. Tables scroll horizontally. No text under 14px.
- Most managers will access the dashboard on their phone.

---

## 9. WHAT WE ARE NOT BUILDING

### Absolutely Not in MVP
- ❌ Mobile app (iOS or Android)
- ❌ Chat or messaging feature — WhatsApp handles this
- ❌ Document management or file attachments
- ❌ Time tracking or timesheets
- ❌ Invoicing or billing
- ❌ Gantt charts or project timeline view
- ❌ Multiple assignees on a single task
- ❌ Custom fields or tags on tasks
- ❌ Integrations with Slack, Jira, or Google Calendar
- ❌ Email notifications
- ❌ Multi-language web app UI (English only; WhatsApp bot speaks user's language)
- ❌ Recurring or scheduled tasks
- ❌ Super-admin panel across all organisations
- ❌ Dark mode
- ❌ Vendor payment management UI (schema is ready, feature is Horizon 2)

### Scope Creep to Actively Resist
- ❌ AI-generated task suggestions
- ❌ Automated task prioritisation
- ❌ Slack or Telegram bot (WhatsApp only)
- ❌ Complex BI-level analytics (a table and bar chart are sufficient)
- ❌ Employee-initiated tasks assigned to others (MVP: only managers/owners assign)
- ❌ Leave management or HR features
- ❌ Multi-org membership for a single user

---

## 10. NON-NEGOTIABLES

1. **WhatsApp bot must work in Gujarati.** Sarvam Saaras v3 with `code_mix=true` is mandatory.

2. **Todos are completely private.** No code path, no query, and no admin access should ever expose a user's todos to another user. Enforced at RLS level.

3. **Employees must commit to a deadline when accepting a task.** ACCEPT alone is not enough. This is the core accountability mechanism. Without it, the product's value proposition collapses.

4. **RLS must be enabled on every table from Day 1.** Not after launch. From Day 1.

5. **Gemini must never hallucinate task or todo details.** Always include "return null if uncertain — do not guess" in every extraction prompt.

6. **The system — not the manager — is responsible for follow-up.** The cron job is not optional. If reminders require manual manager action, the core promise has failed.

7. **The `reminders` table is a scheduler, not a log.** Pending reminders must be cancellable and must track sent/failed status for retry logic.

8. **The web app must be mobile-responsive.** Most managers access it on their phone.

9. **All errors produce a human-readable WhatsApp message.** Silent failures are never acceptable.

10. **The `contacts` and `payments` tables are created in the initial migration.** They may be empty until Horizon 2 but they must exist from Day 1 to prevent future migrations.

---

## 11. OPEN QUESTIONS (Decide With Evidence, Not Speculation)

- **Pricing:** Flat Rs. 499–999/month per org vs. per-user pricing. Decide after beta testing.
- **WhatsApp template approval:** Wati requires Meta-approved templates for outbound messages after the 24-hour window. Start approval process before launch — it takes 1–2 weeks.
- **Employee WhatsApp onboarding:** Should employees be able to sign up entirely through WhatsApp? Would improve adoption but adds complexity. Defer to post-MVP.
- **Todo EOD reminder time:** Default is 8pm. Should this be configurable per user? Validate with beta users first.
- **Vendor payment WhatsApp reminders:** In Horizon 2, should the system automatically message the vendor, or only remind the owner? Automated debt collection messages can damage relationships. Decide carefully with input from SMB owners.
- **Dual reporting managers:** MVP assumes one per person. Add only if real users request it.

---

## 12. CURRENT BUILD STATUS

> Update this section as development progresses.

- [ ] Pre-work: Antigravity setup, MCPs installed, all service accounts created
- [ ] Week 1 (Days 1–7): Web app foundation — auth, app shell, home dashboard, my tasks, assigned tasks, calendar
- [ ] Week 2 (Days 8–14): Web app advanced — team, stats, settings, create task, todos page, real-time, notifications
- [ ] Week 3 (Days 15–21): WhatsApp bot — webhook, Sarvam transcription, Gemini intent + extraction, task flows, todo flows
- [ ] Week 4 (Days 22–28): Reminders cron, delegation, Gujarati testing, security audit, beta testing, launch

**Current version:** Not started
**Live URL:** Not deployed yet
**Beta users:** None yet

---

*Last updated: Pre-development*
*Owner: [Your name]*
*This document travels with the codebase. Update it when major architectural decisions change.*
*Place this file at the root of the project directory alongside package.json.*
