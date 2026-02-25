import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { Send, FileText, Bot, User, Clock, CheckCircle, AlertTriangle, Briefcase, MessageSquare, Mic, Users, Plus, ChevronRight, Save, Link as LinkIcon, BarChart3, MoreHorizontal, X } from 'lucide-react';
import { api } from '../services/api';

// --- Types ---

type ReviewStatus = 'pending' | 'completed' | 'archived';
type ReviewType = 'negotiation' | 'speech' | 'social' | 'conflict' | 'other';
type ReviewResult = 'success' | 'fail' | 'pending';

interface ReviewSummary {
    target: string;
    actual: string;
    keep: string[];
    improve: string[];
    action: string[];
}

interface Message {
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
    type?: 'text' | 'summary_card';
    summaryData?: ReviewSummary;
}

interface ReviewSession {
    id: string;
    title: string;
    date: string;
    status: ReviewStatus;
    type: ReviewType;
    result: ReviewResult;
    messages: Message[];
}

// --- Components ---

const StatusBadge = ({ status }: { status: ReviewStatus }) => {
    switch (status) {
        case 'pending': return <span className="text-[10px] bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded-full flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-yellow-500"></span>待完善</span>;
        case 'completed': return <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>已完成</span>;
        case 'archived': return <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-gray-500"></span>已归档</span>;
    }
};

const TypeIcon = ({ type }: { type: ReviewType }) => {
    switch (type) {
        case 'negotiation': return <Briefcase className="w-3 h-3 mr-1" />;
        case 'speech': return <Mic className="w-3 h-3 mr-1" />;
        case 'social': return <MessageSquare className="w-3 h-3 mr-1" />;
        case 'conflict': return <AlertTriangle className="w-3 h-3 mr-1" />;
        default: return <FileText className="w-3 h-3 mr-1" />;
    }
};

const ResultBadge = ({ result }: { result: ReviewResult }) => {
    switch (result) {
        case 'success': return <span className="text-[10px] font-bold text-green-600">成功 ✅</span>;
        case 'fail': return <span className="text-[10px] font-bold text-red-600">失败 ❌</span>;
        case 'pending': return <span className="text-[10px] font-bold text-gray-400">待定 ⏳</span>;
    }
};

const SummaryCard = ({ data, onLinkPerson, onSaveSOP, isSavingSOP }: { data: ReviewSummary, onLinkPerson: () => void, onSaveSOP: () => void, isSavingSOP: boolean }) => {
    return (
        <div className="bg-white border border-purple-100 rounded-xl p-5 shadow-sm mt-2 w-full max-w-lg">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100">
                <h3 className="font-bold text-purple-900 flex items-center">
                    <Bot className="w-5 h-5 mr-2 text-purple-600" /> 复盘总结卡片
                </h3>
                <span className="text-xs text-gray-400">AI 生成</span>
            </div>
            
            <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="bg-gray-50 p-3 rounded-lg">
                    <div className="text-xs text-gray-500 mb-1 font-bold">🎯 预期目标</div>
                    <div className="text-sm text-gray-800">{data.target}</div>
                </div>
                <div className="bg-gray-50 p-3 rounded-lg">
                    <div className="text-xs text-gray-500 mb-1 font-bold">📉 实际结果</div>
                    <div className="text-sm text-gray-800">{data.actual}</div>
                </div>
            </div>

            <div className="space-y-3 mb-6">
                <div>
                    <div className="flex items-center text-xs font-bold text-green-700 mb-1">
                        <CheckCircle className="w-3 h-3 mr-1" /> 亮点 (Keep)
                    </div>
                    <ul className="list-disc list-inside text-sm text-gray-600 pl-1">
                        {data.keep.map((item, i) => <li key={i}>{item}</li>)}
                    </ul>
                </div>
                <div>
                    <div className="flex items-center text-xs font-bold text-red-700 mb-1">
                        <AlertTriangle className="w-3 h-3 mr-1" /> 不足 (Improve)
                    </div>
                    <ul className="list-disc list-inside text-sm text-gray-600 pl-1">
                        {data.improve.map((item, i) => <li key={i}>{item}</li>)}
                    </ul>
                </div>
                <div>
                    <div className="flex items-center text-xs font-bold text-blue-700 mb-1">
                        <Briefcase className="w-3 h-3 mr-1" /> 行动点 (Action)
                    </div>
                    <div className="bg-blue-50 p-2 rounded text-sm text-blue-800 font-medium">
                         {data.action.map((item, i) => <div key={i}>{i+1}. {item}</div>)}
                    </div>
                </div>
            </div>

            <div className="flex gap-2 pt-2 border-t border-gray-100">
                <button 
                    onClick={onLinkPerson} 
                    className="flex-1 py-2 bg-white border border-gray-200 text-gray-600 rounded-lg text-xs font-bold hover:bg-gray-50 flex items-center justify-center transition-colors"
                >
                    <LinkIcon className="w-3 h-3 mr-1" /> 关联人物
                </button>
                <button 
                    onClick={onSaveSOP} 
                    disabled={isSavingSOP}
                    className="flex-1 py-2 bg-primary text-white rounded-lg text-xs font-bold hover:bg-primary/90 disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
                >
                    {isSavingSOP ? (
                        <>
                            <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white mr-2"></div>
                            生成中...
                        </>
                    ) : (
                        <>
                            <Save className="w-3 h-3 mr-1" /> 保存为 SOP 草稿
                        </>
                    )}
                </button>
            </div>
        </div>
    );
};

// --- Main Component ---

export default function RealReview() {
  const [sessions, setSessions] = useState<ReviewSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Link Person Modal State
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [people, setPeople] = useState<any[]>([]);
  const [selectedPersonId, setSelectedPersonId] = useState<string>('');
  
  // New state for starting review
  const [showStartModal, setShowStartModal] = useState(false);
  const [startPersonId, setStartPersonId] = useState<string>('');

  // Current Session Data
  const currentSession = sessions.find(s => s.id === currentSessionId);
  const messages = currentSession ? currentSession.messages : [];
  
  const [isSavingSOP, setIsSavingSOP] = useState(false);

  // Stats
  const completedCount = sessions.filter(s => s.status === 'completed').length;
  // This success rate calculation is basic, relying on 'result' field which we default to pending
  // We can improve this if AI returns success/fail status
  const successRate = completedCount > 0 ? Math.round((sessions.filter(s => s.result === 'success').length / completedCount) * 100) : 0;

  useEffect(() => {
    fetchSessions();
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, currentSessionId]);

  const fetchSessions = async () => {
      try {
          const data = await api.getReviewSessions();
          setSessions(data);
      } catch (err) {
          console.error("Failed to fetch sessions", err);
      }
  };

  const handleStartNew = async (personId?: string) => {
      // Find person name if personId is provided
      let personContext = "";
      if (personId) {
          const person = people.find(p => p.id === personId);
          if (person) {
              personContext = `\n\n（已关联人物：${person.name} - ${person.identity}）`;
          }
      }

      const newSessionData = {
          title: '新复盘 ' + new Date().toLocaleDateString(),
          status: 'pending',
          type: 'other',
          result: 'pending',
          messages: [
              { role: 'assistant', content: `👋 你好！我是你的复盘教练。我们来复盘刚才那场经历吧。${personContext}\n\n请选择一个场景，或者直接告诉我发生了什么：`, timestamp: new Date() }
          ]
      };
      
      try {
          const result = await api.createReviewSession(newSessionData);
          const newSession = { ...newSessionData, id: result.id, date: new Date().toLocaleDateString() } as ReviewSession;
          setSessions([newSession, ...sessions]);
          setCurrentSessionId(result.id);
          
          // Auto link if person selected
          if (personId) {
              api.linkReviewToPerson(result.id, personId).catch(console.error);
          }
          
          setShowStartModal(false);
          setStartPersonId('');
      } catch (err) {
          console.error("Create session failed", err);
          alert("无法创建复盘会话。请确保后端已连接到 Supabase 并且 `review_sessions` 表已创建。");
      }
  };

  const openStartModal = async () => {
      setShowStartModal(true);
      if (people.length === 0) {
          try {
              const data = await api.getAllPeople();
              setPeople(data);
          } catch (err) {
              console.error("Failed to fetch people", err);
          }
      }
  };

  const handleQuickStart = async (scenario: any) => {
      if (!currentSessionId) return;
      
      // Update local state first for responsiveness (optimistic update)
      // In real app we might want to update title on server too
      setSessions(prev => prev.map(s => s.id === currentSessionId ? { ...s, type: scenario.type, title: scenario.label } : s));
      
      // Send prompt
      await handleSend(scenario.prompt);
  };

  const handleSend = async (textOverride?: string) => {
    const text = textOverride || input;
    if (!text.trim() || !currentSessionId) return;

    // Optimistic UI update for user message
    const userMsg: Message = { role: 'user', content: text, timestamp: new Date() };
    setSessions(prev => prev.map(s => s.id === currentSessionId ? { ...s, messages: [...(s.messages || []), userMsg] } : s));
    
    setInput('');
    setIsTyping(true);

    try {
        const aiResponse = await api.chatReview(currentSessionId, text);
        
        // Update with AI response
        setSessions(prev => prev.map(s => {
            if (s.id === currentSessionId) {
                const newMessages = [...(s.messages || []), aiResponse];
                // Check if summary card returned to update status
                const newStatus = aiResponse.type === 'summary_card' ? 'completed' : s.status;
                return { ...s, messages: newMessages, status: newStatus };
            }
            return s;
        }));
    } catch (err) {
        console.error("Chat failed", err);
        // Add error message locally
        const errorMsg: Message = { role: 'assistant', content: "网络错误，请重试。", timestamp: new Date() };
        setSessions(prev => prev.map(s => s.id === currentSessionId ? { ...s, messages: [...(s.messages || []), errorMsg] } : s));
    } finally {
        setIsTyping(false);
    }
  };

  // --- Actions ---

  const openLinkPersonModal = async () => {
      setShowLinkModal(true);
      if (people.length === 0) {
          try {
              const data = await api.getAllPeople();
              setPeople(data);
          } catch (err) {
              console.error("Failed to fetch people", err);
          }
      }
  };

  const handleLinkPerson = async () => {
      if (!currentSessionId || !selectedPersonId) return;
      try {
          const result = await api.linkReviewToPerson(currentSessionId, selectedPersonId);
          
          let msg = "关联成功！已在人物档案中添加记录。";
          if (result.relationshipChange) {
              const change = result.relationshipChange;
              msg += `\n\n关系变化: ${change > 0 ? '+' : ''}${change}%`;
          }
          
          alert(msg);
          setShowLinkModal(false);
      } catch (err) {
          console.error("Link failed", err);
          alert("关联失败");
      }
  };

  const handleSaveSOP = async (summaryData: any) => {
      if (!currentSessionId || !summaryData) return;
      setIsSavingSOP(true);
      try {
          await api.saveSOPDraft(currentSessionId, summaryData);
          alert("保存成功！已添加到 SOP 库（草稿状态）。");
      } catch (err) {
          console.error("Save SOP failed", err);
          alert("保存失败");
      } finally {
          setIsSavingSOP(false);
      }
  };

  const QUICK_SCENARIOS = [
    { icon: <Briefcase className="w-5 h-5 text-blue-500" />, label: "刚结束一场重要会议", prompt: "我刚结束一场重要会议，想复盘一下。", type: 'negotiation' as ReviewType },
    { icon: <Users className="w-5 h-5 text-green-500" />, label: "刚和一个陌生人聊完", prompt: "我刚和一个陌生人进行了一次社交对话。", type: 'social' as ReviewType },
    { icon: <AlertTriangle className="w-5 h-5 text-red-500" />, label: "刚刚发生了一次冲突", prompt: "我刚才和别人发生了冲突，心情很不好。", type: 'conflict' as ReviewType },
    { icon: <CheckCircle className="w-5 h-5 text-yellow-500" />, label: "今天做成了一件大事", prompt: "今天我成功完成了一个重要目标！", type: 'other' as ReviewType },
  ];

  return (
    <div className="flex h-full bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden relative">
      {/* Sidebar - History */}
      <div className="w-72 border-r border-gray-100 bg-gray-50/50 flex flex-col flex-shrink-0">
        <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-white">
          <h2 className="text-base font-bold text-gray-900 flex items-center">
            <Clock className="w-4 h-4 mr-2 text-primary" />
            历史复盘
          </h2>
          <button 
            onClick={openStartModal}
            className="text-xs bg-primary text-white px-3 py-1.5 rounded-lg hover:bg-primary/90 transition-colors flex items-center shadow-sm"
          >
            <Plus className="w-3 h-3 mr-1" /> 开启新复盘
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
           {sessions.map(session => (
             <div 
                key={session.id}
                onClick={() => setCurrentSessionId(session.id)}
                className={`p-3 rounded-xl border cursor-pointer transition-all ${
                    currentSessionId === session.id 
                    ? 'bg-white border-primary/30 shadow-md ring-1 ring-primary/10' 
                    : 'bg-white border-gray-200 hover:border-gray-300 hover:shadow-sm'
                }`}
             >
               <div className="flex justify-between items-start mb-2">
                   <div className="flex items-center">
                        <StatusBadge status={session.status} />
                   </div>
                   <span className="text-[10px] text-gray-400">{session.date}</span>
               </div>
               
               <div className="font-bold text-gray-900 text-sm mb-1 truncate">{session.title}</div>
               
               <div className="flex justify-between items-center mt-2">
                   <div className="flex items-center text-xs text-gray-500">
                        <TypeIcon type={session.type} />
                        <span className="capitalize">{session.type === 'negotiation' ? '商务谈判' : session.type === 'social' ? '社交破冰' : session.type === 'conflict' ? '冲突处理' : '公开演讲'}</span>
                   </div>
                   <ResultBadge result={session.result} />
               </div>
             </div>
           ))}
        </div>

        {/* Stats Bar */}
        <div className="p-3 bg-gray-100 border-t border-gray-200 text-xs text-gray-600 flex flex-col gap-1">
            <div className="flex justify-between">
                <span>📅 本周复盘: <strong>{sessions.length}</strong> 次</span>
                <span>📈 成功率: <strong>{successRate}%</strong></span>
            </div>
            <div className="flex items-center mt-1 pt-1 border-t border-gray-200/50">
                <BarChart3 className="w-3 h-3 mr-1" />
                主要提升: <strong>汇报能力</strong>
            </div>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col bg-white relative">
        {currentSessionId ? (
            <>
                {/* Header */}
                <div className="h-14 border-b border-gray-100 flex items-center px-6 justify-between bg-white/80 backdrop-blur-sm z-10">
                    <div>
                        <h2 className="font-bold text-gray-900">{currentSession?.title}</h2>
                        <div className="flex items-center text-xs text-gray-500">
                             <span className="mr-2">{currentSession?.date}</span>
                             <span className="flex items-center"><TypeIcon type={currentSession?.type || 'other'} /> {currentSession?.type}</span>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button className="p-2 hover:bg-gray-100 rounded-full text-gray-400"><MoreHorizontal className="w-5 h-5" /></button>
                    </div>
                </div>

                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-gray-50/30">
                {messages.map((msg, idx) => (
                    <div key={idx} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                        <div className={`flex max-w-[85%] ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                            {msg.role === 'assistant' && (
                                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center mr-2 shrink-0">
                                    <Bot className="w-5 h-5 text-primary" />
                                </div>
                            )}
                            
                            <div className={`
                                px-5 py-4 shadow-sm relative text-sm leading-relaxed
                                ${msg.role === 'user' 
                                ? 'bg-primary text-white rounded-2xl rounded-tr-none' 
                                : 'bg-white text-gray-800 border border-gray-100 rounded-2xl rounded-tl-none prose prose-sm max-w-none'}
                            `}>
                                {msg.role === 'user' ? (
                                    <p className="whitespace-pre-wrap">{msg.content}</p>
                                ) : (
                                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                                )}
                            </div>
                        </div>

                        {/* Summary Card Render */}
                        {msg.type === 'summary_card' && msg.summaryData && (
                            <div className="ml-10 mt-2 animate-in fade-in slide-in-from-bottom-4 duration-500">
                                <SummaryCard 
                                    data={msg.summaryData} 
                                    onLinkPerson={openLinkPersonModal}
                                    onSaveSOP={() => handleSaveSOP(msg.summaryData)}
                                    isSavingSOP={isSavingSOP}
                                />
                            </div>
                        )}
                    </div>
                ))}
                
                {/* Quick Start Cards (Only if just 1 message from assistant) */}
                {messages.length === 1 && messages[0].role === 'assistant' && (
                    <div className="ml-10 mt-4 grid grid-cols-1 md:grid-cols-2 gap-3 max-w-2xl animate-in fade-in slide-in-from-bottom-4 duration-500 delay-150">
                        {QUICK_SCENARIOS.map((scenario, i) => (
                            <button 
                                key={i}
                                onClick={() => handleQuickStart(scenario)}
                                className="flex items-center p-4 bg-white border border-gray-200 rounded-xl hover:border-primary/50 hover:shadow-md hover:bg-primary/5 transition-all text-left group"
                            >
                                <div className="p-2 bg-gray-50 rounded-lg mr-3 group-hover:bg-white transition-colors">
                                    {scenario.icon}
                                </div>
                                <div>
                                    <div className="font-bold text-gray-800 text-sm group-hover:text-primary transition-colors">{scenario.label}</div>
                                    <div className="text-xs text-gray-400 mt-0.5">点击快速开始</div>
                                </div>
                            </button>
                        ))}
                    </div>
                )}

                {isTyping && (
                    <div className="flex justify-start ml-10 mt-2">
                        <div className="bg-white border border-gray-100 rounded-full px-4 py-2 text-xs text-gray-500 flex items-center shadow-sm">
                            <span className="w-2 h-2 bg-primary rounded-full animate-bounce mr-1"></span>
                            <span className="w-2 h-2 bg-primary rounded-full animate-bounce mr-1 delay-75"></span>
                            <span className="w-2 h-2 bg-primary rounded-full animate-bounce delay-150"></span>
                            <span className="ml-2">复盘教练正在分析...</span>
                        </div>
                    </div>
                )}
                <div ref={scrollRef} />
                </div>

                {/* Input */}
                <div className="p-4 bg-white border-t border-gray-100">
                <div className="relative max-w-4xl mx-auto">
                    <input
                    type="text"
                    className="w-full pl-5 pr-14 py-4 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-primary/20 focus:border-primary focus:bg-white transition-all text-sm placeholder-gray-400 shadow-inner"
                    placeholder="输入你的回答..."
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                    disabled={isTyping}
                    />
                    <button 
                    onClick={() => handleSend()}
                    disabled={!input.trim() || isTyping}
                    className="absolute right-2 top-2 bottom-2 aspect-square bg-primary text-white rounded-xl hover:bg-primary/90 disabled:opacity-50 transition-all shadow-sm flex items-center justify-center"
                    >
                    <Send className="w-5 h-5" />
                    </button>
                </div>
                </div>
            </>
        ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
                <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mb-4">
                    <Clock className="w-10 h-10 text-gray-300" />
                </div>
                <h3 className="text-lg font-bold text-gray-900 mb-2">开始你的复盘之旅</h3>
                <p className="max-w-xs text-center text-sm mb-6">选择左侧历史记录查看，或开启一个新的复盘来提升你的实战能力。</p>
                <button 
                    onClick={openStartModal}
                    className="px-6 py-3 bg-primary text-white rounded-xl hover:bg-primary/90 transition-colors shadow-lg shadow-primary/20 font-bold flex items-center"
                >
                    <Plus className="w-5 h-5 mr-2" /> 开启新复盘
                </button>
            </div>
        )}
      </div>

      {/* Start Review Modal */}
      {showStartModal && (
          <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 backdrop-blur-sm">
              <div className="bg-white rounded-xl shadow-2xl w-full max-w-md flex flex-col max-h-[80vh]">
                  <div className="flex justify-between items-center p-4 border-b border-gray-100">
                      <h3 className="font-bold text-gray-900">开始新复盘</h3>
                      <button onClick={() => setShowStartModal(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5"/></button>
                  </div>
                  <div className="p-4">
                      <p className="text-sm text-gray-600 mb-4">您可以选择关联一个人物，以便 AI 复盘教练提供更有针对性的建议。</p>
                      <div className="mb-4">
                          <label className="block text-xs font-bold text-gray-700 mb-2 uppercase">关联人物 (可选)</label>
                          <div className="space-y-2 max-h-48 overflow-y-auto border border-gray-200 rounded-lg p-2">
                              <div 
                                  onClick={() => setStartPersonId('')}
                                  className={`flex items-center p-2 rounded cursor-pointer ${!startPersonId ? 'bg-primary/10 text-primary' : 'hover:bg-gray-50'}`}
                              >
                                  <div className="w-8 h-8 rounded-full bg-gray-200 mr-2 flex items-center justify-center text-xs">无</div>
                                  <span className="text-sm font-medium">不关联特定人物</span>
                                  {!startPersonId && <CheckCircle className="w-4 h-4 ml-auto" />}
                              </div>
                              {people.map(p => (
                                  <div 
                                      key={p.id}
                                      onClick={() => setStartPersonId(p.id)}
                                      className={`flex items-center p-2 rounded cursor-pointer ${startPersonId === p.id ? 'bg-primary/10 text-primary' : 'hover:bg-gray-50'}`}
                                  >
                                      <div className="w-8 h-8 rounded-full bg-gray-200 mr-2 overflow-hidden shrink-0">
                                          {p.avatar_real ? (
                                              <img src={p.avatar_real} className="w-full h-full object-cover" />
                                          ) : (
                                              <div className="w-full h-full flex items-center justify-center text-gray-500 font-bold text-xs">{p.name[0]}</div>
                                          )}
                                      </div>
                                      <div>
                                          <div className="text-sm font-bold">{p.name}</div>
                                          <div className="text-xs opacity-70">{p.identity}</div>
                                      </div>
                                      {startPersonId === p.id && <CheckCircle className="w-4 h-4 ml-auto" />}
                                  </div>
                              ))}
                          </div>
                      </div>
                      <button 
                          onClick={() => handleStartNew(startPersonId)}
                          className="w-full py-3 bg-primary text-white rounded-xl font-bold hover:bg-primary/90 transition-colors shadow-md"
                      >
                          开始复盘
                      </button>
                  </div>
              </div>
          </div>
      )}

      {/* Link Person Modal */}
      {showLinkModal && (
          <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 backdrop-blur-sm">
              <div className="bg-white rounded-xl shadow-2xl w-full max-w-md flex flex-col max-h-[80vh]">
                  <div className="flex justify-between items-center p-4 border-b border-gray-100">
                      <h3 className="font-bold text-gray-900">关联人物档案</h3>
                      <button onClick={() => setShowLinkModal(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5"/></button>
                  </div>
                  <div className="p-4 overflow-y-auto flex-1">
                      {people.length === 0 ? (
                          <div className="text-center py-4 text-gray-400">暂无人物档案</div>
                      ) : (
                          <div className="space-y-2">
                              {people.map(p => (
                                  <div 
                                      key={p.id}
                                      onClick={() => setSelectedPersonId(p.id)}
                                      className={`flex items-center p-3 rounded-lg border cursor-pointer transition-colors ${selectedPersonId === p.id ? 'border-primary bg-primary/5' : 'border-gray-200 hover:bg-gray-50'}`}
                                  >
                                      <div className="w-10 h-10 rounded-full bg-gray-200 mr-3 overflow-hidden shrink-0">
                                          {p.avatar_real ? (
                                              <img src={p.avatar_real} className="w-full h-full object-cover" />
                                          ) : (
                                              <div className="w-full h-full flex items-center justify-center text-gray-500 font-bold">{p.name[0]}</div>
                                          )}
                                      </div>
                                      <div>
                                          <div className="font-bold text-gray-900">{p.name}</div>
                                          <div className="text-xs text-gray-500">{p.identity}</div>
                                      </div>
                                      {selectedPersonId === p.id && <CheckCircle className="w-5 h-5 text-primary ml-auto" />}
                                  </div>
                              ))}
                          </div>
                      )}
                  </div>
                  <div className="p-4 border-t border-gray-100">
                      <button 
                          onClick={handleLinkPerson}
                          disabled={!selectedPersonId}
                          className="w-full py-2 bg-primary text-white rounded-lg font-bold disabled:opacity-50 hover:bg-primary/90 transition-colors"
                      >
                          确认关联
                      </button>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
}
