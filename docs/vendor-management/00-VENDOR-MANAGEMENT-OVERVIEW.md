# Vendor Management — Overview & Implementation Context

This document provides the full context needed to implement any vendor management feature in Boldo AI. When starting a new conversation to implement a specific feature, tag this document along with the relevant feature doc (01–05) — no additional prompting should be required.

---

## 1. What We're Building

Boldo AI is a WhatsApp-first task management platform for Indian SMBs. Currently, the system manages **tasks** between employees within an organisation. We are adding **Vendor Management** — a new subsystem that lets org users:

1. **Onboard external vendors** (suppliers, contractors, freelancers) via WhatsApp bot or webapp
2. **Create tracking tickets** for vendor-related work (shipments, payments, invoices) via WhatsApp bot or webapp
3. **Track ticket lifecycle** with deadlines, acceptance flows, and (future) automated reminders

### Key Difference: Vendors vs Employees

| Aspect | Employee (User) | Vendor |
|--------|----------------|--------|
| Boldo Account | Required — must sign up | NOT required |
| Database Table | `users` | `org_vendors` (new) |
| Organisation | Belongs to one org | Can be vendor to multiple orgs |
| WhatsApp Interaction | Full AI pipeline (create tasks, todos, etc.) | Limited: approve/reject requests, accept/reject tickets, provide name |
| Dashboard Access | Full dashboard | None (unless they also create a user account) |

### New Entities

- **Vendor**: An external contact identified by phone number, linked to an organisation. Does not need a Boldo account.
- **Ticket**: A tracking item created by an org user, assigned to a vendor. Has subject, deadline, status lifecycle. Fundamentally different from tasks — tickets track vendor obligations (shipments, payments), not employee work.

---

## 2. Current System Architecture (Self-Contained Summary)

### Tech Stack
- **Framework**: Next.js 14 App Router (TypeScript, strict mode)
- **Database**: Supabase (PostgreSQL + Auth + Realtime)
- **AI**: Google Gemini (Flash Lite Preview, temperature=0.1, JSON output)
- **Messaging**: WhatsApp Cloud API (Meta Graph API v21.0)
- **Voice**: Sarvam AI (speech-to-text), Plivo/Twilio (voice calls)
- **Frontend State**: React Query (@tanstack/react-query) with persist client
- **Deployment**: Railway (standalone output, `node .next/standalone/server.js`)
- **Path Alias**: `@/*` maps to project root

### Supabase Clients
- `lib/supabase/client.ts` — browser-side (cookie-based auth)
- `lib/supabase/server.ts` — server-side / API routes
- `lib/supabase/admin.ts` — admin operations (service role key, bypasses RLS)

### WhatsApp Message Flow

```
Incoming WhatsApp Message
  → app/api/webhook/whatsapp/route.ts (POST handler)
    → Rate limit check (30 msg/60s per sender)
    → Message dedup (5-min window)
    → Known Users Cache check (10-min TTL, positive-only caching)
    → Quick Reply Button payloads → direct handlers (approve_join_request::, task_accept_prompt::, etc.)
    → Fast-path keywords: "signin", "login", "list"
    → Unknown phone → send signup link template
    → Known user + audio → processMessageInline() (transcribe → AI → dispatch)
    → Known user + text → processMessageInline()
```

### AI Processing Pipeline (`app/api/internal/process-message/route.ts`)

```
processMessageInline(phone, messageId, rawText, mediaId?)
  → Fetch message from DB + idempotency check
  → Get sender user from phone
  → If audio: download → transcribe (Sarvam) → translate
  → Check for active conversation session (10-min TTL)
    → If session: route to session-reply-handler
    → If handled: done
    → If not handled: resolve session, fall through
  → AI Analysis: analyzeMessage(text, senderName) — single Gemini call
    → Extracts: WHO (type + name), WHAT (description), WHEN (deadline), INTENT
    → Confidence threshold: ≥ 0.9 or falls back to "unknown"
  → Intent dispatch:
    → task_create → handleTaskCreate()
    → todo_create → handleTodoCreate()
    → send_dashboard_link → handleSendDashboardLink()
    → unknown → handleUnknown()
```

### Intent System

**Current WhatsApp intents** (4, defined in `lib/ai/types.ts` as `WhatsAppIntent`):
- `task_create`, `todo_create`, `send_dashboard_link`, `unknown`

**How to add a new intent:**
1. Add to `WHATSAPP_ACTIONS` array in `lib/ai/whatsapp-capabilities.ts` (with id, label, description, examples)
2. Add to `WhatsAppIntent` union type in `lib/ai/types.ts`
3. The Gemini prompt auto-includes capabilities via `getWhatsAppActionsForPrompt()` in `lib/ai/system-prompts.ts`
4. Add `case` in intent dispatch switch in `app/api/internal/process-message/route.ts`
5. Implement handler function

### Session System (Multi-Turn Conversations)

File: `lib/ai/conversation-context.ts`

- One active session per phone number (auto-resolves previous on new creation)
- 10-minute TTL, stored in `conversation_sessions` table
- Current session types: `awaiting_assignee_name`, `awaiting_assignee_selection`, `awaiting_task_description`, `awaiting_todo_deadline`, `awaiting_accept_deadline`, `awaiting_reject_reason`, `awaiting_edit_deadline`
- Session reply routing: `lib/ai/session-reply-handler.ts`
- Context data shape: `SessionContextData` interface carries intermediate state (intent, who_name, what, when, candidates, task_id, sender info, org_id)

### WhatsApp Templates & Button Payloads

All templates are pre-approved by Meta. Sent via `lib/whatsapp.ts`.

**Current button payload format**: `action_name::entity_id` (e.g., `task_accept_prompt::abc-123`)

Button payloads are handled in the webhook `POST` handler before any AI processing — they're fast-path dispatches based on string prefix matching.

### Notification System (`lib/notifications/`)

- `whatsapp-notifier.ts` — builds and sends WhatsApp messages for task events
- `task-notification-scheduler.ts` — schedules notifications in stages (acceptance, reminder, escalation, deadline)
- `task-notification-processor.ts` — cron-driven execution of due notifications
- `daily-summary.ts` — 8 AM IST daily summaries with atomic dedup
- `business-hours.ts` — enforces 9 AM–9 PM IST, skips Sundays
- Dedup: `dedup_key` = `task_id:stage:stage_number:target_role:channel`

### Frontend Architecture

- **Layout**: `app/(dashboard)/layout.tsx` — server component wraps QueryProvider → DashboardClientWrapper → SidebarProvider → UserProvider
- **Sidebar**: `components/layout/sidebar.tsx` — `pageNav` array with lucide icons, active state via pathname matching
- **Data fetching**: `lib/hooks/useDashboardData.ts` — two-phase parallel fetch (Phase 1: profile + my tasks, Phase 2: org users + all org tasks)
- **Global context**: `lib/user-context.ts` — provides userId, userName, orgId, orgUsers, allOrgUsers, tasks, allOrgTasks, isLoading, refreshData
- **Task cards**: `components/dashboard/TaskCard.tsx` — `rounded-2xl border bg-white p-3 sm:p-4` with left color accent bar
- **Modals**: Bottom-sheet on mobile, centered on desktop. Pattern in `components/tasks/CreateTaskModal.tsx` — uses MODAL token object for consistent styling
- **Skeletons**: `components/ui/DashboardSkeleton.tsx` — `animate-pulse rounded-xl bg-gray-200/70`

### Color System

CSS variable-based shades defined in `tailwind.config.ts`:
- `todo` (violet) — self-assigned tasks
- `owned` (orange) — tasks you created for others
- `assigned` (indigo) — tasks assigned to you
- `overdue` (rose) — past-deadline tasks
- `accent` (yellow) — highlights

---

## 3. CRITICAL: User/Vendor Separation Architecture

This is the single most important architectural challenge. Current system assumes every WhatsApp sender is either a registered user or needs to sign up. Vendors break this assumption.

### The Problem

In `app/api/webhook/whatsapp/route.ts`, when a phone number is not found in the `users` table, the system sends a signup link. Vendors must NOT receive this — they don't need accounts.

In `app/api/internal/process-message/route.ts`, the function checks `getUserByPhone()` and sends signup link if not found. This also must not block vendors.

### The Solution: Layered Lookup

Before the "unknown phone → signup link" fallback, add a vendor lookup layer:

```
Phone arrives in webhook →
  1. getCachedUser(phone) → if found → normal user flow (existing, unchanged)
  2. Check button payload → if vendor-specific payload (approve_vendor_request::, reject_vendor_request::, ticket_accept_prompt::, ticket_reject_prompt::) → handle directly
  3. getActiveSession(phone) → if vendor session type (awaiting_vendor_name) → route to session handler
  4. getCachedVendor(phone) → if found → vendor message handler (limited responses)
  5. None of the above → signup link (existing, unchanged)
```

### Four Scenarios to Handle

**S1: Phone is vendor only (not a registered user)**
- Vendor taps approve/reject button → handle via button payload (no user lookup needed)
- Vendor sends text during name collection → handle via session (awaiting_vendor_name)
- Vendor sends random message → respond: "You're registered as a vendor with [org name]. If you need help, please contact [org owner name]." Do NOT send signup link.
- Vendor types "signin"/"login" → send signup link (they might want to create an account too)

**S2: Phone is both a registered user AND a vendor (in another org)**
- User flows take full priority — all existing task_create, todo_create, etc. work normally
- Vendor button payloads still work because they're namespace-separated (`approve_vendor_request::` vs `task_accept_prompt::`)
- No conflict — button payloads are checked before AI pipeline

**S3: Existing user gets added as vendor to their own or another org**
- Vendor addition should detect this and link `org_vendors.user_id` to the existing user record
- Name is auto-populated from the users table
- Approval template is still sent (vendor must consent to being added)

**S4: Vendor accepts request but has no name in system**
- On approve button click: check if phone exists in `users` table → if yes, use that name
- If not in `users` table → create session `awaiting_vendor_name` for that phone
- Next message from that phone → session handler captures name (FirstName LastName format)
- Only after name is captured → complete onboarding, notify original user
- IMPORTANT: This message must NOT go through the AI pipeline — it's handled purely by the session system

### Vendor Cache Pattern

Mirror the existing known-users cache:
- In-memory Map with 10-minute TTL
- Key: phone number, Value: `{ id, name, organisation_ids, phone_number }`
- Do NOT cache negative results (new vendor additions are found immediately)
- Separate from user cache — `knownVendorsCache` map

### Message Routing Decision Tree

```
if (isButtonPayload) {
  // Handle ALL button payloads first (both user and vendor payloads)
  // This works for both registered users and vendors
  return
}

const user = getCachedUser(phone)
if (user) {
  // Normal user flow — process with AI pipeline
  // This is completely unchanged from current behavior
  return
}

const session = getActiveSession(phone)
if (session && isVendorSession(session.session_type)) {
  // Vendor is in a multi-turn flow (e.g., name collection)
  handleVendorSessionReply(session, message)
  return
}

const vendorRecords = getCachedVendor(phone)
if (vendorRecords && vendorRecords.length > 0) {
  // Known vendor, not a user — send limited response
  handleVendorGenericMessage(phone, vendorRecords)
  return
}

// Unknown phone — send signup link (existing behavior, unchanged)
sendSignupLinkTemplate(phone, token)
```

---

## 4. New Database Tables (Summary)

Detailed schema in `01-DATABASE-SCHEMA.md`.

### `org_vendors`
Vendor records scoped to organisations. Phone number unique per org. Status: pending/active/inactive.

### `vendor_onboarding`
Tracks pending vendor approval requests. Links requester to vendor phone. Status: pending/approved/rejected.

### `tickets`
Tracking tickets for vendor obligations. Has subject, deadline, committed_deadline, status lifecycle (pending → accepted → active → completed/cancelled).

---

## 5. New WhatsApp Intents

### `vendor_add` (AI-classified)
User wants to add a vendor. Detected by Gemini from messages like:
- "Add vendor 9876543210"
- "Register new supplier Ramesh"
- "Add a new vendor"

### `ticket_create` (AI-classified)
User wants to create a ticket for a vendor. Detected from:
- "Create ticket for Ramesh - invoice pending by Friday"
- "Track shipment from Kumar Supplies, deadline next week"
- "New ticket: payment follow-up with Sharma ji"

---

## 6. New Session Types

Add to `SessionType` union in `lib/ai/conversation-context.ts`:

| Session Type | Context | Trigger |
|-------------|---------|---------|
| `awaiting_vendor_phone` | Bot asked user for vendor's phone number | vendor_add intent, no phone in message |
| `awaiting_vendor_name` | Bot asked vendor for their name after approval | Vendor clicks approve, phone not in users table |
| `awaiting_ticket_vendor` | Bot asked user which vendor for the ticket | ticket_create intent, vendor not identified |
| `awaiting_ticket_subject` | Bot asked user for ticket subject | ticket_create intent, subject missing |
| `awaiting_ticket_deadline` | Bot asked user for ticket deadline | ticket_create intent, deadline missing |

### Extended SessionContextData

Add these optional fields to `SessionContextData` in `lib/ai/conversation-context.ts`:

```typescript
/** Vendor onboarding fields */
vendor_phone?: string | null
vendor_name?: string | null
onboarding_id?: string | null

/** Ticket creation fields */
vendor_id?: string | null
ticket_subject?: string | null
ticket_deadline?: string | null
```

---

## 7. New WhatsApp Templates (Create in Meta Business Manager)

### Template 1: `vendor_approval_request`
- **Purpose**: Sent to vendor's phone when a user wants to add them as vendor
- **Body**: `{{1}} from {{2}} ({{3}}) wants to add you as a vendor. Would you like to accept?`
  - {{1}} = requester name
  - {{2}} = company/org name
  - {{3}} = requester phone number
- **Buttons**: 2 Quick Reply buttons
  - Button 0: "Approve" → payload `approve_vendor_request::{{onboarding_id}}`
  - Button 1: "Reject" → payload `reject_vendor_request::{{onboarding_id}}`

### Template 2: `vendor_added_confirmation`
- **Purpose**: Sent to the original user after vendor approves and is fully onboarded
- **Body**: `{{1}} has accepted your vendor request and is now registered as a vendor in {{2}}.`
  - {{1}} = vendor name
  - {{2}} = org name

### Template 3: `vendor_rejected_notification`
- **Purpose**: Sent to the original user after vendor rejects
- **Body**: `The vendor ({{1}}) has declined your request to join {{2}} as a vendor.`
  - {{1}} = vendor phone number
  - {{2}} = org name

### Template 4: `ticket_assignment`
- **Purpose**: Sent to vendor when a ticket is created for them
- **Body**: `{{1}} from {{2}} has created a ticket for you:\n\nSubject: {{3}}\nDeadline: {{4}}\n\nWould you like to accept this ticket?`
  - {{1}} = creator name
  - {{2}} = org name
  - {{3}} = ticket subject
  - {{4}} = deadline formatted
- **Buttons**: 2 Quick Reply buttons
  - Button 0: "Accept" → payload `ticket_accept_prompt::{{ticket_id}}`
  - Button 1: "Reject" → payload `ticket_reject_prompt::{{ticket_id}}`

### Template 5: `ticket_accepted_notification`
- **Purpose**: Sent to the ticket creator when vendor accepts
- **Body**: `{{1}} has accepted your ticket:\n\nSubject: {{2}}\n\nThe ticket is now active.`
  - {{1}} = vendor name
  - {{2}} = ticket subject

### Template 6: `ticket_rejected_notification`
- **Purpose**: Sent to the ticket creator when vendor rejects
- **Body**: `{{1}} has declined your ticket:\n\nSubject: {{2}}`
  - {{1}} = vendor name
  - {{2}} = ticket subject

---

## 8. New Button Payloads

Add these payload handlers in `app/api/webhook/whatsapp/route.ts`:

| Payload Prefix | Handler |
|---------------|---------|
| `approve_vendor_request::` | Look up vendor_onboarding row → check if vendor phone is in users table → if yes, complete onboarding with that name → if no, create `awaiting_vendor_name` session → send name prompt to vendor |
| `reject_vendor_request::` | Update vendor_onboarding status to rejected → notify original user |
| `ticket_accept_prompt::` | Update ticket status to accepted → notify ticket creator |
| `ticket_reject_prompt::` | Update ticket status to rejected → notify ticket creator |

---

## 9. Design Language & Pattern References

When implementing any UI changes, follow these exact patterns from the existing codebase:

### Sidebar Navigation (`components/layout/sidebar.tsx`)
- Add items to the `pageNav` array or as standalone `<Link>` blocks (like the current "All Tasks" block at line 142-158)
- Icons: Import from `lucide-react`, use `h-5 w-5` for nav, `h-4 w-4` for section headers
- Active state: `bg-gray-900 text-white` / Inactive: `text-gray-600 hover:text-gray-900 hover:bg-gray-50`
- Shape: `rounded-xl px-3 py-2.5 text-sm font-semibold`

### Page Structure
- Route: `app/(dashboard)/[page-name]/page.tsx` — "use client", reads from UserContext, renders a client component
- Client component handles data fetching (via React Query or UserContext), filtering, and rendering

### Cards
- Container: `rounded-2xl border border-gray-100 bg-white p-3 sm:p-4 relative`
- Left accent bar: `absolute left-0 top-3 bottom-3 w-1 rounded-full bg-[color]-500`
- Title: `font-semibold text-sm sm:text-[15px] text-gray-900 line-clamp-2`
- Metadata: `text-xs text-gray-500 flex items-center gap-1`
- Badges: `px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase tracking-wide`

### Modals (`components/tasks/CreateTaskModal.tsx` pattern)
- Overlay: `fixed inset-0 z-[9999] flex items-end justify-center sm:items-center bg-gray-900/40 backdrop-blur-sm`
- Panel: `w-full sm:max-w-md bg-white rounded-t-[2rem] sm:rounded-3xl flex flex-col max-h-[92vh] sm:max-h-[85vh]`
- Mobile drag handle: `sm:hidden w-full flex justify-center py-3` with `w-12 h-1.5 bg-gray-200 rounded-full` pill
- Header: `flex items-center justify-between px-5 sm:px-6 pb-4 border-b border-gray-100`
- Title: `text-xl sm:text-2xl font-extrabold tracking-tight text-gray-900`
- Body: `p-5 sm:p-6 overflow-y-auto flex-1`
- Footer: `p-5 sm:p-6 border-t border-gray-100 bg-white sm:bg-gray-50/50 pb-8 sm:pb-6`
- Labels: `block mb-2 text-xs font-bold text-gray-500 uppercase tracking-wider`
- Inputs: `w-full px-4 py-3.5 sm:py-4 bg-gray-50/50 border border-gray-200 rounded-2xl`
- Primary button: `flex-1 px-4 py-3.5 rounded-2xl bg-gray-900 text-white font-bold`
- Cancel button: `flex-1 px-4 py-3.5 rounded-2xl border border-gray-200 text-gray-600`
- Portal rendering via `createPortal`

### Filter Chips
- Container: `flex gap-2 overflow-x-auto`
- Chip: `px-3.5 py-1.5 rounded-full text-xs font-bold flex items-center gap-1.5 border backdrop-blur-sm transition-all`
- Active: `bg-[category]-100 text-[category]-700 border-[category]-200 shadow-md`
- Inactive: `bg-white/70 text-gray-700 border-white/50 hover:bg-white/90`

### Data Fetching
- Use React Query with `queryKey` arrays for cache management
- Follow `useDashboardData.ts` pattern for parallel fetching
- Use Supabase admin client for API routes, browser client for frontend

### Empty States
- Center-aligned: `text-center py-12`
- Icon: `mx-auto h-12 w-12 text-gray-300`
- Title: `text-sm font-semibold text-gray-900 mt-3`
- Description: `text-sm text-gray-500 mt-1`

### API Routes (`app/api/tasks/route.ts` pattern)
- Validate auth via Supabase session
- Rate limit via `lib/rate-limit.ts`
- Use admin client for DB operations
- Return JSON with appropriate status codes
- Fire-and-forget for audit log + notifications

### WhatsApp Bot Messages
- Emoji prefix for message category (e.g., ✅ success, ❌ error, 📋 info, 👤 user prompt, 🔍 search)
- Bold headers: `*Header Text*`
- Italic notes: `_Note text_`
- Newline separation: `\n\n` between sections
- Keep messages concise — mobile-first reading

### Color Theme for New Entities
- **Vendor**: Use teal/cyan shades (`vendor-50` through `vendor-900`) — add CSS variables to `tailwind.config.ts`
- **Ticket**: Use emerald/green shades (`ticket-50` through `ticket-900`) — distinct from task colors

---

## 10. Acknowledgement Messages

Every action in both webapp and WhatsApp bot must provide clear feedback:

### WhatsApp Bot
- Vendor added (to user): "✅ *Vendor Request Sent!*\n\nA request has been sent to {phone}.\nWaiting for their approval."
- Vendor approved (to user): "✅ *Vendor Added!*\n\n{vendor_name} ({phone}) is now registered as a vendor in {org_name}."
- Vendor rejected (to user): "❌ *Vendor Request Declined*\n\n{phone} has declined your vendor request."
- Vendor approved (to vendor): "✅ *Welcome!*\n\nYou're now registered as a vendor with {org_name}.\nYou'll receive ticket notifications from this organisation."
- Ticket created (to user): "✅ *Ticket Created!*\n\nSubject: {subject}\nVendor: {vendor_name}\nDeadline: {deadline}\n\nWaiting for vendor to accept."
- Ticket accepted (to user): "✅ *Ticket Accepted!*\n\n{vendor_name} has accepted:\nSubject: {subject}"

### Webapp
- Toast notifications for all CRUD operations (success/error)
- Loading states during API calls
- Optimistic updates where appropriate (via React Query mutation callbacks)

---

## 11. Implementation Order (Recommended)

Each feature doc (01–05) can be implemented independently, but this order minimizes dependencies:

1. **Database Schema** (`01-DATABASE-SCHEMA.md`) — Create tables, indexes, RLS policies
2. **Vendor Onboarding** (`02-VENDOR-ONBOARDING.md`) — WhatsApp bot + webhook changes + webapp add-vendor
3. **Webapp Vendors & Tickets Pages** (`03-WEBAPP-VENDORS-TICKETS.md`) — New sidebar items, list pages, CRUD modals
4. **Ticket Creation via WhatsApp** (`04-TICKET-CREATION-WHATSAPP.md`) — New intent, multi-turn flow, vendor notifications
5. **Ticket Reminders** (`05-TICKET-REMINDERS-PLACEHOLDER.md`) — Future: notification scheduling for tickets

---

## 12. Files That Will Be Modified

### Core Files (Modified across multiple features)
| File | Changes |
|------|---------|
| `lib/ai/types.ts` | Add `vendor_add`, `ticket_create` to `WhatsAppIntent` union |
| `lib/ai/whatsapp-capabilities.ts` | Add new entries to `WHATSAPP_ACTIONS` array |
| `lib/ai/system-prompts.ts` | Auto-updated via `getWhatsAppActionsForPrompt()` — no manual changes needed |
| `lib/ai/conversation-context.ts` | Add new `SessionType` values, extend `SessionContextData` |
| `lib/ai/session-reply-handler.ts` | Add handler cases for vendor/ticket sessions |
| `app/api/webhook/whatsapp/route.ts` | Add vendor button payloads, vendor routing layer, contacts message type |
| `app/api/internal/process-message/route.ts` | Add vendor_add and ticket_create handlers, vendor lookup before signup redirect |
| `lib/whatsapp.ts` | Add template wrapper functions for vendor/ticket templates |
| `components/layout/sidebar.tsx` | Add Vendors and Tickets nav items |

### New Files
| File | Purpose |
|------|---------|
| `app/(dashboard)/vendors/page.tsx` | Vendors list page |
| `app/(dashboard)/tickets/page.tsx` | Tickets list page |
| `components/vendors/VendorCard.tsx` | Vendor list item card |
| `components/vendors/AddVendorModal.tsx` | Add vendor modal (phone input) |
| `components/tickets/TicketCard.tsx` | Ticket list item card |
| `components/tickets/CreateTicketModal.tsx` | Create ticket modal |
| `app/api/vendors/route.ts` | Vendor CRUD API |
| `app/api/vendors/[vendorId]/route.ts` | Single vendor operations |
| `app/api/tickets/route.ts` | Ticket CRUD API |
| `app/api/tickets/[ticketId]/route.ts` | Single ticket operations |
| `lib/vendor-service.ts` | Vendor business logic (like task-service.ts) |
| `lib/ticket-service.ts` | Ticket business logic |
| `lib/hooks/useVendors.ts` | React Query hook for vendor data |
| `lib/hooks/useTickets.ts` | React Query hook for ticket data |
