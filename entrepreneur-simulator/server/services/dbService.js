const { createClient } = require('@supabase/supabase-js');
const { ChromaClient } = require('chromadb');
const { DEFAULT_USER_ID } = require('../config/currentUser');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

let supabase = null;
if (supabaseUrl && supabaseKey) {
  supabase = createClient(supabaseUrl, supabaseKey);
}

const chromaClient = new ChromaClient({
  path: process.env.CHROMA_URL || 'http://localhost:8000',
});

let scenesCollection = null;
let sopCollection = null;

const SMART_DOC_JSON_PREFIX = '<!-- smart-document-json:';
const SMART_DOC_JSON_SUFFIX = '-->';

const normalizeContentJson = (value) => {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && parsed.type === 'doc' ? parsed : null;
    } catch {
      return null;
    }
  }
  return value && typeof value === 'object' && value.type === 'doc' ? value : null;
};

const unpackSmartDocumentContent = (value) => {
  const rawContent = typeof value === 'string' ? value : '';
  if (!rawContent.startsWith(SMART_DOC_JSON_PREFIX)) {
    return { content: rawContent, contentJson: null };
  }

  const endIndex = rawContent.indexOf(SMART_DOC_JSON_SUFFIX);
  if (endIndex < 0) return { content: rawContent, contentJson: null };

  const encoded = rawContent.slice(SMART_DOC_JSON_PREFIX.length, endIndex).trim();
  const content = rawContent.slice(endIndex + SMART_DOC_JSON_SUFFIX.length).replace(/^\r?\n/, '');

  try {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    return {
      content,
      contentJson: normalizeContentJson(decoded),
    };
  } catch {
    return { content: rawContent, contentJson: null };
  }
};

const packSmartDocumentContent = (content, contentJson) => {
  const normalizedJson = normalizeContentJson(contentJson);
  if (!normalizedJson) return content;

  const encoded = Buffer.from(JSON.stringify(normalizedJson), 'utf8').toString('base64');
  return `${SMART_DOC_JSON_PREFIX}${encoded}${SMART_DOC_JSON_SUFFIX}\n${content || ''}`;
};

const isMissingContentJsonColumn = (error) => {
  const message = String(error?.message || error?.details || '');
  return error?.code === 'PGRST204' || message.includes("'content_json' column");
};

const SOP_METADATA_FIELDS = [
  'domain',
  'research_type',
  'research_status',
  'promoted_to_life',
  'promoted_at',
  'promoted_from_sop_id',
];

const VALID_SOP_DOMAINS = new Set(['life', 'research']);
const VALID_RESEARCH_TYPES = new Set(['document', 'idea', 'meeting']);
const VALID_RESEARCH_STATUSES = new Set(['seed', 'to_verify', 'absorbed', 'paused']);

const isMissingSopMetadataColumn = (error) => {
  const message = String(error?.message || error?.details || '');
  return SOP_METADATA_FIELDS.some((field) => (
    message.includes(`'${field}' column`) ||
    message.includes(`Could not find the '${field}'`) ||
    message.includes(field)
  ));
};

const stripSopMetadataFields = (payload) => {
  const next = { ...(payload || {}) };
  SOP_METADATA_FIELDS.forEach((field) => {
    delete next[field];
  });
  return next;
};

const SYSTEM_TAG_PREFIXES = [
  'domain:',
  'research_type:',
  'research_status:',
  'promoted_to_life:',
  'promoted_from:',
];

const normalizeSopTags = (tags) => (
  Array.isArray(tags) ? tags.map((tag) => String(tag || '').trim()).filter(Boolean) : []
);

const stripSopSystemTags = (tags) => (
  normalizeSopTags(tags).filter((tag) => !SYSTEM_TAG_PREFIXES.some((prefix) => tag.startsWith(prefix)))
);

const getSopTagValue = (tags, prefix) => {
  const tag = normalizeSopTags(tags).find((item) => item.startsWith(prefix));
  return tag ? tag.slice(prefix.length) : '';
};

const canStripSopMetadataFallback = (payload = {}) => {
  const domain = normalizeSopDomain(payload.domain);
  return (
    domain === 'life' &&
    !payload.research_type &&
    !payload.research_status &&
    !payload.promoted_to_life &&
    !payload.promoted_at &&
    !payload.promoted_from_sop_id
  );
};

const withSopMetadataFallbackTags = (payload = {}) => {
  const domain = normalizeSopDomain(payload.domain);
  const researchType = normalizeResearchType(payload.research_type, domain);
  const researchStatus = normalizeResearchStatus(payload.research_status, researchType);
  const tags = stripSopSystemTags(payload.tags);
  const systemTags = [];

  if (domain === 'research') systemTags.push('domain:research');
  if (researchType) systemTags.push(`research_type:${researchType}`);
  if (researchStatus) systemTags.push(`research_status:${researchStatus}`);
  if (payload.promoted_to_life) systemTags.push('promoted_to_life:true');
  if (payload.promoted_from_sop_id) systemTags.push(`promoted_from:${payload.promoted_from_sop_id}`);

  return {
    ...stripSopMetadataFields(payload),
    tags: [...tags, ...systemTags],
  };
};

const normalizeSopDomain = (value) => (
  VALID_SOP_DOMAINS.has(String(value || '').trim()) ? String(value).trim() : 'life'
);

const normalizeResearchType = (value, domain) => {
  const raw = String(value || '').trim();
  return domain === 'research' && VALID_RESEARCH_TYPES.has(raw) ? raw : null;
};

const normalizeResearchStatus = (value, researchType) => {
  const raw = String(value || '').trim();
  if (researchType !== 'idea') return null;
  return VALID_RESEARCH_STATUSES.has(raw) ? raw : 'seed';
};

const normalizeNullableUuid = (value) => {
  const raw = String(value || '').trim();
  return raw.length > 10 ? raw : null;
};

const buildSopMetadataPayload = (sopData = {}) => {
  const domain = normalizeSopDomain(sopData.domain);
  const researchType = normalizeResearchType(sopData.research_type, domain);
  const researchStatus = normalizeResearchStatus(sopData.research_status, researchType);
  return {
    domain,
    research_type: researchType,
    research_status: researchStatus,
    promoted_to_life: !!sopData.promoted_to_life,
    promoted_at: sopData.promoted_at || null,
    promoted_from_sop_id: normalizeNullableUuid(sopData.promoted_from_sop_id),
  };
};

const runSopMutationWithFallback = async (mutate, payload, fallbackContent) => {
  let currentPayload = payload;
  let strippedContentJson = false;
  let strippedMetadata = false;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const result = await mutate(currentPayload);
    if (!result.error) return result;

    if (isMissingContentJsonColumn(result.error) && !strippedContentJson) {
      const { content_json, ...fallbackPayload } = currentPayload;
      currentPayload = { ...fallbackPayload, content: fallbackContent };
      strippedContentJson = true;
      continue;
    }

    if (isMissingSopMetadataColumn(result.error) && !strippedMetadata) {
      currentPayload = canStripSopMetadataFallback(currentPayload)
        ? stripSopMetadataFields(currentPayload)
        : withSopMetadataFallbackTags(currentPayload);
      strippedMetadata = true;
      continue;
    }

    return result;
  }

  return mutate(currentPayload);
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

const initDB = async () => {
  if (supabase) {
    console.log('✅ Connected to Supabase');
  } else {
    console.warn('⚠️ Supabase credentials missing. Data will NOT be persisted.');
  }

  try {
    if (process.env.CHROMA_URL) {
      scenesCollection = await chromaClient.getOrCreateCollection({ name: "scene_embeddings" });
      sopCollection = await chromaClient.getOrCreateCollection({ name: "sop_embeddings" });
      console.log('✅ Connected to ChromaDB Collections');
    }

    // Init Storage Bucket
    if (supabase) {
        const { data: buckets } = await supabase.storage.listBuckets();
        if (buckets && !buckets.find(b => b.name === 'sop-images')) {
            await supabase.storage.createBucket('sop-images', { public: true });
            console.log('✅ Created "sop-images" storage bucket');
        }
    }
  } catch (err) {
    console.warn('⚠️ Init DB Warning:', err.message);
  }
};

// --- Scenes ---

const saveScene = async (sceneData) => {
  if (!supabase) throw new Error("Database connection not established. Check environment variables.");
  
  const { data, error } = await supabase
    .from('scenes')
    .insert([{
      user_id: sceneData.user_id,
      scene_type: sceneData.scene_type,
      npc_profile: sceneData.npc_profile,
      initial_context: sceneData.initial_context,
      conversation_log: sceneData.conversation_log,
      key_decisions: sceneData.key_decisions,
      final_result: sceneData.final_result,
      ai_feedback: sceneData.ai_feedback
    }])
    .select('id')
    .single();

  if (error) {
    console.error('Error saving scene:', error);
    throw error;
  }
  return data.id;
};

const getRecentScenes = async (userId, limit = 5) => {
  if (!supabase || !userId) return [];

  const { data, error } = await supabase
    .from('scenes')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('Error fetching scenes:', error);
    return [];
  }
  return data;
};

// --- SOPs ---

const saveSOP = async (sopData) => {
  if (!supabase) throw new Error("Database connection not established. Check environment variables.");

  let sopId = sopData.id;
  const unpackedContent = unpackSmartDocumentContent(sopData.content);
  const contentJson = normalizeContentJson(sopData.content_json) || unpackedContent.contentJson;
  const content = unpackedContent.content;
  const fallbackContent = packSmartDocumentContent(content, contentJson);

  // Ensure content is processed if it contains URL-encoded mindmap data
  // Although frontend decodes it for display, we want to store it as is or decoded?
  // Frontend sends Markdown. The markdown contains <div ... data-mindmap="...">
  // Postgres TEXT column can handle it fine. No special processing needed here usually.
  
  // Check if updating or inserting
  if (sopData.id && sopData.id.length > 10) { // Simple check for UUID vs mock ID
      const payload = {
          title: sopData.title,
          category: sopData.category,
          tags: sopData.tags,
          version: sopData.version,
          content,
          content_json: contentJson,
          ...buildSopMetadataPayload(sopData),
          updated_at: new Date()
      };

      let { data, error } = await runSopMutationWithFallback(
        (nextPayload) => supabase
          .from('sops')
          .update(nextPayload)
          .eq('id', sopData.id)
          .select('id')
          .single(),
        payload,
        fallbackContent
      );
        
      if (error) throw error;
      sopId = data.id;
  } else {
      // If ID is missing or short (temp ID), treat as insert
      // Remove temp ID from payload so Postgres generates new UUID
      const { id, ...insertData } = sopData;
      const payload = {
          user_id: insertData.user_id || DEFAULT_USER_ID,
          title: insertData.title,
          category: insertData.category,
          tags: insertData.tags,
          version: insertData.version,
          content,
          content_json: contentJson,
          ...buildSopMetadataPayload(insertData),
          // related_scenes is legacy, we use relational tables now
      };
      
      let { data, error } = await runSopMutationWithFallback(
        (nextPayload) => supabase
          .from('sops')
          .insert([nextPayload])
          .select('id')
          .single(),
        payload,
        fallbackContent
      );

      if (error) throw error;
      sopId = data.id;
  }

  try {
    const mm = summarizeMindMapContent(content);
    if (mm.hasFence || mm.hasDiv) {
      const { data: saved, error: savedError } = await supabase
        .from('sops')
        .select('id, content, updated_at')
        .eq('id', sopId)
        .single();
      if (!savedError && saved) {
        console.log('[mindmap][db] saved-check', { id: saved.id, updated_at: saved.updated_at, ...summarizeMindMapContent(saved.content) });
      }
    }
  } catch (e) {
    console.warn('[mindmap][db] saved-check failed', e?.message || e);
  }

  // Save version history
  if (sopData.history && sopData.history.length > 0) {
      const latestHistory = sopData.history[0]; // Assuming latest is first
      // Check if this version already exists to prevent dupes on every save
      const { data: existingVersion } = await supabase
        .from('sop_versions')
        .select('id')
        .eq('sop_id', sopId)
        .eq('version', latestHistory.version)
        .single();

      if (!existingVersion) {
        const versionPayload = {
            sop_id: sopId,
            version: latestHistory.version,
            content,
            content_json: contentJson,
            version_note: latestHistory.note
        };
        let { error: versionError } = await supabase.from('sop_versions').insert(versionPayload);
        if (versionError && isMissingContentJsonColumn(versionError)) {
          const { content_json, ...fallbackVersionPayload } = versionPayload;
          ({ error: versionError } = await supabase
            .from('sop_versions')
            .insert({ ...fallbackVersionPayload, content: fallbackContent }));
        }
        if (versionError) throw versionError;
      }
  }

  // Save Relations
  if (sopData.related) {
      // Scenes
      if (sopData.related.scenes) {
          // Delete existing
          await supabase.from('scene_sop_rel').delete().eq('sop_id', sopId);
          // Insert new
          if (sopData.related.scenes.length > 0) {
              const sceneRelations = sopData.related.scenes.map(s => ({
                  sop_id: sopId,
                  scene_id: s.id
              }));
              await supabase.from('scene_sop_rel').insert(sceneRelations);
          }
      }

      // People
      if (sopData.related.people) {
          // Delete existing
          await supabase.from('people_sop_rel').delete().eq('sop_id', sopId);
          // Insert new
          if (sopData.related.people.length > 0) {
              const peopleRelations = sopData.related.people.map(p => ({
                  sop_id: sopId,
                  people_id: p.id
              }));
              await supabase.from('people_sop_rel').insert(peopleRelations);
          }
      }
  }

  return sopId;
};

const applySopFilters = (items, filters = {}) => {
  const domain = filters.domain && VALID_SOP_DOMAINS.has(String(filters.domain)) ? String(filters.domain) : null;
  const researchType = filters.researchType && VALID_RESEARCH_TYPES.has(String(filters.researchType)) ? String(filters.researchType) : null;

  return (items || []).filter((item) => {
    if (domain && item.domain !== domain) return false;
    if (researchType && item.research_type !== researchType) return false;
    return true;
  });
};

const getSOPs = async (userId, filters = {}) => {
  if (!supabase) return [];

  // Fetch SOPs with their related data
  // Note: This relies on foreign key relationships being detected by Supabase/PostgREST
  let query = supabase
    .from('sops')
    .select(`
      *,
      sop_versions (
        version,
        created_at,
        version_note
      ),
      sop_usage_logs (
        scene_type,
        score,
        created_at,
        notes,
        scene_id
      ),
      scene_sop_rel (
        scene_id,
        scenes (
            id,
            scene_type,
            initial_context
        )
      ),
      people_sop_rel (
        people_id,
        people_profiles (
            id,
            name,
            identity
        )
      )
    `)
    .eq('user_id', userId);

  const domain = filters.domain && VALID_SOP_DOMAINS.has(String(filters.domain)) ? String(filters.domain) : null;
  const researchType = filters.researchType && VALID_RESEARCH_TYPES.has(String(filters.researchType)) ? String(filters.researchType) : null;
  if (domain) query = query.eq('domain', domain);
  if (researchType) query = query.eq('research_type', researchType);

  let { data, error } = await query.order('updated_at', { ascending: false });

  if (error && isMissingSopMetadataColumn(error)) {
    ({ data, error } = await supabase
      .from('sops')
      .select(`
        *,
        sop_versions (
          version,
          created_at,
          version_note
        ),
        sop_usage_logs (
          scene_type,
          score,
          created_at,
          notes,
          scene_id
        ),
        scene_sop_rel (
          scene_id,
          scenes (
              id,
              scene_type,
              initial_context
          )
        ),
        people_sop_rel (
          people_id,
          people_profiles (
              id,
              name,
              identity
          )
        )
      `)
      .eq('user_id', userId)
      .order('updated_at', { ascending: false }));
  }

  if (error) {
    console.error('Error fetching SOPs:', error);
    return [];
  }
  
  // Transform data to match frontend SOPEntity structure
  const mapped = data.map(sop => {
    const unpackedContent = unpackSmartDocumentContent(sop.content);
    const contentJson = normalizeContentJson(sop.content_json) || unpackedContent.contentJson;
    const usageLogs = sop.sop_usage_logs || [];
    const versions = sop.sop_versions || [];
    const rawTags = normalizeSopTags(sop.tags);
    const taggedDomain = getSopTagValue(rawTags, 'domain:');
    const taggedResearchType = getSopTagValue(rawTags, 'research_type:');
    const taggedResearchStatus = getSopTagValue(rawTags, 'research_status:');
    const sopDomain = normalizeSopDomain(sop.domain || taggedDomain);
    const researchType = normalizeResearchType(sop.research_type || taggedResearchType, sopDomain);
    
    // Calculate stats
    const use_count = usageLogs.length;
    const avg_score = use_count > 0 
      ? (usageLogs.reduce((sum, log) => sum + (log.score || 0), 0) / use_count).toFixed(1)
      : 0;
    const last_used = use_count > 0 
      ? new Date(Math.max(...usageLogs.map(l => new Date(l.created_at).getTime()))).toLocaleDateString()
      : '-';

    // Map history
    const history = versions.map(v => ({
      version: v.version,
      date: new Date(v.created_at).toLocaleDateString(),
      note: v.version_note || ''
    })).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    // Map validation (from usage logs where scene_id is present)
    const validation = usageLogs
      .filter(l => l.scene_id) // Assuming we have scene details available or just ID
      .map(l => ({
        scene: l.scene_id, // We might need to fetch scene title separately or join scenes
        date: new Date(l.created_at).toLocaleDateString(),
        score: l.score,
        note: l.notes
      }));

    // Map related scenes
    const relatedScenes = (sop.scene_sop_rel || []).map(rel => {
        const s = rel.scenes;
        return s ? {
            id: s.id,
            title: s.scene_type || 'Unknown Scene', // Fallback title
            score: 0, // Need to fetch score from usage logs or relations if stored there
            date: '-'
        } : null;
    }).filter(Boolean);

    // Map related people
    const relatedPeople = (sop.people_sop_rel || []).map(rel => {
        const p = rel.people_profiles;
        return p ? {
            id: p.id,
            name: p.name,
            role: p.identity || 'Unknown Role'
        } : null;
    }).filter(Boolean);

    return {
      id: sop.id,
      title: sop.title,
      category: sop.category,
      domain: sopDomain,
      research_type: researchType,
      research_status: normalizeResearchStatus(sop.research_status || taggedResearchStatus, researchType),
      promoted_to_life: !!sop.promoted_to_life || getSopTagValue(rawTags, 'promoted_to_life:') === 'true',
      promoted_at: sop.promoted_at || null,
      promoted_from_sop_id: sop.promoted_from_sop_id || getSopTagValue(rawTags, 'promoted_from:') || null,
      tags: stripSopSystemTags(rawTags),
      version: sop.version,
      created_at: new Date(sop.created_at).toLocaleDateString(),
      updated_at: new Date(sop.updated_at).toLocaleDateString(),
      content: unpackedContent.content,
      content_json: contentJson,
      stats: {
        use_count,
        avg_score: Number(avg_score),
        last_used,
        related_scenes_count: relatedScenes.length
      },
      related: {
        scenes: relatedScenes,
        people: relatedPeople,
        sops: []
      },
      history,
      validation
    };
  });

  return applySopFilters(mapped, filters);
};

const updateSOPMeta = async ({ id, userId, patch }) => {
  if (!supabase) throw new Error("Database connection not established. Check environment variables.");
  const payload = {};
  SOP_METADATA_FIELDS.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(patch || {}, field)) {
      payload[field] = patch[field];
    }
  });
  try {
    const { data: existing } = await supabase
      .from('sops')
      .select('tags')
      .eq('id', id)
      .eq('user_id', userId)
      .single();
    if (existing && Array.isArray(existing.tags)) {
      const existingTags = normalizeSopTags(existing.tags);
      payload.tags = existingTags;
      if (!Object.prototype.hasOwnProperty.call(payload, 'domain')) {
        const taggedDomain = getSopTagValue(existingTags, 'domain:');
        if (taggedDomain) payload.domain = taggedDomain;
      }
      if (!Object.prototype.hasOwnProperty.call(payload, 'research_type')) {
        const taggedResearchType = getSopTagValue(existingTags, 'research_type:');
        if (taggedResearchType) payload.research_type = taggedResearchType;
      }
      if (!Object.prototype.hasOwnProperty.call(payload, 'research_status')) {
        const taggedResearchStatus = getSopTagValue(existingTags, 'research_status:');
        if (taggedResearchStatus) payload.research_status = taggedResearchStatus;
      }
      if (!Object.prototype.hasOwnProperty.call(payload, 'promoted_from_sop_id')) {
        const taggedPromotedFrom = getSopTagValue(existingTags, 'promoted_from:');
        if (taggedPromotedFrom) payload.promoted_from_sop_id = taggedPromotedFrom;
      }
    }
  } catch {}
  payload.updated_at = new Date();

  const { data, error } = await runSopMutationWithFallback(
    (nextPayload) => supabase
      .from('sops')
      .update(nextPayload)
      .eq('id', id)
      .eq('user_id', userId)
      .select('id')
      .single(),
    payload,
    null
  );
  if (error) throw error;
  return data.id;
};

const compactSopText = (value, maxLength = 800) => {
  const text = String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#>*_`[\]()~-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text || text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trim()}...`;
};

const promoteSOPToLife = async ({ id, userId, title, summary }) => {
  const researchDocs = await getSOPs(userId, { domain: 'research' });
  let source = (researchDocs || []).find((item) => String(item.id) === String(id));
  if (!source) {
    const allDocs = await getSOPs(userId);
    const candidate = (allDocs || []).find((item) => String(item.id) === String(id));
    if (candidate && candidate.domain === 'research') source = candidate;
  }
  if (!source) throw new Error('Research item not found');

  const sourceTypeLabel = {
    document: 'document',
    idea: 'idea',
    meeting: 'meeting',
  }[source.research_type] || 'research';

  const summaryObj = summary && typeof summary === 'object' ? summary : {};
  const what = compactSopText(summaryObj.what || source.title || 'Untitled research item', 500);
  const why = compactSopText(summaryObj.why || '', 500);
  const impact = compactSopText(summaryObj.impact || '', 500);
  const followup = compactSopText(summaryObj.followup || '', 500);
  const sourceExcerpt = compactSopText(source.content || '', 700);
  const lifeTitle = String(title || `科研上浮：${source.title || '未命名科研条目'}`).trim().slice(0, 120);
  const promotedAt = new Date().toISOString();

  const content = [
    `# ${lifeTitle}`,
    '',
    `来源：${source.title || 'Untitled'} (${sourceTypeLabel})`,
    `来源ID：${source.id}`,
    `上浮时间：${promotedAt}`,
    '',
    '## 这件事是什么',
    what || sourceExcerpt || '待补充',
    '',
    '## 为什么重要',
    why || '待补充',
    '',
    '## 对时间/压力/方向/关系的影响',
    impact || '待补充',
    '',
    '## 是否需要进入复盘或计划',
    followup || '待补充',
  ].join('\n');

  const lifeId = await saveSOP({
    user_id: userId || DEFAULT_USER_ID,
    title: lifeTitle,
    category: 'note',
    tags: ['research-promoted', `research:${sourceTypeLabel}`, `source:${source.id}`],
    version: 'V1.0',
    content,
    content_json: null,
    domain: 'life',
    promoted_from_sop_id: source.id,
  });

  await updateSOPMeta({
    id: source.id,
    userId: userId || DEFAULT_USER_ID,
    patch: {
      promoted_to_life: true,
      promoted_at: promotedAt,
    },
  });

  return { id: lifeId, source_id: source.id, promoted_at: promotedAt };
};

const deleteSOP = async (sopId) => {
    if (!supabase) return;
    await supabase.from('sops').delete().eq('id', sopId);
}

const deleteSOPsByTitle = async (title) => {
    if (!supabase) return;
    const { error } = await supabase.from('sops').delete().eq('title', title);
    if (error) throw error;
}

// --- People Profiles ---

const savePersonProfile = async (profileData) => {
  if (!supabase) throw new Error("Database connection not established. Check environment variables.");

  const normalizeDate = (v) => {
    if (v === undefined || v === null) return null;
    if (typeof v === 'string') {
      const s = v.trim();
      return s ? s : null;
    }
    return v;
  };

  const normalizeBasicInfoExtra = (v) => {
    if (!Array.isArray(v)) return [];
    return v
      .map((it) => {
        if (!it || typeof it !== 'object') return null;
        return {
          id: typeof it.id === 'string' ? it.id : undefined,
          icon: typeof it.icon === 'string' ? it.icon : undefined,
          label: typeof it.label === 'string' ? it.label : '',
          value: typeof it.value === 'string' ? it.value : '',
        };
      })
      .filter((it) => it && (it.label.trim() || it.value.trim()));
  };

  if (profileData.id) {
      // Update existing
      const { data, error } = await supabase
        .from('people_profiles')
        .update({
            name: profileData.name,
            identity: profileData.identity,
            field: profileData.field,
            hometown: profileData.hometown,
            tags: profileData.tags,
            relationship_strength: profileData.relationship_strength,
            disc_type: profileData.disc_type,
            mbti_type: profileData.mbti_type,
            ai_analysis: profileData.ai_analysis,
            interaction_tips: profileData.interaction_tips,
            contact_info: profileData.contact_info,
            first_met_date: normalizeDate(profileData.first_met_date),
            first_met_scene: profileData.first_met_scene,
            current_mood: profileData.current_mood,
            triggers: profileData.triggers,
            pleasers: profileData.pleasers,
            private_info: profileData.private_info,
            birthday: normalizeDate(profileData.birthday),
            avatar_real: profileData.avatar_real,
            avatar_ai: profileData.avatar_ai,
            avatar_type: profileData.avatar_type,
            related_people: profileData.related_people,
            category: profileData.category, // Added category
            basic_info_extra: normalizeBasicInfoExtra(profileData.basic_info_extra),
            reaction_library: Array.isArray(profileData.reaction_library) ? profileData.reaction_library : [],
            updated_at: new Date()
        })
        .eq('id', profileData.id)
        .select('id')
        .single();

      if (error) throw error;
      return data.id;
  } else {
      // Insert new
      const { data, error } = await supabase
        .from('people_profiles')
        .insert([{
            user_id: profileData.user_id,
            name: profileData.name,
            identity: profileData.identity,
            field: profileData.field,
            hometown: profileData.hometown,
            tags: profileData.tags,
            relationship_strength: profileData.relationship_strength,
            disc_type: profileData.disc_type,
            mbti_type: profileData.mbti_type,
            ai_analysis: profileData.ai_analysis,
            interaction_tips: profileData.interaction_tips,
            contact_info: profileData.contact_info,
            first_met_date: normalizeDate(profileData.first_met_date),
            first_met_scene: profileData.first_met_scene,
            current_mood: profileData.current_mood,
            triggers: profileData.triggers,
            pleasers: profileData.pleasers,
            private_info: profileData.private_info,
            birthday: normalizeDate(profileData.birthday),
            avatar_real: profileData.avatar_real,
            avatar_ai: profileData.avatar_ai,
            avatar_type: profileData.avatar_type,
            related_people: profileData.related_people,
            category: profileData.category, // Added category
            basic_info_extra: normalizeBasicInfoExtra(profileData.basic_info_extra),
            reaction_library: Array.isArray(profileData.reaction_library) ? profileData.reaction_library : []
        }])
        .select('id')
        .single();

      if (error) throw error;
      return data.id;
  }
};

const updatePersonPrivateInfo = async (personId, privateInfo) => {
  if (!supabase) throw new Error("Database connection not established. Check environment variables.");

  const { data, error } = await supabase
    .from('people_profiles')
    .update({
      private_info: privateInfo,
      updated_at: new Date(),
    })
    .eq('id', personId)
    .select('id')
    .single();

  if (error) throw error;
  return data.id;
};

const updatePersonTriggersPleasers = async (personId, triggers, pleasers) => {
  if (!supabase) throw new Error("Database connection not established. Check environment variables.");

  const { data, error } = await supabase
    .from('people_profiles')
    .update({
      triggers: Array.isArray(triggers) ? triggers : [],
      pleasers: Array.isArray(pleasers) ? pleasers : [],
      updated_at: new Date(),
    })
    .eq('id', personId)
    .select('id')
    .single();

  if (error) throw error;
  return data.id;
};

const updatePersonReactionLibrary = async (personId, reactionLibrary) => {
  if (!supabase) throw new Error("Database connection not established. Check environment variables.");

  const { data, error } = await supabase
    .from('people_profiles')
    .update({
      reaction_library: Array.isArray(reactionLibrary) ? reactionLibrary : [],
      updated_at: new Date(),
    })
    .eq('id', personId)
    .select('id')
    .single();

  if (error) throw error;
  return data.id;
};

const updatePersonAIFollowUp = async (personId, suggestion) => {
  if (!supabase) throw new Error("Database connection not established. Check environment variables.");

  const { data, error } = await supabase
    .from('people_profiles')
    .update({
      ai_followup_suggestion: suggestion,
      updated_at: new Date(),
    })
    .eq('id', personId)
    .select('id')
    .single();

  if (!error) return data.id;

  const msg = String(error?.message || '');
  if (!msg.includes('ai_followup_suggestion')) throw error;

  const { data: personRow, error: getErr } = await supabase
    .from('people_profiles')
    .select('private_info')
    .eq('id', personId)
    .single();
  if (getErr) throw getErr;

  let parsedPrivate = {};
  if (personRow?.private_info && typeof personRow.private_info === 'string') {
    try {
      const x = JSON.parse(personRow.private_info);
      if (x && typeof x === 'object') parsedPrivate = x;
    } catch {}
  } else if (personRow?.private_info && typeof personRow.private_info === 'object') {
    parsedPrivate = personRow.private_info;
  }

  const nextPrivate = {
    ...(parsedPrivate || {}),
    ai_followup_suggestion: suggestion,
  };

  const { data: fallbackData, error: fallbackErr } = await supabase
    .from('people_profiles')
    .update({
      private_info: JSON.stringify(nextPrivate),
      updated_at: new Date(),
    })
    .eq('id', personId)
    .select('id')
    .single();
  if (fallbackErr) throw fallbackErr;
  return fallbackData.id;
};

const deletePersonProfile = async (personId) => {
  if (!supabase) throw new Error("Database connection not established. Check environment variables.");
  const { error } = await supabase
    .from('people_profiles')
    .delete()
    .eq('id', personId);
  if (error) throw error;
  return personId;
};

const getPlannerLists = async (userId) => {
  if (!supabase || !userId) return [];
  const { data, error } = await supabase
    .from('planner_lists')
    .select('*')
    .eq('user_id', userId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
};

const ensurePlannerInbox = async (userId) => {
  if (!supabase || !userId) return null;
  const { data: existing, error: existingError } = await supabase
    .from('planner_lists')
    .select('*')
    .eq('user_id', userId)
    .eq('is_default_inbox', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) return existing;

  const { data, error } = await supabase
    .from('planner_lists')
    .insert([{ user_id: userId, name: '收集箱', sort_order: 0, is_default_inbox: true }])
    .select('*')
    .single();
  if (error) throw error;
  return data;
};

const createPlannerList = async ({ userId, name }) => {
  if (!supabase) throw new Error("Database connection not established. Check environment variables.");
  const cleanName = String(name || '').trim();
  if (!cleanName) throw new Error('List name is required');
  const { data, error } = await supabase
    .from('planner_lists')
    .insert([{ user_id: userId, name: cleanName, updated_at: new Date() }])
    .select('*')
    .single();
  if (error) throw error;
  return data;
};

const updatePlannerList = async ({ id, userId, patch }) => {
  if (!supabase) throw new Error("Database connection not established. Check environment variables.");
  const next = { ...patch, updated_at: new Date() };
  const { data, error } = await supabase
    .from('planner_lists')
    .update(next)
    .eq('id', id)
    .eq('user_id', userId)
    .select('*')
    .single();
  if (error) throw error;
  return data;
};

const deletePlannerList = async ({ id, userId }) => {
  if (!supabase) throw new Error("Database connection not established. Check environment variables.");
  const { error } = await supabase
    .from('planner_lists')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);
  if (error) throw error;
  return id;
};

const normalizeTs = (v) => {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
};

const createPlannerItem = async ({ userId, item }) => {
  if (!supabase) throw new Error("Database connection not established. Check environment variables.");
  const type = item?.type === 'event' ? 'event' : 'task';
  const title = String(item?.title || '').trim();
  if (!title) throw new Error('Title is required');
  const payload = {
    user_id: userId,
    type,
    title,
    note: item?.note ?? null,
    start_at: normalizeTs(item?.start_at),
    end_at: normalizeTs(item?.end_at),
    is_all_day: !!item?.is_all_day,
    due_at: normalizeTs(item?.due_at),
    status: item?.status || 'open',
    priority: item?.priority || 'medium',
    list_id: item?.list_id ?? null,
    remind_at: normalizeTs(item?.remind_at),
    updated_at: new Date(),
  };
  const { data, error } = await supabase
    .from('planner_items')
    .insert([payload])
    .select('*')
    .single();
  if (error) throw error;
  return data;
};

const updatePlannerItem = async ({ id, userId, patch }) => {
  if (!supabase) throw new Error("Database connection not established. Check environment variables.");
  const next = { ...patch };
  if ('title' in next) next.title = String(next.title || '').trim();
  if ('start_at' in next) next.start_at = normalizeTs(next.start_at);
  if ('end_at' in next) next.end_at = normalizeTs(next.end_at);
  if ('due_at' in next) next.due_at = normalizeTs(next.due_at);
  if ('remind_at' in next) next.remind_at = normalizeTs(next.remind_at);
  next.updated_at = new Date();

  const { data, error } = await supabase
    .from('planner_items')
    .update(next)
    .eq('id', id)
    .eq('user_id', userId)
    .select('*')
    .single();
  if (error) throw error;
  return data;
};

const deletePlannerItem = async ({ id, userId }) => {
  if (!supabase) throw new Error("Database connection not established. Check environment variables.");
  const { error } = await supabase
    .from('planner_items')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);
  if (error) throw error;
  return id;
};

const listPlannerItems = async ({ userId, type, status, listId, startAt, endAt, dueBefore, dueAfter }) => {
  if (!supabase || !userId) return [];
  let q = supabase
    .from('planner_items')
    .select('*')
    .eq('user_id', userId);
  if (type) q = q.eq('type', type);
  if (status) q = q.eq('status', status);
  else q = q.neq('status', 'archived');
  if (listId) q = q.eq('list_id', listId);

  if (type === 'event') {
    if (startAt && endAt) {
      q = q.lt('start_at', endAt).gt('end_at', startAt);
    } else {
      if (startAt) q = q.gte('start_at', startAt);
      if (endAt) q = q.lte('start_at', endAt);
    }
    q = q.order('start_at', { ascending: true }).order('created_at', { ascending: true });
  } else {
    if (dueAfter) q = q.gte('due_at', dueAfter);
    if (dueBefore) q = q.lte('due_at', dueBefore);
    q = q.order('due_at', { ascending: true, nullsFirst: false }).order('created_at', { ascending: true });
  }

  const { data, error } = await q;
  if (error) throw error;
  return data || [];
};

const getPeopleProfiles = async (userId) => {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('people_profiles')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });

  if (error) {
    console.error('getPeopleProfiles error', error);
    return [];
  }

  // Enrich with last interaction log summary
  const enrichedData = await Promise.all(data.map(async (person) => {
      // In a real optimized scenario, we would use a join or a view
      // For now, doing N+1 query is acceptable for MVP with small data
      const { data: logs } = await supabase
          .from('interaction_logs')
          .select('event_context, event_date')
          .eq('person_id', person.id)
          .order('event_date', { ascending: false })
          .limit(1);
      
      let aiFollowUpSuggestion = person.ai_followup_suggestion || null;
      if (!aiFollowUpSuggestion && person.private_info) {
        try {
          const info = typeof person.private_info === 'string' ? JSON.parse(person.private_info) : person.private_info;
          if (info && typeof info === 'object' && info.ai_followup_suggestion) {
            aiFollowUpSuggestion = info.ai_followup_suggestion;
          }
        } catch {}
      }

      return {
          ...person,
          ai_followup_suggestion: aiFollowUpSuggestion,
          last_interaction: logs && logs.length > 0 ? logs[0].event_context : null,
          last_interaction_date: logs && logs.length > 0 ? logs[0].event_date : null
      };
  }));

  return enrichedData;
};

// --- Interaction Logs ---

const saveInteractionLog = async (logData) => {
  if (!supabase) throw new Error("Database connection not established. Check environment variables.");

  const { data, error } = await supabase
    .from('interaction_logs')
    .insert([{
        person_id: logData.person_id,
        event_date: logData.event_date,
        event_context: logData.event_context,
        my_behavior: logData.my_behavior,
        their_reaction: logData.their_reaction,
        relationship_change: logData.relationship_change,
        ai_analysis: logData.ai_analysis,
        ai_review: logData.ai_review // Added ai_review
    }])
    .select('id')
    .single();

  if (error) throw error;
  
  // Update person timestamp and relationship strength
  // 1. Get current strength
  const { data: personData, error: personError } = await supabase
      .from('people_profiles')
      .select('relationship_strength')
      .eq('id', logData.person_id)
      .single();

  if (!personError && personData) {
      let currentStrength = personData.relationship_strength || 0;
      let newStrength = currentStrength + (logData.relationship_change || 0);
      
      // Clamp between 0 and 100
      newStrength = Math.max(0, Math.min(100, newStrength));

      await supabase
        .from('people_profiles')
        .update({ 
            updated_at: new Date(),
            relationship_strength: newStrength
        })
        .eq('id', logData.person_id);
  } else {
      // Fallback if fetch fails, just update timestamp
      await supabase
        .from('people_profiles')
        .update({ updated_at: new Date() })
        .eq('id', logData.person_id);
  }

  return data.id;
};

const updateInteractionLog = async (logId, updates) => {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('interaction_logs')
    .update(updates)
    .eq('id', logId)
    .select('id')
    .single();
  if (error) throw error;
  return data;
};

const deleteInteractionLog = async (logId) => {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('interaction_logs')
    .delete()
    .eq('id', logId)
    .select('id, person_id')
    .single();
  if (error) throw error;
  return data;
};

const getInteractionLogs = async (personId) => {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('interaction_logs')
    .select('*')
    .eq('person_id', personId)
    .order('event_date', { ascending: false });

  if (error) return [];
  return data;
};

// --- Review Sessions (Real Scene Review) ---

const saveReviewSession = async (sessionData) => {
    if (!supabase) throw new Error("Database connection not established. Check environment variables.");

    // Check if exists
    if (sessionData.id && sessionData.id.length > 10) {
        const { data, error } = await supabase
            .from('review_sessions')
            .update({
                title: sessionData.title,
                status: sessionData.status,
                review_type: sessionData.type,
                result: sessionData.result,
                messages: sessionData.messages,
                summary_data: sessionData.summaryData, // JSON
                updated_at: new Date()
            })
            .eq('id', sessionData.id)
            .select('id')
            .single();
        if (error) throw error;
        return data.id;
    } else {
        const { data, error } = await supabase
            .from('review_sessions')
            .insert([{
                user_id: sessionData.user_id || DEFAULT_USER_ID,
                title: sessionData.title,
                status: sessionData.status,
                review_type: sessionData.type,
                result: sessionData.result,
                messages: sessionData.messages,
                summary_data: sessionData.summaryData,
                created_at: new Date(),
                updated_at: new Date()
            }])
            .select('id')
            .single();
        if (error) throw error;
        return data.id;
    }
};

const getReviewSessions = async (userId) => {
    if (!supabase) return [];
    const { data, error } = await supabase
        .from('review_sessions')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
    
    if (error) {
        console.error('getReviewSessions error', error);
        return [];
    }

    return data.map(s => ({
        id: s.id,
        title: s.title,
        date: new Date(s.created_at).toLocaleDateString(),
        status: s.status,
        type: s.review_type,
        result: s.result,
        messages: s.messages || [],
        summaryData: s.summary_data
    }));
};

const getReviewSession = async (sessionId) => {
    const { data, error } = await supabase
        .from('review_sessions')
        .select('*')
        .eq('id', sessionId)
        .single();
    if (error) return null;
    return data;
};

// --- NPC Relations ---

const saveNPCRelation = async (relationData) => {
    if (!supabase) throw new Error("Database connection not established. Check environment variables.");

    const { data, error } = await supabase
        .from('user_npc_relations')
        .insert([relationData])
        .select()
        .single();
    if (error) throw error;
    return data.id;
};

const getNPCRelations = async (userId) => {
    const { data, error } = await supabase
        .from('user_npc_relations')
        .select('*')
        .eq('user_id', userId)
        .order('last_met_at', { ascending: false });
    if (error) return [];
    return data;
};

const updateNPCRelation = async (id, updates) => {
    const { error } = await supabase
        .from('user_npc_relations')
        .update({ ...updates, updated_at: new Date() })
        .eq('id', id);
    if (error) throw error;
};

const getUserStats = async (userId) => {
    if (!supabase) return null;

    // 1. Count completed reviews by type
    const { data: reviews, error: reviewError } = await supabase
        .from('review_sessions')
        .select('review_type, status')
        .eq('user_id', userId)
        .eq('status', 'completed');

    if (reviewError) {
        console.error("Error fetching review stats", reviewError);
        return null;
    }

    const reviewCounts = {
        negotiation: 0,
        social: 0,
        speech: 0,
        conflict: 0,
        other: 0,
        total: 0
    };

    reviews.forEach(r => {
        if (reviewCounts[r.review_type] !== undefined) {
            reviewCounts[r.review_type]++;
        } else {
            reviewCounts.other++;
        }
        reviewCounts.total++;
    });

    // 2. Count People profiles
    const { count: peopleCount } = await supabase
        .from('people_profiles')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId);

    // 3. Count life-domain SOPs/documents only, so research notes do not inflate the life dashboard.
    const lifeSops = await getSOPs(userId, { domain: 'life' });
    const sopCount = lifeSops.length;

    // 4. Calculate Scores (Simple Logic based on activity)
    // In a real app, this would be more complex based on scene results
    const scores = {
        business_cognition: Math.min(100, (reviewCounts.negotiation * 5) + 20),
        people_skills: Math.min(100, (reviewCounts.social * 5) + (peopleCount * 2) + 20),
        personal_branding: Math.min(100, (sopCount * 10) + 10),
        communication: Math.min(100, (reviewCounts.speech * 10) + (reviewCounts.social * 2) + 30),
        resource_integration: Math.min(100, (reviewCounts.negotiation * 3) + 10),
        risk_management: Math.min(100, (reviewCounts.conflict * 8) + 20)
    };

    return {
        reviewCounts,
        peopleCount: peopleCount || 0,
        sopCount: sopCount || 0,
        scores
    };
};

const getAllUserData = async (userId) => {
  if (!supabase) return null;

  try {
    const { data: scenes } = await supabase.from('scenes').select('*').eq('user_id', userId);
    const { data: sops } = await supabase
      .from('sops')
      .select('*, sop_versions(*), sop_usage_logs(*), scene_sop_rel(*), people_sop_rel(*)')
      .eq('user_id', userId);
    const { data: people } = await supabase.from('people_profiles').select('*').eq('user_id', userId);
    const { data: reviews } = await supabase.from('review_sessions').select('*').eq('user_id', userId);
    const { data: npcRelations } = await supabase.from('user_npc_relations').select('*').eq('user_id', userId);
    const { data: plannerLists } = await supabase.from('planner_lists').select('*').eq('user_id', userId);
    const { data: plannerItems } = await supabase.from('planner_items').select('*').eq('user_id', userId);
    const { data: plannerTags } = await supabase.from('planner_tags').select('*').eq('user_id', userId);
    const { data: plannerItemTags } = await supabase.from('planner_item_tags').select('*').eq('user_id', userId);
    
    // Interaction logs (need to fetch all related to the user's people profiles)
    let logs = [];
    if (people && people.length > 0) {
        const personIds = people.map(p => p.id);
        const { data: interactionLogs } = await supabase.from('interaction_logs').select('*').in('person_id', personIds);
        logs = interactionLogs || [];
    }

    let relations = {};
    try {
      const sopIds = (sops || []).map((s) => s.id).filter(Boolean);
      const sceneIds = (scenes || []).map((s) => s.id).filter(Boolean);
      const peopleIds = (people || []).map((p) => p.id).filter(Boolean);

      const relOut = {};

      const uniqBy = (arr, key) => {
        const seen = new Set();
        const out = [];
        (arr || []).forEach((x) => {
          const k = x && x[key];
          if (!k || seen.has(k)) return;
          seen.add(k);
          out.push(x);
        });
        return out;
      };

      let sceneSopRel = [];
      if (sopIds.length) {
        const { data } = await supabase.from('scene_sop_rel').select('*').in('sop_id', sopIds);
        sceneSopRel = sceneSopRel.concat(data || []);
      }
      if (sceneIds.length) {
        const { data } = await supabase.from('scene_sop_rel').select('*').in('scene_id', sceneIds);
        sceneSopRel = sceneSopRel.concat(data || []);
      }
      relOut.scene_sop_rel = uniqBy(sceneSopRel, 'id');

      let peopleSopRel = [];
      if (sopIds.length) {
        const { data } = await supabase.from('people_sop_rel').select('*').in('sop_id', sopIds);
        peopleSopRel = peopleSopRel.concat(data || []);
      }
      if (peopleIds.length) {
        const { data } = await supabase.from('people_sop_rel').select('*').in('people_id', peopleIds);
        peopleSopRel = peopleSopRel.concat(data || []);
      }
      relOut.people_sop_rel = uniqBy(peopleSopRel, 'id');

      relations = relOut;
    } catch (e) {
      relations = { _error: e?.message || 'Failed to fetch relation tables' };
    }

    let sopVersions = [];
    try {
      const sopIds = (sops || []).map((s) => s.id).filter(Boolean);
      if (sopIds.length) {
        const { data } = await supabase.from('sop_versions').select('*').in('sop_id', sopIds);
        sopVersions = data || [];
      }
    } catch {
      sopVersions = [];
    }

    let sopUsageLogs = [];
    try {
      const { data } = await supabase.from('sop_usage_logs').select('*').eq('user_id', userId);
      sopUsageLogs = data || [];
    } catch {
      sopUsageLogs = [];
    }

    const tables = {
      scenes: scenes || [],
      sops: sops || [],
      sop_versions: sopVersions,
      sop_usage_logs: sopUsageLogs,
      scene_sop_rel: Array.isArray(relations?.scene_sop_rel) ? relations.scene_sop_rel : [],
      people_sop_rel: Array.isArray(relations?.people_sop_rel) ? relations.people_sop_rel : [],
      people_profiles: people || [],
      interaction_logs: logs,
      review_sessions: reviews || [],
      user_npc_relations: npcRelations || [],
      planner_lists: plannerLists || [],
      planner_items: plannerItems || [],
      planner_tags: plannerTags || [],
      planner_item_tags: plannerItemTags || [],
    };

    return {
        timestamp: new Date().toISOString(),
        userId,
        scenes: scenes || [],
        sops: sops || [],
        people: people || [],
        interactionLogs: logs,
        reviewSessions: reviews || [],
        npcRelations: npcRelations || [],
        planner: {
          lists: plannerLists || [],
          items: plannerItems || [],
          tags: plannerTags || [],
          itemTags: plannerItemTags || [],
        },
        tables,
        relations,
    };
  } catch (err) {
    console.error("Export Error:", err);
    throw err;
  }
};

const uploadFile = async (fileBuffer, fileName, mimeType) => {
    if (!supabase) throw new Error("Database connection not established");

    const { data, error } = await supabase.storage
        .from('sop-images')
        .upload(fileName, fileBuffer, {
            contentType: mimeType,
            upsert: false
        });

    if (error) {
        console.error("Upload Error:", error);
        throw error;
    }

    const { data: publicData } = supabase.storage
        .from('sop-images')
        .getPublicUrl(fileName);

    return publicData.publicUrl;
};

module.exports = { 
  initDB, saveScene, getRecentScenes, saveSOP, getSOPs, updateSOPMeta, promoteSOPToLife, deleteSOP, deleteSOPsByTitle,
  savePersonProfile, updatePersonPrivateInfo, updatePersonTriggersPleasers, updatePersonReactionLibrary, updatePersonAIFollowUp, deletePersonProfile, getPeopleProfiles, saveInteractionLog, getInteractionLogs, updateInteractionLog, deleteInteractionLog,
  saveReviewSession, getReviewSessions, getReviewSession, getUserStats,
  getPlannerLists, ensurePlannerInbox, createPlannerList, updatePlannerList, deletePlannerList,
  createPlannerItem, updatePlannerItem, deletePlannerItem, listPlannerItems,
  saveNPCRelation, getNPCRelations, updateNPCRelation, getAllUserData, uploadFile
};
