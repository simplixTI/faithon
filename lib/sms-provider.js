// FaithOn — SMS Provider abstraction
//
// Goal: the rest of the backend never knows which SMS gateway is in use.
// Switch providers by changing SMS_PROVIDER env var.
//
// Supported providers:
//   SMS_PROVIDER=smsgate   -> Android SMS Gateway (capcom6/android-sms-gateway)

const { sendSms, estimateSegments } = require('./smsgate');
const { normalizePhoneE164 } = require('./phone');

class SmsProvider {
  /**
   * Send an outbound SMS.
   * @param {Object} opts
   * @param {string} opts.to   E.164 phone number
   * @param {string} opts.text Message text
   * @returns {Promise<{providerMessageId: string|null, state: string|null, raw: object}>}
   */
  async send({ to, text }) {
    throw new Error('SmsProvider.send() not implemented');
  }

  /**
   * Normalize an inbound webhook payload into a common shape.
   * @param {Object} payload
   * @returns {{from: string|null, to: string|null, body: string|null, messageId: string|null, raw: object}}
   */
  normalizeInbound(payload) {
    throw new Error('SmsProvider.normalizeInbound() not implemented');
  }
}

class SmsgateProvider extends SmsProvider {
  async send({ to, text }) {
    const result = await sendSms({ to, text });
    return {
      providerMessageId: result?.id ?? null,
      state: result?.state ?? null,
      raw: result,
    };
  }

  normalizeInbound(payload) {
    const p = payload?.payload || {};
    return {
      from: normalizePhoneE164(p.sender),
      to: normalizePhoneE164(p.recipient),
      body: typeof p.message === 'string' ? p.message : null,
      messageId: p.messageId ?? payload?.id ?? null,
      raw: payload,
    };
  }
}

function getSmsProvider() {
  const name = (process.env.SMS_PROVIDER || 'smsgate').toLowerCase();
  if (name === 'smsgate') return new SmsgateProvider();
  throw new Error(`Unsupported SMS_PROVIDER: ${name}`);
}

module.exports = {
  SmsProvider,
  SmsgateProvider,
  getSmsProvider,
  estimateSegments,
};
