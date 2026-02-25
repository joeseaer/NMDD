const fastify = require('fastify')({ logger: true });
const path = require('path');
require('dotenv').config();

console.log("----------------------------------------------------------------");
console.log("Server Starting...");
console.log("Environment Check:");
console.log("OPENAI_API_KEY:", process.env.OPENAI_API_KEY ? `Loaded (${process.env.OPENAI_API_KEY.substring(0, 5)}...)` : "MISSING");
console.log("OPENAI_BASE_URL:", process.env.OPENAI_BASE_URL);
console.log("----------------------------------------------------------------");

// Plugins
fastify.register(require('@fastify/cors'), { origin: true });
fastify.register(require('@fastify/websocket'));
fastify.register(require('@fastify/multipart'));

// Services
const dbService = require('./services/dbService');
const chatService = require('./services/chatService');
const sceneService = require('./services/sceneService');

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
fastify.register(require('./routes/api'), { prefix: '/api' });

const start = async () => {
  try {
    await dbService.initDB();
    const port = process.env.PORT || 3000;
    await fastify.listen({ port, host: '0.0.0.0' });
    console.log(`🚀 Server running on http://0.0.0.0:${port} (WebSocket enabled)`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();