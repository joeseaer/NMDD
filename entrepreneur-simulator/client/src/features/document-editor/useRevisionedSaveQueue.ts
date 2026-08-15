import { useCallback, useEffect, useRef, useState } from 'react';
import { SOPRevisionConflictError, type SOPSaveResult } from '../../services/api';

export const SMART_DOCUMENT_SCHEMA_VERSION = 2;

export type RevisionedDocument = {
  id: string;
  content_revision?: number | null;
  content_schema_version?: number;
  expected_revision?: number;
};

export type DocumentSavePhase = 'saved' | 'dirty' | 'saving' | 'error' | 'conflict';

export type DocumentSaveStatus = {
  phase: DocumentSavePhase;
  message?: string;
};

export type SaveQueueFlushResult = {
  ok: boolean;
  failedIds: string[];
  conflictedIds: string[];
};

type SaveQueueOptions<T extends RevisionedDocument> = {
  delay?: number;
  saveDocument: (document: T) => Promise<SOPSaveResult>;
  onOptimisticUpdate?: (document: T) => void;
  onConfirmed?: (id: string, result: SOPSaveResult) => void;
};

const LOCAL_DRAFT_VERSION = 1;
const LOCAL_DRAFT_KEY_PREFIX = 'nmdd:document-draft:v1:';

type StoredLocalDocumentDraft<T extends RevisionedDocument> = {
  version: typeof LOCAL_DRAFT_VERSION;
  documentId: string;
  baseRevision: number | null;
  savedAt: string;
  document: T;
};

export const normalizeDocumentRevision = (revision: unknown): number | null => {
  if (revision === null || revision === undefined) return null;
  const numericRevision = Number(revision);
  return Number.isSafeInteger(numericRevision) && numericRevision > 0
    ? numericRevision
    : null;
};

const getInitialRevision = (document: RevisionedDocument) => (
  normalizeDocumentRevision(document.content_revision)
);

const getLocalDraftKey = (id: string) => `${LOCAL_DRAFT_KEY_PREFIX}${encodeURIComponent(id)}`;

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const persistLocalDocumentDraft = <T extends RevisionedDocument>(
  document: T,
  baseRevision: number | null,
) => {
  if (typeof window === 'undefined' || !document.id) return;

  const draft: StoredLocalDocumentDraft<T> = {
    version: LOCAL_DRAFT_VERSION,
    documentId: document.id,
    baseRevision: normalizeDocumentRevision(baseRevision),
    savedAt: new Date().toISOString(),
    document,
  };

  try {
    window.localStorage.setItem(getLocalDraftKey(document.id), JSON.stringify(draft));
  } catch {
    // Storage can be unavailable or full. The in-memory queue still remains active.
  }
};

const clearLocalDocumentDraft = (id: string) => {
  if (typeof window === 'undefined' || !id) return;
  try {
    window.localStorage.removeItem(getLocalDraftKey(id));
  } catch {
    // Storage access is best effort and must never break a confirmed save.
  }
};

/**
 * Restores a locally persisted, unconfirmed draft only when it was based on
 * the exact revision that is still current on the server. Server-owned CAS
 * fields are retained even when the draft contains stale copies of them.
 */
export const restoreLocalDocumentDraft = <T extends RevisionedDocument>(document: T): T => {
  if (typeof window === 'undefined' || !document.id) return document;

  let parsed: unknown;
  try {
    const raw = window.localStorage.getItem(getLocalDraftKey(document.id));
    if (!raw) return document;
    parsed = JSON.parse(raw);
  } catch {
    clearLocalDocumentDraft(document.id);
    return document;
  }

  if (
    !isRecord(parsed)
    || parsed.version !== LOCAL_DRAFT_VERSION
    || parsed.documentId !== document.id
    || !isRecord(parsed.document)
    || parsed.document.id !== document.id
  ) {
    clearLocalDocumentDraft(document.id);
    return document;
  }

  const serverRevision = normalizeDocumentRevision(document.content_revision);
  const draftRevision = normalizeDocumentRevision(parsed.baseRevision);
  if (serverRevision !== draftRevision) return document;

  const {
    id: _draftId,
    content_revision: _draftRevision,
    expected_revision: _draftExpectedRevision,
    ...draftFields
  } = parsed.document;

  return {
    ...document,
    ...draftFields,
    id: document.id,
    content_revision: document.content_revision,
    expected_revision: document.expected_revision,
  } as T;
};

/**
 * Serializes autosaves and uses the last server-confirmed revision as the CAS
 * expectation. A newer local edit is never discarded when an older request
 * finishes, and failed/conflicting writes remain visible until explicitly
 * retried or reloaded.
 */
export const useRevisionedSaveQueue = <T extends RevisionedDocument>({
  delay = 800,
  saveDocument,
  onOptimisticUpdate,
  onConfirmed,
}: SaveQueueOptions<T>) => {
  const pendingRef = useRef(new Map<string, T>());
  const failedRef = useRef(new Map<string, T>());
  const confirmedRevisionRef = useRef(new Map<string, number | null>());
  const blockedRef = useRef(new Set<string>());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const processingRef = useRef<Promise<void> | null>(null);
  const mountedRef = useRef(true);
  const [statuses, setStatuses] = useState<Record<string, DocumentSaveStatus>>({});

  const setStatus = useCallback((id: string, status: DocumentSaveStatus) => {
    if (!mountedRef.current) return;
    setStatuses((current) => ({ ...current, [id]: status }));
  }, []);

  const runQueue = useCallback((): Promise<void> => {
    if (processingRef.current) return processingRef.current;

    const processing = (async () => {
      while (pendingRef.current.size > 0) {
        const entry = pendingRef.current.entries().next().value as [string, T] | undefined;
        if (!entry) break;
        const [id, document] = entry;
        pendingRef.current.delete(id);

        if (blockedRef.current.has(id)) {
          failedRef.current.set(id, document);
          continue;
        }

        if (!confirmedRevisionRef.current.has(id)) {
          confirmedRevisionRef.current.set(id, getInitialRevision(document));
        }
        const expectedRevision = confirmedRevisionRef.current.get(id);
        const payload = {
          ...document,
          content_schema_version: Math.max(
            SMART_DOCUMENT_SCHEMA_VERSION,
            Number(document.content_schema_version || SMART_DOCUMENT_SCHEMA_VERSION),
          ),
          ...(expectedRevision !== null ? { expected_revision: expectedRevision } : {}),
        } as T;

        setStatus(id, { phase: 'saving' });
        try {
          const result = await saveDocument(payload);
          const nextRevision = normalizeDocumentRevision(result.content_revision);
          confirmedRevisionRef.current.set(id, nextRevision);
          failedRef.current.delete(id);
          const newerPendingDocument = pendingRef.current.get(id);
          if (newerPendingDocument) {
            persistLocalDocumentDraft(newerPendingDocument, nextRevision);
          } else {
            clearLocalDocumentDraft(id);
          }
          try {
            onConfirmed?.(id, result);
          } catch (callbackError) {
            console.error('Document save confirmation callback failed.', callbackError);
          }
          setStatus(id, pendingRef.current.has(id) ? { phase: 'dirty' } : { phase: 'saved' });
        } catch (error) {
          failedRef.current.set(id, pendingRef.current.get(id) || document);
          if (error instanceof SOPRevisionConflictError) {
            blockedRef.current.add(id);
            setStatus(id, {
              phase: 'conflict',
              message: '文档已在其他窗口更新。请重新载入后再继续编辑。',
            });
          } else {
            setStatus(id, {
              phase: 'error',
              message: error instanceof Error ? error.message : '保存失败，请重试。',
            });
          }
        }
      }
    })();

    processingRef.current = processing.finally(() => {
      processingRef.current = null;
    });
    return processingRef.current;
  }, [onConfirmed, saveDocument, setStatus]);

  const schedule = useCallback((document: T) => {
    if (!confirmedRevisionRef.current.has(document.id)) {
      confirmedRevisionRef.current.set(document.id, getInitialRevision(document));
    }
    persistLocalDocumentDraft(
      document,
      confirmedRevisionRef.current.get(document.id) ?? null,
    );
    onOptimisticUpdate?.(document);

    if (blockedRef.current.has(document.id)) {
      failedRef.current.set(document.id, document);
      setStatus(document.id, {
        phase: 'conflict',
        message: '文档已在其他窗口更新。请重新载入后再继续编辑。',
      });
      return;
    }

    pendingRef.current.set(document.id, document);
    setStatus(document.id, { phase: 'dirty' });
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void runQueue();
    }, delay);
  }, [delay, onOptimisticUpdate, runQueue, setStatus]);

  const flush = useCallback(async (): Promise<SaveQueueFlushResult> => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    await runQueue();
    while (processingRef.current || pendingRef.current.size > 0) {
      if (processingRef.current) await processingRef.current;
      else await runQueue();
    }

    const conflictedIds = [...blockedRef.current].sort();
    const failedIds = [...failedRef.current.keys()]
      .filter((id) => !blockedRef.current.has(id))
      .sort();
    return {
      ok: failedIds.length === 0 && conflictedIds.length === 0,
      failedIds,
      conflictedIds,
    };
  }, [runQueue]);

  const retry = useCallback((id: string) => {
    const failed = failedRef.current.get(id);
    if (!failed || blockedRef.current.has(id)) return;
    failedRef.current.delete(id);
    pendingRef.current.set(id, failed);
    setStatus(id, { phase: 'dirty' });
    void runQueue();
  }, [runQueue, setStatus]);

  const resetRevision = useCallback((document: T) => {
    blockedRef.current.delete(document.id);
    failedRef.current.delete(document.id);
    pendingRef.current.delete(document.id);
    confirmedRevisionRef.current.set(document.id, getInitialRevision(document));
    setStatus(document.id, { phase: 'saved' });
  }, [setStatus]);

  const acceptExternalSave = useCallback((document: T, result: SOPSaveResult) => {
    const nextRevision = normalizeDocumentRevision(result.content_revision);
    const confirmedDocument = {
      ...document,
      content_revision: nextRevision ?? document.content_revision,
      content_schema_version: Number(
        result.content_schema_version
        || document.content_schema_version
        || SMART_DOCUMENT_SCHEMA_VERSION,
      ),
    } as T;
    pendingRef.current.delete(document.id);
    failedRef.current.delete(document.id);
    blockedRef.current.delete(document.id);
    confirmedRevisionRef.current.set(document.id, nextRevision);
    clearLocalDocumentDraft(document.id);
    onOptimisticUpdate?.(confirmedDocument);
    onConfirmed?.(document.id, result);
    setStatus(document.id, { phase: 'saved' });
    return confirmedDocument;
  }, [onConfirmed, onOptimisticUpdate, setStatus]);

  const getStatus = useCallback((id: string | null | undefined): DocumentSaveStatus => {
    if (!id) return { phase: 'saved' };
    return statuses[id] || { phase: 'saved' };
  }, [statuses]);

  useEffect(() => {
    mountedRef.current = true;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      const hasUnsavedWork = (
        pendingRef.current.size > 0
        || processingRef.current !== null
        || failedRef.current.size > 0
        || blockedRef.current.size > 0
      );
      if (!hasUnsavedWork) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

  return {
    schedule,
    flush,
    retry,
    resetRevision,
    acceptExternalSave,
    getStatus,
  };
};
