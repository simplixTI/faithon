const { supabase } = require('./supabase');

async function upsertUserByPhone(phoneE164, stripeCustomerId) {
  const payload = { phone_e164: phoneE164 };
  if (stripeCustomerId) payload.stripe_customer_id = stripeCustomerId;
  const { data, error } = await supabase
    .from('users')
    .upsert(payload, { onConflict: 'phone_e164' })
    .select()
    .single();
  if (error) throw new Error(`upsertUserByPhone: ${error.message}`);
  return data;
}

/**
 * First-touch bootstrap for a new inbound SMS user:
 *   - upsert user
 *   - if user is fresh (no trial), start a Plus trial per app_settings.trial_days
 *   - upsert consent record with opt_in
 * Returns { user, isNew }.
 */
async function ensureUserWithTrial(phoneE164, source = 'sms') {
  const user = await upsertUserByPhone(phoneE164);
  const isNew =
    !user.trial_started_at &&
    !user.trial_ends_at &&
    (user.access_status === 'free' || !user.access_status);

  if (isNew) {
    const trialDays = await getTrialDays();
    const now = new Date();
    const ends = new Date(now.getTime() + trialDays * 86400 * 1000);
    await supabase.from('users').update({
      tier: 'plus',
      access_status: 'trial',
      trial_started_at: now.toISOString(),
      trial_ends_at: ends.toISOString(),
      source,
    }).eq('id', user.id);

    await supabase.from('user_entitlements').upsert({
      user_id: user.id,
      plan_slug: 'plus',
      access_status: 'trial',
      trial_started_at: now.toISOString(),
      trial_ends_at: ends.toISOString(),
    }, { onConflict: 'user_id' });

    Object.assign(user, {
      tier: 'plus',
      access_status: 'trial',
      trial_started_at: now.toISOString(),
      trial_ends_at: ends.toISOString(),
    });
  }

  await supabase.from('user_consents').upsert({
    user_id: user.id,
    opt_in: true,
    opt_in_at: user.created_at ?? new Date().toISOString(),
    opt_in_source: `sms:${source}`,
  }, { onConflict: 'user_id' });

  return { user, isNew };
}

async function getTrialDays() {
  const { data } = await supabase.from('app_settings').select('value').eq('key', 'trial_days').maybeSingle();
  const v = data?.value;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : 3;
}

module.exports = { upsertUserByPhone, ensureUserWithTrial };
