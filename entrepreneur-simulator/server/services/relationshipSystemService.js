const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');
const { DEFAULT_USER_ID } = require('../config/currentUser');
const { getLlmApiKey, getLlmModel, getOpenAIClientOptions } = require('./llmConfig');
const { extractJsonObject } = require('../utils/aiResponse');
const {
  PlanningStateValidationError,
  cloneDefaultPlanningState,
  normalizePlanningState,
} = require('./relationshipPlanningState');

const TABLES = Object.freeze({
  compass: 'relationship_compasses',
  context: 'relationship_contexts',
  interaction: 'relationship_interactions',
  claim: 'relationship_claims',
  evidence: 'relationship_claim_evidence',
  decision: 'relationship_decisions',
  outcome: 'relationship_decision_outcomes',
  opportunity: 'relationship_opportunities',
  experiment: 'relationship_opportunity_experiments',
  weeklyReview: 'relationship_weekly_reviews',
  growth: 'relationship_growth_patterns',
  proposal: 'relationship_ai_proposals',
});

const PERSON_PUBLIC_FIELDS = [
  'id', 'name', 'identity', 'field', 'tags', 'category', 'avatar_real',
  'first_met_date', 'first_met_scene', 'birthday', 'hometown',
  'created_at', 'updated_at',
].join(',');

const MAX_PAGE_SIZE = 200;
const INTERACTION_PROMPT_VERSION = 'relationship-interaction-extract-v1';
const ATTENTION_RECOMMENDATION_TYPE = 'attention_recommendation';
const ATTENTION_RECOMMENDATION_RUN_TYPE = 'attention_recommendation_run';
const CURRENT_ATTENTION_STATUSES = new Set(['focus', 'repair', 'boundary']);
const ATTENTION_STATUSES = new Set(['focus', 'maintain', 'observe', 'repair', 'boundary', 'sleep', 'archived']);

class RelationshipSystemError extends Error {
  constructor(code, message, statusCode = 400, details = undefined) {
    super(message);
    this.name = 'RelationshipSystemError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

function databaseClientFromEnv() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  return url && key ? createClient(url, key) : null;
}

function databaseErrorText(error) {
  return [error?.message, error?.details, error?.hint].filter(Boolean).join(' ');
}

function isMigrationMissingError(error) {
  const code = String(error?.code || '').toUpperCase();
  const text = databaseErrorText(error);
  return (
    code === '42P01' ||
    code === 'PGRST202' ||
    code === 'PGRST205' ||
    (/relationship_(?:compasses|contexts|interactions|claims|claim_evidence|decisions|decision_outcomes|opportunities|opportunity_experiments|weekly_reviews|growth_patterns|ai_proposals)/i.test(text) &&
      /(does not exist|schema cache|could not find)/i.test(text)) ||
    (/decide_relationship_attention_recommendation/i.test(text) && /(does not exist|schema cache|could not find|function)/i.test(text))
  );
}

function translateDatabaseError(error) {
  if (error instanceof RelationshipSystemError) return error;
  if (isMigrationMissingError(error)) {
    const text = databaseErrorText(error);
    const planningStateMissing = /planning_state/i.test(text);
    const peopleAttentionMissing = /decide_relationship_attention_recommendation|attention_recommendation_run/i.test(text);
    return new RelationshipSystemError(
      'MIGRATION_REQUIRED',
      'Relationship system database migration has not been applied.',
      503,
      {
        migration: peopleAttentionMissing
          ? 'supabase/migrations/20260718_add_people_overview_attention.sql'
          : (planningStateMissing
            ? 'supabase/migrations/20260718_add_relationship_compass_planning_state.sql'
            : 'supabase/migrations/20260715_add_relationship_system.sql'),
        migrationChain: [
          'supabase/migrations/20260715_add_relationship_system.sql',
          'supabase/migrations/20260718_add_relationship_compass_planning_state.sql',
          'supabase/migrations/20260718_add_people_overview_attention.sql',
        ],
      }
    );
  }
  if (String(error?.code || '') === '23505') {
    return new RelationshipSystemError('CONFLICT', 'The record already exists.', 409);
  }
  if (['23514', '22P02', '22007'].includes(String(error?.code || ''))) {
    return new RelationshipSystemError('VALIDATION_ERROR', 'A field value is invalid.', 400, {
      databaseCode: error.code,
    });
  }
  if (String(error?.code || '') === '23503') {
    return new RelationshipSystemError('REFERENCE_CONFLICT', 'A related record is missing or still in use.', 409);
  }
  return new RelationshipSystemError('DATABASE_ERROR', 'Database operation failed.', 500, {
    databaseCode: error?.code || null,
  });
}

function requireText(value, field, maxLength = 10000) {
  const text = value === undefined || value === null ? '' : String(value).trim();
  if (!text) throw new RelationshipSystemError('VALIDATION_ERROR', `${field} is required.`, 400, { field });
  if (text.length > maxLength) {
    throw new RelationshipSystemError('VALIDATION_ERROR', `${field} is too long.`, 400, { field, maxLength });
  }
  return text;
}

function optionalText(value, maxLength = 20000) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (text.length > maxLength) throw new RelationshipSystemError('VALIDATION_ERROR', 'Text is too long.', 400);
  return text;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizePlanningStateInput(value) {
  try {
    return normalizePlanningState(value);
  } catch (error) {
    if (error instanceof PlanningStateValidationError) {
      throw new RelationshipSystemError('VALIDATION_ERROR', error.message, 400, error.details);
    }
    throw error;
  }
}

function compassWithPlanningState(compass) {
  if (!compass) return null;
  return {
    ...compass,
    planning_state: compass.planning_state === undefined || compass.planning_state === null
      ? cloneDefaultPlanningState()
      : normalizePlanningState(compass.planning_state),
  };
}

function normalizeLimit(value, fallback = 50) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, MAX_PAGE_SIZE) : fallback;
}

function normalizeDateTime(value, fallback = null) {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new RelationshipSystemError('VALIDATION_ERROR', 'Invalid date/time value.', 400);
  }
  return date.toISOString();
}

function normalizeDate(value) {
  const text = requireText(value, 'date', 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new RelationshipSystemError('VALIDATION_ERROR', 'Date must be YYYY-MM-DD.', 400);
  }
  return text;
}

function normalizeInteractionDraft(value, defaults = {}) {
  const draft = asObject(value);
  const summary = requireText(draft.summary || defaults.summary, 'draft.summary', 5000);
  return {
    occurred_at: normalizeDateTime(draft.occurred_at || defaults.occurred_at, new Date().toISOString()),
    source_type: ['text', 'voice', 'manual', 'import'].includes(draft.source_type)
      ? draft.source_type
      : (defaults.source_type || 'text'),
    raw_text: optionalText(draft.raw_text ?? defaults.raw_text, 50000),
    summary,
    observed_facts: asArray(draft.observed_facts),
    my_actions: asArray(draft.my_actions),
    their_reactions: asArray(draft.their_reactions),
    my_feelings: asArray(draft.my_feelings),
    interpretations: asArray(draft.interpretations),
    commitments: asArray(draft.commitments),
    relationship_signals: asArray(draft.relationship_signals),
    opportunity_signals: asArray(draft.opportunity_signals),
    review: asObject(draft.review),
  };
}

function pick(input, fields) {
  const output = {};
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(input || {}, field)) output[field] = input[field];
  }
  return output;
}

function createRelationshipSystemService(options = {}) {
  let supabase = options.client === undefined ? databaseClientFromEnv() : options.client;
  const userId = String(options.userId || DEFAULT_USER_ID).trim() || DEFAULT_USER_ID;
  let aiClient = options.aiClient || null;
  const interactionExtractor = options.interactionExtractor || null;

  function requireDatabase() {
    if (!supabase) {
      throw new RelationshipSystemError(
        'DATABASE_UNAVAILABLE',
        'Supabase is not configured for the relationship system.',
        503
      );
    }
    return supabase;
  }

  function throwIfDatabaseError(error) {
    if (error) throw translateDatabaseError(error);
  }

  async function getOwned(table, id, label = 'Record', fields = '*') {
    requireText(id, `${label.toLowerCase()}Id`, 100);
    const { data, error } = await requireDatabase()
      .from(table)
      .select(fields)
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle();
    throwIfDatabaseError(error);
    if (!data) throw new RelationshipSystemError('NOT_FOUND', `${label} was not found.`, 404);
    return data;
  }

  async function requirePerson(personId) {
    return getOwned('people_profiles', personId, 'Person', PERSON_PUBLIC_FIELDS);
  }

  async function updateVersioned(table, id, patch, expectedVersion, label) {
    const current = await getOwned(table, id, label, 'id,user_id,version');
    if (expectedVersion !== undefined && Number(expectedVersion) !== Number(current.version)) {
      throw new RelationshipSystemError('VERSION_CONFLICT', `${label} changed since it was loaded.`, 409, {
        currentVersion: current.version,
      });
    }
    const next = {
      ...patch,
      version: Number(current.version || 1) + 1,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await requireDatabase()
      .from(table)
      .update(next)
      .eq('id', id)
      .eq('user_id', userId)
      .eq('version', current.version)
      .select('*')
      .maybeSingle();
    throwIfDatabaseError(error);
    if (!data) throw new RelationshipSystemError('VERSION_CONFLICT', `${label} changed during save.`, 409);
    return data;
  }

  async function healthcheck() {
    const [contextResult, compassResult, attentionResult, attentionDecisionProbe] = await Promise.all([
      requireDatabase().from(TABLES.context).select('id').limit(1),
      requireDatabase().from(TABLES.compass).select('id,planning_state').limit(1),
      requireDatabase().from(TABLES.proposal).select('id,proposal_type,input_snapshot').limit(1),
      requireDatabase().rpc('decide_relationship_attention_recommendation', {
        p_user_id: userId,
        p_recommendation_id: '00000000-0000-0000-0000-000000000000',
        p_decision: 'dismiss',
        p_reason: null,
        p_observe_next: null,
        p_expected_version: null,
      }),
    ]);
    throwIfDatabaseError(contextResult.error);
    throwIfDatabaseError(compassResult.error);
    throwIfDatabaseError(attentionResult.error);
    // The probe uses an impossible recommendation id and therefore must fail
    // with the function's own RS_NOT_FOUND sentinel. A PostgREST missing-RPC
    // error means the additive migration has not been deployed yet.
    if (attentionDecisionProbe.error
      && !/RS_NOT_FOUND/.test(databaseErrorText(attentionDecisionProbe.error))) {
      throwIfDatabaseError(attentionDecisionProbe.error);
    }
    return { ready: true, migration: '20260718_add_people_overview_attention' };
  }

  async function getCompass() {
    const { data, error } = await requireDatabase()
      .from(TABLES.compass)
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .maybeSingle();
    throwIfDatabaseError(error);
    return compassWithPlanningState(data || null);
  }

  async function saveCompass(input = {}) {
    const current = await getCompass();
    const values = {
      title: optionalText(input.title, 200) || '当前生活与事业罗盘',
      horizon_date: input.horizonDate ? normalizeDate(input.horizonDate) : null,
      outcome_statement: optionalText(input.outcomeStatement, 10000),
      success_metrics: asArray(input.successMetrics),
      current_assets: asArray(input.currentAssets),
      current_constraints: asArray(input.currentConstraints),
      ninety_day_bet: optionalText(input.ninetyDayBet, 10000),
      non_negotiables: asArray(input.nonNegotiables),
    };
    if (Object.prototype.hasOwnProperty.call(input, 'planningState')) {
      values.planning_state = normalizePlanningStateInput(input.planningState);
    } else if (!current) {
      values.planning_state = cloneDefaultPlanningState();
    }
    if (current) return updateVersioned(TABLES.compass, current.id, values, input.expectedVersion, 'Compass');
    const { data, error } = await requireDatabase()
      .from(TABLES.compass)
      .insert([{ ...values, user_id: userId, is_active: true }])
      .select('*')
      .single();
    throwIfDatabaseError(error);
    return data;
  }

  async function listPeople(input = {}) {
    const limit = normalizeLimit(input.limit, 100);
    const { data: people, error: peopleError } = await requireDatabase()
      .from('people_profiles')
      .select(PERSON_PUBLIC_FIELDS)
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(MAX_PAGE_SIZE);
    throwIfDatabaseError(peopleError);

    const { data: contexts, error: contextError } = await requireDatabase()
      .from(TABLES.context)
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });
    throwIfDatabaseError(contextError);

    const { data: recentInteractions, error: interactionError } = await requireDatabase()
      .from(TABLES.interaction)
      .select('id,person_id,summary,occurred_at')
      .eq('user_id', userId)
      .order('occurred_at', { ascending: false })
      .limit(MAX_PAGE_SIZE);
    throwIfDatabaseError(interactionError);

    const contextByPerson = new Map();
    for (const context of contexts || []) {
      const current = contextByPerson.get(context.person_id) || [];
      current.push(context);
      contextByPerson.set(context.person_id, current);
    }
    const latestByPerson = new Map();
    for (const interaction of recentInteractions || []) {
      if (!latestByPerson.has(interaction.person_id)) latestByPerson.set(interaction.person_id, interaction);
    }

    const search = String(input.search || '').trim().toLocaleLowerCase();
    const attentionStatus = String(input.attentionStatus || '').trim();
    return (people || [])
      .map((person) => ({
        ...person,
        contexts: contextByPerson.get(person.id) || [],
        last_interaction: latestByPerson.get(person.id) || null,
      }))
      .filter((person) => {
        if (search) {
          const haystack = [person.name, person.identity, person.field, ...(person.tags || [])]
            .filter(Boolean).join(' ').toLocaleLowerCase();
          if (!haystack.includes(search)) return false;
        }
        if (attentionStatus && !person.contexts.some((item) => item.attention_status === attentionStatus)) return false;
        return true;
      })
      .slice(0, limit);
  }

  async function createPerson(input = {}) {
    // Check the new schema before writing the legacy people row so a missing
    // additive migration cannot leave a half-created relationship record.
    await healthcheck();
    const name = requireText(input.name, 'name', 300);
    const roles = asArray(input.relationshipRoles).map((item) => String(item).trim()).filter(Boolean);
    const { data: person, error } = await requireDatabase().from('people_profiles').insert([{
      user_id: userId,
      name,
      identity: optionalText(input.identity, 1000),
      field: optionalText(input.field, 1000),
      tags: asArray(input.tags),
      category: optionalText(input.category, 200),
    }]).select(PERSON_PUBLIC_FIELDS).single();
    throwIfDatabaseError(error);

    const requestedContext = String(input.contextType || roles[0] || 'other');
    const validContextTypes = ['family', 'partner', 'friend', 'mentor', 'colleague', 'business', 'customer', 'other'];
    const context = await createContext(person.id, {
      contextType: validContextTypes.includes(requestedContext) ? requestedContext : 'other',
      label: roles.length ? roles.join(' / ') : null,
      attentionStatus: input.attentionState === 'dormant' ? 'sleep' : (input.attentionState || 'observe'),
      whyMattersNow: input.focusReason,
      isPrimary: true,
    });
    return { ...person, contexts: [context], last_interaction: null };
  }

  async function listContexts(personId) {
    await requirePerson(personId);
    const { data, error } = await requireDatabase()
      .from(TABLES.context)
      .select('*')
      .eq('user_id', userId)
      .eq('person_id', personId)
      .order('is_primary', { ascending: false })
      .order('updated_at', { ascending: false });
    throwIfDatabaseError(error);
    return data || [];
  }

  async function createContext(personId, input = {}) {
    await requirePerson(personId);
    const payload = {
      user_id: userId,
      person_id: personId,
      context_type: input.contextType || 'other',
      label: optionalText(input.label, 200),
      attention_status: input.attentionStatus || 'observe',
      why_matters_now: optionalText(input.whyMattersNow),
      current_state: optionalText(input.currentState),
      current_goal: optionalText(input.currentGoal),
      mutual_value: optionalText(input.mutualValue),
      boundaries: asArray(input.boundaries),
      relationship_health: asObject(input.relationshipHealth),
      urgency: {
        ...asObject(input.urgency),
        ...(Object.prototype.hasOwnProperty.call(input, 'observeNext')
          ? { observe_next: optionalText(input.observeNext, 5000) }
          : {}),
      },
      is_primary: Boolean(input.isPrimary),
    };
    if (payload.is_primary) {
      const { error } = await requireDatabase().from(TABLES.context)
        .update({ is_primary: false, updated_at: new Date().toISOString() })
        .eq('user_id', userId).eq('person_id', personId).eq('is_primary', true);
      throwIfDatabaseError(error);
    }
    const { data, error } = await requireDatabase().from(TABLES.context)
      .insert([payload]).select('*').single();
    throwIfDatabaseError(error);
    return data;
  }

  async function updateContext(contextId, input = {}) {
    const current = await getOwned(TABLES.context, contextId, 'Context');
    const raw = pick(input, [
      'contextType', 'label', 'attentionStatus', 'whyMattersNow', 'currentState',
      'currentGoal', 'mutualValue', 'boundaries', 'relationshipHealth', 'urgency', 'observeNext', 'isPrimary',
    ]);
    const patch = {};
    if ('contextType' in raw) patch.context_type = raw.contextType;
    if ('label' in raw) patch.label = optionalText(raw.label, 200);
    if ('attentionStatus' in raw) patch.attention_status = raw.attentionStatus;
    if ('whyMattersNow' in raw) patch.why_matters_now = optionalText(raw.whyMattersNow);
    if ('currentState' in raw) patch.current_state = optionalText(raw.currentState);
    if ('currentGoal' in raw) patch.current_goal = optionalText(raw.currentGoal);
    if ('mutualValue' in raw) patch.mutual_value = optionalText(raw.mutualValue);
    if ('boundaries' in raw) patch.boundaries = asArray(raw.boundaries);
    if ('relationshipHealth' in raw) patch.relationship_health = asObject(raw.relationshipHealth);
    if ('urgency' in raw || 'observeNext' in raw) {
      patch.urgency = {
        ...asObject(current.urgency),
        ...('urgency' in raw ? asObject(raw.urgency) : {}),
        ...('observeNext' in raw ? { observe_next: optionalText(raw.observeNext, 5000) } : {}),
      };
    }
    if ('isPrimary' in raw) patch.is_primary = Boolean(raw.isPrimary);
    if (patch.is_primary && !current.is_primary) {
      const { error } = await requireDatabase().from(TABLES.context)
        .update({ is_primary: false, updated_at: new Date().toISOString() })
        .eq('user_id', userId).eq('person_id', current.person_id).eq('is_primary', true);
      throwIfDatabaseError(error);
    }
    return updateVersioned(TABLES.context, contextId, patch, input.expectedVersion, 'Context');
  }

  async function primaryContextForPerson(personId, requestedContextId = null) {
    await requirePerson(personId);
    if (requestedContextId) {
      const context = await getOwned(TABLES.context, requestedContextId, 'Context');
      if (context.person_id !== personId) {
        throw new RelationshipSystemError('OWNERSHIP_MISMATCH', 'Context does not belong to this person.', 409);
      }
      return context;
    }
    const { data, error } = await requireDatabase().from(TABLES.context)
      .select('*').eq('user_id', userId).eq('person_id', personId)
      .order('is_primary', { ascending: false }).order('updated_at', { ascending: false })
      .limit(1).maybeSingle();
    throwIfDatabaseError(error);
    return data || null;
  }

  async function setPersonAttention(personId, input = {}) {
    const requested = input.attentionState === 'dormant' ? 'sleep' : String(input.attentionState || '').trim();
    if (!ATTENTION_STATUSES.has(requested)) {
      throw new RelationshipSystemError('VALIDATION_ERROR', 'attentionState is invalid.', 400, {
        field: 'attentionState',
        allowed: Array.from(ATTENTION_STATUSES),
      });
    }
    let context = await primaryContextForPerson(personId, input.contextId || null);
    const observeNextProvided = Object.prototype.hasOwnProperty.call(input, 'observeNext');
    const urgency = {
      ...asObject(context?.urgency),
      ...(observeNextProvided ? { observe_next: optionalText(input.observeNext, 5000) } : {}),
    };
    if (context) {
      context = await updateContext(context.id, {
        attentionStatus: requested,
        ...('focusReason' in input ? { whyMattersNow: input.focusReason } : {}),
        urgency,
        isPrimary: true,
        expectedVersion: input.expectedVersion,
      });
    } else {
      if (input.expectedVersion !== undefined) {
        throw new RelationshipSystemError('VERSION_CONFLICT', 'Context changed since it was loaded.', 409, {
          currentVersion: null,
        });
      }
      context = await createContext(personId, {
        contextType: 'other',
        attentionStatus: requested,
        whyMattersNow: input.focusReason,
        urgency,
        isPrimary: true,
      });
    }
    if (CURRENT_ATTENTION_STATUSES.has(requested)) {
      const { error } = await requireDatabase().from(TABLES.proposal).update({
        status: 'rejected',
        error: {
          code: 'SUPERSEDED_BY_MANUAL',
          message: 'User manually placed this person in current attention.',
        },
        confirmed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('user_id', userId)
        .eq('person_id', personId)
        .eq('proposal_type', ATTENTION_RECOMMENDATION_TYPE)
        .eq('status', 'draft');
      throwIfDatabaseError(error);
    }
    const people = await listPeople({ limit: MAX_PAGE_SIZE });
    return people.find((person) => person.id === personId) || {
      ...(await requirePerson(personId)),
      contexts: [context],
      last_interaction: null,
    };
  }

  async function listAttentionRecommendations(input = {}) {
    let query = requireDatabase().from(TABLES.proposal).select('*')
      .eq('user_id', userId).eq('proposal_type', ATTENTION_RECOMMENDATION_TYPE)
      .order('created_at', { ascending: false });
    if (input.status) query = query.eq('status', input.status);
    const { data, error } = await query.limit(normalizeLimit(input.limit, 100));
    throwIfDatabaseError(error);
    return data || [];
  }

  async function getLatestAttentionRecommendationRun() {
    const { data, error } = await requireDatabase().from(TABLES.proposal).select('*')
      .eq('user_id', userId).eq('proposal_type', ATTENTION_RECOMMENDATION_RUN_TYPE)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    throwIfDatabaseError(error);
    return data || null;
  }

  async function replaceAttentionRecommendations(input = {}) {
    const recommendations = asArray(input.recommendations);
    const seenPeople = new Set();
    for (const recommendation of recommendations) {
      const personId = requireText(recommendation.personId, 'recommendation.personId', 100);
      if (seenPeople.has(personId)) {
        throw new RelationshipSystemError('VALIDATION_ERROR', 'Only one recommendation per person is allowed.', 400);
      }
      seenPeople.add(personId);
      await requirePerson(personId);
    }
    const now = new Date().toISOString();
    const { error: supersedeError } = await requireDatabase().from(TABLES.proposal).update({
      status: 'rejected',
      error: { code: 'SUPERSEDED', message: 'A newer attention recommendation run replaced this draft.' },
      updated_at: now,
    }).eq('user_id', userId).eq('proposal_type', ATTENTION_RECOMMENDATION_TYPE).eq('status', 'draft');
    throwIfDatabaseError(supersedeError);

    const runPayload = {
      user_id: userId,
      person_id: null,
      proposal_type: ATTENTION_RECOMMENDATION_RUN_TYPE,
      status: 'confirmed',
      input_snapshot: asObject(input.inputSnapshot),
      payload: {
        status: input.runStatus || (recommendations.length ? 'ai' : 'empty'),
        recommendation_count: recommendations.length,
        warning: optionalText(input.warning, 5000),
      },
      evidence_refs: [],
      error: null,
      model: optionalText(input.model, 500),
      prompt_version: optionalText(input.promptVersion, 500),
      confirmed_entity_type: 'attention_recommendation_run',
      confirmed_entity_id: null,
      confirmed_at: now,
    };
    const rows = recommendations.map((item) => ({
      user_id: userId,
      person_id: item.personId,
      proposal_type: ATTENTION_RECOMMENDATION_TYPE,
      status: 'draft',
      input_snapshot: asObject(input.inputSnapshot),
      payload: {
        reason: optionalText(item.reason, 5000),
        why_now: optionalText(item.whyNow, 5000),
        life_domains: asArray(item.lifeDomains).slice(0, 8),
        observe_next: optionalText(item.observeNext, 5000),
        confidence: ['initial', 'moderate', 'strong'].includes(item.confidence) ? item.confidence : 'initial',
        suggested_until: item.suggestedUntil || null,
        fallback: input.runStatus === 'fallback',
      },
      evidence_refs: asArray(item.evidenceRefs).slice(0, 12),
      error: null,
      model: optionalText(input.model, 500),
      prompt_version: optionalText(input.promptVersion, 500),
      confirmed_entity_type: null,
      confirmed_entity_id: null,
      confirmed_at: null,
    }));
    const { data, error } = await requireDatabase().from(TABLES.proposal)
      .insert([runPayload, ...rows]).select('*');
    throwIfDatabaseError(error);
    const inserted = data || [];
    return {
      run: inserted.find((item) => item.proposal_type === ATTENTION_RECOMMENDATION_RUN_TYPE) || null,
      recommendations: inserted.filter((item) => item.proposal_type === ATTENTION_RECOMMENDATION_TYPE),
    };
  }

  async function decideAttentionRecommendation(recommendationId, input = {}) {
    const decision = String(input.decision || '').trim();
    if (!['accept', 'dismiss'].includes(decision)) {
      throw new RelationshipSystemError('VALIDATION_ERROR', 'decision must be accept or dismiss.', 400, { field: 'decision' });
    }
    const expectedVersion = input.expectedVersion === undefined ? null : Number(input.expectedVersion);
    if (expectedVersion !== null && (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1)) {
      throw new RelationshipSystemError('VALIDATION_ERROR', 'expectedVersion must be a positive integer.', 400, {
        field: 'expectedVersion',
      });
    }
    const { data, error } = await requireDatabase().rpc('decide_relationship_attention_recommendation', {
      p_user_id: userId,
      p_recommendation_id: requireText(recommendationId, 'recommendationId', 100),
      p_decision: decision,
      p_reason: optionalText(input.reason, 5000),
      p_observe_next: optionalText(input.observeNext, 5000),
      p_expected_version: expectedVersion,
    });
    if (error) {
      const message = databaseErrorText(error);
      if (/RS_NOT_FOUND/.test(message)) throw new RelationshipSystemError('NOT_FOUND', 'Recommendation was not found.', 404);
      if (/RS_VERSION_CONFLICT/.test(message)) throw new RelationshipSystemError('VERSION_CONFLICT', 'Recommendation changed since it was loaded.', 409);
      if (/RS_DECISION_CONFLICT/.test(message)) throw new RelationshipSystemError('DECISION_CONFLICT', 'Recommendation was already decided differently.', 409);
      if (/RS_CONTEXT_STATE_CONFLICT/.test(message)) throw new RelationshipSystemError(
        'CONTEXT_STATE_CONFLICT',
        '这段关系的策略已经变为修复或边界状态，请重新判断，不会用旧推荐覆盖。',
        409
      );
      if (/RS_PERSON_MISMATCH/.test(message)) throw new RelationshipSystemError('OWNERSHIP_MISMATCH', 'Recommendation person is invalid.', 409);
      throwIfDatabaseError(error);
    }
    return data || null;
  }

  async function getPeopleOverview() {
    const [people, recommendations, recommendationRun] = await Promise.all([
      listPeople({ limit: MAX_PAGE_SIZE }),
      listAttentionRecommendations({ status: 'draft', limit: MAX_PAGE_SIZE }),
      getLatestAttentionRecommendationRun(),
    ]);
    const personById = new Map(people.map((person) => [person.id, person]));
    const currentAttention = [];
    const relationshipLibrary = [];
    for (const person of people) {
      const primary = person.contexts.find((context) => context.is_primary) || person.contexts[0] || null;
      (CURRENT_ATTENTION_STATUSES.has(primary?.attention_status) ? currentAttention : relationshipLibrary).push(person);
    }
    const visibleRecommendations = recommendations
      .filter((item) => personById.has(item.person_id))
      .filter((item) => {
        const person = personById.get(item.person_id);
        const primary = person.contexts.find((context) => context.is_primary) || person.contexts[0] || null;
        return !CURRENT_ATTENTION_STATUSES.has(primary?.attention_status);
      });
    return {
      generated_at: new Date().toISOString(),
      recommendations: visibleRecommendations
        .map((item) => ({ ...item, person: personById.get(item.person_id) })),
      attention_people: currentAttention,
      library_people: relationshipLibrary,
      recommendation_run: recommendationRun,
      counts: {
        tracked_people: people.length,
        current_attention: currentAttention.length,
        relationship_library: relationshipLibrary.length,
        pending_recommendations: visibleRecommendations.length,
      },
    };
  }

  async function listInteractions(personId, input = {}) {
    await requirePerson(personId);
    const { data, error } = await requireDatabase().from(TABLES.interaction)
      .select('*').eq('user_id', userId).eq('person_id', personId)
      .order('occurred_at', { ascending: false }).limit(normalizeLimit(input.limit));
    throwIfDatabaseError(error);
    return data || [];
  }

  async function callInteractionExtractor(content, metadata) {
    if (interactionExtractor) return interactionExtractor(content, metadata);
    if (!getLlmApiKey()) {
      throw new RelationshipSystemError('AI_UNAVAILABLE', 'AI extraction is not configured.', 503, {
        stage: 'configuration',
      });
    }
    if (!aiClient) aiClient = new OpenAI(getOpenAIClientOptions());
    const response = await aiClient.chat.completions.create({
      model: getLlmModel(),
      temperature: 0.1,
      messages: [
        {
          role: 'system',
          content: [
            '你是“关系与机会”系统的互动记录整理器。',
            '只整理用户提供的信息，不诊断人格，不把解释写成事实。',
            '严格区分可观察事实、用户的行为、对方反应、感受与解释。',
            '无法判断时使用空数组，不得补全或编造。',
            '返回一个 JSON 对象，字段：summary, observed_facts, my_actions, their_reactions, my_feelings, interpretations, commitments, relationship_signals, opportunity_signals, review。',
            'commitments 每项为 {owner,text,due_at,status}；review 为 {matched_expectation,learning_about_them,learning_about_self,open_questions}。',
          ].join('\n'),
        },
        {
          role: 'user',
          content: JSON.stringify({ content, occurred_at: metadata.occurredAt || null }),
        },
      ],
    });
    const raw = response?.choices?.[0]?.message?.content || '';
    const parsed = extractJsonObject(raw);
    if (!parsed) {
      throw new RelationshipSystemError('AI_INVALID_RESPONSE', 'AI returned an invalid extraction.', 502, {
        stage: 'parse',
      });
    }
    return parsed;
  }

  async function createInteractionProposal(personId, input = {}) {
    await requirePerson(personId);
    const content = requireText(input.content, 'content', 50000);
    const occurredAt = input.occurredAt ? normalizeDateTime(input.occurredAt) : null;
    const sourceType = ['text', 'voice', 'manual', 'import'].includes(input.sourceType) ? input.sourceType : 'text';
    if (input.contextId) {
      const context = await getOwned(TABLES.context, input.contextId, 'Context');
      if (context.person_id !== personId) {
        throw new RelationshipSystemError('OWNERSHIP_MISMATCH', 'Context does not belong to this person.', 409);
      }
    }

    const inputSnapshot = { content, occurred_at: occurredAt, source_type: sourceType, context_id: input.contextId || null };
    const { data: proposal, error: proposalError } = await requireDatabase().from(TABLES.proposal)
      .insert([{
        user_id: userId,
        person_id: personId,
        proposal_type: 'interaction_extract',
        status: 'draft',
        input_snapshot: inputSnapshot,
        prompt_version: INTERACTION_PROMPT_VERSION,
        model: getLlmApiKey() ? getLlmModel() : null,
      }]).select('*').single();
    throwIfDatabaseError(proposalError);

    try {
      const extracted = await callInteractionExtractor(content, { occurredAt, sourceType });
      const draft = normalizeInteractionDraft({
        ...extracted,
        occurred_at: occurredAt || extracted.occurred_at,
        source_type: sourceType,
        raw_text: content,
      }, { summary: content, occurred_at: occurredAt, source_type: sourceType, raw_text: content });
      const { data, error } = await requireDatabase().from(TABLES.proposal)
        .update({ payload: draft, updated_at: new Date().toISOString() })
        .eq('id', proposal.id).eq('user_id', userId).eq('status', 'draft')
        .select('*').single();
      throwIfDatabaseError(error);
      return data;
    } catch (error) {
      const structured = error instanceof RelationshipSystemError ? error : new RelationshipSystemError(
        'AI_PROPOSAL_FAILED', 'AI interaction extraction failed.', 502, { stage: 'generation' }
      );
      await requireDatabase().from(TABLES.proposal).update({
        status: 'failed',
        error: { code: structured.code, message: structured.message, details: structured.details || null },
        updated_at: new Date().toISOString(),
      }).eq('id', proposal.id).eq('user_id', userId);
      structured.details = { ...(structured.details || {}), proposalId: proposal.id };
      throw structured;
    }
  }

  async function confirmInteraction(personId, input = {}) {
    await requirePerson(personId);
    const proposalId = requireText(input.proposalId, 'proposalId', 100);
    const idempotencyKey = requireText(input.idempotencyKey, 'idempotencyKey', 200);
    const proposal = await getOwned(TABLES.proposal, proposalId, 'AI proposal');
    if (proposal.person_id !== personId || proposal.proposal_type !== 'interaction_extract') {
      throw new RelationshipSystemError('OWNERSHIP_MISMATCH', 'Proposal does not match this person or operation.', 409);
    }
    if (proposal.status === 'failed' || proposal.status === 'rejected') {
      throw new RelationshipSystemError('PROPOSAL_NOT_CONFIRMABLE', 'This proposal cannot be confirmed.', 409);
    }
    if (proposal.status === 'confirmed' && proposal.confirmed_entity_id) {
      const interaction = await getOwned(TABLES.interaction, proposal.confirmed_entity_id, 'Interaction');
      return { interaction, duplicate: true };
    }

    const source = input.draft ? { ...proposal.payload, ...asObject(input.draft) } : proposal.payload;
    const defaults = {
      summary: proposal.input_snapshot?.content,
      occurred_at: proposal.input_snapshot?.occurred_at,
      source_type: proposal.input_snapshot?.source_type,
      raw_text: proposal.input_snapshot?.content,
    };
    const draft = normalizeInteractionDraft(source, defaults);
    const contextId = input.contextId || proposal.input_snapshot?.context_id || null;
    if (contextId) {
      const context = await getOwned(TABLES.context, contextId, 'Context');
      if (context.person_id !== personId) {
        throw new RelationshipSystemError('OWNERSHIP_MISMATCH', 'Context does not belong to this person.', 409);
      }
    }

    let interaction;
    let duplicate = false;
    const { data, error } = await requireDatabase().from(TABLES.interaction).insert([{
      user_id: userId,
      person_id: personId,
      context_id: contextId,
      ...draft,
      source_proposal_id: proposal.id,
      client_idempotency_key: idempotencyKey,
    }]).select('*').single();

    if (error && String(error.code || '') === '23505') {
      const { data: existing, error: existingError } = await requireDatabase().from(TABLES.interaction)
        .select('*').eq('user_id', userId).eq('client_idempotency_key', idempotencyKey).maybeSingle();
      throwIfDatabaseError(existingError);
      if (!existing || existing.person_id !== personId || existing.source_proposal_id !== proposal.id) {
        throw new RelationshipSystemError('IDEMPOTENCY_KEY_REUSED', 'Idempotency key was used for another operation.', 409);
      }
      interaction = existing;
      duplicate = true;
    } else {
      throwIfDatabaseError(error);
      interaction = data;
    }

    const { error: confirmError } = await requireDatabase().from(TABLES.proposal).update({
      status: 'confirmed',
      confirmed_entity_type: 'interaction',
      confirmed_entity_id: interaction.id,
      confirmed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      version: Number(proposal.version || 1) + 1,
    }).eq('id', proposal.id).eq('user_id', userId).eq('status', 'draft');
    throwIfDatabaseError(confirmError);
    return { interaction, duplicate };
  }

  async function createManualInteraction(personId, input = {}) {
    await requirePerson(personId);
    const idempotencyKey = requireText(input.idempotencyKey, 'idempotencyKey', 200);
    const source = asObject(input.draft || input);
    const draft = normalizeInteractionDraft({ ...source, source_type: 'manual' }, {
      summary: source.summary || asArray(source.observed_facts)[0] || '手动互动记录',
      occurred_at: source.occurred_at,
      source_type: 'manual',
      raw_text: source.raw_text,
    });
    const contextId = input.contextId || null;
    if (contextId) {
      const context = await getOwned(TABLES.context, contextId, 'Context');
      if (context.person_id !== personId) {
        throw new RelationshipSystemError('OWNERSHIP_MISMATCH', 'Context does not belong to this person.', 409);
      }
    }
    const { data, error } = await requireDatabase().from(TABLES.interaction).insert([{
      user_id: userId,
      person_id: personId,
      context_id: contextId,
      ...draft,
      source_proposal_id: null,
      client_idempotency_key: idempotencyKey,
    }]).select('*').single();
    if (error && String(error.code || '') === '23505') {
      const { data: existing, error: existingError } = await requireDatabase().from(TABLES.interaction)
        .select('*').eq('user_id', userId).eq('client_idempotency_key', idempotencyKey).maybeSingle();
      throwIfDatabaseError(existingError);
      if (!existing || existing.person_id !== personId || existing.source_proposal_id) {
        throw new RelationshipSystemError('IDEMPOTENCY_KEY_REUSED', 'Idempotency key was used for another operation.', 409);
      }
      return { interaction: existing, duplicate: true };
    }
    throwIfDatabaseError(error);
    return { interaction: data, duplicate: false };
  }

  async function rejectProposal(proposalId, input = {}) {
    const proposal = await getOwned(TABLES.proposal, proposalId, 'AI proposal');
    if (proposal.status !== 'draft') {
      throw new RelationshipSystemError('PROPOSAL_NOT_REJECTABLE', 'Only draft proposals can be rejected.', 409);
    }
    return updateVersioned(TABLES.proposal, proposalId, {
      status: 'rejected',
      error: input.reason ? { reason: optionalText(input.reason, 2000) } : null,
    }, input.expectedVersion, 'AI proposal');
  }

  async function createClaim(personId, input = {}) {
    await requirePerson(personId);
    if (input.contextId) {
      const context = await getOwned(TABLES.context, input.contextId, 'Context');
      if (context.person_id !== personId) throw new RelationshipSystemError('OWNERSHIP_MISMATCH', 'Context does not belong to this person.', 409);
    }
    const { data, error } = await requireDatabase().from(TABLES.claim).insert([{
      user_id: userId,
      person_id: personId,
      context_id: input.contextId || null,
      dimension: optionalText(input.dimension, 100) || 'other',
      statement: requireText(input.statement, 'statement', 10000),
      situation: optionalText(input.situation),
      status: input.status || 'hypothesis',
      confidence_level: input.confidenceLevel || 'insufficient',
      alternative_explanations: asArray(input.alternativeExplanations),
      counterevidence_notes: optionalText(input.counterevidenceNotes),
      source_type: input.sourceType || 'user',
      user_confirmed: input.userConfirmed !== false,
      last_verified_at: input.lastVerifiedAt ? normalizeDateTime(input.lastVerifiedAt) : null,
    }]).select('*').single();
    throwIfDatabaseError(error);
    return data;
  }

  async function updateClaim(claimId, input = {}) {
    const patch = {};
    if ('dimension' in input) patch.dimension = optionalText(input.dimension, 100) || 'other';
    if ('statement' in input) patch.statement = requireText(input.statement, 'statement', 10000);
    if ('situation' in input) patch.situation = optionalText(input.situation);
    if ('status' in input) patch.status = input.status;
    if ('confidenceLevel' in input) patch.confidence_level = input.confidenceLevel;
    if ('alternativeExplanations' in input) patch.alternative_explanations = asArray(input.alternativeExplanations);
    if ('counterevidenceNotes' in input) patch.counterevidence_notes = optionalText(input.counterevidenceNotes);
    if ('userConfirmed' in input) patch.user_confirmed = Boolean(input.userConfirmed);
    if ('lastVerifiedAt' in input) patch.last_verified_at = input.lastVerifiedAt ? normalizeDateTime(input.lastVerifiedAt) : null;
    return updateVersioned(TABLES.claim, claimId, patch, input.expectedVersion, 'Claim');
  }

  async function addClaimEvidence(claimId, input = {}) {
    const claim = await getOwned(TABLES.claim, claimId, 'Claim');
    if (input.interactionId) {
      const interaction = await getOwned(TABLES.interaction, input.interactionId, 'Interaction');
      if (interaction.person_id !== claim.person_id) {
        throw new RelationshipSystemError('OWNERSHIP_MISMATCH', 'Evidence interaction belongs to another person.', 409);
      }
    }
    const { data, error } = await requireDatabase().from(TABLES.evidence).insert([{
      user_id: userId,
      claim_id: claimId,
      interaction_id: input.interactionId || null,
      evidence_type: input.evidenceType || 'neutral',
      content: requireText(input.content, 'content', 10000),
      occurred_at: input.occurredAt ? normalizeDateTime(input.occurredAt) : null,
      source_label: optionalText(input.sourceLabel, 500),
    }]).select('*').single();
    throwIfDatabaseError(error);
    return data;
  }

  async function createDecision(personId, input = {}) {
    await requirePerson(personId);
    if (input.contextId) {
      const context = await getOwned(TABLES.context, input.contextId, 'Context');
      if (context.person_id !== personId) throw new RelationshipSystemError('OWNERSHIP_MISMATCH', 'Context does not belong to this person.', 409);
    }
    const status = input.status || 'draft';
    const { data, error } = await requireDatabase().from(TABLES.decision).insert([{
      user_id: userId,
      person_id: personId,
      context_id: input.contextId || null,
      decision_type: input.decisionType || 'other',
      relationship_mode: input.relationshipMode || null,
      goal: requireText(input.goal, 'goal', 10000),
      why_now: optionalText(input.whyNow),
      mutual_value: optionalText(input.mutualValue),
      options: asArray(input.options),
      selected_option: input.selectedOption ? asObject(input.selectedOption) : null,
      recommendation: optionalText(input.recommendation),
      risks: asArray(input.risks),
      boundaries: asArray(input.boundaries),
      feedback_signals: asArray(input.feedbackSignals),
      stop_conditions: asArray(input.stopConditions),
      status,
      due_at: input.dueAt ? normalizeDateTime(input.dueAt) : null,
      chosen_at: status === 'chosen' ? new Date().toISOString() : null,
      source_proposal_id: input.sourceProposalId || null,
    }]).select('*').single();
    throwIfDatabaseError(error);
    return data;
  }

  async function updateDecision(decisionId, input = {}) {
    const patch = {};
    const map = {
      decisionType: 'decision_type', relationshipMode: 'relationship_mode', whyNow: 'why_now', mutualValue: 'mutual_value',
      selectedOption: 'selected_option', feedbackSignals: 'feedback_signals', stopConditions: 'stop_conditions',
      dueAt: 'due_at',
    };
    if ('goal' in input) patch.goal = requireText(input.goal, 'goal', 10000);
    for (const [from, to] of Object.entries(map)) {
      if (!(from in input)) continue;
      if (['feedbackSignals', 'stopConditions'].includes(from)) patch[to] = asArray(input[from]);
      else if (from === 'selectedOption') patch[to] = input[from] ? asObject(input[from]) : null;
      else if (from === 'dueAt') patch[to] = input[from] ? normalizeDateTime(input[from]) : null;
      else patch[to] = optionalText(input[from]);
    }
    if ('options' in input) patch.options = asArray(input.options);
    if ('recommendation' in input) patch.recommendation = optionalText(input.recommendation);
    if ('risks' in input) patch.risks = asArray(input.risks);
    if ('boundaries' in input) patch.boundaries = asArray(input.boundaries);
    if ('status' in input) {
      patch.status = input.status;
      if (input.status === 'chosen') patch.chosen_at = new Date().toISOString();
    }
    return updateVersioned(TABLES.decision, decisionId, patch, input.expectedVersion, 'Decision');
  }

  async function saveDecisionOutcome(decisionId, input = {}) {
    const decision = await getOwned(TABLES.decision, decisionId, 'Decision');
    const payload = {
      executed_at: input.executedAt ? normalizeDateTime(input.executedAt) : null,
      execution_notes: optionalText(input.executionNotes),
      actual_response: optionalText(input.actualResponse),
      result: optionalText(input.result),
      expected_match: input.expectedMatch || 'unknown',
      learning_about_them: optionalText(input.learningAboutThem),
      learning_about_self: optionalText(input.learningAboutSelf),
      follow_up: optionalText(input.followUp),
    };
    const { data: existing, error: existingError } = await requireDatabase().from(TABLES.outcome)
      .select('*').eq('user_id', userId).eq('decision_id', decisionId).maybeSingle();
    throwIfDatabaseError(existingError);
    let outcome;
    if (existing) outcome = await updateVersioned(TABLES.outcome, existing.id, payload, input.expectedVersion, 'Decision outcome');
    else {
      const { data, error } = await requireDatabase().from(TABLES.outcome)
        .insert([{ ...payload, user_id: userId, decision_id: decisionId }]).select('*').single();
      throwIfDatabaseError(error);
      outcome = data;
    }
    let savedDecision = decision;
    if (input.completeDecision !== false && decision.status !== 'completed') {
      savedDecision = await updateVersioned(TABLES.decision, decisionId, { status: 'completed' }, decision.version, 'Decision');
    }
    return { decision: { ...savedDecision, outcome }, outcome };
  }

  async function listOpportunities(input = {}) {
    let query = requireDatabase().from(TABLES.opportunity).select('*').eq('user_id', userId);
    if (input.stage) query = query.eq('stage', input.stage);
    if (input.status) query = query.eq('status', input.status);
    const { data, error } = await query.order('updated_at', { ascending: false }).limit(normalizeLimit(input.limit, 100));
    throwIfDatabaseError(error);
    return data || [];
  }

  async function getOpportunity(opportunityId) {
    const opportunity = await getOwned(TABLES.opportunity, opportunityId, 'Opportunity');
    const { data: experiments, error } = await requireDatabase().from(TABLES.experiment)
      .select('*').eq('user_id', userId).eq('opportunity_id', opportunityId)
      .order('created_at', { ascending: false });
    throwIfDatabaseError(error);
    return { opportunity, experiments: experiments || [] };
  }

  async function createOpportunity(input = {}) {
    if (input.sourcePersonId) await requirePerson(input.sourcePersonId);
    const { data, error } = await requireDatabase().from(TABLES.opportunity).insert([{
      user_id: userId,
      title: requireText(input.title, 'title', 500),
      problem_statement: requireText(input.problemStatement, 'problemStatement', 10000),
      target_customer: optionalText(input.targetCustomer),
      beneficiary: optionalText(input.beneficiary),
      decision_maker: optionalText(input.decisionMaker),
      payer: optionalText(input.payer),
      frequency: optionalText(input.frequency),
      cost_of_problem: optionalText(input.costOfProblem),
      urgency: optionalText(input.urgency),
      current_workaround: optionalText(input.currentWorkaround),
      access_channel: optionalText(input.accessChannel),
      evidence_summary: optionalText(input.evidenceSummary),
      payment_signal: optionalText(input.paymentSignal),
      next_missing_evidence: optionalText(input.nextMissingEvidence),
      stage: input.stage || 'signal',
      source_person_id: input.sourcePersonId || null,
      related_person_ids: asArray(input.relatedPersonIds),
      status: input.status || 'active',
    }]).select('*').single();
    throwIfDatabaseError(error);
    return data;
  }

  async function updateOpportunity(opportunityId, input = {}) {
    const fieldMap = {
      title: 'title', problemStatement: 'problem_statement', targetCustomer: 'target_customer',
      beneficiary: 'beneficiary', decisionMaker: 'decision_maker', payer: 'payer', frequency: 'frequency',
      costOfProblem: 'cost_of_problem', urgency: 'urgency', currentWorkaround: 'current_workaround',
      accessChannel: 'access_channel', evidenceSummary: 'evidence_summary', paymentSignal: 'payment_signal',
      nextMissingEvidence: 'next_missing_evidence', stage: 'stage', status: 'status',
    };
    const patch = {};
    for (const [from, to] of Object.entries(fieldMap)) {
      if (from in input) patch[to] = from === 'title' || from === 'problemStatement'
        ? requireText(input[from], from, 10000) : optionalText(input[from]);
    }
    if ('relatedPersonIds' in input) patch.related_person_ids = asArray(input.relatedPersonIds);
    return updateVersioned(TABLES.opportunity, opportunityId, patch, input.expectedVersion, 'Opportunity');
  }

  async function createExperiment(opportunityId, input = {}) {
    await getOwned(TABLES.opportunity, opportunityId, 'Opportunity');
    const { data, error } = await requireDatabase().from(TABLES.experiment).insert([{
      user_id: userId,
      opportunity_id: opportunityId,
      experiment_type: input.experimentType || 'other',
      hypothesis: requireText(input.hypothesis, 'hypothesis', 10000),
      method: optionalText(input.method),
      success_criteria: optionalText(input.successCriteria),
      planned_at: input.plannedAt ? normalizeDateTime(input.plannedAt) : null,
      executed_at: input.executedAt ? normalizeDateTime(input.executedAt) : null,
      status: input.status || 'planned',
      result: optionalText(input.result),
      outcome: input.outcome || null,
      revenue_amount: input.revenueAmount ?? null,
      currency: optionalText(input.currency, 10) || 'CNY',
      next_step: optionalText(input.nextStep),
    }]).select('*').single();
    throwIfDatabaseError(error);
    return data;
  }

  async function updateExperiment(experimentId, input = {}) {
    const patch = {};
    const map = {
      experimentType: 'experiment_type', hypothesis: 'hypothesis', method: 'method', successCriteria: 'success_criteria',
      plannedAt: 'planned_at', executedAt: 'executed_at', status: 'status', result: 'result', outcome: 'outcome',
      revenueAmount: 'revenue_amount', currency: 'currency', nextStep: 'next_step',
    };
    for (const [from, to] of Object.entries(map)) {
      if (!(from in input)) continue;
      if (['plannedAt', 'executedAt'].includes(from)) patch[to] = input[from] ? normalizeDateTime(input[from]) : null;
      else if (from === 'revenueAmount') patch[to] = input[from] ?? null;
      else if (from === 'hypothesis') patch[to] = requireText(input[from], from, 10000);
      else patch[to] = optionalText(input[from]);
    }
    return updateVersioned(TABLES.experiment, experimentId, patch, input.expectedVersion, 'Experiment');
  }

  async function listWeeklyReviews(input = {}) {
    const { data, error } = await requireDatabase().from(TABLES.weeklyReview).select('*')
      .eq('user_id', userId).order('week_start', { ascending: false }).limit(normalizeLimit(input.limit, 20));
    throwIfDatabaseError(error);
    return data || [];
  }

  function currentWeekStart(date = new Date()) {
    const value = new Date(date);
    value.setHours(0, 0, 0, 0);
    const day = value.getDay();
    value.setDate(value.getDate() - (day === 0 ? 6 : day - 1));
    return value.toISOString().slice(0, 10);
  }

  async function getCurrentWeeklyReview() {
    const weekStart = currentWeekStart();
    const { data, error } = await requireDatabase().from(TABLES.weeklyReview).select('*')
      .eq('user_id', userId).eq('week_start', weekStart).maybeSingle();
    throwIfDatabaseError(error);
    return data || null;
  }

  async function generateWeeklyReview() {
    const weekStart = currentWeekStart();
    const existing = await getCurrentWeeklyReview();
    if (existing) return existing;
    const startIso = `${weekStart}T00:00:00.000Z`;
    const [interactionsResult, claimsResult, decisionsResult, opportunitiesResult] = await Promise.all([
      requireDatabase().from(TABLES.interaction).select('id,person_id,summary,commitments,opportunity_signals,occurred_at')
        .eq('user_id', userId).gte('occurred_at', startIso).order('occurred_at', { ascending: false }),
      requireDatabase().from(TABLES.claim).select('id,person_id,statement,status,updated_at')
        .eq('user_id', userId).eq('status', 'contradicted').gte('updated_at', startIso),
      requireDatabase().from(TABLES.decision).select('id,person_id,goal,recommendation,due_at,status')
        .eq('user_id', userId).in('status', ['chosen', 'executing']).order('due_at', { ascending: true }),
      requireDatabase().from(TABLES.opportunity).select('id,title,stage,next_missing_evidence,updated_at')
        .eq('user_id', userId).eq('status', 'active').order('updated_at', { ascending: false }).limit(5),
    ]);
    [interactionsResult, claimsResult, decisionsResult, opportunitiesResult].forEach((result) => throwIfDatabaseError(result.error));
    const interactions = interactionsResult.data || [];
    const openCommitments = interactions.flatMap((interaction) => asArray(interaction.commitments)
      .filter((item) => !['done', 'cancelled'].includes(String(item?.status || 'open')))
      .map((item) => ({ ...item, person_id: interaction.person_id, source_interaction_id: interaction.id })));
    const opportunitySignals = interactions.flatMap((interaction) => asArray(interaction.opportunity_signals)
      .map((signal) => ({ signal, person_id: interaction.person_id, interaction_id: interaction.id })));
    return saveWeeklyReview({
      weekStart,
      summary: interactions.length
        ? `本周已记录 ${interactions.length} 次真实互动，请确认变化、盲点和下周行动。`
        : '本周还没有新互动，可以先回顾未完成承诺和当前机会。',
      importantChanges: interactions.slice(0, 8).map((item) => ({
        interaction_id: item.id, person_id: item.person_id, summary: item.summary, occurred_at: item.occurred_at,
      })),
      openCommitments,
      contradictedClaims: claimsResult.data || [],
      opportunitySignals,
      nextPeopleActions: (decisionsResult.data || []).slice(0, 3).map((item) => ({
        decision_id: item.id, person_id: item.person_id, title: item.recommendation || item.goal, due_at: item.due_at,
      })),
      nextOpportunityExperiment: (opportunitiesResult.data || [])[0] || null,
      userConfirmed: false,
    });
  }

  async function confirmWeeklyReview(reviewId, input = {}) {
    const review = await getOwned(TABLES.weeklyReview, reviewId, 'Weekly review');
    const patch = {};
    if ('summary' in input) patch.summary = optionalText(input.summary);
    if ('importantChanges' in input) patch.important_changes = asArray(input.importantChanges);
    if ('neglectedRelationships' in input) patch.neglected_relationships = asArray(input.neglectedRelationships);
    if ('openCommitments' in input) patch.open_commitments = asArray(input.openCommitments);
    if ('overinvestmentSignals' in input) patch.overinvestment_signals = asArray(input.overinvestmentSignals);
    if ('contradictedClaims' in input) patch.contradicted_claims = asArray(input.contradictedClaims);
    if ('opportunitySignals' in input) patch.opportunity_signals = asArray(input.opportunitySignals);
    if ('selfPattern' in input) patch.self_pattern = optionalText(input.selfPattern);
    if ('principle' in input) patch.principle = optionalText(input.principle);
    if ('nextPeopleActions' in input) patch.next_people_actions = asArray(input.nextPeopleActions).slice(0, 3);
    if ('nextOpportunityExperiment' in input) {
      patch.next_opportunity_experiment = input.nextOpportunityExperiment ? asObject(input.nextOpportunityExperiment) : null;
    }
    patch.user_confirmed = true;
    const saved = await updateVersioned(TABLES.weeklyReview, review.id, patch, input.expectedVersion, 'Weekly review');
    const selfPattern = optionalText(input.selfPattern);
    if (selfPattern) {
      const { data: existingPattern, error: patternError } = await requireDatabase().from(TABLES.growth)
        .select('*').eq('user_id', userId).eq('source_weekly_review_id', review.id).maybeSingle();
      throwIfDatabaseError(patternError);
      const patternPayload = {
        category: 'people_skill',
        title: selfPattern.slice(0, 120),
        pattern_statement: selfPattern,
        evidence_refs: [{ weekly_review_id: review.id, week_start: review.week_start }],
        status: 'hypothesis',
        source_weekly_review_id: review.id,
      };
      if (existingPattern) {
        await updateVersioned(TABLES.growth, existingPattern.id, patternPayload, existingPattern.version, 'Growth pattern');
      } else {
        const { error: insertError } = await requireDatabase().from(TABLES.growth)
          .insert([{ ...patternPayload, user_id: userId }]);
        throwIfDatabaseError(insertError);
      }
    }
    return saved;
  }

  function weeklyReviewPayload(input) {
    return {
      week_start: normalizeDate(input.weekStart),
      summary: optionalText(input.summary),
      important_changes: asArray(input.importantChanges),
      neglected_relationships: asArray(input.neglectedRelationships),
      open_commitments: asArray(input.openCommitments),
      overinvestment_signals: asArray(input.overinvestmentSignals),
      contradicted_claims: asArray(input.contradictedClaims),
      opportunity_signals: asArray(input.opportunitySignals),
      self_pattern: optionalText(input.selfPattern),
      principle: optionalText(input.principle),
      next_people_actions: asArray(input.nextPeopleActions).slice(0, 3),
      next_opportunity_experiment: input.nextOpportunityExperiment ? asObject(input.nextOpportunityExperiment) : null,
      user_confirmed: Boolean(input.userConfirmed),
    };
  }

  async function saveWeeklyReview(input = {}) {
    const payload = weeklyReviewPayload(input);
    const { data: existing, error: findError } = await requireDatabase().from(TABLES.weeklyReview)
      .select('*').eq('user_id', userId).eq('week_start', payload.week_start).maybeSingle();
    throwIfDatabaseError(findError);
    if (existing) return updateVersioned(TABLES.weeklyReview, existing.id, payload, input.expectedVersion, 'Weekly review');
    const { data, error } = await requireDatabase().from(TABLES.weeklyReview)
      .insert([{ ...payload, user_id: userId }]).select('*').single();
    throwIfDatabaseError(error);
    return data;
  }

  async function listGrowthPatterns(input = {}) {
    let query = requireDatabase().from(TABLES.growth).select('*').eq('user_id', userId);
    if (input.status) query = query.eq('status', input.status);
    if (input.category) query = query.eq('category', input.category);
    const { data, error } = await query.order('updated_at', { ascending: false }).limit(normalizeLimit(input.limit, 100));
    throwIfDatabaseError(error);
    return data || [];
  }

  async function createGrowthPattern(input = {}) {
    const { data, error } = await requireDatabase().from(TABLES.growth).insert([{
      user_id: userId,
      category: input.category || 'people_skill',
      title: requireText(input.title, 'title', 500),
      pattern_statement: requireText(input.patternStatement, 'patternStatement', 10000),
      evidence_refs: asArray(input.evidenceRefs),
      counterexamples: asArray(input.counterexamples),
      status: input.status || 'hypothesis',
      training_action: optionalText(input.trainingAction),
      next_review_at: input.nextReviewAt ? normalizeDateTime(input.nextReviewAt) : null,
    }]).select('*').single();
    throwIfDatabaseError(error);
    return data;
  }

  async function updateGrowthPattern(patternId, input = {}) {
    const patch = {};
    if ('category' in input) patch.category = input.category;
    if ('title' in input) patch.title = requireText(input.title, 'title', 500);
    if ('patternStatement' in input) patch.pattern_statement = requireText(input.patternStatement, 'patternStatement', 10000);
    if ('evidenceRefs' in input) patch.evidence_refs = asArray(input.evidenceRefs);
    if ('counterexamples' in input) patch.counterexamples = asArray(input.counterexamples);
    if ('status' in input) patch.status = input.status;
    if ('trainingAction' in input) patch.training_action = optionalText(input.trainingAction);
    if ('nextReviewAt' in input) patch.next_review_at = input.nextReviewAt ? normalizeDateTime(input.nextReviewAt) : null;
    return updateVersioned(TABLES.growth, patternId, patch, input.expectedVersion, 'Growth pattern');
  }

  async function getPersonWorkspace(personId) {
    const person = await requirePerson(personId);
    const [contextsResult, interactionsResult, claimsResult, decisionsResult] = await Promise.all([
      requireDatabase().from(TABLES.context).select('*').eq('user_id', userId).eq('person_id', personId)
        .order('is_primary', { ascending: false }).order('updated_at', { ascending: false }),
      requireDatabase().from(TABLES.interaction).select('*').eq('user_id', userId).eq('person_id', personId)
        .order('occurred_at', { ascending: false }).limit(50),
      requireDatabase().from(TABLES.claim).select('*').eq('user_id', userId).eq('person_id', personId)
        .order('updated_at', { ascending: false }),
      requireDatabase().from(TABLES.decision).select('*').eq('user_id', userId).eq('person_id', personId)
        .order('updated_at', { ascending: false }).limit(50),
    ]);
    [contextsResult, interactionsResult, claimsResult, decisionsResult].forEach((result) => throwIfDatabaseError(result.error));
    const claimIds = (claimsResult.data || []).map((item) => item.id);
    const decisionIds = (decisionsResult.data || []).map((item) => item.id);
    const evidenceResult = claimIds.length
      ? await requireDatabase().from(TABLES.evidence).select('*').eq('user_id', userId).in('claim_id', claimIds)
        .order('created_at', { ascending: false })
      : { data: [], error: null };
    const outcomeResult = decisionIds.length
      ? await requireDatabase().from(TABLES.outcome).select('*').eq('user_id', userId).in('decision_id', decisionIds)
      : { data: [], error: null };
    throwIfDatabaseError(evidenceResult.error);
    throwIfDatabaseError(outcomeResult.error);
    return {
      person,
      contexts: contextsResult.data || [],
      interactions: interactionsResult.data || [],
      claims: (claimsResult.data || []).map((claim) => ({
        ...claim,
        evidence: (evidenceResult.data || []).filter((item) => item.claim_id === claim.id),
      })),
      decisions: (decisionsResult.data || []).map((decision) => ({
        ...decision,
        outcome: (outcomeResult.data || []).find((item) => item.decision_id === decision.id) || null,
      })),
    };
  }

  async function getToday() {
    const now = new Date();
    const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const momentumSince = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const [compass, people, decisionsResult, opportunitiesResult, reviewResult, interactionsResult] = await Promise.all([
      getCompass(),
      listPeople({ limit: 100 }),
      requireDatabase().from(TABLES.decision).select('*').eq('user_id', userId)
        .in('status', ['chosen', 'executing']).lte('due_at', nextWeek).order('due_at', { ascending: true }),
      requireDatabase().from(TABLES.opportunity).select('*').eq('user_id', userId).eq('status', 'active')
        .order('updated_at', { ascending: false }).limit(5),
      requireDatabase().from(TABLES.weeklyReview).select('*').eq('user_id', userId)
        .order('week_start', { ascending: false }).limit(1).maybeSingle(),
      requireDatabase().from(TABLES.interaction).select('id,person_id,summary,commitments,occurred_at')
        .eq('user_id', userId).gte('occurred_at', momentumSince).order('occurred_at', { ascending: false }).limit(100),
    ]);
    [decisionsResult, opportunitiesResult, reviewResult, interactionsResult].forEach((result) => throwIfDatabaseError(result.error));
    const attentionPeople = people
      .filter((person) => person.contexts.some((context) => ['focus', 'repair', 'boundary'].includes(context.attention_status)))
      .slice(0, 5);
    const recentInteractions = interactionsResult.data || [];
    const dueCommitments = recentInteractions.flatMap((interaction) => asArray(interaction.commitments)
      .filter((item) => !['done', 'cancelled'].includes(String(item?.status || 'open')))
      .map((item, index) => ({
        id: item.id || `${interaction.id}-${index}`,
        ...item,
        person_id: interaction.person_id,
        source_interaction_id: interaction.id,
      })));
    const momentumIds = new Set(recentInteractions.map((item) => item.person_id));
    const momentumPeople = people.filter((person) => momentumIds.has(person.id)).slice(0, 5);
    const latestReview = reviewResult.data || null;
    const weeklyReviewDue = !latestReview
      || latestReview.week_start !== currentWeekStart(now)
      || latestReview.user_confirmed !== true;
    return {
      generated_at: now.toISOString(),
      compass,
      attention_people: attentionPeople,
      due_decisions: decisionsResult.data || [],
      due_commitments: dueCommitments,
      momentum_people: momentumPeople,
      active_opportunities: opportunitiesResult.data || [],
      active_opportunity: (opportunitiesResult.data || [])[0] || null,
      latest_weekly_review: latestReview,
      weekly_review_due: weeklyReviewDue,
      counts: {
        tracked_people: people.length,
        attention_people: attentionPeople.length,
        due_decisions: (decisionsResult.data || []).length,
        active_opportunities: (opportunitiesResult.data || []).length,
      },
    };
  }

  return {
    healthcheck,
    getCompass,
    saveCompass,
    getToday,
    listPeople,
    createPerson,
    getPersonWorkspace,
    listContexts,
    createContext,
    updateContext,
    setPersonAttention,
    listAttentionRecommendations,
    getLatestAttentionRecommendationRun,
    replaceAttentionRecommendations,
    decideAttentionRecommendation,
    getPeopleOverview,
    listInteractions,
    createInteractionProposal,
    confirmInteraction,
    createManualInteraction,
    rejectProposal,
    createClaim,
    updateClaim,
    addClaimEvidence,
    createDecision,
    updateDecision,
    saveDecisionOutcome,
    listOpportunities,
    getOpportunity,
    createOpportunity,
    updateOpportunity,
    createExperiment,
    updateExperiment,
    listWeeklyReviews,
    getCurrentWeeklyReview,
    generateWeeklyReview,
    confirmWeeklyReview,
    saveWeeklyReview,
    listGrowthPatterns,
    createGrowthPattern,
    updateGrowthPattern,
    __setClientForTests(client) { supabase = client; },
  };
}

const relationshipSystemService = createRelationshipSystemService();

module.exports = relationshipSystemService;
module.exports.createRelationshipSystemService = createRelationshipSystemService;
module.exports.RelationshipSystemError = RelationshipSystemError;
module.exports.__test = {
  isMigrationMissingError,
  translateDatabaseError,
  normalizeInteractionDraft,
  normalizeLimit,
  TABLES,
  ATTENTION_RECOMMENDATION_TYPE,
  ATTENTION_RECOMMENDATION_RUN_TYPE,
};
