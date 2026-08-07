const express = require('express');
const { supabase } = require('../lib/supabase');
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
  res.json({
    server: 'ok',
    supabase: supaOk ? 'connected' : 'error',
    supabase_detail: supaErr,
    stripe: !!process.env.STRIPE_SECRET_KEY ? 'configured' : 'missing',
    twilio: !!process.env.TWILIO_AUTH_TOKEN ? 'configured' : 'missing',
    openai: !!process.env.OPENAI_API_KEY ? 'configured' : 'missing',
    webhook_secret: !!process.env.STRIPE_WEBHOOK_SECRET ? 'set' : 'unset (dev)',
  });
});

module.exports = router;
