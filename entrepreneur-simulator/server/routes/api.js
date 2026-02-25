const sceneService = require('../services/sceneService');
const chatService = require('../services/chatService');
const dbService = require('../services/dbService');

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
    return sops;
  });

  fastify.post('/sop/create', async (request, reply) => {
    try {
      const sopData = request.body;
      const id = await dbService.saveSOP(sopData);
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
      reply.code(500).send({ error: 'Failed to save Person Profile' });
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