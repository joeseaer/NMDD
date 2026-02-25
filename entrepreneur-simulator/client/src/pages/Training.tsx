import { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { Send, AlertTriangle, CheckCircle, Info, Sparkles, X, Activity } from 'lucide-react';

interface NPCResponse {
  text: string;
  emotion_score: number;
  emotion_label: string;
  action_description: string;
  context_reference: string;
}

interface CoachFeedback {
  signal_decoding: string;
  situation_analysis: string;
  strategic_advice: string;
  reference_script: string;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  npc_response?: NPCResponse;
  coach_feedback?: CoachFeedback;
  timestamp: Date;
}

interface AnalysisResult {
  insight: string;
  strategy: string[];
  info_to_get: string[];
}

export default function Training() {
  const { sceneId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [currentEmotionScore, setCurrentEmotionScore] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  
  // Get scene data from navigation state or fetch it
  const scene = location.state?.scene || {
    scene_id: sceneId,
    id: sceneId, // Fallback compatibility
    scene_type: "场景加载中",
    npc_profile: { name: "...", role: "..." },
    initial_context: "正在生成沉浸式场景..."
  };

  useEffect(() => {
    // If no scene data in state (e.g. refresh), fetch it
    if (!location.state?.scene) {
        // In a real app, fetch scene details by ID
    }

    // Normalize data structure for UI
    const normalizedScene = {
        scene_type: scene.type || scene.scene_type || "未知场景",
        npc_profile: scene.npc || scene.npc_profile || { name: "NPC", role: "未知角色" },
        context: scene.context || scene.initial_context || "场景加载中...",
        initial_message: scene.initial_message || ""
    };

    if (messages.length === 0 && (normalizedScene.context)) {
      setMessages([{
        role: 'assistant',
        content: `【场景背景】\n${normalizedScene.context}\n\n${normalizedScene.initial_message}`,
        timestamp: new Date()
      }]);
    }
  }, [scene]);

  const displayScene = {
      scene_type: scene.type || scene.scene_type || "未知场景",
      npc_profile: scene.npc || scene.npc_profile || { name: "NPC", role: "未知角色" },
      context: scene.context || scene.initial_context || "场景加载中..."
  };

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim()) return;

    const userMessage: Message = {
      role: 'user',
      content: input,
      timestamp: new Date()
    };
    
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsTyping(true);

    try {
      // Call backend to process chat
      const response = await fetch('/api/scene/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scene_id: sceneId,
          user_input: input,
          conversation_history: messages.map(m => ({ role: m.role, content: m.content })),
          npc_profile: displayScene.npc_profile,
          context: displayScene.context,
          emotion_state: currentEmotionScore // Pass current emotion state
        })
      });

      const data = await response.json();
      
      const npcResponse = data.npc_response || {};
      const coachFeedback = data.coach_feedback || {};

      const npcMessage: Message = {
        role: 'assistant',
        content: npcResponse.text || "...",
        npc_response: npcResponse,
        coach_feedback: coachFeedback,
        timestamp: new Date()
      };
      
      if (typeof npcResponse.emotion_score === 'number') {
        setCurrentEmotionScore(npcResponse.emotion_score);
      }

      setMessages(prev => [...prev, npcMessage]);
    } catch (err) {
      console.error("Chat Error:", err);
      // Fallback for demo
      setTimeout(() => {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: "抱歉，我现在连接不上AI大脑了。（后台服务未启动？）",
          timestamp: new Date()
        }]);
      }, 1000);
    } finally {
      setIsTyping(false);
    }
  };

  const handleEndSession = async () => {
    // Navigate to review
    navigate(`/review/${sceneId}`, { state: { scene: displayScene, messages } });
  };

  const handleAnalyzeScene = async () => {
    if (analysis) {
        setShowAnalysis(true);
        return;
    }
    
    setAnalyzing(true);
    try {
        const response = await fetch('/api/scene/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(displayScene)
        });
        const data = await response.json();
        setAnalysis(data);
        setShowAnalysis(true);
    } catch (err) {
        console.error("Analysis Failed", err);
    } finally {
        setAnalyzing(false);
    }
  };

  return (
    <div className="flex h-full gap-4">
      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col bg-white rounded-xl shadow-lg overflow-hidden border border-gray-200 relative">
        {/* Immersive Header */}
        <div className="bg-gradient-to-r from-gray-900 to-gray-800 text-white p-4 flex justify-between items-center shadow-md z-10">
          <div>
            <div className="flex items-center space-x-2">
              <span className="bg-white/20 text-xs font-semibold px-2 py-0.5 rounded backdrop-blur-sm border border-white/10">
                {displayScene.scene_type}
              </span>
              <h2 className="text-lg font-bold flex items-center">
                与 {displayScene.npc_profile.name} ({displayScene.npc_profile.role}) 对话中
              </h2>
            </div>
            {/* NPC Status Bar - Visualizing Emotion */}
            <div className="mt-2 flex items-center space-x-4 text-xs text-gray-300">
               <div className="flex items-center w-64">
                 <span className="mr-2 flex items-center"><Activity className="w-3 h-3 mr-1" /> 情绪值: {currentEmotionScore}</span>
                 <div className="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden relative">
                   {/* Center marker */}
                   <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-gray-500"></div>
                   {/* Bar */}
                   <div 
                      className={`h-full transition-all duration-500 ${currentEmotionScore >= 0 ? 'bg-green-500' : 'bg-red-500'}`}
                      style={{ 
                        width: `${Math.abs(currentEmotionScore)}%`,
                        marginLeft: currentEmotionScore >= 0 ? '50%' : `${50 - Math.abs(currentEmotionScore)}%`
                      }}
                   ></div>
                 </div>
                 <span className="ml-2 text-xs opacity-70">
                    {currentEmotionScore >= 50 ? '极佳' : currentEmotionScore >= 0 ? '平稳' : currentEmotionScore >= -50 ? '烦躁' : '愤怒'}
                 </span>
               </div>
            </div>
          </div>
          <div className="flex gap-2">
              <button 
                onClick={handleAnalyzeScene}
                disabled={analyzing}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-all shadow-sm border flex items-center ${
                    showAnalysis 
                    ? 'bg-indigo-600 text-white border-indigo-500' 
                    : 'bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20 border-indigo-400/30'
                }`}
              >
                {analyzing ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current"></div> : <Sparkles className="w-4 h-4 mr-1" />}
                AI 分析
              </button>
              <button 
                onClick={handleEndSession}
                className="bg-red-600/80 hover:bg-red-600 px-4 py-2 rounded-lg text-sm font-medium transition-all shadow-sm border border-red-500/50"
              >
                结束并复盘
              </button>
          </div>
        </div>

        {/* Chat Messages Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
          {messages.map((msg, index) => (
            <div key={index} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
              <div className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} w-full`}>
                <div className={`max-w-[80%] rounded-2xl px-4 py-3 shadow-sm ${
                  msg.role === 'user' 
                    ? 'bg-indigo-600 text-white rounded-tr-none' 
                    : 'bg-white text-gray-800 border border-gray-100 rounded-tl-none'
                }`}>
                  {/* Action Description */}
                  {msg.npc_response?.action_description && (
                    <div className="text-xs text-gray-500 italic mb-1 border-b border-gray-100 pb-1">
                      ({msg.npc_response.action_description})
                    </div>
                  )}

                  <div className="text-sm">{msg.content}</div>
                  
                  {/* Metadata Footer */}
                  {msg.npc_response && (
                    <div className="text-xs mt-2 pt-2 border-t border-gray-100 opacity-70 flex items-center justify-between">
                      <span className={`px-1.5 py-0.5 rounded ${msg.npc_response.emotion_score >= 0 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                        {msg.npc_response.emotion_label} ({msg.npc_response.emotion_score})
                      </span>
                    </div>
                  )}
                </div>
              </div>
              
              {msg.coach_feedback && (msg.coach_feedback.signal_decoding || msg.coach_feedback.situation_analysis || msg.coach_feedback.strategic_advice) && (
                  <div className="mt-2 mb-4 max-w-[90%] bg-white border border-indigo-100 shadow-sm rounded-lg overflow-hidden animate-in fade-in slide-in-from-top-2 duration-500">
                      <div className="bg-indigo-50/50 px-3 py-2 border-b border-indigo-100 flex items-center">
                          <Sparkles className="w-4 h-4 text-indigo-600 mr-2" />
                          <span className="text-xs font-bold text-indigo-900">AI 战术军师</span>
                      </div>
                      <div className="p-3 space-y-2">
                         {msg.coach_feedback.signal_decoding && (
                           <div className="flex items-start">
                             <span className="text-xs font-bold text-purple-600 mr-2 min-w-[4.5em]">🔍 信号:</span>
                             <p className="text-xs text-gray-600">{msg.coach_feedback.signal_decoding}</p>
                           </div>
                         )}
                         {msg.coach_feedback.situation_analysis && (
                           <div className="flex items-start">
                             <span className="text-xs font-bold text-blue-600 mr-2 min-w-[4.5em]">🧭 局势:</span>
                             <p className="text-xs text-gray-600">{msg.coach_feedback.situation_analysis}</p>
                           </div>
                         )}
                         {msg.coach_feedback.strategic_advice && (
                           <div className="flex items-start">
                             <span className="text-xs font-bold text-green-600 mr-2 min-w-[4.5em]">💡 建议:</span>
                             <p className="text-xs text-gray-600">{msg.coach_feedback.strategic_advice}</p>
                           </div>
                         )}
                         {msg.coach_feedback.reference_script && (
                           <div className="mt-2 bg-green-50 p-2 rounded border border-green-100">
                             <span className="text-xs font-bold text-green-700 block mb-1">👉 参考话术:</span>
                             <p className="text-xs text-gray-700 italic">"{msg.coach_feedback.reference_script}"</p>
                           </div>
                         )}
                      </div>
                  </div>
              )}
            </div>
          ))}
          <div ref={scrollRef} />
        </div>

        {/* Input Area */}
        <div className="p-4 bg-white border-t border-gray-100">
          <div className="relative">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder={isTyping ? "对方正在输入..." : "输入你的回答..."}
              disabled={isTyping}
              className="w-full pl-4 pr-12 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all outline-none"
            />
            <button 
              onClick={handleSend}
              disabled={!input.trim() || isTyping}
              className="absolute right-2 top-2 p-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
          <div className="text-center mt-2">
             <span className="text-xs text-gray-400 flex items-center justify-center">
                <AlertTriangle className="w-3 h-3 mr-1" />
                提示：你的每一句话都会影响 {displayScene.npc_profile.name} 的情绪和对你的看法
             </span>
          </div>
        </div>
      </div>

      {/* Side Panel: AI Analysis (Inline) */}
      {showAnalysis && analysis && (
          <div className="w-80 bg-white rounded-xl shadow-lg border border-gray-200 flex flex-col animate-in slide-in-from-right duration-300">
              <div className="bg-indigo-50 p-4 border-b border-indigo-100 flex justify-between items-center">
                  <h3 className="font-bold text-indigo-900 flex items-center"><Sparkles className="w-4 h-4 mr-2 text-indigo-600" /> 战术分析板</h3>
                  <button onClick={() => setShowAnalysis(false)} className="text-indigo-400 hover:text-indigo-600"><X className="w-4 h-4" /></button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-5">
                  <div className="bg-white p-3 rounded-lg border border-indigo-100 shadow-sm">
                      <h4 className="text-xs font-bold text-gray-500 mb-2 uppercase tracking-wider">💡 核心洞察</h4>
                      <p className="text-sm text-gray-800 leading-relaxed font-medium">{analysis.insight}</p>
                  </div>
                  
                  <div>
                      <h4 className="text-xs font-bold text-gray-500 mb-2 uppercase tracking-wider flex items-center">
                          <CheckCircle className="w-3 h-3 mr-1 text-green-500" /> 推荐策略
                      </h4>
                      <ul className="space-y-2">
                          {analysis.strategy.map((s, i) => (
                              <li key={i} className="text-sm text-gray-700 bg-green-50 p-2 rounded border border-green-100">
                                  {s}
                              </li>
                          ))}
                      </ul>
                  </div>

                  <div>
                      <h4 className="text-xs font-bold text-gray-500 mb-2 uppercase tracking-wider flex items-center">
                          <Info className="w-3 h-3 mr-1 text-blue-500" /> 关键信息获取
                      </h4>
                      <ul className="space-y-1">
                          {analysis.info_to_get.map((info, i) => (
                              <li key={i} className="text-xs text-gray-600 flex items-start">
                                  <span className="w-1 h-1 bg-blue-400 rounded-full mr-2 mt-1.5 flex-shrink-0"></span>
                                  {info}
                              </li>
                          ))}
                      </ul>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
}