import { useState, useEffect } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { CheckCircle, BarChart2, ArrowRight, UserCheck, UserPlus } from 'lucide-react';
import { api } from '../services/api';

export default function Review() {
  const location = useLocation();
  const { scene, messages } = location.state || {};
  const [feedback, setFeedback] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [relationCreated, setRelationCreated] = useState(false);

  useEffect(() => {
    if (messages && messages.length > 0) {
      // Simulate API call to generate feedback
      const generateFeedback = async () => {
        try {
          const response = await fetch('/api/scene/complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              scene_id: scene.scene_id,
              conversation_log: messages,
              final_result: { success: true } // Simplified
            })
          });
          
          const data = await response.json();
          setFeedback(data.feedback);
        } catch (err) {
          console.error("Feedback Error:", err);
          // Fallback mock
          setFeedback({
            scores: { "沟通能力": 8, "谈判技巧": 7, "共情能力": 9 },
            strengths: ["积极倾听做得很好", "价值主张阐述清晰"],
            weaknesses: ["错失了成交机会", "在报价环节显得犹豫"],
            suggestions: ["下次尝试使用'锚定效应'报价", "表达观点时更加自信"]
          });
        } finally {
          setLoading(false);
        }
      };

      generateFeedback();
    } else {
      setLoading(false);
    }
  }, [messages, scene]);

  const handleCreateRelation = async () => {
      if (relationCreated) return;
      
      try {
          // In a real app, we would use AI to summarize the interaction first
          const relationData = {
              npc_id: scene.scene_id, // Or generate a new UUID if it's a temp scene
              npc_name: scene.npc_profile.name,
              npc_profile_snapshot: scene.npc_profile,
              relationship_stage: 'L1_BREAKING',
              favorability_score: 10, // Initial score based on success
              last_interaction_summary: "初次相识，进行了愉快的交流。",
              user_id: "user_001" // Current user
          };
          
          await api.createNPCRelation(relationData);
          setRelationCreated(true);
          alert(`成功与 ${scene.npc_profile.name} 建立长线联系！\n已存入【人脉通讯录】。`);
      } catch (err) {
          console.error("Failed to create relation", err);
          alert("建立联系失败");
      }
  };

  if (!scene || !messages) {
    return (
      <div className="text-center py-20">
        <h2 className="text-2xl font-bold text-gray-700">未找到训练记录。</h2>
        <Link to="/" className="text-primary hover:underline mt-4 inline-block">返回控制台</Link>
      </div>
    );
  }

  // Helper function to safely get array content
  const getList = (item: any) => {
    if (Array.isArray(item)) return item;
    if (typeof item === 'string') return [item];
    return [];
  };

  const scoreMap: Record<string, string> = {
    accuracy: "内容准确度",
    emotion: "情绪适配度",
    relationship: "关系推进度",
    goal: "目标达成度",
    risk: "风险规避度"
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-12">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">训练复盘</h1>
        <p className="text-gray-500">分析你的表现，持续精进。</p>
      </div>

      {loading ? (
        <div className="text-center py-20">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-gray-600">AI 教练正在分析对话细节...</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Scores */}
          <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100">
            <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center">
              <BarChart2 className="w-5 h-5 mr-2 text-primary" /> 能力评分
            </h3>
            <div className="space-y-4">
              {Object.entries(feedback?.scores || {}).map(([key, score]) => (
                <div key={key}>
                  <div className="flex justify-between mb-1">
                    <span className="text-sm font-medium text-gray-700">{scoreMap[key] || key}</span>
                    <span className="text-sm font-medium text-gray-700">{String(score)}/10</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2.5">
                    <div 
                      className="bg-primary h-2.5 rounded-full" 
                      style={{ width: `${(Number(score) / 10) * 100}%` }}
                    ></div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Feedback */}
          <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100">
            <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center">
              <UserCheck className="w-5 h-5 mr-2 text-secondary" /> AI 教练点评
            </h3>
            
            <div className="mb-4">
              <h4 className="font-semibold text-green-700 mb-2">亮点</h4>
              <ul className="list-disc list-inside text-sm text-gray-600 space-y-1">
                {getList(feedback?.strengths).length > 0 
                  ? getList(feedback?.strengths).map((s: string, i: number) => <li key={i}>{s}</li>)
                  : <li className="text-gray-400 italic">暂无特别亮点</li>
                }
              </ul>
            </div>

            <div>
              <h4 className="font-semibold text-red-700 mb-2">待改进</h4>
              <ul className="list-disc list-inside text-sm text-gray-600 space-y-1">
                {getList(feedback?.weaknesses).length > 0
                  ? getList(feedback?.weaknesses).map((w: string, i: number) => <li key={i}>{w}</li>)
                  : <li className="text-gray-400 italic">暂无明显问题</li>
                }
              </ul>
            </div>
          </div>

          {/* Suggestions */}
          <div className="md:col-span-2 bg-indigo-50 p-6 rounded-lg border border-indigo-100">
             <h3 className="text-lg font-bold text-indigo-900 mb-3 flex items-center">
               <ArrowRight className="w-5 h-5 mr-2" /> 行动建议
             </h3>
             <ul className="space-y-2">
               {/* Handle both 'suggestion' (singular string) and 'suggestions' (array) */}
               {getList(feedback?.suggestions || feedback?.suggestion).length > 0
                 ? getList(feedback?.suggestions || feedback?.suggestion).map((s: string, i: number) => (
                   <li key={i} className="flex items-start">
                     <CheckCircle className="w-5 h-5 text-indigo-600 mr-2 flex-shrink-0 mt-0.5" />
                     <span className="text-indigo-800">{s}</span>
                   </li>
                 ))
                 : <li className="text-indigo-400 italic ml-7">暂无具体建议</li>
               }
             </ul>
          </div>
        </div>
      )}
      
      <div className="flex justify-center mt-8 gap-4">
        <button 
          onClick={handleCreateRelation}
          disabled={relationCreated}
          className={`px-8 py-3 rounded-lg transition-colors shadow-md font-medium flex items-center ${relationCreated ? 'bg-green-100 text-green-700 cursor-default' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}
        >
          <UserPlus className="w-5 h-5 mr-2" />
          {relationCreated ? "已建立长线联系" : "建立长线联系"}
        </button>
        <Link 
          to="/" 
          className="px-8 py-3 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors shadow-sm font-medium"
        >
          返回控制台
        </Link>
      </div>
    </div>
  );
}