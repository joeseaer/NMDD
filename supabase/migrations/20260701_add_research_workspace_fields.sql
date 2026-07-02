ALTER TABLE public.sops
ADD COLUMN IF NOT EXISTS domain TEXT NOT NULL DEFAULT 'life',
ADD COLUMN IF NOT EXISTS research_type TEXT,
ADD COLUMN IF NOT EXISTS research_status TEXT,
ADD COLUMN IF NOT EXISTS promoted_to_life BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS promoted_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS promoted_from_sop_id UUID REFERENCES public.sops(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sops_domain_check'
      AND conrelid = 'public.sops'::regclass
  ) THEN
    ALTER TABLE public.sops
    ADD CONSTRAINT sops_domain_check
    CHECK (domain IN ('life', 'research'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sops_research_type_check'
      AND conrelid = 'public.sops'::regclass
  ) THEN
    ALTER TABLE public.sops
    ADD CONSTRAINT sops_research_type_check
    CHECK (research_type IS NULL OR research_type IN ('document', 'idea', 'meeting'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sops_research_status_check'
      AND conrelid = 'public.sops'::regclass
  ) THEN
    ALTER TABLE public.sops
    ADD CONSTRAINT sops_research_status_check
    CHECK (research_status IS NULL OR research_status IN ('seed', 'to_verify', 'absorbed', 'paused'));
  END IF;
END $$;

UPDATE public.sops
SET domain = 'research'
WHERE tags @> ARRAY['domain:research']::TEXT[];

UPDATE public.sops
SET research_type = 'document'
WHERE tags @> ARRAY['research_type:document']::TEXT[];

UPDATE public.sops
SET research_type = 'idea'
WHERE tags @> ARRAY['research_type:idea']::TEXT[];

UPDATE public.sops
SET research_type = 'meeting'
WHERE tags @> ARRAY['research_type:meeting']::TEXT[];

UPDATE public.sops
SET research_status = 'seed'
WHERE tags @> ARRAY['research_status:seed']::TEXT[];

UPDATE public.sops
SET research_status = 'to_verify'
WHERE tags @> ARRAY['research_status:to_verify']::TEXT[];

UPDATE public.sops
SET research_status = 'absorbed'
WHERE tags @> ARRAY['research_status:absorbed']::TEXT[];

UPDATE public.sops
SET research_status = 'paused'
WHERE tags @> ARRAY['research_status:paused']::TEXT[];

UPDATE public.sops
SET promoted_to_life = TRUE
WHERE tags @> ARRAY['promoted_to_life:true']::TEXT[];

CREATE INDEX IF NOT EXISTS idx_sops_user_domain ON public.sops(user_id, domain);
CREATE INDEX IF NOT EXISTS idx_sops_user_research_type ON public.sops(user_id, research_type);
CREATE INDEX IF NOT EXISTS idx_sops_promoted_from ON public.sops(promoted_from_sop_id);
