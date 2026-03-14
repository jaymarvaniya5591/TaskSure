# Ticket Creation via WhatsApp Bot

**Prerequisites**: Read `00-VENDOR-MANAGEMENT-OVERVIEW.md` for full context. Database tables from `01-DATABASE-SCHEMA.md` and vendor onboarding from `02-VENDOR-ONBOARDING.md` must be implemented (vendors must exist before tickets can be created).

This document covers creating tickets via the WhatsApp bot, including the new `ticket_create` intent, multi-turn conversation flow for collecting missing fields, and vendor notification with accept/reject.

---

## 1. New Intent: `ticket_create`

### 1.1 Add to Capabilities

**File: `lib/ai/whatsapp-capabilities.ts`** — add to `WHATSAPP_ACTIONS` array:

```typescript
{
    id: 'ticket_create',
    label: 'Create a ticket',
    description: 'Create a tracking ticket for a vendor (shipment, payment, invoice follow-up)',
    examples: [
        'Create ticket for Ramesh - invoice pending by Friday',
        'Track shipment from Kumar Supplies, deadline next week',
        'New ticket: payment follow-up with Sharma ji by March 20th',
        'Create a ticket for vendor Priya about the delayed order',
    ],
},
```

### 1.2 Add to Type Definitions

**File: `lib/ai/types.ts`**:

Add to `WhatsAppIntent` union (if not already added in vendor onboarding step):
```typescript
export type WhatsAppIntent =
    | 'task_create'
    | 'todo_create'
    | 'vendor_add'
    | 'ticket_create'     // NEW
    | 'send_dashboard_link'
    | 'unknown'
```

The existing `AnalyzedMessage` interface already extracts WHO (vendor name), WHAT (subject), and WHEN (deadline) — these map directly to ticket_create parameters. No new interface needed for the AI output, but the handler must interpret them as:
- `who.name` → vendor name (fuzzy match against org_vendors)
- `what` → ticket subject
- `when.date` → ticket deadline

### 1.3 System Prompt Considerations

The `getWhatsAppActionsForPrompt()` in `lib/ai/system-prompts.ts` auto-includes the new capability. However, the unified analysis prompt in `system-prompts.ts` may need a note to help Gemini distinguish between:
- `task_create` (assign work to an employee): "Tell Ramesh to send the invoice"
- `ticket_create` (track a vendor obligation): "Create ticket for Ramesh about the invoice"

**Add to the intent disambiguation rules** in the system prompt:
```
INTENT DISAMBIGUATION — task_create vs ticket_create:
- task_create: User is assigning WORK to someone in their team. Keywords: "tell", "ask", "assign", "do"
- ticket_create: User is TRACKING a vendor obligation. Keywords: "ticket", "track", "follow up", "shipment", "payment", "invoice"
- If the message explicitly says "ticket" or "track", always classify as ticket_create
- If the message mentions vendor-related terms (shipment, delivery, payment, invoice) AND a person, prefer ticket_create
- If ambiguous, classify as task_create (more common action)
```

---

## 2. Three Required Parameters

A ticket needs three fields before it can be created:

| Parameter | Source | Session if Missing |
|-----------|--------|--------------------|
| **Vendor** | `who.name` from AI analysis — fuzzy matched against `org_vendors` | `awaiting_ticket_vendor` |
| **Subject** | `what` from AI analysis | `awaiting_ticket_subject` |
| **Deadline** | `when.date` from AI analysis | `awaiting_ticket_deadline` |

---

## 3. Complete Flow Diagram

```
User sends: "Create ticket for Ramesh about invoice pending by Friday"
  │
  ├─ AI classifies as ticket_create
  │  Extracts: who.name="Ramesh", what="invoice pending", when.date="2026-03-20T20:00:00+05:30"
  │
  ├─ STEP 1: Resolve vendor
  │  ├─ Fuzzy match "Ramesh" against org_vendors (active only)
  │  │  Use phonetic matching from lib/ai/phonetic-match.ts
  │  │  (same fuzzy matching used for employee names, adapted for vendors)
  │  │
  │  ├─ IF no matches:
  │  │  Create session: awaiting_ticket_vendor
  │  │  context_data: { what: "invoice pending", when_date: "...", sender_id, organisation_id }
  │  │  Send: "🔍 *Vendor Not Found*\n\nI couldn't find a vendor named 'Ramesh' in your organisation.\n\nPlease send the vendor's name or phone number.\n\n_To add a new vendor, say 'add vendor'._"
  │  │
  │  ├─ IF multiple matches:
  │  │  Create session: awaiting_ticket_vendor
  │  │  context_data: { candidates: [...], what, when_date, sender_id, organisation_id }
  │  │  Send: "👥 *Multiple Vendors Found*\n\nWhich vendor did you mean?\n\n1️⃣ Ramesh Kumar (9876543210)\n2️⃣ Ramesh Patel (9123456789)\n\n_Reply with the number or name._"
  │  │
  │  └─ IF single match: vendor_id = match.id → continue
  │
  ├─ STEP 2: Check subject
  │  ├─ IF what is empty or < 3 chars:
  │  │  Create session: awaiting_ticket_subject
  │  │  context_data: { vendor_id, when_date, sender_id, organisation_id }
  │  │  Send: "📋 *Ticket Subject Needed*\n\nWhat is this ticket about?\n\n_Example: 'Invoice #1234 follow-up' or 'Shipment tracking for Order 567'_"
  │  │
  │  └─ IF valid: subject = what → continue
  │
  ├─ STEP 3: Check deadline
  │  ├─ IF when.date is null:
  │  │  Create session: awaiting_ticket_deadline
  │  │  context_data: { vendor_id, ticket_subject: subject, sender_id, organisation_id }
  │  │  Send: "📅 *Deadline Needed*\n\nWhen should this ticket be resolved?\n\n_Example: 'by Friday', 'March 25th', 'in 3 days'_"
  │  │
  │  ├─ IF deadline is in the past:
  │  │  Create session: awaiting_ticket_deadline (same as above)
  │  │  Send: "⚠️ That deadline is in the past.\n\nPlease provide a future date.\n\n_Example: 'by Friday', 'next week'_"
  │  │
  │  └─ IF valid: deadline = when.date → continue
  │
  ├─ STEP 4: Create ticket
  │  Insert into tickets: { organisation_id, vendor_id, subject, deadline, status: 'pending', created_by: sender.id, source: 'whatsapp' }
  │
  ├─ STEP 5: Notify vendor
  │  Send ticket_assignment template to vendor's phone:
  │  Body: "{sender_name} from {org_name} has created a ticket: Subject: {subject}, Deadline: {deadline}"
  │  Buttons: [Accept] [Reject]
  │  Payloads: ticket_accept_prompt::{ticket_id}, ticket_reject_prompt::{ticket_id}
  │
  └─ STEP 6: Confirm to user
     Send: "✅ *Ticket Created!*\n\nSubject: _{subject}_\nVendor: {vendor_name}\nDeadline: {formatted_deadline}\n\nWaiting for vendor to accept."
```

---

## 4. Session Handlers

Add these cases to `lib/ai/session-reply-handler.ts`:

### 4.1 `awaiting_ticket_vendor`

```
User replies while awaiting_ticket_vendor session is active
  │
  ├─ IF candidates exist in context (disambiguation):
  │  ├─ Try parse as number (1, 2, 3...) → select from candidates
  │  ├─ Try match as name substring from candidates
  │  ├─ Try match as phone number
  │  └─ IF no match: "Please reply with a number (1, 2, 3...) or the vendor's name."
  │     Keep session alive
  │
  ├─ IF no candidates (vendor not found):
  │  ├─ Try fuzzy match reply against all org vendors
  │  ├─ Try match as 10-digit phone number against org vendors
  │  ├─ IF match found: vendor_id = match.id
  │  │  └─ Check for remaining missing fields (subject, deadline)
  │  │     └─ If all present → create ticket
  │  │     └─ If missing → create next session (awaiting_ticket_subject or awaiting_ticket_deadline)
  │  └─ IF no match: "I couldn't find that vendor.\n\nPlease try again with the vendor's name or phone number.\n\n_To add a new vendor, say 'add vendor'._"
  │     Keep session alive
```

### 4.2 `awaiting_ticket_subject`

```
User replies while awaiting_ticket_subject session is active
  │
  ├─ Validate: reply.length >= 3 and reply.length <= 200
  │  └─ IF too short: "Please provide a more descriptive subject (at least 3 characters)."
  │     Keep session alive
  │
  ├─ subject = reply text
  ├─ Check if deadline exists in context
  │  ├─ IF deadline exists → create ticket (all 3 params ready)
  │  └─ IF deadline missing → create session: awaiting_ticket_deadline
  │     Send: "📅 *Deadline Needed*\n\nWhen should this ticket be resolved?"
```

### 4.3 `awaiting_ticket_deadline`

```
User replies while awaiting_ticket_deadline session is active
  │
  ├─ Check if reply looks like a deadline (use isDeadlineResponse() from existing code)
  ├─ Parse date via parseDateFromText() (existing utility)
  │  └─ IF can't parse: "I couldn't understand that date.\n\nPlease try again.\n\n_Example: 'by Friday', 'March 25th', 'in 3 days'_"
  │     Keep session alive
  │
  ├─ Validate: deadline must be in the future
  │  └─ IF past: "⚠️ That deadline is in the past. Please provide a future date."
  │     Keep session alive
  │
  ├─ All 3 params ready (vendor_id, subject, deadline from context)
  └─ Create ticket → notify vendor → confirm to user
```

---

## 5. Vendor Accept/Reject (Button Payloads)

Add these handlers in `app/api/webhook/whatsapp/route.ts`, alongside the vendor onboarding button handlers:

### 5.1 `ticket_accept_prompt::{ticket_id}`

```
Vendor clicks "Accept" on ticket notification
  │
  ├─ Look up ticket by ID
  │  └─ IF not found or status !== 'pending': Send "This ticket has already been processed."
  │
  ├─ Update ticket: status = 'accepted'
  │
  ├─ Send to vendor: "✅ You've accepted the ticket:\n\nSubject: _{subject}_\n\nThe ticket creator has been notified."
  │
  └─ Send ticket_accepted_notification template to ticket creator:
     "{vendor_name} has accepted your ticket: Subject: {subject}"
```

### 5.2 `ticket_reject_prompt::{ticket_id}`

```
Vendor clicks "Reject" on ticket notification
  │
  ├─ Look up ticket by ID
  │  └─ IF not found or status !== 'pending': Send "This ticket has already been processed."
  │
  ├─ Update ticket: status = 'rejected'
  │
  ├─ Send to vendor: "Got it. You've declined the ticket."
  │
  └─ Send ticket_rejected_notification template to ticket creator:
     "{vendor_name} has declined your ticket: Subject: {subject}"
```

---

## 6. Intent Handler Implementation

Add to `app/api/internal/process-message/route.ts`:

```typescript
case 'ticket_create':
    await handleTicketCreate(supabase, messageId, phone, sender, analysis)
    break
```

### `handleTicketCreate()` Function Outline

```typescript
async function handleTicketCreate(
    supabase: SupabaseAdmin,
    messageId: string,
    phone: string,
    sender: SenderUser,
    analysis: AnalyzedMessage,
): Promise<void> {
    const phoneIntl = `91${phone}`

    // 1. Resolve vendor from who.name
    let vendorId: string | null = null
    let vendorName: string | null = null
    let vendorPhone: string | null = null

    if (analysis.who.name) {
        // Fuzzy match against org vendors
        const { data: vendors } = await supabase
            .from('org_vendors')
            .select('id, name, phone_number')
            .eq('organisation_id', sender.organisation_id)
            .eq('status', 'active')

        if (vendors && vendors.length > 0) {
            // Use phonetic matching (same as employee matching)
            const matches = fuzzyMatchVendor(analysis.who.name, vendors)

            if (matches.length === 0) {
                // No match — ask for vendor
                await createSession(phone, 'awaiting_ticket_vendor', {
                    original_intent: 'ticket_create',
                    what: analysis.what,
                    when_date: analysis.when.date,
                    sender_id: sender.id,
                    sender_name: sender.name,
                    organisation_id: sender.organisation_id,
                })
                await sendWhatsAppMessage(phoneIntl, vendorNotFoundMessage(analysis.who.name))
                await markProcessed(supabase, messageId, 'ticket_create', null)
                return
            }

            if (matches.length > 1) {
                // Multiple matches — disambiguate
                await createSession(phone, 'awaiting_ticket_vendor', {
                    original_intent: 'ticket_create',
                    candidates: matches.map(m => ({ id: m.id, name: m.name, phone_number: m.phone_number })),
                    what: analysis.what,
                    when_date: analysis.when.date,
                    sender_id: sender.id,
                    sender_name: sender.name,
                    organisation_id: sender.organisation_id,
                })
                await sendWhatsAppMessage(phoneIntl, vendorDisambiguationMessage(matches))
                await markProcessed(supabase, messageId, 'ticket_create', null)
                return
            }

            // Single match
            vendorId = matches[0].id
            vendorName = matches[0].name
            vendorPhone = matches[0].phone_number
        } else {
            // No vendors in org at all
            await sendWhatsAppMessage(phoneIntl,
                "❌ *No Vendors Found*\n\nYou don't have any vendors registered in your organisation yet.\n\nSay *'add vendor'* to register a vendor first."
            )
            await markProcessed(supabase, messageId, 'ticket_create', null)
            return
        }
    } else {
        // No vendor name mentioned — ask for it
        await createSession(phone, 'awaiting_ticket_vendor', {
            original_intent: 'ticket_create',
            what: analysis.what,
            when_date: analysis.when.date,
            sender_id: sender.id,
            sender_name: sender.name,
            organisation_id: sender.organisation_id,
        })
        await sendWhatsAppMessage(phoneIntl,
            "👤 *Which Vendor?*\n\nPlease send the vendor's name or phone number for this ticket."
        )
        await markProcessed(supabase, messageId, 'ticket_create', null)
        return
    }

    // 2. Check subject
    const subject = analysis.what
    if (!subject || subject.length < 3) {
        await createSession(phone, 'awaiting_ticket_subject', {
            original_intent: 'ticket_create',
            vendor_id: vendorId,
            when_date: analysis.when.date,
            sender_id: sender.id,
            sender_name: sender.name,
            organisation_id: sender.organisation_id,
        })
        await sendWhatsAppMessage(phoneIntl,
            "📋 *Ticket Subject Needed*\n\nWhat is this ticket about?\n\n_Example: 'Invoice #1234 follow-up' or 'Shipment tracking for Order 567'_"
        )
        await markProcessed(supabase, messageId, 'ticket_create', null)
        return
    }

    // 3. Check deadline
    const deadline = analysis.when.date
    if (!deadline) {
        await createSession(phone, 'awaiting_ticket_deadline', {
            original_intent: 'ticket_create',
            vendor_id: vendorId,
            ticket_subject: subject,
            sender_id: sender.id,
            sender_name: sender.name,
            organisation_id: sender.organisation_id,
        })
        await sendWhatsAppMessage(phoneIntl,
            "📅 *Deadline Needed*\n\nWhen should this ticket be resolved?\n\n_Example: 'by Friday', 'March 25th', 'in 3 days'_"
        )
        await markProcessed(supabase, messageId, 'ticket_create', null)
        return
    }

    // 4. All params present — create ticket
    await createTicketAndNotify(supabase, {
        organisationId: sender.organisation_id,
        vendorId,
        vendorPhone,
        vendorName,
        subject,
        deadline,
        createdBy: sender.id,
        senderName: sender.name,
        senderPhone: phone,
        source: 'whatsapp',
    })

    await markProcessed(supabase, messageId, 'ticket_create', null)
}
```

### `createTicketAndNotify()` Shared Function

This function is shared between the intent handler and session handlers — it does the final ticket creation + notifications:

```typescript
async function createTicketAndNotify(supabase, params) {
    const { organisationId, vendorId, vendorPhone, vendorName, subject, deadline, createdBy, senderName, senderPhone, source } = params

    // Insert ticket
    const { data: ticket, error } = await supabase
        .from('tickets')
        .insert({
            organisation_id: organisationId,
            vendor_id: vendorId,
            subject,
            deadline,
            status: 'pending',
            created_by: createdBy,
            source,
        })
        .select('id')
        .single()

    if (error) {
        await sendWhatsAppMessage(`91${senderPhone}`, "❌ *Error*\n\nFailed to create ticket. Please try again.")
        return
    }

    // Notify vendor (fire-and-forget)
    if (vendorPhone) {
        sendTicketAssignmentTemplate(
            `91${vendorPhone}`,
            senderName,
            orgName,
            subject,
            formatDeadline(deadline),
            ticket.id
        ).catch(err => console.error('[TicketCreate] Vendor notification error:', err))
    }

    // Confirm to user
    const confirmMsg = `✅ *Ticket Created!*\n\nSubject: _${subject}_\nVendor: ${vendorName || vendorPhone}\nDeadline: ${formatDeadline(deadline)}\n\nWaiting for vendor to accept.`
    await sendWhatsAppMessage(`91${senderPhone}`, confirmMsg)

    // Audit log (fire-and-forget)
    supabase.from('audit_log').insert({
        organisation_id: organisationId,
        user_id: createdBy,
        action: 'ticket.created',
        metadata: { ticket_id: ticket.id, vendor_id: vendorId, subject, source },
    }).then(() => {}).catch(() => {})
}
```

---

## 7. Vendor Fuzzy Matching

Adapt the existing `findMatchingUsers()` from `lib/ai/phonetic-match.ts` to work with vendors:

```typescript
// New function or adapter:
async function fuzzyMatchVendor(
    nameQuery: string,
    vendors: Array<{ id: string; name: string | null; phone_number: string }>
): Array<{ id: string; name: string; phone_number: string; score: number }> {
    // Filter out vendors with no name
    const namedVendors = vendors.filter(v => v.name)

    // Use same phonetic matching logic as employee matching
    // 1. Exact substring match on name (ilike)
    // 2. Phonetic similarity (threshold 0.6 — slightly lower than employee matching since vendor names may be less familiar)

    // Also support matching by phone number
    const phoneMatch = vendors.find(v => v.phone_number === nameQuery.replace(/\D/g, '').slice(-10))
    if (phoneMatch) {
        return [{ ...phoneMatch, name: phoneMatch.name || phoneMatch.phone_number, score: 1.0 }]
    }

    // Phonetic matching on name
    return phoneticMatch(nameQuery, namedVendors)
}
```

---

## 8. Files to Modify

| File | What to Change |
|------|---------------|
| `lib/ai/whatsapp-capabilities.ts` | Add `ticket_create` to `WHATSAPP_ACTIONS` |
| `lib/ai/types.ts` | Add `ticket_create` to `WhatsAppIntent` (if not already) |
| `lib/ai/system-prompts.ts` | Add task_create vs ticket_create disambiguation rules to the unified prompt |
| `lib/ai/conversation-context.ts` | Add `awaiting_ticket_vendor`, `awaiting_ticket_subject`, `awaiting_ticket_deadline` to `SessionType`. Add `vendor_id`, `ticket_subject`, `ticket_deadline` to `SessionContextData` |
| `lib/ai/session-reply-handler.ts` | Add handler cases for ticket sessions |
| `app/api/internal/process-message/route.ts` | Add `ticket_create` case + `handleTicketCreate()` function |
| `app/api/webhook/whatsapp/route.ts` | Add `ticket_accept_prompt::` and `ticket_reject_prompt::` button payload handlers |
| `lib/whatsapp.ts` | Add `sendTicketAssignmentTemplate()`, `sendTicketAcceptedNotification()`, `sendTicketRejectedNotification()` wrappers |
| `lib/ai/conversation-context.ts` | Add `buildIntentChangeAcknowledgment` cases for ticket session types |

---

## 9. Edge Cases

1. **Vendor not active**: If vendor exists but status is 'pending' or 'inactive', inform user: "This vendor hasn't been onboarded yet. Please wait for them to accept the vendor request."

2. **Self-referencing**: User mentions their own name → "You can't create a ticket for yourself. Tickets are for tracking vendor obligations."

3. **Duplicate ticket**: No dedup needed — users can create multiple tickets for the same vendor with different subjects. This is intentional.

4. **Vendor rejects ticket but user creates another**: Allowed. Each ticket is independent.

5. **Session interruption**: If user starts a ticket flow but then sends "create task for Ramesh..." — the session handler should detect the intent change, send acknowledgment (using `buildIntentChangeAcknowledgment`), resolve the session, and process the new message through the normal AI pipeline.

6. **Very long subject**: Truncate to 200 chars in the handler. Inform user if truncated.

7. **Audio messages during ticket flow**: Audio messages during an active session (awaiting_ticket_subject, etc.) should be transcribed first, then the transcription is used as the session reply.
