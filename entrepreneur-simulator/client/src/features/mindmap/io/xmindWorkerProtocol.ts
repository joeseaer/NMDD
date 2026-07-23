import type { MindMapDocumentV1 } from '../domain/types';
import type {
  XMindExportOptions,
  XMindExportResult,
  XMindImportResult,
  XMindImportOptions,
} from './xmind';

export const XMIND_WORKER_PROTOCOL_VERSION = 1 as const;

export type XMindWorkerOperation = 'import' | 'export';

/**
 * Import options that can cross the structured-clone boundary. `idFactory` is
 * deliberately excluded because functions cannot be sent to a Web Worker.
 */
export type XMindWorkerImportOptions = Pick<
  XMindImportOptions,
  'limits' | 'locale' | 'zipLimits'
>;

interface XMindWorkerRequestBase {
  readonly kind: 'xmind-worker-request';
  readonly protocolVersion: typeof XMIND_WORKER_PROTOCOL_VERSION;
  readonly requestId: string;
}

export interface XMindWorkerImportRequest extends XMindWorkerRequestBase {
  readonly operation: 'import';
  readonly payload: {
    readonly bytes: ArrayBuffer;
    readonly options: XMindWorkerImportOptions;
  };
}

export interface XMindWorkerExportRequest extends XMindWorkerRequestBase {
  readonly operation: 'export';
  readonly payload: {
    readonly document: MindMapDocumentV1;
    readonly options?: XMindExportOptions;
  };
}

export type XMindWorkerRequest =
  | XMindWorkerImportRequest
  | XMindWorkerExportRequest;

export interface SerializedXMindWorkerError {
  readonly code?: string;
  readonly message: string;
  readonly name: string;
  readonly stack?: string;
}

interface XMindWorkerResponseBase {
  readonly kind: 'xmind-worker-response';
  readonly operation: XMindWorkerOperation;
  readonly protocolVersion: typeof XMIND_WORKER_PROTOCOL_VERSION;
  readonly requestId: string;
}

export interface XMindWorkerImportSuccessResponse extends XMindWorkerResponseBase {
  readonly ok: true;
  readonly operation: 'import';
  readonly result: XMindImportResult;
}

export interface XMindWorkerExportSuccessResponse extends XMindWorkerResponseBase {
  readonly ok: true;
  readonly operation: 'export';
  readonly result: XMindExportResult;
}

export interface XMindWorkerFailureResponse extends XMindWorkerResponseBase {
  readonly error: SerializedXMindWorkerError;
  readonly ok: false;
}

export type XMindWorkerResponse =
  | XMindWorkerImportSuccessResponse
  | XMindWorkerExportSuccessResponse
  | XMindWorkerFailureResponse;

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const isNonNegativeFiniteNumber = (value: unknown): value is number => (
  typeof value === 'number' && Number.isFinite(value) && value >= 0
);

function isDiagnostic(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return typeof value.code === 'string'
    && ['degraded', 'ignored', 'preserved', 'rejected'].includes(String(value.disposition))
    && typeof value.message === 'string'
    && (value.path === undefined || typeof value.path === 'string')
    && ['error', 'info', 'warning'].includes(String(value.severity));
}

function hasCommonReportShape(report: JsonRecord): boolean {
  return typeof report.success === 'boolean'
    && isNonNegativeFiniteNumber(report.degradedItems)
    && Array.isArray(report.diagnostics)
    && report.diagnostics.every(isDiagnostic)
    && isNonNegativeFiniteNumber(report.preservedAttributes);
}

function isImportResult(value: JsonRecord): boolean {
  if (!isRecord(value.report) || !hasCommonReportShape(value.report)) return false;
  if (
    value.resourceBytes !== undefined
    && (!isRecord(value.resourceBytes)
      || !Object.values(value.resourceBytes).every((bytes) => bytes instanceof Uint8Array))
  ) return false;
  return (value.document === null || isRecord(value.document))
    && value.report.format === 'xmind-content-json'
    && isNonNegativeFiniteNumber(value.report.ignoredItems)
    && isNonNegativeFiniteNumber(value.report.importedSheets)
    && isNonNegativeFiniteNumber(value.report.importedTopics)
    && isNonNegativeFiniteNumber(value.report.inputBytes);
}

function isExportResult(value: JsonRecord): boolean {
  if (!isRecord(value.report) || !hasCommonReportShape(value.report)) return false;
  return (value.bytes === null || value.bytes instanceof Uint8Array)
    && value.report.format === 'xmind-content-json'
    && isNonNegativeFiniteNumber(value.report.exportedSheets)
    && isNonNegativeFiniteNumber(value.report.exportedTopics);
}

export function serializeXMindWorkerError(error: unknown): SerializedXMindWorkerError {
  if (error instanceof Error) {
    const code = isRecord(error) && typeof error.code === 'string'
      ? error.code
      : undefined;
    return {
      ...(code === undefined ? {} : { code }),
      message: error.message || 'Unknown XMind worker error.',
      name: error.name || 'Error',
      ...(error.stack === undefined ? {} : { stack: error.stack }),
    };
  }
  if (isRecord(error)) {
    return {
      ...(typeof error.code === 'string' ? { code: error.code } : {}),
      message: typeof error.message === 'string' && error.message.trim() !== ''
        ? error.message
        : 'Unknown XMind worker error.',
      name: typeof error.name === 'string' && error.name.trim() !== ''
        ? error.name
        : 'Error',
      ...(typeof error.stack === 'string' ? { stack: error.stack } : {}),
    };
  }
  return {
    message: typeof error === 'string' && error.trim() !== ''
      ? error
      : 'Unknown XMind worker error.',
    name: 'Error',
  };
}

export function deserializeXMindWorkerError(
  serialized: SerializedXMindWorkerError,
): Error & { code?: string } {
  const error = new Error(serialized.message) as Error & { code?: string };
  error.name = serialized.name;
  if (serialized.stack !== undefined) error.stack = serialized.stack;
  if (serialized.code !== undefined) error.code = serialized.code;
  return error;
}

export function isXMindWorkerResponse(value: unknown): value is XMindWorkerResponse {
  if (!isRecord(value)) return false;
  if (
    value.kind !== 'xmind-worker-response'
    || value.protocolVersion !== XMIND_WORKER_PROTOCOL_VERSION
    || typeof value.requestId !== 'string'
    || !['import', 'export'].includes(String(value.operation))
    || typeof value.ok !== 'boolean'
  ) return false;
  if (value.ok) {
    if (!isRecord(value.result)) return false;
    return value.operation === 'import'
      ? isImportResult(value.result)
      : isExportResult(value.result);
  }
  if (!isRecord(value.error)) return false;
  return typeof value.error.message === 'string'
    && typeof value.error.name === 'string'
    && (value.error.code === undefined || typeof value.error.code === 'string')
    && (value.error.stack === undefined || typeof value.error.stack === 'string');
}

export function isXMindWorkerRequest(value: unknown): value is XMindWorkerRequest {
  if (!isRecord(value)) return false;
  if (
    value.kind !== 'xmind-worker-request'
    || value.protocolVersion !== XMIND_WORKER_PROTOCOL_VERSION
    || typeof value.requestId !== 'string'
    || !isRecord(value.payload)
  ) return false;
  if (value.operation === 'import') {
    return value.payload.bytes instanceof ArrayBuffer
      && isRecord(value.payload.options);
  }
  if (value.operation !== 'export' || !isRecord(value.payload.document)) return false;
  if (value.payload.options === undefined) return true;
  if (!isRecord(value.payload.options)) return false;
  const resourceBytes = value.payload.options.resourceBytes;
  return resourceBytes === undefined
    || (isRecord(resourceBytes) && Object.values(resourceBytes).every((bytes) =>
      bytes instanceof ArrayBuffer || bytes instanceof Uint8Array));
}
