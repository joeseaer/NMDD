import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Copy,
  FileUp,
  LoaderCircle,
  MoreHorizontal,
  Palette,
  Pencil,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import type { BinaryFiles } from '@excalidraw/excalidraw/types';
import {
  WhiteboardReferencedError,
  whiteboardApi,
  whiteboardPreviewUrl,
} from '../features/whiteboard';
import type { WhiteboardScene, WhiteboardSummary } from '../features/whiteboard';
import { uploadMissingWhiteboardAssets } from '../features/whiteboard/assets/assetTransport';

const formatUpdatedAt = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
};

export default function Whiteboards() {
  const navigate = useNavigate();
  const importInputRef = useRef<HTMLInputElement>(null);
  const [boards, setBoards] = useState<WhiteboardSummary[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const loadBoards = async () => {
    setLoading(true);
    setError('');
    try {
      setBoards(await whiteboardApi.list());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '加载白板失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadBoards(); }, []);

  const visibleBoards = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return boards;
    return boards.filter((board) => board.title.toLocaleLowerCase().includes(normalized));
  }, [boards, query]);

  const createBoard = async () => {
    if (working) return;
    setWorking(true);
    setError('');
    try {
      const created = await whiteboardApi.create({ title: '未命名白板' });
      navigate(`/whiteboards/${created.id}`);
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
      if (file.size > 25 * 1024 * 1024) throw new Error('导入文件不能超过 25MB');
      const { loadFromBlob } = await import('@excalidraw/excalidraw');
      const restored = await loadFromBlob(file, null, null);
      const title = file.name.replace(/\.excalidraw$/i, '').trim() || '导入的白板';
      const scene: WhiteboardScene = {
        type: 'excalidraw',
        version: 2,
        source: 'nmdd',
        elements: restored.elements,
        appState: restored.appState,
      };
      const created = await whiteboardApi.create({ title, scene });
      await uploadMissingWhiteboardAssets(created.id, restored.files as BinaryFiles, new Set());
      navigate(`/whiteboards/${created.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '导入白板失败');
    } finally {
      setWorking(false);
      if (importInputRef.current) importInputRef.current.value = '';
    }
  };

  const duplicateBoard = async (board: WhiteboardSummary) => {
    setOpenMenuId(null);
    setWorking(true);
    try {
      const copy = await whiteboardApi.duplicate(board.id, `${board.title} 副本`);
      navigate(`/whiteboards/${copy.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '复制白板失败');
    } finally {
      setWorking(false);
    }
  };

  const renameBoard = async (board: WhiteboardSummary) => {
    setOpenMenuId(null);
    const title = window.prompt('重命名白板', board.title)?.trim();
    if (!title || title === board.title) return;
    setWorking(true);
    setError('');
    try {
      const updated = await whiteboardApi.update(board.id, {
        title,
        expected_revision: board.content_revision,
      });
      setBoards((current) => current.map((item) => (
        item.id === board.id ? { ...item, ...updated } : item
      )));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '重命名白板失败');
    } finally {
      setWorking(false);
    }
  };

  const deleteBoard = async (board: WhiteboardSummary) => {
    setOpenMenuId(null);
    if (!window.confirm(`确定删除“${board.title}”吗？`)) return;
    setWorking(true);
    try {
      await whiteboardApi.remove(board.id);
      setBoards((current) => current.filter((item) => item.id !== board.id));
    } catch (cause) {
      if (cause instanceof WhiteboardReferencedError) {
        const names = cause.references.map((ref) => ref.document?.title).filter(Boolean).join('、');
        setError(names ? `该白板仍被以下文档引用：${names}` : cause.message);
      } else {
        setError(cause instanceof Error ? cause.message : '删除白板失败');
      }
    } finally {
      setWorking(false);
    }
  };

  return (
    <section className="mx-auto flex h-full w-full max-w-7xl flex-col gap-6" data-testid="whiteboard-library">
      <header className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-indigo-600">
            <Palette className="h-5 w-5" />
            <span className="text-sm font-semibold">视觉工作区</span>
          </div>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">白板</h1>
          <p className="mt-1 text-sm text-slate-500">绘制流程、架构、草图，并将白板嵌入文档。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={importInputRef}
            type="file"
            accept=".excalidraw,application/json,application/vnd.excalidraw+json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importBoard(file);
            }}
          />
          <button
            type="button"
            onClick={() => importInputRef.current?.click()}
            disabled={working}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <FileUp className="h-4 w-4" />导入
          </button>
          <button
            type="button"
            onClick={() => void createBoard()}
            disabled={working}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
          >
            {working ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            新建白板
          </button>
        </div>
      </header>

      <div className="relative max-w-lg">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索白板"
          className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
        />
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex flex-1 items-center justify-center text-slate-500">
          <LoaderCircle className="mr-2 h-5 w-5 animate-spin" />正在加载白板…
        </div>
      ) : visibleBoards.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white/70 p-12 text-center">
          <Palette className="h-12 w-12 text-slate-300" />
          <h2 className="mt-4 text-lg font-semibold text-slate-800">{query ? '没有匹配的白板' : '还没有白板'}</h2>
          {!query && <p className="mt-1 text-sm text-slate-500">新建空白画布，或导入已有的 .excalidraw 文件。</p>}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 pb-8 sm:grid-cols-2 xl:grid-cols-3">
          {visibleBoards.map((board) => (
            <article key={board.id} className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
              <button
                type="button"
                onClick={() => navigate(`/whiteboards/${board.id}`)}
                className="block w-full text-left"
              >
                <div className="flex aspect-[16/9] items-center justify-center overflow-hidden border-b border-slate-100 bg-slate-50">
                  {board.preview_revision ? (
                    <img
                      src={whiteboardPreviewUrl(board.id, board.preview_revision)}
                      alt={`${board.title} 缩略图`}
                      className="h-full w-full object-contain"
                      loading="lazy"
                    />
                  ) : (
                    <Palette className="h-10 w-10 text-slate-300" />
                  )}
                </div>
                <div className="p-4 pr-12">
                  <h2 className="truncate font-semibold text-slate-900">{board.title}</h2>
                  <p className="mt-1 text-xs text-slate-500">更新于 {formatUpdatedAt(board.updated_at)}</p>
                </div>
              </button>
              <button
                type="button"
                aria-label="白板操作"
                onClick={() => setOpenMenuId((current) => current === board.id ? null : board.id)}
                className="absolute bottom-3 right-3 rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
              {openMenuId === board.id && (
                <div className="absolute bottom-12 right-3 z-10 w-36 rounded-xl border border-slate-200 bg-white p-1 shadow-xl">
                  <button type="button" onClick={() => void renameBoard(board)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
                    <Pencil className="h-4 w-4" />重命名
                  </button>
                  <button type="button" onClick={() => void duplicateBoard(board)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
                    <Copy className="h-4 w-4" />复制
                  </button>
                  <button type="button" onClick={() => void deleteBoard(board)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-50">
                    <Trash2 className="h-4 w-4" />删除
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
