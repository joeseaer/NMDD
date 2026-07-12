import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  Plus, Tag, Search, X, 
  MoreHorizontal, Trash2, FileText, 
  ArrowLeft, Maximize2, Minimize2
} from 'lucide-react';
import { api, CURRENT_USER_ID } from '../services/api';
import { SmartDocumentEditor, type SmartDocumentPageLink, type SmartDocumentValue } from '../components/SmartDocumentEditor';
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
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [showMobileSidebar, setShowMobileSidebar] = useState(false);

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
  const missingDocumentId = !loading
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

  const documentPages = useMemo<SmartDocumentPageLink[]>(() => (
    items.map((item) => ({
      id: item.id,
      title: item.title || '未命名文档',
      category: item.category,
    }))
  ), [items]);

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

  const fetchData = async () => {
    try {
        setLoading(true);
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

    if (!selectedNoteId) {
      setSelectedNoteId(desiredId);
      setShowMobileSidebar(false);
      return;
    }

    const targetKey = desiredId || '__document_list__';
    if (urlSyncTargetRef.current === targetKey) return;
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

  const handleOpenDetail = async (id: string) => {
    if (!await flushBeforeNavigation()) return;
    const note = items.find((item) => item.id === id);
    const nextView = note ? getDocumentView(note) : view;
    setSelectedNoteId(id);
    setShowMobileSidebar(false);
    setSearchParams({ view: nextView, doc: id });
  };

  const handleBack = async () => {
    if (!await flushBeforeNavigation()) return;
    setSelectedNoteId(null);
    setSearchParams({ view });
    await fetchData();
  };

  const handleSwitchView = async (nextView: 'notes' | 'sop') => {
    if (nextView === view && !selectedNoteId) return;
    if (!await flushBeforeNavigation()) return;
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

  const handleDeleteNote = async (id: string) => {
    if (confirm('确定要删除这篇文档吗？此操作无法撤销。')) {
        try {
            await api.deleteSOP(id);
            setItems(prev => prev.filter(n => n.id !== id));
            if (selectedNoteId === id) {
                setSelectedNoteId(null);
                setSearchParams({ view });
            }
        } catch (error) {
            console.error("Failed to delete note", error);
            alert("删除失败，请重试");
        }
    }
  };
  
  const handleCreateNote = async () => {
      if (!await flushBeforeNavigation()) return;
      setLoading(true);
      const newNote: Partial<SOPEntity> = {
          title: view === 'sop' ? '未命名 SOP' : '未命名文档',
          category: view === 'sop' ? 'people' : 'note',
          domain: 'life',
          research_type: null,
          research_status: null,
          promoted_to_life: false,
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
               created_at: new Date().toISOString().split('T')[0],
              updated_at: new Date().toISOString().split('T')[0],
          } as SOPEntity;

          setItems(prev => [createdNote, ...prev]);
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

  return (
    <div className="flex h-full bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden relative">
      
      {/* Mobile Sidebar Overlay */}
      {showMobileSidebar && selectedNoteId && (
        <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setShowMobileSidebar(false)} />
      )}

      {/* Sidebar List */}
      <div className={`
        fixed inset-y-0 left-0 z-50 w-72 bg-white border-r border-gray-100 flex flex-col transform transition-transform duration-300 ease-in-out lg:static lg:translate-x-0 lg:flex
        ${shouldShowSidebar ? 'translate-x-0' : '-translate-x-full'}
        ${selectedNoteId ? 'hidden lg:flex' : 'flex'}
      `}>
        <div className="p-4 border-b border-gray-100 flex justify-between items-center">
            <h2 className="text-lg font-bold text-gray-900 flex items-center">
                <FileText className="w-5 h-5 mr-2 text-primary" />
                {view === 'sop' ? 'SOP 冷库' : '随笔/文档'}
            </h2>
            <button onClick={() => setShowMobileSidebar(false)} className="lg:hidden text-gray-500">
                <X className="w-5 h-5" />
            </button>
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
                onClick={handleCreateNote}
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
            ) : (
                filteredNotes.length > 0 ? (
                    filteredNotes.map(note => (
                        <div 
                            key={note.id}
                            onClick={() => void handleOpenDetail(note.id)}
                            className={`p-3 rounded-lg cursor-pointer transition-colors group ${
                                selectedNoteId === note.id 
                                ? 'bg-primary/5 border-l-2 border-primary' 
                                : 'hover:bg-gray-50 border-l-2 border-transparent'
                            }`}
                        >
                            <h3 className={`text-sm font-medium mb-1 truncate ${selectedNoteId === note.id ? 'text-primary' : 'text-gray-900'}`}>
                                {note.title}
                            </h3>
                            <div className="flex items-center justify-between text-xs text-gray-400">
                                <span>{note.updated_at}</span>
                                {note.tags.length > 0 && (
                                    <span className="flex items-center">
                                        <Tag className="w-3 h-3 mr-1" />
                                        {note.tags[0]}
                                    </span>
                                )}
                            </div>
                        </div>
                    ))
                ) : (
                    <div className="text-center py-8 text-gray-400 text-sm">
                        {view === 'sop' ? '暂无 SOP' : '暂无文档'}
                    </div>
                )
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
                onBack={handleBack}
                onUpdate={handleSaveNote}
                onDelete={() => handleDeleteNote(selectedNote.id)}
                onPublish={(cat) => {
                  if (!selectedNote) return;
                  const next: SOPEntity = { ...selectedNote, category: cat, updated_at: new Date().toISOString().split('T')[0] };
                  handleSaveNote(next);
                  setSearchParams({ view: 'sop', doc: selectedNote.id });
                }}
                onUnpublish={() => {
                  if (!selectedNote) return;
                  const next: SOPEntity = { ...selectedNote, category: 'note', updated_at: new Date().toISOString().split('T')[0] };
                  handleSaveNote(next);
                  setSearchParams({ view: 'notes', doc: selectedNote.id });
                }}
                pages={documentPages}
            />
        ) : isDeepLinkLoading ? (
            <DocumentLoadingState />
        ) : showMissingDocument ? (
            <DocumentMissingState
                documentId={missingDocumentId || ''}
                onBack={handleBack}
                onCreate={handleCreateNote}
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
  onBack,
  onUpdate,
  onDelete,
  onPublish,
  onUnpublish,
  pages,
}: {
  note: SOPEntity;
  saveStatus: DocumentSaveStatus;
  onRetrySave: () => void;
  onReloadAfterConflict: () => void;
  serializationFlushRef: React.MutableRefObject<(() => Promise<void>) | null>;
  onBack: () => void;
  onUpdate: (note: SOPEntity) => void;
  onDelete: () => void;
  onPublish: (cat: 'people' | 'business' | 'brand') => void;
  onUnpublish: () => void;
  pages: SmartDocumentPageLink[];
}) {
  const [showMenu, setShowMenu] = useState(false);
  const [showPublish, setShowPublish] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [publishCat, setPublishCat] = useState<'people' | 'business' | 'brand'>('people');
  const { mode, setMode, theme, setTheme } = useDocumentViewPreferences();
  const handleBackFromEditor = async () => {
    await onBack();
  };

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
          updated_at: new Date().toISOString().split('T')[0] 
      });
  };

  const handleTagsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const tags = e.target.value.split(',').map(t => t.trim()).filter(Boolean);
      onUpdate({ ...note, tags, updated_at: new Date().toISOString().split('T')[0] });
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
          updated_at: new Date().toISOString().split('T')[0] 
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
        fullscreen={isFullscreen}
        scrollMode="workspace"
        topbar={(
          <DocumentTopbar
            leading={(
              <button type="button" onClick={handleBackFromEditor} className="smart-document-icon-button lg:hidden" aria-label="返回文档列表">
                <ArrowLeft aria-hidden="true" />
              </button>
            )}
            center={<span>{note.category === 'note' ? '文档' : 'SOP'} · 更新于 {note.updated_at || '-'}</span>}
            actions={(
              <>
                <DocumentSaveIndicator status={saveStatus} onRetry={onRetrySave} onReload={onReloadAfterConflict} />
                <DocumentViewControls mode={mode} theme={theme} onModeChange={setMode} onThemeChange={setTheme} />
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
            eyebrow={note.category === 'note' ? 'DOCUMENT' : 'STANDARD OPERATING PROCEDURE'}
            meta={(
              <>
                <span>{note.version || 'V1.0'}</span>
                <span>创建于 {note.created_at || '-'}</span>
                <span>更新于 {note.updated_at || '-'}</span>
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
          </DocumentProperties>
        )}
      >
        <SmartDocumentEditor
          key={note.id}
          content={note.content || ''}
          contentJson={note.content_json || null}
          pages={pages}
          currentDocumentId={note.id}
          mode={mode}
          theme={theme}
          serializationFlushRef={serializationFlushRef}
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
