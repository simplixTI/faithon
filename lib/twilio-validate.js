const crypto = require('crypto');

/**
 * Validates a Twilio webhook signature (X-Twilio-Signature).
 * Docs: https://www.twilio.com/docs/usage/webhooks/webhooks-security
 *
 * @param {string} authToken   - TWILIO_AUTH_TOKEN
 * @param {string} signature   - X-Twilio-Signature header from request
 * @param {string} url         - full URL Twilio POSTed to (including query string)
 * @param {object} params      - parsed form params from the POST body
 */
function isValidTwilioSignature(authToken, signature, url, params) {
  if (!authToken || !signature) return false;
  const sortedKeys = Object.keys(params).sort();
  const data = url + sortedKeys.map(k => k + String(params[k] ?? '')).join('');
  const expected = crypto
    .createHmac('sha1', authToken)
    .update(Buffer.from(data, 'utf-8'))
    .digest('base64');
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

module.exports = { isValidTwilioSignature };
