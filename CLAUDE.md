# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Boldo AI is a WhatsApp-first task management and accountability platform for Indian SMBs, built with Next.js 14 App Router and Supabase. It integrates WhatsApp Cloud API (Meta) for in-chat task management via encrypted WhatsApp Flows.

## Commands

```bash
npm run dev      # Start development server (localhost:3000)
npm run build    # Build for production
npm run lint     # Run ESLint
npm start        # Run production build
```

No test suite is configured.

## Architecture

### Key Patterns

**Authentication**: Supabase cookie-based sessions. `middleware.ts` does synchronous cookie checks only (no network calls, <1ms). Client-side token refresh handled in `lib/hooks/useAuth.ts`. Protected dashboard routes redirect unauthenticated users to `/login`.

**Data Fetching**: React Query (@tanstack/react-query) for client state + Supabase SSR for server-side auth. Persist client enabled for offline caching. Central task business logic lives in `lib/task-service.ts`, consumed by both frontend components and API routes.

**Task Terminology**:
- "Owner" = `created_by` user
- "Assignee" = `assigned_to` user
- "To-do" = single-person task; "Task" = multi-person task

**Supabase Clients**: Three distinct clients for different contexts:
- `lib/supabase/client.ts` — browser-side
- `lib/supabase/server.ts` — server-side / API routes
- `lib/supabase/admin.ts` — admin operations (service role key)

### WhatsApp Flows

The most complex subsystem. See `WHATSAPP_FLOWS_CONTEXT.md` for full context.

- **Encryption** (`lib/whatsapp-flows/crypto.ts`): RSA-OAEP + AES-128-GCM. Uses `node-forge` instead of Node.js crypto because Vercel serverless doesn't support OpenSSL-based RSA.
- **Screen logic** (`lib/whatsapp-flows/screens.ts`): Routes between task management screens; each screen fetches and transforms Supabase data.
- **DB queries** (`lib/whatsapp-flows/task-queries.ts`): Dedicated query functions for flow screens.
- **Endpoint** (`app/api/whatsapp-flows/endpoint/route.ts`): Handles Meta health checks and decrypts/encrypts flow payloads.
- **Webhook** (`app/api/webhook/whatsapp/route.ts`): Receives incoming WhatsApp messages, triggers flows on keyword detection.
- RSA keys are stored as `WHATSAPP_FLOWS_PRIVATE_KEY` env var (base64). PEM files (`flow_private.pem`, `flow_public.pem`) are local dev copies — never commit the private key.

### API Routes (`app/api/`)

- `/api/whatsapp-flows/endpoint` — Meta Flow health check + encrypted payload handler
- `/api/webhook/whatsapp/` — Incoming WhatsApp messages
- `/api/tasks/*` — Task CRUD
- `/api/users/*` — User management
- `/api/cron/*` — Scheduled jobs
- `/api/internal/*` — Requires `INTERNAL_PROCESSOR_SECRET` header
- `/api/keep-warm` — Prevents Vercel cold starts

### Frontend (`app/(dashboard)/`)

Route groups use Next.js App Router conventions. Dashboard layout applies to all routes under `(dashboard)/`. Key views: home, tasks, assigned-tasks, my-tasks, todos, calendar, stats, team, settings, profile.

## Environment Variables

See `.env.local.example` for full list. Key vars:
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_FLOWS_PRIVATE_KEY` (base64 RSA private key)
- `WHATSAPP_FLOW_ID`, `WHATSAPP_FLOW_TEMPLATE`
- `INTERNAL_PROCESSOR_SECRET`
- `GEMINI_API_KEY`

## Build Optimizations (next.config.mjs)

- `console.log` stripped in production (keeps `error`/`warn`)
- Supabase client excluded from server bundle (-47.5 KB)
- Package import optimization for lucide-react, date-fns, react-query, supabase
- `/supabase-proxy` rewrite to Supabase URL
- Static assets cached for 1 year via `vercel.json`

## TypeScript

Strict mode enabled. Path alias `@/*` maps to the project root.
