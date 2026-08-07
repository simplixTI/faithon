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

## App 2 — Admin (`admin/`) served under `faithon.ai/admin`

The admin is a separate Vercel project (name: `faithon-admin`) but the
public URL is `https://faithon.ai/admin/*`. Two things make it work:

1. `admin/next.config.mjs` sets `basePath: "/admin"` so Next.js
   generates internal routes and asset URLs under `/admin/*`.
2. Root `vercel.json` on the main project rewrites:
   ```json
   { "source": "/admin/:path*",
     "destination": "https://faithon-admin.vercel.app/admin/:path*" }
   ```
   Vercel proxies the request, forwards cookies, and rewrites
   response headers. To the browser, everything looks like one origin.

### Setup

1. Import the repo again in Vercel; **name it `faithon-admin`** and
   set **Root Directory** = `admin`.
2. Framework preset: Next.js (auto-detected).
3. Env vars (Production):
   ```
   NEXT_PUBLIC_SUPABASE_URL
   NEXT_PUBLIC_SUPABASE_ANON_KEY
   SUPABASE_SERVICE_ROLE_KEY
   ```
4. **No custom domain needed on this project** — the main project's
   rewrite handles routing.
5. In Supabase → **Auth → URL Configuration**:
   - Site URL: `https://faithon.ai`
   - Redirect URLs (add these):
     - `https://faithon.ai/admin/auth/callback`
     - `http://localhost:3000/admin/auth/callback` (for local dev)

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
