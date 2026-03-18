const sceneService = require('../services/sceneService');
const chatService = require('../services/chatService');
const dbService = require('../services/dbService');
const plannerAssistantService = require('../services/plannerAssistantService');
const secretaryService = require('../services/secretaryService');
const crypto = require('crypto');

const normalizeForHash = (v) => {
  if (v === undefined || v === null) return '';
  if (Array.isArray(v)) return v.map(normalizeForHash);
  if (typeof v === 'object') {
    const keys = Object.keys(v).sort();
    const out = {};
    keys.forEach((k) => {
      out[k] = normalizeForHash(v[k]);
    });
    return out;
  }
  return String(v).trim().replace(/\s+/g, ' ');
};

const sha256 = (obj) => {
  const normalized = normalizeForHash(obj);
  return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
};

const parsePrivateInfoToAnalysis = (privateInfo) => {
  const empty = {
    layer_1_core: { personality_traits: '', core_values: '', cognitive_mode: '', emotional_energy: '' },
    layer_2_drive: { motivation_system: '', skills_capabilities: '', resource_network: '' },
    layer_3_surface: { behavior_habits: '', life_trajectory: '', current_status_path: '' },
    verification_checklists: {},
  };

  if (!privateInfo || typeof privateInfo !== 'string') return empty;
  const raw = privateInfo.trim();
  if (!raw) return empty;

  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object') {
      return {
        layer_1_core: { ...empty.layer_1_core, ...(obj.layer_1_core || {}) },
        layer_2_drive: { ...empty.layer_2_drive, ...(obj.layer_2_drive || {}) },
        layer_3_surface: { ...empty.layer_3_surface, ...(obj.layer_3_surface || {}) },
        verification_checklists: obj.verification_checklists && typeof obj.verification_checklists === 'object' ? obj.verification_checklists : {},
      };
    }
  } catch {}

  return {
    ...empty,
    layer_3_surface: { ...empty.layer_3_surface, current_status_path: raw },
  };
};

function summarizeMindMapContent(content) {
  const text = typeof content === 'string' ? content : '';
  const hasFence = text.includes('```mindmap');
  const hasDiv = text.includes('data-type="mind-map"') || text.includes("data-type='mind-map'");
  const idx = hasFence ? text.indexOf('```mindmap') : (hasDiv ? text.indexOf('data-type') : -1);
  const snippet = idx >= 0
    ? text.slice(Math.max(0, idx - 60), Math.min(text.length, idx + 240))
    : '';
  return {
    len: text.length,
    hasFence,
    hasDiv,
    snippet,
  };
}

async function routes(fastify, options) {
  
  // Scene Generation
  fastify.post('/scene/create', async (request, reply) => {
    try {
      const { user_id, goal } = request.body;
      const userProfile = {
        level: "Lv.12",
        strengths: ["Initial Approach"],
        weaknesses: ["High-Stakes Negotiation"]
      };
      
      const scene = await sceneService.generateScene(userProfile, goal);
      return scene;
    } catch (err) {
      request.log.error(err);
      reply.code(500).send({ error: 'Failed to generate scene' });
    }
  });

  // Scene Interaction (Chat) - Usually handled via WebSocket, but here's an API fallback
  fastify.post('/scene/chat', async (request, reply) => {
    try {
      const { scene_id, user_input, conversation_history, npc_profile, context, emotion_state } = request.body;
      const response = await sceneService.processInteraction({ scene_id, user_input, conversation_history, npc_profile, context, emotion_state });
      return response;
    } catch (err) {
      request.log.error(err);
      reply.code(500).send({ error: 'Interaction failed' });
    }
  });

  // Scene Completion & Feedback
  fastify.post('/scene/analyze', async (request, reply) => {
    try {
      const sceneData = request.body;
      const analysis = await sceneService.analyzeScene(sceneData);
      return analysis;
    } catch (err) {
      request.log.error(err);
      reply.code(500).send({ error: 'Scene analysis failed' });
    }
  });

  fastify.post('/scene/complete', async (request, reply) => {
    try {
      const { scene_id, conversation_log, final_result } = request.body;
      const feedback = await sceneService.assessConversation(conversation_log, final_result);
      
      // Save to DB
      await dbService.saveScene({
        ...request.body,
        ai_feedback: feedback
      });
      
      return { feedback };
    } catch (err) {
      request.log.error(err);
      reply.code(500).send({ error: 'Completion failed' });
    }
  });

  // Get User History
  fastify.get('/history/:userId', async (request, reply) => {
    const { userId } = request.params;
    const { limit } = request.query;
    const history = await dbService.getRecentScenes(userId, limit ? parseInt(limit) : 20);
    return history;
  });

  // SOP Management
  fastify.get('/sop/:userId', async (request, reply) => {
    const { userId } = request.params;
    const sops = await dbService.getSOPs(userId);

    try {
      const mindmapCount = (sops || []).filter((s) => summarizeMindMapContent(s.content).hasFence || summarizeMindMapContent(s.content).hasDiv).length;
      request.log.info({ userId, count: (sops || []).length, mindmapCount }, 'Fetched SOPs');
    } catch {}

    return sops;
  });

  fastify.post('/sop/create', async (request, reply) => {
    try {
      const sopData = request.body;
      const mm = summarizeMindMapContent(sopData?.content);
      request.log.info({ title: sopData?.title, id: sopData?.id, user_id: sopData?.user_id, ...mm }, 'Saving SOP');
      const id = await dbService.saveSOP(sopData);
      request.log.info({ id }, 'SOP Saved');
      return { id, message: "SOP Created Successfully" };
    } catch (err) {
      request.log.error(err);
      reply.code(500).send({ error: err.message || 'Failed to save SOP' });
    }
  });

  fastify.delete('/sop/:id', async (request, reply) => {
    try {
        const { id } = request.params;
        await dbService.deleteSOP(id);
        return { message: "SOP Deleted Successfully" };
    } catch (err) {
        request.log.error(err);
        reply.code(500).send({ error: 'Failed to delete SOP' });
    }
  });

  // Chat Assistant (API endpoint for non-realtime usage)
  fastify.post('/assistant/chat', async (request, reply) => {
    try {
      const { userId, query } = request.body;
      const history = await dbService.getRecentScenes(userId);
      const sops = await dbService.getSOPs(userId);
      
      const response = await chatService.processAssistantMessage({ userId, query, history, sops });
      return response;
    } catch (err) {
      request.log.error(err);
      reply.code(500).send({ error: 'Assistant failed' });
    }
  });

  // People Profile Management
  fastify.get('/people/:userId', async (request, reply) => {
    const { userId } = request.params;
    const profiles = await dbService.getPeopleProfiles(userId);
    return profiles;
  });

  fastify.post('/people/create', async (request, reply) => {
    try {
      const profileData = request.body;
      const id = await dbService.savePersonProfile(profileData);
      return { id, message: "Person Profile Saved Successfully" };
    } catch (err) {
      request.log.error(err);
      reply.code(500).send({ error: 'Failed to save Person Profile', detail: err?.message });
    }
  });

  fastify.put('/people/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const profileData = { ...request.body, id };
      const updatedId = await dbService.savePersonProfile(profileData);
      return { id: updatedId, message: "Person Profile Updated Successfully" };
    } catch (err) {
      request.log.error(err);
      reply.code(500).send({ error: 'Failed to update Person Profile' });
    }
  });

  fastify.delete('/people/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      await dbService.deletePersonProfile(id);
      return { id, message: 'Person Profile Deleted Successfully' };
    } catch (err) {
      request.log.error(err);
      reply.code(500).send({ error: 'Failed to delete Person Profile', detail: err?.message });
    }
  });

  fastify.get('/planner/lists/:userId', async (request, reply) => {
    try {
      const { userId } = request.params;
      await dbService.ensurePlannerInbox(userId);
      const lists = await dbService.getPlannerLists(userId);
      return lists;
    } catch (err) {
      request.log.error(err);
      reply.code(500).send({ error: 'Failed to fetch planner lists', detail: err?.message });
    }
  });

  fastify.post('/planner/lists', async (request, reply) => {
    try {
      const { userId, name } = request.body || {};
      const list = await dbService.createPlannerList({ userId, name });
      return list;
    } catch (err) {
      request.log.error(err);
      reply.code(500).send({ error: 'Failed to create planner list', detail: err?.message });
    }
  });

  fastify.patch('/planner/lists/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const { userId, patch } = request.body || {};
      const list = await dbService.updatePlannerList({ id, userId, patch: patch || {} });
      return list;
    } catch (err) {
      request.log.error(err);
      reply.code(500).send({ error: 'Failed to update planner list', detail: err?.message });
    }
  });

  fastify.delete('/planner/lists/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const userId = request.query?.userId || request.body?.userId;
      const deletedId = await dbService.deletePlannerList({ id, userId });
      return { id: deletedId };
    } catch (err) {
      request.log.error(err);
      reply.code(500).send({ error: 'Failed to delete planner list', detail: err?.message });
    }
  });

  const dayRange = (nowInput) => {
    const now = nowInput ? new Date(String(nowInput)) : new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    return { start: start.toISOString(), end: end.toISOString() };
  };

  fastify.get('/planner/items/:userId', async (request, reply) => {
    try {
      const { userId } = request.params;
      const { type, status, listId, view, startAt, endAt, now, dueBefore: queryDueBefore } = request.query || {};

      if (type === 'calendar') {
        const [events, tasks] = await Promise.all([
          dbService.listPlannerItems({ userId, type: 'event', status, listId, startAt, endAt }),
          dbService.listPlannerItems({ userId, type: 'task', status, listId, dueAfter: startAt, dueBefore: endAt }),
        ]);
        const combined = [...(events || []), ...(tasks || [])].filter(Boolean);
        combined.sort((a, b) => {
          const ta = a.type === 'task' ? a.due_at : a.start_at;
          const tb = b.type === 'task' ? b.due_at : b.start_at;
          const na = ta ? new Date(ta).getTime() : 0;
          const nb = tb ? new Date(tb).getTime() : 0;
          return na - nb;
        });
        return combined;
      }

      if (view === 'today' || view === 'overdue' || view === 'upcoming') {
        const { start, end } = dayRange(now);
        if (view === 'today') {
          return await dbService.listPlannerItems({ userId, type: 'task', status, listId, dueAfter: start, dueBefore: end });
        }
        if (view === 'overdue') {
          const limit = queryDueBefore || start;
          return await dbService.listPlannerItems({ userId, type: 'task', status: 'open', listId, dueBefore: limit });
        }
        return await dbService.listPlannerItems({ userId, type: 'task', status, listId, dueAfter: end });
      }

      return await dbService.listPlannerItems({ userId, type, status, listId, startAt, endAt });
    } catch (err) {
      request.log.error(err);
      reply.code(500).send({ error: 'Failed to fetch planner items', detail: err?.message });
    }
  });

  fastify.post('/planner/items', async (request, reply) => {
    try {
      const { userId, item } = request.body || {};
      const inbox = await dbService.ensurePlannerInbox(userId);
      const next = { ...(item || {}) };
      if (!next.list_id && inbox?.id) next.list_id = inbox.id;
      const created = await dbService.createPlannerItem({ userId, item: next });
      return created;
    } catch (err) {
      request.log.error(err);
      reply.code(500).send({ error: 'Failed to create planner item', detail: err?.message });
    }
  });

  fastify.post('/planner/nl/parse', async (request, reply) => {
    try {
      const { userId, text, listId, tzOffsetMinutes } = request.body || {};
      const uid = userId || 'user-1';
      if (!text) {
        reply.code(400).send({ error: 'Text is required' });
        return;
      }
      const parsed = await plannerAssistantService.parsePlannerText({ text, tzOffsetMinutes });
      
      if (parsed.suggestion) {
        // legacy compat
        parsed.suggestions = [parsed.suggestion];
        delete parsed.suggestion;
      }

      const items = (parsed.suggestions || []).map(suggestion => {
        const buildRes = plannerAssistantService.buildPlannerItemFromSuggestion({
          suggestion,
          tzOffsetMinutes,
          listId,
        });
        return buildRes.ok ? buildRes.item : null;
      }).filter(Boolean);

      reply.code(200).send({
        ...parsed,
        items
      });
    } catch (err) {
      request.log.error(err);
      reply.code(500).send({ error: 'Failed to parse' });
    }
  });

  fastify.put('/planner/items/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const { userId, patch } = request.body || {};
      const updated = await dbService.updatePlannerItem({ id, userId, patch: patch || {} });
      return updated;
    } catch (err) {
      request.log.error(err);
      reply.code(500).send({ error: 'Failed to update planner item', detail: err?.message });
    }
  });

  fastify.delete('/planner/items/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const userId = request.query?.userId || request.body?.userId;
      const deletedId = await dbService.deletePlannerItem({ id, userId });
      return { id: deletedId };
    } catch (err) {
      request.log.error(err);
      reply.code(500).send({ error: 'Failed to delete planner item', detail: err?.message });
    }
  });

  fastify.patch('/people/:id/profile-analysis', async (request, reply) => {
    try {
      const { id } = request.params;
      const { profile_analysis } = request.body || {};

      const incoming = typeof profile_analysis === 'string'
        ? (() => { try { return JSON.parse(profile_analysis); } catch { return null; } })()
        : (profile_analysis ?? null);

      const profiles = await dbService.getPeopleProfiles('user-1');
      const current = profiles.find(p => p.id === id);
      const base = current && typeof current.private_info === 'string'
        ? (() => { try { return JSON.parse(current.private_info); } catch { return {}; } })()
        : {};

      const next = {
        ...(base && typeof base === 'object' ? base : {}),
        layer_1_core: incoming?.layer_1_core ?? base?.layer_1_core ?? {},
        layer_2_drive: incoming?.layer_2_drive ?? base?.layer_2_drive ?? {},
        layer_3_surface: incoming?.layer_3_surface ?? base?.layer_3_surface ?? {},
      };

      const updatedId = await dbService.updatePersonPrivateInfo(id, JSON.stringify(next));
      return { id: updatedId, message: 'Profile analysis updated' };
    } catch (err) {
      request.log.error(err);
      reply.code(500).send({ error: 'Failed to update profile analysis' });
    }
  });

  fastify.post('/people/:id/ai-suggestion', async (request, reply) => {
    try {
      const { id } = request.params;
      const profiles = await dbService.getPeopleProfiles('user-1');
      const profile = profiles.find(p => p.id === id);
      if (!profile) return reply.code(404).send({ error: 'Person not found' });

      const logs = await dbService.getInteractionLogs(id);
      
      const prompt = `你是用户的“人脉关系顾问”。
目标：基于人物档案和过往互动记录，为用户提供【一句】具体、可执行、自然的跟进建议。

人物信息：
姓名：${profile.name}
身份：${profile.identity}
性格类型(DISC)：${profile.disc_type || '未知'}
关系强度：${profile.relationship_strength}
最近互动：${profile.last_interaction || '无'}
最近互动时间：${profile.last_interaction_date || '无'}

互动历史摘要：
${logs.slice(0, 3).map(l => `- ${l.event_date}: ${l.event_context}。我：${l.my_behavior}。对方：${l.their_reaction}`).join('\n')}

请输出一段JSON，包含 label 和 color 字段。
要求：
1. label: 建议的内容（15个字以内，例如："上周刚聊完，周末可问进度" 或 "很久没联系了，发个微信问候"）
2. color: 根据紧迫程度或情绪基调选择一个 Tailwind CSS 类（例如："bg-red-100 text-red-700" 表示紧急/重要，"bg-blue-100 text-blue-700" 表示日常维系，"bg-green-100 text-green-700" 表示刚联系过很稳固）。

必须只输出 JSON 格式，不要包含任何 markdown 标记：
{
  "label": "🔥 建议文案...",
  "color": "bg-xxx-100 text-xxx-700"
}`;

      const client = secretaryService.getOpenAIClientOrNull ? secretaryService.getOpenAIClientOrNull() : null;
      let suggestionObj = { label: '暂无建议', color: 'bg-gray-100 text-gray-700' };

      if (client) {
        const completion = await client.chat.completions.create({
          model: secretaryService.getModel ? secretaryService.getModel() : 'gpt-3.5-turbo',
          messages: [{ role: 'system', content: prompt }],
        });
        
        try {
          const content = completion?.choices?.[0]?.message?.content || '{}';
          request.log.info({ content }, 'AI suggestion response');
          
          // 尝试更宽容的 JSON 解析
          let cleaned = content.replace(/```json\n|```/g, '').trim();
          const start = cleaned.indexOf('{');
          const end = cleaned.lastIndexOf('}');
          if (start !== -1 && end !== -1 && end > start) {
            cleaned = cleaned.slice(start, end + 1);
          }
          
          const parsed = JSON.parse(cleaned);
          if (parsed.label) {
            suggestionObj = {
              label: parsed.label,
              color: parsed.color || 'bg-gray-100 text-gray-700'
            };
          }
        } catch(e) {
          request.log.error('Failed to parse AI suggestion JSON');
        }
      } else {
        request.log.warn('OpenAI client not initialized for ai-suggestion');
      }

      const updatedId = await dbService.updatePersonAIFollowUp(id, suggestionObj);
      return { id: updatedId, suggestion: suggestionObj };

    } catch (err) {
      request.log.error(err);
      reply.code(500).send({ error: 'Failed to generate AI follow-up suggestion' });
    }
  });

  fastify.patch('/people/:id/reaction-library', async (request, reply) => {
    try {
      const { id } = request.params;
      const { reaction_library } = request.body || {};
      const updatedId = await dbService.updatePersonReactionLibrary(id, reaction_library);
      return { id: updatedId, message: 'Reaction library updated' };
    } catch (err) {
      request.log.error(err);
      reply.code(500).send({ error: 'Failed to update reaction library' });
    }
  });

  fastify.post('/people/analyze', async (request, reply) => {
    try {
        const { personId, currentData } = request.body;
        // Fetch person and logs
        const profiles = await dbService.getPeopleProfiles('user-1'); // Simplified: fetching all to find one is inefficient but works for now. Better to add getPersonById.
        let profile = profiles.find(p => p.id === personId);
        
        if (!profile) return reply.code(404).send({ error: 'Person not found' });

        // If currentData is provided, merge it into profile so the analysis respects manual edits
        if (currentData) {
            profile = { ...profile, ...currentData };
        }

        const logs = await dbService.getInteractionLogs(personId);
        
        const analysis = await chatService.analyzePerson({ profile, logs });
        return analysis;
    } catch (err) {
        request.log.error(err);
        reply.code(500).send({ error: 'Analysis failed' });
    }
  });

  fastify.post('/people/script', async (request, reply) => {
      try {
          const { personId, intent, context } = request.body;
          const profiles = await dbService.getPeopleProfiles('user-1');
          const profile = profiles.find(p => p.id === personId);
          if (!profile) return reply.code(404).send({ error: 'Person not found' });
          
          const logs = await dbService.getInteractionLogs(personId);
          const result = await chatService.generateScript({ profile, logs, intent, context });
          return result;
      } catch (err) {
          request.log.error(err);
          reply.code(500).send({ error: 'Script generation failed' });
      }
  });

  // AI Consultation
  fastify.post('/people/consult', async (request, reply) => {
      try {
          const { personId, query } = request.body;
          const profiles = await dbService.getPeopleProfiles('user-1');
          const profile = profiles.find(p => p.id === personId);
          if (!profile) return reply.code(404).send({ error: 'Person not found' });
          
          const logs = await dbService.getInteractionLogs(personId);
          const result = await chatService.consultPerson({ profile, logs, query });
          return result;
      } catch (err) {
          request.log.error(err);
          reply.code(500).send({ error: 'Consultation failed' });
      }
  });

  // AI Summary & Reminders
  fastify.post('/people/summary', async (request, reply) => {
      try {
          const { personId } = request.body;
          const profiles = await dbService.getPeopleProfiles('user-1');
          const profile = profiles.find(p => p.id === personId);
          if (!profile) return reply.code(404).send({ error: 'Person not found' });
          
          const logs = await dbService.getInteractionLogs(personId);
          const result = await chatService.generateSummary({ profile, logs });
          return result;
      } catch (err) {
          request.log.error(err);
          reply.code(500).send({ error: 'Summary generation failed' });
      }
  });

  // AI Practical Scene Library (Triggers & Pleasers)
  fastify.post('/people/practical-scenes', async (request, reply) => {
    try {
      const { personId } = request.body;
      const profiles = await dbService.getPeopleProfiles('user-1');
      const profile = profiles.find(p => p.id === personId);
      if (!profile) return reply.code(404).send({ error: 'Person not found' });

      const logs = await dbService.getInteractionLogs(personId);
      const result = await chatService.generatePracticalSceneLibrary({ profile, logs });

      await dbService.updatePersonTriggersPleasers(personId, result.triggers, result.pleasers);

      return { triggers: result.triggers, pleasers: result.pleasers };
    } catch (err) {
      request.log.error(err);
      reply.code(500).send({ error: 'Failed to generate practical scenes' });
    }
  });

  // AI Verification Checklist (Iceberg layer)
  fastify.post('/people/verification-checklist', async (request, reply) => {
    try {
      const { personId, layerKey, force } = request.body || {};
      if (!personId || !layerKey) return reply.code(400).send({ error: 'Missing personId or layerKey' });

      const profiles = await dbService.getPeopleProfiles('user-1');
      const profile = profiles.find(p => p.id === personId);
      if (!profile) return reply.code(404).send({ error: 'Person not found' });

      const analysis = parsePrivateInfoToAnalysis(profile.private_info);
      const layerData = analysis[layerKey];
      if (!layerData || typeof layerData !== 'object') return reply.code(400).send({ error: 'Invalid layerKey' });

      const layerTitleMap = {
        layer_1_core: '第一层：底层操作系统',
        layer_2_drive: '第二层：中间驱动层',
        layer_3_surface: '第三层：表层表现层',
      };
      const layerTitle = layerTitleMap[layerKey] || layerKey;

      const currentHash = sha256(layerData);
      const existing = analysis.verification_checklists?.[layerKey];
      if (!force && existing && existing.hash === currentHash && Array.isArray(existing.items)) {
        return { items: existing.items, hash: existing.hash, reused: true };
      }

      const logs = await dbService.getInteractionLogs(personId);
      const result = await chatService.generateVerificationChecklist({
        profile,
        layerKey,
        layerTitle,
        layerData,
        logs,
      });

      const next = {
        ...analysis,
        verification_checklists: {
          ...(analysis.verification_checklists || {}),
          [layerKey]: {
            hash: currentHash,
            items: Array.isArray(result.items) ? result.items : [],
            generated_at: new Date().toISOString(),
          },
        },
      };

      await dbService.updatePersonPrivateInfo(personId, JSON.stringify(next));
      return { items: next.verification_checklists[layerKey].items, hash: currentHash, reused: false };
    } catch (err) {
      request.log.error(err);
      reply.code(500).send({ error: 'Failed to generate verification checklist', detail: err?.message });
    }
  });

  // Interaction Logs
  fastify.get('/interaction/:personId', async (request, reply) => {
    const { personId } = request.params;
    const logs = await dbService.getInteractionLogs(personId);
    return logs;
  });

  fastify.post('/interaction/create', async (request, reply) => {
    try {
      const logData = request.body;
      const id = await dbService.saveInteractionLog(logData);
      return { id, message: "Interaction Log Saved Successfully" };
    } catch (err) {
      request.log.error(err);
      reply.code(500).send({ error: 'Failed to save Interaction Log' });
    }
  });

  // Generate Interaction Review
  fastify.post('/interaction/:logId/review', async (request, reply) => {
    try {
        const { logId } = request.params;
        const { personId } = request.body;
        
        const logs = await dbService.getInteractionLogs(personId);
        const log = logs.find(l => l.id == logId);
        
        if (!log) return reply.code(404).send({ error: 'Log not found' });
        
        // If review exists, return it
        if (log.ai_review) return { review: log.ai_review };

        const profiles = await dbService.getPeopleProfiles('user-1');
        const profile = profiles.find(p => p.id === personId);
        
        if (!profile) return reply.code(404).send({ error: 'Person not found' });

        const result = await chatService.generateInteractionReview({ profile, log });
        
        // Save review
        if (result.review) {
            await dbService.updateInteractionLog(logId, { ai_review: result.review });
        }
        
        return result;
    } catch (err) {
        request.log.error(err);
        reply.code(500).send({ error: 'Review generation failed' });
    }
  });

  // --- Real Scene Review Routes ---

  fastify.get('/review/list/:userId', async (request, reply) => {
      const { userId } = request.params;
      const sessions = await dbService.getReviewSessions(userId);
      return sessions;
  });

  fastify.post('/review/create', async (request, reply) => {
      try {
          const sessionData = request.body;
          const id = await dbService.saveReviewSession(sessionData);
          return { id, message: "Review Session Created" };
      } catch (err) {
          request.log.error(err);
          reply.code(500).send({ error: 'Failed to create review session' });
      }
  });

  fastify.post('/review/chat', async (request, reply) => {
      try {
          const { userId, sessionId, userInput } = request.body;
          
          // 1. Get Session
          const session = await dbService.getReviewSession(sessionId);
          if (!session) return reply.code(404).send({ error: "Session not found" });

          // 2. Process Interaction
          const history = session.messages || [];
          const aiResponse = await chatService.processReviewInteraction({ userId, sessionId, userInput, history });

          // 3. Update Session with new messages
          const updatedMessages = [
              ...history,
              { role: 'user', content: userInput, timestamp: new Date() },
              aiResponse
          ];

          const updates = {
              id: sessionId,
              messages: updatedMessages
          };

          // 4. If summary generated, update status and summary data
          if (aiResponse.type === 'summary_card' && aiResponse.summaryData) {
              updates.status = 'completed';
              updates.summaryData = aiResponse.summaryData;
              // Determine result based on 'actual' field simply? No, AI didn't return success/fail explicitly.
              // Let's assume 'success' for now or leave it as is. 
              // Or we can ask AI to output result status too.
              // For now, let's just mark completed.
          } else {
              updates.status = 'pending';
          }

          await dbService.saveReviewSession(updates);

          return aiResponse;
      } catch (err) {
          request.log.error(err);
          reply.code(500).send({ error: 'Review chat failed' });
      }
  });

  fastify.post('/review/link-person', async (request, reply) => {
      try {
          const { reviewId, personId } = request.body;
          const session = await dbService.getReviewSession(reviewId);
          if (!session) return reply.code(404).send({ error: "Session not found" });

          // Calculate relationship change from summary data if available
          let relationshipChange = 0;
          if (session.summaryData && session.summaryData.relationship_change) {
              relationshipChange = parseInt(session.summaryData.relationship_change) || 0;
          }

          // Create interaction log
          const logData = {
              person_id: personId,
              event_date: new Date().toISOString().split('T')[0],
              event_context: `【真实复盘】${session.title}`,
              my_behavior: "进行了深度复盘",
              their_reaction: "（复盘记录）",
              relationship_change: relationshipChange,
              ai_analysis: session.summaryData ? JSON.stringify(session.summaryData) : "查看复盘详情",
              ai_review: `关联的复盘会话ID: ${reviewId}\n\n${session.messages.map(m => `${m.role}: ${m.content}`).join('\n')}`
          };

          await dbService.saveInteractionLog(logData);
          return { message: "Linked successfully", relationshipChange };
      } catch (err) {
          request.log.error(err);
          reply.code(500).send({ error: 'Link person failed' });
      }
  });

  fastify.post('/review/save-sop-draft', async (request, reply) => {
      try {
          const { reviewId, summaryData } = request.body;
          
          // Use AI to generate better SOP content
          const sopContent = await chatService.generateSOPFromReview(summaryData);
          
          const sopData = {
              title: sopContent ? sopContent.title : `[草稿] 基于“${summaryData.target}”的复盘经验`,
              category: sopContent ? sopContent.category : '经验沉淀',
              tags: sopContent ? [...sopContent.tags, '复盘转化'] : ['复盘转化', '草稿'],
              version: '0.1',
              content: sopContent ? `## 来源复盘\nID: ${reviewId}\n\n${sopContent.content}` : `## 来源复盘\nID: ${reviewId}\n\n## 亮点 (Keep)\n${summaryData.keep.map(i=>`- ${i}`).join('\n')}\n\n## 不足 (Improve)\n${summaryData.improve.map(i=>`- ${i}`).join('\n')}\n\n## 行动点 (Action)\n${summaryData.action.map(i=>`- ${i}`).join('\n')}`,
              user_id: 'user-1'
          };

          const id = await dbService.saveSOP(sopData);
          return { id, message: "SOP Draft Saved" };
      } catch (err) {
          request.log.error(err);
          reply.code(500).send({ error: 'Save SOP draft failed' });
      }
  });

  fastify.post('/sop/analyze', async (request, reply) => {
      try {
          const { content } = request.body;
          const result = await chatService.analyzeSOPContent(content);
          return result;
      } catch (err) {
          request.log.error(err);
          reply.code(500).send({ error: 'SOP analysis failed' });
      }
  });

  fastify.get('/user/stats/:userId', async (request, reply) => {
      const { userId } = request.params;
      const stats = await dbService.getUserStats(userId);
      return stats;
  });

  fastify.post('/npc/relation/create', async (request, reply) => {
      try {
          const relationData = request.body;
          const id = await dbService.saveNPCRelation(relationData);
          return { id, message: "Relation Established" };
      } catch (err) {
          request.log.error(err);
          reply.code(500).send({ error: 'Failed to create NPC relation' });
      }
  });

  fastify.get('/npc/relation/list/:userId', async (request, reply) => {
      const { userId } = request.params;
      const relations = await dbService.getNPCRelations(userId);
      return relations;
  });

  // Data Backup
  fastify.get('/backup/export', async (request, reply) => {
    try {
      const { userId } = request.query;
      // Default to 'user-1' if not provided (for dev convenience)
      const uid = userId || 'user-1'; 
      const data = await dbService.getAllUserData(uid);
      
      reply
        .header('Content-Type', 'application/json')
        .header('Content-Disposition', `attachment; filename="backup-${uid}-${new Date().toISOString().split('T')[0]}.json"`)
        .send(data);
    } catch (err) {
      request.log.error(err);
      reply.code(500).send({ error: 'Backup export failed' });
    }
  });

  fastify.get('/secretary/daily/:userId', async (request, reply) => {
    try {
      const { userId } = request.params;
      const refresh = String((request.query || {}).refresh || '') === '1';
      const data = await secretaryService.getSecretaryDaily({ userId, refresh });
      return data;
    } catch (err) {
      request.log.error(err);
      reply.code(500).send({ error: 'Failed to generate secretary reminders' });
    }
  });

  // File Upload
  fastify.post('/upload', async (request, reply) => {
    try {
      const data = await request.file();
      if (!data) {
        return reply.code(400).send({ error: "No file uploaded" });
      }
      
      const buffer = await data.toBuffer();
      const filename = `${Date.now()}-${data.filename}`;
      const mimeType = data.mimetype;

      const url = await dbService.uploadFile(buffer, filename, mimeType);
      
      return { url };
    } catch (err) {
      request.log.error(err);
      reply.code(500).send({ error: err.message || 'Upload failed' });
    }
  });

  // Init DB (for dev)

  // Init DB (for dev)
}

module.exports = routes;
