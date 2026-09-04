import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Check,
  Clipboard,
  Copy,
  Download,
  FileJson,
  FileUp,
  Image,
  LoaderCircle,
  MoreHorizontal,
  RefreshCw,
  Save,
  TriangleAlert,
  Trash2,
} from 'lucide-react';
import {
  Excalidraw,
  exportToBlob,
  loadFromBlob,
} from '@excalidraw/excalidraw';
import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
} from '@excalidraw/excalidraw/types';
import '@excalidraw/excalidraw/index.css';
import {
  WhiteboardReferencedError,
  hydrateWhiteboardAssets,
  sanitizeWhiteboardScene,
  whiteboardApi,
} from '../features/whiteboard';
import type { Whiteboard } from '../features/whiteboard';
import {
  copyWhiteboardPng,
  exportWhiteboardJson,
  exportWhiteboardPng,
  exportWhiteboardSvg,
} from '../features/whiteboard/export/whiteboardExport';
import {
  readWhiteboardDraft,
  type StoredWhiteboardDraft,
} from '../features/whiteboard/persistence/localDraftStore';
import {
  useWhiteboardAutosave,
  type WhiteboardSnapshot,
} from '../features/whiteboard/persistence/useWhiteboardAutosave';

type LoadedEditorState = {
  whiteboard: Whiteboard;
  files: BinaryFiles;
  draft: StoredWhiteboardDraft | null;
};

export default function WhiteboardEditorPage() {
  const { whiteboardId = '' } = useParams();
  const navigate = useNavigate();
  return (
    <WhiteboardWorkspace
      whiteboardId={whiteboardId}
      onClose={() => navigate('/whiteboards')}
      onOpenBoard={(id) => navigate(`/whiteboards/${id}`)}
    />
  );
}

export function WhiteboardWorkspace({
  whiteboardId,
  onClose,
  onOpenBoard,
  readOnly = false,
}: {
  whiteboardId: string;
  onClose: () => void;
  onOpenBoard?: (id: string) => void;
  readOnly?: boolean;
}) {
  const [loaded, setLoaded] = useState<LoadedEditorState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    Promise.all([
      whiteboardApi.get(whiteboardId),
      readWhiteboardDraft(whiteboardId),
    ]).then(async ([whiteboard, draft]) => {
      const files = await hydrateWhiteboardAssets(whiteboard.id, whiteboard.assets, controller.signal);
      if (!controller.signal.aborted) setLoaded({ whiteboard, files, draft });
    }).catch((cause) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '加载白板失败');
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [reloadNonce, whiteboardId]);

  if (loading) {
    return <div className="flex h-full items-center justify-center text-slate-500"><LoaderCircle className="mr-2 h-5 w-5 animate-spin" />正在加载白板…</div>;
  }
  if (error || !loaded) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <TriangleAlert className="h-10 w-10 text-amber-500" />
        <p className="text-slate-700">{error || '白板不存在'}</p>
        <button type="button" onClick={() => setReloadNonce((value) => value + 1)} className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white">重试</button>
      </div>
    );
  }

  const usableDraft = !readOnly && loaded.draft && loaded.draft.baseRevision === Number(loaded.whiteboard.content_revision)
    ? loaded.draft
    : null;
  return (
    <WhiteboardEditorSession
      key={`${loaded.whiteboard.id}:${loaded.whiteboard.content_revision}:${reloadNonce}`}
      whiteboard={loaded.whiteboard}
      files={usableDraft?.files || loaded.files}
      draft={usableDraft}
      staleDraft={Boolean(loaded.draft && !usableDraft)}
      onReload={() => setReloadNonce((value) => value + 1)}
      onClose={onClose}
      onOpenBoard={onOpenBoard}
      readOnly={readOnly}
    />
  );
}

function WhiteboardEditorSession({
  whiteboard: initialWhiteboard,
  files: initialFiles,
  draft,
  staleDraft,
  onReload,
  onClose,
  onOpenBoard,
  readOnly,
}: {
  whiteboard: Whiteboard;
  files: BinaryFiles;
  draft: StoredWhiteboardDraft | null;
  staleDraft: boolean;
  onReload: () => void;
  onClose: () => void;
  onOpenBoard?: (id: string) => void;
  readOnly: boolean;
}) {
  const importInputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(draft?.title || initialWhiteboard.title);
  const titleRef = useRef(title);
  const [excalidrawApi, setExcalidrawApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [actionError, setActionError] = useState(staleDraft ? '发现基于旧版本的本地草稿，已保留在浏览器中；当前加载服务器版本。' : '');
  const initialSnapshot = useMemo<WhiteboardSnapshot>(() => draft ? {
    title: draft.title,
    scene: sanitizeWhiteboardScene(draft.scene),
    files: draft.files,
  } : {
    title: initialWhiteboard.title,
    scene: sanitizeWhiteboardScene(initialWhiteboard.scene_json),
    files: initialFiles,
  }, [draft, initialFiles, initialWhiteboard]);

  useEffect(() => { titleRef.current = title; }, [title]);

  const generatePreview = useCallback(async (snapshot: WhiteboardSnapshot, revision: number) => {
    const activeElements = snapshot.scene.elements.filter((element: any) => !element.isDeleted);
    const blob = activeElements.length > 0
      ? await exportToBlob({
          elements: activeElements,
          appState: {
            ...snapshot.scene.appState,
            exportBackground: true,
            exportWithDarkMode: false,
          },
          files: snapshot.files,
          mimeType: 'image/png',
          maxWidthOrHeight: 1280,
          exportPadding: 24,
        })
      : await new Promise<Blob>((resolve, reject) => {
          const canvas = document.createElement('canvas');
          canvas.width = 640;
          canvas.height = 360;
          const context = canvas.getContext('2d');
          if (!context) return reject(new Error('无法生成白板缩略图'));
          context.fillStyle = String(snapshot.scene.appState.viewBackgroundColor || '#ffffff');
          context.fillRect(0, 0, canvas.width, canvas.height);
          canvas.toBlob((value) => value ? resolve(value) : reject(new Error('无法生成白板缩略图')), 'image/png');
        });
    await whiteboardApi.uploadPreview(initialWhiteboard.id, revision, blob);
  }, [initialWhiteboard.id]);

  const handleConfirmed = useCallback((_next: Whiteboard) => {
    // The queue owns the authoritative revision. The route reloads full board
    // metadata only when explicitly requested or when leaving this session.
  }, []);

  const autosave = useWhiteboardAutosave({
    whiteboard: initialWhiteboard,
    initialFiles,
    initialSnapshot,
    initialDirty: !readOnly && Boolean(draft),
    onConfirmed: handleConfirmed,
    onPreviewRequested: generatePreview,
  });

  const currentExportSnapshot = useCallback(() => {
    const snapshot = autosave.getSnapshot();
    if (!excalidrawApi) {
      return {
        title: snapshot.title,
        elements: snapshot.scene.elements,
        appState: snapshot.scene.appState as AppState,
        files: snapshot.files,
      };
    }
    return {
      title: titleRef.current,
      elements: excalidrawApi.getSceneElements(),
      appState: excalidrawApi.getAppState(),
      files: excalidrawApi.getFiles(),
    };
  }, [autosave, excalidrawApi]);

  const handleImport = async (file: File) => {
    setActionError('');
    try {
      if (!window.confirm('导入会替换当前白板内容，是否继续？')) return;
      const restored = await loadFromBlob(file, null, null);
      const snapshot: WhiteboardSnapshot = {
        title: titleRef.current,
        scene: {
          type: 'excalidraw',
          version: 2,
          source: 'nmdd',
          elements: restored.elements,
          appState: restored.appState,
        },
        files: restored.files,
      };
      excalidrawApi?.updateScene({ elements: restored.elements, appState: restored.appState });
      excalidrawApi?.addFiles(Object.values(restored.files));
      autosave.scheduleSnapshot(snapshot, true);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : '导入失败');
    } finally {
      if (importInputRef.current) importInputRef.current.value = '';
    }
  };

  const duplicateCurrent = async () => {
    setMenuOpen(false);
    if (!await autosave.flush()) return;
    try {
      const duplicate = await whiteboardApi.duplicate(initialWhiteboard.id, `${titleRef.current} 副本`);
      onOpenBoard?.(duplicate.id);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : '复制失败');
    }
  };

  const closeEditor = async () => {
    if (!readOnly && !await autosave.flush()) return;
    onClose();
  };

  const deleteCurrent = async () => {
    setMenuOpen(false);
    if (!window.confirm(`确定删除“${titleRef.current}”吗？`)) return;
    try {
      await whiteboardApi.remove(initialWhiteboard.id);
      onClose();
    } catch (cause) {
      if (cause instanceof WhiteboardReferencedError) {
        const names = cause.references.map((ref) => ref.document?.title).filter(Boolean).join('、');
        setActionError(names ? `仍被以下文档引用：${names}` : cause.message);
      } else {
        setActionError(cause instanceof Error ? cause.message : '删除失败');
      }
    }
  };

  const saveAsCopyAfterConflict = async () => {
    try {
      const snapshot = autosave.getSnapshot();
      const copy = await whiteboardApi.create({ title: `${snapshot.title} 冲突副本`, scene: snapshot.scene });
      const { uploadMissingWhiteboardAssets } = await import('../features/whiteboard/assets/assetTransport');
      await uploadMissingWhiteboardAssets(copy.id, snapshot.files, new Set());
      onOpenBoard?.(copy.id);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : '另存为新白板失败');
    }
  };

  const statusPresentation = {
    saved: { icon: <Check className="h-3.5 w-3.5" />, text: '已保存', className: 'text-emerald-600' },
    dirty: { icon: <Save className="h-3.5 w-3.5" />, text: '等待保存', className: 'text-amber-600' },
    saving: { icon: <LoaderCircle className="h-3.5 w-3.5 animate-spin" />, text: '保存中', className: 'text-indigo-600' },
    error: { icon: <TriangleAlert className="h-3.5 w-3.5" />, text: '保存失败', className: 'text-red-600' },
    conflict: { icon: <TriangleAlert className="h-3.5 w-3.5" />, text: '版本冲突', className: 'text-red-600' },
  }[autosave.status.phase];

  return (
    <section className="flex h-full min-h-0 w-full flex-col bg-white" data-testid="whiteboard-editor">
      <header className="relative z-20 flex h-14 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-2 sm:px-4">
        <button type="button" onClick={() => { void closeEditor(); }} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="关闭白板">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <input
          value={title}
          readOnly={readOnly}
          onChange={(event) => {
            setTitle(event.target.value);
            if (!readOnly && event.target.value.trim()) autosave.scheduleTitle(event.target.value);
          }}
          onBlur={() => {
            if (!title.trim()) {
              setTitle('未命名白板');
              autosave.scheduleTitle('未命名白板');
            }
          }}
          maxLength={120}
          aria-label="白板标题"
          className="min-w-0 max-w-md flex-1 rounded-md border border-transparent px-2 py-1.5 font-semibold text-slate-900 outline-none read-only:cursor-default read-only:bg-transparent hover:border-slate-200 focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
        />
        {!readOnly && <div className={`hidden items-center gap-1 text-xs sm:flex ${statusPresentation.className}`} title={autosave.status.message}>
          {statusPresentation.icon}{statusPresentation.text}
        </div>}
        {autosave.status.phase === 'error' && (
          <button type="button" onClick={autosave.retry} className="rounded-lg p-2 text-red-600 hover:bg-red-50" title="重试保存"><RefreshCw className="h-4 w-4" /></button>
        )}
        <input
          ref={importInputRef}
          type="file"
          accept=".excalidraw,application/json,application/vnd.excalidraw+json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleImport(file);
          }}
        />
        {!readOnly && <button type="button" onClick={() => importInputRef.current?.click()} className="hidden items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 sm:inline-flex">
          <FileUp className="h-4 w-4" />导入
        </button>}
        <div className="relative">
          <button type="button" onClick={() => setMenuOpen((value) => !value)} className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50" aria-label="白板菜单">
            <MoreHorizontal className="h-4 w-4" />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-11 w-52 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">
              <button type="button" onClick={() => { setMenuOpen(false); exportWhiteboardJson(currentExportSnapshot()); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-slate-50"><FileJson className="h-4 w-4" />导出 .excalidraw</button>
              <button type="button" onClick={() => { setMenuOpen(false); void exportWhiteboardPng(currentExportSnapshot()); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-slate-50"><Image className="h-4 w-4" />导出 PNG</button>
              <button type="button" onClick={() => { setMenuOpen(false); void exportWhiteboardSvg(currentExportSnapshot()); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-slate-50"><Download className="h-4 w-4" />导出 SVG</button>
              <button type="button" onClick={() => { setMenuOpen(false); void copyWhiteboardPng(currentExportSnapshot()); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-slate-50"><Clipboard className="h-4 w-4" />复制 PNG</button>
              {!readOnly && <>
                <div className="my-1 border-t border-slate-100" />
                <button type="button" onClick={() => void duplicateCurrent()} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-slate-50"><Copy className="h-4 w-4" />复制白板</button>
                <button type="button" onClick={() => void deleteCurrent()} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-50"><Trash2 className="h-4 w-4" />删除白板</button>
              </>}
            </div>
          )}
        </div>
      </header>

      {(actionError || autosave.status.message) && autosave.status.phase !== 'conflict' && (
        <div className={`relative z-10 flex shrink-0 items-center justify-between px-4 py-2 text-xs ${actionError ? 'bg-amber-50 text-amber-800' : 'bg-red-50 text-red-700'}`}>
          <span>{actionError || autosave.status.message}</span>
          {actionError && <button type="button" onClick={() => setActionError('')} className="font-semibold">关闭</button>}
        </div>
      )}

      {autosave.status.phase === 'conflict' && (
        <div className="relative z-10 flex shrink-0 flex-wrap items-center gap-2 bg-red-50 px-4 py-2 text-xs text-red-800">
          <TriangleAlert className="h-4 w-4" />
          <span className="mr-auto">{autosave.status.message}</span>
          <button type="button" onClick={() => exportWhiteboardJson(currentExportSnapshot())} className="rounded-md border border-red-200 bg-white px-2 py-1">下载本地版本</button>
          <button type="button" onClick={() => void saveAsCopyAfterConflict()} className="rounded-md border border-red-200 bg-white px-2 py-1">另存为新白板</button>
          <button type="button" onClick={onReload} className="rounded-md bg-red-600 px-2 py-1 text-white">重新加载服务器版本</button>
        </div>
      )}

      <div className="min-h-0 flex-1" onContextMenu={() => setMenuOpen(false)}>
        <Excalidraw
          initialData={{
            elements: initialSnapshot.scene.elements,
            appState: initialSnapshot.scene.appState,
            files: initialSnapshot.files,
            scrollToContent: true,
          }}
          excalidrawAPI={setExcalidrawApi}
          onChange={(elements, appState, files) => {
            if (!readOnly) autosave.scheduleScene(titleRef.current.trim() || '未命名白板', elements, appState, files);
          }}
          viewModeEnabled={readOnly}
          langCode="zh-CN"
          name={title}
          autoFocus
          handleKeyboardGlobally={false}
          validateEmbeddable={false}
          UIOptions={{
            canvasActions: {
              changeViewBackgroundColor: true,
              clearCanvas: true,
              export: false,
              loadScene: false,
              saveToActiveFile: false,
              toggleTheme: true,
            },
          }}
        />
      </div>
    </section>
  );
}
