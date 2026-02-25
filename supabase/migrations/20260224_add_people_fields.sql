
ALTER TABLE people_profiles 
ADD COLUMN IF NOT EXISTS contact_info TEXT,
ADD COLUMN IF NOT EXISTS first_met_date DATE,
ADD COLUMN IF NOT EXISTS first_met_scene TEXT;
