const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const Fastify = require('fastify');
const multipart = require('@fastify/multipart');

const routes = require('../routes/api');
const whiteboardService = require('../services/whiteboardService');

const buildApp = async () => {
  const app = Fastify({ logger: false });
  await app.register(multipart, { limits: { fileSize: 15 * 1024 * 1024 } });
  await app.register(routes);
  await app.ready();
  return app;
};

const multipartPayload = ({ contents, mimeType = 'image/png', fileName = 'asset.png' }) => {
  const boundary = `whiteboard-${crypto.randomBytes(8).toString('hex')}`;
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\n`
      + `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n`
      + `Content-Type: ${mimeType}\r\n\r\n`,
    ),
    contents,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return {
    payload,
    headers: {
      'content-type': `multipart/form-data; boundary=${boundary}`,
      'content-length': String(payload.length),
    },
  };
};

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

test('whiteboard storage initialization enforces private raster-only bucket settings', async (t) => {
  const updates = [];
  const fake = {
    storage: {
      listBuckets: async () => ({
        data: [{ id: 'whiteboard-assets', name: 'whiteboard-assets', public: false }],
        error: null,
      }),
      updateBucket: async (id, options) => {
        updates.push({ id, options });
        return { error: null };
      },
    },
  };
  whiteboardService.__setSupabaseClientForTests(fake, { ready: false });
  t.after(() => whiteboardService.__setSupabaseClientForTests(null, { ready: false }));

  assert.equal(await whiteboardService.initStorage(), true);
  assert.deepEqual(updates, [{
    id: 'whiteboard-assets',
    options: {
      public: false,
      fileSizeLimit: 15 * 1024 * 1024,
      allowedMimeTypes: ['image/gif', 'image/jpeg', 'image/png', 'image/webp'],
    },
  }]);
});

test('whiteboard CRUD routes preserve user scope and revision contract', async (t) => {
  const originals = {
    listWhiteboards: whiteboardService.listWhiteboards,
    createWhiteboard: whiteboardService.createWhiteboard,
    getWhiteboard: whiteboardService.getWhiteboard,
    updateWhiteboard: whiteboardService.updateWhiteboard,
    duplicateWhiteboard: whiteboardService.duplicateWhiteboard,
    deleteWhiteboard: whiteboardService.deleteWhiteboard,
  };
  const calls = [];
  whiteboardService.listWhiteboards = async (userId) => {
    calls.push(['list', userId]);
    return [{ id: 'board-1', title: '架构图', content_revision: 3 }];
  };
  whiteboardService.createWhiteboard = async (input) => {
    calls.push(['create', input]);
    return { id: 'board-2', title: input.title, content_revision: 1 };
  };
  whiteboardService.getWhiteboard = async (id, userId) => {
    calls.push(['get', id, userId]);
    return { id, user_id: userId, title: '架构图', assets: [] };
  };
  whiteboardService.updateWhiteboard = async (input) => {
    calls.push(['update', input]);
    return { id: input.id, title: input.title, content_revision: 4 };
  };
  whiteboardService.duplicateWhiteboard = async (input) => {
    calls.push(['duplicate', input]);
    return { id: 'board-copy', title: input.title, content_revision: 1 };
  };
  whiteboardService.deleteWhiteboard = async (input) => {
    calls.push(['delete', input]);
    return { id: input.id, deleted_at: '2026-08-16T00:00:00.000Z' };
  };
  t.after(() => Object.assign(whiteboardService, originals));

  const app = await buildApp();
  t.after(() => app.close());

  const list = await app.inject({ method: 'GET', url: '/whiteboards?userId=user-a' });
  assert.equal(list.statusCode, 200);
  assert.equal(list.json()[0].id, 'board-1');

  const create = await app.inject({
    method: 'POST',
    url: '/whiteboards',
    payload: { userId: 'user-a', title: '新白板', scene: { elements: [], appState: {} } },
  });
  assert.equal(create.statusCode, 201, create.body);

  const get = await app.inject({ method: 'GET', url: '/whiteboards/board-1?userId=user-a' });
  assert.equal(get.statusCode, 200);
  assert.equal(get.json().user_id, 'user-a');

  const update = await app.inject({
    method: 'PATCH',
    url: '/whiteboards/board-1',
    payload: { userId: 'user-a', title: '新版架构图', expected_revision: 3 },
  });
  assert.equal(update.statusCode, 200, update.body);
  assert.equal(update.headers.etag, '"4"');

  const duplicate = await app.inject({
    method: 'POST',
    url: '/whiteboards/board-1/duplicate',
    payload: { userId: 'user-a', title: '架构图副本' },
  });
  assert.equal(duplicate.statusCode, 201, duplicate.body);

  const remove = await app.inject({ method: 'DELETE', url: '/whiteboards/board-1?userId=user-a' });
  assert.equal(remove.statusCode, 200, remove.body);
  assert.deepEqual(calls[0], ['list', 'user-a']);
  assert.equal(calls.find(([kind]) => kind === 'update')[1].expectedRevision, 3);
});

test('whiteboard revision conflicts return a stable 409 payload', async (t) => {
  const original = whiteboardService.updateWhiteboard;
  whiteboardService.updateWhiteboard = async () => {
    throw new whiteboardService.WhiteboardRevisionConflictError({
      id: 'board-1',
      expectedRevision: 2,
      currentRevision: 3,
    });
  };
  t.after(() => { whiteboardService.updateWhiteboard = original; });

  const app = await buildApp();
  t.after(() => app.close());
  const response = await app.inject({
    method: 'PATCH',
    url: '/whiteboards/board-1',
    payload: { expected_revision: 2, scene: { elements: [], appState: {} } },
  });
  assert.equal(response.statusCode, 409, response.body);
  assert.deepEqual(response.json(), {
    error: '白板已在另一个窗口中更新，请重新加载后再保存',
    code: 'WHITEBOARD_REVISION_CONFLICT',
    id: 'board-1',
    expected_revision: 2,
    current_revision: 3,
  });
});

test('whiteboard image and preview routes validate bytes before service calls', async (t) => {
  const originals = {
    putAsset: whiteboardService.putAsset,
    putPreview: whiteboardService.putPreview,
  };
  const calls = [];
  whiteboardService.putAsset = async (input) => {
    calls.push(['asset', input]);
    return {
      file_id: input.fileId,
      mime_type: input.mimeType,
      byte_size: input.buffer.length,
      sha256: input.sha256,
      file_metadata: input.metadata,
    };
  };
  whiteboardService.putPreview = async (input) => {
    calls.push(['preview', input]);
    return { id: input.id, preview_revision: Number(input.revision) };
  };
  t.after(() => Object.assign(whiteboardService, originals));

  const app = await buildApp();
  t.after(() => app.close());

  const asset = await app.inject({
    method: 'POST',
    url: '/whiteboards/board-1/assets?fileId=file_123&userId=user-a',
    ...multipartPayload({ contents: png }),
  });
  assert.equal(asset.statusCode, 201, asset.body);
  assert.equal(asset.json().file_id, 'file_123');
  assert.match(asset.json().sha256, /^[a-f0-9]{64}$/);

  const preview = await app.inject({
    method: 'PUT',
    url: '/whiteboards/board-1/preview?revision=7&userId=user-a',
    ...multipartPayload({ contents: png, fileName: 'preview.png' }),
  });
  assert.equal(preview.statusCode, 200, preview.body);
  assert.equal(preview.json().preview_revision, 7);

  const spoofed = await app.inject({
    method: 'POST',
    url: '/whiteboards/board-1/assets?fileId=file_456',
    ...multipartPayload({ contents: Buffer.from('<svg/>'), mimeType: 'image/png' }),
  });
  assert.equal(spoofed.statusCode, 415, spoofed.body);
  assert.equal(calls.filter(([kind]) => kind === 'asset').length, 1);
});

test('reference extractor finds nested Tiptap whiteboard nodes with stable block ids', () => {
  const refs = whiteboardService.extractWhiteboardReferences({
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'before' }] },
      {
        type: 'blockquote',
        content: [{
          type: 'whiteboardEmbed',
          attrs: { whiteboardId: 'board-a', blockId: 'block-a' },
        }],
      },
      { type: 'whiteboardEmbed', attrs: { whiteboardId: 'board-b' } },
    ],
  });
  assert.deepEqual(refs, [
    { whiteboardId: 'board-a', blockId: 'block-a' },
    { whiteboardId: 'board-b', blockId: 'path:0.2' },
  ]);
});

test('safe deletion fallback scans structured and legacy document references', async (t) => {
  const documents = [
    {
      id: 'doc-structured',
      title: 'Structured',
      content: '',
      content_json: {
        type: 'doc',
        content: [{ type: 'whiteboardEmbed', attrs: { whiteboardId: 'board-a', blockId: 'block-a' } }],
      },
    },
    {
      id: 'doc-legacy',
      title: 'Legacy',
      content: '<figure data-type="whiteboard-embed" data-whiteboard-id="board-a"></figure>',
      content_json: null,
    },
    {
      id: 'doc-other',
      title: 'Other',
      content: '',
      content_json: { type: 'doc', content: [] },
    },
  ];
  const fake = {
    from(table) {
      assert.equal(table, 'sops');
      return {
        select() { return this; },
        async eq(field, value) {
          assert.equal(field, 'user_id');
          assert.equal(value, 'user-a');
          return { data: documents, error: null };
        },
      };
    },
  };
  whiteboardService.__setSupabaseClientForTests(fake);
  t.after(() => whiteboardService.__setSupabaseClientForTests(null, { ready: false }));

  const references = await whiteboardService.scanDocumentReferences('board-a', 'user-a');
  assert.deepEqual(references.map((reference) => [reference.sop_id, reference.block_id]), [
    ['doc-structured', 'block-a'],
    ['doc-legacy', 'legacy-markdown'],
  ]);
});
