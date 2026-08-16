import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppState, BinaryFiles } from '@excalidraw/excalidraw/types';
import { useDocumentNavigationGuard } from '../../document-editor/navigation/DocumentNavigationGuard';
import { whiteboardApi, WhiteboardRevisionConflictError } from '../api/whiteboardApi';
import { uploadMissingWhiteboardAssets } from '../assets/assetTransport';
import type { Whiteboard, WhiteboardSaveStatus, WhiteboardScene } from '../model';
import { clearWhiteboardDraft, writeWhiteboardDraft } from './localDraftStore';

export type WhiteboardSnapshot = {
  title: string;
  scene: WhiteboardScene;
  files: BinaryFiles;
};
type UseWhiteboardAutosaveOptions = {
  whiteboard: Whiteboard;
  initialFiles: BinaryFiles;
  initialSnapshot?: WhiteboardSnapshot;
  initialDirty?: boolean;
  delay?: number;
  onConfirmed: (whiteboard: Whiteboard) => void;
  onPreviewRequested?: (snapshot: WhiteboardSnapshot, revision: number) => Promise<void>;
};

const toScene = (elements: readonly any[], appState: AppState | Record<string, any>): WhiteboardScene => ({
  type: 'excalidraw',
  version: 2,
  source: 'nmdd',
  elements: elements.filter((element) => !element.isDeleted),
  appState: { ...appState },
});

const snapshotSignature = (snapshot: WhiteboardSnapshot) => JSON.stringify({
  title: snapshot.title,
  elements: snapshot.scene.elements.map((element: any) => [
    element.id,
    element.version,
    element.versionNonce,
    element.isDeleted,
  ]),
  appState: {
    viewBackgroundColor: snapshot.scene.appState.viewBackgroundColor,
    theme: snapshot.scene.appState.theme,
    gridSize: snapshot.scene.appState.gridSize,
    gridStep: snapshot.scene.appState.gridStep,
    gridModeEnabled: snapshot.scene.appState.gridModeEnabled,
    scrollX: snapshot.scene.appState.scrollX,
    scrollY: snapshot.scene.appState.scrollY,
    zoom: snapshot.scene.appState.zoom,
  },
  files: Object.values(snapshot.files).map((file) => [file.id, file.version, file.created]),
});

export const useWhiteboardAutosave = ({
  whiteboard,
  initialFiles,
  initialSnapshot,
  initialDirty = false,
  delay = 900,
  onConfirmed,
  onPreviewRequested,
}: UseWhiteboardAutosaveOptions) => {
  const baseSnapshot = initialSnapshot || {
    title: whiteboard.title,
    scene: whiteboard.scene_json,
    files: initialFiles,
  };
  const latestRef = useRef<WhiteboardSnapshot>(baseSnapshot);
  const revisionRef = useRef(Number(whiteboard.content_revision));
  const knownFileIdsRef = useRef(new Set((whiteboard.assets || []).map((asset) => asset.file_id)));
  const dirtyGenerationRef = useRef(initialDirty ? 1 : 0);
  const savedGenerationRef = useRef(0);
  const processingRef = useRef<Promise<boolean> | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSignatureRef = useRef(snapshotSignature(initialDirty ? {
    title: whiteboard.title,
    scene: whiteboard.scene_json,
    files: initialFiles,
  } : baseSnapshot));
  const blockedRef = useRef(false);
  const mountedRef = useRef(true);
  const [status, setStatus] = useState<WhiteboardSaveStatus>(
    initialDirty ? { phase: 'dirty', message: '已恢复未确认的本地草稿' } : { phase: 'saved' },
  );

  const updateStatus = useCallback((next: WhiteboardSaveStatus) => {
    if (mountedRef.current) setStatus(next);
  }, []);

  const processQueue = useCallback((): Promise<boolean> => {
    if (processingRef.current) return processingRef.current;
    const processing = (async () => {
      if (blockedRef.current) return false;
      while (savedGenerationRef.current < dirtyGenerationRef.current) {
        const generation = dirtyGenerationRef.current;
        const snapshot = latestRef.current;
        updateStatus({ phase: 'saving' });
        try {
          knownFileIdsRef.current = await uploadMissingWhiteboardAssets(
            whiteboard.id,
            snapshot.files,
            knownFileIdsRef.current,
          );
          const result = await whiteboardApi.update(whiteboard.id, {
            title: snapshot.title,
            scene: snapshot.scene,
            expected_revision: revisionRef.current,
          });
          revisionRef.current = Number(result.content_revision);
          savedGenerationRef.current = generation;
          onConfirmed({
            ...whiteboard,
            ...result,
            title: snapshot.title,
            scene_json: snapshot.scene,
            assets: Array.from(knownFileIdsRef.current).map((fileId) => (
              whiteboard.assets.find((asset) => asset.file_id === fileId) || {
                file_id: fileId,
                mime_type: String(snapshot.files[fileId]?.mimeType || 'application/octet-stream'),
                byte_size: 0,
                sha256: '',
                file_metadata: { created: snapshot.files[fileId]?.created },
              }
            )),
          });

          if (savedGenerationRef.current === dirtyGenerationRef.current) {
            await clearWhiteboardDraft(whiteboard.id);
            updateStatus({ phase: 'saved' });
            if (onPreviewRequested) {
              void onPreviewRequested(snapshot, revisionRef.current).catch(() => undefined);
            }
          } else {
            await writeWhiteboardDraft({
              version: 1,
              whiteboardId: whiteboard.id,
              baseRevision: revisionRef.current,
              title: latestRef.current.title,
              scene: latestRef.current.scene,
              files: latestRef.current.files,
              savedAt: new Date().toISOString(),
            });
          }
        } catch (error) {
          if (error instanceof WhiteboardRevisionConflictError) {
            blockedRef.current = true;
            updateStatus({ phase: 'conflict', message: error.message });
          } else {
            updateStatus({ phase: 'error', message: error instanceof Error ? error.message : '保存失败' });
          }
          return false;
        }
      }
      return true;
    })().finally(() => {
      processingRef.current = null;
    });
    processingRef.current = processing;
    return processing;
  }, [onConfirmed, onPreviewRequested, updateStatus, whiteboard]);

  const scheduleTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void processQueue();
    }, delay);
  }, [delay, processQueue]);

  const scheduleSnapshot = useCallback((snapshot: WhiteboardSnapshot, force = false) => {
    latestRef.current = snapshot;
    const signature = snapshotSignature(snapshot);
    if (!force && signature === lastSignatureRef.current) return;
    lastSignatureRef.current = signature;
    dirtyGenerationRef.current += 1;
    blockedRef.current = false;
    updateStatus({ phase: 'dirty' });
    void writeWhiteboardDraft({
      version: 1,
      whiteboardId: whiteboard.id,
      baseRevision: revisionRef.current,
      title: snapshot.title,
      scene: snapshot.scene,
      files: snapshot.files,
      savedAt: new Date().toISOString(),
    });
    scheduleTimer();
  }, [scheduleTimer, updateStatus, whiteboard.id]);

  const scheduleScene = useCallback((
    title: string,
    elements: readonly any[],
    appState: AppState,
    files: BinaryFiles,
  ) => {
    scheduleSnapshot({ title, scene: toScene(elements, appState), files });
  }, [scheduleSnapshot]);

  const scheduleTitle = useCallback((title: string) => {
    scheduleSnapshot({ ...latestRef.current, title });
  }, [scheduleSnapshot]);

  const flush = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (savedGenerationRef.current >= dirtyGenerationRef.current) return true;
    return processQueue();
  }, [processQueue]);

  const retry = useCallback(() => {
    blockedRef.current = false;
    updateStatus({ phase: 'dirty' });
    scheduleTimer();
  }, [scheduleTimer, updateStatus]);

  const acceptReload = useCallback(async (next: Whiteboard, files: BinaryFiles) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    revisionRef.current = Number(next.content_revision);
    knownFileIdsRef.current = new Set((next.assets || []).map((asset) => asset.file_id));
    latestRef.current = { title: next.title, scene: next.scene_json, files };
    lastSignatureRef.current = snapshotSignature(latestRef.current);
    dirtyGenerationRef.current = 0;
    savedGenerationRef.current = 0;
    blockedRef.current = false;
    await clearWhiteboardDraft(next.id);
    updateStatus({ phase: 'saved' });
  }, [updateStatus]);

  useDocumentNavigationGuard(flush, true);

  useEffect(() => {
    mountedRef.current = true;
    if (initialDirty) scheduleTimer();
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (savedGenerationRef.current >= dirtyGenerationRef.current && !processingRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [initialDirty, scheduleTimer]);

  return {
    status,
    scheduleScene,
    scheduleTitle,
    scheduleSnapshot,
    flush,
    retry,
    acceptReload,
    getSnapshot: () => latestRef.current,
    getRevision: () => revisionRef.current,
  };
};
