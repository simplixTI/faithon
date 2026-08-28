#!/usr/bin/env node
// =====================================================================
// FaithOn — Simulate an inbound PRAY over WhatsApp for a given number.
//
// Use when UAZAPI was offline and the person's message was lost.
// Requires the recipient to have opened the 24h window (they messaged us first).
//
// Usage:
//   node scripts/simulate-pray-whatsapp.js +18165551234
//   node scripts/simulate-pray-whatsapp.js +18165551234 --dry-run
// =====================================================================
require('dotenv').config();

const { supabase } = require('../lib/supabase');
const { normalizePhoneE164 } = require('../lib/phone');
const { ensureUserWithTrial } = require('../lib/users');
const { generateReply } = require('../lib/conversation-service');
const { estimateSegments } = require('../lib/sms-provider');
const { computeSmsCostCents } = require('../lib/cost');
const whatsapp = require('../lib/whatsapp-provider');

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const rawPhone = args.find((a) => !a.startsWith('-'));

  if (!rawPhone) {
    console.error('Usage: node scripts/simulate-pray-whatsapp.js <phone> [--dry-run]');
    process.exit(1);
  }

  const phone = normalizePhoneE164(rawPhone);
  if (!phone) {
    console.error(`Invalid phone: ${rawPhone}`);
    process.exit(1);
  }

  if (!process.env.UAZAPI_INSTANCE_TOKEN) {
    console.error('UAZAPI_INSTANCE_TOKEN not set — cannot send.');
    process.exit(1);
  }

  console.log(`Target: ${phone}${dryRun ? ' (DRY RUN)' : ''}`);

  const { user, isNew } = await ensureUserWithTrial(phone, 'whatsapp:pray');
  console.log(`User: ${user.id} (${isNew ? 'new — trial started' : 'existing'})`);

  const inboundBody = 'PRAY';
  const inboundSegments = estimateSegments(inboundBody);
  const inboundCost = await computeSmsCostCents({ segments: inboundSegments, direction: 'inbound' });
  const syntheticMessageId = `simulated-pray-${Date.now()}`;

  const { data: inbound, error: inboundErr } = await supabase.from('sms_messages').insert({
    user_id: user.id,
    direction: 'inbound',
    from_e164: phone,
    to_e164: null,
    body: inboundBody,
    provider: 'uzapi',
    provider_message_id: syntheticMessageId,
    provider_metadata: { simulated: true, reason: 'uazapi_offline_recovery' },
    num_segments: inboundSegments,
    status: 'received',
    command: 'PRAY',
    price_cents: inboundCost,
  }).select('id').single();
  if (inboundErr) throw inboundErr;
  console.log(`Inbound PRAY recorded: ${inbound.id}`);

  const aiResult = await generateReply({
    user,
    body: inboundBody,
    isFirstInteraction: isNew,
    correlationId: syntheticMessageId,
    messageId: inbound.id,
    channel: 'whatsapp',
  });
  console.log(`AI reply (${aiResult.text.length} chars):\n  "${aiResult.text}"`);

  if (dryRun) {
    console.log('--- DRY RUN — nothing sent ---');
    return;
  }

  const sendResult = await whatsapp.send({ to: phone, text: aiResult.text });
  const outSegments = estimateSegments(aiResult.text);
  const outCost = await computeSmsCostCents({ segments: outSegments, direction: 'outbound' });

  const { data: outbound } = await supabase.from('sms_messages').insert({
    user_id: user.id,
    direction: 'outbound',
    from_e164: null,
    to_e164: phone,
    body: aiResult.text,
    provider: 'uzapi',
    provider_message_id: sendResult.providerMessageId,
    provider_metadata: sendResult.raw,
    num_segments: outSegments,
    status: 'queued',
    command: 'PRAY',
    price_cents: outCost,
  }).select('id').single();

  await supabase.from('users').update({
    last_active_at: new Date().toISOString(),
    last_message_at: new Date().toISOString(),
  }).eq('id', user.id);

  console.log(`Sent via UAZAPI: providerMessageId=${sendResult.providerMessageId}`);
  console.log(`Outbound recorded: ${outbound.id}`);
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
