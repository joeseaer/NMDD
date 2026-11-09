const test = require('node:test');
const assert = require('node:assert/strict');
const dbService = require('../services/dbService');
const { createFakeSupabase } = require('./helpers/fakeSupabase');

const row = (id, tags, extra = {}) => ({
  id, user_id: 'user', title: id, category: 'note', content: 'body', tags,
  created_at: '2026-11-09T00:00:00Z', updated_at: '2026-11-09T00:00:00Z', ...extra,
});
test.afterEach(() => dbService.__setSupabaseClientForTests(null));

test('legacy workspace filtering excludes other workspaces and retains untagged life documents', async () => {
  const fake = createFakeSupabase({
    missingColumns: ['domain'], supportsReliability: false,
    rows: [row('life', []), row('old-life', null), row('research', ['domain:research']), row('foreign', [], { user_id: 'another-user' })],
  });
  dbService.__setSupabaseClientForTests(fake.client);
  assert.deepEqual((await dbService.getSOPs('user', { domain: 'life' })).map(d => d.id), ['life', 'old-life']);
  assert.equal(fake.state.calls.length, 3, 'first read discovers missing metadata and reliability columns');
  const before = fake.state.calls.length;
  assert.deepEqual((await dbService.getSOPs('user', { domain: 'research' })).map(d => d.id), ['research']);
  assert.equal(fake.state.calls.length - before, 1, 'subsequent reads need only one database request');
  assert.deepEqual(fake.state.calls.at(-1).filters, [['user_id', 'user'], ['tags', ['domain:research'], 'contains']]);
});

test('a partially upgraded schema still filters real domain/research_type values correctly', async () => {
  const fake = createFakeSupabase({
    missingColumns: ['research_type'],
    rows: [row('research', [], { domain: 'research', research_type: 'document' }), row('life', [], { domain: 'life' })],
  });
  dbService.__setSupabaseClientForTests(fake.client);
  const docs = await dbService.getSOPs('user', { domain: 'research', researchType: 'document' });
  assert.deepEqual(docs.map(d => d.id), ['research']);
  assert.equal(fake.state.calls.at(-1).filters.some(([, , operator]) => operator === 'contains'), false);
});

test('schema probes recover automatically after a live database upgrade', async (t) => {
  let now = 1_000_000;
  t.mock.method(Date, 'now', () => now);
  const fake = createFakeSupabase({
    missingColumns: ['domain'], supportsReliability: false,
    rows: [row('life', [], { domain: 'life', content_revision: 2, content_schema_version: 2 })],
  });
  dbService.__setSupabaseClientForTests(fake.client);
  await dbService.getSOPs('user', { domain: 'life' });
  fake.state.missingColumns.clear();
  fake.state.supportsReliability = true;
  now += 60_001;
  const before = fake.state.calls.length;
  const [document] = await dbService.getSOPs('user', { domain: 'life' });
  assert.equal(fake.state.calls.length - before, 1);
  assert.equal(document.revision_supported, true);
  assert.equal(document.content_revision, 2);
  assert.ok(fake.state.calls.at(-1).selection.includes('content_revision'));
  assert.ok(fake.state.calls.at(-1).filters.some(([field]) => field === 'domain'));
});
