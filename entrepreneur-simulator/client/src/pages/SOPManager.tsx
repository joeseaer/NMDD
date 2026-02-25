import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { 
  BookOpen, Plus, Tag, Search, X, 
  MoreHorizontal, Share2, Trash2, FileText, Activity, Clock, 
  ArrowLeft, List, Link as LinkIcon, Code, 
  CheckSquare, Bold, Italic, Type, RotateCcw,
  Strikethrough, Quote, ListOrdered, Sparkles, Save, Folder, Menu, Image as ImageIcon
} from 'lucide-react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
  import Image from '@tiptap/extension-image';
  import TaskList from '@tiptap/extension-task-list';
  import TaskItem from '@tiptap/extension-task-item';
  import Placeholder from '@tiptap/extension-placeholder';
  import Heading from '@tiptap/extension-heading';
  import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
  import MarkdownIt from 'markdown-it';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { api } from '../services/api';

// --- Types ---

interface SOPEntity {
  id: string;
  title: string;
  category: 'people' | 'business' | 'brand';
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

// --- Mock Data (Categories remain static for now) ---

const MOCK_CATEGORIES = [
  { id: 'all', name: '全部' },
  { id: 'people', name: '识人能力' },
  { id: 'business', name: '商业认知' },
  { id: 'brand', name: '个人品牌' },
];

// --- Parsers ---

const mdParser = new MarkdownIt();
const turndownService = new TurndownService({ 
    headingStyle: 'atx',
    codeBlockStyle: 'fenced'
});
turndownService.use(gfm);

// --- Custom Node Views ---
const ResizableImageComponent = (props: any) => {
    const { node, updateAttributes, selected } = props;
    const [width, setWidth] = useState(node.attrs.width || '100%');
    const [resizing, setResizing] = useState(false);
    
    // Simple drag resize handler
    const handleMouseDown = (e: React.MouseEvent) => {
        e.preventDefault();
        setResizing(true);
        
        const startX = e.clientX;
        const startWidth = node.attrs.width ? parseInt(node.attrs.width) : (e.target as HTMLElement).parentElement?.offsetWidth || 300;
        
        const onMouseMove = (e: MouseEvent) => {
            const currentX = e.clientX;
            const diffX = currentX - startX;
            const newWidth = Math.max(100, startWidth + diffX);
            setWidth(`${newWidth}px`);
        };
        
        const onMouseUp = (e: MouseEvent) => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            setResizing(false);
            // Commit change
            const currentX = e.clientX;
            const diffX = currentX - startX;
            const newWidth = Math.max(100, startWidth + diffX);
            updateAttributes({ width: `${newWidth}px` });
        };
        
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    };

    return (
        <NodeViewWrapper className="image-resizer-wrapper inline-block relative group" style={{ width: width, maxWidth: '100%' }}>
            <div className={`relative ${selected ? 'ring-2 ring-primary rounded-lg' : ''}`}>
                <img 
                    src={node.attrs.src} 
                    alt={node.attrs.alt}
                    className="rounded-lg w-full h-auto"
                />
                {/* Drag Handle */}
                <div 
                    className={`absolute bottom-2 right-2 w-4 h-4 bg-white border border-gray-300 rounded shadow-sm cursor-nwse-resize flex items-center justify-center transition-opacity ${selected || resizing ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                    onMouseDown={handleMouseDown}
                >
                    <div className="w-2 h-2 border-r border-b border-gray-400"></div>
                </div>
                
                {/* Bubble Menu for Alignment (Simplified version) */}
                {selected && (
                    <div className="absolute top-2 right-2 bg-white rounded shadow-lg border border-gray-100 p-1 flex space-x-1">
                        <button 
                            className="p-1 hover:bg-gray-100 rounded"
                            onClick={() => updateAttributes({ width: '100%' })}
                            title="全宽"
                        >
                            <span className="text-xs font-bold px-1">100%</span>
                        </button>
                        <button 
                            className="p-1 hover:bg-gray-100 rounded"
                            onClick={() => updateAttributes({ width: '50%' })}
                            title="半宽"
                        >
                            <span className="text-xs font-bold px-1">50%</span>
                        </button>
                    </div>
                )}
            </div>
        </NodeViewWrapper>
    );
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

// --- Components ---

export default function SOPManager() {
  const [sops, setSops] = useState<SOPEntity[]>([]);
  const [allScenes, setAllScenes] = useState<any[]>([]);
  const [allPeople, setAllPeople] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  
  const [activeCategory, setActiveCategory] = useState('all');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [showMobileSidebar, setShowMobileSidebar] = useState(false); // New state for mobile sidebar
  
  // Navigation State
  const [viewMode, setViewMode] = useState<'list' | 'detail' | 'template'>('list');
  const [selectedSopId, setSelectedSopId] = useState<string | null>(null);

  const selectedSop = sops.find(s => s.id === selectedSopId) || null;

  const fetchData = async () => {
    try {
        setLoading(true);
        const [fetchedSops, fetchedScenes, fetchedPeople] = await Promise.all([
            api.getSOPs(),
            api.getAllScenes().catch(() => []), // Fallback if fails
            api.getAllPeople().catch(() => [])  // Fallback if fails
        ]);
        setSops(fetchedSops);
        setAllScenes(fetchedScenes);
        setAllPeople(fetchedPeople);
    } catch (error) {
        console.error("Failed to load data", error);
        // Optionally show toast/alert
    } finally {
        setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const filteredSops = sops.filter(sop => {
    const matchesCategory = activeCategory === 'all' || sop.category === activeCategory;
    const matchesSearch = sop.title.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          sop.tags.some(tag => tag.toLowerCase().includes(searchTerm.toLowerCase()));
    return matchesCategory && matchesSearch;
  });

  // Calculate hot tags
  const hotTags = useMemo(() => {
    const tagCounts = sops.flatMap(s => s.tags || []).reduce((acc, tag) => {
      acc[tag] = (acc[tag] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    return Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(entry => entry[0]);
  }, [sops]);

  const handleOpenDetail = (id: string) => {
    setSelectedSopId(id);
    setViewMode('detail');
  };

  const handleBack = () => {
    setViewMode('list');
    setSelectedSopId(null);
    fetchData(); // Refresh list on back
  };

  const debouncedSave = useDebouncedCallback(async (updatedSop: SOPEntity) => {
    try {
        console.log(`[Debounce] Saving SOP ${updatedSop.id}:`, updatedSop.title);
        await api.createSOP(updatedSop);
    } catch (error) {
        console.error("Failed to save SOP", error);
    } finally {
        setIsSaving(false);
    }
  }, 1000);

  const handleSaveSop = async (updatedSop: SOPEntity) => {
    setIsSaving(true);
    // Optimistic update
    setSops(prev => prev.map(s => s.id === updatedSop.id ? updatedSop : s));
    
    // Debounced API call
    debouncedSave(updatedSop);
  };

  const handleDeleteSop = async (id: string) => {
    if (confirm('确定要删除这个方法论吗？此操作无法撤销。')) {
        try {
            await api.deleteSOP(id);
            setSops(prev => prev.filter(s => s.id !== id));
            setSelectedSopId(null);
            setViewMode('list');
        } catch (error) {
            console.error("Failed to delete SOP", error);
            alert("删除失败，请重试");
        }
    }
  };
  
  const handleCreateFromTemplate = async () => {
      // Show loading state first
      setLoading(true);
      
      const newSop: Partial<SOPEntity> = {
          title: '未命名方法论',
          category: 'people',
          tags: [],
          version: 'V1.0',
          content: '## 新方法论标题\n\n开始输入你的内容...',
          related: { scenes: [], people: [], sops: [] }, 
          history: [{ version: 'V1.0', date: new Date().toISOString().split('T')[0], note: '初始创建' }],
          stats: { use_count: 0, avg_score: 0, last_used: '-', related_scenes_count: 0 },
          validation: []
      };
      
      try {
          const result = await api.createSOP(newSop);
          
          const createdSop = {
              ...newSop,
              id: result.id,
              created_at: new Date().toISOString().split('T')[0],
              updated_at: new Date().toISOString().split('T')[0],
              stats: { use_count: 0, avg_score: 0, last_used: '-', related_scenes_count: 0 },
              related: { scenes: [], people: [], sops: [] },
              history: [{ version: 'V1.0', date: new Date().toISOString().split('T')[0], note: '初始创建' }],
              validation: []
          } as SOPEntity;

          setSops(prev => [createdSop, ...prev]);
          setSelectedSopId(result.id);
          setViewMode('detail');
          
          // Background fetch to sync - REMOVED to avoid race condition overwriting optimistic state
          // fetchData();
      } catch (error: any) {
          console.error("Failed to create SOP", error);
          alert(`创建失败: ${error.message || "请检查网络连接"}`);
      } finally {
          setLoading(false);
      }
  }

  const getCategoryName = (id: string) => {
      const cat = MOCK_CATEGORIES.find(c => c.id === id);
      return cat ? cat.name : '未分类';
  };

  return (
    <div className="flex h-full bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden relative">
      
      {/* Mobile Sidebar Overlay */}
      {showMobileSidebar && (
        <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setShowMobileSidebar(false)} />
      )}

      {/* Sidebar - Desktop & Mobile Drawer */}
      <div className={`
        fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-gray-100 p-6 transform transition-transform duration-300 ease-in-out lg:static lg:translate-x-0 lg:bg-gray-50/50 lg:block
        ${showMobileSidebar ? 'translate-x-0' : '-translate-x-full'}
        ${viewMode !== 'list' ? 'hidden lg:block' : ''}
      `}>
        <div className="flex justify-between items-center mb-6">
            <h2 className="text-lg font-bold text-gray-900 flex items-center">
            <BookOpen className="w-5 h-5 mr-2 text-primary" />
            知识库体系
            </h2>
            <button onClick={() => setShowMobileSidebar(false)} className="lg:hidden text-gray-500">
                <X className="w-5 h-5" />
            </button>
        </div>
        
        <nav className="space-y-1">
          {MOCK_CATEGORIES.map(cat => (
            <button
              key={cat.id}
              onClick={() => { setActiveCategory(cat.id); setViewMode('list'); setShowMobileSidebar(false); }}
              className={`
                w-full flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors
                ${activeCategory === cat.id 
                  ? 'bg-white text-primary shadow-sm border border-gray-100' 
                  : 'text-gray-600 hover:bg-white hover:text-gray-900'}
              `}
            >
              <span className={`w-2 h-2 rounded-full mr-3 ${activeCategory === cat.id ? 'bg-primary' : 'bg-gray-300'}`}></span>
              {cat.name}
            </button>
          ))}
        </nav>
        
        <div className="mt-8 pt-6 border-t border-gray-200">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">热门标签</h3>
          <div className="flex flex-wrap gap-2">
            {hotTags.length > 0 ? hotTags.map(tag => (
              <button 
                key={tag} 
                onClick={() => { setSearchTerm(tag); setViewMode('list'); }}
                className="px-2 py-1 bg-white border border-gray-200 rounded text-xs text-gray-600 cursor-pointer hover:border-primary hover:text-primary transition-colors"
              >
                #{tag}
              </button>
            )) : (
              <span className="text-xs text-gray-400">暂无标签</span>
            )}
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 bg-white">
        
        {viewMode === 'list' && (
          <>
            <header className="px-4 lg:px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-white gap-2">
              <div className="flex items-center flex-1 max-w-lg relative gap-2">
                <button 
                  onClick={() => setShowMobileSidebar(true)} 
                  className="lg:hidden p-2 -ml-2 text-gray-500 hover:bg-gray-100 rounded-lg"
                >
                  <Menu className="w-5 h-5" />
                </button>
                <div className="flex-1 relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Search className="h-4 w-4 text-gray-400" />
                  </div>
                  <input
                  type="text"
                  className="block w-full pl-10 pr-3 py-2 border border-gray-200 rounded-lg leading-5 bg-gray-50 placeholder-gray-400 focus:outline-none focus:bg-white focus:ring-1 focus:ring-primary focus:border-primary sm:text-sm transition-colors"
                  placeholder="搜索方法论、标签..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
            </div>
              <div className="ml-4 flex items-center space-x-3">
                <button 
                  onClick={() => setViewMode('template')}
                  className="flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg shadow-sm text-white bg-primary hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition-colors"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  新建 SOP
                </button>
              </div>
            </header>

            <div className="flex-1 overflow-y-auto p-6 bg-gray-50/30">
              {loading ? (
                  <div className="flex justify-center items-center h-full">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                  </div>
              ) : (
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {filteredSops.map(sop => (
                      <div 
                        key={sop.id} 
                        onClick={() => handleOpenDetail(sop.id)}
                        className="bg-white border border-gray-100 rounded-xl p-5 hover:shadow-md transition-shadow cursor-pointer group hover:border-primary/30 flex flex-col h-[200px]"
                      >
                        <div className="flex justify-between items-start mb-4">
                          <div className="flex items-center space-x-2">
                            <span className="px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700 border border-blue-100">
                              {sop.version}
                            </span>
                            <span className="text-xs text-gray-400">{sop.updated_at}</span>
                          </div>
                          <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                            <BookOpen className="h-4 w-4 text-gray-400 hover:text-primary" />
                          </div>
                        </div>
                        <h3 className="text-base font-bold text-gray-900 mb-2 group-hover:text-primary transition-colors line-clamp-2">
                          {sop.title}
                        </h3>
                        <p className="text-sm text-gray-500 line-clamp-3 mb-4 flex-1">
                            {sop.content ? sop.content.replace(/[#*`]/g, '') : ''}
                        </p>
                        <div className="flex flex-wrap gap-2 mt-auto">
                          {/* Category Badge */}
                          <span className="flex items-center px-2 py-1 rounded-md text-xs font-medium bg-gray-100 text-gray-700 border border-gray-200">
                              <Folder className="w-3 h-3 mr-1 opacity-60" />
                              {getCategoryName(sop.category)}
                          </span>
                          
                          {/* Tags */}
                          {sop.tags && sop.tags.slice(0, 3).map(tag => (
                            <span key={tag} className="flex items-center px-2 py-1 rounded-md text-xs font-medium bg-gray-50 text-gray-600">
                              <Tag className="w-3 h-3 mr-1 opacity-50" />
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
              )}
            </div>
          </>
        )}

        {viewMode === 'detail' && (
          selectedSop ? (
            <SOPDetailView 
              sop={selectedSop} 
              allScenes={allScenes}
              allPeople={allPeople}
              isSaving={isSaving}
              onBack={handleBack} 
              onUpdate={handleSaveSop} 
              onDelete={() => handleDeleteSop(selectedSop.id)}
            />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center h-full text-gray-400">
                {loading ? (
                    <>
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mb-4"></div>
                        <p>正在加载内容...</p>
                    </>
                ) : (
                    <>
                        <FileText className="w-12 h-12 mb-4 opacity-50" />
                        <p>未找到该方法论或已被删除</p>
                        <button onClick={handleBack} className="mt-4 text-primary hover:underline">返回列表</button>
                    </>
                )}
            </div>
          )
        )}

        {viewMode === 'template' && (
            <SOPTemplateSelector 
                onSelect={handleCreateFromTemplate}
                onCancel={() => setViewMode('list')}
            />
        )}

      </div>
    </div>
  );
}

// --- Sub-Components ---

function SOPDetailView({ sop, allScenes, allPeople, isSaving, onBack, onUpdate, onDelete }: { sop: SOPEntity; allScenes: any[]; allPeople: any[]; isSaving: boolean; onBack: () => void; onUpdate: (sop: SOPEntity) => void; onDelete: () => void }) {
  const [showMenu, setShowMenu] = useState(false);
  const [showRelationModal, setShowRelationModal] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);

  const handleAIAnalyze = async () => {
    if (!sop.content) return;
    setAnalyzing(true);
    try {
        const result = await api.analyzeSOP(sop.content);
        if (result) {
            onUpdate({
                ...sop,
                title: result.title || sop.title,
                tags: result.tags || sop.tags,
                category: result.category || sop.category,
                updated_at: new Date().toISOString().split('T')[0] 
            });
            alert(`AI 提取完成！\n标题：${result.title}\n标签：${result.tags.join(', ')}`);
        }
    } catch (e) {
        alert("AI 分析失败");
    } finally {
        setAnalyzing(false);
    }
  };
  
  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const newTitle = e.target.value;
      let newContent = sop.content;
      
      // Update H1 in content if it exists
      if (newContent) {
          if (/^#\s+(.+)$/m.test(newContent)) {
              newContent = newContent.replace(/^#\s+(.+)$/m, `# ${newTitle}`);
          } else {
              // Prepend H1 if not exists
              newContent = `# ${newTitle}\n\n${newContent}`;
          }
      } else {
          newContent = `# ${newTitle}`;
      }

      onUpdate({ 
          ...sop, 
          title: newTitle, 
          content: newContent,
          updated_at: new Date().toISOString().split('T')[0] 
      });
  };

  const handleCategoryChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
      onUpdate({ ...sop, category: e.target.value as any, updated_at: new Date().toISOString().split('T')[0] });
  };

  const handleTagsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const tags = e.target.value.split(',').map(t => t.trim());
      onUpdate({ ...sop, tags, updated_at: new Date().toISOString().split('T')[0] });
  };

  const handleContentUpdate = (newContent: string) => {
      // Auto-extract title: Find first H1
      const h1Match = newContent.match(/^#\s+(.+)$/m);
      let newTitle = sop.title;
      
      if (h1Match) {
          newTitle = h1Match[1].trim();
      }

      const updatedSop = { 
          ...sop, 
          content: newContent, 
          updated_at: new Date().toISOString().split('T')[0] 
      };

      if (newTitle !== sop.title) {
          updatedSop.title = newTitle;
      }
      
      onUpdate(updatedSop);
  };

  const handleCreateVersion = () => {
      const note = prompt('请输入新版本变更说明：', '日常更新');
      if (note === null) return;

      const currentVersionNum = parseFloat(sop.version.replace('V', ''));
      const newVersion = `V${(currentVersionNum + 0.1).toFixed(1)}`;
      
      const newHistoryItem = {
          version: newVersion,
          date: new Date().toISOString().split('T')[0],
          note: note
      };

      onUpdate({
          ...sop,
          version: newVersion,
          updated_at: new Date().toISOString().split('T')[0],
          history: [newHistoryItem, ...sop.history]
      });
      
      setShowMenu(false);
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-white">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-white flex-shrink-0">
        <div className="flex items-center flex-1 mr-4">
          <button onClick={onBack} className="mr-4 p-2 hover:bg-gray-100 rounded-full transition-colors">
            <ArrowLeft className="h-5 w-5 text-gray-500" />
          </button>
          <div className="flex-1 relative">
             <input
                value={sop.title}
                onChange={handleTitleChange}
                className="text-xl font-bold text-gray-900 w-full px-0 py-1 border-none focus:ring-0 focus:outline-none bg-transparent pr-8"
                placeholder="输入方法论标题"
             />
             <button 
                onClick={handleAIAnalyze}
                disabled={analyzing}
                className="absolute right-0 top-1/2 -translate-y-1/2 p-1 text-primary hover:bg-primary/10 rounded transition-colors"
                title="AI 智能提取标题和标签"
            >
                <Sparkles className={`w-4 h-4 ${analyzing ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
        <div className="flex items-center space-x-3">
            <span className="text-xs text-gray-400">
                {isSaving ? (
                    <span className="flex items-center text-primary">
                        <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-primary mr-1"></div>
                        保存中...
                    </span>
                ) : "已自动保存"}
            </span>
            <div className="h-4 w-px bg-gray-200"></div>
            <button className="p-2 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-50">
                <Share2 className="h-5 w-5" />
            </button>
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
                            <button 
                                onClick={handleCreateVersion}
                                className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center"
                            >
                                <Save className="w-4 h-4 mr-2" />
                                发布新版本
                            </button>
                            <button 
                                onClick={() => { onDelete(); setShowMenu(false); }}
                                className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center"
                            >
                                <Trash2 className="w-4 h-4 mr-2" />
                                删除方法论
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 lg:p-8 bg-gray-50">
        <div className="max-w-6xl mx-auto space-y-6">
          
          {/* Meta Info & Stats Bar */}
          <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm flex flex-wrap items-center justify-between gap-4">
             <div className="flex items-center space-x-6 flex-1 min-w-[300px]">
                 <div className="flex items-center space-x-2">
                     <span className="text-sm text-gray-500">分类:</span>
                     <select 
                        value={sop.category} 
                        onChange={handleCategoryChange}
                        className="border-none bg-gray-50 rounded-md text-sm font-medium text-gray-700 focus:ring-primary py-1 px-2"
                     >
                        {MOCK_CATEGORIES.filter(c => c.id !== 'all').map(c => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                     </select>
                 </div>
                 <div className="flex items-center space-x-2 flex-1">
                     <span className="text-sm text-gray-500 flex-shrink-0"><Tag className="w-3 h-3 inline"/> 标签:</span>
                     <input 
                        type="text" 
                        value={sop.tags ? sop.tags.join(', ') : ''} 
                        onChange={handleTagsChange}
                        className="w-full border-none bg-transparent text-sm focus:ring-0 px-0 placeholder-gray-400"
                        placeholder="添加标签 (逗号分隔)..."
                     />
                 </div>
             </div>
             <div className="flex items-center space-x-4 text-xs text-gray-400 border-l border-gray-100 pl-4">
                 <span>创建于 {sop.created_at}</span>
                 <span>更新于 {sop.updated_at}</span>
                 <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded font-medium">{sop.version}</span>
             </div>
          </div>

          {/* Editor Area (Tiptap) */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden flex flex-col flex-1 min-h-[500px] relative">
             <TiptapEditor 
                key={sop.id} // Important: force remount when switching SOPs
                content={sop.content || ''} 
                onChange={handleContentUpdate} 
             />
          </div>

          {/* Stats Card */}
          <div className="bg-white border border-gray-100 rounded-xl p-6 shadow-sm">
            <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider flex items-center mb-4">
                <Activity className="w-4 h-4 mr-2 text-primary"/> 使用统计
            </h3>
            <div className="grid grid-cols-4 gap-4 text-center divide-x divide-gray-100">
                <div>
                    <div className="text-2xl font-bold text-gray-900">{sop.stats?.use_count || 0}</div>
                    <div className="text-xs text-gray-500 mt-1">使用次数</div>
                </div>
                <div>
                    <div className="text-2xl font-bold text-green-600">{sop.stats?.avg_score || 0}</div>
                    <div className="text-xs text-gray-500 mt-1">平均评分</div>
                </div>
                <div>
                    <div className="text-2xl font-bold text-gray-900">{sop.stats?.last_used || '-'}</div>
                    <div className="text-xs text-gray-500 mt-1">最近使用</div>
                </div>
                <div>
                    <div className="text-2xl font-bold text-gray-900">{sop.stats?.related_scenes_count || 0}</div>
                    <div className="text-xs text-gray-500 mt-1">关联场景</div>
                </div>
            </div>
          </div>

          {/* Related & History Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Related */}
              <div className="bg-white border border-gray-100 rounded-xl p-6 shadow-sm">
                  <div className="flex justify-between items-center mb-4">
                      <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider flex items-center">
                          <LinkIcon className="w-4 h-4 mr-2 text-primary"/> 关联内容
                      </h3>
                      <button 
                          onClick={() => setShowRelationModal(true)}
                          className="text-xs text-primary hover:text-primary/80 font-medium"
                      >
                          管理关联
                      </button>
                  </div>
                  <div className="space-y-4">
                      <div>
                          <h4 className="text-xs font-semibold text-gray-500 mb-2">关联场景</h4>
                          <div className="space-y-2">
                              {sop.related?.scenes?.map(s => (
                                  <div key={s.id} className="flex justify-between items-center p-2 bg-gray-50 rounded-lg text-sm hover:bg-gray-100 cursor-pointer">
                                      <span>🎯 {s.title}</span>
                                      <span className="text-green-600 font-medium">{s.score}分</span>
                                  </div>
                              ))}
                              {(!sop.related?.scenes || sop.related.scenes.length === 0) && <div className="text-xs text-gray-400 italic">暂无关联场景</div>}
                          </div>
                      </div>
                      <div>
                          <h4 className="text-xs font-semibold text-gray-500 mb-2">关联人物</h4>
                          <div className="space-y-2">
                              {sop.related?.people?.map(p => (
                                  <div key={p.id} className="flex justify-between items-center p-2 bg-gray-50 rounded-lg text-sm hover:bg-gray-100 cursor-pointer">
                                      <span>👤 {p.name}</span>
                                      <span className="text-gray-500 text-xs">{p.role}</span>
                                  </div>
                              ))}
                              {(!sop.related?.people || sop.related.people.length === 0) && <div className="text-xs text-gray-400 italic">暂无关联人物</div>}
                          </div>
                      </div>
                  </div>
              </div>

              {/* History */}
              <div className="bg-white border border-gray-100 rounded-xl p-6 shadow-sm">
                  <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider flex items-center mb-4">
                      <Clock className="w-4 h-4 mr-2 text-primary"/> 迭代历史
                  </h3>
                  <div className="relative pl-4 border-l-2 border-gray-100 space-y-6">
                      {sop.history?.map((h, i) => (
                          <div key={i} className="relative">
                              <div className="absolute -left-[21px] top-1.5 w-3 h-3 rounded-full bg-white border-2 border-primary"></div>
                              <div className="flex justify-between items-start">
                                  <span className="font-bold text-gray-900 text-sm">{h.version}</span>
                                  <span className="text-xs text-gray-400">{h.date}</span>
                              </div>
                              <p className="text-xs text-gray-500 mt-1">{h.note}</p>
                          </div>
                      ))}
                  </div>
              </div>
          </div>
          
          {/* Validation Records */}
           <div className="bg-white border border-gray-100 rounded-xl p-6 shadow-sm">
                <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider flex items-center mb-4">
                    <CheckSquare className="w-4 h-4 mr-2 text-primary"/> 验证记录
                </h3>
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead>
                            <tr>
                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">场景名称</th>
                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">日期</th>
                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">评分</th>
                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">备注</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                            {sop.validation?.map((v, i) => (
                                <tr key={i}>
                                    <td className="px-3 py-2 text-sm text-gray-900">{v.scene}</td>
                                    <td className="px-3 py-2 text-sm text-gray-500">{v.date}</td>
                                    <td className="px-3 py-2 text-sm font-medium text-green-600">{v.score}/10</td>
                                    <td className="px-3 py-2 text-sm text-gray-500">{v.note}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {(!sop.validation || sop.validation.length === 0) && <div className="text-center py-4 text-sm text-gray-400">暂无验证记录</div>}
                </div>
           </div>

           {showRelationModal && (
              <RelationManagerModal 
                  sop={sop}
                  allScenes={allScenes}
                  allPeople={allPeople}
                  onClose={() => setShowRelationModal(false)}
                  onUpdate={(newRelated) => {
                      onUpdate({ ...sop, related: newRelated });
                      setShowRelationModal(false);
                  }}
              />
          )}

        </div>
      </div>
    </div>
  );
}

const TiptapEditor = ({ content, onChange }: { content: string, onChange: (content: string) => void }) => {
    const uploadImage = useCallback(async (file: File) => {
        try {
            const { url } = await api.uploadImage(file);
            return url;
        } catch (error) {
            console.error('Failed to upload image', error);
            alert('图片上传失败，请重试');
            return null;
        }
    }, []);

    const editor = useEditor({
        extensions: [
            StarterKit.configure({
                bulletList: {
                    keepMarks: true,
                    keepAttributes: false,
                },
                orderedList: {
                    keepMarks: true,
                    keepAttributes: false,
                },
            }),
            Link.configure({ openOnClick: false }),
            Image.extend({
                addAttributes() {
                    return {
                        ...this.parent?.(),
                        width: {
                            default: '100%',
                            renderHTML: attributes => ({
                                width: attributes.width,
                            }),
                        },
                    }
                },
                addNodeView() {
                    return ReactNodeViewRenderer(ResizableImageComponent);
                },
            }).configure({
                inline: true,
                allowBase64: true,
            }),
            Heading.configure({
                levels: [1, 2, 3, 4, 5, 6],
            }),
            TaskList,
            TaskItem.configure({ 
                nested: true,
                HTMLAttributes: {
                    class: 'flex items-start space-x-2',
                },
            }),
            Placeholder.configure({ placeholder: '开始输入内容... (支持 Markdown 快捷键，如 # 标题，- 列表，[ ] 任务，支持截图粘贴)' }),
        ],
        content: mdParser.render(content), // Initial content: Markdown -> HTML
        editorProps: {
            attributes: {
                class: 'prose prose-sm max-w-none focus:outline-none min-h-[500px] p-8 outline-none [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5 [&_h1]:text-3xl [&_h1]:font-bold [&_h1]:mb-4 [&_h2]:text-2xl [&_h2]:font-bold [&_h2]:mb-3 [&_h2]:mt-6 [&_h3]:text-xl [&_h3]:font-bold [&_h3]:mb-2 [&_h3]:mt-4 [&_h4]:text-lg [&_h4]:font-bold [&_h4]:mb-2 [&_h5]:text-base [&_h5]:font-bold [&_h5]:mb-1 [&_h6]:text-sm [&_h6]:font-bold [&_h6]:text-gray-500 [&_li_p]:m-0 [&_ul[data-type="taskList"]]:list-none [&_ul[data-type="taskList"]]:pl-0 [&_img]:rounded-lg [&_img]:shadow-sm [&_img]:max-w-full [&_img]:my-4',
            },
            handlePaste: (view, event, _slice) => {
                const items = Array.from(event.clipboardData?.items || []);
                const item = items.find(item => item.type.indexOf('image') === 0);

                if (item) {
                    event.preventDefault();
                    const file = item.getAsFile();
                    if (file) {
                        uploadImage(file).then(url => {
                            if (url) {
                                const { schema } = view.state;
                                const node = schema.nodes.image.create({ src: url });
                                const transaction = view.state.tr.replaceSelectionWith(node);
                                view.dispatch(transaction);
                            }
                        });
                    }
                    return true;
                }
                return false;
            },
            handleDrop: (view, event, _slice, moved) => {
                if (!moved && event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0]) {
                    const file = event.dataTransfer.files[0];
                    if (file.type.indexOf('image') === 0) {
                        event.preventDefault();
                        uploadImage(file).then(url => {
                            if (url) {
                                const { schema } = view.state;
                                const coordinates = view.posAtCoords({ left: event.clientX, top: event.clientY });
                                if (coordinates) {
                                    const node = schema.nodes.image.create({ src: url });
                                    const transaction = view.state.tr.insert(coordinates.pos, node);
                                    view.dispatch(transaction);
                                }
                            }
                        });
                        return true;
                    }
                }
                return false;
            }
        },
        onUpdate: ({ editor }) => {
             const html = editor.getHTML();
             const markdown = turndownService.turndown(html);
             onChange(markdown);
        }
    });

    const addImage = useCallback(() => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = async () => {
            if (input.files?.length) {
                const file = input.files[0];
                const url = await uploadImage(file);
                if (url) {
                    editor?.chain().focus().setImage({ src: url }).run();
                }
            }
        };
        input.click();
    }, [editor, uploadImage]);

    if (!editor) {
        return null;
    }

    // Sync content if it changes externally (e.g. title update)
    useEffect(() => {
        if (editor && content) {
            const currentHTML = editor.getHTML();
            const newHTML = mdParser.render(content);
            const currentMarkdown = turndownService.turndown(currentHTML);
            if (currentMarkdown.trim() !== content.trim()) {
                 if (!editor.isFocused) {
                     editor.commands.setContent(newHTML);
                 }
            }
        }
    }, [content, editor]);

    return (
        <div className="flex h-full min-h-[500px] relative">
            {/* Outline / Table of Contents (Left Side) - Simplified */}
            <div className="hidden xl:block w-48 sticky top-0 h-full overflow-y-auto pr-4 border-r border-gray-100 py-4 mr-4">
                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3 pl-2">大纲</h4>
                <TableOfContents editor={editor} />
            </div>

            <div className="flex-1 flex flex-col min-w-0">
                <EditorToolbar editor={editor} onAddImage={addImage} />
                <div className="flex-1 bg-white cursor-text p-8" onClick={() => editor.chain().focus().run()}>
                    <EditorContent editor={editor} />
                </div>
            </div>
        </div>
    )
}

const TableOfContents = ({ editor }: { editor: any }) => {
    const [headings, setHeadings] = useState<{ level: number; text: string; id: string; pos: number }[]>([]);

    useEffect(() => {
        if (!editor) return;

        const updateHeadings = () => {
            const items: any[] = [];
            editor.state.doc.descendants((node: any, pos: number) => {
                if (node.type.name === 'heading') {
                    items.push({
                        level: node.attrs.level,
                        text: node.textContent,
                        id: `heading-${pos}`, // Simple ID
                        pos: pos
                    });
                }
            });
            setHeadings(items);
        };

        updateHeadings();
        editor.on('update', updateHeadings);

        return () => {
            editor.off('update', updateHeadings);
        };
    }, [editor]);

    if (headings.length === 0) return <div className="text-xs text-gray-300 pl-2">暂无标题</div>;

    return (
        <ul className="space-y-1">
            {headings.map((heading, index) => (
                <li 
                    key={index} 
                    className={`
                        text-xs cursor-pointer hover:text-primary transition-colors truncate
                        ${heading.level === 1 ? 'font-bold text-gray-800 pl-0' : ''}
                        ${heading.level === 2 ? 'font-medium text-gray-600 pl-2' : ''}
                        ${heading.level >= 3 ? 'text-gray-500 pl-4' : ''}
                    `}
                    onClick={() => {
                        editor.chain().focus().setTextSelection(heading.pos + 1).run();
                        const element = document.querySelector(`.ProseMirror h${heading.level}`);
                        if(element) element.scrollIntoView({ behavior: 'smooth' });
                    }}
                >
                    {heading.text || '(空标题)'}
                </li>
            ))}
        </ul>
    );
};

const EditorToolbar = ({ editor, onAddImage }: { editor: any, onAddImage: () => void }) => {
    if (!editor) return null;

    return (
        <div className="border-b border-gray-200 p-2 flex items-center space-x-1 overflow-x-auto bg-gray-50 sticky top-0 z-10">
            <ToolbarBtn 
                onClick={() => editor.chain().focus().toggleBold().run()} 
                isActive={editor.isActive('bold')} 
                icon={<Bold className="w-4 h-4"/>} 
            />
            <ToolbarBtn 
                onClick={() => editor.chain().focus().toggleItalic().run()} 
                isActive={editor.isActive('italic')} 
                icon={<Italic className="w-4 h-4"/>} 
            />
            <ToolbarBtn 
                onClick={() => editor.chain().focus().toggleStrike().run()} 
                isActive={editor.isActive('strike')} 
                icon={<Strikethrough className="w-4 h-4"/>} 
            />
            <ToolbarBtn 
                onClick={() => editor.chain().focus().toggleCode().run()} 
                isActive={editor.isActive('code')} 
                icon={<Code className="w-4 h-4"/>} 
            />
            <div className="w-px h-4 bg-gray-300 mx-2"></div>
            <ToolbarBtn 
                onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} 
                isActive={editor.isActive('heading', { level: 1 })} 
                icon={<Type className="w-4 h-4"/>} 
                label="H1" 
            />
            <ToolbarBtn 
                onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} 
                isActive={editor.isActive('heading', { level: 2 })} 
                icon={<Type className="w-4 h-4"/>} 
                label="H2" 
            />
            <ToolbarBtn 
                onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} 
                isActive={editor.isActive('heading', { level: 3 })} 
                icon={<Type className="w-3 h-3"/>} 
                label="H3" 
            />
            <div className="w-px h-4 bg-gray-300 mx-2"></div>
            <ToolbarBtn 
                onClick={() => editor.chain().focus().toggleBulletList().run()} 
                isActive={editor.isActive('bulletList')} 
                icon={<List className="w-4 h-4"/>} 
            />
            <ToolbarBtn 
                onClick={() => editor.chain().focus().toggleOrderedList().run()} 
                isActive={editor.isActive('orderedList')} 
                icon={<ListOrdered className="w-4 h-4"/>} 
            />
            <ToolbarBtn 
                onClick={() => editor.chain().focus().toggleTaskList().run()} 
                isActive={editor.isActive('taskList')} 
                icon={<CheckSquare className="w-4 h-4"/>} 
            />
            <div className="w-px h-4 bg-gray-300 mx-2"></div>
            <ToolbarBtn 
                onClick={() => editor.chain().focus().toggleBlockquote().run()} 
                isActive={editor.isActive('blockquote')} 
                icon={<Quote className="w-4 h-4"/>} 
            />
            <div className="w-px h-4 bg-gray-300 mx-2"></div>
            <ToolbarBtn 
                onClick={onAddImage} 
                icon={<ImageIcon className="w-4 h-4"/>} 
                label="图片"
            />
        </div>
    );
};

function ToolbarBtn({ icon, label, onClick, isActive }: { icon: React.ReactNode; label?: string; onClick?: () => void; isActive?: boolean }) {
    return (
        <button 
            onClick={onClick}
            className={`p-1.5 rounded flex items-center space-x-1 transition-colors ${isActive ? 'bg-gray-200 text-black' : 'text-gray-600 hover:bg-gray-200'}`}
        >
            {icon}
            {label && <span className="text-xs font-bold">{label}</span>}
        </button>
    );
}

function SOPTemplateSelector({ onSelect, onCancel }: { onSelect: () => void; onCancel: () => void }) {
    const templates = [
        { title: '🎯 训练复盘模板', desc: '场景描述 / 我的表现 / AI反馈 / 改进方案' },
        { title: '🤝 识人方法模板', desc: '性格类型 / 识别信号 / 相处建议 / 话术示例' },
        { title: '💼 商业分析模板', desc: '机会描述 / 验证过程 / 结论判断 / 行动建议' },
        { title: '📣 个人品牌模板', desc: '定位陈述 / 内容规划 / 传播渠道 / 效果追踪' },
    ];

    return (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl p-8">
                <div className="flex justify-between items-center mb-8">
                    <h2 className="text-2xl font-bold text-gray-900">📋 选择 SOP 模板</h2>
                    <button onClick={onCancel} className="text-gray-400 hover:text-gray-600">
                        <X className="w-6 h-6" />
                    </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                    {templates.map((t, i) => (
                        <div key={i} className="border border-gray-200 rounded-xl p-6 hover:border-primary hover:shadow-md cursor-pointer transition-all text-center group" onClick={onSelect}>
                            <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4 group-hover:bg-primary/20">
                                <FileText className="w-6 h-6 text-primary" />
                            </div>
                            <h3 className="font-bold text-gray-900 mb-2">{t.title}</h3>
                            <p className="text-xs text-gray-500">{t.desc}</p>
                            <button className="mt-4 text-sm text-primary font-medium hover:underline">使用模板</button>
                        </div>
                    ))}
                </div>

                <div className="border-t border-gray-100 pt-6 flex justify-between items-center">
                    <div className="flex space-x-4">
                        <button className="flex items-center px-4 py-2 bg-purple-50 text-purple-700 rounded-lg hover:bg-purple-100 text-sm font-medium border border-purple-100">
                            <RotateCcw className="w-4 h-4 mr-2" />
                            从最近训练生成
                        </button>
                        <button className="flex items-center px-4 py-2 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 text-sm font-medium border border-blue-100">
                            <RotateCcw className="w-4 h-4 mr-2" />
                            从真实复盘提取
                        </button>
                    </div>
                    <button onClick={onSelect} className="text-gray-500 hover:text-gray-700 text-sm">
                        跳过，直接创建空白文档 &rarr;
                    </button>
                </div>
            </div>
        </div>
    );
}

function RelationManagerModal({ sop, allScenes, allPeople, onClose, onUpdate }: { sop: SOPEntity; allScenes: any[]; allPeople: any[]; onClose: () => void; onUpdate: (related: SOPEntity['related']) => void }) {
    const [selectedScenes, setSelectedScenes] = useState<string[]>(sop.related?.scenes?.map(s => s.id) || []);
    const [selectedPeople, setSelectedPeople] = useState<string[]>(sop.related?.people?.map(p => p.id) || []);

    const handleSave = () => {
        const newScenes = allScenes.filter(s => selectedScenes.includes(s.id)).map(s => {
            const existing = sop.related?.scenes?.find(ex => ex.id === s.id);
            return existing || { ...s, score: 0, date: new Date().toISOString().split('T')[0] };
        });
        
        const newPeople = allPeople.filter(p => selectedPeople.includes(p.id)).map(p => {
             const existing = sop.related?.people?.find(ex => ex.id === p.id);
             return existing || { ...p };
        });

        onUpdate({
            ...sop.related,
            scenes: newScenes,
            people: newPeople
        });
    };

    const toggleScene = (id: string) => {
        setSelectedScenes(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
    }

    const togglePerson = (id: string) => {
        setSelectedPeople(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
    }

    return (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl p-6 flex flex-col max-h-[80vh]">
                <div className="flex justify-between items-center mb-6 flex-shrink-0">
                    <div className="flex items-center space-x-3">
                        <h2 className="text-xl font-bold text-gray-900">🔗 管理关联内容</h2>
                        <button 
                            onClick={() => alert('🤖 AI 正在分析 SOP 内容...\n\n推荐关联：\n- 场景：投资人见面会 (85%)\n- 人物：张投资 (78%)')}
                            className="px-2 py-1 bg-purple-50 text-purple-600 rounded text-xs font-medium flex items-center hover:bg-purple-100 transition-colors"
                        >
                            <Sparkles className="w-3 h-3 mr-1" />
                            AI 智能推荐
                        </button>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                        <X className="w-6 h-6" />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto space-y-8 pr-2">
                    {/* Scenes */}
                    <div>
                        <h3 className="text-sm font-bold text-gray-700 mb-3 flex items-center">
                            <span className="bg-blue-100 text-blue-600 p-1 rounded mr-2"><Activity className="w-4 h-4"/></span>
                            关联场景
                        </h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {allScenes.map(scene => (
                                <div 
                                    key={scene.id}
                                    onClick={() => toggleScene(scene.id)}
                                    className={`p-3 rounded-lg border cursor-pointer transition-all flex items-center justify-between ${
                                        selectedScenes.includes(scene.id) 
                                        ? 'border-primary bg-primary/5 ring-1 ring-primary' 
                                        : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                                    }`}
                                >
                                    <span className="text-sm font-medium text-gray-900">{scene.title || scene.scene_type}</span>
                                    {selectedScenes.includes(scene.id) && <CheckSquare className="w-4 h-4 text-primary" />}
                                </div>
                            ))}
                            {allScenes.length === 0 && <div className="text-sm text-gray-400">暂无场景数据</div>}
                        </div>
                    </div>

                    {/* People */}
                    <div>
                        <h3 className="text-sm font-bold text-gray-700 mb-3 flex items-center">
                            <span className="bg-purple-100 text-purple-600 p-1 rounded mr-2"><BookOpen className="w-4 h-4"/></span>
                            关联人物
                        </h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {allPeople.map(person => (
                                <div 
                                    key={person.id}
                                    onClick={() => togglePerson(person.id)}
                                    className={`p-3 rounded-lg border cursor-pointer transition-all flex items-center justify-between ${
                                        selectedPeople.includes(person.id) 
                                        ? 'border-primary bg-primary/5 ring-1 ring-primary' 
                                        : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                                    }`}
                                >
                                    <div>
                                        <div className="text-sm font-medium text-gray-900">{person.name}</div>
                                        <div className="text-xs text-gray-500">{person.identity || person.role}</div>
                                    </div>
                                    {selectedPeople.includes(person.id) && <CheckSquare className="w-4 h-4 text-primary" />}
                                </div>
                            ))}
                            {allPeople.length === 0 && <div className="text-sm text-gray-400">暂无人物数据</div>}
                        </div>
                    </div>
                </div>

                <div className="mt-6 pt-6 border-t border-gray-100 flex justify-end space-x-3 flex-shrink-0">
                    <button 
                        onClick={onClose}
                        className="px-4 py-2 text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm font-medium transition-colors"
                    >
                        取消
                    </button>
                    <button 
                        onClick={handleSave}
                        className="px-6 py-2 text-white bg-primary hover:bg-primary/90 rounded-lg text-sm font-medium shadow-sm transition-colors"
                    >
                        确认关联
                    </button>
                </div>
            </div>
        </div>
    );
}
