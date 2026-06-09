# FaithOn

> _Never face a difficult day alone._

A spiritual companion delivered through text messages — prayer, biblical
wisdom, devotionals, and gentle encouragement. A **SIMPLIX LLC** project.

---

## Stack

- **Static marketing site** — vanilla HTML/CSS/JS (`index.html`)
- **Backend** — Node.js + Express (`server.js`)
- **Payments** — Stripe Checkout (subscription, $0.99/mo)
- **Database** — Supabase (Postgres + RLS)
- **Hosting** — Vercel (serverless function via `api/index.js`)

---

## Local development

```bash
npm install
cp .env.example .env       # then fill in real keys
npm start                  # http://localhost:5500
```

### Required env vars

| Key                          | Where to get it                              |
|------------------------------|----------------------------------------------|
| `STRIPE_SECRET_KEY`          | Stripe → Developers → API keys (`sk_…`)      |
| `STRIPE_PUBLISHABLE_KEY`     | Stripe → Developers → API keys (`pk_…`)      |
| `STRIPE_WEBHOOK_SECRET`      | Stripe → Webhooks → endpoint signing secret  |
| `SUPABASE_URL`               | Supabase → Project Settings → API → URL      |
| `SUPABASE_SECRET_KEY`        | Supabase → API Keys → `sb_secret_…` (server) |
| `SUPABASE_PUBLISHABLE_KEY`   | Supabase → API Keys → `sb_publishable_…`     |
| `PORT`                       | optional, defaults to `5500`                 |

> The `service_role` JWT also works in `SUPABASE_SECRET_KEY` for backward
> compatibility.

---

## Database setup (one-time)

The schema lives in [`supabase/migrations/20260609000000_initial_schema.sql`](supabase/migrations/20260609000000_initial_schema.sql).

Apply it either via:

**A. Dashboard (recommended).** Open Supabase → SQL Editor → New query →
paste the file → Run. Migration is idempotent.

**B. CLI.**
```bash
supabase link --project-ref <your-ref>
supabase db push
```

### What's in the schema

| Table                      | Purpose                                              |
|----------------------------|------------------------------------------------------|
| `users`                    | SMS subscribers — phone is identity, `tier` gates content |
| `subscriptions`            | Stripe subscription mirror (webhook-maintained)      |
| `conversations`/`messages` | Full chat history                                    |
| `daily_usage`              | Rate limit for free tier (5/day)                     |
| `prayer_requests`          | Saved prayer requests                                |
| `devotionals`/`verses`     | Content libraries                                    |
| `stripe_webhook_events`    | Idempotency log for Stripe webhooks                  |
| `audit_log`                | Compliance / activity log                            |

Plus a view (`active_subscribers`) and a function (`is_phone_plus(phone)`)
for one-call tier checks from the SMS handler.

---

## Stripe webhook

Local testing:
```bash
stripe listen --forward-to localhost:5500/api/stripe/webhook
# copies a whsec_… → put it in .env as STRIPE_WEBHOOK_SECRET
```

Production (after Vercel deploy):
1. Stripe Dashboard → Webhooks → Add endpoint
2. URL: `https://<your-vercel-domain>/api/stripe/webhook`
3. Events: `checkout.session.completed`, `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted`
4. Copy the signing secret → Vercel env vars as `STRIPE_WEBHOOK_SECRET`

---

## Deploy to Vercel

1. Push to GitHub.
2. Import the repo in Vercel.
3. Add the env vars listed above (Production + Preview).
4. Deploy. The first deploy lazily creates the Stripe product+price.

`vercel.json` rewrites `/api/*` to the single Express function in
`api/index.js`. `index.html` is served statically.

---

## Project structure

```
.
├── api/
│   └── index.js                      # Vercel handler (re-exports server)
├── supabase/
│   └── migrations/
│       └── 20260609000000_initial_schema.sql
├── index.html                        # marketing site
├── server.js                         # Express app (local + Vercel)
├── package.json
├── vercel.json
└── .env.example
```

---

## License

Proprietary © SIMPLIX LLC. All rights reserved.
