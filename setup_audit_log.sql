-- Create audit_log table
CREATE TABLE IF NOT EXISTS audit_log (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid,
    organisation_id uuid        REFERENCES organisations(id),
    action          text        NOT NULL,
    entity_type     text,
    entity_id       uuid,
    metadata        jsonb       DEFAULT '{}',
    created_at      timestamptz DEFAULT now()
);

-- Drop the foreign key constraint if it exists (for testing flexibility)
ALTER TABLE IF EXISTS audit_log DROP CONSTRAINT IF EXISTS audit_log_user_id_fkey;

-- Disable RLS for testing phase
ALTER TABLE audit_log DISABLE ROW LEVEL SECURITY;

-- Drop previous policies to keep it clean
DROP POLICY IF EXISTS "Users can view audit logs for their organisation" ON audit_log;
DROP POLICY IF EXISTS "Users can insert audit logs" ON audit_log;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_audit_log_organisation_id ON audit_log(organisation_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);
