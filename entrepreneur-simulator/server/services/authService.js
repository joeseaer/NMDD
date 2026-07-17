const crypto = require('crypto');

const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

const configuredUsername = () => process.env.AUTH_USERNAME || '';
const configuredPasswordHash = () => process.env.AUTH_PASSWORD_HASH || '';
const sessionSecret = process.env.AUTH_SESSION_SECRET || crypto.randomBytes(32).toString('hex');

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function verifyPassword(password, encodedHash = configuredPasswordHash()) {
  const [salt, expectedHex] = String(encodedHash).split(':');
  if (!salt || !expectedHex || !/^[a-f0-9]+$/i.test(expectedHex)) return false;
  const actual = crypto.scryptSync(String(password || ''), salt, expectedHex.length / 2);
  return safeEqual(actual.toString('hex'), expectedHex.toLowerCase());
}

function verifyCredentials(username, password) {
  return safeEqual(username, configuredUsername()) && verifyPassword(password);
}

function sign(value) {
  return crypto.createHmac('sha256', sessionSecret).update(value).digest('base64url');
}

function createSessionToken(now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({
    sub: configuredUsername(),
    exp: Math.floor(now / 1000) + SESSION_TTL_SECONDS,
  })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function verifySessionToken(token, now = Date.now()) {
  const [payload, signature] = String(token || '').split('.');
  if (!payload || !signature || !safeEqual(signature, sign(payload))) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data.sub === configuredUsername() && Number(data.exp) > Math.floor(now / 1000);
  } catch {
    return false;
  }
}

module.exports = {
  SESSION_TTL_SECONDS,
  createSessionToken,
  verifyCredentials,
  verifyPassword,
  verifySessionToken,
};
