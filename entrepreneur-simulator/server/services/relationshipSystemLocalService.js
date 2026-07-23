const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const OpenAI = require('openai');

const legacyDbService = require('./dbService');
const { DEFAULT_USER_ID } = require('../config/currentUser');
const { getLlmApiKey, getLlmModel, getOpenAIClientOptions } = require('./llmConfig');
const { extractJsonObject } = require('../utils/aiResponse');
const { RelationshipSystemError } = require('./relationshipSystemService');
const {
  PlanningStateValidationError,
  cloneDefaultPlanningState,
  normalizePlanningState,
} = require('./relationshipPlanningState');

const SCHEMA_VERSION = 1;
const MAX_PAGE_SIZE = 200;
const INTERACTION_PROMPT_VERSION = 'relationship-interaction-extract-local-v1';
const ATTENTION_RECOMMENDATION_TYPE = 'attention_recommendation';
const ATTENTION_RECOMMENDATION_RUN_TYPE = 'attention_recommendation_run';
const CURRENT_ATTENTION_STATUSES = new Set(['focus', 'repair', 'boundary']);
const ATTENTION_STATUSES = new Set(['focus', 'maintain', 'observe', 'repair', 'boundary', 'sleep', 'archived']);
const DEFAULT_FILE_PATH = path.resolve(
  String(process.env.RELATIONSHIP_LOCAL_FILE || '').trim()
    || path.join(__dirname, '..', 'data', 'relationship-system.local.json')
);

const TABLES = Object.freeze({
  people: 'people_profiles',
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

const TABLE_NAMES = Object.freeze(Object.values(TABLES));
const PERSON_PUBLIC_FIELDS = Object.freeze([
  'id', 'name', 'identity', 'field', 'tags', 'category', 'avatar_real',
  'first_met_date', 'first_met_scene', 'birthday', 'hometown',
  'created_at', 'updated_at',
]);

function deepClone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
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

function currentWeekStart(date = new Date()) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  const day = value.getDay();
  value.setDate(value.getDate() - (day === 0 ? 6 : day - 1));
  return value.toISOString().slice(0, 10);
}

function createEmptyState() {
  const tables = {};
  for (const table of TABLE_NAMES) tables[table] = [];
  return {
    schema_version: SCHEMA_VERSION,
    updated_at: new Date().toISOString(),
    tables,
  };
}

function normalizeState(value) {
  const source = asObject(value);
  const sourceTables = asObject(source.tables);
  const empty = createEmptyState();
  const tables = { ...sourceTables };
  for (const table of TABLE_NAMES) tables[table] = asArray(sourceTables[table]);
  return {
    ...source,
    schema_version: Number(source.schema_version || SCHEMA_VERSION),
    updated_at: source.updated_at || empty.updated_at,
    tables,
  };
}

async function replaceByRename(source, target, allowUnlinkFallback = true) {
  try {
    await fs.promises.rename(source, target);
  } catch (error) {
    if (!allowUnlinkFallback || !['EEXIST', 'EPERM'].includes(error?.code)) throw error;
    await fs.promises.rm(target, { force: true });
    await fs.promises.rename(source, target);
  }
}

class LocalJsonStore {
  constructor(filePath) {
    this.filePath = path.resolve(filePath || DEFAULT_FILE_PATH);
    this.backupPath = `${this.filePath}.bak`;
    this.state = null;
    this.loadedFromBackup = false;
    this.queue = Promise.resolve();
  }

  async readJson(filePath) {
    const raw = await fs.promises.readFile(filePath, 'utf8');
    return normalizeState(JSON.parse(raw));
  }

  async load() {
    if (this.state) return this.state;
    await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      this.state = await this.readJson(this.filePath);
      return this.state;
    } catch (primaryError) {
      if (primaryError?.code === 'ENOENT') {
        try {
          this.state = await this.readJson(this.backupPath);
          this.loadedFromBackup = true;
          return this.state;
        } catch (backupError) {
          if (backupError?.code === 'ENOENT') {
            this.state = createEmptyState();
            return this.state;
          }
          throw new RelationshipSystemError('LOCAL_DATA_CORRUPT', 'Local relationship backup is not valid JSON.', 500);
        }
      }
      try {
        this.state = await this.readJson(this.backupPath);
        this.loadedFromBackup = true;
        return this.state;
      } catch {
        throw new RelationshipSystemError('LOCAL_DATA_CORRUPT', 'Local relationship data and its backup are not valid JSON.', 500);
      }
    }
  }

  async write(nextState) {
    const directory = path.dirname(this.filePath);
    await fs.promises.mkdir(directory, { recursive: true });
    const tempPath = path.join(
      directory,
      `.${path.basename(this.filePath)}.${process.pid}.${Date.now()}.${crypto.randomUUID()}.tmp`
    );
    const backupTempPath = `${this.backupPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    const payload = `${JSON.stringify(nextState, null, 2)}\n`;
    let handle;
    try {
      handle = await fs.promises.open(tempPath, 'wx', 0o600);
      await handle.writeFile(payload, 'utf8');
      await handle.sync();
      await handle.close();
      handle = null;

      if (!this.loadedFromBackup) {
        try {
          await fs.promises.copyFile(this.filePath, backupTempPath);
          await fs.promises.chmod(backupTempPath, 0o600).catch(() => {});
          await replaceByRename(backupTempPath, this.backupPath);
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error;
        }
      }

      // Replacing the primary file is rename-only. If the OS cannot perform an
      // atomic replacement, keep the old file intact and surface the error.
      await replaceByRename(tempPath, this.filePath, false);
      await fs.promises.chmod(this.filePath, 0o600).catch(() => {});
      this.loadedFromBackup = false;
    } finally {
      if (handle) await handle.close().catch(() => {});
      await fs.promises.rm(tempPath, { force: true }).catch(() => {});
      await fs.promises.rm(backupTempPath, { force: true }).catch(() => {});
    }
  }

  async read(reader) {
    await this.queue.catch(() => {});
    const state = await this.load();
    return deepClone(await reader(state));
  }

  async mutate(mutator) {
    const operation = this.queue.then(async () => {
      const current = await this.load();
      const draft = deepClone(current);
      const result = await mutator(draft);
      draft.schema_version = SCHEMA_VERSION;
      draft.updated_at = new Date().toISOString();
      await this.write(draft);
      this.state = draft;
      return deepClone(result);
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
}

function newRecord(payload) {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    user_id: DEFAULT_USER_ID,
    ...payload,
    version: 1,
    created_at: now,
    updated_at: now,
  };
}

function findOwned(state, table, id, label = 'Record') {
  requireText(id, `${label.toLowerCase()}Id`, 200);
  const record = state.tables[table].find((item) => item.id === id && item.user_id === DEFAULT_USER_ID);
  if (!record) throw new RelationshipSystemError('NOT_FOUND', `${label} was not found.`, 404);
  return record;
}

function updateVersioned(state, table, id, patch, expectedVersion, label) {
  const record = findOwned(state, table, id, label);
  if (expectedVersion !== undefined && Number(expectedVersion) !== Number(record.version)) {
    throw new RelationshipSystemError('VERSION_CONFLICT', `${label} changed since it was loaded.`, 409, {
      currentVersion: record.version,
    });
  }
  Object.assign(record, patch, {
    version: Number(record.version || 1) + 1,
    updated_at: new Date().toISOString(),
  });
  return record;
}

function sanitizePerson(row) {
  if (!row || typeof row !== 'object' || !row.id || !row.name) return null;
  const person = { user_id: DEFAULT_USER_ID };
  for (const field of PERSON_PUBLIC_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(row, field)) person[field] = deepClone(row[field]);
  }
  person.id = String(person.id);
  person.name = String(person.name);
  person.tags = asArray(person.tags);
  return person;
}

function legacyInteraction(row, personId) {
  if (!row || !row.id) return null;
  let occurredAt = null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(row.event_date || ''))) {
    occurredAt = `${row.event_date}T12:00:00.000Z`;
  } else {
    const candidate = new Date(row.event_date || row.created_at || 0);
    if (!Number.isNaN(candidate.getTime())) occurredAt = candidate.toISOString();
  }
  const createdCandidate = new Date(row.created_at || 0);
  const createdAt = Number.isNaN(createdCandidate.getTime())
    ? (occurredAt || new Date(0).toISOString())
    : createdCandidate.toISOString();
  return {
    id: `legacy-${row.id}`,
    user_id: DEFAULT_USER_ID,
    person_id: personId,
    context_id: null,
    occurred_at: occurredAt || createdAt,
    source_type: 'import',
    raw_text: null,
    summary: optionalText(row.event_context, 5000) || '旧版互动记录',
    observed_facts: [],
    my_actions: row.my_behavior ? [String(row.my_behavior)] : [],
    their_reactions: row.their_reaction ? [String(row.their_reaction)] : [],
    my_feelings: [],
    interpretations: [],
    commitments: [],
    relationship_signals: [],
    opportunity_signals: [],
    review: {},
    legacy_read_only: true,
    legacy_interaction_id: String(row.id),
    version: 1,
    created_at: createdAt,
    updated_at: createdAt,
  };
}

function syntheticContext(person) {
  const valid = ['family', 'partner', 'friend', 'mentor', 'colleague', 'business', 'customer', 'other'];
  const contextType = valid.includes(String(person.category || '')) ? person.category : 'other';
  const createdAt = person.created_at || new Date(0).toISOString();
  return {
    id: `legacy-context-${person.id}`,
    user_id: DEFAULT_USER_ID,
    person_id: person.id,
    context_type: contextType,
    label: person.category || null,
    attention_status: 'observe',
    why_matters_now: null,
    current_state: null,
    current_goal: null,
    mutual_value: null,
    boundaries: [],
    relationship_health: {},
    urgency: {},
    is_primary: true,
    legacy_read_only: true,
    version: 1,
    created_at: createdAt,
    updated_at: person.updated_at || createdAt,
  };
}

function fallbackInteractionDraft(content, occurredAt, sourceType, warningCode) {
  const normalized = String(content || '').replace(/\s+/g, ' ').trim();
  const summary = normalized.slice(0, 240) || '待确认互动记录';
  return {
    ...normalizeInteractionDraft({
      occurred_at: occurredAt,
      source_type: sourceType,
      raw_text: content,
      summary,
    }, { summary, occurred_at: occurredAt, source_type: sourceType, raw_text: content }),
    warnings: [{
      code: warningCode || 'AI_UNAVAILABLE',
      message: '已生成可编辑的规则草稿；其中尚未形成任何人物判断，请确认后再保存。',
    }],
  };
}

function createRelationshipSystemLocalService(options = {}) {
  const store = new LocalJsonStore(options.filePath || DEFAULT_FILE_PATH);
  const legacy = options.legacyDbService || legacyDbService;
  const interactionExtractor = options.interactionExtractor || null;
  let aiClient = options.aiClient || null;

  async function legacyPeople() {
    try {
      const rows = await legacy.getPeopleProfiles(DEFAULT_USER_ID);
      return asArray(rows).map(sanitizePerson).filter(Boolean);
    } catch {
      return [];
    }
  }

  async function allPeople() {
    const [local, old] = await Promise.all([
      store.read((state) => state.tables[TABLES.people].filter((item) => item.user_id === DEFAULT_USER_ID)),
      legacyPeople(),
    ]);
    const byId = new Map(old.map((item) => [item.id, item]));
    for (const person of local.map(sanitizePerson).filter(Boolean)) byId.set(person.id, person);
    return Array.from(byId.values());
  }

  async function requirePerson(personId) {
    const id = requireText(personId, 'personId', 200);
    const person = (await allPeople()).find((item) => item.id === id);
    if (!person) throw new RelationshipSystemError('NOT_FOUND', 'Person was not found.', 404);
    return person;
  }

  async function oldInteractions(personId) {
    try {
      const rows = await legacy.getInteractionLogs(personId);
      return asArray(rows).map((item) => legacyInteraction(item, personId)).filter(Boolean);
    } catch {
      return [];
    }
  }

  async function resolveContext(personId, contextId) {
    if (!contextId) return null;
    if (contextId === `legacy-context-${personId}`) return null;
    return store.read((state) => {
      const context = findOwned(state, TABLES.context, contextId, 'Context');
      if (context.person_id !== personId) {
        throw new RelationshipSystemError('OWNERSHIP_MISMATCH', 'Context does not belong to this person.', 409);
      }
      return context.id;
    });
  }

  async function callInteractionExtractor(content, metadata) {
    if (interactionExtractor) return interactionExtractor(content, metadata);
    if (!getLlmApiKey()) {
      throw new RelationshipSystemError('AI_UNAVAILABLE', 'AI extraction is not configured.', 503);
    }
    if (!aiClient) aiClient = new OpenAI(getOpenAIClientOptions());
    const response = await aiClient.chat.completions.create({
      model: getLlmModel(),
      temperature: 0.1,
      messages: [
        {
          role: 'system',
          content: [
            '你是关系互动记录整理器。只整理用户提供的信息。',
            '不要诊断人格，不要把解释写成事实，不得补全或编造。',
            '严格返回 JSON：summary, observed_facts, my_actions, their_reactions, my_feelings, interpretations, commitments, relationship_signals, opportunity_signals, review。',
          ].join('\n'),
        },
        { role: 'user', content: JSON.stringify({ content, occurred_at: metadata.occurredAt || null }) },
      ],
    });
    const parsed = extractJsonObject(response?.choices?.[0]?.message?.content || '');
    if (!parsed) throw new RelationshipSystemError('AI_INVALID_RESPONSE', 'AI returned invalid structured data.', 502);
    return parsed;
  }

  async function healthcheck() {
    await store.read(() => true);
    return {
      ready: true,
      storage: 'local-json',
      migration: 'local-json-v1',
      localFile: store.filePath,
      recovered_from_backup: store.loadedFromBackup,
    };
  }

  async function getCompass() {
    const compass = await store.read((state) => state.tables[TABLES.compass]
      .find((item) => item.user_id === DEFAULT_USER_ID && item.is_active) || null);
    return compassWithPlanningState(compass);
  }

  async function saveCompass(input = {}) {
    return store.mutate((state) => {
      const current = state.tables[TABLES.compass]
        .find((item) => item.user_id === DEFAULT_USER_ID && item.is_active);
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
      } else if (!current || current.planning_state === undefined || current.planning_state === null) {
        values.planning_state = cloneDefaultPlanningState();
      }
      if (current) return updateVersioned(state, TABLES.compass, current.id, values, input.expectedVersion, 'Compass');
      const created = newRecord({ ...values, is_active: true });
      state.tables[TABLES.compass].push(created);
      return created;
    });
  }

  async function contextsForPerson(person) {
    const contexts = await store.read((state) => state.tables[TABLES.context]
      .filter((item) => item.user_id === DEFAULT_USER_ID && item.person_id === person.id)
      .sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || String(b.updated_at).localeCompare(String(a.updated_at))));
    return contexts.length ? contexts : [syntheticContext(person)];
  }

  async function listInteractions(personId, input = {}) {
    await requirePerson(personId);
    const [local, old] = await Promise.all([
      store.read((state) => state.tables[TABLES.interaction]
        .filter((item) => item.user_id === DEFAULT_USER_ID && item.person_id === personId)),
      oldInteractions(personId),
    ]);
    const importedIds = new Set(local.map((item) => item.legacy_interaction_id).filter(Boolean).map(String));
    return [...local, ...old.filter((item) => !importedIds.has(String(item.legacy_interaction_id)))]
      .sort((a, b) => String(b.occurred_at).localeCompare(String(a.occurred_at)))
      .slice(0, normalizeLimit(input.limit));
  }

  async function listPeople(input = {}) {
    const people = await allPeople();
    const enriched = await Promise.all(people.map(async (person) => {
      const [contexts, interactions] = await Promise.all([
        contextsForPerson(person),
        listInteractions(person.id, { limit: 1 }),
      ]);
      return { ...person, contexts, last_interaction: interactions[0] || null };
    }));
    const search = String(input.search || '').trim().toLocaleLowerCase();
    const attentionStatus = String(input.attentionStatus || '').trim();
    return enriched
      .filter((person) => {
        if (search) {
          const haystack = [person.name, person.identity, person.field, ...asArray(person.tags)]
            .filter(Boolean).join(' ').toLocaleLowerCase();
          if (!haystack.includes(search)) return false;
        }
        if (attentionStatus && !person.contexts.some((item) => item.attention_status === attentionStatus)) return false;
        return true;
      })
      .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))
      .slice(0, normalizeLimit(input.limit, 100));
  }

  async function createPerson(input = {}) {
    const name = requireText(input.name, 'name', 300);
    const roles = asArray(input.relationshipRoles).map((item) => String(item).trim()).filter(Boolean);
    const validContextTypes = ['family', 'partner', 'friend', 'mentor', 'colleague', 'business', 'customer', 'other'];
    const requested = String(input.contextType || roles[0] || 'other');
    return store.mutate((state) => {
      const person = newRecord({
        name,
        identity: optionalText(input.identity, 1000),
        field: optionalText(input.field, 1000),
        tags: asArray(input.tags),
        category: optionalText(input.category, 200),
        avatar_real: optionalText(input.avatarReal, 5000),
        first_met_date: input.firstMetDate ? normalizeDate(input.firstMetDate) : null,
        first_met_scene: optionalText(input.firstMetScene, 2000),
        birthday: input.birthday ? normalizeDate(input.birthday) : null,
        hometown: optionalText(input.hometown, 500),
      });
      const context = newRecord({
        person_id: person.id,
        context_type: validContextTypes.includes(requested) ? requested : 'other',
        label: roles.length ? roles.join(' / ') : null,
        attention_status: input.attentionState === 'dormant' ? 'sleep' : (input.attentionState || 'observe'),
        why_matters_now: optionalText(input.focusReason),
        current_state: null,
        current_goal: null,
        mutual_value: null,
        boundaries: [],
        relationship_health: {},
        urgency: {},
        is_primary: true,
      });
      state.tables[TABLES.people].push(person);
      state.tables[TABLES.context].push(context);
      return { ...person, contexts: [context], last_interaction: null };
    });
  }

  async function listContexts(personId) {
    const person = await requirePerson(personId);
    return contextsForPerson(person);
  }

  async function createContext(personId, input = {}) {
    await requirePerson(personId);
    return store.mutate((state) => {
      const isPrimary = Boolean(input.isPrimary);
      if (isPrimary) {
        for (const item of state.tables[TABLES.context]) {
          if (item.user_id === DEFAULT_USER_ID && item.person_id === personId && item.is_primary) {
            item.is_primary = false;
            item.version = Number(item.version || 1) + 1;
            item.updated_at = new Date().toISOString();
          }
        }
      }
      const context = newRecord({
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
        is_primary: isPrimary,
      });
      state.tables[TABLES.context].push(context);
      return context;
    });
  }

  async function updateContext(contextId, input = {}) {
    if (String(contextId).startsWith('legacy-context-')) {
      const personId = String(contextId).slice('legacy-context-'.length);
      if (input.expectedVersion !== undefined && Number(input.expectedVersion) !== 1) {
        throw new RelationshipSystemError('VERSION_CONFLICT', 'Context changed since it was loaded.', 409, { currentVersion: 1 });
      }
      return createContext(personId, { ...input, isPrimary: 'isPrimary' in input ? input.isPrimary : true });
    }
    return store.mutate((state) => {
      const current = findOwned(state, TABLES.context, contextId, 'Context');
      const patch = {};
      if ('contextType' in input) patch.context_type = input.contextType;
      if ('label' in input) patch.label = optionalText(input.label, 200);
      if ('attentionStatus' in input) patch.attention_status = input.attentionStatus;
      if ('whyMattersNow' in input) patch.why_matters_now = optionalText(input.whyMattersNow);
      if ('currentState' in input) patch.current_state = optionalText(input.currentState);
      if ('currentGoal' in input) patch.current_goal = optionalText(input.currentGoal);
      if ('mutualValue' in input) patch.mutual_value = optionalText(input.mutualValue);
      if ('boundaries' in input) patch.boundaries = asArray(input.boundaries);
      if ('relationshipHealth' in input) patch.relationship_health = asObject(input.relationshipHealth);
      if ('urgency' in input || 'observeNext' in input) {
        patch.urgency = {
          ...asObject(current.urgency),
          ...('urgency' in input ? asObject(input.urgency) : {}),
          ...('observeNext' in input ? { observe_next: optionalText(input.observeNext, 5000) } : {}),
        };
      }
      if ('isPrimary' in input) patch.is_primary = Boolean(input.isPrimary);
      if (patch.is_primary && !current.is_primary) {
        for (const item of state.tables[TABLES.context]) {
          if (item.id !== current.id && item.user_id === DEFAULT_USER_ID && item.person_id === current.person_id && item.is_primary) {
            item.is_primary = false;
            item.version = Number(item.version || 1) + 1;
            item.updated_at = new Date().toISOString();
          }
        }
      }
      return updateVersioned(state, TABLES.context, contextId, patch, input.expectedVersion, 'Context');
    });
  }

  async function setPersonAttention(personId, input = {}) {
    await requirePerson(personId);
    const requested = input.attentionState === 'dormant' ? 'sleep' : String(input.attentionState || '').trim();
    if (!ATTENTION_STATUSES.has(requested)) {
      throw new RelationshipSystemError('VALIDATION_ERROR', 'attentionState is invalid.', 400, {
        field: 'attentionState',
        allowed: Array.from(ATTENTION_STATUSES),
      });
    }
    const contexts = await contextsForPerson(await requirePerson(personId));
    let context = input.contextId
      ? contexts.find((item) => item.id === input.contextId)
      : (contexts.find((item) => item.is_primary) || contexts[0] || null);
    if (input.contextId && !context) {
      throw new RelationshipSystemError('OWNERSHIP_MISMATCH', 'Context does not belong to this person.', 409);
    }
    const urgency = {
      ...asObject(context?.urgency),
      ...(Object.prototype.hasOwnProperty.call(input, 'observeNext')
        ? { observe_next: optionalText(input.observeNext, 5000) }
        : {}),
    };
    context = await updateContext(context?.id || `legacy-context-${personId}`, {
      attentionStatus: requested,
      ...('focusReason' in input ? { whyMattersNow: input.focusReason } : {}),
      urgency,
      isPrimary: true,
      expectedVersion: input.expectedVersion,
    });
    if (CURRENT_ATTENTION_STATUSES.has(requested)) {
      await store.mutate((state) => {
        const now = new Date().toISOString();
        for (const proposal of state.tables[TABLES.proposal]) {
          if (proposal.user_id !== DEFAULT_USER_ID
            || proposal.person_id !== personId
            || proposal.proposal_type !== ATTENTION_RECOMMENDATION_TYPE
            || proposal.status !== 'draft') continue;
          proposal.status = 'rejected';
          proposal.error = {
            code: 'SUPERSEDED_BY_MANUAL',
            message: 'User manually placed this person in current attention.',
          };
          proposal.confirmed_at = now;
          proposal.version = Number(proposal.version || 1) + 1;
          proposal.updated_at = now;
        }
      });
    }
    const people = await listPeople({ limit: MAX_PAGE_SIZE });
    return people.find((person) => person.id === personId) || {
      ...(await requirePerson(personId)), contexts: [context], last_interaction: null,
    };
  }

  async function listAttentionRecommendations(input = {}) {
    return store.read((state) => state.tables[TABLES.proposal]
      .filter((item) => item.user_id === DEFAULT_USER_ID
        && item.proposal_type === ATTENTION_RECOMMENDATION_TYPE
        && (!input.status || item.status === input.status))
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .slice(0, normalizeLimit(input.limit, 100)));
  }

  async function getLatestAttentionRecommendationRun() {
    return store.read((state) => state.tables[TABLES.proposal]
      .filter((item) => item.user_id === DEFAULT_USER_ID && item.proposal_type === ATTENTION_RECOMMENDATION_RUN_TYPE)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0] || null);
  }

  async function replaceAttentionRecommendations(input = {}) {
    const recommendations = asArray(input.recommendations);
    const seenPeople = new Set();
    for (const recommendation of recommendations) {
      const personId = requireText(recommendation.personId, 'recommendation.personId', 200);
      if (seenPeople.has(personId)) {
        throw new RelationshipSystemError('VALIDATION_ERROR', 'Only one recommendation per person is allowed.', 400);
      }
      seenPeople.add(personId);
      await requirePerson(personId);
    }
    return store.mutate((state) => {
      const now = new Date().toISOString();
      for (const proposal of state.tables[TABLES.proposal]) {
        if (proposal.user_id === DEFAULT_USER_ID
          && proposal.proposal_type === ATTENTION_RECOMMENDATION_TYPE
          && proposal.status === 'draft') {
          proposal.status = 'rejected';
          proposal.error = { code: 'SUPERSEDED', message: 'A newer attention recommendation run replaced this draft.' };
          proposal.version = Number(proposal.version || 1) + 1;
          proposal.updated_at = now;
        }
      }
      const common = {
        input_snapshot: asObject(input.inputSnapshot),
        error: null,
        model: optionalText(input.model, 500),
        prompt_version: optionalText(input.promptVersion, 500),
      };
      const run = newRecord({
        person_id: null,
        proposal_type: ATTENTION_RECOMMENDATION_RUN_TYPE,
        status: 'confirmed',
        ...common,
        payload: {
          status: input.runStatus || (recommendations.length ? 'ai' : 'empty'),
          recommendation_count: recommendations.length,
          warning: optionalText(input.warning, 5000),
        },
        evidence_refs: [],
        confirmed_entity_type: 'attention_recommendation_run',
        confirmed_entity_id: null,
        confirmed_at: now,
      });
      const created = recommendations.map((item) => newRecord({
        person_id: item.personId,
        proposal_type: ATTENTION_RECOMMENDATION_TYPE,
        status: 'draft',
        ...common,
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
        confirmed_entity_type: null,
        confirmed_entity_id: null,
        confirmed_at: null,
      }));
      state.tables[TABLES.proposal].push(run, ...created);
      return { run, recommendations: created };
    });
  }

  async function decideAttentionRecommendation(recommendationId, input = {}) {
    const decision = String(input.decision || '').trim();
    if (!['accept', 'dismiss'].includes(decision)) {
      throw new RelationshipSystemError('VALIDATION_ERROR', 'decision must be accept or dismiss.', 400, { field: 'decision' });
    }
    const recommendation = await store.read((state) => findOwned(
      state, TABLES.proposal, recommendationId, 'Attention recommendation'
    ));
    if (recommendation.proposal_type !== ATTENTION_RECOMMENDATION_TYPE || !recommendation.person_id) {
      throw new RelationshipSystemError('NOT_FOUND', 'Recommendation was not found.', 404);
    }
    await requirePerson(recommendation.person_id);
    return store.mutate((state) => {
      const proposal = findOwned(state, TABLES.proposal, recommendationId, 'Attention recommendation');
      const alreadyAccepted = proposal.status === 'confirmed';
      const alreadyDismissed = proposal.status === 'rejected' && proposal.error?.code === 'USER_DISMISSED';
      if ((decision === 'accept' && alreadyAccepted) || (decision === 'dismiss' && alreadyDismissed)) {
        const existingContext = proposal.confirmed_entity_id
          ? state.tables[TABLES.context].find((item) => item.id === proposal.confirmed_entity_id) || null
          : null;
        return { recommendation: proposal, context: existingContext, duplicate: true };
      }
      if (proposal.status !== 'draft') {
        throw new RelationshipSystemError('DECISION_CONFLICT', 'Recommendation was already decided differently.', 409);
      }
      if (input.expectedVersion !== undefined && Number(input.expectedVersion) !== Number(proposal.version)) {
        throw new RelationshipSystemError('VERSION_CONFLICT', 'Recommendation changed since it was loaded.', 409, {
          currentVersion: proposal.version,
        });
      }
      const reason = optionalText(input.reason, 5000) || optionalText(proposal.payload?.reason, 5000);
      const observeNext = optionalText(input.observeNext, 5000) || optionalText(proposal.payload?.observe_next, 5000);
      proposal.payload = { ...asObject(proposal.payload), reason, observe_next: observeNext };
      let context = null;
      if (decision === 'accept') {
        context = state.tables[TABLES.context]
          .filter((item) => item.user_id === DEFAULT_USER_ID && item.person_id === proposal.person_id)
          .sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || String(b.updated_at).localeCompare(String(a.updated_at)))[0]
          || null;
        if (context) {
          if (['repair', 'boundary'].includes(context.attention_status)) {
            throw new RelationshipSystemError(
              'CONTEXT_STATE_CONFLICT',
              '这段关系的策略已经变为修复或边界状态，请重新判断，不会用旧推荐覆盖。',
              409
            );
          }
          for (const other of state.tables[TABLES.context]) {
            if (other.id !== context.id && other.user_id === DEFAULT_USER_ID
              && other.person_id === proposal.person_id && other.is_primary) {
              other.is_primary = false;
              other.version = Number(other.version || 1) + 1;
              other.updated_at = new Date().toISOString();
            }
          }
          context.attention_status = 'focus';
          context.is_primary = true;
          if (reason) context.why_matters_now = reason;
          context.urgency = { ...asObject(context.urgency), ...(observeNext ? { observe_next: observeNext } : {}) };
          context.version = Number(context.version || 1) + 1;
          context.updated_at = new Date().toISOString();
        } else {
          context = newRecord({
            person_id: proposal.person_id,
            context_type: 'other',
            label: null,
            attention_status: 'focus',
            why_matters_now: reason,
            current_state: null,
            current_goal: null,
            mutual_value: null,
            boundaries: [],
            relationship_health: {},
            urgency: observeNext ? { observe_next: observeNext } : {},
            is_primary: true,
          });
          state.tables[TABLES.context].push(context);
        }
        proposal.status = 'confirmed';
        proposal.error = null;
        proposal.confirmed_entity_type = 'relationship_context';
        proposal.confirmed_entity_id = context.id;
        proposal.confirmed_at = new Date().toISOString();
      } else {
        proposal.status = 'rejected';
        proposal.error = { code: 'USER_DISMISSED', message: 'User chose not to focus on this person now.' };
        proposal.confirmed_at = new Date().toISOString();
      }
      proposal.version = Number(proposal.version || 1) + 1;
      proposal.updated_at = new Date().toISOString();
      return { recommendation: proposal, context, duplicate: false };
    });
  }

  async function getPeopleOverview() {
    const [people, recommendations, recommendationRun] = await Promise.all([
      listPeople({ limit: MAX_PAGE_SIZE }),
      listAttentionRecommendations({ status: 'draft', limit: MAX_PAGE_SIZE }),
      getLatestAttentionRecommendationRun(),
    ]);
    const personById = new Map(people.map((person) => [person.id, person]));
    const attentionPeople = [];
    const libraryPeople = [];
    for (const person of people) {
      const primary = person.contexts.find((context) => context.is_primary) || person.contexts[0] || null;
      (CURRENT_ATTENTION_STATUSES.has(primary?.attention_status) ? attentionPeople : libraryPeople).push(person);
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
      attention_people: attentionPeople,
      library_people: libraryPeople,
      recommendation_run: recommendationRun,
      counts: {
        tracked_people: people.length,
        current_attention: attentionPeople.length,
        relationship_library: libraryPeople.length,
        pending_recommendations: visibleRecommendations.length,
      },
    };
  }

  async function createInteractionProposal(personId, input = {}) {
    await requirePerson(personId);
    const content = requireText(input.content, 'content', 50000);
    const occurredAt = input.occurredAt ? normalizeDateTime(input.occurredAt) : null;
    const sourceType = ['text', 'voice', 'manual', 'import'].includes(input.sourceType) ? input.sourceType : 'text';
    const contextId = await resolveContext(personId, input.contextId);
    let payload;
    let warnings = [];
    let model = null;
    try {
      const extracted = await callInteractionExtractor(content, { occurredAt, sourceType });
      payload = normalizeInteractionDraft({
        ...asObject(extracted),
        occurred_at: occurredAt || extracted?.occurred_at,
        source_type: sourceType,
        raw_text: content,
      }, { summary: content, occurred_at: occurredAt, source_type: sourceType, raw_text: content });
      model = interactionExtractor ? 'injected-extractor' : getLlmModel();
    } catch (error) {
      const code = error instanceof RelationshipSystemError ? error.code : 'AI_PROPOSAL_FAILED';
      payload = fallbackInteractionDraft(content, occurredAt, sourceType, code);
      warnings = payload.warnings;
    }
    return store.mutate((state) => {
      const proposal = newRecord({
        person_id: personId,
        proposal_type: 'interaction_extract',
        status: 'draft',
        input_snapshot: { content, occurred_at: occurredAt, source_type: sourceType, context_id: contextId },
        payload,
        warnings,
        error: null,
        prompt_version: INTERACTION_PROMPT_VERSION,
        model,
        confirmed_entity_type: null,
        confirmed_entity_id: null,
        confirmed_at: null,
      });
      state.tables[TABLES.proposal].push(proposal);
      return proposal;
    });
  }

  async function confirmInteraction(personId, input = {}) {
    await requirePerson(personId);
    const proposalId = requireText(input.proposalId, 'proposalId', 200);
    const idempotencyKey = requireText(input.idempotencyKey, 'idempotencyKey', 200);
    const contextId = await resolveContext(personId, input.contextId);
    return store.mutate((state) => {
      const proposal = findOwned(state, TABLES.proposal, proposalId, 'AI proposal');
      if (proposal.person_id !== personId || proposal.proposal_type !== 'interaction_extract') {
        throw new RelationshipSystemError('OWNERSHIP_MISMATCH', 'Proposal does not match this person or operation.', 409);
      }
      if (['failed', 'rejected'].includes(proposal.status)) {
        throw new RelationshipSystemError('PROPOSAL_NOT_CONFIRMABLE', 'This proposal cannot be confirmed.', 409);
      }
      if (proposal.status === 'confirmed' && proposal.confirmed_entity_id) {
        const confirmed = findOwned(state, TABLES.interaction, proposal.confirmed_entity_id, 'Interaction');
        return { interaction: confirmed, duplicate: true };
      }
      const existing = state.tables[TABLES.interaction]
        .find((item) => item.user_id === DEFAULT_USER_ID && item.client_idempotency_key === idempotencyKey);
      if (existing) {
        if (existing.person_id !== personId || existing.source_proposal_id !== proposal.id) {
          throw new RelationshipSystemError('IDEMPOTENCY_KEY_REUSED', 'Idempotency key was used for another operation.', 409);
        }
        return { interaction: existing, duplicate: true };
      }
      const source = input.draft ? { ...asObject(proposal.payload), ...asObject(input.draft) } : proposal.payload;
      const draft = normalizeInteractionDraft(source, {
        summary: proposal.input_snapshot?.content,
        occurred_at: proposal.input_snapshot?.occurred_at,
        source_type: proposal.input_snapshot?.source_type,
        raw_text: proposal.input_snapshot?.content,
      });
      const interaction = newRecord({
        person_id: personId,
        context_id: contextId || proposal.input_snapshot?.context_id || null,
        ...draft,
        source_proposal_id: proposal.id,
        client_idempotency_key: idempotencyKey,
      });
      state.tables[TABLES.interaction].push(interaction);
      Object.assign(proposal, {
        status: 'confirmed',
        confirmed_entity_type: 'interaction',
        confirmed_entity_id: interaction.id,
        confirmed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        version: Number(proposal.version || 1) + 1,
      });
      return { interaction, duplicate: false };
    });
  }

  async function createManualInteraction(personId, input = {}) {
    await requirePerson(personId);
    const idempotencyKey = requireText(input.idempotencyKey, 'idempotencyKey', 200);
    const contextId = await resolveContext(personId, input.contextId);
    const source = asObject(input.draft || input);
    const draft = normalizeInteractionDraft({ ...source, source_type: 'manual' }, {
      summary: source.summary || asArray(source.observed_facts)[0] || '手动互动记录',
      occurred_at: source.occurred_at,
      source_type: 'manual',
      raw_text: source.raw_text,
    });
    return store.mutate((state) => {
      const existing = state.tables[TABLES.interaction]
        .find((item) => item.user_id === DEFAULT_USER_ID && item.client_idempotency_key === idempotencyKey);
      if (existing) {
        if (existing.person_id !== personId || existing.source_proposal_id) {
          throw new RelationshipSystemError('IDEMPOTENCY_KEY_REUSED', 'Idempotency key was used for another operation.', 409);
        }
        return { interaction: existing, duplicate: true };
      }
      const interaction = newRecord({
        person_id: personId,
        context_id: contextId,
        ...draft,
        source_proposal_id: null,
        client_idempotency_key: idempotencyKey,
      });
      state.tables[TABLES.interaction].push(interaction);
      return { interaction, duplicate: false };
    });
  }

  async function rejectProposal(proposalId, input = {}) {
    return store.mutate((state) => {
      const proposal = findOwned(state, TABLES.proposal, proposalId, 'AI proposal');
      if (proposal.status !== 'draft') {
        throw new RelationshipSystemError('PROPOSAL_NOT_REJECTABLE', 'Only draft proposals can be rejected.', 409);
      }
      return updateVersioned(state, TABLES.proposal, proposalId, {
        status: 'rejected',
        error: input.reason ? { reason: optionalText(input.reason, 2000) } : null,
      }, input.expectedVersion, 'AI proposal');
    });
  }

  async function createClaim(personId, input = {}) {
    await requirePerson(personId);
    const contextId = await resolveContext(personId, input.contextId);
    return store.mutate((state) => {
      const claim = newRecord({
        person_id: personId,
        context_id: contextId,
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
      });
      state.tables[TABLES.claim].push(claim);
      return claim;
    });
  }

  async function updateClaim(claimId, input = {}) {
    return store.mutate((state) => {
      const patch = {};
      if ('dimension' in input) patch.dimension = optionalText(input.dimension, 100) || 'other';
      if ('statement' in input) patch.statement = requireText(input.statement, 'statement', 10000);
      if ('situation' in input) patch.situation = optionalText(input.situation);
      if ('status' in input) patch.status = input.status;
      if ('confidenceLevel' in input) patch.confidence_level = input.confidenceLevel;
      if ('alternativeExplanations' in input) patch.alternative_explanations = asArray(input.alternativeExplanations);
      if ('counterevidenceNotes' in input) patch.counterevidence_notes = optionalText(input.counterevidenceNotes);
      if ('userConfirmed' in input) patch.user_confirmed = Boolean(input.userConfirmed);
      if ('lastVerifiedAt' in input) {
        patch.last_verified_at = input.lastVerifiedAt ? normalizeDateTime(input.lastVerifiedAt) : null;
      }
      return updateVersioned(state, TABLES.claim, claimId, patch, input.expectedVersion, 'Claim');
    });
  }

  async function addClaimEvidence(claimId, input = {}) {
    const claim = await store.read((state) => findOwned(state, TABLES.claim, claimId, 'Claim'));
    if (input.interactionId) {
      const interactions = await listInteractions(claim.person_id, { limit: MAX_PAGE_SIZE });
      if (!interactions.some((item) => item.id === input.interactionId)) {
        throw new RelationshipSystemError('NOT_FOUND', 'Interaction was not found.', 404);
      }
    }
    return store.mutate((state) => {
      findOwned(state, TABLES.claim, claimId, 'Claim');
      const evidence = newRecord({
        claim_id: claimId,
        interaction_id: input.interactionId || null,
        evidence_type: input.evidenceType || 'neutral',
        content: requireText(input.content, 'content', 10000),
        occurred_at: input.occurredAt ? normalizeDateTime(input.occurredAt) : null,
        source_label: optionalText(input.sourceLabel, 500),
      });
      state.tables[TABLES.evidence].push(evidence);
      return evidence;
    });
  }

  async function createDecision(personId, input = {}) {
    await requirePerson(personId);
    const contextId = await resolveContext(personId, input.contextId);
    return store.mutate((state) => {
      const status = input.status || 'draft';
      const decision = newRecord({
        person_id: personId,
        context_id: contextId,
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
      });
      state.tables[TABLES.decision].push(decision);
      return decision;
    });
  }

  async function updateDecision(decisionId, input = {}) {
    return store.mutate((state) => {
      const patch = {};
      const map = {
        decisionType: 'decision_type', relationshipMode: 'relationship_mode', whyNow: 'why_now', mutualValue: 'mutual_value',
        selectedOption: 'selected_option', feedbackSignals: 'feedback_signals', stopConditions: 'stop_conditions', dueAt: 'due_at',
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
      return updateVersioned(state, TABLES.decision, decisionId, patch, input.expectedVersion, 'Decision');
    });
  }

  async function saveDecisionOutcome(decisionId, input = {}) {
    return store.mutate((state) => {
      const decision = findOwned(state, TABLES.decision, decisionId, 'Decision');
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
      let outcome = state.tables[TABLES.outcome]
        .find((item) => item.user_id === DEFAULT_USER_ID && item.decision_id === decisionId);
      if (outcome) {
        outcome = updateVersioned(state, TABLES.outcome, outcome.id, payload, input.expectedVersion, 'Decision outcome');
      } else {
        outcome = newRecord({ decision_id: decisionId, ...payload });
        state.tables[TABLES.outcome].push(outcome);
      }
      if (input.completeDecision !== false && decision.status !== 'completed') {
        updateVersioned(state, TABLES.decision, decisionId, { status: 'completed' }, decision.version, 'Decision');
      }
      return { decision: { ...decision, outcome }, outcome };
    });
  }

  async function listOpportunities(input = {}) {
    return store.read((state) => state.tables[TABLES.opportunity]
      .filter((item) => item.user_id === DEFAULT_USER_ID)
      .filter((item) => !input.stage || item.stage === input.stage)
      .filter((item) => !input.status || item.status === input.status)
      .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
      .slice(0, normalizeLimit(input.limit, 100)));
  }

  async function getOpportunity(opportunityId) {
    return store.read((state) => {
      const opportunity = findOwned(state, TABLES.opportunity, opportunityId, 'Opportunity');
      const experiments = state.tables[TABLES.experiment]
        .filter((item) => item.user_id === DEFAULT_USER_ID && item.opportunity_id === opportunityId)
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      return { opportunity, experiments };
    });
  }

  async function createOpportunity(input = {}) {
    if (input.sourcePersonId) await requirePerson(input.sourcePersonId);
    return store.mutate((state) => {
      const opportunity = newRecord({
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
      });
      state.tables[TABLES.opportunity].push(opportunity);
      return opportunity;
    });
  }

  async function updateOpportunity(opportunityId, input = {}) {
    return store.mutate((state) => {
      const fieldMap = {
        title: 'title', problemStatement: 'problem_statement', targetCustomer: 'target_customer',
        beneficiary: 'beneficiary', decisionMaker: 'decision_maker', payer: 'payer', frequency: 'frequency',
        costOfProblem: 'cost_of_problem', urgency: 'urgency', currentWorkaround: 'current_workaround',
        accessChannel: 'access_channel', evidenceSummary: 'evidence_summary', paymentSignal: 'payment_signal',
        nextMissingEvidence: 'next_missing_evidence', stage: 'stage', status: 'status',
      };
      const patch = {};
      for (const [from, to] of Object.entries(fieldMap)) {
        if (!(from in input)) continue;
        patch[to] = from === 'title' || from === 'problemStatement'
          ? requireText(input[from], from, 10000)
          : optionalText(input[from]);
      }
      if ('relatedPersonIds' in input) patch.related_person_ids = asArray(input.relatedPersonIds);
      return updateVersioned(state, TABLES.opportunity, opportunityId, patch, input.expectedVersion, 'Opportunity');
    });
  }

  async function createExperiment(opportunityId, input = {}) {
    await getOpportunity(opportunityId);
    return store.mutate((state) => {
      const experiment = newRecord({
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
      });
      state.tables[TABLES.experiment].push(experiment);
      return experiment;
    });
  }

  async function updateExperiment(experimentId, input = {}) {
    return store.mutate((state) => {
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
      return updateVersioned(state, TABLES.experiment, experimentId, patch, input.expectedVersion, 'Experiment');
    });
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

  async function listWeeklyReviews(input = {}) {
    return store.read((state) => state.tables[TABLES.weeklyReview]
      .filter((item) => item.user_id === DEFAULT_USER_ID)
      .sort((a, b) => String(b.week_start).localeCompare(String(a.week_start)))
      .slice(0, normalizeLimit(input.limit, 20)));
  }

  async function getCurrentWeeklyReview() {
    const weekStart = currentWeekStart();
    return store.read((state) => state.tables[TABLES.weeklyReview]
      .find((item) => item.user_id === DEFAULT_USER_ID && item.week_start === weekStart) || null);
  }

  async function saveWeeklyReview(input = {}) {
    const payload = weeklyReviewPayload(input);
    return store.mutate((state) => {
      const existing = state.tables[TABLES.weeklyReview]
        .find((item) => item.user_id === DEFAULT_USER_ID && item.week_start === payload.week_start);
      if (existing) {
        return updateVersioned(state, TABLES.weeklyReview, existing.id, payload, input.expectedVersion, 'Weekly review');
      }
      const review = newRecord(payload);
      state.tables[TABLES.weeklyReview].push(review);
      return review;
    });
  }

  async function generateWeeklyReview() {
    const weekStart = currentWeekStart();
    const existing = await getCurrentWeeklyReview();
    if (existing) return existing;
    const startIso = `${weekStart}T00:00:00.000Z`;
    const people = await allPeople();
    const interactionGroups = await Promise.all(people.map((person) => listInteractions(person.id, { limit: MAX_PAGE_SIZE })));
    const interactions = interactionGroups.flat()
      .filter((item) => String(item.occurred_at) >= startIso)
      .sort((a, b) => String(b.occurred_at).localeCompare(String(a.occurred_at)));
    const snapshot = await store.read((state) => ({
      claims: state.tables[TABLES.claim]
        .filter((item) => item.user_id === DEFAULT_USER_ID && item.status === 'contradicted' && item.updated_at >= startIso),
      decisions: state.tables[TABLES.decision]
        .filter((item) => item.user_id === DEFAULT_USER_ID && ['chosen', 'executing'].includes(item.status))
        .sort((a, b) => String(a.due_at || '9999').localeCompare(String(b.due_at || '9999'))),
      opportunities: state.tables[TABLES.opportunity]
        .filter((item) => item.user_id === DEFAULT_USER_ID && item.status === 'active')
        .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
        .slice(0, 5),
    }));
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
        interaction_id: item.id,
        person_id: item.person_id,
        summary: item.summary,
        occurred_at: item.occurred_at,
      })),
      openCommitments,
      contradictedClaims: snapshot.claims,
      opportunitySignals,
      nextPeopleActions: snapshot.decisions.slice(0, 3).map((item) => ({
        decision_id: item.id,
        person_id: item.person_id,
        title: item.recommendation || item.goal,
        due_at: item.due_at,
      })),
      nextOpportunityExperiment: snapshot.opportunities[0] || null,
      userConfirmed: false,
    });
  }

  async function confirmWeeklyReview(reviewId, input = {}) {
    return store.mutate((state) => {
      const review = findOwned(state, TABLES.weeklyReview, reviewId, 'Weekly review');
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
        patch.next_opportunity_experiment = input.nextOpportunityExperiment
          ? asObject(input.nextOpportunityExperiment)
          : null;
      }
      patch.user_confirmed = true;
      const saved = updateVersioned(
        state,
        TABLES.weeklyReview,
        review.id,
        patch,
        input.expectedVersion,
        'Weekly review'
      );
      const selfPattern = optionalText(input.selfPattern);
      if (selfPattern) {
        const patternPayload = {
          category: 'people_skill',
          title: selfPattern.slice(0, 120),
          pattern_statement: selfPattern,
          evidence_refs: [{ weekly_review_id: review.id, week_start: review.week_start }],
          status: 'hypothesis',
          source_weekly_review_id: review.id,
        };
        const existingPattern = state.tables[TABLES.growth]
          .find((item) => item.user_id === DEFAULT_USER_ID && item.source_weekly_review_id === review.id);
        if (existingPattern) {
          updateVersioned(state, TABLES.growth, existingPattern.id, patternPayload, existingPattern.version, 'Growth pattern');
        } else {
          state.tables[TABLES.growth].push(newRecord({
            ...patternPayload,
            counterexamples: [],
            training_action: null,
            next_review_at: null,
          }));
        }
      }
      return saved;
    });
  }

  async function listGrowthPatterns(input = {}) {
    return store.read((state) => state.tables[TABLES.growth]
      .filter((item) => item.user_id === DEFAULT_USER_ID)
      .filter((item) => !input.status || item.status === input.status)
      .filter((item) => !input.category || item.category === input.category)
      .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
      .slice(0, normalizeLimit(input.limit, 100)));
  }

  async function createGrowthPattern(input = {}) {
    return store.mutate((state) => {
      const pattern = newRecord({
        category: input.category || 'people_skill',
        title: requireText(input.title, 'title', 500),
        pattern_statement: requireText(input.patternStatement, 'patternStatement', 10000),
        evidence_refs: asArray(input.evidenceRefs),
        counterexamples: asArray(input.counterexamples),
        status: input.status || 'hypothesis',
        training_action: optionalText(input.trainingAction),
        next_review_at: input.nextReviewAt ? normalizeDateTime(input.nextReviewAt) : null,
        source_weekly_review_id: input.sourceWeeklyReviewId || null,
      });
      state.tables[TABLES.growth].push(pattern);
      return pattern;
    });
  }

  async function updateGrowthPattern(patternId, input = {}) {
    return store.mutate((state) => {
      const patch = {};
      if ('category' in input) patch.category = input.category;
      if ('title' in input) patch.title = requireText(input.title, 'title', 500);
      if ('patternStatement' in input) patch.pattern_statement = requireText(input.patternStatement, 'patternStatement', 10000);
      if ('evidenceRefs' in input) patch.evidence_refs = asArray(input.evidenceRefs);
      if ('counterexamples' in input) patch.counterexamples = asArray(input.counterexamples);
      if ('status' in input) patch.status = input.status;
      if ('trainingAction' in input) patch.training_action = optionalText(input.trainingAction);
      if ('nextReviewAt' in input) patch.next_review_at = input.nextReviewAt ? normalizeDateTime(input.nextReviewAt) : null;
      return updateVersioned(state, TABLES.growth, patternId, patch, input.expectedVersion, 'Growth pattern');
    });
  }

  async function getPersonWorkspace(personId) {
    const person = await requirePerson(personId);
    const [contexts, interactions, snapshot] = await Promise.all([
      listContexts(personId),
      listInteractions(personId, { limit: 50 }),
      store.read((state) => ({
        claims: state.tables[TABLES.claim]
          .filter((item) => item.user_id === DEFAULT_USER_ID && item.person_id === personId)
          .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))),
        evidence: state.tables[TABLES.evidence]
          .filter((item) => item.user_id === DEFAULT_USER_ID)
          .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))),
        decisions: state.tables[TABLES.decision]
          .filter((item) => item.user_id === DEFAULT_USER_ID && item.person_id === personId)
          .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
          .slice(0, 50),
        outcomes: state.tables[TABLES.outcome].filter((item) => item.user_id === DEFAULT_USER_ID),
      })),
    ]);
    return {
      person,
      contexts,
      interactions,
      claims: snapshot.claims.map((claim) => ({
        ...claim,
        evidence: snapshot.evidence.filter((item) => item.claim_id === claim.id),
      })),
      decisions: snapshot.decisions.map((decision) => ({
        ...decision,
        outcome: snapshot.outcomes.find((item) => item.decision_id === decision.id) || null,
      })),
    };
  }

  async function getToday() {
    const now = new Date();
    const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const momentumSince = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const [compass, people, currentReview, snapshot] = await Promise.all([
      getCompass(),
      listPeople({ limit: 100 }),
      getCurrentWeeklyReview(),
      store.read((state) => ({
        decisions: state.tables[TABLES.decision]
          .filter((item) => item.user_id === DEFAULT_USER_ID && ['chosen', 'executing'].includes(item.status))
          .filter((item) => !item.due_at || item.due_at <= nextWeek)
          .sort((a, b) => String(a.due_at || '9999').localeCompare(String(b.due_at || '9999'))),
        opportunities: state.tables[TABLES.opportunity]
          .filter((item) => item.user_id === DEFAULT_USER_ID && item.status === 'active')
          .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
          .slice(0, 5),
      })),
    ]);
    const interactionGroups = await Promise.all(people.map((person) => listInteractions(person.id, { limit: 100 })));
    const recentInteractions = interactionGroups.flat()
      .filter((item) => item.occurred_at >= momentumSince)
      .sort((a, b) => String(b.occurred_at).localeCompare(String(a.occurred_at)));
    const attentionPeople = people
      .filter((person) => person.contexts.some((context) => ['focus', 'repair', 'boundary'].includes(context.attention_status)))
      .slice(0, 5);
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
    const weeklyReviewDue = !currentReview
      || currentReview.week_start !== currentWeekStart(now)
      || currentReview.user_confirmed !== true;
    return {
      generated_at: now.toISOString(),
      compass,
      attention_people: attentionPeople,
      due_decisions: snapshot.decisions,
      due_commitments: dueCommitments,
      momentum_people: momentumPeople,
      active_opportunities: snapshot.opportunities,
      active_opportunity: snapshot.opportunities[0] || null,
      latest_weekly_review: currentReview,
      weekly_review_due: weeklyReviewDue,
      counts: {
        tracked_people: people.length,
        attention_people: attentionPeople.length,
        due_decisions: snapshot.decisions.length,
        active_opportunities: snapshot.opportunities.length,
      },
    };
  }

  return {
    localFile: store.filePath,
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
  };
}

const relationshipSystemLocalService = createRelationshipSystemLocalService();

module.exports = relationshipSystemLocalService;
module.exports.createRelationshipSystemLocalService = createRelationshipSystemLocalService;
module.exports.RelationshipSystemError = RelationshipSystemError;
module.exports.__test = {
  DEFAULT_FILE_PATH,
  TABLES,
  LocalJsonStore,
  normalizeState,
  normalizeInteractionDraft,
  currentWeekStart,
  ATTENTION_RECOMMENDATION_TYPE,
  ATTENTION_RECOMMENDATION_RUN_TYPE,
};
