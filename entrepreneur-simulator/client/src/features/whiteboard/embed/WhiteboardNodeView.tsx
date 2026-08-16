import { lazy, Suspense, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { NodeViewWrapper } from '@tiptap/react';
import {
  Copy,
  ExternalLink,
  LoaderCircle,
  Maximize2,
  Minus,
  Palette,
  Plus,
  RefreshCw,
  Replace,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { whiteboardApi, whiteboardPreviewUrl } from '../api/whiteboardApi';
import type { WhiteboardSummary } from '../model';
import { requestWhiteboardSelection } from './WhiteboardPickerHost';

const LazyWhiteboardWorkspace = lazy(async () => {
  const module = await import('../../../pages/WhiteboardEditorPage');
  return { default: module.WhiteboardWorkspace };
});

export const WhiteboardNodeView = ({ node, updateAttributes, deleteNode, editor, selected }: any) => {
  const initialId = String(node.attrs.whiteboardId || '');
  const [whiteboardId, setWhiteboardId] = useState(initialId);
  const [metadata, setMetadata] = useState<WhiteboardSummary | null>(null);
  const [loading, setLoading] = useState(Boolean(initialId));
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const editable = Boolean(editor?.isEditable);
  const height = Math.max(240, Math.min(900, Number(node.attrs.height) || 420));

  const loadMetadata = async (id = whiteboardId) => {
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      const nextMetadata = await whiteboardApi.getMetadata(id);
      setMetadata(nextMetadata);
      if (editable && (
        nextMetadata.title !== node.attrs.title
        || nextMetadata.preview_revision !== node.attrs.previewRevision
      )) {
        updateAttributes({
          title: nextMetadata.title,
          previewRevision: nextMetadata.preview_revision || null,
        });
      }
    } catch (cause) {
      setMetadata(null);
      setError(cause instanceof Error ? cause.message : '白板不可用');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setWhiteboardId(initialId);
    void loadMetadata(initialId);
  }, [initialId]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [open]);

  const chooseReplacement = async () => {
    const replacement = await requestWhiteboardSelection();
    if (!replacement) return;
    setWhiteboardId(replacement.id);
    setMetadata(replacement);
    updateAttributes({
      whiteboardId: replacement.id,
      title: replacement.title,
      previewRevision: replacement.preview_revision || null,
    });
  };

  const duplicateAsIndependent = async () => {
    if (!whiteboardId) return;
    try {
      const duplicate = await whiteboardApi.duplicate(
        whiteboardId,
        `${metadata?.title || node.attrs.title || '白板'} 副本`,
      );
      setWhiteboardId(duplicate.id);
      setMetadata(duplicate);
      updateAttributes({
        whiteboardId: duplicate.id,
        title: duplicate.title,
        previewRevision: duplicate.preview_revision || null,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '复制白板失败');
    }
  };

  const closeWorkspace = () => {
    setOpen(false);
    void loadMetadata();
  };

  const overlay = open && typeof document !== 'undefined' ? createPortal(
    <div className="fixed inset-0 z-[11000] bg-white" role="dialog" aria-modal="true" aria-label="编辑白板">
      <Suspense fallback={<div className="flex h-full items-center justify-center text-slate-500"><LoaderCircle className="mr-2 h-5 w-5 animate-spin" />正在加载白板编辑器…</div>}>
        <LazyWhiteboardWorkspace
          whiteboardId={whiteboardId}
          onClose={closeWorkspace}
          readOnly={!editable}
          onOpenBoard={(id) => {
            setWhiteboardId(id);
            updateAttributes({ whiteboardId: id });
          }}
        />
      </Suspense>
    </div>,
    document.body,
  ) : null;

  return (
    <NodeViewWrapper
      className={`my-5 overflow-hidden rounded-xl border bg-white transition ${selected ? 'border-indigo-400 ring-2 ring-indigo-100' : 'border-slate-200'}`}
      contentEditable={false}
      data-type="whiteboard-embed"
      data-whiteboard-id={whiteboardId}
      data-block-id={node.attrs.blockId || undefined}
    >
      <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
        <Palette className="h-4 w-4 text-indigo-600" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">
          {metadata?.title || node.attrs.title || '白板'}
        </span>
        {metadata && <span className="hidden text-[11px] text-slate-400 sm:inline">版本 {metadata.content_revision}</span>}
        <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-indigo-600 hover:bg-indigo-50">
          <Maximize2 className="h-3.5 w-3.5" />打开
        </button>
      </div>

      <button
        type="button"
        onDoubleClick={() => setOpen(true)}
        onClick={() => undefined}
        className="relative flex w-full items-center justify-center overflow-hidden bg-slate-50 text-left"
        style={{ height }}
        aria-label="打开白板编辑器"
      >
        {loading ? (
          <span className="inline-flex items-center text-sm text-slate-500"><LoaderCircle className="mr-2 h-4 w-4 animate-spin" />正在加载预览…</span>
        ) : error ? (
          <span className="flex flex-col items-center gap-2 px-6 text-center text-sm text-amber-700">
            <TriangleAlert className="h-6 w-6" />{error}
          </span>
        ) : metadata?.preview_revision ? (
          <img
            src={whiteboardPreviewUrl(whiteboardId, metadata.preview_revision)}
            alt={`${metadata.title} 缩略图`}
            className="h-full w-full object-contain"
            loading="lazy"
          />
        ) : (
          <span className="flex flex-col items-center gap-2 text-sm text-slate-400"><Palette className="h-9 w-9" />双击打开白板</span>
        )}
      </button>

      {editable && selected && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-200 bg-white px-3 py-2">
          <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"><ExternalLink className="h-3.5 w-3.5" />编辑</button>
          <button type="button" onClick={() => void chooseReplacement()} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"><Replace className="h-3.5 w-3.5" />更换</button>
          <button type="button" onClick={() => void duplicateAsIndependent()} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"><Copy className="h-3.5 w-3.5" />复制为独立白板</button>
          <span className="mx-1 h-4 w-px bg-slate-200" />
          <button type="button" onClick={() => updateAttributes({ height: Math.max(240, height - 80) })} className="rounded-md p-1 text-slate-500 hover:bg-slate-100" aria-label="减小预览高度"><Minus className="h-3.5 w-3.5" /></button>
          <span className="text-[11px] text-slate-500">{height}px</span>
          <button type="button" onClick={() => updateAttributes({ height: Math.min(900, height + 80) })} className="rounded-md p-1 text-slate-500 hover:bg-slate-100" aria-label="增加预览高度"><Plus className="h-3.5 w-3.5" /></button>
          <button type="button" onClick={() => void loadMetadata()} className="ml-auto rounded-md p-1 text-slate-500 hover:bg-slate-100" aria-label="刷新白板预览"><RefreshCw className="h-3.5 w-3.5" /></button>
          <button type="button" onClick={deleteNode} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-red-600 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5" />解除引用</button>
        </div>
      )}

      <div className="border-t border-slate-100 px-3 py-2">
        {editable ? (
          <input
            value={String(node.attrs.caption || '')}
            onChange={(event) => updateAttributes({ caption: event.target.value })}
            placeholder="添加白板说明…"
            maxLength={300}
            className="w-full border-0 bg-transparent text-xs text-slate-500 outline-none placeholder:text-slate-300"
          />
        ) : node.attrs.caption ? (
          <p className="text-xs text-slate-500">{node.attrs.caption}</p>
        ) : null}
      </div>
      {overlay}
    </NodeViewWrapper>
  );
};
