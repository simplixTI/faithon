# FaithOn — Architecture

## System map

```
                         ┌─────────────────────────────┐
                         │  Public visitor / SMS user  │
                         └──────────────┬──────────────┘
                                        │
        ┌───────────────────────────────┼──────────────────────────────────┐
        │                               │                                  │
        ▼                               ▼                                  ▼
 ┌──────────────┐              ┌─────────────────┐                ┌────────────────┐
 │  Marketing   │              │   SMS (Twilio)  │                │ Stripe Checkout│
 │  (public/*)  │              │                 │                │ + Portal       │
 │  vanilla html│              └────────┬────────┘                └────────┬───────┘
 └──────┬───────┘                       │                                  │
        │                     POST /api/twilio/inbound         POST /api/stripe/webhook
        │                               │                                  │
        ▼                               ▼                                  ▼
 ┌────────────────────────────────────────────────────────────────────────────────┐
 │  Express (server.js) — routes/                                                  │
 │  ── config, checkout, stripe-webhook, twilio, n8n, entitlement, usage, cron ──  │
 └────────────────────────────────┬───────────────────────────────────────────────┘
                                  │
                    ┌─────────────┼──────────────┐
                    ▼             ▼              ▼
              ┌──────────┐  ┌──────────┐  ┌─────────────┐
              │ Supabase │  │   n8n    │  │   OpenAI    │
              │ Postgres │  │workflows │  │ (gpt-4o…)   │
              │ + Auth   │  │          │  └─────────────┘
              └────┬─────┘  └────┬─────┘
                   │             │
                   │       POST /api/n8n/heartbeat
                   │       POST /api/n8n/execution
                   │       GET  /api/entitlement/:phone
                   │       POST /api/usage/record
                   │
                   ▼
        ┌────────────────────┐
        │  Admin (Next.js)   │
        │  /admin/*          │
        │  Supabase Auth SSR │
        │  requireAdmin gate │
        └────────────────────┘
```

## Repos & processes

| Concern              | Runtime         | Path                  | Entry                |
| -------------------- | --------------- | --------------------- | -------------------- |
| Marketing site       | Static + Node   | `public/`, `server.js`| Express + `api/index.js` on Vercel |
| API + webhooks       | Node/Express    | `server.js`, `routes/`| same as above        |
| Backoffice           | Next.js 15 (RSC)| `admin/`              | separate Vercel project (recommended) |
| Database             | Supabase Postgres| `supabase/migrations/`| Managed              |
| Auth                 | Supabase Auth   | (magic link)          | Managed              |
| Workflows            | n8n             | external              | Talks to our API via `x-n8n-secret` |

## Data flow — inbound PRAY

1. User texts `PRAY` to the FaithOn number.
2. Twilio POSTs the webhook to `/api/twilio/inbound`.
3. Server validates the Twilio signature, checks idempotency
   (`sms_webhook_events`), upserts the user, starts a Plus trial for
   first-touch users, and records the inbound SMS + increments
   `usage_daily`.
4. For `STOP`/`START`/`HELP`, the server responds with TwiML directly.
   For `PRAY` (or anything else), the server returns empty TwiML —
   generation of the reply is deferred to the n8n workflow.
5. n8n's inbound workflow polls (or is fanned to by another trigger),
   calls `GET /api/entitlement/:phone` to check the daily limit, calls
   OpenAI, sends the reply via Twilio, then calls
   `POST /api/usage/record` with token counts.

## Access model (RLS)

- `service_role` bypasses RLS — used by the Express server and by the
  admin app for privileged reads/writes.
- `authenticated` users of the admin app hit RLS policies that check
  `public.is_admin(auth.uid())`.
- Marketing site never authenticates against Supabase.
- Conversation content (`conversations`, `messages`) is
  **super_admin only** — support admins see metadata but not bodies.

## Cost accounting

Every AI generation is written to `ai_usage_events` with token counts.
Every SMS is written to `sms_messages` with segments. Rates from
`app_settings` (dashboard-editable) multiply into
`estimated_cost_cents` on both `usage_daily` and `usage_monthly`.
MRR estimate = sum of active/trialing subs joined on `plans` price.
