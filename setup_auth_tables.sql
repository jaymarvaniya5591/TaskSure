-- ============================================================================
-- Auth Tables Migration — WhatsApp-based auth
-- Run this in Supabase SQL Editor
-- ============================================================================

-- 1. auth_tokens — stores magic link tokens for signup/signin
CREATE TABLE IF NOT EXISTS auth_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text UNIQUE NOT NULL,
  phone text NOT NULL,
  type text NOT NULL CHECK (type IN ('signup', 'signin')),
  expires_at timestamptz NOT NULL,
  consumed boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auth_tokens_token ON auth_tokens(token);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_phone ON auth_tokens(phone);

-- Auto-cleanup expired tokens (older than 1 hour)
-- You can run this periodically or set up a cron job
-- DELETE FROM auth_tokens WHERE expires_at < NOW() - INTERVAL '1 hour';

-- 2. join_requests — tracks partner join requests
CREATE TABLE IF NOT EXISTS join_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_phone text NOT NULL,
  requester_name text NOT NULL,
  partner_phone text NOT NULL,
  role text NOT NULL CHECK (role IN ('owner', 'member')),
  company_name text,          -- NULL for key_partner (will use partner's company)
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_join_requests_partner_phone ON join_requests(partner_phone);
CREATE INDEX IF NOT EXISTS idx_join_requests_status ON join_requests(status);

-- No RLS on auth_tokens — these are only accessed server-side via service role
-- No RLS on join_requests — these are only accessed server-side via service role
