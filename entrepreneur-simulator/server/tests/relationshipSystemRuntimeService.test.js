const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createRelationshipSystemRuntimeService,
  PUBLIC_METHODS,
} = require('../services/relationshipSystemRuntimeService');
const { createRelationshipSystemService } = require('../services/relationshipSystemService');

function makeService(label, overrides = {}) {
  const calls = [];
  const service = {
    calls,
    localFile: label === 'local' ? 'C:\\data\\relationship-system.local.json' : undefined,
    async healthcheck() {
      calls.push(['healthcheck']);
      return { ready: true, backend: label };
    },
  };
  for (const methodName of PUBLIC_METHODS) {
    service[methodName] = async (...args) => {
      calls.push([methodName, ...args]);
      return { backend: label, methodName, args };
    };
  }
  return Object.assign(service, overrides);
}

function codedError(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

test('local mode always delegates locally without probing Supabase', async () => {
  const remote = makeService('remote');
  const local = makeService('local');
  const runtime = createRelationshipSystemRuntimeService({
    env: { RELATIONSHIP_STORAGE_MODE: 'local' },
    remoteService: remote,
    localService: local,
  });

  const result = await runtime.createPerson({ name: 'Ada' });
  const health = await runtime.healthcheck();

  assert.equal(result.backend, 'local');
  assert.deepEqual(remote.calls, []);
  assert.deepEqual(local.calls[0], ['createPerson', { name: 'Ada' }]);
  assert.equal(health.storageMode, 'local');
  assert.equal(health.localFile, 'C:\\data\\relationship-system.local.json');
});

test('supabase mode always delegates remotely and never loads local storage', async () => {
  const remote = makeService('remote');
  let localLoads = 0;
  const runtime = createRelationshipSystemRuntimeService({
    mode: 'supabase',
    remoteService: remote,
    loadLocalService() {
      localLoads += 1;
      return makeService('local');
    },
  });

  const result = await runtime.listPeople({ limit: 3 });

  assert.equal(result.backend, 'remote');
  assert.equal(localLoads, 0);
  assert.deepEqual(remote.calls, [['listPeople', { limit: 3 }]]);
});

test('auto mode probes once, selects Supabase, and caches that selection', async () => {
  const remote = makeService('remote');
  const local = makeService('local');
  const runtime = createRelationshipSystemRuntimeService({
    mode: 'auto',
    remoteService: remote,
    localService: local,
  });

  const [people, today] = await Promise.all([
    runtime.listPeople(),
    runtime.getToday(),
  ]);
  const health = await runtime.healthcheck();

  assert.equal(people.backend, 'remote');
  assert.equal(today.backend, 'remote');
  assert.equal(health.storageMode, 'supabase');
  assert.equal(remote.calls.filter(([name]) => name === 'healthcheck').length, 1);
  assert.deepEqual(local.calls, []);
});

for (const errorCode of ['MIGRATION_REQUIRED', 'DATABASE_UNAVAILABLE']) {
  test(`auto mode falls back to local storage for ${errorCode}`, async () => {
    const remote = makeService('remote', {
      async healthcheck() {
        remote.calls.push(['healthcheck']);
        throw codedError(errorCode);
      },
    });
    const local = makeService('local');
    const runtime = createRelationshipSystemRuntimeService({
      mode: 'auto',
      remoteService: remote,
      localService: local,
    });

    const result = await runtime.getToday();
    const health = await runtime.healthcheck();

    assert.equal(result.backend, 'local');
    assert.equal(health.storageMode, 'local');
    assert.equal(health.fallbackReason, errorCode);
    assert.equal(remote.calls.filter(([name]) => name === 'healthcheck').length, 1);
  });
}

test('auto mode rethrows non-allowlisted probe errors and does not load local storage', async () => {
  const expected = codedError('PERMISSION_DENIED');
  let remoteHealthCalls = 0;
  let localLoads = 0;
  const runtime = createRelationshipSystemRuntimeService({
    mode: 'auto',
    remoteService: {
      async healthcheck() {
        remoteHealthCalls += 1;
        throw expected;
      },
    },
    loadLocalService() {
      localLoads += 1;
      return makeService('local');
    },
  });

  await assert.rejects(runtime.getToday(), (error) => error === expected);
  await assert.rejects(runtime.listPeople(), (error) => error === expected);
  assert.equal(remoteHealthCalls, 1, 'the rejected selection is cached');
  assert.equal(localLoads, 0);
});

test('a failure after remote selection is rethrown without switching stores', async () => {
  const writeError = codedError('DATABASE_UNAVAILABLE', 'write failed after selection');
  const remote = makeService('remote', {
    async createDecision() {
      remote.calls.push(['createDecision']);
      throw writeError;
    },
  });
  const local = makeService('local');
  const runtime = createRelationshipSystemRuntimeService({
    mode: 'auto',
    remoteService: remote,
    localService: local,
  });

  await assert.rejects(runtime.createDecision({ goal: 'test' }), (error) => error === writeError);
  const result = await runtime.getToday();

  assert.equal(result.backend, 'remote');
  assert.deepEqual(local.calls, []);
  assert.equal(remote.calls.filter(([name]) => name === 'healthcheck').length, 1);
});

test('runtime exposes every application-facing relationship method', () => {
  const runtime = createRelationshipSystemRuntimeService({
    mode: 'local',
    remoteService: makeService('remote'),
    localService: makeService('local'),
  });

  assert.equal(typeof runtime.healthcheck, 'function');
  for (const methodName of PUBLIC_METHODS) {
    assert.equal(typeof runtime[methodName], 'function', methodName);
  }
});

test('auto mode falls back locally when legacy Supabase tables exist but the new attention RPC is missing', async () => {
  const remote = createRelationshipSystemService({
    userId: 'server-owned-user',
    client: {
      from() {
        return {
          select() { return this; },
          limit() { return Promise.resolve({ data: [], error: null }); },
        };
      },
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
  const local = makeService('local');
  const runtime = createRelationshipSystemRuntimeService({
    mode: 'auto', remoteService: remote, localService: local,
  });
  const health = await runtime.healthcheck();
  const overview = await runtime.getPeopleOverview();
  assert.equal(health.storageMode, 'local');
  assert.equal(health.fallbackReason, 'MIGRATION_REQUIRED');
  assert.equal(overview.backend, 'local');
});
