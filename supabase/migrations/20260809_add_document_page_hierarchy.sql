-- Notion-style page hierarchy for life and research documents.
--
-- Page location is deliberately stored separately from the ProseMirror JSON:
-- every page keeps its own content, revision history and stable URL while the
-- parent/sibling fields only describe where it appears in the page tree.
BEGIN;

ALTER TABLE public.sops
  ADD COLUMN IF NOT EXISTS parent_id UUID,
  ADD COLUMN IF NOT EXISTS sort_order BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS structure_updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sops_parent_id_fkey'
      AND conrelid = 'public.sops'::regclass
  ) THEN
    ALTER TABLE public.sops
      ADD CONSTRAINT sops_parent_id_fkey
      FOREIGN KEY (parent_id)
      REFERENCES public.sops(id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sops_parent_not_self_check'
      AND conrelid = 'public.sops'::regclass
  ) THEN
    ALTER TABLE public.sops
      ADD CONSTRAINT sops_parent_not_self_check
      CHECK (parent_id IS NULL OR parent_id <> id);
  END IF;
END $$;

-- Existing pages receive a deterministic chronological order when first
-- rendered as roots. New pages use a millisecond sort key and can later be
-- reordered by the dedicated location endpoint without touching content.
UPDATE public.sops
SET sort_order = FLOOR(EXTRACT(EPOCH FROM COALESCE(created_at, NOW())) * 1000)::BIGINT
WHERE sort_order = 0;

CREATE INDEX IF NOT EXISTS idx_sops_page_tree
  ON public.sops(user_id, parent_id, sort_order);

-- A page move is structural metadata, not a content edit. Keep optimistic
-- content revisions stable when only parent_id/sort_order changes.
DO $$
DECLARE
  revision_columns TEXT;
BEGIN
  -- Some long-lived installations intentionally still use the legacy sops
  -- schema. Only replace the reliability trigger when that migration and its
  -- function already exist; hierarchy remains fully usable either way.
  IF to_regprocedure('public.bump_sop_content_revision()') IS NOT NULL THEN
    SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
    INTO revision_columns
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'sops'
      AND column_name = ANY (ARRAY[
        'title',
        'category',
        'tags',
        'version',
        'content',
        'content_json',
        'content_schema_version',
        'domain',
        'research_type',
        'research_status',
        'promoted_to_life',
        'promoted_at',
        'promoted_from_sop_id'
      ]);

    DROP TRIGGER IF EXISTS sops_bump_content_revision ON public.sops;
    IF revision_columns IS NOT NULL THEN
      EXECUTE format(
        'CREATE TRIGGER sops_bump_content_revision BEFORE UPDATE OF %s ON public.sops FOR EACH ROW EXECUTE FUNCTION public.bump_sop_content_revision()',
        revision_columns
      );
    END IF;
  END IF;
END $$;

COMMENT ON COLUMN public.sops.parent_id IS
  'Optional parent page. NULL means the page is at the root of its document library.';
COMMENT ON COLUMN public.sops.sort_order IS
  'Stable ordering key among sibling pages. Structural moves do not change content_revision.';
COMMENT ON COLUMN public.sops.structure_updated_at IS
  'Last time the page moved in the hierarchy; independent from document content updated_at.';

COMMIT;
