// =====================================================================
// FaithOn — server (thin bootstrap; routes live in ./routes)
//   • Serves the marketing site at public/index.html
//   • Mounts /api/* routes:
//       config      — GET  /api/config, /api/health
//       checkout    — POST /api/create-checkout-session, /api/stripe/portal
//       stripe hook — POST /api/stripe/webhook (raw body; mounted early)
//       sms       — POST /api/sms/incoming, /api/sms/status
//       n8n       — POST /api/n8n/heartbeat, /api/n8n/execution
//       entitlement — GET  /api/entitlement/:phone
//       usage       — POST /api/usage/record
//       cron        — POST /api/cron/{expire-trials, expire-grace, reset-daily, devotional}
// =====================================================================
require('dotenv').config();

const express = require('express');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT) || 5500;

// Basic hardening headers
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// -------- Stripe webhook FIRST (needs raw body) --------
app.use('/api', require('./routes/stripe-webhook'));

// -------- JSON middleware for remaining routes --------
app.use(express.json());

app.use('/api', require('./routes/config'));
app.use('/api', require('./routes/checkout'));
app.use('/api', require('./routes/n8n'));
app.use('/api', require('./routes/entitlement'));
app.use('/api', require('./routes/usage'));
app.use('/api', require('./routes/cron'));
app.use('/api', require('./routes/sms'));

// -------- SMS deep-link shortcut --------
// /pray serves a small landing page that auto-opens the user's SMS app
// with the FaithOn number and "PRAY" pre-filled. The page also shows a
// fallback button for browsers that block automatic sms: redirects.
// Configure the number via FAITHON_SMS_NUMBER (hardcoded fallback below).
app.get('/pray', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pray.html'));
});

// -------- Static marketing site --------
app.use(express.static(path.join(__dirname, 'public')));
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// -------- Error handler (never leak stack in prod) --------
app.use((err, _req, res, _next) => {
  console.error('unhandled:', err);
  const isProd = process.env.NODE_ENV === 'production';
  res.status(500).json({ error: isProd ? 'internal error' : err.message });
});

// -------- Local dev listener (Vercel imports the app; no listen() there) --------
if (require.main === module) {
  app.listen(PORT, () => {
    console.log('━'.repeat(60));
    console.log(`✦ FaithOn server  http://localhost:${PORT}`);
    console.log('━'.repeat(60));
    console.log(`  stripe:     ${process.env.STRIPE_SECRET_KEY ? 'configured' : 'MISSING'}`);
    console.log(`  supa:       ${process.env.SUPABASE_URL ? 'configured' : 'MISSING'}`);
    console.log(`  sms:        ${process.env.SMS_PROVIDER || 'smsgate'}`);
    console.log(`  smsgate:    ${process.env.SMSGATE_URL || '192.168.15.2:8080'}`);
    console.log(`  ai:         ${process.env.AI_PROVIDER || 'not set'}`);
    console.log(`  ai model:   ${process.env.AI_MODEL || 'default'}`);
    console.log(`  deepseek:   ${process.env.DEEPSEEK_API_KEY ? 'configured' : 'MISSING'}`);
    console.log(`  openai:     ${process.env.OPENAI_API_KEY ? 'configured' : 'DEFERRED'}`);
    console.log(`  n8n key:    ${process.env.N8N_WEBHOOK_SECRET ? 'set' : 'unset'}`);
    console.log(`  cron:       ${process.env.CRON_SECRET ? 'set' : 'unset'}`);
    console.log('━'.repeat(60));
  });
}

module.exports = app;
