# Webapp — Vendors & Tickets Pages

**Prerequisites**: Read `00-VENDOR-MANAGEMENT-OVERVIEW.md` for full context. Database tables from `01-DATABASE-SCHEMA.md` must exist. Vendor onboarding API routes from `02-VENDOR-ONBOARDING.md` should be implemented.

This document covers the webapp-side implementation: new sidebar navigation items, vendor list page, ticket list page, and all associated components, modals, and data fetching.

---

## 1. Sidebar Changes

### File: `components/layout/sidebar.tsx`

Add two new navigation items below the existing "All Tasks" section (line 158). Follow the exact same pattern as the "All Tasks" `<Link>` block.

```
Current sidebar structure:
  - Home (pageNav)
  - ─── divider ───
  - All Tasks
  - ─── (end of scrollable content) ───

New sidebar structure:
  - Home (pageNav)
  - ─── divider ───
  - All Tasks
  - Tickets        ← NEW
  - Vendors        ← NEW
  - ─── (end of scrollable content) ───
```

### Icons (from lucide-react)
- **Tickets**: Use `Ticket` icon (or `FileText` if `Ticket` isn't available in the project's lucide version)
- **Vendors**: Use `Users` icon (distinct from `User` used elsewhere)

### Implementation

Add after the "All Tasks" `<div className="mb-4">` block (around line 158):

```tsx
{/* ── SECTION 2: TICKETS ── */}
<div className="mb-1">
    <Link
        href="/tickets"
        onClick={() => setIsMobileOpen(false)}
        className={cn(
            pathname.startsWith("/tickets")
                ? "bg-gray-900 text-white"
                : "text-gray-600 hover:text-gray-900 hover:bg-gray-50",
            "group flex items-center justify-between rounded-xl px-3 py-2.5 text-sm font-semibold transition-all duration-200"
        )}
    >
        <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider">
            <Ticket className={cn("w-4 h-4", pathname.startsWith("/tickets") ? "text-white" : "text-gray-400 group-hover:text-gray-600")} />
            Tickets
        </span>
    </Link>
</div>

{/* ── SECTION 3: VENDORS ── */}
<div className="mb-4">
    <Link
        href="/vendors"
        onClick={() => setIsMobileOpen(false)}
        className={cn(
            pathname.startsWith("/vendors")
                ? "bg-gray-900 text-white"
                : "text-gray-600 hover:text-gray-900 hover:bg-gray-50",
            "group flex items-center justify-between rounded-xl px-3 py-2.5 text-sm font-semibold transition-all duration-200"
        )}
    >
        <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider">
            <Users className={cn("w-4 h-4", pathname.startsWith("/vendors") ? "text-white" : "text-gray-400 group-hover:text-gray-600")} />
            Vendors
        </span>
    </Link>
</div>
```

Add imports: `Ticket` (or `FileText`) and `Users` from `lucide-react`.

---

## 2. Vendors Page

### 2.1 Route Structure

```
app/(dashboard)/vendors/
  page.tsx          — Main page (client component)
```

### 2.2 Page Layout

```
┌─────────────────────────────────────────────┐
│  Vendors                    [+ Add Vendor]  │  ← Header with title + action button
├─────────────────────────────────────────────┤
│  🔍 Search vendors...                       │  ← Search input
├─────────────────────────────────────────────┤
│  ┌─────────────────────────────────────┐    │
│  │ Ramesh Kumar          9876543210    │    │  ← VendorCard
│  │ Active                    [⋮ Menu]  │    │
│  └─────────────────────────────────────┘    │
│  ┌─────────────────────────────────────┐    │
│  │ Priya Sharma          9123456789    │    │
│  │ Pending                   [⋮ Menu]  │    │
│  └─────────────────────────────────────┘    │
│  ...                                        │
└─────────────────────────────────────────────┘
```

### 2.3 Components

#### `app/(dashboard)/vendors/page.tsx`
```tsx
"use client"
// Main page wrapper
// Uses useVendors() hook for data
// Renders: header + search + vendor list + AddVendorModal
```

#### `components/vendors/VendorCard.tsx`
Follow the `TaskCard.tsx` pattern:
- Container: `rounded-2xl border border-gray-100 bg-white p-3 sm:p-4 relative group`
- Left accent bar: `absolute left-0 top-3 bottom-3 w-1 rounded-full`
  - Active: `bg-teal-500`
  - Pending: `bg-amber-400`
  - Inactive: `bg-gray-300`
- Content:
  - Name: `font-semibold text-sm sm:text-[15px] text-gray-900`
  - Phone: `text-xs text-gray-500 flex items-center gap-1` with `Phone` icon
  - Status badge: `px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase tracking-wide`
    - Active: `bg-emerald-100 text-emerald-700 border-emerald-200`
    - Pending: `bg-amber-100 text-amber-700 border-amber-200`
    - Inactive: `bg-gray-100 text-gray-500 border-gray-200`
  - Added by: `text-xs text-gray-400` — "Added by {user_name}"
  - Added date: `text-xs text-gray-400` — relative time (e.g., "2 days ago")
- Actions (three-dot menu or inline buttons):
  - Edit (pencil icon) — opens edit modal
  - Delete (trash icon) — confirmation dialog then soft-delete

#### `components/vendors/AddVendorModal.tsx`
Follow the `CreateTaskModal.tsx` MODAL pattern exactly:
- **Title**: "Add Vendor"
- **Fields**:
  - Phone number input: `type="tel"`, placeholder "10-digit phone number", pattern validation for 10 digits
  - Auto-format as user types (optional: insert spaces like "98765 43210")
- **Footer buttons**:
  - Cancel (secondary)
  - "Send Request" (primary, `bg-gray-900 text-white`)
- **Submit**: Call `POST /api/vendors` with `{ phone_number }`
- **Success**: Close modal, show toast "Vendor request sent", refresh vendor list
- **Error**: Show inline error message (e.g., "Already registered", "Invalid phone number")

#### `components/vendors/EditVendorModal.tsx`
Same modal pattern:
- **Title**: "Edit Vendor"
- **Fields**:
  - Name input (editable)
  - Phone number (read-only, shown but not editable)
  - Status (read-only display)
- **Footer**:
  - Cancel
  - "Save Changes" (primary)
  - "Remove Vendor" (destructive, `bg-red-600 text-white`) — triggers confirmation dialog

### 2.4 Data Fetching

Create `lib/hooks/useVendors.ts`:
```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

export function useVendors() {
    return useQuery({
        queryKey: ['vendors'],
        queryFn: async () => {
            const res = await fetch('/api/vendors')
            if (!res.ok) throw new Error('Failed to fetch vendors')
            return res.json()
        },
    })
}

export function useAddVendor() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async (phoneNumber: string) => {
            const res = await fetch('/api/vendors', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone_number: phoneNumber }),
            })
            if (!res.ok) {
                const error = await res.json()
                throw new Error(error.message || 'Failed to add vendor')
            }
            return res.json()
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['vendors'] })
        },
    })
}

// Similarly: useEditVendor(), useDeleteVendor()
```

### 2.5 Search

Client-side filtering on the vendor list:
- Search by name (case-insensitive substring match)
- Search by phone number (substring match)
- Debounce input by 300ms

```tsx
const filteredVendors = vendors.filter(v => {
    const q = searchQuery.toLowerCase()
    return (
        (v.name?.toLowerCase().includes(q)) ||
        v.phone_number.includes(q)
    )
})
```

---

## 3. Tickets Page

### 3.1 Route Structure

```
app/(dashboard)/tickets/
  page.tsx          — Main page (client component)
```

### 3.2 Page Layout

```
┌──────────────────────────────────────────────────┐
│  Tickets                     [+ Create Ticket]   │  ← Header
├──────────────────────────────────────────────────┤
│  🔍 Search tickets...    [Overdue ▼] [Status ▼]  │  ← Search + filters
├──────────────────────────────────────────────────┤
│  ┌────────────────────────────────────────────┐  │
│  │ Invoice pending - Ramesh Kumar             │  │  ← TicketCard
│  │ 📅 Mar 20, 2026    👤 Ramesh    ● Active   │  │
│  │ Created by: You              [⋮ Actions]   │  │
│  └────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────┐  │
│  │ Shipment tracking - Priya Sharma           │  │
│  │ 📅 Mar 15, 2026    👤 Priya    ● Overdue   │  │
│  └────────────────────────────────────────────┘  │
│  ...                                             │
└──────────────────────────────────────────────────┘
```

### 3.3 Components

#### `app/(dashboard)/tickets/page.tsx`
```tsx
"use client"
// Main page wrapper
// Uses useTickets() hook for data
// Renders: header + search + filters + ticket list + CreateTicketModal
```

#### `components/tickets/TicketCard.tsx`
Follow `TaskCard.tsx` pattern:
- Container: `rounded-2xl border border-gray-100 bg-white p-3 sm:p-4 relative group`
- Left accent bar based on status:
  - Pending: `bg-amber-400`
  - Accepted/Active: `bg-emerald-500`
  - Overdue: `bg-rose-500`
  - Completed: `bg-gray-300`
  - Rejected: `bg-red-400`
  - Cancelled: `bg-gray-300`
- Content layout:
  - **Subject**: `font-semibold text-sm sm:text-[15px] text-gray-900 line-clamp-2`
  - **Metadata row**: `flex items-center gap-x-2 gap-y-1 flex-wrap text-xs text-gray-500`
    - Deadline: `Clock` icon + formatted date
    - Vendor name: `User` icon + name
    - Created by: shown if viewing org-wide (future)
  - **Status badge**: same styling as vendor status badges
    - Pending: amber
    - Accepted: blue
    - Active: emerald
    - Overdue: rose
    - Completed: emerald (muted)
    - Rejected: red
    - Cancelled: gray
- **Actions** (three-dot menu or inline):
  - Edit ticket (opens modal)
  - Mark as completed (direct action with confirmation)
  - Delete/Cancel ticket (confirmation dialog)

#### `components/tickets/CreateTicketModal.tsx`
Follow `CreateTaskModal.tsx` MODAL pattern:
- **Title**: "Create Ticket"
- **Fields**:
  1. **Vendor** (required): Searchable dropdown/combobox
     - Lists active vendors from org
     - Type-ahead search by name or phone
     - Shows vendor name + phone in dropdown items
     - Uses same search pattern as `SearchEmployee.tsx`
  2. **Subject** (required): Text input
     - Placeholder: "e.g., Invoice #1234 follow-up"
     - Max 200 characters
  3. **Deadline** (required): Date/time picker
     - Minimum: tomorrow
     - Default time: 8 PM IST (matches task deadline default)
     - Use native `<input type="datetime-local">` or existing date picker if one exists
- **Footer**:
  - Cancel (secondary)
  - "Create Ticket" (primary, `bg-gray-900 text-white`)
- **Submit**: Call `POST /api/tickets`
- **Success**: Close modal, toast "Ticket created", refresh ticket list

#### `components/tickets/EditTicketModal.tsx`
Same modal pattern:
- **Title**: "Edit Ticket"
- **Fields**:
  - Subject (editable)
  - Deadline (editable)
  - Vendor (read-only display — can't change vendor after creation)
  - Status (read-only display)
- **Footer**:
  - Cancel
  - "Save Changes" (primary)
  - "Mark Completed" (emerald button, if status is accepted/active/overdue)
  - "Delete Ticket" (destructive red, confirmation dialog)

### 3.4 Filters

#### Overdue Filter
Toggle button (pill style):
- When active: show only tickets where `deadline < now && status IN ('pending', 'accepted')`
- Styling follows the filter chip pattern from dashboard:
  - Active: `bg-rose-100 text-rose-700 border-rose-200 shadow-md`
  - Inactive: `bg-white/70 text-gray-700 border-white/50`

#### Status Filter (optional, nice-to-have)
Dropdown or chip group to filter by status: All, Pending, Accepted, Completed, Overdue

### 3.5 Search

Client-side filtering:
- Search by ticket subject (case-insensitive substring)
- Search by vendor name (case-insensitive substring)
- Debounce 300ms

```tsx
const filteredTickets = tickets.filter(t => {
    const q = searchQuery.toLowerCase()
    return (
        t.subject.toLowerCase().includes(q) ||
        t.vendor?.name?.toLowerCase().includes(q)
    )
})
```

### 3.6 Data Fetching

Create `lib/hooks/useTickets.ts`:
```typescript
export function useTickets() {
    return useQuery({
        queryKey: ['tickets'],
        queryFn: async () => {
            const res = await fetch('/api/tickets')
            if (!res.ok) throw new Error('Failed to fetch tickets')
            return res.json()
        },
    })
}

export function useCreateTicket() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async (data: { vendor_id: string; subject: string; deadline: string }) => {
            const res = await fetch('/api/tickets', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            })
            if (!res.ok) {
                const error = await res.json()
                throw new Error(error.message || 'Failed to create ticket')
            }
            return res.json()
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['tickets'] })
        },
    })
}

// Similarly: useEditTicket(), useDeleteTicket(), useCompleteTicket()
```

---

## 4. API Routes

### 4.1 `app/api/tickets/route.ts`

```typescript
export async function GET(request: Request) {
    // 1. Validate auth (Supabase session)
    // 2. Get user's org_id from session
    // 3. Query tickets with vendor data:
    //    SELECT tickets.*, org_vendors.name as vendor_name, org_vendors.phone_number as vendor_phone
    //    FROM tickets
    //    JOIN org_vendors ON tickets.vendor_id = org_vendors.id
    //    WHERE tickets.organisation_id = org_id
    //    ORDER BY tickets.created_at DESC
    // 4. Return tickets array
}

export async function POST(request: Request) {
    // 1. Validate auth
    // 2. Rate limit (20 ticket creates per 60 seconds per user)
    // 3. Extract: vendor_id, subject, deadline from body
    // 4. Validate:
    //    - vendor_id exists and belongs to user's org
    //    - vendor status is 'active'
    //    - subject is non-empty, max 200 chars
    //    - deadline is in the future
    // 5. Insert ticket row (status: 'pending', source: 'dashboard')
    // 6. Fire-and-forget: send ticket_assignment template to vendor
    // 7. Audit log: ticket.created
    // 8. Return { success: true, ticket }
}
```

### 4.2 `app/api/tickets/[ticketId]/route.ts`

```typescript
export async function PATCH(request: Request) {
    // Edit ticket: update subject, deadline, or status
    // Only the ticket creator (created_by) or org members can edit
    // Validate ticket belongs to user's org
    // If status changed to 'completed': fire-and-forget notification to vendor
}

export async function DELETE(request: Request) {
    // Update status to 'cancelled'
    // Only the ticket creator can cancel
    // Fire-and-forget: notify vendor of cancellation (optional)
}
```

---

## 5. Color Theme

Add to `tailwind.config.ts` — new CSS variable-based color scales:

### Vendor Color (Teal)
```
vendor-50:  #f0fdfa
vendor-100: #ccfbf1
vendor-200: #99f6e4
vendor-300: #5eead4
vendor-400: #2dd4bf
vendor-500: #14b8a6
vendor-600: #0d9488
vendor-700: #0f766e
vendor-800: #115e59
vendor-900: #134e4a
```

### Ticket Color (Emerald)
```
ticket-50:  #ecfdf5
ticket-100: #d1fae5
ticket-200: #a7f3d0
ticket-300: #6ee7b7
ticket-400: #34d399
ticket-500: #10b981
ticket-600: #059669
ticket-700: #047857
ticket-800: #065f46
ticket-900: #064e3b
```

Add these as CSS variables in `app/globals.css` (or wherever the existing task color variables are defined) and reference them in `tailwind.config.ts` following the same pattern as `todo`, `owned`, `assigned`, `overdue`.

---

## 6. Empty States

### Vendors Page — No Vendors
```tsx
<div className="text-center py-16">
    <Users className="mx-auto h-12 w-12 text-gray-300" />
    <h3 className="text-sm font-semibold text-gray-900 mt-3">No vendors yet</h3>
    <p className="text-sm text-gray-500 mt-1">
        Add your first vendor to start tracking shipments and payments.
    </p>
    <button className="mt-4 px-4 py-2 bg-gray-900 text-white text-sm font-bold rounded-xl">
        + Add Vendor
    </button>
</div>
```

### Tickets Page — No Tickets
```tsx
<div className="text-center py-16">
    <Ticket className="mx-auto h-12 w-12 text-gray-300" />
    <h3 className="text-sm font-semibold text-gray-900 mt-3">No tickets yet</h3>
    <p className="text-sm text-gray-500 mt-1">
        Create a ticket to track vendor obligations like shipments or payments.
    </p>
    <button className="mt-4 px-4 py-2 bg-gray-900 text-white text-sm font-bold rounded-xl">
        + Create Ticket
    </button>
</div>
```

### Tickets Page — No Search Results
```tsx
<div className="text-center py-12">
    <Search className="mx-auto h-8 w-8 text-gray-300" />
    <p className="text-sm text-gray-500 mt-2">
        No tickets match your search.
    </p>
</div>
```

---

## 7. Loading Skeletons

Follow `DashboardSkeleton.tsx` pattern:

### VendorCardSkeleton
```tsx
<div className="rounded-2xl border border-gray-100 bg-white p-3 sm:p-4 animate-pulse">
    <div className="flex items-center gap-3">
        <div className="w-1 h-10 rounded-full bg-gray-200" />
        <div className="flex-1">
            <div className="h-4 bg-gray-200/70 rounded-xl w-32 mb-2" />
            <div className="h-3 bg-gray-200/70 rounded-xl w-24" />
        </div>
        <div className="h-5 bg-gray-200/70 rounded-full w-16" />
    </div>
</div>
```

### TicketCardSkeleton
```tsx
<div className="rounded-2xl border border-gray-100 bg-white p-3 sm:p-4 animate-pulse">
    <div className="flex items-start gap-3">
        <div className="w-1 h-12 rounded-full bg-gray-200" />
        <div className="flex-1">
            <div className="h-4 bg-gray-200/70 rounded-xl w-48 mb-2" />
            <div className="flex gap-3">
                <div className="h-3 bg-gray-200/70 rounded-xl w-20" />
                <div className="h-3 bg-gray-200/70 rounded-xl w-24" />
            </div>
        </div>
        <div className="h-5 bg-gray-200/70 rounded-full w-16" />
    </div>
</div>
```

---

## 8. Files to Create/Modify

### New Files
| File | Purpose |
|------|---------|
| `app/(dashboard)/vendors/page.tsx` | Vendors page |
| `app/(dashboard)/tickets/page.tsx` | Tickets page |
| `components/vendors/VendorCard.tsx` | Vendor list card |
| `components/vendors/AddVendorModal.tsx` | Add vendor modal |
| `components/vendors/EditVendorModal.tsx` | Edit vendor modal |
| `components/tickets/TicketCard.tsx` | Ticket list card |
| `components/tickets/CreateTicketModal.tsx` | Create ticket modal |
| `components/tickets/EditTicketModal.tsx` | Edit ticket modal |
| `lib/hooks/useVendors.ts` | Vendor data fetching hooks |
| `lib/hooks/useTickets.ts` | Ticket data fetching hooks |
| `app/api/tickets/route.ts` | Ticket list + create API |
| `app/api/tickets/[ticketId]/route.ts` | Ticket edit + delete API |

### Modified Files
| File | Change |
|------|--------|
| `components/layout/sidebar.tsx` | Add Tickets and Vendors nav items + import new icons |
| `tailwind.config.ts` | Add vendor and ticket color scales |
| `app/globals.css` | Add vendor and ticket CSS variables (if colors are defined here) |
