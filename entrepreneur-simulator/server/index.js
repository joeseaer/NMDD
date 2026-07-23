const fastify = require('fastify')({ logger: true });
const path = require('path');
require('dotenv').config();

const LOCAL_ORIGIN_PATTERN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;
const configuredOrigins = new Set(
  String(process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
);

function allowLocalOrigin(origin, callback) {
  if (!origin || LOCAL_ORIGIN_PATTERN.test(origin) || configuredOrigins.has(origin)) {
    callback(null, true);
    return;
  }
  // CORS is a browser policy, not an authentication boundary. Returning false
  // keeps direct cross-origin browser calls blocked without rejecting trusted
  // reverse-proxy requests (for example, Vercel forwarding /api to Railway).
  callback(null, false);
}

// Plugins
fastify.register(require('@fastify/cors'), { origin: allowLocalOrigin });
fastify.register(require('@fastify/websocket'));
fastify.register(require('@fastify/multipart'), {
  limits: {
    fileSize: 15 * 1024 * 1024,
  },
});

// Services
const dbService = require('./services/dbService');
const chatService = require('./services/chatService');
const sceneService = require('./services/sceneService');
const { isAuthenticated } = require('./routes/auth');

fastify.addHook('onRequest', async (request, reply) => {
  const pathname = String(request.raw.url || '').split('?')[0];
  if (!pathname.startsWith('/api/') || pathname.startsWith('/api/auth/')) return;
  if (!isAuthenticated(request)) {
    return reply.code(401).send({ error: '请先登录' });
  }
});

// WebSocket for Real-time Chat Assistant & Scene Sync
fastify.register(async function (fastify) {
  fastify.get('/ws', { websocket: true }, (connection, req) => {
    connection.socket.on('message', async (message) => {
      try {
        const data = JSON.parse(message);
        // Handle different message types
        if (data.type === 'CHAT_ASSISTANT') {
          const response = await chatService.processAssistantMessage(data.payload);
          connection.socket.send(JSON.stringify({ type: 'ASSISTANT_RESPONSE', payload: response }));
        } else if (data.type === 'SCENE_ACTION') {
          // Handle scene interactions via WS for lower latency
          const response = await sceneService.processInteraction(data.payload);
          connection.socket.send(JSON.stringify({ type: 'SCENE_UPDATE', payload: response }));
        }
      } catch (err) {
        fastify.log.error(err);
        connection.socket.send(JSON.stringify({ type: 'ERROR', payload: 'Processing failed' }));
      }
    });
  });
});

// REST API Routes
fastify.register(require('./routes/auth'), { prefix: '/api/auth' });
fastify.register(require('./routes/api'), { prefix: '/api' });
fastify.register(require('./routes/relationshipSystem'), { prefix: '/api/relationship-system' });

const start = async () => {
  try {
    await dbService.initDB();
    const port = Number(process.env.PORT || 3000);
    // Railway can only route traffic to a process listening on every
    // interface. Force the required binding there even if a stale HOST value
    // was copied from a local .env; local setups can still opt into 127.0.0.1.
    const isRailway = Boolean(
      process.env.RAILWAY_ENVIRONMENT_ID || process.env.RAILWAY_DEPLOYMENT_ID
    );
    const host = isRailway ? '0.0.0.0' : (process.env.HOST || '0.0.0.0');
    await fastify.listen({ port, host });
    console.log(`Server running on http://${host}:${port} (WebSocket enabled)`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
