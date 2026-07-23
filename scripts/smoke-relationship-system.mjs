#!/usr/bin/env node

import assert from 'node:assert/strict';
import process from 'node:process';

const baseUrl = String(process.argv[2] || 'http://127.0.0.1:3001/api/relationship-system').replace(/\/$/, '');

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`${options.method || 'GET'} ${path} failed (${response.status}): ${JSON.stringify(payload)}`);
  }
  return payload.data;
}

const json = (value) => JSON.stringify(value);

async function main() {
  const health = await request('/health');
  assert.equal(health.storageMode, 'local');

  const created = await request('/people', {
    method: 'POST',
    body: json({
      name: '端到端联调人物',
      identity: '潜在合作方',
      relationshipRoles: ['business'],
      focusReason: '验证完整关系闭环',
      attentionState: 'focus',
      userId: 'client-cannot-control-owner',
    }),
  });
  const person = created.person;
  assert.ok(person.id);
  assert.equal(Object.hasOwn(person, 'private_info'), false);

  let workspace = await request(`/people/${person.id}/workspace`);
  const context = workspace.contexts.find((item) => item.is_primary) || workspace.contexts[0];
  assert.ok(context.id);
  await request(`/contexts/${context.id}`, {
    method: 'PATCH',
    body: json({
      attentionStatus: 'focus',
      whyMattersNow: '有清晰的合作验证价值',
      currentState: '正在建立最小合作信任',
      currentGoal: '完成一次小范围付费试验',
      mutualValue: '我提供技术验证，对方提供真实问题与反馈',
      boundaries: ['不在付款证据出现前投入大量开发'],
      expectedVersion: context.version,
    }),
  });

  const clientRequestId = `smoke-${Date.now()}`;
  const extracted = await request('/interactions/extract', {
    method: 'POST',
    body: json({
      personId: person.id,
      text: '我提出先做一次小范围付费试验。对方询问了价格和交付时间，我答应周五发送一页方案。',
      occurredAt: new Date().toISOString(),
      clientRequestId,
    }),
  });
  assert.ok(extracted.proposal.id);
  assert.equal(Array.isArray(extracted.warnings), true);

  const confirmBody = {
    personId: person.id,
    proposalId: extracted.proposal.id,
    clientRequestId,
    patch: {
      eventContext: '讨论最小付费试验',
      observedFacts: ['对方询问价格和交付时间'],
      myActions: ['提出小范围付费试验'],
      theirReactions: ['询问价格和交付时间'],
      myFeelings: ['认为存在初步兴趣，但仍需付款验证'],
      commitments: [{ owner: 'me', title: '周五发送一页方案', status: 'open' }],
      opportunitySignals: [{ summary: '对方主动询问价格' }],
    },
  };
  const confirmed = await request('/interactions/confirm', { method: 'POST', body: json(confirmBody) });
  const repeated = await request('/interactions/confirm', { method: 'POST', body: json(confirmBody) });
  assert.equal(repeated.interaction.id, confirmed.interaction.id);
  assert.equal(repeated.duplicate, true);

  const claim = await request(`/people/${person.id}/claims`, {
    method: 'POST',
    body: json({
      contextId: context.id,
      situation: '讨论具体合作时',
      statement: '对方更愿意回应明确范围、价格和交付时间的请求',
      status: 'hypothesis',
      confidenceLevel: 'initial',
      alternativeExplanations: ['也可能只是礼貌询问，并无购买意愿'],
      userConfirmed: true,
    }),
  });
  await request(`/claims/${claim.id}/evidence`, {
    method: 'POST',
    body: json({
      interactionId: confirmed.interaction.id,
      evidenceType: 'supports',
      content: '对方主动询问价格和交付时间',
    }),
  });
  await request(`/claims/${claim.id}`, {
    method: 'PATCH',
    body: json({ status: 'testing', expectedVersion: claim.version }),
  });

  const decisionResult = await request('/decisions', {
    method: 'POST',
    body: json({
      personId: person.id,
      goal: '验证对方是否愿意进入真实交易',
      whyNow: '对方已经询问价格与交付时间',
      relationshipMode: 'mixed',
      mutualValue: '用低风险试验确认双方是否适合合作',
      chosenAction: '发送一页方案并给出明确报价',
      expectedSignals: {
        positive: ['愿意付款或讨论付款节点'],
        neutral: ['提出具体修改'],
        negative: ['持续回避价格和下一步'],
      },
      boundaries: ['不免费承诺完整开发'],
      stopConditions: ['连续两次回避明确下一步'],
    }),
  });
  const completedDecision = await request(`/decisions/${decisionResult.decision.id}/outcome`, {
    method: 'POST',
    body: json({
      actualResponse: '对方愿意先看一页方案，再决定是否付款',
      result: 'neutral',
      matchedExpectation: true,
      learning: '询问价格是信号，但不是付款证据',
      nextStep: '发送一页方案并设置回复期限',
    }),
  });
  assert.equal(completedDecision.decision.status, 'reviewed');

  const opportunity = await request('/opportunities', {
    method: 'POST',
    body: json({
      title: '技术验证小单',
      problem: '客户需要低风险验证技术方案是否可行',
      customer: '有明确技术问题但不愿先投入大预算的团队',
      evidence: '一位潜在客户主动询问价格和交付时间',
      stage: 'interview',
    }),
  });
  const experimentResult = await request(`/opportunities/${opportunity.id}/experiments`, {
    method: 'POST',
    body: json({
      type: 'offer',
      hypothesis: '对方愿意为一页方案和小范围验证付款',
      method: '发送带价格和交付范围的一页报价',
      successCriteria: '收到付款或明确付款承诺',
      plannedAt: new Date().toISOString(),
    }),
  });
  const experiment = await request(`/experiments/${experimentResult.experiment.id}/outcome`, {
    method: 'POST',
    body: json({
      result: '对方愿意继续讨论，但尚未付款',
      evidence: '回复了交付范围问题',
      amountCents: 0,
      currency: 'CNY',
      nextDecision: 'adjust',
    }),
  });
  assert.equal(experiment.experiment.status, 'completed');

  const review = await request('/weekly-reviews/generate', { method: 'POST', body: '{}' });
  assert.equal(review.status, 'draft');
  const finalReview = await request(`/weekly-reviews/${review.id}/confirm`, {
    method: 'POST',
    body: json({
      principle: '把兴趣信号与付款证据分开，先验证再扩大投入。',
      selfBlindSpot: '容易把对方的询问过早解释成购买意愿。',
      relationshipActions: [{ personId: person.id, title: '发送一页方案并记录真实反馈' }],
      opportunityExperiment: '向第二位相似客户展示同一报价',
    }),
  });
  assert.equal(finalReview.review.status, 'completed');

  workspace = await request(`/people/${person.id}/workspace`);
  const savedClaim = workspace.hypotheses.find((item) => item.id === claim.id);
  assert.equal(savedClaim.evidence[0].direction, 'support');
  assert.equal(workspace.interactions.filter((item) => item.id === confirmed.interaction.id).length, 1);

  const growth = await request('/growth');
  assert.equal(growth.principles.some((item) => item.statement.includes('兴趣信号')), true);
  assert.equal(growth.patterns.some((item) => item.statement.includes('购买意愿')), true);
  assert.equal(growth.calibration.closedDecisions >= 1, true);

  const today = await request('/today');
  assert.equal(today.peopleActions.some((item) => item.person.id === person.id), true);
  assert.ok(today.activeOpportunity);

  console.log(JSON.stringify({
    status: 'passed',
    storage_mode: health.storageMode,
    person_id: person.id,
    interaction_id: confirmed.interaction.id,
    decision_id: decisionResult.decision.id,
    opportunity_id: opportunity.id,
    weekly_review_id: review.id,
    closed_decisions: growth.calibration.closedDecisions,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
