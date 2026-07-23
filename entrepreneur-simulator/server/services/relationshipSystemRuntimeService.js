const remoteRelationshipSystemService = require('./relationshipSystemService');

const STORAGE_MODES = Object.freeze({
  AUTO: 'auto',
  LOCAL: 'local',
  SUPABASE: 'supabase',
});

const AUTO_FALLBACK_ERROR_CODES = new Set([
  'MIGRATION_REQUIRED',
  'DATABASE_UNAVAILABLE',
]);

// Keep this list explicit: these are the application-facing operations shared by
// the Supabase and local implementations. Selection is performed once, before
// any one of these operations is delegated.
const PUBLIC_METHODS = Object.freeze([
  'getCompass',
  'saveCompass',
  'getToday',
  'listPeople',
  'createPerson',
  'getPersonWorkspace',
  'listContexts',
  'createContext',
  'updateContext',
  'setPersonAttention',
  'listAttentionRecommendations',
  'getLatestAttentionRecommendationRun',
  'replaceAttentionRecommendations',
  'decideAttentionRecommendation',
  'getPeopleOverview',
  'listInteractions',
  'createInteractionProposal',
  'confirmInteraction',
  'createManualInteraction',
  'rejectProposal',
  'createClaim',
  'updateClaim',
  'addClaimEvidence',
  'createDecision',
  'updateDecision',
  'saveDecisionOutcome',
  'listOpportunities',
  'getOpportunity',
  'createOpportunity',
  'updateOpportunity',
  'createExperiment',
  'updateExperiment',
  'listWeeklyReviews',
  'getCurrentWeeklyReview',
  'generateWeeklyReview',
  'confirmWeeklyReview',
  'saveWeeklyReview',
  'listGrowthPatterns',
  'createGrowthPattern',
  'updateGrowthPattern',
]);

function normalizeStorageMode(value) {
  const mode = String(value || STORAGE_MODES.AUTO).trim().toLowerCase();
  if (!Object.values(STORAGE_MODES).includes(mode)) {
    const error = new Error(
      `Invalid RELATIONSHIP_STORAGE_MODE "${value}". Expected auto, local, or supabase.`
    );
    error.code = 'INVALID_STORAGE_MODE';
    throw error;
  }
  return mode;
}

function createUnavailableMethodError(methodName, storageMode) {
  const error = new Error(
    `Relationship ${storageMode} storage does not implement ${methodName}().`
  );
  error.code = 'SERVICE_METHOD_UNAVAILABLE';
  return error;
}

function createRelationshipSystemRuntimeService(options = {}) {
  const env = options.env || process.env;
  const configuredMode = normalizeStorageMode(
    options.mode === undefined ? env.RELATIONSHIP_STORAGE_MODE : options.mode
  );
  const remoteService = options.remoteService || remoteRelationshipSystemService;
  let localService = options.localService || null;
  let selectionPromise = null;

  function getLocalService() {
    if (localService) return localService;
    localService = options.loadLocalService
      ? options.loadLocalService()
      : require('./relationshipSystemLocalService');
    return localService;
  }

  async function selectAutoBackend() {
    try {
      const probeResult = await remoteService.healthcheck();
      return {
        storageMode: STORAGE_MODES.SUPABASE,
        service: remoteService,
        probeResult,
      };
    } catch (error) {
      if (!AUTO_FALLBACK_ERROR_CODES.has(error?.code)) throw error;
      return {
        storageMode: STORAGE_MODES.LOCAL,
        service: getLocalService(),
        fallbackReason: error.code,
      };
    }
  }

  function selectBackend() {
    if (!selectionPromise) {
      if (configuredMode === STORAGE_MODES.LOCAL) {
        selectionPromise = Promise.resolve({
          storageMode: STORAGE_MODES.LOCAL,
          service: getLocalService(),
        });
      } else if (configuredMode === STORAGE_MODES.SUPABASE) {
        selectionPromise = Promise.resolve({
          storageMode: STORAGE_MODES.SUPABASE,
          service: remoteService,
        });
      } else {
        // Cache the promise itself so concurrent first requests cannot perform
        // multiple probes or select different stores.
        selectionPromise = selectAutoBackend();
      }
    }
    return selectionPromise;
  }

  async function invoke(methodName, args) {
    const selected = await selectBackend();
    const method = selected.service?.[methodName];
    if (typeof method !== 'function') {
      throw createUnavailableMethodError(methodName, selected.storageMode);
    }
    // There is deliberately no catch-and-fallback here. Once selected, a
    // backend remains selected for the lifetime of this service instance. This
    // prevents a transient write failure from splitting records across stores.
    return method.apply(selected.service, args);
  }

  async function healthcheck() {
    const selected = await selectBackend();
    let details = selected.probeResult;
    if (details === undefined) {
      const method = selected.service?.healthcheck;
      details = typeof method === 'function'
        ? await method.call(selected.service)
        : { ready: true };
    }

    const result = details && typeof details === 'object' && !Array.isArray(details)
      ? { ...details }
      : { ready: Boolean(details) };
    result.storageMode = selected.storageMode;

    if (selected.storageMode === STORAGE_MODES.LOCAL) {
      const localFile = result.localFile
        || selected.service?.localFile
        || selected.service?.storageFile
        || options.localFile;
      if (localFile) result.localFile = localFile;
      if (selected.fallbackReason) result.fallbackReason = selected.fallbackReason;
    }
    return result;
  }

  const runtimeService = { healthcheck };
  for (const methodName of PUBLIC_METHODS) {
    runtimeService[methodName] = (...args) => invoke(methodName, args);
  }
  return runtimeService;
}

const relationshipSystemRuntimeService = createRelationshipSystemRuntimeService();

module.exports = relationshipSystemRuntimeService;
module.exports.createRelationshipSystemRuntimeService = createRelationshipSystemRuntimeService;
module.exports.PUBLIC_METHODS = PUBLIC_METHODS;
module.exports.STORAGE_MODES = STORAGE_MODES;
