const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Fastify = require('fastify');
const multipart = require('@fastify/multipart');
const { createWardrobeDatabase } = require('./helpers/wardrobeDatabase');
const { createWardrobeService } = require('../services/wardrobeService');
const { parseBundle, zipFiles, readZip, LIMITS, normalizeItem, imageInfo } = require('../services/wardrobeBundle');
const { createSessionToken } = require('../services/authService');
const routes = require('../routes/wardrobe');
const fixture = fs.readFileSync(path.join(__dirname,'fixtures/wardrobe/mock-ten.zip'));
const demo = fs.readFileSync(path.join(__dirname,'fixtures/wardrobe/provided-demo.zip'));
const cookie = `nmdd_session=${createSessionToken()}`;
const multipartBody = (bytes,filename='bundle.zip',mime='application/zip',data) => {
  const boundary = 'wardrobe-tests-boundary';
  return { headers: { cookie, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: Buffer.concat([
    ...(data ? [Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="data"\r\n\r\n${JSON.stringify(data)}\r\n`)] : []),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`), bytes, Buffer.from(`\r\n--${boundary}--\r\n`),
  ]) };
};
async function mutateZip(change) { const files = await readZip(fixture); const items = JSON.parse(files.get('items.json')); const manifest = JSON.parse(files.get('manifest.json')); await change({ files, items, manifest }); files.set('items.json',Buffer.from(JSON.stringify(items))); files.set('manifest.json',Buffer.from(JSON.stringify(manifest))); return zipFiles(files); }

test('wardrobe production SQL, routes, storage and exchange round-trip', async t => {
  const database = await createWardrobeDatabase(); t.after(() => database.pg.close());
  const { pg, client, state, migration } = database;
  const service = createWardrobeService(client);
  const app = Fastify(); await app.register(multipart,{ limits: { fileSize: 15*1024*1024 } }); await app.register(routes,{ prefix: '/api/wardrobe',service }); await app.ready(); t.after(() => app.close());
  await t.test('migration can be rerun; private bucket, RLS and role grants are enforced', async () => {
    await pg.exec(migration);
    assert.equal((await pg.query("SELECT public FROM storage.buckets WHERE id='wardrobe-images'")).rows[0].public,false);
    assert.equal((await pg.query("SELECT count(*)::int AS count FROM pg_class WHERE relname IN ('wardrobe_items','wardrobe_outfits','wardrobe_outfit_items') AND relrowsecurity")).rows[0].count,3);
    await pg.exec('SET ROLE anon'); await assert.rejects(pg.query('SELECT * FROM wardrobe_items'),/permission denied/); await assert.rejects(pg.query("SELECT wardrobe_import('x','[]'::jsonb,'skip_existing')"),/permission denied/); await pg.exec('RESET ROLE');
  });
  await t.test('every route rejects anonymous requests before parsing body', async () => {
    for (const [method,url] of [['GET','items'],['POST','import'],['GET','export'],['GET','outfits'],['POST','items'],['GET','items/00000000-0000-4000-8000-000000000001/image']]) assert.equal((await app.inject({ method,url:`/api/wardrobe/${url}` })).statusCode,401);
  });
  await t.test('provided demo and 10-item fixture validate', async () => { assert.equal((await parseBundle(demo)).items.length,1); assert.equal((await parseBundle(fixture)).items.length,10); });
  await t.test('10 items import; retry skips; image bytes are private and persistence survives service recreation', async () => {
    const response = await app.inject({ method:'POST',url:'/api/wardrobe/import?user_id=attacker',...multipartBody(fixture) });
    assert.equal(response.statusCode,200,response.body); assert.equal(response.json().created,10);
    const again = await service.importBundle(fixture); assert.equal(again.created,0); assert.equal(again.skipped,10); assert.equal(state.objects.size,10);
    const reloaded = await createWardrobeService(client).listItems(); assert.equal(reloaded.total,10); assert.equal(reloaded.stats.categories,6);
    assert.ok(reloaded.items.every(item => !item.user_id && !item.image_object_key && !item.manual_fields));
    const first = reloaded.items[0]; const image = await app.inject({ method:'GET',url:first.image_url,headers:{cookie} }); assert.equal(image.statusCode,200); assert.equal(image.headers['cache-control'],'private, no-store'); assert.equal(image.headers['x-content-type-options'],'nosniff'); assert.equal(imageInfo(image.rawPayload,'x.png').sha256,first.image_sha256);
    assert.equal((await app.inject({ method:'GET',url:first.image_url })).statusCode,401);
  });
  await t.test('manual changes survive default and explicit imported-field updates', async () => {
    const item = (await service.listItems()).items.find(i => i.external_id === 'mock_001');
    await service.patchItem(item.id,{ name:'我的手工名称',notes:'手工备注',user_id:'attacker' });
    const changed = await mutateZip(({items}) => { items[0].name='AI 新名称'; items[0].notes='AI 备注'; items[0].primary_color='绿色'; });
    await service.importBundle(changed); let current = (await service.listItems()).items.find(i => i.id === item.id); assert.equal(current.name,'我的手工名称'); assert.equal(current.primary_color,'蓝色');
    const report = await service.importBundle(changed,'update_imported'); assert.equal(report.updated,10);
    current = (await service.listItems()).items.find(i => i.id === item.id); assert.equal(current.name,'我的手工名称'); assert.equal(current.notes,'手工备注'); assert.equal(current.primary_color,'绿色');
    assert.equal((await service.listItems({search:'我的手工'})).total,1); assert.equal((await service.listItems({search:'%,()'})).total,0);
    assert.equal((await service.listItems({category:'tops',season:'spring',occasion:'daily',status:'active'})).total,2);
  });
  await t.test('manual create, replace photo, archive, restore, outfit ordering, ownership and soft delete', async () => {
    const parsed = await parseBundle(fixture), first = parsed.items[0];
    const create = await app.inject({method:'POST',url:'/api/wardrobe/items',...multipartBody(first.bytes,'mock.png','image/png',{name:'手工新增',category:'tops',primary_color:'蓝',user_id:'attacker'})});
    assert.equal(create.statusCode,201,create.body); const manual=create.json();
    await service.replaceImage(manual.id,{bytes:parsed.items[1].bytes,filename:'photo.png',mimetype:'image/png'});
    const others = (await service.listItems()).items.filter(i => i.id !== manual.id);
    const result = await service.saveOutfit(null,{name:'学术会议',occasion:'academic_conference',notes:'测试',item_ids:[manual.id,others[0].id]});
    await service.patchItem(manual.id,{status:'archived'}); let outfit = (await service.listOutfits())[0]; assert.equal(outfit.items[0].item.status,'archived');
    await service.patchItem(manual.id,{status:'active'});
    await service.saveOutfit(result.id,{name:'会议修改',occasion:'academic_conference',notes:null,item_ids:[others[0].id,manual.id]}); outfit=(await createWardrobeService(client).listOutfits())[0]; assert.equal(outfit.items[0].item_id,others[0].id);
    await assert.rejects(service.saveOutfit(result.id,{name:'重复',occasion:'daily',item_ids:[manual.id,manual.id]}));
    assert.equal((await service.listOutfits())[0].name,'会议修改');
    const foreign=await pg.query("INSERT INTO wardrobe_items SELECT (jsonb_populate_record(NULL::wardrobe_items,(SELECT to_jsonb(w) FROM wardrobe_items w LIMIT 1)||jsonb_build_object('id',gen_random_uuid(),'user_id','other-owner'))).* RETURNING id");
    await assert.rejects(service.patchItem(foreign.rows[0].id,{name:'越权'}),/不存在/);
    await assert.rejects(service.getImage(foreign.rows[0].id),/不存在/);
    await assert.rejects(service.saveOutfit(null,{name:'越权',occasion:'daily',item_ids:[foreign.rows[0].id]}));
    await service.deleteItem(manual.id); outfit=(await service.listOutfits())[0]; assert.ok(outfit.items[1].item.deleted_at);
    await service.deleteOutfit(result.id); assert.equal((await service.listOutfits()).length,0);
  });
  await t.test('invalid bundles, hashes, media and limits never contaminate DB', async () => {
    const before=(await service.listItems()).total, images=state.objects.size;
    const bad = [Buffer.from('invalid'), await mutateZip(({manifest})=>{manifest.schema_version=2;}), await mutateZip(({items})=>{items[0].image_path='../bad.png';}), await mutateZip(({files,items})=>files.delete(items[0].image_path)), await mutateZip(({items})=>{items[1].external_id=items[0].external_id;}), await mutateZip(({items})=>{items[0].image_sha256='0'.repeat(64);}), await mutateZip(({files,items})=>{files.set(items[0].image_path,Buffer.from('<html>invalid</html>'));}), await mutateZip(({items})=>{items[0].category='invalid';}), await mutateZip(({items})=>{items[0].seasons=['invalid'];}), await mutateZip(({items})=>{while(items.length<=100) items.push({...items[0],external_id:`extra-${items.length}`});}), await mutateZip(({files})=>files.set('images/huge.png',Buffer.alloc(LIMITS.image+1)))];
    for(const bytes of bad) await assert.rejects(service.importBundle(bytes));
    await assert.rejects(service.importBundle(Buffer.alloc(LIMITS.zip+1)));
    assert.throws(()=>normalizeItem({...(({})),name:'n'}));
    assert.throws(()=>imageInfo((Buffer.from('<svg></svg>')),'x.svg'));
    const report=await app.inject({method:'POST',url:'/api/wardrobe/import',...multipartBody(bad[4])}); assert.equal(report.statusCode,400); assert.equal(report.json().created,0); assert.ok(report.json().errors.length);
    assert.equal((await service.listItems()).total,before); assert.equal(state.objects.size,images);
  });
  await t.test('staging upload or DB failure compensates images, SQL failures roll back the entire batch', async () => {
    const unique=await mutateZip(({items})=>{for(const item of items) item.external_id='new_'+item.external_id;});
    // Simulate no existing digest by using a separate, empty database.
    const fresh=await createWardrobeDatabase(); try {
      const target=createWardrobeService(fresh.client); fresh.state.failUploadAt=3;
      await assert.rejects(target.importBundle(unique)); assert.equal(fresh.state.objects.size,0); assert.equal((await target.listItems()).total,0);
      fresh.state.failUploadAt=0; fresh.state.failRpc=true;
      await assert.rejects(target.importBundle(unique)); assert.equal(fresh.state.objects.size,0); assert.equal((await target.listItems()).total,0);
      fresh.state.failRpc=false;
      const parsed=await parseBundle(unique); const valid={...parsed.items[0],image_object_key:'x.png'}; delete valid.bytes; delete valid.info;
      const response=await fresh.client.rpc('wardrobe_import',{p_owner:'user-1',p_items:[valid,{...valid,external_id:'invalid',category:'BAD'}],p_mode:'skip_existing'});
      assert.ok(response.error); assert.equal((await target.listItems()).total,0);
    } finally {await fresh.pg.close();}
  });
  await t.test('export imports into empty SQL database with identical metadata and binary photos', async () => {
    const exported=await app.inject({method:'GET',url:'/api/wardrobe/export',headers:{cookie}}); assert.equal(exported.statusCode,200); assert.match(exported.headers['content-type'],/application\/zip/);
    const parsed=await parseBundle(exported.rawPayload), fresh=await createWardrobeDatabase();
    try { const target=createWardrobeService(fresh.client); const report=await target.importBundle(exported.rawPayload); assert.equal(report.created,10); const restored=(await target.listItems()).items; for(const item of parsed.items) { const row=restored.find(i=>i.external_id===item.external_id); for(const key of ['name','notes','primary_color','status','needs_review']) assert.equal(row[key],item[key]); assert.deepEqual((await target.getImage(row.id)).bytes,item.bytes); } } finally {await fresh.pg.close();}
  });
});
