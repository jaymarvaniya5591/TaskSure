# Vendor Onboarding — WhatsApp Bot + Webapp

**Prerequisites**: Read `00-VENDOR-MANAGEMENT-OVERVIEW.md` for full context. Database tables from `01-DATABASE-SCHEMA.md` must exist.

This document covers the complete vendor onboarding flow — adding vendors via WhatsApp bot and webapp, the approval process, name collection, and all webhook/session changes required.

---

## 1. Overview

Vendor onboarding is designed to be extremely seamless:
- User can add a vendor by simply telling the bot or using the webapp
- The only required input is the vendor's phone number (or a shared contact)
- Vendor receives a WhatsApp template asking for consent
- If vendor approves, they're onboarded (with automatic or manual name collection)
- If vendor rejects, the user is notified

---

## 2. WhatsApp Bot Flow

### 2.1 New Intent: `vendor_add`

**Add to `lib/ai/whatsapp-capabilities.ts`** — `WHATSAPP_ACTIONS` array:
```typescript
{
    id: 'vendor_add',
    label: 'Add a vendor',
    description: 'Register a new vendor (supplier, contractor) in the organisation by phone number',
    examples: [
        'Add vendor 9876543210',
        'Register new supplier Ramesh, his number is 98765 43210',
        'Add a new vendor',
        'I want to add a vendor to my organisation',
    ],
},
```

**Add to `lib/ai/types.ts`** — `WhatsAppIntent` union:
```typescript
export type WhatsAppIntent =
    | 'task_create'
    | 'todo_create'
    | 'vendor_add'        // NEW
    | 'ticket_create'     // NEW (for 04-TICKET-CREATION-WHATSAPP.md)
    | 'send_dashboard_link'
    | 'unknown'
```

**Add to `AnalyzedMessage` or handle via extraction**: The AI should also try to extract a phone number from the message. Extend the analysis or do post-processing phone extraction.

### 2.2 Phone Number Extraction

The bot needs to extract phone numbers from:

1. **Text messages**: "Add vendor 9876543210" or "Add vendor 98765 43210" or "Add vendor +91 98765 43210"
2. **Contact/vCard messages**: User shares a contact card via WhatsApp

**Phone extraction utility** (add to a new file `lib/ai/phone-extractor.ts` or inline in handler):
```typescript
function extractPhoneFromText(text: string): string | null {
    // Remove all spaces, dashes, dots from potential phone strings
    const cleaned = text.replace(/[\s\-\.()]/g, '')
    // Match 10-digit Indian number (with optional +91 or 91 prefix)
    const match = cleaned.match(/(?:\+?91)?(\d{10})/)
    return match ? match[1] : null
}
```

**vCard/Contact message handling**: WhatsApp sends contacts as type `contacts` in the webhook payload. Structure:
```json
{
    "type": "contacts",
    "contacts": [{
        "name": { "formatted_name": "Ramesh Kumar", "first_name": "Ramesh", "last_name": "Kumar" },
        "phones": [{ "phone": "+919876543210", "type": "CELL" }]
    }]
}
```

Currently, `app/api/webhook/whatsapp/route.ts` only handles `text`, `button`, and `audio` message types. Add `contacts` handling:
- Extract phone number from `message.contacts[0].phones[0].phone`
- Normalize to 10-digit format
- Also extract name from `message.contacts[0].name.formatted_name` if available
- Route to vendor_add handler if user has an active `awaiting_vendor_phone` session

### 2.3 Complete Flow Diagram

```
User sends: "Add vendor 9876543210"
  │
  ├─ AI classifies as vendor_add
  │  └─ Extract phone from message text
  │
  ├─ IF no phone extracted:
  │  └─ Create session: awaiting_vendor_phone
  │     Send: "📱 *Vendor Phone Number Needed*\n\nPlease send the vendor's phone number.\n\nYou can type the number or share a contact."
  │     └─ User replies with phone or shares contact
  │        └─ Session handler extracts phone, continues below ↓
  │
  ├─ Normalize phone to 10 digits
  │
  ├─ Check: is this phone already a vendor in the user's org?
  │  └─ Query: org_vendors WHERE organisation_id = user.org_id AND phone_number = phone
  │     ├─ IF found (active): Send "ℹ️ *Already Registered*\n\n{name} ({phone}) is already a vendor in your organisation."
  │     ├─ IF found (pending): Send "⏳ *Request Already Pending*\n\nA vendor request is already pending for {phone}."
  │     └─ IF not found: continue ↓
  │
  ├─ Check: is this phone an employee in the user's org?
  │  └─ Query: users WHERE organisation_id = user.org_id AND phone_number = phone
  │     └─ IF found: Send "ℹ️ *Already an Employee*\n\n{name} ({phone}) is already registered as an employee in your organisation."
  │         (Don't block — they might still want to add them as vendor. But inform them.)
  │
  ├─ Create org_vendors row (status: pending)
  ├─ Create vendor_onboarding row (status: pending)
  │
  ├─ Send vendor_approval_request template to vendor's phone
  │  Body: "{user_name} from {org_name} ({user_phone}) wants to add you as a vendor."
  │  Buttons: [Approve] [Reject]
  │  Payloads: approve_vendor_request::{onboarding_id}, reject_vendor_request::{onboarding_id}
  │
  └─ Send confirmation to user:
     "✅ *Vendor Request Sent!*\n\nA request has been sent to {phone}.\nWaiting for their approval."
```

### 2.4 Vendor Approval Flow (Button Payloads)

Add these handlers in `app/api/webhook/whatsapp/route.ts`, in the button payload handling section (before the user lookup):

#### `approve_vendor_request::{onboarding_id}`

```
Vendor clicks "Approve" button
  │
  ├─ Look up vendor_onboarding row by ID
  │  └─ IF not found or already resolved: Send "This request has already been processed."
  │
  ├─ Check if vendor phone exists in users table (any org)
  │  └─ Query: users WHERE phone_number = vendor_phone LIMIT 1
  │
  ├─ IF user found:
  │  ├─ Set vendor_name = user.name
  │  ├─ Update org_vendors: status = 'active', name = user.name, first_name, last_name, user_id = user.id
  │  ├─ Update vendor_onboarding: status = 'approved', vendor_name = user.name, resolved_at = now()
  │  ├─ Send to vendor: "✅ *Welcome!*\n\nYou're now registered as a vendor with {org_name}.\nYou'll receive ticket notifications from this organisation."
  │  └─ Send to original user (requested_by): "✅ *Vendor Added!*\n\n{vendor_name} ({phone}) is now registered as a vendor in {org_name}."
  │
  └─ IF user NOT found:
     ├─ Create session: awaiting_vendor_name (for vendor's phone)
     │  context_data: { onboarding_id, organisation_id, vendor_phone }
     ├─ Send to vendor: "👋 *Almost there!*\n\nSince you're new to Boldo AI, please send your name in this format:\n\n*FirstName LastName*\n\n_Example: Ramesh Kumar_"
     └─ (Do NOT notify original user yet — wait for name collection)
```

#### `reject_vendor_request::{onboarding_id}`

```
Vendor clicks "Reject" button
  │
  ├─ Look up vendor_onboarding row by ID
  │  └─ IF not found or already resolved: Send "This request has already been processed."
  │
  ├─ Update vendor_onboarding: status = 'rejected', resolved_at = now()
  ├─ Update org_vendors: status = 'inactive'
  │
  ├─ Send to vendor: "Got it. You've declined the vendor request."
  └─ Send to original user: "❌ *Vendor Request Declined*\n\nThe vendor ({phone}) has declined your request to join {org_name} as a vendor."
```

### 2.5 Name Collection Session Handler

Add to `lib/ai/session-reply-handler.ts` — new case for `awaiting_vendor_name`:

```
Vendor sends message while awaiting_vendor_name session is active
  │
  ├─ Validate format: expect "FirstName LastName" (at least 2 words, each 2+ chars)
  │  └─ IF invalid format:
  │     Send: "Please send your name in *FirstName LastName* format.\n\n_Example: Ramesh Kumar_"
  │     Keep session alive (don't resolve)
  │     return
  │
  ├─ Parse: first_name = words[0], last_name = words.slice(1).join(' ')
  ├─ full_name = first_name + ' ' + last_name
  │
  ├─ Update org_vendors: status = 'active', name = full_name, first_name, last_name
  ├─ Update vendor_onboarding: status = 'approved', vendor_name = full_name, resolved_at = now()
  ├─ Resolve session
  │
  ├─ Send to vendor: "✅ *Welcome, {first_name}!*\n\nYou're now registered as a vendor with {org_name}.\nYou'll receive ticket notifications from this organisation."
  └─ Send to original user (requested_by from onboarding row): "✅ *Vendor Added!*\n\n{full_name} ({phone}) is now registered as a vendor in {org_name}."
```

**IMPORTANT**: This session handler must be checked BEFORE the "unknown user → signup link" redirect. The vendor does NOT have a user account — the session lookup must work with phone numbers directly, not user IDs.

### 2.6 Phone Number Session Handler

Add to `lib/ai/session-reply-handler.ts` — new case for `awaiting_vendor_phone`:

```
User sends message while awaiting_vendor_phone session is active
  │
  ├─ Check if message is a contacts-type message
  │  └─ IF contacts: extract phone from contact
  │  └─ IF text: try extractPhoneFromText()
  │
  ├─ IF no phone extracted:
  │  Send: "I couldn't find a phone number in your message.\n\nPlease send the vendor's 10-digit phone number or share a contact."
  │  Keep session alive
  │  return
  │
  ├─ Resolve session
  └─ Continue with the vendor_add flow (duplicate check → onboarding → template)
     Use session context_data for sender_id, sender_name, organisation_id
```

---

## 3. Webapp Flow

### 3.1 Add Vendor Modal

The webapp should have an "Add Vendor" button on the vendors page that opens a modal with:
- Phone number input (10-digit, validated)
- Submit button

On submit:
1. Call `POST /api/vendors` with `{ phone_number }`
2. Backend performs same checks as WhatsApp flow:
   - Already a vendor in org? → return error
   - Already an employee? → return warning (but allow)
3. Backend creates `org_vendors` (pending) + `vendor_onboarding` (pending) rows
4. Backend sends `vendor_approval_request` template to vendor's phone
5. Return success to frontend
6. Frontend shows toast: "Vendor request sent to {phone}. Waiting for approval."

### 3.2 API Route: `POST /api/vendors`

```typescript
// app/api/vendors/route.ts

export async function POST(request: Request) {
    // 1. Validate auth (Supabase session)
    // 2. Rate limit (10 vendor adds per 60 seconds per user)
    // 3. Extract phone_number from body
    // 4. Normalize to 10 digits
    // 5. Check for existing vendor in org
    // 6. Check for existing employee in org (warn but allow)
    // 7. Create org_vendors row (status: pending)
    // 8. Create vendor_onboarding row (status: pending)
    // 9. Send vendor_approval_request template (fire-and-forget)
    // 10. Audit log: vendor.invited
    // 11. Return { success: true, vendor_id, message }
}

export async function GET(request: Request) {
    // 1. Validate auth
    // 2. Get user's org_id
    // 3. Query org_vendors WHERE organisation_id = org_id AND status IN ('active', 'pending')
    // 4. Return vendors array
}
```

### 3.3 API Route: `PATCH/DELETE /api/vendors/[vendorId]`

```typescript
// app/api/vendors/[vendorId]/route.ts

export async function PATCH(request: Request) {
    // Edit vendor: update name, status
    // Only org members can edit
    // Validate vendor belongs to user's org
}

export async function DELETE(request: Request) {
    // Soft delete: set status = 'inactive'
    // Only org members can delete
    // Validate vendor belongs to user's org
    // Check for active tickets — warn user if any exist
}
```

---

## 4. Webhook Changes

### 4.1 Contact Message Type Support

In `app/api/webhook/whatsapp/route.ts`, add handling for `contacts` message type:

```typescript
// In the message type extraction section, add:
const messageType = message.type  // 'text' | 'audio' | 'button' | 'contacts' | ...

if (messageType === 'contacts' && message.contacts?.[0]) {
    const contact = message.contacts[0]
    const contactPhone = contact.phones?.[0]?.phone
    const contactName = contact.name?.formatted_name

    // Check if sender has an active awaiting_vendor_phone session
    const session = await getActiveSession(senderPhone)
    if (session?.session_type === 'awaiting_vendor_phone') {
        // Extract and normalize phone from contact
        // Route to session handler with extracted phone + optional name
        return
    }

    // If no relevant session, treat as normal message
    // (Could be user sharing a contact for other reasons)
}
```

### 4.2 Vendor Routing Layer

Add the vendor routing layer in the webhook POST handler. This must be placed AFTER button payload handling but BEFORE the "unknown phone → signup" block:

```typescript
// EXISTING: Button payload handling (unchanged)
// ...

// EXISTING: Fast-path keywords (signin, login, list) (unchanged)
// ...

// NEW: Vendor routing — BEFORE signup link redirect
const vendorSession = await getActiveSession(senderPhone)
if (vendorSession && isVendorSessionType(vendorSession.session_type)) {
    // Handle vendor session reply (name collection, etc.)
    await handleVendorSessionReply(vendorSession, messageText, senderPhone)
    return NextResponse.json({ status: 'ok' })
}

const vendorRecords = await getCachedVendor(senderPhone)
if (vendorRecords && vendorRecords.length > 0 && !user) {
    // Known vendor, not a user — send limited response
    const orgNames = vendorRecords.map(v => v.organisation_name).join(', ')
    await sendWhatsAppMessage(
        senderPhoneIntl,
        `You're registered as a vendor with ${orgNames}.\n\nIf you need assistance, please contact your organisation directly.\n\n_Want to create your own Boldo AI account? Type "signup" to get started._`
    )
    return NextResponse.json({ status: 'ok' })
}

// EXISTING: Unknown phone → signup link (unchanged)
```

### 4.3 Helper Function

```typescript
function isVendorSessionType(type: string): boolean {
    return type === 'awaiting_vendor_name' || type === 'awaiting_vendor_phone'
}
```

---

## 5. Files to Modify

| File | What to Change |
|------|---------------|
| `lib/ai/whatsapp-capabilities.ts` | Add `vendor_add` to `WHATSAPP_ACTIONS` array |
| `lib/ai/types.ts` | Add `vendor_add` to `WhatsAppIntent` union |
| `lib/ai/conversation-context.ts` | Add `awaiting_vendor_phone` and `awaiting_vendor_name` to `SessionType` union. Add `vendor_phone`, `vendor_name`, `onboarding_id` to `SessionContextData` |
| `lib/ai/session-reply-handler.ts` | Add handler cases for `awaiting_vendor_phone` and `awaiting_vendor_name` |
| `app/api/webhook/whatsapp/route.ts` | Add `approve_vendor_request::` and `reject_vendor_request::` button payload handlers. Add `contacts` message type handling. Add vendor routing layer before signup redirect |
| `app/api/internal/process-message/route.ts` | Add `vendor_add` case in intent dispatch switch. Implement `handleVendorAdd()` function |
| `lib/whatsapp.ts` | Add `sendVendorApprovalTemplate()`, `sendVendorAddedConfirmation()`, `sendVendorRejectedNotification()` wrapper functions |
| `lib/ai/conversation-context.ts` | Add `buildIntentChangeAcknowledgment` case for vendor session types |

### New Files to Create

| File | Purpose |
|------|---------|
| `app/api/vendors/route.ts` | GET (list) + POST (add vendor) API route |
| `app/api/vendors/[vendorId]/route.ts` | PATCH (edit) + DELETE (soft delete) API route |
| `lib/vendor-service.ts` | Vendor business logic: validation, lookup, onboarding orchestration |

---

## 6. Edge Cases

1. **Vendor's phone has country code**: Normalize all phone numbers to 10-digit Indian format. Strip +91, 91, 0 prefixes.

2. **Vendor clicks approve/reject multiple times**: Check `vendor_onboarding.status` — if already resolved, send "This request has already been processed."

3. **Vendor sends name in wrong format**: Keep session alive, re-prompt. Allow 3 retries, then auto-resolve with raw text as name (best effort).

4. **User tries to add themselves as vendor**: Check if phone matches sender's phone → reject with "You can't add yourself as a vendor."

5. **Onboarding request expires**: vendor_onboarding rows with status 'pending' older than 7 days could be auto-expired by a future cron job. For now, they remain pending indefinitely.

6. **Multiple orgs invite same vendor**: Each org gets its own `org_vendors` row. Vendor gets separate approval templates for each. The `vendor_onboarding.id` in the button payload ensures the correct request is resolved.

7. **Vendor sends "signup" or "signin"**: Even though they're a known vendor, if they type these keywords, send the normal signup/signin flow. They might want to create a full account.

8. **Contact card with multiple phone numbers**: Use the first phone number in the contacts array. If it doesn't look like a valid Indian mobile number, try subsequent numbers.
