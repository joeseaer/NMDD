const test = require('node:test');
const assert = require('node:assert/strict');
const {
  RelationshipSystemError,
  createRelationshipSystemService,
  __test,
} = require('../services/relationshipSystemService');

function healthcheckClient(rpcError) {
  return {
    from() {
      return {
        select() { return this; },
        limit() { return Promise.resolve({ data: [], error: null }); },
      };
    },
    async rpc() { return { data: null, error: rpcError }; },
  };
}

test('remote healthcheck treats the atomic decision RS_NOT_FOUND probe as proof that the RPC exists', async () => {
  const service = createRelationshipSystemService({
    userId: 'server-owned-user',
    client: healthcheckClient({ code: 'P0001', message: 'RS_NOT_FOUND' }),
  });
  const result = await service.healthcheck();
  assert.equal(result.ready, true);
  assert.equal(result.migration, '20260718_add_people_overview_attention');
});

test('remote healthcheck rejects a database where the attention decision RPC is not deployed', async () => {
  const service = createRelationshipSystemService({
    userId: 'server-owned-user',
    client: healthcheckClient({
      code: 'PGRST202',
      message: 'Could not find the function public.decide_relationship_attention_recommendation in the schema cache',
    }),
  });
  await assert.rejects(service.healthcheck(), (error) => {
    assert.equal(error.code, 'MIGRATION_REQUIRED');
    assert.equal(error.details.migration, 'supabase/migrations/20260718_add_people_overview_attention.sql');
    return true;
  });
});

test('missing PostgREST table is classified as MIGRATION_REQUIRED', () => {
  const error = {
    code: 'PGRST205',
    message: "Could not find the table 'public.relationship_contexts' in the schema cache",
  };
  assert.equal(__test.isMigrationMissingError(error), true);
  const translated = __test.translateDatabaseError(error);
  assert.ok(translated instanceof RelationshipSystemError);
  assert.equal(translated.code, 'MIGRATION_REQUIRED');
  assert.equal(translated.statusCode, 503);
});

test('missing planning_state column points to the additive 20260718 migration', () => {
  const translated = __test.translateDatabaseError({
    code: 'PGRST204',
    message: "Could not find the 'planning_state' column of 'relationship_compasses' in the schema cache",
  });
  assert.equal(translated.code, 'MIGRATION_REQUIRED');
  assert.equal(translated.details.migration, 'supabase/migrations/20260718_add_relationship_compass_planning_state.sql');
});

test('missing atomic attention decision RPC points to the people overview additive migration', async () => {
  const service = createRelationshipSystemService({
    userId: 'server-owned-user',
    client: {
      async rpc() {
        return {
          data: null,
          error: {
            code: 'PGRST202',
            message: 'Could not find the function public.decide_relationship_attention_recommendation in the schema cache',
          },
        };
      },
    },
  });
  await assert.rejects(
    service.decideAttentionRecommendation('00000000-0000-0000-0000-000000000001', {
      decision: 'accept', expectedVersion: 1, userId: 'attacker',
    }),
    (error) => {
      assert.equal(error.code, 'MIGRATION_REQUIRED');
      assert.equal(error.statusCode, 503);
      assert.equal(error.details.migration, 'supabase/migrations/20260718_add_people_overview_attention.sql');
      return true;
    }
  );
});

test('interaction normalization preserves observation and interpretation as separate fields', () => {
  const result = __test.normalizeInteractionDraft({
    summary: 'A real conversation',
    observed_facts: ['They said the deadline is Friday'],
    interpretations: ['They may be under pressure'],
    my_actions: ['Asked about timing'],
    their_reactions: ['Answered directly'],
    commitments: [{ owner: 'me', text: 'Send draft' }],
  });
  assert.deepEqual(result.observed_facts, ['They said the deadline is Friday']);
  assert.deepEqual(result.interpretations, ['They may be under pressure']);
  assert.notDeepEqual(result.observed_facts, result.interpretations);
});

test('database validation errors do not become opaque 500 responses', () => {
  const translated = __test.translateDatabaseError({ code: '23514', message: 'check constraint' });
  assert.equal(translated.code, 'VALIDATION_ERROR');
  assert.equal(translated.statusCode, 400);
});
