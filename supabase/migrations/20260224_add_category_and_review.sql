
ALTER TABLE people_profiles 
ADD COLUMN IF NOT EXISTS category TEXT;

ALTER TABLE interaction_logs 
ADD COLUMN IF NOT EXISTS ai_review TEXT;
