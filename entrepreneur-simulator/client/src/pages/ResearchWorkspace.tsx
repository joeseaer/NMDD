import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  FileText,
  Lightbulb,
  MessageSquare,
  Plus,
  Search,
  Tag,
  Trash2,
  UploadCloud,
  UserPlus,
  X,
} from 'lucide-react';
import { api, CURRENT_USER_ID } from '../services/api';
import { SmartDocumentEditor, type SmartDocumentPageLink, type SmartDocumentValue } from '../components/SmartDocumentEditor';

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
  tags: string[];
  version: string;
  created_at: string;
  updated_at: string;
  content: string;
  content_json?: any | null;
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
    tags: Array.isArray(raw?.tags) ? raw.tags.map((tag: any) => String(tag)).filter(Boolean) : [],
    version: String(raw?.version || 'V1.0'),
    created_at: String(raw?.created_at || ''),
    updated_at: String(raw?.updated_at || ''),
    content: String(raw?.content || ''),
    content_json: raw?.content_json || null,
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

function useDebouncedCallback<T extends (...args: any[]) => any>(
  callback: T,
  wait: number
) {
  const timeout = useRef<ReturnType<typeof setTimeout>>();

  return useCallback(
    (...args: Parameters<T>) => {
      const later = () => {
        clearTimeout(timeout.current);
        callback(...args);
      };

      clearTimeout(timeout.current);
      timeout.current = setTimeout(later, wait);
    },
    [callback, wait]
  );
}

export default function ResearchWorkspace() {
  const [items, setItems] = useState<ResearchItem[]>([]);
  const [people, setPeople] = useState<RelatedPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [promotingId, setPromotingId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [showMobileSidebar, setShowMobileSidebar] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  const activeType: ResearchType = isResearchType(searchParams.get('type')) ? searchParams.get('type') as ResearchType : 'document';
  const docParam = searchParams.get('doc');
  const selectedItem = items.find((item) => item.id === selectedItemId) || null;
  const showMainContent = Boolean(selectedItem || selectedItemId || (docParam && loading));
  const shouldShowSidebar = showMobileSidebar || !showMainContent;

  const pages = useMemo<SmartDocumentPageLink[]>(() => (
    items.map((item) => ({
      id: item.id,
      title: item.title || makeDefaultTitle(item.research_type),
      category: item.research_type,
    }))
  ), [items]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [rawItems, rawPeople] = await Promise.all([
        api.getSOPs(CURRENT_USER_ID, { domain: 'research' }),
        api.getAllPeople(CURRENT_USER_ID),
      ]);
      setItems((Array.isArray(rawItems) ? rawItems : []).map(normalizeResearchItem).filter((item) => item.id));
      setPeople((Array.isArray(rawPeople) ? rawPeople : []).map((person: any) => ({
        id: String(person?.id || ''),
        name: String(person?.name || ''),
        role: String(person?.identity || person?.role || ''),
        identity: String(person?.identity || ''),
      })).filter((person) => person.id && person.name));
    } catch (error) {
      console.error('Failed to load research workspace', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (!docParam) return;
    const target = items.find((item) => item.id === docParam);
    if (!target) return;
    if (target.research_type !== activeType) {
      setSearchParams({ type: target.research_type, doc: docParam }, { replace: true });
      return;
    }
    if (selectedItemId !== docParam) {
      setSelectedItemId(docParam);
      setShowMobileSidebar(false);
    }
  }, [activeType, docParam, items, selectedItemId, setSearchParams]);

  const visibleItems = items
    .filter((item) => item.research_type === activeType)
    .filter((item) => {
      const query = searchTerm.trim().toLowerCase();
      if (!query) return true;
      return (
        item.title.toLowerCase().includes(query) ||
        item.content.toLowerCase().includes(query) ||
        item.tags.some((tag) => tag.toLowerCase().includes(query))
      );
    });

  const debouncedSave = useDebouncedCallback(async (updatedItem: ResearchItem) => {
    try {
      await api.createSOP(updatedItem);
    } catch (error) {
      console.error('Failed to save research item', error);
    } finally {
      setIsSaving(false);
    }
  }, 1000);

  const handleUpdateItem = (updatedItem: ResearchItem) => {
    setIsSaving(true);
    setItems((prev) => prev.map((item) => item.id === updatedItem.id ? updatedItem : item));
    debouncedSave(updatedItem);
  };

  const handleCreateItem = async () => {
    setLoading(true);
    const content = makeTemplate(activeType);
    const newItem: Partial<ResearchItem> = {
      title: makeDefaultTitle(activeType),
      category: 'note',
      domain: 'research',
      research_type: activeType,
      research_status: activeType === 'idea' ? 'seed' : null,
      promoted_to_life: false,
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
        created_at: new Date().toISOString().split('T')[0],
        updated_at: new Date().toISOString().split('T')[0],
      } as ResearchItem;
      setItems((prev) => [createdItem, ...prev]);
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
    if (!confirm('确定删除这条科研记录吗？此操作无法撤销。')) return;
    try {
      await api.deleteSOP(id);
      setItems((prev) => prev.filter((item) => item.id !== id));
      if (selectedItemId === id) {
        setSelectedItemId(null);
        setSearchParams({ type: activeType });
      }
    } catch (error) {
      console.error('Failed to delete research item', error);
      alert('删除失败，请重试');
    }
  };

  const handleOpenItem = (item: ResearchItem) => {
    setSelectedItemId(item.id);
    setShowMobileSidebar(false);
    setSearchParams({ type: item.research_type, doc: item.id });
  };

  const handleSwitchType = (type: ResearchType) => {
    setSelectedItemId(null);
    setSearchParams({ type });
  };

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
        ${selectedItemId ? 'hidden lg:flex' : 'flex'}
      `}>
        <div className="flex items-center justify-between border-b border-gray-100 p-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900">科研工作台</h2>
            <div className="mt-1 text-xs text-gray-500">独立科研记录区</div>
          </div>
          <button onClick={() => setShowMobileSidebar(false)} className="text-gray-500 lg:hidden">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="border-b border-gray-100 p-3">
          <div className="grid grid-cols-3 gap-1 rounded-lg bg-gray-50 p-1">
            {RESEARCH_TYPES.map((type) => (
              <button
                key={type.key}
                type="button"
                onClick={() => handleSwitchType(type.key)}
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
            onClick={handleCreateItem}
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
          ) : visibleItems.length > 0 ? (
            <div className="space-y-1">
              {visibleItems.map((item) => (
                <ResearchListItem
                  key={item.id}
                  item={item}
                  active={selectedItemId === item.id}
                  onClick={() => handleOpenItem(item)}
                />
              ))}
            </div>
          ) : (
            <div className="py-10 text-center text-sm text-gray-400">暂无记录</div>
          )}
        </div>
      </aside>

      <main className={`min-w-0 flex-1 bg-white ${!showMainContent ? 'hidden lg:flex' : 'flex'}`}>
        {selectedItem ? (
          <ResearchDetail
            item={selectedItem}
            people={people}
            pages={pages}
            isSaving={isSaving}
            isPromoting={promotingId === selectedItem.id}
            onBack={() => {
              setSelectedItemId(null);
              setSearchParams({ type: activeType });
            }}
            onUpdate={handleUpdateItem}
            onDelete={() => handleDeleteItem(selectedItem.id)}
            onPromote={(draft) => handlePromote(selectedItem, draft)}
          />
        ) : docParam && loading ? (
          <div className="flex flex-1 items-center justify-center text-sm text-gray-400">正在打开科研记录...</div>
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

function ResearchListItem({
  item,
  active,
  onClick,
}: {
  item: ResearchItem;
  active: boolean;
  onClick: () => void;
}) {
  const snippet = item.content.replace(/[#>*_`[\]()~-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  const Icon = item.research_type === 'idea' ? Lightbulb : item.research_type === 'meeting' ? MessageSquare : FileText;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group w-full rounded-lg border-l-2 p-3 text-left transition-colors ${
        active ? 'border-primary bg-primary/5' : 'border-transparent hover:bg-gray-50'
      }`}
    >
      <div className="mb-1 flex items-start gap-2">
        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${active ? 'text-primary' : 'text-gray-400 group-hover:text-gray-500'}`} />
        <div className="min-w-0 flex-1">
          <div className={`truncate text-sm font-medium ${active ? 'text-primary' : 'text-gray-900'}`}>
            {item.title || makeDefaultTitle(item.research_type)}
          </div>
          {snippet && <div className="mt-1 line-clamp-2 text-xs leading-5 text-gray-500">{snippet}</div>}
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-xs text-gray-400">
        <span>{item.updated_at}</span>
        <div className="flex items-center gap-1">
          {item.promoted_to_life && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}
          {item.research_type === 'idea' && item.research_status && (
            <span className={`rounded-full border px-2 py-0.5 ${STATUS_STYLES[item.research_status]}`}>
              {STATUS_LABELS[item.research_status]}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

function ResearchDetail({
  item,
  people,
  pages,
  isSaving,
  isPromoting,
  onBack,
  onUpdate,
  onDelete,
  onPromote,
}: {
  item: ResearchItem;
  people: RelatedPerson[];
  pages: SmartDocumentPageLink[];
  isSaving: boolean;
  isPromoting: boolean;
  onBack: () => void;
  onUpdate: (item: ResearchItem) => void;
  onDelete: () => void;
  onPromote: (draft: PromoteDraft) => Promise<void>;
}) {
  const [showPromote, setShowPromote] = useState(false);
  const [promoteDraft, setPromoteDraft] = useState<PromoteDraft>(() => ({
    title: `科研上浮：${item.title || makeDefaultTitle(item.research_type)}`,
    what: item.title || '',
    why: '',
    impact: '',
    followup: '',
  }));

  useEffect(() => {
    setPromoteDraft({
      title: `科研上浮：${item.title || makeDefaultTitle(item.research_type)}`,
      what: item.title || '',
      why: '',
      impact: '',
      followup: '',
    });
  }, [item.id]);

  const handleTitleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    onUpdate({ ...item, title: event.target.value, updated_at: new Date().toISOString().split('T')[0] });
  };

  const handleTagsChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const tags = event.target.value.split(',').map((tag) => tag.trim()).filter(Boolean);
    onUpdate({ ...item, tags, updated_at: new Date().toISOString().split('T')[0] });
  };

  const handleContentUpdate = (value: SmartDocumentValue) => {
    let nextTitle = item.title;
    if (!item.title || item.title === makeDefaultTitle(item.research_type)) {
      const firstLine = (value.text || value.markdown)
        .split('\n')
        .map((line) => line.replace(/^#+\s*/, '').trim())
        .find(Boolean);
      if (firstLine && firstLine.length < 50) nextTitle = firstLine;
    }

    onUpdate({
      ...item,
      title: nextTitle,
      content: value.markdown,
      content_json: value.json,
      updated_at: new Date().toISOString().split('T')[0],
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
      updated_at: new Date().toISOString().split('T')[0],
    });
  };

  const removePerson = (personId: string) => {
    onUpdate({
      ...item,
      related: {
        ...item.related,
        people: (item.related.people || []).filter((person) => person.id !== personId),
      },
      updated_at: new Date().toISOString().split('T')[0],
    });
  };

  const updateStatus = (status: ResearchStatus) => {
    onUpdate({ ...item, research_status: status, updated_at: new Date().toISOString().split('T')[0] });
  };

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden bg-white">
      <div className="flex shrink-0 items-center justify-between border-b border-gray-100 bg-white px-6 py-4">
        <div className="mr-4 flex flex-1 items-center">
          <button onClick={onBack} className="mr-4 rounded-full p-2 transition-colors hover:bg-gray-100 lg:hidden">
            <ArrowLeft className="h-5 w-5 text-gray-500" />
          </button>
          <div className="min-w-0 flex-1">
            <input
              value={item.title}
              onChange={handleTitleChange}
              className="w-full border-none bg-transparent px-0 py-1 text-xl font-bold text-gray-900 focus:outline-none focus:ring-0"
              placeholder="科研记录标题"
            />
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-400">
              <span>{RESEARCH_TYPES.find((type) => type.key === item.research_type)?.label}</span>
              <span>更新于 {item.updated_at || '-'}</span>
              {item.promoted_to_life && <span className="text-emerald-600">已上浮</span>}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">
            {isSaving ? '保存中...' : '已保存'}
          </span>
          <button
            type="button"
            onClick={() => setShowPromote(true)}
            disabled={isPromoting}
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-60"
          >
            <UploadCloud className="h-4 w-4" />
            {item.promoted_to_life ? '再次上浮' : '上浮到人生主线'}
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="rounded-lg border border-red-100 bg-white p-2 text-red-500 transition-colors hover:bg-red-50"
            title="删除"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-white">
        <div className="mx-auto flex h-full max-w-4xl flex-col">
          <div className="space-y-4 px-8 pb-2 pt-6">
            <div className="flex items-center gap-2">
              <Tag className="h-4 w-4 text-gray-400" />
              <input
                type="text"
                value={item.tags ? item.tags.join(', ') : ''}
                onChange={handleTagsChange}
                className="flex-1 border-none bg-transparent px-0 text-sm placeholder-gray-400 focus:ring-0"
                placeholder="添加标签..."
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {item.research_type === 'idea' && (
                <select
                  value={item.research_status || 'seed'}
                  onChange={(event) => updateStatus(event.target.value as ResearchStatus)}
                  className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary/20"
                >
                  {Object.entries(STATUS_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              )}

              <div className="flex flex-wrap items-center gap-2">
                {(item.related.people || []).map((person) => (
                  <span key={person.id} className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs text-gray-700">
                    {person.name}
                    <button type="button" onClick={() => removePerson(person.id)} className="text-gray-400 hover:text-gray-700">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>

              <div className="relative">
                <UserPlus className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <select
                  value=""
                  onChange={(event) => addPerson(event.target.value)}
                  className="rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-8 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary/20"
                >
                  <option value="">关联人物</option>
                  {people.map((person) => (
                    <option key={person.id} value={person.id}>{person.name}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="flex flex-1 flex-col">
            <SmartDocumentEditor
              key={item.id}
              content={item.content || ''}
              contentJson={item.content_json || null}
              pages={pages}
              currentDocumentId={item.id}
              onChange={handleContentUpdate}
            />
          </div>
        </div>
      </div>

      {showPromote && (
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
      )}
    </div>
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
