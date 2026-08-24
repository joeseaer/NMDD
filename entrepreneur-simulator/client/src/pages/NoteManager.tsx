import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  Plus, RefreshCw, Tag, Search, X,
  MoreHorizontal, Trash2, FileText, 
  ArrowLeft, ChevronRight, Link2, ListTree, Maximize2, Minimize2, PanelLeftClose, PanelLeftOpen
} from 'lucide-react';
import { api, CURRENT_USER_ID, type SOPContentRepairResult } from '../services/api';
import { SmartDocumentEditor, type SmartDocumentPageLink, type SmartDocumentValue, type SmartDocumentValueGetter } from '../components/SmartDocumentEditor';
import { useSearchParams } from 'react-router-dom';
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

// --- Types ---
interface SOPEntity {
  id: string;
  title: string;
  category: 'people' | 'business' | 'brand' | 'note';
  domain?: 'life' | 'research';
  research_type?: 'document' | 'idea' | 'meeting' | null;
  research_status?: 'seed' | 'to_verify' | 'absorbed' | 'paused' | null;
  promoted_to_life?: boolean;
  promoted_at?: string | null;
  promoted_from_sop_id?: string | null;
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
  stats: {
    use_count: number;
    avg_score: number;
    last_used: string;
    related_scenes_count: number;
  };
  related: {
    scenes: { id: string; title: string; score: number; date: string }[];
    people: { id: string; name: string; role: string }[];
    sops: { id: string; title: string }[];
  };
  history: { version: string; date: string; note: string }[];
  validation: { scene: string; date: string; score: number; note: string }[];
}

type SOPEntitySavePayload = Omit<SOPEntity, 'related'> & {
  related?: SOPEntity['related'];
};

const normalizeSopEntity = (raw: any): SOPEntity => {
  const category = raw?.category === 'people' || raw?.category === 'business' || raw?.category === 'brand' || raw?.category === 'note'
    ? raw.category
    : 'note';

  return {
    id: String(raw?.id || ''),
    title: String(raw?.title || ''),
    category,
    domain: raw?.domain === 'research' ? 'research' : 'life',
    research_type: raw?.research_type === 'document' || raw?.research_type === 'idea' || raw?.research_type === 'meeting' ? raw.research_type : null,
    research_status: raw?.research_status === 'seed' || raw?.research_status === 'to_verify' || raw?.research_status === 'absorbed' || raw?.research_status === 'paused' ? raw.research_status : null,
    promoted_to_life: !!raw?.promoted_to_life,
    promoted_at: raw?.promoted_at || null,
    promoted_from_sop_id: raw?.promoted_from_sop_id || null,
    parent_id: raw?.parent_id ? String(raw.parent_id) : null,
    sort_order: Number.isSafeInteger(Number(raw?.sort_order)) ? Number(raw.sort_order) : 0,
    structure_updated_at: raw?.structure_updated_at || null,
    tags: Array.isArray(raw?.tags) ? raw.tags.map((t: any) => String(t)).filter(Boolean) : [],
    version: String(raw?.version || 'V1.0'),
    created_at: String(raw?.created_at || ''),
    updated_at: String(raw?.updated_at || ''),
    content: String(raw?.content || ''),
    content_json: raw?.content_json || null,
    content_schema_version: Number(raw?.content_schema_version || 1),
    content_revision: normalizeDocumentRevision(raw?.content_revision),
    stats: raw?.stats && typeof raw.stats === 'object'
      ? {
          use_count: Number(raw.stats.use_count || 0),
          avg_score: Number(raw.stats.avg_score || 0),
          last_used: String(raw.stats.last_used || '-'),
          related_scenes_count: Number(raw.stats.related_scenes_count || 0),
        }
      : { use_count: 0, avg_score: 0, last_used: '-', related_scenes_count: 0 },
    related: raw?.related && typeof raw.related === 'object'
      ? {
          scenes: Array.isArray(raw.related.scenes) ? raw.related.scenes : [],
          people: Array.isArray(raw.related.people) ? raw.related.people : [],
          sops: Array.isArray(raw.related.sops) ? raw.related.sops : [],
        }
      : { scenes: [], people: [], sops: [] },
    history: Array.isArray(raw?.history) ? raw.history : [],
    validation: Array.isArray(raw?.validation) ? raw.validation : [],
  };
};

const getDocumentView = (note: Pick<SOPEntity, 'category'>) => {
  return note.category === 'note' ? 'notes' : 'sop';
};

export default function NoteManager() {
  const [items, setItems] = useState<SOPEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [showMobileSidebar, setShowMobileSidebar] = useState(false);
  const [libraryCollapsed, setLibraryCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    const stored = window.localStorage.getItem('nmdd.notes.library-collapsed.v2');
    return stored === 'true';
  });

  const [searchParams, setSearchParams] = useSearchParams();
  const view = (searchParams.get('view') || 'notes') === 'sop' ? 'sop' : 'notes';
  const docParam = searchParams.get('doc');
  
  // Navigation State
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const activeEditorFlushRef = React.useRef<(() => Promise<void>) | null>(null);
  const urlSyncTargetRef = React.useRef<string | undefined>(undefined);

  const selectedNote = items.find(n => n.id === selectedNoteId) || null;
  const docParamTarget = docParam ? items.find((item) => item.id === docParam) || null : null;
  const isDeepLinkLoading = Boolean(docParam && loading && !docParamTarget && !selectedNote);
  const missingDocumentId = !loading && !loadError
    ? (
        docParam && !docParamTarget
          ? docParam
          : selectedNoteId && !selectedNote
            ? selectedNoteId
            : null
      )
    : null;
  const showMissingDocument = Boolean(missingDocumentId);
  const showMainContent = Boolean(selectedNote || selectedNoteId || isDeepLinkLoading || showMissingDocument);

  const shouldShowSidebar = showMobileSidebar || !showMainContent;
  const desktopLibraryHidden = Boolean(selectedNoteId && libraryCollapsed);

  useEffect(() => {
    window.localStorage.setItem('nmdd.notes.library-collapsed.v2', String(libraryCollapsed));
  }, [libraryCollapsed]);

  const documentPages = useMemo<SmartDocumentPageLink[]>(() => (
    items.map((item) => ({
      id: item.id,
      title: item.title || '未命名文档',
      category: item.category,
      href: `/notes?view=${getDocumentView(item)}&doc=${encodeURIComponent(item.id)}`,
    }))
  ), [items]);
  const backlinks = useMemo<SmartDocumentPageLink[]>(() => (
    selectedNoteId
      ? items
          .filter((item) => item.id !== selectedNoteId && documentLinksToPage(item.content_json, selectedNoteId))
          .map((item) => ({
            id: item.id,
            title: item.title || '未命名文档',
            category: item.category,
            href: `/notes?view=${getDocumentView(item)}&doc=${encodeURIComponent(item.id)}`,
          }))
      : []
  ), [items, selectedNoteId]);

  const handleOptimisticDocumentUpdate = useCallback((updatedNote: SOPEntitySavePayload) => {
    setItems((current) => current.map((item) => item.id === updatedNote.id
      ? {
          ...item,
          ...updatedNote,
          related: updatedNote.related ?? item.related,
        }
      : item));
  }, []);

  const handleConfirmedDocumentSave = useCallback((id: string, result: {
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

  const saveQueue = useRevisionedSaveQueue<SOPEntitySavePayload>({
    saveDocument: api.createSOP,
    onOptimisticUpdate: handleOptimisticDocumentUpdate,
    onConfirmed: handleConfirmedDocumentSave,
  });
  const selectedSaveStatus = saveQueue.getStatus(selectedNoteId);
  useDocumentNavigationGuard(flushBeforeNavigation, Boolean(selectedNoteId));

  const fetchData = async () => {
    try {
        setLoading(true);
        setLoadError(null);
        const fetchedSops = await api.getSOPs(CURRENT_USER_ID, { domain: 'life' });
        const normalizedItems = (Array.isArray(fetchedSops) ? fetchedSops : [])
          .map(normalizeSopEntity)
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
    } catch (error) {
        console.error("Failed to load notes", error);
        setLoadError('文档列表加载失败。请检查本地服务或网络连接后重试。');
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
    const targetKey = desiredId || '__document_list__';

    if (urlSyncTargetRef.current !== undefined && urlSyncTargetRef.current !== targetKey) return;

    if (desiredId === selectedNoteId) {
      urlSyncTargetRef.current = undefined;
      if (target) {
        const targetView = getDocumentView(target);
        if (targetView !== view) {
          setSearchParams({ view: targetView, doc: target.id }, { replace: true });
        }
      }
      return;
    }

    if (urlSyncTargetRef.current === targetKey) {
      urlSyncTargetRef.current = undefined;
      setSelectedNoteId(desiredId);
      setShowMobileSidebar(false);
      return;
    }

    if (!selectedNoteId) {
      setSelectedNoteId(desiredId);
      setShowMobileSidebar(false);
      return;
    }

    urlSyncTargetRef.current = targetKey;
    void (async () => {
      const canLeave = await flushBeforeNavigation();
      if (urlSyncTargetRef.current !== targetKey) return;
      urlSyncTargetRef.current = undefined;
      if (!canLeave) {
        const current = items.find((item) => item.id === selectedNoteId);
        if (current) {
          setSearchParams({ view: getDocumentView(current), doc: current.id }, { replace: true });
        }
        return;
      }
      setSelectedNoteId(desiredId);
      setShowMobileSidebar(false);
      if (target) {
        setSearchParams({ view: getDocumentView(target), doc: target.id }, { replace: true });
      }
    })();
  }, [docParam, items, selectedNoteId, setSearchParams, view]);

  const visibleItems = useCallback((list: SOPEntity[]) => {
    const lifeItems = list.filter((it) => (it.domain || 'life') === 'life');
    if (view === 'sop') return lifeItems.filter((it) => it.category !== 'note');
    return lifeItems.filter((it) => it.category === 'note');
  }, [view]);

  const filteredNotes = visibleItems(items).filter(note => {
    const matchesSearch = note.title.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          (note.tags || []).some(tag => tag.toLowerCase().includes(searchTerm.toLowerCase()));
    return matchesSearch;
  });
  const pageTreeItems = visibleItems(items);
  const matchingPageIds = searchTerm.trim()
    ? new Set(filteredNotes.map((note) => note.id))
    : undefined;
  const selectedAncestors = selectedNote ? getDocumentAncestors(items, selectedNote.id) : [];
  const selectedChildren = selectedNote ? getDocumentChildren(items, selectedNote.id) : [];
  const moveTargets = selectedNote
    ? (() => {
        const excluded = getDocumentDescendantIds(items, selectedNote.id);
        excluded.add(selectedNote.id);
        return pageTreeItems.filter((item) => !excluded.has(item.id));
      })()
    : [];

  const handleOpenDetail = async (id: string) => {
    if (!await flushBeforeNavigation()) return;
    const note = items.find((item) => item.id === id);
    const nextView = note ? getDocumentView(note) : view;
    urlSyncTargetRef.current = id;
    setSelectedNoteId(id);
    setShowMobileSidebar(false);
    setSearchParams({ view: nextView, doc: id });
  };

  const handleBack = async () => {
    if (!await flushBeforeNavigation()) return;
    urlSyncTargetRef.current = '__document_list__';
    setSelectedNoteId(null);
    setSearchParams({ view });
    await fetchData();
  };

  const handleSwitchView = async (nextView: 'notes' | 'sop') => {
    if (nextView === view && !selectedNoteId) return;
    if (!await flushBeforeNavigation()) return;
    urlSyncTargetRef.current = '__document_list__';
    setSelectedNoteId(null);
    setSearchParams({ view: nextView });
  };

  async function flushBeforeNavigation() {
    try {
      await activeEditorFlushRef.current?.();
    } catch (error) {
      alert(error instanceof Error ? error.message : '附件仍在上传，请稍后再离开文档。');
      return false;
    }

    const result = await saveQueue.flush();
    if (result.ok) return true;
    alert(result.conflictedIds.length
      ? '文档与其他窗口发生冲突。请先处理冲突，当前内容仍保留在本地。'
      : '文档尚未保存成功。请重试保存后再离开，当前内容仍保留在本地。');
    return false;
  }

  const handleSaveNote = useCallback((updatedNote: SOPEntity) => {
    saveQueue.schedule(withoutRelationsForDocumentAutosave(updatedNote));
  }, [saveQueue]);

  const handleRecoveredNote = useCallback((
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

  const handleDeleteNote = async (id: string) => {
    if (confirm('确定要删除这篇文档吗？子页面会保留并提升一级，此操作无法撤销。')) {
        try {
            const result = await api.deleteSOP(id);
            setItems(prev => prev
              .filter(n => n.id !== id)
              .map((item) => item.parent_id === id
                ? { ...item, parent_id: result.parent_id || null }
                : item));
            if (selectedNoteId === id) {
                urlSyncTargetRef.current = '__document_list__';
                setSelectedNoteId(null);
                setSearchParams({ view });
            }
        } catch (error) {
            console.error("Failed to delete note", error);
            alert("删除失败，请重试");
        }
    }
  };
  
  const handleCreateNote = async (parentId: string | null = null) => {
      if (!await flushBeforeNavigation()) return;
      setLoading(true);
      const newNote: Partial<SOPEntity> = {
          title: view === 'sop' ? '未命名 SOP' : '未命名文档',
          category: view === 'sop' ? 'people' : 'note',
          domain: 'life',
          research_type: null,
          research_status: null,
          promoted_to_life: false,
          parent_id: parentId,
          sort_order: Date.now(),
          tags: [],
          version: 'V1.0',
          content: '',
          content_json: null,
          related: { scenes: [], people: [], sops: [] }, 
          history: [{ version: 'V1.0', date: new Date().toISOString().split('T')[0], note: '初始创建' }],
          stats: { use_count: 0, avg_score: 0, last_used: '-', related_scenes_count: 0 },
          validation: []
      };
      
      try {
          const result = await api.createSOP(newNote);
          
          if (!result || !result.id) {
              throw new Error('Server response missing ID');
          }
          
          const createdNote = {
              ...newNote,
              id: result.id,
              content_schema_version: Number(result.content_schema_version || 1),
              content_revision: normalizeDocumentRevision(result.content_revision),
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
          } as SOPEntity;

          setItems(prev => [createdNote, ...prev]);
          urlSyncTargetRef.current = result.id;
          setSelectedNoteId(result.id);
          setSearchParams({ view, doc: result.id });
      } catch (error: any) {
          console.error("Failed to create note", error);
          alert(`创建失败: ${error.message || 'Unknown error'}`);
          // Do not proceed with undefined ID
      } finally {
          setLoading(false);
      }
  }

  const handleMoveNote = async (id: string, parentId: string | null) => {
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
      console.error('Failed to move document page', error);
      alert(error instanceof Error ? error.message : '移动页面失败，请重试');
    }
  };

  return (
    <div className="flex h-full bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden relative">
      
      {/* Mobile Sidebar Overlay */}
      {showMobileSidebar && selectedNoteId && (
        <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setShowMobileSidebar(false)} />
      )}

      {/* Sidebar List */}
      <div className={`
        fixed inset-y-0 left-0 z-50 w-72 bg-white border-r border-gray-100 flex flex-col transform transition-transform duration-300 ease-in-out lg:static lg:translate-x-0
        ${shouldShowSidebar ? 'translate-x-0' : '-translate-x-full'}
        ${selectedNoteId ? 'hidden' : 'flex'}
        ${desktopLibraryHidden ? 'lg:hidden' : 'lg:flex'}
      `}>
        <div className="p-4 border-b border-gray-100 flex justify-between items-center">
            <h2 className="text-lg font-bold text-gray-900 flex items-center">
                <FileText className="w-5 h-5 mr-2 text-primary" />
                {view === 'sop' ? 'SOP 冷库' : '随笔/文档'}
            </h2>
            <div className="flex items-center gap-1">
              {selectedNoteId ? (
                <button type="button" onClick={() => setLibraryCollapsed(true)} className="hidden rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 lg:inline-flex" title="收起文档列表" aria-label="收起文档列表">
                  <PanelLeftClose className="h-4 w-4" />
                </button>
              ) : null}
              <button onClick={() => setShowMobileSidebar(false)} className="lg:hidden text-gray-500">
                  <X className="w-5 h-5" />
              </button>
            </div>
        </div>

        <div className="px-4 pt-3">
          <div className="flex items-center gap-2 bg-gray-50 rounded-lg p-1 border border-gray-100">
            <button
              onClick={() => void handleSwitchView('notes')}
              className={`flex-1 text-xs font-medium px-3 py-1.5 rounded-md ${view === 'notes' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-600 hover:bg-white/60'}`}
            >
              文档
            </button>
            <button
              onClick={() => void handleSwitchView('sop')}
              className={`flex-1 text-xs font-medium px-3 py-1.5 rounded-md ${view === 'sop' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-600 hover:bg-white/60'}`}
            >
              SOP 冷库
            </button>
          </div>
        </div>
        
        <div className="p-4 border-b border-gray-100">
             <div className="relative mb-3">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Search className="h-4 w-4 text-gray-400" />
                  </div>
                  <input
                  type="text"
                  className="block w-full pl-10 pr-3 py-2 border border-gray-200 rounded-lg leading-5 bg-gray-50 placeholder-gray-400 focus:outline-none focus:bg-white focus:ring-1 focus:ring-primary focus:border-primary sm:text-sm transition-colors"
                  placeholder={view === 'sop' ? '搜索 SOP...' : '搜索文档...'}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
            </div>
            <button 
                onClick={() => void handleCreateNote()}
                className="w-full flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg shadow-sm text-white bg-primary hover:bg-primary/90 focus:outline-none transition-colors"
            >
                <Plus className="h-4 w-4 mr-2" />
                {view === 'sop' ? '新建 SOP' : '新建文档'}
            </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {loading && items.length === 0 ? (
                 <div className="flex justify-center p-4">
                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
                 </div>
            ) : loadError && items.length === 0 ? (
                <div className="m-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" role="alert">
                    <div className="font-medium">无法载入文档</div>
                    <p className="mt-1 text-xs leading-5 text-amber-700">{loadError}</p>
                    <button type="button" onClick={() => void fetchData()} className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-amber-100">
                        <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                        重新加载
                    </button>
                </div>
            ) : (
                <DocumentPageTree
                  items={pageTreeItems}
                  selectedId={selectedNoteId}
                  matchingIds={matchingPageIds}
                  storageKey={`nmdd.notes.page-tree.expanded.${view}`}
                  emptyMessage={view === 'sop' ? '暂无 SOP' : '暂无文档'}
                  onSelect={(note) => void handleOpenDetail(note.id)}
                  onCreateChild={(note) => void handleCreateNote(note.id)}
                  renderTrailing={(note) => note.tags.length ? (
                    <span className="max-w-16 truncate rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-normal text-gray-400">
                      {note.tags[0]}
                    </span>
                  ) : null}
                />
            )}
        </div>
      </div>

      {/* Main Content Area */}
      <div className={`flex-1 flex flex-col min-w-0 bg-white ${!showMainContent ? 'hidden lg:flex' : 'flex'}`}>
        {selectedNote ? (
            <NoteDetailView 
                note={selectedNote}
                saveStatus={selectedSaveStatus}
                onRetrySave={() => saveQueue.retry(selectedNote.id)}
                onReloadAfterConflict={() => window.location.reload()}
                serializationFlushRef={activeEditorFlushRef}
                onRecoveryRepaired={(value, result) => handleRecoveredNote(selectedNote.id, value, result)}
                onBack={handleBack}
                onUpdate={handleSaveNote}
                onDelete={() => handleDeleteNote(selectedNote.id)}
                onPublish={(cat) => {
                  if (!selectedNote) return;
                  const next: SOPEntity = { ...selectedNote, category: cat, updated_at: new Date().toISOString() };
                  handleSaveNote(next);
                  setSearchParams({ view: 'sop', doc: selectedNote.id });
                }}
                onUnpublish={() => {
                  if (!selectedNote) return;
                  const next: SOPEntity = { ...selectedNote, category: 'note', updated_at: new Date().toISOString() };
                  handleSaveNote(next);
                  setSearchParams({ view: 'notes', doc: selectedNote.id });
                }}
                pages={documentPages}
                backlinks={backlinks}
                ancestors={selectedAncestors}
                childPages={selectedChildren}
                moveTargets={moveTargets}
                onCreateChild={() => handleCreateNote(selectedNote.id)}
                onMove={(parentId) => handleMoveNote(selectedNote.id, parentId)}
                libraryCollapsed={desktopLibraryHidden}
                onOpenLibrary={() => setLibraryCollapsed(false)}
            />
        ) : isDeepLinkLoading ? (
            <DocumentLoadingState />
        ) : docParam && loadError ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-amber-50/30 px-6 text-center" role="alert">
                <div className="text-sm font-medium text-amber-900">文档暂时无法打开</div>
                <p className="max-w-md text-xs leading-5 text-amber-700">{loadError}</p>
                <button type="button" onClick={() => void fetchData()} className="inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm text-amber-800 hover:bg-amber-50">
                    <RefreshCw className="h-4 w-4" aria-hidden="true" />
                    重新加载
                </button>
            </div>
        ) : showMissingDocument ? (
            <DocumentMissingState
                documentId={missingDocumentId || ''}
                onBack={handleBack}
                onCreate={() => void handleCreateNote()}
            />
        ) : (
            <div className="flex-1 flex flex-col items-center justify-center h-full text-gray-400 bg-gray-50/30">
                <FileText className="w-16 h-16 mb-4 opacity-20" />
                <p>选择或创建一个文档开始记录</p>
            </div>
        )}
      </div>
    </div>
  );
}

function DocumentLoadingState() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center h-full bg-gray-50/30 px-6 text-center">
      <div className="mb-4 h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-t-primary" />
      <div className="text-sm font-medium text-gray-700">正在打开文档...</div>
      <div className="mt-1 text-xs text-gray-400">正在根据链接定位页面</div>
    </div>
  );
}

function DocumentMissingState({
  documentId,
  onBack,
  onCreate,
}: {
  documentId: string;
  onBack: () => void | Promise<void>;
  onCreate: () => void;
}) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center h-full bg-gray-50/30 px-6 text-center">
      <FileText className="w-14 h-14 mb-4 text-gray-300" />
      <div className="text-base font-semibold text-gray-900">找不到这个文档</div>
      <div className="mt-2 max-w-md text-sm leading-6 text-gray-500">
        这个链接指向的文档可能已经被删除、移动，或者不在当前账号的数据里。
      </div>
      {documentId && (
        <div className="mt-3 max-w-md truncate rounded-md bg-white px-3 py-1.5 text-xs text-gray-400 shadow-sm">
          {documentId}
        </div>
      )}
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          返回文档列表
        </button>
        <button
          type="button"
          onClick={onCreate}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          新建文档
        </button>
      </div>
    </div>
  );
}

function NoteDetailView({
  note,
  saveStatus,
  onRetrySave,
  onReloadAfterConflict,
  serializationFlushRef,
  onRecoveryRepaired,
  onBack,
  onUpdate,
  onDelete,
  onPublish,
  onUnpublish,
  pages,
  backlinks,
  ancestors,
  childPages,
  moveTargets,
  onCreateChild,
  onMove,
  libraryCollapsed,
  onOpenLibrary,
}: {
  note: SOPEntity;
  saveStatus: DocumentSaveStatus;
  onRetrySave: () => void;
  onReloadAfterConflict: () => void;
  serializationFlushRef: React.MutableRefObject<(() => Promise<void>) | null>;
  onRecoveryRepaired: (value: SmartDocumentValue, result: SOPContentRepairResult) => void;
  onBack: () => void;
  onUpdate: (note: SOPEntity) => void;
  onDelete: () => void;
  onPublish: (cat: 'people' | 'business' | 'brand') => void;
  onUnpublish: () => void;
  pages: SmartDocumentPageLink[];
  backlinks: SmartDocumentPageLink[];
  ancestors: SOPEntity[];
  childPages: SOPEntity[];
  moveTargets: SOPEntity[];
  onCreateChild: () => Promise<void>;
  onMove: (parentId: string | null) => Promise<void>;
  libraryCollapsed: boolean;
  onOpenLibrary: () => void;
}) {
  const [showMenu, setShowMenu] = useState(false);
  const [showPublish, setShowPublish] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const exportValueRef = React.useRef<SmartDocumentValueGetter | null>(null);
  const [publishCat, setPublishCat] = useState<'people' | 'business' | 'brand'>('people');
  const {
    mode, setMode, theme, setTheme,
    width, setWidth, font, setFont, smallText, setSmallText,
  } = useDocumentViewPreferences();
  const handleBackFromEditor = async () => {
    await onBack();
  };

  useEffect(() => {
    setOutlineOpen(false);
  }, [note.id]);

  useEffect(() => {
    if (!isFullscreen) return;

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsFullscreen(false);
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isFullscreen]);

  const handleTitleChange = (newTitle: string) => {
      onUpdate({ 
          ...note, 
          title: newTitle, 
          updated_at: new Date().toISOString(),
      });
  };

  const handleTagsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const tags = e.target.value.split(',').map(t => t.trim()).filter(Boolean);
      onUpdate({ ...note, tags, updated_at: new Date().toISOString() });
  };

  const handleContentUpdate = (value: SmartDocumentValue) => {
      // Auto-extract title from first line if title is "未命名文档" or empty
      let newTitle = note.title;
      if (note.title === '未命名文档' || !note.title) {
          const firstLine = (value.text || value.markdown)
              .split('\n')
              .map((line) => line.replace(/^#+\s*/, '').trim())
              .find(Boolean);
          if (firstLine && firstLine.length < 50) {
              newTitle = firstLine;
          }
      }

      const updatedNote = { 
          ...note, 
          content: value.markdown,
          content_json: value.json,
          updated_at: new Date().toISOString(),
      };

      if (newTitle !== note.title) {
          updatedNote.title = newTitle;
      }
      
      onUpdate(updatedNote);
  };

  return (
    <>
      <DocumentWorkspaceShell
        className="flex-1"
        data-testid="document-workspace"
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
                <button type="button" onClick={handleBackFromEditor} className="smart-document-icon-button lg:hidden" aria-label="返回文档列表">
                  <ArrowLeft aria-hidden="true" />
                </button>
                {libraryCollapsed ? (
                  <button type="button" onClick={onOpenLibrary} className="smart-document-icon-button hidden lg:inline-flex" aria-label="打开文档列表" title="打开文档列表">
                    <PanelLeftOpen aria-hidden="true" />
                  </button>
                ) : null}
              </>
            )}
            center={(
              <span className="smart-document-breadcrumbs">
                <span>记录中心</span>
                <ChevronRight aria-hidden="true" />
                <span>{note.category === 'note' ? '文档' : 'SOP'}</span>
                {ancestors.map((page) => (
                  <React.Fragment key={page.id}>
                    <ChevronRight aria-hidden="true" />
                    <GuardedLink
                      to={`/notes?view=${getDocumentView(page)}&doc=${encodeURIComponent(page.id)}`}
                      className="smart-document-breadcrumb-link"
                    >
                      {page.title || '未命名文档'}
                    </GuardedLink>
                  </React.Fragment>
                ))}
                <ChevronRight aria-hidden="true" />
                <strong>{note.title || '未命名文档'}</strong>
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
                  onModeChange={setMode}
                  onThemeChange={setTheme}
                  onWidthChange={setWidth}
                  onFontChange={setFont}
                  onSmallTextChange={setSmallText}
                />
                <DocumentExportMenu
                  title={note.title || '未命名文档'}
                  valueRef={exportValueRef}
                  beforeExport={async () => serializationFlushRef.current?.()}
                />
                <button
                  type="button"
                  onClick={() => {
                    setShowMenu(false);
                    setIsFullscreen(current => !current);
                  }}
                  className="smart-document-icon-button"
                  title={isFullscreen ? '退出全屏 (Esc)' : '全屏编辑'}
                  aria-label={isFullscreen ? '退出全屏' : '全屏编辑'}
                >
                  {isFullscreen ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
                </button>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowMenu(!showMenu)}
                    className="smart-document-icon-button"
                    aria-label="更多文档操作"
                    aria-expanded={showMenu}
                  >
                    <MoreHorizontal aria-hidden="true" />
                  </button>
                  {showMenu ? (
                    <>
                      <button
                        type="button"
                        className="fixed inset-0 z-10 cursor-default"
                        aria-label="关闭文档菜单"
                        onClick={() => setShowMenu(false)}
                      />
                      <div className="absolute right-0 z-20 mt-2 w-48 rounded-lg border border-gray-100 bg-white py-1 shadow-lg">
                        {note.category === 'note' ? (
                          <button
                            type="button"
                            onClick={() => {
                              setPublishCat('people');
                              setShowPublish(true);
                              setShowMenu(false);
                            }}
                            className="flex w-full items-center px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                          >
                            <FileText className="mr-2 h-4 w-4" aria-hidden="true" />
                            发布为 SOP
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              onUnpublish();
                              setShowMenu(false);
                            }}
                            className="flex w-full items-center px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                          >
                            <FileText className="mr-2 h-4 w-4" aria-hidden="true" />
                            转回文档
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            onDelete();
                            setShowMenu(false);
                          }}
                          className="flex w-full items-center px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                        >
                          <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
                          删除文档
                        </button>
                      </div>
                    </>
                  ) : null}
                </div>
              </>
            )}
          />
        )}
        header={(
          <DocumentPageHeader
            title={note.title}
            onTitleChange={handleTitleChange}
            readOnly={mode === 'read'}
            titlePlaceholder="文档标题"
            icon={<FileText />}
            eyebrow={(
              <span className="smart-document-page-path">
                <span>{note.category === 'note' ? 'DOCUMENT' : 'STANDARD OPERATING PROCEDURE'}</span>
                {ancestors.map((page) => (
                  <React.Fragment key={page.id}>
                    <ChevronRight aria-hidden="true" />
                    <GuardedLink to={`/notes?view=${getDocumentView(page)}&doc=${encodeURIComponent(page.id)}`}>
                      {page.title || '未命名文档'}
                    </GuardedLink>
                  </React.Fragment>
                ))}
              </span>
            )}
            meta={(
              <>
                <span>{note.version || 'V1.0'}</span>
                <span>创建于 {formatDocumentDate(note.created_at)}</span>
                <span>更新于 {formatDocumentDate(note.updated_at)}</span>
              </>
            )}
          />
        )}
        properties={(
          <DocumentProperties>
            <DocumentProperty label="标签" icon={<Tag />}>
              <input
                type="text"
                value={note.tags ? note.tags.join(', ') : ''}
                onChange={handleTagsChange}
                disabled={mode === 'read'}
                placeholder="添加标签，用逗号分隔"
                aria-label="文档标签"
              />
            </DocumentProperty>
            <DocumentProperty label="上级页面" icon={<ChevronRight />}>
              <select
                value={note.parent_id || ''}
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
                  to={`/notes?view=${getDocumentView(page)}&doc=${encodeURIComponent(page.id)}`}
                  className="smart-document-backlink"
                >
                  <FileText aria-hidden="true" />
                  <span>{page.title || '未命名文档'}</span>
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
            <DocumentProperty label="反向链接" icon={<Link2 />}>
              {backlinks.length ? backlinks.map((page) => (
                <GuardedLink
                  key={page.id}
                  to={page.href || `/notes?view=${page.category === 'note' ? 'notes' : 'sop'}&doc=${encodeURIComponent(page.id)}`}
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
          key={note.id}
          content={note.content || ''}
          contentJson={note.content_json || null}
          pages={pages}
          currentDocumentId={note.id}
          contentRevision={note.content_revision}
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

      {showPublish ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4" onClick={() => setShowPublish(false)}>
          <div
            className="w-full max-w-sm rounded-xl border border-gray-100 bg-white shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="publish-sop-title"
            onClick={event => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-100 p-5">
              <div id="publish-sop-title" className="text-sm font-bold text-gray-900">发布为 SOP</div>
              <button
                type="button"
                onClick={() => setShowPublish(false)}
                className="text-gray-400 hover:text-gray-600"
                aria-label="关闭发布对话框"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <div className="space-y-4 p-5">
              <label className="block">
                <span className="mb-1 block text-xs text-gray-600">选择分类</span>
                <select
                  value={publishCat}
                  onChange={event => setPublishCat(event.target.value as 'people' | 'business' | 'brand')}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                >
                  <option value="people">识人能力</option>
                  <option value="business">商业认知</option>
                  <option value="brand">个人品牌</option>
                </select>
              </label>
              <div className="flex items-center justify-end gap-2">
                <button type="button" onClick={() => setShowPublish(false)} className="rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">
                  取消
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onPublish(publishCat);
                    setShowPublish(false);
                  }}
                  className="rounded-lg bg-primary px-3 py-2 text-sm text-white hover:bg-primary/90"
                >
                  发布
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
