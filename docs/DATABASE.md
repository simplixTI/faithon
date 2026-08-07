# FaithOn — Database reference

Postgres 15 on Supabase. All tables in `public` schema. RLS enabled
throughout. Migrations live in `supabase/migrations/` and are applied
with `supabase db push` (linked project).

## Enums

- `user_tier` — `free | plus` (denormalized on `users.tier`)
- `subscription_status` — Stripe's set: `trialing | active | past_due | canceled | unpaid | incomplete | incomplete_expired | paused`
- `message_role` — `user | companion | system` (for AI chat)
- `admin_role` — `super_admin | support_admin`
- `access_status` — user's effective access: `trial | active | free | past_due | grace_period | blocked | opted_out | deleted`
- `sms_direction` — `inbound | outbound`
- `sms_status` — `queued | sending | sent | delivered | undelivered | failed | received | read`
- `workflow_status` — `running | success | failed | timeout | skipped`
- `alert_severity` — `info | warning | critical`
- `alert_status` — `open | acknowledged | resolved`
- `system_component` — `twilio | stripe | n8n | openai | database | api | cron`
- `deletion_status` — `requested | processing | completed | rejected`

## Tables (grouped)

### Identity + access

| Table              | Purpose                                                   |
| ------------------ | --------------------------------------------------------- |
| `users`            | SMS subscribers. Primary key = uuid; unique key = `phone_e164`. Hot-path fields: `tier`, `access_status`, `trial_ends_at`, `grace_period_ends_at`, `daily_limit_override`, `blocked_reason`. |
| `user_consents`    | 10DLC/TCPA compliance: opt_in/out timestamps, sources.    |
| `user_entitlements`| Source-of-truth entitlement snapshot per user.            |
| `plans`            | `free` + `plus`. Free never has a Stripe row.             |
| `subscriptions`    | Mirrored from Stripe. Keyed by `stripe_subscription_id`.  |
| `subscription_events` | Every lifecycle event (audit).                         |
| `payment_events`   | Every invoice paid/failed. `stripe_event_id` unique.      |

### Content + activity

| Table              | Purpose                                                   |
| ------------------ | --------------------------------------------------------- |
| `conversations`    | Chat threads (one per user typically).                    |
| `messages`         | Chat turns. **RLS: super_admin only.**                    |
| `sms_messages`     | Twilio mirror. Includes `command`, `num_segments`, `price_cents`. |
| `sms_webhook_events` | Raw Twilio events (idempotency).                        |
| `ai_usage_events`  | Per-turn OpenAI tokens + cost.                            |
| `usage_daily`      | Aggregate per user per day. Enforces free-tier limit.     |
| `usage_monthly`    | Aggregate per user per YYYY-MM.                           |
| `prayer_requests`  | Optional structured prayers.                              |
| `devotionals`      | Content library, `audience` = `all` / `plus_only`.        |
| `verses`           | Scripture library, gin-indexed on `themes`.               |

### Admin + ops

| Table                    | Purpose                                             |
| ------------------------ | --------------------------------------------------- |
| `admin_users`            | FK to `auth.users`. Role gate for the admin app.    |
| `admin_audit_logs`       | Every admin action.                                  |
| `app_settings`           | Non-secret key/value config. Editable in `/settings`.|
| `system_health`          | Latest heartbeat per component.                     |
| `system_alerts`          | Backoffice-visible alerts. Ack + resolve tracked.   |
| `workflow_executions`    | n8n execution log.                                  |
| `stripe_webhook_events`  | Raw Stripe events (idempotency).                    |
| `data_deletion_requests` | GDPR-style deletion queue.                          |

## Views

- `v_user_counts` — totals + breakdowns by tier/status/activity window.
- `v_subscription_counts` — Stripe status counts.
- `v_mrr` — sum of active/trialing subs × `plans.price_cents`.

## Helper functions

- `is_phone_plus(phone text) → boolean` — one-call tier check for the SMS handler.
- `is_admin(uid uuid default auth.uid()) → boolean` — RLS gate.
- `is_super_admin(uid uuid default auth.uid()) → boolean` — RLS gate.
- `promote_to_admin(email citext, role admin_role default 'super_admin') → admin_users` — bootstrap.
- `set_updated_at()` — trigger function used across tables.

## Applying migrations

```bash
export SUPABASE_ACCESS_TOKEN=<personal-access-token>
supabase link --project-ref <ref>
supabase db push          # prompts for confirmation
supabase db push --include-all   # non-interactive (blocked in some sandboxes)
```

Migrations are idempotent (use `IF NOT EXISTS` / `DO` blocks) — safe to
re-run against an already-migrated database.
