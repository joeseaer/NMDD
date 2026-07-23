const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const Fastify = require('fastify');
const multipart = require('@fastify/multipart');

const routes = require('../routes/api');
const dbService = require('../services/dbService');

const buildApp = async (limits = { fileSize: 15 * 1024 * 1024 }) => {
  const app = Fastify({ logger: false });
  await app.register(multipart, { limits });
  await app.register(routes);
  await app.ready();
  return app;
};

const multipartPayload = ({
  contents,
  fileName = 'upload.bin',
  mimeType = 'application/octet-stream',
}) => {
  const boundary = `test-${crypto.randomBytes(12).toString('hex')}`;
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\n`
      + `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n`
      + `Content-Type: ${mimeType}\r\n\r\n`,
      'utf8',
    ),
    contents,
    Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'),
  ]);
  return {
    payload: body,
    headers: {
      'content-type': `multipart/form-data; boundary=${boundary}`,
      'content-length': String(body.length),
    },
  };
};

const multipartWithoutFile = () => {
  const boundary = `test-${crypto.randomBytes(12).toString('hex')}`;
  const body = Buffer.from(
    `--${boundary}\r\n`
    + 'Content-Disposition: form-data; name="note"\r\n\r\n'
    + `metadata only\r\n--${boundary}--\r\n`,
    'utf8',
  );
  return {
    payload: body,
    headers: {
      'content-type': `multipart/form-data; boundary=${boundary}`,
      'content-length': String(body.length),
    },
  };
};

const rasterFixtures = [
  {
    mimeType: 'image/png',
    fileName: '..\\..\\private?diagram.png',
    contents: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ),
  },
  {
    mimeType: 'image/jpeg',
    fileName: 'photo.jpeg',
    contents: Buffer.from(
      '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQgJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==',
      'base64',
    ),
  },
  {
    mimeType: 'image/gif',
    fileName: 'animation.gif',
    contents: Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64'),
  },
  {
    mimeType: 'image/webp',
    fileName: 'picture.webp',
    contents: Buffer.from('UklGRhwAAABXRUJQVlA4TA8AAAAvAAAAAAcQ/Y/+ByKi/wEA', 'base64'),
  },
  {
    mimeType: 'image/webp',
    fileName: 'lossy.webp',
    contents: Buffer.from(
      'UklGRjAAAABXRUJQVlA4ICQAAABQAQCdASoDAAIAAUAmJQBOgCgAAP76id+R2EN2HLri5shvAAA=',
      'base64',
    ),
  },
  {
    mimeType: 'image/webp',
    fileName: 'alpha.webp',
    contents: Buffer.from(
      'UklGRlIAAABXRUJQVlA4WAoAAAAQAAAAAgAAAQAAQUxQSAcAAAAAZGRkZGRkAFZQOCAkAAAAUAEAnQEqAwACAAFAJiUAToAoAAD++onfkdhDdhy64ubIbwAA',
      'base64',
    ),
  },
  {
    mimeType: 'image/webp',
    fileName: 'animated.webp',
    contents: Buffer.from(
      'UklGRtoAAABXRUJQVlA4WAoAAAASAAAAAgAAAQAAQU5JTQYAAAAAAAAAAABBTk1GSgAAAAAAAAAAAAIAAAEAAGQAAAJWUDggMgAAADABAJ0BKgMAAgABQCYloAADcAD+8ut///mwP/bz/wR6Af//0uD//pcH//S4P/SkAAAAQU5NRlwAAAAAAAAAAAACAAABAABkAAACQUxQSAcAAAAAgICAgICAAFZQOCA0AAAAMAEAnQEqAwACAAFAJiWgAANwAP7pIh//958//7nz//ufP+jP//8p+//yOP//I4/+UCAAAA==',
      'base64',
    ),
  },
  {
    mimeType: 'image/png',
    fileName: 'animated.png',
    contents: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAYAAACddGYaAAAACGFjVEwAAAACAAAAAPONk3AAAAAaZmNUTAAAAAAAAAADAAAAAgAAAAAAAAAAAGQD6AAA1rcPRQAAABNJREFUeJxj/M/A8J8BCpgYkAAALx8CAqGwS3sAAAAaZmNUTAAAAAEAAAADAAAAAgAAAAAAAAAAAGQD6AAATcTlkQAAABdmZEFUAAAAAnicY2T4z9DAAAVMDEgAACM2AYP2PYitAAAAAElFTkSuQmCC',
      'base64',
    ),
  },
  {
    mimeType: 'image/jpeg',
    fileName: 'progressive.jpeg',
    contents: Buffer.from(
      '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQYHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wgARCAACAAMDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUAQEAAAAAAAAAAAAAAAAAAAAE/9oADAMBAAIQAxAAAAGehRv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAn//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/AX//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/AX//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/An//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IX//2gAMAwEAAgADAAAAEPf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EH//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EH//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EH//2Q==',
      'base64',
    ),
  },
  {
    mimeType: 'image/gif',
    fileName: 'animated.gif',
    contents: Buffer.from(
      'R0lGODlhAwACAIEAAP8AAAAAAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQACgAAACwAAAAAAwACAAAIBgABCBwYEAAh+QQBCgABACwAAAAAAwACAIEA/wAAAAAAAAAAAAAIBgABCBwYEAA7',
      'base64',
    ),
  },
];

const extensionByMimeType = {
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const pngCrc32 = (buffer) => {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
};

test('image upload returns an idempotent content-addressed object key and authoritative metadata', async (t) => {
  const originalPutMindMapImage = dbService.putMindMapImage;
  const storageCalls = [];
  dbService.putMindMapImage = async (buffer, objectKey, mimeType) => {
    storageCalls.push({ buffer, objectKey, mimeType });
    return `https://assets.example.test/${objectKey}`;
  };
  t.after(() => { dbService.putMindMapImage = originalPutMindMapImage; });

  const app = await buildApp();
  t.after(() => app.close());

  for (const fixture of rasterFixtures) {
    const response = await app.inject({
      method: 'POST',
      url: '/upload?kind=image',
      ...multipartPayload(fixture),
    });

    assert.equal(response.statusCode, 200, response.body);
    const result = response.json();
    const storageCall = storageCalls.at(-1);
    assert.equal(result.mimeType, fixture.mimeType);
    assert.equal(result.byteSize, fixture.contents.length);
    const expectedSha256 = crypto.createHash('sha256').update(fixture.contents).digest('hex');
    const expectedObjectKey = (
      `mindmap-images/sha256/${expectedSha256}.${extensionByMimeType[fixture.mimeType]}`
    );
    assert.equal(result.sha256, expectedSha256);
    assert.match(result.sha256, /^[a-f0-9]{64}$/);
    assert.equal(result.objectKey, expectedObjectKey);
    assert.doesNotMatch(result.fileName, /[\\/?*]/);
    assert.doesNotMatch(result.fileName, /^\.+$/);
    assert.equal(storageCall.objectKey, expectedObjectKey);
    assert.equal(storageCall.objectKey.includes(result.fileName), false);
    assert.equal(storageCall.mimeType, fixture.mimeType);
    assert.deepEqual(storageCall.buffer, fixture.contents);
    assert.equal(
      result.url,
      `/api/mindmap/image-assets/${expectedSha256}.${extensionByMimeType[fixture.mimeType]}`,
    );
    assert.equal(result.url.includes('assets.example.test'), false);
  }

  const repeated = await app.inject({
    method: 'POST',
    url: '/upload?kind=image',
    ...multipartPayload(rasterFixtures[0]),
  });
  assert.equal(repeated.statusCode, 200, repeated.body);
  assert.equal(repeated.json().objectKey, storageCalls[0].objectKey);
  assert.equal(new Set(storageCalls.map((call) => call.objectKey)).size, rasterFixtures.length);
});

test('image upload rejects spoofed MIME, mismatched raster MIME, and SVG before storage', async (t) => {
  const originalPutMindMapImage = dbService.putMindMapImage;
  let storageCallCount = 0;
  dbService.putMindMapImage = async () => {
    storageCallCount += 1;
    return 'https://assets.example.test/unexpected';
  };
  t.after(() => { dbService.putMindMapImage = originalPutMindMapImage; });

  const app = await buildApp();
  t.after(() => app.close());

  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect /></svg>', 'utf8');
  const cases = [
    {
      fixture: { contents: svg, fileName: 'spoofed.png', mimeType: 'image/png' },
      error: 'Image content does not match its declared MIME type',
    },
    {
      fixture: { contents: rasterFixtures[1].contents, fileName: 'mismatch.png', mimeType: 'image/png' },
      error: 'Image content does not match its declared MIME type',
    },
    {
      fixture: { contents: svg, fileName: 'vector.svg', mimeType: 'image/svg+xml' },
      error: 'Unsupported image type',
    },
    {
      fixture: {
        contents: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]),
        fileName: 'truncated.jpeg',
        mimeType: 'image/jpeg',
      },
      error: 'Image content does not match its declared MIME type',
    },
  ];

  for (const item of cases) {
    const response = await app.inject({
      method: 'POST',
      url: '/upload?kind=image',
      ...multipartPayload(item.fixture),
    });
    assert.equal(response.statusCode, 415);
    assert.deepEqual(response.json(), { error: item.error });
  }
  assert.equal(storageCallCount, 0);
});

test('image upload rejects truncated, trailing, and structurally corrupt rasters before storage', async (t) => {
  const originalPutMindMapImage = dbService.putMindMapImage;
  let storageCallCount = 0;
  dbService.putMindMapImage = async () => { storageCallCount += 1; };
  t.after(() => { dbService.putMindMapImage = originalPutMindMapImage; });

  const app = await buildApp();
  t.after(() => app.close());

  const corruptCases = rasterFixtures.flatMap((fixture) => [
    { ...fixture, fileName: `truncated-${fixture.fileName}`, contents: fixture.contents.subarray(0, -1) },
    { ...fixture, fileName: `trailing-${fixture.fileName}`, contents: Buffer.concat([fixture.contents, Buffer.from([0])]) },
  ]);

  const badPngCrc = Buffer.from(rasterFixtures[0].contents);
  const imageDataTypeOffset = badPngCrc.indexOf(Buffer.from('IDAT', 'ascii'));
  assert.notEqual(imageDataTypeOffset, -1);
  badPngCrc[imageDataTypeOffset + 4] ^= 0x01;
  corruptCases.push({
    mimeType: 'image/png',
    fileName: 'bad-crc.png',
    contents: badPngCrc,
  });

  const badWebpLength = Buffer.from(rasterFixtures[3].contents);
  badWebpLength.writeUInt32LE(badWebpLength.readUInt32LE(4) + 2, 4);
  corruptCases.push({
    mimeType: 'image/webp',
    fileName: 'bad-riff-length.webp',
    contents: badWebpLength,
  });

  for (const fixture of corruptCases) {
    const response = await app.inject({
      method: 'POST',
      url: '/upload?kind=image',
      ...multipartPayload(fixture),
    });
    assert.equal(response.statusCode, 415, fixture.fileName);
    assert.deepEqual(response.json(), {
      error: 'Image content does not match its declared MIME type',
    });
  }
  assert.equal(storageCallCount, 0);
});

test('image upload enforces the decoded pixel budget before storage', async (t) => {
  const originalPutMindMapImage = dbService.putMindMapImage;
  let storageCallCount = 0;
  dbService.putMindMapImage = async () => { storageCallCount += 1; };
  t.after(() => { dbService.putMindMapImage = originalPutMindMapImage; });

  const oversizedPng = Buffer.from(rasterFixtures[0].contents);
  oversizedPng.writeUInt32BE(10_000, 16);
  oversizedPng.writeUInt32BE(10_000, 20);
  oversizedPng.writeUInt32BE(pngCrc32(oversizedPng.subarray(12, 29)), 29);

  const app = await buildApp();
  t.after(() => app.close());
  const response = await app.inject({
    method: 'POST',
    url: '/upload?kind=image',
    ...multipartPayload({
      contents: oversizedPng,
      fileName: 'pixel-bomb.png',
      mimeType: 'image/png',
    }),
  });

  assert.equal(response.statusCode, 415);
  assert.deepEqual(response.json(), {
    error: 'Image content does not match its declared MIME type',
  });
  assert.equal(storageCallCount, 0);
});

test('upload rejects missing and empty files with deterministic client errors', async (t) => {
  const originalPutMindMapImage = dbService.putMindMapImage;
  let storageCallCount = 0;
  dbService.putMindMapImage = async () => { storageCallCount += 1; };
  t.after(() => { dbService.putMindMapImage = originalPutMindMapImage; });

  const app = await buildApp();
  t.after(() => app.close());

  const missingPayload = await app.inject({ method: 'POST', url: '/upload?kind=image' });
  assert.equal(missingPayload.statusCode, 400);
  assert.deepEqual(missingPayload.json(), { error: 'No file uploaded' });

  const missingFile = await app.inject({
    method: 'POST',
    url: '/upload?kind=image',
    ...multipartWithoutFile(),
  });
  assert.equal(missingFile.statusCode, 400);
  assert.deepEqual(missingFile.json(), { error: 'No file uploaded' });

  const emptyFile = await app.inject({
    method: 'POST',
    url: '/upload?kind=image',
    ...multipartPayload({ contents: Buffer.alloc(0), fileName: 'empty.png', mimeType: 'image/png' }),
  });
  assert.equal(emptyFile.statusCode, 400);
  assert.deepEqual(emptyFile.json(), { error: 'Uploaded file is empty' });
  assert.equal(storageCallCount, 0);
});

test('managed image read serves all raster types through a fixed validated keyspace', async (t) => {
  const originalGetMindMapImage = dbService.getMindMapImage;
  const resources = new Map(rasterFixtures.map((fixture) => {
    const sha = crypto.createHash('sha256').update(fixture.contents).digest('hex');
    const resourceName = `${sha}.${extensionByMimeType[fixture.mimeType]}`;
    return [
      `mindmap-images/sha256/${resourceName}`,
      { buffer: fixture.contents, mimeType: fixture.mimeType, resourceName },
    ];
  }));
  const reads = [];
  dbService.getMindMapImage = async (objectKey) => {
    reads.push(objectKey);
    return resources.get(objectKey) || null;
  };
  t.after(() => { dbService.getMindMapImage = originalGetMindMapImage; });

  const app = await buildApp();
  t.after(() => app.close());

  for (const [objectKey, resource] of resources) {
    const response = await app.inject({
      method: 'GET',
      url: `/mindmap/image-assets/${resource.resourceName}`,
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.rawPayload, resource.buffer);
    assert.equal(response.headers['content-type'], resource.mimeType);
    assert.equal(response.headers['content-length'], String(resource.buffer.length));
    assert.equal(
      response.headers.etag,
      `"${resource.resourceName.slice(0, 64)}"`,
    );
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.equal(response.headers['cache-control'], 'private, no-store');
    assert.equal(reads.at(-1), objectKey);
  }
});

test('managed image read rejects arbitrary names and traversal before storage', async (t) => {
  const originalGetMindMapImage = dbService.getMindMapImage;
  let reads = 0;
  dbService.getMindMapImage = async () => {
    reads += 1;
    return null;
  };
  t.after(() => { dbService.getMindMapImage = originalGetMindMapImage; });

  const app = await buildApp();
  t.after(() => app.close());
  const invalidNames = [
    'not-a-hash.png',
    `${'a'.repeat(64)}.svg`,
    `${'A'.repeat(64)}.png`,
    'https%3A%2F%2Fprivate.example%2Fimage.png',
    '..%2Fsecret.png',
  ];
  for (const resourceName of invalidNames) {
    const response = await app.inject({
      method: 'GET',
      url: `/mindmap/image-assets/${resourceName}`,
    });
    assert.ok([400, 404].includes(response.statusCode), response.body);
  }
  assert.equal(reads, 0);
});

test('managed image read returns a stable 404 and sanitizes corrupt/storage failures', async (t) => {
  const originalGetMindMapImage = dbService.getMindMapImage;
  const app = await buildApp();
  t.after(() => {
    dbService.getMindMapImage = originalGetMindMapImage;
    return app.close();
  });

  const missingName = `${'a'.repeat(64)}.png`;
  dbService.getMindMapImage = async () => null;
  const missing = await app.inject({
    method: 'GET',
    url: `/mindmap/image-assets/${missingName}`,
  });
  assert.equal(missing.statusCode, 404);
  assert.deepEqual(missing.json(), { error: 'Image asset not found' });

  const expected = rasterFixtures[0];
  const expectedSha = crypto.createHash('sha256').update(expected.contents).digest('hex');
  dbService.getMindMapImage = async () => ({
    buffer: Buffer.from('not an image'),
    mimeType: 'image/png',
  });
  const corrupt = await app.inject({
    method: 'GET',
    url: `/mindmap/image-assets/${expectedSha}.png`,
  });
  assert.equal(corrupt.statusCode, 500);
  assert.deepEqual(corrupt.json(), { error: 'Image asset unavailable' });

  dbService.getMindMapImage = async () => {
    throw new Error('C:\\private\\asset.png?token=do-not-leak');
  };
  const failed = await app.inject({
    method: 'GET',
    url: `/mindmap/image-assets/${expectedSha}.png`,
  });
  assert.equal(failed.statusCode, 500);
  assert.deepEqual(failed.json(), { error: 'Image asset unavailable' });
  assert.equal(failed.body.includes('private'), false);
  assert.equal(failed.body.includes('token='), false);
});

test('generic upload remains compatible without raster enforcement and returns the same metadata shape', async (t) => {
  const originalUploadFile = dbService.uploadFile;
  let storageCall;
  dbService.uploadFile = async (buffer, storageKey, mimeType) => {
    storageCall = { buffer, storageKey, mimeType };
    return 'https://assets.example.test/generic';
  };
  t.after(() => { dbService.uploadFile = originalUploadFile; });

  const app = await buildApp();
  t.after(() => app.close());

  const contents = Buffer.from('<svg>kept as a generic attachment</svg>', 'utf8');
  const response = await app.inject({
    method: 'POST',
    url: '/upload',
    ...multipartPayload({ contents, fileName: 'notes?.txt', mimeType: 'text/plain' }),
  });

  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json(), {
    url: 'https://assets.example.test/generic',
    fileName: 'notes-.txt',
    mimeType: 'text/plain',
    byteSize: contents.length,
    sha256: crypto.createHash('sha256').update(contents).digest('hex'),
  });
  assert.equal(storageCall.mimeType, 'text/plain');
  assert.deepEqual(storageCall.buffer, contents);
  assert.match(storageCall.storageKey, /^[0-9a-f-]{36}$/i);
});

test('upload maps the global multipart limit to 413 without calling storage', async (t) => {
  const originalUploadFile = dbService.uploadFile;
  let storageCallCount = 0;
  dbService.uploadFile = async () => { storageCallCount += 1; };
  t.after(() => { dbService.uploadFile = originalUploadFile; });

  const app = await buildApp({ fileSize: 8 });
  t.after(() => app.close());
  const response = await app.inject({
    method: 'POST',
    url: '/upload',
    ...multipartPayload({ contents: Buffer.alloc(9, 1) }),
  });

  assert.equal(response.statusCode, 413);
  assert.deepEqual(response.json(), { error: 'File exceeds upload size limit' });
  assert.equal(storageCallCount, 0);
});

test('storage failures return a stable 500 without leaking error details', async (t) => {
  const originalUploadFile = dbService.uploadFile;
  dbService.uploadFile = async () => {
    throw new Error('C:\\private\\asset.png https://storage.test/object?token=do-not-leak');
  };
  t.after(() => { dbService.uploadFile = originalUploadFile; });

  const app = await buildApp();
  t.after(() => app.close());
  const response = await app.inject({
    method: 'POST',
    url: '/upload',
    ...multipartPayload({ contents: Buffer.from('attachment'), fileName: 'asset.bin' }),
  });

  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.json(), { error: 'Upload failed' });
  assert.equal(response.body.includes('private'), false);
  assert.equal(response.body.includes('token='), false);
});

test('database initialization creates and enforces a private managed image bucket', async (t) => {
  const originalChromaUrl = process.env.CHROMA_URL;
  delete process.env.CHROMA_URL;
  let listedBuckets = [{ name: 'sop-images', public: true }];
  const createCalls = [];
  const updateCalls = [];
  let updateBucketError = null;
  dbService.__setSupabaseClientForTests({
    storage: {
      listBuckets: async () => ({ data: listedBuckets, error: null }),
      createBucket: async (name, options) => {
        createCalls.push({ name, options });
        return { data: { name }, error: null };
      },
      updateBucket: async (name, options) => {
        updateCalls.push({ name, options });
        return updateBucketError
          ? { data: null, error: updateBucketError }
          : { data: { message: 'updated' }, error: null };
      },
    },
  });
  t.after(() => {
    dbService.__setSupabaseClientForTests(null);
    if (originalChromaUrl === undefined) delete process.env.CHROMA_URL;
    else process.env.CHROMA_URL = originalChromaUrl;
  });

  await dbService.initDB();
  assert.deepEqual(createCalls, [{
    name: 'mindmap-images',
    options: {
      public: false,
      fileSizeLimit: 15 * 1024 * 1024,
      allowedMimeTypes: ['image/gif', 'image/jpeg', 'image/png', 'image/webp'],
    },
  }]);

  listedBuckets = [
    { name: 'sop-images', public: true },
    { name: 'mindmap-images', public: true },
  ];
  await dbService.initDB();
  assert.deepEqual(updateCalls, [{
    name: 'mindmap-images',
    options: {
      public: false,
      fileSizeLimit: 15 * 1024 * 1024,
      allowedMimeTypes: ['image/gif', 'image/jpeg', 'image/png', 'image/webp'],
    },
  }]);

  updateBucketError = new Error('private bucket update denied');
  await dbService.initDB();
  const fixture = rasterFixtures[0];
  const sha256 = crypto.createHash('sha256').update(fixture.contents).digest('hex');
  await assert.rejects(
    dbService.putMindMapImage(
      fixture.contents,
      `mindmap-images/sha256/${sha256}.png`,
      fixture.mimeType,
    ),
    /storage is not ready/i,
  );
});

test('managed db storage seam upserts idempotently and converts Supabase download payloads', async (t) => {
  const originalChromaUrl = process.env.CHROMA_URL;
  delete process.env.CHROMA_URL;
  const fixture = rasterFixtures[0];
  const sha256 = crypto.createHash('sha256').update(fixture.contents).digest('hex');
  const objectKey = `mindmap-images/sha256/${sha256}.png`;
  const uploadCalls = [];
  const fromCalls = [];
  const bucket = {
    upload: async (key, buffer, options) => {
      uploadCalls.push({ key, buffer, options });
      return { data: { path: key }, error: null };
    },
    getPublicUrl: () => assert.fail('managed images must not request a public URL'),
    download: async () => ({
      data: new Blob([fixture.contents], { type: fixture.mimeType }),
      error: null,
    }),
  };
  dbService.__setSupabaseClientForTests({
    storage: {
      listBuckets: async () => ({
        data: [
          { name: 'sop-images', public: true },
          { name: 'mindmap-images', public: false },
        ],
        error: null,
      }),
      from: (name) => {
        fromCalls.push(name);
        return bucket;
      },
    },
  });
  t.after(() => {
    dbService.__setSupabaseClientForTests(null);
    if (originalChromaUrl === undefined) delete process.env.CHROMA_URL;
    else process.env.CHROMA_URL = originalChromaUrl;
  });
  await dbService.initDB();

  const storedResult = await dbService.putMindMapImage(
    fixture.contents,
    objectKey,
    fixture.mimeType,
  );
  assert.equal(storedResult, undefined);
  assert.equal(uploadCalls.length, 1);
  assert.equal(uploadCalls[0].key, objectKey);
  assert.deepEqual(uploadCalls[0].buffer, fixture.contents);
  assert.deepEqual(uploadCalls[0].options, {
    cacheControl: '0',
    contentType: 'image/png',
    upsert: true,
  });

  const downloaded = await dbService.getMindMapImage(objectKey);
  assert.deepEqual(downloaded.buffer, fixture.contents);
  assert.equal(downloaded.mimeType, fixture.mimeType);
  assert.deepEqual(fromCalls, ['mindmap-images', 'mindmap-images']);

  await assert.rejects(
    dbService.putMindMapImage(fixture.contents, `mindmap-images/sha256/${'0'.repeat(64)}.png`, fixture.mimeType),
    /metadata does not match/i,
  );
});
