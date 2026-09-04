import type {
  ArrowHead,
  Boundary,
  BoundaryId,
  MindMapDocumentV1,
  MindMapSheet,
  Relationship,
  RelationshipId,
  RelationshipTargetRef,
  RichText,
  SheetId,
  Summary,
  SummaryId,
  ThemeId,
  Topic,
  TopicId,
  TopicScope,
  TreeEdge,
  TreeEdgeId,
} from './types';
import {
  createLegacyV0DefaultSet,
  LEGACY_V0_DEFAULTS_VERSION,
} from './defaults';
import { expandSemanticTopicScope } from './semanticScope';

export { LEGACY_V0_DEFAULTS_VERSION } from './defaults';

/**
 * The renderer-owned format written by MindMapExtension before canonical V1.
 * Extra properties are accepted deliberately: the migrator reports and
 * preserves content it does not understand instead of silently deleting it.
 */
export interface LegacyMindMapNode {
  id?: unknown;
  type?: unknown;
  position?: unknown;
  data?: unknown;
  width?: unknown;
  height?: unknown;
  selected?: unknown;
  [key: string]: unknown;
}

export interface LegacyMindMapEdge {
  id?: unknown;
  source?: unknown;
  target?: unknown;
  type?: unknown;
  style?: unknown;
  data?: unknown;
  markerStart?: unknown;
  markerEnd?: unknown;
  [key: string]: unknown;
}

export interface LegacyMindMapGraph {
  nodes: unknown[];
  edges: unknown[];
  createdAt?: unknown;
  [key: string]: unknown;
}

export type LegacyDiagnosticSeverity = 'info' | 'warning' | 'error';

export interface LegacyMigrationDiagnostic {
  code: string;
  severity: LegacyDiagnosticSeverity;
  path: string;
  message: string;
  legacyId?: string;
  original?: unknown;
}

export interface LegacyQuarantinedValue {
  kind: 'payload' | 'node' | 'edge';
  path: string;
  reason: string;
  original: unknown;
}

export interface LegacyMigrationStats {
  sourceNodes: number;
  sourceEdges: number;
  topics: number;
  treeEdges: number;
  relationships: number;
  boundaries: number;
  summaries: number;
  quarantinedNodes: number;
  quarantinedEdges: number;
}

export interface LegacyMigrationReport {
  status: 'success' | 'degraded' | 'failed';
  sourceFormat: 'legacy-v0';
  defaultsVersion: typeof LEGACY_V0_DEFAULTS_VERSION;
  sourceHash: string;
  idMap: Record<string, string>;
  legacyIdMap: Record<string, string[]>;
  diagnostics: LegacyMigrationDiagnostic[];
  quarantined: LegacyQuarantinedValue[];
  stats: LegacyMigrationStats;
}

export interface LegacyMigrationResult {
  document: MindMapDocumentV1 | null;
  report: LegacyMigrationReport;
  /** Exact JSON-safe copy kept outside canonical content for rollback. */
  legacyBackup: Readonly<unknown>;
}

export interface LegacyPayloadLimits {
  maxPayloadBytes: number;
  maxNodes: number;
  maxEdges: number;
  maxDepth: number;
  maxKeys: number;
}

export interface LegacyMigrationOptions {
  documentTitle?: string;
  sheetTitle?: string;
  limits?: Partial<LegacyPayloadLimits>;
}

export type MindMapPayloadDetection =
  | {
      kind: 'legacy-v0';
      value: LegacyMindMapGraph;
      decodedFrom: 'object' | 'json' | 'uri' | 'html-entity';
      diagnostics: LegacyMigrationDiagnostic[];
    }
  | {
      kind: 'canonical-v1';
      value: MindMapDocumentV1;
      decodedFrom: 'object' | 'json' | 'uri' | 'html-entity';
      diagnostics: LegacyMigrationDiagnostic[];
    }
  | {
      kind: 'unknown';
      value: unknown;
      decodedFrom?: 'object' | 'json' | 'uri' | 'html-entity';
      diagnostics: LegacyMigrationDiagnostic[];
    };

export const LEGACY_V0_FIXED_EPOCH = '2026-07-18T00:00:00.000Z' as const;

export const DEFAULT_LEGACY_PAYLOAD_LIMITS: Readonly<LegacyPayloadLimits> =
  Object.freeze({
    maxPayloadBytes: 5_000_000,
    maxNodes: 50_000,
    maxEdges: 100_000,
    maxDepth: 64,
    maxKeys: 500_000,
  });

const LEGACY_ID_EXTENSION = 'app.nmdd.legacy-id';
const LEGACY_VALUE_EXTENSION = 'app.nmdd.legacy-v0';
const MIGRATION_EXTENSION = 'app.nmdd.migration';
const PREVIEW_EDGE_ID = '__mindmap_preview_edge__';
const DEFAULT_NODE_WIDTH = 150;
const DEFAULT_NODE_HEIGHT = 50;
const MAX_COORDINATE = 1_000_000;

type JsonRecord = Record<string, unknown>;

interface NormalizedLegacyNode {
  index: number;
  path: string;
  legacyId: string;
  type: 'mindMap' | 'boundary' | 'summary';
  position: { x: number; y: number };
  data: JsonRecord;
  raw: JsonRecord;
  duplicateLegacyId: boolean;
  canonicalId: string;
}

interface NormalizedLegacyEdge {
  index: number;
  path: string;
  legacyId: string;
  source: string;
  target: string;
  data: JsonRecord;
  raw: JsonRecord;
}

interface MutableMigrationState {
  sourceHash: string;
  timestamp: number;
  diagnostics: LegacyMigrationDiagnostic[];
  quarantined: LegacyQuarantinedValue[];
  idMap: Record<string, string>;
  legacyIdMap: Record<string, string[]>;
  stats: LegacyMigrationStats;
}

interface PendingTreeEdge {
  edge: NormalizedLegacyEdge;
  parent: NormalizedLegacyNode;
  child: NormalizedLegacyNode;
  id: TreeEdgeId;
}

interface PendingRelationshipEdge {
  edge: NormalizedLegacyEdge;
  reason?: string;
}

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasOwn = (value: JsonRecord, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

const diagnostic = (
  code: string,
  severity: LegacyDiagnosticSeverity,
  path: string,
  message: string,
  extra: Pick<LegacyMigrationDiagnostic, 'legacyId' | 'original'> = {},
): LegacyMigrationDiagnostic => ({ code, severity, path, message, ...extra });

const decodeHtmlEntities = (value: string): string => {
  let decoded = value;
  for (let pass = 0; pass < 2; pass += 1) {
    const next = decoded
      .replace(/&quot;|&#34;|&#x22;/gi, '"')
      .replace(/&apos;|&#39;|&#x27;/gi, "'")
      .replace(/&lt;|&#60;|&#x3c;/gi, '<')
      .replace(/&gt;|&#62;|&#x3e;/gi, '>')
      .replace(/&amp;|&#38;|&#x26;/gi, '&');
    if (next === decoded) break;
    decoded = next;
  }
  return decoded;
};

const utf8Length = (value: string): number => new TextEncoder().encode(value).length;

const inspectValueBudget = (
  value: unknown,
  limits: LegacyPayloadLimits,
): { ok: true } | { ok: false; code: string; message: string } => {
  let keys = 0;
  const ancestors = new Set<object>();

  const visit = (current: unknown, depth: number): string | null => {
    if (depth > limits.maxDepth) return `Payload exceeds depth ${limits.maxDepth}`;
    if (typeof current !== 'object' || current === null) return null;
    if (ancestors.has(current)) return 'Payload contains a circular reference';

    ancestors.add(current);
    if (Array.isArray(current)) {
      for (const item of current) {
        const issue = visit(item, depth + 1);
        if (issue) return issue;
      }
    } else {
      for (const key of Object.keys(current)) {
        keys += 1;
        if (keys > limits.maxKeys) return `Payload exceeds ${limits.maxKeys} keys`;
        const issue = visit((current as JsonRecord)[key], depth + 1);
        if (issue) return issue;
      }
    }
    ancestors.delete(current);
    return null;
  };

  const issue = visit(value, 0);
  return issue
    ? { ok: false, code: issue.includes('circular') ? 'circular-payload' : 'payload-budget', message: issue }
    : { ok: true };
};

const stableStringify = (value: unknown): string => {
  const ancestors = new Set<object>();
  const serialize = (current: unknown): string => {
    if (current === null) return 'null';
    if (typeof current === 'string') return JSON.stringify(current);
    if (typeof current === 'boolean') return current ? 'true' : 'false';
    if (typeof current === 'number') {
      if (Number.isFinite(current)) return Object.is(current, -0) ? '0' : String(current);
      return JSON.stringify({ $legacyType: 'non-finite-number', value: String(current) });
    }
    if (typeof current === 'bigint') {
      return JSON.stringify({ $legacyType: 'bigint', value: String(current) });
    }
    if (typeof current === 'undefined') return JSON.stringify({ $legacyType: 'undefined' });
    if (typeof current === 'function' || typeof current === 'symbol') {
      return JSON.stringify({ $legacyType: typeof current, value: String(current) });
    }
    if (typeof current !== 'object') return JSON.stringify(String(current));
    if (ancestors.has(current)) throw new TypeError('Circular legacy payload');

    ancestors.add(current);
    let result: string;
    if (Array.isArray(current)) {
      result = `[${current.map((item) => serialize(item)).join(',')}]`;
    } else {
      const record = current as JsonRecord;
      const fields = Object.keys(record)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${serialize(record[key])}`);
      result = `{${fields.join(',')}}`;
    }
    ancestors.delete(current);
    return result;
  };
  return serialize(value);
};

const jsonSafeCopy = (value: unknown): unknown => JSON.parse(stableStringify(value)) as unknown;

const deepFreeze = <T>(value: T): Readonly<T> => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
    return value as Readonly<T>;
  }
  Object.freeze(value);
  for (const child of Object.values(value as JsonRecord)) deepFreeze(child);
  return value as Readonly<T>;
};

const rotateRight = (value: number, bits: number): number =>
  (value >>> bits) | (value << (32 - bits));

/** Browser-safe, synchronous SHA-256 used only for deterministic migration IDs. */
const sha256 = (input: string): string => {
  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
    0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
    0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
    0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
    0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
    0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const initial = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const bytes = Array.from(new TextEncoder().encode(input));
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const high = Math.floor(bitLength / 0x1_0000_0000);
  const low = bitLength >>> 0;
  for (let shift = 24; shift >= 0; shift -= 8) bytes.push((high >>> shift) & 0xff);
  for (let shift = 24; shift >= 0; shift -= 8) bytes.push((low >>> shift) & 0xff);

  const hash = initial.slice();
  const words = new Array<number>(64).fill(0);
  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const start = offset + index * 4;
      words[index] = (
        (bytes[start] << 24)
        | (bytes[start + 1] << 16)
        | (bytes[start + 2] << 8)
        | bytes[start + 3]
      ) >>> 0;
    }
    for (let index = 16; index < 64; index += 1) {
      const x = words[index - 15];
      const y = words[index - 2];
      const s0 = rotateRight(x, 7) ^ rotateRight(x, 18) ^ (x >>> 3);
      const s1 = rotateRight(y, 17) ^ rotateRight(y, 19) ^ (y >>> 10);
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const sigma1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + sigma1 + choice + constants[index] + words[index]) >>> 0;
      const sigma0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sigma0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    hash[0] = (hash[0] + a) >>> 0;
    hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0;
    hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0;
    hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0;
    hash[7] = (hash[7] + h) >>> 0;
  }
  return hash.map((word) => word.toString(16).padStart(8, '0')).join('');
};

const deterministicUuidV7 = (
  sourceHash: string,
  entityPath: string,
  timestamp: number,
): string => {
  const entropy = sha256(
    `${sourceHash}:${entityPath}:${LEGACY_V0_DEFAULTS_VERSION}`,
  );
  const bytes = new Array<number>(16).fill(0);
  let remaining = Math.max(0, Math.min(timestamp, 0xffff_ffff_ffff));
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = remaining % 256;
    remaining = Math.floor(remaining / 256);
  }
  for (let index = 6; index < 16; index += 1) {
    bytes[index] = Number.parseInt(entropy.slice((index - 6) * 2, (index - 5) * 2), 16);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const isCanonicalV1 = (value: unknown): value is MindMapDocumentV1 =>
  isRecord(value)
  && value.schema === 'app.nmdd.mindmap'
  && value.schemaVersion === 1;

const isLegacyEnvelope = (value: unknown): value is LegacyMindMapGraph =>
  isRecord(value)
  && Array.isArray(value.nodes)
  && Array.isArray(value.edges)
  && !hasOwn(value, 'schemaVersion');

const parseNestedJson = (candidate: string): unknown => {
  let parsed: unknown = JSON.parse(candidate) as unknown;
  for (let depth = 0; depth < 2 && typeof parsed === 'string'; depth += 1) {
    parsed = JSON.parse(parsed) as unknown;
  }
  return parsed;
};

/** Detects the Tiptap object/string/URI/HTML-entity variants without mutating input. */
export const detectMindMapPayload = (
  input: unknown,
  partialLimits: Partial<LegacyPayloadLimits> = {},
): MindMapPayloadDetection => {
  const limits = { ...DEFAULT_LEGACY_PAYLOAD_LIMITS, ...partialLimits };
  const diagnostics: LegacyMigrationDiagnostic[] = [];
  const candidates: Array<{
    value: unknown;
    decodedFrom: 'object' | 'json' | 'uri' | 'html-entity';
  }> = [];

  if (typeof input === 'string') {
    if (utf8Length(input) > limits.maxPayloadBytes) {
      return {
        kind: 'unknown',
        value: input,
        diagnostics: [diagnostic(
          'payload-too-large',
          'error',
          '$',
          `Payload exceeds ${limits.maxPayloadBytes} UTF-8 bytes`,
        )],
      };
    }
    const encodedCandidates: Array<{
      text: string;
      decodedFrom: 'json' | 'uri' | 'html-entity';
    }> = [{ text: input, decodedFrom: 'json' }];
    try {
      const uriDecoded = decodeURIComponent(input);
      if (uriDecoded !== input) encodedCandidates.push({ text: uriDecoded, decodedFrom: 'uri' });
    } catch {
      diagnostics.push(diagnostic(
        'invalid-uri-encoding',
        'info',
        '$',
        'Input was not valid URI encoding; raw and HTML forms were still attempted',
      ));
    }
    const htmlDecoded = decodeHtmlEntities(input);
    if (htmlDecoded !== input) {
      encodedCandidates.push({ text: htmlDecoded, decodedFrom: 'html-entity' });
    }
    const seen = new Set<string>();
    for (const candidate of encodedCandidates) {
      if (seen.has(candidate.text)) continue;
      seen.add(candidate.text);
      try {
        candidates.push({
          value: parseNestedJson(candidate.text),
          decodedFrom: candidate.decodedFrom,
        });
      } catch {
        // Other supported encodings are attempted before reporting unknown.
      }
    }
  } else {
    candidates.push({ value: input, decodedFrom: 'object' });
  }

  for (const candidate of candidates) {
    const budget = inspectValueBudget(candidate.value, limits);
    if (!budget.ok) {
      diagnostics.push(diagnostic(budget.code, 'error', '$', budget.message));
      continue;
    }
    if (isCanonicalV1(candidate.value)) {
      return {
        kind: 'canonical-v1',
        value: candidate.value,
        decodedFrom: candidate.decodedFrom,
        diagnostics,
      };
    }
    if (isLegacyEnvelope(candidate.value)) {
      if (candidate.value.nodes.length > limits.maxNodes) {
        diagnostics.push(diagnostic(
          'node-limit-exceeded',
          'error',
          '$.nodes',
          `Legacy payload has more than ${limits.maxNodes} nodes`,
        ));
        continue;
      }
      if (candidate.value.edges.length > limits.maxEdges) {
        diagnostics.push(diagnostic(
          'edge-limit-exceeded',
          'error',
          '$.edges',
          `Legacy payload has more than ${limits.maxEdges} edges`,
        ));
        continue;
      }
      return {
        kind: 'legacy-v0',
        value: candidate.value,
        decodedFrom: candidate.decodedFrom,
        diagnostics,
      };
    }
  }

  return {
    kind: 'unknown',
    value: candidates[0]?.value ?? input,
    decodedFrom: candidates[0]?.decodedFrom,
    diagnostics: diagnostics.length > 0
      ? diagnostics
      : [diagnostic(
          'unknown-payload-shape',
          'error',
          '$',
          'Expected canonical V1 or a legacy object with nodes[] and edges[]',
        )],
  };
};

const makeEmptyStats = (graph?: LegacyMindMapGraph): LegacyMigrationStats => ({
  sourceNodes: graph?.nodes.length ?? 0,
  sourceEdges: graph?.edges.length ?? 0,
  topics: 0,
  treeEdges: 0,
  relationships: 0,
  boundaries: 0,
  summaries: 0,
  quarantinedNodes: 0,
  quarantinedEdges: 0,
});

const makeReport = (
  sourceHash: string,
  graph?: LegacyMindMapGraph,
): LegacyMigrationReport => ({
  status: 'failed',
  sourceFormat: 'legacy-v0',
  defaultsVersion: LEGACY_V0_DEFAULTS_VERSION,
  sourceHash,
  idMap: {},
  legacyIdMap: {},
  diagnostics: [],
  quarantined: [],
  stats: makeEmptyStats(graph),
});

const addQuarantine = (
  state: MutableMigrationState,
  kind: LegacyQuarantinedValue['kind'],
  path: string,
  reason: string,
  original: unknown,
): void => {
  state.quarantined.push({ kind, path, reason, original: jsonSafeCopy(original) });
  if (kind === 'node') state.stats.quarantinedNodes += 1;
  if (kind === 'edge') state.stats.quarantinedEdges += 1;
};

const recordId = (
  state: MutableMigrationState,
  path: string,
  legacyId: string,
  canonicalId: string,
): void => {
  state.idMap[path] = canonicalId;
  (state.legacyIdMap[legacyId] ??= []).push(canonicalId);
};

const readFiniteCoordinate = (
  value: unknown,
  path: string,
  state: MutableMigrationState,
): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    state.diagnostics.push(diagnostic(
      'invalid-coordinate',
      'warning',
      path,
      'Invalid coordinate replaced with 0; original value remains in the rollback backup',
      { original: jsonSafeCopy(value) },
    ));
    return 0;
  }
  if (value < -MAX_COORDINATE || value > MAX_COORDINATE) {
    const clamped = Math.max(-MAX_COORDINATE, Math.min(MAX_COORDINATE, value));
    state.diagnostics.push(diagnostic(
      'coordinate-clamped',
      'warning',
      path,
      `Coordinate was clamped to ${clamped}`,
      { original: value },
    ));
    return clamped;
  }
  return value;
};

const normalizePosition = (
  value: unknown,
  path: string,
  state: MutableMigrationState,
): { x: number; y: number } => {
  if (!isRecord(value)) {
    state.diagnostics.push(diagnostic(
      'missing-position',
      'warning',
      path,
      'Missing/invalid position replaced with {x:0,y:0}',
      { original: jsonSafeCopy(value) },
    ));
    return { x: 0, y: 0 };
  }
  return {
    x: readFiniteCoordinate(value.x, `${path}.x`, state),
    y: readFiniteCoordinate(value.y, `${path}.y`, state),
  };
};

const normalizeData = (
  value: unknown,
  path: string,
  state: MutableMigrationState,
): JsonRecord => {
  if (value === undefined) return {};
  if (isRecord(value)) return value;
  state.diagnostics.push(diagnostic(
    'invalid-node-data',
    'warning',
    path,
    'Non-object data was not interpreted and remains in the rollback backup',
    { original: jsonSafeCopy(value) },
  ));
  return {};
};

const normalizeLegacyNodes = (
  graph: LegacyMindMapGraph,
  state: MutableMigrationState,
): NormalizedLegacyNode[] => {
  const normalized: NormalizedLegacyNode[] = [];
  const legacyIds = new Map<string, number>();

  graph.nodes.forEach((candidate, index) => {
    const path = `$.nodes[${index}]`;
    if (!isRecord(candidate)) {
      state.diagnostics.push(diagnostic(
        'invalid-node',
        'warning',
        path,
        'Non-object node was quarantined',
        { original: jsonSafeCopy(candidate) },
      ));
      addQuarantine(state, 'node', path, 'invalid-node', candidate);
      return;
    }

    let legacyId: string;
    if (typeof candidate.id === 'string' && candidate.id.trim()) {
      legacyId = candidate.id;
    } else {
      legacyId = `__legacy_node_${index}`;
      state.diagnostics.push(diagnostic(
        'missing-node-id',
        'warning',
        `${path}.id`,
        `Assigned deterministic surrogate ID ${legacyId}`,
        { original: jsonSafeCopy(candidate.id) },
      ));
    }

    let type: NormalizedLegacyNode['type'] | null = null;
    if (candidate.type === 'mindMap' || candidate.type === 'boundary' || candidate.type === 'summary') {
      type = candidate.type;
    } else if (candidate.type === undefined && isRecord(candidate.data) && hasOwn(candidate.data, 'label')) {
      type = 'mindMap';
      state.diagnostics.push(diagnostic(
        'inferred-node-type',
        'warning',
        `${path}.type`,
        'Missing type inferred as mindMap from data.label',
        { legacyId },
      ));
    }
    if (!type) {
      state.diagnostics.push(diagnostic(
        'unknown-node-type',
        'warning',
        `${path}.type`,
        'Unsupported node type was quarantined',
        { legacyId, original: jsonSafeCopy(candidate.type) },
      ));
      addQuarantine(state, 'node', path, 'unknown-node-type', candidate);
      return;
    }

    const duplicateLegacyId = legacyIds.has(legacyId);
    if (duplicateLegacyId) {
      state.diagnostics.push(diagnostic(
        'duplicate-node-id',
        'warning',
        `${path}.id`,
        'Duplicate node was retained with its own canonical ID; ambiguous edges resolve to the first occurrence',
        { legacyId, original: legacyId },
      ));
    }
    legacyIds.set(legacyId, (legacyIds.get(legacyId) ?? 0) + 1);
    const canonicalId = deterministicUuidV7(
      state.sourceHash,
      `nodes/${index}/${type}`,
      state.timestamp,
    );
    recordId(state, path, legacyId, canonicalId);
    normalized.push({
      index,
      path,
      legacyId,
      type,
      position: normalizePosition(candidate.position, `${path}.position`, state),
      data: normalizeData(candidate.data, `${path}.data`, state),
      raw: candidate,
      duplicateLegacyId,
      canonicalId,
    });
  });
  return normalized;
};

const normalizeLegacyEdges = (
  graph: LegacyMindMapGraph,
  state: MutableMigrationState,
): NormalizedLegacyEdge[] => {
  const normalized: NormalizedLegacyEdge[] = [];
  const ids = new Set<string>();

  graph.edges.forEach((candidate, index) => {
    const path = `$.edges[${index}]`;
    if (!isRecord(candidate)) {
      state.diagnostics.push(diagnostic(
        'invalid-edge',
        'warning',
        path,
        'Non-object edge was quarantined',
        { original: jsonSafeCopy(candidate) },
      ));
      addQuarantine(state, 'edge', path, 'invalid-edge', candidate);
      return;
    }
    const legacyId = typeof candidate.id === 'string' && candidate.id.trim()
      ? candidate.id
      : `__legacy_edge_${index}`;
    if (legacyId.startsWith('__legacy_edge_')) {
      state.diagnostics.push(diagnostic(
        'missing-edge-id',
        'warning',
        `${path}.id`,
        `Assigned deterministic surrogate ID ${legacyId}`,
        { original: jsonSafeCopy(candidate.id) },
      ));
    } else if (ids.has(legacyId)) {
      state.diagnostics.push(diagnostic(
        'duplicate-edge-id',
        'warning',
        `${path}.id`,
        'Duplicate edge ID retained through a path-derived canonical ID',
        { legacyId },
      ));
    }
    ids.add(legacyId);
    if (typeof candidate.source !== 'string' || typeof candidate.target !== 'string') {
      state.diagnostics.push(diagnostic(
        'invalid-edge-endpoint',
        'warning',
        path,
        'Edge without string source/target was quarantined',
        { legacyId, original: jsonSafeCopy(candidate) },
      ));
      addQuarantine(state, 'edge', path, 'invalid-edge-endpoint', candidate);
      return;
    }
    normalized.push({
      index,
      path,
      legacyId,
      source: candidate.source,
      target: candidate.target,
      data: normalizeData(candidate.data, `${path}.data`, state),
      raw: candidate,
    });
  });
  return normalized;
};

const stringLabel = (
  value: unknown,
  path: string,
  state: MutableMigrationState,
): string => {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  if (typeof value === 'number' || typeof value === 'boolean') {
    state.diagnostics.push(diagnostic(
      'coerced-label',
      'warning',
      path,
      'Primitive label was converted to text',
      { original: value },
    ));
    return String(value);
  }
  state.diagnostics.push(diagnostic(
    'invalid-label',
    'warning',
    path,
    'Structured label was serialized as deterministic JSON text',
    { original: jsonSafeCopy(value) },
  ));
  return stableStringify(value);
};

const richText = (text: string): RichText => ({
  type: 'doc',
  version: 1,
  blocks: [{
    type: 'paragraph',
    children: text ? [{ type: 'text', text }] : [],
  }],
});

const richTextToPlainText = (value: RichText): string => {
  const blockText = (block: RichText['blocks'][number]): string => {
    if (block.type === 'paragraph') {
      return block.children
        .map((child) => child.type === 'text' ? child.text : '\n')
        .join('');
    }
    if (block.type === 'table') {
      return block.rows.map((row) => row.cells.map((cell) => cell.text).join('\t')).join('\n');
    }
    return block.items
      .map((item) => item.children.map((child) => blockText(child)).join('\n'))
      .join('\n');
  };
  return value.blocks.map(blockText).join('\n');
};

const unknownFields = (
  source: JsonRecord,
  known: ReadonlySet<string>,
): JsonRecord => Object.fromEntries(
  Object.entries(source)
    .filter(([key]) => !known.has(key))
    .sort(([left], [right]) => left.localeCompare(right)),
);

const makeLegacyExtensions = (
  node: NormalizedLegacyNode,
  knownData: ReadonlySet<string>,
  extra: JsonRecord = {},
  state?: MutableMigrationState,
): Record<string, unknown> => {
  const topUnknown = unknownFields(
    node.raw,
    new Set(['id', 'type', 'position', 'data', 'width', 'height', 'selected', 'dragging', 'measured']),
  );
  const dataUnknown = unknownFields(node.data, knownData);
  const runtime: JsonRecord = {};
  for (const key of ['selected', 'dragging', 'measured', 'width', 'height']) {
    if (hasOwn(node.raw, key)) runtime[key] = node.raw[key];
  }
  if (hasOwn(node.data, 'editNonce')) runtime.editNonce = node.data.editNonce;
  if (Object.keys(runtime).length > 0 && state) {
    state.diagnostics.push(diagnostic(
      'runtime-field-dropped',
      'info',
      node.path,
      'Renderer-only selection/edit/measurement fields were excluded from canonical content',
      { legacyId: node.legacyId, original: jsonSafeCopy(runtime) },
    ));
  }
  const preserved = {
    ...(Object.keys(topUnknown).length > 0 ? { node: jsonSafeCopy(topUnknown) } : {}),
    ...(Object.keys(dataUnknown).length > 0 ? { data: jsonSafeCopy(dataUnknown) } : {}),
    ...extra,
  };
  if (state && (Object.keys(topUnknown).length > 0 || Object.keys(dataUnknown).length > 0)) {
    state.diagnostics.push(diagnostic(
      'unknown-field-preserved',
      'info',
      node.path,
      'Unknown content fields were preserved in the namespaced legacy extension',
      { legacyId: node.legacyId },
    ));
  }
  return {
    [LEGACY_ID_EXTENSION]: node.legacyId,
    ...(Object.keys(preserved).length > 0
      ? { [LEGACY_VALUE_EXTENSION]: jsonSafeCopy(preserved) }
      : {}),
  };
};

const makeEdgeExtensions = (edge: NormalizedLegacyEdge): Record<string, unknown> => {
  const topUnknown = unknownFields(
    edge.raw,
    new Set(['id', 'source', 'target', 'type', 'style', 'data', 'markerStart', 'markerEnd']),
  );
  const preserved = {
    ...(edge.raw.type !== undefined ? { type: jsonSafeCopy(edge.raw.type) } : {}),
    ...(edge.raw.style !== undefined ? { style: jsonSafeCopy(edge.raw.style) } : {}),
    ...(Object.keys(edge.data).length > 0 ? { data: jsonSafeCopy(edge.data) } : {}),
    ...(edge.raw.markerStart !== undefined ? { markerStart: jsonSafeCopy(edge.raw.markerStart) } : {}),
    ...(edge.raw.markerEnd !== undefined ? { markerEnd: jsonSafeCopy(edge.raw.markerEnd) } : {}),
    ...(Object.keys(topUnknown).length > 0 ? { edge: jsonSafeCopy(topUnknown) } : {}),
  };
  return {
    [LEGACY_ID_EXTENSION]: edge.legacyId,
    ...(Object.keys(preserved).length > 0 ? { [LEGACY_VALUE_EXTENSION]: preserved } : {}),
  };
};

const chooseRoot = (
  topicNodes: NormalizedLegacyNode[],
  edges: NormalizedLegacyEdge[],
  firstNodeByLegacyId: Map<string, NormalizedLegacyNode>,
  state: MutableMigrationState,
): NormalizedLegacyNode | null => {
  if (topicNodes.length === 0) return null;
  const explicit = topicNodes.find((node) => node.legacyId === 'root' && !node.duplicateLegacyId);
  if (explicit) return explicit;

  const incoming = new Set<string>();
  for (const edge of edges) {
    if (edge.data.kind === 'link' || edge.legacyId === PREVIEW_EDGE_ID) continue;
    const source = firstNodeByLegacyId.get(edge.source);
    const target = firstNodeByLegacyId.get(edge.target);
    if (source?.type === 'mindMap' && target?.type === 'mindMap' && source !== target) {
      incoming.add(target.canonicalId);
    }
  }
  const candidates = topicNodes.filter((node) => !incoming.has(node.canonicalId));
  const root = candidates[0] ?? topicNodes[0];
  state.diagnostics.push(diagnostic(
    candidates.length === 1 ? 'root-inferred' : 'ambiguous-root',
    'warning',
    '$.nodes',
    candidates.length === 1
      ? `Central topic inferred from the only root candidate (${root.legacyId})`
      : `Central topic selected deterministically from ${candidates.length || topicNodes.length} candidates (${root.legacyId})`,
    { legacyId: root.legacyId },
  ));
  return root;
};

const wouldCreateCycle = (
  parentId: string,
  childId: string,
  childrenByParent: Map<string, Set<string>>,
): boolean => {
  const pending = [childId];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (current === parentId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const child of childrenByParent.get(current) ?? []) pending.push(child);
  }
  return false;
};

const routeTreeEdges = (
  edges: NormalizedLegacyEdge[],
  firstNodeByLegacyId: Map<string, NormalizedLegacyNode>,
  root: NormalizedLegacyNode,
  state: MutableMigrationState,
): {
  accepted: PendingTreeEdge[];
  relationships: PendingRelationshipEdge[];
} => {
  const accepted: PendingTreeEdge[] = [];
  const relationships: PendingRelationshipEdge[] = [];
  const parentByChild = new Map<string, string>();
  const childrenByParent = new Map<string, Set<string>>();
  const pairs = new Set<string>();

  for (const edge of edges) {
    if (edge.legacyId === PREVIEW_EDGE_ID) {
      state.diagnostics.push(diagnostic(
        'preview-edge-dropped',
        'info',
        edge.path,
        'Ephemeral drag preview edge was excluded from canonical content',
        { legacyId: edge.legacyId, original: jsonSafeCopy(edge.raw) },
      ));
      continue;
    }
    if (edge.data.kind === 'link') {
      relationships.push({ edge });
      continue;
    }
    const source = firstNodeByLegacyId.get(edge.source);
    const target = firstNodeByLegacyId.get(edge.target);
    let reason: string | null = null;
    if (!source || !target) reason = 'dangling-ref';
    else if (source.type !== 'mindMap' || target.type !== 'mindMap') reason = 'non-topic-tree-endpoint';
    else if (source.canonicalId === target.canonicalId) reason = 'self-loop';
    else if (target.canonicalId === root.canonicalId) reason = 'edge-targets-root';
    else if (parentByChild.has(target.canonicalId)) reason = 'multiple-parent';
    else if (pairs.has(`${source.canonicalId}:${target.canonicalId}`)) reason = 'duplicate-tree-edge';
    else if (wouldCreateCycle(source.canonicalId, target.canonicalId, childrenByParent)) reason = 'cycle-repair';

    if (reason) {
      relationships.push({ edge, reason });
      continue;
    }
    const id = deterministicUuidV7(
      state.sourceHash,
      `edges/${edge.index}/tree-edge`,
      state.timestamp,
    ) as TreeEdgeId;
    recordId(state, edge.path, edge.legacyId, id);
    accepted.push({ edge, parent: source!, child: target!, id });
    parentByChild.set(target!.canonicalId, source!.canonicalId);
    pairs.add(`${source!.canonicalId}:${target!.canonicalId}`);
    (childrenByParent.get(source!.canonicalId) ?? (() => {
      const set = new Set<string>();
      childrenByParent.set(source!.canonicalId, set);
      return set;
    })()).add(target!.canonicalId);
  }
  return { accepted, relationships };
};

const orderKey = (index: number): string => `a${index.toString(36).padStart(7, '0')}`;

const materializeTreeEdges = (
  pending: PendingTreeEdge[],
  root: NormalizedLegacyNode,
): Record<TreeEdgeId, TreeEdge> => {
  const grouped = new Map<string, PendingTreeEdge[]>();
  for (const item of pending) {
    const side = item.parent.canonicalId === root.canonicalId
      ? (item.child.position.x < root.position.x
          ? 'left'
          : item.child.position.x > root.position.x
            ? 'right'
            : item.child.canonicalId < root.canonicalId ? 'left' : 'right')
      : 'inherit';
    const group = `${item.parent.canonicalId}:${side}`;
    (grouped.get(group) ?? (() => {
      const list: PendingTreeEdge[] = [];
      grouped.set(group, list);
      return list;
    })()).push(item);
  }
  const result = {} as Record<TreeEdgeId, TreeEdge>;
  for (const items of grouped.values()) {
    items.sort((left, right) =>
      left.child.position.y - right.child.position.y
      || left.child.index - right.child.index
      || left.child.canonicalId.localeCompare(right.child.canonicalId));
    items.forEach((item, index) => {
      const side: TreeEdge['side'] = item.parent.canonicalId === root.canonicalId
        ? (item.child.position.x < root.position.x
            ? 'left'
            : item.child.position.x > root.position.x
              ? 'right'
              : item.child.canonicalId < root.canonicalId ? 'left' : 'right')
        : 'inherit';
      result[item.id] = {
        id: item.id,
        parentTopicId: item.parent.canonicalId as TopicId,
        childTopicId: item.child.canonicalId as TopicId,
        orderKey: orderKey(index),
        side,
        style: connectorStyleFromLegacy(item.edge, true),
        extensions: makeEdgeExtensions(item.edge),
      };
      if (!result[item.id].style) delete result[item.id].style;
    });
  }
  return result;
};

const makeTopics = (
  nodes: NormalizedLegacyNode[],
  root: NormalizedLegacyNode,
  treeEdges: Record<TreeEdgeId, TreeEdge>,
  state: MutableMigrationState,
): Record<TopicId, Topic> => {
  const incoming = new Set(Object.values(treeEdges).map((edge) => edge.childTopicId as string));
  const topics = {} as Record<TopicId, Topic>;
  for (const node of nodes.filter((item) => item.type === 'mindMap')) {
    const id = node.canonicalId as TopicId;
    const bold = node.data.bold === true;
    if (node.data.bold !== undefined && typeof node.data.bold !== 'boolean') {
      state.diagnostics.push(diagnostic(
        'invalid-bold',
        'warning',
        `${node.path}.data.bold`,
        'Only boolean true maps to bold; original value remains in the rollback backup',
        { legacyId: node.legacyId, original: jsonSafeCopy(node.data.bold) },
      ));
    }
    topics[id] = {
      id,
      role: node.canonicalId === root.canonicalId
        ? 'central'
        : incoming.has(node.canonicalId) ? 'regular' : 'floating-root',
      title: richText(stringLabel(node.data.label, `${node.path}.data.label`, state)),
      placement: { mode: 'absolute', x: node.position.x, y: node.position.y },
      sizing: { width: { mode: 'fit' } },
      defaultCollapsed: false,
      ...(bold ? { style: { overrides: { typography: { fontWeight: 700 } } } } : {}),
      extensions: makeLegacyExtensions(
        node,
        new Set(['label', 'bold', 'editNonce']),
        {},
        state,
      ),
    };
  }
  return topics;
};

const collectDescendants = (
  rootId: TopicId,
  childrenByParent: Map<string, TopicId[]>,
): TopicId[] => {
  const result: TopicId[] = [];
  const pending = [rootId];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const current = pending.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    result.push(current);
    pending.push(...(childrenByParent.get(current) ?? []));
  }
  return result;
};

const inferTopicScope = (
  memberIds: TopicId[],
  treeEdges: Record<TreeEdgeId, TreeEdge>,
): TopicScope => {
  const memberSet = new Set<string>(memberIds);
  const incoming = new Map<string, TreeEdge>();
  const childrenByParent = new Map<string, TopicId[]>();
  for (const edge of Object.values(treeEdges)) {
    incoming.set(edge.childTopicId, edge);
    (childrenByParent.get(edge.parentTopicId) ?? (() => {
      const children: TopicId[] = [];
      childrenByParent.set(edge.parentTopicId, children);
      return children;
    })()).push(edge.childTopicId);
  }
  for (const children of childrenByParent.values()) children.sort();

  for (const candidate of memberIds) {
    const descendants = collectDescendants(candidate, childrenByParent);
    if (descendants.length === memberIds.length
      && descendants.every((id) => memberSet.has(id))) {
      return { kind: 'subtree', rootTopicId: candidate, depth: 'all' };
    }
  }

  const memberEdges = memberIds.map((id) => incoming.get(id));
  if (memberEdges.every((edge): edge is TreeEdge => Boolean(edge))) {
    const first = memberEdges[0];
    const sameGroup = memberEdges.every((edge) =>
      edge.parentTopicId === first.parentTopicId
      && edge.side === first.side
      && edge.slot === first.slot);
    if (sameGroup) {
      const siblings = Object.values(treeEdges)
        .filter((edge) =>
          edge.parentTopicId === first.parentTopicId
          && edge.side === first.side
          && edge.slot === first.slot)
        .sort((left, right) =>
          left.orderKey.localeCompare(right.orderKey) || left.id.localeCompare(right.id));
      const indexes = memberEdges.map((edge) => siblings.findIndex((item) => item.id === edge.id)).sort((a, b) => a - b);
      if (indexes.every((value, index) => index === 0 || value === indexes[index - 1] + 1)) {
        return {
          kind: 'sibling-range',
          parentTopicId: first.parentTopicId,
          firstEdgeId: siblings[indexes[0]].id,
          lastEdgeId: siblings[indexes[indexes.length - 1]].id,
          includeDescendants: false,
        };
      }
    }
  }
  return { kind: 'explicit', topicIds: memberIds };
};

const resolveMembers = (
  node: NormalizedLegacyNode,
  firstNodeByLegacyId: Map<string, NormalizedLegacyNode>,
  state: MutableMigrationState,
): TopicId[] => {
  if (!Array.isArray(node.data.memberIds)) {
    state.diagnostics.push(diagnostic(
      'invalid-member-ids',
      'warning',
      `${node.path}.data.memberIds`,
      'Boundary/Summary without memberIds cannot form a valid canonical scope',
      { legacyId: node.legacyId, original: jsonSafeCopy(node.data.memberIds) },
    ));
    return [];
  }
  const result: TopicId[] = [];
  const seen = new Set<string>();
  node.data.memberIds.forEach((legacyMemberId, index) => {
    const path = `${node.path}.data.memberIds[${index}]`;
    if (typeof legacyMemberId !== 'string') {
      state.diagnostics.push(diagnostic(
        'invalid-member-ref',
        'warning',
        path,
        'Non-string member reference was ignored and retained in rollback backup',
        { legacyId: node.legacyId, original: jsonSafeCopy(legacyMemberId) },
      ));
      return;
    }
    const target = firstNodeByLegacyId.get(legacyMemberId);
    if (!target || target.type !== 'mindMap') {
      state.diagnostics.push(diagnostic(
        'dangling-member-ref',
        'warning',
        path,
        'memberIds reference did not resolve to a Topic',
        { legacyId: node.legacyId, original: legacyMemberId },
      ));
      return;
    }
    if (seen.has(target.canonicalId)) {
      state.diagnostics.push(diagnostic(
        'duplicate-member-ref',
        'info',
        path,
        'Duplicate member reference was normalized once',
        { legacyId: node.legacyId, original: legacyMemberId },
      ));
      return;
    }
    seen.add(target.canonicalId);
    result.push(target.canonicalId as TopicId);
  });
  return result;
};

const readNonNegativeNumber = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.min(value, 10_000)
    : fallback;

const makeBoundariesAndSummaries = (
  nodes: NormalizedLegacyNode[],
  firstNodeByLegacyId: Map<string, NormalizedLegacyNode>,
  root: NormalizedLegacyNode,
  treeEdges: Record<TreeEdgeId, TreeEdge>,
  topics: Record<TopicId, Topic>,
  state: MutableMigrationState,
): {
  boundaries: Record<BoundaryId, Boundary>;
  summaries: Record<SummaryId, Summary>;
} => {
  const boundaries = {} as Record<BoundaryId, Boundary>;
  const summaries = {} as Record<SummaryId, Summary>;

  for (const node of nodes) {
    if (node.type !== 'boundary' && node.type !== 'summary') continue;
    const memberIds = resolveMembers(node, firstNodeByLegacyId, state);
    if (memberIds.length === 0 || (node.type === 'summary' && memberIds.includes(root.canonicalId as TopicId))) {
      const reason = memberIds.length === 0 ? 'empty-scope' : 'summary-includes-central';
      state.diagnostics.push(diagnostic(
        reason,
        'warning',
        node.path,
        'Range element was quarantined because it could not satisfy canonical scope invariants',
        { legacyId: node.legacyId, original: jsonSafeCopy(node.raw) },
      ));
      addQuarantine(state, 'node', node.path, reason, node.raw);
      continue;
    }
    const scope = inferTopicScope(memberIds, treeEdges);
    if (scope.kind === 'explicit') {
      state.diagnostics.push(diagnostic(
        'scope-fallback',
        'warning',
        `${node.path}.data.memberIds`,
        'Legacy membership could not be represented as subtree/sibling-range and uses explicit compatibility scope',
        { legacyId: node.legacyId },
      ));
    }
    const legacyGeometry = {
      position: node.position,
      ...(typeof node.data.w === 'number' ? { w: node.data.w } : {}),
      ...(typeof node.data.h === 'number' ? { h: node.data.h } : {}),
    };
    if (node.type === 'boundary') {
      const id = node.canonicalId as BoundaryId;
      const label = stringLabel(node.data.label, `${node.path}.data.label`, state);
      boundaries[id] = {
        id,
        scope,
        ...(label ? { title: richText(label) } : {}),
        padding: readNonNegativeNumber(node.data.padding, 20),
        extensions: makeLegacyExtensions(
          node,
          new Set(['memberIds', 'padding', 'w', 'h', 'label', 'editNonce']),
          { geometry: legacyGeometry },
          state,
        ),
      };
      state.stats.boundaries += 1;
      continue;
    }

    const id = node.canonicalId as SummaryId;
    const resultTopicId = deterministicUuidV7(
      state.sourceHash,
      `nodes/${node.index}/summary-result`,
      state.timestamp,
    ) as TopicId;
    const memberNodes = memberIds
      .map((memberId) => nodes.find((item) => item.canonicalId === memberId))
      .filter((item): item is NormalizedLegacyNode => Boolean(item));
    const anchorX = memberNodes.length > 0
      ? Math.max(...memberNodes.map((item) => item.position.x + DEFAULT_NODE_WIDTH))
      : node.position.x;
    const anchorY = memberNodes.length > 0
      ? Math.min(...memberNodes.map((item) => item.position.y))
      : node.position.y;
    topics[resultTopicId] = {
      id: resultTopicId,
      role: 'summary-result',
      title: richText(stringLabel(node.data.label, `${node.path}.data.label`, state) || '概要'),
      placement: {
        mode: 'offset',
        dx: node.position.x - anchorX,
        dy: node.position.y - anchorY,
      },
      sizing: { width: { mode: 'fit' } },
      defaultCollapsed: false,
      extensions: {
        [LEGACY_ID_EXTENSION]: `${node.legacyId}:result`,
      },
    };
    state.idMap[`${node.path}.resultTopic`] = resultTopicId;
    summaries[id] = {
      id,
      scope,
      resultTopicId,
      orientation: 'auto',
      extensions: makeLegacyExtensions(
        node,
        new Set(['memberIds', 'padding', 'h', 'label', 'editNonce']),
        {
          geometry: legacyGeometry,
          padding: readNonNegativeNumber(node.data.padding, 12),
        },
        state,
      ),
    };
    state.stats.summaries += 1;
  }
  return { boundaries, summaries };
};

const hexColor = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  if (/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(value)) return value.toUpperCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(value);
  return short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toUpperCase() : null;
};

const dashArray = (value: unknown): number[] | undefined => {
  const values = Array.isArray(value)
    ? value
    : typeof value === 'string' ? value.trim().split(/[ ,]+/) : [];
  const parsed = values
    .map((item) => typeof item === 'number' ? item : Number(item))
    .filter((item) => Number.isFinite(item) && item >= 0)
    .slice(0, 32);
  return parsed.length > 0 ? parsed : undefined;
};

const connectorStyleFromLegacy = (
  edge: NormalizedLegacyEdge,
  includeShape: boolean,
): TreeEdge['style'] | Relationship['style'] | undefined => {
  const rawStyle = isRecord(edge.raw.style) ? edge.raw.style : {};
  const color = hexColor(rawStyle.stroke);
  const width = typeof rawStyle.strokeWidth === 'number'
    && Number.isFinite(rawStyle.strokeWidth)
    && rawStyle.strokeWidth >= 0
    ? Math.min(rawStyle.strokeWidth, 1_000)
    : undefined;
  const dash = dashArray(rawStyle.strokeDasharray);
  const rawType = typeof edge.raw.type === 'string' ? edge.raw.type.toLowerCase() : '';
  const shape = rawType.includes('smooth')
    ? 'rounded-elbow' as const
    : rawType.includes('step') ? 'elbow' as const
      : rawType.includes('straight') ? 'straight' as const
        : rawType.includes('bezier') ? 'curve' as const : undefined;
  if (!color && width === undefined && !dash && (!includeShape || !shape)) return undefined;
  return {
    overrides: {
      connector: {
        ...(color ? { color: { kind: 'literal', value: color } as const } : {}),
        ...(width !== undefined ? { width } : {}),
        ...(dash ? { dash } : {}),
        ...(includeShape && shape ? { shape } : {}),
      },
    },
  };
};

const routingFromLegacy = (edge: NormalizedLegacyEdge): Relationship['routing'] => {
  const type = typeof edge.raw.type === 'string' ? edge.raw.type.toLowerCase() : '';
  if (type.includes('straight')) return 'straight';
  if (type.includes('step')) return 'orthogonal';
  if (type.includes('smooth')) return 'orthogonal';
  if (type.includes('bezier')) return 'curve';
  return 'curve';
};

const arrowFromLegacy = (value: unknown): ArrowHead => {
  const marker = typeof value === 'string'
    ? value
    : isRecord(value) && typeof value.type === 'string' ? value.type : '';
  const normalized = marker.toLowerCase().replace(/[^a-z]/g, '');
  if (!normalized) return 'none';
  if (normalized.includes('arrowclosed') || normalized.includes('triangle')) return 'triangle';
  if (normalized.includes('arrow') || normalized.includes('open')) return 'open-triangle';
  return 'none';
};

const endpointForNode = (
  node: NormalizedLegacyNode,
  boundaries: Record<BoundaryId, Boundary>,
): RelationshipTargetRef | null => {
  if (node.type === 'mindMap') return { kind: 'topic', topicId: node.canonicalId as TopicId };
  if (node.type === 'boundary' && boundaries[node.canonicalId as BoundaryId]) {
    return { kind: 'boundary', boundaryId: node.canonicalId as BoundaryId };
  }
  return null;
};

const legalRelationshipPair = (
  source: RelationshipTargetRef,
  target: RelationshipTargetRef,
): boolean => {
  if (source.kind === 'topic' && target.kind === 'topic') return true;
  if (source.kind === 'boundary' && target.kind === 'topic') return true;
  return source.kind === 'zone' || target.kind === 'zone';
};

const materializeRelationships = (
  pending: PendingRelationshipEdge[],
  firstNodeByLegacyId: Map<string, NormalizedLegacyNode>,
  boundaries: Record<BoundaryId, Boundary>,
  state: MutableMigrationState,
): Record<RelationshipId, Relationship> => {
  const relationships = {} as Record<RelationshipId, Relationship>;
  for (const item of pending) {
    const { edge, reason } = item;
    const sourceNode = firstNodeByLegacyId.get(edge.source);
    const targetNode = firstNodeByLegacyId.get(edge.target);
    const source = sourceNode ? endpointForNode(sourceNode, boundaries) : null;
    const target = targetNode ? endpointForNode(targetNode, boundaries) : null;
    if (!source || !target || !legalRelationshipPair(source, target)
      || JSON.stringify(source) === JSON.stringify(target)) {
      const code = reason === 'dangling-ref' ? 'dangling-ref' : 'illegal-relationship-pair';
      state.diagnostics.push(diagnostic(
        code,
        'warning',
        edge.path,
        'Edge could not become a valid TreeEdge or Relationship and was quarantined',
        { legacyId: edge.legacyId, original: jsonSafeCopy(edge.raw) },
      ));
      addQuarantine(state, 'edge', edge.path, code, edge.raw);
      continue;
    }
    const id = deterministicUuidV7(
      state.sourceHash,
      `edges/${edge.index}/relationship`,
      state.timestamp,
    ) as RelationshipId;
    if (!state.idMap[edge.path]) recordId(state, edge.path, edge.legacyId, id);
    relationships[id] = {
      id,
      source: { element: source, anchor: 'auto' },
      target: { element: target, anchor: 'auto' },
      routing: routingFromLegacy(edge),
      startArrow: arrowFromLegacy(edge.raw.markerStart),
      endArrow: arrowFromLegacy(edge.raw.markerEnd),
      style: connectorStyleFromLegacy(edge, false),
      extensions: makeEdgeExtensions(edge),
    };
    if (!relationships[id].style) delete relationships[id].style;
    if (reason) {
      state.diagnostics.push(diagnostic(
        'demoted-relationship',
        'warning',
        edge.path,
        `Invalid TreeEdge candidate (${reason}) was retained as a non-hierarchical Relationship`,
        { legacyId: edge.legacyId },
      ));
    }
  }
  return relationships;
};

const legacyTimestamp = (
  graph: LegacyMindMapGraph,
  diagnostics: LegacyMigrationDiagnostic[],
): number => {
  if (typeof graph.createdAt === 'string') {
    const parsed = Date.parse(graph.createdAt);
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 0xffff_ffff_ffff) return parsed;
    diagnostics.push(diagnostic(
      'invalid-created-at',
      'warning',
      '$.createdAt',
      `Invalid createdAt; deterministic fixed epoch ${LEGACY_V0_FIXED_EPOCH} was used`,
      { original: graph.createdAt },
    ));
  }
  return Date.parse(LEGACY_V0_FIXED_EPOCH);
};

const finalizeReport = (state: MutableMigrationState, document: MindMapDocumentV1 | null): LegacyMigrationReport => ({
  status: !document
    ? 'failed'
    : state.diagnostics.some((item) => item.severity !== 'info') ? 'degraded' : 'success',
  sourceFormat: 'legacy-v0',
  defaultsVersion: LEGACY_V0_DEFAULTS_VERSION,
  sourceHash: state.sourceHash,
  idMap: state.idMap,
  legacyIdMap: state.legacyIdMap,
  diagnostics: state.diagnostics,
  quarantined: state.quarantined,
  stats: state.stats,
});

/**
 * Pure legacy-v0 -> canonical V1 migration. It never reads time, locale,
 * timezone, DOM state or randomness, and never mutates the source payload.
 */
export const migrateLegacyV0ToCanonical = (
  input: unknown,
  options: LegacyMigrationOptions = {},
): LegacyMigrationResult => {
  const detection = detectMindMapPayload(input, options.limits);
  if (detection.kind !== 'legacy-v0') {
    let backup: Readonly<unknown>;
    try {
      backup = deepFreeze(jsonSafeCopy(detection.value));
    } catch {
      backup = deepFreeze({ $legacyType: 'unserializable-payload' });
    }
    const sourceHash = (() => {
      try { return sha256(stableStringify(detection.value)); } catch { return sha256('unserializable-payload'); }
    })();
    const report = makeReport(sourceHash);
    report.diagnostics.push(...detection.diagnostics);
    report.quarantined.push({
      kind: 'payload',
      path: '$',
      reason: detection.kind === 'canonical-v1' ? 'already-canonical' : 'unknown-payload-shape',
      original: backup,
    });
    return { document: null, report, legacyBackup: backup };
  }

  const graph = detection.value;
  const sourceHash = sha256(stableStringify(graph));
  const backup = deepFreeze(jsonSafeCopy(graph));
  const state: MutableMigrationState = {
    sourceHash,
    timestamp: legacyTimestamp(graph, detection.diagnostics),
    diagnostics: [...detection.diagnostics],
    quarantined: [],
    idMap: {},
    legacyIdMap: {},
    stats: makeEmptyStats(graph),
  };
  const nodes = normalizeLegacyNodes(graph, state);
  const edges = normalizeLegacyEdges(graph, state);
  const topicNodes = nodes.filter((node) => node.type === 'mindMap');
  const firstNodeByLegacyId = new Map<string, NormalizedLegacyNode>();
  for (const node of nodes) {
    if (!firstNodeByLegacyId.has(node.legacyId)) firstNodeByLegacyId.set(node.legacyId, node);
  }
  const root = chooseRoot(topicNodes, edges, firstNodeByLegacyId, state);
  if (!root) {
    state.diagnostics.push(diagnostic(
      'missing-topic-root',
      'error',
      '$.nodes',
      'No migratable mindMap Topic exists; canonical document was not written',
    ));
    addQuarantine(state, 'payload', '$', 'missing-topic-root', graph);
    return {
      document: null,
      report: finalizeReport(state, null),
      legacyBackup: backup,
    };
  }

  const routed = routeTreeEdges(edges, firstNodeByLegacyId, root, state);
  const treeEdges = materializeTreeEdges(routed.accepted, root);
  const topics = makeTopics(nodes, root, treeEdges, state);
  const ranges = makeBoundariesAndSummaries(
    nodes,
    firstNodeByLegacyId,
    root,
    treeEdges,
    topics,
    state,
  );
  const relationships = materializeRelationships(
    routed.relationships,
    firstNodeByLegacyId,
    ranges.boundaries,
    state,
  );
  const legacyDefaults = createLegacyV0DefaultSet();

  const documentId = deterministicUuidV7(sourceHash, 'document', state.timestamp);
  const sheetId = deterministicUuidV7(sourceHash, 'sheets/0', state.timestamp) as SheetId;
  const themeId = deterministicUuidV7(sourceHash, 'themes/migration-default', state.timestamp) as ThemeId;
  const sheet: MindMapSheet = {
    id: sheetId,
    orderKey: orderKey(0),
    title: options.sheetTitle ?? 'Mind Map',
    rootTopicId: root.canonicalId as TopicId,
    themeId,
    defaultBranchLayout: legacyDefaults.defaultBranchLayout,
    advancedLayout: legacyDefaults.advancedLayout,
    canvas: legacyDefaults.canvas,
    workCalendar: legacyDefaults.workCalendar,
    markerLegend: legacyDefaults.markerLegend,
    topics,
    treeEdges,
    relationships,
    boundaries: ranges.boundaries,
    summaries: ranges.summaries,
    callouts: {},
    zones: {},
    markerInstances: {},
    notes: {},
    links: {},
    attachments: {},
    images: {},
    equations: {},
    audioClips: {},
    todos: {},
    tasks: {},
    taskDependencies: {},
  };
  const document: MindMapDocumentV1 = {
    schema: 'app.nmdd.mindmap',
    schemaVersion: 1,
    minimumReaderVersion: 1,
    id: documentId as MindMapDocumentV1['id'],
    contentRevision: 0,
    title: options.documentTitle ?? 'Migrated Mind Map',
    sheets: { [sheetId]: sheet } as MindMapDocumentV1['sheets'],
    assets: {},
    styles: {},
    themes: {
      [themeId]: {
        id: themeId,
        name: legacyDefaults.defaultThemeName,
        tokens: {},
        defaultStyles: {},
        rules: {},
      },
    } as MindMapDocumentV1['themes'],
    markerGroups: {},
    markerDefinitions: {},
    presentations: {},
    savedViews: {},
    actors: {},
    extensions: {
      [MIGRATION_EXTENSION]: {
        sourceFormat: 'legacy-v0',
        defaultsVersion: LEGACY_V0_DEFAULTS_VERSION,
        sourceHash,
      },
    },
  };
  state.stats.topics = Object.keys(topics).length;
  state.stats.treeEdges = Object.keys(treeEdges).length;
  state.stats.relationships = Object.keys(relationships).length;
  return {
    document,
    report: finalizeReport(state, document),
    legacyBackup: backup,
  };
};

const legacyExtension = (entity: { extensions?: Record<string, unknown> }): JsonRecord => {
  const value = entity.extensions?.[LEGACY_VALUE_EXTENSION];
  return isRecord(value) ? value : {};
};

const preferredLegacyId = (entity: { id: string; extensions?: Record<string, unknown> }): string => {
  const value = entity.extensions?.[LEGACY_ID_EXTENSION];
  return typeof value === 'string' && value.trim() ? value : entity.id;
};

const uniqueAlias = (preferred: string, canonicalId: string, used: Set<string>): string => {
  if (!used.has(preferred)) {
    used.add(preferred);
    return preferred;
  }
  const fallback = `${preferred}~${canonicalId.replace(/-/g, '').slice(-8)}`;
  if (!used.has(fallback)) {
    used.add(fallback);
    return fallback;
  }
  let index = 2;
  while (used.has(`${fallback}-${index}`)) index += 1;
  const alias = `${fallback}-${index}`;
  used.add(alias);
  return alias;
};

const topicPosition = (topic: Topic): { x: number; y: number } => {
  if (topic.placement.mode === 'absolute') return { x: topic.placement.x, y: topic.placement.y };
  if (topic.placement.mode === 'offset') return { x: topic.placement.dx, y: topic.placement.dy };
  return { x: 0, y: 0 };
};

const expandScope = (scope: TopicScope, sheet: MindMapSheet): TopicId[] =>
  expandSemanticTopicScope(sheet, scope);

const geometryRecord = (entity: { extensions?: Record<string, unknown> }): JsonRecord => {
  const geometry = legacyExtension(entity).geometry;
  return isRecord(geometry) ? geometry : {};
};

const finiteOr = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const deriveBoundaryGeometry = (
  memberIds: TopicId[],
  sheet: MindMapSheet,
  padding: number,
): { position: { x: number; y: number }; w: number; h: number } => {
  const positions = memberIds
    .map((id) => sheet.topics[id])
    .filter((topic): topic is Topic => Boolean(topic))
    .map(topicPosition);
  if (positions.length === 0) return { position: { x: 0, y: 0 }, w: 100, h: 100 };
  const minX = Math.min(...positions.map((position) => position.x));
  const minY = Math.min(...positions.map((position) => position.y));
  const maxX = Math.max(...positions.map((position) => position.x + DEFAULT_NODE_WIDTH));
  const maxY = Math.max(...positions.map((position) => position.y + DEFAULT_NODE_HEIGHT));
  return {
    position: { x: minX - padding, y: minY - padding },
    w: maxX - minX + padding * 2,
    h: maxY - minY + padding * 2,
  };
};

/**
 * Compatibility projection for the current React Flow canvas. It is derived
 * data only; callers must continue persisting the canonical document.
 */
export const projectCanonicalToLegacyCanvas = (
  document: MindMapDocumentV1,
  requestedSheetId?: string,
): LegacyMindMapGraph => {
  const sheets = Object.values(document.sheets).sort((left, right) =>
    left.orderKey.localeCompare(right.orderKey) || left.id.localeCompare(right.id));
  const sheet = requestedSheetId
    ? document.sheets[requestedSheetId as SheetId]
    : sheets[0];
  if (!sheet) throw new Error('Cannot project a document without the requested Sheet');

  const used = new Set<string>();
  const aliases = new Map<string, string>();
  const addAlias = (entity: { id: string; extensions?: Record<string, unknown> }): string => {
    const alias = uniqueAlias(preferredLegacyId(entity), entity.id, used);
    aliases.set(entity.id, alias);
    return alias;
  };
  for (const topic of Object.values(sheet.topics)) {
    if (topic.role !== 'summary-result') addAlias(topic);
  }
  for (const boundary of Object.values(sheet.boundaries)) addAlias(boundary);
  for (const summary of Object.values(sheet.summaries)) addAlias(summary);

  const nodes: LegacyMindMapNode[] = [];
  for (const topic of Object.values(sheet.topics)) {
    if (topic.role === 'summary-result') continue;
    nodes.push({
      id: aliases.get(topic.id) ?? topic.id,
      type: 'mindMap',
      position: topicPosition(topic),
      data: {
        label: richTextToPlainText(topic.title),
        bold: (topic.style?.overrides?.typography?.fontWeight ?? 0) >= 600,
      },
    });
  }
  for (const boundary of Object.values(sheet.boundaries)) {
    const memberIds = expandScope(boundary.scope, sheet);
    const derived = deriveBoundaryGeometry(memberIds, sheet, boundary.padding);
    const geometry = geometryRecord(boundary);
    const legacyPosition = isRecord(geometry.position) ? geometry.position : {};
    nodes.push({
      id: aliases.get(boundary.id) ?? boundary.id,
      type: 'boundary',
      position: {
        x: finiteOr(legacyPosition.x, derived.position.x),
        y: finiteOr(legacyPosition.y, derived.position.y),
      },
      data: {
        memberIds: memberIds.map((id) => aliases.get(id) ?? id),
        padding: boundary.padding,
        w: finiteOr(geometry.w, derived.w),
        h: finiteOr(geometry.h, derived.h),
        ...(boundary.title ? { label: richTextToPlainText(boundary.title) } : {}),
      },
    });
  }
  for (const summary of Object.values(sheet.summaries)) {
    const memberIds = expandScope(summary.scope, sheet);
    const resultTopic = sheet.topics[summary.resultTopicId];
    const geometry = geometryRecord(summary);
    const legacyPosition = isRecord(geometry.position) ? geometry.position : {};
    const extension = legacyExtension(summary);
    nodes.push({
      id: aliases.get(summary.id) ?? summary.id,
      type: 'summary',
      position: {
        x: finiteOr(legacyPosition.x, resultTopic ? topicPosition(resultTopic).x : 0),
        y: finiteOr(legacyPosition.y, resultTopic ? topicPosition(resultTopic).y : 0),
      },
      data: {
        memberIds: memberIds.map((id) => aliases.get(id) ?? id),
        padding: finiteOr(extension.padding, 12),
        h: finiteOr(geometry.h, 120),
        label: resultTopic ? richTextToPlainText(resultTopic.title) : '概要',
      },
    });
  }

  const edges: LegacyMindMapEdge[] = [];
  for (const edge of Object.values(sheet.treeEdges)) {
    const extension = legacyExtension(edge);
    const data = isRecord(extension.data) ? { ...extension.data } : {};
    if (data.kind === 'link') delete data.kind;
    edges.push({
      id: preferredLegacyId(edge),
      source: aliases.get(edge.parentTopicId) ?? edge.parentTopicId,
      target: aliases.get(edge.childTopicId) ?? edge.childTopicId,
      type: typeof extension.type === 'string' ? extension.type : 'smoothstep',
      ...(Object.keys(data).length > 0 ? { data } : {}),
      ...(isRecord(extension.style) ? { style: jsonSafeCopy(extension.style) } : {}),
      ...(extension.markerStart !== undefined ? { markerStart: jsonSafeCopy(extension.markerStart) } : {}),
      ...(extension.markerEnd !== undefined ? { markerEnd: jsonSafeCopy(extension.markerEnd) } : {}),
    });
  }
  const targetId = (target: RelationshipTargetRef): string | null => {
    if (target.kind === 'topic') return aliases.get(target.topicId) ?? target.topicId;
    if (target.kind === 'boundary') return aliases.get(target.boundaryId) ?? target.boundaryId;
    return null;
  };
  for (const relationship of Object.values(sheet.relationships)) {
    const source = targetId(relationship.source.element);
    const target = targetId(relationship.target.element);
    if (!source || !target) continue;
    const extension = legacyExtension(relationship);
    const data = isRecord(extension.data) ? { ...extension.data, kind: 'link' } : { kind: 'link' };
    edges.push({
      id: preferredLegacyId(relationship),
      source,
      target,
      type: typeof extension.type === 'string' ? extension.type : 'smoothstep',
      data,
      ...(isRecord(extension.style) ? { style: jsonSafeCopy(extension.style) } : {}),
      ...(extension.markerStart !== undefined ? { markerStart: jsonSafeCopy(extension.markerStart) } : {}),
      ...(extension.markerEnd !== undefined ? { markerEnd: jsonSafeCopy(extension.markerEnd) } : {}),
    });
  }
  return { nodes, edges };
};
