# Deployment (Vercel)

Two apps are deployed independently:

## App 1 — Marketing site + API (`/`)

Existing Vercel project. `api/index.js` re-exports `server.js` as a
serverless function. `vercel.json` rewrites `/api/*` → `/api`.

### Env vars (Vercel → Settings → Environment Variables)

Required (Production):
```
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
STRIPE_SECRET_KEY
STRIPE_PUBLISHABLE_KEY
STRIPE_WEBHOOK_SECRET
STRIPE_PLUS_PRICE_ID
```

Add when integrations come online:
```
TWILIO_ACCOUNT_SID
TWILIO_AUTH_TOKEN
TWILIO_PHONE_NUMBER
OPENAI_API_KEY
N8N_WEBHOOK_SECRET
CRON_SECRET
APP_URL=https://www.faithon.ai
```

### Cron jobs (Vercel Cron)

Create in `vercel.json`:

```json
{
  "crons": [
    { "path": "/api/cron/expire-trials?secret=REPLACE", "schedule": "0 * * * *" },
    { "path": "/api/cron/expire-grace?secret=REPLACE",  "schedule": "0 * * * *" },
    { "path": "/api/cron/reset-daily?secret=REPLACE",   "schedule": "5 3 * * *" }
  ]
}
```

Prefer routing crons through n8n if you already have it — you get one
place to see all scheduled runs.

## App 2 — Admin (`admin/`)

Recommended: **separate Vercel project** pointed at the `admin/` root.
Deploy on subdomain `admin.faithon.ai`.

### Setup

1. Import the repo again in Vercel; set **Root Directory** = `admin`.
2. Framework preset: Next.js.
3. Env vars (Production):
   ```
   NEXT_PUBLIC_SUPABASE_URL
   NEXT_PUBLIC_SUPABASE_ANON_KEY
   SUPABASE_SERVICE_ROLE_KEY
   ```
4. Custom domain: `admin.faithon.ai` → Vercel gives DNS records.
5. In Supabase → **Auth → URL Configuration**, add the admin URL to
   the allowed list:
   - Site URL: `https://admin.faithon.ai`
   - Redirect URLs: `https://admin.faithon.ai/auth/callback`

### Alternative — single project

If you prefer to keep one Vercel project, set
`admin/next.config.mjs`'s `basePath: '/admin'` and add a rewrite in
the root `vercel.json`. This makes deployment tighter but the two
apps' env vars have to be reconciled (they conflict on
`SUPABASE_SERVICE_ROLE_KEY`).

## Local dev

```bash
# Terminal 1 — API + marketing on :5500
npm install
npm start

# Terminal 2 — admin on :3000
cd admin
npm install
npm run dev
```

Visit:
- Marketing: <http://localhost:5500>
- Admin: <http://localhost:3000/login>

For magic-link auth to work locally, add `http://localhost:3000` to
Supabase's allowed redirect URLs.
