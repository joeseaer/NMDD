const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { DEFAULT_USER_ID } = require('../config/currentUser');
const {
  createRelationshipSystemLocalService,
  RelationshipSystemError,
} = require('../services/relationshipSystemLocalService');

const PUBLIC_METHODS = [
  'healthcheck', 'getCompass', 'saveCompass', 'getToday', 'listPeople', 'createPerson',
  'getPersonWorkspace', 'listContexts', 'createContext', 'updateContext', 'listInteractions',
  'createInteractionProposal', 'confirmInteraction', 'createManualInteraction', 'rejectProposal', 'createClaim', 'updateClaim',
  'addClaimEvidence', 'createDecision', 'updateDecision', 'saveDecisionOutcome', 'listOpportunities',
  'getOpportunity', 'createOpportunity', 'updateOpportunity', 'createExperiment', 'updateExperiment',
  'listWeeklyReviews', 'getCurrentWeeklyReview', 'generateWeeklyReview', 'confirmWeeklyReview',
  'saveWeeklyReview', 'listGrowthPatterns', 'createGrowthPattern', 'updateGrowthPattern',
  'setPersonAttention', 'listAttentionRecommendations', 'getLatestAttentionRecommendationRun',
  'replaceAttentionRecommendations', 'decideAttentionRecommendation', 'getPeopleOverview',
];

async function fixture(t, options = {}) {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'nmdd-relationships-local-'));
  t.after(async () => fs.promises.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'relationship-system.local.json');
  const emptyLegacy = {
    async getPeopleProfiles() { return []; },
    async getInteractionLogs() { return []; },
  };
  const make = (overrides = {}) => createRelationshipSystemLocalService({
    filePath,
    legacyDbService: options.legacyDbService || emptyLegacy,
    interactionExtractor: options.interactionExtractor,
    ...overrides,
  });
  return { directory, filePath, make, service: make() };
}

test('exposes every method in the remote relationship service contract', async (t) => {
  const { service } = await fixture(t);
  for (const method of PUBLIC_METHODS) assert.equal(typeof service[method], 'function', method);
});

test('persists and reloads local records atomically while keeping one backup', async (t) => {
  const { service, make, filePath } = await fixture(t);
  assert.equal(service.localFile, path.resolve(filePath));
  assert.equal((await service.healthcheck()).localFile, path.resolve(filePath));
  const person = await service.createPerson({
    name: '本地测试人物',
    identity: '测试身份',
    relationshipRoles: ['friend'],
    user_id: 'client-must-not-control-this',
    private_info: 'must-not-be-written',
    contact_info: 'must-not-be-written',
  });
  await service.saveCompass({
    title: '本地罗盘',
    outcomeStatement: '完成一个经真实交易验证的项目',
    successMetrics: ['真实付款'],
  });

  const reloaded = make();
  const people = await reloaded.listPeople();
  const compass = await reloaded.getCompass();
  assert.equal(people.some((item) => item.id === person.id), true);
  assert.equal(compass.title, '本地罗盘');
  assert.equal(compass.planning_state.nodes.length, 5);
  assert.equal(compass.planning_state.current_node_id, 'paid-need');

  const disk = JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
  const storedPerson = disk.tables.people_profiles.find((item) => item.id === person.id);
  assert.equal(storedPerson.user_id, DEFAULT_USER_ID);
  assert.equal('private_info' in storedPerson, false);
  assert.equal('contact_info' in storedPerson, false);
  assert.equal(await fs.promises.stat(`${filePath}.bak`).then(() => true), true);
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(`${filePath}.bak`, 'utf8')));
});

test('persists editable branches atomically, preserves them when omitted and respects an explicit empty tree', async (t) => {
  const { service, make } = await fixture(t);
  const created = await service.saveCompass({ title: '树测试' });
  const customState = {
    schema_version: 1,
    current_node_id: 'branch-a',
    nodes: [
      { id: 'root', parent_id: null, title: '主目标', status: 'in_progress' },
      { id: 'branch-a', parent_id: 'root', title: '支线A', status: 'in_progress', current_fact: '事实A' },
      { id: 'branch-b', parent_id: 'root', title: '支线B', status: 'planned' },
    ],
    overall_gaps: [],
    stage_gaps: {},
    daily_guidance: {
      focus: '验证支线A',
      why: '缺少证据',
      avoid: '不要扩张',
      observe: '是否出现真实承诺',
      generated_at: '2026-07-18T00:00:00.000Z',
      sources: [{ domain: 'goal', id: 'branch-a', label: '支线A' }],
      data_sources: [{ domain: 'goals', label: '目标与差距', count: 3, status: 'included' }],
      snapshot_hash: 'b'.repeat(64),
      based_on_compass_version: 1,
    },
  };
  const withBranches = await service.saveCompass({
    title: '树测试',
    planningState: customState,
    expectedVersion: created.version,
  });
  assert.equal(withBranches.planning_state.nodes.length, 3);

  const metadataOnly = await service.saveCompass({
    title: '只改标题',
    expectedVersion: withBranches.version,
  });
  assert.equal(metadataOnly.planning_state.nodes.length, 3);
  assert.equal(metadataOnly.planning_state.nodes[1].current_fact, '事实A');
  assert.equal(metadataOnly.planning_state.daily_guidance.snapshot_hash, 'b'.repeat(64));
  assert.equal(metadataOnly.planning_state.daily_guidance.data_sources[0].domain, 'goals');

  const emptied = await service.saveCompass({
    title: '空树',
    planningState: { current_node_id: null, nodes: [], overall_gaps: [], stage_gaps: {} },
    expectedVersion: metadataOnly.version,
  });
  assert.deepEqual(emptied.planning_state.nodes, []);
  assert.deepEqual((await make().getCompass()).planning_state.nodes, []);
});

test('merges legacy people and interactions through a strict public whitelist', async (t) => {
  const legacyDbService = {
    async getPeopleProfiles() {
      return [{
        id: 'legacy-person-1',
        name: '旧人物',
        identity: '旧身份',
        tags: ['旧资料'],
        category: 'friend',
        private_info: '绝不能暴露',
        contact_info: '绝不能暴露',
        ai_analysis: '旧画像推断绝不能暴露',
        reaction_library: [{ secret: true }],
        updated_at: '2026-07-01T00:00:00.000Z',
        created_at: '2026-01-01T00:00:00.000Z',
      }];
    },
    async getInteractionLogs(personId) {
      assert.equal(personId, 'legacy-person-1');
      return [{
        id: 'legacy-log-1',
        person_id: personId,
        event_date: '2026-07-02',
        event_context: '一次旧版互动',
        my_behavior: '我提出了一个问题',
        their_reaction: '对方给出回应',
        ai_analysis: '旧 AI 私密推断不得暴露',
        ai_review: '旧 AI 复盘不得暴露',
        created_at: '2026-07-02T01:00:00.000Z',
      }];
    },
  };
  const { service } = await fixture(t, { legacyDbService });
  const [person] = await service.listPeople();
  assert.equal(person.name, '旧人物');
  assert.equal('private_info' in person, false);
  assert.equal('contact_info' in person, false);
  assert.equal('ai_analysis' in person, false);
  assert.equal('reaction_library' in person, false);

  const workspace = await service.getPersonWorkspace(person.id);
  assert.equal('private_info' in workspace.person, false);
  assert.equal('contact_info' in workspace.person, false);
  assert.equal('ai_analysis' in workspace.person, false);
  assert.equal(workspace.interactions.length, 1);
  assert.equal(workspace.interactions[0].legacy_read_only, true);
  assert.equal('ai_analysis' in workspace.interactions[0], false);
  assert.equal('ai_review' in workspace.interactions[0], false);
});

test('AI failure creates only an editable proposal and confirm is idempotent across reloads', async (t) => {
  const { service, make } = await fixture(t, {
    async interactionExtractor() { throw new Error('simulated AI outage'); },
  });
  const person = await service.createPerson({ name: '互动对象', relationshipRoles: ['friend'] });
  const proposal = await service.createInteractionProposal(person.id, {
    content: '今天聊了合作，对方说需要再考虑。',
    occurredAt: new Date().toISOString(),
  });

  assert.equal(proposal.status, 'draft');
  assert.equal(proposal.payload.warnings.length, 1);
  assert.deepEqual(await service.listInteractions(person.id), []);
  assert.equal(proposal.payload.observed_facts.length, 0);
  assert.equal(proposal.payload.interpretations.length, 0);

  const first = await service.confirmInteraction(person.id, {
    proposalId: proposal.id,
    idempotencyKey: 'interaction-request-1',
  });
  assert.equal(first.duplicate, false);

  const second = await service.confirmInteraction(person.id, {
    proposalId: proposal.id,
    idempotencyKey: 'interaction-request-1',
  });
  assert.equal(second.duplicate, true);
  assert.equal(second.interaction.id, first.interaction.id);

  const reloaded = make();
  const third = await reloaded.confirmInteraction(person.id, {
    proposalId: proposal.id,
    idempotencyKey: 'interaction-request-1',
  });
  assert.equal(third.duplicate, true);
  assert.equal(third.interaction.id, first.interaction.id);
  assert.equal((await reloaded.listInteractions(person.id)).length, 1);
});

test('versioned updates reject stale writes with a route-compatible 409 error', async (t) => {
  const { service } = await fixture(t);
  const person = await service.createPerson({ name: '版本测试人物', relationshipRoles: ['mentor'] });
  const context = person.contexts[0];
  const updated = await service.updateContext(context.id, {
    currentGoal: '先完成一次清晰请求',
    expectedVersion: context.version,
  });
  assert.equal(updated.version, context.version + 1);

  await assert.rejects(
    service.updateContext(context.id, {
      currentGoal: '覆盖掉较新的修改',
      expectedVersion: context.version,
    }),
    (error) => {
      assert.equal(error instanceof RelationshipSystemError, true);
      assert.equal(error.code, 'VERSION_CONFLICT');
      assert.equal(error.statusCode, 409);
      assert.equal(error.details.currentVersion, updated.version);
      return true;
    }
  );
});

test('updating observeNext merges with the existing urgency metadata', async (t) => {
  const { service, make } = await fixture(t);
  const person = await service.createPerson({ name: '观察对象', relationshipRoles: ['friend'] });
  const context = person.contexts[0];
  const withUrgency = await service.updateContext(context.id, {
    urgency: {
      importance: 'high',
      review_after: '2026-08-01',
      source: 'weekly-review',
    },
    expectedVersion: context.version,
  });

  const updated = await service.updateContext(context.id, {
    observeNext: '观察对方是否愿意给出明确时间',
    expectedVersion: withUrgency.version,
  });

  assert.deepEqual(updated.urgency, {
    importance: 'high',
    review_after: '2026-08-01',
    source: 'weekly-review',
    observe_next: '观察对方是否愿意给出明确时间',
  });
  const [reloaded] = await make().listContexts(person.id);
  assert.deepEqual(reloaded.urgency, updated.urgency);
});

test('manual interactions preserve facts, feelings and interpretations and are idempotent across reloads', async (t) => {
  const { service, make } = await fixture(t);
  const person = await service.createPerson({ name: '手动记录对象', relationshipRoles: ['business'] });
  const input = {
    idempotencyKey: 'manual-interaction-1',
    draft: {
      occurred_at: '2026-07-18T09:00:00.000Z',
      summary: '讨论了一次小范围合作',
      observed_facts: ['对方询问了交付时间'],
      my_feelings: ['紧张', '期待'],
      interpretations: ['对方可能更在意时间可控性'],
    },
  };

  const first = await service.createManualInteraction(person.id, input);
  assert.equal(first.duplicate, false);
  assert.equal(first.interaction.source_type, 'manual');
  assert.deepEqual(first.interaction.observed_facts, input.draft.observed_facts);
  assert.deepEqual(first.interaction.my_feelings, input.draft.my_feelings);
  assert.deepEqual(first.interaction.interpretations, input.draft.interpretations);

  const duplicate = await service.createManualInteraction(person.id, input);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.interaction.id, first.interaction.id);

  const reloaded = make();
  const afterReload = await reloaded.createManualInteraction(person.id, input);
  assert.equal(afterReload.duplicate, true);
  assert.equal(afterReload.interaction.id, first.interaction.id);
  const interactions = await reloaded.listInteractions(person.id);
  assert.equal(interactions.length, 1);
  assert.deepEqual(interactions[0].observed_facts, input.draft.observed_facts);
  assert.deepEqual(interactions[0].my_feelings, input.draft.my_feelings);
  assert.deepEqual(interactions[0].interpretations, input.draft.interpretations);
});

test('weekly generation stays draft and confirmation alone deposits the confirmed self pattern', async (t) => {
  const { service, make } = await fixture(t, {
    async interactionExtractor(content) {
      return {
        summary: content,
        observed_facts: ['对方明确说需要书面方案'],
        my_actions: ['询问了下一步'],
        their_reactions: ['要求先看书面方案'],
        commitments: [],
        opportunity_signals: ['存在方案交付需求'],
        review: {},
      };
    },
  });
  const person = await service.createPerson({ name: '周复盘人物', relationshipRoles: ['business'] });
  const proposal = await service.createInteractionProposal(person.id, {
    content: '对方明确说需要书面方案。',
    occurredAt: new Date().toISOString(),
  });
  await service.confirmInteraction(person.id, {
    proposalId: proposal.id,
    idempotencyKey: 'weekly-interaction-1',
  });

  const draft = await service.generateWeeklyReview();
  assert.equal(draft.user_confirmed, false);
  assert.equal((await service.listGrowthPatterns()).length, 0);

  const confirmed = await service.confirmWeeklyReview(draft.id, {
    principle: '先确认对方愿意采取的下一步，再投入大量开发。',
    selfPattern: '容易在付款证据出现前进入开发。',
    nextPeopleActions: [{ person_id: person.id, title: '发送一页方案' }],
    expectedVersion: draft.version,
  });
  assert.equal(confirmed.user_confirmed, true);
  const patterns = await service.listGrowthPatterns();
  assert.equal(patterns.length, 1);
  assert.equal(patterns[0].source_weekly_review_id, draft.id);
  assert.equal(patterns[0].pattern_statement, '容易在付款证据出现前进入开发。');

  const reloaded = make();
  assert.equal((await reloaded.getCurrentWeeklyReview()).user_confirmed, true);
  assert.equal((await reloaded.listGrowthPatterns()).length, 1);
});

test('confirming a principle without a self pattern does not create a growth record', async (t) => {
  const { service } = await fixture(t);
  const review = await service.saveWeeklyReview({
    weekStart: '2026-01-05',
    summary: '历史周复盘',
    userConfirmed: false,
  });
  const confirmed = await service.confirmWeeklyReview(review.id, {
    principle: '先确认事实，再形成判断。',
    expectedVersion: review.version,
  });
  assert.equal(confirmed.user_confirmed, true);
  assert.equal(confirmed.principle, '先确认事实，再形成判断。');
  assert.deepEqual(await service.listGrowthPatterns(), []);
});
