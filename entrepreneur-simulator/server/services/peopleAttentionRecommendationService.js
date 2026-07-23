const crypto = require('crypto');
const OpenAI = require('openai');

const relationshipsDefault = require('./relationshipSystemRuntimeService');
const { getLlmApiKey, getLlmModel, getOpenAIClientOptions } = require('./llmConfig');
const { extractJsonObject } = require('../utils/aiResponse');

const PROMPT_VERSION = 'people-attention-overview-v1';
const CURRENT_ATTENTION_STATUSES = new Set(['focus', 'repair', 'boundary']);
const MAX_WORKSPACES = 40;
const MAX_RECOMMENDATIONS = 5;
const LIFE_DOMAIN_BY_CONTEXT = Object.freeze({
  family: '家庭',
  partner: '亲密关系',
  friend: '朋友',
  mentor: '导师与成长',
  colleague: '事业与协作',
  business: '事业与合作',
  customer: '事业与客户',
  other: '综合生活',
});

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function clip(value, max = 1000) {
  const text = value === undefined || value === null ? '' : String(value).trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function primaryContext(person) {
  const contexts = asArray(person?.contexts);
  return contexts.find((item) => item.is_primary) || contexts[0] || null;
}

function sourceRef(ref, type, label, summary, sourceId = null, occurredAt = null) {
  return {
    ref,
    type,
    label: clip(label, 300),
    summary: clip(summary, 1200),
    sourceId,
    ...(occurredAt ? { occurredAt } : {}),
  };
}

function localDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function datePlusDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return localDate(next);
}

function stableHash(value) {
  const stableValue = (item) => {
    if (Array.isArray(item)) return item.map(stableValue);
    if (!item || typeof item !== 'object') return item === undefined ? null : item;
    return Object.fromEntries(Object.keys(item).sort().map((key) => [key, stableValue(item[key])]));
  };
  return crypto.createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');
}

function inferLifeDomains(person) {
  const values = asArray(person?.contexts)
    .map((item) => LIFE_DOMAIN_BY_CONTEXT[item.context_type] || LIFE_DOMAIN_BY_CONTEXT.other);
  return Array.from(new Set(values.length ? values : [LIFE_DOMAIN_BY_CONTEXT.other]));
}

function isRecent(value, now, days = 45) {
  const date = new Date(value || '');
  return !Number.isNaN(date.getTime()) && now.getTime() - date.getTime() <= days * 86400000;
}

function evidenceForPerson(person, compass, commitments) {
  const context = primaryContext(person);
  const refs = [sourceRef(
    `person:${person.id}`,
    'person',
    person.name || '人物',
    [person.identity, person.field, ...asArray(person.tags)].filter(Boolean).join('；') || '已进入关系库',
    person.id
  )];
  if (context) {
    const contextSummary = [context.label, context.current_goal, context.current_state, context.why_matters_now]
      .filter(Boolean).join('；');
    if (contextSummary) refs.push(sourceRef(
      `context:${context.id}`,
      'context',
      `${person.name || '人物'}的关系上下文`,
      contextSummary,
      context.id
    ));
  }
  if (person.last_interaction?.id) refs.push(sourceRef(
    `interaction:${person.last_interaction.id}`,
    'interaction',
    `${person.name || '人物'}的最近互动`,
    person.last_interaction.summary || '存在最近互动',
    person.last_interaction.id,
    person.last_interaction.occurred_at
  ));
  for (const commitment of commitments.slice(0, 3)) refs.push(sourceRef(
    `commitment:${commitment.id}`,
    'commitment',
    `与${person.name || '此人'}有关的承诺`,
    commitment.title || commitment.text || commitment.content || '存在尚未完成的承诺',
    commitment.id,
    commitment.due_at || commitment.dueAt || null
  ));
  return refs;
}

function confidenceFromEvidence(evidenceRefs) {
  const types = new Set(asArray(evidenceRefs).map((item) => item?.type).filter(Boolean));
  const concreteTypes = ['context', 'interaction', 'commitment'].filter((type) => types.has(type));
  if (concreteTypes.length >= 3) return 'strong';
  if (concreteTypes.length >= 2 || types.has('interaction') || types.has('commitment')) return 'moderate';
  return 'initial';
}

function fallbackRecommendations(snapshot, now) {
  const commitmentsByPerson = new Map();
  for (const item of snapshot.due_commitments) {
    const personId = item.person_id || item.personId;
    if (!personId) continue;
    const rows = commitmentsByPerson.get(personId) || [];
    rows.push(item);
    commitmentsByPerson.set(personId, rows);
  }
  return snapshot.people
    .filter((person) => !CURRENT_ATTENTION_STATUSES.has(primaryContext(person)?.attention_status))
    .map((person) => {
      const context = primaryContext(person);
      const commitments = commitmentsByPerson.get(person.id) || [];
      const recent = isRecent(person.last_interaction?.occurred_at, now);
      const score = commitments.length * 8
        + (context?.current_goal ? 5 : 0)
        + (context?.why_matters_now ? 4 : 0)
        + (context?.current_state ? 2 : 0)
        + (recent ? 3 : 0);
      if (!score) return null;
      const goal = clip(context?.current_goal, 300);
      const reason = clip(context?.why_matters_now, 600)
        || (goal ? `这段关系与“${goal}”有关，值得确认现在是否需要投入注意力。` : '')
        || (commitments.length ? '你们之间存在尚未完成的承诺，值得确认关系状态。' : '')
        || '最近有真实互动，值得确认关系是否发生变化。';
      const whyNow = commitments.length
        ? '当前存在尚未完成的承诺，延迟回应可能增加关系成本。'
        : (recent ? '近期互动提供了新的真实信号，现在适合确认彼此状态。' : '当前关系资料显示存在明确目标或状态变化。');
      const configuredObservation = clip(asObject(context?.urgency).observe_next, 600);
      const observeNext = configuredObservation
        || (goal ? `观察对方是否愿意围绕“${goal}”给出明确回应或投入。` : '观察下一次互动中，对方是否主动回应、投入或说明边界。');
      const evidenceRefs = evidenceForPerson(person, snapshot.compass, commitments).slice(0, 6);
      return {
        personId: person.id,
        reason,
        whyNow,
        lifeDomains: inferLifeDomains(person),
        observeNext,
        evidenceRefs,
        confidence: confidenceFromEvidence(evidenceRefs),
        suggestedUntil: datePlusDays(now, 14),
        score,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.personId.localeCompare(b.personId))
    .slice(0, MAX_RECOMMENDATIONS)
    .map(({ score, ...item }) => item);
}

function normalizeAiRecommendations(parsed, snapshot, now) {
  if (!parsed || !Array.isArray(parsed.recommendations)) {
    const error = new Error('AI response did not contain a recommendations array.');
    error.code = 'AI_INVALID_OUTPUT';
    throw error;
  }
  const peopleById = new Map(snapshot.people.map((person) => [person.id, person]));
  const commitmentsByPerson = new Map();
  for (const item of snapshot.due_commitments) {
    const id = item.person_id || item.personId;
    const rows = commitmentsByPerson.get(id) || [];
    rows.push(item);
    commitmentsByPerson.set(id, rows);
  }
  const seen = new Set();
  const output = [];
  for (const raw of asArray(parsed?.recommendations).slice(0, MAX_RECOMMENDATIONS)) {
    const personId = String(raw?.person_id || raw?.personId || '').trim();
    const person = peopleById.get(personId);
    if (!person || seen.has(personId) || CURRENT_ATTENTION_STATUSES.has(primaryContext(person)?.attention_status)) continue;
    const catalog = new Map(evidenceForPerson(person, snapshot.compass, commitmentsByPerson.get(personId) || [])
      .map((item) => [item.ref, item]));
    const selectedRefs = asArray(raw.source_refs || raw.evidence_refs)
      .map((ref) => catalog.get(String(ref)))
      .filter(Boolean);
    // A generic person record does not support a time-sensitive attention
    // recommendation on its own. Invalid refs are never silently replaced.
    if (!selectedRefs.some((item) => ['context', 'interaction', 'commitment'].includes(item.type))) continue;
    const reason = clip(raw.reason, 1000);
    const whyNow = clip(raw.why_now || raw.whyNow, 1000);
    const observeNext = clip(raw.observe_next || raw.observeNext, 1000);
    if (!reason || !whyNow || !observeNext || !selectedRefs.filter(Boolean).length) continue;
    const allowedDomains = new Set(inferLifeDomains(person));
    const requestedDomains = asArray(raw.life_domains || raw.lifeDomains).map(String).filter((item) => allowedDomains.has(item));
    output.push({
      personId,
      reason,
      whyNow,
      lifeDomains: requestedDomains.length ? requestedDomains : Array.from(allowedDomains),
      observeNext,
      evidenceRefs: selectedRefs.filter(Boolean).slice(0, 8),
      confidence: confidenceFromEvidence(selectedRefs),
      suggestedUntil: /^\d{4}-\d{2}-\d{2}$/.test(String(raw.suggested_until || raw.suggestedUntil || ''))
        ? String(raw.suggested_until || raw.suggestedUntil)
        : datePlusDays(now, 14),
    });
    seen.add(personId);
  }
  if (parsed.recommendations.length > 0 && output.length === 0) {
    const error = new Error('Every AI recommendation failed person, evidence, or field validation.');
    error.code = 'AI_INVALID_OUTPUT';
    throw error;
  }
  return output;
}

function createPeopleAttentionRecommendationService(options = {}) {
  const relationships = options.relationships || relationshipsDefault;
  const nowProvider = options.nowProvider || (() => new Date());
  const injectedGenerator = options.recommendationGenerator || null;
  let aiClient = options.aiClient || null;

  function getClient() {
    if (injectedGenerator) return null;
    if (aiClient) return aiClient;
    if (!getLlmApiKey()) return null;
    aiClient = new OpenAI(getOpenAIClientOptions());
    return aiClient;
  }

  async function buildSnapshot() {
    const [peopleResult, compassResult, todayResult, opportunitiesResult, reviewsResult, growthResult] = await Promise.allSettled([
      relationships.listPeople({ limit: 200 }),
      relationships.getCompass(),
      relationships.getToday(),
      relationships.listOpportunities({ limit: 50 }),
      relationships.listWeeklyReviews({ limit: 20 }),
      relationships.listGrowthPatterns({ limit: 30 }),
    ]);
    const people = peopleResult.status === 'fulfilled' ? asArray(peopleResult.value) : [];
    const compass = compassResult.status === 'fulfilled' ? compassResult.value : null;
    const today = todayResult.status === 'fulfilled' ? asObject(todayResult.value) : {};
    // Analyze a stable slice of all people. If this slice were limited to the
    // current library, accepting one draft would change the source hash and
    // immediately create another run even though no new relationship evidence
    // appeared.
    const workspacePeople = people.slice(0, MAX_WORKSPACES);
    const workspaceResults = await Promise.allSettled(workspacePeople.map((person) => relationships.getPersonWorkspace(person.id)));
    const workspaces = workspaceResults.filter((item) => item.status === 'fulfilled').map((item) => item.value);
    const sourceStatus = {
      people: { available: peopleResult.status === 'fulfilled', count: people.length, included: workspacePeople.length },
      goals: { available: compassResult.status === 'fulfilled', count: asArray(compass?.planning_state?.nodes).length },
      interactions: {
        available: workspaceResults.every((item) => item.status === 'fulfilled'),
        count: workspaces.reduce((total, item) => total + asArray(item.interactions).length, 0),
        includedPeople: workspaces.length,
      },
      commitments: { available: todayResult.status === 'fulfilled', count: asArray(today.due_commitments).length },
      opportunities: { available: opportunitiesResult.status === 'fulfilled', count: asArray(opportunitiesResult.value).length },
      reviews: {
        available: reviewsResult.status === 'fulfilled' && growthResult.status === 'fulfilled',
        count: asArray(reviewsResult.value).length + asArray(growthResult.value).length,
      },
    };
    const truncated = people.length > workspacePeople.length;
    const warningParts = [];
    const unavailable = Object.entries(sourceStatus).filter(([, value]) => !value.available).map(([key]) => key);
    if (unavailable.length) warningParts.push(`部分数据源暂不可用：${unavailable.join('、')}。`);
    if (truncated) warningParts.push(`人物较多，本轮仅分析最近的 ${MAX_WORKSPACES} 位候选人物。`);
    const snapshot = {
      generated_date: localDate(nowProvider()),
      people,
      compass,
      due_commitments: asArray(today.due_commitments),
      opportunities: opportunitiesResult.status === 'fulfilled' ? asArray(opportunitiesResult.value).slice(0, 30) : [],
      reviews: reviewsResult.status === 'fulfilled' ? asArray(reviewsResult.value).slice(0, 10) : [],
      growth_patterns: growthResult.status === 'fulfilled' ? asArray(growthResult.value).slice(0, 20) : [],
      workspaces: workspaces.map((item) => ({
        person_id: item.person?.id,
        interactions: asArray(item.interactions).slice(0, 20),
        claims: asArray(item.claims).slice(0, 20),
        decisions: asArray(item.decisions).slice(0, 10),
      })),
      source_status: sourceStatus,
    };
    const commitmentsByPerson = new Map();
    for (const commitment of snapshot.due_commitments) {
      const personId = commitment.person_id || commitment.personId;
      if (!personId) continue;
      const values = commitmentsByPerson.get(personId) || [];
      values.push(commitment);
      commitmentsByPerson.set(personId, values);
    }
    snapshot.source_catalog = people.map((person) => ({
      person_id: person.id,
      refs: evidenceForPerson(person, compass, commitmentsByPerson.get(person.id) || []),
    }));
    // Attention state, focus reason and observe_next are deliberately excluded:
    // accepting/dismissing a recommendation must not create a new source run.
    const fingerprint = {
      people: people.map((person) => ({
        id: person.id,
        name: person.name,
        identity: person.identity,
        field: person.field,
        tags: person.tags,
        birthday: person.birthday,
        contexts: asArray(person.contexts).map((context) => ({
          id: context.id,
          context_type: context.context_type,
          label: context.label,
          current_state: context.current_state,
          current_goal: context.current_goal,
          mutual_value: context.mutual_value,
          boundaries: context.boundaries,
        })),
        last_interaction: person.last_interaction,
      })),
      compass,
      due_commitments: snapshot.due_commitments,
      opportunities: snapshot.opportunities,
      reviews: snapshot.reviews,
      growth_patterns: snapshot.growth_patterns,
      workspaces: snapshot.workspaces,
    };
    return { snapshot, snapshotHash: stableHash(fingerprint), sourceStatus, warning: warningParts.join(' ') || null };
  }

  async function generateRecommendations(input = {}) {
    const now = nowProvider();
    const { snapshot, snapshotHash, sourceStatus, warning: sourceWarning } = await buildSnapshot();
    const previousRun = await relationships.getLatestAttentionRecommendationRun();
    if (!input.refresh && previousRun?.input_snapshot?.snapshot_hash === snapshotHash) {
      return { ...(await relationships.getPeopleOverview()), cached: true };
    }

    const rejected = await relationships.listAttentionRecommendations({ status: 'rejected', limit: 200 });
    const dismissedForSnapshot = new Set(rejected
      .filter((item) => item?.error?.code === 'USER_DISMISSED')
      .filter((item) => item?.input_snapshot?.snapshot_hash === snapshotHash)
      .map((item) => item.person_id)
      .filter(Boolean));

    let recommendations;
    let runStatus;
    let warning = sourceWarning;
    let model = null;
    try {
      if (injectedGenerator) {
        const parsed = await injectedGenerator(snapshot);
        recommendations = normalizeAiRecommendations(parsed, snapshot, now)
          .filter((item) => !dismissedForSnapshot.has(item.personId));
        runStatus = recommendations.length ? 'ai' : 'empty';
        model = 'injected-generator';
      } else {
        const client = getClient();
        if (!client) throw Object.assign(new Error('LLM API is not configured.'), { code: 'AI_UNAVAILABLE' });
        const response = await client.chat.completions.create({
          model: getLlmModel(),
          temperature: 0.1,
          messages: [
            {
              role: 'system',
              content: [
                '你是“人物注意力与相处判断”助手。请从完整人生而非单一商业价值出发，平等考虑事业、家庭、朋友、亲密关系、导师与生活责任。',
                '只推荐当前不在 focus/repair/boundary 的人物，最多5人；推荐只是待确认草稿，绝不能声称已经改变关注名单。',
                '区分事实与推测。每条建议必须说明为什么值得关注、为什么是现在、下一次只观察一个可见信号，并引用该人物可用的 source_refs。',
                '只输出 JSON：{"recommendations":[{"person_id":"","reason":"","why_now":"","life_domains":[""],"observe_next":"","confidence":"initial|moderate|strong","suggested_until":"YYYY-MM-DD","source_refs":[""]}]}。',
                `Prompt version: ${PROMPT_VERSION}`,
              ].join('\n'),
            },
            { role: 'user', content: JSON.stringify(snapshot) },
          ],
        });
        model = getLlmModel();
        const parsed = extractJsonObject(response?.choices?.[0]?.message?.content || '');
        recommendations = normalizeAiRecommendations(parsed, snapshot, now)
          .filter((item) => !dismissedForSnapshot.has(item.personId));
        runStatus = recommendations.length ? 'ai' : 'empty';
      }
    } catch (error) {
      recommendations = fallbackRecommendations(snapshot, now)
        .filter((item) => !dismissedForSnapshot.has(item.personId));
      runStatus = 'fallback';
      warning = [sourceWarning, `AI 推荐暂不可用（${error?.code || 'GENERATION_FAILED'}），以下为基于明确关系资料与时间信号的规则建议，仍需你确认。`]
        .filter(Boolean).join(' ');
    }

    await relationships.replaceAttentionRecommendations({
      recommendations,
      inputSnapshot: { snapshot_hash: snapshotHash, source_status: sourceStatus },
      runStatus,
      warning,
      model,
      promptVersion: PROMPT_VERSION,
    });
    return { ...(await relationships.getPeopleOverview()), cached: false };
  }

  return { buildSnapshot, generateRecommendations };
}

const service = createPeopleAttentionRecommendationService();

module.exports = service;
module.exports.createPeopleAttentionRecommendationService = createPeopleAttentionRecommendationService;
module.exports.__test = {
  fallbackRecommendations,
  confidenceFromEvidence,
  inferLifeDomains,
  normalizeAiRecommendations,
  primaryContext,
  stableHash,
};
