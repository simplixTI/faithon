const { supabase } = require('./supabase');

let cache = null; let cachedAt = 0;
const TTL = 30_000;

async function getSettings() {
  if (cache && Date.now() - cachedAt < TTL) return cache;
  const { data } = await supabase.from('app_settings').select('key, value');
  cache = {};
  for (const r of data ?? []) cache[r.key] = r.value;
  cachedAt = Date.now();
  return cache;
}

function invalidateCache() { cache = null; }

async function computeSmsCostCents({ segments = 1, direction }) {
  const s = await getSettings();
  const key = direction === 'inbound' ? 'cost_sms_inbound_cents' : 'cost_sms_outbound_cents';
  const per = Number(s[key] ?? 0.79);
  return per * (segments || 1);
}

async function computeOpenAICostCents({ model, tokensInput = 0, tokensOutput = 0 }) {
  const s = await getSettings();
  // Match model → 1k-token cost keys we seeded.
  const inKey =
    /gpt-4o-mini/i.test(model) ? 'cost_openai_gpt4omini_in_per1k' :
    /gpt-4o/i.test(model)      ? 'cost_openai_gpt4o_in_per1k' :
    null;
  const outKey =
    /gpt-4o-mini/i.test(model) ? 'cost_openai_gpt4omini_out_per1k' :
    /gpt-4o/i.test(model)      ? 'cost_openai_gpt4o_out_per1k' :
    null;
  if (!inKey || !outKey) return 0;
  const inRate  = Number(s[inKey]  ?? 0);
  const outRate = Number(s[outKey] ?? 0);
  return (tokensInput / 1000) * inRate + (tokensOutput / 1000) * outRate;
}

module.exports = { getSettings, invalidateCache, computeSmsCostCents, computeOpenAICostCents };
