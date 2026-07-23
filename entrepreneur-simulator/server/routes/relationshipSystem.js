const defaultService = require('../services/relationshipSystemRuntimeService');
const defaultGuidanceService = require('../services/compassGuidanceService');
const defaultAttentionRecommendationService = require('../services/peopleAttentionRecommendationService');
const { RelationshipSystemError } = require('../services/relationshipSystemService');

const ACTIVE_CLAIM_STATUSES = new Set(['supported']);

function omitUndefined(value) {
  return Object.fromEntries(Object.entries(value || {}).filter(([, item]) => item !== undefined));
}

function attentionForClient(value) {
  return value === 'sleep' ? 'dormant' : (value || 'observe');
}

function stageForClient(value) {
  return ({
    customer_interview: 'interview',
    quote_test: 'offer_test',
    paid_test: 'paid_validation',
    scale: 'scaling',
  })[value] || value || 'signal';
}

function stageForService(value) {
  return ({
    interview: 'customer_interview',
    offer_test: 'quote_test',
    paid_validation: 'paid_test',
    scaling: 'scale',
  })[value] || value;
}

function personForClient(person) {
  if (!person) return null;
  const contexts = Array.isArray(person.contexts) ? person.contexts : [];
  const primary = contexts.find((item) => item.is_primary) || contexts[0] || null;
  const last = person.last_interaction || null;
  const roles = contexts.map((item) => item.label || item.context_type).filter(Boolean);
  const relationshipMode = primary?.attention_status || 'observe';
  const attentionLayer = ['focus', 'repair', 'boundary'].includes(relationshipMode) ? 'current' : 'library';
  const observeNext = primary?.urgency?.observe_next || null;
  return {
    ...person,
    roles,
    relationshipRoles: roles,
    attentionState: attentionForClient(primary?.attention_status),
    attention_state: attentionForClient(primary?.attention_status),
    focusReason: primary?.why_matters_now || null,
    focus_reason: primary?.why_matters_now || null,
    primaryContextId: primary?.id || null,
    primary_context_id: primary?.id || null,
    contextVersion: primary?.version || null,
    context_version: primary?.version || null,
    currentGoal: primary?.current_goal || null,
    current_goal: primary?.current_goal || null,
    currentState: primary?.current_state || null,
    current_state: primary?.current_state || null,
    observeNext,
    observe_next: observeNext,
    attentionLayer,
    attention_layer: attentionLayer,
    currentAttention: attentionLayer === 'current',
    current_attention: attentionLayer === 'current',
    relationshipMode,
    relationship_mode: relationshipMode,
    lastInteractionAt: last?.occurred_at || null,
    last_interaction_at: last?.occurred_at || null,
    lastInteractionSummary: last?.summary || null,
    last_interaction_summary: last?.summary || null,
  };
}

function recommendationForClient(recommendation) {
  if (!recommendation) return null;
  const payload = recommendation.payload || {};
  return {
    id: recommendation.id,
    personId: recommendation.person_id,
    person_id: recommendation.person_id,
    status: recommendation.status,
    reason: payload.reason || null,
    whyNow: payload.why_now || null,
    why_now: payload.why_now || null,
    lifeDomains: payload.life_domains || [],
    life_domains: payload.life_domains || [],
    observeNext: payload.observe_next || null,
    observe_next: payload.observe_next || null,
    evidenceRefs: recommendation.evidence_refs || [],
    evidence_refs: recommendation.evidence_refs || [],
    confidence: payload.confidence || 'initial',
    suggestedUntil: payload.suggested_until || null,
    suggested_until: payload.suggested_until || null,
    fallback: payload.fallback === true,
    generatedAt: recommendation.created_at || null,
    generated_at: recommendation.created_at || null,
    version: recommendation.version,
    person: personForClient(recommendation.person),
  };
}

function recommendationRunForClient(run) {
  if (!run) return null;
  const payload = run.payload || {};
  const snapshot = run.input_snapshot || {};
  return {
    id: run.id,
    generatedAt: run.created_at || null,
    generated_at: run.created_at || null,
    snapshotHash: snapshot.snapshot_hash || null,
    snapshot_hash: snapshot.snapshot_hash || null,
    status: payload.status || 'empty',
    warning: payload.warning || null,
    sourceStatus: snapshot.source_status || {},
    source_status: snapshot.source_status || {},
    recommendationCount: Number(payload.recommendation_count || 0),
    recommendation_count: Number(payload.recommendation_count || 0),
    model: run.model || null,
    promptVersion: run.prompt_version || null,
    prompt_version: run.prompt_version || null,
  };
}

function peopleOverviewForClient(overview) {
  const run = recommendationRunForClient(overview?.recommendation_run);
  const counts = overview?.counts || {};
  return {
    generatedAt: overview?.generated_at || new Date().toISOString(),
    generated_at: overview?.generated_at || new Date().toISOString(),
    recommendations: (overview?.recommendations || []).map(recommendationForClient),
    attentionPeople: (overview?.attention_people || []).map(personForClient),
    attention_people: (overview?.attention_people || []).map(personForClient),
    libraryPeople: (overview?.library_people || []).map(personForClient),
    library_people: (overview?.library_people || []).map(personForClient),
    counts: {
      trackedPeople: Number(counts.tracked_people || 0),
      currentAttention: Number(counts.current_attention || 0),
      relationshipLibrary: Number(counts.relationship_library || 0),
      pendingRecommendations: Number(counts.pending_recommendations || 0),
    },
    recommendationRun: run,
    recommendation_run: run,
    warning: run?.warning || null,
    cached: overview?.cached === true,
  };
}

function interactionForClient(interaction) {
  return {
    ...interaction,
    personId: interaction.person_id,
    occurredAt: interaction.occurred_at,
    eventContext: interaction.summary,
    observedFacts: interaction.observed_facts || [],
    myActions: interaction.my_actions || [],
    theirReactions: interaction.their_reactions || [],
    myFeelings: interaction.my_feelings || [],
    interpretations: interaction.interpretations || [],
    opportunitySignals: interaction.opportunity_signals || [],
    createdAt: interaction.created_at,
  };
}

function claimForClient(claim) {
  const evidence = (claim.evidence || []).map((item) => ({
    ...item,
    sourceType: item.interaction_id ? 'interaction' : 'manual',
    sourceId: item.interaction_id || null,
    excerpt: item.content || '',
    occurredAt: item.occurred_at || item.created_at || null,
    direction: ({ supports: 'support', contradicts: 'counter', neutral: 'neutral' })[item.evidence_type]
      || 'neutral',
  }));
  return {
    ...claim,
    personId: claim.person_id,
    context: claim.situation || claim.dimension || '一般相处',
    status: claim.status === 'hypothesis' ? 'proposed' : claim.status,
    evidenceStrength: claim.confidence_level,
    evidence,
    alternativeExplanations: claim.alternative_explanations || [],
    lastVerifiedAt: claim.last_verified_at,
    userConfirmed: claim.user_confirmed === true,
    suggestedApproach: null,
  };
}

function outcomeForClient(outcome) {
  if (!outcome) return null;
  return {
    ...outcome,
    actualResponse: outcome.actual_response || outcome.result || '',
    predictionMatch: outcome.expected_match === 'unexpected' ? 'not_matched' : outcome.expected_match,
    learning: [outcome.learning_about_them, outcome.learning_about_self].filter(Boolean).join('\n') || null,
    recordedAt: outcome.updated_at || outcome.created_at,
  };
}

function decisionForClient(decision) {
  let status = decision.status;
  if (status === 'executing') status = 'chosen';
  if (status === 'completed') status = decision.outcome ? 'reviewed' : 'executed';
  return {
    ...decision,
    personId: decision.person_id,
    whyNow: decision.why_now,
    mutualValue: decision.mutual_value,
    relationshipMode: decision.relationship_mode,
    chosenAction: decision.selected_option?.label || decision.selected_option?.action || decision.recommendation,
    feedbackSignals: decision.feedback_signals || [],
    stopConditions: decision.stop_conditions || [],
    createdAt: decision.created_at,
    status,
    outcome: outcomeForClient(decision.outcome),
  };
}

function opportunityForClient(opportunity, experiments = []) {
  if (!opportunity) return null;
  const evidence = opportunity.evidence_summary ? [{
    id: `summary-${opportunity.id}`,
    kind: opportunity.payment_signal ? 'payment' : 'other',
    summary: opportunity.evidence_summary,
    person_id: opportunity.source_person_id,
    occurred_at: opportunity.updated_at,
  }] : [];
  return {
    ...opportunity,
    problem: opportunity.problem_statement,
    customer: opportunity.target_customer,
    userRole: opportunity.target_customer,
    beneficiaryRole: opportunity.beneficiary,
    decisionMakerRole: opportunity.decision_maker,
    payerRole: opportunity.payer,
    cost: opportunity.cost_of_problem,
    accessAdvantage: opportunity.access_channel,
    missingEvidence: opportunity.next_missing_evidence,
    nextExperiment: opportunity.next_missing_evidence,
    stage: stageForClient(opportunity.stage),
    evidence,
    experiments: experiments.map((experiment) => ({
      ...experiment,
      opportunityId: experiment.opportunity_id,
      successCriteria: experiment.success_criteria,
      plannedAt: experiment.planned_at,
      amountCents: typeof experiment.revenue_amount === 'number'
        ? Math.round(experiment.revenue_amount * 100)
        : null,
      createdAt: experiment.created_at,
    })),
    relatedPeople: [],
    cashflowTotal: experiments.reduce((total, item) => total + Number(item.revenue_amount || 0), 0),
    updatedAt: opportunity.updated_at,
  };
}

function weeklyReviewForClient(review) {
  if (!review) return null;
  const weekStart = review.week_start || null;
  let weekEnd = null;
  if (weekStart) {
    const end = new Date(`${weekStart}T00:00:00.000Z`);
    if (!Number.isNaN(end.getTime())) {
      end.setUTCDate(end.getUTCDate() + 6);
      weekEnd = end.toISOString().slice(0, 10);
    }
  }
  return {
    ...review,
    weekStart,
    weekEnd,
    status: review.user_confirmed ? 'completed' : 'draft',
    importantChanges: review.important_changes || [],
    neglectedRelationships: review.neglected_relationships || [],
    openCommitments: review.open_commitments || [],
    asymmetryWarnings: review.overinvestment_signals || [],
    contradictedClaims: review.contradicted_claims || [],
    opportunitySignals: (review.opportunity_signals || [])
      .map((item) => typeof item === 'string' ? item : (item?.signal || item?.summary || ''))
      .filter(Boolean),
    selfBlindSpot: review.self_pattern || null,
    selfPatternCandidate: review.self_pattern || null,
    principle: review.principle || null,
    relationshipActions: review.next_people_actions || [],
    opportunityExperiment: review.next_opportunity_experiment?.title
      || review.next_opportunity_experiment?.next_missing_evidence
      || null,
  };
}

function errorPayload(error, request) {
  const known = error instanceof RelationshipSystemError;
  const statusCode = known ? error.statusCode : 500;
  const code = known ? error.code : 'INTERNAL_ERROR';
  return {
    statusCode,
    body: {
      error: code,
      message: known ? error.message : 'Relationship system request failed.',
      details: known ? error.details : undefined,
      requestId: request?.id ? String(request.id) : undefined,
    },
  };
}

async function relationshipSystemRoutes(fastify, options = {}) {
  const service = options.service || defaultService;
  const guidanceService = options.guidanceService || defaultGuidanceService;
  const attentionRecommendationService = options.attentionRecommendationService || defaultAttentionRecommendationService;

  const register = (method, url, handler, successCode = 200) => {
    fastify.route({
      method,
      url,
      handler: async (request, reply) => {
        try {
          const data = await handler(request);
          return reply.code(successCode).send({ data });
        } catch (error) {
          const response = errorPayload(error, request);
          if (response.statusCode >= 500) request.log?.error?.({ err: error }, 'relationship-system request failed');
          return reply.code(response.statusCode).send(response.body);
        }
      },
    });
  };

  register('GET', '/health', async () => service.healthcheck());

  register('GET', '/compass', async () => service.getCompass());
  register('PUT', '/compass', async (request) => service.saveCompass(request.body || {}));
  register('POST', '/compass/daily-guidance', async (request) => guidanceService.generateDailyGuidance({
    refresh: request.body?.refresh === true,
  }));

  register('GET', '/today', async () => {
    const today = await service.getToday();
    return {
      generatedAt: today.generated_at,
      compass: {
        headline: today.compass?.title || '把真实互动沉淀为判断、行动与商业验证。',
        outcome12m: today.compass?.outcome_statement || null,
        focus90d: today.compass?.ninety_day_bet || null,
        cashflowTarget: 50000,
        metricDefinition: '经营性现金流，由真实交易验证',
      },
      peopleActions: (today.attention_people || []).map((person) => {
        const clientPerson = personForClient(person);
        const primary = person.contexts?.find((item) => item.is_primary) || person.contexts?.[0];
        return {
          person: clientPerson,
          reason: primary?.why_matters_now || null,
          suggestedAction: primary?.current_goal || primary?.current_state || null,
        };
      }),
      dueCommitments: today.due_commitments || [],
      momentumPeople: (today.momentum_people || []).map(personForClient),
      activeOpportunity: today.active_opportunity
        ? opportunityForClient(today.active_opportunity, today.active_opportunity.experiments || [])
        : null,
      weeklyReviewDue: Boolean(today.weekly_review_due),
      weeklyReviewLabel: today.weekly_review_due ? '用十分钟确认一条原则、一个盲点和下周行动。' : null,
      counts: today.counts,
    };
  });

  register('GET', '/people', async (request) => {
    const people = await service.listPeople({
      search: request.query?.q || request.query?.search,
      attentionStatus: request.query?.attentionState === 'dormant' ? 'sleep' : request.query?.attentionState,
      limit: request.query?.limit,
    });
    return people.map(personForClient);
  });

  register('GET', '/people/overview', async () => peopleOverviewForClient(await service.getPeopleOverview()));
  register('POST', '/people/attention-recommendations/generate', async (request) => peopleOverviewForClient(
    await attentionRecommendationService.generateRecommendations({ refresh: request.body?.refresh === true })
  ));
  register('POST', '/people/attention-recommendations/:recommendationId/decision', async (request) => {
    const body = request.body || {};
    const result = await service.decideAttentionRecommendation(request.params.recommendationId, {
      decision: body.decision,
      reason: body.reason,
      observeNext: body.observeNext,
      expectedVersion: body.expectedVersion,
    });
    const personId = result?.recommendation?.person_id;
    const people = personId ? await service.listPeople({ limit: 200 }) : [];
    const person = people.find((item) => item.id === personId) || null;
    return {
      recommendation: recommendationForClient({ ...result?.recommendation, person }),
      person: personForClient(person),
      duplicate: result?.duplicate === true,
    };
  });
  register('PATCH', '/people/:personId/attention', async (request) => {
    const body = request.body || {};
    return personForClient(await service.setPersonAttention(request.params.personId, omitUndefined({
      attentionState: body.attentionState,
      focusReason: body.focusReason,
      observeNext: body.observeNext,
      contextId: body.contextId,
      expectedVersion: body.expectedVersion,
    })));
  });

  register('POST', '/people', async (request) => {
    const person = await service.createPerson(request.body || {});
    return { person: personForClient(person) };
  }, 201);

  register('GET', '/people/:personId/workspace', async (request) => {
    const workspace = await service.getPersonWorkspace(request.params.personId);
    const primary = workspace.contexts.find((item) => item.is_primary) || workspace.contexts[0] || null;
    const confirmed = workspace.claims.filter((claim) => ACTIVE_CLAIM_STATUSES.has(claim.status) && claim.user_confirmed === true);
    const hypothesis = workspace.claims.filter((claim) =>
      ['hypothesis', 'proposed', 'testing', 'mixed'].includes(claim.status)
      || (ACTIVE_CLAIM_STATUSES.has(claim.status) && claim.user_confirmed !== true)
    );
    const inactiveClaims = workspace.claims.filter((claim) => ['contradicted', 'retired'].includes(claim.status));
    const commitments = workspace.interactions.flatMap((interaction) =>
      (interaction.commitments || []).filter((item) => !['done', 'cancelled'].includes(item?.status || 'open')).map((item, index) => ({
        id: item.id || `${interaction.id}-${index}`,
        ...item,
        personId: workspace.person.id,
        sourceInteractionId: interaction.id,
      }))
    );
    return {
      person: personForClient({
        ...workspace.person,
        contexts: workspace.contexts,
        last_interaction: workspace.interactions[0] || null,
      }),
      brief: {
        whyNow: primary?.why_matters_now || null,
        currentState: primary?.current_state || null,
        recentChange: workspace.interactions[0]?.summary || null,
        currentGoal: primary?.current_goal || null,
        currentBoundary: (primary?.boundaries || []).map((item) => item?.text || item).filter(Boolean).join('；') || null,
        observeNext: primary?.urgency?.observe_next || null,
      },
      interactionGuide: confirmed.map(claimForClient),
      hypotheses: hypothesis.map(claimForClient),
      inactiveClaims: inactiveClaims.map(claimForClient),
      commitments,
      decisions: workspace.decisions.map(decisionForClient),
      interactions: workspace.interactions.map(interactionForClient),
      contexts: workspace.contexts,
      relatedPeople: [],
    };
  });

  register('GET', '/people/:personId/contexts', async (request) => service.listContexts(request.params.personId));
  register('POST', '/people/:personId/contexts', async (request) => service.createContext(request.params.personId, request.body || {}), 201);
  register('PATCH', '/contexts/:contextId', async (request) => service.updateContext(request.params.contextId, request.body || {}));

  register('GET', '/people/:personId/interactions', async (request) => {
    const rows = await service.listInteractions(request.params.personId, request.query || {});
    return rows.map(interactionForClient);
  });

  register('POST', '/people/:personId/interactions', async (request) => {
    const body = request.body || {};
    const patch = body.patch || body.draft || body;
    const result = await service.createManualInteraction(request.params.personId, {
      idempotencyKey: body.clientRequestId || body.idempotencyKey,
      contextId: body.contextId,
      draft: omitUndefined({
        occurred_at: patch.occurredAt || patch.occurred_at,
        source_type: 'manual',
        raw_text: patch.rawText || patch.raw_text,
        summary: patch.eventContext || patch.context || patch.summary,
        observed_facts: patch.observedFacts || patch.facts,
        my_actions: patch.myActions || (patch.my_action ? [patch.my_action] : undefined),
        their_reactions: patch.theirReactions || (patch.their_reaction ? [patch.their_reaction] : undefined),
        my_feelings: patch.myFeelings || patch.my_feelings,
        interpretations: patch.interpretations || (patch.interpretation ? [patch.interpretation] : undefined),
        commitments: patch.commitments,
        relationship_signals: patch.relationshipSignals,
        opportunity_signals: patch.opportunitySignals || patch.opportunity_signals,
        review: patch.review,
      }),
    });
    return { interaction: interactionForClient(result.interaction), duplicate: result.duplicate };
  }, 201);

  const extractInteraction = async (request) => {
    const body = request.body || {};
    const personId = body.personId || request.params?.personId;
    const proposal = await service.createInteractionProposal(personId, {
      content: body.rawText || body.text || body.content,
      occurredAt: body.occurredAt,
      sourceType: body.sourceType,
      contextId: body.contextId,
    });
    return {
      proposal: {
        id: proposal.id,
        proposalId: proposal.id,
        personId: proposal.person_id,
        ...proposal.payload,
        occurredAt: proposal.payload?.occurred_at,
        eventContext: proposal.payload?.summary,
        observedFacts: proposal.payload?.observed_facts || [],
        myActions: proposal.payload?.my_actions || [],
        theirReactions: proposal.payload?.their_reactions || [],
        myFeelings: proposal.payload?.my_feelings || [],
        interpretations: proposal.payload?.interpretations || [],
        commitments: (proposal.payload?.commitments || []).map((item) => ({
          ...item,
          title: item?.title || item?.text || item?.content || '',
          dueAt: item?.dueAt || item?.due_at || null,
        })),
        opportunitySignals: proposal.payload?.opportunity_signals || [],
        claimLinks: [],
        warnings: proposal.warnings || proposal.payload?.warnings || [],
      },
      duplicateCandidates: [],
      warnings: proposal.warnings || proposal.payload?.warnings || [],
    };
  };
  register('POST', '/interactions/extract', extractInteraction, 201);
  register('POST', '/people/:personId/interactions/extract', extractInteraction, 201);

  const confirmInteraction = async (request) => {
    const body = request.body || {};
    const personId = body.personId || request.params?.personId;
    const patch = body.patch || body.draft || {};
    const result = await service.confirmInteraction(personId, {
      proposalId: body.proposalId || patch.proposal_id,
      idempotencyKey: body.clientRequestId || body.idempotencyKey,
      contextId: body.contextId,
      draft: omitUndefined({
        occurred_at: patch.occurredAt || patch.occurred_at,
        source_type: patch.sourceType || patch.source_type,
        raw_text: patch.rawText || patch.raw_text,
        summary: patch.eventContext || patch.context || patch.summary,
        observed_facts: patch.observedFacts || patch.facts,
        my_actions: patch.myActions || (patch.my_action ? [patch.my_action] : undefined),
        their_reactions: patch.theirReactions || (patch.their_reaction ? [patch.their_reaction] : undefined),
        my_feelings: patch.myFeelings,
        interpretations: patch.interpretations || (patch.interpretation ? [patch.interpretation] : undefined),
        commitments: patch.commitments,
        relationship_signals: patch.relationshipSignals,
        opportunity_signals: patch.opportunitySignals || patch.opportunity_signals,
        review: patch.review,
      }),
    });
    return { interaction: interactionForClient(result.interaction), duplicate: result.duplicate };
  };
  register('POST', '/interactions/confirm', confirmInteraction, 201);
  register('POST', '/people/:personId/interactions/confirm', confirmInteraction, 201);
  register('POST', '/ai-proposals/:proposalId/reject', async (request) => service.rejectProposal(request.params.proposalId, request.body || {}));

  register('POST', '/people/:personId/claims', async (request) => claimForClient(
    await service.createClaim(request.params.personId, request.body || {})
  ), 201);
  register('PATCH', '/claims/:claimId', async (request) => claimForClient(
    await service.updateClaim(request.params.claimId, request.body || {})
  ));
  register('POST', '/claims/:claimId/evidence', async (request) => service.addClaimEvidence(
    request.params.claimId, request.body || {}
  ), 201);

  register('POST', '/decisions', async (request) => {
    const body = request.body || {};
    const expectedSignals = body.expectedSignals || {};
    const decision = await service.createDecision(body.personId, {
      contextId: body.contextId,
      decisionType: body.decisionType,
      relationshipMode: body.relationshipMode,
      goal: body.goal,
      whyNow: body.whyNow,
      mutualValue: body.mutualValue,
      options: body.options,
      selectedOption: body.selectedOption || (body.chosenAction ? { label: body.chosenAction } : null),
      recommendation: body.recommendation || body.chosenAction,
      risks: body.risks,
      boundaries: body.boundaries,
      feedbackSignals: [
        ...(body.feedbackSignals || []),
        ...(body.positiveSignals || []),
        ...(body.neutralSignals || []),
        ...(body.negativeSignals || []),
        ...(expectedSignals.positive || []),
        ...(expectedSignals.neutral || []),
        ...(expectedSignals.negative || []),
      ],
      stopConditions: body.stopConditions,
      status: body.status || 'chosen',
      dueAt: body.dueAt,
    });
    return { decision: decisionForClient(decision) };
  }, 201);
  register('PATCH', '/decisions/:decisionId', async (request) => decisionForClient(
    await service.updateDecision(request.params.decisionId, request.body || {})
  ));
  register('POST', '/decisions/:decisionId/outcome', async (request) => {
    const body = request.body || {};
    const result = await service.saveDecisionOutcome(request.params.decisionId, {
      executedAt: body.executedAt,
      executionNotes: body.executionNotes,
      actualResponse: body.actualResponse,
      result: body.result,
      expectedMatch: typeof body.matchedExpectation === 'boolean'
        ? (body.matchedExpectation ? 'matched' : 'unexpected')
        : (body.expectedMatch || 'unknown'),
      learningAboutThem: body.learningAboutThem,
      learningAboutSelf: body.learningAboutSelf || body.learning,
      followUp: body.followUp || body.nextStep,
      completeDecision: body.completeDecision,
      expectedVersion: body.expectedVersion,
    });
    return {
      decision: decisionForClient(result.decision),
      outcome: outcomeForClient(result.outcome),
    };
  }, 201);

  register('GET', '/opportunities', async (request) => {
    const opportunities = await service.listOpportunities({
      ...request.query,
      stage: request.query?.stage ? stageForService(request.query.stage) : undefined,
    });
    return opportunities.map((item) => opportunityForClient(item));
  });
  register('GET', '/opportunities/:opportunityId', async (request) => {
    const result = await service.getOpportunity(request.params.opportunityId);
    return opportunityForClient(result.opportunity, result.experiments);
  });
  register('POST', '/opportunities', async (request) => {
    const body = request.body || {};
    return opportunityForClient(await service.createOpportunity({
      ...body,
      problemStatement: body.problemStatement || body.problem,
      targetCustomer: body.targetCustomer || body.customer,
      evidenceSummary: body.evidenceSummary || body.evidence,
      stage: stageForService(body.stage),
    }));
  }, 201);
  register('PATCH', '/opportunities/:opportunityId', async (request) => {
    const body = request.body || {};
    const source = { ...(body.patch || {}), expectedVersion: body.expectedVersion ?? body.patch?.version };
    return opportunityForClient(await service.updateOpportunity(request.params.opportunityId, omitUndefined({
      ...source,
      problemStatement: source.problemStatement ?? source.problem,
      targetCustomer: source.targetCustomer ?? source.customer,
      beneficiary: source.beneficiary ?? source.beneficiary_role,
      decisionMaker: source.decisionMaker ?? source.decision_maker_role,
      payer: source.payer ?? source.payer_role,
      costOfProblem: source.costOfProblem ?? source.cost,
      currentWorkaround: source.currentWorkaround ?? source.current_workaround,
      accessChannel: source.accessChannel ?? source.accessAdvantage ?? source.access_advantage,
      nextMissingEvidence: source.nextMissingEvidence ?? source.missingEvidence ?? source.missing_evidence ?? source.nextExperiment ?? source.next_experiment,
      stage: source.stage ? stageForService(source.stage) : undefined,
    })));
  });
  register('POST', '/opportunities/:opportunityId/experiments', async (request) => {
    const body = request.body || {};
    const experimentType = ({ offer: 'quote', payment: 'quote', repeat: 'repurchase', referral: 'channel' })[body.type]
      || body.experimentType || body.type;
    const experiment = await service.createExperiment(request.params.opportunityId, {
      ...body,
      experimentType,
    });
    return { experiment: opportunityForClient({ id: request.params.opportunityId }, [experiment]).experiments[0] };
  }, 201);
  register('PATCH', '/experiments/:experimentId', async (request) => service.updateExperiment(
    request.params.experimentId, request.body || {}
  ));
  register('POST', '/experiments/:experimentId/outcome', async (request) => {
    const body = request.body || {};
    const amountCents = body.amountCents;
    const experiment = await service.updateExperiment(request.params.experimentId, {
      status: 'completed',
      executedAt: body.executedAt || new Date().toISOString(),
      result: body.evidence ? `${body.result}\n\n证据：${body.evidence}` : body.result,
      outcome: Number(amountCents || 0) > 0 ? 'validated' : 'inconclusive',
      revenueAmount: typeof amountCents === 'number' ? amountCents / 100 : null,
      currency: body.currency || 'CNY',
      nextStep: body.nextStep || body.nextDecision,
      expectedVersion: body.expectedVersion,
    });
    return {
      experiment: opportunityForClient({ id: experiment.opportunity_id }, [experiment]).experiments[0],
    };
  });

  register('GET', '/weekly-reviews', async (request) => {
    const rows = await service.listWeeklyReviews(request.query || {});
    return rows.map(weeklyReviewForClient);
  });
  register('GET', '/weekly-reviews/current', async () => weeklyReviewForClient(await service.getCurrentWeeklyReview()));
  register('POST', '/weekly-reviews/generate', async () => weeklyReviewForClient(await service.generateWeeklyReview()), 201);
  register('POST', '/weekly-reviews/:reviewId/confirm', async (request) => {
    const body = request.body || {};
    const review = await service.confirmWeeklyReview(request.params.reviewId, omitUndefined({
      ...body,
      principle: body.principle,
      selfPattern: body.selfPattern || body.selfBlindSpot,
      nextPeopleActions: body.nextPeopleActions || body.relationshipActions,
      nextOpportunityExperiment: body.nextOpportunityExperiment
        || (body.opportunityExperiment ? { title: body.opportunityExperiment } : undefined),
    }));
    return { review: weeklyReviewForClient(review) };
  });

  register('GET', '/growth', async (request) => {
    const [patterns, reviews, people] = await Promise.all([
      service.listGrowthPatterns(request.query || {}),
      service.listWeeklyReviews({ limit: 12 }),
      service.listPeople({ limit: 100 }),
    ]);
    const workspaces = await Promise.all(
      people.map((person) => service.getPersonWorkspace(person.id))
    );
    const decisions = workspaces.flatMap((workspace) => workspace.decisions || []);
    const closedDecisions = decisions.filter((item) => item.outcome || item.status === 'completed').length;
    const commitments = workspaces.flatMap((workspace) => (workspace.interactions || [])
      .flatMap((interaction) => interaction.commitments || []));
    const completedCommitments = commitments.filter((item) => item?.status === 'done').length;
    const supported = patterns.filter((item) => ['supported', 'reframed'].includes(item.status));
    const patternForClient = (item) => ({
      ...item,
      statement: item.pattern_statement,
      status: ['supported', 'reframed'].includes(item.status)
        ? 'confirmed'
        : (item.status === 'retired' ? 'rejected' : item.status),
      evidenceCount: (item.evidence_refs || []).length,
      counterEvidenceCount: (item.counterexamples || []).length,
      trainingAction: item.training_action || null,
      updatedAt: item.updated_at,
    });
    return {
      patterns: patterns.map(patternForClient),
      principles: reviews.filter((item) => item.user_confirmed && item.principle).map((item) => ({
        id: `weekly-principle-${item.id}`,
        statement: item.principle,
        evidenceCount: 1,
        counterEvidenceCount: 0,
        status: 'candidate',
        updatedAt: item.updated_at,
      })),
      blindSpots: patterns.filter((item) => !['supported', 'reframed', 'retired'].includes(item.status))
        .map(patternForClient),
      commercialPatterns: patterns.filter((item) => item.category === 'commercial'),
      recentReviews: reviews.map(weeklyReviewForClient),
      closedLoopCount: closedDecisions,
      commitmentCompletionRate: commitments.length ? completedCommitments / commitments.length : null,
      calibration: {
        totalPatterns: patterns.length,
        supportedPatterns: supported.length,
        confirmedWeeklyReviews: reviews.filter((item) => item.user_confirmed).length,
        closedDecisions,
      },
    };
  });
  register('POST', '/growth/patterns', async (request) => service.createGrowthPattern(request.body || {}), 201);
  register('PATCH', '/growth/patterns/:patternId', async (request) => service.updateGrowthPattern(
    request.params.patternId, request.body || {}
  ));
}

module.exports = relationshipSystemRoutes;
module.exports.__test = {
  attentionForClient,
  stageForClient,
  stageForService,
  personForClient,
  interactionForClient,
  claimForClient,
  decisionForClient,
  opportunityForClient,
  weeklyReviewForClient,
  errorPayload,
};
