import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import {
  ArrowDown,
  ArrowUp,
  CaseSensitive,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ChevronsLeft,
  GripVertical,
  IndentDecrease,
  IndentIncrease,
  ListTree,
  Search,
} from 'lucide-react';

import type {
  ElementRef,
  MindMapDocumentV1,
  RichText,
  SheetId,
  TopicId,
} from '../domain/types';
import {
  buildMindMapSearchIndex,
  navigateMindMapSearchResults,
  projectMindMapOutliner,
  projectMindMapSearchFilter,
  searchMindMapIndex,
  type MindMapOutlinerRow,
  type MindMapOutlinerViewState,
  type MindMapSearchCursor,
  type MindMapSearchField,
  type MindMapSearchFilterProjection,
  type MindMapSearchMatch,
  type MindMapSearchNavigationDirection,
  type MindMapSearchScope,
} from '../view';
import {
  planOutlinerDropIntent,
  planOutlinerIndentIntent,
  normalizeOutlinerRichTextCommit,
  planOutlinerOutdentIntent,
  planOutlinerSiblingMoveIntent,
  type OutlinerDropPosition,
  type OutlinerReorderIntent,
  type OutlinerReparentIntent,
  type OutlinerUpdateTitleIntent,
} from './outlinerEditing';
import { TopicRichTextEditor } from './TopicRichText';

type SearchScopeKind = 'branch' | 'sheet' | 'all-sheets';
type SearchFieldScope = 'all' | MindMapSearchField;

const searchFieldLabel: Record<MindMapSearchField, string> = {
  topic: '主题',
  note: '备注',
  label: '标签',
  marker: '图标',
  todo: '待办',
  task: '任务',
};

const sameCursor = (
  left: MindMapSearchCursor | undefined,
  right: MindMapSearchCursor | undefined,
): boolean => left?.sheetId === right?.sheetId && left?.topicId === right?.topicId;

const searchScope = (
  kind: SearchScopeKind,
  activeSheetId: SheetId,
  branchRootTopicId: TopicId | undefined,
): MindMapSearchScope => {
  if (kind === 'all-sheets') return { kind: 'all-sheets' };
  if (kind === 'branch' && branchRootTopicId) {
    return {
      kind: 'branch',
      sheetId: activeSheetId,
      rootTopicId: branchRootTopicId,
    };
  }
  return { kind: 'sheet', sheetId: activeSheetId };
};

const matchingFieldSummary = (match: MindMapSearchMatch): string => {
  const labels = [...new Set(match.fields.map((field) => searchFieldLabel[field.field]))];
  return labels.join('、');
};

const highlightedTopicTitle = (match: MindMapSearchMatch): ReactNode => {
  const titleMatch = match.fields.find((field) => field.field === 'topic');
  const ranges = titleMatch?.ranges ?? [];
  if (ranges.length === 0) return match.topicTitle || '无标题主题';

  const parts: ReactNode[] = [];
  let offset = 0;
  for (const range of ranges) {
    if (range.start > offset) parts.push(match.topicTitle.slice(offset, range.start));
    parts.push(
      <mark key={`${range.start}:${range.end}`} className="rounded bg-amber-200 px-0.5 text-inherit">
        {match.topicTitle.slice(range.start, range.end)}
      </mark>,
    );
    offset = range.end;
  }
  if (offset < match.topicTitle.length) parts.push(match.topicTitle.slice(offset));
  return parts;
};

export interface SearchOutlinerPanelHandle {
  /** Opens the panel and focuses/selects the search field (for example from Ctrl+F). */
  focusSearch(): void;
}

export interface SearchOutlinerPanelProps {
  readonly document: MindMapDocumentV1;
  readonly activeSheetId: SheetId;
  /** The current branch root used by the branch-only search scope. */
  readonly branchRootTopicId?: TopicId;
  readonly selectedTopic?: MindMapSearchCursor;
  readonly readOnly?: boolean;
  readonly defaultCollapsed?: boolean;
  readonly className?: string;
  onSelect(reference: ElementRef, sheetId: SheetId): void;
  onCollapsedChange?(collapsed: boolean): void;
  /** Emits a view-only projection so the canvas can dim the same non-matches as the Outliner. */
  onFilterChange?(filter: MindMapSearchFilterProjection | undefined): void;
  /** Canonical content intents. The panel never mutates `document` itself. */
  onUpdateTopicTitle?(intent: OutlinerUpdateTitleIntent): void;
  onReparentTopic?(intent: OutlinerReparentIntent): void;
  onReorderTopic?(intent: OutlinerReorderIntent): void;
}

interface EditingTopicState {
  readonly sheetId: SheetId;
  readonly topicId: TopicId;
  readonly initialTitle: RichText;
}

interface OutlinerDragOverState {
  readonly topicKey: string;
  readonly position: OutlinerDropPosition;
}

const outlinerTopicKey = (sheetId: SheetId, topicId: TopicId): string =>
  `${sheetId}:${topicId}`;

export const SearchOutlinerPanel = forwardRef<
  SearchOutlinerPanelHandle,
  SearchOutlinerPanelProps
>(function SearchOutlinerPanel({
  document,
  activeSheetId,
  branchRootTopicId,
  selectedTopic,
  readOnly = false,
  defaultCollapsed = false,
  className = '',
  onSelect,
  onCollapsedChange,
  onFilterChange,
  onUpdateTopicTitle,
  onReparentTopic,
  onReorderTopic,
}, ref) {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const titleButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const editingKeyRef = useRef<string>();
  const draggedTopicRef = useRef<MindMapSearchCursor>();
  const pendingEditorStructureRef = useRef<
    OutlinerReparentIntent | OutlinerReorderIntent
  >();
  const [panelCollapsed, setPanelCollapsed] = useState(defaultCollapsed);
  const [focusRequest, setFocusRequest] = useState(0);
  const [queryText, setQueryText] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [scopeKind, setScopeKind] = useState<SearchScopeKind>('sheet');
  const [fieldScope, setFieldScope] = useState<SearchFieldScope>('all');
  const [cursor, setCursor] = useState<MindMapSearchCursor>();
  const [outlinerViewState, setOutlinerViewState] = useState<MindMapOutlinerViewState>({});
  const [editingTopic, setEditingTopic] = useState<EditingTopicState>();
  const [focusAfterEdit, setFocusAfterEdit] = useState<string>();
  const [draggedTopic, setDraggedTopic] = useState<MindMapSearchCursor>();
  const [dragOverTarget, setDragOverTarget] = useState<OutlinerDragOverState>();

  const activeSheet = document.sheets[activeSheetId];
  const canSearchBranch = branchRootTopicId !== undefined
    && activeSheet?.topics[branchRootTopicId] !== undefined;

  const setCollapsed = (collapsed: boolean): void => {
    setPanelCollapsed(collapsed);
    onCollapsedChange?.(collapsed);
  };

  useImperativeHandle(ref, () => ({
    focusSearch: () => {
      setCollapsed(false);
      setFocusRequest((value) => value + 1);
    },
  }));

  useEffect(() => {
    if (focusRequest === 0 || panelCollapsed) return;
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }, [focusRequest, panelCollapsed]);

  useEffect(() => {
    if (!focusAfterEdit || editingTopic) return;
    titleButtonRefs.current.get(focusAfterEdit)?.focus();
    setFocusAfterEdit(undefined);
  }, [editingTopic, focusAfterEdit]);

  useEffect(() => {
    if (!editingTopic) return;
    const topicExists = document.sheets[editingTopic.sheetId]
      ?.topics[editingTopic.topicId] !== undefined;
    if (!topicExists || readOnly) {
      editingKeyRef.current = undefined;
      pendingEditorStructureRef.current = undefined;
      setEditingTopic(undefined);
    }
  }, [document, editingTopic, readOnly]);

  useEffect(() => {
    if (scopeKind === 'branch' && !canSearchBranch) setScopeKind('sheet');
  }, [canSearchBranch, scopeKind]);

  useEffect(() => {
    setCursor(undefined);
  }, [activeSheetId, branchRootTopicId, caseSensitive, fieldScope, queryText, scopeKind, wholeWord]);

  const index = useMemo(
    () => buildMindMapSearchIndex(document),
    [document, document.contentRevision],
  );
  const results = useMemo(() => searchMindMapIndex(index, {
    text: queryText,
    caseSensitive,
    wholeWord,
    ...(fieldScope === 'all' ? {} : { fields: [fieldScope] }),
    scope: searchScope(scopeKind, activeSheetId, branchRootTopicId),
  }), [
    activeSheetId,
    branchRootTopicId,
    caseSensitive,
    fieldScope,
    index,
    queryText,
    scopeKind,
    wholeWord,
  ]);
  const filter = useMemo(
    () => projectMindMapSearchFilter(index, results, 'dim'),
    [index, results],
  );
  useEffect(() => {
    onFilterChange?.(results.active ? filter : undefined);
  }, [filter, onFilterChange, results.active]);
  const outliner = useMemo(() => projectMindMapOutliner({
    document,
    viewState: outlinerViewState,
    ...(results.active ? { filter } : {}),
  }), [document, filter, outlinerViewState, results.active]);
  const cursorIndex = cursor === undefined
    ? -1
    : results.matches.findIndex((match) => sameCursor(match, cursor));

  useEffect(() => {
    if (cursor !== undefined && cursorIndex < 0) setCursor(undefined);
  }, [cursor, cursorIndex]);

  const selectMatch = (match: MindMapSearchMatch): void => {
    const nextCursor = { sheetId: match.sheetId, topicId: match.topicId };
    setCursor(nextCursor);
    onSelect({ kind: 'topic', id: match.topicId }, match.sheetId);
  };

  const navigate = (direction: MindMapSearchNavigationDirection): void => {
    const match = navigateMindMapSearchResults(results, cursor, direction);
    if (match) selectMatch(match);
  };

  const onSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      navigate(event.shiftKey ? 'previous' : 'next');
    } else if (event.key === 'Escape' && queryText.length > 0) {
      event.preventDefault();
      setQueryText('');
    }
  };

  const toggleSheet = (sheetId: SheetId): void => {
    setOutlinerViewState((previous) => {
      const collapsed = new Set(previous.collapsedSheetIds ?? []);
      if (collapsed.has(sheetId)) collapsed.delete(sheetId);
      else collapsed.add(sheetId);
      return { ...previous, collapsedSheetIds: [...collapsed] };
    });
  };

  const toggleTopic = (row: Extract<MindMapOutlinerRow, { kind: 'topic' }>): void => {
    setOutlinerViewState((previous) => ({
      ...previous,
      foldOverrides: {
        ...previous.foldOverrides,
        [row.sheetId]: {
          ...previous.foldOverrides?.[row.sheetId],
          [row.topicId]: !row.collapsed,
        },
      },
    }));
  };

  const selectTopic = (sheetId: SheetId, topicId: TopicId): void => {
    onSelect({ kind: 'topic', id: topicId }, sheetId);
  };

  const beginTitleEdit = (
    row: Extract<MindMapOutlinerRow, { kind: 'topic' }>,
  ): void => {
    if (readOnly || !onUpdateTopicTitle) return;
    const key = outlinerTopicKey(row.sheetId, row.topicId);
    const canonicalTitle = document.sheets[row.sheetId]?.topics[row.topicId]?.title;
    if (!canonicalTitle) return;
    editingKeyRef.current = key;
    pendingEditorStructureRef.current = undefined;
    setEditingTopic({
      sheetId: row.sheetId,
      topicId: row.topicId,
      initialTitle: structuredClone(canonicalTitle),
    });
  };

  const finishTitleEdit = (title?: RichText): void => {
    if (!editingTopic) return;
    const key = outlinerTopicKey(editingTopic.sheetId, editingTopic.topicId);
    if (editingKeyRef.current !== key) return;
    editingKeyRef.current = undefined;
    const pendingStructure = pendingEditorStructureRef.current;
    pendingEditorStructureRef.current = undefined;
    const canonicalTitle = title
      ? normalizeOutlinerRichTextCommit(editingTopic.initialTitle, title)
      : undefined;
    if (
      canonicalTitle
      && !readOnly
      && onUpdateTopicTitle
      && JSON.stringify(canonicalTitle) !== JSON.stringify(editingTopic.initialTitle)
    ) {
      onUpdateTopicTitle({
        kind: 'update-title',
        sheetId: editingTopic.sheetId,
        topicId: editingTopic.topicId,
        title: canonicalTitle,
        source: 'editor',
      });
    }
    setEditingTopic(undefined);
    setFocusAfterEdit(key);
    if (pendingStructure?.kind === 'reparent') invokeReparent(pendingStructure);
    else if (pendingStructure?.kind === 'reorder') invokeReorder(pendingStructure);
  };

  const invokeReparent = (intent: OutlinerReparentIntent | undefined): boolean => {
    if (readOnly || !intent || !onReparentTopic) return false;
    onReparentTopic(intent);
    return true;
  };

  const invokeReorder = (intent: OutlinerReorderIntent | undefined): boolean => {
    if (readOnly || !intent || !onReorderTopic) return false;
    onReorderTopic(intent);
    return true;
  };

  const invokeDropIntent = (
    intent: OutlinerReparentIntent | OutlinerReorderIntent | undefined,
  ): boolean => intent?.kind === 'reparent'
    ? invokeReparent(intent)
    : invokeReorder(intent);

  const canInvokeDropIntent = (
    intent: OutlinerReparentIntent | OutlinerReorderIntent | undefined,
  ): boolean => !readOnly && (
    (intent?.kind === 'reparent' && onReparentTopic !== undefined)
    || (intent?.kind === 'reorder' && onReorderTopic !== undefined)
  );

  const handleTopicShortcut = (
    event: ReactKeyboardEvent<HTMLElement>,
    row: Extract<MindMapOutlinerRow, { kind: 'topic' }>,
  ): void => {
    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      const intent = planOutlinerSiblingMoveIntent(
        document,
        row.sheetId,
        row.topicId,
        event.key === 'ArrowUp' ? 'up' : 'down',
        'keyboard',
      );
      if (!readOnly && onReorderTopic && intent) {
        event.preventDefault();
        event.stopPropagation();
        invokeReorder(intent);
      }
      return;
    }

    if (event.key === 'Tab') {
      const intent = event.shiftKey
        ? planOutlinerOutdentIntent(document, row.sheetId, row.topicId, 'keyboard')
        : planOutlinerIndentIntent(document, row.sheetId, row.topicId, 'keyboard');
      if (!readOnly && onReparentTopic && intent) {
        event.preventDefault();
        event.stopPropagation();
        invokeReparent(intent);
      }
      return;
    }

    if (event.key === 'Enter') {
      if (!readOnly && onUpdateTopicTitle) {
        event.preventDefault();
        event.stopPropagation();
        beginTitleEdit(row);
      }
      return;
    }

    if (event.key === 'F2' && !readOnly && onUpdateTopicTitle) {
      event.preventDefault();
      event.stopPropagation();
      beginTitleEdit(row);
    }
  };

  const handleEditorStructureShortcut = (
    event: ReactKeyboardEvent<HTMLDivElement>,
    row: Extract<MindMapOutlinerRow, { kind: 'topic' }>,
  ): void => {
    let intent: OutlinerReparentIntent | OutlinerReorderIntent | undefined;
    if (event.key === 'Tab') {
      intent = event.shiftKey
        ? planOutlinerOutdentIntent(document, row.sheetId, row.topicId, 'keyboard')
        : planOutlinerIndentIntent(document, row.sheetId, row.topicId, 'keyboard');
      if (!onReparentTopic || intent?.kind !== 'reparent') return;
    } else if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      intent = planOutlinerSiblingMoveIntent(
        document,
        row.sheetId,
        row.topicId,
        event.key === 'ArrowUp' ? 'up' : 'down',
        'keyboard',
      );
      if (!onReorderTopic || intent?.kind !== 'reorder') return;
    } else {
      return;
    }
    if (readOnly || !intent) return;
    event.preventDefault();
    event.stopPropagation();
    pendingEditorStructureRef.current = intent;
    if (event.target instanceof HTMLElement) event.target.blur();
  };

  const dropPosition = (
    event: ReactDragEvent<HTMLElement>,
  ): OutlinerDropPosition => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const clientY = Number.isFinite(event.clientY) ? event.clientY : bounds.top;
    const offset = clientY - bounds.top;
    if (offset <= bounds.height / 3) return 'before';
    if (offset >= bounds.height * 2 / 3) return 'after';
    return 'inside';
  };

  if (panelCollapsed) {
    return (
      <aside
        className={`nowheel nodrag absolute bottom-3 left-3 top-14 z-30 flex w-10 flex-col items-center rounded-lg border border-slate-200 bg-white/95 py-2 shadow-lg backdrop-blur ${className}`}
        aria-label="思维导图搜索与大纲（已折叠）"
        data-testid="mindmap-search-outliner-panel"
        data-collapsed="true"
        data-readonly={readOnly ? 'true' : 'false'}
        onMouseDown={(event: ReactMouseEvent<HTMLElement>) => event.stopPropagation()}
      >
        <button
          type="button"
          className="rounded p-1.5 text-slate-600 hover:bg-slate-100"
          aria-label="展开搜索与大纲"
          title="展开搜索与大纲"
          onClick={() => setCollapsed(false)}
        >
          <ChevronRight size={16} aria-hidden="true" />
        </button>
        <Search size={15} className="mt-3 text-slate-400" aria-hidden="true" />
        <ListTree size={15} className="mt-2 text-slate-400" aria-hidden="true" />
      </aside>
    );
  }

  return (
    <aside
      className={`nowheel nodrag absolute bottom-3 left-3 top-14 z-30 flex w-80 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white/95 shadow-lg backdrop-blur ${className}`}
      aria-label="思维导图搜索与大纲"
      data-testid="mindmap-search-outliner-panel"
      data-collapsed="false"
      data-readonly={readOnly ? 'true' : 'false'}
      onMouseDown={(event: ReactMouseEvent<HTMLElement>) => event.stopPropagation()}
    >
      <div className="flex items-center justify-between border-b border-slate-200 px-2 py-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
          <Search size={14} aria-hidden="true" />
          <span>搜索与大纲</span>
        </div>
        <button
          type="button"
          className="rounded p-1 text-slate-500 hover:bg-slate-100"
          aria-label="折叠搜索与大纲"
          title="折叠面板"
          onClick={() => setCollapsed(true)}
        >
          <ChevronsLeft size={15} aria-hidden="true" />
        </button>
      </div>

      <section className="border-b border-slate-200 p-2" aria-label="搜索">
        <div className="flex items-center gap-1">
          <div className="relative min-w-0 flex-1">
            <Search
              size={13}
              className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              ref={searchInputRef}
              type="search"
              className="w-full rounded-md border border-slate-200 bg-white py-1.5 pl-7 pr-2 text-xs text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              aria-label="搜索主题和内容"
              placeholder="搜索主题、备注、标签…"
              value={queryText}
              onChange={(event) => setQueryText(event.target.value)}
              onKeyDown={onSearchKeyDown}
            />
          </div>
          <button
            type="button"
            className={`rounded border p-1.5 ${caseSensitive ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}
            aria-label="区分大小写"
            aria-pressed={caseSensitive}
            title="区分大小写"
            onClick={() => setCaseSensitive((value) => !value)}
          >
            <CaseSensitive size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`rounded border px-1.5 py-1 text-[10px] font-semibold ${wholeWord ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}
            aria-label="全词匹配"
            aria-pressed={wholeWord}
            title="全词匹配"
            onClick={() => setWholeWord((value) => !value)}
          >
            词
          </button>
        </div>

        <div className="mt-2 flex items-center gap-1">
          <label className="sr-only" htmlFor={`mindmap-search-scope-${document.id}`}>搜索范围</label>
          <select
            id={`mindmap-search-scope-${document.id}`}
            className="min-w-0 flex-1 rounded border border-slate-200 bg-white px-1.5 py-1 text-[11px] text-slate-600 outline-none focus:border-blue-400"
            aria-label="搜索范围"
            value={scopeKind}
            onChange={(event) => setScopeKind(event.target.value as SearchScopeKind)}
          >
            <option value="branch" disabled={!canSearchBranch}>当前分支</option>
            <option value="sheet">当前 Sheet</option>
            <option value="all-sheets">全部 Sheet</option>
          </select>
          <label className="sr-only" htmlFor={`mindmap-search-field-${document.id}`}>搜索内容类型</label>
          <select
            id={`mindmap-search-field-${document.id}`}
            className="min-w-0 flex-1 rounded border border-slate-200 bg-white px-1.5 py-1 text-[11px] text-slate-600 outline-none focus:border-blue-400"
            aria-label="搜索内容类型"
            value={fieldScope}
            onChange={(event) => setFieldScope(event.target.value as SearchFieldScope)}
          >
            <option value="all">全部内容</option>
            {(Object.entries(searchFieldLabel) as Array<[MindMapSearchField, string]>).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <span
            className="w-14 text-center text-[10px] tabular-nums text-slate-500"
            aria-live="polite"
            aria-label={`搜索结果 ${cursorIndex >= 0 ? cursorIndex + 1 : 0} / ${results.total}`}
          >
            {cursorIndex >= 0 ? cursorIndex + 1 : 0}/{results.total}
          </span>
          <button
            type="button"
            className="rounded border border-slate-200 p-1 text-slate-500 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-35"
            aria-label="上一个搜索结果"
            title="上一个（Shift+Enter）"
            disabled={results.total === 0}
            onClick={() => navigate('previous')}
          >
            <ChevronUp size={13} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="rounded border border-slate-200 p-1 text-slate-500 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-35"
            aria-label="下一个搜索结果"
            title="下一个（Enter）"
            disabled={results.total === 0}
            onClick={() => navigate('next')}
          >
            <ChevronDown size={13} aria-hidden="true" />
          </button>
        </div>

        {results.active && (
          <ol
            className="mt-2 max-h-36 space-y-0.5 overflow-auto border-t border-slate-100 pt-1"
            aria-label="搜索结果"
            data-testid="mindmap-search-results"
          >
            {results.matches.length === 0 ? (
              <li className="px-2 py-2 text-center text-[10px] text-slate-400">未找到匹配内容</li>
            ) : results.matches.map((match, matchIndex) => {
              const current = sameCursor(match, cursor);
              return (
                <li key={match.key}>
                  <button
                    type="button"
                    className={`w-full rounded px-2 py-1 text-left ${current ? 'bg-blue-100 text-blue-800' : 'text-slate-700 hover:bg-slate-100'}`}
                    aria-label={`打开搜索结果 ${match.topicTitle || '无标题主题'}（${match.sheetTitle}）`}
                    aria-current={current ? 'true' : undefined}
                    data-result-index={matchIndex}
                    onClick={() => selectMatch(match)}
                  >
                    <span className="block truncate text-[11px] font-medium">
                      {highlightedTopicTitle(match)}
                    </span>
                    <span className="block truncate text-[9px] text-slate-400">
                      {match.sheetTitle} · {matchingFieldSummary(match)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <section className="flex min-h-0 flex-1 flex-col" aria-label="大纲">
        <div className="flex items-center gap-1.5 px-2 py-1.5 text-[11px] font-semibold text-slate-600">
          <ListTree size={13} aria-hidden="true" />
          <span>大纲</span>
          <span className="ml-auto font-normal text-[9px] text-slate-400">
            {index.entries.length} 个主题
          </span>
        </div>
        <div
          className="min-h-0 flex-1 overflow-auto px-1 pb-2"
          role="tree"
          aria-label="思维导图大纲"
          data-testid="mindmap-outliner-tree"
        >
          {outliner.rows.map((row) => {
            if (row.kind === 'sheet') {
              return (
                <div
                  key={`sheet:${row.sheetId}`}
                  role="treeitem"
                  aria-level={1}
                  aria-expanded={!row.collapsed}
                  className="mt-1 flex items-center gap-1 rounded px-1 py-0.5 text-slate-700 hover:bg-slate-50"
                  data-testid={`outliner-sheet-${row.sheetId}`}
                >
                  <button
                    type="button"
                    className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                    aria-label={`${row.collapsed ? '展开' : '折叠'} Sheet ${row.title}`}
                    onClick={() => toggleSheet(row.sheetId)}
                  >
                    {row.collapsed
                      ? <ChevronRight size={12} aria-hidden="true" />
                      : <ChevronDown size={12} aria-hidden="true" />}
                  </button>
                  <span className="min-w-0 truncate text-[11px] font-semibold" title={row.title}>
                    {row.title}
                  </span>
                </div>
              );
            }

            const selected = selectedTopic?.sheetId === row.sheetId
              && selectedTopic.topicId === row.topicId;
            const topicKey = outlinerTopicKey(row.sheetId, row.topicId);
            const isEditing = editingTopic?.sheetId === row.sheetId
              && editingTopic.topicId === row.topicId;
            const indentIntent = selected ? planOutlinerIndentIntent(
              document,
              row.sheetId,
              row.topicId,
              'button',
            ) : undefined;
            const outdentIntent = selected ? planOutlinerOutdentIntent(
              document,
              row.sheetId,
              row.topicId,
              'button',
            ) : undefined;
            const moveUpIntent = selected ? planOutlinerSiblingMoveIntent(
              document,
              row.sheetId,
              row.topicId,
              'up',
              'button',
            ) : undefined;
            const moveDownIntent = selected ? planOutlinerSiblingMoveIntent(
              document,
              row.sheetId,
              row.topicId,
              'down',
              'button',
            ) : undefined;
            const canDrag = !readOnly
              && row.parentTopicId !== undefined
              && (onReparentTopic !== undefined || onReorderTopic !== undefined);
            const activeDropPosition = dragOverTarget?.topicKey === topicKey
              ? dragOverTarget.position
              : undefined;
            const dropTargetClass = activeDropPosition === 'before'
              ? 'shadow-[inset_0_2px_0_#3b82f6]'
              : activeDropPosition === 'after'
                ? 'shadow-[inset_0_-2px_0_#3b82f6]'
                : activeDropPosition === 'inside'
                  ? 'bg-blue-50 ring-2 ring-inset ring-blue-400'
                  : '';
            const matchClass = row.matchState === 'match'
              ? 'bg-amber-50 text-amber-900'
              : row.matchState === 'dimmed'
                ? 'text-slate-300'
                : 'text-slate-700';
            return (
              <div
                key={`topic:${row.sheetId}:${row.topicId}`}
                role="treeitem"
                aria-level={row.rowDepth + 1}
                aria-expanded={row.hasChildren ? !row.collapsed : undefined}
                aria-selected={selected}
                className={`relative flex items-center gap-0.5 rounded py-0.5 pr-1 ${dropTargetClass} ${selected ? 'bg-blue-100 text-blue-800' : matchClass}`}
                style={{ paddingLeft: `${Math.max(2, (row.rowDepth - 1) * 12 + 2)}px` }}
                data-testid={`outliner-topic-${row.sheetId}-${row.topicId}`}
                data-match-state={row.matchState}
                data-drop-position={activeDropPosition}
                data-dragging={draggedTopic?.sheetId === row.sheetId
                  && draggedTopic.topicId === row.topicId ? 'true' : 'false'}
                draggable={canDrag}
                onDragStart={(event) => {
                  if (!canDrag) {
                    event.preventDefault();
                    return;
                  }
                  const nextDraggedTopic = { sheetId: row.sheetId, topicId: row.topicId };
                  draggedTopicRef.current = nextDraggedTopic;
                  setDraggedTopic(nextDraggedTopic);
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', topicKey);
                }}
                onDragOver={(event) => {
                  if (
                    readOnly
                    || !draggedTopicRef.current
                    || draggedTopicRef.current.sheetId !== row.sheetId
                  ) return;
                  const dragSource = draggedTopicRef.current;
                  const position = dropPosition(event);
                  const intent = planOutlinerDropIntent(
                    document,
                    dragSource,
                    { sheetId: row.sheetId, topicId: row.topicId },
                    position,
                  );
                  if (!canInvokeDropIntent(intent)) {
                    if (dragOverTarget?.topicKey === topicKey) setDragOverTarget(undefined);
                    return;
                  }
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                  setDragOverTarget({ topicKey, position });
                }}
                onDragLeave={(event) => {
                  const relatedTarget = event.relatedTarget;
                  if (
                    relatedTarget instanceof Node
                    && event.currentTarget.contains(relatedTarget)
                  ) return;
                  if (dragOverTarget?.topicKey === topicKey) setDragOverTarget(undefined);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (
                    !readOnly
                    && draggedTopicRef.current
                    && draggedTopicRef.current.sheetId === row.sheetId
                  ) {
                    const dragSource = draggedTopicRef.current;
                    invokeDropIntent(planOutlinerDropIntent(
                      document,
                      dragSource,
                      { sheetId: row.sheetId, topicId: row.topicId },
                      dropPosition(event),
                    ));
                  }
                  draggedTopicRef.current = undefined;
                  setDraggedTopic(undefined);
                  setDragOverTarget(undefined);
                }}
                onDragEnd={() => {
                  draggedTopicRef.current = undefined;
                  setDraggedTopic(undefined);
                  setDragOverTarget(undefined);
                }}
              >
                {row.hasChildren ? (
                  <button
                    type="button"
                    className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                    aria-label={`${row.collapsed ? '展开' : '折叠'}主题 ${row.title || '无标题主题'}`}
                    onClick={() => toggleTopic(row)}
                  >
                    {row.collapsed
                      ? <ChevronRight size={11} aria-hidden="true" />
                      : <ChevronDown size={11} aria-hidden="true" />}
                  </button>
                ) : <span className="inline-block w-4 shrink-0" aria-hidden="true" />}
                {canDrag && <GripVertical size={10} className="shrink-0 text-slate-300" aria-hidden="true" />}
                {isEditing ? (
                  <div
                    className="min-w-0 flex-1"
                    onKeyDownCapture={(event) => handleEditorStructureShortcut(event, row)}
                  >
                    <TopicRichTextEditor
                      initialValue={editingTopic.initialTitle}
                      ariaLabel={`编辑主题标题 ${row.title || '无标题主题'}`}
                      className="min-w-0 text-slate-800"
                      onCommit={(title) => finishTitleEdit(title)}
                      onCancel={() => finishTitleEdit()}
                    />
                  </div>
                ) : (
                  <button
                    ref={(node) => {
                      if (node) titleButtonRefs.current.set(topicKey, node);
                      else titleButtonRefs.current.delete(topicKey);
                    }}
                    type="button"
                    className="min-w-0 flex-1 truncate rounded px-1 py-0.5 text-left text-[11px] hover:bg-slate-100/80"
                    aria-label={`选择主题 ${row.title || '无标题主题'}（${document.sheets[row.sheetId]?.title ?? 'Sheet'}）`}
                    aria-keyshortcuts="F2 Enter Tab Shift+Tab Alt+ArrowUp Alt+ArrowDown"
                    title={readOnly
                      ? row.title || '无标题主题'
                      : `${row.title || '无标题主题'} · 双击/F2/Enter 编辑`}
                    onClick={() => selectTopic(row.sheetId, row.topicId)}
                    onDoubleClick={() => beginTitleEdit(row)}
                    onKeyDown={(event) => handleTopicShortcut(event, row)}
                  >
                    {row.title || '无标题主题'}
                  </button>
                )}
                {selected && (
                  <span
                    className="flex shrink-0 items-center gap-px"
                    role="group"
                    aria-label={`调整主题 ${row.title || '无标题主题'}`}
                  >
                    <button
                      type="button"
                      className="rounded p-0.5 text-slate-500 hover:bg-white disabled:cursor-not-allowed disabled:opacity-25"
                      aria-label={`提升主题 ${row.title || '无标题主题'}`}
                      title="提升（Shift+Tab）"
                      disabled={readOnly || !onReparentTopic || !outdentIntent}
                      onClick={() => invokeReparent(outdentIntent)}
                    >
                      <IndentDecrease size={10} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="rounded p-0.5 text-slate-500 hover:bg-white disabled:cursor-not-allowed disabled:opacity-25"
                      aria-label={`缩进主题 ${row.title || '无标题主题'}`}
                      title="缩进（Tab）"
                      disabled={readOnly || !onReparentTopic || !indentIntent}
                      onClick={() => invokeReparent(indentIntent)}
                    >
                      <IndentIncrease size={10} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="rounded p-0.5 text-slate-500 hover:bg-white disabled:cursor-not-allowed disabled:opacity-25"
                      aria-label={`上移主题 ${row.title || '无标题主题'}`}
                      title="上移（Alt+↑）"
                      disabled={readOnly || !onReorderTopic || !moveUpIntent}
                      onClick={() => invokeReorder(moveUpIntent)}
                    >
                      <ArrowUp size={10} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="rounded p-0.5 text-slate-500 hover:bg-white disabled:cursor-not-allowed disabled:opacity-25"
                      aria-label={`下移主题 ${row.title || '无标题主题'}`}
                      title="下移（Alt+↓）"
                      disabled={readOnly || !onReorderTopic || !moveDownIntent}
                      onClick={() => invokeReorder(moveDownIntent)}
                    >
                      <ArrowDown size={10} aria-hidden="true" />
                    </button>
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </aside>
  );
});

SearchOutlinerPanel.displayName = 'SearchOutlinerPanel';
