import React, { useState, useEffect } from 'react'
import { Routes, Route, Link, Navigate, useLocation } from 'react-router-dom'
import { Brain, MessageSquare, User, Settings, LayoutDashboard, Users, FileText, Menu, X, Notebook, ChevronLeft, ChevronRight, Calendar } from 'lucide-react'

// Pages
import Dashboard from './pages/Dashboard'
import Training from './pages/Training'
import Review from './pages/Review'
import NoteManager from './pages/NoteManager'
import PersonalityManager from './pages/PersonalityManager'
import RealReview from './pages/RealReview'
import ChatAssistant from './pages/ChatAssistant'
import EvolutionTree from './pages/EvolutionTree'
import SettingsPage from './pages/Settings'
import Planner from './pages/Planner'
import FloatingAssistant from './components/FloatingAssistant'

function App() {
  const location = useLocation();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem('sidebar_collapsed') === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (location.pathname.includes('/training') || location.pathname.includes('/evolution-tree')) setActiveTab('dashboard');
    else if (location.pathname.includes('/planner')) setActiveTab('planner');
    else if (location.pathname.includes('/dashboard')) setActiveTab('dashboard');
    else if (location.pathname.includes('/notes')) setActiveTab('notes');
    else if (location.pathname.includes('/personality')) setActiveTab('personality');
    else if (location.pathname.includes('/real-review')) setActiveTab('real-review');
    else if (location.pathname.includes('/assistant')) setActiveTab('assistant');
    else setActiveTab('dashboard');
    
    // Close mobile menu on route change
    setIsMobileMenuOpen(false);
  }, [location]);

  useEffect(() => {
    try {
      localStorage.setItem('sidebar_collapsed', String(isSidebarCollapsed));
    } catch {}
  }, [isSidebarCollapsed]);

  useEffect(() => {
    // Auto Backup Check
    const storedAuto = localStorage.getItem('auto_backup_enabled');
    if (storedAuto === 'true') {
        const last = localStorage.getItem('last_backup_timestamp');
        const THREE_DAYS = 3 * 24 * 60 * 60 * 1000;
        
        if (!last || (Date.now() - parseInt(last) > THREE_DAYS)) {
            // Trigger auto-download
            console.log('Auto-backup triggered');
            const link = document.createElement('a');
            link.href = '/api/backup/export?userId=user-1';
            link.download = `auto-backup-${Date.now()}.json`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            // Update timestamp
            localStorage.setItem('last_backup_timestamp', String(Date.now()));
        }
    }
  }, []);

  const defaultHome = (import.meta as any).env?.VITE_DEFAULT_HOME || 'planner';
  const Home = () => {
    if (defaultHome === 'planner') return <Navigate to="/planner" replace />;
    return <Dashboard />;
  };

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden font-sans text-gray-900">
      
      {/* Mobile Menu Overlay */}
      {isMobileMenuOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar Navigation */}
      <aside className={`
        fixed md:static inset-y-0 left-0 z-50 bg-white border-r border-gray-200 flex flex-col transition-all duration-300 ease-in-out
        w-64 ${isSidebarCollapsed ? 'md:w-20' : 'md:w-64'}
        ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
      `}>
        <div className="p-6 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="bg-primary/10 p-2 rounded-lg">
              <Brain className="h-6 w-6 text-primary" />
            </div>
            {!isSidebarCollapsed && <h1 className="text-lg font-bold text-gray-900">牛马大队无限公司</h1>}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsSidebarCollapsed(v => !v)}
              className="hidden md:flex p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-50"
              title={isSidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
            >
              {isSidebarCollapsed ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
            </button>
            <button onClick={() => setIsMobileMenuOpen(false)} className="md:hidden text-gray-500">
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>
        
        <nav className={`flex-1 overflow-y-auto ${isSidebarCollapsed ? 'p-2 space-y-4' : 'p-4 space-y-6'}`}>
          <div>
            {!isSidebarCollapsed && <h3 className="px-3 text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">训练中心</h3>}
            <SidebarLink collapsed={isSidebarCollapsed} to="/dashboard" icon={<LayoutDashboard size={20} />} label="训练仪表盘" active={activeTab === 'dashboard'} />
          </div>

          <div>
            {!isSidebarCollapsed && <h3 className="px-3 text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">记录中心</h3>}
            <SidebarLink collapsed={isSidebarCollapsed} to="/planner" icon={<Calendar size={20} />} label="日程待办" active={activeTab === 'planner'} />
            <SidebarLink collapsed={isSidebarCollapsed} to="/notes?view=notes" icon={<Notebook size={20} />} label="随笔/文档" active={activeTab === 'notes'} />
            <SidebarLink collapsed={isSidebarCollapsed} to="/personality" icon={<Users size={20} />} label="性格分析档案" active={activeTab === 'personality'} />
            <SidebarLink collapsed={isSidebarCollapsed} to="/real-review" icon={<FileText size={20} />} label="真实场景复盘" active={activeTab === 'real-review'} />
          </div>

          <div>
             {!isSidebarCollapsed && <h3 className="px-3 text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">助手</h3>}
             <SidebarLink collapsed={isSidebarCollapsed} to="/assistant" icon={<MessageSquare size={20} />} label="AI 聊天助手" active={activeTab === 'assistant'} />
          </div>
          
          <div className="pt-4 mt-4 border-t border-gray-100">
            {!isSidebarCollapsed && <h3 className="px-3 text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">个人中心</h3>}
            <SidebarLink collapsed={isSidebarCollapsed} to="/evolution-tree" icon={<User size={20} />} label="我的档案" />
            <SidebarLink collapsed={isSidebarCollapsed} to="/settings" icon={<Settings size={20} />} label="系统设置" />
          </div>
        </nav>
        
        <div className="p-4 border-t border-gray-200">
          <div className={`flex items-center ${isSidebarCollapsed ? 'justify-center' : 'space-x-3'}`}>
            <div className="h-8 w-8 rounded-full bg-gray-200 flex items-center justify-center text-xs font-bold text-gray-600">
              U
            </div>
            {!isSidebarCollapsed && (
              <div>
                <p className="text-sm font-medium text-gray-900">User_001</p>
                <p className="text-xs text-gray-500">Lv.12 创业学徒</p>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden bg-gray-50 w-full">
        <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-4 md:hidden shrink-0">
          <div className="flex items-center space-x-3">
            <button 
              onClick={() => setIsMobileMenuOpen(true)}
              className="p-1 text-gray-500 hover:text-gray-700"
            >
              <Menu className="w-6 h-6" />
            </button>
            <div className="flex items-center space-x-2">
              <Brain className="h-6 w-6 text-primary" />
              <span className="font-bold">牛马大队无限公司</span>
            </div>
          </div>
          <Link to="/settings" className="p-2 rounded-md text-gray-400 hover:text-gray-500">
            <Settings size={20} />
          </Link>
        </header>

        <div className="flex-1 overflow-auto p-2 sm:p-4 lg:p-8 w-full">
          <div className="max-w-7xl mx-auto h-full">
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/training/:sceneId" element={<Training />} />
              <Route path="/review/:sceneId" element={<Review />} />
              <Route path="/planner" element={<Planner />} />
              <Route path="/sop" element={<Navigate to="/notes?view=sop" replace />} />
              <Route path="/notes" element={<NoteManager />} />
              <Route path="/personality" element={<PersonalityManager />} />
              <Route path="/real-review" element={<RealReview />} />
              <Route path="/evolution-tree" element={<EvolutionTree />} />
              <Route path="/assistant" element={<ChatAssistant />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Routes>
          </div>
        </div>
      </main>

      <FloatingAssistant />
    </div>
  )
}

function SidebarLink({ to, icon, label, active = false, collapsed = false }: { to: string; icon: React.ReactNode; label: string; active?: boolean; collapsed?: boolean }) {
  return (
    <Link
      to={to}
      title={collapsed ? label : undefined}
      className={`
        group flex items-center rounded-lg text-sm font-medium transition-colors
        ${collapsed ? 'w-11 h-11 justify-center mx-auto' : 'px-3 py-2.5'}
        ${active 
          ? 'bg-primary/5 text-primary' 
          : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'}
      `}
    >
      <span className={`${active ? 'text-primary' : 'text-gray-400 group-hover:text-gray-500'} ${collapsed ? '' : 'mr-3'}`}>
        {icon}
      </span>
      {collapsed ? <span className="sr-only">{label}</span> : label}
    </Link>
  )
}

export default App
