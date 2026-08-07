# n8n workflows — payload contracts

The n8n instance authenticates to our API with a shared secret header:

```
x-n8n-secret: <N8N_WEBHOOK_SECRET>
```

Set `N8N_WEBHOOK_SECRET` in both the root `.env` and in n8n's
Credentials as an HTTP Header credential.

## API endpoints n8n can call

### `GET /api/entitlement/:phone`

Check whether a user is allowed to receive a reply.

**Response 200:**
```json
{
  "exists": true,
  "user_id": "uuid",
  "phone_e164": "+15551234567",
  "plan": "plus",
  "access_status": "trial",
  "trial_ends_at": "2026-08-09T00:00:00Z",
  "grace_ends_at": null,
  "daily_limit": 100,
  "daily_used": 12,
  "remaining": 88,
  "allowed": true,
  "reason": null
}
```

If `allowed: false`, honor `reason` and either send an upgrade prompt
(`app_settings.text_upgrade_link`) or the limit-reached copy
(`app_settings.text_limit_free`) instead of calling the LLM.

### `POST /api/usage/record`

Log AI generation + outbound SMS. Called after sending a reply.

**Body:**
```json
{
  "phone": "+15551234567",
  "model": "gpt-4o-mini",
  "tokens_input": 640,
  "tokens_output": 220,
  "latency_ms": 1140,
  "sms_direction": "outbound",
  "sms_segments": 2
}
```

Returns the cost that was recorded: `{ ok, ai_cost_cents, sms_cost_cents }`.

### `POST /api/n8n/heartbeat`

Ping the health monitor. Set on a `* * * * *` cron in n8n.

```json
{ "details": { "queue_depth": 3 } }
```

### `POST /api/n8n/execution`

Log an execution result. Auto-creates a `system_alerts` row on
`failed` or `timeout`.

```json
{
  "workflow_name": "inbound_sms",
  "execution_id": "1234",
  "status": "success",
  "started_at": "2026-08-06T18:00:00Z",
  "finished_at": "2026-08-06T18:00:02Z",
  "metadata": { "user_id": "uuid", "phone": "+15551234567" }
}
```

## Required workflows (spec §19)

### 1. Inbound SMS

Trigger: our webhook fans out to n8n **or** n8n polls
`sms_messages` for unhandled inbound rows.

```
[Trigger]
  → Normalize phone
  → GET /api/entitlement/:phone
  → allowed? no → send upgrade/limit copy via Twilio, log usage.record
              yes → OpenAI (system prompt + last N msgs from `messages`)
                  → Twilio.send(reply)
                  → POST /api/usage/record  (tokens + sms_direction=outbound)
                  → INSERT messages (role=companion, twilio_message_sid)
  → POST /api/n8n/execution (success)
```

### 2. Stripe checkout link via SMS

Triggered when a user replies "PLUS" or clicks upgrade in copy.

```
→ POST server /api/create-checkout-session { phone }
→ Twilio.send("Upgrade here: {url}")
→ POST /api/usage/record { sms_direction: outbound }
```

### 3. Stripe webhook fan-out (optional)

If you want n8n involved in Stripe events (e.g. to send a "Welcome to
Plus" SMS on `checkout.session.completed`), Stripe can send to n8n
in parallel with our server. Server already updates the DB; n8n only
handles the send side.

### 4. Trial expiry (cron)

Runs every hour.

```
→ POST server /api/cron/expire-trials
  (server downgrades users whose trial_ends_at < now and who have no
   active/trialing sub. Returns { processed, downgraded }.)
→ POST /api/n8n/execution
```

### 5. Grace period expiry (cron)

Runs every hour.

```
→ POST server /api/cron/expire-grace
→ POST /api/n8n/execution
```

### 6. Daily reconciliation

Runs at 03:00 UTC.

```
→ Query Stripe.subscriptions.list vs public.subscriptions;
  flag drift → POST server /api/cron/expire-trials again
→ Prune old usage rows: POST /api/cron/reset-daily
→ POST /api/n8n/execution
```

### 7. Reset / heartbeat

`* * * * *`: POST /api/n8n/heartbeat. If missing for > 5 minutes,
open a `system_alerts` critical.

## Cron endpoints secret

Cron routes use `x-cron-secret` (or `?secret=…`) matching `CRON_SECRET`.
Use a different secret from `N8N_WEBHOOK_SECRET` — they have different
blast radii.
