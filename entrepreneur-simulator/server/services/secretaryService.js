const OpenAI = require('openai');
const dbService = require('./dbService');

let openaiClient = null;

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

async function getSecretaryDaily({ userId }) {
  const uid = userId || 'user-1';
  const people = await dbService.getPeopleProfiles(uid);
  const now = new Date();
  const nowText = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  const payload = (people || []).slice(0, 30).map((p) => ({
    id: p.id,
    name: p.name,
    identity: p.identity,
    field: p.field,
    tags: p.tags,
    relationship_strength: p.relationship_strength,
    last_interaction_date: p.last_interaction_date,
    last_interaction: p.last_interaction,
    private_info: typeof p.private_info === 'string' ? p.private_info.slice(0, 2000) : null,
  }));

  const client = getOpenAIClientOrNull();
  if (!client) {
    return { available: false, suggestions: [], message: 'OPENAI_API_KEY 未配置' };
  }

  const prompt = `你是用户的“精神秘书”。\n\n当前日期：${nowText}\n用户希望：在未来 7 天内给出“该联系谁/该约什么活动”的提醒建议。\n\n你会收到一组人物档案数据（可能包含深度分析档案 private_info、最近互动摘要、关系强度）。\n输出必须是 JSON（不要 markdown），字段：\n{\n  "suggestions": [\n    {\n      "person_id": string,\n      "person_name": string,\n      "when": "today"|"tomorrow"|"this_week",\n      "reason": string,\n      "action": string\n    }\n  ],\n  "notes": string[]\n}\n\n规则：\n- suggestions 最多 3 条；尽量挑关系强度高、很久没联系、或 private_info/last_interaction 暗示需要推进的。\n- action 必须是可执行的一句话（例如“发微信问候并约 30 分钟电话”）。\n- reason 30 字以内。\n\n人物数据：\n${JSON.stringify(payload)}`;

  try {
    const completion = await client.chat.completions.create({
      model: getModel(),
      messages: [{ role: 'system', content: prompt }],
    });
    const parsed = extractJsonObject(completion?.choices?.[0]?.message?.content);
    if (!parsed || typeof parsed !== 'object') {
      return { available: true, suggestions: [], message: 'AI 输出解析失败' };
    }
    const suggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
    const notes = Array.isArray(parsed.notes) ? parsed.notes.map((x) => String(x)).filter(Boolean) : [];
    return {
      available: true,
      suggestions: suggestions
        .map((s) => ({
          person_id: String(s.person_id || ''),
          person_name: String(s.person_name || ''),
          when: String(s.when || ''),
          reason: String(s.reason || ''),
          action: String(s.action || ''),
        }))
        .filter((s) => s.person_id && s.person_name && s.action)
        .slice(0, 3),
      notes,
    };
  } catch (e) {
    return { available: true, suggestions: [], message: e?.message || 'AI 请求失败' };
  }
}

module.exports = { getSecretaryDaily };

