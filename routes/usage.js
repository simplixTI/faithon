const express = require('express');
const { supabase } = require('../lib/supabase');
const { normalizePhoneE164 } = require('../lib/phone');
const { computeOpenAICostCents, computeSmsCostCents } = require('../lib/cost');

const router = express.Router();

function requireSecret(req, res, next) {
  const secret = process.env.N8N_WEBHOOK_SECRET;
  if (!secret) return res.status(503).json({ error: 'N8N_WEBHOOK_SECRET not configured' });
  if (req.headers['x-n8n-secret'] !== secret) return res.status(401).json({ error: 'invalid secret' });
  next();
}

async function resolveUserId({ user_id, phone }) {
  if (user_id) return user_id;
  const p = normalizePhoneE164(phone);
  if (!p) return null;
  const { data } = await supabase.from('users').select('id').eq('phone_e164', p).maybeSingle();
  return data?.id ?? null;
}

/**
 * POST /api/usage/record
 * n8n calls this after generating + sending a response. Records:
 *   - AI tokens (if provided)  → ai_usage_events + rolls into usage_daily/monthly
 *   - outbound SMS count/cost  → usage_daily.outbound_count
 */
router.post('/usage/record', express.json(), requireSecret, async (req, res) => {
  try {
    const {
      user_id, phone,
      conversation_id, message_id,
      model, tokens_input = 0, tokens_output = 0,
      latency_ms, safety_blocked = false, fallback_used = false, error,
      sms_direction, sms_segments = 0,
    } = req.body || {};

    const uid = await resolveUserId({ user_id, phone });
    if (!uid) return res.status(400).json({ error: 'user_id or phone required' });

    const today = new Date().toISOString().slice(0, 10);
    const yyyymm = today.slice(0, 7);

    let aiCost = 0;
    if (model && (tokens_input || tokens_output)) {
      aiCost = await computeOpenAICostCents({ model, tokensInput: tokens_input, tokensOutput: tokens_output });
      await supabase.from('ai_usage_events').insert({
        user_id: uid,
        conversation_id: conversation_id ?? null,
        message_id: message_id ?? null,
        model, tokens_input, tokens_output,
        latency_ms: latency_ms ?? null,
        estimated_cost_cents: aiCost,
        safety_blocked, fallback_used,
        error: error ?? null,
      });
    }

    let smsCost = 0;
    if (sms_direction) {
      smsCost = await computeSmsCostCents({ segments: sms_segments || 1, direction: sms_direction });
    }

    // Roll up usage_daily
    const { data: prevDay } = await supabase
      .from('usage_daily').select('*')
      .eq('user_id', uid).eq('usage_date', today).maybeSingle();
    await supabase.from('usage_daily').upsert({
      user_id: uid,
      usage_date: today,
      message_count: (prevDay?.message_count ?? 0) + (sms_direction === 'outbound' ? 1 : 0),
      inbound_count: (prevDay?.inbound_count ?? 0) + (sms_direction === 'inbound' ? 1 : 0),
      outbound_count: (prevDay?.outbound_count ?? 0) + (sms_direction === 'outbound' ? 1 : 0),
      ai_tokens_input: (prevDay?.ai_tokens_input ?? 0) + tokens_input,
      ai_tokens_output: (prevDay?.ai_tokens_output ?? 0) + tokens_output,
      estimated_cost_cents: Number(prevDay?.estimated_cost_cents ?? 0) + aiCost + smsCost,
    }, { onConflict: 'user_id,usage_date' });

    // Roll up usage_monthly
    const { data: prevMonth } = await supabase
      .from('usage_monthly').select('*')
      .eq('user_id', uid).eq('year_month', yyyymm).maybeSingle();
    await supabase.from('usage_monthly').upsert({
      user_id: uid,
      year_month: yyyymm,
      inbound_count: (prevMonth?.inbound_count ?? 0) + (sms_direction === 'inbound' ? 1 : 0),
      outbound_count: (prevMonth?.outbound_count ?? 0) + (sms_direction === 'outbound' ? 1 : 0),
      ai_tokens_input: (prevMonth?.ai_tokens_input ?? 0) + tokens_input,
      ai_tokens_output: (prevMonth?.ai_tokens_output ?? 0) + tokens_output,
      estimated_cost_cents: Number(prevMonth?.estimated_cost_cents ?? 0) + aiCost + smsCost,
    }, { onConflict: 'user_id,year_month' });

    res.json({ ok: true, ai_cost_cents: aiCost, sms_cost_cents: smsCost });
  } catch (err) {
    console.error('usage/record error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
