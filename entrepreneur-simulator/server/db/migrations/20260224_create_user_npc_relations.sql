-- NPC 关系进展表
CREATE TABLE IF NOT EXISTS user_npc_relations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id TEXT NOT NULL,
    npc_id UUID NOT NULL,          -- NPC 的唯一 ID
    npc_name VARCHAR(100),         -- NPC 名字
    npc_profile_snapshot JSONB,    -- NPC 性格快照
    
    -- 核心状态
    relationship_stage VARCHAR(20) DEFAULT 'L1_BREAKING', -- L1:破冰, L2:探索, L3:稳固, L4:修复
    favorability_score INT DEFAULT 0, -- 好感度 -100 到 100
    
    -- 记忆上下文
    last_interaction_summary TEXT, -- 上次互动的总结
    unresolved_issues TEXT[],      -- 未解决的问题
    
    last_met_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);