const { createClient } = require('@supabase/supabase-js');
const { ChromaClient } = require('chromadb');

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

const initDB = async () => {
  if (supabase) {
    console.log('✅ Connected to Supabase');
  } else {
    console.warn('⚠️ Supabase credentials missing. Data will NOT be persisted.');
  }

  try {
    scenesCollection = await chromaClient.getOrCreateCollection({ name: "scene_embeddings" });
    sopCollection = await chromaClient.getOrCreateCollection({ name: "sop_embeddings" });
    console.log('✅ Connected to ChromaDB Collections');

    // Init Storage Bucket
    const { data: buckets } = await supabase.storage.listBuckets();
    if (!buckets.find(b => b.name === 'sop-images')) {
        await supabase.storage.createBucket('sop-images', { public: true });
        console.log('✅ Created "sop-images" storage bucket');
    }
  } catch (chromaErr) {
    console.warn('⚠️ ChromaDB Connection Failed (Is it running?):', chromaErr.message);
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

  // Check if updating or inserting
  if (sopData.id && sopData.id.length > 10) { // Simple check for UUID vs mock ID
      const { data, error } = await supabase
        .from('sops')
        .update({
            title: sopData.title,
            category: sopData.category,
            tags: sopData.tags,
            version: sopData.version,
            content: sopData.content,
            updated_at: new Date()
        })
        .eq('id', sopData.id)
        .select('id')
        .single();
        
      if (error) throw error;
      sopId = data.id;
  } else {
      const { data, error } = await supabase
        .from('sops')
        .insert([{
            user_id: sopData.user_id || 'test-user', // Default for now
            title: sopData.title,
            category: sopData.category,
            tags: sopData.tags,
            version: sopData.version,
            content: sopData.content,
            // related_scenes is legacy, we use relational tables now
        }])
        .select('id')
        .single();

      if (error) throw error;
      sopId = data.id;
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
        await supabase.from('sop_versions').insert({
            sop_id: sopId,
            version: latestHistory.version,
            content: sopData.content,
            version_note: latestHistory.note
        });
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

const getSOPs = async (userId) => {
  if (!supabase) return [];

  // Fetch SOPs with their related data
  // Note: This relies on foreign key relationships being detected by Supabase/PostgREST
  const { data, error } = await supabase
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
    .order('updated_at', { ascending: false });

  if (error) {
    console.error('Error fetching SOPs:', error);
    return [];
  }
  
  // Transform data to match frontend SOPEntity structure
  return data.map(sop => {
    const usageLogs = sop.sop_usage_logs || [];
    const versions = sop.sop_versions || [];
    
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
      tags: sop.tags || [],
      version: sop.version,
      created_at: new Date(sop.created_at).toLocaleDateString(),
      updated_at: new Date(sop.updated_at).toLocaleDateString(),
      content: sop.content,
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

  if (profileData.id) {
      // Update existing
      const { data, error } = await supabase
        .from('people_profiles')
        .update({
            name: profileData.name,
            identity: profileData.identity,
            field: profileData.field,
            tags: profileData.tags,
            relationship_strength: profileData.relationship_strength,
            disc_type: profileData.disc_type,
            mbti_type: profileData.mbti_type,
            ai_analysis: profileData.ai_analysis,
            interaction_tips: profileData.interaction_tips,
            contact_info: profileData.contact_info,
            first_met_date: profileData.first_met_date,
            first_met_scene: profileData.first_met_scene,
            current_mood: profileData.current_mood,
            triggers: profileData.triggers,
            pleasers: profileData.pleasers,
            private_info: profileData.private_info,
            birthday: profileData.birthday,
            avatar_real: profileData.avatar_real,
            avatar_ai: profileData.avatar_ai,
            avatar_type: profileData.avatar_type,
            related_people: profileData.related_people,
            category: profileData.category, // Added category
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
            tags: profileData.tags,
            relationship_strength: profileData.relationship_strength,
            disc_type: profileData.disc_type,
            mbti_type: profileData.mbti_type,
            ai_analysis: profileData.ai_analysis,
            interaction_tips: profileData.interaction_tips,
            contact_info: profileData.contact_info,
            first_met_date: profileData.first_met_date,
            first_met_scene: profileData.first_met_scene,
            current_mood: profileData.current_mood,
            triggers: profileData.triggers,
            pleasers: profileData.pleasers,
            private_info: profileData.private_info,
            birthday: profileData.birthday,
            avatar_real: profileData.avatar_real,
            avatar_ai: profileData.avatar_ai,
            avatar_type: profileData.avatar_type,
            related_people: profileData.related_people,
            category: profileData.category // Added category
        }])
        .select('id')
        .single();

      if (error) throw error;
      return data.id;
  }
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
          .select('event_context')
          .eq('person_id', person.id)
          .order('event_date', { ascending: false })
          .limit(1);
      
      return {
          ...person,
          last_interaction: logs && logs.length > 0 ? logs[0].event_context : null
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
                user_id: sessionData.user_id || 'user-1',
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

    // 3. Count SOPs
    const { count: sopCount } = await supabase
        .from('sops')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId);

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
    const { data: sops } = await supabase.from('sops').select('*, sop_versions(*), sop_usage_logs(*)').eq('user_id', userId);
    const { data: people } = await supabase.from('people_profiles').select('*').eq('user_id', userId);
    const { data: reviews } = await supabase.from('review_sessions').select('*').eq('user_id', userId);
    const { data: npcRelations } = await supabase.from('user_npc_relations').select('*').eq('user_id', userId);
    
    // Interaction logs (need to fetch all related to the user's people profiles)
    let logs = [];
    if (people && people.length > 0) {
        const personIds = people.map(p => p.id);
        const { data: interactionLogs } = await supabase.from('interaction_logs').select('*').in('person_id', personIds);
        logs = interactionLogs || [];
    }

    return {
        timestamp: new Date().toISOString(),
        userId,
        scenes: scenes || [],
        sops: sops || [],
        people: people || [],
        interactionLogs: logs,
        reviewSessions: reviews || [],
        npcRelations: npcRelations || []
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

    if (error) throw error;

    const { data: publicData } = supabase.storage
        .from('sop-images')
        .getPublicUrl(fileName);

    return publicData.publicUrl;
};

module.exports = { 
  initDB, saveScene, getRecentScenes, saveSOP, getSOPs, deleteSOP, deleteSOPsByTitle,
  savePersonProfile, getPeopleProfiles, saveInteractionLog, getInteractionLogs, updateInteractionLog,
  saveReviewSession, getReviewSessions, getReviewSession, getUserStats,
  saveNPCRelation, getNPCRelations, updateNPCRelation, getAllUserData, uploadFile
};
