const test = require('node:test');
const assert = require('node:assert/strict');
const Fastify = require('fastify');
const relationshipSystemRoutes = require('../routes/relationshipSystem');
const { RelationshipSystemError } = require('../services/relationshipSystemService');

async function buildApp(service, guidanceService, attentionRecommendationService) {
  const app = Fastify({ logger: false });
  await app.register(relationshipSystemRoutes, {
    prefix: '/api/relationship-system',
    service,
    guidanceService,
    attentionRecommendationService,
  });
  await app.ready();
  return app;
}

test('people overview exposes evidence, attention layers and a persisted recommendation run', async (t) => {
  const service = {
    async getPeopleOverview() {
      const context = {
        id: 'context-1', context_type: 'friend', label: '朋友', is_primary: true,
        attention_status: 'observe', current_goal: '加深了解', current_state: '近期重新联系',
        why_matters_now: '有新的互动窗口', urgency: {}, version: 3,
      };
      const person = { id: 'person-1', name: '朋友甲', contexts: [context], last_interaction: null };
      return {
        generated_at: '2026-07-18T08:00:00.000Z',
        recommendations: [{
          id: 'recommendation-1', person_id: person.id, status: 'draft', version: 1,
          payload: {
            reason: '值得确认关系状态', why_now: '近期重新联系', life_domains: ['朋友'],
            observe_next: '观察是否愿意持续回应', confidence: 'moderate', fallback: false,
          },
          evidence_refs: [{ ref: 'person:person-1', type: 'person', label: '朋友甲', summary: '关系库人物' }],
          created_at: '2026-07-18T08:00:00.000Z', person,
        }],
        attention_people: [], library_people: [person],
        recommendation_run: {
          id: 'run-1', created_at: '2026-07-18T08:00:00.000Z', model: 'test-model', prompt_version: 'v1',
          input_snapshot: { snapshot_hash: 'abc', source_status: { people: { available: true, count: 1 } } },
          payload: { status: 'ai', recommendation_count: 1, warning: null },
        },
        counts: { tracked_people: 1, current_attention: 0, relationship_library: 1, pending_recommendations: 1 },
      };
    },
  };
  const app = await buildApp(service);
  t.after(() => app.close());
  const response = await app.inject({ method: 'GET', url: '/api/relationship-system/people/overview?userId=attacker' });
  assert.equal(response.statusCode, 200);
  const overview = response.json().data;
  assert.equal(overview.counts.relationshipLibrary, 1);
  assert.equal(overview.recommendations[0].evidenceRefs[0].ref, 'person:person-1');
  assert.equal(overview.libraryPeople[0].attentionLayer, 'library');
  assert.equal(overview.libraryPeople[0].relationshipMode, 'observe');
  assert.equal(overview.libraryPeople[0].observeNext, null);
  assert.equal(overview.libraryPeople[0].currentAttention, false);
  assert.equal(overview.recommendationRun.snapshotHash, 'abc');
});

test('attention generation, decision and manual patch never accept a client user identity', async (t) => {
  const calls = [];
  const person = {
    id: 'person-1', name: '朋友甲',
    contexts: [{ id: 'context-1', is_primary: true, attention_status: 'focus', urgency: { observe_next: '观察回应' }, version: 2 }],
  };
  const emptyOverview = {
    generated_at: '2026-07-18T08:00:00.000Z', recommendations: [], attention_people: [person], library_people: [],
    recommendation_run: null,
    counts: { tracked_people: 1, current_attention: 1, relationship_library: 0, pending_recommendations: 0 },
  };
  const service = {
    async decideAttentionRecommendation(id, input) {
      calls.push({ operation: 'decision', id, input });
      return {
        recommendation: { id, person_id: person.id, status: 'confirmed', payload: {}, evidence_refs: [], version: 2 },
        context: person.contexts[0], duplicate: false,
      };
    },
    async listPeople() { return [person]; },
    async setPersonAttention(id, input) {
      calls.push({ operation: 'manual', id, input });
      return person;
    },
  };
  const attentionRecommendationService = {
    async generateRecommendations(input) {
      calls.push({ operation: 'generate', input });
      return { ...emptyOverview, cached: false };
    },
  };
  const app = await buildApp(service, undefined, attentionRecommendationService);
  t.after(() => app.close());

  const generated = await app.inject({
    method: 'POST', url: '/api/relationship-system/people/attention-recommendations/generate',
    payload: { refresh: true, userId: 'attacker' },
  });
  assert.equal(generated.statusCode, 200);
  assert.deepEqual(calls[0], { operation: 'generate', input: { refresh: true } });

  const decided = await app.inject({
    method: 'POST', url: '/api/relationship-system/people/attention-recommendations/recommendation-1/decision',
    payload: { decision: 'accept', reason: '我确认关注', observeNext: '观察回应', expectedVersion: 1, userId: 'attacker' },
  });
  assert.equal(decided.statusCode, 200);
  assert.deepEqual(calls[1].input, {
    decision: 'accept', reason: '我确认关注', observeNext: '观察回应', expectedVersion: 1,
  });

  const patched = await app.inject({
    method: 'PATCH', url: '/api/relationship-system/people/person-1/attention',
    payload: { attentionState: 'observe', contextId: 'context-1', expectedVersion: 2, userId: 'attacker' },
  });
  assert.equal(patched.statusCode, 200);
  assert.deepEqual(calls[2].input, { attentionState: 'observe', contextId: 'context-1', expectedVersion: 2 });
});

test('daily guidance route delegates refresh without accepting a client user identity', async (t) => {
  const calls = [];
  const guidanceService = {
    async generateDailyGuidance(input) {
      calls.push(input);
      return {
        available: true,
        cached: false,
        generated_at: '2026-07-18T00:00:00.000Z',
        guidance: {
          focus: '验证需求', why: '缺少证据', avoid: '不要扩开发', observe: '是否付费',
          generated_at: '2026-07-18T00:00:00.000Z', sources: [], fallback: false,
        },
        source_status: {},
      };
    },
  };
  const app = await buildApp({}, guidanceService);
  t.after(() => app.close());
  const response = await app.inject({
    method: 'POST',
    url: '/api/relationship-system/compass/daily-guidance',
    payload: { refresh: true, userId: 'attacker' },
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(calls, [{ refresh: true }]);
  assert.equal(response.json().data.guidance.focus, '验证需求');
  assert.equal('snapshot' in response.json().data, false);
});

test('people route ignores client userId and maps the stable client contract', async (t) => {
  const calls = [];
  const service = {
    async listPeople(input) {
      calls.push(input);
      return [{
        id: 'person-1',
        name: 'Test Person',
        contexts: [{ context_type: 'mentor', attention_status: 'focus', why_matters_now: 'Learn' }],
        last_interaction: { occurred_at: '2026-07-15T10:00:00.000Z', summary: 'Talked' },
      }];
    },
  };
  const app = await buildApp(service);
  t.after(() => app.close());

  const response = await app.inject({
    method: 'GET',
    url: '/api/relationship-system/people?userId=attacker&q=Test&attentionState=focus',
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(calls, [{ search: 'Test', attentionStatus: 'focus', limit: undefined }]);
  const person = response.json().data[0];
  assert.equal(person.attentionState, 'focus');
  assert.equal(person.lastInteractionSummary, 'Talked');
});

test('interaction extract accepts rawText and returns a reviewable proposal', async (t) => {
  let received;
  const service = {
    async createInteractionProposal(personId, input) {
      received = { personId, input };
      return {
        id: 'proposal-1',
        person_id: personId,
        payload: {
          occurred_at: '2026-07-15T11:00:00.000Z',
          summary: 'Summary',
          observed_facts: ['Fact'],
          my_actions: ['Asked'],
          their_reactions: ['Answered'],
          my_feelings: [],
          opportunity_signals: ['Pain point'],
        },
      };
    },
  };
  const app = await buildApp(service);
  t.after(() => app.close());

  const response = await app.inject({
    method: 'POST',
    url: '/api/relationship-system/interactions/extract',
    payload: { userId: 'attacker', personId: 'person-1', rawText: 'Raw interaction' },
  });
  assert.equal(response.statusCode, 201);
  assert.equal(received.personId, 'person-1');
  assert.equal(received.input.content, 'Raw interaction');
  assert.equal(Object.prototype.hasOwnProperty.call(received.input, 'userId'), false);
  assert.equal(response.json().data.proposal.observedFacts[0], 'Fact');
});

test('interaction confirm maps clientRequestId to the service idempotency key', async (t) => {
  let received;
  const service = {
    async confirmInteraction(personId, input) {
      received = { personId, input };
      return {
        duplicate: false,
        interaction: {
          id: 'interaction-1',
          person_id: personId,
          occurred_at: '2026-07-15T12:00:00.000Z',
          summary: input.draft.summary,
          observed_facts: input.draft.observed_facts,
          my_actions: [],
          their_reactions: [],
          my_feelings: [],
          interpretations: [],
          opportunity_signals: [],
        },
      };
    },
  };
  const app = await buildApp(service);
  t.after(() => app.close());

  const response = await app.inject({
    method: 'POST',
    url: '/api/relationship-system/interactions/confirm',
    payload: {
      userId: 'attacker',
      personId: 'person-1',
      proposalId: 'proposal-1',
      clientRequestId: 'request-1',
      patch: { eventContext: 'Confirmed summary', observedFacts: ['Observed'] },
    },
  });
  assert.equal(response.statusCode, 201);
  assert.equal(received.input.idempotencyKey, 'request-1');
  assert.equal(received.input.draft.summary, 'Confirmed summary');
  assert.deepEqual(received.input.draft.observed_facts, ['Observed']);
  assert.equal(Object.prototype.hasOwnProperty.call(received.input.draft, 'my_actions'), false);
  assert.equal(response.json().data.interaction.eventContext, 'Confirmed summary');
});

test('migration errors use a stable 503/MIGRATION_REQUIRED response', async (t) => {
  const service = {
    async healthcheck() {
      throw new RelationshipSystemError(
        'MIGRATION_REQUIRED',
        'Relationship system database migration has not been applied.',
        503,
        { migration: '20260715_add_relationship_system.sql' }
      );
    },
  };
  const app = await buildApp(service);
  t.after(() => app.close());
  const response = await app.inject({ method: 'GET', url: '/api/relationship-system/health' });
  assert.equal(response.statusCode, 503);
  assert.equal(response.json().error, 'MIGRATION_REQUIRED');
  assert.equal(response.json().details.migration, '20260715_add_relationship_system.sql');
});

test('weekly current/generate/confirm routes preserve draft then explicit confirmation', async (t) => {
  const calls = [];
  const draft = {
    id: 'review-1',
    week_start: '2026-07-13',
    important_changes: ['Changed'],
    open_commitments: [],
    user_confirmed: false,
    version: 1,
  };
  const service = {
    async getCurrentWeeklyReview() { calls.push('current'); return null; },
    async generateWeeklyReview() { calls.push('generate'); return draft; },
    async confirmWeeklyReview(id, input) { calls.push({ id, input }); return { ...draft, user_confirmed: true, version: 2 }; },
  };
  const app = await buildApp(service);
  t.after(() => app.close());

  const current = await app.inject({ method: 'GET', url: '/api/relationship-system/weekly-reviews/current' });
  assert.equal(current.statusCode, 200);
  assert.equal(current.json().data, null);
  const generated = await app.inject({ method: 'POST', url: '/api/relationship-system/weekly-reviews/generate', payload: { userId: 'attacker' } });
  assert.equal(generated.statusCode, 201);
  assert.equal(generated.json().data.user_confirmed, false);
  assert.equal(generated.json().data.status, 'draft');
  assert.equal(generated.json().data.weekEnd, '2026-07-19');
  const confirmed = await app.inject({ method: 'POST', url: '/api/relationship-system/weekly-reviews/review-1/confirm', payload: { expectedVersion: 1 } });
  assert.equal(confirmed.statusCode, 200);
  assert.equal(confirmed.json().data.review.user_confirmed, true);
  assert.equal(confirmed.json().data.review.status, 'completed');
  assert.deepEqual(calls, ['current', 'generate', { id: 'review-1', input: { expectedVersion: 1 } }]);
});

test('workspace uses the primary context observation and only exposes user-confirmed supported claims as interaction guides', async (t) => {
  const service = {
    async getPersonWorkspace() {
      return {
        person: { id: 'person-1', name: 'Test Person' },
        contexts: [{
          id: 'context-1',
          person_id: 'person-1',
          is_primary: true,
          urgency: { observe_next: '观察对方是否接受简洁且明确的请求' },
        }],
        interactions: [],
        decisions: [],
        claims: [
          {
            id: 'claim-supported-confirmed',
            person_id: 'person-1',
            statement: 'Prefers concise requests',
            status: 'supported',
            confidence_level: 'behavior_supported',
            user_confirmed: true,
            evidence: [
              { id: 'e-1', evidence_type: 'supports', content: 'Responded quickly', interaction_id: 'i-1' },
              { id: 'e-2', evidence_type: 'contradicts', content: 'Asked for more detail' },
            ],
          },
          {
            id: 'claim-supported-unconfirmed',
            person_id: 'person-1',
            statement: 'May prefer a written agenda',
            status: 'supported',
            confidence_level: 'behavior_supported',
            user_confirmed: false,
            evidence: [],
          },
          {
            id: 'claim-direct-report',
            person_id: 'person-1',
            statement: 'Says they prefer voice messages',
            status: 'testing',
            confidence_level: 'direct_report',
            user_confirmed: true,
            evidence: [],
          },
          {
            id: 'claim-contradicted',
            person_id: 'person-1',
            statement: 'Always replies immediately',
            status: 'contradicted',
            confidence_level: 'repeated',
            user_confirmed: true,
            evidence: [],
          },
          {
            id: 'claim-retired',
            person_id: 'person-1',
            statement: 'Old interaction preference',
            status: 'retired',
            confidence_level: 'behavior_supported',
            user_confirmed: true,
            evidence: [],
          },
        ],
      };
    },
  };
  const app = await buildApp(service);
  t.after(() => app.close());

  const response = await app.inject({
    method: 'GET',
    url: '/api/relationship-system/people/person-1/workspace',
  });
  assert.equal(response.statusCode, 200);
  const workspace = response.json().data;
  assert.deepEqual(workspace.interactionGuide.map((claim) => claim.id), ['claim-supported-confirmed']);
  assert.deepEqual(workspace.hypotheses.map((claim) => claim.id).sort(), [
    'claim-direct-report',
    'claim-supported-unconfirmed',
  ]);
  assert.deepEqual(workspace.inactiveClaims.map((claim) => claim.id).sort(), [
    'claim-contradicted',
    'claim-retired',
  ]);
  const evidence = workspace.interactionGuide[0].evidence;
  assert.equal(evidence[0].direction, 'support');
  assert.equal(evidence[0].sourceType, 'interaction');
  assert.equal(evidence[1].direction, 'counter');
  assert.equal(evidence[1].sourceType, 'manual');
  assert.equal(workspace.brief.observeNext, '观察对方是否接受简洁且明确的请求');
});

test('decision routes map nested expected signals and return the full decision after outcome', async (t) => {
  const calls = [];
  const service = {
    async createDecision(personId, input) {
      calls.push({ operation: 'create', personId, input });
      return { id: 'decision-1', person_id: personId, goal: input.goal, status: 'chosen', feedback_signals: input.feedbackSignals };
    },
    async saveDecisionOutcome(id, input) {
      calls.push({ operation: 'outcome', id, input });
      const outcome = { id: 'outcome-1', actual_response: input.actualResponse, expected_match: input.expectedMatch };
      return {
        decision: { id, person_id: 'person-1', goal: 'Ask for help', status: 'completed', outcome },
        outcome,
      };
    },
  };
  const app = await buildApp(service);
  t.after(() => app.close());

  const created = await app.inject({
    method: 'POST',
    url: '/api/relationship-system/decisions',
    payload: {
      personId: 'person-1',
      goal: 'Ask for help',
      chosenAction: 'Send a concise request',
      expectedSignals: { positive: ['Agrees'], neutral: ['Asks later'], negative: ['Declines'] },
    },
  });
  assert.equal(created.statusCode, 201);
  assert.deepEqual(calls[0].input.feedbackSignals, ['Agrees', 'Asks later', 'Declines']);

  const completed = await app.inject({
    method: 'POST',
    url: '/api/relationship-system/decisions/decision-1/outcome',
    payload: { actualResponse: 'They agreed', matchedExpectation: true, learning: 'Clear requests work' },
  });
  assert.equal(completed.statusCode, 201);
  assert.equal(completed.json().data.decision.id, 'decision-1');
  assert.equal(completed.json().data.decision.status, 'reviewed');
  assert.equal(completed.json().data.decision.outcome.actualResponse, 'They agreed');
});

test('opportunity patch unwraps client patch and experiment outcome maps cents safely', async (t) => {
  const calls = [];
  const service = {
    async updateOpportunity(id, input) {
      calls.push({ operation: 'opportunity', id, input });
      return { id, title: 'Opportunity', problem_statement: input.problemStatement, stage: input.stage, version: 3 };
    },
    async updateExperiment(id, input) {
      calls.push({ operation: 'experiment', id, input });
      return {
        id,
        opportunity_id: 'opportunity-1',
        hypothesis: 'Will pay',
        method: 'Quote',
        success_criteria: 'Payment',
        status: input.status,
        result: input.result,
        revenue_amount: input.revenueAmount,
        currency: input.currency,
      };
    },
  };
  const app = await buildApp(service);
  t.after(() => app.close());

  const patched = await app.inject({
    method: 'PATCH',
    url: '/api/relationship-system/opportunities/opportunity-1',
    payload: { patch: { problem: 'Expensive manual work', stage: 'paid_validation', version: 2 }, expectedVersion: 2 },
  });
  assert.equal(patched.statusCode, 200);
  assert.equal(calls[0].input.problemStatement, 'Expensive manual work');
  assert.equal(calls[0].input.stage, 'paid_test');
  assert.equal(calls[0].input.expectedVersion, 2);

  const outcome = await app.inject({
    method: 'POST',
    url: '/api/relationship-system/experiments/experiment-1/outcome',
    payload: { result: 'Paid', evidence: 'Receipt', amountCents: 12345, currency: 'CNY', nextDecision: 'continue' },
  });
  assert.equal(outcome.statusCode, 200);
  assert.equal(calls[1].input.revenueAmount, 123.45);
  assert.equal(calls[1].input.nextStep, 'continue');
  assert.equal(outcome.json().data.experiment.amountCents, 12345);
});

test('weekly confirmation maps reflection fields for persistence and growth', async (t) => {
  let received;
  const service = {
    async confirmWeeklyReview(id, input) {
      received = { id, input };
      return {
        id,
        week_start: '2026-07-13',
        principle: input.principle,
        self_pattern: input.selfPattern,
        next_people_actions: input.nextPeopleActions,
        next_opportunity_experiment: input.nextOpportunityExperiment,
        user_confirmed: true,
      };
    },
  };
  const app = await buildApp(service);
  t.after(() => app.close());
  const response = await app.inject({
    method: 'POST',
    url: '/api/relationship-system/weekly-reviews/review-1/confirm',
    payload: {
      principle: 'Ask clearly and leave room to decline',
      selfBlindSpot: 'Avoiding direct requests',
      relationshipActions: [{ title: 'Send request' }],
      opportunityExperiment: 'Test a paid manual service',
    },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(received.input.selfPattern, 'Avoiding direct requests');
  assert.deepEqual(received.input.nextPeopleActions, [{ title: 'Send request' }]);
  assert.deepEqual(received.input.nextOpportunityExperiment, { title: 'Test a paid manual service' });
  assert.equal(response.json().data.review.principle, 'Ask clearly and leave room to decline');
});

test('growth separates confirmed weekly principles from self-pattern candidates', async (t) => {
  const service = {
    async listGrowthPatterns() {
      return [{
        id: 'pattern-1',
        title: 'Overbuilds early',
        pattern_statement: 'I start building before payment evidence.',
        evidence_refs: [{ weekly_review_id: 'review-1' }],
        counterexamples: [],
        status: 'hypothesis',
        training_action: 'Ask for a paid test first',
      }];
    },
    async listWeeklyReviews() {
      return [{ id: 'review-1', week_start: '2026-07-13', principle: 'Ask clearly, then observe behavior.', user_confirmed: true }];
    },
    async listPeople() { return []; },
  };
  const app = await buildApp(service);
  t.after(() => app.close());

  const response = await app.inject({ method: 'GET', url: '/api/relationship-system/growth' });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().data.principles[0].statement, 'Ask clearly, then observe behavior.');
  assert.equal(response.json().data.principles[0].status, 'candidate');
  assert.equal(response.json().data.patterns[0].statement, 'I start building before payment evidence.');
  assert.equal(response.json().data.patterns[0].trainingAction, 'Ask for a paid test first');
});
