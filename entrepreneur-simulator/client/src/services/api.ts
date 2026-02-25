
const API_BASE_URL = 'http://localhost:3000/api';
export const CURRENT_USER_ID = 'user-1';

export const api = {
    // SOPs
    getSOPs: async (userId: string = CURRENT_USER_ID) => {
        const response = await fetch(`${API_BASE_URL}/sop/${userId}`);
        if (!response.ok) throw new Error('Failed to fetch SOPs');
        return response.json();
    },

    createSOP: async (sopData: any) => {
        // Ensure user_id is present
        const dataToSend = { ...sopData, user_id: sopData.user_id || CURRENT_USER_ID };
        
        const response = await fetch(`${API_BASE_URL}/sop/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(dataToSend)
        });
        if (!response.ok) throw new Error('Failed to create SOP');
        return response.json();
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
        if (!response.ok) throw new Error('Failed to update person');
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

    getPersonSummary: async (personId: string) => {
        const response = await fetch(`${API_BASE_URL}/people/summary`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ personId })
        });
        if (!response.ok) throw new Error('Failed to get summary');
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
