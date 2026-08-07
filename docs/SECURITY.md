# Security posture

## Secrets

- **Never** commit `.env` (it's gitignored). The repo has `.env.example`.
- **service_role** Supabase key bypasses RLS — server only, never in a browser bundle.
- **STRIPE_SECRET_KEY** is `sk_live_*` today. For local dev use a
  **restricted key** (`rk_live_*`) scoped to Checkout Sessions +
  Portal + Webhooks so a bug can't refund customers.
- **STRIPE_WEBHOOK_SECRET** protects the webhook. Absence flips the
  route into a warning-only mode intended for local dev only.
- **N8N_WEBHOOK_SECRET** and **CRON_SECRET** are shared bearer tokens
  in the `x-n8n-secret` and `x-cron-secret` headers respectively.
  Different values — different blast radius.
- **TWILIO_AUTH_TOKEN** validates the `X-Twilio-Signature` header on
  inbound + status callbacks. Absence disables signature checking (dev
  only — prod deployments MUST have it set).

## Row-Level Security

Enabled on every table exposed to any client:
- `users`, `subscriptions`, `plans`, `app_settings`,
  `admin_users`, `admin_audit_logs`, `user_consents`,
  `user_entitlements`, `subscription_events`, `payment_events`,
  `sms_messages`, `usage_daily`, `usage_monthly`, `ai_usage_events`,
  `workflow_executions`, `system_health`, `system_alerts`,
  `data_deletion_requests`, `conversations`, `messages`.

Policies gate `authenticated` reads with `public.is_admin(auth.uid())`
or `public.is_super_admin(auth.uid())`. `service_role` bypasses RLS
by default (Supabase behavior). Anonymous cannot read anything.

`conversations` and `messages` are **super_admin only** to protect
sensitive content.

`sms_webhook_events` has no `authenticated` policy → service_role only.

## Webhooks — replay & idempotency

- `stripe_webhook_events` PK'd on `event.id`. Duplicate deliveries
  return `{received: true, idempotent: true}` without re-processing.
- `sms_webhook_events` PK'd on `MessageSid` (inbound) or
  `MessageSid:MessageStatus` (status callback). Same protection.
- Stripe signature verified via `stripe.webhooks.constructEvent`.
- Twilio signature verified via HMAC-SHA1 in `lib/twilio-validate.js`.

## Admin session

- Supabase Auth magic link (no passwords to leak).
- Session cookies refreshed on every request by `admin/middleware.ts`.
- `requireAdmin()` and `requireSuperAdmin()` run in every server
  component / route handler; they hit `admin_users` with the
  service-role client and redirect to `/login` if the record is
  missing, inactive, or the role is insufficient.

## Audit trail

Every mutation from the admin app writes to `admin_audit_logs` with
`admin_id`, `admin_email`, `action`, `target_type`, `target_id`,
optional `reason`, optional structured `metadata` (before/after for
settings). Reads of raw message bodies rely on RLS (super_admin only)
and are not extra-logged — add a wrapper if you need read-audit later.

## HTTP hardening

`server.js` sets `X-Content-Type-Options: nosniff`,
`X-Frame-Options: DENY`, `Referrer-Policy:
strict-origin-when-cross-origin`. Vercel adds TLS.

## Rate limiting

Not implemented at the API layer for MVP. Twilio + Stripe + Supabase
each have their own upstream limits. Add a per-IP limiter (e.g.
Upstash Ratelimit) before public beta.

## What to rotate when a secret leaks

| Leaked                | Rotate where                                    |
| --------------------- | ----------------------------------------------- |
| Supabase service_role | Dashboard → Settings → API → Reset              |
| Supabase anon         | Dashboard → Settings → API → Reset (redeploy)   |
| Supabase PAT          | Account → Access Tokens → Revoke                |
| Stripe secret         | Dashboard → Developers → API Keys → Roll        |
| Stripe webhook secret | Dashboard → Developers → Webhooks → Reveal/Roll |
| Twilio auth token     | Twilio Console → Account → Auth Tokens → Roll   |
| OpenAI key            | platform.openai.com → API Keys → Revoke         |
| N8N_WEBHOOK_SECRET    | Rotate the env var, redeploy, update n8n creds  |
| CRON_SECRET           | Same                                            |
