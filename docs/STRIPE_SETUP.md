# Stripe setup

## ⚠️ This project runs on LIVE Stripe keys

Assume real money moves. Never test destructive operations against the
live account. For local dev create a **restricted key** (starts with
`rk_live_…`) scoped only to Read + Checkout Sessions + Billing Portal
+ Webhooks. Store it as `STRIPE_SECRET_KEY` in your local `.env` —
your local server won't be able to accidentally issue refunds.

## 1. Create the FaithOn Plus product

Stripe Dashboard → Products → Add product.

- Name: `FaithOn Plus`
- Add price: `$1.99 USD` / monthly, recurring
- Metadata (product): `slug=faithon-plus`
- Metadata (price):   `slug=faithon-plus-monthly`

Copy the **Price ID** (starts with `price_…`) into `.env`:

```bash
STRIPE_PLUS_PRICE_ID=price_xxxxxxxxxxxxxxxxxx
```

The server prefers this env var. If unset, it will lazily create the
product/price on first checkout — safe for dev but avoid in live.

## 2. Wire the webhook

Dashboard → Developers → Webhooks → Add endpoint.

- URL: `https://www.faithon.ai/api/stripe/webhook`
- Events to send:
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `customer.subscription.paused`
  - `customer.subscription.resumed`
  - `invoice.paid`
  - `invoice.payment_failed`

Copy the **Signing secret** into `.env`:

```bash
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxx
```

## 3. Enable the customer billing portal

Dashboard → Settings → Billing → Customer portal → Activate.

Enable the actions you want customers to have (update payment method,
cancel subscription, view invoices). Our `/api/stripe/portal` endpoint
creates portal sessions on demand.

## 4. Idempotency

The webhook handler stores every event in `stripe_webhook_events`
keyed on `event.id`. Duplicate deliveries are no-ops (return
`{received: true, idempotent: true}`).

## 5. What happens on payment failure

`invoice.payment_failed` writes to `payment_events`, flips the user to
`access_status='grace_period'` with `grace_period_ends_at = now() +
grace_period_hours` (default 72h from `app_settings`), and opens a
`system_alerts` row. The `expire-grace` cron job checks Stripe status
after the window and downgrades to Free if still unpaid — the user is
never bulk-blocked from spiritual support just for not paying.
