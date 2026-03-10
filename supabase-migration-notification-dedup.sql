-- ============================================================================
-- Notification System Dedup Migration
-- Run this in Supabase SQL Editor BEFORE deploying the code changes.
-- ============================================================================

-- 1. Add dedup_key column to task_notifications
ALTER TABLE task_notifications ADD COLUMN IF NOT EXISTS dedup_key TEXT;
ALTER TABLE task_notifications ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0;

-- 2. Clean up duplicate audit_log entries for daily_summary_run (keep oldest per date)
-- This fixes the 4-5x duplicate daily summary sends
DELETE FROM audit_log a
USING audit_log b
WHERE a.action = 'daily_summary_run'
  AND b.action = 'daily_summary_run'
  AND a.metadata->>'date' = b.metadata->>'date'
  AND a.id <> b.id
  AND a.created_at > b.created_at;

-- 3. Create unique index for daily summary audit log
-- This prevents the race condition where two cron runs both send summaries
CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_daily_summary
ON audit_log (action, (metadata->>'date'))
WHERE action = 'daily_summary_run';

-- 3.5. Clean up existing duplicates in task_notifications to prevent unique constraint violation
-- We keep the newest one and cancel the rest.
WITH duplicates AS (
  SELECT id,
         ROW_NUMBER() OVER(PARTITION BY task_id, stage, stage_number, target_role, channel ORDER BY created_at DESC) as rn
  FROM task_notifications
  WHERE status NOT IN ('cancelled', 'failed')
)
UPDATE task_notifications
SET status = 'cancelled',
    failure_reason = 'Duplicate notification cancelled during migration cleanup'
WHERE id IN (SELECT id FROM duplicates WHERE rn > 1);

-- 4. Backfill dedup_key for existing active notifications
-- (Only for non-cancelled, non-failed rows that will be subject to the unique constraint)
UPDATE task_notifications
SET dedup_key = task_id || ':' || stage || ':' || stage_number || ':' || target_role || ':' || channel
WHERE dedup_key IS NULL
  AND status NOT IN ('cancelled', 'failed');

-- 5. Create partial unique index for notification dedup
-- Only active notifications (not cancelled/failed) are subject to uniqueness
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_notif_dedup
ON task_notifications (dedup_key)
WHERE status NOT IN ('cancelled', 'failed') AND dedup_key IS NOT NULL;

-- 6. Create the retry count increment function (used by the processor)
CREATE OR REPLACE FUNCTION increment_notification_retry(notif_id UUID, fail_reason TEXT)
RETURNS void AS $$
BEGIN
    UPDATE task_notifications
    SET status = 'pending',
        failure_reason = fail_reason,
        retry_count = COALESCE(retry_count, 0) + 1,
        updated_at = NOW()
    WHERE id = notif_id;
END;
$$ LANGUAGE plpgsql;

-- 7. Verify the migration
DO $$
BEGIN
    RAISE NOTICE 'Migration complete. Verifying...';

    -- Check dedup_key column exists
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'task_notifications' AND column_name = 'dedup_key'
    ) THEN
        RAISE NOTICE '✓ dedup_key column exists';
    ELSE
        RAISE EXCEPTION '✗ dedup_key column missing';
    END IF;

    -- Check retry_count column exists
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'task_notifications' AND column_name = 'retry_count'
    ) THEN
        RAISE NOTICE '✓ retry_count column exists';
    ELSE
        RAISE EXCEPTION '✗ retry_count column missing';
    END IF;

    -- Check unique indexes exist
    IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_task_notif_dedup') THEN
        RAISE NOTICE '✓ idx_task_notif_dedup index exists';
    ELSE
        RAISE EXCEPTION '✗ idx_task_notif_dedup index missing';
    END IF;

    IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_audit_daily_summary') THEN
        RAISE NOTICE '✓ idx_audit_daily_summary index exists';
    ELSE
        RAISE EXCEPTION '✗ idx_audit_daily_summary index missing';
    END IF;

    RAISE NOTICE '✓ All checks passed!';
END $$;
