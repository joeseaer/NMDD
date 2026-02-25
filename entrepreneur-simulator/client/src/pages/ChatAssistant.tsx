import React, { useState, useEffect, useRef } from 'react';
import { Send, User, Bot, Loader2, Sparkles, BookOpen } from 'lucide-react';

export default function ChatAssistant() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const scrollRef = useRef(null);
  
  // WebSocket connection would go here in a real app
  // For now, we simulate API calls

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim()) return;

    const userMsg = { role: 'user', content: input, timestamp: new Date() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsTyping(true);

    try {
      const response = await fetch('/api/assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: "user_001", query: input })
      });
      
      const data = await response.json();
      
      const aiMsg = { 
        role: 'assistant', 
        content: data.content, 
        related_sops: data.related_sops || [],
        timestamp: new Date() 
      };
      
      setMessages(prev => [...prev, aiMsg]);
    } catch (err) {
      console.error("Assistant Error", err);
      setMessages(prev => [...prev, { role: 'assistant', content: "抱歉，连接失败，请稍后重试。", timestamp: new Date() }]);
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-white">
        <div>
          <h2 className="text-lg font-bold text-gray-900 flex items-center">
            <Sparkles className="w-5 h-5 text-yellow-500 mr-2" />
            AI 实时创业导师
          </h2>
          <p className="text-sm text-gray-500">随时解答你的真实商业难题，调用你的历史经验库。</p>
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-gray-50/30">
        {messages.length === 0 && (
          <div className="text-center py-20 text-gray-400">
            <Bot className="w-12 h-12 mx-auto mb-4 text-gray-300" />
            <p>你好！我是你的私人创业顾问。</p>
            <p className="text-sm mt-2">我可以帮你分析谈判策略、回顾历史复盘、提供SOP建议。</p>
            <div className="mt-6 flex justify-center gap-2">
              <button onClick={() => setInput("下午要见投资人，怎么准备？")} className="px-3 py-1 bg-white border border-gray-200 rounded-full text-xs hover:border-primary hover:text-primary transition-colors">下午要见投资人，怎么准备？</button>
              <button onClick={() => setInput("帮我分析上次谈判失败的原因")} className="px-3 py-1 bg-white border border-gray-200 rounded-full text-xs hover:border-primary hover:text-primary transition-colors">帮我分析上次谈判失败的原因</button>
            </div>
          </div>
        )}
        
        {messages.map((msg, idx) => (
          <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`
              max-w-[80%] rounded-2xl px-5 py-4 shadow-sm relative
              ${msg.role === 'user' 
                ? 'bg-primary text-white rounded-tr-none' 
                : 'bg-white text-gray-800 border border-gray-100 rounded-tl-none'}
            `}>
              <div className="flex items-center mb-1 opacity-70 text-xs">
                {msg.role === 'assistant' && <Bot className="w-3 h-3 mr-1" />}
                <span className="font-bold">{msg.role === 'user' ? '你' : 'AI 导师'}</span>
              </div>
              <p className="whitespace-pre-wrap leading-relaxed text-sm">{msg.content}</p>
              
              {/* Related SOPs */}
              {msg.related_sops && msg.related_sops.length > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-100/50">
                  <p className="text-xs font-semibold mb-2 flex items-center opacity-80">
                    <BookOpen className="w-3 h-3 mr-1" /> 参考资料：
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {msg.related_sops.map((sop, i) => (
                      <span key={i} className="px-2 py-1 bg-black/5 rounded text-xs truncate max-w-[150px] cursor-pointer hover:bg-black/10 transition-colors">
                        📄 {sop}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
        
        {isTyping && (
          <div className="flex justify-start">
            <div className="bg-white border border-gray-100 rounded-full px-4 py-2 text-xs text-gray-500 flex items-center shadow-sm">
              <Loader2 className="w-3 h-3 mr-2 animate-spin" />
              正在思考与检索知识库...
            </div>
          </div>
        )}
        <div ref={scrollRef} />
      </div>

      {/* Input */}
      <div className="p-4 bg-white border-t border-gray-100">
        <div className="relative">
          <input
            type="text"
            className="w-full pl-4 pr-12 py-4 bg-gray-50 border-none rounded-xl focus:ring-2 focus:ring-primary/20 focus:bg-white transition-all text-sm placeholder-gray-400"
            placeholder="输入你的问题，例如：如何处理客户投诉？"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            disabled={isTyping}
          />
          <button 
            onClick={handleSend}
            disabled={!input.trim() || isTyping}
            className="absolute right-2 top-2 p-2 bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}