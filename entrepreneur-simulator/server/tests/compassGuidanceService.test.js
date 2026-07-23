const test = require('node:test');
const assert = require('node:assert/strict');

const { createCompassGuidanceService } = require('../services/compassGuidanceService');
const { cloneDefaultPlanningState } = require('../services/relationshipPlanningState');

function fixture(overrides = {}) {
  let taskTitle = '联系第一位客户';
  let aiCalls = 0;
  let saveCalls = 0;
  let lastSaveInput = null;
  const initialState = overrides.initialPlanningState || cloneDefaultPlanningState();
  initialState.nodes[0].next_validation = '完成一次真实客户访谈';
  let compassRecord = {
    id: 'compass-1',
    version: 1,
    title: '罗盘',
    horizon_date: '2027-07-18',
    outcome_statement: '建立自己的事业',
    success_metrics: ['真实付款'],
    current_assets: ['技术能力'],
    current_constraints: ['博士任务'],
    ninety_day_bet: '验证付费需求',
    non_negotiables: ['不牺牲生存安全'],
    planning_state: initialState,
  };
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const relationshipService = {
    async getCompass() { return copy(compassRecord); },
    async saveCompass(input) {
      saveCalls += 1;
      lastSaveInput = copy(input);
      if (overrides.conflictOnSave) {
        compassRecord = { ...compassRecord, version: compassRecord.version + 1, title: '并发更新后的罗盘' };
        const error = new Error('stale compass');
        error.code = 'VERSION_CONFLICT';
        error.statusCode = 409;
        error.details = { currentVersion: compassRecord.version };
        throw error;
      }
      assert.equal(input.expectedVersion, compassRecord.version);
      compassRecord = {
        ...compassRecord,
        version: compassRecord.version + 1,
        title: input.title,
        horizon_date: input.horizonDate,
        outcome_statement: input.outcomeStatement,
        success_metrics: input.successMetrics,
        current_assets: input.currentAssets,
        current_constraints: input.currentConstraints,
        ninety_day_bet: input.ninetyDayBet,
        non_negotiables: input.nonNegotiables,
        planning_state: input.planningState,
      };
      return copy(compassRecord);
    },
    async listPeople() {
      return [{
        id: 'person-1', name: '客户甲', contexts: [{ attention_status: 'focus', current_goal: '验证需求', is_primary: true }],
        last_interaction: { occurred_at: '2026-07-17T00:00:00.000Z', summary: '愿意继续聊' },
      }];
    },
    async getPersonWorkspace() {
      return {
        person: { id: 'person-1' },
        interactions: [{ id: 'interaction-1', occurred_at: '2026-07-17T00:00:00.000Z', summary: '讨论需求' }],
        claims: [], decisions: [],
      };
    },
    async listOpportunities() {
      return [{ id: 'opportunity-1', title: '手工服务', problem_statement: '客户缺少工具', status: 'active' }];
    },
    async getOpportunity() {
      return { opportunity: { id: 'opportunity-1', title: '手工服务', problem_statement: '客户缺少工具' }, experiments: [] };
    },
    async listWeeklyReviews() { return [{ id: 'weekly-1', week_start: '2026-07-13', summary: '要更早验证' }]; },
    async listGrowthPatterns() { return [{ id: 'growth-1', pattern_statement: '容易先开发' }]; },
    ...overrides.relationshipService,
  };
  const database = {
    async listPlannerItems(input) {
      return input.type === 'task'
        ? [{ id: 'task-1', title: taskTitle, due_at: '2026-07-18T10:00:00.000Z' }]
        : [{ id: 'event-1', title: '博士组会', start_at: '2026-07-18T08:00:00.000Z' }];
    },
    async getReviewSessions() { return [{ id: 'review-1', title: '冲突复盘', result: '先确认事实' }]; },
    ...overrides.dbService,
  };
  const documents = {
    async buildDecisionDocumentContext(input) {
      assert.equal(input.domain, 'life');
      return {
        corpus: { domain: 'life', document_count: 1 },
        references: [{ ref_id: 'D1', title: '经营原则', snippet: '先验证，再投入' }],
        promptText: '[D1] 先验证，再投入',
      };
    },
    ...overrides.documentContextService,
  };
  const aiClient = overrides.aiClient === undefined ? {
    chat: { completions: { async create() {
      aiCalls += 1;
      if (overrides.aiDelayMs) await new Promise((resolve) => setTimeout(resolve, overrides.aiDelayMs));
      return { choices: [{ message: { content: JSON.stringify({
        focus: '完成一次真实客户访谈',
        why: '当前最缺付费问题证据',
        avoid: '不要继续扩大开发',
        observe: '对方是否愿意投入时间或接受报价',
        source_refs: ['goal:paid-need', 'task:task-1', 'document:D1'],
      }) } }] };
    } } },
  } : overrides.aiClient;
  const createService = (serviceOverrides = {}) => createCompassGuidanceService({
    relationshipService,
    dbService: database,
    documentContextService: documents,
    aiClient: Object.prototype.hasOwnProperty.call(serviceOverrides, 'aiClient') ? serviceOverrides.aiClient : aiClient,
    now: () => new Date('2026-07-18T04:00:00.000Z'),
  });
  const service = createService();
  return {
    service,
    createService,
    relationshipService,
    getAiCalls: () => aiCalls,
    getSaveCalls: () => saveCalls,
    getLastSaveInput: () => lastSaveInput,
    getCompassRecord: () => copy(compassRecord),
    setTaskTitle(value) { taskTitle = value; },
  };
}

test('aggregates every life source, persists with a full versioned compass and invalidates cache when data changes', async () => {
  const { service, getAiCalls, getSaveCalls, getLastSaveInput, setTaskTitle } = fixture();
  const first = await service.generateDailyGuidance();
  assert.equal(first.available, true);
  assert.equal(first.persisted, true);
  assert.equal(first.stale, false);
  assert.equal(first.based_on_compass_version, 1);
  assert.equal(first.compass_version, 2);
  assert.equal(first.guidance.fallback, false);
  assert.match(first.guidance.snapshot_hash, /^[a-f0-9]{64}$/);
  assert.equal(first.guidance.data_sources.length, 7);
  assert.deepEqual(first.guidance.sources.map((source) => source.domain), ['goal', 'planner', 'life_documents']);
  for (const domain of ['goals', 'planner', 'people', 'interactions', 'opportunities', 'reviews', 'life_documents']) {
    assert.equal(first.source_status[domain].available, true, domain);
  }
  assert.equal('snapshot' in first, false);
  assert.equal(getAiCalls(), 1);
  assert.equal(getSaveCalls(), 1);
  assert.deepEqual(Object.keys(getLastSaveInput()).sort(), [
    'currentAssets', 'currentConstraints', 'expectedVersion', 'horizonDate', 'ninetyDayBet',
    'nonNegotiables', 'outcomeStatement', 'planningState', 'successMetrics', 'title',
  ].sort());

  const cached = await service.generateDailyGuidance();
  assert.equal(cached.cached, true);
  assert.equal(getAiCalls(), 1);

  setTaskTitle('发送具体报价');
  const changed = await service.generateDailyGuidance();
  assert.equal(changed.cached, false);
  assert.equal(getAiCalls(), 2);
  assert.equal(getSaveCalls(), 2);
});

test('returns a transparent dynamic fallback when AI or a source is unavailable', async () => {
  const { service } = fixture({
    aiClient: null,
    documentContextService: {
      async buildDecisionDocumentContext() { throw new Error('document store unavailable'); },
    },
  });
  const result = await service.generateDailyGuidance();
  assert.equal(result.available, false);
  assert.equal(result.guidance.fallback, true);
  assert.equal(result.guidance.focus, '完成一次真实客户访谈');
  assert.equal(result.persisted, true);
  assert.equal(result.source_status.life_documents.available, false);
  assert.match(result.warning, /数据源|LLM/);
  assert.equal('snapshot' in result, false);
});

test('deduplicates concurrent generation and persistence for the same snapshot', async () => {
  const { service, getAiCalls, getSaveCalls } = fixture({ aiDelayMs: 30 });
  const [first, second] = await Promise.all([
    service.generateDailyGuidance({ refresh: true }),
    service.generateDailyGuidance({ refresh: true }),
  ]);
  assert.equal(getAiCalls(), 1);
  assert.equal(getSaveCalls(), 1);
  assert.equal(first.compass_version, 2);
  assert.equal(second.compass_version, 2);
  assert.equal(second.cached, true);
});

test('does not overwrite a newer compass when CAS detects a concurrent edit', async () => {
  const { service, getLastSaveInput, getCompassRecord } = fixture({ conflictOnSave: true });
  const result = await service.generateDailyGuidance({ refresh: true });
  assert.equal(result.persisted, false);
  assert.equal(result.stale, true);
  assert.equal(result.based_on_compass_version, 1);
  assert.equal(result.compass_version, 2);
  assert.equal(getLastSaveInput().expectedVersion, 1);
  assert.equal(getCompassRecord().planning_state.daily_guidance, null);
  assert.match(result.warning, /未覆盖|发生变化/);
});

test('a new service instance reuses persisted guidance with the same snapshot hash without calling AI', async () => {
  const { service, createService, getAiCalls } = fixture();
  const generated = await service.generateDailyGuidance({ refresh: true });
  assert.equal(generated.persisted, true);
  let restartedAiCalls = 0;
  const restarted = createService({
    aiClient: { chat: { completions: { async create() { restartedAiCalls += 1; throw new Error('must not run'); } } } },
  });
  const restored = await restarted.generateDailyGuidance();
  assert.equal(restored.cached, true);
  assert.equal(restored.persisted, true);
  assert.equal(restored.stale, false);
  assert.equal(restored.compass_version, 2);
  assert.equal(restored.guidance.snapshot_hash, generated.guidance.snapshot_hash);
  assert.equal(restartedAiCalls, 0);
  assert.equal(getAiCalls(), 1);
});

test('keeps the current goal in a truncated compact snapshot and reports the true goal count', async () => {
  const nodes = [{ id: 'root', parent_id: null, sort_order: 0, title: '根目标', status: 'planned' }];
  for (let index = 1; index < 300; index += 1) {
    nodes.push({ id: `n${index}`, parent_id: 'root', sort_order: index, title: `目标${index}`, status: 'planned' });
  }
  const currentId = 'n299';
  const { service } = fixture({
    initialPlanningState: {
      schema_version: 1,
      current_node_id: currentId,
      nodes,
      overall_gaps: [],
      stage_gaps: {},
      daily_guidance: null,
    },
  });
  const built = await service.buildDecisionSnapshot();
  assert.equal(built.sourceStatus.goals.count, 300);
  assert.equal(built.sourceStatus.goals.truncated, true);
  assert.equal(built.snapshot.compass.planning_state.nodes.length, 250);
  assert.equal(built.snapshot.compass.planning_state.nodes.some((node) => node.id === currentId), true);
  assert.deepEqual(built.snapshot.truncation.goals, { total: 300, included: 250 });
});
