# Go-live checklist

## Supabase

- [x] Project created (`wzslezbwfqxvvfewyacy`)
- [x] Migrations applied (`supabase db push`)
- [ ] First super admin promoted (`select promote_to_admin('brucnascimento@gmail.com','super_admin')`)
- [ ] SMTP configured (Auth → SMTP) — Supabase's default has strict rate limits
- [ ] Auth allowed redirect URLs include `https://admin.faithon.ai/auth/callback`

## Stripe

- [x] LIVE keys in root `.env` / Vercel Production
- [ ] Restricted key (`rk_live_*`) created for local dev (avoid write-blast on live account)
- [ ] `FaithOn Plus` product + $1.99/mo price created; `STRIPE_PLUS_PRICE_ID` set
- [ ] Webhook endpoint added: `https://www.faithon.ai/api/stripe/webhook`
      with events: checkout.session.completed, customer.subscription.*,
      invoice.paid, invoice.payment_failed
- [ ] Webhook signing secret set as `STRIPE_WEBHOOK_SECRET`
- [ ] Customer portal activated
- [ ] Test with `stripe listen --forward-to localhost:5500/api/stripe/webhook`

## Twilio (deferred — do before public SMS launch)

- [ ] US 10DLC-eligible number purchased
- [ ] A2P 10DLC brand + campaign registered (multi-day approval)
- [ ] `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` set
- [ ] Inbound webhook: `POST https://www.faithon.ai/api/twilio/inbound`
- [ ] Status callback: `POST https://www.faithon.ai/api/twilio/status`
- [ ] Send yourself PRAY and confirm a row in `sms_messages` + user in `users`

## n8n

- [ ] `N8N_WEBHOOK_SECRET` set in both `.env` and n8n HTTP header credential
- [ ] Heartbeat workflow running every minute
- [ ] Inbound-SMS workflow implemented (see docs/N8N_WORKFLOWS.md #1)
- [ ] Cron workflows (or Vercel Cron) hitting expire-trials / expire-grace / reset-daily hourly

## OpenAI

- [ ] `OPENAI_API_KEY` set
- [ ] `OPENAI_MODEL=gpt-4o-mini` and `OPENAI_FALLBACK_MODEL=gpt-4o`
- [ ] Prompt template stored somewhere versioned (recommend: `app_settings` under a new key `prompt_system_v1`)

## Vercel (marketing + API)

- [x] Production deploy of root project
- [ ] All env vars from `.env.example` set in Production
- [ ] Cron jobs added in `vercel.json`

## Vercel (admin)

- [ ] Second Vercel project pointed at `admin/`
- [ ] Custom domain `admin.faithon.ai` connected
- [ ] Env vars set (see docs/DEPLOYMENT.md)
- [ ] Login round-trip works (magic link → callback → dashboard)

## Smoke tests before turning on marketing

1. **Sign up**: `/admin/login` → magic link → sign in with a **new** email → get "not admin" bounce → promote via SQL → sign in → land on dashboard with zero-state (no crashes).
2. **Stripe**: create a Checkout session for a test phone → complete with a real card → confirm webhook fired (`stripe_webhook_events.processed_at IS NOT NULL`) → confirm `subscriptions` row created → confirm `users.tier='plus'`.
3. **Twilio**: text PRAY to the number → confirm `sms_webhook_events` row + `sms_messages` inbound row + user has `access_status='trial'` and `trial_ends_at` set 3d out.
4. **Entitlement**: `curl -H "x-n8n-secret: …" https://www.faithon.ai/api/entitlement/+15551234567` returns the expected shape.
5. **Cron**: manually POST `/api/cron/expire-trials` with the secret → returns `{ processed, downgraded }`.
6. **STOP**: text STOP → confirm `user_consents.opt_out=true`, `users.access_status='opted_out'`.
7. **Alert visibility**: force a bad n8n execution status → confirm a row appears in Operations and can be Ack/Resolve.

## Rotate everything one last time before launch

Anything that was ever pasted into a chat or screenshot:
- Supabase service_role JWT — rotate
- Stripe secret — rotate to a fresh `sk_live_*` (or use restricted key going forward)
- Supabase PAT — revoke

## Post-launch monitoring

- Dashboard → Operations → check heartbeats every morning
- Set up (optional) an email/Slack notifier via a `system_alerts` webhook
- Watch `system_alerts` open count as your on-call signal
