// Isolated browser-test API. No dotenv, remote database or production account.
const crypto = require('node:crypto');
process.env.AUTH_USERNAME = 'wardrobe-e2e';
process.env.AUTH_PASSWORD_HASH = `test-salt:${crypto.scryptSync('wardrobe-e2e-password','test-salt',64).toString('hex')}`;
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_KEY = '';
process.env.DEFAULT_USER_ID = 'nmdd-mcp-acceptance';
const Fastify = require('fastify');
const { createWardrobeDatabase } = require('./helpers/wardrobeDatabase');
const { createWardrobeService } = require('../services/wardrobeService');
const { createInspirationService } = require('../services/inspirationService');
const { createOAuthService, configuration } = require('../services/mcpOAuth');
async function start() {
  const cloud=await require('./helpers/isolatedSupabase').createIsolatedSupabase();
  const database = cloud || await createWardrobeDatabase();
  async function reset(){
    if(cloud)return cloud.reset();
    await database.pg.exec('TRUNCATE wardrobe_outfit_items,wardrobe_outfits,wardrobe_items,wardrobe_inspirations,wardrobe_inspiration_images,nmdd_write_requests,nmdd_tool_audit,nmdd_oauth_clients CASCADE');database.state.objects.clear();
  }
  const app = Fastify();
  await app.register(require('@fastify/multipart'),{limits:{fileSize:15*1024*1024}});
  await app.register(require('../routes/auth'),{prefix:'/api/auth'});
  const wardrobe=createWardrobeService(database.client);
  await app.register(require('../routes/wardrobe'),{prefix:'/api/wardrobe',service:wardrobe});
  const config=configuration({NMDD_MCP_PUBLIC_URL:'http://127.0.0.1:3101',NMDD_SITE_URL:'http://127.0.0.1:5178',NMDD_MCP_SECRET:'isolated-browser-test-secret-over-32-chars'});
  await app.register(require('../routes/mcp'),{oauth:createOAuthService(database.client,config),wardrobe,inspirations:createInspirationService(database.client,{wardrobe,siteUrl:config.site})});
  app.get('/__test/health',()=>({ready:true,storage:cloud?.mode||'isolated-postgresql'}));
  app.post('/__test/reset',async (request,reply)=>{
    if (!require('../routes/auth').isAuthenticated(request)) return reply.code(401).send();
    await reset(); return {reset:true};
  });
  await app.listen({port:3101,host:'127.0.0.1'});
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal,async()=>{await app.close();if(cloud)await cloud.close();else await database.pg.close();process.exit(0);});
}
start().catch(error=>{console.error(error);process.exit(1);});
