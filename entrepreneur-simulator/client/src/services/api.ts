
const API_BASE_URL = '/api';
export const CURRENT_USER_ID = 'user-1';

export const api = {
    // SOPs
    getSOPs: async (userId: string = CURRENT_USER_ID) => {
        const response = await fetch(`${API_BASE_URL}/sop/${userId}`);
        if (!response.ok) throw new Error('Failed to fetch SOPs');
        return response.json();
    },

    uploadImage: async (file: File) => {
        const formData = new FormData();
        formData.append('file', file);
        
        const response = await fetch(`${API_BASE_URL}/upload`, {
            method: 'POST',
            body: formData,
        });
        
        if (!response.ok) {
            const text = await response.text().catch(() => '');
            const statusHint = `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;
            if (!text) throw new Error(`Failed to upload image (${statusHint})`);
            try {
                const errorData = JSON.parse(text);
                throw new Error(errorData.error || errorData.detail || `Failed to upload image (${statusHint})`);
            } catch {
                throw new Error(`Failed to upload image (${statusHint}): ${text.substring(0, 160)}`);
            }
        }
        return response.json();
    },

    createSOP: async (sopData: any) => {
        // Ensure user_id is present
        const dataToSend = { ...sopData, user_id: sopData.user_id || CURRENT_USER_ID };
        
        // Ensure content is not undefined or empty string if it's supposed to be JSON for some cases
        // But for SOPs, content is usually Markdown string.
        // If it's empty, make sure it's an empty string, not undefined.
        if (dataToSend.content === undefined || dataToSend.content === null) {
            dataToSend.content = '';
        }

        const response = await fetch(`${API_BASE_URL}/sop/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(dataToSend)
        });
        
        const text = await response.text();
        const statusHint = `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;

        if (!response.ok) {
            if (!text) throw new Error(`创建失败（${statusHint}）：服务无响应或返回空内容`);
            try {
                const data = JSON.parse(text);
                throw new Error(data.error || `创建失败（${statusHint}）`);
            } catch {
                throw new Error(`创建失败（${statusHint}）：${text.substring(0, 120)}`);
            }
        }

        if (!text) {
            throw new Error(`创建失败（${statusHint}）：服务返回空内容（未拿到 ID）`);
        }

        try {
            const data = JSON.parse(text);
            if (!data.id) {
                throw new Error('Server response missing SOP ID');
            }
            return data;
        } catch (e: any) {
            console.error("JSON Parse Error:", e, "Response Text:", text);
            throw new Error(e.message || `Invalid JSON response: ${text.substring(0, 100)}...`);
        }
    },

    deleteSOP: async (id: string) => {
        const response = await fetch(`${API_BASE_URL}/sop/${id}`, {
            method: 'DELETE'
        });
        if (!response.ok) throw new Error('Failed to delete SOP');
        return response.json();
    },

    // Scenes (for related selection)
    getAllScenes: async (userId: string = CURRENT_USER_ID) => {
         const response = await fetch(`${API_BASE_URL}/history/${userId}`); 
         if (!response.ok) throw new Error('Failed to fetch scenes');
         return response.json();
    },

    // People (for related selection)
    getAllPeople: async (userId: string = CURRENT_USER_ID) => {
        const response = await fetch(`${API_BASE_URL}/people/${userId}`);
        if (!response.ok) throw new Error('Failed to fetch people');
        return response.json();
    },

    createPerson: async (personData: any) => {
        const dataToSend = { ...personData, user_id: personData.user_id || CURRENT_USER_ID };
        const response = await fetch(`${API_BASE_URL}/people/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(dataToSend)
        });
        if (!response.ok) throw new Error('Failed to create person');
        return response.json();
    },

    updatePerson: async (id: string, personData: any) => {
        const response = await fetch(`${API_BASE_URL}/people/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(personData)
        });
        if (!response.ok) {
            const text = await response.text().catch(() => '');
            const statusHint = `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;
            if (!text) throw new Error(`Failed to update person (${statusHint})`);
            try {
                const data = JSON.parse(text);
                throw new Error(data.error || data.detail || `Failed to update person (${statusHint})`);
            } catch {
                throw new Error(`Failed to update person (${statusHint}): ${text.substring(0, 160)}`);
            }
        }
        return response.json();
    },

    deletePerson: async (id: string) => {
        const response = await fetch(`${API_BASE_URL}/people/${id}`, {
            method: 'DELETE'
        });
        if (!response.ok) throw new Error('Failed to delete person');
        return response.json();
    },

    updatePersonProfileAnalysis: async (id: string, profileAnalysis: any) => {
        const response = await fetch(`${API_BASE_URL}/people/${id}/profile-analysis`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ profile_analysis: profileAnalysis })
        });
        if (!response.ok) throw new Error('Failed to update profile analysis');
        return response.json();
    },

    getPlannerLists: async (userId: string = CURRENT_USER_ID) => {
        const response = await fetch(`${API_BASE_URL}/planner/lists/${userId}`);
        if (!response.ok) throw new Error('Failed to fetch planner lists');
        return response.json();
    },

    getPlannerItems: async (userId: string = CURRENT_USER_ID, opts?: { view?: 'today' | 'overdue' | 'upcoming'; listId?: string; dueBefore?: string }) => {
        const params = new URLSearchParams();
        if (opts?.view) params.set('view', opts.view);
        if (opts?.listId) params.set('listId', opts.listId);
        if (opts?.dueBefore) params.set('dueBefore', opts.dueBefore);
        const q = params.toString();
        const response = await fetch(`${API_BASE_URL}/planner/items/${userId}${q ? `?${q}` : ''}`);
        if (!response.ok) throw new Error('Failed to fetch planner items');
        return response.json();
    },

    getPlannerEvents: async (userId: string = CURRENT_USER_ID, opts: { startAt: string; endAt: string; listId?: string }) => {
        const params = new URLSearchParams();
        params.set('type', 'event');
        params.set('startAt', opts.startAt);
        params.set('endAt', opts.endAt);
        if (opts.listId) params.set('listId', opts.listId);
        const response = await fetch(`${API_BASE_URL}/planner/items/${userId}?${params.toString()}`);
        if (!response.ok) throw new Error('Failed to fetch planner events');
        return response.json();
    },

    getPlannerCalendarItems: async (userId: string = CURRENT_USER_ID, opts: { startAt: string; endAt: string; listId?: string }) => {
        const params = new URLSearchParams();
        params.set('type', 'calendar');
        params.set('startAt', opts.startAt);
        params.set('endAt', opts.endAt);
        if (opts.listId) params.set('listId', opts.listId);
        const response = await fetch(`${API_BASE_URL}/planner/items/${userId}?${params.toString()}`);
        if (!response.ok) throw new Error('Failed to fetch planner calendar items');
        return response.json();
    },

    createPlannerItem: async (userId: string, item: any) => {
        const response = await fetch(`${API_BASE_URL}/planner/items`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, item })
        });
        if (!response.ok) throw new Error('Failed to create planner item');
        return response.json();
    },

    updatePlannerItem: async (id: string, userId: string, patch: any) => {
        const response = await fetch(`${API_BASE_URL}/planner/items/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, patch })
        });
        if (!response.ok) throw new Error('Failed to update planner item');
        return response.json();
    },

    deletePlannerItem: async (id: string, userId: string) => {
        const response = await fetch(`${API_BASE_URL}/planner/items/${id}?userId=${encodeURIComponent(userId)}`, {
            method: 'DELETE'
        });
        if (!response.ok) throw new Error('Failed to delete planner item');
        return response.json();
    },

    parsePlannerText: async (userId: string, payload: { text: string; listId?: string | null; tzOffsetMinutes?: number }) => {
        const response = await fetch(`${API_BASE_URL}/planner/nl/parse`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, ...payload })
        });
        if (!response.ok) throw new Error('Failed to parse planner text');
        return response.json();
    },

    updatePersonReactionLibrary: async (id: string, reactionLibrary: any[]) => {
        const response = await fetch(`${API_BASE_URL}/people/${id}/reaction-library`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reaction_library: reactionLibrary })
        });
        if (!response.ok) throw new Error('Failed to update reaction library');
        return response.json();
    },

    analyzePerson: async (personId: string, currentData?: any) => {
        const response = await fetch(`${API_BASE_URL}/people/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ personId, currentData })
        });
        if (!response.ok) throw new Error('Failed to analyze person');
        return response.json();
    },

    generateAIFollowUpSuggestion: async (personId: string, userId: string = CURRENT_USER_ID) => {
        const response = await fetch(`${API_BASE_URL}/people/${personId}/ai-suggestion`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId })
        });
        if (!response.ok) {
            const text = await response.text().catch(() => '');
            if (!text) throw new Error('刷新 AI 建议失败');
            try {
                const json = JSON.parse(text);
                throw new Error(json?.detail || json?.error || '刷新 AI 建议失败');
            } catch {
                throw new Error(text.substring(0, 160));
            }
        }
        return response.json();
    },

    generateStrategySuggestion: async (personId: string, userId: string = CURRENT_USER_ID) => {
        const response = await fetch(`${API_BASE_URL}/people/${personId}/strategy-suggestion`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId })
        });
        if (!response.ok) {
            const text = await response.text().catch(() => '');
            if (!text) throw new Error('生成策略建议失败');
            try {
                const json = JSON.parse(text);
                throw new Error(json?.detail || json?.error || '生成策略建议失败');
            } catch {
                throw new Error(text.substring(0, 160));
            }
        }
        return response.json();
    },

    evaluateStrategy: async (personId: string, userId: string = CURRENT_USER_ID) => {
        const response = await fetch(`${API_BASE_URL}/people/${personId}/strategy-evaluate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId })
        });
        if (!response.ok) {
            const text = await response.text().catch(() => '');
            if (!text) throw new Error('策略评估失败');
            try {
                const json = JSON.parse(text);
                throw new Error(json?.detail || json?.error || '策略评估失败');
            } catch {
                throw new Error(text.substring(0, 160));
            }
        }
        return response.json();
    },

    getSecretaryDaily: async (userId: string = CURRENT_USER_ID, opts?: { refresh?: boolean }) => {
        const url = new URL(`${API_BASE_URL}/secretary/daily/${encodeURIComponent(userId)}`, window.location.origin);
        if (opts?.refresh) url.searchParams.set('refresh', '1');
        const response = await fetch(url.toString());
        if (!response.ok) throw new Error('Failed to fetch secretary daily');
        return response.json();
    },

    generateScript: async (personId: string, intent?: string, context?: string) => {
        const response = await fetch(`${API_BASE_URL}/people/script`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ personId, intent, context })
        });
        if (!response.ok) throw new Error('Failed to generate script');
        return response.json();
    },

    consultPerson: async (personId: string, query: string) => {
        const response = await fetch(`${API_BASE_URL}/people/consult`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ personId, query })
        });
        if (!response.ok) throw new Error('Failed to consult person');
        return response.json();
    },

    getAdvisorThreads: async (personId: string, userId: string = CURRENT_USER_ID) => {
        const response = await fetch(`${API_BASE_URL}/people/${personId}/advisor/threads?userId=${encodeURIComponent(userId)}`);
        if (!response.ok) throw new Error('Failed to fetch advisor threads');
        return response.json();
    },

    createAdvisorThread: async (personId: string, title?: string, userId: string = CURRENT_USER_ID) => {
        const response = await fetch(`${API_BASE_URL}/people/${personId}/advisor/thread`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, title })
        });
        if (!response.ok) throw new Error('Failed to create advisor thread');
        return response.json();
    },

    getAdvisorThread: async (personId: string, threadId: string, userId: string = CURRENT_USER_ID) => {
        const response = await fetch(`${API_BASE_URL}/people/${personId}/advisor/thread/${threadId}?userId=${encodeURIComponent(userId)}`);
        if (!response.ok) throw new Error('Failed to fetch advisor thread');
        return response.json();
    },

    advisorChat: async (personId: string, payload: { threadId: string; content: string }, userId: string = CURRENT_USER_ID) => {
        const response = await fetch(`${API_BASE_URL}/people/${personId}/advisor/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, ...payload })
        });
        if (!response.ok) throw new Error('Failed to send advisor message');
        return response.json();
    },

    applyAdvisorInsight: async (personId: string, payload: { threadId: string; messageId: string }, userId: string = CURRENT_USER_ID) => {
        const response = await fetch(`${API_BASE_URL}/people/${personId}/advisor/apply`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, ...payload })
        });
        if (!response.ok) throw new Error('Failed to apply advisor insight');
        return response.json();
    },

    getPersonSummary: async (personId: string, forceRefresh: boolean = false, userId: string = CURRENT_USER_ID) => {
        const response = await fetch(`${API_BASE_URL}/people/summary`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ personId, forceRefresh, userId })
        });
        if (!response.ok) throw new Error('Failed to get summary');
        return response.json();
    },

    generatePracticalScenes: async (personId: string) => {
        const response = await fetch(`${API_BASE_URL}/people/practical-scenes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ personId })
        });
        if (!response.ok) throw new Error('Failed to generate practical scenes');
        return response.json();
    },

    getScenarioCards: async (personId: string, userId: string = CURRENT_USER_ID) => {
        const response = await fetch(`${API_BASE_URL}/people/${personId}/scenario-cards?userId=${encodeURIComponent(userId)}`);
        if (!response.ok) throw new Error('Failed to fetch scenario cards');
        return response.json();
    },

    generateScenarioSimulation: async (personId: string, payload: { query: string; category: string }, userId: string = CURRENT_USER_ID) => {
        const response = await fetch(`${API_BASE_URL}/people/${personId}/scenario-simulate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, ...payload })
        });
        if (!response.ok) throw new Error('Failed to generate scenario simulation');
        return response.json();
    },

    updateScenarioCard: async (personId: string, sopId: string, patch: any, userId: string = CURRENT_USER_ID) => {
        const response = await fetch(`${API_BASE_URL}/people/${personId}/scenario-cards/${sopId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, patch })
        });
        if (!response.ok) throw new Error('Failed to update scenario card');
        return response.json();
    },

    deleteScenarioCard: async (personId: string, sopId: string, userId: string = CURRENT_USER_ID) => {
        const response = await fetch(`${API_BASE_URL}/people/${personId}/scenario-cards/${sopId}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId })
        });
        if (!response.ok) throw new Error('Failed to delete scenario card');
        return response.json();
    },

    applyMapProposal: async (personId: string, proposal: any, userId: string = CURRENT_USER_ID) => {
        const response = await fetch(`${API_BASE_URL}/people/${personId}/map-proposal/apply`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, proposal })
        });
        if (!response.ok) throw new Error('Failed to apply map proposal');
        return response.json();
    },

    ensureVerificationChecklist: async (personId: string, layerKey: string, force: boolean = false) => {
        const response = await fetch(`${API_BASE_URL}/people/verification-checklist`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ personId, layerKey, force })
        });
        if (!response.ok) throw new Error('Failed to generate verification checklist');
        return response.json();
    },

    generateReview: async (logId: number, personId: string) => {
        const response = await fetch(`${API_BASE_URL}/interaction/${logId}/review`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ personId })
        });
        if (!response.ok) throw new Error('Failed to generate review');
        return response.json();
    },

    // Logs
    getInteractionLogs: async (personId: string) => {
        const response = await fetch(`${API_BASE_URL}/interaction/${personId}`);
        if (!response.ok) throw new Error('Failed to fetch logs');
        return response.json();
    },

    createInteractionLog: async (logData: any) => {
        const response = await fetch(`${API_BASE_URL}/interaction/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(logData)
        });
        if (!response.ok) throw new Error('Failed to create log');
        return response.json();
    },

    updateInteractionLog: async (logId: string | number, updates: any) => {
        const response = await fetch(`${API_BASE_URL}/interaction/${logId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates || {})
        });
        if (!response.ok) throw new Error('Failed to update log');
        return response.json();
    },

    deleteInteractionLog: async (logId: string | number) => {
        const response = await fetch(`${API_BASE_URL}/interaction/${logId}`, {
            method: 'DELETE'
        });
        if (!response.ok) throw new Error('Failed to delete log');
        return response.json();
    },

    createInteractionLogsFromText: async (payload: { person_id: string; text: string; default_date?: string; userId?: string }) => {
        let response: Response;
        try {
            response = await fetch(`${API_BASE_URL}/interaction/parse-create`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        } catch (err) {
            throw new Error('网络连接失败：云端后端可能不可达或尚未发布该接口');
        }
        if (!response.ok) {
            if (response.status === 404) {
                throw new Error('云端后端尚未发布 AI 提取接口（/api/interaction/parse-create），请先部署后端最新版');
            }
            const text = await response.text().catch(() => '');
            if (!text) throw new Error('AI提取互动记录失败');
            try {
                const json = JSON.parse(text);
                throw new Error(json?.detail || json?.error || 'AI提取互动记录失败');
            } catch {
                throw new Error(text.substring(0, 200));
            }
        }
        return response.json();
    },

    // Review Sessions
    getReviewSessions: async (userId: string = CURRENT_USER_ID) => {
        const response = await fetch(`${API_BASE_URL}/review/list/${userId}`);
        if (!response.ok) throw new Error('Failed to fetch review sessions');
        return response.json();
    },

    createReviewSession: async (sessionData: any) => {
        const dataToSend = { ...sessionData, user_id: sessionData.user_id || CURRENT_USER_ID };
        const response = await fetch(`${API_BASE_URL}/review/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(dataToSend)
        });
        if (!response.ok) throw new Error('Failed to create review session');
        return response.json();
    },

    chatReview: async (sessionId: string, userInput: string) => {
        const response = await fetch(`${API_BASE_URL}/review/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: CURRENT_USER_ID, sessionId, userInput })
        });
        if (!response.ok) throw new Error('Failed to chat review');
        return response.json();
    },

    linkReviewToPerson: async (reviewId: string, personId: string) => {
        const response = await fetch(`${API_BASE_URL}/review/link-person`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reviewId, personId })
        });
        if (!response.ok) throw new Error('Failed to link person');
        return response.json();
    },

    saveSOPDraft: async (reviewId: string, summaryData: any) => {
        const response = await fetch(`${API_BASE_URL}/review/save-sop-draft`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reviewId, summaryData })
        });
        if (!response.ok) throw new Error('Failed to save SOP draft');
        return response.json();
    },

    analyzeSOP: async (content: string) => {
        const response = await fetch(`${API_BASE_URL}/sop/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content })
        });
        return response.json();
    },

    getUserStats: async (userId: string = CURRENT_USER_ID) => {
        const response = await fetch(`${API_BASE_URL}/user/stats/${userId}`);
        if (!response.ok) throw new Error('Failed to fetch user stats');
        return response.json();
    },

    // NPC Relations
    createNPCRelation: async (relationData: any) => {
        const dataToSend = { ...relationData, user_id: relationData.user_id || CURRENT_USER_ID };
        const response = await fetch(`${API_BASE_URL}/npc/relation/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(dataToSend)
        });
        if (!response.ok) throw new Error('Failed to create NPC relation');
        return response.json();
    },

    getNPCRelations: async (userId: string = CURRENT_USER_ID) => {
        const response = await fetch(`${API_BASE_URL}/npc/relation/list/${userId}`);
        if (!response.ok) throw new Error('Failed to fetch NPC relations');
        return response.json();
    }
};
