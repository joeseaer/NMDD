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

const parsePrivateInfoObject = (privateInfo) => {
  if (!privateInfo) return {};
  if (privateInfo && typeof privateInfo === 'object') return privateInfo;
  if (typeof privateInfo !== 'string') return {};
  const raw = privateInfo.trim();
  if (!raw) return {};
  try {
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' ? obj : {};
  } catch {
    return {};
  }
};

const normalizeStringList = (arr) => {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((x) => (x === undefined || x === null ? '' : String(x).trim()))
    .filter(Boolean);
};

const parsePrivateInfoToAnalysis = (privateInfo) => {
  const empty = {
    layer_1_core: { personality_traits: '', core_values: '', cognitive_mode: '', emotional_energy: '' },
    layer_2_drive: { motivation_system: '', skills_capabilities: '', resource_network: '' },
    layer_3_surface: { behavior_habits: '', life_trajectory: '', current_status_path: '' },
    behavioral_archive: {
      life_patterns: '',
      consumption_traits: '',
      language_signals: '',
      key_events: '',
      observation_points: [],
    },
    emotional_decoder: {
      charging_guide: '',
      mine_avoidance: '',
      conflict_first_aid: '',
      updated_at: '',
    },
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
        behavioral_archive: {
          ...empty.behavioral_archive,
          ...(obj.behavioral_archive || {}),
          observation_points: normalizeStringList(obj?.behavioral_archive?.observation_points || obj?.observation_points || []),
        },
        emotional_decoder: { ...empty.emotional_decoder, ...(obj.emotional_decoder || {}) },
        verification_checklists: obj.verification_checklists && typeof obj.verification_checklists === 'object' ? obj.verification_checklists : {},
      };
    }
  } catch {}

  return {
    ...empty,
    layer_3_surface: { ...empty.layer_3_surface, current_status_path: raw },
  };
};

const SCENARIO_CARD_PREFIX = 'SCENARIO_CARD_JSON:';

const buildScenarioCardContent = (card) => {
  const payload = {
    title: String(card?.title || ''),
    category: String(card?.category || 'work'),
    scenario: String(card?.scenario || ''),
    predicted_reaction: String(card?.predicted_reaction || ''),
    strategy: String(card?.strategy || ''),
    verdict: card?.verdict === 'accept' ? 'accept' : (card?.verdict === 'reject' ? 'reject' : 'pending'),
    updated_at: new Date().toISOString(),
  };
  return [
    '# 场景预演卡片',
    '',
    `${SCENARIO_CARD_PREFIX}${JSON.stringify(payload)}`,
    '',
    `## 标题`,
    payload.title || '未命名场景',
    '',
    `## 场景`,
    payload.scenario || '无',
    '',
    `## AI 预测反应`,
    payload.predicted_reaction || '无',
    '',
    `## AI 建议对策`,
    payload.strategy || '无',
  ].join('\n');
};

const parseScenarioCardFromSOP = (sop) => {
  const text = typeof sop?.content === 'string' ? sop.content : '';
  const line = text.split('\n').find((l) => l.startsWith(SCENARIO_CARD_PREFIX));
  if (!line) return null;
  const raw = line.slice(SCENARIO_CARD_PREFIX.length).trim();
  try {
    const card = JSON.parse(raw);
    if (!card || typeof card !== 'object') return null;
    const normalizedCategory = String(card.category || '').trim();
    return {
      sop_id: sop.id,
      sop_title: sop.title,
      title: String(card.title || sop.title || '未命名场景'),
      scenario: String(card.scenario || ''),
      predicted_reaction: String(card.predicted_reaction || ''),
      strategy: String(card.strategy || ''),
      category: normalizedCategory || '未分类',
      verdict: String(card.verdict || 'pending'),
      updated_at: card.updated_at || sop.updated_at || sop.created_at || null,
    };
  } catch {
    return null;
  }
};

const createId = () => {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
};

const getAdvisorWorkspace = (privateObj) => {
  const advisor = privateObj?.advisor_workspace;
  if (!advisor || typeof advisor !== 'object') return { threads: [], active_thread_id: null };
  const threads = Array.isArray(advisor.threads) ? advisor.threads : [];
  return {
    threads: threads.map((t) => ({
      id: String(t?.id || createId()),
      title: String(t?.title || '未命名会话'),
      updated_at: t?.updated_at || new Date().toISOString(),
      created_at: t?.created_at || new Date().toISOString(),
      messages: Array.isArray(t?.messages) ? t.messages.map((m) => ({
        id: String(m?.id || createId()),
        role: m?.role === 'assistant' ? 'assistant' : 'user',
        content: String(m?.content || ''),
        created_at: m?.created_at || new Date().toISOString(),
        applied: !!m?.applied,
      })) : [],
    })),
    active_thread_id: advisor.active_thread_id || null,
  };
};

const withAdvisorWorkspace = (privateObj, workspace) => ({
  ...(privateObj || {}),
  advisor_workspace: {
    threads: Array.isArray(workspace?.threads) ? workspace.threads : [],
    active_thread_id: workspace?.active_thread_id || null,
  },
});

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
        behavioral_archive: incoming?.behavioral_archive ?? base?.behavioral_archive ?? {},
        emotional_decoder: incoming?.emotional_decoder ?? base?.emotional_decoder ?? {},
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
      const userId = request.body?.userId || request.query?.userId || 'user-1';
      const profiles = await dbService.getPeopleProfiles(userId);
      const profile = profiles.find(p => p.id === id);
      if (!profile) return reply.code(404).send({ error: 'Person not found' });

      const logs = await dbService.getInteractionLogs(id);
      
      const prompt = `你是用户的“人脉关系顾问”。
目标：基于人物档案和过往互动记录，为用户提供【极短且个性化】的跟进标签词。

人物信息：
姓名：${profile.name}
身份：${profile.identity || '未知'}
DISC：${profile.disc_type || '未知'}
标签：${Array.isArray(profile.tags) ? profile.tags.join('、') : '无'}
关系强度：${profile.relationship_strength}
最近互动时间：${profile.last_interaction_date || '无'}
最近互动摘要：${profile.last_interaction || '无'}
上一条建议：${(() => {
  const raw = profile.ai_followup_suggestion;
  if (!raw) return '无';
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'object' && raw.label) return raw.label;
  return '无';
})()}

互动历史摘要：
${logs.slice(0, 3).map(l => `- ${l.event_date}: ${l.event_context}`).join('\n')}

请输出一段纯 JSON，包含 label 和 color 字段。
要求：
1. label: 必须极其简短（5-8个字以内），必须带 emoji 开头，且必须包含一个具体动作词（如：问候/约聊/跟进/破冰/致谢/祝贺）。
2. color: 根据紧迫程度选择 Tailwind CSS 类。例如红色 "bg-red-100 text-red-700" (紧急/久未联系)，蓝色 "bg-blue-100 text-blue-700" (常规维护)，橙色 "bg-orange-100 text-orange-700" (近期需跟进)，绿色 "bg-green-100 text-green-700" (状态良好)。
3. 不要输出泛化句式（如“近期可问候”“建议本周联系”这类无对象特征句）。
4. label 要结合身份/互动内容体现差异，例如导师可偏“汇报/请教”，同学可偏“近况/合作”，合作伙伴可偏“进度/资源”。
5. 若“上一条建议”不是“无”，尽量避免重复相同措辞，除非判断为紧急场景。

只输出 JSON 对象，不要任何多余的字符：
{
  "label": "🔥 跟进论文进展",
  "color": "bg-red-100 text-red-700"
}`;

      const client = secretaryService.getOpenAIClientOrNull ? secretaryService.getOpenAIClientOrNull() : null;
      if (!client) {
        return reply.code(503).send({ error: 'AI service unavailable', detail: 'OpenAI client not initialized' });
      }

      let suggestionObj = null;
      try {
        const completion = await client.chat.completions.create({
          model: secretaryService.getModel ? secretaryService.getModel() : 'gpt-3.5-turbo',
          messages: [{ role: 'system', content: prompt }],
          temperature: 0.9,
        });
        const content = completion?.choices?.[0]?.message?.content || '{}';
        request.log.info({ msg: 'AI suggestion response', content, personId: id });
        let cleaned = content.replace(/```(?:json)?\s*|```/g, '').trim();
        const start = cleaned.indexOf('{');
        const end = cleaned.lastIndexOf('}');
        if (start !== -1 && end !== -1 && end >= start) cleaned = cleaned.slice(start, end + 1);
        const parsed = JSON.parse(cleaned);
        if (!parsed || typeof parsed.label !== 'string' || !parsed.label.trim()) {
          return reply.code(502).send({ error: 'Invalid AI output', detail: 'Missing label field from AI response' });
        }
        suggestionObj = {
          label: parsed.label.trim().slice(0, 20),
          color: typeof parsed.color === 'string' && parsed.color.trim() ? parsed.color.trim() : 'bg-blue-100 text-blue-700',
        };
      } catch (e) {
        request.log.error({ msg: 'AI suggestion generate/parse failed', error: e?.message, personId: id });
        return reply.code(502).send({ error: 'AI suggestion generation failed', detail: e?.message || 'Unknown AI error' });
      }

      try {
        await dbService.updatePersonAIFollowUp(id, suggestionObj);
      } catch (e) {
        request.log.error({ msg: 'Persist ai followup failed', error: e?.message, personId: id });
        return reply.code(500).send({ error: 'Failed to persist AI suggestion', detail: e?.message || 'persist failed' });
      }

      return { id, suggestion: suggestionObj, source: 'ai', persisted: true };

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

  fastify.get('/people/:id/advisor/threads', async (request, reply) => {
    try {
      const { id } = request.params;
      const userId = request.query?.userId || 'user-1';
      const profiles = await dbService.getPeopleProfiles(userId);
      const profile = profiles.find((p) => p.id === id);
      if (!profile) return reply.code(404).send({ error: 'Person not found' });
      const base = parsePrivateInfoObject(profile.private_info);
      const workspace = getAdvisorWorkspace(base);
      const threads = (workspace.threads || [])
        .map((t) => ({ id: t.id, title: t.title, updated_at: t.updated_at, created_at: t.created_at, message_count: (t.messages || []).length }))
        .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
      return { threads, active_thread_id: workspace.active_thread_id || null };
    } catch (err) {
      request.log.error(err);
      reply.code(500).send({ error: 'Failed to fetch advisor threads' });
    }
  });

  fastify.post('/people/:id/advisor/thread', async (request, reply) => {
    try {
      const { id } = request.params;
      const userId = request.body?.userId || request.query?.userId || 'user-1';
      const title = String(request.body?.title || '新建会话').trim().slice(0, 60) || '新建会话';
      const profiles = await dbService.getPeopleProfiles(userId);
      const profile = profiles.find((p) => p.id === id);
      if (!profile) return reply.code(404).send({ error: 'Person not found' });
      const base = parsePrivateInfoObject(profile.private_info);
      const workspace = getAdvisorWorkspace(base);
      const now = new Date().toISOString();
      const thread = { id: createId(), title, created_at: now, updated_at: now, messages: [] };
      const nextWorkspace = {
        ...workspace,
        active_thread_id: thread.id,
        threads: [thread, ...(workspace.threads || [])],
      };
      const nextPrivate = withAdvisorWorkspace(base, nextWorkspace);
      await dbService.updatePersonPrivateInfo(id, JSON.stringify(nextPrivate));
      return { thread: { id: thread.id, title: thread.title, created_at: thread.created_at, updated_at: thread.updated_at, message_count: 0 } };
    } catch (err) {
      request.log.error(err);
      reply.code(500).send({ error: 'Failed to create advisor thread' });
    }
  });

  fastify.get('/people/:id/advisor/thread/:threadId', async (request, reply) => {
    try {
      const { id, threadId } = request.params;
      const userId = request.query?.userId || 'user-1';
      const profiles = await dbService.getPeopleProfiles(userId);
      const profile = profiles.find((p) => p.id === id);
      if (!profile) return reply.code(404).send({ error: 'Person not found' });
      const base = parsePrivateInfoObject(profile.private_info);
      const workspace = getAdvisorWorkspace(base);
      const thread = (workspace.threads || []).find((t) => String(t.id) === String(threadId));
      if (!thread) return reply.code(404).send({ error: 'Thread not found' });
      return { thread };
    } catch (err) {
      request.log.error(err);
      reply.code(500).send({ error: 'Failed to fetch advisor thread' });
    }
  });

  fastify.post('/people/:id/advisor/chat', async (request, reply) => {
    try {
      const { id } = request.params;
      const userId = request.body?.userId || request.query?.userId || 'user-1';
      const threadId = String(request.body?.threadId || '');
      const content = String(request.body?.content || '').trim();
      if (!threadId || !content) return reply.code(400).send({ error: 'threadId and content are required' });
      const profiles = await dbService.getPeopleProfiles(userId);
      const profile = profiles.find((p) => p.id === id);
      if (!profile) return reply.code(404).send({ error: 'Person not found' });
      const base = parsePrivateInfoObject(profile.private_info);
      const workspace = getAdvisorWorkspace(base);
      const threadIndex = (workspace.threads || []).findIndex((t) => String(t.id) === threadId);
      if (threadIndex < 0) return reply.code(404).send({ error: 'Thread not found' });
      const thread = workspace.threads[threadIndex];
      const userMsg = { id: createId(), role: 'user', content, created_at: new Date().toISOString(), applied: false };
      const historyText = [...(thread.messages || []), userMsg]
        .slice(-12)
        .map((m) => `${m.role === 'assistant' ? '军师' : '我'}：${m.content}`)
        .join('\n');
      const logs = await dbService.getInteractionLogs(id);
      const query = `请基于以下连续会话进行多轮决策建议。\n${historyText}\n\n请延续上下文回答，并给出可执行建议。`;
      const result = await chatService.consultPerson({ profile, logs, query });
      const assistantMsg = {
        id: createId(),
        role: 'assistant',
        content: String(result?.reply || '').trim(),
        created_at: new Date().toISOString(),
        applied: false,
      };
      const nextThread = {
        ...thread,
        title: (thread.title === '新建会话' ? content.slice(0, 20) : thread.title) || thread.title,
        updated_at: new Date().toISOString(),
        messages: [...(thread.messages || []), userMsg, assistantMsg],
      };
      const nextThreads = [...workspace.threads];
      nextThreads.splice(threadIndex, 1);
      nextThreads.unshift(nextThread);
      const nextWorkspace = { ...workspace, active_thread_id: threadId, threads: nextThreads };
      const nextPrivate = withAdvisorWorkspace(base, nextWorkspace);
      await dbService.updatePersonPrivateInfo(id, JSON.stringify(nextPrivate));
      return { user_message: userMsg, assistant_message: assistantMsg, thread: { id: nextThread.id, title: nextThread.title, updated_at: nextThread.updated_at, message_count: nextThread.messages.length } };
    } catch (err) {
      request.log.error(err);
      reply.code(500).send({ error: 'Failed to process advisor chat' });
    }
  });

  fastify.post('/people/:id/advisor/apply', async (request, reply) => {
    try {
      const { id } = request.params;
      const userId = request.body?.userId || request.query?.userId || 'user-1';
      const threadId = String(request.body?.threadId || '');
      const messageId = String(request.body?.messageId || '');
      if (!threadId || !messageId) return reply.code(400).send({ error: 'threadId and messageId are required' });
      const profiles = await dbService.getPeopleProfiles(userId);
      const profile = profiles.find((p) => p.id === id);
      if (!profile) return reply.code(404).send({ error: 'Person not found' });

      const base = parsePrivateInfoObject(profile.private_info);
      const workspace = getAdvisorWorkspace(base);
      const threadIndex = (workspace.threads || []).findIndex((t) => String(t.id) === threadId);
      if (threadIndex < 0) return reply.code(404).send({ error: 'Thread not found' });
      const thread = workspace.threads[threadIndex];
      const msgIndex = (thread.messages || []).findIndex((m) => String(m.id) === messageId && m.role === 'assistant');
      if (msgIndex < 0) return reply.code(404).send({ error: 'Assistant message not found' });
      const msg = thread.messages[msgIndex];
      const archive = parsePrivateInfoToAnalysis(profile.private_info)?.behavioral_archive || {};
      const oldText = String(archive.life_patterns || '').trim();
      const snippet = String(msg.content || '').slice(0, 500);
      const line = `[军师洞察 ${new Date().toISOString().slice(0, 10)}] ${snippet}`;
      const nextArchiveText = [oldText, line].filter(Boolean).join('\n');
      const updatedMessage = { ...msg, applied: true, applied_at: new Date().toISOString() };
      const nextMessages = [...(thread.messages || [])];
      nextMessages[msgIndex] = updatedMessage;
      const nextThread = { ...thread, messages: nextMessages, updated_at: new Date().toISOString() };
      const nextThreads = [...workspace.threads];
      nextThreads[threadIndex] = nextThread;
      const nextWorkspace = { ...workspace, threads: nextThreads, active_thread_id: threadId };
      const nextPrivate = withAdvisorWorkspace(base, nextWorkspace);
      nextPrivate.behavioral_archive = {
        ...(base?.behavioral_archive || {}),
        ...(archive || {}),
        life_patterns: nextArchiveText,
      };
      await dbService.updatePersonPrivateInfo(id, JSON.stringify(nextPrivate));
      return { ok: true, behavioral_archive: nextPrivate.behavioral_archive };
    } catch (err) {
      request.log.error(err);
      reply.code(500).send({ error: 'Failed to apply advisor insight' });
    }
  });

  // AI Summary & Reminders
  fastify.post('/people/summary', async (request, reply) => {
      try {
          const { personId, forceRefresh } = request.body;
          const userId = request.body?.userId || request.query?.userId || 'user-1';
          const profiles = await dbService.getPeopleProfiles(userId);
          const profile = profiles.find(p => p.id === personId);
          if (!profile) return reply.code(404).send({ error: 'Person not found' });

          const privateObj = parsePrivateInfoObject(profile.private_info);
          const today = new Date().toISOString().slice(0, 10);
          const cachedBriefing = privateObj?.daily_briefing;

          if (
            !forceRefresh &&
            cachedBriefing &&
            typeof cachedBriefing === 'object' &&
            cachedBriefing.date === today &&
            cachedBriefing.payload &&
            typeof cachedBriefing.payload === 'object'
          ) {
            return {
              ...cachedBriefing.payload,
              generated_at: cachedBriefing.generated_at || null,
              date: cachedBriefing.date,
              cached: true,
            };
          }

          const logs = await dbService.getInteractionLogs(personId);
          const result = await chatService.generateSummary({ profile, logs });
          const nextPrivate = {
            ...(privateObj || {}),
            daily_briefing: {
              date: today,
              generated_at: new Date().toISOString(),
              payload: result,
            },
          };
          await dbService.updatePersonPrivateInfo(personId, JSON.stringify(nextPrivate));
          return {
            ...result,
            date: today,
            cached: false,
          };
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

  fastify.get('/people/:id/scenario-cards', async (request, reply) => {
    try {
      const { id } = request.params;
      const userId = request.query?.userId || 'user-1';
      const sops = await dbService.getSOPs(userId);
      const cards = (sops || [])
        .filter((s) => Array.isArray(s.tags) && s.tags.includes('scenario-lab') && s.tags.includes(`person:${id}`))
        .map(parseScenarioCardFromSOP)
        .filter(Boolean)
        .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
      return { items: cards };
    } catch (err) {
      request.log.error(err);
      reply.code(500).send({ error: 'Failed to fetch scenario cards' });
    }
  });

  fastify.post('/people/:id/scenario-simulate', async (request, reply) => {
    try {
      const { id } = request.params;
      const userId = request.body?.userId || request.query?.userId || 'user-1';
      const query = String(request.body?.query || '').trim();
      const category = String(request.body?.category || '').trim().slice(0, 24) || '职场协作';

      const profiles = await dbService.getPeopleProfiles(userId);
      const profile = profiles.find(p => p.id === id);
      if (!profile) return reply.code(404).send({ error: 'Person not found' });

      const logs = await dbService.getInteractionLogs(id);
      const generated = await chatService.generateScenarioSimulation({ profile, logs, query, category });

      const scenarioText = query || generated.title || '未命名场景';
      const card = {
        title: generated.title || scenarioText,
        category: generated.category || category,
        scenario: scenarioText,
        predicted_reaction: generated.predicted_reaction || '',
        strategy: generated.strategy || '',
        verdict: 'pending',
      };
      const sopData = {
        user_id: userId,
        title: `剧本｜${card.title}`.slice(0, 80),
        category: 'people',
        tags: ['scenario-lab', `person:${id}`, `scenario:${card.category}`],
        version: 'V1.0',
        content: buildScenarioCardContent(card),
      };
      const sopId = await dbService.saveSOP(sopData);
      return {
        item: {
          sop_id: sopId,
          sop_title: sopData.title,
          ...card,
          updated_at: new Date().toISOString(),
        },
      };
    } catch (err) {
      request.log.error(err);
      reply.code(500).send({ error: 'Failed to generate scenario simulation', detail: err?.message });
    }
  });

  fastify.patch('/people/:id/scenario-cards/:sopId', async (request, reply) => {
    try {
      const { id, sopId } = request.params;
      const userId = request.body?.userId || request.query?.userId || 'user-1';
      const patch = request.body?.patch || {};
      const sops = await dbService.getSOPs(userId);
      const sop = (sops || []).find((s) => s.id === sopId);
      if (!sop) return reply.code(404).send({ error: 'Scenario card not found' });
      const current = parseScenarioCardFromSOP(sop);
      if (!current) return reply.code(400).send({ error: 'Invalid scenario card content' });
      const next = {
        title: patch.title ?? current.title,
        category: String(patch.category ?? current.category ?? '未分类').trim().slice(0, 24) || '未分类',
        scenario: patch.scenario ?? current.scenario,
        predicted_reaction: patch.predicted_reaction ?? current.predicted_reaction,
        strategy: patch.strategy ?? current.strategy,
        verdict: patch.verdict === 'accept' ? 'accept' : (patch.verdict === 'reject' ? 'reject' : current.verdict),
      };
      const updatedTags = ['scenario-lab', `person:${id}`, `scenario:${next.category}`];
      const data = {
        id: sopId,
        user_id: userId,
        title: `剧本｜${next.title}`.slice(0, 80),
        category: 'people',
        tags: updatedTags,
        version: sop.version || 'V1.0',
        content: buildScenarioCardContent(next),
      };
      const updatedId = await dbService.saveSOP(data);
      return { id: updatedId, item: { sop_id: updatedId, ...next, updated_at: new Date().toISOString() } };
    } catch (err) {
      request.log.error(err);
      reply.code(500).send({ error: 'Failed to update scenario card', detail: err?.message });
    }
  });

  fastify.delete('/people/:id/scenario-cards/:sopId', async (request, reply) => {
    try {
      const { id, sopId } = request.params;
      const userId = request.body?.userId || request.query?.userId || 'user-1';
      const sops = await dbService.getSOPs(userId);
      const sop = (sops || []).find((s) => s.id === sopId);
      if (!sop) return reply.code(404).send({ error: 'Scenario card not found' });
      const tags = Array.isArray(sop.tags) ? sop.tags : [];
      const isScenarioCard = tags.includes('scenario-lab') && tags.includes(`person:${id}`);
      if (!isScenarioCard) return reply.code(400).send({ error: 'SOP is not a scenario card of this person' });
      await dbService.deleteSOP(sopId);
      return { ok: true, id: sopId };
    } catch (err) {
      request.log.error(err);
      reply.code(500).send({ error: 'Failed to delete scenario card', detail: err?.message });
    }
  });

  fastify.post('/people/:id/map-proposal/apply', async (request, reply) => {
    try {
      const { id } = request.params;
      const userId = request.body?.userId || request.query?.userId || 'user-1';
      const proposal = request.body?.proposal || {};
      const profiles = await dbService.getPeopleProfiles(userId);
      const profile = profiles.find(p => p.id === id);
      if (!profile) return reply.code(404).send({ error: 'Person not found' });

      const existingPrivate = parsePrivateInfoToAnalysis(profile.private_info);
      const basePrivate = parsePrivateInfoObject(profile.private_info);
      const mergedTriggers = Array.from(new Set([...(profile.triggers || []), ...normalizeStringList(proposal.red_lights || [])]));
      const mergedPleasers = Array.from(new Set([...(profile.pleasers || []), ...normalizeStringList(proposal.green_lights || [])]));
      await dbService.updatePersonTriggersPleasers(id, mergedTriggers, mergedPleasers);

      const archiveNotes = normalizeStringList(proposal.archive_notes || []);
      const oldPatterns = String(existingPrivate?.behavioral_archive?.life_patterns || '').trim();
      const joinedPatterns = [oldPatterns, ...archiveNotes].filter(Boolean).join('\n');
      const observationTasks = Array.from(new Set([
        ...normalizeStringList(existingPrivate?.behavioral_archive?.observation_points || []),
        ...normalizeStringList(proposal.observation_tasks || []),
      ]));
      const nextPrivate = {
        ...(basePrivate || {}),
        behavioral_archive: {
          ...(existingPrivate?.behavioral_archive || {}),
          life_patterns: joinedPatterns,
          observation_points: observationTasks,
        },
      };
      await dbService.updatePersonPrivateInfo(id, JSON.stringify(nextPrivate));

      return {
        triggers: mergedTriggers,
        pleasers: mergedPleasers,
        behavioral_archive: nextPrivate.behavioral_archive,
      };
    } catch (err) {
      request.log.error(err);
      reply.code(500).send({ error: 'Failed to apply map proposal', detail: err?.message });
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
      let proposal = null;
      try {
        const personId = logData?.person_id;
        if (personId) {
          const profiles = await dbService.getPeopleProfiles('user-1');
          const profile = profiles.find((p) => p.id === personId);
          if (profile) {
            const logs = await dbService.getInteractionLogs(personId);
            const latest = (logs || []).find((l) => String(l.id) === String(id)) || logs?.[0];
            if (latest) {
              proposal = await chatService.generateMapPatchProposal({ profile, log: latest });
            }
          }
        }
      } catch (e) {
        request.log.warn({ msg: 'generateMapPatchProposal failed', error: e?.message, logId: id });
      }
      return { id, message: "Interaction Log Saved Successfully", proposal };
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
