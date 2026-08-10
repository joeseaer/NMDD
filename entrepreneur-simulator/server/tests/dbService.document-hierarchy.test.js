const test = require('node:test');
const assert = require('node:assert/strict');

const dbService = require('../services/dbService');
const { createFakeSupabase } = require('./helpers/fakeSupabase');

const ROOT_ID = '11111111-1111-4111-8111-111111111111';
const CHILD_ID = '22222222-2222-4222-8222-222222222222';
const GRANDCHILD_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_USER_ID = '44444444-4444-4444-8444-444444444444';

const page = (overrides = {}) => ({
  id: ROOT_ID,
  user_id: 'user-1',
  title: 'Page',
  category: 'note',
  tags: [],
  version: 'V1.0',
  content: '',
  content_json: null,
  content_schema_version: 1,
  content_revision: 4,
  domain: 'life',
  research_type: null,
  parent_id: null,
  sort_order: 100,
  structure_updated_at: '2026-08-09T00:00:00.000Z',
  created_at: '2026-08-09T00:00:00.000Z',
  updated_at: '2026-08-09T00:00:00.000Z',
  sop_versions: [],
  sop_usage_logs: [],
  scene_sop_rel: [],
  people_sop_rel: [],
  ...overrides,
});

test.afterEach(() => dbService.__setSupabaseClientForTests(null));

test('moves a page without changing its content revision', async () => {
  const fake = createFakeSupabase({
    rows: [page(), page({ id: CHILD_ID, title: 'Child' })],
  });
  dbService.__setSupabaseClientForTests(fake.client);

  const result = await dbService.updateSOPLocation({
    id: CHILD_ID,
    userId: 'user-1',
    parentId: ROOT_ID,
    sortOrder: 200,
  });

  assert.equal(result.parent_id, ROOT_ID);
  assert.equal(result.sort_order, 200);
  assert.equal(fake.state.rows.get(CHILD_ID).content_revision, 4);
});

test('creates a child under a legacy research parent encoded with system tags', async () => {
  const fake = createFakeSupabase({
    rows: [page({
      domain: undefined,
      research_type: undefined,
      tags: ['domain:research', 'research_type:document'],
    })],
  });
  dbService.__setSupabaseClientForTests(fake.client);

  const result = await dbService.saveSOP({
    user_id: 'user-1',
    title: 'Research child',
    category: 'note',
    tags: [],
    version: 'V1.0',
    content: '',
    content_json: null,
    domain: 'research',
    research_type: 'document',
    parent_id: ROOT_ID,
    sort_order: 200,
  }, { returnResult: true });

  assert.equal(result.parent_id, ROOT_ID);
  assert.equal(fake.state.rows.get(result.id).parent_id, ROOT_ID);
});

test('rejects cycles, foreign-user parents and cross-workspace parents', async () => {
  const fake = createFakeSupabase({
    rows: [
      page(),
      page({ id: CHILD_ID, title: 'Child', parent_id: ROOT_ID }),
      page({ id: GRANDCHILD_ID, title: 'Grandchild', parent_id: CHILD_ID }),
      page({ id: OTHER_USER_ID, user_id: 'user-2', title: 'Foreign' }),
      page({ id: '55555555-5555-4555-8555-555555555555', title: 'Research', domain: 'research', research_type: 'document' }),
      page({
        id: '66666666-6666-4666-8666-666666666666',
        title: 'Legacy research',
        domain: undefined,
        research_type: undefined,
        tags: ['domain:research', 'research_type:document'],
      }),
    ],
  });
  dbService.__setSupabaseClientForTests(fake.client);

  await assert.rejects(
    dbService.updateSOPLocation({ id: ROOT_ID, userId: 'user-1', parentId: GRANDCHILD_ID }),
    (error) => error.code === 'SOP_PARENT_CYCLE',
  );
  await assert.rejects(
    dbService.updateSOPLocation({ id: ROOT_ID, userId: 'user-1', parentId: OTHER_USER_ID }),
    (error) => error.code === 'SOP_PARENT_NOT_FOUND',
  );
  await assert.rejects(
    dbService.updateSOPLocation({
      id: ROOT_ID,
      userId: 'user-1',
      parentId: '55555555-5555-4555-8555-555555555555',
    }),
    (error) => error.code === 'SOP_PARENT_DOMAIN_MISMATCH',
  );
  await assert.rejects(
    dbService.updateSOPLocation({
      id: ROOT_ID,
      userId: 'user-1',
      parentId: '66666666-6666-4666-8666-666666666666',
    }),
    (error) => error.code === 'SOP_PARENT_DOMAIN_MISMATCH',
  );
});

test('deleting a page promotes its direct children to the deleted page parent', async () => {
  const fake = createFakeSupabase({
    rows: [
      page(),
      page({ id: CHILD_ID, title: 'Child', parent_id: ROOT_ID }),
      page({ id: GRANDCHILD_ID, title: 'Grandchild', parent_id: CHILD_ID }),
    ],
  });
  dbService.__setSupabaseClientForTests(fake.client);

  const result = await dbService.deleteSOP(CHILD_ID);

  assert.equal(fake.state.rows.has(CHILD_ID), false);
  assert.equal(fake.state.rows.get(GRANDCHILD_ID).parent_id, ROOT_ID);
  assert.deepEqual(result.promoted_child_ids, [GRANDCHILD_ID]);
  assert.equal(result.parent_id, ROOT_ID);
  assert.equal(fake.state.rows.get(GRANDCHILD_ID).content_revision, 4);
});
