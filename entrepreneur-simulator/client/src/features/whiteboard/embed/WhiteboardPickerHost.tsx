import { useEffect, useMemo, useRef, useState } from 'react';
import { FileUp, LoaderCircle, Palette, Plus, Search, X } from 'lucide-react';
import type { BinaryFiles } from '@excalidraw/excalidraw/types';
import { whiteboardApi } from '../api/whiteboardApi';
import { uploadMissingWhiteboardAssets } from '../assets/assetTransport';
import type { WhiteboardScene, WhiteboardSummary } from '../model';

const PICKER_EVENT = 'nmdd:whiteboard-picker';

type PickerRequest = {
  resolve: (whiteboard: WhiteboardSummary | null) => void;
};
export const requestWhiteboardSelection = (): Promise<WhiteboardSummary | null> => (
  new Promise((resolve) => {
    window.dispatchEvent(new CustomEvent<PickerRequest>(PICKER_EVENT, { detail: { resolve } }));
  })
);

export const WhiteboardPickerHost = () => {
  const importRef = useRef<HTMLInputElement>(null);
  const resolverRef = useRef<PickerRequest['resolve'] | null>(null);
  const [open, setOpen] = useState(false);
  const [boards, setBoards] = useState<WhiteboardSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const listener = (event: Event) => {
      const request = (event as CustomEvent<PickerRequest>).detail;
      if (!request?.resolve) return;
      resolverRef.current?.(null);
      resolverRef.current = request.resolve;
      setOpen(true);
      setLoading(true);
      setError('');
      void whiteboardApi.list()
        .then(setBoards)
        .catch((cause) => setError(cause instanceof Error ? cause.message : '加载白板失败'))
        .finally(() => setLoading(false));
    };
    window.addEventListener(PICKER_EVENT, listener);
    return () => window.removeEventListener(PICKER_EVENT, listener);
  }, []);

  const finish = (result: WhiteboardSummary | null) => {
    resolverRef.current?.(result);
    resolverRef.current = null;
    setOpen(false);
    setQuery('');
    setError('');
  };

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') finish(null);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return normalized ? boards.filter((board) => board.title.toLocaleLowerCase().includes(normalized)) : boards;
  }, [boards, query]);

  const createBoard = async () => {
    setWorking(true);
    setError('');
    try {
      finish(await whiteboardApi.create({ title: '未命名白板' }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '创建白板失败');
    } finally {
      setWorking(false);
    }
  };

  const importBoard = async (file: File) => {
    setWorking(true);
    setError('');
    try {
      const { loadFromBlob } = await import('@excalidraw/excalidraw');
      const restored = await loadFromBlob(file, null, null);
      const scene: WhiteboardScene = {
        type: 'excalidraw',
        version: 2,
        source: 'nmdd',
        elements: restored.elements,
        appState: restored.appState,
      };
      const created = await whiteboardApi.create({
        title: file.name.replace(/\.excalidraw$/i, '') || '导入的白板',
        scene,
      });
      await uploadMissingWhiteboardAssets(created.id, restored.files as BinaryFiles, new Set());
      finish(created);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '导入白板失败');
    } finally {
      setWorking(false);
      if (importRef.current) importRef.current.value = '';
    }
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-950/55 p-4" role="dialog" aria-modal="true" aria-label="选择白板">
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <header className="flex items-center gap-3 border-b border-slate-200 px-5 py-4">
          <div className="rounded-lg bg-indigo-50 p-2 text-indigo-600"><Palette className="h-5 w-5" /></div>
          <div className="mr-auto">
            <h2 className="font-semibold text-slate-900">插入白板</h2>
            <p className="text-xs text-slate-500">选择已有白板，或创建新的白板。</p>
          </div>
          <button type="button" onClick={() => finish(null)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100" aria-label="关闭"><X className="h-5 w-5" /></button>
        </header>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-4">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索白板" className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-indigo-400" />
          </div>
          <input ref={importRef} type="file" accept=".excalidraw,application/json" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importBoard(file); }} />
          <button type="button" disabled={working} onClick={() => importRef.current?.click()} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"><FileUp className="h-4 w-4" />导入</button>
          <button type="button" disabled={working} onClick={() => void createBoard()} className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"><Plus className="h-4 w-4" />新建</button>
        </div>
        {error && <div className="mx-4 mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <div className="min-h-[240px] overflow-y-auto p-4">
          {loading ? (
            <div className="flex h-48 items-center justify-center text-sm text-slate-500"><LoaderCircle className="mr-2 h-4 w-4 animate-spin" />正在加载…</div>
          ) : visible.length === 0 ? (
            <div className="flex h-48 items-center justify-center text-sm text-slate-500">没有可选白板</div>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {visible.map((board) => (
                <button key={board.id} type="button" onClick={() => finish(board)} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 text-left hover:border-indigo-300 hover:bg-indigo-50/50">
                  <div className="rounded-lg bg-slate-100 p-2 text-slate-500"><Palette className="h-5 w-5" /></div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-900">{board.title}</div>
                    <div className="mt-0.5 text-xs text-slate-500">版本 {board.content_revision}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
