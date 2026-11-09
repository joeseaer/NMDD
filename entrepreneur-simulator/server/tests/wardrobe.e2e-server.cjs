// Isolated browser-test API. No dotenv, remote database or production account.
const crypto = require('node:crypto');
process.env.AUTH_USERNAME = 'wardrobe-e2e';
process.env.AUTH_PASSWORD_HASH = `test-salt:${crypto.scryptSync('wardrobe-e2e-password','test-salt',64).toString('hex')}`;
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_KEY = '';
const Fastify = require('fastify');
const { createWardrobeDatabase } = require('./helpers/wardrobeDatabase');
const { createWardrobeService } = require('../services/wardrobeService');
async function start() {
  const database = await createWardrobeDatabase();
  const app = Fastify();
  await app.register(require('@fastify/multipart'),{limits:{fileSize:15*1024*1024}});
  await app.register(require('../routes/auth'),{prefix:'/api/auth'});
  await app.register(require('../routes/wardrobe'),{prefix:'/api/wardrobe',service:createWardrobeService(database.client)});
  app.get('/__test/health',()=>({ready:true}));
  app.post('/__test/reset',async (request,reply)=>{
    if (!require('../routes/auth').isAuthenticated(request)) return reply.code(401).send();
    await database.pg.exec('TRUNCATE wardrobe_outfit_items,wardrobe_outfits,wardrobe_items CASCADE'); database.state.objects.clear(); return {reset:true};
  });
  await app.listen({port:3101,host:'127.0.0.1'});
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal,async()=>{await app.close();await database.pg.close();process.exit(0);});
}
start().catch(error=>{console.error(error);process.exit(1);});
