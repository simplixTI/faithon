// FaithOn — Entitlement check (reusable between API route and SMS flow)

const { supabase } = require('./supabase');
const { normalizePhoneE164 } = require('./phone');

async function checkEntitlement(rawPhone) {
  const phone = normalizePhoneE164(rawPhone);
  if (!phone) {
    return { exists: false, allowed: false, reason: 'invalid_phone' };
  }

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
    return { exists: false, allowed: false, reason: 'not_registered' };
  }

  if (user.access_status === 'opted_out') {
    return { exists: true, user_id: user.id, allowed: false, reason: 'opted_out' };
  }
  if (user.access_status === 'blocked') {
    return { exists: true, user_id: user.id, allowed: false, reason: 'blocked' };
  }

  const settingsMap = Object.fromEntries((settings ?? []).map(r => [r.key, r.value]));
  const freeDailyLimit = user.daily_limit_override ?? Number(settingsMap.free_daily_limit ?? 5);
  const plusDailyLimit = Number(settingsMap.plus_fair_use_daily ?? 100);

  const now = Date.now();
  const trialActive = user.trial_ends_at && new Date(user.trial_ends_at).getTime() > now;
  const graceActive = user.grace_period_ends_at && new Date(user.grace_period_ends_at).getTime() > now;
  const isPlus = user.tier === 'plus' && (
    user.access_status === 'active' ||
    (user.access_status === 'trial' && trialActive) ||
    (user.access_status === 'grace_period' && graceActive)
  );

  const today = new Date().toISOString().slice(0, 10);
  const { data: usage } = await supabase
    .from('usage_daily').select('message_count').eq('user_id', user.id).eq('usage_date', today).maybeSingle();
  const used = usage?.message_count ?? 0;
  const limit = isPlus ? plusDailyLimit : freeDailyLimit;
  const remaining = Math.max(0, limit - used);
  const allowed = remaining > 0;

  return {
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
  };
}

module.exports = { checkEntitlement };
