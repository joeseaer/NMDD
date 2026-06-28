import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  BrainCircuit,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardPaste,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { api, CURRENT_USER_ID } from '../services/api';

type PlannerList = { id: string; name: string; is_default_inbox?: boolean };
type PersonLite = { id: string; name?: string; birthday?: string | null };
type ViewMode = 'day' | 'week' | 'month';
type TaskStatus = 'open' | 'done' | 'archived';

type PlannerTask = {
  id: string;
  type: 'task' | 'event';
  title: string;
  due_at?: string | null;
  status: TaskStatus;
  list_id?: string | null;
  created_at?: string | null;
};

type ParsedImportItem = {
  dateKey: string;
  title: string;
  status: TaskStatus;
};

const weekdays = ['日', '一', '二', '三', '四', '五', '六'];

const startOfDay = (date: Date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

const endOfDay = (date: Date) => {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
};

const addDays = (date: Date, days: number) => {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
};

const addMonths = (date: Date, months: number) => {
  const d = new Date(date);
  const day = d.getDate();
  const target = new Date(d.getFullYear(), d.getMonth() + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, lastDay));
  return target;
};

const toDateKey = (date: Date) => {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

const dateKeyFromIso = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return toDateKey(d);
};

const fromDateKey = (key: string) => {
  const [yyyy, mm, dd] = String(key).split('-').map((x) => parseInt(x, 10));
  const d = new Date();
  if ([yyyy, mm, dd].every(Number.isFinite)) {
    d.setFullYear(yyyy, mm - 1, dd);
  }
  d.setHours(0, 0, 0, 0);
  return d;
};

const formatDateTitle = (date: Date) => {
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')} 周${weekdays[date.getDay()]}`;
};

const formatShortDate = (date: Date) => {
  return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
};

const formatCompactDate = (date: Date) => {
  return `${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
};

const taskDueIso = (dateKey: string, orderIndex: number) => {
  const d = fromDateKey(dateKey);
  const minutes = Math.min(12 * 60, Math.max(0, orderIndex));
  d.setHours(9 + Math.floor(minutes / 60), minutes % 60, 0, 0);
  return d.toISOString();
};

const taskSortValue = (task: PlannerTask) => {
  const dueTime = task.due_at ? new Date(task.due_at).getTime() : 0;
  const createdTime = task.created_at ? new Date(task.created_at).getTime() : 0;
  return Number.isFinite(dueTime) ? dueTime : createdTime;
};

const sortTasks = (items: PlannerTask[]) => {
  return [...items].sort((a, b) => {
    const statusA = a.status === 'done' ? 1 : 0;
    const statusB = b.status === 'done' ? 1 : 0;
    if (statusA !== statusB) return statusA - statusB;
    return taskSortValue(a) - taskSortValue(b);
  });
};

const getWeekStart = (date: Date) => {
  const d = startOfDay(date);
  d.setDate(d.getDate() - d.getDay());
  return d;
};

const getMonthGridStart = (date: Date) => {
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  first.setDate(first.getDate() - first.getDay());
  first.setHours(0, 0, 0, 0);
  return first;
};

const getViewRange = (date: Date, mode: ViewMode) => {
  if (mode === 'month') {
    const start = getMonthGridStart(date);
    const end = addDays(start, 42);
    return { start, end };
  }
  if (mode === 'week') {
    const start = getWeekStart(date);
    return { start, end: addDays(start, 7) };
  }
  return { start: startOfDay(date), end: endOfDay(date) };
};

const parseDateToken = (token: string, baseYear: number) => {
  const raw = String(token || '').trim();
  if (!raw) return '';

  const ymd = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (ymd) {
    const yyyy = parseInt(ymd[1], 10);
    const mm = parseInt(ymd[2], 10);
    const dd = parseInt(ymd[3], 10);
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      return toDateKey(new Date(yyyy, mm - 1, dd));
    }
  }

  const md = raw.match(/^(\d{1,2})[-/.](\d{1,2})$/);
  if (md) {
    const mm = parseInt(md[1], 10);
    const dd = parseInt(md[2], 10);
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      return toDateKey(new Date(baseYear, mm - 1, dd));
    }
  }

  const compact = raw.match(/^(\d{2})(\d{2})$/);
  if (compact) {
    const mm = parseInt(compact[1], 10);
    const dd = parseInt(compact[2], 10);
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      return toDateKey(new Date(baseYear, mm - 1, dd));
    }
  }

  return '';
};

const parseImportText = (text: string, fallbackDateKey: string) => {
  const baseYear = fromDateKey(fallbackDateKey).getFullYear();
  let currentDateKey = fallbackDateKey;
  const items: ParsedImportItem[] = [];

  String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .forEach((line) => {
      if (!line) return;

      const parsedDate = parseDateToken(line, baseYear);
      if (parsedDate) {
        currentDateKey = parsedDate;
        return;
      }

      const statusMatch = line.match(/^(.*?)([01])$/);
      const title = statusMatch ? statusMatch[1].trim() : line;
      const status: TaskStatus = statusMatch?.[2] === '1' ? 'done' : 'open';
      if (!title) return;

      items.push({ dateKey: currentDateKey, title, status });
    });

  return items;
};

function DateNav({
  focusDay,
  viewMode,
  setFocusDay,
  setViewMode,
}: {
  focusDay: Date;
  viewMode: ViewMode;
  setFocusDay: (date: Date) => void;
  setViewMode: (mode: ViewMode) => void;
}) {
  const focusKey = toDateKey(focusDay);
  const shift = (direction: number) => {
    if (viewMode === 'month') setFocusDay(addMonths(focusDay, direction));
    else if (viewMode === 'week') setFocusDay(addDays(focusDay, direction * 7));
    else setFocusDay(addDays(focusDay, direction));
  };

  return (
    <div className="flex flex-col gap-3 border-b border-gray-200 bg-white px-4 py-4 sm:px-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-lg font-bold text-gray-900">
            <CalendarDays className="h-5 w-5 text-primary" />
            {formatDateTitle(focusDay)}
          </div>
          <div className="mt-1 text-xs text-gray-500">打开就写，写完就勾；过去没做完的事会自动带到今天前面。</div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => shift(-1)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
            title="上一段"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={() => setFocusDay(startOfDay(new Date()))}
            className="h-9 rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            今天
          </button>
          <button
            onClick={() => shift(1)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
            title="下一段"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <input
            type="date"
            value={focusKey}
            onChange={(event) => setFocusDay(fromDateKey(event.target.value))}
            className="h-9 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700 outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
      </div>

      <div className="flex w-fit rounded-lg border border-gray-200 bg-gray-50 p-1">
        {[
          ['day', '日'],
          ['week', '周'],
          ['month', '月'],
        ].map(([mode, label]) => (
          <button
            key={mode}
            onClick={() => setViewMode(mode as ViewMode)}
            className={`h-8 rounded-md px-4 text-sm font-medium transition-colors ${
              viewMode === mode ? 'bg-white text-primary shadow-sm' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function TaskRow({
  task,
  onToggle,
  onUpdateTitle,
  onDelete,
  onMoveToToday,
}: {
  task: PlannerTask;
  onToggle: (task: PlannerTask) => void;
  onUpdateTitle: (task: PlannerTask, title: string) => void;
  onDelete: (task: PlannerTask) => void;
  onMoveToToday?: (task: PlannerTask) => void;
}) {
  const [draft, setDraft] = useState(task.title || '');

  useEffect(() => {
    setDraft(task.title || '');
  }, [task.id, task.title]);

  const commit = () => {
    const title = draft.trim();
    if (!title) {
      onDelete(task);
      return;
    }
    if (title !== task.title) onUpdateTitle(task, title);
  };

  return (
    <div className="group flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-gray-50">
      <button
        onClick={() => onToggle(task)}
        className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
          task.status === 'done' ? 'border-emerald-600 bg-emerald-600' : 'border-gray-300 bg-white hover:border-gray-500'
        }`}
        title={task.status === 'done' ? '标记未完成' : '标记完成'}
      >
        {task.status === 'done' && <Check className="h-3.5 w-3.5 text-white" />}
      </button>
      <input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            setDraft(task.title || '');
            event.currentTarget.blur();
          }
        }}
        className={`min-h-7 flex-1 bg-transparent text-[15px] leading-7 outline-none ${
          task.status === 'done' ? 'text-gray-400 line-through' : 'text-gray-900'
        }`}
      />
      {onMoveToToday && task.status !== 'done' && (
        <button
          onClick={() => onMoveToToday(task)}
          className="mt-1 hidden rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-500 hover:text-primary group-hover:block"
        >
          移到今天
        </button>
      )}
      <button
        onClick={() => onDelete(task)}
        className="mt-1 hidden h-6 w-6 items-center justify-center rounded-md text-gray-400 hover:bg-red-50 hover:text-red-600 group-hover:flex"
        title="删除"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function DayChecklist({
  date,
  tasks,
  title,
  subtitle,
  compact = false,
  showDateBadge = true,
  onCreate,
  onBulkImport,
  onToggle,
  onUpdateTitle,
  onDelete,
  onMoveToToday,
}: {
  date: Date;
  tasks: PlannerTask[];
  title?: string;
  subtitle?: string;
  compact?: boolean;
  showDateBadge?: boolean;
  onCreate: (dateKey: string, title: string) => Promise<void>;
  onBulkImport: (text: string, fallbackDateKey: string) => Promise<void>;
  onToggle: (task: PlannerTask) => void;
  onUpdateTitle: (task: PlannerTask, title: string) => void;
  onDelete: (task: PlannerTask) => void;
  onMoveToToday?: (task: PlannerTask) => void;
}) {
  const dateKey = toDateKey(date);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const ordered = useMemo(() => sortTasks(tasks), [tasks]);
  const openCount = ordered.filter((task) => task.status !== 'done').length;

  const create = async () => {
    const text = draft.trim();
    if (!text) return;
    await onCreate(dateKey, text);
    setDraft('');
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  return (
    <section className="rounded-xl border border-gray-200 bg-white">
      <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {showDateBadge && (
              <div className="rounded-md bg-gray-100 px-2 py-1 text-xs font-bold text-gray-700">{formatCompactDate(date)}</div>
            )}
            <h2 className={`${compact ? 'text-sm' : 'text-base'} font-bold text-gray-900`}>{title || formatDateTitle(date)}</h2>
          </div>
          {subtitle && <div className="mt-1 text-xs text-gray-500">{subtitle}</div>}
        </div>
        <div className="shrink-0 text-xs text-gray-500">{openCount}/{ordered.length} 未完成</div>
      </div>

      <div className={`${compact ? 'p-2' : 'p-3'}`}>
        {ordered.length === 0 ? (
          <div className="px-2 py-4 text-sm text-gray-400">暂无</div>
        ) : (
          <div className="space-y-0.5">
            {ordered.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                onToggle={onToggle}
                onUpdateTitle={onUpdateTitle}
                onDelete={onDelete}
                onMoveToToday={onMoveToToday}
              />
            ))}
          </div>
        )}

        <div className="mt-2 flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-gray-50">
          <Plus className="h-4 w-4 shrink-0 text-gray-400" />
          <input
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') create();
            }}
            onPaste={(event) => {
              const text = event.clipboardData.getData('text');
              if (text.includes('\n')) {
                event.preventDefault();
                onBulkImport(text, dateKey);
              }
            }}
            className="min-h-7 flex-1 bg-transparent text-[15px] outline-none placeholder:text-gray-400"
            placeholder="继续输入，回车新增..."
          />
        </div>
      </div>
    </section>
  );
}

function LegacySection({
  tasksByDate,
  onToggle,
  onUpdateTitle,
  onDelete,
  onMoveToToday,
}: {
  tasksByDate: Record<string, PlannerTask[]>;
  onToggle: (task: PlannerTask) => void;
  onUpdateTitle: (task: PlannerTask, title: string) => void;
  onDelete: (task: PlannerTask) => void;
  onMoveToToday: (task: PlannerTask) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const dates = Object.keys(tasksByDate).sort((a, b) => b.localeCompare(a));
  const visibleDates = expanded ? dates : dates.slice(0, 2);
  const hiddenCount = dates.slice(2).reduce((sum, key) => sum + tasksByDate[key].length, 0);

  if (dates.length === 0) return null;

  return (
    <section className="rounded-xl border border-amber-200 bg-amber-50/40">
      <div className="flex items-center justify-between gap-3 border-b border-amber-100 px-4 py-3">
        <div>
          <div className="text-sm font-bold text-amber-950">遗留未完成</div>
          <div className="mt-1 text-xs text-amber-800">过去没做完的事先放在这里，勾掉或移到今天。</div>
        </div>
        {dates.length > 2 && (
          <button onClick={() => setExpanded((value) => !value)} className="text-xs font-medium text-amber-900 hover:underline">
            {expanded ? '收起' : `展开更早 ${hiddenCount} 条`}
          </button>
        )}
      </div>
      <div className="space-y-3 p-3">
        {visibleDates.map((dateKey) => (
          <div key={dateKey} className="rounded-lg border border-amber-100 bg-white/80">
            <div className="border-b border-amber-50 px-3 py-2 text-xs font-bold text-gray-700">
              {formatShortDate(fromDateKey(dateKey))} 周{weekdays[fromDateKey(dateKey).getDay()]}
            </div>
            <div className="p-2">
              {sortTasks(tasksByDate[dateKey]).map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  onToggle={onToggle}
                  onUpdateTitle={onUpdateTitle}
                  onDelete={onDelete}
                  onMoveToToday={onMoveToToday}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function AssistantPanel({
  peopleLoading,
  birthdayReminders,
  secretary,
  secretaryLoading,
  onRefreshSecretary,
}: {
  peopleLoading: boolean;
  birthdayReminders: any[];
  secretary: any;
  secretaryLoading: boolean;
  onRefreshSecretary: () => void;
}) {
  return (
    <aside className="space-y-4">
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="text-sm font-bold text-gray-900">7 天内生日</div>
        {peopleLoading ? (
          <div className="mt-3 text-xs text-gray-400">同步中...</div>
        ) : birthdayReminders.length === 0 ? (
          <div className="mt-3 text-xs text-gray-400">暂无</div>
        ) : (
          <div className="mt-3 space-y-2">
            {birthdayReminders.slice(0, 5).map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-2 text-xs text-gray-700">
                <span className="truncate">{item.name}</span>
                <span className="shrink-0 text-gray-500">{item.days === 0 ? '今天' : `${item.days} 天后`}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Sparkles className="h-4 w-4 text-blue-600" />
            <div className="text-sm font-bold text-gray-900">AI 建议</div>
          </div>
          <button onClick={onRefreshSecretary} className="text-xs text-gray-500 hover:underline">
            刷新
          </button>
        </div>
        {secretaryLoading ? (
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            思考中...
          </div>
        ) : secretary?.available === false ? (
          <div className="text-xs text-red-500">{secretary?.message || '服务不可用'}</div>
        ) : Array.isArray(secretary?.suggestions) && secretary.suggestions.length > 0 ? (
          <div className="space-y-2">
            {secretary.suggestions.slice(0, 3).map((item: any, index: number) => (
              <div key={item.person_id || index} className="rounded-lg border border-blue-100 bg-blue-50/30 p-2 text-xs">
                <div className="font-bold text-gray-900">{item.person_name}</div>
                <div className="mt-1 text-gray-600">{item.reason}</div>
                <div className="mt-1 font-medium text-blue-800">{item.action}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs text-gray-400">暂无特别建议</div>
        )}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="mb-3 flex items-center gap-1.5">
          <BrainCircuit className="h-4 w-4 text-purple-600" />
          <div className="text-sm font-bold text-gray-900">综合提醒</div>
        </div>
        {secretaryLoading ? (
          <div className="text-xs text-gray-400">分析上下文中...</div>
        ) : Array.isArray(secretary?.general_reminders) && secretary.general_reminders.length > 0 ? (
          <div className="space-y-2">
            {secretary.general_reminders.slice(0, 3).map((item: any, index: number) => (
              <div key={index} className="rounded-lg border border-purple-100 bg-purple-50/30 p-2 text-xs">
                <div className="font-bold text-gray-900">{item.title}</div>
                <div className="mt-1 text-gray-600">{item.content}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs text-gray-400">暂无</div>
        )}
      </section>

      {Array.isArray(secretary?.document_context?.references) && secretary.document_context.references.length > 0 && (
        <section className="rounded-xl border border-emerald-100 bg-emerald-50/30 p-4">
          <div className="mb-3 flex items-center gap-1.5">
            <BookOpen className="h-4 w-4 text-emerald-600" />
            <div className="text-sm font-bold text-gray-900">AI 文档记忆</div>
          </div>
          <div className="space-y-1.5">
            {secretary.document_context.references.slice(0, 4).map((ref: any) => (
              <a
                key={`${ref.ref_id}-${ref.url || ref.title}`}
                href={ref.url || '#'}
                className="block truncate rounded-md border border-emerald-100 bg-white/70 px-2 py-1 text-xs text-emerald-900 hover:bg-white"
                title={ref.snippet || ref.title}
              >
                {ref.ref_id} · {ref.title}
              </a>
            ))}
          </div>
        </section>
      )}
    </aside>
  );
}

export default function Planner() {
  const userId = CURRENT_USER_ID;
  const [lists, setLists] = useState<PlannerList[]>([]);
  const [selectedListId, setSelectedListId] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('day');
  const [focusDay, setFocusDay] = useState(() => startOfDay(new Date()));
  const [rangeTasks, setRangeTasks] = useState<PlannerTask[]>([]);
  const [pastOpenTasks, setPastOpenTasks] = useState<PlannerTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importText, setImportText] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [people, setPeople] = useState<PersonLite[]>([]);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [secretary, setSecretary] = useState<any>(null);
  const [secretaryLoading, setSecretaryLoading] = useState(false);

  const inboxId = useMemo(() => lists.find((list) => list.is_default_inbox)?.id || '', [lists]);
  const activeListId = selectedListId || inboxId;
  const today = useMemo(() => startOfDay(new Date()), []);
  const todayKey = toDateKey(today);
  const focusDayKey = toDateKey(focusDay);

  const loadLists = async () => {
    const result = await api.getPlannerLists(userId);
    setLists(Array.isArray(result) ? result : []);
  };

  const loadPeople = async () => {
    setPeopleLoading(true);
    try {
      const result = await api.getAllPeople(userId);
      setPeople(Array.isArray(result) ? result : []);
    } catch {
      setPeople([]);
    } finally {
      setPeopleLoading(false);
    }
  };

  const loadSecretary = async (opts?: { refresh?: boolean }) => {
    setSecretaryLoading(true);
    try {
      const result = await api.getSecretaryDaily(userId, { refresh: !!opts?.refresh });
      setSecretary(result || null);
    } catch {
      setSecretary(null);
    } finally {
      setSecretaryLoading(false);
    }
  };

  const loadTasks = async () => {
    setLoading(true);
    try {
      const range = getViewRange(focusDay, viewMode);
      const todayStart = startOfDay(new Date()).toISOString();
      const [rangeResult, overdueResult] = await Promise.all([
        api.getPlannerCalendarItems(userId, {
          startAt: range.start.toISOString(),
          endAt: range.end.toISOString(),
          listId: activeListId || undefined,
        }),
        api.getPlannerItems(userId, {
          view: 'overdue',
          listId: activeListId || undefined,
          dueBefore: todayStart,
        }),
      ]);

      setRangeTasks((Array.isArray(rangeResult) ? rangeResult : []).filter((item: PlannerTask) => item.type === 'task'));
      setPastOpenTasks((Array.isArray(overdueResult) ? overdueResult : []).filter((item: PlannerTask) => item.type === 'task'));
      setError(null);
    } catch (err: any) {
      setRangeTasks([]);
      setPastOpenTasks([]);
      setError(err?.message ? String(err.message) : '待办加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLists();
    loadPeople();
    loadSecretary();
  }, []);

  useEffect(() => {
    loadTasks();
  }, [activeListId, focusDayKey, viewMode]);

  const tasksByDate = useMemo(() => {
    const map: Record<string, PlannerTask[]> = {};
    rangeTasks.forEach((task) => {
      const key = dateKeyFromIso(task.due_at);
      if (!key) return;
      if (!map[key]) map[key] = [];
      map[key].push(task);
    });
    return map;
  }, [rangeTasks]);

  const pastOpenByDate = useMemo(() => {
    const map: Record<string, PlannerTask[]> = {};
    pastOpenTasks.forEach((task) => {
      const key = dateKeyFromIso(task.due_at);
      if (!key) return;
      if (key >= todayKey) return;
      if (!map[key]) map[key] = [];
      map[key].push(task);
    });
    return map;
  }, [pastOpenTasks, todayKey]);

  const birthdayReminders = useMemo(() => {
    const base = startOfDay(new Date());
    const items = (people || [])
      .map((person) => {
        const raw = String(person.birthday || '').trim();
        if (!raw) return null;
        const parts = raw.split('-').map((x) => parseInt(x, 10));
        if (parts.length < 3 || parts.some(Number.isNaN)) return null;
        const next = new Date(base);
        next.setFullYear(base.getFullYear(), parts[1] - 1, parts[2]);
        if (next.getTime() < base.getTime()) next.setFullYear(next.getFullYear() + 1);
        const days = Math.round((next.getTime() - base.getTime()) / 86400000);
        if (days < 0 || days > 7) return null;
        return { id: person.id, name: person.name || '未命名', days };
      })
      .filter(Boolean) as any[];
    return items.sort((a, b) => a.days - b.days);
  }, [people]);

  const reloadAfterWrite = async () => {
    await loadTasks();
  };

  const createTask = async (dateKey: string, title: string, status: TaskStatus = 'open') => {
    const clean = title.trim();
    if (!clean) return;
    setSaving(true);
    try {
      const existingCount = (tasksByDate[dateKey] || []).length;
      await api.createPlannerItem(userId, {
        type: 'task',
        title: clean,
        due_at: taskDueIso(dateKey, existingCount),
        status,
        priority: 'medium',
        list_id: activeListId || null,
      });
      await reloadAfterWrite();
    } finally {
      setSaving(false);
    }
  };

  const importTasks = async (text: string, fallbackDateKey: string) => {
    const parsed = parseImportText(text, fallbackDateKey);
    if (!parsed.length) return;
    setSaving(true);
    try {
      const counts: Record<string, number> = {};
      parsed.forEach((item) => {
        if (counts[item.dateKey] === undefined) counts[item.dateKey] = (tasksByDate[item.dateKey] || []).length;
      });

      for (const item of parsed) {
        const orderIndex = counts[item.dateKey] || 0;
        counts[item.dateKey] = orderIndex + 1;
        await api.createPlannerItem(userId, {
          type: 'task',
          title: item.title,
          due_at: taskDueIso(item.dateKey, orderIndex),
          status: item.status,
          priority: 'medium',
          list_id: activeListId || null,
        });
      }
      setImportText('');
      setImportOpen(false);
      await reloadAfterWrite();
    } finally {
      setSaving(false);
    }
  };

  const toggleTask = async (task: PlannerTask) => {
    const nextStatus = task.status === 'done' ? 'open' : 'done';
    setRangeTasks((items) => items.map((item) => (item.id === task.id ? { ...item, status: nextStatus } : item)));
    setPastOpenTasks((items) => items.filter((item) => item.id !== task.id));
    await api.updatePlannerItem(task.id, userId, { status: nextStatus });
    await reloadAfterWrite();
  };

  const updateTaskTitle = async (task: PlannerTask, title: string) => {
    const clean = title.trim();
    if (!clean) return;
    setRangeTasks((items) => items.map((item) => (item.id === task.id ? { ...item, title: clean } : item)));
    setPastOpenTasks((items) => items.map((item) => (item.id === task.id ? { ...item, title: clean } : item)));
    await api.updatePlannerItem(task.id, userId, { title: clean });
    await loadTasks();
  };

  const deleteTask = async (task: PlannerTask) => {
    setRangeTasks((items) => items.filter((item) => item.id !== task.id));
    setPastOpenTasks((items) => items.filter((item) => item.id !== task.id));
    await api.deletePlannerItem(task.id, userId);
    await reloadAfterWrite();
  };

  const moveTaskToToday = async (task: PlannerTask) => {
    const existingCount = (tasksByDate[todayKey] || []).length;
    await api.updatePlannerItem(task.id, userId, { due_at: taskDueIso(todayKey, existingCount), status: 'open' });
    await reloadAfterWrite();
  };

  const weekDays = useMemo(() => {
    const start = getWeekStart(focusDay);
    return Array.from({ length: 7 }).map((_, index) => addDays(start, index));
  }, [focusDayKey]);

  const monthDays = useMemo(() => {
    const start = getMonthGridStart(focusDay);
    return Array.from({ length: 42 }).map((_, index) => addDays(start, index));
  }, [focusDayKey]);

  const renderDayView = () => (
    <div className="space-y-4">
      {focusDayKey === todayKey && Object.keys(pastOpenByDate).length > 0 && (
        <LegacySection
          tasksByDate={pastOpenByDate}
          onToggle={toggleTask}
          onUpdateTitle={updateTaskTitle}
          onDelete={deleteTask}
          onMoveToToday={moveTaskToToday}
        />
      )}
      <DayChecklist
        date={focusDay}
        title={focusDayKey === todayKey ? '今天' : formatDateTitle(focusDay)}
        subtitle={focusDayKey === todayKey ? formatDateTitle(focusDay) : undefined}
        tasks={tasksByDate[focusDayKey] || []}
        onCreate={createTask}
        onBulkImport={importTasks}
        onToggle={toggleTask}
        onUpdateTitle={updateTaskTitle}
        onDelete={deleteTask}
      />
    </div>
  );

  const renderWeekView = () => (
    <div className="overflow-x-auto pb-2">
      <div className="grid min-w-[980px] grid-cols-7 gap-3">
        {weekDays.map((day) => {
          const key = toDateKey(day);
          return (
            <DayChecklist
              key={key}
              date={day}
              title={`周${weekdays[day.getDay()]}`}
              subtitle={formatShortDate(day)}
              compact
              tasks={tasksByDate[key] || []}
              onCreate={createTask}
              onBulkImport={importTasks}
              onToggle={toggleTask}
              onUpdateTitle={updateTaskTitle}
              onDelete={deleteTask}
            />
          );
        })}
      </div>
    </div>
  );

  const renderMonthView = () => (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <div className="grid grid-cols-7 gap-2">
        {monthDays.map((day) => {
          const key = toDateKey(day);
          const tasks = sortTasks(tasksByDate[key] || []);
          const openCount = tasks.filter((task) => task.status !== 'done').length;
          const isInMonth = day.getMonth() === focusDay.getMonth();
          const isToday = key === todayKey;
          return (
            <button
              key={key}
              onClick={() => {
                setFocusDay(day);
                setViewMode('day');
              }}
              className={`min-h-[124px] rounded-lg border p-2 text-left transition-colors hover:bg-gray-50 ${
                isToday ? 'border-primary bg-primary/5' : 'border-gray-200 bg-white'
              } ${!isInMonth ? 'opacity-45' : ''}`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className={`text-sm font-bold ${isToday ? 'text-primary' : 'text-gray-900'}`}>{day.getDate()}</div>
                {tasks.length > 0 && <div className="text-[10px] text-gray-500">{openCount}/{tasks.length}</div>}
              </div>
              <div className="mt-2 space-y-1">
                {tasks.slice(0, 4).map((task) => (
                  <div
                    key={task.id}
                    className={`truncate rounded px-1.5 py-0.5 text-[11px] ${
                      task.status === 'done' ? 'bg-gray-50 text-gray-400 line-through' : 'bg-gray-100 text-gray-700'
                    }`}
                  >
                    {task.title}
                  </div>
                ))}
                {tasks.length > 4 && <div className="text-[10px] text-gray-400">+{tasks.length - 4}</div>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="min-h-full overflow-hidden rounded-2xl border border-gray-200 bg-gray-50">
      <DateNav focusDay={focusDay} viewMode={viewMode} setFocusDay={setFocusDay} setViewMode={setViewMode} />

      <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <main className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="relative">
                <select
                  value={selectedListId}
                  onChange={(event) => setSelectedListId(event.target.value)}
                  className="h-9 appearance-none rounded-lg border border-gray-200 bg-white py-1 pl-3 pr-9 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                >
                  <option value="">当前清单：{inboxId ? '收集箱' : '全部'}</option>
                  {lists.map((list) => (
                    <option key={list.id} value={list.id}>
                      {list.name}{list.is_default_inbox ? '（收集箱）' : ''}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              </div>
              {(loading || saving) && (
                <div className="flex items-center gap-1.5 text-xs text-gray-400">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {saving ? '保存中' : '加载中'}
                </div>
              )}
            </div>

            <button
              onClick={() => setImportOpen((value) => !value)}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              <ClipboardPaste className="h-4 w-4" />
              批量粘贴
            </button>
          </div>

          {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

          {importOpen && (
            <section className="rounded-xl border border-indigo-200 bg-white p-4">
              <textarea
                value={importText}
                onChange={(event) => setImportText(event.target.value)}
                rows={8}
                className="w-full resize-y rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                placeholder={'0524\n完成拟合分析 1\n训练模型\n\n0612\n完成计算材料学作业'}
              />
              <div className="mt-3 flex justify-end gap-2">
                <button onClick={() => setImportOpen(false)} className="h-9 rounded-lg border border-gray-200 px-3 text-sm text-gray-600 hover:bg-gray-50">
                  取消
                </button>
                <button
                  onClick={() => importTasks(importText, focusDayKey)}
                  disabled={saving || !importText.trim()}
                  className="h-9 rounded-lg bg-primary px-4 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
                >
                  导入
                </button>
              </div>
            </section>
          )}

          {viewMode === 'day' && renderDayView()}
          {viewMode === 'week' && renderWeekView()}
          {viewMode === 'month' && renderMonthView()}
        </main>

        <AssistantPanel
          peopleLoading={peopleLoading}
          birthdayReminders={birthdayReminders}
          secretary={secretary}
          secretaryLoading={secretaryLoading}
          onRefreshSecretary={() => loadSecretary({ refresh: true })}
        />
      </div>
    </div>
  );
}
