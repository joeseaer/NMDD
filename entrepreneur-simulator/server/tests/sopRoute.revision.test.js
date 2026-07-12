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
