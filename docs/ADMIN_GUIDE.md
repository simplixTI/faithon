# Admin guide

## Sign in

1. Go to `/admin/login`.
2. Enter your admin email → check inbox for the sign-in link → open on
   the same device.
3. If your account isn't provisioned as an admin yet you'll be signed
   out with an error. Have a Super Admin run:
   ```sql
   select public.promote_to_admin('your@email.com', 'super_admin');
   ```

## Roles

| Role            | Can see                             | Can do                                                           |
| --------------- | ----------------------------------- | ---------------------------------------------------------------- |
| `super_admin`   | Everything                          | All actions, edit settings, request user deletions, read messages content, promote/demote admins. |
| `support_admin` | Everything except message bodies + settings | Reset limits, grant trial days, block/unblock, ack alerts.  |

## Screens

- **Dashboard** — users, MRR, today's SMS/AI, open alerts, component health.
- **Customers** — search by phone digits; filter by plan/status; export CSV. Open any row for full detail + actions.
- **Customer detail** — everything about the user in one page: trial + grace timelines, subscription (deep-link to Stripe), latest 10 SMS, 7-day usage bar, consents, admin history. Actions on the right.
- **Subscriptions** — Stripe status counts, MRR, filter, deep-link to Stripe.
- **Messages** — inbound/outbound counts (total + today), 24h delivery rate, command counts, latest 50 messages.
- **Operations** — component health, open alerts (with ack/resolve), n8n executions, recent webhook activity for Stripe and Twilio.
- **Settings** *(super_admin)* — edit JSON values in `app_settings`. Every change is audited with before/after.
- **Audit logs** — filter by action or admin email.

## Customer actions

Every action writes to `admin_audit_logs`.

- **Reset today's counter** — sets `usage_daily.message_count = 0` for the current date. Instant. Doesn't touch total counts.
- **Grant 3 extra Plus trial days** — extends `trial_ends_at`. If already ended, starts from today; if still active, adds to the existing end.
- **Block user** — sets `access_status = 'blocked'` with a required reason. The SMS pipeline stops responding to blocked users.
- **Unblock user** — reverts to `free`.
- **Request account deletion** *(super_admin only)* — queues a row in `data_deletion_requests`. Data isn't deleted immediately; the deletion is processed by a separate operator/procedure once reviewed.

## Reading conversation content

By default, only metadata is exposed. The `messages` and
`conversations` tables have RLS policies restricted to `super_admin`.
This is intentional — messages can contain highly sensitive content
(mental health, faith crises, family issues). Every read is
implicitly logged by the database query, and support admins should
not open these routinely.

## Settings you'll change often

| Key                          | Meaning                                         |
| ---------------------------- | ----------------------------------------------- |
| `trial_days`                 | Default trial length for new users.             |
| `free_daily_limit`           | Messages/day for Free tier.                     |
| `plus_fair_use_daily`        | Soft cap for Plus tier.                         |
| `grace_period_hours`         | How long a past-due user keeps Plus access.     |
| `price_display_usd`          | Price shown on marketing site (does not change Stripe). |
| `text_welcome`, `text_help`, `text_stop_ack`, `text_upgrade_link` | SMS copy templates. |
| `maintenance_mode`           | When true, the SMS handler returns a "brief pause" message. |

Prices at the Stripe layer are managed in Stripe Dashboard.
`app_settings.price_display_usd` is only for the marketing site.

## Alerts

Alerts appear in **Operations**. Two verbs:
- **Ack** — you've seen it, still working on it. Doesn't close.
- **Resolve** — closes the alert.

Sources today: `invoice_payment_failed`, `workflow_failed`. More
sources come online as we wire n8n further.

## When something is wrong

- **User complains no reply after PRAY**: open their record → check
  `access_status`, `trial_ends_at`, latest SMS status. If `opted_out`,
  they need to send `START` themselves.
- **Payment failed but Plus still active**: check `grace_period_ends_at`.
  Grace hasn't expired yet — that's normal.
- **Duplicate charge**: shouldn't happen — Stripe idempotency + our
  `stripe_webhook_events` table. Check the audit log for the event
  and open in Stripe.
