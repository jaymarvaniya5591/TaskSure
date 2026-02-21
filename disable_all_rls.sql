-- Disable RLS on all tables for easy testing

ALTER TABLE IF EXISTS organisations DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS users DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS tasks DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS todos DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS task_comments DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS audit_log DISABLE ROW LEVEL SECURITY;

-- Optional: Drop all policies to keep it perfectly clean (since disabling RLS bypasses them anyway, this is just for thoroughness, but DISABLE ROW LEVEL SECURITY is enough)
-- But we'll leave the policies intact in case you want to re-enable RLS later by just running "ENABLE ROW LEVEL SECURITY".
