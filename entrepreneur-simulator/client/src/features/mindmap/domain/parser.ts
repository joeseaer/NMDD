import {
  detectMindMapPayload,
  type LegacyMigrationOptions,
  type LegacyMigrationReport,
  type LegacyMigrationDiagnostic,
} from './legacy';
import {
  getMindMapMigration,
  LEGACY_V0_TO_SCHEMA_V1,
} from './migrations';
import {
  DEFAULT_MIND_MAP_JSON_LIMITS,
  MindMapJsonError,
  parseConstrainedJson,
  type MindMapJsonLimits,
} from './safeJson';
import type { MindMapDocumentV1 } from './types';
import {
  validateMindMapDocument,
  type ValidationIssue,
} from './validation';

export const CURRENT_MIND_MAP_READER_VERSION = 1 as const;

export type MindMapParseIssueSeverity = 'info' | 'warning' | 'error';

export interface MindMapParseIssue {
  readonly code: string;
  readonly path: string;
  readonly message: string;
  readonly severity: MindMapParseIssueSeverity;
}

interface MindMapParseResultBase {
  readonly issues: readonly MindMapParseIssue[];
  /** Exact string input, or a JSON snapshot of object input, retained for recovery. */
  readonly preservedPayload: string;
  readonly migrationReport?: LegacyMigrationReport;
}

export interface MindMapParseSuccess extends MindMapParseResultBase {
  readonly ok: true;
  readonly readOnly: false;
  readonly sourceFormat: 'canonical-v1' | 'legacy-v0';
  readonly document: MindMapDocumentV1;
}

export interface MindMapParseFailure extends MindMapParseResultBase {
  readonly ok: false;
  readonly readOnly: boolean;
  readonly reason:
    | 'invalid-json'
    | 'unknown-format'
    | 'unsupported-version'
    | 'validation-failed'
    | 'migration-failed';
  readonly sourceFormat?: 'canonical-v1' | 'legacy-v0' | 'canonical-future';
}

export type MindMapParseResult = MindMapParseSuccess | MindMapParseFailure;

export interface ParseMindMapDocumentOptions {
  readonly readerVersion?: number;
  readonly jsonLimits?: Partial<MindMapJsonLimits>;
  readonly migration?: LegacyMigrationOptions;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const preservePayload = (raw: unknown): string => {
  if (typeof raw === 'string') return raw;
  try {
    return JSON.stringify(raw);
  } catch {
    return '[unserializable mind map payload]';
  }
};

const escapePointerSegment = (segment: string): string =>
  segment.replace(/~/g, '~0').replace(/\//g, '~1');

const legacyPathToPointer = (path: string): string => {
  if (path === '$' || path === '') return '/';
  const segments = path
    .replace(/^\$\.?/, '')
    .replace(/\[([0-9]+)\]/g, '.$1')
    .split('.')
    .filter(Boolean)
    .map(escapePointerSegment);
  return segments.length === 0 ? '/' : `/${segments.join('/')}`;
};

const fromLegacyDiagnostic = (
  diagnostic: LegacyMigrationDiagnostic,
): MindMapParseIssue => ({
  code: `migration.${diagnostic.code}`,
  path: legacyPathToPointer(diagnostic.path),
  message: diagnostic.message,
  severity: diagnostic.severity,
});

const fromValidationIssue = (issue: ValidationIssue): MindMapParseIssue => ({
  code: issue.code,
  path: issue.path,
  message: issue.message,
  severity: issue.severity,
});

const compareIssues = (left: MindMapParseIssue, right: MindMapParseIssue): number => {
  if (left.path < right.path) return -1;
  if (left.path > right.path) return 1;
  if (left.code < right.code) return -1;
  if (left.code > right.code) return 1;
  if (left.message < right.message) return -1;
  if (left.message > right.message) return 1;
  return 0;
};

const sortedIssues = (issues: readonly MindMapParseIssue[]): MindMapParseIssue[] =>
  [...issues].sort(compareIssues);

const validateDocument = (
  document: MindMapDocumentV1,
  preservedPayload: string,
  sourceFormat: MindMapParseSuccess['sourceFormat'],
  prefixIssues: readonly MindMapParseIssue[] = [],
  migrationReport?: LegacyMigrationReport,
): MindMapParseResult => {
  const validation = validateMindMapDocument(document);
  const issues = sortedIssues([
    ...prefixIssues,
    ...validation.issues.map(fromValidationIssue),
  ]);
  if (!validation.valid) {
    return {
      ok: false,
      readOnly: true,
      reason: 'validation-failed',
      sourceFormat,
      issues,
      preservedPayload,
      ...(migrationReport ? { migrationReport } : {}),
    };
  }

  return {
    ok: true,
    readOnly: false,
    sourceFormat,
    document,
    issues,
    preservedPayload,
    ...(migrationReport ? { migrationReport } : {}),
  };
};

export const parseMindMapDocument = (
  raw: unknown,
  options: ParseMindMapDocumentOptions = {},
): MindMapParseResult => {
  const preservedPayload = preservePayload(raw);
  const detection = detectMindMapPayload(raw, options.migration?.limits);
  const detectionIssues = detection.diagnostics.map(fromLegacyDiagnostic);

  let constrainedValue: unknown;
  try {
    constrainedValue = parseConstrainedJson(detection.value, {
      ...DEFAULT_MIND_MAP_JSON_LIMITS,
      ...options.jsonLimits,
    }).value;
  } catch (error) {
    const jsonError = error instanceof MindMapJsonError ? error : undefined;
    return {
      ok: false,
      readOnly: true,
      reason: 'invalid-json',
      issues: sortedIssues([
        ...detectionIssues,
        {
          code: jsonError?.code ?? 'json.invalid',
          path: '/',
          message: jsonError?.message ?? 'Mind map JSON is invalid.',
          severity: 'error',
        },
      ]),
      preservedPayload,
    };
  }

  if (isRecord(constrainedValue) && constrainedValue.schema === 'app.nmdd.mindmap') {
    const schemaVersion = constrainedValue.schemaVersion;
    const minimumReaderVersion = constrainedValue.minimumReaderVersion;
    const readerVersion = options.readerVersion ?? CURRENT_MIND_MAP_READER_VERSION;
    if (
      (typeof minimumReaderVersion === 'number' && minimumReaderVersion > readerVersion)
      || (typeof schemaVersion === 'number' && schemaVersion > 1)
    ) {
      return {
        ok: false,
        readOnly: true,
        reason: 'unsupported-version',
        sourceFormat: 'canonical-future',
        issues: sortedIssues([
          ...detectionIssues,
          {
            code: 'version.reader-too-old',
            path: '/minimumReaderVersion',
            message: `This document requires reader version ${String(minimumReaderVersion)}.`,
            severity: 'error',
          },
        ]),
        preservedPayload,
      };
    }
    if (typeof schemaVersion === 'number' && schemaVersion !== 1) {
      return {
        ok: false,
        readOnly: true,
        reason: 'unsupported-version',
        sourceFormat: 'canonical-future',
        issues: sortedIssues([
          ...detectionIssues,
          {
            code: 'version.unsupported-schema',
            path: '/schemaVersion',
            message: `No migration is registered for schema version ${schemaVersion}.`,
            severity: 'error',
          },
        ]),
        preservedPayload,
      };
    }
  }

  if (detection.kind === 'canonical-v1') {
    return validateDocument(
      constrainedValue as MindMapDocumentV1,
      preservedPayload,
      'canonical-v1',
      detectionIssues,
    );
  }

  if (detection.kind === 'legacy-v0') {
    const migration = getMindMapMigration(LEGACY_V0_TO_SCHEMA_V1)
      .migrate(constrainedValue, options.migration);
    const migrationIssues = migration.report.diagnostics.map(fromLegacyDiagnostic);
    if (!migration.document) {
      return {
        ok: false,
        readOnly: true,
        reason: 'migration-failed',
        sourceFormat: 'legacy-v0',
        issues: sortedIssues(migrationIssues),
        preservedPayload,
        migrationReport: migration.report,
      };
    }
    return validateDocument(
      migration.document,
      preservedPayload,
      'legacy-v0',
      migrationIssues,
      migration.report,
    );
  }

  return {
    ok: false,
    readOnly: true,
    reason: 'unknown-format',
    issues: sortedIssues(detectionIssues.length > 0 ? detectionIssues : [{
      code: 'format.unknown',
      path: '/',
      message: 'The payload is neither canonical MindMap V1 nor supported legacy nodes + edges.',
      severity: 'error',
    }]),
    preservedPayload,
  };
};
