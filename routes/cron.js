const express = require('express');
const { supabase } = require('../lib/supabase');
const { getSmsProvider, estimateSegments } = require('../lib/sms-provider');
const { computeSmsCostCents } = require('../lib/cost');
const { generateDailyDevotional } = require('../lib/devotional');

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

/**
 * POST /api/cron/devotional
 * Sends a daily devotional SMS to all active PLUS users.
 * Intended to run once every morning via Vercel Cron or n8n.
 */
router.post('/cron/devotional', requireCron, async (_req, res) => {
  try {
    const devotional = await generateDailyDevotional();
    const segments = estimateSegments(devotional);
    const smsCost = await computeSmsCostCents({ segments, direction: 'outbound' });

    const { data: plusUsers } = await supabase
      .from('users')
      .select('id, phone_e164')
      .eq('tier', 'plus')
      .eq('access_status', 'active')
      .is('deleted_at', null);

    const sms = getSmsProvider();
    let sent = 0;
    let failed = 0;

    for (const user of plusUsers ?? []) {
      try {
        const result = await sms.send({ to: user.phone_e164, text: devotional });
        await supabase.from('sms_messages').insert({
          user_id: user.id,
          direction: 'outbound',
          from_e164: null,
          to_e164: user.phone_e164,
          body: devotional,
          provider: process.env.SMS_PROVIDER || 'smsgate',
          provider_message_id: result.providerMessageId,
          provider_metadata: result.raw,
          num_segments: segments,
          status: 'queued',
          command: 'devotional',
          price_cents: smsCost,
        });
        sent++;
      } catch (err) {
        console.error(`devotional send failed for ${user.phone_e164}:`, err.message);
        failed++;
      }
    }

    res.json({ devotional, sent, failed, total: plusUsers?.length ?? 0 });
  } catch (err) {
    console.error('devotional cron error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
