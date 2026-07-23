import type { MindMapDocumentV1 } from '../domain/types';
import type {
  MindMapImportDiagnostic,
} from './types';
import {
  exportMindMapToXMind,
  importMindMapFromXMind,
  type XMindExportOptions,
  type XMindExportResult,
  type XMindImportResult,
  type XMindImportOptions,
} from './xmind';
import { resolveXMindZipSecurityLimits } from './xmindZip';
import {
  XMIND_WORKER_PROTOCOL_VERSION,
  deserializeXMindWorkerError,
  isXMindWorkerResponse,
  type XMindWorkerImportOptions,
  type XMindWorkerRequest,
} from './xmindWorkerProtocol';

export const XMIND_WORKER_FALLBACK_DIAGNOSTIC_CODE = (
  'xmind.worker-main-thread-fallback'
) as const;

export interface XMindWorkerRequestOptions {
  readonly signal?: AbortSignal;
}

export interface XMindWorkerExportRequestOptions
  extends XMindWorkerRequestOptions, XMindExportOptions {}

export interface XMindAsyncCodecClient {
  readonly busy: boolean;
  cancel(reason?: string): void;
  dispose(): void;
  exportXMind(
    document: MindMapDocumentV1,
    options?: XMindWorkerExportRequestOptions,
  ): Promise<XMindExportResult>;
  importXMind(
    input: ArrayBuffer | Uint8Array,
    importOptions?: XMindImportOptions,
    options?: XMindWorkerRequestOptions,
  ): Promise<XMindImportResult>;
}

export type XMindWorkerFactory = () => Worker;

export interface XMindWorkerClientOptions {
  /** Defaults to the Vite module Worker entry. */
  readonly workerFactory?: XMindWorkerFactory;
  /** Disable only when a caller would rather fail than use the synchronous codec. */
  readonly allowMainThreadFallback?: boolean;
  /** Test hook; production IDs remain unique for the lifetime of the page. */
  readonly requestIdFactory?: () => string;
}

export class XMindWorkerBusyError extends Error {
  constructor() {
    super('Another XMind worker operation is already running.');
    this.name = 'XMindWorkerBusyError';
  }
}

export class XMindWorkerUnavailableError extends Error {
  constructor(reason: string) {
    super(`XMind Web Worker is unavailable: ${reason}`);
    this.name = 'XMindWorkerUnavailableError';
  }
}

interface ActiveOperation {
  readonly cancel: (reason: string) => void;
  readonly requestId: string;
}

let requestSequence = 0;

const nextRequestId = (): string => {
  requestSequence += 1;
  return `xmind-${Date.now().toString(36)}-${requestSequence.toString(36)}`;
};

function defaultWorkerFactory(): Worker {
  if (typeof Worker === 'undefined') {
    throw new XMindWorkerUnavailableError('this browser does not expose Worker');
  }
  return new Worker(new URL('./xmind.worker.ts', import.meta.url), {
    name: 'nmdd-xmind-codec',
    type: 'module',
  });
}

function errorSummary(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') return error.message;
  if (typeof error === 'string' && error.trim() !== '') return error;
  return 'unknown worker initialization or transport error';
}

function createAbortError(message: string): Error {
  if (typeof DOMException !== 'undefined') return new DOMException(message, 'AbortError');
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

export function isXMindWorkerAbortError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'name' in error
    && error.name === 'AbortError';
}

/** Mirrors the codec's pre-decompression archive byte limit for UI preflight. */
export function resolveXMindArchiveByteLimit(
  options: XMindImportOptions = {},
): number {
  return resolveXMindZipSecurityLimits({
    ...options.zipLimits,
    ...(options.limits?.maxInputBytes === undefined
      ? {}
      : { maxArchiveBytes: options.limits.maxInputBytes }),
  }).maxArchiveBytes;
}

function fallbackDiagnostic(reason: string): MindMapImportDiagnostic {
  return {
    code: XMIND_WORKER_FALLBACK_DIAGNOSTIC_CODE,
    disposition: 'degraded',
    message: `The XMind Web Worker was unavailable, so the same safety-limited codec ran on the main thread. Reason: ${reason}`,
    path: '/runtime/xmind-worker',
    severity: 'warning',
  };
}

function withImportFallbackDiagnostic(
  result: XMindImportResult,
  reason: string,
): XMindImportResult {
  return {
    ...result,
    report: {
      ...result.report,
      degradedItems: result.report.degradedItems + 1,
      diagnostics: [...result.report.diagnostics, fallbackDiagnostic(reason)],
    },
  };
}

function withExportFallbackDiagnostic(
  result: XMindExportResult,
  reason: string,
): XMindExportResult {
  return {
    ...result,
    report: {
      ...result.report,
      degradedItems: result.report.degradedItems + 1,
      diagnostics: [...result.report.diagnostics, fallbackDiagnostic(reason)],
    },
  };
}

function copyToTransferableBuffer(input: ArrayBuffer | Uint8Array): ArrayBuffer {
  const source = input instanceof Uint8Array ? input : new Uint8Array(input);
  const copy = new Uint8Array(source.byteLength);
  copy.set(source);
  return copy.buffer;
}

function serializableImportOptions(options: XMindImportOptions): XMindWorkerImportOptions {
  return {
    ...(options.limits === undefined ? {} : { limits: options.limits }),
    ...(options.locale === undefined ? {} : { locale: options.locale }),
    ...(options.zipLimits === undefined ? {} : { zipLimits: options.zipLimits }),
  };
}

/**
 * Runs one heavy codec operation in a dedicated Worker. One Worker per request
 * keeps cancellation deterministic: termination interrupts ZIP/JSON work even
 * while the codec itself is executing synchronously inside the Worker.
 */
export class XMindWorkerClient implements XMindAsyncCodecClient {
  readonly #allowMainThreadFallback: boolean;
  readonly #requestIdFactory: () => string;
  readonly #workerFactory: XMindWorkerFactory;
  #active: ActiveOperation | undefined;
  #disposed = false;

  constructor(options: XMindWorkerClientOptions = {}) {
    this.#allowMainThreadFallback = options.allowMainThreadFallback ?? true;
    this.#requestIdFactory = options.requestIdFactory ?? nextRequestId;
    this.#workerFactory = options.workerFactory ?? defaultWorkerFactory;
  }

  get busy(): boolean {
    return this.#active !== undefined;
  }

  cancel(reason = 'The XMind operation was cancelled.'): void {
    this.#active?.cancel(reason);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.cancel('The XMind worker client was disposed.');
  }

  importXMind(
    input: ArrayBuffer | Uint8Array,
    importOptions: XMindImportOptions = {},
    options: XMindWorkerRequestOptions = {},
  ): Promise<XMindImportResult> {
    const forcedFallbackReason = importOptions.idFactory === undefined
      ? undefined
      : 'the supplied idFactory is a function and cannot cross the structured-clone boundary';
    // Do not copy a potentially large archive when this request is known to
    // require the compatibility path before a Worker is even considered.
    const transferBuffer = forcedFallbackReason === undefined
      ? copyToTransferableBuffer(input)
      : new ArrayBuffer(0);
    const requestId = this.#requestIdFactory();
    const request: XMindWorkerRequest = {
      kind: 'xmind-worker-request',
      operation: 'import',
      payload: {
        bytes: transferBuffer,
        options: serializableImportOptions(importOptions),
      },
      protocolVersion: XMIND_WORKER_PROTOCOL_VERSION,
      requestId,
    };
    return this.#run(
      request,
      [transferBuffer],
      () => importMindMapFromXMind(input, importOptions),
      withImportFallbackDiagnostic,
      options.signal,
      forcedFallbackReason,
    );
  }

  exportXMind(
    document: MindMapDocumentV1,
    options: XMindWorkerExportRequestOptions = {},
  ): Promise<XMindExportResult> {
    const requestId = this.#requestIdFactory();
    const request: XMindWorkerRequest = {
      kind: 'xmind-worker-request',
      operation: 'export',
      payload: {
        document,
        ...(options.resourceBytes === undefined
          ? {}
          : { options: { resourceBytes: options.resourceBytes } }),
      },
      protocolVersion: XMIND_WORKER_PROTOCOL_VERSION,
      requestId,
    };
    return this.#run(
      request,
      [],
      () => exportMindMapToXMind(document, options.resourceBytes === undefined
        ? {}
        : { resourceBytes: options.resourceBytes }),
      withExportFallbackDiagnostic,
      options.signal,
    );
  }

  #run<Result>(
    request: XMindWorkerRequest,
    transfer: Transferable[],
    fallback: () => Result,
    decorateFallback: (result: Result, reason: string) => Result,
    signal?: AbortSignal,
    forcedFallbackReason?: string,
  ): Promise<Result> {
    if (this.#disposed) {
      return Promise.reject(createAbortError('The XMind worker client is disposed.'));
    }
    if (this.#active) return Promise.reject(new XMindWorkerBusyError());
    if (signal?.aborted) {
      return Promise.reject(createAbortError('The XMind operation was cancelled.'));
    }

    return new Promise<Result>((resolve, reject) => {
      let settled = false;
      let fallbackStarted = false;
      let fallbackTimer: number | undefined;
      let workerStartTimer: number | undefined;
      let worker: Worker | undefined;

      const detachWorker = (): void => {
        if (!worker) return;
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
        worker.removeEventListener('messageerror', onMessageError);
        worker.terminate();
        worker = undefined;
      };

      const finish = (complete: () => void): void => {
        if (settled) return;
        settled = true;
        if (fallbackTimer !== undefined) globalThis.clearTimeout(fallbackTimer);
        if (workerStartTimer !== undefined) globalThis.clearTimeout(workerStartTimer);
        signal?.removeEventListener('abort', onAbort);
        detachWorker();
        if (this.#active?.requestId === request.requestId) this.#active = undefined;
        complete();
      };

      const cancel = (reason: string): void => {
        finish(() => reject(createAbortError(reason)));
      };

      const startFallback = (reason: string): void => {
        if (settled || fallbackStarted) return;
        fallbackStarted = true;
        detachWorker();
        if (!this.#allowMainThreadFallback) {
          finish(() => reject(new XMindWorkerUnavailableError(reason)));
          return;
        }
        // Yield once so React can paint the busy/cancel affordance before the
        // exceptional main-thread path starts its synchronous codec work.
        fallbackTimer = globalThis.setTimeout(() => {
          fallbackTimer = undefined;
          if (signal?.aborted) {
            cancel('The XMind operation was cancelled.');
            return;
          }
          try {
            const result = decorateFallback(fallback(), reason);
            if (signal?.aborted) {
              cancel('The XMind operation was cancelled.');
              return;
            }
            finish(() => resolve(result));
          } catch (error) {
            finish(() => reject(error));
          }
        }, 0);
      };

      const onMessage = (event: MessageEvent<unknown>): void => {
        const response = event.data;
        if (!isXMindWorkerResponse(response)) {
          startFallback('the Worker returned an invalid protocol response');
          return;
        }
        if (response.requestId !== request.requestId) {
          startFallback('the Worker returned a mismatched request ID');
          return;
        }
        if (response.operation !== request.operation) {
          startFallback('the Worker returned a response for the wrong operation');
          return;
        }
        if (!response.ok) {
          finish(() => reject(deserializeXMindWorkerError(response.error)));
          return;
        }
        finish(() => resolve(response.result as Result));
      };

      const onError = (event: ErrorEvent): void => {
        event.preventDefault();
        startFallback(event.message || 'the Worker failed while loading or executing');
      };

      const onMessageError = (): void => {
        startFallback('the browser could not deserialize the Worker response');
      };

      const onAbort = (): void => cancel('The XMind operation was cancelled.');

      this.#active = { cancel, requestId: request.requestId };
      signal?.addEventListener('abort', onAbort, { once: true });

      if (forcedFallbackReason !== undefined) {
        startFallback(forcedFallbackReason);
        return;
      }

      // Let the calling UI commit its busy state before Worker construction and
      // structured cloning of a potentially large export document begin.
      workerStartTimer = globalThis.setTimeout(() => {
        workerStartTimer = undefined;
        if (signal?.aborted) {
          cancel('The XMind operation was cancelled.');
          return;
        }
        try {
          worker = this.#workerFactory();
          worker.addEventListener('message', onMessage);
          worker.addEventListener('error', onError);
          worker.addEventListener('messageerror', onMessageError);
          worker.postMessage(request, transfer);
        } catch (error) {
          startFallback(errorSummary(error));
        }
      }, 0);
    });
  }
}

export const createXMindWorkerClient = (): XMindAsyncCodecClient => (
  new XMindWorkerClient()
);
