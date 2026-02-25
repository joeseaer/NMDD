import { useState, useEffect } from 'react';
import { Search, Plus, User, Calendar, MessageSquare, Brain, X, Save, Edit2, Phone, MapPin, Zap, ThumbsUp, Activity, AlertCircle, Lock, Cake, Upload, Users, Clock, Eye, EyeOff, Briefcase, GraduationCap, Coffee, Compass, Crown, ChevronDown, ChevronUp, Bot } from 'lucide-react';
import { api } from '../services/api';

// --- Constants ---
const CATEGORIES = [
  { id: 'noble', label: '贵人/恩师', icon: <Crown className="w-4 h-4" /> },
  { id: 'mentor', label: '导师/前辈', icon: <Compass className="w-4 h-4" /> },
  { id: 'partner', label: '合作伙伴', icon: <Briefcase className="w-4 h-4" /> },
  { id: 'peer', label: '同学/同侪', icon: <GraduationCap className="w-4 h-4" /> },
  { id: 'expert', label: '行业专家', icon: <Activity className="w-4 h-4" /> },
  { id: 'friend', label: '普通朋友', icon: <Coffee className="w-4 h-4" /> }
];

// --- Components ---

const RelationshipTrendChart = ({ logs, currentScore }: { logs: any[], currentScore: number }) => {
    // Calculate trend: start from current score and go backwards
    // limit to last 10 points
    const sortedLogs = [...logs].sort((a, b) => new Date(b.event_date).getTime() - new Date(a.event_date).getTime()).slice(0, 10);
    
    let score = currentScore;
    const points = [{ date: 'Now', score }];
    
    sortedLogs.forEach(log => {
        score -= (log.relationship_change || 0);
        points.unshift({ date: log.event_date, score });
    });
    
    // Normalize points for SVG (width 100, height 40)
    // Score range 0-100
    const width = 120;
    const height = 40;
    
    const polylinePoints = points.map((p, i) => {
        const x = (i / (points.length - 1 || 1)) * width;
        const y = height - (p.score / 100) * height;
        return `${x},${y}`;
    }).join(' ');

    return (
        <div className="flex flex-col items-end">
            <svg width={width} height={height} className="overflow-visible">
                <polyline 
                    points={polylinePoints} 
                    fill="none" 
                    stroke="#8b5cf6" 
                    strokeWidth="2" 
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
                {points.map((p, i) => (
                     <circle 
                        key={i} 
                        cx={(i / (points.length - 1 || 1)) * width} 
                        cy={height - (p.score / 100) * height} 
                        r="2" 
                        fill="#8b5cf6" 
                    />
                ))}
            </svg>
            <span className="text-[10px] text-gray-400 mt-1">近期趋势</span>
        </div>
    );
};

export default function PersonalityManager() {
  const [people, setPeople] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPerson, setSelectedPerson] = useState<any>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [loading, setLoading] = useState(false);
  
  const [logs, setLogs] = useState<any[]>([]);
  const [isAddingLog, setIsAddingLog] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<any>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<any>(null);

  // New States
  const [showPrivate, setShowPrivate] = useState(true); 
  const [generatedScript, setGeneratedScript] = useState<string[] | null>(null);
  const [scriptLoading, setScriptLoading] = useState(false);
  const [showRelatedModal, setShowRelatedModal] = useState(false);
  const [activeCategory, setActiveCategory] = useState('全部'); // Updated: Category filter
  const [consultModalOpen, setConsultModalOpen] = useState(false);
  const [summaryData, setSummaryData] = useState<any>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  const fetchSummary = async (personId: string) => {
      setSummaryLoading(true);
      try {
          const data = await api.getPersonSummary(personId);
          setSummaryData(data);
      } catch (err) {
          console.error("Failed to fetch summary", err);
      } finally {
          setSummaryLoading(false);
      }
  };

  const fetchPeople = async () => {
    try {
      setLoading(true);
      const data = await api.getAllPeople();
      const peopleList = Array.isArray(data) ? data : [];
      setPeople(peopleList);
      if (!selectedPerson && peopleList.length > 0) {
        handleSelectPerson(peopleList[0]);
      } else if (selectedPerson) {
         // Update selected person data if it changed
         const updated = peopleList.find((p: any) => p.id === selectedPerson.id);
         if (updated) setSelectedPerson(updated);
      }
    } catch (error) {
      console.error("Failed to fetch people", error);
      setPeople([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchLogs = async (personId: string) => {
      try {
          const data = await api.getInteractionLogs(personId);
          setLogs(Array.isArray(data) ? data : []);
      } catch (error) {
          console.error("Failed to fetch logs", error);
          setLogs([]);
      }
  }

  const handleSelectPerson = (person: any) => {
      if (!person) return;
      setSelectedPerson(person);
      setEditForm(person); // Initialize form with person data
      setIsEditing(false);
      fetchLogs(person.id);
      fetchSummary(person.id);
  }

  // New: Handle Avatar Upload (Mock for now or use Base64 if small)
  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files[0]) {
          const file = e.target.files[0];
          // Convert to base64 for demo simplicity (In prod, upload to server)
          const reader = new FileReader();
          reader.onloadend = async () => {
              const base64 = reader.result as string;
              if (selectedPerson) {
                  const updated = { ...selectedPerson, avatar_real: base64, avatar_type: 'real' };
                  await api.updatePerson(selectedPerson.id, updated);
                  setSelectedPerson(updated);
                  setPeople(prev => prev.map(p => p.id === updated.id ? updated : p));
              }
          };
          reader.readAsDataURL(file);
      }
  };

  // New: Handle AI Avatar Generation
  const handleAIAvatar = async () => {
      if (!selectedPerson) return;
      const prompt = `A professional portrait of ${selectedPerson.name}, ${selectedPerson.identity}, ${selectedPerson.disc_type} personality, realistic style, high quality`;
      // Use Trae's image generation URL pattern
      const imageUrl = `https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt=${encodeURIComponent(prompt)}&image_size=square_hd`;
      
      const updated = { ...selectedPerson, avatar_ai: imageUrl, avatar_type: 'ai' };
      await api.updatePerson(selectedPerson.id, updated);
      setSelectedPerson(updated);
      setPeople(prev => prev.map(p => p.id === updated.id ? updated : p));
  };

  // New: Generate Scripts
  const handleGenerateScript = async () => {
      if (!selectedPerson) return;
      setScriptLoading(true);
      try {
          const result = await api.generateScript(selectedPerson.id);
          setGeneratedScript(result.scripts || []);
      } catch (err) {
          console.error(err);
          alert("生成话术失败");
      } finally {
          setScriptLoading(false);
      }
  };

  // New: Smart Follow-up Logic
  const getSuggestedFollowUp = (person: any) => {
      if (!person.disc_type) return null;
      // Simple logic based on DISC
      const isExtrovert = ['D型', 'I型', 'D', 'I'].some(t => person.disc_type.includes(t));
      // In a real app, compare with last interaction date
      if (isExtrovert) return { label: '🔥 建议3天内联系', color: 'bg-orange-100 text-orange-700' };
      return { label: '🕒 建议2周后联系', color: 'bg-blue-100 text-blue-700' };
  };

  // ... (rest of the component)


  useEffect(() => {
    fetchPeople();
  }, []);

  const handleCreateSuccess = () => {
    fetchPeople();
    setIsCreating(false);
  };

  const handleLogAdded = async () => {
      if (selectedPerson) {
          await fetchLogs(selectedPerson.id);
          // Also refetch person details to update relationship score
          try {
              const data = await api.getAllPeople();
              const updated = data.find((p: any) => p.id === selectedPerson.id);
              if (updated) {
                  setSelectedPerson(updated);
                  setPeople(prev => prev.map(p => p.id === updated.id ? updated : p));
              }
          } catch (err) {
              console.error("Failed to refresh people list", err);
          }
      }
      setIsAddingLog(false);
  }

  const handleUpdateProfile = async () => {
      try {
          if (!editForm) return;
          // Parse tags if string
          const tags = typeof editForm.tags === 'string' 
            ? editForm.tags.split(/[,，\s]+/).filter(Boolean) 
            : (Array.isArray(editForm.tags) ? editForm.tags : []);
          
          const updatedData = { ...editForm, tags };
          await api.updatePerson(selectedPerson.id, updatedData);
          
          setSelectedPerson(updatedData);
          setPeople(prev => prev.map(p => p.id === updatedData.id ? updatedData : p));
          setIsEditing(false);
      } catch (error) {
          console.error("Update failed", error);
          alert("更新失败");
      }
  }

  const handleAIAnalyze = async () => {
      if (!selectedPerson) return;
      setAnalyzing(true);
      try {
          // Pass current editing data if available, otherwise selected person
          const currentData = isEditing && editForm ? editForm : selectedPerson;
          
          const result = await api.analyzePerson(selectedPerson.id, currentData);
          // Store result for review instead of applying directly
          setAnalysisResult(result);
          // Don't set editing or form data yet
      } catch (error) {
          console.error("Analysis failed", error);
          alert("AI 分析失败");
      } finally {
          setAnalyzing(false);
      }
  }

  const handleApplyAnalysis = (finalData: any) => {
      // Use finalData (which might be edited) instead of analysisResult
      const dataToApply = finalData || analysisResult;
      if (!dataToApply) return;
      
      setEditForm((prev: any) => ({
          ...(prev || selectedPerson || {}),
          disc_type: dataToApply.disc || '',
          mbti_type: dataToApply.mbti || '',
          ai_analysis: dataToApply.analysis || '',
          interaction_tips: dataToApply.tips || '',
          triggers: dataToApply.triggers || [],
          pleasers: dataToApply.pleasers || []
      }));
      setAnalysisResult(null);
      setIsEditing(true);
  }

  const toggleMood = async (person: any) => {
      const moods = ['平稳', '开心', '忙碌', '压力', '期待'];
      const currentIdx = moods.indexOf(person.current_mood || '平稳');
      const nextMood = moods[(currentIdx + 1) % moods.length];
      
      try {
          const updated = { ...person, current_mood: nextMood };
          await api.updatePerson(person.id, updated);
          setSelectedPerson(updated);
          setPeople(prev => prev.map(p => p.id === updated.id ? updated : p));
      } catch (error) {
          console.error("Failed to update mood", error);
      }
  }

  // New: Generate Interaction Review
  const handleGenerateReview = async (logId: number) => {
      try {
          const result = await api.generateReview(logId, selectedPerson.id);
          // Refresh logs to show review
          if (result.review) {
              setLogs(prev => prev.map(l => l.id === logId ? { ...l, ai_review: result.review } : l));
          }
      } catch (err) {
          console.error(err);
          alert("复盘生成失败");
      }
  };

  const filteredPeople = (people || []).filter(p => {
    const matchesSearch = (p.name || '').toLowerCase().includes(searchTerm.toLowerCase()) || 
      (Array.isArray(p.tags) && p.tags.some((t: string) => (t || '').toLowerCase().includes(searchTerm.toLowerCase())));
    
    if (activeCategory === '全部') return matchesSearch;
    
    // Find category config
    const catConfig = CATEGORIES.find(c => c.label.includes(activeCategory));
    if (!catConfig) return matchesSearch;
    
    return matchesSearch && p.category === catConfig.id;
  });

  return (
    <div className="flex h-full bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden relative">
      {/* Sidebar List */}
      <div className="w-80 border-r border-gray-100 bg-gray-50/50 flex flex-col flex-shrink-0">
        <div className="p-4 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center">
            <User className="w-5 h-5 mr-2 text-primary" />
            性格分析档案
          </h2>
          <div className="relative mb-3">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="搜索人物..."
              className="w-full pl-9 pr-4 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
            <button 
                onClick={() => setActiveCategory('全部')} 
                className={`px-3 py-1.5 rounded-lg text-xs whitespace-nowrap transition-colors border ${activeCategory === '全部' ? 'bg-primary text-white border-primary' : 'bg-white text-gray-600 border-gray-200 hover:border-primary/50'}`}
            >
                全部
            </button>
            {CATEGORIES.map(cat => (
              <button 
                key={cat.id} 
                onClick={() => setActiveCategory(cat.label)} 
                className={`px-3 py-1.5 rounded-lg text-xs whitespace-nowrap transition-colors flex items-center border ${activeCategory === cat.label ? 'bg-primary text-white border-primary' : 'bg-white text-gray-600 border-gray-200 hover:border-primary/50'}`}
              >
                <span className="mr-1">{cat.icon}</span>
                {cat.label.split('/')[0]}
              </button>
            ))}
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto p-2 space-y-2">
          {loading ? (
             <div className="text-center py-4 text-gray-400 text-sm">加载中...</div>
          ) : filteredPeople.map(person => (
            <div 
              key={person.id}
              onClick={() => handleSelectPerson(person)}
              className={`p-3 rounded-lg cursor-pointer transition-colors ${selectedPerson?.id === person.id ? 'bg-white shadow-sm border border-primary/20' : 'hover:bg-white hover:shadow-sm border border-transparent'}`}
            >
              <div className="flex justify-between items-start mb-1">
                <span className="font-bold text-gray-900">{person.name || '未命名'}</span>
                {person.category && (
                    <span className="text-[10px] bg-primary/5 text-primary px-1.5 py-0.5 rounded flex items-center">
                        {CATEGORIES.find(c => c.id === person.category)?.icon}
                        <span className="ml-1">{CATEGORIES.find(c => c.id === person.category)?.label.split('/')[0]}</span>
                    </span>
                )}
              </div>
              <div className="text-xs text-gray-500 mb-2 truncate">{person.identity}</div>
              <div className="flex flex-wrap gap-1 mb-2">
                {person.tags && person.tags.map((t: string, i: number) => (
                  <span key={i} className="px-1.5 py-0.5 bg-gray-100 rounded text-[10px] text-gray-600">#{t}</span>
                ))}
              </div>
              <div className="flex items-center text-xs text-gray-500 gap-3">
                <span className="flex items-center"><Brain className="w-3 h-3 mr-1" /> {person.disc_type || '未知'}</span>
                <span className="flex items-center">关系: {person.relationship_strength}%</span>
              </div>
              
              {/* Last Interaction Summary */}
              {person.last_interaction && (
                  <div className="text-[10px] text-gray-500 truncate mb-2 flex items-center bg-gray-50 px-1.5 py-0.5 rounded">
                      <MessageSquare className="w-3 h-3 mr-1 text-gray-400" />
                      上次: {person.last_interaction}
                  </div>
              )}

              {/* New: Suggested Follow Up Tag */}
              {(() => {
                  const suggestion = getSuggestedFollowUp(person);
                  if (suggestion) return (
                      <div className={`mt-2 inline-block px-2 py-0.5 rounded text-[10px] ${suggestion.color}`}>
                          {suggestion.label}
                      </div>
                  );
              })()}
            </div>
          ))}
          
          <button onClick={() => setIsCreating(true)} className="w-full py-3 border-2 border-dashed border-gray-200 rounded-lg text-gray-400 text-sm hover:border-primary hover:text-primary hover:bg-primary/5 transition-all flex items-center justify-center">
            <Plus className="w-4 h-4 mr-1" /> 新建人物档案
          </button>
        </div>
      </div>

      {/* Main Detail Area */}
      <div className="flex-1 overflow-y-auto bg-white">
        {selectedPerson ? (
          <div className="p-8 max-w-4xl mx-auto">
            {/* Header */}
            <div className="flex justify-between items-start mb-8 border-b border-gray-100 pb-6">
              <div className="flex items-start gap-4 flex-1">
                {/* Avatar with Dual Track */}
                <div className="relative group w-24 h-24 shrink-0 cursor-pointer">
                    <div className="w-full h-full bg-primary/10 rounded-full flex items-center justify-center text-3xl font-bold text-primary overflow-hidden border-2 border-transparent group-hover:border-primary/50 transition-all">
                        {selectedPerson.avatar_real ? (
                            <img src={selectedPerson.avatar_real} alt="Real" className="w-full h-full object-cover" />
                        ) : selectedPerson.avatar_ai ? (
                            <img src={selectedPerson.avatar_ai} alt="AI" className="w-full h-full object-cover" />
                        ) : (
                            (selectedPerson.name || '?')[0]
                        )}
                    </div>
                    {/* Hover Actions */}
                    <div className="absolute inset-0 bg-black/60 rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2 backdrop-blur-sm z-10">
                        <label className="cursor-pointer bg-white/20 p-2 rounded-full hover:bg-white/40 transition-colors" title="上传真实照片" onClick={e => e.stopPropagation()}>
                            <Upload className="w-4 h-4 text-white" />
                            <input type="file" className="hidden" accept="image/*" onChange={handleAvatarUpload} />
                        </label>
                        <button onClick={(e) => { e.stopPropagation(); handleAIAvatar(); }} className="bg-white/20 p-2 rounded-full hover:bg-white/40 transition-colors" title="AI 生成形象">
                            <Zap className="w-4 h-4 text-yellow-300" />
                        </button>
                    </div>
                </div>

                <div className="flex-1 ml-2">
                  {isEditing && editForm ? (
                      <div className="space-y-2">
                          <input 
                            value={editForm.name || ''} 
                            onChange={e => setEditForm({...editForm, name: e.target.value})}
                            className="text-2xl font-bold text-gray-900 w-full border-b border-gray-300 focus:outline-none focus:border-primary"
                            placeholder="姓名"
                          />
                          <div className="flex gap-2">
                              <input 
                                value={editForm.identity || ''} 
                                onChange={e => setEditForm({...editForm, identity: e.target.value})}
                                className="text-gray-500 w-1/2 border-b border-gray-300 focus:outline-none focus:border-primary"
                                placeholder="身份"
                              />
                              <input 
                                value={editForm.field || ''} 
                                onChange={e => setEditForm({...editForm, field: e.target.value})}
                                className="text-gray-500 w-1/2 border-b border-gray-300 focus:outline-none focus:border-primary"
                                placeholder="领域"
                              />
                            <div className="flex items-center">
                        <Cake className="w-4 h-4 mr-2 text-gray-400"/> 
                        <span className="text-gray-500 w-20 shrink-0">生日:</span> 
                        {isEditing && editForm ? (
                            <input 
                                type="date"
                                value={editForm.birthday || ''} 
                                onChange={e => setEditForm({...editForm, birthday: e.target.value})}
                                className="flex-1 bg-white border border-gray-200 rounded px-2 py-1"
                            />
                        ) : (
                            <span className="text-gray-900">{selectedPerson.birthday || '未记录'}</span>
                        )}
                    </div>
                  </div>
                          <input 
                            value={Array.isArray(editForm.tags) ? editForm.tags.join(' ') : (editForm.tags || '')} 
                            onChange={e => setEditForm({...editForm, tags: e.target.value})}
                            className="text-xs text-gray-600 w-full border-b border-gray-300 focus:outline-none focus:border-primary"
                            placeholder="标签 (空格分隔)"
                          />
                      </div>
                  ) : (
                      <>
                        <div className="flex items-center gap-3 mb-1">
                            <h1 className="text-2xl font-bold text-gray-900">{selectedPerson.name || '未命名'}</h1>
                            {/* Mood Selector - Moved here */}
                            <div className="relative group flex items-center gap-2">
                                <div onClick={() => toggleMood(selectedPerson)} className="flex items-center space-x-1 px-2 py-1 bg-gray-50 rounded-full text-xs text-gray-600 cursor-pointer border border-transparent hover:border-gray-200 select-none transition-colors hover:bg-gray-100">
                                    <span>{selectedPerson.current_mood || '平稳'}</span>
                                </div>
                                <button onClick={() => { setIsEditing(true); setEditForm(selectedPerson); }} className="p-1 text-gray-400 hover:text-primary transition-colors" title="编辑档案">
                                    <Edit2 className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                <p className="text-gray-500 mb-2">
                    {selectedPerson.identity || '未知身份'} | {selectedPerson.field || '未知领域'}
                    {selectedPerson.birthday && <span className="ml-2 text-xs bg-pink-100 text-pink-600 px-2 py-0.5 rounded-full flex inline-flex items-center"><Cake className="w-3 h-3 mr-1"/> {selectedPerson.birthday}</span>}
                </p>
                        <div className="flex gap-2 flex-wrap">
                            {selectedPerson.tags && selectedPerson.tags.map((t: string, i: number) => (
                            <span key={i} className="px-2 py-1 bg-gray-100 rounded-full text-xs text-gray-600">#{t}</span>
                            ))}
                        </div>
                      </>
                  )}
                </div>
              </div>
              <div className="text-right shrink-0 ml-4 flex flex-col items-end">
                  {isEditing && editForm && (
                      <div className="flex space-x-2 mb-4">
                          <button onClick={() => setIsEditing(false)} className="px-3 py-1 text-sm text-gray-500 hover:text-gray-700">取消</button>
                          <button onClick={handleUpdateProfile} className="px-3 py-1 text-sm bg-primary text-white rounded-md hover:bg-primary/90">保存</button>
                      </div>
                  )}
                
                <div className="text-sm text-gray-500 mb-1">关系强度</div>
                  {isEditing && editForm ? (
                      <div className="flex items-center gap-2">
                          <input 
                              type="number" 
                              min="0" max="100"
                              value={editForm.relationship_strength || 0}
                              onChange={e => setEditForm({...editForm, relationship_strength: parseInt(e.target.value)})}
                              className="w-16 border rounded px-1 text-right font-bold text-primary"
                          />
                          <span className="text-primary font-bold">%</span>
                      </div>
                  ) : (
                      <div className="text-xl font-bold text-primary">{selectedPerson.relationship_strength}%</div>
                  )}
                  
                  <div className="w-32 h-2 bg-gray-100 rounded-full mt-1 overflow-hidden mb-2">
                    <div className="h-full bg-primary" style={{ width: `${isEditing && editForm ? editForm.relationship_strength : selectedPerson.relationship_strength}%` }}></div>
                  </div>
                  
                  {/* Trend Chart */}
                  {!isEditing && logs.length > 1 && (
                      <RelationshipTrendChart logs={logs} currentScore={selectedPerson.relationship_strength} />
                  )}
              </div>
            </div>

            {/* AI Summary & Insights Box */}
            <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-100 rounded-2xl p-6 mb-8 relative overflow-hidden shadow-sm">
                <div className="relative z-10">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="font-bold text-blue-900 flex items-center text-lg">
                            <Bot className="w-5 h-5 mr-2 text-blue-600" /> 
                            AI 军师 · 每日内参
                        </h3>
                        {summaryLoading ? (
                            <span className="text-xs text-blue-400 animate-pulse bg-white/50 px-2 py-1 rounded">更新中...</span>
                        ) : (
                            <span className="text-xs text-blue-400 bg-white/50 px-2 py-1 rounded">今日已更新</span>
                        )}
                    </div>
                    
                    {summaryData ? (
                        <div className="space-y-4">
                            <div className="bg-white/60 rounded-xl p-4 border border-blue-100/50 backdrop-blur-sm">
                                <div className="text-sm text-blue-900 font-medium leading-relaxed">
                                    {summaryData.summary || "暂无摘要"}
                                </div>
                            </div>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="bg-blue-100/50 rounded-xl p-4 border border-blue-200/50">
                                    <div className="text-xs font-bold text-blue-600 mb-2 uppercase tracking-wide flex items-center">
                                        <Zap className="w-3 h-3 mr-1" /> 行动建议
                                    </div>
                                    <div className="text-sm text-blue-800 leading-relaxed">
                                        {summaryData.advice || "保持现状即可。"}
                                    </div>
                                </div>
                                
                                <div className="bg-yellow-50/80 rounded-xl p-4 border border-yellow-100">
                                    <div className="text-xs font-bold text-yellow-600 mb-2 uppercase tracking-wide flex items-center">
                                        <Clock className="w-3 h-3 mr-1" /> 重要提醒
                                    </div>
                                    <div className="space-y-2">
                                        {summaryData.reminders && summaryData.reminders.length > 0 ? (
                                            summaryData.reminders.map((r: string, i: number) => (
                                                <div key={i} className="flex items-start text-sm text-yellow-800">
                                                    <span className="mr-2">•</span>
                                                    <span>{r}</span>
                                                </div>
                                            ))
                                        ) : (
                                            <div className="text-sm text-yellow-800/60 italic">暂无特别提醒</div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="text-center py-8 text-blue-400/60">
                            <div className="animate-spin w-6 h-6 border-2 border-blue-400 border-t-transparent rounded-full mx-auto mb-2"></div>
                            正在生成今日摘要...
                        </div>
                    )}
                </div>
                
                {/* Decoration */}
                <div className="absolute -top-6 -right-6 opacity-5 pointer-events-none">
                    <Brain className="w-48 h-48 text-blue-900" />
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
              {/* Personality Analysis */}
              <div className="bg-purple-50 p-6 rounded-xl border border-purple-100 relative group">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="font-bold text-purple-900 flex items-center">
                        <Brain className="w-5 h-5 mr-2" /> 性格分析 (AI 辅助)
                    </h3>
                    <button 
                        onClick={handleAIAnalyze}
                        disabled={analyzing}
                        className="text-xs bg-white/50 hover:bg-white text-purple-700 px-2 py-1 rounded border border-purple-200 transition-colors flex items-center"
                    >
                        {analyzing ? '分析中...' : '✨ 智能生成建议'}
                    </button>
                </div>
                
                <div className="space-y-4">
                  <div>
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      {isEditing && editForm ? (
                          <>
                            <select 
                                value={editForm.disc_type || ''} 
                                onChange={e => setEditForm({...editForm, disc_type: e.target.value})}
                                className="text-sm font-bold text-purple-800 bg-white px-2 py-0.5 rounded border-none focus:ring-1 focus:ring-purple-300"
                            >
                                <option value="">DISC未知</option>
                                <option value="D型">D型</option>
                                <option value="I型">I型</option>
                                <option value="S型">S型</option>
                                <option value="C型">C型</option>
                            </select>
                            <input 
                                value={editForm.mbti_type || ''} 
                                onChange={e => setEditForm({...editForm, mbti_type: e.target.value})}
                                className="text-sm font-bold text-purple-800 bg-white px-2 py-0.5 rounded border-none focus:ring-1 focus:ring-purple-300 w-24"
                                placeholder="MBTI"
                            />
                          </>
                      ) : (
                          <>
                            <span className="text-sm font-bold text-purple-800 bg-white/50 px-2 py-0.5 rounded">DISC: {selectedPerson.disc_type || '未分析'}</span>
                            <span className="text-sm font-bold text-purple-800 bg-white/50 px-2 py-0.5 rounded">MBTI: {selectedPerson.mbti_type || '未分析'}</span>
                          </>
                      )}
                    </div>
                    
                    {isEditing && editForm ? (
                        <textarea 
                            value={editForm.ai_analysis || ''} 
                            onChange={e => setEditForm({...editForm, ai_analysis: e.target.value})}
                            className="w-full h-24 text-sm text-purple-800 bg-white/50 border border-purple-100 rounded p-2 focus:outline-none focus:border-purple-300 resize-none"
                            placeholder="性格分析..."
                        />
                    ) : (
                        <p className="text-sm text-purple-800 leading-relaxed whitespace-pre-wrap">{selectedPerson.ai_analysis || "暂无分析，请添加互动记录后生成。"}</p>
                    )}
                  </div>
                  <div className="pt-4 border-t border-purple-200">
                  <div className="flex justify-between items-center mb-2">
                    <h4 className="text-sm font-bold text-purple-900">💡 相处建议</h4>
                    {!isEditing && (
                        <button 
                            onClick={handleGenerateScript} 
                            disabled={scriptLoading}
                            className="text-xs text-primary border border-primary/20 bg-white px-2 py-0.5 rounded-full hover:bg-primary/5 flex items-center"
                        >
                            <MessageSquare className="w-3 h-3 mr-1" />
                            {scriptLoading ? '生成中...' : '生成开场白'}
                        </button>
                    )}
                  </div>
                  {/* Generated Scripts Display */}
                  {generatedScript && !isEditing && (
                      <div className="mb-4 bg-white rounded-lg border border-purple-100 p-3 shadow-sm">
                          <div className="flex justify-between items-center mb-2">
                              <span className="text-xs font-bold text-purple-700">💬 推荐开场白</span>
                              <button onClick={() => setGeneratedScript(null)} className="text-gray-400 hover:text-gray-600"><X className="w-3 h-3"/></button>
                          </div>
                          <div className="space-y-2">
                              {generatedScript.map((script, i) => (
                                  <div key={i} className="text-sm text-gray-600 bg-gray-50 p-2 rounded border border-gray-100 hover:bg-white hover:border-purple-200 transition-colors cursor-pointer" onClick={() => navigator.clipboard.writeText(script)}>
                                      <span className="font-bold mr-1 text-primary">{(['A','B','C'])[i]}.</span> {script}
                                  </div>
                              ))}
                          </div>
                      </div>
                  )}

                  {isEditing && editForm ? (
                        <textarea 
                            value={editForm.interaction_tips || ''} 
                            onChange={e => setEditForm({...editForm, interaction_tips: e.target.value})}
                            className="w-full h-24 text-sm text-purple-800 bg-white/50 border border-purple-100 rounded p-2 focus:outline-none focus:border-purple-300 resize-none"
                            placeholder="相处建议..."
                        />
                    ) : (
                        <p className="text-sm text-purple-800 leading-relaxed whitespace-pre-wrap">{selectedPerson.interaction_tips || "暂无建议"}</p>
                    )}
                  </div>

                  {/* Triggers & Pleasers */}
                  <div className="pt-4 border-t border-purple-200 grid grid-cols-2 gap-4">
                      <div>
                          <h4 className="text-sm font-bold text-red-700 mb-2 flex items-center"><AlertCircle className="w-3 h-3 mr-1"/> 雷区 (Triggers)</h4>
                          {isEditing && editForm ? (
                              <textarea 
                                  value={Array.isArray(editForm.triggers) ? editForm.triggers.join('\n') : (editForm.triggers || '')} 
                                  onChange={e => setEditForm({...editForm, triggers: e.target.value.split('\n')})}
                                  className="w-full h-20 text-xs bg-white/50 border border-red-100 rounded p-2 focus:outline-none focus:border-red-300 resize-none"
                                  placeholder="每行一个..."
                              />
                          ) : (
                              <ul className="list-disc list-inside text-xs text-purple-800 space-y-1">
                                  {(selectedPerson.triggers || []).length > 0 ? (
                                      selectedPerson.triggers.map((t: string, i: number) => <li key={i}>{t}</li>)
                                  ) : <span className="text-gray-400 italic">暂无记录</span>}
                              </ul>
                          )}
                      </div>
                      <div>
                          <h4 className="text-sm font-bold text-green-700 mb-2 flex items-center"><ThumbsUp className="w-3 h-3 mr-1"/> 爽点 (Pleasers)</h4>
                          {isEditing && editForm ? (
                              <textarea 
                                  value={Array.isArray(editForm.pleasers) ? editForm.pleasers.join('\n') : (editForm.pleasers || '')} 
                                  onChange={e => setEditForm({...editForm, pleasers: e.target.value.split('\n')})}
                                  className="w-full h-20 text-xs bg-white/50 border border-green-100 rounded p-2 focus:outline-none focus:border-green-300 resize-none"
                                  placeholder="每行一个..."
                              />
                          ) : (
                              <ul className="list-disc list-inside text-xs text-purple-800 space-y-1">
                                  {(selectedPerson.pleasers || []).length > 0 ? (
                                      selectedPerson.pleasers.map((t: string, i: number) => <li key={i}>{t}</li>)
                                  ) : <span className="text-gray-400 italic">暂无记录</span>}
                              </ul>
                          )}
                      </div>
                  </div>
                </div>
              </div>

              {/* Basic Info & Actions */}
              <div className="space-y-6">
                <div className="bg-gray-50 p-6 rounded-xl border border-gray-100">
                  <h3 className="font-bold text-gray-900 mb-4">基本信息</h3>
                  <div className="space-y-3 text-sm">
                    <div className="flex items-center">
                        <Phone className="w-4 h-4 mr-2 text-gray-400"/> 
                        <span className="text-gray-500 w-20 shrink-0">联系方式:</span> 
                        {isEditing && editForm ? (
                            <input 
                                value={editForm.contact_info || ''} 
                                onChange={e => setEditForm({...editForm, contact_info: e.target.value})}
                                className="flex-1 bg-white border border-gray-200 rounded px-2 py-1"
                            />
                        ) : (
                            <span className="text-gray-900 break-all">{selectedPerson.contact_info || '未记录'}</span>
                        )}
                    </div>
                    <div className="flex items-center">
                        <Calendar className="w-4 h-4 mr-2 text-gray-400"/> 
                        <span className="text-gray-500 w-20 shrink-0">认识时间:</span> 
                        {isEditing && editForm ? (
                            <input 
                                type="date"
                                value={editForm.first_met_date || ''} 
                                onChange={e => setEditForm({...editForm, first_met_date: e.target.value})}
                                className="flex-1 bg-white border border-gray-200 rounded px-2 py-1"
                            />
                        ) : (
                            <span className="text-gray-900">{selectedPerson.first_met_date || '未记录'}</span>
                        )}
                    </div>
                    <div className="flex items-center">
                        <MapPin className="w-4 h-4 mr-2 text-gray-400"/> 
                        <span className="text-gray-500 w-20 shrink-0">认识场景:</span> 
                        {isEditing && editForm ? (
                            <input 
                                value={editForm.first_met_scene || ''} 
                                onChange={e => setEditForm({...editForm, first_met_scene: e.target.value})}
                                className="flex-1 bg-white border border-gray-200 rounded px-2 py-1"
                            />
                        ) : (
                            <span className="text-gray-900">{selectedPerson.first_met_scene || '未记录'}</span>
                        )}
                    </div>
                  </div>
                </div>
                
                {/* Private Info (Moved here) */}

                {/* Related People Section */}
                <div className="bg-gray-50 p-6 rounded-xl border border-gray-100 mt-6">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="font-bold text-gray-900 flex items-center">
                            <Users className="w-4 h-4 mr-2" /> 关联人物
                        </h3>
                        {isEditing && <button onClick={() => setShowRelatedModal(true)} className="text-xs text-primary hover:underline">+ 关联</button>}
                    </div>
                    {selectedPerson.related_people && selectedPerson.related_people.length > 0 ? (
                        <div className="space-y-3">
                            {selectedPerson.related_people.map((rel: any, i: number) => (
                                <div key={i} className="flex items-center bg-white p-2 rounded border border-gray-200">
                                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-bold mr-3 shrink-0">
                                        {rel.avatar ? <img src={rel.avatar} className="w-full h-full rounded-full object-cover"/> : rel.name[0]}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="text-sm font-bold text-gray-900 truncate">{rel.name}</div>
                                        <div className="text-xs text-gray-500 truncate">{rel.relation}</div>
                                    </div>
                                    {isEditing && (
                                        <button 
                                            onClick={() => {
                                                const newRelated = selectedPerson.related_people.filter((_: any, idx: number) => idx !== i);
                                                setEditForm({...editForm, related_people: newRelated});
                                            }}
                                            className="text-gray-400 hover:text-red-500"
                                        >
                                            <X className="w-3 h-3" />
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="text-sm text-gray-400 italic">暂无关联人物</div>
                    )}
                </div>

                <button className="w-full py-3 bg-white border border-primary text-primary rounded-xl font-medium hover:bg-primary/5 transition-colors flex items-center justify-center mt-6">
                  <MessageSquare className="w-4 h-4 mr-2" />
                  用此人档案进行模拟训练
                </button>
                
                {/* New: AI Consultation Button */}
                <button 
                    onClick={() => setConsultModalOpen(true)}
                    className="w-full py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-xl font-bold shadow-md hover:shadow-lg transform hover:-translate-y-0.5 transition-all flex items-center justify-center mt-3"
                >
                    <Bot className="w-5 h-5 mr-2" />
                    遇到难题？AI 军师快速决策
                </button>
              </div>
            </div>

            {/* Interaction Timeline */}
            <div className="flex flex-col gap-6">
                
              {/* Private Info */}
                {showPrivate ? (
                <div className="bg-blue-50 p-6 rounded-xl border border-blue-100">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="font-bold text-blue-900 flex items-center">
                            <Lock className="w-4 h-4 mr-2" /> 私人信息
                        </h3>
                        <button onClick={() => setShowPrivate(false)} className="text-blue-500 hover:text-blue-700">
                            <EyeOff className="w-4 h-4" />
                        </button>
                    </div>
                    <div className="space-y-2">
                        {isEditing && editForm ? (
                            <textarea 
                                value={editForm.private_info || ''} 
                                onChange={e => setEditForm({...editForm, private_info: e.target.value})}
                                className="w-full h-24 text-sm text-blue-800 bg-white/50 border border-blue-100 rounded p-2 focus:outline-none focus:border-blue-300 resize-none"
                                placeholder="记录生肖、生日、家庭情况、喜好、重要日期等..."
                            />
                        ) : (
                            <p className="text-sm text-blue-800 leading-relaxed whitespace-pre-wrap">
                                {selectedPerson.private_info || <span className="text-blue-400 italic">暂无私人信息记录</span>}
                            </p>
                        )}
                    </div>
                </div>
                ) : (
                    <div className="bg-blue-50/50 p-4 rounded-xl border border-blue-100/50 flex items-center justify-between cursor-pointer hover:bg-blue-50" onClick={() => setShowPrivate(true)}>
                        <div className="flex items-center text-blue-900/50 font-medium">
                            <Lock className="w-4 h-4 mr-2" /> 私人信息 (已隐藏)
                        </div>
                        <Eye className="w-4 h-4 text-blue-400" />
                    </div>
                )}

              <div>
                <div className="flex justify-between items-center mb-6">
                  <h3 className="text-lg font-bold text-gray-900 flex items-center">
                    <MessageSquare className="w-5 h-5 mr-2" /> 互动记录时间线
                  </h3>
                  <button onClick={() => setIsAddingLog(true)} className="text-sm text-primary hover:underline">+ 添加记录</button>
                </div>
              
              <div className="space-y-6 relative before:absolute before:left-2 before:top-2 before:bottom-0 before:w-0.5 before:bg-gray-200 pl-8">
                 {logs.length > 0 ? (
                     logs.map(log => (
                         <div key={log.id} className="relative">
                             <div className="absolute -left-[30px] top-1 w-3 h-3 bg-white border-2 border-primary rounded-full"></div>
                             <div className="text-xs text-gray-400 mb-1">{new Date(log.event_date).toLocaleDateString()} · {log.event_context}</div>
                             <div className="bg-gray-50 rounded-lg p-4 border border-gray-100">
                                 <div className="mb-2">
                                     <span className="text-xs font-bold text-gray-500 bg-gray-200 px-1 rounded mr-2">我</span>
                                     <span className="text-sm text-gray-800">{log.my_behavior}</span>
                                 </div>
                                 <div className="mb-2">
                                     <span className="text-xs font-bold text-gray-500 bg-gray-200 px-1 rounded mr-2">TA</span>
                                     <span className="text-sm text-gray-800">{log.their_reaction}</span>
                                 </div>
                                 {log.relationship_change !== 0 && (
                                     <div className={`text-xs font-bold ${log.relationship_change > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                         关系变化: {log.relationship_change > 0 ? '+' : ''}{log.relationship_change}%
                                     </div>
                                 )}
                                 
                                 {/* AI Review Section */}
                                 <div className="mt-3 pt-3 border-t border-gray-200">
                                     {log.ai_review ? (
                                         <details className="group">
                                             <summary className="text-xs font-bold text-purple-600 cursor-pointer flex items-center select-none">
                                                 <Bot className="w-3 h-3 mr-1" /> 🤖 AI 复盘
                                                 <ChevronDown className="w-3 h-3 ml-1 group-open:hidden" />
                                                 <ChevronUp className="w-3 h-3 ml-1 hidden group-open:block" />
                                             </summary>
                                             <div className="mt-2 text-xs text-gray-600 bg-purple-50 p-3 rounded border border-purple-100 whitespace-pre-wrap leading-relaxed">
                                                 {log.ai_review}
                                             </div>
                                         </details>
                                     ) : (
                                         <button 
                                             onClick={() => handleGenerateReview(log.id)}
                                             className="text-xs text-gray-400 hover:text-purple-600 flex items-center transition-colors"
                                         >
                                             <Bot className="w-3 h-3 mr-1" /> 生成 AI 复盘
                                         </button>
                                     )}
                                 </div>
                             </div>
                         </div>
                     ))
                 ) : (
                    <div className="text-gray-400 text-sm italic">暂无互动记录</div>
                 )}
              </div>
            </div>

            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-gray-400">
            <User className="w-16 h-16 mb-4 opacity-20" />
            <p>请选择或创建一个人物档案</p>
          </div>
        )}
      </div>

      {/* Creation Modal */}
      {isCreating && (
        <PersonCreationModal 
          onClose={() => setIsCreating(false)} 
          onSuccess={handleCreateSuccess}
        />
      )}

      {/* Add Log Modal */}
      {isAddingLog && selectedPerson && (
          <InteractionLogModal 
              personId={selectedPerson.id}
              onClose={() => setIsAddingLog(false)}
              onSuccess={handleLogAdded}
          />
      )}

      {/* Related People Modal */}
      {showRelatedModal && isEditing && (
          <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 backdrop-blur-sm">
              <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
                  <h3 className="text-lg font-bold text-gray-900 mb-4">添加关联人物</h3>
                <div className="space-y-2 max-h-60 overflow-y-auto">
                    {people
                        .filter(p => 
                            p.id !== selectedPerson.id && 
                            !editForm.related_people?.some((r: any) => r.id === p.id)
                        )
                        .map(p => (
                        <div 
                            key={p.id}
                            onClick={() => {
                                const newRelated = [...(editForm.related_people || []), { id: p.id, name: p.name, role: p.identity, relation: 'unknown' }];
                                setEditForm({ ...editForm, related_people: newRelated });
                                setShowRelatedModal(false);
                            }}
                            className="flex items-center p-3 rounded-lg border border-gray-200 hover:bg-gray-50 cursor-pointer transition-colors"
                        >
                            <div className="w-8 h-8 rounded-full bg-gray-200 mr-3 overflow-hidden">
                                {p.avatar_real ? (
                                    <img src={p.avatar_real} className="w-full h-full object-cover" />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center text-gray-500 font-bold text-xs">{p.name[0]}</div>
                                )}
                            </div>
                            <div>
                                <div className="font-bold text-gray-900 text-sm">{p.name}</div>
                                <div className="text-xs text-gray-500">{p.identity}</div>
                            </div>
                            <Plus className="w-4 h-4 text-gray-400 ml-auto" />
                        </div>
                    ))}
                    {people.filter(p => p.id !== selectedPerson.id && !editForm.related_people?.some((r: any) => r.id === p.id)).length === 0 && (
                        <div className="text-center py-4 text-gray-400 text-sm">暂无更多可选人物</div>
                    )}
                </div>
                  <button onClick={() => setShowRelatedModal(false)} className="mt-4 w-full py-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200">取消</button>
              </div>
          </div>
      )}
      {/* Analysis Review Modal */}
      {analysisResult && (
          <AnalysisReviewModal 
              currentData={isEditing && editForm ? editForm : selectedPerson}
              newData={analysisResult}
              onClose={() => setAnalysisResult(null)}
              onApply={handleApplyAnalysis}
          />
      )}

      {/* New: Consultation Modal */}
      {consultModalOpen && selectedPerson && (
          <AIConsultationModal 
              person={selectedPerson}
              onClose={() => setConsultModalOpen(false)}
          />
      )}
    </div>
  );
}

function AIConsultationModal({ person, onClose }: { person: any, onClose: () => void }) {
    const [query, setQuery] = useState('');
    const [loading, setLoading] = useState(false);
    const [response, setResponse] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!query.trim()) return;
        
        setLoading(true);
        try {
            const result = await api.consultPerson(person.id, query);
            setResponse(result.reply);
        } catch (err) {
            console.error(err);
            setResponse("抱歉，AI 军师暂时无法回应。");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
                <div className="flex justify-between items-center p-6 border-b border-gray-100 bg-gradient-to-r from-purple-50 to-blue-50 rounded-t-xl">
                    <h2 className="text-xl font-bold text-gray-900 flex items-center">
                        <Bot className="w-6 h-6 mr-2 text-purple-600" />
                        AI 军师 · 决策辅助
                    </h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                        <X className="w-6 h-6" />
                    </button>
                </div>

                <div className="p-6 overflow-y-auto flex-1">
                    <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 mb-6 text-sm text-blue-800 flex items-start">
                        <Brain className="w-5 h-5 mr-2 shrink-0" />
                        <div>
                            <p className="font-bold mb-1">正在咨询关于 {person.name} 的问题</p>
                            <p className="opacity-80">AI 将结合 {person.name} 的性格档案（{person.disc_type}/{person.mbti_type}）及过往互动记录为您出谋划策。</p>
                        </div>
                    </div>

                    {!response ? (
                        <form onSubmit={handleSubmit}>
                            <div className="mb-4">
                                <label className="block text-sm font-bold text-gray-700 mb-2">请描述您遇到的情况或问题：</label>
                                <textarea 
                                    value={query}
                                    onChange={e => setQuery(e.target.value)}
                                    className="w-full h-32 border border-gray-300 rounded-xl p-4 focus:ring-2 focus:ring-purple-200 focus:border-purple-400 resize-none text-sm"
                                    placeholder="例如：我准备邀请他参加周末的聚会，但他最近好像心情不好，我该怎么开口？或者，他刚刚拒绝了我的提议，我该如何挽回？"
                                    autoFocus
                                />
                            </div>
                            <button 
                                type="submit" 
                                disabled={loading || !query.trim()}
                                className="w-full py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-xl font-bold shadow-md hover:shadow-lg disabled:opacity-50 flex items-center justify-center transition-all"
                            >
                                {loading ? (
                                    <>
                                        <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full mr-2"></div>
                                        正在分析利弊...
                                    </>
                                ) : (
                                    <>
                                        <Zap className="w-4 h-4 mr-2" /> 开始分析
                                    </>
                                )}
                            </button>
                        </form>
                    ) : (
                        <div className="space-y-6">
                            <div className="bg-purple-50/50 rounded-xl p-6 border border-purple-100">
                                <h3 className="text-sm font-bold text-gray-500 mb-2 uppercase tracking-wide">AI 建议</h3>
                                <div className="text-gray-800 leading-relaxed whitespace-pre-wrap font-medium">
                                    {response}
                                </div>
                            </div>
                            
                            <div className="flex justify-end space-x-3">
                                <button 
                                    onClick={() => { setResponse(''); setQuery(''); }}
                                    className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm transition-colors"
                                >
                                    咨询其他问题
                                </button>
                                <button 
                                    onClick={onClose}
                                    className="px-6 py-2 bg-gray-900 text-white rounded-lg text-sm hover:bg-gray-800 transition-colors"
                                >
                                    完成
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

function AnalysisReviewModal({ currentData, newData, onClose, onApply }: { currentData: any, newData: any, onClose: () => void, onApply: (data: any) => void }) {
    const [editedData, setEditedData] = useState(newData);

    // Helper to render diff
    const DiffField = ({ label, oldVal, newVal, fieldKey, isList = false }: { label: string, oldVal: string, newVal: string | string[], fieldKey: string, isList?: boolean }) => {
        const hasChanged = isList 
            ? JSON.stringify(oldVal) !== JSON.stringify(newVal)
            : oldVal !== newVal;
            
        const handleListChange = (val: string) => {
            setEditedData({ ...editedData, [fieldKey]: val.split('\n') });
        };

        const handleChange = (val: string) => {
            setEditedData({ ...editedData, [fieldKey]: val });
        };

        return (
            <div className="mb-4">
                <div className="flex items-center mb-1">
                    <span className="text-sm font-bold text-gray-700">{label}</span>
                    {hasChanged && <span className="ml-2 text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">已变更</span>}
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div className="bg-gray-50 p-3 rounded-lg border border-gray-100">
                        <div className="text-xs text-gray-400 mb-1">当前内容</div>
                        <div className="text-sm text-gray-600 whitespace-pre-wrap">{isList && Array.isArray(oldVal) ? oldVal.join('\n') : (oldVal || '(空)')}</div>
                    </div>
                    <div className={`p-3 rounded-lg border ${hasChanged ? 'bg-green-50 border-green-100' : 'bg-gray-50 border-gray-100'}`}>
                        <div className="text-xs text-gray-400 mb-1 flex justify-between">
                            <span>AI 建议 (可编辑)</span>
                            <Edit2 className="w-3 h-3 text-gray-400" />
                        </div>
                        <textarea 
                            className={`w-full bg-transparent border-none p-0 text-sm focus:ring-0 resize-none ${hasChanged ? 'text-green-800 font-medium' : 'text-gray-600'}`}
                            value={isList && Array.isArray(newVal) ? newVal.join('\n') : (newVal || '')}
                            onChange={e => isList ? handleListChange(e.target.value) : handleChange(e.target.value)}
                            rows={isList ? 5 : 3}
                        />
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
                <div className="flex justify-between items-center p-6 border-b border-gray-100">
                    <h2 className="text-xl font-bold text-gray-900 flex items-center">
                        <Brain className="w-5 h-5 mr-2 text-primary" />
                        审查 AI 分析结果
                    </h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                        <X className="w-6 h-6" />
                    </button>
                </div>
                
                <div className="flex-1 overflow-y-auto p-6">
                    <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 mb-6 text-sm text-blue-800 flex items-start">
                        <AlertCircle className="w-5 h-5 mr-2 shrink-0" />
                        AI 已根据最新互动记录生成了新的分析建议。您可以直接在右侧编辑 AI 的建议，确认无误后点击“应用更改”。
                    </div>

                    <div className="grid grid-cols-2 gap-4 mb-4">
                         <DiffField label="DISC 类型" oldVal={currentData.disc_type} newVal={editedData.disc} fieldKey="disc" />
                         <DiffField label="MBTI 类型" oldVal={currentData.mbti_type} newVal={editedData.mbti} fieldKey="mbti" />
                    </div>

                    <DiffField label="性格深度分析" oldVal={currentData.ai_analysis} newVal={editedData.analysis} fieldKey="analysis" />
                    <DiffField label="相处建议" oldVal={currentData.interaction_tips} newVal={editedData.tips} fieldKey="tips" />
                    
                    <div className="grid grid-cols-2 gap-4">
                        <DiffField label="雷区 (Triggers)" oldVal={currentData.triggers} newVal={editedData.triggers} fieldKey="triggers" isList={true} />
                        <DiffField label="爽点 (Pleasers)" oldVal={currentData.pleasers} newVal={editedData.pleasers} fieldKey="pleasers" isList={true} />
                    </div>
                </div>

                <div className="p-6 border-t border-gray-100 flex justify-end space-x-3 bg-gray-50 rounded-b-xl">
                    <button onClick={onClose} className="px-4 py-2 text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 rounded-lg text-sm font-medium transition-colors">
                        放弃更改
                    </button>
                    <button onClick={() => onApply(editedData)} className="px-6 py-2 text-white bg-primary hover:bg-primary/90 rounded-lg text-sm font-medium shadow-sm transition-colors flex items-center">
                        <Save className="w-4 h-4 mr-2" />
                        应用更改
                    </button>
                </div>
            </div>
        </div>
    );
}

function PersonCreationModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: (person: any) => void }) {
    const [formData, setFormData] = useState({
        name: '',
        category: '', // Added category
        identity: '',
        field: '',
        tags: '',
        relationship_strength: 50,
        disc_type: '',
        mbti_type: '',
        contact_info: '',
        birthday: '', // Added birthday
        first_met_date: new Date().toISOString().split('T')[0],
        first_met_scene: '',
        ai_analysis: '', // User can manually input initial analysis
        interaction_tips: ''
    });
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            const tagsArray = formData.tags.split(/[,，\s]+/).filter(Boolean);
            const dataToSave = {
                ...formData,
                tags: tagsArray
            };
            const result = await api.createPerson(dataToSave);
            onSuccess(result);
        } catch (error) {
            console.error("Create failed", error);
            alert("创建失败，请重试");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                <div className="flex justify-between items-center p-6 border-b border-gray-100 sticky top-0 bg-white z-10">
                    <h2 className="text-xl font-bold text-gray-900">✨ 新建人物档案</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                        <X className="w-6 h-6" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-6">
                    {/* Basic Info */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">身份分类 *</label>
                            <div className="grid grid-cols-2 gap-2">
                                {CATEGORIES.map(cat => (
                                    <div 
                                        key={cat.id}
                                        onClick={() => setFormData({...formData, category: cat.id})}
                                        className={`flex items-center p-2 rounded-lg cursor-pointer border transition-colors ${formData.category === cat.id ? 'bg-primary/5 border-primary text-primary' : 'bg-white border-gray-200 hover:bg-gray-50'}`}
                                    >
                                        <div className={`w-8 h-8 rounded-full flex items-center justify-center mr-2 ${formData.category === cat.id ? 'bg-primary text-white' : 'bg-gray-100 text-gray-500'}`}>
                                            {cat.icon}
                                        </div>
                                        <div className="text-xs font-medium">{cat.label}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">姓名 *</label>
                            <input 
                                type="text" 
                                required
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary/20 focus:border-primary"
                                value={formData.name}
                                onChange={e => setFormData({...formData, name: e.target.value})}
                                placeholder="如：王教授"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">身份/职位 *</label>
                            <input 
                                type="text" 
                                required
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary/20 focus:border-primary"
                                value={formData.identity}
                                onChange={e => setFormData({...formData, identity: e.target.value})}
                                placeholder="如：某大学学院教授"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">所属领域/行业</label>
                            <input 
                                type="text" 
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary/20 focus:border-primary"
                                value={formData.field}
                                onChange={e => setFormData({...formData, field: e.target.value})}
                                placeholder="如：机械工程 / 互联网"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">标签 (空格或逗号分隔)</label>
                            <input 
                                type="text" 
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary/20 focus:border-primary"
                                value={formData.tags}
                                onChange={e => setFormData({...formData, tags: e.target.value})}
                                placeholder="如：导师 学术圈 高权力"
                            />
                        </div>
                    </div>

                    {/* Relationship & Personality */}
                    <div className="bg-gray-50 p-4 rounded-lg border border-gray-100 space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">关系强度 ({formData.relationship_strength}%)</label>
                            <input 
                                type="range" 
                                min="0" 
                                max="100" 
                                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-primary"
                                value={formData.relationship_strength}
                                onChange={e => setFormData({...formData, relationship_strength: parseInt(e.target.value)})}
                            />
                            <div className="flex justify-between text-xs text-gray-400 mt-1">
                                <span>陌生 (0%)</span>
                                <span>熟悉 (50%)</span>
                                <span>至交 (100%)</span>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">DISC 类型</label>
                                <select 
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary/20 focus:border-primary bg-white"
                                    value={formData.disc_type}
                                    onChange={e => setFormData({...formData, disc_type: e.target.value})}
                                >
                                    <option value="">未知</option>
                                    <option value="D型">D型 (支配型)</option>
                                    <option value="I型">I型 (影响型)</option>
                                    <option value="S型">S型 (稳健型)</option>
                                    <option value="C型">C型 (谨慎型)</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">MBTI 类型</label>
                                <input 
                                    type="text" 
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary/20 focus:border-primary"
                                    value={formData.mbti_type}
                                    onChange={e => setFormData({...formData, mbti_type: e.target.value.toUpperCase()})}
                                    placeholder="如：INTJ"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Contact & Context */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                         <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">联系方式</label>
                            <input 
                                type="text" 
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary/20 focus:border-primary"
                                value={formData.contact_info}
                                onChange={e => setFormData({...formData, contact_info: e.target.value})}
                                placeholder="电话/微信"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">生日</label>
                            <input 
                                type="date" 
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary/20 focus:border-primary"
                                value={formData.birthday}
                                onChange={e => setFormData({...formData, birthday: e.target.value})}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">认知时间</label>
                            <input 
                                type="date" 
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary/20 focus:border-primary"
                                value={formData.first_met_date}
                                onChange={e => setFormData({...formData, first_met_date: e.target.value})}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">认识场景</label>
                            <input 
                                type="text" 
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary/20 focus:border-primary"
                                value={formData.first_met_scene}
                                onChange={e => setFormData({...formData, first_met_scene: e.target.value})}
                                placeholder="如：学术会议"
                            />
                        </div>
                    </div>
                    
                    {/* Notes */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">性格描述/备注</label>
                        <textarea 
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary/20 focus:border-primary h-24 resize-none"
                            value={formData.ai_analysis}
                            onChange={e => setFormData({...formData, ai_analysis: e.target.value})}
                            placeholder="输入对这个人的初步印象或性格分析..."
                        ></textarea>
                    </div>

                    <div className="pt-4 border-t border-gray-100 flex justify-end space-x-3">
                        <button 
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm font-medium transition-colors"
                        >
                            取消
                        </button>
                        <button 
                            type="submit"
                            disabled={loading}
                            className="px-6 py-2 text-white bg-primary hover:bg-primary/90 rounded-lg text-sm font-medium shadow-sm transition-colors disabled:opacity-50 flex items-center"
                        >
                            {loading && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>}
                            创建档案
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

function InteractionLogModal({ personId, onClose, onSuccess }: { personId: string; onClose: () => void; onSuccess: () => void }) {
    const [formData, setFormData] = useState({
        event_date: new Date().toISOString().split('T')[0],
        event_context: '',
        my_behavior: '',
        their_reaction: '',
        relationship_change: 0,
        ai_analysis: '' // Optional
    });
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            await api.createInteractionLog({ ...formData, person_id: personId });
            onSuccess();
            // Reset form
            setFormData({
                event_date: new Date().toISOString().split('T')[0],
                event_context: '',
                my_behavior: '',
                their_reaction: '',
                relationship_change: 0,
                ai_analysis: ''
            });
        } catch (error) {
            console.error("Failed to add log", error);
            alert("添加失败");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">
                <div className="flex justify-between items-center p-6 border-b border-gray-100">
                    <h2 className="text-xl font-bold text-gray-900">📝 添加互动记录</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                        <X className="w-6 h-6" />
                    </button>
                </div>
                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">互动日期</label>
                        <input 
                            type="date" 
                            required
                            className="w-full border border-gray-300 rounded-lg px-3 py-2"
                            value={formData.event_date}
                            onChange={e => setFormData({...formData, event_date: e.target.value})}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">互动场景/背景</label>
                        <input 
                            type="text" 
                            required
                            className="w-full border border-gray-300 rounded-lg px-3 py-2"
                            placeholder="如：咖啡厅闲聊，讨论项目"
                            value={formData.event_context}
                            onChange={e => setFormData({...formData, event_context: e.target.value})}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">我的表现/行为</label>
                        <textarea 
                            required
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 h-20 resize-none"
                            placeholder="我说/做了什么..."
                            value={formData.my_behavior}
                            onChange={e => setFormData({...formData, my_behavior: e.target.value})}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">对方反应/反馈</label>
                        <textarea 
                            required
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 h-20 resize-none"
                            placeholder="他/她说了什么，表情如何..."
                            value={formData.their_reaction}
                            onChange={e => setFormData({...formData, their_reaction: e.target.value})}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">关系变化 (当前 +{formData.relationship_change}%)</label>
                        <input 
                            type="range" 
                            min="-10" 
                            max="10" 
                            className="w-full"
                            value={formData.relationship_change}
                            onChange={e => setFormData({...formData, relationship_change: parseInt(e.target.value)})}
                        />
                        <div className="flex justify-between text-xs text-gray-400">
                            <span>恶化 (-10%)</span>
                            <span>不变 (0%)</span>
                            <span>升温 (+10%)</span>
                        </div>
                    </div>
                    
                    <div className="pt-4 flex justify-end space-x-3">
                        <button type="button" onClick={onClose} className="px-4 py-2 text-gray-600 bg-gray-100 rounded-lg text-sm">取消</button>
                        <button type="submit" disabled={loading} className="px-6 py-2 text-white bg-primary rounded-lg text-sm">
                            {loading ? '保存中...' : '保存记录'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
