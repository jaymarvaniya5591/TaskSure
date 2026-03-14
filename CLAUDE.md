# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Boldo AI is a WhatsApp-first task management and accountability platform for Indian SMBs, built with Next.js 14 App Router and Supabase. It integrates WhatsApp Cloud API (Meta) for in-chat task management via encrypted WhatsApp Flows.

## Commands

```bash
npm run dev      # Start development server (localhost:3000)
npm run build    # Build for production (standalone output + vendor file copy)
npm run lint     # Run ESLint
npm start        # Run production build
```

No test suite is configured. Build produces standalone output (`output: 'standalone'` in next.config.mjs) and copies `lib/vendor/lame.all.js` into `.next/standalone/` for runtime MP3 encoding.

## Deployment

Primary deployment is **Railway** (migrated from Vercel for cold-start elimination). Railway uses NIXPACKS builder running `node .next/standalone/server.js` with `HOSTNAME=0.0.0.0`. See `RAILWAY_MIGRATION.md` for migration context. Vercel config (`vercel.json`) remains for static asset caching.

## Architecture

### Key Patterns

**Authentication**: Supabase cookie-based sessions. `middleware.ts` does synchronous cookie checks only (no network calls, <1ms) — handles chunked cookies (`sb-<ref>-auth-token.0/1/2`). Client-side token refresh handled in `lib/hooks/useAuth.ts`. Protected dashboard routes redirect unauthenticated users to `/login`.

**Auth Link Flow** (`lib/auth-links.ts`): Generates secure 16-byte random tokens with 15-minute expiry, single-use. Two-mode verification: instant redirect (skeleton loads from CDN) and processing mode (JSON API for callback page).

**Data Fetching**: React Query (@tanstack/react-query) for client state + Supabase SSR for server-side auth. Persist client enabled for offline caching. Two-phase parallel dashboard fetch (`lib/hooks/useDashboardData.ts`): Phase 1 = profile + my tasks, Phase 2 = org users + all org tasks (eliminates waterfall).

**Task Terminology**:
- "Owner" = `created_by` user
- "Assignee" = `assigned_to` user
- "To-do" = single-person task; "Task" = multi-person task

**Task Service** (`lib/task-service.ts`): Central business logic consumed by components, AI agents, API routes, and WhatsApp flows. Key functions: `isTodo()`, `isActive()`, `isOverdue()`, `isAccepted()`, `isPendingAcceptance()`, `getParticipantCount()` (recursive), `getPendingInfo()`.

**Supabase Clients**: Three distinct clients for different contexts:
- `lib/supabase/client.ts` — browser-side
- `lib/supabase/server.ts` — server-side / API routes
- `lib/supabase/admin.ts` — admin operations (service role key)

### Notification System (`lib/notifications/`)

Multi-channel notification engine (WhatsApp text, voice calls, or both):
- `whatsapp-notifier.ts` — Handles task events (created, accepted, rejected, completed, overdue, etc.)
- `task-notification-scheduler.ts` — Schedules notifications in 4 stages: acceptance followups, reminder, escalation, deadline_approaching
- `task-notification-processor.ts` — Cron-driven execution of scheduled notifications
- `daily-summary.ts` — Sends aggregated daily summaries at 8 AM IST using atomic insert-as-lock pattern (unique constraint dedup)
- `business-hours.ts` — Enforces 9 AM–9 PM IST, skips Sundays
- Deduplication via `dedup_key` = `task_id:stage:stage_number:target_role:channel` with partial unique index

### AI Message Processing (`lib/ai/`)

Single-pass unified analysis using Gemini (Flash Lite Preview, temperature=0.1, JSON output):
- `intent-classifier.ts` / `message-analyzer.ts` — Extracts WHO/WHAT/WHEN/INTENT in one Gemini call
- `system-prompts.ts` — Extraction rules with Hindi relative date conversion (kal=tomorrow, parso=day after) to ISO 8601 IST
- `task-resolver.ts` — Fuzzy-matches extracted task hints against user's actual tasks
- `phonetic-match.ts` — Fuzzy name matching for employee selection (handles Hindi phonetics)
- `action-extractor.ts` — Converts intent to structured action data
- 15 intent types including task_create, todo_create, task_edit, reminder_create, status_query, auth_signin

### Voice & Audio (`lib/sarvam.ts`, `lib/notifications/calling-service.ts`)

- Sarvam AI Saaras v3 for speech-to-text (OGG/MP3/MP4/WAV/WebM from WhatsApp)
- Vendored lamejs (`lib/vendor/lame.all.js`) for WAV→MP3 conversion at 64 kbps (lazy-loaded, graceful fallback to WAV)
- Pluggable calling service abstraction (Twilio/Plivo) for voice call notifications
- IVR endpoints: `/api/internal/plivo-answer`, `/api/internal/twilio-answer`

### WhatsApp Flows

The most complex subsystem. See `WHATSAPP_FLOWS_CONTEXT.md` for full context.

- **Encryption** (`lib/whatsapp-flows/crypto.ts`): RSA-OAEP + AES-128-GCM. Uses `node-forge` instead of Node.js crypto because Vercel serverless doesn't support OpenSSL-based RSA.
- **Screen logic** (`lib/whatsapp-flows/screens.ts`): Routes between task management screens (DASHBOARD → TASK_LIST → TASK_DETAIL); each screen fetches and transforms Supabase data.
- **DB queries** (`lib/whatsapp-flows/task-queries.ts`): Dedicated query functions for flow screens.
- **Endpoint** (`app/api/whatsapp-flows/endpoint/route.ts`): Handles Meta health checks and decrypts/encrypts flow payloads.
- **Webhook** (`app/api/webhook/whatsapp/route.ts`): Receives incoming WhatsApp messages, triggers flows on keyword detection.
- Commit action deduplication (30-second window) to prevent duplicate side-effects from slow connectivity.
- RSA keys are stored as `WHATSAPP_FLOWS_PRIVATE_KEY` env var (base64). PEM files (`flow_private.pem`, `flow_public.pem`) are local dev copies — never commit the private key.

### Cron Jobs (`app/api/cron/process-reminders/`)

Runs every 5 minutes. Two-phase processing:
1. Phase 1 (8 AM–8:15 AM IST): Daily summaries first, isolated failure handling
2. Phase 2 (always): Task notifications processed independently

In-memory concurrency guard (single Node instance on Railway). Does not protect across multiple replicas.

### API Routes (`app/api/`)

- `/api/whatsapp-flows/endpoint` — Meta Flow health check + encrypted payload handler
- `/api/webhook/whatsapp/` — Incoming WhatsApp messages (rate-limited: 30 msg/60s per sender, 5-min message dedup)
- `/api/tasks/*` — Task CRUD
- `/api/users/*` — User management
- `/api/cron/*` — Scheduled jobs
- `/api/internal/*` — Requires `INTERNAL_PROCESSOR_SECRET` header (call audio, voice IVR, test endpoints)
- `/api/auth/verify-link` — Token-based auth verification
- `/api/keep-warm` — Prevents cold starts

### Frontend (`app/(dashboard)/`)

Route groups use Next.js App Router conventions. Dashboard layout applies to all routes under `(dashboard)/`. Key views: home, tasks, assigned-tasks, my-tasks, todos, calendar, stats, team, settings, profile.

**Inline App Shell**: Dashboard layout renders a pure HTML/CSS skeleton with inline styles (no JS dependencies) that shows before hydration, with shimmer animation removed on mount.

**Rate Limiting** (`lib/rate-limit.ts`): In-memory sliding-window Map per namespace. Per-process only (best-effort on serverless). Stale entry cleanup every 5 minutes.

### Non-Obvious Patterns

- **Known Users Cache** (webhook): 10-minute TTL cache avoids repeated DB lookups. Does NOT cache negative results so new signups are found immediately.
- **Participant Chain Walking**: Notifications walk up `parent_task_id` links (max 3 levels), deduplicating users to avoid circular references.
- **Inline Confirmation Flag**: When WhatsApp bot sends confirmation, sets `inlineConfirmationSent: true` so the notification system excludes the actor (prevents duplicates).
- **Database Locking**: Daily summary uses atomic insert with unique constraint — conflict error (code 23505) means another run already claimed today.

## Environment Variables

See `.env.local.example` for full list. Key vars:
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_FLOWS_PRIVATE_KEY` (base64 RSA private key)
- `WHATSAPP_FLOW_ID`, `WHATSAPP_FLOW_TEMPLATE`
- `INTERNAL_PROCESSOR_SECRET`
- `GEMINI_API_KEY`

## Build Optimizations (next.config.mjs)

- `output: 'standalone'` for Railway containerization
- `console.log` stripped in production (keeps `error`/`warn`)
- Supabase client excluded from server bundle (-47.5 KB)
- Package import optimization for lucide-react, date-fns, react-query, supabase
- `/supabase-proxy` rewrite to Supabase URL
- Static assets cached for 1 year via `vercel.json`

## Tailwind Theme

Custom color system via CSS variables: `todo`, `owned`, `assigned`, `overdue` — each with 50–900 shade variants. `accent` (yellow-based) for highlights. Shimmer keyframes for skeleton animations.

## TypeScript

Strict mode enabled. Path alias `@/*` maps to the project root.
