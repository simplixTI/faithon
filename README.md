# FaithOn

> _Never face a difficult day alone._

A spiritual companion delivered through text messages — prayer, biblical
wisdom, devotionals, and gentle encouragement. A **SIMPLIX LLC** project.

---

## Stack

- **Static marketing site** — vanilla HTML/CSS/JS ([public/index.html](public/index.html))
- **Backend** — Node.js + Express ([server.js](server.js), [routes/](routes/), [lib/](lib/))
- **Backoffice** — Next.js 15 + TypeScript + Supabase Auth ([admin/](admin/))
- **Database** — Supabase (Postgres + RLS)
- **Payments** — Stripe Checkout (subscription, $1.99/mo)
- **SMS** — Twilio (10DLC, deferred setup)
- **AI** — OpenAI (`gpt-4o-mini` primary, `gpt-4o` fallback)
- **Orchestration** — n8n workflows
- **Hosting** — Vercel (marketing + API in one project, admin in another)

---

## Documentation

Read the docs in this order:

1. [ARCHITECTURE.md](docs/ARCHITECTURE.md) — system diagram + data flow
2. [DATABASE.md](docs/DATABASE.md) — schema, enums, views, helper functions
3. [SUPABASE_SETUP.md](docs/SUPABASE_SETUP.md) — migrations + first admin promotion
4. [ADMIN_GUIDE.md](docs/ADMIN_GUIDE.md) — how to use the backoffice
5. [STRIPE_SETUP.md](docs/STRIPE_SETUP.md) — product/price/webhook
6. [TWILIO_SETUP.md](docs/TWILIO_SETUP.md) — 10DLC + webhook wiring
7. [N8N_WORKFLOWS.md](docs/N8N_WORKFLOWS.md) — payload contracts + workflow specs
8. [SECURITY.md](docs/SECURITY.md) — secrets, RLS, hardening, rotation
9. [DEPLOYMENT.md](docs/DEPLOYMENT.md) — Vercel + subdomain setup
10. [GO_LIVE_CHECKLIST.md](docs/GO_LIVE_CHECKLIST.md) — final gates before turning it on

---

## Local development

```bash
# Marketing + API (:5500)
npm install
cp .env.example .env       # fill values (see below)
npm start

# Admin (:3000)
cd admin
npm install
cp .env.example .env.local
npm run dev
```

### Required env vars (root .env)

| Key                          | Required | Notes                                     |
|------------------------------|:--------:|-------------------------------------------|
| `SUPABASE_URL`               |    ✓     |                                           |
| `SUPABASE_SERVICE_ROLE_KEY`  |    ✓     | server only, bypasses RLS                 |
| `SUPABASE_ANON_KEY`          |    ✓     |                                           |
| `STRIPE_SECRET_KEY`          |    ✓     | LIVE mode active — see docs/SECURITY.md   |
| `STRIPE_PUBLISHABLE_KEY`     |    ✓     |                                           |
| `STRIPE_WEBHOOK_SECRET`      |    ✓     | from Stripe → Webhooks                    |
| `STRIPE_PLUS_PRICE_ID`       |   opt    | preferred over lazy-creating the price    |
| `TWILIO_ACCOUNT_SID`         |   opt    | deferred                                  |
| `TWILIO_AUTH_TOKEN`          |   opt    | required in prod for signature validation |
| `TWILIO_PHONE_NUMBER`        |   opt    | deferred                                  |
| `OPENAI_API_KEY`             |   opt    | deferred                                  |
| `OPENAI_MODEL`               |   opt    | default `gpt-4o-mini`                     |
| `OPENAI_FALLBACK_MODEL`      |   opt    | default `gpt-4o`                          |
| `N8N_WEBHOOK_SECRET`         |   opt    | required for n8n endpoints to work        |
| `CRON_SECRET`                |   opt    | required for cron endpoints               |
| `APP_URL`                    |   opt    | e.g. `https://www.faithon.ai`             |

See [`.env.example`](.env.example) for the full list.

---

## API surface (mounted under `/api`)

| Route                              | Purpose                                     | Auth                     |
|------------------------------------|---------------------------------------------|--------------------------|
| `GET  /config`                     | publishable Stripe key                      | public                   |
| `GET  /health`                     | server + integration status                 | public                   |
| `POST /create-checkout-session`    | start Stripe Checkout                       | public (rate-limit soon) |
| `POST /stripe/portal`              | open Stripe billing portal                  | public                   |
| `POST /stripe/webhook`             | Stripe events (idempotent)                  | signature                |
| `POST /twilio/inbound`             | Twilio inbound SMS (commands + logging)     | signature                |
| `POST /twilio/status`              | Twilio status callback                      | signature                |
| `POST /n8n/heartbeat`              | n8n uptime ping → `system_health`           | `x-n8n-secret`           |
| `POST /n8n/execution`              | log a workflow run                          | `x-n8n-secret`           |
| `GET  /entitlement/:phone`         | can this user receive a reply now?          | `x-n8n-secret`           |
| `POST /usage/record`               | record tokens + SMS cost                    | `x-n8n-secret`           |
| `POST /cron/expire-trials`         | downgrade users past trial                  | `x-cron-secret`          |
| `POST /cron/expire-grace`          | downgrade users past grace period           | `x-cron-secret`          |
| `POST /cron/reset-daily`           | prune old usage rows                        | `x-cron-secret`          |

---

## Project structure

```
.
├── public/               marketing site (vanilla HTML/CSS/JS + logo)
│   ├── index.html
│   └── logo.png
├── server.js             thin Express bootstrap
├── routes/               API route modules
│   ├── config.js
│   ├── checkout.js
│   ├── stripe-webhook.js
│   ├── twilio.js
│   ├── n8n.js
│   ├── entitlement.js
│   ├── usage.js
│   └── cron.js
├── lib/                  shared server helpers
│   ├── supabase.js
│   ├── phone.js
│   ├── users.js
│   ├── twilio-validate.js
│   └── cost.js
├── admin/                Next.js 15 backoffice (separate deploy)
│   ├── app/
│   ├── components/
│   ├── lib/
│   └── middleware.ts
├── supabase/
│   └── migrations/
│       ├── 20260609000000_initial_schema.sql
│       └── 20260806000000_admin_and_operations.sql
├── docs/                 (see above)
├── api/index.js          Vercel handler → server.js
├── vercel.json
└── .env.example
```

---

## License

Proprietary © SIMPLIX LLC. All rights reserved.
