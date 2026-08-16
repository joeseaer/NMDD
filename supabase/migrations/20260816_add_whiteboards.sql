-- Standalone Excalidraw whiteboards, binary asset metadata, and Tiptap references.
-- Scene JSON deliberately excludes image data URLs; immutable binaries live in
-- the private `whiteboard-assets` Storage bucket managed by the API service.
BEGIN;

CREATE TABLE IF NOT EXISTS public.whiteboards (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '未命名白板',
  scene_json JSONB NOT NULL DEFAULT '{"type":"excalidraw","version":2,"source":"nmdd","elements":[],"appState":{}}'::JSONB,
  scene_schema_version INTEGER NOT NULL DEFAULT 1,
  content_revision BIGINT NOT NULL DEFAULT 1,
  preview_object_key TEXT,
  preview_revision BIGINT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE,
  CONSTRAINT whiteboards_title_not_blank CHECK (length(btrim(title)) > 0),
  CONSTRAINT whiteboards_schema_version_positive CHECK (scene_schema_version > 0),
  CONSTRAINT whiteboards_revision_positive CHECK (content_revision > 0),
  CONSTRAINT whiteboards_scene_shape CHECK (
    jsonb_typeof(scene_json) = 'object'
    AND jsonb_typeof(scene_json->'elements') = 'array'
    AND jsonb_typeof(scene_json->'appState') = 'object'
  ),
  CONSTRAINT whiteboards_preview_revision_valid CHECK (
    preview_revision IS NULL OR preview_revision > 0
  )
);

CREATE INDEX IF NOT EXISTS idx_whiteboards_user_updated
  ON public.whiteboards(user_id, updated_at DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.whiteboard_assets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  whiteboard_id UUID NOT NULL REFERENCES public.whiteboards(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL,
  object_key TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size BIGINT NOT NULL,
  file_metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  last_referenced_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT whiteboard_assets_file_id_not_blank CHECK (length(btrim(file_id)) > 0),
  CONSTRAINT whiteboard_assets_sha256_format CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT whiteboard_assets_byte_size_positive CHECK (byte_size > 0),
  CONSTRAINT whiteboard_assets_board_file_unique UNIQUE (whiteboard_id, file_id)
);

CREATE INDEX IF NOT EXISTS idx_whiteboard_assets_board
  ON public.whiteboard_assets(whiteboard_id);
CREATE INDEX IF NOT EXISTS idx_whiteboard_assets_sha256
  ON public.whiteboard_assets(sha256);

CREATE TABLE IF NOT EXISTS public.whiteboard_document_refs (
  whiteboard_id UUID NOT NULL REFERENCES public.whiteboards(id) ON DELETE CASCADE,
  sop_id UUID NOT NULL REFERENCES public.sops(id) ON DELETE CASCADE,
  block_id TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  PRIMARY KEY (whiteboard_id, sop_id, block_id),
  CONSTRAINT whiteboard_document_refs_block_not_blank CHECK (length(btrim(block_id)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_whiteboard_document_refs_sop
  ON public.whiteboard_document_refs(sop_id);

ALTER TABLE public.whiteboards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whiteboard_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whiteboard_document_refs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whiteboards_owner_all ON public.whiteboards;
CREATE POLICY whiteboards_owner_all ON public.whiteboards
  FOR ALL
  USING (auth.uid()::TEXT = user_id)
  WITH CHECK (auth.uid()::TEXT = user_id);

DROP POLICY IF EXISTS whiteboard_assets_owner_all ON public.whiteboard_assets;
CREATE POLICY whiteboard_assets_owner_all ON public.whiteboard_assets
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.whiteboards
      WHERE whiteboards.id = whiteboard_assets.whiteboard_id
        AND whiteboards.user_id = auth.uid()::TEXT
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.whiteboards
      WHERE whiteboards.id = whiteboard_assets.whiteboard_id
        AND whiteboards.user_id = auth.uid()::TEXT
    )
  );

DROP POLICY IF EXISTS whiteboard_document_refs_owner_all ON public.whiteboard_document_refs;
CREATE POLICY whiteboard_document_refs_owner_all ON public.whiteboard_document_refs
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.whiteboards
      WHERE whiteboards.id = whiteboard_document_refs.whiteboard_id
        AND whiteboards.user_id = auth.uid()::TEXT
    )
    AND EXISTS (
      SELECT 1 FROM public.sops
      WHERE sops.id = whiteboard_document_refs.sop_id
        AND sops.user_id = auth.uid()::TEXT
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.whiteboards
      WHERE whiteboards.id = whiteboard_document_refs.whiteboard_id
        AND whiteboards.user_id = auth.uid()::TEXT
    )
    AND EXISTS (
      SELECT 1 FROM public.sops
      WHERE sops.id = whiteboard_document_refs.sop_id
        AND sops.user_id = auth.uid()::TEXT
    )
  );

CREATE OR REPLACE FUNCTION public.bump_whiteboard_content_revision()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.content_revision := COALESCE(OLD.content_revision, 0) + 1;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS whiteboards_bump_content_revision ON public.whiteboards;
CREATE TRIGGER whiteboards_bump_content_revision
BEFORE UPDATE OF title, scene_json, scene_schema_version ON public.whiteboards
FOR EACH ROW
EXECUTE FUNCTION public.bump_whiteboard_content_revision();

COMMENT ON TABLE public.whiteboards IS
  'Standalone Excalidraw scenes. Binary files are stored separately in private Storage.';
COMMENT ON COLUMN public.whiteboards.content_revision IS
  'Server-owned optimistic concurrency revision incremented for title or scene changes.';
COMMENT ON TABLE public.whiteboard_document_refs IS
  'Derived index of Tiptap whiteboardEmbed nodes used for safe deletion and backlinks.';

COMMIT;
