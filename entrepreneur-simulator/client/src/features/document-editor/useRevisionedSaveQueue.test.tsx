import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SOPRevisionConflictError } from '../../services/api';
import {
  normalizeDocumentRevision,
  restoreLocalDocumentDraft,
  useRevisionedSaveQueue,
  type RevisionedDocument,
  type SaveQueueFlushResult,
} from './useRevisionedSaveQueue';

type TestDocument = RevisionedDocument & { content: string };

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const dispatchBeforeUnload = () => {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event;
};

describe('useRevisionedSaveQueue', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('serializes writes, rebases the newer draft, and uses the last confirmed revision', async () => {
    const first = deferred<{ id: string; content_revision: number }>();
    const second = deferred<{ id: string; content_revision: number }>();
    const saveDocument = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    const { result } = renderHook(() => useRevisionedSaveQueue<TestDocument>({
      delay: 0,
      saveDocument,
    }));

    act(() => {
      result.current.schedule({ id: 'doc-1', content: 'first', content_revision: 1 });
    });
    const firstFlush = result.current.flush();
    await waitFor(() => expect(saveDocument).toHaveBeenCalledTimes(1));
    expect(saveDocument.mock.calls[0][0]).toMatchObject({ expected_revision: 1, content: 'first' });

    act(() => {
      result.current.schedule({ id: 'doc-1', content: 'second', content_revision: 1 });
    });
    first.resolve({ id: 'doc-1', content_revision: 2 });
    await waitFor(() => expect(saveDocument).toHaveBeenCalledTimes(2));
    expect(saveDocument.mock.calls[1][0]).toMatchObject({ expected_revision: 2, content: 'second' });
    expect(restoreLocalDocumentDraft({
      id: 'doc-1',
      content: 'server after first save',
      content_revision: 2,
    })).toMatchObject({ content: 'second', content_revision: 2 });

    second.resolve({ id: 'doc-1', content_revision: 3 });
    await expect(firstFlush).resolves.toEqual({
      ok: true,
      failedIds: [],
      conflictedIds: [],
    });
    await waitFor(() => expect(result.current.getStatus('doc-1').phase).toBe('saved'));
    expect(window.localStorage.length).toBe(0);
  });

  it('returns a failed flush result and keeps the draft after an ordinary save error', async () => {
    const saveDocument = vi.fn().mockRejectedValue(new Error('network unavailable'));
    const { result } = renderHook(() => useRevisionedSaveQueue<TestDocument>({
      delay: 0,
      saveDocument,
    }));

    act(() => {
      result.current.schedule({ id: 'doc-error', content: 'unsaved', content_revision: 3 });
    });

    let flushResult!: SaveQueueFlushResult;
    await act(async () => {
      flushResult = await result.current.flush();
    });

    expect(flushResult).toEqual({
      ok: false,
      failedIds: ['doc-error'],
      conflictedIds: [],
    });
    expect(result.current.getStatus('doc-error')).toMatchObject({
      phase: 'error',
      message: 'network unavailable',
    });
    expect(window.localStorage.length).toBe(1);
  });

  it('surfaces conflicts, reports the conflicted id, and prevents blind retries', async () => {
    const saveDocument = vi.fn().mockRejectedValue(new SOPRevisionConflictError({
      id: 'doc-1',
      expected_revision: 3,
      current_revision: 4,
      code: 'SOP_REVISION_CONFLICT',
    }));
    const { result } = renderHook(() => useRevisionedSaveQueue<TestDocument>({
      delay: 0,
      saveDocument,
    }));

    act(() => {
      result.current.schedule({ id: 'doc-1', content: 'local', content_revision: 3 });
    });
    let flushResult!: SaveQueueFlushResult;
    await act(async () => {
      flushResult = await result.current.flush();
    });

    expect(flushResult).toEqual({
      ok: false,
      failedIds: [],
      conflictedIds: ['doc-1'],
    });
    expect(result.current.getStatus('doc-1').phase).toBe('conflict');
    expect(dispatchBeforeUnload().defaultPrevented).toBe(true);
    act(() => result.current.retry('doc-1'));
    expect(saveDocument).toHaveBeenCalledTimes(1);
  });

  it('normalizes only positive safe integer revisions, including numeric strings', () => {
    expect(normalizeDocumentRevision(1)).toBe(1);
    expect(normalizeDocumentRevision(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
    expect(normalizeDocumentRevision('42')).toBe(42);
    expect(normalizeDocumentRevision(null)).toBeNull();
    expect(normalizeDocumentRevision(undefined)).toBeNull();
    expect(normalizeDocumentRevision(0)).toBeNull();
    expect(normalizeDocumentRevision('0')).toBeNull();
    expect(normalizeDocumentRevision(Number.NaN)).toBeNull();
    expect(normalizeDocumentRevision(-1)).toBeNull();
    expect(normalizeDocumentRevision(1.5)).toBeNull();
    expect(normalizeDocumentRevision(Number.MAX_SAFE_INTEGER + 1)).toBeNull();
  });

  it.each([null, 0, Number.NaN])(
    'omits expected_revision for a legacy %s revision',
    async (legacyRevision) => {
      const saveDocument = vi.fn().mockResolvedValue({ id: 'legacy', content_revision: 1 });
      const { result } = renderHook(() => useRevisionedSaveQueue<TestDocument>({
        delay: 0,
        saveDocument,
      }));

      act(() => {
        result.current.schedule({
          id: 'legacy',
          content: 'legacy document',
          content_revision: legacyRevision,
        });
      });
      await act(async () => {
        await result.current.flush();
      });

      expect(saveDocument.mock.calls[0][0]).not.toHaveProperty('expected_revision');
    },
  );

  it('restores only a draft based on the current server revision and clears it after confirmation', async () => {
    const saveDocument = vi.fn().mockResolvedValue({ id: 'doc-draft', content_revision: 8 });
    const { result } = renderHook(() => useRevisionedSaveQueue<TestDocument>({
      delay: 60_000,
      saveDocument,
    }));

    act(() => {
      result.current.schedule({
        id: 'doc-draft',
        content: 'local draft',
        content_revision: 7,
        expected_revision: 999,
      });
    });

    expect(window.localStorage.length).toBe(1);
    expect(restoreLocalDocumentDraft({
      id: 'doc-draft',
      content: 'server content',
      content_revision: 7,
      expected_revision: 7,
    })).toMatchObject({
      id: 'doc-draft',
      content: 'local draft',
      content_revision: 7,
      expected_revision: 7,
    });
    expect(restoreLocalDocumentDraft({
      id: 'doc-draft',
      content: 'newer server content',
      content_revision: 8,
    })).toMatchObject({
      content: 'newer server content',
      content_revision: 8,
    });

    await act(async () => {
      await result.current.flush();
    });
    expect(window.localStorage.length).toBe(0);
  });

  it('guards beforeunload while pending, processing, or failed and releases it after retry succeeds', async () => {
    const first = deferred<{ id: string; content_revision: number }>();
    const saveDocument = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce({ id: 'doc-dirty', content_revision: 2 });
    const { result } = renderHook(() => useRevisionedSaveQueue<TestDocument>({
      delay: 60_000,
      saveDocument,
    }));

    act(() => {
      result.current.schedule({ id: 'doc-dirty', content: 'draft', content_revision: 1 });
    });
    expect(dispatchBeforeUnload().defaultPrevented).toBe(true);

    const flushPromise = result.current.flush();
    await waitFor(() => expect(saveDocument).toHaveBeenCalledTimes(1));
    expect(dispatchBeforeUnload().defaultPrevented).toBe(true);

    first.reject(new Error('temporary failure'));
    await act(async () => {
      await flushPromise;
    });
    expect(dispatchBeforeUnload().defaultPrevented).toBe(true);

    act(() => result.current.retry('doc-dirty'));
    await waitFor(() => expect(result.current.getStatus('doc-dirty').phase).toBe('saved'));
    await expect(result.current.flush()).resolves.toMatchObject({ ok: true });
    expect(dispatchBeforeUnload().defaultPrevented).toBe(false);
  });

  it('accepts an externally confirmed recovery save without scheduling a duplicate write', () => {
    const saveDocument = vi.fn();
    const onOptimisticUpdate = vi.fn();
    const onConfirmed = vi.fn();
    const { result } = renderHook(() => useRevisionedSaveQueue<TestDocument>({
      delay: 60_000,
      saveDocument,
      onOptimisticUpdate,
      onConfirmed,
    }));

    act(() => {
      result.current.acceptExternalSave({
        id: 'doc-repaired',
        content: 'repaired',
        content_revision: 3,
      }, {
        id: 'doc-repaired',
        content_revision: 4,
        content_schema_version: 2,
      });
    });

    expect(saveDocument).not.toHaveBeenCalled();
    expect(onOptimisticUpdate).toHaveBeenCalledWith(expect.objectContaining({
      id: 'doc-repaired',
      content: 'repaired',
      content_revision: 4,
      content_schema_version: 2,
    }));
    expect(onConfirmed).toHaveBeenCalledWith('doc-repaired', expect.objectContaining({
      content_revision: 4,
    }));
    expect(result.current.getStatus('doc-repaired').phase).toBe('saved');
  });
});
