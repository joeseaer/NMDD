import { CURRENT_USER_ID } from '../../config/currentUser';
import type {
  AttentionState,
  BusinessOpportunity,
  ClaimStatus,
  Commitment,
  CompassGap,
  CompassPageData,
  CompassPlan,
  DailyGuidance,
  DailyGuidanceSource,
  DecisionOutcome,
  DecisionOption,
  DecisionProposal,
  ExtractedInteractionDraft,
  GoalNode,
  GoalNodeStatus,
  GrowthData,
  Interaction,
  LegacyPerson,
  OpportunityEvidence,
  OpportunityExperiment,
  OpportunityStage,
  AttentionRecommendation,
  AttentionRecommendationEvidence,
  AttentionRecommendationRun,
  PeopleOverviewData,
  PersonClaim,
  PrimaryRelationshipContext,
  PersonSummary,
  PersonWorkspace,
  PlannerTaskSummary,
  PlanningState,
  RelationshipDecision,
  TodayData,
  WeeklyReviewAction,
  WeeklyReviewDraft,
} from './model';

const API_BASE_URL = '/api/relationship-system';
const LEGACY_API_BASE_URL = '/api';

type UnknownRecord = Record<string, unknown>;

export class RelationshipApiError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'RelationshipApiError';
    this.status = status;
    this.details = details;
  }
}

const isRecord = (value: unknown): value is UnknownRecord => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const record = (value: unknown): UnknownRecord => isRecord(value) ? value : {};
const stringValue = (value: unknown, fallback = '') => typeof value === 'string' ? value : fallback;
const nullableString = (value: unknown) => typeof value === 'string' && value.trim() ? value : null;
const numberValue = (value: unknown, fallback = 0) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const arrayValue = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const stringList = (value: unknown): string[] => Array.isArray(value)
  ? value.map((item) => typeof item === 'string'
      ? item
      : stringValue(record(item).summary || record(item).title || record(item).text || record(item).message))
    .filter(Boolean)
  : [];

const unwrap = (value: unknown): unknown => {
  if (!isRecord(value)) return value;
  return Object.prototype.hasOwnProperty.call(value, 'data') ? value.data : value;
};

const parseErrorMessage = (payload: unknown, status: number) => {
  const body = record(payload);
  return stringValue(body.message || body.error || body.detail, `请求失败（HTTP ${status}）`);
};

export async function relationshipRequest<T>(
  path: string,
  options: RequestInit & { baseUrl?: string } = {},
): Promise<T> {
  const { baseUrl = API_BASE_URL, headers, ...init } = options;
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
  });

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    throw new RelationshipApiError(parseErrorMessage(payload, response.status), response.status, payload);
  }
  return unwrap(payload) as T;
}

const queryString = (extra?: Record<string, string | undefined>) => {
  const params = new URLSearchParams();
  Object.entries(extra || {}).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  return params.toString();
};

const attentionValues: AttentionState[] = ['focus', 'maintain', 'observe', 'repair', 'boundary', 'dormant', 'archived'];
const opportunityStages: OpportunityStage[] = ['signal', 'problem_hypothesis', 'interview', 'offer_test', 'paid_validation', 'repeatable', 'scaling', 'stopped', 'archived'];

const normalizeAttention = (value: unknown): AttentionState => value === 'sleep'
  ? 'dormant'
  : attentionValues.includes(value as AttentionState)
  ? value as AttentionState
  : 'observe';

const normalizeOpportunityStage = (value: unknown): OpportunityStage => opportunityStages.includes(value as OpportunityStage)
  ? value as OpportunityStage
  : 'signal';

export const normalizePerson = (value: unknown): PersonSummary => {
  const item = record(value);
  return {
    id: stringValue(item.id),
    name: stringValue(item.name, '未命名'),
    identity: nullableString(item.identity || item.position),
    field: nullableString(item.field || item.industry),
    roles: stringList(item.roles || item.relationshipRoles || item.relationship_roles),
    tags: stringList(item.tags),
    attention_state: normalizeAttention(item.attentionState || item.attention_state),
    focus_reason: nullableString(item.focusReason || item.focus_reason),
    last_interaction_at: nullableString(item.lastInteractionAt || item.last_interaction_at),
    last_interaction_summary: nullableString(item.lastInteractionSummary || item.last_interaction_summary || item.last_interaction),
    primary_context_id: nullableString(item.primaryContextId || item.primary_context_id),
    context_version: typeof item.contextVersion === 'number'
      ? item.contextVersion
      : typeof item.context_version === 'number'
        ? item.context_version
        : undefined,
    current_goal: nullableString(item.currentGoal || item.current_goal),
    current_state: nullableString(item.currentState || item.current_state),
    observe_next: nullableString(item.observeNext || item.observe_next),
    attention_layer: item.attentionLayer === 'current' || item.attention_layer === 'current'
      ? 'current'
      : item.attentionLayer === 'library' || item.attention_layer === 'library'
        ? 'library'
        : null,
    current_attention: typeof item.currentAttention === 'boolean'
      ? item.currentAttention
      : typeof item.current_attention === 'boolean'
        ? item.current_attention
        : undefined,
    relationship_mode: nullableString(item.relationshipMode || item.relationship_mode),
    updated_at: nullableString(item.updatedAt || item.updated_at),
    version: typeof item.version === 'number' ? item.version : undefined,
    is_legacy: Boolean(item.isLegacy || item.is_legacy),
  };
};

const normalizeAttentionEvidence = (value: unknown): AttentionRecommendationEvidence => {
  if (typeof value === 'string') return { label: value };
  const item = record(value);
  return {
    id: nullableString(item.id || item.refId || item.ref_id),
    type: nullableString(item.type || item.domain || item.sourceType || item.source_type),
    label: stringValue(item.label || item.summary || item.title || item.ref, '未命名依据'),
    summary: nullableString(item.summary),
    occurred_at: nullableString(item.occurredAt || item.occurred_at),
    source_id: nullableString(item.sourceId || item.source_id || item.ref),
  };
};

const normalizeRecommendationRun = (value: unknown): AttentionRecommendationRun | null => {
  if (!value) return null;
  const item = record(value);
  const rawStatus = stringValue(item.status);
  const sourceStatus = Object.fromEntries(Object.entries(record(item.sourceStatus || item.source_status)).map(([domain, raw]) => {
    const status = record(raw);
    return [domain, {
      available: status.available !== false,
      count: numberValue(status.count),
      error: nullableString(status.error),
    }];
  }));
  return {
    id: stringValue(item.id),
    generated_at: nullableString(item.generatedAt || item.generated_at),
    snapshot_hash: nullableString(item.snapshotHash || item.snapshot_hash),
    status: rawStatus === 'ai' || rawStatus === 'fallback' ? rawStatus : 'empty',
    warning: nullableString(item.warning),
    source_status: sourceStatus,
    recommendation_count: numberValue(item.recommendationCount || item.recommendation_count),
    model: nullableString(item.model),
    prompt_version: nullableString(item.promptVersion || item.prompt_version),
  };
};

const normalizeAttentionRecommendation = (value: unknown): AttentionRecommendation => {
  const item = record(value);
  const person = normalizePerson(item.person);
  const rawStatus = stringValue(item.status);
  return {
    id: stringValue(item.id),
    person_id: stringValue(item.personId || item.person_id, person.id),
    person,
    status: rawStatus === 'accepted' || rawStatus === 'dismissed' ? rawStatus : 'pending',
    reason: nullableString(item.reason),
    why_now: nullableString(item.whyNow || item.why_now),
    life_domains: stringList(item.lifeDomains || item.life_domains),
    observe_next: nullableString(item.observeNext || item.observe_next),
    evidence_refs: arrayValue(item.evidenceRefs || item.evidence_refs).map(normalizeAttentionEvidence),
    confidence: nullableString(item.confidence),
    suggested_until: nullableString(item.suggestedUntil || item.suggested_until),
    generated_at: nullableString(item.generatedAt || item.generated_at),
    version: typeof item.version === 'number' ? item.version : undefined,
  };
};

const normalizePeopleOverview = (value: unknown): PeopleOverviewData => {
  const item = record(value);
  const recommendations = arrayValue(item.recommendations).map(normalizeAttentionRecommendation);
  const attentionPeople = arrayValue(item.attentionPeople || item.attention_people).map(normalizePerson);
  const libraryPeople = arrayValue(item.libraryPeople || item.library_people).map(normalizePerson);
  const rawCounts = record(item.counts);
  return {
    generated_at: nullableString(item.generatedAt || item.generated_at),
    recommendations,
    attention_people: attentionPeople,
    library_people: libraryPeople,
    counts: {
      tracked: numberValue(rawCounts.trackedPeople || rawCounts.tracked_people || rawCounts.tracked || rawCounts.total, attentionPeople.length + libraryPeople.length),
      attention: numberValue(rawCounts.currentAttention || rawCounts.current_attention || rawCounts.attention || rawCounts.focused, attentionPeople.length),
      library: numberValue(rawCounts.relationshipLibrary || rawCounts.relationship_library || rawCounts.library, libraryPeople.length),
      recommendations: numberValue(rawCounts.pendingRecommendations || rawCounts.pending_recommendations || rawCounts.recommendations, recommendations.length),
    },
    recommendation_run: normalizeRecommendationRun(item.recommendationRun || item.recommendation_run),
    cached: typeof item.cached === 'boolean' ? item.cached : undefined,
    warning: nullableString(item.warning),
  };
};

const normalizeCommitment = (value: unknown): Commitment => {
  const item = record(value);
  const rawOwner = stringValue(item.owner || item.promisedBy || item.promised_by);
  const owner: Commitment['owner'] = rawOwner === 'them' || rawOwner === 'shared' ? rawOwner : 'me';
  const rawStatus = stringValue(item.status);
  const status: Commitment['status'] = rawStatus === 'done' || rawStatus === 'cancelled' ? rawStatus : 'open';
  return {
    id: stringValue(item.id, `draft-${Math.random().toString(16).slice(2)}`),
    person_id: nullableString(item.personId || item.person_id),
    person_name: nullableString(item.personName || item.person_name),
    title: stringValue(item.title || item.content || item.summary),
    owner,
    due_at: nullableString(item.dueAt || item.due_at),
    status,
    source_interaction_id: nullableString(item.sourceInteractionId || item.source_interaction_id),
  };
};

const normalizeEvidence = (value: unknown): OpportunityEvidence => {
  const item = record(value);
  const allowed: OpportunityEvidence['kind'][] = ['complaint', 'repeated_problem', 'workaround', 'existing_spend', 'quote', 'payment', 'repeat', 'referral', 'other'];
  const rawKind = stringValue(item.kind);
  return {
    id: stringValue(item.id, `evidence-${Math.random().toString(16).slice(2)}`),
    kind: allowed.includes(rawKind as OpportunityEvidence['kind']) ? rawKind as OpportunityEvidence['kind'] : 'other',
    summary: stringValue(item.summary || item.content || item.evidence),
    person_id: nullableString(item.personId || item.person_id),
    person_name: nullableString(item.personName || item.person_name),
    amount: typeof item.amount === 'number' ? item.amount : typeof item.amountCents === 'number' ? item.amountCents / 100 : null,
    occurred_at: nullableString(item.occurredAt || item.occurred_at || item.createdAt || item.created_at),
  };
};

const normalizeExperiment = (value: unknown): OpportunityExperiment => {
  const item = record(value);
  const rawStatus = stringValue(item.status);
  const status: OpportunityExperiment['status'] = rawStatus === 'running' || rawStatus === 'completed' || rawStatus === 'cancelled' ? rawStatus : 'planned';
  return {
    id: stringValue(item.id),
    opportunity_id: stringValue(item.opportunityId || item.opportunity_id),
    hypothesis: stringValue(item.hypothesis),
    method: stringValue(item.method || item.type),
    success_signal: stringValue(item.successCriteria || item.success_signal),
    due_at: nullableString(item.plannedAt || item.due_at),
    status,
    result: nullableString(item.result),
    evidence: nullableString(item.evidence),
    payment_amount: typeof item.amountCents === 'number' ? item.amountCents / 100 : typeof item.payment_amount === 'number' ? item.payment_amount : null,
    next_decision: ['continue', 'adjust', 'stop'].includes(stringValue(item.nextDecision || item.next_decision))
      ? stringValue(item.nextDecision || item.next_decision) as OpportunityExperiment['next_decision']
      : null,
    created_at: nullableString(item.createdAt || item.created_at),
  };
};

export const normalizeOpportunity = (value: unknown): BusinessOpportunity => {
  const item = record(value);
  return {
    id: stringValue(item.id),
    title: stringValue(item.title, '未命名机会'),
    problem: stringValue(item.problem || item.problemStatement || item.problem_statement),
    customer: nullableString(item.customer || item.customerSegment || item.customer_segment),
    user_role: nullableString(item.userRole || item.user_role),
    beneficiary_role: nullableString(item.beneficiaryRole || item.beneficiary_role),
    decision_maker_role: nullableString(item.decisionMakerRole || item.decision_maker_role),
    payer_role: nullableString(item.payerRole || item.payer_role),
    frequency: nullableString(item.frequency),
    cost: nullableString(item.cost),
    urgency: nullableString(item.urgency),
    current_workaround: nullableString(item.currentWorkaround || item.current_workaround),
    access_advantage: nullableString(item.accessAdvantage || item.access_advantage),
    missing_evidence: nullableString(item.missingEvidence || item.missing_evidence),
    next_experiment: nullableString(item.nextExperiment || item.next_experiment),
    stage: normalizeOpportunityStage(item.stage),
    evidence: Array.isArray(item.evidence) ? item.evidence.map(normalizeEvidence) : [],
    experiments: Array.isArray(item.experiments) ? item.experiments.map(normalizeExperiment) : [],
    related_people: arrayValue(item.relatedPeople || item.related_people).map(normalizePerson),
    cashflow_total: typeof item.cashflowTotal === 'number' ? item.cashflowTotal : typeof item.cashflow_total === 'number' ? item.cashflow_total : null,
    updated_at: nullableString(item.updatedAt || item.updated_at),
    version: typeof item.version === 'number' ? item.version : undefined,
  };
};

const normalizeInteraction = (value: unknown): Interaction => {
  const item = record(value);
  const rawMatch = stringValue(item.predictionMatch || item.prediction_match);
  const predictionMatch: Interaction['prediction_match'] = ['matched', 'partly', 'not_matched', 'unknown'].includes(rawMatch)
    ? rawMatch as NonNullable<Interaction['prediction_match']>
    : null;
  return {
    id: stringValue(item.id),
    person_id: stringValue(item.personId || item.person_id),
    occurred_at: stringValue(item.occurredAt || item.occurred_at || item.event_date || item.createdAt || item.created_at, new Date().toISOString()),
    context: nullableString(item.eventContext || item.context || item.event_context),
    facts: stringList(item.observedFacts || item.facts),
    my_action: nullableString(item.myAction || item.my_action || item.my_behavior || stringList(item.myActions).join('；')),
    their_reaction: nullableString(item.theirReaction || item.their_reaction || stringList(item.theirReactions).join('；')),
    my_feelings: stringList(item.myFeelings || item.my_feelings),
    interpretation: nullableString(item.interpretation || stringList(item.interpretations).join('；')),
    actual_result: nullableString(item.actualResult || item.actual_result),
    prediction_match: predictionMatch,
    commitments: Array.isArray(item.commitments) ? item.commitments.map(normalizeCommitment) : [],
    opportunity_signal_ids: stringList(item.opportunitySignalIds || item.opportunity_signal_ids),
    created_at: nullableString(item.createdAt || item.created_at),
  };
};

const normalizeClaim = (value: unknown, personId: string): PersonClaim => {
  const item = record(value);
  const allowedConfidence: PersonClaim['confidence'][] = ['insufficient', 'initial', 'mixed', 'repeated', 'direct_report', 'behavior_supported'];
  const allowedStatus: PersonClaim['status'][] = ['proposed', 'testing', 'mixed', 'supported', 'contradicted', 'retired'];
  const confidenceRaw = stringValue(item.evidenceStrength || item.confidence || item.evidence_strength);
  const statusRaw = stringValue(item.status);
  const evidence: PersonClaim['evidence'] = arrayValue(item.evidence || item.evidenceReferences || item.evidence_references).map((source, index) => {
    const entry = record(source);
    const sourceTypeRaw = stringValue(entry.sourceType || entry.source_type);
    const sourceType: PersonClaim['evidence'][number]['source_type'] = ['interaction', 'direct_statement', 'document', 'manual', 'other'].includes(sourceTypeRaw)
      ? sourceTypeRaw as PersonClaim['evidence'][number]['source_type']
      : 'other';
    const directionRaw = stringValue(entry.evidenceType || entry.evidence_type || entry.direction);
    const direction: PersonClaim['evidence'][number]['direction'] = directionRaw === 'supports' || directionRaw === 'support'
      ? 'support'
      : directionRaw === 'contradicts' || directionRaw === 'counter'
        ? 'counter'
        : 'neutral';
    return {
      id: stringValue(entry.id, `${stringValue(item.id, 'claim')}-evidence-${index}`),
      source_type: sourceType,
      source_id: nullableString(entry.sourceId || entry.source_id),
      excerpt: typeof source === 'string' ? source : stringValue(entry.excerpt || entry.summary || entry.content || entry.text),
      occurred_at: nullableString(entry.occurredAt || entry.occurred_at || entry.createdAt || entry.created_at),
      direction,
    };
  });
  return {
    id: stringValue(item.id),
    person_id: stringValue(item.personId || item.person_id, personId),
    context: stringValue(item.context || item.situation || item.category, '一般相处'),
    statement: stringValue(item.statement || item.claim || item.summary),
    status: allowedStatus.includes(statusRaw as PersonClaim['status']) ? statusRaw as PersonClaim['status'] : 'proposed',
    confidence: allowedConfidence.includes(confidenceRaw as PersonClaim['confidence']) ? confidenceRaw as PersonClaim['confidence'] : 'insufficient',
    evidence,
    alternative_explanations: stringList(item.alternativeExplanations || item.alternative_explanations),
    suggested_approach: nullableString(item.suggestedApproach || item.suggested_approach),
    last_verified_at: nullableString(item.lastVerifiedAt || item.last_verified_at),
    user_confirmed: item.userConfirmed === true || item.user_confirmed === true,
    version: typeof item.version === 'number' ? item.version : undefined,
  };
};

const normalizeDecision = (value: unknown): RelationshipDecision => {
  const item = record(value);
  const rawStatus = stringValue(item.status);
  const status: RelationshipDecision['status'] = ['chosen', 'executed', 'reviewed', 'cancelled'].includes(rawStatus)
    ? rawStatus as RelationshipDecision['status']
    : 'draft';
  const expected = record(item.expectedSignals || item.expected_signals);
  const options: DecisionOption[] = Array.isArray(item.options)
    ? item.options.map((option) => {
        const entry = record(option);
        return {
          id: nullableString(entry.id) || undefined,
          label: stringValue(entry.label || entry.action || option),
          upside: nullableString(entry.upside),
          downside: nullableString(entry.downside),
        };
      })
    : [];
  const outcomeRaw = isRecord(item.outcome) ? item.outcome : null;
  let outcome: DecisionOutcome | null = null;
  if (outcomeRaw) {
    const rawMatch = stringValue(outcomeRaw.predictionMatch || outcomeRaw.prediction_match);
    outcome = {
      actual_result: stringValue(outcomeRaw.actualResponse || outcomeRaw.actual_result || outcomeRaw.result),
      observed_signals: stringList(outcomeRaw.observedSignals || outcomeRaw.observed_signals),
      prediction_match: ['matched', 'partly', 'not_matched', 'unknown'].includes(rawMatch)
        ? rawMatch as DecisionOutcome['prediction_match']
        : 'unknown',
      lesson: nullableString(outcomeRaw.learning || outcomeRaw.lesson),
      recorded_at: nullableString(outcomeRaw.recordedAt || outcomeRaw.recorded_at),
    };
  }
  return {
    id: stringValue(item.id),
    person_id: stringValue(item.personId || item.person_id),
    goal: stringValue(item.goal),
    why_now: nullableString(item.whyNow || item.why_now),
    mutual_value: nullableString(item.mutualValue || item.mutual_value),
    trust_context: nullableString(item.trustContext || item.trust_context || item.relationshipMode),
    options,
    recommendation: nullableString(item.recommendation),
    next_step: nullableString(item.chosenAction || item.nextStep || item.next_step),
    feedback_signals: [...stringList(expected.positive), ...stringList(expected.neutral), ...stringList(expected.negative), ...stringList(item.feedbackSignals || item.feedback_signals)],
    risks: stringList(item.risks),
    boundaries: stringList(item.boundaries),
    stop_conditions: stringList(item.stopConditions || item.stop_conditions),
    status,
    outcome,
    created_at: nullableString(item.createdAt || item.created_at),
    version: typeof item.version === 'number' ? item.version : undefined,
  };
};

const normalizePrimaryContext = (value: unknown): PrimaryRelationshipContext => {
  const item = record(value);
  const urgency = record(item.urgency);
  return {
    id: stringValue(item.id),
    version: typeof item.version === 'number' ? item.version : undefined,
    attention_status: normalizeAttention(item.attentionStatus || item.attention_status),
    why: nullableString(item.whyMattersNow || item.why_matters_now),
    current_state: nullableString(item.currentState || item.current_state),
    current_goal: nullableString(item.currentGoal || item.current_goal),
    mutual_value: nullableString(item.mutualValue || item.mutual_value),
    boundaries: stringList(item.boundaries),
    observe_next: nullableString(item.observeNext || item.observe_next || urgency.observeNext || urgency.observe_next),
  };
};

const normalizeWorkspace = (value: unknown, personId: string): PersonWorkspace => {
  const item = record(value);
  const person = normalizePerson(item.person);
  const brief = record(item.brief);
  const contexts = arrayValue(item.contexts);
  const primaryContextRaw = contexts.find((context) => Boolean(record(context).isPrimary || record(context).is_primary)) || contexts[0];
  const primary = primaryContextRaw ? record(primaryContextRaw) : null;
  const primaryContext: PrimaryRelationshipContext | null = primary ? normalizePrimaryContext(primary) : null;
  const guide = arrayValue(item.interactionGuide || item.interaction_guide);
  const hypotheses = arrayValue(item.hypotheses);
  const inactiveClaims = arrayValue(item.inactiveClaims || item.inactive_claims);
  const decisions = Array.isArray(item.decisions) ? item.decisions.map(normalizeDecision) : [];
  const interactions = Array.isArray(item.interactions) ? item.interactions.map(normalizeInteraction) : [];
  const nextDecision = decisions.find((decision) => decision.status === 'chosen' || decision.status === 'draft') || null;
  return {
    person: person.id ? person : { ...person, id: personId },
    primary_context: primaryContext,
    brief: {
      why_now: nullableString(brief.whyNow || brief.why_now) || primaryContext?.why || null,
      current_state: nullableString(brief.currentState || brief.current_state) || primaryContext?.current_state || null,
      recent_change: nullableString(brief.recentChange || brief.recent_change),
      current_goal: nullableString(brief.currentGoal || brief.current_goal) || primaryContext?.current_goal || null,
      current_boundary: nullableString(brief.currentBoundary || brief.current_boundary) || primaryContext?.boundaries.join('；') || null,
      observe_next: nullableString(brief.observeNext || brief.observe_next),
    },
    confirmed_guides: guide.map((claim) => normalizeClaim(claim, personId)),
    hypotheses: hypotheses.map((claim) => normalizeClaim(claim, personId)),
    inactive_claims: inactiveClaims.map((claim) => normalizeClaim(claim, personId)),
    commitments: Array.isArray(item.commitments) ? item.commitments.map(normalizeCommitment) : [],
    next_action: nextDecision,
    decisions,
    interactions,
    related_people: arrayValue(item.relatedPeople || item.related_people).map(normalizePerson),
  };
};

export interface CreatePersonInput {
  name: string;
  identity?: string;
  relationshipRoles: string[];
  focusReason?: string;
  attentionState: AttentionState;
}

export interface UpdateRelationshipContextInput {
  attentionStatus: AttentionState;
  whyMattersNow?: string;
  currentState?: string;
  currentGoal?: string;
  mutualValue?: string;
  boundaries: string[];
  observeNext?: string;
  expectedVersion?: number;
}

export interface UpdatePersonAttentionInput {
  attentionState: AttentionState;
  focusReason?: string;
  observeNext?: string;
  contextId?: string;
  expectedVersion?: number;
}

export interface AttentionRecommendationDecisionInput {
  decision: 'accept' | 'dismiss';
  reason?: string;
  observeNext?: string;
  expectedVersion?: number;
}

export interface CreateClaimInput {
  contextId?: string;
  situation: string;
  statement: string;
  alternativeExplanations: string[];
}

export interface UpdateClaimInput {
  status?: ClaimStatus;
  userConfirmed?: boolean;
  situation?: string;
  statement?: string;
  alternativeExplanations?: string[];
  expectedVersion?: number;
}

export interface AddClaimEvidenceInput {
  direction: 'support' | 'counter' | 'neutral';
  content: string;
  interactionId?: string;
  occurredAt?: string;
}

export interface CreateDecisionInput {
  personId: string;
  goal: string;
  whyNow?: string;
  relationshipMode: 'long_term' | 'transaction' | 'mixed';
  mutualValue?: string;
  options?: DecisionOption[];
  chosenAction: string;
  positiveSignals: string[];
  neutralSignals: string[];
  negativeSignals: string[];
  boundaries: string[];
  stopConditions: string[];
  createPlannerItem?: boolean;
  dueAt?: string;
}

export interface RecordDecisionOutcomeInput {
  actualResponse: string;
  result: 'positive' | 'neutral' | 'negative' | 'mixed';
  matchedExpectation?: boolean;
  learning?: string;
  nextStep?: string;
}

export interface CreateOpportunityInput {
  title: string;
  problem: string;
  customer?: string;
  evidence?: string;
}

export interface CreateExperimentInput {
  type: 'interview' | 'offer' | 'preorder' | 'delivery' | 'payment' | 'repeat' | 'referral';
  hypothesis: string;
  method: string;
  successCriteria: string;
  plannedAt?: string;
}

export interface ExperimentOutcomeInput {
  result: string;
  evidence?: string;
  amountCents?: number;
  currency: 'CNY';
  nextDecision: 'continue' | 'adjust' | 'stop';
}

export interface SaveCompassInput {
  title: string;
  horizonDate?: string | null;
  outcomeStatement: string;
  successMetrics: string[];
  currentAssets: string[];
  currentConstraints: string[];
  ninetyDayBet?: string | null;
  nonNegotiables: string[];
  planningState: PlanningState;
  expectedVersion?: number;
}

export interface DailyGuidanceResult {
  available: boolean;
  cached: boolean;
  based_on_compass_version: number | null;
  compass_version: number | null;
  persisted: boolean;
  stale: boolean;
  guidance: DailyGuidance;
  source_status: Record<string, { available: boolean; count: number; error?: string }>;
  warning?: string | null;
}

const GUIDANCE_SOURCE_LABELS: Record<string, string> = {
  goals: '目标与差距',
  planner: '首页待办',
  people: '人物资料',
  interactions: '互动记录',
  opportunities: '商业机会',
  reviews: '复盘与原则',
  life_documents: '生活资料',
};

const EMPTY_PLANNING_STATE: PlanningState = {
  schema_version: 1,
  current_node_id: null,
  nodes: [],
  overall_gaps: [],
  stage_gaps: {},
  daily_guidance: null,
};

const DEFAULT_COMPASS_PLAN: CompassPlan = {
  id: null,
  version: 0,
  title: '事业与处世罗盘',
  horizon_date: '2027-07-15',
  outcome_statement: '启动并操盘一个简单的创业项目或一门生意，为客户创造真实价值，形成每月约 5 万元的稳定经营性现金流。',
  success_metrics: ['有一个由我操盘的真实项目', '连续出现可验证的客户付款', '经营性现金流逐步走向每月约 5 万元'],
  current_assets: ['博士生身份与科研场景', '长期写代码形成的技术能力', '曾尝试过低门槛中介生意'],
  current_constraints: ['需要养活自己，存在现实经济压力', '时间需要与博士研究并行'],
  ninety_day_bet: '选择一个能接触到真实客户的问题，完成访谈、报价和至少一次付费验证。',
  non_negotiables: [],
  planning_state: EMPTY_PLANNING_STATE,
};

const goalNodeStatuses: GoalNodeStatus[] = ['planned', 'in_progress', 'completed', 'paused'];

const normalizeGoalNode = (value: unknown, index: number): GoalNode => {
  const item = record(value);
  const status = stringValue(item.status) as GoalNodeStatus;
  return {
    id: stringValue(item.id, `goal-${index + 1}`),
    parent_id: nullableString(item.parentId || item.parent_id),
    title: stringValue(item.title, '未命名目标'),
    status: goalNodeStatuses.includes(status) ? status : 'planned',
    sort_order: numberValue(item.sortOrder ?? item.sort_order, index),
    current_fact: stringValue(item.currentFact || item.current_fact),
    completion_standard: stringValue(item.completionStandard || item.completion_standard),
    missing_evidence: stringValue(item.missingEvidence || item.missing_evidence),
    next_validation: stringValue(item.nextValidation || item.next_validation),
  };
};

const optionalNumber = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;

const normalizeCompassGap = (value: unknown, index: number): CompassGap => {
  const item = record(value);
  const metric = record(item.metric);
  return {
    id: stringValue(item.id, `gap-${index + 1}`),
    label: stringValue(item.label || item.title, '未命名指标'),
    current_state: stringValue(item.currentState || item.current_state),
    target_state: stringValue(item.targetState || item.target_state),
    primary_gap: stringValue(item.primaryGap || item.primary_gap),
    next_evidence: stringValue(item.nextEvidence || item.next_evidence),
    current_value: optionalNumber(item.currentValue ?? item.current_value ?? metric.currentValue ?? metric.current_value),
    target_value: optionalNumber(item.targetValue ?? item.target_value ?? metric.targetValue ?? metric.target_value),
    unit: nullableString(item.unit || metric.unit),
  };
};

const normalizeGuidanceSource = (value: unknown, fallbackDomain = 'other'): DailyGuidanceSource => {
  const item = record(value);
  const statusRaw = stringValue(item.status);
  return {
    domain: stringValue(item.domain || item.type, fallbackDomain),
    id: nullableString(item.id),
    label: stringValue(item.label || item.title || item.domain || item.type, '其他信息'),
    count: optionalNumber(item.count),
    status: statusRaw === 'unavailable' || statusRaw === 'empty' || statusRaw === 'truncated' ? statusRaw : 'included',
    last_updated_at: nullableString(item.lastUpdatedAt || item.last_updated_at),
  };
};

const normalizeDailyGuidance = (value: unknown): DailyGuidance => {
  const item = record(value);
  return {
    focus: stringValue(item.focus, '围绕当前阶段，选择一项能带来新证据的行动。'),
    why: stringValue(item.why, '当前信息不足，请先补充目标或刷新今日判断。'),
    avoid: stringValue(item.avoid, '不要用继续整理替代真实反馈。'),
    observe: stringValue(item.observe, '观察今天出现的新事实、承诺与外部反馈。'),
    generated_at: nullableString(item.generatedAt || item.generated_at),
    snapshot_hash: nullableString(item.snapshotHash || item.snapshot_hash),
    based_on_compass_version: optionalNumber(item.basedOnCompassVersion ?? item.based_on_compass_version),
    data_sources: arrayValue(item.dataSources || item.data_sources).map((source, index) => normalizeGuidanceSource(source, `data-source-${index + 1}`)),
    sources: arrayValue(item.sources).map((source, index) => normalizeGuidanceSource(source, `source-${index + 1}`)),
    fallback: Boolean(item.fallback),
    warning: nullableString(item.warning),
  };
};

const normalizePlanningState = (value: unknown): PlanningState => {
  const item = record(value);
  const nodes = arrayValue(item.nodes).map(normalizeGoalNode);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const rawStageGaps = record(item.stageGaps || item.stage_gaps);
  const stageGaps = Object.fromEntries(Object.entries(rawStageGaps).map(([nodeId, gaps]) => [
    nodeId,
    arrayValue(gaps).map(normalizeCompassGap),
  ]));
  const requestedCurrentId = nullableString(item.currentNodeId || item.current_node_id);
  return {
    schema_version: 1,
    current_node_id: requestedCurrentId && nodeIds.has(requestedCurrentId) ? requestedCurrentId : null,
    nodes,
    overall_gaps: arrayValue(item.overallGaps || item.overall_gaps).map(normalizeCompassGap),
    stage_gaps: stageGaps,
    daily_guidance: item.dailyGuidance || item.daily_guidance
      ? normalizeDailyGuidance(item.dailyGuidance || item.daily_guidance)
      : null,
  };
};

const buildLegacyPlanningState = (plan: Pick<CompassPlan, 'current_assets' | 'current_constraints' | 'ninety_day_bet'>): PlanningState => {
  const assets = plan.current_assets.slice(0, 2).join('；') || '已有技术与学习能力，但尚未建立商业基线';
  const nodes: GoalNode[] = [
    {
      id: 'paid-need', parent_id: null, sort_order: 0, title: '找到真实付费需求', status: 'in_progress',
      current_fact: `${assets}；目前还没有形成可重复的付费需求证据。`,
      completion_standard: '找到能接触到的真实客户问题，并获得明确投入或付款信号。',
      missing_evidence: '具体客户的持续痛点、现有替代成本与真实付费意愿。',
      next_validation: plan.ninety_day_bet || '完成一次客户访谈、具体报价或小额付费验证。',
    },
    {
      id: 'first-delivery', parent_id: 'paid-need', sort_order: 0, title: '完成首次收费与交付', status: 'planned',
      current_fact: '尚未进入本阶段；需要先确认问题和付费意愿。',
      completion_standard: '完成一次真实收费，并交付对方认可的结果。',
      missing_evidence: '明确报价、付款记录、交付范围与客户反馈。',
      next_validation: '用最小可交付服务完成第一笔闭环交易。',
    },
    {
      id: 'repeatable', parent_id: 'first-delivery', sort_order: 0, title: '形成重复获客与交付', status: 'planned',
      current_fact: '尚未进入本阶段；一次交易不能证明模式可重复。',
      completion_standard: '不同客户愿意为相似价值付费，交付过程可以复用。',
      missing_evidence: '第二次独立获客、复购或转介绍，以及稳定交付成本。',
      next_validation: '复用同一报价与交付方式，验证第二次真实交易。',
    },
    {
      id: 'predictable-cashflow', parent_id: 'repeatable', sort_order: 0, title: '获得可预测现金流', status: 'planned',
      current_fact: '尚未进入本阶段；目前没有连续经营数据。',
      completion_standard: '能够根据客户管道和交付能力预测下一周期收入。',
      missing_evidence: '稳定线索来源、成交率、交付产能和实际利润。',
      next_validation: '连续记录获客、报价、成交、成本与回款。',
    },
    {
      id: 'stable-business', parent_id: 'predictable-cashflow', sort_order: 0, title: '稳定约 5 万元/月', status: 'planned',
      current_fact: '这是目标状态，不以单月偶然收入作为完成。',
      completion_standard: '连续数月达到约 5 万元经营性现金流，并能持续交付价值。',
      missing_evidence: '连续现金流、健康利润、复购与可持续的个人投入。',
      next_validation: '在前序模式稳定后，逐步扩大有效获客和交付能力。',
    },
  ];
  const constraints = plan.current_constraints.join('；') || '尚未建立现实约束基线';
  const overallGaps: CompassGap[] = [
    { id: 'business-result', label: '经营结果', current_state: '尚未记录稳定的自营业务现金流。', target_state: '连续数月形成约 5 万元经营性现金流。', primary_gap: '缺少从真实交易到持续回款的完整证据。', next_evidence: '第一笔真实付款与对应交付结果。' },
    { id: 'demand', label: '需求与机会', current_state: '有过中介尝试，但尚未形成可重复付费模式。', target_state: '同类客户持续认可问题，并出现付费、复购或转介绍。', primary_gap: '真实客户问题、替代成本和付费意愿仍需验证。', next_evidence: '一次具体访谈、报价或付费行为。' },
    { id: 'operation', label: '项目操盘', current_state: assets, target_state: '能够独立完成获客、报价、交付、收款和复盘。', primary_gap: '技术执行能力还没有转化成全周期经营证据。', next_evidence: '跑通一次范围明确、有人付款的最小交付。' },
    { id: 'relationships', label: '处事与关系', current_state: '较少进行互动前判断、互动后复盘和人物模型校准。', target_state: '能够基于事实、反证和边界选择合适的相处方式。', primary_gap: '缺少持续记录“判断—行动—反应—修正”的真实样本。', next_evidence: '完成一次重要互动的事前判断与事后校准。' },
    { id: 'runway', label: '现实余量', current_state: constraints, target_state: '形成低成本、短周期且不破坏博士主线与生存安全的验证节奏。', primary_gap: '时间和经济压力要求每次尝试都有明确上限。', next_evidence: '为当前实验设定时间、资金和停止条件。' },
  ];
  return {
    schema_version: 1,
    current_node_id: nodes[0].id,
    nodes,
    overall_gaps: overallGaps,
    stage_gaps: {
      'paid-need': [
        { id: 'interviews', label: '客户访谈', current_state: '尚未记录有效客户访谈。', target_state: '完成 5 次真实客户访谈。', primary_gap: '还差 5 次访谈。', next_evidence: '完成下一次访谈并记录具体问题与原话。', current_value: 0, target_value: 5, unit: '次' },
        { id: 'offers', label: '具体报价', current_state: '尚未提出具体报价。', target_state: '向 3 位潜在客户提出明确报价。', primary_gap: '还差 3 次具体报价。', next_evidence: '提出包含范围、价格和交付时间的下一份报价。', current_value: 0, target_value: 3, unit: '次' },
        { id: 'payments', label: '真实付款', current_state: '尚未获得真实付款。', target_state: '获得至少 1 笔真实客户付款。', primary_gap: '还差第一笔付款证据。', next_evidence: '获得付款记录并关联对应交付承诺。', current_value: 0, target_value: 1, unit: '笔' },
      ],
    },
    daily_guidance: null,
  };
};

const normalizeCompassPlan = (value: unknown): CompassPlan => {
  const item = record(value);
  if (!Object.keys(item).length) return { ...DEFAULT_COMPASS_PLAN };
  const normalized = {
    id: nullableString(item.id),
    version: numberValue(item.version, 0),
    title: stringValue(item.title, DEFAULT_COMPASS_PLAN.title),
    horizon_date: nullableString(item.horizonDate || item.horizon_date),
    outcome_statement: stringValue(item.outcomeStatement || item.outcome_statement, DEFAULT_COMPASS_PLAN.outcome_statement),
    success_metrics: stringList(item.successMetrics || item.success_metrics),
    current_assets: stringList(item.currentAssets || item.current_assets),
    current_constraints: stringList(item.currentConstraints || item.current_constraints),
    ninety_day_bet: nullableString(item.ninetyDayBet || item.ninety_day_bet),
    non_negotiables: stringList(item.nonNegotiables || item.non_negotiables),
  };
  const hasPlanningState = Object.prototype.hasOwnProperty.call(item, 'planningState')
    || Object.prototype.hasOwnProperty.call(item, 'planning_state');
  return {
    ...normalized,
    planning_state: hasPlanningState
      ? normalizePlanningState(item.planningState ?? item.planning_state)
      : buildLegacyPlanningState(normalized),
  };
};

const fetchCompassPlan = async (signal?: AbortSignal): Promise<CompassPlan> => normalizeCompassPlan(
  await relationshipRequest<unknown>('/compass', { signal }),
);

const fetchTodayPlannerTasks = async (signal?: AbortSignal): Promise<PlannerTaskSummary[]> => {
  const raw = await relationshipRequest<unknown>(`/planner/items/${encodeURIComponent(CURRENT_USER_ID)}?view=today`, {
    baseUrl: LEGACY_API_BASE_URL,
    signal,
  });
  const values = Array.isArray(raw) ? raw : arrayValue(record(raw).items);
  return values
    .map((value) => record(value))
    .filter((item) => stringValue(item.type, 'task') === 'task' && !['done', 'archived'].includes(stringValue(item.status)))
    .map((item) => ({
      id: stringValue(item.id),
      title: stringValue(item.title, '未命名待办'),
      due_at: nullableString(item.dueAt || item.due_at),
    }))
    .sort((a, b) => String(a.due_at || '9999').localeCompare(String(b.due_at || '9999')))
    .slice(0, 3);
};

export const relationshipApi = {
  getCompass: fetchCompassPlan,

  saveCompass: async (input: SaveCompassInput, signal?: AbortSignal): Promise<CompassPlan> => normalizeCompassPlan(
    await relationshipRequest<unknown>('/compass', {
      method: 'PUT',
      signal,
      body: JSON.stringify(input),
    }),
  ),

  generateDailyGuidance: async (refresh = false, signal?: AbortSignal): Promise<DailyGuidanceResult> => {
    const raw = record(await relationshipRequest<unknown>('/compass/daily-guidance', {
      method: 'POST',
      signal,
      body: JSON.stringify({ refresh }),
    }));
    const rawSourceStatus = record(raw.sourceStatus || raw.source_status);
    const sourceStatus = Object.fromEntries(Object.entries(rawSourceStatus).map(([domain, value]) => {
      const item = record(value);
      return [domain, {
        available: item.available !== false,
        count: numberValue(item.count),
        error: nullableString(item.error) || undefined,
      }];
    }));
    const guidance = normalizeDailyGuidance(raw.guidance || raw);
    const dataSources = guidance.data_sources.length
      ? guidance.data_sources
      : Object.keys(sourceStatus).length
      ? Object.entries(sourceStatus).map(([domain, status]) => ({
        domain,
        label: GUIDANCE_SOURCE_LABELS[domain] || domain,
        count: status.count,
        status: status.available ? (status.count ? 'included' as const : 'empty' as const) : 'unavailable' as const,
      }))
      : [];
    const wrapperWarning = nullableString(raw.warning);
    return {
      available: raw.available !== false,
      cached: Boolean(raw.cached),
      based_on_compass_version: optionalNumber(raw.basedOnCompassVersion ?? raw.based_on_compass_version),
      compass_version: optionalNumber(raw.compassVersion ?? raw.compass_version),
      persisted: Boolean(raw.persisted),
      stale: Boolean(raw.stale),
      guidance: {
        ...guidance,
        generated_at: guidance.generated_at || nullableString(raw.generatedAt || raw.generated_at),
        based_on_compass_version: guidance.based_on_compass_version ?? optionalNumber(raw.basedOnCompassVersion ?? raw.based_on_compass_version),
        data_sources: dataSources,
        fallback: guidance.fallback || raw.available === false,
        warning: guidance.warning || wrapperWarning,
      },
      source_status: sourceStatus,
      warning: wrapperWarning,
    };
  },

  getCompassPage: async (signal?: AbortSignal): Promise<CompassPageData> => {
    const [plan, planner] = await Promise.all([
      fetchCompassPlan(signal),
      fetchTodayPlannerTasks(signal)
        .then((tasks) => ({ tasks, available: true }))
        .catch(() => ({ tasks: [] as PlannerTaskSummary[], available: false })),
    ]);
    return {
      plan,
      today_tasks: planner.tasks,
      planner_available: planner.available,
    };
  },

  getToday: async (signal?: AbortSignal): Promise<TodayData> => {
    const raw = record(await relationshipRequest<unknown>('/today', { signal }));
    const actions = Array.isArray(raw.peopleActions) ? raw.peopleActions : [];
    const priorityPeople = actions.map((action) => {
      const entry = record(action);
      const person = normalizePerson(entry.person || entry);
      return {
        ...person,
        focus_reason: nullableString(entry.reason || entry.actionReason || entry.focusReason) || person.focus_reason,
        last_interaction_summary: nullableString(entry.suggestedAction || entry.nextAction) || person.last_interaction_summary,
      };
    });
    const compass = record(raw.compass);
    return {
      compass: {
        headline: stringValue(compass.headline, '把真实互动沉淀为判断、行动与商业验证。'),
        outcome_12m: nullableString(compass.outcome12m || compass.outcome_12m) || '操盘自己的项目，并向稳定经营性现金流推进',
        focus_90d: nullableString(compass.focus90d || compass.focus_90d) || '先验证真实问题和付费意愿，再投入开发',
        cashflow_target: typeof compass.cashflowTarget === 'number' ? compass.cashflowTarget : 50000,
        metric_definition: nullableString(compass.metricDefinition || compass.metric_definition) || '经营性现金流，由真实交易验证',
      },
      priority_people: priorityPeople,
      commitments: Array.isArray(raw.dueCommitments) ? raw.dueCommitments.map(normalizeCommitment) : [],
      momentum_people: Array.isArray(raw.momentumPeople) ? raw.momentumPeople.map(normalizePerson) : [],
      active_opportunity: raw.activeOpportunity ? normalizeOpportunity(raw.activeOpportunity) : null,
      weekly_review_due: Boolean(raw.weeklyReviewDue),
      weekly_review_label: nullableString(raw.weeklyReviewLabel),
    };
  },

  getPeople: async (filters: { q?: string; attentionState?: AttentionState } = {}, signal?: AbortSignal): Promise<PersonSummary[]> => {
    const query = queryString({ q: filters.q, attentionState: filters.attentionState });
    const raw = await relationshipRequest<unknown>(`/people${query ? `?${query}` : ''}`, { signal });
    return Array.isArray(raw) ? raw.map(normalizePerson) : [];
  },

  getPeopleOverview: async (signal?: AbortSignal): Promise<PeopleOverviewData> => {
    const raw = await relationshipRequest<unknown>('/people/overview', { signal });
    return normalizePeopleOverview(raw);
  },

  generateAttentionRecommendations: async (refresh = false, signal?: AbortSignal): Promise<PeopleOverviewData> => {
    const raw = await relationshipRequest<unknown>('/people/attention-recommendations/generate', {
      method: 'POST',
      signal,
      body: JSON.stringify({ refresh }),
    });
    return normalizePeopleOverview(raw);
  },

  decideAttentionRecommendation: async (
    recommendationId: string,
    input: AttentionRecommendationDecisionInput,
    signal?: AbortSignal,
  ): Promise<{ recommendation: AttentionRecommendation; person: PersonSummary | null }> => {
    const raw = record(await relationshipRequest<unknown>(`/people/attention-recommendations/${encodeURIComponent(recommendationId)}/decision`, {
      method: 'POST',
      signal,
      body: JSON.stringify(input),
    }));
    return {
      recommendation: normalizeAttentionRecommendation(raw.recommendation || raw),
      person: raw.person ? normalizePerson(raw.person) : null,
    };
  },

  updatePersonAttention: async (
    personId: string,
    input: UpdatePersonAttentionInput,
    signal?: AbortSignal,
  ): Promise<PersonSummary> => {
    const raw = await relationshipRequest<unknown>(`/people/${encodeURIComponent(personId)}/attention`, {
      method: 'PATCH',
      signal,
      body: JSON.stringify(input),
    });
    return normalizePerson(record(raw).person || raw);
  },

  createPerson: async (input: CreatePersonInput, signal?: AbortSignal): Promise<PersonSummary> => {
    const raw = await relationshipRequest<unknown>('/people', {
      method: 'POST',
      signal,
      body: JSON.stringify(input),
    });
    return normalizePerson(record(raw).person || raw);
  },

  getPersonWorkspace: async (personId: string, signal?: AbortSignal): Promise<PersonWorkspace> => {
    const raw = await relationshipRequest<unknown>(`/people/${encodeURIComponent(personId)}/workspace`, { signal });
    return normalizeWorkspace(raw, personId);
  },

  updateContext: async (contextId: string, input: UpdateRelationshipContextInput, signal?: AbortSignal): Promise<PrimaryRelationshipContext> => {
    const raw = await relationshipRequest<unknown>(`/contexts/${encodeURIComponent(contextId)}`, {
      method: 'PATCH',
      signal,
      body: JSON.stringify({
        ...input,
        attentionStatus: input.attentionStatus === 'dormant' ? 'sleep' : input.attentionStatus,
      }),
    });
    return normalizePrimaryContext(record(raw).context || raw);
  },

  createClaim: async (personId: string, input: CreateClaimInput, signal?: AbortSignal): Promise<PersonClaim> => {
    const raw = await relationshipRequest<unknown>(`/people/${encodeURIComponent(personId)}/claims`, {
      method: 'POST',
      signal,
      body: JSON.stringify({
        contextId: input.contextId,
        dimension: 'interaction_style',
        situation: input.situation,
        statement: input.statement,
        status: 'hypothesis',
        confidenceLevel: 'insufficient',
        alternativeExplanations: input.alternativeExplanations,
        sourceType: 'user',
        userConfirmed: true,
      }),
    });
    return normalizeClaim(record(raw).claim || raw, personId);
  },

  updateClaim: async (claimId: string, input: UpdateClaimInput, signal?: AbortSignal): Promise<PersonClaim> => {
    const body = {
      ...input,
      status: input.status === 'proposed' ? 'hypothesis' : input.status,
    };
    const raw = await relationshipRequest<unknown>(`/claims/${encodeURIComponent(claimId)}`, {
      method: 'PATCH',
      signal,
      body: JSON.stringify(body),
    });
    return normalizeClaim(record(raw).claim || raw, stringValue(record(raw).personId || record(raw).person_id));
  },

  addClaimEvidence: async (claimId: string, input: AddClaimEvidenceInput, signal?: AbortSignal): Promise<void> => {
    const evidenceType = input.direction === 'support' ? 'supports' : input.direction === 'counter' ? 'contradicts' : 'neutral';
    await relationshipRequest<unknown>(`/claims/${encodeURIComponent(claimId)}/evidence`, {
      method: 'POST',
      signal,
      body: JSON.stringify({
        interactionId: input.interactionId,
        evidenceType,
        content: input.content,
        occurredAt: input.occurredAt,
        sourceLabel: '用户确认记录',
      }),
    });
  },

  extractInteraction: async (input: { personId: string; text: string; occurredAt?: string; clientRequestId: string }, signal?: AbortSignal): Promise<ExtractedInteractionDraft> => {
    const raw = record(await relationshipRequest<unknown>('/interactions/extract', {
      method: 'POST',
      signal,
      body: JSON.stringify(input),
    }));
    const proposal = record(raw.proposal || raw);
    return {
      proposal_id: stringValue(proposal.id || proposal.proposalId),
      person_id: stringValue(proposal.personId, input.personId),
      occurred_at: stringValue(proposal.occurredAt, input.occurredAt || new Date().toISOString()),
      context: nullableString(proposal.eventContext),
      facts: stringList(proposal.observedFacts),
      my_action: nullableString(stringList(proposal.myActions).join('；')),
      their_reaction: nullableString(stringList(proposal.theirReactions).join('；')),
      my_feelings: stringList(proposal.myFeelings),
      interpretation: nullableString(stringList(proposal.interpretations).join('；')),
      commitments: Array.isArray(proposal.commitments)
        ? proposal.commitments.map((item) => {
            const entry = normalizeCommitment(item);
            return { title: entry.title, owner: entry.owner, due_at: entry.due_at };
          })
        : [],
      opportunity_signals: stringList(proposal.opportunitySignals),
      hypothesis_updates: stringList(proposal.claimLinks),
      duplicate_candidates: Array.isArray(raw.duplicateCandidates)
        ? raw.duplicateCandidates.map((candidate) => {
            const entry = record(candidate);
            return { id: stringValue(entry.id), summary: stringValue(entry.summary), occurred_at: nullableString(entry.occurredAt) };
          })
        : [],
      warnings: Array.from(new Set([...stringList(raw.warnings), ...stringList(proposal.warnings)])),
    };
  },

  confirmInteraction: async (input: { personId: string; clientRequestId: string; draft: ExtractedInteractionDraft }, signal?: AbortSignal): Promise<Interaction> => {
    const { draft } = input;
    const raw = record(await relationshipRequest<unknown>('/interactions/confirm', {
      method: 'POST',
      signal,
      body: JSON.stringify({
        personId: input.personId,
        proposalId: draft.proposal_id,
        clientRequestId: input.clientRequestId,
        patch: {
          occurredAt: draft.occurred_at,
          eventContext: draft.context,
          observedFacts: draft.facts,
          myActions: draft.my_action ? [draft.my_action] : [],
          theirReactions: draft.their_reaction ? [draft.their_reaction] : [],
          myFeelings: draft.my_feelings || [],
          interpretations: draft.interpretation ? [draft.interpretation] : [],
          commitments: draft.commitments.map((item) => ({ title: item.title, owner: item.owner, dueAt: item.due_at })),
          opportunitySignals: draft.opportunity_signals.map((summary) => ({ summary })),
        },
      }),
    }));
    return normalizeInteraction(raw.interaction || raw);
  },

  saveManualInteraction: async (input: { personId: string; clientRequestId: string; draft: ExtractedInteractionDraft }, signal?: AbortSignal): Promise<Interaction> => {
    const { draft } = input;
    const raw = record(await relationshipRequest<unknown>(`/people/${encodeURIComponent(input.personId)}/interactions`, {
      method: 'POST',
      signal,
      body: JSON.stringify({
        clientRequestId: input.clientRequestId,
        patch: {
          occurredAt: draft.occurred_at,
          sourceType: 'manual',
          eventContext: draft.context || draft.facts[0] || '手动互动记录',
          observedFacts: draft.facts,
          myActions: draft.my_action ? [draft.my_action] : [],
          theirReactions: draft.their_reaction ? [draft.their_reaction] : [],
          myFeelings: draft.my_feelings || [],
          interpretations: draft.interpretation ? [draft.interpretation] : [],
          commitments: draft.commitments.map((item) => ({ title: item.title, owner: item.owner, dueAt: item.due_at })),
          opportunitySignals: draft.opportunity_signals.map((summary) => ({ summary })),
        },
      }),
    }));
    return normalizeInteraction(raw.interaction || raw);
  },

  createDecision: async (input: CreateDecisionInput, signal?: AbortSignal): Promise<RelationshipDecision> => {
    const raw = record(await relationshipRequest<unknown>('/decisions', {
      method: 'POST',
      signal,
      body: JSON.stringify({
        personId: input.personId,
        goal: input.goal,
        whyNow: input.whyNow,
        relationshipMode: input.relationshipMode,
        mutualValue: input.mutualValue,
        options: input.options,
        chosenAction: input.chosenAction,
        expectedSignals: {
          positive: input.positiveSignals,
          neutral: input.neutralSignals,
          negative: input.negativeSignals,
        },
        boundaries: input.boundaries,
        stopConditions: input.stopConditions,
        planner: { create: Boolean(input.createPlannerItem), dueAt: input.dueAt },
      }),
    }));
    return normalizeDecision(raw.decision || raw);
  },

  recordDecisionOutcome: async (decisionId: string, input: RecordDecisionOutcomeInput, signal?: AbortSignal): Promise<RelationshipDecision> => {
    const raw = record(await relationshipRequest<unknown>(`/decisions/${encodeURIComponent(decisionId)}/outcome`, {
      method: 'POST',
      signal,
      body: JSON.stringify(input),
    }));
    return normalizeDecision(raw.decision || raw);
  },

  getOpportunities: async (signal?: AbortSignal): Promise<BusinessOpportunity[]> => {
    const raw = await relationshipRequest<unknown>('/opportunities', { signal });
    return Array.isArray(raw) ? raw.map(normalizeOpportunity) : [];
  },

  getOpportunity: async (id: string, signal?: AbortSignal): Promise<BusinessOpportunity> => {
    const raw = await relationshipRequest<unknown>(`/opportunities/${encodeURIComponent(id)}`, { signal });
    return normalizeOpportunity(raw);
  },

  createOpportunity: async (input: CreateOpportunityInput, signal?: AbortSignal): Promise<BusinessOpportunity> => {
    const raw = await relationshipRequest<unknown>('/opportunities', {
      method: 'POST',
      signal,
      body: JSON.stringify(input),
    });
    return normalizeOpportunity(record(raw).opportunity || raw);
  },

  updateOpportunity: async (id: string, patch: Partial<BusinessOpportunity>, signal?: AbortSignal): Promise<BusinessOpportunity> => {
    const raw = await relationshipRequest<unknown>(`/opportunities/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      signal,
      body: JSON.stringify({ patch, expectedVersion: patch.version }),
    });
    return normalizeOpportunity(record(raw).opportunity || raw);
  },

  createExperiment: async (opportunityId: string, input: CreateExperimentInput, signal?: AbortSignal): Promise<OpportunityExperiment> => {
    const raw = record(await relationshipRequest<unknown>(`/opportunities/${encodeURIComponent(opportunityId)}/experiments`, {
      method: 'POST',
      signal,
      body: JSON.stringify(input),
    }));
    return normalizeExperiment(raw.experiment || raw);
  },

  recordExperimentOutcome: async (experimentId: string, input: ExperimentOutcomeInput, signal?: AbortSignal): Promise<OpportunityExperiment> => {
    const raw = record(await relationshipRequest<unknown>(`/experiments/${encodeURIComponent(experimentId)}/outcome`, {
      method: 'POST',
      signal,
      body: JSON.stringify(input),
    }));
    return normalizeExperiment(raw.experiment || raw);
  },

  getCurrentWeeklyReview: async (signal?: AbortSignal): Promise<WeeklyReviewDraft | null> => {
    try {
      const raw = await relationshipRequest<unknown>('/weekly-reviews/current', { signal });
      return raw ? normalizeWeeklyReview(raw) : null;
    } catch (error) {
      if (error instanceof RelationshipApiError && error.status === 404) return null;
      throw error;
    }
  },

  generateWeeklyReview: async (weekStart?: string, signal?: AbortSignal): Promise<WeeklyReviewDraft> => {
    const raw = await relationshipRequest<unknown>('/weekly-reviews/generate', {
      method: 'POST',
      signal,
      body: JSON.stringify({ weekStart }),
    });
    return normalizeWeeklyReview(record(raw).proposal || record(raw).review || raw);
  },

  confirmWeeklyReview: async (id: string, input: { principle: string; selfBlindSpot: string; relationshipActions: WeeklyReviewAction[]; opportunityExperiment?: string }, signal?: AbortSignal): Promise<WeeklyReviewDraft> => {
    const raw = await relationshipRequest<unknown>(`/weekly-reviews/${encodeURIComponent(id)}/confirm`, {
      method: 'POST',
      signal,
      body: JSON.stringify({ ...input, relationshipActions: input.relationshipActions.slice(0, 3) }),
    });
    return normalizeWeeklyReview(record(raw).review || raw);
  },

  getGrowth: async (signal?: AbortSignal): Promise<GrowthData> => {
    const raw = record(await relationshipRequest<unknown>('/growth', { signal }));
    const calibration = record(raw.calibration);
    return {
      principles: Array.isArray(raw.principles) ? raw.principles.map((value) => {
        const item = record(value);
        const statusRaw = stringValue(item.status);
        return {
          id: stringValue(item.id),
          statement: stringValue(item.statement || item.title),
          evidence_count: numberValue(item.evidenceCount || item.evidence_count),
          counterexample_count: numberValue(item.counterEvidenceCount || item.counterexample_count),
          status: statusRaw === 'confirmed' || statusRaw === 'retired' ? statusRaw : 'candidate',
          updated_at: nullableString(item.updatedAt || item.updated_at),
        };
      }) : [],
      patterns: Array.isArray(raw.patterns) ? raw.patterns.map((value) => {
        const item = record(value);
        const statusRaw = stringValue(item.status);
        return {
          id: stringValue(item.id),
          statement: stringValue(item.title || item.statement),
          status: statusRaw === 'confirmed' || statusRaw === 'rejected' ? statusRaw : 'candidate',
          evidence_count: numberValue(item.evidenceCount || item.evidence_count),
          counterexample_count: numberValue(item.counterEvidenceCount || item.counterexample_count),
          next_practice: nullableString(item.trainingAction || item.next_practice),
        };
      }) : [],
      calibration: [],
      independent_judgment_rate: typeof calibration.independentJudgmentRate === 'number' ? calibration.independentJudgmentRate : null,
      closed_loop_count: numberValue(calibration.closedDecisions || raw.closedLoopCount),
      commitment_completion_rate: typeof raw.commitmentCompletionRate === 'number' ? raw.commitmentCompletionRate : null,
    };
  },

  getLegacyPeople: async (signal?: AbortSignal): Promise<LegacyPerson[]> => {
    const raw = await relationshipRequest<unknown>(`/people/${encodeURIComponent(CURRENT_USER_ID)}`, { baseUrl: LEGACY_API_BASE_URL, signal });
    return Array.isArray(raw) ? raw.map((value) => {
      const item = record(value);
      return {
        id: stringValue(item.id),
        name: nullableString(item.name),
        identity: nullableString(item.identity),
        field: nullableString(item.field),
        tags: stringList(item.tags),
        contact_info: nullableString(item.contact_info || item.contactInfo),
        notes: nullableString(item.notes || item.personality_description),
        private_info: nullableString(item.private_info || item.privateInfo),
        relationship_strength: typeof item.relationship_strength === 'number' ? item.relationship_strength : null,
        disc_type: nullableString(item.disc_type),
        mbti_type: nullableString(item.mbti_type),
        updated_at: nullableString(item.updated_at),
      };
    }) : [];
  },

  getLegacyInteractions: async (personId: string, signal?: AbortSignal): Promise<Interaction[]> => {
    const raw = await relationshipRequest<unknown>(`/interaction/${encodeURIComponent(personId)}`, { baseUrl: LEGACY_API_BASE_URL, signal });
    return Array.isArray(raw) ? raw.map(normalizeInteraction) : [];
  },
};

const normalizeWeeklyReview = (value: unknown): WeeklyReviewDraft => {
  const item = record(value);
  const rawStatus = stringValue(item.status);
  const actions = arrayValue(item.relationshipActions || item.relationship_actions);
  return {
    id: stringValue(item.id || item.proposalId),
    week_start: stringValue(item.weekStart || item.week_start),
    week_end: stringValue(item.weekEnd || item.week_end),
    status: rawStatus === 'completed' ? 'completed' : 'draft',
    important_changes: stringList(item.importantChanges || item.important_changes),
    neglected_relationships: stringList(item.neglectedRelationships || item.neglected_relationships),
    open_commitments: arrayValue(item.openCommitments || item.open_commitments).map(normalizeCommitment),
    asymmetry_warnings: stringList(item.asymmetryWarnings || item.asymmetry_warnings),
    contradicted_claims: [],
    opportunity_signals: stringList(item.opportunitySignals || item.opportunity_signals),
    self_pattern_candidate: nullableString(item.selfBlindSpot || item.selfPatternCandidate || item.self_pattern_candidate),
    principle_candidate: nullableString(item.principle || item.principleCandidate || item.principle_candidate),
    relationship_actions: actions.map((value) => {
      const action = record(value);
      return {
        id: nullableString(action.id) || undefined,
        person_id: nullableString(action.personId || action.person_id),
        person_name: nullableString(action.personName || action.person_name),
        title: stringValue(action.title || action.action),
        due_at: nullableString(action.dueAt || action.due_at),
      };
    }),
    opportunity_experiment: nullableString(item.opportunityExperiment || item.opportunity_experiment),
  };
};

export const createClientRequestId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `relationship-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export const decisionProposalFromForm = (input: Omit<CreateDecisionInput, 'personId'>, personId: string): DecisionProposal => ({
  proposal_id: createClientRequestId(),
  person_id: personId,
  goal: input.goal,
  why_now: input.whyNow,
  mutual_value: input.mutualValue,
  trust_context: input.relationshipMode,
  options: input.options || [],
  recommendation: input.chosenAction,
  next_step: input.chosenAction,
  feedback_signals: [...input.positiveSignals, ...input.neutralSignals, ...input.negativeSignals],
  risks: [],
  boundaries: input.boundaries,
  stop_conditions: input.stopConditions,
  evidence_ids: [],
  counterview: null,
});

export { API_BASE_URL as RELATIONSHIP_API_BASE_URL };
