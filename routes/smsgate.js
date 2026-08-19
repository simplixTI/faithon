// FaithOn — SMSGate (SMS Gateway for Android) routes
//
// Endpoints:
//   POST /api/smsgate/inbound  - receives sms:received webhooks from the device
//   POST /api/smsgate/send     - n8n calls this to send AI replies
//   POST /api/smsgate/status   - receives sms:sent/delivered/failed webhooks
//
// The SMSGate webhook payload shape is documented at:
// https://docs.sms-gate.app/features/webhooks/

const express = require('express');
const { supabase } = require('../lib/supabase');
const { normalizePhoneE164 } = require('../lib/phone');
const { ensureUserWithTrial } = require('../lib/users');
const { computeSmsCostCents } = require('../lib/cost');
const { sendSms, estimateSegments } = require('../lib/smsgate');

const router = express.Router();

const COMMANDS = new Set(['PRAY', 'HELP', 'STOP', 'START', 'UNSTOP']);

function detectCommand(body) {
  const raw = String(body || '').trim().toUpperCase();
  if (COMMANDS.has(raw)) return raw;
  return null;
}

function requireN8nSecret(req, res, next) {
  const secret = process.env.N8N_WEBHOOK_SECRET;
  if (!secret) return res.status(503).json({ error: 'N8N_WEBHOOK_SECRET not configured' });
  if (req.headers['x-n8n-secret'] !== secret) return res.status(401).json({ error: 'invalid secret' });
  next();
}

async function getSettingText(key, fallback) {
  const { data } = await supabase.from('app_settings').select('value').eq('key', key).maybeSingle();
  const v = data?.value;
  return typeof v === 'string' ? v : fallback;
}

async function markProcessed(webhookId) {
  await supabase.from('sms_webhook_events')
    .update({ processed_at: new Date().toISOString() })
    .eq('id', webhookId);
}

async function sendReply({ to, text, userId, command }) {
  const result = await sendSms({ to, text });
  const providerMessageId = result?.id ?? null;
  const segments = estimateSegments(text);
  const cost = await computeSmsCostCents({ segments, direction: 'outbound' });

  await supabase.from('sms_messages').insert({
    user_id: userId,
    direction: 'outbound',
    from_e164: null, // device number; SMSGate may report it later via status webhook
    to_e164: normalizePhoneE164(to),
    body: text,
    provider: 'smsgate',
    provider_message_id: providerMessageId,
    provider_metadata: result,
    num_segments: segments,
    status: 'queued',
    command,
    price_cents: cost,
  });

  return result;
}

/**
 * POST /api/smsgate/inbound
 * Receives sms:received webhooks from the Android device.
 */
router.post('/smsgate/inbound', express.json(), async (req, res) => {
  try {
    const event = req.body || {};
    if (event.event !== 'sms:received') {
      return res.status(400).send('expected sms:received event');
    }

    const webhookId = event.id;
    if (!webhookId) return res.status(400).send('missing webhook id');

    // Idempotency
    const { data: seen } = await supabase
      .from('sms_webhook_events').select('id, processed_at').eq('id', webhookId).maybeSingle();
    if (seen?.processed_at) return res.status(204).end();

    await supabase.from('sms_webhook_events').upsert({
      id: webhookId,
      type: 'inbound',
      payload: event,
    });

    const payload = event.payload || {};
    const from = normalizePhoneE164(payload.sender);
    const to = normalizePhoneE164(payload.recipient);
    if (!from) return res.status(400).send('bad sender');

    const command = detectCommand(payload.message);
    const segments = estimateSegments(payload.message);
    const cost = await computeSmsCostCents({ segments, direction: 'inbound' });

    const { user } = await ensureUserWithTrial(from, command === 'PRAY' ? 'sms:pray' : 'sms');

    await supabase.from('sms_messages').insert({
      user_id: user.id,
      direction: 'inbound',
      from_e164: from,
      to_e164: to,
      body: payload.message ?? null,
      provider: 'smsgate',
      provider_message_id: payload.messageId ?? null,
      provider_metadata: payload,
      num_segments: segments,
      status: 'received',
      command,
      price_cents: cost,
    });

    // Increment daily counter (inbound)
    const today = new Date().toISOString().slice(0, 10);
    const { data: usageRow } = await supabase
      .from('usage_daily')
      .select('message_count, inbound_count')
      .eq('user_id', user.id).eq('usage_date', today).maybeSingle();
    await supabase.from('usage_daily').upsert({
      user_id: user.id,
      usage_date: today,
      message_count: (usageRow?.message_count ?? 0) + 1,
      inbound_count: (usageRow?.inbound_count ?? 0) + 1,
    }, { onConflict: 'user_id,usage_date' });

    await supabase.from('users').update({
      last_active_at: new Date().toISOString(),
      last_message_at: new Date().toISOString(),
    }).eq('id', user.id);

    // --- Command handlers (STOP/HELP/START respond synchronously; PRAY defers to n8n) ---
    if (command === 'STOP') {
      await supabase.from('user_consents').upsert({
        user_id: user.id,
        opt_out: true,
        opt_out_at: new Date().toISOString(),
        opt_out_reason: 'STOP',
      }, { onConflict: 'user_id' });
      await supabase.from('users').update({ access_status: 'opted_out' }).eq('id', user.id);
      await markProcessed(webhookId);
      return res.status(204).end();
    }

    if (command === 'START' || command === 'UNSTOP') {
      await supabase.from('user_consents').upsert({
        user_id: user.id,
        opt_in: true,
        opt_in_at: new Date().toISOString(),
        opt_in_source: `sms:${command}`,
        opt_out: false,
        opt_out_at: null,
        opt_out_reason: null,
      }, { onConflict: 'user_id' });
      await supabase.from('users').update({
        access_status: user.tier === 'plus' ? 'active' : 'free',
      }).eq('id', user.id);
      const startText = await getSettingText('text_start_ack', 'Welcome back to FaithOn. Send PRAY to begin.');
      await sendReply({ to: from, text: startText, userId: user.id, command });
      await markProcessed(webhookId);
      return res.status(204).end();
    }

    if (command === 'HELP') {
      const helpText = await getSettingText('text_help', 'FaithOn: a spiritual companion by SMS. Reply STOP to opt out. Support: help@faithon.ai');
      await sendReply({ to: from, text: helpText, userId: user.id, command });
      await markProcessed(webhookId);
      return res.status(204).end();
    }

    // PRAY (or any other message): leave the AI response to n8n.
    await markProcessed(webhookId);
    return res.status(204).end();

  } catch (err) {
    console.error('smsgate/inbound error:', err);
    return res.status(500).send('error');
  }
});

/**
 * POST /api/smsgate/send
 * n8n calls this to send AI-generated replies.
 */
router.post('/smsgate/send', express.json(), requireN8nSecret, async (req, res) => {
  try {
    const { to, text, user_id, conversation_id, message_id, command } = req.body || {};
    const normalizedTo = normalizePhoneE164(to);
    if (!normalizedTo) return res.status(400).json({ error: 'invalid to' });
    if (!text) return res.status(400).json({ error: 'text required' });

    const result = await sendSms({ to: normalizedTo, text });
    const providerMessageId = result?.id ?? null;
    const segments = estimateSegments(text);
    const cost = await computeSmsCostCents({ segments, direction: 'outbound' });

    await supabase.from('sms_messages').insert({
      user_id: user_id ?? null,
      conversation_id: conversation_id ?? null,
      direction: 'outbound',
      from_e164: null,
      to_e164: normalizedTo,
      body: text,
      provider: 'smsgate',
      provider_message_id: providerMessageId,
      provider_metadata: result,
      num_segments: segments,
      status: 'queued',
      command: command ?? null,
      price_cents: cost,
    });

    // Update user last_message_at
    if (user_id) {
      await supabase.from('users').update({
        last_active_at: new Date().toISOString(),
        last_message_at: new Date().toISOString(),
      }).eq('id', user_id);
    }

    return res.json({
      ok: true,
      provider: 'smsgate',
      provider_message_id: providerMessageId,
      state: result?.state ?? null,
      result,
    });
  } catch (err) {
    console.error('smsgate/send error:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/smsgate/status
 * Receives sms:sent / sms:delivered / sms:failed webhooks.
 */
router.post('/smsgate/status', express.json(), async (req, res) => {
  try {
    const event = req.body || {};
    const allowedEvents = new Set(['sms:sent', 'sms:delivered', 'sms:failed']);
    if (!allowedEvents.has(event.event)) {
      return res.status(400).send('unexpected event');
    }

    const webhookId = event.id;
    if (!webhookId) return res.status(400).send('missing webhook id');

    // Idempotency
    const eventId = `${webhookId}:${event.event}`;
    const { data: seen } = await supabase
      .from('sms_webhook_events').select('id, processed_at').eq('id', eventId).maybeSingle();
    if (seen?.processed_at) return res.status(204).end();

    await supabase.from('sms_webhook_events').upsert({
      id: eventId,
      type: 'status_callback',
      payload: event,
    });

    const payload = event.payload || {};
    const providerMessageId = payload.messageId ?? null;
    if (!providerMessageId) return res.status(400).send('missing messageId');

    const patch = { status: 'sent' };
    if (event.event === 'sms:delivered') {
      patch.status = 'delivered';
      patch.delivered_at = new Date().toISOString();
    } else if (event.event === 'sms:failed') {
      patch.status = 'failed';
      patch.error_message = payload.reason ?? null;
    }
    if (payload.sentAt) patch.sent_at = new Date(payload.sentAt).toISOString();

    await supabase.from('sms_messages')
      .update(patch)
      .eq('provider', 'smsgate')
      .eq('provider_message_id', providerMessageId);

    await supabase.from('sms_webhook_events')
      .update({ processed_at: new Date().toISOString() })
      .eq('id', eventId);

    return res.status(204).end();
  } catch (err) {
    console.error('smsgate/status error:', err);
    return res.status(500).send('error');
  }
});

module.exports = router;
