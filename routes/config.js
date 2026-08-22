const express = require('express');
const { supabase } = require('../lib/supabase');
const { heartbeat } = require('../lib/system-health');
const router = express.Router();

router.get('/config', (_req, res) => {
  res.json({
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
  });
});

router.get('/health', async (_req, res) => {
  let supaOk = false, supaErr = null;
  try {
    const { error } = await supabase.from('users').select('id').limit(1);
    supaOk = !error;
    supaErr = error?.message || null;
  } catch (e) { supaErr = e.message; }

  // Report own health to the admin dashboard.
  await heartbeat('api', 'ok', { checked_at: new Date().toISOString() });
  await heartbeat('database', supaOk ? 'ok' : 'down', { error: supaErr });

  res.json({
    server: 'ok',
    supabase: supaOk ? 'connected' : 'error',
    supabase_detail: supaErr,
    stripe: !!process.env.STRIPE_SECRET_KEY ? 'configured' : 'missing',
    smsgate: !!process.env.SMSGATE_URL ? 'configured' : 'missing',
    openai: !!process.env.OPENAI_API_KEY ? 'configured' : 'missing',
    webhook_secret: !!process.env.STRIPE_WEBHOOK_SECRET ? 'set' : 'unset (dev)',
  });
});

module.exports = router;
