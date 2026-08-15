const test = require('node:test');
const assert = require('node:assert/strict');
const Fastify = require('fastify');

const routes = require('../routes/api');
const dbService = require('../services/dbService');

const buildApp = async () => {
  const app = Fastify({ logger: false });
  await app.register(routes);
  await app.ready();
  return app;
};

test('POST /sop/create returns revision metadata and an ETag', async (t) => {
  const originalSaveSOP = dbService.saveSOP;
  t.after(() => { dbService.saveSOP = originalSaveSOP; });

  let receivedOptions = null;
  dbService.saveSOP = async (_data, options) => {
    receivedOptions = options;
    return {
      id: '11111111-1111-4111-8111-111111111111',
      content_schema_version: 2,
      content_revision: 8,
      revision_supported: true,
    };
  };

  const app = await buildApp();
  t.after(() => app.close());
  const response = await app.inject({
    method: 'POST',
    url: '/sop/create',
    payload: { title: 'Document', content: 'body' },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(receivedOptions, { returnResult: true });
  assert.equal(response.headers.etag, '"8"');
  assert.deepEqual(response.json(), {
    id: '11111111-1111-4111-8111-111111111111',
    content_schema_version: 2,
    content_revision: 8,
    revision_supported: true,
    message: 'SOP Created Successfully',
  });
});

test('POST /sop/create maps a stale If-Match revision to a structured 409', async (t) => {
  const originalSaveSOP = dbService.saveSOP;
  t.after(() => { dbService.saveSOP = originalSaveSOP; });

  let receivedData = null;
  dbService.saveSOP = async (data) => {
    receivedData = data;
    throw new dbService.SopRevisionConflictError({
      id: data.id,
      expectedRevision: data.expected_revision,
      currentRevision: 9,
      contentSchemaVersion: 2,
    });
  };

  const app = await buildApp();
  t.after(() => app.close());
  const response = await app.inject({
    method: 'POST',
    url: '/sop/create',
    headers: { 'if-match': 'W/"7"' },
    payload: {
      id: '11111111-1111-4111-8111-111111111111',
      title: 'Document',
      content: 'stale body',
    },
  });

  assert.equal(receivedData.expected_revision, 7);
  assert.equal(response.statusCode, 409);
  assert.deepEqual(response.json(), {
    error: 'Document changed in another editor. Reload before saving again.',
    code: 'SOP_REVISION_CONFLICT',
    id: '11111111-1111-4111-8111-111111111111',
    expected_revision: 7,
    current_revision: 9,
    content_schema_version: 2,
  });
});

test('POST /sop/create reports an invalid expected revision as 400', async (t) => {
  const originalSaveSOP = dbService.saveSOP;
  t.after(() => { dbService.saveSOP = originalSaveSOP; });

  dbService.saveSOP = async (data) => {
    dbService.__test.normalizeExpectedRevision(data);
    throw new Error('unreachable');
  };

  const app = await buildApp();
  t.after(() => app.close());
  const response = await app.inject({
    method: 'POST',
    url: '/sop/create',
    headers: { 'if-match': 'not-a-revision' },
    payload: {
      id: '11111111-1111-4111-8111-111111111111',
      title: 'Document',
      content: 'body',
    },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().code, 'INVALID_EXPECTED_REVISION');
});

test('POST /sop/:id/repair-content forwards the guarded repair and returns its backup receipt', async (t) => {
  const originalRepair = dbService.repairSOPContent;
  t.after(() => { dbService.repairSOPContent = originalRepair; });

  let received = null;
  dbService.repairSOPContent = async (payload) => {
    received = payload;
    return {
      id: payload.id,
      content_schema_version: 2,
      content_revision: 6,
      revision_supported: true,
      recovery_backup: { version: 'recovery-backup-r5-test', content_revision: 5 },
    };
  };

  const app = await buildApp();
  t.after(() => app.close());
  const response = await app.inject({
    method: 'POST',
    url: '/sop/11111111-1111-4111-8111-111111111111/repair-content',
    headers: { 'if-match': '"5"' },
    payload: {
      userId: 'user-1',
      content: '# Recovered',
      content_json: { type: 'doc', content: [] },
      content_schema_version: 2,
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers.etag, '"6"');
  assert.equal(received.expected_revision, 5);
  assert.equal(received.userId, 'user-1');
  assert.deepEqual(response.json().recovery_backup, {
    version: 'recovery-backup-r5-test',
    content_revision: 5,
  });
});

test('POST /sop/:id/repair-content maps a concurrent edit to 409', async (t) => {
  const originalRepair = dbService.repairSOPContent;
  t.after(() => { dbService.repairSOPContent = originalRepair; });

  dbService.repairSOPContent = async (payload) => {
    throw new dbService.SopRevisionConflictError({
      id: payload.id,
      expectedRevision: 3,
      currentRevision: 4,
      contentSchemaVersion: 2,
    });
  };

  const app = await buildApp();
  t.after(() => app.close());
  const response = await app.inject({
    method: 'POST',
    url: '/sop/11111111-1111-4111-8111-111111111111/repair-content',
    payload: {
      content: 'recovered',
      content_json: { type: 'doc', content: [] },
      expected_revision: 3,
    },
  });

  assert.equal(response.statusCode, 409);
  assert.equal(response.json().code, 'SOP_REVISION_CONFLICT');
  assert.equal(response.json().current_revision, 4);
});
