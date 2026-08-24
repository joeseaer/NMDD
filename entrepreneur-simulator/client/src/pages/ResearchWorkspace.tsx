import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  ChevronRight,
  FileText,
  Lightbulb,
  Link2,
  ListTree,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Tag,
  Trash2,
  UploadCloud,
  UserPlus,
  RefreshCw,
  X,
} from 'lucide-react';
import { api, CURRENT_USER_ID, type SOPContentRepairResult } from '../services/api';
import { SmartDocumentEditor, type SmartDocumentPageLink, type SmartDocumentValue, type SmartDocumentValueGetter } from '../components/SmartDocumentEditor';
import {
  normalizeDocumentRevision,
  restoreLocalDocumentDraft,
  useRevisionedSaveQueue,
  type DocumentSaveStatus,
} from '../features/document-editor/useRevisionedSaveQueue';
import { DocumentSaveIndicator } from '../features/document-editor/ui/DocumentSaveIndicator';
import {
  DocumentPageHeader,
  DocumentProperties,
  DocumentProperty,
  DocumentTopbar,
  DocumentWorkspaceShell,
} from '../components/document';
import { DocumentViewControls } from '../features/document-editor/ui/DocumentViewControls';
import { useDocumentViewPreferences } from '../features/document-editor/useDocumentViewPreferences';
import { withoutRelationsForDocumentAutosave } from '../features/document-editor/savePayload';
import { DocumentExportMenu } from '../features/document-editor/ui/DocumentExportMenu';
import { GuardedLink, useDocumentNavigationGuard } from '../features/document-editor/navigation/DocumentNavigationGuard';
import { documentLinksToPage } from '../features/document-editor/pageLinks/pageLinkIndex';
import { DocumentPageTree } from '../features/document-tree/DocumentPageTree';
import {
  formatDocumentDate,
  formatDocumentPath,
  getDocumentAncestors,
  getDocumentChildren,
  getDocumentDescendantIds,
} from '../features/document-tree/documentTree';

type ResearchType = 'document' | 'idea' | 'meeting';
type ResearchStatus = 'seed' | 'to_verify' | 'absorbed' | 'paused';

type RelatedPerson = {
  id: string;
  name: string;
  role?: string;
  identity?: string;
};

type ResearchItem = {
  id: string;
  title: string;
  category: 'note' | 'people' | 'business' | 'brand';
  domain: 'research';
  research_type: ResearchType;
  research_status?: ResearchStatus | null;
  promoted_to_life?: boolean;
  promoted_at?: string | null;
  parent_id?: string | null;
  sort_order?: number;
  structure_updated_at?: string | null;
  tags: string[];
  version: string;
  created_at: string;
  updated_at: string;
  content: string;
  content_json?: any | null;
  content_schema_version?: number;
  content_revision?: number | null;
  related: {
    scenes: { id: string; title: string; score: number; date: string }[];
    people: RelatedPerson[];
    sops: { id: string; title: string }[];
  };
  history: { version: string; date: string; note: string }[];
  validation: { scene: string; date: string; score: number; note: string }[];
  stats: {
    use_count: number;
    avg_score: number;
    last_used: string;
    related_scenes_count: number;
  };
};

type ResearchSavePayload = Omit<ResearchItem, 'related'> & {
  related?: ResearchItem['related'];
};

type ResearchUpdateOptions = {
  persistRelations?: boolean;
  flush?: boolean;
};

type PromoteDraft = {
  title: string;
  what: string;
  why: string;
  impact: string;
  followup: string;
};

const RESEARCH_TYPES: Array<{ key: ResearchType; label: string; description: string }> = [
  { key: 'document', label: '文档', description: '长文、论文笔记、方法记录' },
  { key: 'idea', label: '想法', description: '灵感、假设、待验证问题' },
  { key: 'meeting', label: '会议', description: '会前准备、讨论记录、会后总结' },
];

const STATUS_LABELS: Record<ResearchStatus, string> = {
  seed: '萌芽',
  to_verify: '待验证',
  absorbed: '已吸收',
  paused: '暂搁置',
};

const STATUS_STYLES: Record<ResearchStatus, string> = {
  seed: 'bg-amber-50 text-amber-700 border-amber-100',
  to_verify: 'bg-sky-50 text-sky-700 border-sky-100',
  absorbed: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  paused: 'bg-gray-50 text-gray-600 border-gray-100',
};

const isResearchType = (value: string | null): value is ResearchType => (
  value === 'document' || value === 'idea' || value === 'meeting'
);

const isResearchStatus = (value: unknown): value is ResearchStatus => (
  value === 'seed' || value === 'to_verify' || value === 'absorbed' || value === 'paused'
);

const normalizeResearchItem = (raw: any): ResearchItem => {
  const researchType: ResearchType = isResearchType(raw?.research_type) ? raw.research_type : 'document';
  const related = raw?.related && typeof raw.related === 'object' ? raw.related : {};
  return {
    id: String(raw?.id || ''),
    title: String(raw?.title || ''),
    category: raw?.category === 'people' || raw?.category === 'business' || raw?.category === 'brand' ? raw.category : 'note',
    domain: 'research',
    research_type: researchType,
    research_status: researchType === 'idea' ? (isResearchStatus(raw?.research_status) ? raw.research_status : 'seed') : null,
    promoted_to_life: !!raw?.promoted_to_life,
    promoted_at: raw?.promoted_at || null,
    parent_id: raw?.parent_id ? String(raw.parent_id) : null,
    sort_order: Number.isSafeInteger(Number(raw?.sort_order)) ? Number(raw.sort_order) : 0,
    structure_updated_at: raw?.structure_updated_at || null,
    tags: Array.isArray(raw?.tags) ? raw.tags.map((tag: any) => String(tag)).filter(Boolean) : [],
    version: String(raw?.version || 'V1.0'),
    created_at: String(raw?.created_at || ''),
    updated_at: String(raw?.updated_at || ''),
    content: String(raw?.content || ''),
    content_json: raw?.content_json || null,
    content_schema_version: Number(raw?.content_schema_version || 1),
    content_revision: normalizeDocumentRevision(raw?.content_revision),
    related: {
      scenes: Array.isArray(related.scenes) ? related.scenes : [],
      people: Array.isArray(related.people) ? related.people : [],
      sops: Array.isArray(related.sops) ? related.sops : [],
    },
    history: Array.isArray(raw?.history) ? raw.history : [],
    validation: Array.isArray(raw?.validation) ? raw.validation : [],
    stats: raw?.stats && typeof raw.stats === 'object'
      ? {
          use_count: Number(raw.stats.use_count || 0),
          avg_score: Number(raw.stats.avg_score || 0),
          last_used: String(raw.stats.last_used || '-'),
          related_scenes_count: Number(raw.stats.related_scenes_count || 0),
        }
      : { use_count: 0, avg_score: 0, last_used: '-', related_scenes_count: 0 },
  };
};

const makeTemplate = (type: ResearchType) => {
  if (type === 'meeting') {
    return [
      '# 新会议纪要',
      '',
      '## 会前准备',
      '',
      '## 讨论记录',
      '',
      '## 会后总结',
      '',
      '## 行动项',
      '- ',
    ].join('\n');
  }

  if (type === 'idea') {
    return [
      '# 新想法',
      '',
      '## 核心想法',
      '',
      '## 待验证问题',
      '',
      '## 可能用途',
      '',
    ].join('\n');
  }

  return '';
};

const makeDefaultTitle = (type: ResearchType) => {
  if (type === 'idea') return '新想法';
  if (type === 'meeting') return '新会议纪要';
  return '未命名科研文档';
};

const getDocumentNodeText = (node: any): string => {
  if (!node || typeof node !== 'object') return '';
  if (typeof node.text === 'string') return node.text;
  if (!Array.isArray(node.content)) return '';
  return node.content.map(getDocumentNodeText).join('');
};

const cleanTitleCandidate = (value: string) => value
  .replace(/^\s{0,3}(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s*)/, '')
  .replace(/[*_~`]+/g, '')
  .replace(/\s+/g, ' ')
  .trim();

export const inferResearchDocumentTitle = (value: SmartDocumentValue): string | null => {
  const topLevelNodes = Array.isArray(value.json?.content) ? value.json.content : [];
  const proseNodes = topLevelNodes.filter((node: any) => (
    node?.type === 'heading' || node?.type === 'paragraph' || node?.type === 'blockquote'
  ));
  const orderedNodes = [
    ...proseNodes.filter((node: any) => node?.type === 'heading'),
    ...proseNodes.filter((node: any) => node?.type !== 'heading'),
  ];

  for (const node of orderedNodes) {
    const candidate = cleanTitleCandidate(getDocumentNodeText(node));
    if (candidate && candidate.length <= 50) return candidate;
  }

  const markdownLines = String(value.markdown || value.text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('```'))
    .filter((line) => !/^(?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|mindmap)\b/i.test(line));

  for (const line of markdownLines) {
    const candidate = cleanTitleCandidate(line);
    if (candidate && candidate.length <= 50) return candidate;
  }

  const diagramNode = topLevelNodes.find((node: any) => (
    node?.type === 'codeBlock' && String(node?.attrs?.language || '').toLowerCase() === 'mermaid'
  ));
  return diagramNode ? 'Mermaid 图表' : null;
};

export default function ResearchWorkspace() {
  const [items, setItems] = useState<ResearchItem[]>([]);
  const [people, setPeople] = useState<RelatedPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [promotingId, setPromotingId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [libraryCollapsed, setLibraryCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    const stored = window.localStorage.getItem('nmdd.research.library-collapsed.v2');
    return stored === 'true';
  });
  const activeEditorFlushRef = React.useRef<(() => Promise<void>) | null>(null);
  const urlSyncTargetRef = React.useRef<string | undefined>(undefined);
  const documentSwitchRequestRef = React.useRef(0);
  const [showMobileSidebar, setShowMobileSidebar] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  const activeType: ResearchType = isResearchType(searchParams.get('type')) ? searchParams.get('type') as ResearchType : 'document';
  const docParam = searchParams.get('doc');
  const selectedItem = items.find((item) => item.id === selectedItemId) || null;
  const showMainContent = Boolean(selectedItem || selectedItemId || (docParam && loading));
  const shouldShowSidebar = showMobileSidebar || !showMainContent;
  const desktopLibraryHidden = Boolean(selectedItemId && libraryCollapsed);

  useEffect(() => {
    window.localStorage.setItem('nmdd.research.library-collapsed.v2', String(libraryCollapsed));
  }, [libraryCollapsed]);

  const pages = useMemo<SmartDocumentPageLink[]>(() => (
    items.map((item) => ({
      id: item.id,
      title: item.title || makeDefaultTitle(item.research_type),
      category: item.research_type,
      href: `/research?type=${item.research_type}&doc=${encodeURIComponent(item.id)}`,
    }))
  ), [items]);
  const backlinks = useMemo<SmartDocumentPageLink[]>(() => (
    selectedItemId
      ? items
          .filter((item) => item.id !== selectedItemId && documentLinksToPage(item.content_json, selectedItemId))
          .map((item) => ({
            id: item.id,
            title: item.title || makeDefaultTitle(item.research_type),
            category: item.research_type,
            href: `/research?type=${item.research_type}&doc=${encodeURIComponent(item.id)}`,
          }))
      : []
  ), [items, selectedItemId]);

  const handleOptimisticResearchUpdate = useCallback((updatedItem: ResearchSavePayload) => {
    setItems((current) => current.map((item) => item.id === updatedItem.id
      ? {
          ...item,
          ...updatedItem,
          related: updatedItem.related ?? item.related,
        }
      : item));
  }, []);

  const handleConfirmedResearchSave = useCallback((id: string, result: {
    content_revision?: number | null;
    content_schema_version?: number;
  }) => {
    setItems((current) => current.map((item) => item.id === id
      ? {
          ...item,
          content_revision: normalizeDocumentRevision(result.content_revision) ?? item.content_revision,
          content_schema_version: Number(result.content_schema_version || item.content_schema_version || 1),
        }
      : item));
  }, []);

  const saveQueue = useRevisionedSaveQueue<ResearchSavePayload>({
    saveDocument: api.createSOP,
    onOptimisticUpdate: handleOptimisticResearchUpdate,
    onConfirmed: handleConfirmedResearchSave,
  });
  const selectedSaveStatus = saveQueue.getStatus(selectedItemId);
  useDocumentNavigationGuard(flushBeforeNavigation, Boolean(selectedItemId));

  const fetchData = async () => {
    try {
      setLoading(true);
      setLoadError(null);
      const [rawItems, rawPeople] = await Promise.all([
        api.getSOPs(CURRENT_USER_ID, { domain: 'research' }),
        api.getAllPeople(CURRENT_USER_ID),
      ]);
      const normalizedItems = (Array.isArray(rawItems) ? rawItems : [])
        .map(normalizeResearchItem)
        .filter((item) => item.id);
      const restoredItems = normalizedItems.map((item) => {
        const restored = restoreLocalDocumentDraft(item);
        if (restored !== item && normalizeDocumentRevision(item.content_revision) !== null) {
          // A recovered draft may contain an explicit relation edit, so its
          // one-time retry must preserve the complete stored payload. Legacy
          // databases have no CAS revision, so their drafts remain visible
          // locally but are never replayed automatically over remote content.
          saveQueue.schedule(restored);
        }
        return restored;
      });
      setItems(restoredItems);
      setPeople((Array.isArray(rawPeople) ? rawPeople : []).map((person: any) => ({
        id: String(person?.id || ''),
        name: String(person?.name || ''),
        role: String(person?.identity || person?.role || ''),
        identity: String(person?.identity || ''),
      })).filter((person) => person.id && person.name));
    } catch (error) {
      console.error('Failed to load research workspace', error);
      setLoadError('科研记录加载失败。请检查本地服务或网络连接后重试。');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    const target = docParam ? items.find((item) => item.id === docParam) || null : null;
    if (docParam && !target) return;
    const desiredId = target?.id || null;
    const targetKey = desiredId || '__research_list__';

    // A click updates React state and the URL in two separate render passes.
    // Ignore the transient render that still carries the previous URL; otherwise
    // it can race the click and reopen the document the user just left.
    if (urlSyncTargetRef.current !== undefined && urlSyncTargetRef.current !== targetKey) return;

    if (desiredId === selectedItemId) {
      urlSyncTargetRef.current = undefined;
      if (target && target.research_type !== activeType) {
        setSearchParams({ type: target.research_type, doc: target.id }, { replace: true });
      }
      return;
    }

    if (urlSyncTargetRef.current === targetKey) {
      urlSyncTargetRef.current = undefined;
      setSelectedItemId(desiredId);
      setShowMobileSidebar(false);
      return;
    }

    if (!selectedItemId) {
      setSelectedItemId(desiredId);
      setShowMobileSidebar(false);
      return;
    }

    urlSyncTargetRef.current = targetKey;
    void (async () => {
      const canLeave = await flushBeforeNavigation();
      if (urlSyncTargetRef.current !== targetKey) return;
      urlSyncTargetRef.current = undefined;
      if (!canLeave) {
        const current = items.find((item) => item.id === selectedItemId);
        if (current) {
          setSearchParams({ type: current.research_type, doc: current.id }, { replace: true });
        }
        return;
      }
      setSelectedItemId(desiredId);
      setShowMobileSidebar(false);
      if (target) {
        setSearchParams({ type: target.research_type, doc: target.id }, { replace: true });
      }
    })();
  }, [activeType, docParam, items, selectedItemId, setSearchParams]);

  const pageTreeItems = items.filter((item) => item.research_type === activeType);
  const matchingItems = pageTreeItems.filter((item) => {
      const query = searchTerm.trim().toLowerCase();
      if (!query) return true;
      return (
        item.title.toLowerCase().includes(query) ||
        item.content.toLowerCase().includes(query) ||
        item.tags.some((tag) => tag.toLowerCase().includes(query))
      );
    });
  const matchingPageIds = searchTerm.trim()
    ? new Set(matchingItems.map((item) => item.id))
    : undefined;
  const selectedAncestors = selectedItem ? getDocumentAncestors(items, selectedItem.id) : [];
  const selectedChildren = selectedItem ? getDocumentChildren(items, selectedItem.id) : [];
  const moveTargets = selectedItem
    ? (() => {
        const excluded = getDocumentDescendantIds(items, selectedItem.id);
        excluded.add(selectedItem.id);
        return items.filter((item) => item.research_type === selectedItem.research_type && !excluded.has(item.id));
      })()
    : [];

  const handleUpdateItem = useCallback((updatedItem: ResearchItem, options: ResearchUpdateOptions = {}) => {
    if (options.persistRelations) {
      saveQueue.schedule(updatedItem);
    } else {
      saveQueue.schedule(withoutRelationsForDocumentAutosave(updatedItem));
    }
    if (options.flush) void saveQueue.flush();
  }, [saveQueue]);

  const handleRecoveredItem = useCallback((
    id: string,
    value: SmartDocumentValue,
    result: SOPContentRepairResult,
  ) => {
    const current = items.find((item) => item.id === id);
    if (!current) return;
    saveQueue.acceptExternalSave(withoutRelationsForDocumentAutosave({
      ...current,
      content: value.markdown,
      content_json: value.json,
      content_schema_version: result.content_schema_version || current.content_schema_version,
      content_revision: normalizeDocumentRevision(result.content_revision) ?? current.content_revision,
      updated_at: new Date().toISOString(),
    }), result);
  }, [items, saveQueue]);

  const handleCreateItem = async (parentId: string | null = null) => {
    if (!await flushBeforeNavigation()) return;
    setLoading(true);
    const content = makeTemplate(activeType);
    const newItem: Partial<ResearchItem> = {
      title: makeDefaultTitle(activeType),
      category: 'note',
      domain: 'research',
      research_type: activeType,
      research_status: activeType === 'idea' ? 'seed' : null,
      promoted_to_life: false,
      parent_id: parentId,
      sort_order: Date.now(),
      tags: [],
      version: 'V1.0',
      content,
      content_json: null,
      related: { scenes: [], people: [], sops: [] },
      history: [{ version: 'V1.0', date: new Date().toISOString().split('T')[0], note: '初始创建' }],
      stats: { use_count: 0, avg_score: 0, last_used: '-', related_scenes_count: 0 },
      validation: [],
    };

    try {
      const result = await api.createSOP(newItem);
      if (!result?.id) throw new Error('Server response missing ID');
      const createdItem = {
        ...newItem,
        id: result.id,
        content_schema_version: Number(result.content_schema_version || 1),
        content_revision: normalizeDocumentRevision(result.content_revision),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as ResearchItem;
      setItems((prev) => [createdItem, ...prev]);
      urlSyncTargetRef.current = result.id;
      setSelectedItemId(result.id);
      setSearchParams({ type: activeType, doc: result.id });
    } catch (error: any) {
      console.error('Failed to create research item', error);
      alert(`创建失败：${error.message || 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteItem = async (id: string) => {
    if (!confirm('确定删除这条科研记录吗？子页面会保留并提升一级，此操作无法撤销。')) return;
    try {
      const result = await api.deleteSOP(id);
      setItems((prev) => prev
        .filter((item) => item.id !== id)
        .map((item) => item.parent_id === id
          ? { ...item, parent_id: result.parent_id || null }
          : item));
      if (selectedItemId === id) {
        urlSyncTargetRef.current = '__research_list__';
        setSelectedItemId(null);
        setSearchParams({ type: activeType });
      }
    } catch (error) {
      console.error('Failed to delete research item', error);
      alert('删除失败，请重试');
    }
  };

  const handleMoveItem = async (id: string, parentId: string | null) => {
    if (!await flushBeforeNavigation()) return;
    try {
      const result = await api.updateSOPLocation(id, {
        parent_id: parentId,
        sort_order: Date.now(),
        userId: CURRENT_USER_ID,
      });
      setItems((current) => current.map((item) => item.id === id
        ? {
            ...item,
            parent_id: result.parent_id,
            sort_order: result.sort_order,
            structure_updated_at: result.structure_updated_at || null,
          }
        : item));
    } catch (error) {
      console.error('Failed to move research page', error);
      alert(error instanceof Error ? error.message : '移动页面失败，请重试');
    }
  };

  const handleOpenItem = async (item: ResearchItem) => {
    if (selectedItemId === item.id) {
      setShowMobileSidebar(false);
      return;
    }

    const requestId = ++documentSwitchRequestRef.current;
    if (!await flushEditorBeforeDocumentSwitch()) return;
    if (documentSwitchRequestRef.current !== requestId) return;

    urlSyncTargetRef.current = item.id;
    setSelectedItemId(item.id);
    setShowMobileSidebar(false);
    setSearchParams({ type: item.research_type, doc: item.id });
  };

  const handleSwitchType = async (type: ResearchType) => {
    if (!await flushBeforeNavigation()) return;
    urlSyncTargetRef.current = '__research_list__';
    setSelectedItemId(null);
    setSearchParams({ type });
  };

  async function flushEditorBeforeDocumentSwitch() {
    try {
      await activeEditorFlushRef.current?.();
    } catch (error) {
      alert(error instanceof Error ? error.message : '附件仍在上传，请稍后再离开文档。');
      return false;
    }

    return true;
  }

  async function flushBeforeNavigation() {
    if (!await flushEditorBeforeDocumentSwitch()) return false;

    const result = await saveQueue.flush();
    if (result.ok) return true;
    alert(result.conflictedIds.length
      ? '文档与其他窗口发生冲突。请先处理冲突，当前内容仍保留在本地。'
      : '文档尚未保存成功。请重试保存后再离开，当前内容仍保留在本地。');
    return false;
  }

  const handlePromote = async (item: ResearchItem, draft: PromoteDraft) => {
    setPromotingId(item.id);
    try {
      const result = await api.promoteSOPToLife(item.id, {
        userId: CURRENT_USER_ID,
        title: draft.title,
        summary: {
          what: draft.what,
          why: draft.why,
          impact: draft.impact,
          followup: draft.followup,
        },
      });
      setItems((prev) => prev.map((it) => it.id === item.id ? {
        ...it,
        promoted_to_life: true,
        promoted_at: result?.promoted_at || new Date().toISOString(),
      } : it));
    } finally {
      setPromotingId(null);
    }
  };

  return (
    <div className="flex h-full overflow-hidden rounded-lg border border-gray-200 bg-white">
      {showMobileSidebar && selectedItemId && (
        <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setShowMobileSidebar(false)} />
      )}

      <aside className={`
        fixed inset-y-0 left-0 z-50 flex w-80 flex-col border-r border-gray-100 bg-white transition-transform duration-300 lg:static lg:translate-x-0
        ${shouldShowSidebar ? 'translate-x-0' : '-translate-x-full'}
        ${selectedItemId ? 'hidden' : 'flex'}
        ${desktopLibraryHidden ? 'lg:hidden' : 'lg:flex'}
      `}>
        <div className="flex items-center justify-between border-b border-gray-100 p-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900">科研工作台</h2>
            <div className="mt-1 text-xs text-gray-500">独立科研记录区</div>
          </div>
          <div className="flex items-center gap-1">
            {selectedItemId ? (
              <button type="button" onClick={() => setLibraryCollapsed(true)} className="hidden rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 lg:inline-flex" title="收起科研文档列表" aria-label="收起科研文档列表">
                <PanelLeftClose className="h-4 w-4" />
              </button>
            ) : null}
            <button onClick={() => setShowMobileSidebar(false)} className="text-gray-500 lg:hidden">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="border-b border-gray-100 p-3">
          <div className="grid grid-cols-3 gap-1 rounded-lg bg-gray-50 p-1">
            {RESEARCH_TYPES.map((type) => (
              <button
                key={type.key}
                type="button"
                onClick={() => void handleSwitchType(type.key)}
                className={`rounded-md px-2 py-2 text-xs font-medium transition-colors ${
                  activeType === type.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:bg-white/70'
                }`}
              >
                {type.label}
              </button>
            ))}
          </div>
        </div>

        <div className="border-b border-gray-100 p-4">
          <div className="relative mb-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              className="block w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pl-10 pr-3 text-sm placeholder-gray-400 transition-colors focus:border-primary focus:bg-white focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder={`搜索${RESEARCH_TYPES.find((type) => type.key === activeType)?.label || '记录'}...`}
            />
          </div>
          <button
            type="button"
            onClick={() => void handleCreateItem()}
            className="flex w-full items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-primary/90"
          >
            <Plus className="mr-2 h-4 w-4" />
            新建{RESEARCH_TYPES.find((type) => type.key === activeType)?.label || '记录'}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {loading && items.length === 0 ? (
            <div className="flex justify-center p-6">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-200 border-b-primary" />
            </div>
          ) : loadError && items.length === 0 ? (
            <div className="m-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" role="alert">
              <div className="font-medium">无法载入科研记录</div>
              <p className="mt-1 text-xs leading-5 text-amber-700">{loadError}</p>
              <button
                type="button"
                onClick={() => void fetchData()}
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium transition-colors hover:bg-amber-100"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                重新加载
              </button>
            </div>
          ) : (
            <DocumentPageTree
              items={pageTreeItems}
              selectedId={selectedItemId}
              matchingIds={matchingPageIds}
              storageKey={`nmdd.research.page-tree.expanded.${activeType}`}
              emptyMessage="暂无记录"
              onSelect={(item) => void handleOpenItem(item)}
              onCreateChild={(item) => void handleCreateItem(item.id)}
              renderIcon={(item, active) => {
                const Icon = item.research_type === 'idea'
                  ? Lightbulb
                  : item.research_type === 'meeting'
                    ? MessageSquare
                    : FileText;
                return <Icon className={`h-3.5 w-3.5 ${active ? 'text-primary' : ''}`} aria-hidden="true" />;
              }}
              renderTrailing={(item) => item.research_type === 'idea' && item.research_status ? (
                <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-normal ${STATUS_STYLES[item.research_status]}`}>
                  {STATUS_LABELS[item.research_status]}
                </span>
              ) : null}
            />
          )}
        </div>
      </aside>

      <main className={`min-w-0 flex-1 bg-white ${!showMainContent ? 'hidden lg:flex' : 'flex'}`}>
        {selectedItem ? (
          <ResearchDetail
            item={selectedItem}
            people={people}
            pages={pages}
            backlinks={backlinks}
            ancestors={selectedAncestors}
            childPages={selectedChildren}
            moveTargets={moveTargets}
            onCreateChild={() => handleCreateItem(selectedItem.id)}
            onMove={(parentId) => handleMoveItem(selectedItem.id, parentId)}
            libraryCollapsed={desktopLibraryHidden}
            onOpenLibrary={() => setLibraryCollapsed(false)}
            saveStatus={selectedSaveStatus}
            onRetrySave={() => saveQueue.retry(selectedItem.id)}
            onReloadAfterConflict={() => window.location.reload()}
            serializationFlushRef={activeEditorFlushRef}
            onRecoveryRepaired={(value, result) => handleRecoveredItem(selectedItem.id, value, result)}
            isPromoting={promotingId === selectedItem.id}
            onBack={async () => {
              if (!await flushBeforeNavigation()) return;
              urlSyncTargetRef.current = '__research_list__';
              setSelectedItemId(null);
              setSearchParams({ type: activeType });
            }}
            onUpdate={handleUpdateItem}
            onDelete={() => handleDeleteItem(selectedItem.id)}
            onPromote={(draft) => handlePromote(selectedItem, draft)}
          />
        ) : docParam && loading ? (
          <div className="flex flex-1 items-center justify-center text-sm text-gray-400">正在打开科研记录...</div>
        ) : docParam && loadError ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-amber-50/30 px-6 text-center" role="alert">
            <div className="text-sm font-medium text-amber-900">科研记录暂时无法打开</div>
            <p className="max-w-md text-xs leading-5 text-amber-700">{loadError}</p>
            <button type="button" onClick={() => void fetchData()} className="inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm text-amber-800 hover:bg-amber-50">
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              重新加载
            </button>
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center bg-gray-50/30 text-gray-400">
            <FileText className="mb-4 h-16 w-16 opacity-20" />
            <p>选择或创建一条科研记录</p>
          </div>
        )}
      </main>
    </div>
  );
}

function ResearchDetail({
  item,
  people,
  pages,
  backlinks,
  ancestors,
  childPages,
  moveTargets,
  onCreateChild,
  onMove,
  libraryCollapsed,
  onOpenLibrary,
  saveStatus,
  onRetrySave,
  onReloadAfterConflict,
  serializationFlushRef,
  onRecoveryRepaired,
  isPromoting,
  onBack,
  onUpdate,
  onDelete,
  onPromote,
}: {
  item: ResearchItem;
  people: RelatedPerson[];
  pages: SmartDocumentPageLink[];
  backlinks: SmartDocumentPageLink[];
  ancestors: ResearchItem[];
  childPages: ResearchItem[];
  moveTargets: ResearchItem[];
  onCreateChild: () => Promise<void>;
  onMove: (parentId: string | null) => Promise<void>;
  libraryCollapsed: boolean;
  onOpenLibrary: () => void;
  saveStatus: DocumentSaveStatus;
  onRetrySave: () => void;
  onReloadAfterConflict: () => void;
  serializationFlushRef: React.MutableRefObject<(() => Promise<void>) | null>;
  onRecoveryRepaired: (value: SmartDocumentValue, result: SOPContentRepairResult) => void;
  isPromoting: boolean;
  onBack: () => void | Promise<void>;
  onUpdate: (item: ResearchItem, options?: ResearchUpdateOptions) => void;
  onDelete: () => void;
  onPromote: (draft: PromoteDraft) => Promise<void>;
}) {
  const [showPromote, setShowPromote] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [fullscreenEntryWidth, setFullscreenEntryWidth] = useState<number | null>(null);
  const workspaceShellRef = React.useRef<HTMLDivElement | null>(null);
  const exportValueRef = React.useRef<SmartDocumentValueGetter | null>(null);
  const {
    mode, setMode, theme, setTheme,
    width, setWidth, font, setFont, smallText, setSmallText,
  } = useDocumentViewPreferences();
  const handleFullscreenChange = useCallback((nextFullscreen: boolean) => {
    if (nextFullscreen) {
      const currentWidth = workspaceShellRef.current
        ?.querySelector<HTMLElement>('.smart-document-shell__page')
        ?.getBoundingClientRect().width || 0;
      setFullscreenEntryWidth(currentWidth > 0 ? Math.round(currentWidth) : null);
    } else {
      setFullscreenEntryWidth(null);
    }
    setIsFullscreen(nextFullscreen);
  }, []);
  const handleWidthChange = useCallback((nextWidth: typeof width) => {
    setWidth(nextWidth);
    // Entering fullscreen preserves the existing page geometry. A deliberate
    // width choice made while fullscreen unlocks that geometry immediately.
    if (isFullscreen) setFullscreenEntryWidth(null);
  }, [isFullscreen, setWidth]);
  const handleBackFromEditor = async () => {
    await onBack();
  };
  const [promoteDraft, setPromoteDraft] = useState<PromoteDraft>(() => ({
    title: `科研上浮：${item.title || makeDefaultTitle(item.research_type)}`,
    what: item.title || '',
    why: '',
    impact: '',
    followup: '',
  }));

  useEffect(() => {
    setOutlineOpen(false);
  }, [item.id]);

  useEffect(() => {
    setPromoteDraft({
      title: `科研上浮：${item.title || makeDefaultTitle(item.research_type)}`,
      what: item.title || '',
      why: '',
      impact: '',
      followup: '',
    });
  }, [item.id]);

  useEffect(() => {
    if (!isFullscreen) return;
    const previousOverflow = document.body.style.overflow;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handleFullscreenChange(false);
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleEscape);
    };
  }, [handleFullscreenChange, isFullscreen]);

  const handleTitleChange = (title: string) => {
    onUpdate({ ...item, title, updated_at: new Date().toISOString() });
  };

  const handleTagsChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const tags = event.target.value.split(',').map((tag) => tag.trim()).filter(Boolean);
    onUpdate({ ...item, tags, updated_at: new Date().toISOString() });
  };

  const handleContentUpdate = (value: SmartDocumentValue) => {
    let nextTitle = item.title;
    if (!item.title || item.title === makeDefaultTitle(item.research_type)) {
      nextTitle = inferResearchDocumentTitle(value) || nextTitle;
    }

    onUpdate({
      ...item,
      title: nextTitle,
      content: value.markdown,
      content_json: value.json,
      updated_at: new Date().toISOString(),
    });
  };

  const addPerson = (personId: string) => {
    if (!personId) return;
    const person = people.find((candidate) => candidate.id === personId);
    if (!person) return;
    const currentPeople = item.related.people || [];
    if (currentPeople.some((candidate) => candidate.id === person.id)) return;
    onUpdate({
      ...item,
      related: {
        ...item.related,
        people: [...currentPeople, { id: person.id, name: person.name, role: person.identity || person.role || '' }],
      },
      updated_at: new Date().toISOString(),
    }, { persistRelations: true, flush: true });
  };

  const removePerson = (personId: string) => {
    onUpdate({
      ...item,
      related: {
        ...item.related,
        people: (item.related.people || []).filter((person) => person.id !== personId),
      },
      updated_at: new Date().toISOString(),
    }, { persistRelations: true, flush: true });
  };

  const updateStatus = (status: ResearchStatus) => {
    onUpdate({ ...item, research_status: status, updated_at: new Date().toISOString() });
  };

  return (
    <>
      <DocumentWorkspaceShell
        ref={workspaceShellRef}
        className="flex-1"
        data-testid="research-document-workspace"
        data-fullscreen-width-locked={fullscreenEntryWidth ? 'true' : 'false'}
        style={fullscreenEntryWidth ? ({
          '--smart-doc-fullscreen-entry-width': `${fullscreenEntryWidth}px`,
        } as React.CSSProperties) : undefined}
        theme={theme}
        mode={mode}
        width={width}
        font={font}
        smallText={smallText}
        fullscreen={isFullscreen}
        scrollMode="workspace"
        topbar={(
          <DocumentTopbar
            leading={(
              <>
                <button type="button" onClick={handleBackFromEditor} className="smart-document-icon-button lg:hidden" aria-label="返回科研记录列表">
                  <ArrowLeft aria-hidden="true" />
                </button>
                {libraryCollapsed ? (
                  <button type="button" onClick={onOpenLibrary} className="smart-document-icon-button hidden lg:inline-flex" aria-label="打开科研文档列表" title="打开科研文档列表">
                    <PanelLeftOpen aria-hidden="true" />
                  </button>
                ) : null}
              </>
            )}
            center={(
              <span className="smart-document-breadcrumbs">
                <span>科研工作台</span>
                <ChevronRight aria-hidden="true" />
                <span>{RESEARCH_TYPES.find(type => type.key === item.research_type)?.label || '科研记录'}</span>
                {ancestors.map((page) => (
                  <React.Fragment key={page.id}>
                    <ChevronRight aria-hidden="true" />
                    <GuardedLink
                      to={`/research?type=${page.research_type}&doc=${encodeURIComponent(page.id)}`}
                      className="smart-document-breadcrumb-link"
                    >
                      {page.title || makeDefaultTitle(page.research_type)}
                    </GuardedLink>
                  </React.Fragment>
                ))}
                <ChevronRight aria-hidden="true" />
                <strong>{item.title || makeDefaultTitle(item.research_type)}</strong>
              </span>
            )}
            actions={(
              <>
                <DocumentSaveIndicator status={saveStatus} onRetry={onRetrySave} onReload={onReloadAfterConflict} />
                <button
                  type="button"
                  className="smart-document-icon-button"
                  data-smart-document-outline-toggle
                  data-active={outlineOpen ? 'true' : 'false'}
                  aria-label={outlineOpen ? '隐藏文档大纲' : '显示文档大纲'}
                  aria-pressed={outlineOpen}
                  aria-controls="smart-document-outline"
                  title={outlineOpen ? '隐藏文档大纲' : '显示文档大纲'}
                  onClick={() => setOutlineOpen(current => !current)}
                >
                  <ListTree aria-hidden="true" />
                </button>
                <DocumentViewControls
                  mode={mode}
                  theme={theme}
                  width={width}
                  font={font}
                  smallText={smallText}
                  fullscreen={isFullscreen}
                  onModeChange={setMode}
                  onThemeChange={setTheme}
                  onWidthChange={handleWidthChange}
                  onFontChange={setFont}
                  onSmallTextChange={setSmallText}
                  onFullscreenChange={handleFullscreenChange}
                />
                <DocumentExportMenu
                  title={item.title || makeDefaultTitle(item.research_type)}
                  valueRef={exportValueRef}
                  beforeExport={async () => serializationFlushRef.current?.()}
                />
                <button
                  type="button"
                  onClick={() => setShowPromote(true)}
                  disabled={isPromoting}
                  className="research-promote-button inline-flex min-h-9 flex-none items-center gap-1.5 whitespace-nowrap rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 text-sm font-medium text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-60"
                  aria-label={item.promoted_to_life ? '再次上浮到人生主线' : '上浮到人生主线'}
                  title={item.promoted_to_life ? '再次上浮到人生主线' : '上浮到人生主线'}
                >
                  <UploadCloud className="h-4 w-4" aria-hidden="true" />
                  <span className="research-promote-button__label">{item.promoted_to_life ? '再次上浮' : '上浮到人生主线'}</span>
                </button>
                <button type="button" onClick={onDelete} className="smart-document-icon-button text-red-500" title="删除" aria-label="删除科研记录">
                  <Trash2 aria-hidden="true" />
                </button>
              </>
            )}
          />
        )}
        header={(
          <DocumentPageHeader
            title={item.title}
            onTitleChange={handleTitleChange}
            readOnly={mode === 'read'}
            titlePlaceholder="科研记录标题"
            icon={item.research_type === 'idea' ? <Lightbulb /> : item.research_type === 'meeting' ? <MessageSquare /> : <FileText />}
            eyebrow={(
              <span className="smart-document-page-path">
                <span>RESEARCH WORKSPACE</span>
                {ancestors.map((page) => (
                  <React.Fragment key={page.id}>
                    <ChevronRight aria-hidden="true" />
                    <GuardedLink to={`/research?type=${page.research_type}&doc=${encodeURIComponent(page.id)}`}>
                      {page.title || makeDefaultTitle(page.research_type)}
                    </GuardedLink>
                  </React.Fragment>
                ))}
              </span>
            )}
            description={RESEARCH_TYPES.find(type => type.key === item.research_type)?.label}
            meta={(
              <>
                <span>{item.version || 'V1.0'}</span>
                <span>创建于 {formatDocumentDate(item.created_at)}</span>
                <span>更新于 {formatDocumentDate(item.updated_at)}</span>
                {item.promoted_to_life ? <span className="text-emerald-600">已上浮到人生主线</span> : null}
              </>
            )}
          />
        )}
        properties={(
          <DocumentProperties>
            <DocumentProperty label="标签" icon={<Tag />}>
              <input
                type="text"
                value={item.tags ? item.tags.join(', ') : ''}
                onChange={handleTagsChange}
                disabled={mode === 'read'}
                placeholder="添加标签，用逗号分隔"
                aria-label="科研记录标签"
              />
            </DocumentProperty>

            <DocumentProperty label="上级页面" icon={<ChevronRight />}>
              <select
                value={item.parent_id || ''}
                onChange={(event) => void onMove(event.target.value || null)}
                disabled={mode === 'read'}
                aria-label="上级页面"
              >
                <option value="">顶层页面</option>
                {moveTargets.map((page) => (
                  <option key={page.id} value={page.id}>{formatDocumentPath(moveTargets, page)}</option>
                ))}
              </select>
            </DocumentProperty>

            <DocumentProperty label={`子页面${childPages.length ? ` ${childPages.length}` : ''}`} icon={<FileText />}>
              {childPages.map((page) => (
                <GuardedLink
                  key={page.id}
                  to={`/research?type=${page.research_type}&doc=${encodeURIComponent(page.id)}`}
                  className="smart-document-backlink"
                >
                  <FileText aria-hidden="true" />
                  <span>{page.title || makeDefaultTitle(page.research_type)}</span>
                </GuardedLink>
              ))}
              {mode === 'edit' ? (
                <button type="button" onClick={() => void onCreateChild()} className="smart-document-add-child">
                  <Plus aria-hidden="true" />
                  新建子页面
                </button>
              ) : null}
              {!childPages.length && mode === 'read' ? <span className="smart-document-property-empty">暂无子页面</span> : null}
            </DocumentProperty>

            {item.research_type === 'idea' ? (
              <DocumentProperty label="状态" icon={<Lightbulb />}>
                <select
                  value={item.research_status || 'seed'}
                  onChange={event => updateStatus(event.target.value as ResearchStatus)}
                  disabled={mode === 'read'}
                  aria-label="科研想法状态"
                >
                  {Object.entries(STATUS_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </DocumentProperty>
            ) : null}

            <DocumentProperty label="关联人物" icon={<UserPlus />}>
              {(item.related.people || []).map(person => (
                <span key={person.id} className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs text-gray-700">
                  {person.name}
                  {mode === 'edit' ? (
                    <button type="button" onClick={() => removePerson(person.id)} className="text-gray-400 hover:text-gray-700" aria-label={'移除 ' + person.name}>
                      <X className="h-3 w-3" aria-hidden="true" />
                    </button>
                  ) : null}
                </span>
              ))}
              <select
                value=""
                onChange={event => addPerson(event.target.value)}
                disabled={mode === 'read'}
                aria-label="关联人物"
              >
                <option value="">添加关联人物</option>
                {people.map(person => (
                  <option key={person.id} value={person.id}>{person.name}</option>
                ))}
              </select>
            </DocumentProperty>

            <DocumentProperty label="反向链接" icon={<Link2 />}>
              {backlinks.length ? backlinks.map((page) => (
                <GuardedLink
                  key={page.id}
                  to={page.href || `/research?type=${page.category || 'document'}&doc=${encodeURIComponent(page.id)}`}
                  className="smart-document-backlink"
                >
                  <FileText aria-hidden="true" />
                  <span>{page.title}</span>
                </GuardedLink>
              )) : <span className="smart-document-property-empty">暂无反向链接</span>}
            </DocumentProperty>
          </DocumentProperties>
        )}
      >
        <SmartDocumentEditor
          key={item.id}
          content={item.content || ''}
          contentJson={item.content_json || null}
          pages={pages}
          currentDocumentId={item.id}
          contentRevision={item.content_revision}
          mode={mode}
          theme={theme}
          outlineOpen={outlineOpen}
          onOutlineOpenChange={setOutlineOpen}
          serializationFlushRef={serializationFlushRef}
          exportValueRef={exportValueRef}
          onRecoveryRepaired={onRecoveryRepaired}
          onChange={handleContentUpdate}
        />
      </DocumentWorkspaceShell>

      {showPromote ? (
        <PromoteModal
          draft={promoteDraft}
          isSubmitting={isPromoting}
          onChange={setPromoteDraft}
          onClose={() => setShowPromote(false)}
          onSubmit={async () => {
            await onPromote(promoteDraft);
            setShowPromote(false);
          }}
        />
      ) : null}
    </>
  );
}

function PromoteModal({
  draft,
  isSubmitting,
  onChange,
  onClose,
  onSubmit,
}: {
  draft: PromoteDraft;
  isSubmitting: boolean;
  onChange: (draft: PromoteDraft) => void;
  onClose: () => void;
  onSubmit: () => Promise<void>;
}) {
  const setField = (field: keyof PromoteDraft, value: string) => {
    onChange({ ...draft, [field]: value });
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-xl rounded-lg border border-gray-100 bg-white shadow-xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-100 p-5">
          <div className="text-sm font-bold text-gray-900">上浮到人生主线</div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-4 p-5">
          <PromoteInput label="标题" value={draft.title} onChange={(value) => setField('title', value)} />
          <PromoteTextarea label="这件事是什么" value={draft.what} onChange={(value) => setField('what', value)} />
          <PromoteTextarea label="为什么重要" value={draft.why} onChange={(value) => setField('why', value)} />
          <PromoteTextarea label="对时间/压力/方向/关系的影响" value={draft.impact} onChange={(value) => setField('impact', value)} />
          <PromoteTextarea label="是否需要进入复盘或计划" value={draft.followup} onChange={(value) => setField('followup', value)} />
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-100 p-4">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">
            取消
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={isSubmitting}
            className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-60"
          >
            {isSubmitting ? '上浮中...' : '确认上浮'}
          </button>
        </div>
      </div>
    </div>
  );
}

function PromoteInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-gray-600">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
      />
    </label>
  );
}

function PromoteTextarea({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-gray-600">{label}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={3}
        className="w-full resize-y rounded-lg border border-gray-200 px-3 py-2 text-sm leading-6 focus:outline-none focus:ring-2 focus:ring-primary/20"
      />
    </label>
  );
}
