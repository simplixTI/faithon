// FaithOn — UazapiGO WhatsApp provider
//
// Docs: https://docs.uazapi.com/
// Send message: POST /send/text (header: token)
// Webhook events: POST to configured URL with { event, instance, data }

const UAZAPI_BASE = process.env.UAZAPI_BASE_URL || 'https://free.uazapi.com';

function getConfig() {
  return {
    baseUrl: UAZAPI_BASE,
    token: process.env.UAZAPI_INSTANCE_TOKEN,
  };
}

function waIdToE164(waId) {
  // wa_id may come as "5511999999999" or "5511999999999@s.whatsapp.net"
  const digits = String(waId || '').split('@')[0].replace(/\D/g, '');
  return digits ? `+${digits}` : null;
}

function normalizeInbound(body) {
  // UazapiGO format: { EventType, BaseUrl, instanceName, chat, message }
  if (!body || body.EventType !== 'messages') return null;

  const msg = body.message || {};
  const chat = body.chat || {};

  // Ignore messages sent by ourselves and group messages
  if (msg.fromMe) return null;
  if (msg.isGroup || chat.wa_isGroup) return null;

  // Only text messages
  const messageType = msg.messageType || '';
  if (messageType !== 'Conversation' && messageType !== 'ExtendedTextMessage') {
    return null;
  }

  // msg.text is always a plain string; msg.content may be an object
  // (ExtendedTextMessage from click-to-chat links: { text, contextInfo })
  let text = msg.text ?? msg.content ?? '';
  if (text && typeof text === 'object') text = text.text || '';
  if (typeof text !== 'string') text = String(text);
  if (!text) return null;

  // Sender phone is in chat.phone or message.chatid; sender LID is not E.164
  const senderPhone = chat.phone || (msg.chatid || '').split('@')[0];

  return {
    from: waIdToE164(senderPhone),
    to: waIdToE164(msg.owner || chat.owner),
    body: text,
    messageId: msg.messageid || msg.id,
    timestamp: msg.messageTimestamp ? new Date(msg.messageTimestamp).toISOString() : new Date().toISOString(),
    isGroup: msg.isGroup || chat.wa_isGroup || false,
    instance: body.instanceName,
    raw: body,
  };
}

async function send({ to, text }) {
  const cfg = getConfig();
  if (!cfg.token) {
    throw new Error('UAZAPI_INSTANCE_TOKEN not configured');
  }

  const number = String(to || '').replace(/\D/g, '');
  if (!number) {
    throw new Error('invalid phone number');
  }

  const url = `${cfg.baseUrl}/send/text`;
  console.log('[whatsapp-provider] sending to', url, 'number=', number, 'token=', cfg.token ? cfg.token.slice(0, 8) + '...' : 'MISSING');
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'token': cfg.token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      number,
      text,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`UazapiGO send failed: ${res.status} ${JSON.stringify(data)}`);
  }

  return {
    providerMessageId: data.messageid || data.id || null,
    raw: data,
  };
}

module.exports = {
  normalizeInbound,
  send,
  waIdToE164,
};
