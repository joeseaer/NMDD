import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Lock, CheckCircle, BookOpen, Target, Users, Zap, Award, MessageSquare, Tag, Brain, Search, PenTool, Coins, Network, Shield, RefreshCw, CheckCircle2, Megaphone, Eye, Globe, Crown, Gem, Library } from 'lucide-react';
import { api } from '../services/api';

export default function EvolutionTree() {
  const [selectedNode, setSelectedNode] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);

  useEffect(() => {
      api.getUserStats().then(setStats).catch(console.error);
  }, []);

  // Helper to check status
  const getNodeStatus = (reqType: string, reqCount: number, unlockedByTier: boolean) => {
      if (!unlockedByTier) return 'locked';
      if (!stats) return 'locked'; // Loading

      let current = 0;
      if (reqType === 'training') current = stats.reviewCounts.total;
      else if (reqType === 'people') current = stats.peopleCount;
      else if (reqType === 'sop') current = stats.sopCount;
      // Specific types
      else if (reqType === 'negotiation') current = stats.reviewCounts.negotiation;
      else if (reqType === 'social') current = stats.reviewCounts.social;
      
      if (current >= reqCount) return 'completed';
      if (current > 0) return 'in_progress';
      return 'pending'; // Unlocked but not started
  };

  const getProgress = (reqType: string, reqCount: number) => {
      if (!stats) return 0;
      let current = 0;
      if (reqType === 'training') current = stats.reviewCounts.total;
      else if (reqType === 'people') current = stats.peopleCount;
      else if (reqType === 'sop') current = stats.sopCount;
      
      return Math.min(100, Math.round((current / reqCount) * 100));
  };

  // Tier 1 is always unlocked. Tier 2 unlocks if Tier 1 completed (simplified logic for now: unlocked by default or level)
  // Let's assume all unlocked for visibility, but status depends on data.
  
  const tiers = [
    {
      id: 1,
      name: "第一阶 · 觉醒者",
      levelRange: "Lv.1-10",
      status: "completed", // Should calculate based on nodes
      nodes: [
        { id: '1-1', name: "痛点洞察", category: "商业认知", 
          status: getNodeStatus('training', 1, true), 
          progress: getProgress('training', 1), 
          icon: <Target className="w-5 h-5" />, desc: "能够从日常生活中发现商业痛点", req: "完成1次训练" },
        { id: '1-2', name: "基础话术", category: "识人能力", 
          status: getNodeStatus('social', 1, true), 
          progress: getProgress('social', 1), 
          icon: <MessageSquare className="w-5 h-5" />, desc: "掌握基本的破冰和沟通话术", req: "完成1次社交训练" },
        { id: '1-3', name: "自我定位", category: "个人品牌", 
          status: getNodeStatus('training', 3, true), 
          progress: getProgress('training', 3), 
          icon: <Tag className="w-5 h-5" />, desc: "能够清晰定义自己的个人标签", req: "完成3次训练" },
        { id: '1-4', name: "性格认知", category: "性格分析", 
          status: getNodeStatus('people', 1, true), 
          progress: getProgress('people', 1), 
          icon: <Brain className="w-5 h-5" />, desc: "了解基础的性格分析框架", req: "记录1人档案" },
      ]
    },
    {
      id: 2,
      name: "第二阶 · 探索者",
      levelRange: "Lv.11-20",
      status: "in_progress",
      nodes: [
        { id: '2-1', name: "需求验证", category: "商业认知", 
          status: getNodeStatus('training', 5, true), 
          progress: getProgress('training', 5), 
          icon: <Search className="w-5 h-5" />, desc: "能够通过有效访谈和验证，判断一个模糊想法是否值得投入。", req: "完成5次训练" },
        { id: '2-2', name: "破冰沟通", category: "识人能力", 
          status: getNodeStatus('social', 3, true), 
          progress: getProgress('social', 3), 
          icon: <Users className="w-5 h-5" />, desc: "能够快速与陌生人建立联系", req: "完成3次社交训练" },
        { id: '2-3', name: "内容输出", category: "个人品牌", 
          status: getNodeStatus('sop', 1, true), 
          progress: getProgress('sop', 1), 
          icon: <PenTool className="w-5 h-5" />, desc: "能够持续输出有价值的内容", req: "创建1个SOP" },
        { id: '2-4', name: "SOP建立", category: "方法论", 
          status: getNodeStatus('sop', 3, true), 
          progress: getProgress('sop', 3), 
          icon: <BookOpen className="w-5 h-5" />, desc: "能够建立自己的方法论体系", req: "创建3个SOP" },
      ]
    },
    {
      id: 3,
      name: "第三阶 · 连接者",
      levelRange: "Lv.21-30",
      status: "locked",
      nodes: [
        { id: '3-1', name: "资源撬动", category: "商业认知", status: "locked", progress: 0, icon: <Coins className="w-5 h-5" />, desc: "在资源匮乏时撬动杠杆", req: "完成15次训练" },
        { id: '3-2', name: "人脉拓展", category: "识人能力", status: "locked", progress: 0, icon: <Network className="w-5 h-5" />, desc: "建立高质量人脉网络", req: "完成15次训练" },
        { id: '3-3', name: "信任建立", category: "个人品牌", status: "locked", progress: 0, icon: <Shield className="w-5 h-5" />, desc: "快速建立专业信任感", req: "完成15次训练" },
        { id: '3-4', name: "迭代优化", category: "方法论", status: "locked", progress: 0, icon: <RefreshCw className="w-5 h-5" />, desc: "持续优化SOP体系", req: "SOP迭代10次" },
      ]
    },
    // ... Tiers 4 and 5 remain locked for MVP
    {
      id: 4,
      name: "第四阶 · 影响者",
      levelRange: "Lv.31-40",
      status: "locked",
      nodes: [
        { id: '4-1', name: "机会闭环", category: "商业认知", status: "locked", progress: 0, icon: <CheckCircle2 className="w-5 h-5" />, desc: "实现商业闭环", req: "完成20次训练" },
        { id: '4-2', name: "高维对话", category: "识人能力", status: "locked", progress: 0, icon: <Zap className="w-5 h-5" />, desc: "与高认知人群同频对话", req: "完成20次训练" },
        { id: '4-3', name: "个人IP", category: "个人品牌", status: "locked", progress: 0, icon: <Megaphone className="w-5 h-5" />, desc: "形成独特的个人IP", req: "完成20次训练" },
        { id: '4-4', name: "性格洞察", category: "性格分析", status: "locked", progress: 0, icon: <Eye className="w-5 h-5" />, desc: "一眼看穿他人性格本质", req: "记录20人档案" },
      ]
    },
    {
      id: 5,
      name: "第五阶 · 整合者",
      levelRange: "Lv.41-50",
      status: "locked",
      nodes: [
        { id: '5-1', name: "生态构建", category: "商业认知", status: "locked", progress: 0, icon: <Globe className="w-5 h-5" />, desc: "构建商业生态系统", req: "完成30次训练" },
        { id: '5-2', name: "贵人网络", category: "识人能力", status: "locked", progress: 0, icon: <Crown className="w-5 h-5" />, desc: "运营顶层贵人网络", req: "完成30次训练" },
        { id: '5-3', name: "影响力变现", category: "个人品牌", status: "locked", progress: 0, icon: <Gem className="w-5 h-5" />, desc: "将影响力转化为商业价值", req: "完成30次训练" },
        { id: '5-4', name: "体系输出", category: "方法论", status: "locked", progress: 0, icon: <Library className="w-5 h-5" />, desc: "输出完整的商业思想体系", req: "输出完整体系" },
      ]
    }
  ];

  // Helper icons import
  // Note: Some icons might need to be imported from lucide-react. 
  // I'll add the imports at the top.
  
  return (
    <div className="flex flex-col h-full bg-gray-50 overflow-hidden relative">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center z-10 shadow-sm">
        <div className="flex items-center">
          <Link to="/" className="mr-4 p-2 hover:bg-gray-100 rounded-full transition-colors">
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-gray-900">能力进化树</h1>
            <p className="text-xs text-gray-500">当前等级: Lv.12 (探索者)</p>
          </div>
        </div>
        <div className="flex items-center space-x-2">
           <div className="flex items-center text-xs text-gray-500 mr-4">
             <span className="w-2 h-2 rounded-full bg-green-500 mr-1"></span> 已完成
             <span className="w-2 h-2 rounded-full bg-yellow-500 mx-2"></span> 进行中
             <span className="w-2 h-2 rounded-full bg-gray-300 mx-2"></span> 未解锁
           </div>
           <div className="bg-indigo-50 text-indigo-700 px-3 py-1 rounded-full text-sm font-bold flex items-center">
             <Award className="w-4 h-4 mr-1" />
             终极目标: 资源整合型创业者
           </div>
        </div>
      </div>

      {/* Tree Visualization */}
      <div className="flex-1 overflow-y-auto p-8 relative">
        {/* Central Trunk Line */}
        <div className="absolute left-1/2 top-0 bottom-0 w-1 bg-gray-200 -ml-0.5 z-0"></div>

        <div className="max-w-4xl mx-auto space-y-16 relative z-10 pb-20">
          {tiers.slice().reverse().map((tier) => (
            <div key={tier.id} className="relative">
              {/* Tier Label */}
              <div className="flex justify-center mb-6">
                <div className={`
                  px-6 py-2 rounded-full border-2 font-bold text-sm bg-white shadow-sm z-10
                  ${tier.status === 'completed' ? 'border-green-500 text-green-700' : 
                    tier.status === 'in_progress' ? 'border-yellow-500 text-yellow-700' : 
                    'border-gray-200 text-gray-400'}
                `}>
                  {tier.name} <span className="text-xs font-normal opacity-80 ml-1">({tier.levelRange})</span>
                  {tier.status === 'locked' && <Lock className="w-3 h-3 inline ml-1 mb-0.5" />}
                </div>
              </div>

              {/* Nodes Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {tier.nodes.map((node) => (
                  <div 
                    key={node.id}
                    onClick={() => setSelectedNode(node)}
                    className={`
                      relative bg-white rounded-xl p-4 border-2 cursor-pointer transition-all hover:scale-105 hover:shadow-md
                      flex flex-col items-center text-center group
                      ${node.status === 'completed' ? 'border-green-500 shadow-green-100' : 
                        node.status === 'in_progress' ? 'border-yellow-500 shadow-yellow-100' : 
                        'border-gray-200 opacity-70 hover:opacity-100'}
                    `}
                  >
                    {/* Connection Line to Center (Visual only, simplified) */}
                    
                    <div className={`
                      w-10 h-10 rounded-full flex items-center justify-center mb-3 text-white shadow-sm
                      ${node.status === 'completed' ? 'bg-green-500' : 
                        node.status === 'in_progress' ? 'bg-yellow-500' : 
                        'bg-gray-300'}
                    `}>
                      {node.icon}
                    </div>
                    
                    <h3 className={`font-bold text-sm mb-1 ${node.status === 'locked' ? 'text-gray-400' : 'text-gray-800'}`}>
                      {node.name}
                    </h3>
                    
                    <span className="text-[10px] text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full mb-2">
                      {node.category}
                    </span>

                    {/* Progress Bar for In Progress */}
                    {node.status === 'in_progress' && (
                      <div className="w-full bg-gray-100 h-1.5 rounded-full mt-2 overflow-hidden">
                        <div className="bg-yellow-500 h-full rounded-full" style={{ width: `${node.progress}%` }}></div>
                      </div>
                    )}
                    
                    {node.status === 'completed' && <CheckCircle className="w-4 h-4 text-green-500 absolute top-2 right-2" />}
                    {node.status === 'locked' && <Lock className="w-3 h-3 text-gray-400 absolute top-2 right-2" />}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Node Detail Modal */}
      {selectedNode && (
        <div className="absolute inset-0 z-50 bg-black/50 flex items-center justify-center p-4 backdrop-blur-sm" onClick={() => setSelectedNode(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-4">
              <div className="flex items-center">
                <div className={`
                  w-10 h-10 rounded-full flex items-center justify-center mr-3 text-white
                  ${selectedNode.status === 'completed' ? 'bg-green-500' : 
                    selectedNode.status === 'in_progress' ? 'bg-yellow-500' : 
                    'bg-gray-300'}
                `}>
                  {selectedNode.icon}
                </div>
                <div>
                  <h2 className="text-xl font-bold text-gray-900">{selectedNode.name}</h2>
                  <span className="text-xs text-gray-500">{selectedNode.category}</span>
                </div>
              </div>
              <button onClick={() => setSelectedNode(null)} className="text-gray-400 hover:text-gray-600">×</button>
            </div>
            
            <div className="space-y-4">
              <div className="bg-gray-50 p-3 rounded-lg text-sm text-gray-700">
                {selectedNode.desc}
              </div>

              <div>
                <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">解锁/完成条件</h4>
                <div className="flex items-center text-sm">
                  {selectedNode.status === 'completed' ? (
                    <CheckCircle className="w-4 h-4 text-green-500 mr-2" />
                  ) : (
                    <Target className="w-4 h-4 text-gray-400 mr-2" />
                  )}
                  <span className={selectedNode.status === 'completed' ? 'text-gray-900 line-through opacity-50' : 'text-gray-900'}>
                    {selectedNode.req}
                  </span>
                </div>
              </div>

              <div>
                <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">当前进度</h4>
                <div className="w-full bg-gray-100 h-2 rounded-full overflow-hidden">
                  <div 
                    className={`h-full rounded-full ${selectedNode.status === 'completed' ? 'bg-green-500' : 'bg-yellow-500'}`} 
                    style={{ width: `${selectedNode.progress}%` }}
                  ></div>
                </div>
                <div className="text-right text-xs text-gray-500 mt-1">{selectedNode.progress}%</div>
              </div>

              <div className="pt-4 flex gap-3">
                <button 
                  onClick={() => setSelectedNode(null)}
                  className="flex-1 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 text-sm font-medium"
                >
                  关闭
                </button>
                <button 
                  disabled={selectedNode.status === 'locked'}
                  className="flex-1 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {selectedNode.status === 'completed' ? '再次训练' : '开始相关训练'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
