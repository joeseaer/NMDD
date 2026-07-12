-- Document editor persistence metadata.
--
-- Existing documents are schema version 1 and revision 1.  The columns are
-- deliberately additive so older clients and older rows keep working.
ALTER TABLE sops
  ADD COLUMN IF NOT EXISTS content_schema_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS content_revision BIGINT NOT NULL DEFAULT 1;

ALTER TABLE sop_versions
  ADD COLUMN IF NOT EXISTS content_schema_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS content_revision BIGINT NOT NULL DEFAULT 1;

-- Keep the revision server-owned.  saveSOP performs a compare-and-set against
-- content_revision; this trigger advances the value in the same atomic UPDATE.
CREATE OR REPLACE FUNCTION bump_sop_content_revision()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.content_revision := COALESCE(OLD.content_revision, 0) + 1;
  RETURN NEW;
END;
$$;

-- Also finish a partially applied/manual deployment where the columns existed
-- but were nullable or lacked defaults.
UPDATE sops SET content_schema_version = 1 WHERE content_schema_version IS NULL;
UPDATE sops SET content_revision = 1 WHERE content_revision IS NULL;
UPDATE sop_versions SET content_schema_version = 1 WHERE content_schema_version IS NULL;
UPDATE sop_versions SET content_revision = 1 WHERE content_revision IS NULL;

ALTER TABLE sops
  ALTER COLUMN content_schema_version SET DEFAULT 1,
  ALTER COLUMN content_schema_version SET NOT NULL,
  ALTER COLUMN content_revision SET DEFAULT 1,
  ALTER COLUMN content_revision SET NOT NULL;

ALTER TABLE sop_versions
  ALTER COLUMN content_schema_version SET DEFAULT 1,
  ALTER COLUMN content_schema_version SET NOT NULL,
  ALTER COLUMN content_revision SET DEFAULT 1,
  ALTER COLUMN content_revision SET NOT NULL;

DROP TRIGGER IF EXISTS sops_bump_content_revision ON sops;
CREATE TRIGGER sops_bump_content_revision
BEFORE UPDATE ON sops
FOR EACH ROW
EXECUTE FUNCTION bump_sop_content_revision();

COMMENT ON COLUMN sops.content_schema_version IS
  'Version of the ProseMirror/Tiptap JSON document schema. Legacy documents are version 1.';
COMMENT ON COLUMN sops.content_revision IS
  'Server-owned optimistic concurrency revision incremented on every SOP update.';
COMMENT ON COLUMN sop_versions.content_schema_version IS
  'Document schema version captured by this history snapshot.';
COMMENT ON COLUMN sop_versions.content_revision IS
  'SOP content revision captured by this history snapshot.';
