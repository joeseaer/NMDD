const defaultService = require('../services/wardrobeService');
const { isAuthenticated } = require('./auth');
const { LIMITS, WardrobeError, ensure } = require('../services/wardrobeBundle');

module.exports = async function wardrobeRoutes(app, options) {
  const service = options.service || defaultService;
  // Also enforce auth when this plugin is mounted independently (e.g. integration tests).
  app.addHook('onRequest', async (request, reply) => {
    if (!isAuthenticated(request)) return reply.code(401).send({ error: '请先登录' });
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof WardrobeError) return reply.code(error.statusCode).send({ error: error.message, created: 0, skipped: 0, updated: 0, failed: error.details.length || 1, errors: error.details.length ? error.details : [{ message: error.message }] });
    if (error.statusCode === 413 || error.code?.startsWith('FST_')) return reply.code(error.statusCode || 400).send({ error: '上传超限或请求格式错误（ZIP 60MB，图片 8MB）' });
    request.log.error({ event: 'wardrobe_request_failed' }, 'Wardrobe request failed');
    return reply.code(503).send({ error: '衣橱操作失败，请稍后重试' });
  });
  app.addHook('preValidation', async request => {
    if (request.params?.id) ensure(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(request.params.id), '记录 ID 无效');
  });
  async function upload(request, max, withData = false) {
    let file, data;
    for await (const part of request.parts({ limits: { fileSize: max, files: 1, fields: withData ? 1 : 0, parts: withData ? 2 : 1, fieldSize: LIMITS.json } })) {
      if (part.type === 'file') { ensure(part.fieldname === 'file', '文件字段必须为 file'); file = { bytes: await part.toBuffer(), filename: part.filename, mimetype: part.mimetype }; }
      else { ensure(part.fieldname === 'data' && !part.valueTruncated, '数据字段无效'); try { data = JSON.parse(part.value); } catch { throw new WardrobeError('衣物 JSON 无效'); } }
    }
    ensure(file, '请选择文件');
    return { file, data };
  }
  app.get('/items', request => service.listItems(request.query));
  app.get('/items/:id', request => service.getItemDetails(request.params.id));
  app.post('/items', async (request, reply) => { const { file, data } = await upload(request, LIMITS.image, true); return reply.code(201).send(await service.createItem(data, file)); });
  app.patch('/items/:id', request => service.patchItem(request.params.id, request.body));
  app.delete('/items/:id', request => service.deleteItem(request.params.id));
  app.post('/items/:id/image', async request => { const { file } = await upload(request, LIMITS.image); return service.replaceImage(request.params.id, file); });
  app.get('/items/:id/image', async (request, reply) => {
    const image = await service.getImage(request.params.id);
    return reply.type(image.mime).header('Cache-Control', 'private, no-store').header('X-Content-Type-Options', 'nosniff').send(image.bytes);
  });
  app.post('/import', async request => { const { file } = await upload(request, LIMITS.zip); return service.importBundle(file.bytes, request.query.mode || 'skip_existing'); });
  app.get('/export', async (_request, reply) => reply.type('application/zip').header('Cache-Control', 'private, no-store').header('Content-Disposition', 'attachment; filename="nmdd-wardrobe-v1.zip"').send(await service.exportBundle()));
  app.get('/outfits', () => service.listOutfits());
  app.post('/outfits', async (request, reply) => reply.code(201).send(await service.saveOutfit(null, request.body)));
  app.patch('/outfits/:id', request => service.saveOutfit(request.params.id, request.body));
  app.delete('/outfits/:id', request => service.deleteOutfit(request.params.id));
};
