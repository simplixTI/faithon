const express = require('express');
const { supabase } = require('../lib/supabase');
const { normalizePhoneE164 } = require('../lib/phone');
const { ensureUserWithTrial } = require('../lib/users');
const { isValidTwilioSignature } = require('../lib/twilio-validate');
const { computeSmsCostCents } = require('../lib/cost');

const router = express.Router();

const COMMANDS = new Set(['PRAY', 'HELP', 'STOP', 'START', 'UNSTOP']);

function detectCommand(body) {
  const raw = String(body || '').trim().toUpperCase();
  if (COMMANDS.has(raw)) return raw;
  return null;
}

function twimlEmpty(res) {
  res.set('content-type', 'text/xml');
  res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
}

function twimlText(res, body) {
  const esc = String(body || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  res.set('content-type', 'text/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${esc}</Message></Response>`);
}

async function getSettingText(key, fallback) {
  const { data } = await supabase.from('app_settings').select('value').eq('key', key).maybeSingle();
  const v = data?.value;
  return typeof v === 'string' ? v : fallback;
}

router.post('/twilio/inbound', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    // --- Optional signature validation ---
    if (process.env.TWILIO_AUTH_TOKEN) {
      const url = (process.env.TWILIO_STATUS_CALLBACK_URL?.split('/api/')[0] || `${req.protocol}://${req.get('host')}`) + req.originalUrl;
      const sig = req.headers['x-twilio-signature'];
      if (!isValidTwilioSignature(process.env.TWILIO_AUTH_TOKEN, sig, url, req.body)) {
        return res.status(403).send('invalid signature');
      }
    }

    const p = req.body || {};
    const messageSid = p.MessageSid || p.SmsMessageSid;
    if (!messageSid) return res.status(400).send('missing MessageSid');

    // Idempotency
    const { data: seen } = await supabase
      .from('sms_webhook_events').select('id, processed_at').eq('id', messageSid).maybeSingle();
    if (seen?.processed_at) return twimlEmpty(res);

    await supabase.from('sms_webhook_events').upsert({
      id: messageSid, type: 'inbound', payload: p,
    });

    const from = normalizePhoneE164(p.From);
    const to = normalizePhoneE164(p.To);
    if (!from) return res.status(400).send('bad From');

    const command = detectCommand(p.Body);
    const segments = parseInt(p.NumSegments || '1', 10) || 1;
    const cost = await computeSmsCostCents({ segments, direction: 'inbound' });

    const { user } = await ensureUserWithTrial(from, command === 'PRAY' ? 'sms:pray' : 'sms');

    await supabase.from('sms_messages').insert({
      user_id: user.id,
      direction: 'inbound',
      from_e164: from,
      to_e164: to,
      body: p.Body ?? null,
      twilio_message_sid: messageSid,
      num_segments: segments,
      status: 'received',
      command,
      price_cents: cost,
    });

    // Increment daily counter (inbound)
    const today = new Date().toISOString().slice(0, 10);
    await supabase.rpc('exec', {}).catch(() => {}); // noop for envs w/o rpc
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

    // --- Command handlers (STOP/HELP/START respond synchronously; PRAY defers to n8n)
    if (command === 'STOP') {
      await supabase.from('user_consents').upsert({
        user_id: user.id,
        opt_out: true,
        opt_out_at: new Date().toISOString(),
        opt_out_reason: 'STOP',
      }, { onConflict: 'user_id' });
      await supabase.from('users').update({ access_status: 'opted_out' }).eq('id', user.id);
      // Twilio's carrier layer auto-sends a STOP acknowledgement; do not double-send.
      await markProcessed(messageSid);
      return twimlEmpty(res);
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
      await markProcessed(messageSid);
      return twimlText(res, startText);
    }

    if (command === 'HELP') {
      const helpText = await getSettingText('text_help', 'FaithOn: a spiritual companion by SMS. Reply STOP to opt out. Support: help@faithon.ai');
      await markProcessed(messageSid);
      return twimlText(res, helpText);
    }

    // For PRAY (or any other message), leave the AI response to the n8n workflow.
    // The workflow polls sms_webhook_events / sms_messages OR is triggered
    // by this same webhook fan-out. Return empty TwiML so Twilio doesn't retry.
    await markProcessed(messageSid);
    return twimlEmpty(res);

  } catch (err) {
    console.error('twilio/inbound error:', err);
    return res.status(500).send('error');
  }
});

async function markProcessed(messageSid) {
  await supabase.from('sms_webhook_events')
    .update({ processed_at: new Date().toISOString() })
    .eq('id', messageSid);
}

router.post('/twilio/status', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    if (process.env.TWILIO_AUTH_TOKEN) {
      const url = (process.env.TWILIO_STATUS_CALLBACK_URL?.split('/api/')[0] || `${req.protocol}://${req.get('host')}`) + req.originalUrl;
      const sig = req.headers['x-twilio-signature'];
      if (!isValidTwilioSignature(process.env.TWILIO_AUTH_TOKEN, sig, url, req.body)) {
        return res.status(403).send('invalid signature');
      }
    }

    const p = req.body || {};
    const messageSid = p.MessageSid;
    if (!messageSid) return res.status(400).send('missing MessageSid');

    const eventId = `${messageSid}:${p.MessageStatus}`;
    const { data: seen } = await supabase
      .from('sms_webhook_events').select('id, processed_at').eq('id', eventId).maybeSingle();
    if (seen?.processed_at) return res.status(204).end();

    await supabase.from('sms_webhook_events').upsert({
      id: eventId, type: 'status_callback', payload: p,
    });

    const status = p.MessageStatus;
    const patch = { status };
    if (status === 'delivered') patch.delivered_at = new Date().toISOString();
    if (status === 'sent')      patch.sent_at = new Date().toISOString();
    if (p.ErrorCode)            patch.error_code = p.ErrorCode;
    if (p.ErrorMessage)         patch.error_message = p.ErrorMessage;

    await supabase.from('sms_messages').update(patch).eq('twilio_message_sid', messageSid);
    await supabase.from('sms_webhook_events')
      .update({ processed_at: new Date().toISOString() }).eq('id', eventId);

    res.status(204).end();
  } catch (err) {
    console.error('twilio/status error:', err);
    res.status(500).send('error');
  }
});

module.exports = router;
