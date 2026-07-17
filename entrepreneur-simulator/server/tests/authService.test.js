const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const testPassword = 'test-password';
const testSalt = 'unit-test-salt';
process.env.AUTH_USERNAME = 'test-user';
process.env.AUTH_PASSWORD_HASH = `${testSalt}:${crypto.scryptSync(testPassword, testSalt, 64).toString('hex')}`;
const {
  createSessionToken,
  verifyCredentials,
  verifyPassword,
  verifySessionToken,
} = require('../services/authService');

test('accepts the configured application credential only', () => {
  assert.equal(verifyCredentials('test-user', testPassword), true);
  assert.equal(verifyCredentials('test-user', 'wrong'), false);
  assert.equal(verifyCredentials('wrong', testPassword), false);
  assert.equal(verifyPassword(''), false);
});

test('creates valid signed sessions and rejects tampering or expiry', () => {
  const now = Date.now();
  const token = createSessionToken(now);
  assert.equal(verifySessionToken(token, now), true);
  assert.equal(verifySessionToken(`${token}x`, now), false);
  assert.equal(verifySessionToken(token, now + 8 * 24 * 60 * 60 * 1000), false);
});
