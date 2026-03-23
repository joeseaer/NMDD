const OpenAI = require('openai');
const { getLlmApiKey, getLlmModel, getOpenAIClientOptions } = require('./llmConfig');

let openaiClient = null;

function getModel() {
  return getLlmModel();
}

function extractJsonObject(text) {
  if (!text || typeof text !== 'string') return null;
  const cleaned = text.replace(/```json\n|```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {}
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  const candidate = cleaned.slice(start, end + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function getOpenAIClientOrNull() {
  if (openaiClient) return openaiClient;
  const apiKey = getLlmApiKey();
  if (!apiKey) return null;
  openaiClient = new OpenAI(getOpenAIClientOptions());
  return openaiClient;
}

function toUtcIsoFromLocalParts({ yyyy, mm, dd, hh, mi, tzOffsetMinutes }) {
  const utcMillis = Date.UTC(yyyy, mm - 1, dd, hh, mi, 0, 0) + (Number(tzOffsetMinutes) || 0) * 60000;
  return new Date(utcMillis).toISOString();
}

function toYmd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseDateExpressionToYmd(expr, baseDate) {
  const s = String(expr || '').trim();
  if (!s) return '';

  const ymd = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (ymd) {
    const yy = parseInt(ymd[1], 10);
    const mm = parseInt(ymd[2], 10);
    const dd = parseInt(ymd[3], 10);
    if ([yy, mm, dd].every(Number.isFinite)) return `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  }

  const md = s.match(/(\d{1,2})月(\d{1,2})(日|号)/);
  if (md) {
    const mm = parseInt(md[1], 10);
    const dd = parseInt(md[2], 10);
    if ([mm, dd].every(Number.isFinite)) {
      const d = new Date(baseDate);
      d.setMonth(mm - 1, dd);
      d.setHours(0, 0, 0, 0);
      const b = new Date(baseDate);
      b.setHours(0, 0, 0, 0);
      if (d.getTime() < b.getTime()) d.setFullYear(d.getFullYear() + 1);
      return toYmd(d);
    }
  }

  return guessDueDateFromText(s, baseDate) || '';
}

function sanitizeTitle(inputTitle, rawText) {
  const base = String(inputTitle || rawText || '').trim();
  const stripped = base
    .replace(/\d{4}-\d{1,2}-\d{1,2}/g, '')
    .replace(/\d{1,2}月\d{1,2}日/g, '')
    .replace(/\d{1,2}月/g, '')
    .replace(/\d{1,2}号/g, '')
    .replace(/从/g, '')
    .replace(/到/g, '')
    .replace(/每天|每日/g, '')
    .replace(/都要|要/g, '')
    .replace(/提醒我/g, '')
    .replace(/提醒/g, '')
    .replace(/(今天|明天|后天|下周[一二三四五六日天])/g, '')
    .replace(/[，,。\.、\s]+/g, ' ')
    .trim();
  return stripped || base;
}

function guessDueDateFromText(text, baseDate) {
  const s = String(text || '').trim();
  if (!s) return '';
  if (s.includes('后天')) {
    const d = new Date(baseDate);
    d.setDate(d.getDate() + 2);
    return toYmd(d);
  }
  if (s.includes('明天')) {
    const d = new Date(baseDate);
    d.setDate(d.getDate() + 1);
    return toYmd(d);
  }
  if (s.includes('今天')) return toYmd(baseDate);

  const nextWeekMatch = s.match(/下周([一二三四五六日天])/);
  if (nextWeekMatch) {
    const map = { '日': 0, '天': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6 };
    const wd = map[nextWeekMatch[1]];
    if (typeof wd === 'number') {
      const d = new Date(baseDate);
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
      const d = new Date(baseDate);
      d.setMonth(mm - 1, dd);
      d.setHours(0, 0, 0, 0);
      const b = new Date(baseDate);
      b.setHours(0, 0, 0, 0);
      if (d.getTime() < b.getTime()) d.setFullYear(d.getFullYear() + 1);
      return toYmd(d);
    }
  }

  return '';
}

async function parsePlannerText({ text, tzOffsetMinutes }) {
  const raw = String(text || '').trim();
  if (!raw) return { ok: false, error: 'empty_text' };

  const baseDate = new Date();

  const rangeMatch = raw.match(/从(.+?)到(.+?)(每天|每日)/);
  if (rangeMatch) {
    const startExpr = rangeMatch[1];
    const endExpr = rangeMatch[2];
    const startDate = parseDateExpressionToYmd(startExpr, baseDate);
    const endDate = parseDateExpressionToYmd(endExpr, baseDate);
    const title = sanitizeTitle(raw, raw);
    if (startDate && endDate) {
      return {
        ok: true,
        source: 'rule',
        suggestion: {
          type: 'task',
          title,
          date: startDate,
          start_time: null,
          end_time: null,
          series: { start_date: startDate, end_date: endDate, frequency: 'daily' },
        },
        warning: null,
      };
    }
    return {
      ok: true,
      source: 'rule',
      suggestion: {
        type: 'task',
        title,
        date: startDate || endDate || '',
        start_time: null,
        end_time: null,
        series: { start_date: startDate || '', end_date: endDate || '', frequency: 'daily' },
      },
      warning: '无法确认起止日期，请手动调整',
    };
  }
  const fallbackDate = guessDueDateFromText(raw, baseDate) || toYmd(baseDate);
  const fallbackTitle = sanitizeTitle(raw, raw);
  const fallback = {
    ok: true,
    source: 'fallback',
    suggestions: [{
      type: 'task',
      title: fallbackTitle,
      date: fallbackDate,
      start_time: null,
      end_time: null,
    }],
    warning: null,
  };

  const client = getOpenAIClientOrNull();
  if (!client) return fallback;

  const now = new Date();
  const nowText = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  const prompt = `你是一个日程/待办的自然语言解析器。

当前日期：${nowText}
用户原话：${raw}

任务：把用户原话解析为【一个或多个】“待办(task)”或“日程(event)”。
- 用户可能会一次性说多个事情（例如：“今天先做A，再做B，再做C”），请将它们拆分为多个独立的 task/event 对象放入数组。
- 如果原话是某一天要做某事、提醒、记得、要完成：更像 task。
- 如果原话是某天的活动、会议、约见、出去玩：更像 event。
- 需要识别日期（支持：YYYY-MM-DD、X月X日、今天/明天/后天、下周一~下周日）。
- 如果用户写了明显不合法的日期（例如 36月），请推断最可能的真实日期，并在 warnings 里说明；如果无法推断，则把 date 留空并在 warnings 里说明需要用户确认。
- title 必须尽量去掉日期/时间词，只保留事情本身。例如“3月26号出去玩”应输出 title="出去玩"。

只输出 JSON（不要 markdown）。格式如下：
{
  "suggestions": [
    {
      "type": "task"|"event",
      "title": string,
      "date": "YYYY-MM-DD"|"",
      "start_time": "HH:MM"|"" ,
      "end_time": "HH:MM"|""
    }
  ],
  "warnings": string[]
}`;

  try {
    const completion = await client.chat.completions.create({
      model: getModel(),
      messages: [{ role: 'system', content: prompt }],
    });
    const parsed = extractJsonObject(completion?.choices?.[0]?.message?.content);
    if (!parsed || typeof parsed !== 'object') return fallback;

    const warnings = Array.isArray(parsed.warnings) ? parsed.warnings.map((x) => String(x)).filter(Boolean) : [];
    const suggestionsArray = Array.isArray(parsed.suggestions) ? parsed.suggestions : (parsed.type ? [parsed] : []);

    const finalSuggestions = suggestionsArray.map(item => {
      const t = item.type === 'event' ? 'event' : 'task';
      const title = sanitizeTitle(item.title, raw);
      const date = typeof item.date === 'string' ? item.date.trim() : '';
      const start_time = typeof item.start_time === 'string' ? item.start_time.trim() : '';
      const end_time = typeof item.end_time === 'string' ? item.end_time.trim() : '';
      
      const okDate = /^\d{4}-\d{2}-\d{2}$/.test(date);
      return {
        type: t,
        title,
        date: okDate ? date : '',
        start_time: start_time || null,
        end_time: end_time || null,
      };
    }).filter(s => s.title);

    if (finalSuggestions.length === 0) return fallback;

    return {
      ok: true,
      source: 'llm',
      suggestions: finalSuggestions,
      warning: warnings.length ? warnings.join('；') : null,
    };
  } catch {
    return fallback;
  }
}

function buildPlannerItemFromSuggestion({ suggestion, tzOffsetMinutes, listId }) {
  const date = String(suggestion.date || '').trim();
  const [yy, mm, dd] = date.split('-').map((x) => parseInt(x, 10));
  if (![yy, mm, dd].every(Number.isFinite)) {
    return { ok: false, error: 'invalid_date' };
  }
  const type = suggestion.type === 'event' ? 'event' : 'task';
  const title = String(suggestion.title || '').trim();
  if (!title) return { ok: false, error: 'empty_title' };

  if (type === 'task') {
    const now = new Date();
    const dueIso = toUtcIsoFromLocalParts({
      yyyy: yy,
      mm,
      dd,
      hh: now.getHours(),
      mi: now.getMinutes(),
      tzOffsetMinutes,
    });
    return {
      ok: true,
      item: {
        type: 'task',
        title,
        due_at: dueIso,
        status: 'open',
        priority: 'medium',
        list_id: listId || null,
      },
    };
  }

  const start = String(suggestion.start_time || '').trim();
  const end = String(suggestion.end_time || '').trim();
  let sh = 9;
  let smi = 0;
  let eh = 18;
  let emi = 0;
  if (/^\d{2}:\d{2}$/.test(start)) {
    sh = parseInt(start.slice(0, 2), 10);
    smi = parseInt(start.slice(3, 5), 10);
  }
  if (/^\d{2}:\d{2}$/.test(end)) {
    eh = parseInt(end.slice(0, 2), 10);
    emi = parseInt(end.slice(3, 5), 10);
  }

  const startIso = toUtcIsoFromLocalParts({ yyyy: yy, mm, dd, hh: sh, mi: smi, tzOffsetMinutes });
  const endIso = toUtcIsoFromLocalParts({ yyyy: yy, mm, dd, hh: eh, mi: emi, tzOffsetMinutes });

  return {
    ok: true,
    item: {
      type: 'event',
      title,
      start_at: startIso,
      end_at: endIso,
      status: 'open',
      priority: 'medium',
      list_id: listId || null,
    },
  };
}

module.exports = {
  parsePlannerText,
  buildPlannerItemFromSuggestion,
};

