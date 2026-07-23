import {
  exportMindMapToXMind,
  importMindMapFromXMind,
} from './xmind';
import {
  XMIND_WORKER_PROTOCOL_VERSION,
  isXMindWorkerRequest,
  serializeXMindWorkerError,
  type XMindWorkerOperation,
  type XMindWorkerRequest,
  type XMindWorkerResponse,
} from './xmindWorkerProtocol';

function invalidRequestResponse(value: unknown): XMindWorkerResponse {
  const candidate = typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : {};
  const operation: XMindWorkerOperation = candidate.operation === 'export'
    ? 'export'
    : 'import';
  return {
    error: serializeXMindWorkerError(Object.assign(
      new Error('The XMind worker received an invalid or unsupported request.'),
      { code: 'xmind.worker-protocol-invalid-request' },
    )),
    kind: 'xmind-worker-response',
    ok: false,
    operation,
    protocolVersion: XMIND_WORKER_PROTOCOL_VERSION,
    requestId: typeof candidate.requestId === 'string' ? candidate.requestId : '',
  };
}

/** Executes one protocol request. Kept separate from the Worker entry for unit testing. */
export function executeXMindWorkerRequest(value: unknown): XMindWorkerResponse {
  if (!isXMindWorkerRequest(value)) return invalidRequestResponse(value);
  const request: XMindWorkerRequest = value;
  try {
    if (request.operation === 'import') {
      return {
        kind: 'xmind-worker-response',
        ok: true,
        operation: 'import',
        protocolVersion: XMIND_WORKER_PROTOCOL_VERSION,
        requestId: request.requestId,
        result: importMindMapFromXMind(
          request.payload.bytes,
          request.payload.options,
        ),
      };
    }
    return {
      kind: 'xmind-worker-response',
      ok: true,
      operation: 'export',
      protocolVersion: XMIND_WORKER_PROTOCOL_VERSION,
      requestId: request.requestId,
      result: exportMindMapToXMind(request.payload.document, request.payload.options),
    };
  } catch (error) {
    return {
      error: serializeXMindWorkerError(error),
      kind: 'xmind-worker-response',
      ok: false,
      operation: request.operation,
      protocolVersion: XMIND_WORKER_PROTOCOL_VERSION,
      requestId: request.requestId,
    };
  }
}
