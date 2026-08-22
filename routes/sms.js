// FaithOn — Generic SMS inbound/outbound handler
//
// Provider-agnostic endpoint: receives webhooks from the active SMS gateway
// (configured via SMS_PROVIDER env var) and sends replies through it.
//
// Current provider: SMSGate (Android SMS Gateway)
// Webhook docs: https://docs.sms-gate.app/features/webhooks/

const express = require('express');
const { supabase } = require('../lib/supabase');
const { normalizePhoneE164 } = require('../lib/phone');
const { ensureUserWithTrial } = require('../lib/users');
const { computeSmsCostCents } = require('../lib/cost');
const { getSmsProvider, estimateSegments } = require('../lib/sms-provider');
const { generateReply } = require('../lib/conversation-service');
const { checkEntitlement } = require('../lib/entitlement');
const { STAGES, STATUS, record, startStage, completeStage } = require('../lib/trace');

const router = express.Router();

const COMMANDS = new Set(['PRAY', 'HELP', 'STOP', 'START', 'UNSTOP', 'PLUS']);

function detectCommand(body) {
  const raw = String(body || '').trim().toUpperCase();
  if (COMMANDS.has(raw)) return raw;
  return null;
}

function isSystemOrCarrierMessage({ sender, body }) {
  if (!sender) return true;
  const text = String(body || '').toUpperCase();
  const carrierPatterns = [
    'VIVO', 'TIM', 'CLARO', 'OI', 'NEXTEL',
    'TORPEDO SMS ENTREGUE', 'SALDO', 'RECARGA', 'OFERTA',
    'MENSAGEM ENTREGUE', 'SMS DELIVERED', 'DELIVERY REPORT',
  ];
  return carrierPatterns.some((p) => text.includes(p));
}

async function getSettingText(key, fallback) {
  const { data } = await supabase.from('app_settings').select('value').eq('key', key).maybeSingle();
  const v = data?.value;
  return typeof v === 'string' ? v : fallback;
}

async function recordInboundMessage({ user, from, to, body, messageId, provider, providerMetadata, command }) {
  const segments = estimateSegments(body);
  const cost = await computeSmsCostCents({ segments, direction: 'inbound' });

  const { data: inserted } = await supabase.from('sms_messages').insert({
    user_id: user.id,
    direction: 'inbound',
    from_e164: from,
    to_e164: to,
    body,
    provider,
    provider_message_id: messageId,
    provider_metadata: providerMetadata,
    num_segments: segments,
    status: 'received',
    command,
    price_cents: cost,
  }).select('id').single();

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

  return inserted?.id ?? null;
}

async function sendSystemReply({ to, text, userId, provider, command = null, correlationId = null }) {
  const sms = getSmsProvider();
  const smsStage = await startStage({ correlationId, stage: STAGES.SMS_SEND_STARTED, provider, userId });
  const result = await sms.send({ to, text });
  const segments = estimateSegments(text);
  const cost = await computeSmsCostCents({ segments, direction: 'outbound' });

  const { data: inserted } = await supabase.from('sms_messages').insert({
    user_id: userId,
    direction: 'outbound',
    from_e164: null,
    to_e164: normalizePhoneE164(to),
    body: text,
    provider,
    provider_message_id: result.providerMessageId,
    provider_metadata: result.raw,
    num_segments: segments,
    status: 'queued',
    command,
    price_cents: cost,
  }).select('id').single();

  await completeStage(smsStage, { status: STATUS.SUCCESS, metadata: { providerMessageId: result.providerMessageId, messageId: inserted?.id ?? null } });

  if (userId) {
    await supabase.from('users').update({
      last_active_at: new Date().toISOString(),
      last_message_at: new Date().toISOString(),
    }).eq('id', userId);
  }

  return { ...result, messageId: inserted?.id ?? null };
}

/**
 * POST /api/sms/incoming
 * Receives inbound SMS and MMS webhooks from the active provider.
 */
router.post('/sms/incoming', express.json(), async (req, res) => {
  const correlationId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const flowStartedAt = Date.now();
  let userId = null;

  try {
    const eventType = req.body?.event;
    if (!['sms:received', 'mms:received', 'mms:downloaded'].includes(eventType)) {
      return res.status(400).send('expected sms:received, mms:received or mms:downloaded event');
    }

    const provider = getSmsProvider();
    const inbound = provider.normalizeInbound(req.body || {});

    console.log(`[sms/incoming:${correlationId}] event=${eventType} from=${inbound.from} body="${inbound.body}"`);

    if (!inbound.from) {
      console.error(`[sms/incoming:${correlationId}] missing sender, payload:`, JSON.stringify(req.body));
      await record({ correlationId, stage: STAGES.WEBHOOK_VALIDATED, status: STATUS.FAILED, errorCode: 'missing_sender', errorMessage: 'missing sender', metadata: { eventType, payload: req.body } });
      return res.status(400).send('missing sender');
    }

    await record({ correlationId, stage: STAGES.SMS_RECEIVED, status: STATUS.SUCCESS });
    await record({ correlationId, stage: STAGES.PHONE_NORMALIZED, status: STATUS.SUCCESS, metadata: { from: inbound.from } });

    // Ignore carrier/system messages (delivery reports, spam, etc.)
    if (isSystemOrCarrierMessage({ sender: inbound.from, body: inbound.body })) {
      console.log(`[sms/incoming:${correlationId}] ignoring system/carrier message`);
      await record({ correlationId, stage: STAGES.FLOW_COMPLETED, status: STATUS.SKIPPED, metadata: { reason: 'system_or_carrier' } });
      return res.status(204).end();
    }

    const webhookId = req.body?.id || inbound.messageId;
    if (!webhookId) {
      await record({ correlationId, stage: STAGES.WEBHOOK_VALIDATED, status: STATUS.FAILED, errorCode: 'missing_message_id', errorMessage: 'missing message id' });
      return res.status(400).send('missing message id');
    }

    await record({ correlationId, stage: STAGES.WEBHOOK_VALIDATED, status: STATUS.SUCCESS });

    // Idempotency: mark webhook as processed atomically at the start.
    // If another request already inserted this webhookId, the insert fails
    // with a duplicate key error and we return 204 immediately.
    const { error: insertError } = await supabase
      .from('sms_webhook_events')
      .insert({
        id: webhookId,
        type: 'inbound',
        payload: req.body,
        processed_at: new Date().toISOString(),
      });
    if (insertError) {
      const isDuplicate = insertError.code === '23505' || String(insertError.message).includes('duplicate key');
      if (isDuplicate) {
        console.log(`[sms/incoming:${correlationId}] duplicate webhook, skipping`);
        await record({ correlationId, stage: STAGES.FLOW_COMPLETED, status: STATUS.SKIPPED, metadata: { reason: 'duplicate_webhook' } });
        return res.status(204).end();
      }
      throw insertError;
    }

    const command = detectCommand(inbound.body);
    const userStage = await startStage({ correlationId, stage: STAGES.USER_LOOKUP_STARTED, provider: 'supabase' });
    const { user, isNew } = await ensureUserWithTrial(inbound.from, command === 'PRAY' ? 'sms:pray' : 'sms');
    user.isNew = isNew;
    userId = user.id;
    await completeStage(userStage, { status: STATUS.SUCCESS, metadata: { userId: user.id, isNew } });
    await record({ correlationId, stage: isNew ? STAGES.USER_CREATED : STAGES.USER_FOUND, status: STATUS.SUCCESS, userId: user.id });

    const inboundMessageId = await recordInboundMessage({
      user,
      from: inbound.from,
      to: inbound.to,
      body: inbound.body,
      messageId: inbound.messageId,
      provider: process.env.SMS_PROVIDER || 'smsgate',
      providerMetadata: inbound.raw,
      command,
    });

    // Entitlement check (limits, opt-out, trial/grace status)
    const entitlementStage = await startStage({ correlationId, stage: STAGES.ENTITLEMENT_CHECK_STARTED, provider: 'supabase', userId: user.id, messageId: inboundMessageId });
    const entitlement = await checkEntitlement(inbound.from);
    if (!entitlement.allowed) {
      await completeStage(entitlementStage, { status: STATUS.FAILED, errorCode: entitlement.reason, metadata: { daily_used: entitlement.daily_used, daily_limit: entitlement.daily_limit } });
      await record({ correlationId, stage: STAGES.ENTITLEMENT_BLOCKED, status: STATUS.FAILED, userId: user.id, messageId: inboundMessageId, errorCode: entitlement.reason, metadata: { reason: entitlement.reason } });
      const limitText = await getSettingText('text_daily_limit', "You've reached your daily message limit. Reply PLUS to upgrade.");
      await sendSystemReply({ to: inbound.from, text: limitText, userId: user.id, provider: process.env.SMS_PROVIDER || 'smsgate', command, correlationId });

      await record({ correlationId, stage: STAGES.FLOW_COMPLETED, status: STATUS.SUCCESS, userId: user.id, messageId: inboundMessageId, metadata: { command, blockedReason: entitlement.reason } });
      return res.status(204).end();
    }
    await completeStage(entitlementStage, { status: STATUS.SUCCESS, metadata: { plan: entitlement.plan, daily_used: entitlement.daily_used, daily_limit: entitlement.daily_limit } });
    await record({ correlationId, stage: STAGES.ENTITLEMENT_ALLOWED, status: STATUS.SUCCESS, userId: user.id, messageId: inboundMessageId, metadata: { plan: entitlement.plan } });

    // --- STOP: opt-out ---
    if (command === 'STOP') {
      await supabase.from('user_consents').upsert({
        user_id: user.id,
        opt_out: true,
        opt_out_at: new Date().toISOString(),
        opt_out_reason: 'STOP',
      }, { onConflict: 'user_id' });
      await supabase.from('users').update({ access_status: 'opted_out' }).eq('id', user.id);

      await record({ correlationId, stage: STAGES.FLOW_COMPLETED, status: STATUS.SUCCESS, userId: user.id, metadata: { command: 'STOP' } });
      return res.status(204).end();
    }

    // --- START/UNSTOP: opt back in ---
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
      const text = await getSettingText('text_start_ack', 'Welcome back to FaithOn. Send PRAY to begin.');
      await sendSystemReply({ to: inbound.from, text, userId: user.id, provider: process.env.SMS_PROVIDER || 'smsgate', command, correlationId });

      await record({ correlationId, stage: STAGES.FLOW_COMPLETED, status: STATUS.SUCCESS, userId: user.id, metadata: { command } });
      return res.status(204).end();
    }

    // --- HELP ---
    if (command === 'HELP') {
      const text = await getSettingText('text_help', 'FaithOn: a spiritual companion by SMS. Reply STOP to opt out. Support: help@faithon.ai');
      await sendSystemReply({ to: inbound.from, text, userId: user.id, provider: process.env.SMS_PROVIDER || 'smsgate', command, correlationId });

      await record({ correlationId, stage: STAGES.FLOW_COMPLETED, status: STATUS.SUCCESS, userId: user.id, metadata: { command: 'HELP' } });
      return res.status(204).end();
    }

    // --- PLUS: upgrade link ---
    if (command === 'PLUS') {
      const paymentLink = process.env.STRIPE_PAYMENT_LINK || 'https://buy.stripe.com/cNi6oH5g951JfCn6sCenS00';
      const upgradeText = await getSettingText('text_upgrade_link', 'Upgrade to FaithOn Plus for $1.99/mo: {url}');
      const text = upgradeText.replace('{url}', paymentLink);
      await sendSystemReply({ to: inbound.from, text, userId: user.id, provider: process.env.SMS_PROVIDER || 'smsgate', command, correlationId });

      await record({ correlationId, stage: STAGES.FLOW_COMPLETED, status: STATUS.SUCCESS, userId: user.id, metadata: { command: 'PLUS', paymentLink } });
      return res.status(204).end();
    }

    // --- FASE 3: PRAY or any message -> AI-generated reply ---
    const isFirstInteraction = !!user.isNew;
    const aiStage = await startStage({ correlationId, stage: STAGES.AI_REQUEST_STARTED, provider: process.env.AI_PROVIDER || 'deepseek', userId: user.id, messageId: inboundMessageId });
    const aiResult = await generateReply({
      user,
      body: inbound.body,
      isFirstInteraction,
      correlationId,
      messageId: inboundMessageId,
    });
    await completeStage(aiStage, { status: STATUS.SUCCESS, metadata: { tokens: aiResult.tokens } });

    const totalMs = Date.now() - flowStartedAt;
    await record({ correlationId, stage: STAGES.FLOW_COMPLETED, status: STATUS.SUCCESS, userId: user.id, durationMs: totalMs });

    console.log(`[sms/incoming:${correlationId}] AI replied to ${inbound.from}: "${aiResult.text.slice(0, 80)}..."`);
    return res.status(204).end();

  } catch (err) {
    console.error(`[sms/incoming:${correlationId}] error:`, err);
    const totalMs = Date.now() - flowStartedAt;
    await record({
      correlationId,
      stage: STAGES.FLOW_FAILED,
      status: STATUS.FAILED,
      userId,
      durationMs: totalMs,
      errorCode: err.code || 'unknown',
      errorMessage: err.message,
    });
    return res.status(500).send('error');
  }
});

/**
 * POST /api/sms/status
 * Receives delivery status webhooks from the active provider.
 */
router.post('/sms/status', express.json(), async (req, res) => {
  const correlationId = `status-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    const event = req.body || {};
    const allowedEvents = new Set(['sms:sent', 'sms:delivered', 'sms:failed']);
    if (!allowedEvents.has(event.event)) {
      return res.status(400).send('unexpected event');
    }

    const webhookId = event.id;
    const eventKey = `${webhookId}:${event.event}`;
    const { data: seen } = await supabase
      .from('sms_webhook_events').select('id, processed_at').eq('id', eventKey).maybeSingle();
    if (seen?.processed_at) return res.status(204).end();

    await supabase.from('sms_webhook_events').upsert({
      id: eventKey,
      type: 'status_callback',
      payload: event,
    });

    const payload = event.payload || {};
    const providerMessageId = payload.messageId;
    if (!providerMessageId) return res.status(400).send('missing messageId');

    const { data: smsMessage } = await supabase
      .from('sms_messages')
      .select('id, user_id, conversation_id')
      .eq('provider', process.env.SMS_PROVIDER || 'smsgate')
      .eq('provider_message_id', providerMessageId)
      .maybeSingle();

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
      .eq('provider', process.env.SMS_PROVIDER || 'smsgate')
      .eq('provider_message_id', providerMessageId);

    // Record delivery trace event when delivered/failed
    if (event.event === 'sms:delivered') {
      await record({
        correlationId,
        stage: STAGES.DELIVERY_CONFIRMED,
        status: STATUS.SUCCESS,
        userId: smsMessage?.user_id ?? null,
        messageId: smsMessage?.id ?? null,
        conversationId: smsMessage?.conversation_id ?? null,
        provider: process.env.SMS_PROVIDER || 'smsgate',
        metadata: { providerMessageId, event: event.event },
      });
    } else if (event.event === 'sms:failed') {
      await record({
        correlationId,
        stage: STAGES.DELIVERY_FAILED,
        status: STATUS.FAILED,
        userId: smsMessage?.user_id ?? null,
        messageId: smsMessage?.id ?? null,
        conversationId: smsMessage?.conversation_id ?? null,
        provider: process.env.SMS_PROVIDER || 'smsgate',
        errorCode: payload.reason ?? 'delivery_failed',
        errorMessage: payload.reason ?? 'delivery failed',
        metadata: { providerMessageId, event: event.event },
      });
    }

    await supabase.from('sms_webhook_events')
      .update({ processed_at: new Date().toISOString() }).eq('id', eventKey);

    return res.status(204).end();
  } catch (err) {
    console.error('sms/status error:', err);
    await record({
      correlationId,
      stage: STAGES.DELIVERY_FAILED,
      status: STATUS.FAILED,
      errorCode: err.code || 'unknown',
      errorMessage: err.message,
    });
    return res.status(500).send('error');
  }
});

module.exports = router;
