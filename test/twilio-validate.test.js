const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { isValidTwilioSignature } = require('../lib/twilio-validate');

const AUTH_TOKEN = 'test-token-abc-123';
const URL = 'https://faithon.ai/api/twilio/inbound';
const PARAMS = {
  MessageSid: 'SMabc',
  From: '+15551234567',
  To: '+19547950686',
  Body: 'PRAY',
  NumSegments: '1',
};

function signParams(url, params, token) {
  const sortedKeys = Object.keys(params).sort();
  const data = url + sortedKeys.map(k => k + String(params[k] ?? '')).join('');
  return crypto.createHmac('sha1', token).update(Buffer.from(data, 'utf-8')).digest('base64');
}

test('isValidTwilioSignature — accepts a correctly signed request', () => {
  const sig = signParams(URL, PARAMS, AUTH_TOKEN);
  assert.equal(isValidTwilioSignature(AUTH_TOKEN, sig, URL, PARAMS), true);
});

test('isValidTwilioSignature — rejects tampered body', () => {
  const sig = signParams(URL, PARAMS, AUTH_TOKEN);
  const tampered = { ...PARAMS, Body: 'STOP' };
  assert.equal(isValidTwilioSignature(AUTH_TOKEN, sig, URL, tampered), false);
});

test('isValidTwilioSignature — rejects wrong token', () => {
  const sig = signParams(URL, PARAMS, 'other-token');
  assert.equal(isValidTwilioSignature(AUTH_TOKEN, sig, URL, PARAMS), false);
});

test('isValidTwilioSignature — rejects missing signature', () => {
  assert.equal(isValidTwilioSignature(AUTH_TOKEN, '', URL, PARAMS), false);
  assert.equal(isValidTwilioSignature(AUTH_TOKEN, null, URL, PARAMS), false);
});

test('isValidTwilioSignature — rejects when auth token missing', () => {
  const sig = signParams(URL, PARAMS, AUTH_TOKEN);
  assert.equal(isValidTwilioSignature('', sig, URL, PARAMS), false);
  assert.equal(isValidTwilioSignature(null, sig, URL, PARAMS), false);
});

test('isValidTwilioSignature — key ordering doesn\'t matter (params get sorted)', () => {
  const sig = signParams(URL, PARAMS, AUTH_TOKEN);
  const reordered = { NumSegments: '1', Body: 'PRAY', To: '+19547950686', From: '+15551234567', MessageSid: 'SMabc' };
  assert.equal(isValidTwilioSignature(AUTH_TOKEN, sig, URL, reordered), true);
});
