
ALTER TABLE people_profiles 
ADD COLUMN IF NOT EXISTS avatar_real TEXT,
ADD COLUMN IF NOT EXISTS avatar_ai TEXT,
ADD COLUMN IF NOT EXISTS avatar_type TEXT DEFAULT 'initial', -- 'initial', 'real', 'ai'
ADD COLUMN IF NOT EXISTS related_people JSONB DEFAULT '[]';
