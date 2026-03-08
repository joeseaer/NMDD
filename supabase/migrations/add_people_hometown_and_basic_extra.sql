ALTER TABLE public.people_profiles
ADD COLUMN IF NOT EXISTS hometown TEXT,
ADD COLUMN IF NOT EXISTS basic_info_extra JSONB NOT NULL DEFAULT '[]'::jsonb;
