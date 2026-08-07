const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizePhoneE164 } = require('../lib/phone');

test('normalizePhoneE164 — US 10-digit → +1XXXXXXXXXX', () => {
  assert.equal(normalizePhoneE164('5551234567'), '+15551234567');
  assert.equal(normalizePhoneE164('(555) 123-4567'), '+15551234567');
  assert.equal(normalizePhoneE164('555.123.4567'), '+15551234567');
});

test('normalizePhoneE164 — US 11-digit with country code', () => {
  assert.equal(normalizePhoneE164('15551234567'), '+15551234567');
  assert.equal(normalizePhoneE164('1-555-123-4567'), '+15551234567');
});

test('normalizePhoneE164 — already E.164', () => {
  assert.equal(normalizePhoneE164('+15551234567'), '+15551234567');
});

test('normalizePhoneE164 — international 12–15 digits', () => {
  assert.equal(normalizePhoneE164('+551199991234'), '+551199991234');
  assert.equal(normalizePhoneE164('551199991234'), '+551199991234');
});

test('normalizePhoneE164 — rejects nonsense', () => {
  assert.equal(normalizePhoneE164(''), null);
  assert.equal(normalizePhoneE164(null), null);
  assert.equal(normalizePhoneE164(undefined), null);
  assert.equal(normalizePhoneE164('abc'), null);
  assert.equal(normalizePhoneE164('123'), null); // too short
});
