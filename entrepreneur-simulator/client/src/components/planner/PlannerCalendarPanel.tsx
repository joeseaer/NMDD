import { Calendar, Check, Clock, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';

export type PlannerCalendarItem = {
  id: string;
  type: 'event' | 'task';
  title: string;
  status?: 'open' | 'done' | 'archived';
  start_at?: string | null;
  end_at?: string | null;
  due_at?: string | null;
};

export default function PlannerCalendarPanel({
  focusDay,
  setFocusDay,
  dayEvents,
  calendarMode,
  setCalendarMode,
  tasksByDate,
  creating,
  onCreateEvent,
  onDeleteEvent,
  onToggleTaskDone,
  onDeleteTask,
}: {
  focusDay: Date;
  setFocusDay: (d: Date) => void;
  dayEvents: PlannerCalendarItem[];
  calendarMode: 'week' | 'month';
  setCalendarMode: (m: 'week' | 'month') => void;
  tasksByDate: Record<string, PlannerCalendarItem[]>;
  creating: boolean;
  onCreateEvent: (payload: { title: string; startLocal: string; endLocal: string }) => Promise<void>;
  onDeleteEvent: (id: string, title: string) => void;
  onToggleTaskDone: (it: PlannerCalendarItem) => void;
  onDeleteTask: (it: PlannerCalendarItem) => void;
}) {
  const [title, setTitle] = useState('');
  const [startLocal, setStartLocal] = useState('');
  const [endLocal, setEndLocal] = useState('');

  const formatMdHm = (iso?: string | null) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const mm = d.getMonth() + 1;
    const dd = d.getDate();
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${mm}月${dd}日 ${hh}:${mi}`;
  };

  const toKey = (d: Date) => {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const viewDays = useMemo(() => {
    const base = new Date(focusDay);
    if (calendarMode === 'week') {
      const start = new Date(base);
      start.setDate(base.getDate() - base.getDay());
      start.setHours(0, 0, 0, 0);
      return Array.from({ length: 7 }).map((_, i) => {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        return d;
      });
    }

    const first = new Date(base.getFullYear(), base.getMonth(), 1);
    const gridStart = new Date(first);
    gridStart.setDate(first.getDate() - first.getDay());
    gridStart.setHours(0, 0, 0, 0);

    return Array.from({ length: 42 }).map((_, i) => {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      return d;
    });
  }, [focusDay, calendarMode]);

  const viewTitle = useMemo(() => {
    const d = new Date(focusDay);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    return `${y}年${m}月`;
  }, [focusDay]);

  const shiftMonth = (delta: number) => {
    const d = new Date(focusDay);
    const target = new Date(d.getFullYear(), d.getMonth() + delta, 1);
    const curDate = d.getDate();
    const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    target.setDate(Math.min(curDate, lastDay));
    setFocusDay(target);
  };

  return (
    <div className="flex-1 bg-white border border-gray-200 rounded-2xl p-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-gray-900 font-bold">
          <Calendar className="w-5 h-5" />
          {calendarMode === 'week' ? '周视图' : '月视图'}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCalendarMode('week')}
            className={`px-2.5 py-1 rounded-md text-xs font-medium ${calendarMode === 'week' ? 'bg-primary/10 text-primary' : 'text-gray-600 hover:bg-gray-50'}`}
          >
            周
          </button>
          <button
            onClick={() => setCalendarMode('month')}
            className={`px-2.5 py-1 rounded-md text-xs font-medium ${calendarMode === 'month' ? 'bg-primary/10 text-primary' : 'text-gray-600 hover:bg-gray-50'}`}
          >
            月
          </button>
        </div>
      </div>

      {calendarMode === 'month' ? (
        <div className="mt-2 flex items-center justify-between">
          <button onClick={() => shiftMonth(-1)} className="text-xs text-gray-600 hover:underline">上个月</button>
          <div className="text-sm text-gray-700 font-medium">{viewTitle}</div>
          <button onClick={() => shiftMonth(1)} className="text-xs text-gray-600 hover:underline">下个月</button>
        </div>
      ) : (
        <div className="mt-2 text-sm text-gray-500">{focusDay.toLocaleDateString()}</div>
      )}

      <div className="mt-4 grid grid-cols-7 gap-2">
        {viewDays.map((d) => {
          const isActive = d.toDateString() === focusDay.toDateString();
          const key = toKey(d);
          const tasks = (tasksByDate?.[key] || []).filter((it) => it.type === 'task');
          const chips = tasks.slice(0, 2);
          const extraCount = tasks.length - chips.length;
          const isInMonth = calendarMode === 'month' ? d.getMonth() === new Date(focusDay).getMonth() : true;
          return (
            <button
              key={d.toISOString()}
              onClick={() => setFocusDay(d)}
              className={`rounded-lg border px-2 py-2 text-left ${isActive ? 'border-primary bg-primary/5' : 'border-gray-200 hover:bg-gray-50'} ${!isInMonth ? 'opacity-50' : ''}`}
            >
              <div className="text-xs text-gray-500">{['日','一','二','三','四','五','六'][d.getDay()]}</div>
              <div className={`text-sm font-bold ${isActive ? 'text-primary' : 'text-gray-900'}`}>{d.getDate()}</div>
              {tasks.length > 0 && (
                <div className="mt-1 space-y-1">
                  {chips.map((t) => (
                    <div
                      key={t.id}
                      className={`text-[10px] leading-tight rounded px-1 py-0.5 border ${t.status === 'done' ? 'text-gray-400 border-gray-200 line-through' : 'text-gray-700 border-gray-200'}`}
                      title={t.title}
                    >
                      {t.title}
                    </div>
                  ))}
                  {extraCount > 0 && <div className="text-[10px] text-gray-400">+{extraCount}</div>}
                </div>
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-5 grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-gray-200 p-4">
          <div className="text-sm font-bold text-gray-900">当天日程 / 待办</div>
          {dayEvents.length === 0 ? (
            <div className="mt-3 text-xs text-gray-400 italic">暂无</div>
          ) : (
            <div className="mt-3 space-y-2">
              {dayEvents.map((it) => (
                <div key={it.id} className="flex items-center gap-3 bg-gray-50/60 border border-gray-100 rounded-lg px-3 py-2">
                  {it.type === 'task' && (
                    <button
                      onClick={() => onToggleTaskDone(it)}
                      className={`w-5 h-5 rounded border flex items-center justify-center ${it.status === 'done' ? 'bg-green-600 border-green-600' : 'border-gray-300 hover:border-gray-400'}`}
                      title={it.status === 'done' ? '标记未完成' : '标记完成'}
                    >
                      {it.status === 'done' && <Check className="w-4 h-4 text-white" />}
                    </button>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm font-medium whitespace-normal break-words ${it.type === 'task' && it.status === 'done' ? 'text-gray-400 line-through' : 'text-gray-900'}`}>{it.title}</div>
                    {it.type === 'event' ? (
                      <div className="text-xs text-gray-500 mt-0.5">
                        {formatMdHm(it.start_at)}
                        {' - '}
                        {formatMdHm(it.end_at)}
                      </div>
                    ) : (
                      <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        <span>待办</span>
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => (it.type === 'event' ? onDeleteEvent(it.id, it.title) : onDeleteTask(it))}
                    className="text-gray-400 hover:text-red-600"
                    title="删除"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-gray-200 p-4">
          <div className="text-sm font-bold text-gray-900">新增日程</div>
          <div className="mt-3 space-y-2">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              placeholder="日程标题"
            />
            <div className="space-y-2">
              <div>
                <div className="text-xs text-gray-600 mb-1">开始时间</div>
                <input
                  type="datetime-local"
                  value={startLocal}
                  onChange={(e) => setStartLocal(e.target.value)}
                  className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <div>
                <div className="text-xs text-gray-600 mb-1">结束时间</div>
                <input
                  type="datetime-local"
                  value={endLocal}
                  onChange={(e) => setEndLocal(e.target.value)}
                  className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
            </div>
            <button
              onClick={async () => {
                await onCreateEvent({ title, startLocal, endLocal });
                setTitle('');
                setStartLocal('');
                setEndLocal('');
              }}
              disabled={creating || !title.trim() || !startLocal || !endLocal}
              className="inline-flex items-center justify-center gap-2 bg-primary text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 w-full"
            >
              <Plus className="w-4 h-4" />
              添加日程
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

