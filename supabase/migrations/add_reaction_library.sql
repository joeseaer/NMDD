ALTER TABLE public.people_profiles
ADD COLUMN IF NOT EXISTS reaction_library JSONB NOT NULL DEFAULT '[]'::jsonb;
