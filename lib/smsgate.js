// FaithOn — SMSGate (SMS Gateway for Android) client
// Docs: https://docs.sms-gate.app
//
// Supports both modes:
//   Local mode:  http://192.168.x.x:8080  (device on LAN)
//   Cloud mode:  https://api.sms-gate.app/3rdparty/v1  (managed cloud)
//
// Cloud mode is used in production (Vercel). Local mode for development.

const http = require('http');
const https = require('https');

function getConfig() {
  const url = (process.env.SMSGATE_URL || 'http://192.168.15.2:8080').replace(/\/$/, '');
  const isCloud = url.includes('api.sms-gate.app') || url.includes('/3rdparty/v1');
  return {
    url,
    isCloud,
    username: process.env.SMSGATE_USER || 'sms',
    password: process.env.SMSGATE_PASS || 'Gab@2020',
    deviceId: process.env.SMSGATE_DEVICE_ID || null,
  };
}

function basicAuth(username, password) {
  return Buffer.from(`${username}:${password}`).toString('base64');
}

function requestJson(path, { method = 'GET', body = null } = {}) {
  const { url, username, password } = getConfig();
  const parsed = new URL(`${url}${path}`);
  const useHttps = parsed.protocol === 'https:';
  const client = useHttps ? https : http;

  const payload = body ? JSON.stringify(body) : null;
  const options = {
    hostname: parsed.hostname,
    port: parsed.port || (useHttps ? 443 : 8080),
    path: parsed.pathname + parsed.search,
    method,
    headers: {
      Authorization: `Basic ${basicAuth(username, password)}`,
      ...(payload ? {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      } : {}),
    },
  };

  return new Promise((resolve, reject) => {
    const req = client.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try {
          if (data.trim()) json = JSON.parse(data);
        } catch {
          // leave json null for empty/non-JSON bodies
        }
        resolve({ status: res.statusCode, body: json ?? data });
      });
    });

    req.on('error', (err) => reject(err));
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * Send an SMS via SMSGate.
 * @param {Object} opts
 * @param {string} opts.to      E.164 phone number
 * @param {string} opts.text    Message text
 * @returns {Promise<Object>}   SMSGate response body
 */
async function sendSms({ to, text }) {
  const { isCloud, deviceId } = getConfig();
  const path = isCloud ? '/messages' : '/message';
  const payload = {
    textMessage: { text },
    phoneNumbers: [to],
  };
  if (isCloud && deviceId) {
    payload.device_id = deviceId;
  }

  const { body } = await requestJson(path, {
    method: 'POST',
    body: payload,
  });
  return body;
}

/**
 * Register a webhook on the SMSGate device/cloud.
 * @param {Object} opts
 * @param {string} opts.url     Your webhook endpoint URL
 * @param {string} opts.event   SMSGate event, e.g. 'sms:received'
 * @param {string} [opts.deviceId]
 */
async function registerWebhook({ url, event, deviceId }) {
  const { isCloud, deviceId: configDeviceId } = getConfig();
  const path = isCloud ? '/webhooks' : '/webhooks';
  const payload = { url, event };
  const finalDeviceId = deviceId || configDeviceId;
  if (finalDeviceId) payload.device_id = finalDeviceId;
  return requestJson(path, { method: 'POST', body: payload });
}

/**
 * List registered webhooks.
 */
async function listWebhooks() {
  const { isCloud } = getConfig();
  const path = isCloud ? '/webhooks' : '/webhooks';
  return requestJson(path, { method: 'GET' });
}

/**
 * Estimate SMS segments for cost accounting.
 * Simplistic: 160 chars for GSM-7, 70 for Unicode.
 */
function estimateSegments(text) {
  const isUnicode = /[^\u0000-\u00ff]/.test(text);
  const limit = isUnicode ? 70 : 160;
  return Math.max(1, Math.ceil((text || '').length / limit));
}

module.exports = {
  getConfig,
  sendSms,
  registerWebhook,
  listWebhooks,
  estimateSegments,
};
