# Ticket Notification & Reminder System

**Prerequisites**: Read `00-VENDOR-MANAGEMENT-OVERVIEW.md` for full context. Database tables from `01-DATABASE-SCHEMA.md`, vendor onboarding from `02-VENDOR-ONBOARDING.md`, and ticket creation from `04-TICKET-CREATION-WHATSAPP.md` must be implemented.

This document specifies the complete ticket notification system — from acceptance followups through deadline-crossed negotiations. Unlike the task notification system (which uses one-way calls), the ticket system introduces **interactive IVR calls** where the bot asks questions, records vendor speech responses, transcribes and analyzes them via AI, and relays structured information back to the ticket owner.

---

## Design Philosophy

**Think like a human coordinator.** When a business owner assigns a vendor to deliver goods or make a payment, a good coordinator would:
1. Confirm the vendor received the request
2. Check in periodically to ensure things are on track
3. On the day of deadline, proactively verify delivery status
4. If deadline passes, immediately follow up for reason + new commitment

The system replicates this behavior automatically. Calls are preferred over WhatsApp for vendors because:
- Vendors are external parties who may not check WhatsApp frequently
- Voice calls demand immediate attention — harder to ignore
- Interactive calls allow real-time information exchange
- For Indian SMB context, phone calls carry more weight than texts

---

## Overview: Four Stages

| Stage | Timing | Call Type | WhatsApp | Owner Notified |
|-------|--------|-----------|----------|----------------|
| **1. Acceptance** | +10min, +1hr, +3hr after creation | One-way (play message) | Template with Accept/Reject | After each call attempt |
| **2. Daily Reminders** | 9 AM daily (acceptance → deadline-1 day) | One-way (play message) | None | After each morning's attempts |
| **3. Deadline Day** | 1 hour before deadline | Interactive (ask + record) | Template with Edit Deadline | With vendor's response |
| **4. Deadline Crossed** | Immediately after deadline passes | Interactive (negotiate) | Template with status | With reason + new deadline |

---

## Stage 1: Ticket Acceptance Followups

### When Triggered
- Ticket created (status = 'pending'), vendor has not yet accepted or rejected

### Timing
3 followup attempts with escalating urgency, plus a final owner notification:

| Followup | Time | Vendor Action | Owner Action |
|----------|------|--------------|--------------|
| F1 | +10 min | Call + WhatsApp template | Status update (call result) |
| F2 | +1 hr (from F1 adjusted) | Call + WhatsApp template | Status update (call result) |
| F3 | +3 hr (from F2 adjusted) | Call + WhatsApp template | Status update (call result) |
| F4 | +30 min after F3 | — | "Vendor not responding, please contact directly" |

### Business Hours
- All calls adjusted to 9 AM–9 PM IST, skip Sundays
- Gaps chain from adjusted times (same pattern as `scheduleAcceptanceFollowups` in `task-notification-scheduler.ts`)

### Call Script (One-Way, Hindi)
```
नमस्ते! आपके लिए एक नया टिकट बनाया गया है, {owner_name} ने, {org_name} से।
विषय है: {subject}।
डेडलाइन: {deadline_formatted}।
कृपया WhatsApp पर इसे स्वीकार या अस्वीकार करें।
```

English fallback:
```
Hello! A new ticket has been created for you by {owner_name} from {org_name}.
Subject: {subject}.
Deadline: {deadline_formatted}.
Please accept or reject it on WhatsApp.
```

### WhatsApp Template: `ticket_acceptance_followup`
Sent alongside each call:
- Body: "This is a followup on the ticket created {time_ago} ago. Please accept or reject by clicking below."
- Followed by the `ticket_assignment` template (Accept/Reject buttons)

### Owner Status Updates
After each call attempt, send owner a WhatsApp text:
```
📞 *Ticket Acceptance Followup #{n}*

*Ticket:*
"{subject}"

*Call to:*
{vendor_name || vendor_phone}

*Call Status:*
{✅ Connected (42s) | ❌ Not connected | ⚠️ Error}

_Ticket acceptance has been re-sent via WhatsApp._
```

### Final Owner Notification (F4)
If vendor hasn't accepted after all 3 call attempts:
```
⚠️ *Vendor Not Responding*

*Ticket:*
"{subject}"

*Vendor:*
{vendor_name || vendor_phone}

3 call attempts and WhatsApp messages have been sent over the past few hours.
The vendor has not accepted or rejected.

_Please contact the vendor directly or cancel the ticket._
```

### Cancellation
- On vendor accept: cancel all pending acceptance followups
- On vendor reject: cancel all pending acceptance followups
- On ticket cancelled/deleted: cancel all pending notifications

---

## Stage 2: Daily Reminder Calls (Acceptance → Deadline Day)

### When Triggered
- Ticket accepted (status = 'accepted')
- Scheduled from the day after acceptance until 1 day before deadline

### Design Rationale
Unlike tasks (where WhatsApp reminders with buttons suffice), vendor tickets use **call-only reminders** because:
1. Vendors are external — they haven't opted into the platform
2. A daily morning call is how a real coordinator would follow up
3. No acknowledgment needed — just a reminder that the obligation exists
4. WhatsApp messages from unknown business numbers are often ignored

### Timing per Day
- **First attempt**: 9:00 AM IST
- **Retry intervals**: +30 min, +60 min, +90 min (if previous attempts failed)
- **Max 4 attempts per day**
- **Skip Sundays**
- Stop scheduling the day before deadline (Stage 3 takes over on deadline day)

### Scheduling Logic

```
On ticket acceptance:
  acceptance_date = today (IST)
  deadline_date = ticket.deadline (IST date)

  eligible_days = all weekdays from (acceptance_date + 1) to (deadline_date - 1)
  // Exclude Sundays
  // Exclude same-day deadlines (if deadline is today or tomorrow, no Stage 2)

  For each eligible day:
    Schedule first call at 9:00 AM IST
    // Retries are NOT pre-scheduled — they're triggered by the processor
    // when a call fails (same as task reminder call escalation pattern)
```

### Call Script (One-Way, Hindi)
```
नमस्ते! यह {org_name} से एक रिमाइंडर है।
आपका टिकट - {subject} - {deadline_formatted} तक है।
कृपया समय पर पूरा करें। धन्यवाद।
```

English fallback:
```
Hello! This is a reminder from {org_name}.
Your ticket - {subject} - is due on {deadline_formatted}.
Please ensure timely completion. Thank you.
```

### Retry Logic (Processor-Driven)
When the processor finds a failed daily reminder call:
1. Check how many attempts were made today for this ticket (from metadata)
2. If < 4 attempts: schedule retry in 30 minutes (adjusted to business hours)
3. If = 4 attempts: schedule owner notification

```
attempt_times = [9:00, 9:30, 10:00, 10:30] // IST, approximate
```

### Owner Notification (After Daily Attempts)

**If at least one call connected** (even briefly):
```
📞 *Daily Vendor Check-in*

*Ticket:*
"{subject}"

*Vendor:*
{vendor_name}

*Today's Status:*
✅ Call connected ({n} of 4 attempts)
Duration: {seconds}s

_Deadline: {deadline_formatted}_
```

**If all 4 attempts failed**:
```
⚠️ *Vendor Unreachable Today*

*Ticket:*
"{subject}"

*Vendor:*
{vendor_name}

All 4 call attempts this morning went unanswered.

_Deadline: {deadline_formatted}_
_You may want to reach out directly._
```

### Same-Day or Next-Day Deadline Edge Case
If the ticket deadline is today or tomorrow when accepted:
- **Skip Stage 2 entirely** — go straight to Stage 3 (deadline approaching)
- This prevents a jarring experience of getting a "daily reminder" and "deadline approaching" call within hours

---

## Stage 3: Deadline Day — Interactive Call (1 Hour Before)

### When Triggered
- 1 hour before ticket deadline
- Ticket status is 'accepted' or 'overdue' (not completed/cancelled)

### This is the Most Complex Stage
This stage introduces **interactive IVR calls** — a major extension to the current calling infrastructure. The bot speaks, then listens to the vendor's response, transcribes it, classifies it with AI, and takes action.

### Simultaneous WhatsApp Template
Send `ticket_deadline_reminder` template to vendor:
- Body: "Your ticket '{subject}' from {org_name} is due in 1 hour. If you need more time, you can request a deadline extension."
- Buttons: [Edit Deadline] → payload `ticket_edit_deadline_prompt::{ticket_id}`

### Interactive Call Flow

```
┌─────────────────────────────────────────────────────────────┐
│  CALL INITIATED                                              │
│                                                              │
│  Bot speaks:                                                 │
│  "नमस्ते! यह {org_name} से {owner_name} की ओर से कॉल है।    │
│   आपका टिकट - {subject} - एक घंटे में ड्यू है।              │
│   क्या आप समय पर दे पाएंगे?                                 │
│   अगर हां, तो 'हां' बोलें।                                  │
│   अगर नहीं, तो कारण बताएं।"                                  │
│                                                              │
│  [Twilio <Gather> — listen for speech, 10 second timeout]    │
│                                                              │
│  ├─ SPEECH DETECTED → webhook to /api/internal/ticket-ivr    │
│  │   ├─ Transcribe (Sarvam STT)                              │
│  │   ├─ AI classify: yes | no_with_reason | unclear          │
│  │   │                                                       │
│  │   ├─ YES:                                                 │
│  │   │   Bot says: "ठीक है, धन्यवाद! हम {owner_name} को     │
│  │   │   बता देंगे।"                                         │
│  │   │   → Notify owner: "Vendor confirmed on-time delivery" │
│  │   │   → Mark notification as 'sent'                       │
│  │   │                                                       │
│  │   ├─ NO + REASON:                                         │
│  │   │   Bot says: "समझ गया। हम {owner_name} को बता देंगे।   │
│  │   │   अगर आपको नई डेडलाइन बतानी है, तो WhatsApp पर       │
│  │   │   बता दें।"                                           │
│  │   │   → Notify owner with reason                          │
│  │   │   → Send vendor WhatsApp: "Please reply with new      │
│  │   │     deadline if you have one"                         │
│  │   │   → Create session: awaiting_ticket_new_deadline      │
│  │   │                                                       │
│  │   └─ UNCLEAR:                                             │
│  │       Bot says: "माफ़ कीजिये, समझ नहीं आया।               │
│  │       कृपया 'हां' या 'नहीं' बोलें।"                       │
│  │       → Loop back to <Gather> (max 2 retries per call)    │
│  │                                                           │
│  └─ NO SPEECH (timeout) → Bot says "कोई जवाब नहीं मिला"      │
│      → Hang up, mark attempt as failed                       │
│      → Schedule retry call                                   │
│                                                              │
│  RETRY LOGIC:                                                │
│  - Max 5 total call attempts                                 │
│  - Retry intervals: +15min, +30min, +45min, +55min           │
│  - After 5 failures → notify owner "vendor unresponsive"     │
└─────────────────────────────────────────────────────────────┘
```

### English Call Script
```
Hello! This is a call from {org_name} on behalf of {owner_name}.
Your ticket - {subject} - is due in one hour.
Will you be able to deliver on time?
If yes, say 'yes'.
If not, please tell me the reason.
```

### AI Response Classification

Use Gemini (same model as message analyzer) with a focused prompt:

```
You are analyzing a vendor's voice response to the question:
"Will you be able to deliver [SUBJECT] on time?"

Classify the response into ONE of these categories:
- "yes": Vendor confirms they will deliver on time. Examples: "haan", "yes", "ho jayega", "ready hai", "deliver kar dunga"
- "no_with_reason": Vendor says no and gives a reason. Extract the reason. Examples: "nahi, material nahi aaya", "payment nahi hua", "truck late hai"
- "unclear": Cannot determine intent. Examples: background noise only, incomplete sentence, unrelated speech

Respond in JSON:
{
  "classification": "yes" | "no_with_reason" | "unclear",
  "reason": "extracted reason in English" | null,
  "confidence": 0.0-1.0,
  "raw_transcript": "original transcript"
}
```

### Owner Notifications

**Vendor confirmed (YES)**:
```
✅ *Vendor Confirmed On-Time*

*Ticket:*
"{subject}"

*Vendor:*
{vendor_name}

The vendor confirmed they will deliver on time.
Deadline: {deadline_formatted}

_We'll follow up if the deadline passes without completion._
```

**Vendor said NO with reason**:
```
⚠️ *Vendor Delay Reported*

*Ticket:*
"{subject}"

*Vendor:*
{vendor_name}

*Vendor's Response:*
"{extracted_reason}"

The vendor has indicated a delay. We've asked them to provide a new deadline via WhatsApp.

_Please get in touch with the vendor if needed._
```

**Vendor unresponsive after 5 attempts**:
```
❌ *Vendor Unresponsive — Deadline Imminent*

*Ticket:*
"{subject}"

*Vendor:*
{vendor_name}

We attempted to reach the vendor 5 times in the past hour.
No clear response was received.

_The deadline is in {minutes} minutes. Please contact the vendor directly._
```

---

## Stage 4: Deadline Crossed — Interactive Negotiation Call

### When Triggered
- Ticket deadline has passed
- Ticket status is 'accepted' or the processor detects it as overdue
- Ticket is NOT completed or cancelled

### Timing
- **First call**: Immediately when overdue is detected (within 5-min cron window)
- **Retries**: +30min, +1hr, +2hr, +4hr (up to 5 total attempts)
- **No business hour restriction** on first call (deadline crossed is urgent)
- **Subsequent retries**: adjusted to business hours (9 AM–9 PM IST)

### Interactive Call Flow

```
┌──────────────────────────────────────────────────────────────┐
│  CALL INITIATED                                               │
│                                                               │
│  Bot speaks:                                                  │
│  "नमस्ते! यह {org_name} से कॉल है।                           │
│   आपका टिकट - {subject} - की डेडलाइन बीत चुकी है।            │
│   क्या यह तैयार है?                                           │
│   अगर हां, तो 'हां' बोलें।                                   │
│   अगर नहीं, तो कारण बताएं और बताएं कब तक कर पाएंगे।"         │
│                                                               │
│  [Twilio <Gather> — speech input, 15 second timeout]          │
│  (longer timeout here — vendor needs time to explain)         │
│                                                               │
│  ├─ SPEECH DETECTED → webhook to /api/internal/ticket-ivr     │
│  │   ├─ Transcribe (Sarvam STT)                               │
│  │   ├─ AI classify: ready | not_ready | unclear              │
│  │   │                                                        │
│  │   ├─ READY:                                                │
│  │   │   Bot says: "बहुत अच्छा! हम {owner_name} को बता        │
│  │   │   देंगे। धन्यवाद।"                                    │
│  │   │   → Notify owner: vendor says it's ready               │
│  │   │   → Mark notification as 'sent'                        │
│  │   │                                                        │
│  │   ├─ NOT READY (with reason + new deadline extracted):     │
│  │   │   Bot says: "समझ गया, {new_deadline_spoken}             │
│  │   │   तक। हम {owner_name} को बता देंगे। धन्यवाद।"         │
│  │   │   → Update ticket.deadline to new_deadline              │
│  │   │   → Notify owner with reason + new deadline            │
│  │   │   → Re-schedule Stage 2 & 3 for new deadline           │
│  │   │   → Mark notification as 'sent'                        │
│  │   │                                                        │
│  │   ├─ NOT READY (reason but NO new deadline):               │
│  │   │   Bot says: "समझ गया। कब तक कर पाएंगे?                │
│  │   │   कृपया एक तारीख बताएं।"                               │
│  │   │   → [Second <Gather> for deadline]                     │
│  │   │   ├─ Deadline detected:                                │
│  │   │   │   Same as above (update + notify)                  │
│  │   │   └─ Still no deadline:                                │
│  │   │       Bot says: "ठीक है, कृपया WhatsApp पर नई          │
│  │   │       डेडलाइन बता दें।"                                │
│  │   │       → Notify owner with reason (no deadline yet)     │
│  │   │       → Create session: awaiting_ticket_new_deadline   │
│  │   │                                                        │
│  │   └─ UNCLEAR:                                              │
│  │       Bot says: "माफ़ कीजिये, समझ नहीं आया।                │
│  │       क्या तैयार है? हां या नहीं बोलें।"                    │
│  │       → Loop back to <Gather> (max 2 retries per call)     │
│  │                                                            │
│  └─ NO SPEECH (timeout):                                      │
│      → Hang up, schedule retry                                │
└──────────────────────────────────────────────────────────────┘
```

### AI Response Classification (Stage 4)

```
You are analyzing a vendor's voice response to the question:
"Is [SUBJECT] ready? If not, tell reason and when you can deliver."

Classify the response:
- "ready": Vendor confirms it's ready/done. Examples: "haan ready hai", "payment kar diya", "ship kar diya"
- "not_ready": Vendor says not ready. Extract reason AND new deadline if mentioned.
  Examples: "nahi, material nahi aaya, parso tak ho jayega" → reason: "material not arrived", new_deadline: day after tomorrow
- "unclear": Cannot determine. Background noise, incomplete, unrelated.

IMPORTANT: For dates, convert Hindi relative dates to absolute:
- "kal" = tomorrow
- "parso" = day after tomorrow
- "agle hafte" = next week (Monday)
- "do din mein" = in 2 days

Respond in JSON:
{
  "classification": "ready" | "not_ready" | "unclear",
  "reason": "extracted reason in English" | null,
  "new_deadline": "ISO 8601 date" | null,
  "confidence": 0.0-1.0,
  "raw_transcript": "original transcript"
}
```

### Owner Notifications

**Vendor says READY**:
```
✅ *Vendor Says Ready*

*Ticket:*
"{subject}"

*Vendor:*
{vendor_name}

The vendor confirmed that {subject} is ready/completed.

_Please verify and mark the ticket as completed once you've confirmed._

[Mark Completed button → ticket_mark_completed::{ticket_id}]
```

**Vendor NOT READY — with reason + new deadline**:
```
⚠️ *Vendor Delay — New Deadline Set*

*Ticket:*
"{subject}"

*Vendor:*
{vendor_name}

*Reason for delay:*
"{extracted_reason}"

*New Deadline:*
{new_deadline_formatted}

The ticket deadline has been updated automatically.

_If this is not acceptable, please contact the vendor directly._
```

**Vendor NOT READY — reason but no new deadline**:
```
⚠️ *Vendor Delay Reported*

*Ticket:*
"{subject}"

*Vendor:*
{vendor_name}

*Reason for delay:*
"{extracted_reason}"

We've asked the vendor to provide a new deadline via WhatsApp.

_Please get in touch if needed._
```

**Vendor unresponsive after 5 attempts**:
```
❌ *Vendor Unresponsive — Deadline Crossed*

*Ticket:*
"{subject}"

*Vendor:*
{vendor_name}

*Deadline was:*
{deadline_formatted}

We attempted to reach the vendor 5 times.
No clear response was received.

_Please contact the vendor directly to resolve this._
```

---

## Interactive IVR Architecture

### New Endpoint: `/api/internal/ticket-ivr`

This is the core new infrastructure needed. It handles Twilio webhook callbacks when a vendor speaks during an interactive call.

#### Endpoint Design

```typescript
// app/api/internal/ticket-ivr/route.ts

export async function POST(request: Request) {
    const url = new URL(request.url)
    const ticketId = url.searchParams.get('ticketId')
    const stage = url.searchParams.get('stage')  // 'deadline_approaching' | 'deadline_crossed'
    const attempt = parseInt(url.searchParams.get('attempt') || '1')
    const step = url.searchParams.get('step') || 'initial'  // 'initial' | 'retry' | 'get_deadline'

    // Parse Twilio POST body (form-encoded)
    const formData = await request.formData()
    const speechResult = formData.get('SpeechResult') as string | null
    const confidence = parseFloat(formData.get('Confidence') as string || '0')

    if (!speechResult || confidence < 0.3) {
        // No speech or very low confidence — retry or hang up
        return generateRetryOrHangupTwiml(ticketId, stage, attempt, step)
    }

    // Transcribe is already done by Twilio's <Gather speech>
    // But for Hindi accuracy, optionally re-transcribe via Sarvam

    // Classify response with AI
    const classification = await classifyVendorResponse(speechResult, stage, ticketId)

    // Take action based on classification
    return handleClassification(classification, ticketId, stage, attempt, step)
}
```

#### TwiML Generation for Interactive Calls

```typescript
function generateInteractiveCallTwiml(
    ticketId: string,
    stage: string,
    attempt: number,
    promptAudioUrl: string,
): string {
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://boldoai.in'
    const actionUrl = `${baseUrl}/api/internal/ticket-ivr?ticketId=${ticketId}&stage=${stage}&attempt=${attempt}&step=initial`

    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Play>${promptAudioUrl}</Play>
    <Gather input="speech" action="${actionUrl}" method="POST"
            timeout="10" speechTimeout="3" language="hi-IN">
    </Gather>
    <Say language="hi-IN">कोई जवाब नहीं मिला। कृपया दोबारा कोशिश करें।</Say>
    <Redirect>${actionUrl}&step=timeout</Redirect>
</Response>`
}
```

### How Twilio `<Gather speech>` Works

1. Twilio calls the vendor
2. Twilio fetches our TwiML URL → gets `<Play>` (pre-generated audio) + `<Gather>`
3. After the audio plays, `<Gather>` listens for speech
4. `timeout="10"` — waits up to 10 seconds for speech to begin
5. `speechTimeout="3"` — ends recording 3 seconds after last speech detected
6. `language="hi-IN"` — Twilio's built-in speech recognition for Hindi
7. On speech detected: POSTs to `action` URL with `SpeechResult` and `Confidence`
8. Our endpoint responds with new TwiML (confirmation message, retry, or follow-up question)

### Twilio vs Sarvam for Transcription

**Option A: Use Twilio's built-in `<Gather speech>`** (recommended for MVP)
- Pros: Zero latency (transcription happens during the call), no extra API call
- Cons: May be less accurate for Hindi/Hinglish than Sarvam
- Confidence threshold: 0.5 (Twilio provides this)

**Option B: Use `<Record>` + Sarvam STT** (for better accuracy)
- Twilio records the audio, posts recording URL to webhook
- We download recording → send to Sarvam STT → get transcript
- Pros: Better Hindi/regional language accuracy
- Cons: Adds 2-5 seconds latency (can't respond during the call)

**Recommendation**: Start with Option A (`<Gather speech>`) for speed. If Hindi accuracy is poor, switch to Option B with `<Record>` for Stage 4 (where accuracy matters more).

### Recording for Audit Trail

Regardless of transcription method, **always record calls** for dispute resolution:
```xml
<Record maxLength="60" recordingStatusCallback="{baseUrl}/api/internal/ticket-recording"
        recordingStatusCallbackMethod="POST" />
```

Store recording URLs in notification metadata. Don't process recordings in real-time — they're just for audit.

---

## Database Changes

### Option A: Extend `task_notifications` (Recommended)

Add a nullable `ticket_id` column alongside the existing `task_id`:

```sql
ALTER TABLE task_notifications
    ADD COLUMN ticket_id UUID REFERENCES tickets(id) ON DELETE CASCADE;

-- Allow either task_id or ticket_id (but not both, and not neither)
ALTER TABLE task_notifications
    ADD CONSTRAINT chk_task_or_ticket
    CHECK (
        (task_id IS NOT NULL AND ticket_id IS NULL) OR
        (task_id IS NULL AND ticket_id IS NOT NULL)
    );

-- Index for ticket notification queries
CREATE INDEX idx_ticket_notifications ON task_notifications (ticket_id, stage, status)
    WHERE ticket_id IS NOT NULL;
```

**Dedup key format for tickets**: `ticket:{ticket_id}:{stage}:{stage_number}:{target}:{channel}[:suffix]`

Note: Prefix with `ticket:` to avoid collisions with task dedup keys.

### New Stages for Tickets

Add to the stage CHECK constraint (or use text type which is already in use):

| Stage Value | Description |
|-------------|-------------|
| `ticket_acceptance` | Stage 1: acceptance followups |
| `ticket_reminder` | Stage 2: daily reminder calls |
| `ticket_deadline_approaching` | Stage 3: interactive deadline day call |
| `ticket_deadline_crossed` | Stage 4: interactive overdue negotiation |
| `ticket_owner_update` | Owner status notifications |

### New Metadata Fields

```typescript
interface TicketNotificationMetadata {
    ticket_subject: string
    vendor_id: string
    vendor_name: string | null
    vendor_phone: string
    owner_id: string
    owner_name: string
    org_name: string
    deadline: string                    // ISO 8601
    attempt_number?: number            // For retry tracking
    max_attempts?: number
    daily_attempts_today?: number      // For Stage 2 daily count
    call_recording_url?: string        // Audit trail
    vendor_response_transcript?: string // What vendor said
    vendor_response_classification?: string // AI classification
    vendor_response_reason?: string    // Extracted reason
    new_deadline?: string              // Extracted new deadline
}
```

---

## Ticket Notification Scheduler

### New File: `lib/notifications/ticket-notification-scheduler.ts`

Follow the same pattern as `task-notification-scheduler.ts` but with ticket-specific logic.

### Key Functions

```typescript
// Called when ticket is created (status: pending)
export async function scheduleTicketAcceptanceFollowups(
    ticketId: string,
    vendorId: string,
    vendorPhone: string,
    ownerId: string,
    subject: string,
    ownerName: string,
    orgName: string,
): Promise<void>

// Called when ticket is accepted by vendor
export async function scheduleTicketReminders(
    ticketId: string,
    vendorId: string,
    vendorPhone: string,
    ownerId: string,
    acceptedAt: Date,
    deadline: Date,
    subject: string,
    ownerName: string,
    orgName: string,
): Promise<void>

// Called when ticket is accepted (schedules the deadline-day call)
export async function scheduleTicketDeadlineApproaching(
    ticketId: string,
    vendorId: string,
    vendorPhone: string,
    ownerId: string,
    deadline: Date,
    subject: string,
    ownerName: string,
    orgName: string,
): Promise<void>

// Called by processor when deadline is detected as crossed
export async function scheduleTicketDeadlineCrossed(
    ticketId: string,
    vendorId: string,
    vendorPhone: string,
    ownerId: string,
    deadline: Date,
    subject: string,
    ownerName: string,
    orgName: string,
): Promise<void>

// Cancel all pending ticket notifications
export async function cancelTicketNotifications(
    ticketId: string,
    stage?: string,
): Promise<void>
```

---

## Ticket Notification Processor

### Integration with Existing Cron

In `app/api/cron/process-reminders/route.ts`, add Phase 3:

```typescript
// Phase 1: Daily summaries (8:00-8:15 AM IST only)
// Phase 2: Task notifications
// Phase 3: Ticket notifications (NEW)
const ticketStats = await processTicketNotifications(supabase)
```

### New File: `lib/notifications/ticket-notification-processor.ts`

Follow `task-notification-processor.ts` pattern but with ticket-specific stage handlers:

```typescript
export async function processTicketNotifications(
    supabase?: SupabaseAdmin,
): Promise<{
    processed: number
    failed: number
    overdue: number
}>
```

### Stage Processing Functions

```typescript
// Stage 1: One-way call + WhatsApp template
async function processTicketAcceptance(supabase, notif)

// Stage 2: One-way call, retry logic, daily attempt tracking
async function processTicketReminder(supabase, notif)

// Stage 3: Interactive call with <Gather> for speech
async function processTicketDeadlineApproaching(supabase, notif)

// Stage 4: Interactive negotiation call
async function processTicketDeadlineCrossed(supabase, notif)

// Detect overdue tickets and schedule Stage 4
async function detectOverdueTickets(supabase): Promise<number>
```

### Overdue Detection

```typescript
async function detectOverdueTickets(supabase: SupabaseAdmin): Promise<number> {
    const { data: overdueTickets } = await supabase
        .from('tickets')
        .select('id, subject, vendor_id, deadline, created_by, organisation_id')
        .in('status', ['accepted'])
        .not('deadline', 'is', null)
        .lte('deadline', new Date().toISOString())
        .limit(50)

    // For each: update status to 'overdue', schedule Stage 4, cancel pending Stage 2/3
}
```

---

## Call Scripts — Complete Reference

### Stage 1: Acceptance (One-Way)
**Hindi**: `नमस्ते! आपके लिए एक नया टिकट बनाया गया है, {owner_name} ने, {org_name} से। विषय है: {subject}। डेडलाइन: {deadline}। कृपया WhatsApp पर इसे स्वीकार या अस्वीकार करें।`

### Stage 2: Daily Reminder (One-Way)
**Hindi**: `नमस्ते! यह {org_name} से एक रिमाइंडर है। आपका टिकट - {subject} - {deadline} तक है। कृपया समय पर पूरा करें। धन्यवाद।`

### Stage 3: Deadline Approaching (Interactive)
**Hindi**: `नमस्ते! यह {org_name} से {owner_name} की ओर से कॉल है। आपका टिकट - {subject} - एक घंटे में ड्यू है। क्या आप समय पर दे पाएंगे? अगर हां, तो 'हां' बोलें। अगर नहीं, तो कारण बताएं।`

### Stage 4: Deadline Crossed (Interactive)
**Hindi**: `नमस्ते! यह {org_name} से कॉल है। आपका टिकट - {subject} - की डेडलाइन बीत चुकी है। क्या यह तैयार है? अगर हां, तो 'हां' बोलें। अगर नहीं, तो कारण बताएं और बताएं कब तक कर पाएंगे।`

### Confirmation Responses (Bot speaks after classification)
- **YES confirmed**: `ठीक है, धन्यवाद! हम {owner_name} को बता देंगे।`
- **NO with reason**: `समझ गया। हम {owner_name} को बता देंगे। अगर आपको नई डेडलाइन बतानी है, तो WhatsApp पर बता दें।`
- **NO with reason + new deadline**: `समझ गया, {new_deadline_spoken} तक। हम {owner_name} को बता देंगे। धन्यवाद।`
- **Unclear (retry)**: `माफ़ कीजिये, समझ नहीं आया। कृपया दोबारा बोलें। क्या तैयार है? हां या नहीं?`
- **Asking for deadline**: `ठीक है। कब तक कर पाएंगे? कृपया एक तारीख बताएं।`

---

## WhatsApp Templates Needed (Additional)

### `ticket_deadline_reminder`
- **Purpose**: Sent to vendor 1 hour before deadline (alongside Stage 3 call)
- **Body**: `Your ticket "{subject}" from {org_name} is due in 1 hour. Need more time?`
- **Button**: [Request Extension] → payload `ticket_edit_deadline_prompt::{ticket_id}`

### `ticket_overdue_owner`
- **Purpose**: Sent to owner when ticket crosses deadline
- **Body**: `Your ticket "{subject}" for {vendor_name} is now overdue. Deadline was {deadline}. We're attempting to contact the vendor.`

### `ticket_vendor_ready_owner`
- **Purpose**: Sent to owner when vendor confirms ready (Stage 4)
- **Body**: `{vendor_name} says "{subject}" is ready. Please verify and mark complete.`
- **Button**: [Mark Completed] → payload `ticket_mark_completed::{ticket_id}`

---

## New Button Payloads

| Payload | Handler |
|---------|---------|
| `ticket_edit_deadline_prompt::{ticket_id}` | Create session `awaiting_ticket_new_deadline`, ask for new date |
| `ticket_mark_completed::{ticket_id}` | Update ticket status to 'completed', notify vendor |

---

## Edge Cases

### 1. Same-Day Deadline
If ticket deadline is today (within next few hours):
- Skip Stage 2 entirely
- If deadline is within 1 hour: go straight to Stage 3
- If deadline has already passed: go straight to Stage 4

### 2. Vendor Provides New Deadline via WhatsApp (during/after Stage 4)
- Session `awaiting_ticket_new_deadline` is active
- Vendor sends a message → session handler parses date
- Update ticket deadline → cancel old notifications → reschedule from Stage 2
- Notify owner of new deadline

### 3. Ticket Completed During Reminder Stage
- Owner marks ticket complete via webapp or WhatsApp
- Cancel all pending notifications for this ticket
- Optionally notify vendor: "The ticket has been marked as completed. Thank you."

### 4. Vendor Calls Back (Missed Call Scenario)
- If vendor sees missed call and sends WhatsApp message:
  - Check if there's a pending ticket notification for their phone
  - If yes, treat their message in context of the ticket
  - This is handled by the vendor routing layer in `02-VENDOR-ONBOARDING.md`

### 5. Multiple Tickets for Same Vendor
- Each ticket has independent notification schedules
- Calls are NOT batched (each ticket gets its own call)
- If vendor has multiple overdue tickets, they may receive multiple calls
- Consider: future optimization to batch calls ("You have 3 overdue tickets...")

### 6. Deadline Extended After Stage 3/4
- When a new deadline is set (via call response or WhatsApp):
  - Cancel all pending Stage 3 and Stage 4 notifications
  - Update ticket.deadline
  - Re-schedule Stage 2 reminders for remaining days
  - Re-schedule Stage 3 for new deadline

### 7. Owner Cancels Ticket During Active Notifications
- Cancel all pending notifications immediately
- Do NOT call vendor about cancellation (just stop notifications)
- Send vendor WhatsApp: "The ticket '{subject}' has been cancelled by {owner_name}."

### 8. Vendor is also a Registered User
- If vendor phone exists in `users` table:
  - Use `getUserLanguage()` for call language detection
  - All flows work the same — no special handling needed

### 9. Recording Storage & Privacy
- Call recordings stored as Twilio-hosted URLs in notification metadata
- Auto-expire after 30 days (configure in Twilio settings)
- Used only for dispute resolution — never shared publicly
- Add to privacy policy: "Vendor calls may be recorded for quality and tracking purposes"

---

## Daily Summary Integration

Add ticket section to existing daily summary (`lib/notifications/daily-summary.ts`):

```
📦 *Vendor Tickets*

*Due Today:*
• Invoice #1234 follow-up → Ramesh Kumar (Deadline: 8 PM)
• Shipment tracking → Priya Sharma (Deadline: 5 PM)

*Overdue:*
🔴 Payment collection → Kumar Supplies (Was due: Mar 12)

*Pending Acceptance:*
⏳ Material delivery → New Vendor (Sent: 2 hours ago)
```

---

## Files to Create/Modify

### New Files
| File | Purpose |
|------|---------|
| `lib/notifications/ticket-notification-scheduler.ts` | Schedule ticket notifications |
| `lib/notifications/ticket-notification-processor.ts` | Process ticket notifications |
| `app/api/internal/ticket-ivr/route.ts` | Interactive IVR webhook for Stages 3 & 4 |
| `app/api/internal/ticket-recording/route.ts` | Recording status callback (audit trail) |
| `lib/ai/vendor-response-classifier.ts` | AI classification of vendor call responses |

### Modified Files
| File | Change |
|------|--------|
| `app/api/cron/process-reminders/route.ts` | Add Phase 3 for ticket notification processing |
| `lib/notifications/calling-service.ts` | Add `makeInteractiveCall()` function that returns TwiML with `<Gather>` |
| `lib/notifications/calling-service.ts` | Add ticket-specific call script builders |
| `lib/notifications/daily-summary.ts` | Add ticket section to daily summary |
| `lib/whatsapp.ts` | Add ticket notification template wrappers |
| `lib/ai/conversation-context.ts` | Add `awaiting_ticket_new_deadline` session type |
| `lib/ai/session-reply-handler.ts` | Add handler for `awaiting_ticket_new_deadline` |
| Database migration | Add `ticket_id` column to `task_notifications` table |
