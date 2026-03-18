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
  const [drafts, setDrafts] = useState<any[]>([]);
  const disabled = useMemo(() => saving || parsing || !text.trim(), [saving, parsing, text]);

  const toIsoFromLocal = (date: string, time: string) => {
    const t = /^\d{2}:\d{2}$/.test(time) ? time : '09:00';
    return new Date(`${date}T${t}:00`).toISOString();
  };

  const makeDueAtIso = (date: string) => {
    const base = new Date();
    const parts = String(date).split('-').map((x) => parseInt(x, 10));
    if (parts.length !== 3 || !parts.every((n) => Number.isFinite(n))) return null;
    const d = new Date(base);
    d.setFullYear(parts[0], parts[1] - 1, parts[2]);
    d.setHours(base.getHours(), base.getMinutes(), 0, 0);
    return d.toISOString();
  };


  const undoCreated = async () => {
    const allIds = drafts.flatMap(d => d.createdIds || []);
    if (!allIds.length) return;
    setSaving(true);
    try {
      await Promise.all(allIds.map((id) => api.deletePlannerItem(id, userId)));
      setDrafts([]);
    } finally {
      setSaving(false);
    }
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

            {drafts.length > 0 && (
              <div className="rounded-lg border border-gray-100 bg-gray-50/50 p-3 space-y-2 max-h-60 overflow-y-auto">
                <div className="flex items-center justify-between sticky top-0 bg-gray-50/90 backdrop-blur-sm pb-2 z-10">
                  <div className="text-xs font-bold text-gray-900">解析结果 ({drafts.length}个)</div>
                  <button onClick={() => setDrafts([])} className="text-xs text-gray-500 hover:underline">清除</button>
                </div>
                {drafts.some(d => d.warning) && <div className="text-[11px] text-amber-700">{drafts.find(d => d.warning)?.warning}</div>}
                
                {drafts.map((draft, idx) => (
                  <div key={idx} className="bg-white border border-gray-100 rounded-md p-2 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-gray-700">事件 {idx + 1}</span>
                      <span className="text-[10px] text-gray-500">{draft.type === 'event' ? '日程' : '待办'}</span>
                    </div>
                    <input
                      value={draft.title}
                      readOnly
                      className="w-full bg-gray-50 border border-gray-200 rounded px-2 py-1 text-xs text-gray-600 focus:outline-none"
                    />
                    <div className="flex gap-2">
                      <input
                        type="date"
                        value={draft.date}
                        readOnly
                        className="flex-1 bg-gray-50 border border-gray-200 rounded px-2 py-1 text-xs text-gray-600 focus:outline-none"
                      />
                    </div>
                  </div>
                ))}

                <button
                  disabled={saving || drafts.flatMap(d => d.createdIds || []).length === 0}
                  onClick={undoCreated}
                  className="w-full inline-flex items-center justify-center gap-2 bg-white border border-gray-200 text-gray-900 px-4 py-2 mt-2 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
                >
                  <X className="w-4 h-4" />
                  {saving ? '撤回中…' : '撤回全部'}
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
                    const suggestions = Array.isArray(res?.suggestions) ? res.suggestions : (res?.suggestion ? [res.suggestion] : []);
                    
                    if (suggestions.length === 0) throw new Error('No suggestions');

                    const newDrafts = [];
                    for (const suggestion of suggestions) {
                      const date = typeof suggestion?.date === 'string' && suggestion.date ? suggestion.date : (dueDate || toYmd(new Date()));
                      const draftItem = {
                        type: suggestion?.type === 'event' ? 'event' : 'task',
                        title: String(suggestion?.title || sanitizeTitle(t, t)).trim() || t,
                        date,
                        start_time: suggestion?.start_time || null,
                        end_time: suggestion?.end_time || null,
                        warning: res?.warning || null,
                        createdIds: [] as string[],
                      };

                      if (draftItem.type === 'task') {
                        const dueAt = makeDueAtIso(draftItem.date);
                        const created = await api.createPlannerItem(userId, {
                          type: 'task',
                          title: `提醒：${String(draftItem.title).trim()}`,
                          due_at: dueAt,
                          status: 'open',
                          priority: 'medium',
                          list_id: null,
                        });
                        if (created?.id) draftItem.createdIds.push(String(created.id));
                      } else {
                        const s = toIsoFromLocal(draftItem.date, String(draftItem.start_time || '09:00'));
                        const e = toIsoFromLocal(draftItem.date, String(draftItem.end_time || '18:00'));
                        const created = await api.createPlannerItem(userId, {
                          type: 'event',
                          title: String(draftItem.title).trim(),
                          start_at: s,
                          end_at: e,
                          status: 'open',
                          priority: 'medium',
                          list_id: null,
                        });
                        if (created?.id) draftItem.createdIds.push(String(created.id));
                      }
                      newDrafts.push(draftItem);
                    }

                    setDrafts(newDrafts);
                    if (!touched && suggestions[0]?.date) setDueDate(suggestions[0].date);
                    setText('');
                  } catch {
                    const date = dueDate || toYmd(new Date());
                    const title = sanitizeTitle(t, t) || t;
                    const dueAt = makeDueAtIso(date);
                    const created = await api.createPlannerItem(userId, {
                      type: 'task',
                      title: `提醒：${title}`,
                      due_at: dueAt,
                      status: 'open',
                      priority: 'medium',
                      list_id: null,
                    });
                    setDrafts([{
                      type: 'task',
                      title,
                      date,
                      start_time: null,
                      end_time: null,
                      warning: 'AI 解析失败，已使用本地解析',
                      createdIds: created?.id ? [String(created.id)] : [],
                    }]);
                    setText('');
                  }
                } finally {
                  setParsing(false);
                }
              }}
              className="w-full inline-flex items-center justify-center gap-2 bg-primary text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
              {parsing ? '添加中…' : '解析并添加'}
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
