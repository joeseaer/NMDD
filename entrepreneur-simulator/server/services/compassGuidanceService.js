const crypto = require('crypto');
const OpenAI = require('openai');

const { DEFAULT_USER_ID } = require('../config/currentUser');
const { extractJsonObject } = require('../utils/aiResponse');
const dbService = require('./dbService');
const documentContextService = require('./documentContextService');
const { getLlmApiKey, getLlmModel, getOpenAIClientOptions } = require('./llmConfig');
const relationshipRuntimeService = require('./relationshipSystemRuntimeService');
const { cloneDefaultPlanningState, normalizePlanningState } = require('./relationshipPlanningState');

const PROMPT_VERSION = 'compass-daily-guidance-v1';
const MAX_PEOPLE_WORKSPACES = 20;
const MAX_OPPORTUNITY_DETAILS = 20;
const MAX_CACHE_ENTRIES = 50;
const MAX_COMPACT_GOAL_NODES = 250;
const MAX_COMPACT_GAP_GROUPS = 100;

const DATA_SOURCE_LABELS = Object.freeze({
  goals: '目标与差距',
  planner: '待办与日程',
  people: '人物资料',
  interactions: '人物互动与判断',
  opportunities: '商业机会',
  reviews: '复盘与成长',
  life_documents: '生活资料',
});

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function clip(value, maxLength = 1000) {
  const normalized = value === undefined || value === null ? '' : String(value).trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isObject(value)) return value === undefined ? null : value;
  const result = {};
  for (const key of Object.keys(value).sort()) result[key] = stableValue(value[key]);
  return result;
}

function stableHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');
}

function localDateKey(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date).reduce((accumulator, part) => {
    accumulator[part.type] = part.value;
    return accumulator;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function settledValue(result, fallback) {
  return result?.status === 'fulfilled' ? result.value : fallback;
}

function sourceState(available, count, extra = {}) {
  return {
    available: Boolean(available),
    count: Number.isFinite(count) ? count : 0,
    ...extra,
  };
}

function dataSourcesFromStatus(sourceStatus) {
  return Object.entries(DATA_SOURCE_LABELS).map(([domain, label]) => {
    const source = sourceStatus[domain] || sourceState(false, 0);
    const status = !source.available
      ? 'unavailable'
      : source.truncated
        ? 'truncated'
        : source.count > 0
          ? 'included'
          : 'empty';
    return { domain, label, count: source.count, status };
  });
}

function personPriority(person) {
  const contexts = asArray(person?.contexts);
  const priority = { focus: 5, repair: 4, boundary: 4, maintain: 3, observe: 2, sleep: 1, archived: 0 };
  const attention = contexts.reduce((best, context) => Math.max(best, priority[context?.attention_status] || 0), 0);
  const last = Date.parse(person?.last_interaction?.occurred_at || person?.last_interaction_at || '') || 0;
  return attention * 1e15 + last;
}

function compactCompass(compass) {
  const state = compass?.planning_state
    ? normalizePlanningState(compass.planning_state)
    : cloneDefaultPlanningState();
  const compactNodes = state.nodes.slice(0, MAX_COMPACT_GOAL_NODES);
  const currentNode = state.nodes.find((node) => node.id === state.current_node_id) || null;
  if (currentNode && !compactNodes.some((node) => node.id === currentNode.id)) {
    if (compactNodes.length >= MAX_COMPACT_GOAL_NODES) compactNodes[compactNodes.length - 1] = currentNode;
    else compactNodes.push(currentNode);
  }
  const stageGapEntries = Object.entries(state.stage_gaps);
  const compactStageGapEntries = stageGapEntries.slice(0, MAX_COMPACT_GAP_GROUPS);
  if (currentNode && state.stage_gaps[currentNode.id]
    && !compactStageGapEntries.some(([nodeId]) => nodeId === currentNode.id)) {
    const entry = [currentNode.id, state.stage_gaps[currentNode.id]];
    if (compactStageGapEntries.length >= MAX_COMPACT_GAP_GROUPS) {
      compactStageGapEntries[compactStageGapEntries.length - 1] = entry;
    } else {
      compactStageGapEntries.push(entry);
    }
  }
  return {
    compass: {
      id: compass?.id || null,
      title: clip(compass?.title, 300),
      horizon_date: compass?.horizon_date || null,
      outcome_statement: clip(compass?.outcome_statement, 2000),
      success_metrics: asArray(compass?.success_metrics).slice(0, 20).map((item) => clip(item, 500)),
      current_assets: asArray(compass?.current_assets).slice(0, 20).map((item) => clip(item, 500)),
      current_constraints: asArray(compass?.current_constraints).slice(0, 20).map((item) => clip(item, 500)),
      ninety_day_bet: clip(compass?.ninety_day_bet, 2000),
      non_negotiables: asArray(compass?.non_negotiables).slice(0, 20).map((item) => clip(item, 500)),
      planning_state: {
        ...state,
        daily_guidance: null,
        nodes: compactNodes,
        overall_gaps: state.overall_gaps.slice(0, MAX_COMPACT_GAP_GROUPS),
        stage_gaps: Object.fromEntries(compactStageGapEntries),
      },
    },
    state,
    truncation: {
      goals: state.nodes.length > compactNodes.length,
      goal_nodes_total: state.nodes.length,
      goal_nodes_included: compactNodes.length,
      overall_gaps: state.overall_gaps.length > MAX_COMPACT_GAP_GROUPS,
      stage_gap_groups: stageGapEntries.length > compactStageGapEntries.length,
    },
  };
}

function compactPerson(person) {
  const primary = asArray(person?.contexts).find((context) => context?.is_primary)
    || asArray(person?.contexts)[0]
    || null;
  return {
    ref: `person:${person?.id || ''}`,
    id: person?.id || null,
    name: clip(person?.name, 200),
    identity: clip(person?.identity || person?.field, 300),
    attention_status: primary?.attention_status || null,
    why_matters_now: clip(primary?.why_matters_now, 800),
    current_goal: clip(primary?.current_goal, 800),
    last_interaction: clip(person?.last_interaction?.summary || person?.last_interaction_summary, 800),
    last_interaction_at: person?.last_interaction?.occurred_at || person?.last_interaction_at || null,
  };
}

function compactWorkspace(workspace) {
  return {
    person_id: workspace?.person?.id || null,
    interactions: asArray(workspace?.interactions).slice(0, 10).map((item) => ({
      ref: `interaction:${item.id}`,
      id: item.id,
      occurred_at: item.occurred_at,
      summary: clip(item.summary, 1000),
      observed_facts: asArray(item.observed_facts).slice(0, 8).map((entry) => clip(entry, 500)),
      my_actions: asArray(item.my_actions).slice(0, 8).map((entry) => clip(entry, 500)),
      their_reactions: asArray(item.their_reactions).slice(0, 8).map((entry) => clip(entry, 500)),
      commitments: asArray(item.commitments).slice(0, 8),
      opportunity_signals: asArray(item.opportunity_signals).slice(0, 8).map((entry) => clip(entry?.signal || entry, 500)),
    })),
    claims: asArray(workspace?.claims).slice(0, 12).map((item) => ({
      id: item.id,
      statement: clip(item.statement, 800),
      status: item.status,
      confidence_level: item.confidence_level,
      counterevidence_notes: clip(item.counterevidence_notes, 500),
    })),
    decisions: asArray(workspace?.decisions).slice(0, 8).map((item) => ({
      id: item.id,
      goal: clip(item.goal, 800),
      recommendation: clip(item.recommendation, 800),
      status: item.status,
      due_at: item.due_at,
      outcome: item.outcome ? {
        result: clip(item.outcome.result, 800),
        actual_response: clip(item.outcome.actual_response, 800),
        learning_about_self: clip(item.outcome.learning_about_self, 800),
      } : null,
    })),
  };
}

function compactOpportunity(value) {
  const opportunity = value?.opportunity || value || {};
  return {
    ref: `opportunity:${opportunity.id || ''}`,
    id: opportunity.id || null,
    title: clip(opportunity.title, 300),
    problem_statement: clip(opportunity.problem_statement, 1200),
    target_customer: clip(opportunity.target_customer, 500),
    evidence_summary: clip(opportunity.evidence_summary, 1000),
    payment_signal: clip(opportunity.payment_signal, 600),
    next_missing_evidence: clip(opportunity.next_missing_evidence, 800),
    stage: opportunity.stage || null,
    status: opportunity.status || null,
    experiments: asArray(value?.experiments || opportunity.experiments).slice(0, 10).map((item) => ({
      id: item.id,
      hypothesis: clip(item.hypothesis, 800),
      method: clip(item.method, 800),
      status: item.status,
      result: clip(item.result, 800),
      outcome: item.outcome,
      next_step: clip(item.next_step, 800),
    })),
  };
}

function compactReview(item, domain) {
  return {
    ref: `review:${item?.id || `${domain}-unknown`}`,
    id: item?.id || null,
    domain,
    date: item?.week_start || item?.date || item?.created_at || null,
    title: clip(item?.title, 300),
    summary: clip(item?.summary || item?.result, 1200),
    self_pattern: clip(item?.self_pattern || item?.pattern_statement, 800),
    principle: clip(item?.principle, 800),
    training_action: clip(item?.training_action, 800),
  };
}

function buildSourceCatalog(snapshot) {
  const catalog = new Map();
  const add = (ref, domain, id, label) => {
    if (!ref || !label) return;
    catalog.set(ref, { domain, id: String(id || ''), label: clip(label, 300) });
  };
  for (const node of snapshot.compass?.planning_state?.nodes || []) {
    add(`goal:${node.id}`, 'goal', node.id, node.title);
  }
  for (const task of snapshot.planner?.tasks || []) add(task.ref, 'planner', task.id, task.title);
  for (const event of snapshot.planner?.events || []) add(event.ref, 'planner', event.id, event.title);
  for (const person of snapshot.people || []) add(person.ref, 'people', person.id, person.name);
  for (const workspace of snapshot.relationship_workspaces || []) {
    for (const interaction of workspace.interactions || []) {
      add(interaction.ref, 'interactions', interaction.id, interaction.summary || '互动记录');
    }
  }
  for (const opportunity of snapshot.opportunities || []) {
    add(opportunity.ref, 'opportunities', opportunity.id, opportunity.title);
  }
  for (const review of snapshot.reviews || []) add(review.ref, 'reviews', review.id, review.title || review.summary || '复盘');
  for (const reference of snapshot.life_documents?.references || []) {
    add(`document:${reference.ref_id}`, 'life_documents', reference.ref_id, reference.title || reference.heading || reference.ref_id);
  }
  return catalog;
}

function currentGoalNode(compass) {
  const state = compass?.planning_state || cloneDefaultPlanningState();
  return state.nodes.find((node) => node.id === state.current_node_id)
    || state.nodes.find((node) => node.status === 'in_progress')
    || state.nodes[0]
    || null;
}

function dynamicFallback(snapshot, catalog, warning, generatedAt) {
  const node = currentGoalNode(snapshot.compass);
  const firstGap = snapshot.compass?.planning_state?.overall_gaps?.[0] || null;
  const firstTask = snapshot.planner?.tasks?.[0] || null;
  const focus = clip(
    node?.next_validation
      || (node?.title ? `为“${node.title}”取得一条新的现实证据。` : '')
      || firstTask?.title
      || snapshot.compass?.ninety_day_bet
      || '先补充一个当前阶段目标，并写清下一步要验证的事实。',
    3000
  );
  const why = clip(
    node?.missing_evidence
      || firstGap?.primary_gap
      || snapshot.compass?.outcome_statement
      || '当前资料还不足以判断优先级，先建立清晰目标和现实基线。',
    5000
  );
  const avoid = clip(
    node?.title
      ? `不要用与“${node.title}”无关的新投入，替代当前最缺证据的验证。`
      : '不要同时展开过多方向；先确定一个阶段目标再投入。',
    5000
  );
  const observe = clip(
    node?.completion_standard
      || firstGap?.next_evidence
      || '观察今天的行动是否产生了可核对的外部反馈，而不只是完成准备工作。',
    5000
  );
  const source = node ? catalog.get(`goal:${node.id}`) : firstTask ? catalog.get(firstTask.ref) : null;
  return {
    focus,
    why,
    avoid,
    observe,
    generated_at: generatedAt,
    sources: source ? [source] : [],
    fallback: true,
    warning: warning || 'AI 暂不可用，当前判断由已记录的目标与差距动态生成。',
  };
}

function normalizeAiGuidance(parsed, catalog, generatedAt) {
  if (!isObject(parsed)) throw new Error('AI returned no JSON object.');
  const required = ['focus', 'why', 'avoid', 'observe'];
  const guidance = {};
  for (const field of required) {
    const value = clip(parsed[field], field === 'focus' ? 3000 : 5000);
    if (!value) throw new Error(`AI response is missing ${field}.`);
    guidance[field] = value;
  }
  const requestedRefs = asArray(parsed.source_refs || parsed.sources).map((item) => {
    if (typeof item === 'string') return item;
    return item?.ref || item?.source_ref || null;
  }).filter(Boolean);
  guidance.generated_at = generatedAt;
  guidance.sources = Array.from(new Set(requestedRefs)).map((ref) => catalog.get(ref)).filter(Boolean).slice(0, 8);
  guidance.fallback = false;
  guidance.warning = null;
  return guidance;
}

function compassSaveInput(compass, planningState) {
  return {
    title: compass.title || '当前生活与事业罗盘',
    horizonDate: compass.horizon_date || null,
    outcomeStatement: compass.outcome_statement || '',
    successMetrics: asArray(compass.success_metrics),
    currentAssets: asArray(compass.current_assets),
    currentConstraints: asArray(compass.current_constraints),
    ninetyDayBet: compass.ninety_day_bet || null,
    nonNegotiables: asArray(compass.non_negotiables),
    planningState,
    expectedVersion: compass.version,
  };
}

function isVersionConflict(error) {
  return error?.code === 'VERSION_CONFLICT' || error?.statusCode === 409;
}

function appendWarning(first, second) {
  return [first, second].filter(Boolean).join(' ') || null;
}

function createCompassGuidanceService(options = {}) {
  const relationships = options.relationshipService || relationshipRuntimeService;
  const database = options.dbService || dbService;
  const documents = options.documentContextService || documentContextService;
  const userId = String(options.userId || DEFAULT_USER_ID);
  const nowProvider = options.now || (() => new Date());
  const cache = options.cache || new Map();
  const inFlight = options.inFlight || new Map();
  let client = Object.prototype.hasOwnProperty.call(options, 'aiClient') ? options.aiClient : undefined;

  function getClient() {
    if (client !== undefined) return client;
    const apiKey = getLlmApiKey();
    client = apiKey ? new OpenAI(getOpenAIClientOptions()) : null;
    return client;
  }

  async function buildDecisionSnapshot() {
    const now = nowProvider();
    const rangeStart = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const rangeEnd = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();
    const loaders = [
      () => relationships.getCompass(),
      () => database.listPlannerItems({ userId, type: 'task', status: 'open' }),
      () => database.listPlannerItems({ userId, type: 'event', startAt: rangeStart, endAt: rangeEnd }),
      () => relationships.listPeople({ limit: 200 }),
      () => relationships.listOpportunities({ limit: 100 }),
      () => relationships.listWeeklyReviews({ limit: 20 }),
      () => relationships.listGrowthPatterns({ limit: 50 }),
      () => database.getReviewSessions(userId),
    ];
    const results = await Promise.allSettled(loaders.map((load) => load()));
    const [compassResult, taskResult, eventResult, peopleResult, opportunityResult, weeklyResult, growthResult, legacyReviewResult] = results;

    const rawCompass = settledValue(compassResult, null);
    const baseCompass = rawCompass ? {
      ...rawCompass,
      planning_state: rawCompass.planning_state
        ? normalizePlanningState(rawCompass.planning_state)
        : cloneDefaultPlanningState(),
    } : null;
    const compactedCompass = compactCompass(baseCompass);
    const compass = compactedCompass.compass;
    const tasksRaw = asArray(settledValue(taskResult, []));
    const eventsRaw = asArray(settledValue(eventResult, []));
    const tasks = tasksRaw.slice(0, 50).map((item) => ({
      ref: `task:${item.id}`,
      id: item.id,
      title: clip(item.title, 500),
      due_at: item.due_at || null,
      priority: item.priority || null,
    }));
    const events = eventsRaw.slice(0, 30).map((item) => ({
      ref: `event:${item.id}`,
      id: item.id,
      title: clip(item.title, 500),
      start_at: item.start_at || null,
      end_at: item.end_at || null,
    }));
    const peopleRaw = asArray(settledValue(peopleResult, []));
    const people = peopleRaw.slice(0, 100).map(compactPerson);
    const selectedPeople = [...peopleRaw]
      .sort((a, b) => personPriority(b) - personPriority(a))
      .slice(0, MAX_PEOPLE_WORKSPACES);
    const workspaceResults = peopleResult.status === 'fulfilled'
      ? await Promise.allSettled(selectedPeople.map((person) => relationships.getPersonWorkspace(person.id)))
      : [];
    const workspaces = workspaceResults.filter((result) => result.status === 'fulfilled').map((result) => compactWorkspace(result.value));

    const opportunitiesRaw = asArray(settledValue(opportunityResult, []));
    const opportunityDetailResults = opportunityResult.status === 'fulfilled'
      ? await Promise.allSettled(opportunitiesRaw.slice(0, MAX_OPPORTUNITY_DETAILS).map((item) => relationships.getOpportunity(item.id)))
      : [];
    const detailedById = new Map(opportunityDetailResults
      .filter((result) => result.status === 'fulfilled')
      .map((result) => [result.value?.opportunity?.id || result.value?.id, result.value]));
    const opportunities = opportunitiesRaw.slice(0, 50).map((item) => compactOpportunity(detailedById.get(item.id) || item));

    const weeklyRaw = asArray(settledValue(weeklyResult, []));
    const growthRaw = asArray(settledValue(growthResult, []));
    const legacyReviewsRaw = asArray(settledValue(legacyReviewResult, []));
    const weeklyReviews = weeklyRaw.slice(0, 20).map((item) => compactReview(item, 'weekly'));
    const growthReviews = growthRaw.slice(0, 30).map((item) => compactReview(item, 'growth'));
    const legacyReviews = legacyReviewsRaw.slice(0, 20).map((item) => compactReview(item, 'legacy'));
    const reviews = [...weeklyReviews, ...growthReviews, ...legacyReviews];

    const query = [
      compass.outcome_statement,
      compass.ninety_day_bet,
      ...compass.planning_state.nodes.map((node) => `${node.title} ${node.missing_evidence} ${node.next_validation}`),
      ...compass.planning_state.overall_gaps.map((gap) => `${gap.label} ${gap.primary_gap} ${gap.next_evidence}`),
      ...tasks.map((item) => item.title),
      ...events.map((item) => item.title),
      ...people.map((item) => `${item.name} ${item.current_goal}`),
      ...opportunities.map((item) => `${item.title} ${item.next_missing_evidence}`),
    ].filter(Boolean).join(' ').slice(0, 12000);
    const documentResult = await Promise.allSettled([
      documents.buildDecisionDocumentContext({ userId, query, maxBlocks: 12, domain: 'life' }),
    ]).then(([result]) => result);
    const documentContext = settledValue(documentResult, { corpus: {}, references: [], promptText: '' });
    const lifeDocuments = {
      corpus: documentContext.corpus || {},
      references: asArray(documentContext.references).slice(0, 12).map((reference) => ({
        ref_id: reference.ref_id,
        title: clip(reference.title, 300),
        heading: clip(reference.heading, 300),
        snippet: clip(reference.snippet, 500),
        updated_at: reference.updated_at || null,
      })),
      prompt_text: clip(documentContext.promptText, 12000),
    };

    const documentBlockCount = Number(documentContext?.corpus?.block_count || 0);
    const sourceStatus = {
      goals: sourceState(
        compassResult.status === 'fulfilled',
        compactedCompass.state.nodes.length,
        {
          included_count: compactedCompass.compass.planning_state.nodes.length,
          truncated: compactedCompass.truncation.goals
            || compactedCompass.truncation.overall_gaps
            || compactedCompass.truncation.stage_gap_groups,
        }
      ),
      planner: sourceState(
        taskResult.status === 'fulfilled' && eventResult.status === 'fulfilled',
        tasksRaw.length + eventsRaw.length,
        { included_count: tasks.length + events.length, truncated: tasksRaw.length > tasks.length || eventsRaw.length > events.length }
      ),
      people: sourceState(
        peopleResult.status === 'fulfilled',
        peopleRaw.length,
        { included_count: people.length, truncated: peopleRaw.length > people.length }
      ),
      interactions: sourceState(
        peopleResult.status === 'fulfilled' && workspaceResults.every((result) => result.status === 'fulfilled'),
        workspaces.reduce((count, workspace) => count + workspace.interactions.length, 0),
        {
          selected_people: selectedPeople.length,
          truncated: peopleRaw.length > selectedPeople.length,
        }
      ),
      opportunities: sourceState(
        opportunityResult.status === 'fulfilled',
        opportunitiesRaw.length,
        { included_count: opportunities.length, truncated: opportunitiesRaw.length > opportunities.length }
      ),
      reviews: sourceState(
        weeklyResult.status === 'fulfilled' && growthResult.status === 'fulfilled' && legacyReviewResult.status === 'fulfilled',
        weeklyRaw.length + growthRaw.length + legacyReviewsRaw.length,
        {
          included_count: reviews.length,
          truncated: weeklyRaw.length > weeklyReviews.length
            || growthRaw.length > growthReviews.length
            || legacyReviewsRaw.length > legacyReviews.length,
        }
      ),
      life_documents: sourceState(
        documentResult.status === 'fulfilled',
        Number(documentContext?.corpus?.document_count || lifeDocuments.references.length),
        {
          included_count: lifeDocuments.references.length,
          truncated: documentBlockCount > lifeDocuments.references.length,
        }
      ),
    };

    return {
      snapshot: {
        date: localDateKey(now),
        compass,
        planner: { tasks, events },
        people,
        relationship_workspaces: workspaces,
        opportunities,
        reviews,
        life_documents: lifeDocuments,
        source_coverage: sourceStatus,
        truncation: Object.fromEntries(Object.entries(sourceStatus)
          .filter(([, status]) => status.truncated)
          .map(([domain, status]) => [domain, {
            total: status.count,
            included: status.included_count ?? status.count,
          }])),
      },
      sourceStatus,
      baseCompass,
    };
  }

  async function persistGuidance(baseCompass, guidance) {
    const basedOnCompassVersion = Number.isSafeInteger(baseCompass?.version) ? baseCompass.version : null;
    if (!baseCompass || basedOnCompassVersion === null || typeof relationships.saveCompass !== 'function') {
      return {
        guidance,
        persisted: false,
        stale: false,
        basedOnCompassVersion,
        compassVersion: basedOnCompassVersion,
        warning: '今日判断已生成，但当前罗盘不支持安全持久化。',
      };
    }
    const nextPlanningState = normalizePlanningState({
      ...baseCompass.planning_state,
      daily_guidance: guidance,
    });
    try {
      const saved = await relationships.saveCompass(compassSaveInput(baseCompass, nextPlanningState));
      const savedGuidance = saved?.planning_state?.daily_guidance || guidance;
      return {
        guidance: savedGuidance,
        persisted: true,
        stale: false,
        basedOnCompassVersion,
        compassVersion: Number.isSafeInteger(saved?.version) ? saved.version : basedOnCompassVersion + 1,
        warning: null,
      };
    } catch (error) {
      if (isVersionConflict(error)) {
        let currentVersion = Number.isSafeInteger(error?.details?.currentVersion)
          ? error.details.currentVersion
          : basedOnCompassVersion;
        try {
          const current = await relationships.getCompass();
          if (Number.isSafeInteger(current?.version)) currentVersion = current.version;
        } catch {}
        return {
          guidance,
          persisted: false,
          stale: true,
          basedOnCompassVersion,
          compassVersion: currentVersion,
          warning: '生成期间罗盘已发生变化，本次判断未覆盖较新的目标数据。',
        };
      }
      return {
        guidance,
        persisted: false,
        stale: false,
        basedOnCompassVersion,
        compassVersion: basedOnCompassVersion,
        warning: '今日判断已生成，但保存失败；本次结果仅在当前会话可用。',
      };
    }
  }

  async function generateAndPersist({ snapshot, sourceStatus, baseCompass, hash }) {
    const generatedAt = nowProvider().toISOString();
    const catalog = buildSourceCatalog(snapshot);
    const unavailable = Object.entries(sourceStatus)
      .filter(([, status]) => !status.available)
      .map(([name]) => DATA_SOURCE_LABELS[name] || name);
    const truncated = Object.entries(sourceStatus)
      .filter(([, status]) => status.available && status.truncated)
      .map(([name]) => DATA_SOURCE_LABELS[name] || name);
    const contextWarnings = [];
    if (unavailable.length) {
      contextWarnings.push(`部分数据源暂不可用：${unavailable.join('、')}。`);
    }
    if (truncated.length) {
      contextWarnings.push(`以下数据源因内容较多而仅纳入高相关摘要：${truncated.join('、')}。`);
    }
    const partialWarning = contextWarnings.length
      ? `${contextWarnings.join(' ')}今日判断只基于明确纳入的数据。`
      : null;
    const dataSources = dataSourcesFromStatus(sourceStatus);
    const basedOnCompassVersion = Number.isSafeInteger(baseCompass?.version) ? baseCompass.version : null;
    const ai = getClient();
    let draft;

    if (!ai) {
      const fallbackWarning = [
        'LLM API 未配置。',
        partialWarning,
        '已使用目标与差距生成透明的动态提示。',
      ].filter(Boolean).join(' ');
      draft = {
        available: false,
        guidance: dynamicFallback(snapshot, catalog, fallbackWarning, generatedAt),
        warning: fallbackWarning,
      };
    } else {
      const sourceRefs = Array.from(catalog.entries()).map(([ref, source]) => ({ ref, ...source }));
      const promptSnapshot = { ...snapshot, source_catalog: sourceRefs };
      try {
        const completion = await ai.chat.completions.create({
          model: getLlmModel(),
          temperature: 0.1,
          messages: [
            {
              role: 'system',
              content: [
                '你是用户的“事业与处世罗盘”决策助手。根据提供的全部可用生活数据源，生成今天唯一的注意力判断。',
                '只输出 JSON 对象，不要 Markdown：{"focus":"","why":"","avoid":"","observe":"","source_refs":["goal:id"]}。',
                'focus 只能有一条主线；不要创建待办，不要假装执行了行动。',
                '优先解决当前阶段目标最关键的缺口，并同时尊重现实待办、关系承诺、商业证据和生活约束。',
                '区分事实与推断；资料不足时直接说明。source_refs 只能使用 source_catalog 中存在的 ref，最多 8 个。',
                `Prompt version: ${PROMPT_VERSION}`,
              ].join('\n'),
            },
            { role: 'user', content: JSON.stringify(promptSnapshot) },
          ],
        });
        const parsed = extractJsonObject(completion?.choices?.[0]?.message?.content || '');
        const guidance = normalizeAiGuidance(parsed, catalog, generatedAt);
        if (partialWarning) guidance.warning = partialWarning;
        draft = { available: true, guidance, warning: partialWarning };
      } catch (error) {
        const warning = partialWarning
          ? `${partialWarning} AI 生成失败，已使用动态回退。`
          : 'AI 生成失败，已使用目标与差距生成透明的动态回退。';
        draft = {
          available: false,
          guidance: dynamicFallback(snapshot, catalog, warning, generatedAt),
          warning,
        };
      }
    }

    const guidance = {
      ...draft.guidance,
      data_sources: dataSources,
      snapshot_hash: hash,
      based_on_compass_version: basedOnCompassVersion,
    };
    const persistence = await persistGuidance(baseCompass, guidance);
    const persistenceWarning = persistence.warning;
    const finalGuidance = {
      ...persistence.guidance,
      warning: appendWarning(persistence.guidance.warning, persistenceWarning),
    };
    return {
      available: draft.available,
      cached: false,
      generated_at: generatedAt,
      guidance: finalGuidance,
      source_status: sourceStatus,
      warning: appendWarning(draft.warning, persistenceWarning),
      based_on_compass_version: persistence.basedOnCompassVersion,
      compass_version: persistence.compassVersion,
      persisted: persistence.persisted,
      stale: persistence.stale,
    };
  }

  async function generateDailyGuidance(input = {}) {
    const { snapshot, sourceStatus, baseCompass } = await buildDecisionSnapshot();
    const hash = stableHash(snapshot);
    const cacheKey = `${userId}:${snapshot.date}:${hash}`;
    const baseVersion = Number.isSafeInteger(baseCompass?.version) ? baseCompass.version : null;

    if (inFlight.has(cacheKey)) {
      const result = await inFlight.get(cacheKey);
      return { ...result, cached: true };
    }

    if (!input.refresh) {
      const cached = cache.get(cacheKey);
      if (cached && cached.compass_version === baseVersion) return { ...cached, cached: true };

      const storedGuidance = baseCompass?.planning_state?.daily_guidance || null;
      if (storedGuidance?.snapshot_hash === hash) {
        const restoredGuidance = {
          ...storedGuidance,
          data_sources: asArray(storedGuidance.data_sources).length === Object.keys(DATA_SOURCE_LABELS).length
            ? storedGuidance.data_sources
            : dataSourcesFromStatus(sourceStatus),
        };
        const restored = {
          available: restoredGuidance.fallback !== true,
          cached: true,
          generated_at: restoredGuidance.generated_at || nowProvider().toISOString(),
          guidance: restoredGuidance,
          source_status: sourceStatus,
          warning: restoredGuidance.warning || null,
          based_on_compass_version: Number.isSafeInteger(restoredGuidance.based_on_compass_version)
            ? restoredGuidance.based_on_compass_version
            : Math.max(0, (baseVersion || 1) - 1),
          compass_version: baseVersion,
          persisted: true,
          stale: false,
        };
        if (cache.size >= MAX_CACHE_ENTRIES) cache.clear();
        cache.set(cacheKey, restored);
        return restored;
      }
    }

    const operation = generateAndPersist({ snapshot, sourceStatus, baseCompass, hash });
    inFlight.set(cacheKey, operation);
    try {
      const result = await operation;
      if (cache.size >= MAX_CACHE_ENTRIES) cache.clear();
      cache.set(cacheKey, result);
      return result;
    } finally {
      if (inFlight.get(cacheKey) === operation) inFlight.delete(cacheKey);
    }
  }

  return {
    buildDecisionSnapshot,
    generateDailyGuidance,
  };
}

const compassGuidanceService = createCompassGuidanceService();

module.exports = compassGuidanceService;
module.exports.createCompassGuidanceService = createCompassGuidanceService;
module.exports.__test = {
  buildSourceCatalog,
  dynamicFallback,
  localDateKey,
  normalizeAiGuidance,
  stableHash,
};
