const { isAuthenticated } = require('./auth');
const { websiteResearchDocuments } = require('../services/researchDocumentService');

module.exports = async function researchDocumentRoutes(app, options) {
  app.patch('/:id/chatgpt-access', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!isAuthenticated(request)) return reply.code(401).send({ error: '请先登录' });
    const body = request.body;
    if (!body || Object.keys(body).length !== 1 || typeof body.enabled !== 'boolean') {
      return reply.code(400).send({ error: '请提供 enabled 布尔值' });
    }
    try {
      return await (options.service || websiteResearchDocuments()).setAccess(request.params.id, body.enabled);
    } catch (error) {
      return reply.code(error.statusCode || 503).send({ error: error.message });
    }
  });
};
