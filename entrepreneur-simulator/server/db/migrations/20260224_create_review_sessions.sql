CREATE TABLE IF NOT EXISTS review_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,
  title TEXT,
  review_type TEXT, -- negotiation, social, conflict, other
  status TEXT, -- pending, completed
  result TEXT, -- success, fail, pending
  messages JSONB, -- 存储完整对话记录
  summary_data JSONB, -- 存储结构化卡片数据
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);