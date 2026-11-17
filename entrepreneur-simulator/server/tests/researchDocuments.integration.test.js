const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createWardrobeDatabase } = require('./helpers/wardrobeDatabase');
const { createResearchDocumentService } = require('../services/researchDocumentService');
const { createOAuthService, configuration } = require('../services/mcpOAuth');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { createSessionToken } = require('../services/authService');
const dbService = require('../services/dbService');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const migrations = path.resolve(__dirname, '../../../supabase/migrations');
const doc = text => ({ type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: 'kept-block' }, content: [{ type: 'text', text }] }] });

test('research documents: real migration + website permissions + HTTP MCP + revisioned backups', async t => {
  const database = await createWardrobeDatabase();
  const { pg } = database;
  t.after(async () => { dbService.__setSupabaseClientForTests(null); await pg.close(); });
  // PGlite provides gen_random_uuid natively; uuid-ossp is not installed here.
  await pg.exec(fs.readFileSync(path.join(migrations, '20260224_init_schema.sql'), 'utf8')
    .replace('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";', '').replaceAll('uuid_generate_v4()', 'gen_random_uuid()'));
  for (const name of ['20260701_add_research_workspace_fields.sql', '20260712_add_document_editor_reliability.sql', '20260809_add_document_page_hierarchy.sql']) {
    await pg.exec(fs.readFileSync(path.join(migrations, name), 'utf8'));
  }
  const oldId = (await pg.query("INSERT INTO sops(user_id,title,domain,research_type) VALUES ('user-1','Private legacy','research','document') RETURNING id")).rows[0].id;
  const migration = fs.readFileSync(path.join(migrations, '20261117052522_research_document_chatgpt_access.sql'), 'utf8');
  await pg.exec(migration);
  await pg.exec(migration); // Safe to reapply after a partially prepared deployment.
  assert.equal((await pg.query('SELECT chatgpt_access FROM sops WHERE id=$1', [oldId])).rows[0].chatgpt_access, false);

  // Substitute PostgREST transport only. SQL, filters, triggers, RPC and backups execute in PostgreSQL.
  class Query {
    constructor(table) { this.table = table; this.filters = []; this.values = []; this.fields = '*'; this.orders = []; }
    select(fields = '*') { this.fields = fields; return this; }
    eq(field, value) { this.values.push(value); this.filters.push(`"${field}"=$${this.values.length}`); return this; }
    order(field, options = {}) { this.orders.push(`"${field}" ${options.ascending === false ? 'DESC' : 'ASC'}`); return this; }
    range(start, end) { this.offset = start; this.limit = end - start + 1; return this; }
    insert(payload) { this.operation = 'insert'; this.payload = Array.isArray(payload) ? payload[0] : payload; return this; }
    update(payload) { this.operation = 'update'; this.payload = payload; return this; }
    maybeSingle() { this.one = true; return this; }
    single() { this.one = true; return this; }
    async run() {
      try {
        const where = this.filters.length ? ` WHERE ${this.filters.join(' AND ')}` : '';
        const values = [...this.values];
        const fields = this.fields === '*' ? '*' : this.fields.split(',').map(field => `"${field.trim()}"`).join(',');
        let sql;
        if (this.operation === 'update') {
          const sets = Object.entries(this.payload).filter(([, value]) => value !== undefined).map(([field, value]) => {
            values.push(typeof value === 'object' && value !== null && !(value instanceof Date) ? JSON.stringify(value) : value);
            return `"${field}"=$${values.length}`;
          });
          sql = `UPDATE ${this.table} SET ${sets.join(',')}${where} RETURNING ${fields}`;
        } else if (this.operation === 'insert') {
          const entries = Object.entries(this.payload).filter(([, value]) => value !== undefined);
          for (const [field, value] of entries) values.push(['content_json'].includes(field) ? JSON.stringify(value) : value);
          sql = `INSERT INTO ${this.table}(${entries.map(([field]) => `"${field}"`).join(',')}) VALUES(${entries.map((_, i) => `$${i + 1}`).join(',')}) RETURNING ${fields}`;
        } else {
          sql = `SELECT ${fields} FROM ${this.table}${where}${this.orders.length ? ` ORDER BY ${this.orders.join(',')}` : ''}${this.limit ? ` LIMIT ${this.limit} OFFSET ${this.offset}` : ''}`;
        }
        const { rows } = await pg.query(sql, values);
        return { data: this.one ? rows[0] || null : rows, error: null };
      } catch (error) { return { data: null, error }; }
    }
    then(resolve, reject) { return this.run().then(resolve, reject); }
  }
  const client = {
    from: table => ['sops', 'sop_versions'].includes(table) ? new Query(table) : database.client.from(table),
    async rpc(name, args) {
      if (name !== 'nmdd_research_document_update') return database.client.rpc(name, args);
      try {
        const result = await pg.query('SELECT nmdd_research_document_update($1,$2,$3,$4::jsonb) AS result',
          [args.p_owner, args.p_id, args.p_expected_revision, JSON.stringify(args.p_patch)]);
        return { data: result.rows[0].result, error: null };
      } catch (error) { return { data: null, error }; }
    },
  };
  const service = createResearchDocumentService(client, { owner: 'user-1', siteUrl: 'https://nmdd.example' });
  dbService.__setSupabaseClientForTests(client);
  const create = async (title, access, owner = 'user-1', domain = 'research') => (await pg.query(
    'INSERT INTO sops(user_id,title,domain,research_type,chatgpt_access,content,content_json) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
    [owner, title, domain, domain === 'research' ? 'document' : null, access, 'Original body', JSON.stringify(doc('Original body'))],
  )).rows[0].id;
  const publicId = await create('Shared', true);
  const otherId = await create('Other owner secret', true, 'someone-else');
  const lifeId = await create('Life secret', true, 'user-1', 'life');
  const childId = await create('Unshared child', false);
  await pg.query('UPDATE sops SET parent_id=$1 WHERE id=$2', [publicId, childId]);

  await t.test('only opted-in research records appear, without unrelated account or hierarchy metadata', async () => {
    const list = await service.list();
    assert.deepEqual(list.items.map(row => row.id), [publicId]);
    assert.equal(list.items[0].content, undefined);
    assert.equal(list.items[0].user_id, undefined);
    assert.equal((await service.get(publicId)).parent_id, undefined);
    for (const id of [oldId, otherId, lifeId, childId, crypto.randomUUID()]) {
      await assert.rejects(service.get(id), error => error.statusCode === 404);
      await assert.rejects(service.update({ id, expected_revision: 1, patch: { title: 'Blocked' } }), error => error.statusCode === 404);
    }
    await assert.rejects(service.update({ id: publicId, expected_revision: 1, patch: { chatgpt_access: true } }), /只能修改/);
    await assert.rejects(service.update({ id: publicId, expected_revision: 1, patch: { content: 'Markdown only' } }), /content_json/);
    assert.equal((await pg.query('SELECT count(*)::integer AS n FROM sop_versions')).rows[0].n, 0);
  });

  await t.test('website creation persists explicit opt-in and defaults to private without inheriting a parent', async () => {
    const shared = await dbService.saveSOP({ user_id: 'user-1', title: 'Created shared', domain: 'research', research_type: 'document', content: '', chatgpt_access: true });
    assert.equal((await service.get(shared)).title, 'Created shared');
    const child = await dbService.saveSOP({ user_id: 'user-1', title: 'Created private child', domain: 'research', research_type: 'document', content: '', parent_id: shared });
    await assert.rejects(service.get(child), error => error.statusCode === 404);
    await service.setAccess(shared, false);
    await assert.rejects(createResearchDocumentService(client).list(), error => error.statusCode === 503);
  });

  await t.test('legacy packed editor JSON is readable without rewriting the original, and title edits preserve its backup', async () => {
    const id = await create('Legacy shared document', true);
    const json = doc('Legacy body');
    const packed = `<!-- smart-document-json:${Buffer.from(JSON.stringify(json)).toString('base64')}-->\nLegacy body`;
    await pg.query('UPDATE sops SET content=$1, content_json=NULL WHERE id=$2', [packed, id]);
    const read = await service.get(id);
    assert.equal(read.content, 'Legacy body');
    assert.deepEqual(read.content_json, json);
    await service.update({ id, expected_revision: read.content_revision, patch: { title: 'Legacy renamed' } });
    assert.equal((await pg.query('SELECT content FROM sops WHERE id=$1', [id])).rows[0].content, packed);
    assert.equal((await pg.query('SELECT content FROM sop_versions WHERE sop_id=$1', [id])).rows[0].content, packed);
    await service.setAccess(id, false);
  });

  const app = require('fastify')();
  t.after(() => app.close());
  const config = configuration({ NMDD_MCP_PUBLIC_URL: 'http://127.0.0.1:3000', NMDD_SITE_URL: 'http://127.0.0.1:3000', NMDD_MCP_SECRET: 'isolated-research-tests-secret-at-least-32' });
  const oauth = createOAuthService(database.client, config);
  await app.register(require('../routes/researchDocuments'), { prefix: '/api/research/documents', service });
  await app.register(require('../routes/mcp'), {
    oauth, researchDocuments: service, wardrobe: {}, inspirations: { audit: async () => {} },
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const cookie = `nmdd_session=${createSessionToken()}`;
  let clientNumber = 0;
  async function connect(scopes) {
    const clientId = `research-test-${clientNumber++}`;
    await pg.query('INSERT INTO nmdd_oauth_clients(client_id,client_name,redirect_uris) VALUES ($1,$1,$2)', [clientId, [`${base}/callback`]]);
    const grant = (await pg.query("INSERT INTO nmdd_oauth_grants(owner_id,client_id,scopes,issuer,resource,redirect_uri,code_hash,code_challenge,code_expires_at) VALUES ('user-1',$1,$2,$3,$4,$5,$6,'challenge',now()+interval '1 minute') RETURNING id",
      [clientId, scopes, config.issuer, config.resource, `${base}/callback`, hash(clientId)])).rows[0].id;
    const token = crypto.randomBytes(32).toString('base64url');
    await pg.query("INSERT INTO nmdd_oauth_tokens(token_hash,grant_id,kind,expires_at) VALUES ($1,$2,'access',now()+interval '5 minutes')", [hash(token), grant]);
    const mcp = new Client({ name: clientId, version: '1.0.0' });
    await mcp.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
    t.after(() => mcp.close());
    return { mcp, token, grant };
  }
  const { mcp, token, grant } = await connect(['research:read', 'research:write']);
  const call = (name, args = {}) => mcp.callTool({ name, arguments: args });
  await t.test('HTTP MCP discovers scoped tools and atomically saves content with original backup', async () => {
    assert.deepEqual((await mcp.listTools()).tools.map(tool => tool.name).sort(), ['research_document_get', 'research_document_list', 'research_document_update']);
    const listed = await call('research_document_list');
    assert.deepEqual(listed.structuredContent.items.map(row => row.id), [publicId]);
    const result = await call('research_document_update', { id: publicId, expected_revision: 1, patch: { content: 'Edited', content_json: doc('Edited') } });
    assert.equal(result.isError, undefined, JSON.stringify(result));
    assert.equal(result.structuredContent.content_revision, 2);
    assert.equal((await service.get(publicId)).content, 'Edited');
    const backup = (await pg.query('SELECT * FROM sop_versions WHERE sop_id=$1', [publicId])).rows;
    assert.equal(backup.length, 1);
    assert.equal(backup[0].content, 'Original body');
    assert.deepEqual(backup[0].content_json, doc('Original body'));
    assert.equal(backup[0].content_revision, 1);
    const stale = await call('research_document_update', { id: publicId, expected_revision: 1, patch: { title: 'Stale write' } });
    assert.equal(JSON.parse(stale.content[0].text).code, 'NMDD_409');
    assert.equal((await service.get(publicId)).title, 'Shared');
  });
  await t.test('missing scopes and forged permission edits cannot grant access', async () => {
    const readOnly = (await connect(['research:read'])).mcp;
    assert.equal((await readOnly.listTools()).tools.length, 2);
    const denied = await readOnly.callTool({ name: 'research_document_update', arguments: { id: publicId, expected_revision: 2, patch: { title: 'Forbidden' } } });
    assert.equal(JSON.parse(denied.content[0].text).code, 'NMDD_403');
    const wardrobeOnly = (await connect(['wardrobe:read'])).mcp;
    assert.equal((await wardrobeOnly.listTools()).tools.some(tool => tool.name.startsWith('research_')), false);
    const forged = await call('research_document_update', { id: publicId, expected_revision: 2, patch: { chatgpt_access: true } });
    assert.equal(JSON.parse(forged.content[0].text).code, 'NMDD_400');
    const bearer = await app.inject({ method: 'PATCH', url: `/api/research/documents/${publicId}/chatgpt-access`, headers: { authorization: `Bearer ${token}` }, payload: { enabled: true } });
    assert.equal(bearer.statusCode, 401);
  });
  await t.test('revocation takes effect with the same token and preserves content revision and dirty saves', async () => {
    const url = `/api/research/documents/${publicId}/chatgpt-access`;
    assert.equal((await app.inject({ method: 'PATCH', url, headers: { cookie }, payload: { enabled: 'true' } })).statusCode, 400);
    const off = await app.inject({ method: 'PATCH', url, headers: { cookie }, payload: { enabled: false } });
    assert.equal(off.statusCode, 200, off.body);
    assert.equal((await pg.query('SELECT content_revision FROM sops WHERE id=$1', [publicId])).rows[0].content_revision, 2);
    assert.equal((await call('research_document_get', { id: publicId })).isError, true);
    assert.deepEqual((await call('research_document_list')).structuredContent.items, []);
    const denied = await call('research_document_update', { id: publicId, expected_revision: 2, patch: { title: 'After revocation' } });
    assert.equal(JSON.parse(denied.content[0].text).code, 'NMDD_404');
    await dbService.saveSOP({ id: publicId, title: 'Website draft', domain: 'research', research_type: 'document', content: 'Local draft', content_json: doc('Local draft'), chatgpt_access: true, expected_revision: 2 });
    const saved = (await pg.query('SELECT chatgpt_access,content_revision FROM sops WHERE id=$1', [publicId])).rows[0];
    assert.equal(saved.chatgpt_access, false);
    assert.equal(saved.content_revision, 3);
    const on = await app.inject({ method: 'PATCH', url, headers: { cookie }, payload: { enabled: true } });
    assert.equal(on.statusCode, 200);
    assert.equal((await service.get(publicId)).content_revision, 3);
  });
  await t.test('backup failure rolls the edit back, and stale concurrent edits produce one winner', async () => {
    await pg.exec("CREATE FUNCTION fail_research_backup() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'backup unavailable'; END $$; CREATE TRIGGER fail_research_backup BEFORE INSERT ON sop_versions FOR EACH ROW EXECUTE FUNCTION fail_research_backup();");
    await assert.rejects(service.update({ id: publicId, expected_revision: 3, patch: { title: 'Must roll back' } }), error => error.statusCode === 503);
    assert.equal((await service.get(publicId)).title, 'Website draft');
    assert.equal((await service.get(publicId)).content_revision, 3);
    await pg.exec('DROP TRIGGER fail_research_backup ON sop_versions;');
    const results = await Promise.allSettled(['Winner A', 'Winner B'].map(title => service.update({ id: publicId, expected_revision: 3, patch: { title } })));
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.find(result => result.status === 'rejected').reason.statusCode, 409);
  });
  await t.test('RPC is not callable by public roles and revoking the OAuth grant invalidates the token', async () => {
    const privileges = (await pg.query("SELECT has_function_privilege('anon','nmdd_research_document_update(text,uuid,bigint,jsonb)','EXECUTE') AS anon, has_function_privilege('authenticated','nmdd_research_document_update(text,uuid,bigint,jsonb)','EXECUTE') AS authenticated")).rows[0];
    assert.deepEqual(privileges, { anon: false, authenticated: false });
    assert.deepEqual((await pg.query("SELECT has_table_privilege('anon','sops','SELECT') AS read, has_table_privilege('authenticated','sops','UPDATE') AS write, has_table_privilege('anon','sop_versions','SELECT') AS history")).rows[0], { read: false, write: false, history: false });
    await pg.query('UPDATE nmdd_oauth_grants SET revoked_at=now() WHERE id=$1', [grant]);
    await assert.rejects(call('research_document_list'), /invalid_token/);
  });
});
