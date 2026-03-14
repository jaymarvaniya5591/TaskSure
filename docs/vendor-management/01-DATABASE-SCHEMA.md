# Database Schema — Vendor Management Tables

**Prerequisites**: Read `00-VENDOR-MANAGEMENT-OVERVIEW.md` for full context.

This document specifies the new database tables, indexes, constraints, and RLS policies needed for vendor management.

---

## 1. Table: `org_vendors`

Stores vendor records scoped to organisations. A vendor is identified by phone number and can be linked to multiple organisations.

```sql
CREATE TABLE org_vendors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    phone_number TEXT NOT NULL,
    name TEXT,                                    -- Nullable initially (collected during onboarding)
    first_name TEXT,                              -- Parsed from name after collection
    last_name TEXT,                               -- Parsed from name after collection
    status TEXT NOT NULL DEFAULT 'pending'         -- pending | active | inactive
        CHECK (status IN ('pending', 'active', 'inactive')),
    added_by UUID NOT NULL REFERENCES users(id),  -- The user who initiated the vendor addition
    user_id UUID REFERENCES users(id),            -- Set if vendor also has a Boldo user account
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- A vendor phone can only appear once per org
    CONSTRAINT uq_org_vendor_phone UNIQUE (organisation_id, phone_number)
);

-- Index for webhook lookup: "is this phone a vendor anywhere?"
CREATE INDEX idx_org_vendors_phone ON org_vendors (phone_number);

-- Index for listing vendors in an org
CREATE INDEX idx_org_vendors_org_status ON org_vendors (organisation_id, status);

-- Auto-update updated_at
CREATE TRIGGER set_org_vendors_updated_at
    BEFORE UPDATE ON org_vendors
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
```

### Field Notes

- **phone_number**: Stored as 10-digit normalized format (same as `users.phone_number`). Indian numbers only for now. Example: `"9876543210"`.
- **name**: Initially null when vendor is first invited. Populated when:
  1. Vendor's phone matches an existing user → copy name from `users.name`
  2. Vendor provides name via WhatsApp after accepting invitation
- **first_name / last_name**: Parsed from `name` field after collection. Used for phonetic matching and display.
- **status**:
  - `pending` — invitation sent, waiting for vendor to accept
  - `active` — vendor accepted, fully onboarded
  - `inactive` — vendor was removed/deactivated by an org user
- **user_id**: If the vendor's phone matches a registered Boldo user, link them. This enables:
  - Auto-populating name from user profile
  - Future: letting vendors see their tickets in the dashboard if they sign up
- **added_by**: The org user who initiated the vendor addition. Used for audit trail and notifications.

---

## 2. Table: `vendor_onboarding`

Tracks pending vendor approval requests. Each row represents one invitation sent to a vendor.

```sql
CREATE TABLE vendor_onboarding (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    vendor_phone TEXT NOT NULL,                    -- 10-digit normalized
    requested_by UUID NOT NULL REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected')),
    vendor_name TEXT,                              -- Collected during approval flow
    org_vendor_id UUID REFERENCES org_vendors(id), -- Linked after successful onboarding
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,                       -- When approved or rejected

    -- Prevent duplicate pending requests for same phone in same org
    CONSTRAINT uq_vendor_onboarding_pending
        EXCLUDE USING btree (organisation_id WITH =, vendor_phone WITH =)
        WHERE (status = 'pending')
);

-- Index for lookup when vendor clicks approve/reject button
CREATE INDEX idx_vendor_onboarding_id ON vendor_onboarding (id) WHERE status = 'pending';
```

### Field Notes

- **vendor_name**: Collected during the approval flow — either from existing user record or from vendor's WhatsApp reply.
- **org_vendor_id**: Set after the `org_vendors` row is created/updated to `active` status. Links the onboarding request to the final vendor record.
- **resolved_at**: Timestamp when the vendor approved or rejected. Null while pending.
- The `EXCLUDE` constraint prevents multiple pending requests for the same phone in the same org, but allows re-inviting after a rejection.

---

## 3. Table: `tickets`

Tracking tickets for vendor obligations. Fundamentally different from tasks — tickets track external vendor commitments (shipments, payments, invoices), not employee work.

```sql
CREATE TABLE tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    vendor_id UUID NOT NULL REFERENCES org_vendors(id) ON DELETE CASCADE,
    subject TEXT NOT NULL,                         -- Short description (max 200 chars recommended)
    description TEXT,                              -- Optional longer description
    deadline TIMESTAMPTZ,                          -- Suggested deadline by ticket creator
    committed_deadline TIMESTAMPTZ,                -- Confirmed deadline by vendor (future use)
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'accepted', 'completed', 'rejected', 'cancelled', 'overdue')),
    created_by UUID NOT NULL REFERENCES users(id), -- Org user who created the ticket
    source TEXT NOT NULL DEFAULT 'dashboard'        -- 'whatsapp' | 'dashboard'
        CHECK (source IN ('whatsapp', 'dashboard')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for listing tickets in an org
CREATE INDEX idx_tickets_org_status ON tickets (organisation_id, status);

-- Index for listing tickets by vendor
CREATE INDEX idx_tickets_vendor ON tickets (vendor_id, status);

-- Index for listing tickets by creator
CREATE INDEX idx_tickets_created_by ON tickets (created_by, status);

-- Index for overdue detection (cron job)
CREATE INDEX idx_tickets_deadline ON tickets (deadline)
    WHERE status IN ('pending', 'accepted') AND deadline IS NOT NULL;

-- Auto-update updated_at
CREATE TRIGGER set_tickets_updated_at
    BEFORE UPDATE ON tickets
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
```

### Field Notes

- **subject**: The primary identifier for the ticket. Displayed in lists, search, and notifications. Keep concise.
- **deadline**: Suggested by the ticket creator. Required for meaningful tracking.
- **committed_deadline**: For future use — when vendor accepts and commits to a specific date (mirrors `tasks.committed_deadline` pattern).
- **status lifecycle**:
  ```
  pending → accepted → completed
         ↘ rejected

  (any active status) → cancelled (by ticket creator)
  (accepted with past deadline) → overdue (set by cron, future)
  ```
- **source**: Tracks whether ticket was created via WhatsApp bot or webapp dashboard. Useful for analytics and notification routing.
- **vendor_id**: References `org_vendors.id`, NOT a phone number. This ensures vendor must be onboarded before tickets can be created.

---

## 4. RLS Policies

All tables should have Row Level Security enabled. Since we primarily use the admin client (service role key) for API routes, RLS is a safety net, not the primary access control.

```sql
-- Enable RLS on all new tables
ALTER TABLE org_vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_onboarding ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;

-- org_vendors: Org members can read/write their own org's vendors
CREATE POLICY "org_vendors_select" ON org_vendors
    FOR SELECT USING (
        organisation_id IN (
            SELECT organisation_id FROM users WHERE id = auth.uid()
        )
    );

CREATE POLICY "org_vendors_insert" ON org_vendors
    FOR INSERT WITH CHECK (
        organisation_id IN (
            SELECT organisation_id FROM users WHERE id = auth.uid()
        )
    );

CREATE POLICY "org_vendors_update" ON org_vendors
    FOR UPDATE USING (
        organisation_id IN (
            SELECT organisation_id FROM users WHERE id = auth.uid()
        )
    );

CREATE POLICY "org_vendors_delete" ON org_vendors
    FOR DELETE USING (
        organisation_id IN (
            SELECT organisation_id FROM users WHERE id = auth.uid()
        )
    );

-- vendor_onboarding: Org members can read their own org's onboarding requests
CREATE POLICY "vendor_onboarding_select" ON vendor_onboarding
    FOR SELECT USING (
        organisation_id IN (
            SELECT organisation_id FROM users WHERE id = auth.uid()
        )
    );

CREATE POLICY "vendor_onboarding_insert" ON vendor_onboarding
    FOR INSERT WITH CHECK (
        organisation_id IN (
            SELECT organisation_id FROM users WHERE id = auth.uid()
        )
    );

-- tickets: Org members can CRUD their own org's tickets
CREATE POLICY "tickets_select" ON tickets
    FOR SELECT USING (
        organisation_id IN (
            SELECT organisation_id FROM users WHERE id = auth.uid()
        )
    );

CREATE POLICY "tickets_insert" ON tickets
    FOR INSERT WITH CHECK (
        organisation_id IN (
            SELECT organisation_id FROM users WHERE id = auth.uid()
        )
    );

CREATE POLICY "tickets_update" ON tickets
    FOR UPDATE USING (
        organisation_id IN (
            SELECT organisation_id FROM users WHERE id = auth.uid()
        )
    );

CREATE POLICY "tickets_delete" ON tickets
    FOR DELETE USING (
        organisation_id IN (
            SELECT organisation_id FROM users WHERE id = auth.uid()
        )
    );
```

---

## 5. Vendor Cache Pattern

In `app/api/webhook/whatsapp/route.ts`, mirror the existing `knownUsersCache` pattern:

```typescript
// Existing pattern (for reference):
const knownUsersCache = new Map<string, { user: ResolvedUser; timestamp: number }>()
const CACHE_TTL = 10 * 60 * 1000 // 10 minutes

// New vendor cache (same pattern):
interface CachedVendor {
    id: string
    name: string | null
    phone_number: string
    organisation_id: string
    organisation_name: string   // For display in vendor-only messages
    status: string
}

const knownVendorsCache = new Map<string, { vendors: CachedVendor[]; timestamp: number }>()

// Note: vendors array because one phone can be vendor in multiple orgs
// Note: Do NOT cache negative results (empty array) — same pattern as user cache
```

### Lookup Function

```typescript
async function getCachedVendor(phone: string, forceDbCheck = false): Promise<CachedVendor[] | null> {
    const cached = knownVendorsCache.get(phone)
    if (cached && !forceDbCheck && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.vendors
    }

    const { data } = await supabaseAdmin
        .from('org_vendors')
        .select('id, name, phone_number, organisation_id, status, organisations(name)')
        .eq('phone_number', phone)
        .eq('status', 'active')

    if (!data || data.length === 0) return null  // Don't cache negatives

    const vendors = data.map(v => ({
        id: v.id,
        name: v.name,
        phone_number: v.phone_number,
        organisation_id: v.organisation_id,
        organisation_name: v.organisations?.name || 'Unknown',
        status: v.status,
    }))

    knownVendorsCache.set(phone, { vendors, timestamp: Date.now() })
    return vendors
}
```

---

## 6. Migration Execution

Run these SQL statements in order in the Supabase SQL Editor:

1. Create `org_vendors` table + indexes
2. Create `vendor_onboarding` table + indexes
3. Create `tickets` table + indexes
4. Enable RLS + create policies
5. Verify with: `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('org_vendors', 'vendor_onboarding', 'tickets')`

### Pre-Migration Checklist

- [ ] Ensure `update_updated_at_column()` function exists (used by existing tables like `tasks` — should already be in place)
- [ ] Verify `organisations` table has `name` column (used in vendor cache lookup join)
- [ ] Back up the database before running migration in production
