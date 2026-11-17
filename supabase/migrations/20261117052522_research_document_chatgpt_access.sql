-- Opt-in per document; existing rows and future documents remain private.
ALTER TABLE public.sops
  ADD COLUMN IF NOT EXISTS chatgpt_access BOOLEAN NOT NULL DEFAULT FALSE;
-- This application uses website cookies + backend service_role, not direct
-- browser Supabase sessions. Prevent Data API clients from bypassing opt-in.
ALTER TABLE public.sops ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sop_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sops, public.sop_versions FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sops, public.sop_versions TO service_role;
COMMENT ON COLUMN public.sops.chatgpt_access IS
  'Website-controlled permission for ChatGPT to read and modify this research document. Never inherited.';
CREATE INDEX IF NOT EXISTS sops_chatgpt_research_owner_updated_idx
  ON public.sops (user_id, updated_at DESC, id)
  WHERE domain = 'research' AND chatgpt_access = TRUE;

-- An access-only toggle must work even while an editor has unsaved content.
-- Keep its content revision stable; all document edits still advance revisions.
CREATE OR REPLACE FUNCTION public.bump_sop_content_revision()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW.chatgpt_access IS DISTINCT FROM OLD.chatgpt_access
     AND (to_jsonb(NEW) - 'chatgpt_access' - 'content_revision')
         IS NOT DISTINCT FROM (to_jsonb(OLD) - 'chatgpt_access' - 'content_revision') THEN
    NEW.content_revision := OLD.content_revision;
  ELSE
    NEW.content_revision := COALESCE(OLD.content_revision, 0) + 1;
  END IF;
  RETURN NEW;
END;
$$;

-- Permission check, revision check, backup and replacement are one transaction.
-- The row lock serializes edits with website permission revocation.
CREATE OR REPLACE FUNCTION public.nmdd_research_document_update(
  p_owner TEXT, p_id UUID, p_expected_revision BIGINT, p_patch JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  current_doc public.sops%ROWTYPE;
  saved_doc public.sops%ROWTYPE;
BEGIN
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' OR p_patch = '{}'::jsonb
     OR (p_patch - ARRAY['title', 'content', 'content_json']) <> '{}'::jsonb
     OR p_expected_revision IS NULL OR p_expected_revision < 1 THEN
    RAISE EXCEPTION 'Invalid document patch' USING ERRCODE = '22023';
  END IF;
  IF p_patch ? 'title' AND (jsonb_typeof(p_patch->'title') <> 'string'
     OR length(btrim(p_patch->>'title')) = 0 OR length(p_patch->>'title') > 500) THEN
    RAISE EXCEPTION 'Invalid title' USING ERRCODE = '22023';
  END IF;
  IF p_patch ? 'content' OR p_patch ? 'content_json' THEN
    IF NOT (p_patch ? 'content' AND p_patch ? 'content_json')
       OR jsonb_typeof(p_patch->'content') IS DISTINCT FROM 'string'
       OR length(p_patch->>'content') > 1000000
       OR jsonb_typeof(p_patch->'content_json') IS DISTINCT FROM 'object'
       OR p_patch->'content_json'->>'type' IS DISTINCT FROM 'doc'
       OR jsonb_typeof(p_patch->'content_json'->'content') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Both Markdown and structured document content are required' USING ERRCODE = '22023';
    END IF;
  END IF;
  SELECT * INTO current_doc FROM public.sops
    WHERE id = p_id AND user_id = p_owner AND domain = 'research' AND chatgpt_access = TRUE
    FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF current_doc.content_revision <> p_expected_revision THEN
    RETURN jsonb_build_object('error', 'revision_conflict');
  END IF;

  INSERT INTO public.sop_versions
    (sop_id, version, content, content_json, content_schema_version, content_revision, version_note)
  VALUES (current_doc.id, 'chatgpt-backup-r' || current_doc.content_revision || '-' || gen_random_uuid(),
    current_doc.content, current_doc.content_json, current_doc.content_schema_version,
    current_doc.content_revision, 'ChatGPT 修改前自动备份');

  UPDATE public.sops SET
    title = CASE WHEN p_patch ? 'title' THEN p_patch->>'title' ELSE title END,
    content = CASE WHEN p_patch ? 'content' THEN p_patch->>'content' ELSE content END,
    content_json = CASE WHEN p_patch ? 'content_json' THEN p_patch->'content_json' ELSE content_json END,
    updated_at = now()
  WHERE id = current_doc.id RETURNING * INTO saved_doc;
  RETURN jsonb_build_object('id', saved_doc.id, 'title', saved_doc.title,
    'research_type', saved_doc.research_type, 'content_revision', saved_doc.content_revision,
    'content_schema_version', saved_doc.content_schema_version, 'updated_at', saved_doc.updated_at);
END;
$$;
REVOKE ALL ON FUNCTION public.nmdd_research_document_update(TEXT, UUID, BIGINT, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nmdd_research_document_update(TEXT, UUID, BIGINT, JSONB)
  TO service_role;
