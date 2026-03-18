const OpenAI = require('openai');
const dbService = require('./dbService');

let openaiClient = null;

const dailyCache = new Map();

function toDateKeyLocal(d) {
  const x = d instanceof Date ? d : new Date();
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

function getModel() {
  const m = process.env.OPENAI_MODEL;
  if (m && String(m).trim()) return String(m).trim();
  const base = String(process.env.OPENAI_BASE_URL || '');
  if (base.includes('dashscope.aliyuncs.com')) return 'qwen-plus';
  return 'doubao-seed-2-0-pro-260215';
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
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  openaiClient = new OpenAI({ apiKey, baseURL: process.env.OPENAI_BASE_URL });
  return openaiClient;
}

async function getSecretaryDaily({ userId, refresh }) {
  const uid = userId || 'user-1';
  const now = new Date();
  const nowText = toDateKeyLocal(now);

  const cacheKey = `${uid}:${nowText}:v2`;
  if (!refresh && dailyCache.has(cacheKey)) {
    const cached = dailyCache.get(cacheKey);
    return { ...cached, cached: true, date: nowText };
  }

  // 1. 获取所有人物数据（并精简）
  const people = await dbService.getPeopleProfiles(uid);
  const peoplePayload = (people || []).slice(0, 30).map((p) => ({
    id: p.id,
    name: p.name,
    identity: p.identity,
    relationship_strength: p.relationship_strength,
    last_interaction_date: p.last_interaction_date,
    last_interaction: p.last_interaction,
    private_info: typeof p.private_info === 'string' ? p.private_info.slice(0, 500) : null,
  }));

  // 2. 获取近期待办和日程（前50条未完成任务或近期日程）
  const start = new Date(now);
  start.setDate(start.getDate() - 3); // 过去3天
  const end = new Date(now);
  end.setDate(end.getDate() + 14); // 未来14天

  const [events, tasks] = await Promise.all([
    dbService.listPlannerItems({ userId: uid, type: 'event', startAt: start.toISOString(), endAt: end.toISOString() }),
    dbService.listPlannerItems({ userId: uid, type: 'task', status: 'open' }),
  ]);

  const plannerPayload = {
    events: (events || []).map(e => ({ id: e.id, title: e.title, start: e.start_at, end: e.end_at })),
    tasks: (tasks || []).slice(0, 30).map(t => ({ id: t.id, title: t.title, due: t.due_at }))
  };

  // 3. 获取近期 SOP/笔记摘要（前10条）
  const sops = await dbService.getSOPs(uid);
  const sopPayload = (sops || []).slice(0, 10).map(s => ({
    id: s.id,
    title: s.title,
    category: s.category,
    content_preview: typeof s.content === 'string' ? s.content.slice(0, 100) : ''
  }));

  const client = getOpenAIClientOrNull();
  if (!client) {
    const res = { available: false, suggestions: [], general_reminders: [], message: 'OPENAI_API_KEY 未配置', cached: false, date: nowText };
    dailyCache.set(cacheKey, res);
    return res;
  }

  const prompt = `你是用户的“全能精神秘书”。

当前日期：${nowText}
目标：基于用户的人脉网络、待办日程以及近期的经验随笔，给出当天或近几天的【综合行动建议与提醒】。

你将收到以下数据：
1. 【人脉库】：包含关系强度、上次互动及深度性格分析。
2. 【日程与待办】：用户记录的近期日程事件及未完成的任务。
3. 【随笔与经验】：用户最近记录的感悟或SOP。

请输出 JSON 格式（不要 markdown 标记），包含以下两个数组：
{
  "suggestions": [
    {
      "person_id": string,
      "person_name": string,
      "when": "today"|"tomorrow"|"this_week",
      "reason": string (30字以内),
      "action": string (可执行的一句话，如"发微信问候并约30分钟电话")
    }
  ],
  "general_reminders": [
    {
      "type": "task" | "idea" | "warning",
      "title": string (简短标题),
      "content": string (具体的提醒内容，结合了待办或随笔的洞察，50字以内),
      "priority": "high" | "medium" | "low"
    }
  ]
}

规则：
- suggestions：最多 3 条；专注【人脉维护】，挑选关系强度高需维护、或很久没联系、或性格分析暗示需要推进的人。
- general_reminders：最多 3 条；专注【事务与认知提醒】。可以是对某个重要待办的催促、对某个日程的提前准备建议、或者是结合某篇近期随笔给出今天的行为准则（例如"你前天随笔写到要注意情绪控制，今天下午有重要会议，请注意深呼吸"）。如果没有特别要提醒的，可以少于3条。

【数据输入】
人脉库: ${JSON.stringify(peoplePayload)}
日程与待办: ${JSON.stringify(plannerPayload)}
随笔与经验: ${JSON.stringify(sopPayload)}
`;

  try {
    const completion = await client.chat.completions.create({
      model: getModel(),
      messages: [{ role: 'system', content: prompt }],
    });
    const parsed = extractJsonObject(completion?.choices?.[0]?.message?.content);
    if (!parsed || typeof parsed !== 'object') {
      const res = { available: true, suggestions: [], general_reminders: [], message: 'AI 输出解析失败', cached: false, date: nowText };
      dailyCache.set(cacheKey, res);
      return res;
    }
    
    const suggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
    const general_reminders = Array.isArray(parsed.general_reminders) ? parsed.general_reminders : [];
    
    const res = {
      available: true,
      suggestions: suggestions
        .map((s) => ({
          person_id: String(s.person_id || ''),
          person_name: String(s.person_name || ''),
          when: String(s.when || ''),
          reason: String(s.reason || ''),
          action: String(s.action || ''),
        }))
        .filter((s) => s.person_name && s.action)
        .slice(0, 3),
      general_reminders: general_reminders
        .map((g) => ({
          type: String(g.type || 'idea'),
          title: String(g.title || ''),
          content: String(g.content || ''),
          priority: String(g.priority || 'medium'),
        }))
        .filter((g) => g.title && g.content)
        .slice(0, 3),
      cached: false,
      date: nowText,
    };
    dailyCache.set(cacheKey, res);
    return res;
  } catch (e) {
    const res = { available: true, suggestions: [], general_reminders: [], message: e?.message || 'AI 请求失败', cached: false, date: nowText };
    dailyCache.set(cacheKey, res);
    return res;
  }
}

module.exports = { getSecretaryDaily, getOpenAIClientOrNull, getModel };

