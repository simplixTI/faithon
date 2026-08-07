const express = require('express');
const { supabase } = require('../lib/supabase');

const router = express.Router();

function requireCron(req, res, next) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(503).json({ error: 'CRON_SECRET not configured' });
  const provided = req.headers['x-cron-secret'] || req.query.secret;
  if (provided !== secret) return res.status(401).json({ error: 'invalid secret' });
  next();
}

/**
 * POST /api/cron/expire-trials
 * Runs periodically (Vercel Cron or n8n). Any user whose trial has ended
 * and who doesn't have an active/trialing subscription is downgraded to Free.
 */
router.post('/cron/expire-trials', requireCron, async (_req, res) => {
  const now = new Date().toISOString();
  const { data: users } = await supabase
    .from('users')
    .select('id, phone_e164')
    .eq('access_status', 'trial')
    .lt('trial_ends_at', now)
    .is('deleted_at', null);

  let downgraded = 0;
  for (const u of users ?? []) {
    // If there's an active/trialing sub, honor Stripe status instead.
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('status')
      .eq('user_id', u.id)
      .in('status', ['active', 'trialing'])
      .maybeSingle();
    if (sub) continue;

    await supabase.from('users').update({
      tier: 'free',
      access_status: 'free',
    }).eq('id', u.id);
    await supabase.from('user_entitlements').upsert({
      user_id: u.id,
      plan_slug: 'free',
      access_status: 'free',
    }, { onConflict: 'user_id' });
    downgraded++;
  }
  res.json({ processed: users?.length ?? 0, downgraded });
});

/**
 * POST /api/cron/expire-grace
 * Users past their grace_period_ends_at without payment go back to Free.
 */
router.post('/cron/expire-grace', requireCron, async (_req, res) => {
  const now = new Date().toISOString();
  const { data: users } = await supabase
    .from('users')
    .select('id')
    .eq('access_status', 'grace_period')
    .lt('grace_period_ends_at', now);

  for (const u of users ?? []) {
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('status')
      .eq('user_id', u.id)
      .in('status', ['active', 'trialing'])
      .maybeSingle();
    if (sub) continue;
    await supabase.from('users').update({
      tier: 'free', access_status: 'free', grace_period_ends_at: null,
    }).eq('id', u.id);
    await supabase.from('user_entitlements').upsert({
      user_id: u.id, plan_slug: 'free', access_status: 'free',
    }, { onConflict: 'user_id' });
  }
  res.json({ processed: users?.length ?? 0 });
});

/**
 * POST /api/cron/reset-daily
 * No-op — usage_daily is keyed by (user_id, usage_date), so a "reset"
 * happens naturally when the date rolls over. This endpoint exists so
 * n8n can log an execution + we can prune very old usage rows if needed.
 */
router.post('/cron/reset-daily', requireCron, async (_req, res) => {
  // Prune rows older than 90 days to keep the table small.
  const cutoff = new Date(Date.now() - 90 * 86400 * 1000).toISOString().slice(0, 10);
  const { count } = await supabase.from('usage_daily').delete({ count: 'exact' }).lt('usage_date', cutoff);
  res.json({ pruned: count ?? 0 });
});

module.exports = router;
