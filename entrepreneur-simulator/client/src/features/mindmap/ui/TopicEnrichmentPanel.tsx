import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  ClipboardList,
  ExternalLink,
  FileWarning,
  Link2,
  ListTodo,
  NotebookPen,
  Pencil,
  Plus,
  Tags,
  Trash2,
  X,
} from 'lucide-react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';

import { createRichText } from '../domain/defaults';
import { compareOrderedEntities } from '../domain/orderKey';
import type {
  LinkId,
  MindMapDocumentV1,
  Note,
  SheetId,
  TopicId,
  TopicLink,
} from '../domain/types';
import { mindMapRichTextToPlainText } from '../view/text';
import {
  planDeleteTopicLinkCommand,
  planDeleteTopicNoteCommand,
  planDeleteTopicTodoCommand,
  planBatchTopicTodosCommand,
  planDirectChildTodosCompletionCommand,
  planUpdateTopicLabelsCommand,
  planUpsertExternalTopicLinkCommand,
  planUpsertTopicNoteCommand,
  planUpsertTopicTodoCommand,
  type TopicEnrichmentCommand,
} from './enrichmentPlanning';
import { buildTopicEnrichmentsProjection } from './enrichmentProjection';
import { TopicRichTextDisplay, TopicRichTextEditor } from './TopicRichText';
import { TopicTaskSection } from './TopicTaskSection';
import { InternalLinkPicker } from './InternalLinkPicker';
import {
  planUpsertInternalTopicLinkCommand,
  type InternalLinkTarget,
} from './internalLinkPlanning';

export type TopicEnrichmentSection = 'labels' | 'note' | 'links' | 'todo' | 'task';

export interface TopicEnrichmentPanelProps {
  readonly document: MindMapDocumentV1;
  readonly sheetId: SheetId;
  readonly topicId: TopicId;
  /** All selected Topics; the primary topicId remains the detail target. */
  readonly selectedTopicIds?: readonly TopicId[];
  readonly section: TopicEnrichmentSection;
  readonly readOnly: boolean;
  readonly focusLinkRequest?: number;
  onSectionChange(section: TopicEnrichmentSection): void;
  onCommand(command: TopicEnrichmentCommand): void;
  onNavigate?(sheetId: SheetId, topicId: TopicId): void;
  onClose(): void;
}

const byOrder = (left: TopicLink, right: TopicLink): number => compareOrderedEntities(left, right);

const linkDisplayName = (
  document: MindMapDocumentV1,
  link: TopicLink,
): string => {
  if (link.title) return link.title;
  switch (link.kind) {
    case 'web':
    case 'email':
    case 'file':
    case 'folder':
      return link.href;
    case 'sheet':
      return document.sheets[link.targetSheetId]?.title ?? '缺失 Sheet';
    case 'topic':
      return mindMapRichTextToPlainText(
        document.sheets[link.targetSheetId]?.topics[link.targetTopicId]?.title,
      ) || '缺失主题';
    case 'document-page':
      return link.targetDocumentPage.pageId;
  }
};

const linkKindLabel = (link: TopicLink): string => {
  if (link.kind === 'web') return '网页';
  if (link.kind === 'email') return '邮箱';
  if (link.kind === 'file') return '本地文件';
  if (link.kind === 'folder') return '本地文件夹';
  if (link.kind === 'sheet') return 'Sheet';
  if (link.kind === 'topic') return '主题';
  return '文档页面';
};

type OpenableExternalTopicLink = TopicLink & {
  readonly kind: 'web' | 'email';
  readonly href: string;
};

export const isOpenableExternalTopicLink = (
  link: TopicLink,
): link is OpenableExternalTopicLink => {
  if (link.status !== 'active') return false;
  if (link.kind === 'web') return /^https?:\/\//i.test(link.href);
  if (link.kind === 'email') return /^mailto:/i.test(link.href);
  return false;
};

const tabs: ReadonlyArray<{
  section: TopicEnrichmentSection;
  label: string;
  icon: typeof Tags;
}> = [
  { section: 'labels', label: '标签', icon: Tags },
  { section: 'note', label: '笔记', icon: NotebookPen },
  { section: 'links', label: '链接', icon: Link2 },
  { section: 'todo', label: '待办', icon: ListTodo },
  { section: 'task', label: '任务', icon: ClipboardList },
];

export const TopicEnrichmentPanel = ({
  document,
  sheetId,
  topicId,
  selectedTopicIds,
  section,
  readOnly,
  focusLinkRequest = 0,
  onSectionChange,
  onCommand,
  onNavigate,
  onClose,
}: TopicEnrichmentPanelProps) => {
  const sheet = document.sheets[sheetId];
  const topic = sheet?.topics[topicId];
  const note = useMemo<Note | undefined>(() => sheet
    ? Object.values(sheet.notes).find((candidate) => candidate.topicId === topicId)
    : undefined, [sheet, topicId]);
  const links = useMemo(() => sheet
    ? Object.values(sheet.links).filter((link) => link.topicId === topicId).sort(byOrder)
    : [], [sheet, topicId]);
  const todo = useMemo(() => sheet
    ? Object.values(sheet.todos).find((candidate) => candidate.topicId === topicId)
    : undefined, [sheet, topicId]);
  const bulkTopicIds = useMemo(() => {
    if (!sheet) return [];
    const requested = selectedTopicIds && selectedTopicIds.length > 0
      ? selectedTopicIds
      : [topicId];
    return [...new Set(requested)].filter((candidate) => Boolean(sheet.topics[candidate]));
  }, [selectedTopicIds, sheet, topicId]);
  const bulkTodoCounts = useMemo(() => {
    const selected = new Set(bulkTopicIds);
    const todos = sheet
      ? Object.values(sheet.todos).filter((candidate) => selected.has(candidate.topicId))
      : [];
    return {
      selected: bulkTopicIds.length,
      withTodo: todos.length,
      missing: bulkTopicIds.length - todos.length,
      completed: todos.filter((candidate) => candidate.completed).length,
      incomplete: todos.filter((candidate) => !candidate.completed).length,
    };
  }, [bulkTopicIds, sheet]);
  const childTodoProgress = useMemo(() => sheet
    ? buildTopicEnrichmentsProjection({ document, sheetId }).byTopicId[topicId]
      ?.childTodoProgress
    : undefined, [document, sheet, sheetId, topicId]);
  const [labelDraft, setLabelDraft] = useState('');
  const [editingNote, setEditingNote] = useState(false);
  const [editingLinkId, setEditingLinkId] = useState<LinkId | null>(null);
  const [editingInternalLinkId, setEditingInternalLinkId] = useState<LinkId | null>(null);
  const [internalLinkEditorOpen, setInternalLinkEditorOpen] = useState(false);
  const [linkHref, setLinkHref] = useState('');
  const [linkTitle, setLinkTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const linkInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLabelDraft('');
    setEditingNote(false);
    setEditingLinkId(null);
    setEditingInternalLinkId(null);
    setInternalLinkEditorOpen(false);
    setLinkHref('');
    setLinkTitle('');
    setError(null);
  }, [sheetId, topicId]);

  useEffect(() => {
    if (section === 'links' && focusLinkRequest > 0) {
      setInternalLinkEditorOpen(false);
      setEditingInternalLinkId(null);
      requestAnimationFrame(() => linkInputRef.current?.focus());
    }
  }, [focusLinkRequest, section]);

  if (!sheet || !topic) return null;

  const dispatch = (command: TopicEnrichmentCommand): boolean => {
    try {
      onCommand(command);
      setError(null);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    }
  };

  const updateLabels = (labels: readonly string[]): void => {
    dispatch(planUpdateTopicLabelsCommand({ document, sheetId, topicId, labels }));
  };
  const addLabel = (): void => {
    if (readOnly || !labelDraft.trim()) return;
    try {
      const additions = labelDraft.split(/[,，]/u);
      const command = planUpdateTopicLabelsCommand({
        document,
        sheetId,
        topicId,
        labels: [...(topic.labels ?? []), ...additions],
      });
      if (dispatch(command)) setLabelDraft('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const moveLabel = (index: number, offset: -1 | 1): void => {
    const labels = [...(topic.labels ?? [])];
    const destination = index + offset;
    if (readOnly || destination < 0 || destination >= labels.length) return;
    const [label] = labels.splice(index, 1);
    if (label === undefined) return;
    labels.splice(destination, 0, label);
    updateLabels(labels);
  };

  const beginLinkEdit = (link?: TopicLink): void => {
    if (link && link.kind !== 'web' && link.kind !== 'email') return;
    setInternalLinkEditorOpen(false);
    setEditingInternalLinkId(null);
    setEditingLinkId(link?.id ?? null);
    setLinkHref(link && (link.kind === 'web' || link.kind === 'email') ? link.href : '');
    setLinkTitle(link?.title ?? '');
    setError(null);
    requestAnimationFrame(() => linkInputRef.current?.focus());
  };
  const beginInternalLinkEdit = (link?: TopicLink): void => {
    if (link && link.kind !== 'sheet' && link.kind !== 'topic') return;
    cancelLinkEdit();
    setEditingInternalLinkId(link?.id ?? null);
    setInternalLinkEditorOpen(true);
    setError(null);
  };
  const cancelInternalLinkEdit = (): void => {
    setEditingInternalLinkId(null);
    setInternalLinkEditorOpen(false);
    setError(null);
  };
  const submitInternalLink = (target: InternalLinkTarget, title: string): void => {
    if (readOnly) return;
    try {
      const command = planUpsertInternalTopicLinkCommand({
        document,
        sheetId,
        topicId,
        target,
        title,
        ...(editingInternalLinkId ? { linkId: editingInternalLinkId } : {}),
      });
      if (dispatch(command)) cancelInternalLinkEdit();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const cancelLinkEdit = (): void => {
    setEditingLinkId(null);
    setLinkHref('');
    setLinkTitle('');
    setError(null);
  };
  const submitLink = (event: FormEvent): void => {
    event.preventDefault();
    if (readOnly) return;
    try {
      const command = planUpsertExternalTopicLinkCommand({
        document,
        sheetId,
        topicId,
        href: linkHref,
        title: linkTitle,
        ...(editingLinkId ? { linkId: editingLinkId } : {}),
      });
      if (dispatch(command)) cancelLinkEdit();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const activateLink = (link: TopicLink): void => {
    if (link.status !== 'active') return;
    if (isOpenableExternalTopicLink(link)) {
      globalThis.open(link.href, '_blank', 'noopener,noreferrer');
      return;
    }
    if (link.kind === 'topic') onNavigate?.(link.targetSheetId, link.targetTopicId);
    else if (link.kind === 'sheet') {
      const rootTopicId = document.sheets[link.targetSheetId]?.rootTopicId;
      if (rootTopicId) onNavigate?.(link.targetSheetId, rootTopicId);
    }
  };

  return (
    <aside
      className="nowheel nodrag flex max-h-full w-80 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white/98 shadow-2xl backdrop-blur"
      aria-label={`主题内容：${mindMapRichTextToPlainText(topic.title) || '未命名主题'}`}
      data-testid="mindmap-topic-enrichment-panel"
      onMouseDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <header className="flex items-center justify-between border-b border-slate-200 px-3 py-2.5">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-800">主题内容</h2>
          <p className="truncate text-[11px] text-slate-500">
            {mindMapRichTextToPlainText(topic.title) || '未命名主题'}
          </p>
        </div>
        <button
          type="button"
          className="rounded p-1 text-slate-500 hover:bg-slate-100"
          aria-label="关闭主题内容"
          onClick={onClose}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </header>

      <div className="grid grid-cols-5 gap-1 border-b border-slate-200 bg-slate-50 p-1" role="tablist" aria-label="主题内容类型">
        {tabs.map(({ section: tabSection, label, icon: Icon }) => (
          <button
            key={tabSection}
            type="button"
            role="tab"
            aria-selected={section === tabSection}
            className={`flex items-center justify-center gap-1 rounded px-2 py-1.5 text-xs ${
              section === tabSection
                ? 'bg-white font-medium text-blue-700 shadow-sm'
                : 'text-slate-600 hover:bg-white/70'
            }`}
            onClick={() => onSectionChange(tabSection)}
          >
            <Icon size={13} aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {section === 'labels' ? (
          <section aria-label="主题标签">
            <div className="flex flex-wrap gap-1.5">
              {(topic.labels ?? []).map((label, index, labels) => (
                <span key={label} className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-1 text-xs text-violet-700">
                  {label}
                  {!readOnly ? (
                    <span className="inline-flex items-center">
                      <button
                        type="button"
                        className="rounded-full p-0.5 hover:bg-violet-100 disabled:opacity-30"
                        aria-label={`前移标签 ${label}`}
                        disabled={index === 0}
                        onClick={() => moveLabel(index, -1)}
                      >
                        <ChevronLeft size={10} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="rounded-full p-0.5 hover:bg-violet-100 disabled:opacity-30"
                        aria-label={`后移标签 ${label}`}
                        disabled={index === labels.length - 1}
                        onClick={() => moveLabel(index, 1)}
                      >
                        <ChevronRight size={10} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="rounded-full p-0.5 hover:bg-violet-100"
                        aria-label={`删除标签 ${label}`}
                        onClick={() => updateLabels((topic.labels ?? []).filter((candidate) => candidate !== label))}
                      >
                        <X size={12} aria-hidden="true" />
                      </button>
                    </span>
                  ) : null}
                </span>
              ))}
              {(topic.labels ?? []).length === 0 ? (
                <p className="text-xs text-slate-400">暂无标签</p>
              ) : null}
            </div>
            {!readOnly ? (
              <div className="mt-3 flex gap-2">
                <input
                  value={labelDraft}
                  maxLength={4096}
                  className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2.5 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                  aria-label="新标签"
                  placeholder="输入标签，多个用逗号分隔"
                  onChange={(event) => setLabelDraft(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      addLabel();
                    }
                  }}
                />
                <button
                  type="button"
                  className="rounded-lg bg-blue-600 px-3 text-white disabled:opacity-40"
                  disabled={!labelDraft.trim()}
                  aria-label="添加标签"
                  onClick={addLabel}
                >
                  <Plus size={15} aria-hidden="true" />
                </button>
              </div>
            ) : null}
          </section>
        ) : null}

        {section === 'note' ? (
          <section aria-label="主题笔记">
            {editingNote && !readOnly ? (
              <TopicRichTextEditor
                key={`note-editor:${note?.id ?? 'new'}:${document.contentRevision}`}
                initialValue={note?.content ?? createRichText('')}
                ariaLabel="编辑主题笔记"
                submitShortcut="mod-enter"
                allowTables
                className="w-full"
                onCommit={(content) => {
                  if (dispatch(planUpsertTopicNoteCommand({ document, sheetId, topicId, content }))) {
                    setEditingNote(false);
                  }
                }}
                onCancel={() => setEditingNote(false)}
              />
            ) : note ? (
              <>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                  <TopicRichTextDisplay value={note.content} ariaLabel="主题笔记内容" />
                </div>
                {!readOnly ? (
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50"
                      onClick={() => setEditingNote(true)}
                    >
                      <Pencil size={13} aria-hidden="true" /> 编辑笔记
                    </button>
                    <button
                      type="button"
                      className="inline-flex items-center justify-center gap-1 rounded-lg border border-red-200 px-3 py-2 text-xs text-red-600 hover:bg-red-50"
                      onClick={() => dispatch(planDeleteTopicNoteCommand({ document, sheetId, topicId, noteId: note.id }))}
                    >
                      <Trash2 size={13} aria-hidden="true" /> 删除
                    </button>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="rounded-lg border border-dashed border-slate-200 p-4 text-center">
                <NotebookPen size={20} className="mx-auto text-slate-300" aria-hidden="true" />
                <p className="mt-2 text-xs text-slate-500">笔记独立于主题布局，支持富文本、嵌套列表和表格。</p>
                {!readOnly ? (
                  <button
                    type="button"
                    className="mt-3 rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white"
                    onClick={() => setEditingNote(true)}
                  >
                    添加笔记
                  </button>
                ) : null}
              </div>
            )}
          </section>
        ) : null}

        {section === 'links' ? (
          <section aria-label="主题链接">
            {links.length === 0 ? <p className="text-xs text-slate-400">暂无链接</p> : null}
            <ul className="space-y-2">
              {links.map((link) => {
                const editable = link.kind === 'web'
                  || link.kind === 'email'
                  || link.kind === 'sheet'
                  || link.kind === 'topic';
                const openable = isOpenableExternalTopicLink(link)
                  || (link.status === 'active' && (link.kind === 'topic' || link.kind === 'sheet'));
                return (
                  <li key={link.id} className="rounded-lg border border-slate-200 p-2.5">
                    <div className="flex items-start gap-2">
                      {link.status === 'broken'
                        ? <FileWarning size={15} className="mt-0.5 shrink-0 text-amber-600" aria-hidden="true" />
                        : <Link2 size={15} className="mt-0.5 shrink-0 text-blue-600" aria-hidden="true" />}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-slate-800">{linkDisplayName(document, link)}</p>
                        <p className="mt-0.5 text-[10px] text-slate-500">
                          {linkKindLabel(link)}{link.status === 'broken' ? ' · 目标已失效' : ''}
                        </p>
                      </div>
                    </div>
                    <div className="mt-2 flex justify-end gap-1">
                      <button
                        type="button"
                        className="rounded border border-slate-200 p-1 text-slate-600 disabled:cursor-not-allowed disabled:opacity-35"
                        aria-label={`打开链接 ${linkDisplayName(document, link)}`}
                        title={link.kind === 'file' || link.kind === 'folder'
                          ? 'Web 环境没有持久本地文件权限'
                          : '打开链接'}
                        disabled={!openable}
                        onClick={() => activateLink(link)}
                      >
                        <ExternalLink size={13} aria-hidden="true" />
                      </button>
                      {!readOnly && editable ? (
                        <button
                          type="button"
                          className="rounded border border-slate-200 p-1 text-slate-600"
                          aria-label={`编辑链接 ${linkDisplayName(document, link)}`}
                          onClick={() => {
                            if (link.kind === 'sheet' || link.kind === 'topic') beginInternalLinkEdit(link);
                            else beginLinkEdit(link);
                          }}
                        >
                          <Pencil size={13} aria-hidden="true" />
                        </button>
                      ) : null}
                      {!readOnly ? (
                        <button
                          type="button"
                          className="rounded border border-red-200 p-1 text-red-600"
                          aria-label={`删除链接 ${linkDisplayName(document, link)}`}
                          onClick={() => dispatch(planDeleteTopicLinkCommand({ document, sheetId, topicId, linkId: link.id }))}
                        >
                          <Trash2 size={13} aria-hidden="true" />
                        </button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>

            {!readOnly && internalLinkEditorOpen ? (
              <div className="mt-3 border-t border-slate-100 pt-3">
                {(() => {
                  const editing = editingInternalLinkId
                    ? sheet.links[editingInternalLinkId]
                    : undefined;
                  const initialTarget: InternalLinkTarget | undefined = editing?.kind === 'sheet'
                    ? { kind: 'sheet', targetSheetId: editing.targetSheetId }
                    : editing?.kind === 'topic'
                      ? {
                          kind: 'topic',
                          targetSheetId: editing.targetSheetId,
                          targetTopicId: editing.targetTopicId,
                        }
                      : undefined;
                  return (
                    <InternalLinkPicker
                      key={editingInternalLinkId ?? 'new-internal-link'}
                      document={document}
                      initialTarget={initialTarget}
                      initialTitle={editing?.title}
                      submitLabel={editingInternalLinkId ? '更新内部链接' : '保存内部链接'}
                      onSubmit={submitInternalLink}
                      onCancel={cancelInternalLinkEdit}
                    />
                  );
                })()}
              </div>
            ) : null}

            {!readOnly && !internalLinkEditorOpen ? (
              <form className="mt-3 space-y-2 border-t border-slate-100 pt-3" onSubmit={submitLink}>
                <div className="flex items-center justify-between gap-2">
                  <label className="block text-[11px] font-medium text-slate-600" htmlFor={`mindmap-link-href-${topicId}`}>
                    {editingLinkId ? '编辑链接' : '添加网页或邮箱链接'}
                  </label>
                  {!editingLinkId ? (
                    <button
                      type="button"
                      className="rounded-lg border border-blue-200 px-2 py-1 text-[10px] font-medium text-blue-700 hover:bg-blue-50"
                      onClick={() => beginInternalLinkEdit()}
                    >
                      添加内部链接
                    </button>
                  ) : null}
                </div>
                <input
                  ref={linkInputRef}
                  id={`mindmap-link-href-${topicId}`}
                  value={linkHref}
                  className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                  aria-label="链接地址"
                  placeholder="https://example.com 或 name@example.com"
                  onChange={(event) => setLinkHref(event.currentTarget.value)}
                />
                <input
                  value={linkTitle}
                  maxLength={4096}
                  className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                  aria-label="链接标题"
                  placeholder="可选标题"
                  onChange={(event) => setLinkTitle(event.currentTarget.value)}
                />
                <div className="flex justify-end gap-2">
                  {editingLinkId || linkHref || linkTitle ? (
                    <button type="button" className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600" onClick={cancelLinkEdit}>
                      取消
                    </button>
                  ) : null}
                  <button
                    type="submit"
                    className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                    disabled={!linkHref.trim()}
                  >
                    {editingLinkId ? '保存链接' : '添加链接'}
                  </button>
                </div>
                <p className="text-[10px] leading-4 text-slate-400">
                  Ctrl/Cmd+K 可直接打开；危险协议会在命令层拒绝。本地文件需桌面权限桥接。
                </p>
              </form>
            ) : null}
          </section>
        ) : null}

        {section === 'todo' ? (
          <section aria-label="主题待办">
            {bulkTodoCounts.selected > 1 ? (
              <div
                className="mb-3 rounded-xl border border-blue-200 bg-blue-50/70 p-3"
                data-testid="mindmap-bulk-todo-controls"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-blue-900">
                    已选择 {bulkTodoCounts.selected} 个主题
                  </p>
                  <span className="text-[10px] tabular-nums text-blue-700">
                    待办 {bulkTodoCounts.withTodo} · 完成 {bulkTodoCounts.completed}
                  </span>
                </div>
                {!readOnly ? (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      className="rounded-lg border border-blue-200 bg-white px-2 py-1.5 text-xs text-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
                      disabled={bulkTodoCounts.missing === 0}
                      onClick={() => dispatch(planBatchTopicTodosCommand({
                        document,
                        sheetId,
                        topicIds: bulkTopicIds,
                        action: 'apply',
                      }))}
                    >
                      批量应用待办 ({bulkTodoCounts.missing})
                    </button>
                    <button
                      type="button"
                      className="rounded-lg border border-red-200 bg-white px-2 py-1.5 text-xs text-red-700 disabled:cursor-not-allowed disabled:opacity-40"
                      disabled={bulkTodoCounts.withTodo === 0}
                      onClick={() => dispatch(planBatchTopicTodosCommand({
                        document,
                        sheetId,
                        topicIds: bulkTopicIds,
                        action: 'remove',
                      }))}
                    >
                      批量移除待办 ({bulkTodoCounts.withTodo})
                    </button>
                    <button
                      type="button"
                      className="rounded-lg border border-emerald-200 bg-white px-2 py-1.5 text-xs text-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
                      disabled={bulkTodoCounts.incomplete === 0}
                      onClick={() => dispatch(planBatchTopicTodosCommand({
                        document,
                        sheetId,
                        topicIds: bulkTopicIds,
                        action: 'complete',
                      }))}
                    >
                      批量标记已完成 ({bulkTodoCounts.incomplete})
                    </button>
                    <button
                      type="button"
                      className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                      disabled={bulkTodoCounts.completed === 0}
                      onClick={() => dispatch(planBatchTopicTodosCommand({
                        document,
                        sheetId,
                        topicIds: bulkTopicIds,
                        action: 'reopen',
                      }))}
                    >
                      批量标记未完成 ({bulkTodoCounts.completed})
                    </button>
                  </div>
                ) : (
                  <p className="mt-2 text-[10px] text-blue-700">只读模式不会创建批量事务。</p>
                )}
              </div>
            ) : null}
            {todo ? (
              <div
                className={`rounded-xl border p-3 ${todo.completed
                  ? 'border-emerald-200 bg-emerald-50'
                  : 'border-slate-200 bg-slate-50'}`}
                data-testid="mindmap-topic-todo"
              >
                <div className="flex items-center gap-3">
                  {readOnly ? (
                    todo.completed
                      ? <CheckCircle2 size={22} className="shrink-0 text-emerald-600" aria-hidden="true" />
                      : <Circle size={22} className="shrink-0 text-slate-400" aria-hidden="true" />
                  ) : (
                    <button
                      type="button"
                      className={`rounded-full p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${todo.completed
                        ? 'text-emerald-600 hover:text-emerald-700'
                        : 'text-slate-400 hover:text-blue-600'}`}
                      aria-label={todo.completed ? '标记待办为未完成' : '标记待办为已完成'}
                      aria-pressed={todo.completed}
                      onClick={() => dispatch(planUpsertTopicTodoCommand({
                        document,
                        sheetId,
                        topicId,
                        todoId: todo.id,
                        completed: !todo.completed,
                      }))}
                    >
                      {todo.completed
                        ? <CheckCircle2 size={22} aria-hidden="true" />
                        : <Circle size={22} aria-hidden="true" />}
                    </button>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm font-medium ${todo.completed
                      ? 'text-emerald-800 line-through'
                      : 'text-slate-800'}`}
                    >
                      {todo.completed ? '已完成' : '未完成'}
                    </p>
                    {todo.completedAt ? (
                      <p className="mt-0.5 text-[10px] text-slate-500">
                        完成于 <time dateTime={todo.completedAt}>{todo.completedAt}</time>
                      </p>
                    ) : null}
                  </div>
                  {!readOnly ? (
                    <button
                      type="button"
                      className="rounded-lg border border-red-200 p-1.5 text-red-600 hover:bg-red-50"
                      aria-label="删除待办"
                      onClick={() => dispatch(planDeleteTopicTodoCommand({
                        document,
                        sheetId,
                        topicId,
                        todoId: todo.id,
                      }))}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-slate-200 p-4 text-center">
                <ListTodo size={22} className="mx-auto text-slate-300" aria-hidden="true" />
                <p className="mt-2 text-xs leading-5 text-slate-500">
                  待办是独立的轻量完成状态，不会自动获得 Task 的日期或依赖字段。
                </p>
                {!readOnly ? (
                  <button
                    type="button"
                    className="mt-3 rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white"
                    onClick={() => dispatch(planUpsertTopicTodoCommand({
                      document,
                      sheetId,
                      topicId,
                      completed: false,
                    }))}
                  >
                    添加待办
                  </button>
                ) : null}
              </div>
            )}

            {childTodoProgress ? (
              <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-medium text-slate-700">直属子主题待办</span>
                  <span className="tabular-nums text-slate-500">
                    {childTodoProgress.completedCount}/{childTodoProgress.totalCount}
                  </span>
                </div>
                <div
                  className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"
                  role="progressbar"
                  aria-label="直属子主题待办进度"
                  aria-valuemin={0}
                  aria-valuemax={childTodoProgress.totalCount}
                  aria-valuenow={childTodoProgress.completedCount}
                  aria-valuetext={`${Math.round(childTodoProgress.progress * 100)}%`}
                >
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-[width]"
                    style={{ width: `${Math.round(childTodoProgress.progress * 100)}%` }}
                  />
                </div>
                <p className="mt-1.5 text-[10px] leading-4 text-slate-400">
                  进度由直属子主题的待办实时计算，不重复写入文档。
                </p>
                {!readOnly ? (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      className="rounded-lg border border-emerald-200 px-2 py-1.5 text-xs text-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
                      disabled={childTodoProgress.completedCount === childTodoProgress.totalCount}
                      onClick={() => dispatch(planDirectChildTodosCompletionCommand({
                        document,
                        sheetId,
                        parentTopicId: topicId,
                        completed: true,
                      }))}
                    >
                      完成全部直属子项
                    </button>
                    <button
                      type="button"
                      className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                      disabled={childTodoProgress.completedCount === 0}
                      onClick={() => dispatch(planDirectChildTodosCompletionCommand({
                        document,
                        sheetId,
                        parentTopicId: topicId,
                        completed: false,
                      }))}
                    >
                      取消全部直属子项完成
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>
        ) : null}

        {section === 'task' ? (
          <TopicTaskSection
            document={document}
            sheetId={sheetId}
            topicId={topicId}
            readOnly={readOnly}
            onCommand={onCommand}
          />
        ) : null}

        {error ? (
          <p className="mt-3 rounded-lg bg-red-50 px-2.5 py-2 text-xs text-red-700" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </aside>
  );
};
