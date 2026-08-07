const express = require('express');
const { supabase } = require('../lib/supabase');
const { normalizePhoneE164 } = require('../lib/phone');

const router = express.Router();

function requireSecret(req, res, next) {
  const secret = process.env.N8N_WEBHOOK_SECRET;
  if (!secret) return res.status(503).json({ error: 'N8N_WEBHOOK_SECRET not configured' });
  if (req.headers['x-n8n-secret'] !== secret) return res.status(401).json({ error: 'invalid secret' });
  next();
}

/**
 * GET /api/entitlement/:phone
 * Called from n8n before generating an AI response.
 * Returns whether the phone is allowed to receive a full response now.
 */
router.get('/entitlement/:phone', requireSecret, async (req, res) => {
  try {
    const phone = normalizePhoneE164(req.params.phone);
    if (!phone) return res.status(400).json({ error: 'invalid phone' });

    const [{ data: user }, { data: settings }] = await Promise.all([
      supabase
        .from('users')
        .select('id, tier, access_status, trial_ends_at, grace_period_ends_at, daily_limit_override')
        .eq('phone_e164', phone).is('deleted_at', null).maybeSingle(),
      supabase
        .from('app_settings')
        .select('key, value')
        .in('key', ['free_daily_limit', 'plus_fair_use_daily']),
    ]);

    if (!user) {
      return res.json({
        exists: false,
        allowed: false,
        reason: 'not_registered',
      });
    }

    if (user.access_status === 'opted_out') {
      return res.json({ exists: true, user_id: user.id, allowed: false, reason: 'opted_out' });
    }
    if (user.access_status === 'blocked') {
      return res.json({ exists: true, user_id: user.id, allowed: false, reason: 'blocked' });
    }

    const settingsMap = Object.fromEntries((settings ?? []).map(r => [r.key, r.value]));
    const freeDailyLimit = user.daily_limit_override ?? Number(settingsMap.free_daily_limit ?? 5);
    const plusDailyLimit = Number(settingsMap.plus_fair_use_daily ?? 100);

    // Check trial expiry
    const now = Date.now();
    const trialActive = user.trial_ends_at && new Date(user.trial_ends_at).getTime() > now;
    const graceActive = user.grace_period_ends_at && new Date(user.grace_period_ends_at).getTime() > now;
    const isPlus = user.tier === 'plus' && (
      user.access_status === 'active' ||
      user.access_status === 'trial' && trialActive ||
      user.access_status === 'grace_period' && graceActive
    );

    const today = new Date().toISOString().slice(0, 10);
    const { data: usage } = await supabase
      .from('usage_daily').select('message_count').eq('user_id', user.id).eq('usage_date', today).maybeSingle();
    const used = usage?.message_count ?? 0;
    const limit = isPlus ? plusDailyLimit : freeDailyLimit;
    const remaining = Math.max(0, limit - used);
    const allowed = remaining > 0;

    return res.json({
      exists: true,
      user_id: user.id,
      phone_e164: phone,
      plan: isPlus ? 'plus' : 'free',
      access_status: user.access_status,
      trial_ends_at: user.trial_ends_at,
      grace_ends_at: user.grace_period_ends_at,
      daily_limit: limit,
      daily_used: used,
      remaining,
      allowed,
      reason: allowed ? null : (isPlus ? 'plus_fair_use_exceeded' : 'free_daily_limit_reached'),
    });
  } catch (err) {
    console.error('entitlement error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
