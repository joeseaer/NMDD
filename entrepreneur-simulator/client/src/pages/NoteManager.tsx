import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Plus, Tag, Search, X, 
  MoreHorizontal, Trash2, FileText, 
  ArrowLeft
} from 'lucide-react';
import { api } from '../services/api';
import { TiptapEditor } from '../components/TiptapEditor';
import { useSearchParams } from 'react-router-dom';

// --- Types ---
interface SOPEntity {
  id: string;
  title: string;
  category: 'people' | 'business' | 'brand' | 'note';
  tags: string[];
  version: string;
  created_at: string;
  updated_at: string;
  content: string;
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

const normalizeSopEntity = (raw: any): SOPEntity => {
  const category = raw?.category === 'people' || raw?.category === 'business' || raw?.category === 'brand' || raw?.category === 'note'
    ? raw.category
    : 'note';

  return {
    id: String(raw?.id || ''),
    title: String(raw?.title || ''),
    category,
    tags: Array.isArray(raw?.tags) ? raw.tags.map((t: any) => String(t)).filter(Boolean) : [],
    version: String(raw?.version || 'V1.0'),
    created_at: String(raw?.created_at || ''),
    updated_at: String(raw?.updated_at || ''),
    content: String(raw?.content || ''),
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

// --- Custom Hooks ---
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

export default function NoteManager() {
  const [items, setItems] = useState<SOPEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [showMobileSidebar, setShowMobileSidebar] = useState(false);

  const [searchParams, setSearchParams] = useSearchParams();
  const view = (searchParams.get('view') || 'notes') === 'sop' ? 'sop' : 'notes';
  
  // Navigation State
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);

  const selectedNote = items.find(n => n.id === selectedNoteId) || null;

  const shouldShowSidebar = showMobileSidebar || !selectedNoteId;

  const fetchData = async () => {
    try {
        setLoading(true);
        const fetchedSops = await api.getSOPs();
        setItems((Array.isArray(fetchedSops) ? fetchedSops : []).map(normalizeSopEntity).filter((x) => x.id));
    } catch (error) {
        console.error("Failed to load notes", error);
    } finally {
        setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const visibleItems = useCallback((list: SOPEntity[]) => {
    if (view === 'sop') return list.filter((it) => it.category !== 'note');
    return list.filter((it) => it.category === 'note');
  }, [view]);

  const filteredNotes = visibleItems(items).filter(note => {
    const matchesSearch = note.title.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          (note.tags || []).some(tag => tag.toLowerCase().includes(searchTerm.toLowerCase()));
    return matchesSearch;
  });

  const handleOpenDetail = (id: string) => {
    setSelectedNoteId(id);
    setShowMobileSidebar(false);
  };

  const handleBack = () => {
    setSelectedNoteId(null);
    fetchData();
  };

  const debouncedSave = useDebouncedCallback(async (updatedNote: SOPEntity) => {
    try {
        const hasMindMap = (updatedNote.content || '').includes('```mindmap');
        if (hasMindMap) {
            console.log('[mindmap][save][note] sending', { id: updatedNote.id, len: (updatedNote.content || '').length });
        }
        await api.createSOP(updatedNote);
        if (hasMindMap) {
            console.log('[mindmap][save][note] ok', { id: updatedNote.id });
        }
    } catch (error) {
        console.error("Failed to save note", error);
        const hasMindMap = (updatedNote.content || '').includes('```mindmap');
        if (hasMindMap) {
            console.error('[mindmap][save][note] failed', { id: updatedNote.id });
        }
    } finally {
        setIsSaving(false);
    }
  }, 1000);

  const handleSaveNote = async (updatedNote: SOPEntity) => {
    setIsSaving(true);
    setItems(prev => prev.map(n => n.id === updatedNote.id ? updatedNote : n));
    debouncedSave(updatedNote);
  };

  const handleDeleteNote = async (id: string) => {
    if (confirm('确定要删除这篇文档吗？此操作无法撤销。')) {
        try {
            await api.deleteSOP(id);
            setItems(prev => prev.filter(n => n.id !== id));
            if (selectedNoteId === id) {
                setSelectedNoteId(null);
            }
        } catch (error) {
            console.error("Failed to delete note", error);
            alert("删除失败，请重试");
        }
    }
  };
  
  const handleCreateNote = async () => {
      setLoading(true);
      const newNote: Partial<SOPEntity> = {
          title: view === 'sop' ? '未命名 SOP' : '未命名文档',
          category: view === 'sop' ? 'people' : 'note',
          tags: [],
          version: 'V1.0',
          content: '',
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
              created_at: new Date().toISOString().split('T')[0],
              updated_at: new Date().toISOString().split('T')[0],
          } as SOPEntity;

          setItems(prev => [createdNote, ...prev]);
          setSelectedNoteId(result.id);
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
              onClick={() => setSearchParams({ view: 'notes' })}
              className={`flex-1 text-xs font-medium px-3 py-1.5 rounded-md ${view === 'notes' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-600 hover:bg-white/60'}`}
            >
              文档
            </button>
            <button
              onClick={() => setSearchParams({ view: 'sop' })}
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
                            onClick={() => handleOpenDetail(note.id)}
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
      <div className={`flex-1 flex flex-col min-w-0 bg-white ${!selectedNoteId ? 'hidden lg:flex' : 'flex'}`}>
        {selectedNote ? (
            <NoteDetailView 
                note={selectedNote}
                isSaving={isSaving}
                onBack={handleBack}
                onUpdate={handleSaveNote}
                onDelete={() => handleDeleteNote(selectedNote.id)}
                onPublish={(cat) => {
                  if (!selectedNote) return;
                  const next: SOPEntity = { ...selectedNote, category: cat, updated_at: new Date().toISOString().split('T')[0] };
                  handleSaveNote(next);
                  setSearchParams({ view: 'sop' });
                }}
                onUnpublish={() => {
                  if (!selectedNote) return;
                  const next: SOPEntity = { ...selectedNote, category: 'note', updated_at: new Date().toISOString().split('T')[0] };
                  handleSaveNote(next);
                  setSearchParams({ view: 'notes' });
                }}
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

function NoteDetailView({
  note,
  isSaving,
  onBack,
  onUpdate,
  onDelete,
  onPublish,
  onUnpublish,
}: {
  note: SOPEntity;
  isSaving: boolean;
  onBack: () => void;
  onUpdate: (note: SOPEntity) => void;
  onDelete: () => void;
  onPublish: (cat: 'people' | 'business' | 'brand') => void;
  onUnpublish: () => void;
}) {
  const [showMenu, setShowMenu] = useState(false);
  const [showPublish, setShowPublish] = useState(false);
  const [publishCat, setPublishCat] = useState<'people' | 'business' | 'brand'>('people');

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const newTitle = e.target.value;
      
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

  const handleContentUpdate = (newContent: string) => {
      // Auto-extract title from first line if title is "未命名文档" or empty
      let newTitle = note.title;
      if (note.title === '未命名文档' || !note.title) {
          const firstLine = newContent.split('\n')[0].replace(/^#+\s*/, '').trim();
          if (firstLine && firstLine.length < 50) {
              newTitle = firstLine;
          }
      }

      const updatedNote = { 
          ...note, 
          content: newContent, 
          updated_at: new Date().toISOString().split('T')[0] 
      };

      if (newTitle !== note.title) {
          updatedNote.title = newTitle;
      }
      
      onUpdate(updatedNote);
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-white">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-white flex-shrink-0">
        <div className="flex items-center flex-1 mr-4">
          <button onClick={onBack} className="mr-4 p-2 hover:bg-gray-100 rounded-full transition-colors lg:hidden">
            <ArrowLeft className="h-5 w-5 text-gray-500" />
          </button>
          <div className="flex-1">
             <input
                value={note.title}
                onChange={handleTitleChange}
                className="text-xl font-bold text-gray-900 w-full px-0 py-1 border-none focus:ring-0 focus:outline-none bg-transparent"
                placeholder="文档标题"
             />
          </div>
        </div>
        <div className="flex items-center space-x-3">
            <span className="text-xs text-gray-400">
                {isSaving ? (
                    <span className="flex items-center text-primary">
                        <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-primary mr-1"></div>
                        保存中...
                    </span>
                ) : "已保存"}
            </span>
            <div className="h-4 w-px bg-gray-200"></div>
            <div className="relative">
                <button 
                    onClick={() => setShowMenu(!showMenu)}
                    className="p-2 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-50"
                >
                    <MoreHorizontal className="h-5 w-5" />
                </button>
                
                {showMenu && (
                    <>
                        <div 
                            className="fixed inset-0 z-10" 
                            onClick={() => setShowMenu(false)}
                        ></div>
                        <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-100 z-20 py-1">
                            {note.category === 'note' ? (
                              <button
                                onClick={() => { setPublishCat('people'); setShowPublish(true); setShowMenu(false); }}
                                className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center"
                              >
                                <FileText className="w-4 h-4 mr-2" />
                                发布为 SOP
                              </button>
                            ) : (
                              <button
                                onClick={() => { onUnpublish(); setShowMenu(false); }}
                                className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center"
                              >
                                <FileText className="w-4 h-4 mr-2" />
                                转回文档
                              </button>
                            )}
                            <button 
                                onClick={() => { onDelete(); setShowMenu(false); }}
                                className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center"
                            >
                                <Trash2 className="w-4 h-4 mr-2" />
                                删除文档
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
      </div>

      {showPublish && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setShowPublish(false)}>
          <div className="bg-white w-full max-w-sm rounded-xl shadow-xl border border-gray-100" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 border-b border-gray-100 flex items-center justify-between">
              <div className="text-sm font-bold text-gray-900">发布为 SOP</div>
              <button onClick={() => setShowPublish(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <div className="text-xs text-gray-600 mb-1">选择分类</div>
                <select
                  value={publishCat}
                  onChange={(e) => setPublishCat(e.target.value as any)}
                  className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                >
                  <option value="people">识人能力</option>
                  <option value="business">商业认知</option>
                  <option value="brand">个人品牌</option>
                </select>
              </div>
              <div className="flex items-center justify-end gap-2">
                <button onClick={() => setShowPublish(false)} className="px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 rounded-lg">
                  取消
                </button>
                <button
                  onClick={() => { onPublish(publishCat); setShowPublish(false); }}
                  className="px-3 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary/90"
                >
                  发布
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto bg-white">
          <div className="max-w-4xl mx-auto h-full flex flex-col">
              {/* Meta inputs */}
              <div className="px-8 pt-6 pb-2 flex items-center space-x-2">
                  <Tag className="w-4 h-4 text-gray-400" />
                  <input 
                    type="text" 
                    value={note.tags ? note.tags.join(', ') : ''} 
                    onChange={handleTagsChange}
                    className="flex-1 border-none bg-transparent text-sm focus:ring-0 px-0 placeholder-gray-400"
                    placeholder="添加标签..."
                  />
              </div>
              
              {/* Editor */}
              <div className="flex-1 flex flex-col">
                 <TiptapEditor 
                    key={note.id}
                    content={note.content || ''} 
                    onChange={handleContentUpdate} 
                 />
              </div>
          </div>
      </div>
    </div>
  );
}
