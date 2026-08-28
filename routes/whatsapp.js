// FaithOn — Uzapi WhatsApp webhook receiver
//
// Receives inbound WhatsApp text messages from Uzapi and sends AI replies.
// Docs: https://api.uzapi.com.br/docs

const express = require('express');
const { supabase } = require('../lib/supabase');
const { normalizePhoneE164 } = require('../lib/phone');
const { ensureUserWithTrial } = require('../lib/users');
const { computeSmsCostCents } = require('../lib/cost');
const { estimateSegments } = require('../lib/sms-provider');
const { generateReply } = require('../lib/conversation-service');
const { checkEntitlement } = require('../lib/entitlement');
const whatsapp = require('../lib/whatsapp-provider');
const { STAGES, STATUS, record, startStage, completeStage } = require('../lib/trace');

const router = express.Router();

const COMMANDS = new Set(['PRAY', 'HELP', 'STOP', 'START', 'UNSTOP', 'PLUS']);

function detectCommand(body) {
  const raw = String(body || '').trim().toUpperCase();
  if (COMMANDS.has(raw)) return raw;
  return null;
}

async function getSettingText(key, fallback) {
  const { data } = await supabase.from('app_settings').select('value').eq('key', key).maybeSingle();
  const v = data?.value;
  return typeof v === 'string' ? v : fallback;
}

async function recordInboundMessage({ user, from, to, body, messageId, providerMetadata, command }) {
  const segments = estimateSegments(body);
  const cost = await computeSmsCostCents({ segments, direction: 'inbound' });

  const { data: inserted } = await supabase.from('sms_messages').insert({
    user_id: user.id,
    direction: 'inbound',
    from_e164: from,
    to_e164: to,
    body,
    provider: 'uzapi',
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

async function sendSystemReply({ to, text, userId, command = null, correlationId = null }) {
  const smsStage = await startStage({ correlationId, stage: STAGES.SMS_SEND_STARTED, provider: 'uzapi', userId });
  const result = await whatsapp.send({ to, text });
  const segments = estimateSegments(text);
  const cost = await computeSmsCostCents({ segments, direction: 'outbound' });

  const { data: inserted } = await supabase.from('sms_messages').insert({
    user_id: userId,
    direction: 'outbound',
    from_e164: null,
    to_e164: normalizePhoneE164(to),
    body: text,
    provider: 'uzapi',
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
 * POST /api/whatsapp/incoming
 * Receives inbound WhatsApp messages from Uzapi.
 */
router.post('/whatsapp/incoming', express.json(), async (req, res) => {
  const correlationId = `whatsapp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const flowStartedAt = Date.now();
  let userId = null;

  try {
    const inbound = whatsapp.normalizeInbound(req.body || {});



    // Persist raw event for inspection / replay
    try {
      await supabase.from('whatsapp_webhook_events').insert({
        correlation_id: correlationId,
        payload: req.body,
        received_at: new Date().toISOString(),
      });
    } catch (err) {
      console.error(`[whatsapp/incoming:${correlationId}] failed to persist raw event:`, err);
    }

    if (!inbound) {
      console.log(`[whatsapp/incoming:${correlationId}] ignored: non-text or no message`);
      return res.status(200).json({ ok: true });
    }

    console.log(`[whatsapp/incoming:${correlationId}] from=${inbound.from} body="${inbound.body}"`);

    if (!inbound.from) {
      await record({ correlationId, stage: STAGES.WEBHOOK_VALIDATED, status: STATUS.FAILED, errorCode: 'missing_sender', errorMessage: 'missing sender', metadata: { payload: req.body } });
      return res.status(400).send('missing sender');
    }

    await record({ correlationId, stage: STAGES.SMS_RECEIVED, status: STATUS.SUCCESS });
    await record({ correlationId, stage: STAGES.PHONE_NORMALIZED, status: STATUS.SUCCESS, metadata: { from: inbound.from } });

    // Ignore group messages for now
    if (inbound.isGroup) {
      await record({ correlationId, stage: STAGES.FLOW_COMPLETED, status: STATUS.SKIPPED, metadata: { reason: 'group_message' } });
      return res.status(200).json({ ok: true });
    }

    if (!inbound.messageId) {
      await record({ correlationId, stage: STAGES.WEBHOOK_VALIDATED, status: STATUS.FAILED, errorCode: 'missing_message_id', errorMessage: 'missing message id' });
      return res.status(400).send('missing message id');
    }

    await record({ correlationId, stage: STAGES.WEBHOOK_VALIDATED, status: STATUS.SUCCESS });

    // Idempotency
    const { error: insertError } = await supabase
      .from('sms_webhook_events')
      .insert({
        id: inbound.messageId,
        type: 'inbound',
        payload: req.body,
        processed_at: new Date().toISOString(),
      });
    if (insertError) {
      const isDuplicate = insertError.code === '23505' || String(insertError.message).includes('duplicate key');
      if (isDuplicate) {
        console.log(`[whatsapp/incoming:${correlationId}] duplicate webhook, skipping`);
        await record({ correlationId, stage: STAGES.FLOW_COMPLETED, status: STATUS.SKIPPED, metadata: { reason: 'duplicate_webhook' } });
        return res.status(200).json({ ok: true });
      }
      throw insertError;
    }

    const command = detectCommand(inbound.body);
    const userStage = await startStage({ correlationId, stage: STAGES.USER_LOOKUP_STARTED, provider: 'supabase' });
    const { user, isNew } = await ensureUserWithTrial(inbound.from, command === 'PRAY' ? 'whatsapp:pray' : 'whatsapp');
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
      providerMetadata: inbound.raw,
      command,
    });

    // Entitlement check
    const entitlementStage = await startStage({ correlationId, stage: STAGES.ENTITLEMENT_CHECK_STARTED, provider: 'supabase', userId: user.id, messageId: inboundMessageId });
    const entitlement = await checkEntitlement(inbound.from);
    if (!entitlement.allowed) {
      await completeStage(entitlementStage, { status: STATUS.FAILED, errorCode: entitlement.reason, metadata: { daily_used: entitlement.daily_used, daily_limit: entitlement.daily_limit } });
      await record({ correlationId, stage: STAGES.ENTITLEMENT_BLOCKED, status: STATUS.FAILED, userId: user.id, messageId: inboundMessageId, errorCode: entitlement.reason, metadata: { reason: entitlement.reason } });
      const limitText = await getSettingText('text_daily_limit', "You've reached your daily message limit. Reply PLUS to upgrade.");
      await sendSystemReply({ to: inbound.from, text: limitText, userId: user.id, command, correlationId });
      await record({ correlationId, stage: STAGES.FLOW_COMPLETED, status: STATUS.SUCCESS, userId: user.id, messageId: inboundMessageId, metadata: { command, blockedReason: entitlement.reason } });
      return res.status(200).json({ ok: true });
    }
    await completeStage(entitlementStage, { status: STATUS.SUCCESS, metadata: { plan: entitlement.plan, daily_used: entitlement.daily_used, daily_limit: entitlement.daily_limit } });
    await record({ correlationId, stage: STAGES.ENTITLEMENT_ALLOWED, status: STATUS.SUCCESS, userId: user.id, messageId: inboundMessageId, metadata: { plan: entitlement.plan } });

    // STOP
    if (command === 'STOP') {
      await supabase.from('user_consents').upsert({
        user_id: user.id,
        opt_out: true,
        opt_out_at: new Date().toISOString(),
        opt_out_reason: 'STOP',
      }, { onConflict: 'user_id' });
      await supabase.from('users').update({ access_status: 'opted_out' }).eq('id', user.id);
      await record({ correlationId, stage: STAGES.FLOW_COMPLETED, status: STATUS.SUCCESS, userId: user.id, metadata: { command: 'STOP' } });
      return res.status(200).json({ ok: true });
    }

    // START/UNSTOP
    if (command === 'START' || command === 'UNSTOP') {
      await supabase.from('user_consents').upsert({
        user_id: user.id,
        opt_in: true,
        opt_in_at: new Date().toISOString(),
        opt_in_source: `whatsapp:${command}`,
        opt_out: false,
        opt_out_at: null,
        opt_out_reason: null,
      }, { onConflict: 'user_id' });
      await supabase.from('users').update({
        access_status: user.tier === 'plus' ? 'active' : 'free',
      }).eq('id', user.id);
      const text = await getSettingText('text_start_ack', 'Welcome back to FaithOn. Send PRAY to begin.');
      await sendSystemReply({ to: inbound.from, text, userId: user.id, command, correlationId });
      await record({ correlationId, stage: STAGES.FLOW_COMPLETED, status: STATUS.SUCCESS, userId: user.id, metadata: { command } });
      return res.status(200).json({ ok: true });
    }

    // HELP
    if (command === 'HELP') {
      const text = await getSettingText('text_help', 'FaithOn: a spiritual companion by WhatsApp. Reply STOP to opt out. Support: help@faithon.ai');
      await sendSystemReply({ to: inbound.from, text, userId: user.id, command, correlationId });
      await record({ correlationId, stage: STAGES.FLOW_COMPLETED, status: STATUS.SUCCESS, userId: user.id, metadata: { command: 'HELP' } });
      return res.status(200).json({ ok: true });
    }

    // PLUS
    if (command === 'PLUS') {
      const paymentLink = process.env.STRIPE_PAYMENT_LINK || 'https://buy.stripe.com/cNi6oH5g951JfCn6sCenS00';
      const upgradeText = await getSettingText('text_upgrade_link', 'Upgrade to FaithOn Plus for $1.99/mo: {url}');
      const text = upgradeText.replace('{url}', paymentLink);
      await sendSystemReply({ to: inbound.from, text, userId: user.id, command, correlationId });
      await record({ correlationId, stage: STAGES.FLOW_COMPLETED, status: STATUS.SUCCESS, userId: user.id, metadata: { command: 'PLUS', paymentLink } });
      return res.status(200).json({ ok: true });
    }

    // AI reply
    const isFirstInteraction = !!user.isNew;
    const aiStage = await startStage({ correlationId, stage: STAGES.AI_REQUEST_STARTED, provider: process.env.AI_PROVIDER || 'deepseek', userId: user.id, messageId: inboundMessageId });
    const aiResult = await generateReply({
      user,
      body: inbound.body,
      isFirstInteraction,
      correlationId,
      messageId: inboundMessageId,
      channel: 'whatsapp',
    });
    await completeStage(aiStage, { status: STATUS.SUCCESS, metadata: { tokens: aiResult.tokens } });

    await sendSystemReply({ to: inbound.from, text: aiResult.text, userId: user.id, command, correlationId });

    const totalMs = Date.now() - flowStartedAt;
    await record({ correlationId, stage: STAGES.FLOW_COMPLETED, status: STATUS.SUCCESS, userId: user.id, durationMs: totalMs });

    console.log(`[whatsapp/incoming:${correlationId}] AI replied to ${inbound.from}: "${aiResult.text.slice(0, 80)}..."`);
    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error(`[whatsapp/incoming:${correlationId}] error:`, err);
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

module.exports = router;
