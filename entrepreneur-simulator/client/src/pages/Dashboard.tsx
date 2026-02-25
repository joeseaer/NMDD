import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Play, TrendingUp, History, TreeDeciduous, ArrowRight, BarChart3, Zap, Users, BookOpen, Award, Target, Gem, Crown, Shield } from 'lucide-react';
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Tooltip } from 'recharts';
import { api } from '../services/api';

export default function Dashboard() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [recentScenes, setRecentScenes] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);

  useEffect(() => {
    // Fetch user stats
    api.getUserStats().then(setStats).catch(console.error);
    
    // Fetch history
    fetch('/api/history/user_001')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) setRecentScenes(data);
      })
      .catch(err => console.error("Failed to fetch history", err));
  }, []);

  const radarData = [
    { subject: '商业认知', A: stats ? stats.scores?.business_cognition || 0 : 0, fullMark: 100 },
    { subject: '识人能力', A: stats ? stats.scores?.people_skills || 0 : 0, fullMark: 100 },
    { subject: '个人品牌', A: stats ? stats.scores?.personal_branding || 0 : 0, fullMark: 100 },
    { subject: '说话能力', A: stats ? stats.scores?.communication || 0 : 0, fullMark: 100 },
    { subject: '资源整合', A: stats ? stats.scores?.resource_integration || 0 : 0, fullMark: 100 },
    { subject: '风险管理', A: stats ? stats.scores?.risk_management || 0 : 0, fullMark: 100 },
  ];

  const getReviewCount = (type: string) => {
      if (!stats || !stats.reviewCounts) return 0;
      if (type === 'total') return stats.reviewCounts.total;
      return stats.reviewCounts[type] || 0;
  };

  const handleStartTraining = async (customGoal?: string) => {
    setLoading(true);
    try {
      // Call backend to generate scene based on user profile (weaknesses) OR custom goal
      const response = await fetch('/api/scene/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: "user_001",
          // If customGoal is provided, use it; otherwise, let backend decide based on weaknesses
          goal: customGoal || "auto_generate_based_on_weakness", 
          constraints: "严格的时间限制，对方比较多疑"
        })
      });
      
      const data = await response.json();
      // Ensure we navigate using the correct property, handling both 'scene_id' and 'id'
      const targetId = data.scene_id || data.id;
      if (targetId) {
        navigate(`/training/${targetId}`, { state: { scene: data } });
      } else {
         console.error("Invalid scene data received:", data);
         // Fallback if ID is missing but we have other data
         if (data.type) {
             const fallbackId = "generated-" + Date.now();
             navigate(`/training/${fallbackId}`, { state: { scene: { ...data, scene_id: fallbackId } } });
         }
      }
    } catch (err) {
      console.error("Failed to start training", err);
      // Fallback
      const mockScene = {
        scene_id: "mock-auto-" + Date.now(),
        scene_type: customGoal || "自动生成的针对性训练",
        npc_profile: { name: "王总", role: "潜在客户" },
        initial_context: "AI根据你的历史表现，为你生成了一个高压谈判场景..."
      };
      navigate(`/training/${mockScene.scene_id}`, { state: { scene: mockScene } });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 p-4 lg:p-8">
      {/* Banner */}
      <div className="bg-gradient-to-r from-indigo-600 to-purple-600 px-8 py-10 text-white shadow-lg">
          <div className="flex justify-between items-end">
              <div>
                  <h1 className="text-3xl font-bold mb-2">训练仪表盘</h1>
                  <p className="text-indigo-100 opacity-90">欢迎回来，探索者。准备好今天的进化了吗？</p>
              </div>
              <div className="text-right">
                  <div className="text-4xl font-bold mb-1">Lv.12</div>
                  <div className="text-xs bg-white/20 px-3 py-1 rounded-full backdrop-blur-sm inline-block">距离下一级还需 350 XP</div>
              </div>
          </div>
      </div>

      <div className="p-8 -mt-8 grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Card 1: Radar Chart */}
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 flex flex-col">
              <h3 className="font-bold text-gray-800 mb-4 flex items-center">
                  <BarChart3 className="w-5 h-5 mr-2 text-indigo-500" /> 个人能力雷达
              </h3>
              <div className="flex-1 min-h-[250px] relative">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart cx="50%" cy="50%" outerRadius="80%" data={radarData}>
                      <PolarGrid stroke="#e5e7eb" />
                      <PolarAngleAxis dataKey="subject" tick={{ fill: '#6b7280', fontSize: 12 }} />
                      <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                      <Radar name="能力值" dataKey="A" stroke="#6366f1" fill="#818cf8" fillOpacity={0.2} />
                      <Tooltip />
                    </RadarChart>
                  </ResponsiveContainer>
              </div>
          </div>

          {/* Card 2: Strengths */}
          <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-2xl p-6 shadow-sm border border-green-100">
              <h3 className="font-bold text-green-800 mb-4 flex items-center">
                  <TrendingUp className="w-5 h-5 mr-2" /> 优势能力
              </h3>
              <ul className="space-y-3">
                  <li className="flex items-center bg-white/60 p-3 rounded-xl">
                      <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center mr-3 text-green-600">
                          <Users className="w-4 h-4" />
                      </div>
                      <span className="font-medium text-green-900">敏锐洞察</span>
                  </li>
                  <li className="flex items-center bg-white/60 p-3 rounded-xl">
                      <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center mr-3 text-green-600">
                          <Zap className="w-4 h-4" />
                      </div>
                      <span className="font-medium text-green-900">快速破冰</span>
                  </li>
                  <li className="flex items-center bg-white/60 p-3 rounded-xl">
                      <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center mr-3 text-green-600">
                          <BookOpen className="w-4 h-4" />
                      </div>
                      <span className="font-medium text-green-900">故事叙述</span>
                  </li>
              </ul>
          </div>

          {/* Card 3: Weaknesses */}
          <div className="bg-gradient-to-br from-red-50 to-rose-50 rounded-2xl p-6 shadow-sm border border-red-100">
              <h3 className="font-bold text-red-800 mb-4 flex items-center">
                  <Target className="w-5 h-5 mr-2" /> 待提升
              </h3>
              <ul className="space-y-3">
                  <li className="flex items-center bg-white/60 p-3 rounded-xl">
                      <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center mr-3 text-red-600">
                          <Gem className="w-4 h-4" />
                      </div>
                      <span className="font-medium text-red-900">价值提炼</span>
                  </li>
                  <li className="flex items-center bg-white/60 p-3 rounded-xl">
                      <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center mr-3 text-red-600">
                          <Crown className="w-4 h-4" />
                      </div>
                      <span className="font-medium text-red-900">高维对话</span>
                  </li>
                  <li className="flex items-center bg-white/60 p-3 rounded-xl">
                      <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center mr-3 text-red-600">
                          <Shield className="w-4 h-4" />
                      </div>
                      <span className="font-medium text-red-900">机会闭环</span>
                  </li>
              </ul>
          </div>
      </div>

      {/* Stats Overview Row */}
      <div className="px-8 pb-8 grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm flex items-center">
              <div className="w-12 h-12 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center mr-4">
                  <Play className="w-6 h-6" />
              </div>
              <div>
                  <div className="text-2xl font-bold text-gray-900">{getReviewCount('total')}</div>
                  <div className="text-xs text-gray-500">总训练次数</div>
              </div>
          </div>
          <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm flex items-center">
              <div className="w-12 h-12 rounded-full bg-purple-50 text-purple-600 flex items-center justify-center mr-4">
                  <Users className="w-6 h-6" />
              </div>
              <div>
                  <div className="text-2xl font-bold text-gray-900">{stats?.peopleCount || 0}</div>
                  <div className="text-xs text-gray-500">识人档案</div>
              </div>
          </div>
          <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm flex items-center">
              <div className="w-12 h-12 rounded-full bg-orange-50 text-orange-600 flex items-center justify-center mr-4">
                  <BookOpen className="w-6 h-6" />
              </div>
              <div>
                  <div className="text-2xl font-bold text-gray-900">{stats?.sopCount || 0}</div>
                  <div className="text-xs text-gray-500">沉淀 SOP</div>
              </div>
          </div>
          <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm flex items-center">
              <div className="w-12 h-12 rounded-full bg-teal-50 text-teal-600 flex items-center justify-center mr-4">
                  <Award className="w-6 h-6" />
              </div>
              <div>
                  <div className="text-2xl font-bold text-gray-900">Lv.12</div>
                  <div className="text-xs text-gray-500">当前等级</div>
              </div>
          </div>
      </div>

      {/* Action Banner */}
      <div className="px-8 pb-12">
          <div className="bg-gray-900 rounded-2xl p-8 text-white flex justify-between items-center relative overflow-hidden shadow-xl">
              <div className="relative z-10">
                  <h2 className="text-2xl font-bold mb-2">准备好迎接新的挑战了吗？</h2>
                  <p className="text-gray-400 mb-6 max-w-lg">通过模拟训练或真实复盘，不断打磨你的商业直觉与沟通技巧。</p>
                  <div className="flex gap-4">
                      <button 
                        onClick={() => handleStartTraining("random_challenge")} // Random Mode
                        disabled={loading}
                        className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 rounded-xl font-bold transition-colors flex items-center"
                      >
                          {loading ? (
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                          ) : (
                            <Play className="w-4 h-4 mr-2" /> 
                          )}
                          随机挑战
                      </button>
                      <Link to="/real-review" className="px-6 py-3 bg-white/10 hover:bg-white/20 rounded-xl font-bold transition-colors flex items-center backdrop-blur-sm">
                          <TrendingUp className="w-4 h-4 mr-2" /> 真实场景复盘
                      </Link>
                  </div>
              </div>
              {/* Decorative Circle */}
              <div className="absolute -right-20 -bottom-40 w-96 h-96 bg-indigo-600/20 rounded-full blur-3xl"></div>
              <div className="absolute right-40 -top-20 w-72 h-72 bg-purple-600/20 rounded-full blur-3xl"></div>
          </div>
      </div>
      
      {/* Specific Training Modules */}
      <div className="px-8 pb-8">
        <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center">
          <Play className="w-5 h-5 mr-2 text-indigo-600" /> 商业认知模块 (机会发现)
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <button onClick={() => handleStartTraining("痛点洞察")} disabled={loading} className="p-6 bg-white border border-gray-200 rounded-xl hover:shadow-md hover:border-indigo-500 transition-all text-left group relative overflow-hidden">
            <div className="absolute top-0 right-0 w-16 h-16 bg-indigo-50 rounded-bl-full -mr-8 -mt-8 opacity-50 transition-transform group-hover:scale-110"></div>
            <div className="font-semibold text-gray-800 group-hover:text-indigo-600 mb-1 relative z-10 flex items-center"><Target className="w-4 h-4 mr-2 text-indigo-400" /> 痛点洞察</div>
            <div className="text-sm text-gray-500 relative z-10">你在食堂听到抱怨，如何判断这是否是商业机会？</div>
          </button>
          <button onClick={() => handleStartTraining("需求验证")} disabled={loading} className="p-6 bg-white border border-gray-200 rounded-xl hover:shadow-md hover:border-indigo-500 transition-all text-left group relative overflow-hidden">
            <div className="absolute top-0 right-0 w-16 h-16 bg-indigo-50 rounded-bl-full -mr-8 -mt-8 opacity-50 transition-transform group-hover:scale-110"></div>
            <div className="font-semibold text-gray-800 group-hover:text-indigo-600 mb-1 relative z-10 flex items-center"><Shield className="w-4 h-4 mr-2 text-indigo-400" /> 需求验证</div>
            <div className="text-sm text-gray-500 relative z-10">只有一个模糊想法，如何通过访谈验证真实需求？</div>
          </button>
          <button onClick={() => handleStartTraining("资源整合")} disabled={loading} className="p-6 bg-white border border-gray-200 rounded-xl hover:shadow-md hover:border-indigo-500 transition-all text-left group relative overflow-hidden">
            <div className="absolute top-0 right-0 w-16 h-16 bg-indigo-50 rounded-bl-full -mr-8 -mt-8 opacity-50 transition-transform group-hover:scale-110"></div>
            <div className="font-semibold text-gray-800 group-hover:text-indigo-600 mb-1 relative z-10 flex items-center"><Gem className="w-4 h-4 mr-2 text-indigo-400" /> 资源整合</div>
            <div className="text-sm text-gray-500 relative z-10">想做小项目但没钱，如何利用学校免费资源启动？</div>
          </button>
        </div>

        <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center">
          <Users className="w-5 h-5 mr-2 text-purple-600" /> 识人能力模块 (全阶层人际)
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <button onClick={() => handleStartTraining("向上社交")} disabled={loading} className="p-6 bg-white border border-gray-200 rounded-xl hover:shadow-md hover:border-purple-500 transition-all text-left group relative overflow-hidden">
            <div className="absolute top-0 right-0 w-16 h-16 bg-purple-50 rounded-bl-full -mr-8 -mt-8 opacity-50 transition-transform group-hover:scale-110"></div>
            <div className="font-semibold text-gray-800 group-hover:text-purple-600 mb-1 relative z-10 flex items-center"><Crown className="w-4 h-4 mr-2 text-purple-400" /> 向上社交</div>
            <div className="text-sm text-gray-500 relative z-10">在学术会议茶歇偶遇大佬，如何优雅破冰？</div>
          </button>
          <button onClick={() => handleStartTraining("平级链接")} disabled={loading} className="p-6 bg-white border border-gray-200 rounded-xl hover:shadow-md hover:border-purple-500 transition-all text-left group relative overflow-hidden">
            <div className="absolute top-0 right-0 w-16 h-16 bg-purple-50 rounded-bl-full -mr-8 -mt-8 opacity-50 transition-transform group-hover:scale-110"></div>
            <div className="font-semibold text-gray-800 group-hover:text-purple-600 mb-1 relative z-10 flex items-center"><Users className="w-4 h-4 mr-2 text-purple-400" /> 平级链接</div>
            <div className="text-sm text-gray-500 relative z-10">识别潜力同学，说服他和你一起搞事情。</div>
          </button>
          <button onClick={() => handleStartTraining("向下兼容")} disabled={loading} className="p-6 bg-white border border-gray-200 rounded-xl hover:shadow-md hover:border-purple-500 transition-all text-left group relative overflow-hidden">
            <div className="absolute top-0 right-0 w-16 h-16 bg-purple-50 rounded-bl-full -mr-8 -mt-8 opacity-50 transition-transform group-hover:scale-110"></div>
            <div className="font-semibold text-gray-800 group-hover:text-purple-600 mb-1 relative z-10 flex items-center"><Zap className="w-4 h-4 mr-2 text-purple-400" /> 向下兼容</div>
            <div className="text-sm text-gray-500 relative z-10">与快递员或路人聊天，锻炼快速获取信息能力。</div>
          </button>
        </div>

        <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center">
          <Award className="w-5 h-5 mr-2 text-orange-600" /> 个人品牌模块 (资源整合IP)
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <button onClick={() => handleStartTraining("标签定位")} disabled={loading} className="p-6 bg-white border border-gray-200 rounded-xl hover:shadow-md hover:border-orange-500 transition-all text-left group relative overflow-hidden">
            <div className="absolute top-0 right-0 w-16 h-16 bg-orange-50 rounded-bl-full -mr-8 -mt-8 opacity-50 transition-transform group-hover:scale-110"></div>
            <div className="font-semibold text-gray-800 group-hover:text-orange-600 mb-1 relative z-10 flex items-center"><Target className="w-4 h-4 mr-2 text-orange-400" /> 标签定位</div>
            <div className="text-sm text-gray-500 relative z-10">三句话介绍自己，让人记住你的独特价值。</div>
          </button>
          <button onClick={() => handleStartTraining("内容输出")} disabled={loading} className="p-6 bg-white border border-gray-200 rounded-xl hover:shadow-md hover:border-orange-500 transition-all text-left group relative overflow-hidden">
            <div className="absolute top-0 right-0 w-16 h-16 bg-orange-50 rounded-bl-full -mr-8 -mt-8 opacity-50 transition-transform group-hover:scale-110"></div>
            <div className="font-semibold text-gray-800 group-hover:text-orange-600 mb-1 relative z-10 flex items-center"><BookOpen className="w-4 h-4 mr-2 text-orange-400" /> 内容输出</div>
            <div className="text-sm text-gray-500 relative z-10">将枯燥的理论研究转化为大众爱看的内容。</div>
          </button>
          <button onClick={() => handleStartTraining("价值交换")} disabled={loading} className="p-6 bg-white border border-gray-200 rounded-xl hover:shadow-md hover:border-orange-500 transition-all text-left group relative overflow-hidden">
            <div className="absolute top-0 right-0 w-16 h-16 bg-orange-50 rounded-bl-full -mr-8 -mt-8 opacity-50 transition-transform group-hover:scale-110"></div>
            <div className="font-semibold text-gray-800 group-hover:text-orange-600 mb-1 relative z-10 flex items-center"><Gem className="w-4 h-4 mr-2 text-orange-400" /> 价值交换</div>
            <div className="text-sm text-gray-500 relative z-10">无实权情况下，如何提供情绪或信息价值？</div>
          </button>
        </div>
      </div>
      
      {/* Evolution Tree Summary */}
      <div className="px-8 pb-8">
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-bold text-gray-900 flex items-center">
              <TreeDeciduous className="w-5 h-5 mr-2 text-green-600" /> 
              能力进化树
            </h3>
            <Link to="/evolution-tree" className="text-sm font-medium text-primary hover:text-indigo-700 flex items-center">
              查看完整进化树 <ArrowRight className="w-4 h-4 ml-1" />
            </Link>
          </div>
          {/* We can show a simple progress bar or summary here */}
          <div className="flex items-center space-x-4 text-sm text-gray-600">
             <span>当前阶段: <strong>探索者</strong></span>
             <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden max-w-xs">
                 <div className="h-full bg-green-500 w-[45%]"></div>
             </div>
             <span>进度: 45%</span>
          </div>
        </div>
      </div>
      
      {/* History Section */}
      <div className="px-8 pb-8">
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center">
            <History className="w-5 h-5 mr-2" /> 最近训练记录
          </h3>
          {recentScenes.length === 0 ? (
            <div className="text-gray-500 text-center py-8">
              暂无记录。点击上方按钮开始你的第一次实战训练吧！
            </div>
          ) : (
            <div className="space-y-3">
              {recentScenes.map((scene, idx) => (
                <div key={idx} className="flex justify-between items-center p-3 hover:bg-gray-50 rounded-lg border border-transparent hover:border-gray-100 transition-colors">
                  <div>
                    <div className="font-medium text-gray-800">{scene.scene_type}</div>
                    <div className="text-xs text-gray-500">{new Date(scene.created_at).toLocaleString('zh-CN')}</div>
                  </div>
                  <div className={`px-2 py-1 rounded text-xs font-medium ${scene.final_result?.success ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                    {scene.final_result?.success ? '成功' : '已完成'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

    </div>
  );
}