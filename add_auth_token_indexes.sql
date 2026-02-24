-- ═══════════════════════════════════════════════════════════════════════
-- Index on auth_tokens.token for fast token lookups
-- Without this, every token verification does a sequential scan.
-- ═══════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_auth_tokens_token ON public.auth_tokens (token);

-- Also add index on consumed + expires_at for faster filtering
CREATE INDEX IF NOT EXISTS idx_auth_tokens_consumed ON public.auth_tokens (consumed, expires_at);
