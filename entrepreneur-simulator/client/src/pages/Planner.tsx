import { useEffect, useMemo, useState } from 'react';
import { BrainCircuit, ChevronDown, Sparkles } from 'lucide-react';
import { api, CURRENT_USER_ID } from '../services/api';
import PlannerTodoPanel, { PlannerItem } from '../components/planner/PlannerTodoPanel';
import PlannerCalendarPanel, { PlannerCalendarItem } from '../components/planner/PlannerCalendarPanel';

type PlannerList = { id: string; name: string; is_default_inbox?: boolean };
type PersonLite = { id: string; name?: string; birthday?: string | null; last_interaction?: string | null; last_interaction_date?: string | null };

export default function Planner() {
  const userId = CURRENT_USER_ID;
  const [lists, setLists] = useState<PlannerList[]>([]);
  const [selectedListId, setSelectedListId] = useState<string>('');

  const [calendarMode, setCalendarMode] = useState<'week' | 'month'>('week');

  const [overdue, setOverdue] = useState<PlannerItem[]>([]);
  const [upcoming, setUpcoming] = useState<PlannerItem[]>([]);
  const [loading, setLoading] = useState(false);

  const [people, setPeople] = useState<PersonLite[]>([]);
  const [peopleLoading, setPeopleLoading] = useState(false);

  const [secretary, setSecretary] = useState<any>(null);
  const [secretaryLoading, setSecretaryLoading] = useState(false);

  const [creatingTask, setCreatingTask] = useState(false);
  const [creatingEvent, setCreatingEvent] = useState(false);

  const [focusDay, setFocusDay] = useState(() => new Date());
  const [calendarItems, setCalendarItems] = useState<PlannerCalendarItem[]>([]);
  const [calendarLoadError, setCalendarLoadError] = useState<string | null>(null);
  const [listLoadError, setListLoadError] = useState<string | null>(null);

  const inboxId = useMemo(() => {
    const inbox = lists.find(l => l.is_default_inbox);
    return inbox?.id || '';
  }, [lists]);

  const activeListId = selectedListId || inboxId;

  const loadPeople = async () => {
    setPeopleLoading(true);
    try {
      const res = await api.getAllPeople(userId);
      setPeople(Array.isArray(res) ? res : []);
    } catch {
      setPeople([]);
    } finally {
      setPeopleLoading(false);
    }
  };

  const loadSecretary = async (opts?: { refresh?: boolean }) => {
    setSecretaryLoading(true);
    try {
      const res = await api.getSecretaryDaily(userId, { refresh: !!opts?.refresh });
      setSecretary(res || null);
    } catch {
      setSecretary(null);
    } finally {
      setSecretaryLoading(false);
    }
  };

  const toDateKey = (iso: string | null | undefined) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const refresh = async () => {
    setLoading(true);
    try {
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      const dueBefore = now.toISOString();

      const [l, o, u] = await Promise.all([
        api.getPlannerLists(userId),
        api.getPlannerItems(userId, { view: 'overdue', listId: activeListId || undefined, dueBefore }),
        api.getPlannerItems(userId, { view: 'upcoming', listId: activeListId || undefined }),
      ]);
      setLists(Array.isArray(l) ? l : []);
      setOverdue(Array.isArray(o) ? o : []);
      setUpcoming(Array.isArray(u) ? u : []);
      setListLoadError(null);
    } catch (e: any) {
      setListLoadError(e?.message ? String(e.message) : '待办数据加载失败');
    } finally {
      setLoading(false);
    }
  };

  const [isDragging, setIsDragging] = useState(false);

  const refreshEvents = async (day: Date) => {
    const d = new Date(day);
    let start: Date;
    let end: Date;

    if (calendarMode === 'month') {
      const first = new Date(d.getFullYear(), d.getMonth(), 1);
      const gridStart = new Date(first);
      gridStart.setDate(first.getDate() - first.getDay());
      gridStart.setHours(0, 0, 0, 0);

      const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      const gridEnd = new Date(last);
      gridEnd.setDate(last.getDate() + (6 - last.getDay()) + 1);
      gridEnd.setHours(0, 0, 0, 0);

      start = gridStart;
      end = gridEnd;
    } else {
      start = new Date(d);
      start.setDate(d.getDate() - d.getDay());
      start.setHours(0, 0, 0, 0);
      end = new Date(start);
      end.setDate(start.getDate() + 7);
    }

    try {
      const res = await api.getPlannerCalendarItems(userId, { startAt: start.toISOString(), endAt: end.toISOString(), listId: activeListId || undefined });
      setCalendarItems(Array.isArray(res) ? res : []);
      setCalendarLoadError(null);
    } catch (e: any) {
      setCalendarItems([]);
      setCalendarLoadError(e?.message ? String(e.message) : '日历数据加载失败');
    }
  };

  useEffect(() => {
    refresh();
    loadPeople();
    loadSecretary();
  }, []);

  useEffect(() => {
    if (!lists.length) return;
    refresh();
    refreshEvents(focusDay);
  }, [activeListId]);

  useEffect(() => {
    refreshEvents(focusDay);
  }, [focusDay, calendarMode]);

  const dayEvents = useMemo(() => {
    const s = new Date(focusDay);
    s.setHours(0, 0, 0, 0);
    const e = new Date(focusDay);
    e.setHours(23, 59, 59, 999);
    return calendarItems
      .filter((it) => {
        if (it.type === 'task') {
          const iso = it.due_at;
          const t = iso ? new Date(iso).getTime() : NaN;
          if (Number.isNaN(t)) return false;
          return t >= s.getTime() && t <= e.getTime();
        }

        const startIso = it.start_at;
        const endIso = it.end_at;
        const ts = startIso ? new Date(startIso).getTime() : NaN;
        const te = endIso ? new Date(endIso).getTime() : NaN;
        if (Number.isNaN(ts) || Number.isNaN(te)) return false;
        return ts <= e.getTime() && te >= s.getTime();
      })
      .sort((a, b) => {
        const aIsTask = a.type === 'task' ? 1 : 0;
        const bIsTask = b.type === 'task' ? 1 : 0;
        if (aIsTask !== bIsTask) return aIsTask - bIsTask;
        if (a.type === 'task' && b.type === 'task') {
          const sa = a.status === 'done' ? 1 : 0;
          const sb = b.status === 'done' ? 1 : 0;
          if (sa !== sb) return sa - sb;
        }
        const ia = a.type === 'task' ? a.due_at : a.start_at;
        const ib = b.type === 'task' ? b.due_at : b.start_at;
        const ta = ia ? new Date(ia).getTime() : 0;
        const tb = ib ? new Date(ib).getTime() : 0;
        return ta - tb;
      });
  }, [calendarItems, focusDay]);

  const focusDayKey = useMemo(() => {
    const d = new Date(focusDay);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, [focusDay]);

  const handleMoveTaskToDate = async (taskId: string, date: string) => {
    const all = [...overdue, ...upcoming, ...focusDayTasks, ...(calendarItems.filter(it => it.type === 'task') as unknown as PlannerItem[])];
    const target = all.find(it => it.id === taskId);
    
    const parts = date.split('-').map(x => parseInt(x, 10));
    const d = new Date();
    d.setFullYear(parts[0], parts[1] - 1, parts[2]);

    if (target && target.due_at) {
        const old = new Date(target.due_at);
        if (!Number.isNaN(old.getTime())) {
            d.setHours(old.getHours(), old.getMinutes(), 0, 0);
        }
    }

    const nextDueAt = d.toISOString();
    await api.updatePlannerItem(taskId, userId, { due_at: nextDueAt });
    await Promise.all([refresh(), refreshEvents(focusDay)]);
  };

  const focusDayTasks = useMemo(() => {
    return dayEvents.filter((it) => it.type === 'task') as unknown as PlannerItem[];
  }, [dayEvents]);

  const weekTasksByDate = useMemo(() => {
    const map: Record<string, PlannerItem[]> = {};
    calendarItems.forEach((it: any) => {
      if (it?.type !== 'task') return;
      const key = toDateKey(it.due_at);
      if (!key) return;
      if (!map[key]) map[key] = [];
      map[key].push(it);
    });
    Object.keys(map).forEach((k) => {
      map[k] = map[k].sort((a, b) => {
        const sa = a.status === 'done' ? 1 : 0;
        const sb = b.status === 'done' ? 1 : 0;
        if (sa !== sb) return sa - sb;
        return 0;
      });
    });
    return map;
  }, [calendarItems]);

  const birthdayReminders = useMemo(() => {
    const base = new Date();
    base.setHours(0, 0, 0, 0);
    const items = (people || [])
      .map((p) => {
        const raw = String(p.birthday || '').trim();
        if (!raw) return null;
        const parts = raw.split('-').map((x) => parseInt(x, 10));
        if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return null;
        const mm = parts[1];
        const dd = parts[2];
        if (!mm || !dd) return null;

        const next = new Date(base);
        next.setFullYear(base.getFullYear(), mm - 1, dd);
        const diffDays = Math.round((next.getTime() - base.getTime()) / 86400000);
        const useNext = diffDays < 0 ? (() => { const d = new Date(next); d.setFullYear(d.getFullYear() + 1); return d; })() : next;
        const days = Math.round((useNext.getTime() - base.getTime()) / 86400000);
        if (days < 0 || days > 7) return null;

        return {
          id: p.id,
          name: p.name || '未命名',
          days,
          dateText: `${mm}月${dd}日`,
        };
      })
      .filter(Boolean) as any[];
    items.sort((a, b) => a.days - b.days);
    return items;
  }, [people]);

  return (
    <div className="h-full flex flex-col gap-4">
      <div className="bg-white border border-gray-200 rounded-2xl p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xl font-bold text-gray-900">日程与待办</div>
            <div className="text-sm text-gray-500 mt-1">用清单管理待办，并用周视图记录日程。</div>
            {(calendarLoadError || listLoadError) && (
              <div className="mt-2 text-xs text-red-600">
                {calendarLoadError || listLoadError}
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-col lg:flex-row gap-3 lg:items-center">
          <div className="relative">
            <select
              value={selectedListId}
              onChange={(e) => setSelectedListId(e.target.value)}
              className="appearance-none bg-white border border-gray-200 rounded-lg pl-3 pr-9 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="">当前清单：{inboxId ? '收集箱(默认)' : '全部'}</option>
              {lists.map((l) => (
                <option key={l.id} value={l.id}>{l.name}{l.is_default_inbox ? '（收集箱）' : ''}</option>
              ))}
            </select>
            <ChevronDown className="w-4 h-4 text-gray-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
          <div className="flex-1" />
        </div>

        <div className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50/40 p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-bold text-gray-900">今日秘书</div>
              <div className="text-xs text-gray-600 mt-1">用于提醒：待办里不容易被你看到的信息。</div>
            </div>
            <div className="text-xs text-gray-500">
              {peopleLoading ? '同步人物信息中…' : `今日待办：${focusDayTasks.filter((t: any) => t.status !== 'done').length} 条未完成`}
            </div>
          </div>

          <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="bg-white rounded-lg border border-gray-100 p-3">
              <div className="text-xs font-bold text-gray-900">7 天内生日</div>
              {birthdayReminders.length === 0 ? (
                <div className="mt-2 text-xs text-gray-400 italic">暂无</div>
              ) : (
                <div className="mt-2 space-y-1">
                  {birthdayReminders.slice(0, 5).map((b) => (
                    <div key={b.id} className="text-xs text-gray-700 flex items-center justify-between gap-2">
                      <div className="truncate">{b.name}</div>
                      <div className="text-gray-500 shrink-0">{b.days === 0 ? '今天' : `${b.days}天后`} · {b.dateText}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white rounded-lg border border-gray-100 p-3 lg:col-span-2 flex flex-col gap-4">
              {/* Section 1: AI Suggestions */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-blue-600" />
                    <div className="text-xs font-bold text-gray-900">AI 建议（人脉维护）</div>
                  </div>
                  <button onClick={() => loadSecretary({ refresh: true })} className="text-xs text-gray-500 hover:underline">刷新</button>
                </div>
                {secretaryLoading ? (
                  <div className="text-xs text-gray-400">正在思考中…</div>
                ) : secretary?.available === false ? (
                  <div className="text-xs text-red-500">{secretary?.message || '服务不可用'}</div>
                ) : (Array.isArray(secretary?.suggestions) && secretary.suggestions.length > 0) ? (
                  <div className="space-y-2">
                    {secretary.suggestions.map((s: any, idx: number) => (
                      <div key={s.person_id || idx} className="text-xs text-gray-700 bg-blue-50/30 p-2 rounded border border-blue-100/50">
                        <div className="flex justify-between items-start">
                          <span className="font-bold text-gray-900">{s.person_name}</span>
                          <span className="text-[10px] text-blue-600 bg-blue-100/50 px-1.5 py-0.5 rounded">{s.when === 'today' ? '今天' : s.when === 'tomorrow' ? '明天' : '本周'}</span>
                        </div>
                        <div className="text-gray-500 mt-0.5">{s.reason}</div>
                        <div className="mt-1 font-medium text-blue-800">建议：{s.action}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-gray-400 italic">目前人脉维护良好，暂无特别建议。</div>
                )}
              </div>

              {/* Section 2: AI Comprehensive Reminders */}
              <div className="pt-3 border-t border-gray-100">
                <div className="flex items-center gap-1.5 mb-2">
                  <BrainCircuit className="w-3.5 h-3.5 text-purple-600" />
                  <div className="text-xs font-bold text-gray-900">AI 综合提醒（事务与认知）</div>
                </div>
                {secretaryLoading ? (
                  <div className="text-xs text-gray-400">正在分析上下文…</div>
                ) : (Array.isArray(secretary?.general_reminders) && secretary.general_reminders.length > 0) ? (
                  <div className="space-y-2">
                    {secretary.general_reminders.map((r: any, idx: number) => {
                      const isHigh = r.priority === 'high';
                      const tone = isHigh ? 'red' : r.type === 'idea' ? 'purple' : 'gray';
                      const bg = tone === 'red' ? 'bg-red-50/30 border-red-100/50' : tone === 'purple' ? 'bg-purple-50/30 border-purple-100/50' : 'bg-gray-50/50 border-gray-100';
                      const text = tone === 'red' ? 'text-red-900' : tone === 'purple' ? 'text-purple-900' : 'text-gray-900';
                      
                      return (
                        <div key={idx} className={`text-xs p-2 rounded border ${bg}`}>
                          <div className={`font-bold ${text} mb-0.5 flex justify-between`}>
                            <span>{r.title}</span>
                            {isHigh && <span className="text-[10px] text-red-600 bg-red-100/50 px-1.5 py-0.5 rounded">重要</span>}
                          </div>
                          <div className="text-gray-600 leading-relaxed">{r.content}</div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-xs text-gray-400 italic">今日事务井井有条，无需额外提醒。</div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <PlannerCalendarPanel
          focusDay={focusDay}
          setFocusDay={setFocusDay}
          dayEvents={dayEvents}
          calendarMode={calendarMode}
          setCalendarMode={setCalendarMode}
          tasksByDate={weekTasksByDate as any}
          creating={creatingEvent}
          onCreateEvent={async ({ title, startLocal, endLocal }) => {
            const s = new Date(startLocal);
            const e = new Date(endLocal);
            if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e.getTime() <= s.getTime()) return;
            setCreatingEvent(true);
            try {
              await api.createPlannerItem(userId, {
                type: 'event',
                title: String(title || '').trim(),
                start_at: s.toISOString(),
                end_at: e.toISOString(),
                status: 'open',
                priority: 'medium',
                list_id: activeListId || null,
              });
              await refreshEvents(focusDay);
            } finally {
              setCreatingEvent(false);
            }
          }}
          onDeleteEvent={async (id, title) => {
            const ok = window.confirm(`确认删除「${title}」？`);
            if (!ok) return;
            await api.deletePlannerItem(id, userId);
            await refreshEvents(focusDay);
          }}
          onToggleTaskDone={async (it) => {
            const next = it.status === 'done' ? 'open' : 'done';
            await api.updatePlannerItem(it.id, userId, { status: next });
            await Promise.all([refreshEvents(focusDay), refresh()]);
          }}
          onDeleteTask={async (it) => {
            const ok = window.confirm(`确认删除「${it.title}」？`);
            if (!ok) return;
            await api.deletePlannerItem(it.id, userId);
            await Promise.all([refreshEvents(focusDay), refresh()]);
          }}
          onMoveTaskToDate={handleMoveTaskToDate}
          isDragging={isDragging}
          setIsDragging={setIsDragging}
        />

        <PlannerTodoPanel
          activeListId={activeListId}
          focusDayLabel={focusDayKey}
          focusDayTasks={focusDayTasks}
          overdue={overdue}
          upcoming={upcoming}
          creating={creatingTask}
          onCreateTask={async ({ title, dueDate, listId }) => {
            const t = String(title || '').trim();
            if (!t) return;
            setCreatingTask(true);
            try {
              let dueAt: string | null = null;
              if (dueDate) {
                const base = new Date();
                const parts = String(dueDate).split('-').map((x) => parseInt(x, 10));
                if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
                  const d = new Date(base);
                  d.setFullYear(parts[0], parts[1] - 1, parts[2]);
                  d.setHours(base.getHours(), base.getMinutes(), 0, 0);
                  dueAt = d.toISOString();
                }
              }
              await api.createPlannerItem(userId, {
                type: 'task',
                title: t,
                due_at: dueAt,
                status: 'open',
                priority: 'medium',
                list_id: listId || null,
              });
              await Promise.all([refresh(), refreshEvents(focusDay)]);
            } finally {
              setCreatingTask(false);
            }
          }}
          onToggleDone={async (it) => {
            const next = it.status === 'done' ? 'open' : 'done';
            await api.updatePlannerItem(it.id, userId, { status: next });
            await Promise.all([refresh(), refreshEvents(focusDay)]);
          }}
          onUpdate={async (it, patch) => {
            const nextPatch: any = {};
            if (typeof patch.title === 'string') nextPatch.title = patch.title;
            if ('dueDate' in patch) {
              if (!patch.dueDate) {
                nextPatch.due_at = null;
              } else {
                const base = new Date();
                const parts = String(patch.dueDate).split('-').map((x) => parseInt(x, 10));
                if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
                  const d = new Date(base);
                  d.setFullYear(parts[0], parts[1] - 1, parts[2]);
                  d.setHours(base.getHours(), base.getMinutes(), 0, 0);
                  nextPatch.due_at = d.toISOString();
                }
              }
            }
            await api.updatePlannerItem(it.id, userId, nextPatch);
            await Promise.all([refresh(), refreshEvents(focusDay)]);
          }}
          onDelete={async (it) => {
            const ok = window.confirm(`确认删除「${it.title}」？`);
            if (!ok) return;
            await api.deletePlannerItem(it.id, userId);
            await Promise.all([refresh(), refreshEvents(focusDay)]);
          }}
          setIsDragging={setIsDragging}
        />
      </div>

      {loading && (
        <div className="text-xs text-gray-400">加载中…</div>
      )}
    </div>
  );
}
