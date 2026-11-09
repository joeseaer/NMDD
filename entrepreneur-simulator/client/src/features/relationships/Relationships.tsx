import { lazy, Suspense, useRef, useState } from 'react';
import { CalendarCheck2, Compass, Lightbulb, MessageSquarePlus, TrendingUp, Users } from 'lucide-react';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { cn, LoadingState } from './RelationshipUi';
import { QuickCaptureSheet } from './QuickCaptureSheet';
import { useIntentPreload } from '../../routes/useIntentPreload';

const loaders = {
  today: () => import('./TodayPage'),
  people: () => import('./PeoplePage'),
  opportunities: () => import('./OpportunitiesPage'),
  review: () => import('./WeeklyReviewPage'),
  growth: () => import('./GrowthPage'),
  legacy: () => import('./LegacyArchivePage'),
};
const TodayPage = lazy(loaders.today);
const PeoplePage = lazy(loaders.people);
const OpportunitiesPage = lazy(loaders.opportunities);
const WeeklyReviewPage = lazy(loaders.review);
const GrowthPage = lazy(loaders.growth);
const LegacyArchivePage = lazy(loaders.legacy);

const NAV_ITEMS = [
  { to: '/relationships/today', label: '罗盘', icon: Compass },
  { to: '/relationships/people', label: '人物', icon: Users },
  { to: '/relationships/opportunities', label: '机会', icon: Lightbulb },
  { to: '/relationships/review', label: '周复盘', icon: CalendarCheck2 },
  { to: '/relationships/growth', label: '处世成长', icon: TrendingUp },
];

export default function Relationships() {
  const location = useLocation();
  const [captureOpen, setCaptureOpen] = useState(false);
  const hoveredSection = useRef<keyof typeof loaders | null>(null);
  const preloadEvents = useIntentPreload(() => {
    const section = hoveredSection.current;
    return section ? loaders[section]?.() : undefined;
  });
  const splitWorkspace = location.pathname.startsWith('/relationships/people')
    || location.pathname.startsWith('/relationships/opportunities')
    || location.pathname.startsWith('/relationships/legacy');

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      <nav className="z-30 flex h-14 shrink-0 items-center gap-1 overflow-x-auto border-b border-gray-200 bg-white px-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:px-4" aria-label="关系与机会导航">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              {...preloadEvents}
              onMouseEnter={() => {
                hoveredSection.current = item.to.split('/').pop() as keyof typeof loaders;
                preloadEvents.onMouseEnter();
              }}
              onFocus={() => {
                hoveredSection.current = item.to.split('/').pop() as keyof typeof loaders;
                preloadEvents.onFocus();
              }}
              onTouchStart={() => {
                hoveredSection.current = item.to.split('/').pop() as keyof typeof loaders;
                preloadEvents.onTouchStart();
              }}
              className={({ isActive }) => cn(
                'inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-medium transition',
                isActive || (item.to.endsWith('/people') && location.pathname.startsWith('/relationships/legacy'))
                  ? 'bg-indigo-50 text-indigo-700'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-950',
              )}
            >
              <Icon className="h-4 w-4" /> {item.label}
            </NavLink>
          );
        })}
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setCaptureOpen(true)}
          className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg bg-indigo-600 px-3 text-sm font-medium text-white hover:bg-indigo-700"
        >
          <MessageSquarePlus className="h-4 w-4" /> <span className="hidden md:inline">快速记录</span>
        </button>
      </nav>
      <div className={cn('min-h-0 flex-1', splitWorkspace ? 'overflow-hidden' : 'overflow-y-auto')}>
        <Suspense fallback={<LoadingState />}>
          <Routes>
            <Route index element={<Navigate to="today" replace />} />
            <Route path="today" element={<TodayPage />} />
            <Route path="people" element={<PeoplePage />} />
            <Route path="people/:personId" element={<PeoplePage />} />
            <Route path="people/:personId/:tab" element={<PeoplePage />} />
            <Route path="opportunities" element={<OpportunitiesPage />} />
            <Route path="opportunities/:opportunityId" element={<OpportunitiesPage />} />
            <Route path="review" element={<WeeklyReviewPage />} />
            <Route path="growth" element={<GrowthPage />} />
            <Route path="legacy" element={<LegacyArchivePage />} />
            <Route path="legacy/:legacyPersonId" element={<LegacyArchivePage />} />
            <Route path="*" element={<Navigate to="today" replace />} />
          </Routes>
        </Suspense>
      </div>
      <QuickCaptureSheet open={captureOpen} onClose={() => setCaptureOpen(false)} />
    </div>
  );
}
