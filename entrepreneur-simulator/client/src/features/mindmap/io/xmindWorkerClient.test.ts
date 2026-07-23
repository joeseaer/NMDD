import { describe, expect, it, vi } from 'vitest';

import { createNewMindMapDocument } from '../domain/defaults';
import type { Id, MindMapDocumentV1 } from '../domain/types';
import { executeXMindWorkerRequest } from './xmindWorkerRuntime';
import {
  XMIND_WORKER_FALLBACK_DIAGNOSTIC_CODE,
  resolveXMindArchiveByteLimit,
  XMindWorkerBusyError,
  XMindWorkerClient,
} from './xmindWorkerClient';
import type { XMindWorkerRequest } from './xmindWorkerProtocol';

const id = <K extends string>(counter: number): Id<K> => (
  `018f7000-0000-7000-8000-${counter.toString(16).padStart(12, '0')}` as Id<K>
);

const createDocument = (): MindMapDocumentV1 => createNewMindMapDocument({
  documentId: id<'Document'>(1),
  rootTopicId: id<'Topic'>(3),
  sheetId: id<'Sheet'>(2),
  sheetOrderKey: 'a',
  themeId: id<'Theme'>(4),
  title: 'Worker client',
});

class RuntimeBackedWorker extends EventTarget {
  readonly posted: Array<{ message: XMindWorkerRequest; transfer: readonly Transferable[] }> = [];
  terminated = false;

  postMessage(message: XMindWorkerRequest, transfer: Transferable[] = []): void {
    this.posted.push({ message, transfer });
    queueMicrotask(() => {
      if (this.terminated) return;
      this.dispatchEvent(new MessageEvent('message', {
        data: executeXMindWorkerRequest(message),
      }));
    });
  }

  terminate(): void {
    this.terminated = true;
  }
}

class PendingWorker extends EventTarget {
  terminated = false;
  postMessage(): void {}
  terminate(): void {
    this.terminated = true;
  }
}

class MismatchedRequestWorker extends EventTarget {
  terminated = false;
  postMessage(message: XMindWorkerRequest): void {
    queueMicrotask(() => {
      const response = executeXMindWorkerRequest(message);
      this.dispatchEvent(new MessageEvent('message', {
        data: { ...response, requestId: 'not-the-request-id' },
      }));
    });
  }
  terminate(): void {
    this.terminated = true;
  }
}

describe('XMindWorkerClient', () => {
  it('uses a module worker, correlates request IDs, and transfers import bytes', async () => {
    const workers: RuntimeBackedWorker[] = [];
    let request = 0;
    const client = new XMindWorkerClient({
      requestIdFactory: () => `request-${request += 1}`,
      workerFactory: () => {
        const worker = new RuntimeBackedWorker();
        workers.push(worker);
        return worker as unknown as Worker;
      },
    });
    const exported = await client.exportXMind(createDocument());
    expect(exported.report.success).toBe(true);
    expect(workers[0].posted[0].message.requestId).toBe('request-1');
    expect(workers[0].terminated).toBe(true);
    expect(client.busy).toBe(false);

    const source = exported.bytes;
    expect(source).not.toBeNull();
    const imported = await client.importXMind(source!);
    expect(imported.report.success).toBe(true);
    expect(workers[1].posted[0].message.requestId).toBe('request-2');
    expect(workers[1].posted[0].transfer).toHaveLength(1);
    expect(workers[1].posted[0].transfer[0]).toBe(
      (workers[1].posted[0].message as Extract<XMindWorkerRequest, { operation: 'import' }>)
        .payload.bytes,
    );
    // The client transfers a defensive copy, leaving the caller's bytes usable
    // for a safe fallback or a retry.
    expect(source!.byteLength).toBeGreaterThan(0);
  });

  it('terminates active codec work on AbortSignal and rejects concurrent work', async () => {
    const worker = new PendingWorker();
    const client = new XMindWorkerClient({
      requestIdFactory: () => 'pending-1',
      workerFactory: () => worker as unknown as Worker,
    });
    const controller = new AbortController();
    const pending = client.exportXMind(createDocument(), { signal: controller.signal });
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(client.busy).toBe(true);
    await expect(client.exportXMind(createDocument())).rejects
      .toBeInstanceOf(XMindWorkerBusyError);

    await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
    controller.abort();
    await rejected;
    expect(worker.terminated).toBe(true);
    expect(client.busy).toBe(false);
  });

  it('falls back safely with an explicit diagnostic when Worker construction fails', async () => {
    const client = new XMindWorkerClient({
      workerFactory: () => {
        throw new Error('CSP blocked worker-src');
      },
    });
    const result = await client.exportXMind(createDocument());
    expect(result.report.success).toBe(true);
    expect(result.report.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: XMIND_WORKER_FALLBACK_DIAGNOSTIC_CODE,
        message: expect.stringContaining('CSP blocked worker-src'),
      }),
    ]));
  });

  it('treats a mismatched response ID as a protocol failure instead of staying busy', async () => {
    const worker = new MismatchedRequestWorker();
    const client = new XMindWorkerClient({
      requestIdFactory: () => 'expected-request-id',
      workerFactory: () => worker as unknown as Worker,
    });
    const result = await client.exportXMind(createDocument());
    expect(result.report.success).toBe(true);
    expect(result.report.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: XMIND_WORKER_FALLBACK_DIAGNOSTIC_CODE,
        message: expect.stringContaining('mismatched request ID'),
      }),
    ]));
    expect(worker.terminated).toBe(true);
    expect(client.busy).toBe(false);
  });

  it('resolves the same archive byte limit used by the synchronous codec', () => {
    expect(resolveXMindArchiveByteLimit()).toBe(64 * 1024 * 1024);
    expect(resolveXMindArchiveByteLimit({
      zipLimits: { maxArchiveBytes: 12_345 },
    })).toBe(12_345);
    expect(resolveXMindArchiveByteLimit({
      limits: { maxInputBytes: 4_321 },
      zipLimits: { maxArchiveBytes: 12_345 },
    })).toBe(4_321);
  });

  it('preserves non-cloneable idFactory semantics by bypassing Worker explicitly', async () => {
    const workerFactory = vi.fn(() => new RuntimeBackedWorker() as unknown as Worker);
    const exported = await new XMindWorkerClient({ workerFactory }).exportXMind(createDocument());
    expect(exported.bytes).not.toBeNull();
    workerFactory.mockClear();

    let nextId = 100;
    const client = new XMindWorkerClient({ workerFactory });
    const result = await client.importXMind(exported.bytes!, {
      idFactory: () => (
        `018f7000-0000-7000-8000-${(nextId += 1).toString(16).padStart(12, '0')}`
      ),
    });
    expect(result.report.success).toBe(true);
    expect(workerFactory).not.toHaveBeenCalled();
    expect(result.report.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: XMIND_WORKER_FALLBACK_DIAGNOSTIC_CODE }),
    ]));
  });
});
