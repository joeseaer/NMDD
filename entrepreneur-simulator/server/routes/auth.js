const {
  SESSION_TTL_SECONDS,
  createSessionToken,
  verifyCredentials,
  verifySessionToken,
} = require('../services/authService');

const COOKIE_NAME = 'nmdd_session';

function parseCookies(header = '') {
  return String(header).split(';').reduce((cookies, part) => {
    const separator = part.indexOf('=');
    if (separator < 0) return cookies;
    cookies[part.slice(0, separator).trim()] = decodeURIComponent(part.slice(separator + 1).trim());
    return cookies;
  }, {});
}

function sessionCookie(token, maxAge) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

function isAuthenticated(request) {
  return verifySessionToken(parseCookies(request.headers.cookie)[COOKIE_NAME]);
}

async function authRoutes(fastify) {
  fastify.post('/login', async (request, reply) => {
    const { username = '', password = '' } = request.body || {};
    if (!verifyCredentials(username, password)) {
      return reply.code(401).send({ error: '账号或密码错误' });
    }
    reply.header('Set-Cookie', sessionCookie(createSessionToken(), SESSION_TTL_SECONDS));
    return { authenticated: true, username: String(username) };
  });

  fastify.get('/session', async (request, reply) => {
    if (!isAuthenticated(request)) return reply.code(401).send({ authenticated: false });
    return { authenticated: true };
  });

  fastify.post('/logout', async (_request, reply) => {
    reply.header('Set-Cookie', sessionCookie('', 0));
    return { authenticated: false };
  });
}

module.exports = authRoutes;
module.exports.isAuthenticated = isAuthenticated;
