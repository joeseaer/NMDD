import React, { useState, useEffect } from 'react'
import { Routes, Route, Link, useLocation } from 'react-router-dom'
import { Brain, MessageSquare, User, Settings, LayoutDashboard, BookOpen, Users, FileText, Menu, X, Notebook } from 'lucide-react'

// Pages
import Dashboard from './pages/Dashboard'
import Training from './pages/Training'
import Review from './pages/Review'
import SOPManager from './pages/SOPManager'
import NoteManager from './pages/NoteManager'
import PersonalityManager from './pages/PersonalityManager'
import RealReview from './pages/RealReview'
import ChatAssistant from './pages/ChatAssistant'
import EvolutionTree from './pages/EvolutionTree'
import SettingsPage from './pages/Settings'

function App() {
  const location = useLocation();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    if (location.pathname.includes('/training') || location.pathname.includes('/evolution-tree')) setActiveTab('dashboard');
    else if (location.pathname.includes('/sop')) setActiveTab('sop');
    else if (location.pathname.includes('/notes')) setActiveTab('notes');
    else if (location.pathname.includes('/personality')) setActiveTab('personality');
    else if (location.pathname.includes('/real-review')) setActiveTab('real-review');
    else if (location.pathname.includes('/assistant')) setActiveTab('assistant');
    else setActiveTab('dashboard');
    
    // Close mobile menu on route change
    setIsMobileMenuOpen(false);
  }, [location]);

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
        fixed md:static inset-y-0 left-0 z-50 w-64 bg-white border-r border-gray-200 flex flex-col transition-transform duration-300 ease-in-out
        ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
      `}>
        <div className="p-6 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="bg-primary/10 p-2 rounded-lg">
              <Brain className="h-6 w-6 text-primary" />
            </div>
            <h1 className="text-lg font-bold text-gray-900">牛马大队无限公司</h1>
          </div>
          <button onClick={() => setIsMobileMenuOpen(false)} className="md:hidden text-gray-500">
            <X className="w-6 h-6" />
          </button>
        </div>
        
        <nav className="flex-1 p-4 space-y-6 overflow-y-auto">
          <div>
            <h3 className="px-3 text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">训练中心</h3>
            <SidebarLink to="/" icon={<LayoutDashboard size={20} />} label="训练仪表盘" active={activeTab === 'dashboard'} />
          </div>

          <div>
            <h3 className="px-3 text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">记录中心</h3>
            <SidebarLink to="/sop" icon={<BookOpen size={20} />} label="SOP 方法论库" active={activeTab === 'sop'} />
            <SidebarLink to="/notes" icon={<Notebook size={20} />} label="随笔/文档" active={activeTab === 'notes'} />
            <SidebarLink to="/personality" icon={<Users size={20} />} label="性格分析档案" active={activeTab === 'personality'} />
            <SidebarLink to="/real-review" icon={<FileText size={20} />} label="真实场景复盘" active={activeTab === 'real-review'} />
          </div>

          <div>
             <h3 className="px-3 text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">助手</h3>
             <SidebarLink to="/assistant" icon={<MessageSquare size={20} />} label="AI 聊天助手" active={activeTab === 'assistant'} />
          </div>
          
          <div className="pt-4 mt-4 border-t border-gray-100">
            <h3 className="px-3 text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">个人中心</h3>
            <SidebarLink to="/evolution-tree" icon={<User size={20} />} label="我的档案" />
            <SidebarLink to="/settings" icon={<Settings size={20} />} label="系统设置" />
          </div>
        </nav>
        
        <div className="p-4 border-t border-gray-200">
          <div className="flex items-center space-x-3">
            <div className="h-8 w-8 rounded-full bg-gray-200 flex items-center justify-center text-xs font-bold text-gray-600">
              U
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900">User_001</p>
              <p className="text-xs text-gray-500">Lv.12 创业学徒</p>
            </div>
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
              <span className="font-bold">创业模拟</span>
            </div>
          </div>
          <Link to="/settings" className="p-2 rounded-md text-gray-400 hover:text-gray-500">
            <Settings size={20} />
          </Link>
        </header>

        <div className="flex-1 overflow-auto p-2 sm:p-4 lg:p-8 w-full">
          <div className="max-w-7xl mx-auto h-full">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/training/:sceneId" element={<Training />} />
              <Route path="/review/:sceneId" element={<Review />} />
              <Route path="/sop" element={<SOPManager />} />
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
    </div>
  )
}

function SidebarLink({ to, icon, label, active = false }: { to: string; icon: React.ReactNode; label: string; active?: boolean }) {
  return (
    <Link
      to={to}
      className={`
        flex items-center px-3 py-2.5 rounded-lg text-sm font-medium transition-colors
        ${active 
          ? 'bg-primary/5 text-primary' 
          : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'}
      `}
    >
      <span className={`${active ? 'text-primary' : 'text-gray-400 group-hover:text-gray-500'} mr-3`}>
        {icon}
      </span>
      {label}
    </Link>
  )
}

export default App
