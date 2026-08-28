const express = require('express');
const { supabase } = require('../lib/supabase');
const { getSmsProvider, estimateSegments } = require('../lib/sms-provider');
const { computeSmsCostCents } = require('../lib/cost');
const { generateDailyDevotional } = require('../lib/devotional');
const { heartbeat } = require('../lib/system-health');
const whatsapp = require('../lib/whatsapp-provider');

const router = express.Router();

function requireCron(req, res, next) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(503).json({ error: 'CRON_SECRET not configured' });

  // Vercel Cron sends the secret as `Authorization: Bearer <CRON_SECRET>`
  // when CRON_SECRET is set as an environment variable. We also support
  // `x-cron-secret` header and `?secret=` query param for external cron
  // services (e.g. cron-job.org, n8n).
  const authHeader = req.headers.authorization || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const provided = bearer || req.headers['x-cron-secret'] || req.query.secret;

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
  await heartbeat('cron', 'ok', { job: 'expire-trials', processed: users?.length ?? 0, downgraded });
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
  await heartbeat('cron', 'ok', { job: 'expire-grace', processed: users?.length ?? 0 });
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
  await heartbeat('cron', 'ok', { job: 'reset-daily', pruned: count ?? 0 });
  res.json({ pruned: count ?? 0 });
});

/**
 * ANY /api/cron/devotional
 * Sends a daily devotional to all active PLUS users.
 * Intended to run once every morning via Vercel Cron or n8n.
 * Note: Vercel Cron calls paths with GET — that's why this accepts any method.
 * Channel per user: SMS only for +1 (US/CA) and +52 (MX); everything else
 * goes via WhatsApp (BR carriers block our US SMS number, and WhatsApp is
 * the primary channel outside North America).
 */
router.all('/cron/devotional', requireCron, async (_req, res) => {
  try {
    const { data: plusUsersRaw } = await supabase
      .from('users')
      .select('id, phone_e164')
      .eq('tier', 'plus')
      .in('access_status', ['active', 'trial'])
      .is('deleted_at', null);

    // Never send to our own service number (would loop back as inbound)
    const ownNumber = process.env.FAITHON_SMS_NUMBER || '+19547950686';
    const plusUsers = (plusUsersRaw ?? []).filter((u) => u.phone_e164 !== ownNumber);

    const sms = getSmsProvider();
    const devotionalCache = {}; // one devotional per locale, generated lazily
    let sent = 0;
    let failed = 0;

    for (const user of plusUsers) {
      const phone = String(user.phone_e164 || '');
      const viaSms = phone.startsWith('+1') || phone.startsWith('+52');
      const locale = phone.startsWith('+55') ? 'pt' : 'en';
      try {
        if (!devotionalCache[locale]) devotionalCache[locale] = await generateDailyDevotional(locale);
        const header = locale === 'pt' ? '☀️ Devocional do dia:' : "☀️ Today's devotional:";
        const text = `${header}\n\n${devotionalCache[locale]}`;
        const segments = estimateSegments(text);
        const smsCost = await computeSmsCostCents({ segments, direction: 'outbound' });
        const result = viaSms
          ? await sms.send({ to: phone, text })
          : await whatsapp.send({ to: phone, text });
        await supabase.from('sms_messages').insert({
          user_id: user.id,
          direction: 'outbound',
          from_e164: null,
          to_e164: phone,
          body: text,
          provider: viaSms ? (process.env.SMS_PROVIDER || 'smsgate') : 'uzapi',
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

    await heartbeat('cron', failed === 0 ? 'ok' : 'degraded', { job: 'devotional', sent, failed, total: plusUsers.length });
    res.json({ devotionals: devotionalCache, sent, failed, total: plusUsers.length });
  } catch (err) {
    console.error('devotional cron error:', err);
    await heartbeat('cron', 'down', { job: 'devotional', error: err.message }).catch(() => {});
    res.status(500).json({ error: err.message });
  }
});

/**
 * ANY /api/cron/health-check
 * Runs daily. Keeps api/database heartbeats fresh and marks components as
 * degraded when their last heartbeat is too old. Components that never
 * reported (last_heartbeat_at is null) stay "unknown" instead of "down".
 * Note: Vercel Cron calls paths with GET — that's why this accepts any method.
 */
router.all('/cron/health-check', requireCron, async (_req, res) => {
  const thresholds = {
    api: 10 * 60 * 1000,         // 10 minutes
    smsgate: 60 * 60 * 1000,     // 1 hour (SMS can be quiet)
    stripe: 24 * 60 * 60 * 1000, // 1 day
    openai: 60 * 60 * 1000,      // 1 hour
    cron: 25 * 60 * 60 * 1000,   // 25 hours (daily cron)
    n8n: 25 * 60 * 60 * 1000,    // 25 hours
  };

  // Keep api/database heartbeats fresh from the cron itself.
  let supaOk = false, supaErr = null;
  try {
    const { error } = await supabase.from('users').select('id').limit(1);
    supaOk = !error;
    supaErr = error?.message || null;
  } catch (e) { supaErr = e.message; }
  await heartbeat('api', 'ok', { checked_at: new Date().toISOString() });
  await heartbeat('database', supaOk ? 'ok' : 'down', { error: supaErr });

  const { data: rows, error } = await supabase
    .from('system_health')
    .select('component, status, last_heartbeat_at, details');

  if (error) return res.status(500).json({ error: error.message });

  const now = Date.now();
  const updated = [];

  for (const row of rows ?? []) {
    const threshold = thresholds[row.component];
    if (!threshold) continue;

    const last = row.last_heartbeat_at ? new Date(row.last_heartbeat_at).getTime() : 0;

    let nextStatus = row.status;
    if (last && now - last > threshold && row.status === 'ok') {
      nextStatus = 'degraded';
    }
    // Only mark as "down" if we had a heartbeat before and it went stale.
    // Components that never reported stay "unknown".

    if (nextStatus !== row.status) {
      await supabase.from('system_health').upsert({
        component: row.component,
        status: nextStatus,
        details: { ...(row.details || {}), stale_ms: last ? now - last : null },
      }, { onConflict: 'component' });
      updated.push({ component: row.component, from: row.status, to: nextStatus });
    }
  }

  await heartbeat('cron', 'ok', { job: 'health-check', updated });
  res.json({ checked: rows?.length ?? 0, updated });
});

module.exports = router;
