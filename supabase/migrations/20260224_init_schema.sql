-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Scenes Table
CREATE TABLE IF NOT EXISTS scenes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,
  scene_type TEXT,
  npc_profile JSONB,
  initial_context TEXT,
  conversation_log JSONB,
  key_decisions JSONB,
  final_result JSONB,
  ai_feedback JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. SOPs Table
CREATE TABLE IF NOT EXISTS sops (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  category TEXT,
  tags TEXT[],
  version TEXT DEFAULT 'V1.0',
  content TEXT,
  related_scenes TEXT[], -- Legacy field, kept for compatibility
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. People Profiles Table
CREATE TABLE IF NOT EXISTS people_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  identity TEXT,
  field TEXT,
  tags TEXT[],
  relationship_strength INT DEFAULT 0,
  disc_type TEXT,
  mbti_type TEXT,
  ai_analysis TEXT,
  interaction_tips TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Interaction Logs Table
CREATE TABLE IF NOT EXISTS interaction_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  person_id UUID REFERENCES people_profiles(id) ON DELETE CASCADE,
  event_date DATE DEFAULT CURRENT_DATE,
  event_context TEXT,
  my_behavior TEXT,
  their_reaction TEXT,
  relationship_change INT DEFAULT 0,
  ai_analysis TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. SOP Versions (New)
CREATE TABLE IF NOT EXISTS sop_versions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sop_id UUID REFERENCES sops(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  content TEXT,
  version_note TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 6. SOP Usage Logs (New)
CREATE TABLE IF NOT EXISTS sop_usage_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sop_id UUID REFERENCES sops(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  scene_id UUID, -- Can be null if manual log
  scene_type TEXT, -- 'training' or 'real'
  score INT,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 7. Scene-SOP Relation (New)
CREATE TABLE IF NOT EXISTS scene_sop_rel (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  scene_id UUID REFERENCES scenes(id) ON DELETE CASCADE,
  sop_id UUID REFERENCES sops(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(scene_id, sop_id)
);

-- 8. People-SOP Relation (New)
CREATE TABLE IF NOT EXISTS people_sop_rel (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  people_id UUID REFERENCES people_profiles(id) ON DELETE CASCADE,
  sop_id UUID REFERENCES sops(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(people_id, sop_id)
);
