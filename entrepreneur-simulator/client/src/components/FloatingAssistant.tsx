import { Calendar, Plus, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { api, CURRENT_USER_ID } from '../services/api';

const toYmd = (d: Date) => {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const guessDueDateFromText = (text: string, base: Date) => {
  const s = String(text || '').trim();
  if (!s) return '';
  if (s.includes('后天')) {
    const d = new Date(base);
    d.setDate(d.getDate() + 2);
    return toYmd(d);
  }
  if (s.includes('明天')) {
    const d = new Date(base);
    d.setDate(d.getDate() + 1);
    return toYmd(d);
  }
  if (s.includes('今天')) return toYmd(base);

  const nextWeekMatch = s.match(/下周([一二三四五六日天])/);
  if (nextWeekMatch) {
    const map: Record<string, number> = { '日': 0, '天': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6 };
    const wd = map[nextWeekMatch[1]];
    if (typeof wd === 'number') {
      const d = new Date(base);
      const delta = (7 - d.getDay()) + wd;
      d.setDate(d.getDate() + delta);
      return toYmd(d);
    }
  }

  const ymd = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (ymd) {
    const yy = parseInt(ymd[1], 10);
    const mm = parseInt(ymd[2], 10);
    const dd = parseInt(ymd[3], 10);
    if ([yy, mm, dd].every(Number.isFinite)) return `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  }

  const md = s.match(/(\d{1,2})月(\d{1,2})日/);
  if (md) {
    const mm = parseInt(md[1], 10);
    const dd = parseInt(md[2], 10);
    if ([mm, dd].every(Number.isFinite)) {
      const d = new Date(base);
      d.setMonth(mm - 1, dd);
      d.setHours(0, 0, 0, 0);
      const b = new Date(base);
      b.setHours(0, 0, 0, 0);
      if (d.getTime() < b.getTime()) d.setFullYear(d.getFullYear() + 1);
      return toYmd(d);
    }
  }

  return '';
};

const sanitizeTitle = (inputTitle: string, rawText: string) => {
  const base = String(inputTitle || rawText || '').trim();
  const stripped = base
    .replace(/\d{4}-\d{1,2}-\d{1,2}/g, '')
    .replace(/\d{1,2}月\d{1,2}日/g, '')
    .replace(/\d{1,2}号/g, '')
    .replace(/(今天|明天|后天|下周[一二三四五六日天])/g, '')
    .replace(/[，,。\.、\s]+/g, ' ')
    .trim();
  return stripped || base;
};

export default function FloatingAssistant() {
  const userId = CURRENT_USER_ID;
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [dueDate, setDueDate] = useState(() => toYmd(new Date()));
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [draft, setDraft] = useState<null | {
    type: 'task' | 'event';
    title: string;
    date: string;
    start_time?: string | null;
    end_time?: string | null;
    warning?: string | null;
  }>(null);
  const disabled = useMemo(() => saving || parsing || !text.trim(), [saving, parsing, text]);

  const toIsoFromLocal = (date: string, time: string) => {
    const t = /^\d{2}:\d{2}$/.test(time) ? time : '09:00';
    return new Date(`${date}T${t}:00`).toISOString();
  };

  return (
    <div className="fixed right-5 bottom-5 z-50">
      {open && (
        <div className="w-[340px] max-w-[calc(100vw-40px)] bg-white border border-gray-200 rounded-2xl shadow-xl overflow-hidden mb-3">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <div className="text-sm font-bold text-gray-900">快速记录</div>
            <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600" title="关闭">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="p-4 space-y-3">
            <textarea
              rows={3}
              value={text}
              onChange={(e) => {
                const v = e.target.value;
                setText(v);
                if (!touched) {
                  const g = guessDueDateFromText(v, new Date());
                  if (g) setDueDate(g);
                }
              }}
              className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
              placeholder="例如：下周三提醒我提交合同"
            />
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2 text-xs text-gray-600">
                <Calendar className="w-4 h-4 text-gray-400" />
                <span>提醒日期</span>
              </div>
              <div className="flex-1" />
              <input
                type="date"
                value={dueDate}
                onChange={(e) => { setTouched(true); setDueDate(e.target.value); }}
                className="bg-white border border-gray-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>

            {draft && (
              <div className="rounded-lg border border-gray-100 bg-gray-50/50 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-bold text-gray-900">解析结果</div>
                  <button onClick={() => setDraft(null)} className="text-xs text-gray-500 hover:underline">清除</button>
                </div>
                {draft.warning && <div className="text-[11px] text-amber-700">{draft.warning}</div>}
                <div className="grid grid-cols-1 gap-2">
                  <select
                    value={draft.type}
                    onChange={(e) => setDraft({ ...draft, type: e.target.value as any })}
                    className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  >
                    <option value="task">待办提醒</option>
                    <option value="event">日程</option>
                  </select>
                  <input
                    value={draft.title}
                    onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                    className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                    placeholder="标题"
                  />
                  <input
                    type="date"
                    value={draft.date}
                    onChange={(e) => setDraft({ ...draft, date: e.target.value })}
                    className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                  {draft.type === 'event' && (
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="time"
                        value={draft.start_time || '09:00'}
                        onChange={(e) => setDraft({ ...draft, start_time: e.target.value })}
                        className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                      />
                      <input
                        type="time"
                        value={draft.end_time || '18:00'}
                        onChange={(e) => setDraft({ ...draft, end_time: e.target.value })}
                        className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                      />
                    </div>
                  )}
                </div>

                <button
                  disabled={saving || !draft.title.trim() || !draft.date}
                  onClick={async () => {
                    if (!draft) return;
                    setSaving(true);
                    try {
                      if (draft.type === 'task') {
                        const base = new Date();
                        const parts = String(draft.date).split('-').map((x) => parseInt(x, 10));
                        let dueAt: string | null = null;
                        if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
                          const d = new Date(base);
                          d.setFullYear(parts[0], parts[1] - 1, parts[2]);
                          d.setHours(base.getHours(), base.getMinutes(), 0, 0);
                          dueAt = d.toISOString();
                        }
                        await api.createPlannerItem(userId, {
                          type: 'task',
                          title: `提醒：${draft.title.trim()}`,
                          due_at: dueAt,
                          status: 'open',
                          priority: 'medium',
                          list_id: null,
                        });
                      } else {
                        const s = toIsoFromLocal(draft.date, String(draft.start_time || '09:00'));
                        const e = toIsoFromLocal(draft.date, String(draft.end_time || '18:00'));
                        await api.createPlannerItem(userId, {
                          type: 'event',
                          title: draft.title.trim(),
                          start_at: s,
                          end_at: e,
                          status: 'open',
                          priority: 'medium',
                          list_id: null,
                        });
                      }
                      setText('');
                      setTouched(false);
                      setDueDate(toYmd(new Date()));
                      setDraft(null);
                      setOpen(false);
                    } finally {
                      setSaving(false);
                    }
                  }}
                  className="w-full inline-flex items-center justify-center gap-2 bg-primary text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
                >
                  <Plus className="w-4 h-4" />
                  {saving ? '添加中…' : '确认添加'}
                </button>
              </div>
            )}
            <button
              disabled={disabled}
              onClick={async () => {
                const t = String(text || '').trim();
                if (!t) return;
                setParsing(true);
                try {
                  const tzOffsetMinutes = new Date().getTimezoneOffset();
                  try {
                    const res = await api.parsePlannerText(userId, { text: t, listId: null, tzOffsetMinutes });
                    const suggestion = res?.suggestion;
                    const date = typeof suggestion?.date === 'string' && suggestion.date ? suggestion.date : (dueDate || toYmd(new Date()));
                    setDraft({
                      type: suggestion?.type === 'event' ? 'event' : 'task',
                      title: String(suggestion?.title || sanitizeTitle(t, t)).trim() || t,
                      date,
                      start_time: suggestion?.start_time || null,
                      end_time: suggestion?.end_time || null,
                      warning: res?.warning || null,
                    });
                    if (!touched && suggestion?.date) setDueDate(suggestion.date);
                  } catch {
                    const date = dueDate || toYmd(new Date());
                    setDraft({
                      type: 'task',
                      title: sanitizeTitle(t, t) || t,
                      date,
                      start_time: null,
                      end_time: null,
                      warning: 'AI 解析失败，已使用本地解析（可手动调整）',
                    });
                  }
                } finally {
                  setParsing(false);
                }
              }}
              className="w-full inline-flex items-center justify-center gap-2 bg-primary text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
              {parsing ? '解析中…' : '解析'}
            </button>
            <div className="text-[11px] text-gray-400">支持：今天/明天/后天/下周一~下周日。</div>
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        className="w-12 h-12 rounded-full bg-primary text-white shadow-lg hover:bg-primary/90 flex items-center justify-center"
        title="快速记录"
      >
        <Plus className="w-6 h-6" />
      </button>
    </div>
  );
}
