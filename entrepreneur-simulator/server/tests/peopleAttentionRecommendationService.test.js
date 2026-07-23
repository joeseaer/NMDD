const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createRelationshipSystemLocalService } = require('../services/relationshipSystemLocalService');
const {
  createPeopleAttentionRecommendationService,
} = require('../services/peopleAttentionRecommendationService');

async function fixture(t, recommendationGenerator) {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'nmdd-people-attention-'));
  t.after(async () => fs.promises.rm(directory, { recursive: true, force: true }));
  const relationships = createRelationshipSystemLocalService({
    filePath: path.join(directory, 'relationships.json'),
    legacyDbService: {
      async getPeopleProfiles() { return []; },
      async getInteractionLogs() { return []; },
    },
  });
  const service = createPeopleAttentionRecommendationService({
    relationships,
    recommendationGenerator,
    nowProvider: () => new Date('2026-07-18T08:00:00.000Z'),
  });
  return { relationships, service };
}

async function createCandidate(relationships, name, role = 'friend') {
  const person = await relationships.createPerson({ name, relationshipRoles: [role] });
  await relationships.updateContext(person.contexts[0].id, {
    currentGoal: `确认与${name}的下一步`,
    currentState: '最近有新的互动窗口',
    expectedVersion: person.contexts[0].version,
  });
  return person;
}

test('AI drafts never change attention until accept, and accept does not trigger a new run for the same source snapshot', async (t) => {
  let generationCalls = 0;
  let candidateId;
  let candidateContextId;
  let alreadyFocusedId;
  let seenSnapshot;
  const { relationships, service } = await fixture(t, async (snapshot) => {
    generationCalls += 1;
    seenSnapshot = snapshot;
    return {
      recommendations: [
        {
          person_id: candidateId,
          reason: '最近有明确关系目标',
          why_now: '当前存在新的互动窗口',
          life_domains: ['朋友'],
          observe_next: '观察对方是否愿意给出明确回应',
          confidence: 'moderate',
          source_refs: [`context:${candidateContextId}`],
        },
        {
          person_id: alreadyFocusedId,
          reason: '不应出现',
          why_now: '不应出现',
          observe_next: '不应出现',
          source_refs: [`person:${alreadyFocusedId}`],
        },
      ],
    };
  });
  const candidate = await createCandidate(relationships, '朋友甲');
  candidateId = candidate.id;
  candidateContextId = candidate.contexts[0].id;
  const focused = await createCandidate(relationships, '导师乙', 'mentor');
  alreadyFocusedId = focused.id;
  await relationships.setPersonAttention(focused.id, {
    attentionState: 'focus',
    expectedVersion: (await relationships.listContexts(focused.id))[0].version,
  });

  const generated = await service.generateRecommendations();
  assert.equal(generationCalls, 1);
  assert.equal(generated.recommendations.length, 1);
  assert.equal(generated.recommendations[0].person_id, candidateId);
  assert.equal(generated.recommendations[0].payload.confidence, 'initial');
  assert.ok(seenSnapshot.source_catalog.some((item) => item.person_id === candidateId));
  assert.equal((await relationships.listContexts(candidateId))[0].attention_status, 'observe');

  const recommendation = generated.recommendations[0];
  const accepted = await relationships.decideAttentionRecommendation(recommendation.id, {
    decision: 'accept',
    expectedVersion: recommendation.version,
  });
  assert.equal(accepted.context.attention_status, 'focus');
  assert.equal(accepted.context.urgency.observe_next, '观察对方是否愿意给出明确回应');
  assert.equal(accepted.duplicate, false);
  const duplicate = await relationships.decideAttentionRecommendation(recommendation.id, {
    decision: 'accept',
    expectedVersion: recommendation.version,
  });
  assert.equal(duplicate.duplicate, true);

  const cached = await service.generateRecommendations({ refresh: false });
  assert.equal(cached.cached, true);
  assert.equal(cached.recommendations.length, 0);
  assert.equal(generationCalls, 1);
});

test('dismiss is idempotent, keeps the person in the library, and does not regenerate an empty draft list', async (t) => {
  let calls = 0;
  let personId;
  let contextId;
  const { relationships, service } = await fixture(t, async () => {
    calls += 1;
    return {
      recommendations: [{
        person_id: personId,
        reason: '存在关系目标',
        why_now: '资料近期更新',
        observe_next: '观察是否主动回应',
        source_refs: [`context:${contextId}`],
      }],
    };
  });
  const person = await createCandidate(relationships, '朋友丙');
  personId = person.id;
  contextId = person.contexts[0].id;
  const first = await service.generateRecommendations();
  const recommendation = first.recommendations[0];
  const dismissed = await relationships.decideAttentionRecommendation(recommendation.id, {
    decision: 'dismiss', expectedVersion: recommendation.version,
  });
  assert.equal(dismissed.recommendation.status, 'rejected');
  assert.equal(dismissed.context, null);
  assert.equal((await relationships.listContexts(personId))[0].attention_status, 'observe');
  assert.equal((await relationships.decideAttentionRecommendation(recommendation.id, { decision: 'dismiss' })).duplicate, true);

  const cached = await service.generateRecommendations();
  assert.equal(cached.cached, true);
  assert.equal(cached.recommendations.length, 0);
  assert.equal(calls, 1);

  const forcedRefresh = await service.generateRecommendations({ refresh: true });
  assert.equal(forcedRefresh.cached, false);
  assert.equal(forcedRefresh.recommendations.length, 0);
  assert.equal(calls, 2);

  const context = (await relationships.listContexts(personId))[0];
  await relationships.updateContext(context.id, {
    currentState: '出现了新的、不同的互动证据',
    expectedVersion: context.version,
  });
  const changedSnapshot = await service.generateRecommendations({ refresh: false });
  assert.equal(changedSnapshot.cached, false);
  assert.equal(changedSnapshot.recommendations.length, 1);
  assert.equal(calls, 3);
});

test('manual current attention supersedes every pending draft so it cannot reappear after moving back to the library', async (t) => {
  let personId;
  let contextId;
  const { relationships, service } = await fixture(t, async () => ({
    recommendations: [{
      person_id: personId,
      reason: '存在关系目标',
      why_now: '状态刚刚更新',
      observe_next: '观察是否愿意明确回应',
      source_refs: [`context:${contextId}`],
    }],
  }));
  const person = await createCandidate(relationships, '同事戊', 'colleague');
  personId = person.id;
  contextId = person.contexts[0].id;
  const generated = await service.generateRecommendations();
  assert.equal(generated.recommendations.length, 1);

  const before = (await relationships.listContexts(personId))[0];
  const focused = await relationships.setPersonAttention(personId, {
    attentionState: 'focus', expectedVersion: before.version,
  });
  const rejected = await relationships.listAttentionRecommendations({ status: 'rejected' });
  const superseded = rejected.find((item) => item.id === generated.recommendations[0].id);
  assert.equal(superseded.error.code, 'SUPERSEDED_BY_MANUAL');

  const focusedContext = focused.contexts.find((item) => item.is_primary) || focused.contexts[0];
  await relationships.setPersonAttention(personId, {
    attentionState: 'observe', expectedVersion: focusedContext.version,
  });
  assert.equal((await relationships.getPeopleOverview()).recommendations.length, 0);
});

test('a stale recommendation cannot overwrite a relationship that has moved to repair or boundary', async (t) => {
  const recommendationTargets = [];
  const { relationships, service } = await fixture(t, async () => ({
    recommendations: recommendationTargets.map(({ personId, contextId }) => ({
      person_id: personId,
      reason: '当时存在可推进的关系目标',
      why_now: '当时资料显示有新的互动窗口',
      observe_next: '观察对方是否愿意给出明确回应',
      source_refs: [`context:${contextId}`],
    })),
  }));
  for (const [name, state] of [['待修复关系', 'repair'], ['边界关系', 'boundary']]) {
    const person = await createCandidate(relationships, name);
    recommendationTargets.push({
      personId: person.id,
      contextId: person.contexts[0].id,
      state,
    });
  }

  const generated = await service.generateRecommendations();
  assert.equal(generated.recommendations.length, 2);

  for (const target of recommendationTargets) {
    const before = (await relationships.listContexts(target.personId))[0];
    await relationships.updateContext(before.id, {
      attentionStatus: target.state,
      expectedVersion: before.version,
    });
    const recommendation = generated.recommendations.find((item) => item.person_id === target.personId);
    await assert.rejects(
      relationships.decideAttentionRecommendation(recommendation.id, {
        decision: 'accept',
        expectedVersion: recommendation.version,
      }),
      (error) => {
        assert.equal(error.code, 'CONTEXT_STATE_CONFLICT');
        assert.equal(error.statusCode, 409);
        return true;
      }
    );
    assert.equal((await relationships.listContexts(target.personId))[0].attention_status, target.state);
  }
});

test('generation failure persists a transparent rule fallback instead of presenting it as AI', async (t) => {
  const { relationships, service } = await fixture(t, async () => {
    const error = new Error('quota exceeded');
    error.code = 'AI_QUOTA';
    throw error;
  });
  await createCandidate(relationships, '家人丁', 'family');
  const generated = await service.generateRecommendations();
  assert.equal(generated.recommendation_run.payload.status, 'fallback');
  assert.match(generated.recommendation_run.payload.warning, /AI 推荐暂不可用/);
  assert.equal(generated.recommendations.length, 1);
  assert.equal(generated.recommendations[0].payload.fallback, true);
  assert.deepEqual(generated.recommendations[0].payload.life_domains, ['家庭']);
  assert.ok(generated.recommendations[0].evidence_refs.length >= 1);
});

test('non-empty AI output with no valid concrete evidence becomes an AI_INVALID_OUTPUT fallback', async (t) => {
  let personId;
  const { relationships, service } = await fixture(t, async () => ({
    recommendations: [{
      person_id: personId,
      reason: '看似完整但没有有效依据',
      why_now: '现在',
      observe_next: '观察回应',
      source_refs: ['made-up:reference'],
    }],
  }));
  personId = (await createCandidate(relationships, '朋友己')).id;
  const generated = await service.generateRecommendations();
  assert.equal(generated.recommendation_run.payload.status, 'fallback');
  assert.match(generated.recommendation_run.payload.warning, /AI_INVALID_OUTPUT/);
  assert.equal(generated.recommendations[0].payload.fallback, true);
});
