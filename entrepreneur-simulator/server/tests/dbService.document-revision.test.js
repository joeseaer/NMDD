const test = require('node:test');
const assert = require('node:assert/strict');

const dbService = require('../services/dbService');

const clone = (value) => JSON.parse(JSON.stringify(value));

const createFakeSupabase = ({
  rows = [],
  supportsReliability = true,
  failVersionInsert = false,
  updateErrorOnce = null,
} = {}) => {
  const state = {
    rows: new Map(rows.map((row) => [row.id, clone(row)])),
    calls: [],
    supportsReliability,
    failVersionInsert,
    updateErrorOnce: updateErrorOnce ? clone(updateErrorOnce) : null,
    updateErrorConsumed: false,
    nextId: 1,
  };

  class Query {
    constructor(table) {
      this.table = table;
      this.operation = 'select';
      this.payload = null;
      this.filters = [];
      this.selection = '*';
    }

    update(payload) {
      this.operation = 'update';
      this.payload = clone(payload);
      return this;
    }

    insert(payload) {
      this.operation = 'insert';
      this.payload = clone(Array.isArray(payload) ? payload[0] : payload);
      return this;
    }

    delete() {
      this.operation = 'delete';
      return this;
    }

    select(selection = '*') {
      this.selection = selection;
      return this;
    }

    eq(field, value) {
      this.filters.push([field, value]);
      return this;
    }

    order() {
      return this;
    }

    single() {
      return Promise.resolve(this.execute(true));
    }

    maybeSingle() {
      return Promise.resolve(this.execute(true));
    }

    then(resolve, reject) {
      return Promise.resolve(this.execute(false)).then(resolve, reject);
    }

    referencesReliabilityFields() {
      const selection = String(this.selection || '');
      return (
        Object.keys(this.payload || {}).some((key) => key === 'content_revision' || key === 'content_schema_version') ||
        this.filters.some(([field]) => field === 'content_revision' || field === 'content_schema_version') ||
        selection.includes('content_revision') ||
        selection.includes('content_schema_version')
      );
    }

    matches(row) {
      return this.filters.every(([field, value]) => row?.[field] === value);
    }

    project(row) {
      if (!row) return null;
      if (String(this.selection).includes('sop_versions') || String(this.selection).trim() === '*') {
        return clone(row);
      }
      const fields = String(this.selection)
        .split(',')
        .map((field) => field.trim())
        .filter(Boolean);
      return fields.reduce((result, field) => {
        result[field] = row[field];
        return result;
      }, {});
    }

    execute(single) {
      state.calls.push({
        table: this.table,
        operation: this.operation,
        payload: clone(this.payload),
        filters: clone(this.filters),
        selection: this.selection,
      });

      if (!state.supportsReliability && this.referencesReliabilityFields()) {
        return {
          data: null,
          error: {
            code: 'PGRST204',
            message: "Could not find the 'content_schema_version' column of 'sops' in the schema cache",
          },
        };
      }

      if (
        this.table === 'sops' &&
        this.operation === 'update' &&
        state.updateErrorOnce &&
        !state.updateErrorConsumed
      ) {
        state.updateErrorConsumed = true;
        return { data: null, error: clone(state.updateErrorOnce) };
      }

      if (this.table === 'sop_versions' && this.operation === 'insert' && state.failVersionInsert) {
        return { data: null, error: { message: 'simulated version history failure' } };
      }

      if (this.table !== 'sops') return { data: null, error: null };

      if (this.operation === 'insert') {
        const row = {
          id: this.payload.id || `00000000-0000-4000-8000-${String(state.nextId++).padStart(12, '0')}`,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          ...clone(this.payload),
        };
        state.rows.set(row.id, row);
        return { data: this.project(row), error: null };
      }

      const matchingRows = Array.from(state.rows.values()).filter((row) => this.matches(row));
      if (this.operation === 'update') {
        const row = matchingRows[0];
        if (!row) return { data: null, error: null };
        const previousRevision = row.content_revision;
        Object.assign(row, clone(this.payload));
        if (state.supportsReliability) row.content_revision = previousRevision + 1;
        return { data: this.project(row), error: null };
      }

      const projected = matchingRows.map((row) => this.project(row));
      return { data: single ? (projected[0] || null) : projected, error: null };
    }
  }

  return {
    state,
    client: {
      from(table) {
        return new Query(table);
      },
    },
  };
};

const baseRow = (overrides = {}) => ({
  id: '11111111-1111-4111-8111-111111111111',
  user_id: 'user-1',
  title: 'Original',
  category: 'note',
  tags: [],
  version: 'V1.0',
  content: 'old',
  content_json: { type: 'doc', content: [] },
  content_schema_version: 1,
  content_revision: 4,
  domain: 'life',
  created_at: '2026-07-01T00:00:00.000Z',
  updated_at: '2026-07-01T00:00:00.000Z',
  sop_versions: [],
  sop_usage_logs: [],
  scene_sop_rel: [],
  people_sop_rel: [],
  ...overrides,
});

test.afterEach(() => dbService.__setSupabaseClientForTests(null));

test('missing-column detection only accepts schema-cache or undefined-column errors for the exact field', () => {
  const { errorMentionsColumn } = dbService.__test;

  assert.equal(errorMentionsColumn({
    code: 'PGRST204',
    message: "Could not find the 'content_revision' column of 'sops' in the schema cache",
  }, 'content_revision'), true);
  assert.equal(errorMentionsColumn({
    code: '42703',
    message: 'column "sops.content_revision" does not exist',
  }, 'content_revision'), true);

  assert.equal(errorMentionsColumn({
    code: '23514',
    message: 'new row violates check constraint content_revision_positive',
  }, 'content_revision'), false);
  assert.equal(errorMentionsColumn({
    code: 'PGRST204',
    message: 'request failed while writing content_revision',
  }, 'content_revision'), false);
  assert.equal(errorMentionsColumn({
    code: '42703',
    message: 'column "another_column" does not exist; content_revision was requested',
  }, 'content_revision'), false);
  assert.equal(errorMentionsColumn({
    message: 'column "content_revision" does not exist',
  }, 'content_revision'), false);
});

test('saveSOP performs an atomic revision compare-and-set and returns the new revision', async () => {
  const fake = createFakeSupabase({ rows: [baseRow()] });
  dbService.__setSupabaseClientForTests(fake.client);

  const result = await dbService.saveSOP({
    ...baseRow(),
    title: 'Updated',
    content: 'new body',
    content_schema_version: 2,
    expected_revision: 4,
  }, { returnResult: true });

  assert.deepEqual(result, {
    id: baseRow().id,
    content_schema_version: 2,
    content_revision: 5,
    revision_supported: true,
  });
  assert.equal(fake.state.rows.get(baseRow().id).content, 'new body');
  assert.ok(fake.state.calls.some((call) => (
    call.operation === 'update' &&
    call.filters.some(([field, value]) => field === 'content_revision' && value === 4)
  )));
});

test('saveSOP rejects a stale expected revision without modifying the document', async () => {
  const fake = createFakeSupabase({ rows: [baseRow({ content_revision: 5 })] });
  dbService.__setSupabaseClientForTests(fake.client);

  await assert.rejects(
    dbService.saveSOP({
      ...baseRow(),
      content: 'must not win',
      expected_revision: 4,
    }, { returnResult: true }),
    (error) => {
      assert.equal(error.code, 'SOP_REVISION_CONFLICT');
      assert.equal(error.statusCode, 409);
      assert.equal(error.expectedRevision, 4);
      assert.equal(error.currentRevision, 5);
      return true;
    }
  );

  assert.equal(fake.state.rows.get(baseRow().id).content, 'old');
});

test('an older client that omits content_schema_version does not downgrade the stored schema', async () => {
  const row = baseRow({ content_schema_version: 2, content_revision: 6 });
  const fake = createFakeSupabase({ rows: [row] });
  dbService.__setSupabaseClientForTests(fake.client);

  const result = await dbService.saveSOP({
    id: row.id,
    title: row.title,
    category: row.category,
    tags: row.tags,
    version: row.version,
    content: 'saved by an older client',
    expected_revision: 6,
  }, { returnResult: true });

  assert.equal(result.content_schema_version, 2);
  assert.equal(result.content_revision, 7);
  assert.equal(fake.state.rows.get(row.id).content_schema_version, 2);
});

test('saveSOP falls back safely when reliability columns have not been deployed', async () => {
  const legacy = baseRow();
  delete legacy.content_schema_version;
  delete legacy.content_revision;
  const fake = createFakeSupabase({ rows: [legacy], supportsReliability: false });
  dbService.__setSupabaseClientForTests(fake.client);

  const result = await dbService.saveSOP({
    ...legacy,
    content: 'legacy-compatible update',
    content_schema_version: 2,
    expected_revision: 4,
  }, { returnResult: true });

  assert.deepEqual(result, {
    id: legacy.id,
    content_schema_version: 1,
    content_revision: null,
    revision_supported: false,
  });
  assert.equal(fake.state.rows.get(legacy.id).content, 'legacy-compatible update');
  assert.equal(fake.state.rows.get(legacy.id).content_revision, undefined);
  assert.ok(fake.state.calls.some((call) => call.filters.some(([field]) => field === 'content_revision')));
  assert.ok(fake.state.calls.some((call) => (
    call.operation === 'update' && !call.filters.some(([field]) => field === 'content_revision')
  )));
});

test('a non-schema database error that mentions content_revision is not retried without CAS', async () => {
  const databaseError = {
    code: '23514',
    message: 'new row violates check constraint content_revision_positive',
  };
  const fake = createFakeSupabase({
    rows: [baseRow()],
    updateErrorOnce: databaseError,
  });
  dbService.__setSupabaseClientForTests(fake.client);

  await assert.rejects(
    dbService.saveSOP({
      ...baseRow(),
      content: 'must not bypass CAS',
      expected_revision: 4,
    }, { returnResult: true }),
    (error) => {
      assert.equal(error.code, databaseError.code);
      assert.equal(error.message, databaseError.message);
      return true;
    }
  );

  const updateCalls = fake.state.calls.filter((call) => (
    call.table === 'sops' && call.operation === 'update'
  ));
  assert.equal(updateCalls.length, 1);
  assert.ok(updateCalls[0].filters.some(([field, value]) => (
    field === 'content_revision' && value === 4
  )));
  assert.equal(fake.state.rows.get(baseRow().id).content, 'old');
});

test('saveSOP creates a new document at revision 1 without changing the legacy return contract', async () => {
  const fake = createFakeSupabase();
  dbService.__setSupabaseClientForTests(fake.client);

  const idOnly = await dbService.saveSOP({
    user_id: 'user-1',
    title: 'New document',
    category: 'note',
    tags: [],
    version: 'V1.0',
    content: 'body',
    content_json: { type: 'doc', content: [] },
    content_schema_version: 2,
  });

  assert.equal(typeof idOnly, 'string');
  const row = fake.state.rows.get(idOnly);
  assert.equal(row.content_schema_version, 2);
  assert.equal(row.content_revision, 1);
});

test('a failed history snapshot does not turn a committed document revision into a failed save', async () => {
  const fake = createFakeSupabase({ rows: [baseRow()], failVersionInsert: true });
  dbService.__setSupabaseClientForTests(fake.client);

  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const result = await dbService.saveSOP({
      ...baseRow(),
      content: 'committed body',
      expected_revision: 4,
      history: [{ version: 'V2.0', note: 'snapshot' }],
    }, { returnResult: true });

    assert.equal(result.content_revision, 5);
    assert.equal(fake.state.rows.get(baseRow().id).content, 'committed body');
    assert.ok(fake.state.calls.some((call) => (
      call.table === 'sop_versions' && call.operation === 'insert'
    )));
  } finally {
    console.warn = originalWarn;
  }
});

test('body autosaves without related data do not rewrite relation tables', async () => {
  const fake = createFakeSupabase({ rows: [baseRow()] });
  dbService.__setSupabaseClientForTests(fake.client);

  await dbService.saveSOP({
    ...baseRow(),
    content: 'body-only autosave',
    expected_revision: 4,
  }, { returnResult: true });

  assert.equal(fake.state.calls.some((call) => (
    call.table === 'scene_sop_rel' || call.table === 'people_sop_rel'
  )), false);
});

test('explicit related data still uses the relation persistence path', async () => {
  const fake = createFakeSupabase({ rows: [baseRow()] });
  dbService.__setSupabaseClientForTests(fake.client);

  await dbService.saveSOP({
    ...baseRow(),
    content: 'relation edit',
    expected_revision: 4,
    related: {
      scenes: [{ id: 'scene-1' }],
      people: [{ id: 'person-1' }],
    },
  }, { returnResult: true });

  const relationCalls = fake.state.calls.filter((call) => (
    call.table === 'scene_sop_rel' || call.table === 'people_sop_rel'
  ));
  assert.deepEqual(relationCalls.map((call) => [call.table, call.operation]), [
    ['scene_sop_rel', 'delete'],
    ['scene_sop_rel', 'insert'],
    ['people_sop_rel', 'delete'],
    ['people_sop_rel', 'insert'],
  ]);
});

test('getSOPs maps document and history schema/revision metadata', async () => {
  const row = baseRow({
    content_schema_version: 2,
    content_revision: 9,
    sop_versions: [{
      version: 'V1.0',
      created_at: '2026-07-01T00:00:00.000Z',
      version_note: 'snapshot',
      content_schema_version: 1,
      content_revision: 4,
    }],
  });
  const fake = createFakeSupabase({ rows: [row] });
  dbService.__setSupabaseClientForTests(fake.client);

  const [document] = await dbService.getSOPs('user-1', { domain: 'life' });

  assert.equal(document.content_schema_version, 2);
  assert.equal(document.content_revision, 9);
  assert.equal(document.revision_supported, true);
  assert.equal(document.history[0].content_schema_version, 1);
  assert.equal(document.history[0].content_revision, 4);
});

test('getSOPs treats documents as schema v1 and disables CAS on a legacy database', async () => {
  const legacy = baseRow();
  delete legacy.content_schema_version;
  delete legacy.content_revision;
  legacy.sop_versions = [{
    version: 'V1.0',
    created_at: '2026-07-01T00:00:00.000Z',
    version_note: '',
  }];
  const fake = createFakeSupabase({ rows: [legacy], supportsReliability: false });
  dbService.__setSupabaseClientForTests(fake.client);

  const [document] = await dbService.getSOPs('user-1', { domain: 'life' });

  assert.equal(document.content_schema_version, 1);
  assert.equal(document.content_revision, null);
  assert.equal(document.revision_supported, false);
  assert.equal(document.history[0].content_schema_version, 1);
  assert.equal(document.history[0].content_revision, null);
  assert.ok(fake.state.calls.length >= 2, 'the query should retry without new history columns');
});
