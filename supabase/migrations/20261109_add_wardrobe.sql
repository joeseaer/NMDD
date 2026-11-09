-- Wardrobe V1: additive, repeatable; only the authenticated Fastify service uses these tables.
BEGIN;
CREATE TABLE IF NOT EXISTS public.wardrobe_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL, external_id text NOT NULL CHECK (length(btrim(external_id)) BETWEEN 1 AND 500),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 500),
  category text NOT NULL CHECK (category IN ('tops','bottoms','outerwear','shoes','accessories','other')),
  subcategory text, color_family text CHECK (color_family IN ('black','white','gray','blue','brown','beige','green','red','yellow','purple','orange','pink','multicolor','other')),
  primary_color text NOT NULL CHECK (length(btrim(primary_color)) BETWEEN 1 AND 500),
  fit text CHECK (fit IN ('slim','regular','straight','relaxed','oversized','unknown')),
  pattern text CHECK (pattern IN ('solid','striped','checked','printed','other','unknown')),
  seasons text[] NOT NULL DEFAULT '{}' CHECK (seasons <@ ARRAY['spring','summer','autumn','winter']::text[]),
  style_tags text[] NOT NULL DEFAULT '{}',
  occasions text[] NOT NULL DEFAULT '{}' CHECK (occasions <@ ARRAY['academic_conference','business_social','daily','other']::text[]),
  formality smallint CHECK (formality BETWEEN 1 AND 5), brand text, size text, material text, notes text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  needs_review boolean NOT NULL DEFAULT false,
  image_object_key text NOT NULL, image_sha256 text NOT NULL CHECK (image_sha256 ~ '^[a-f0-9]{64}$'),
  manual_fields text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
  UNIQUE (user_id, external_id)
);
CREATE INDEX IF NOT EXISTS wardrobe_items_user_status_category ON public.wardrobe_items(user_id,status,category) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS wardrobe_items_user_digest ON public.wardrobe_items(user_id,image_sha256);
CREATE TABLE IF NOT EXISTS public.wardrobe_outfits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id text NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 500),
  occasion text NOT NULL DEFAULT 'daily' CHECK (occasion IN ('academic_conference','business_social','daily','other')),
  notes text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wardrobe_outfits_owner ON public.wardrobe_outfits(user_id);
CREATE TABLE IF NOT EXISTS public.wardrobe_outfit_items (
  outfit_id uuid NOT NULL REFERENCES public.wardrobe_outfits(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.wardrobe_items(id),
  position integer NOT NULL CHECK (position >= 0),
  PRIMARY KEY (outfit_id,item_id), UNIQUE(outfit_id,position)
);
ALTER TABLE public.wardrobe_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wardrobe_outfits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wardrobe_outfit_items ENABLE ROW LEVEL SECURITY;
-- No anon/authenticated policies: the existing app uses a server-side session + service role.
REVOKE ALL ON public.wardrobe_items, public.wardrobe_outfits, public.wardrobe_outfit_items FROM anon, authenticated;
GRANT ALL ON public.wardrobe_items, public.wardrobe_outfits, public.wardrobe_outfit_items TO service_role;

CREATE OR REPLACE FUNCTION public.wardrobe_import(p_owner text, p_items jsonb, p_mode text DEFAULT 'skip_existing')
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE entry jsonb; previous wardrobe_items; next_row wardrobe_items; payload jsonb; field text;
  created_count int := 0; skipped_count int := 0; updated_count int := 0;
BEGIN
  IF p_owner IS NULL OR length(btrim(p_owner)) = 0 OR jsonb_typeof(p_items) <> 'array'
    OR jsonb_array_length(p_items) > 100 OR p_mode NOT IN ('skip_existing','update_imported') THEN
    RAISE EXCEPTION 'invalid wardrobe import';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('wardrobe:' || p_owner, 0));
  FOR entry IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO previous FROM wardrobe_items WHERE user_id=p_owner AND external_id=entry->>'external_id' FOR UPDATE;
    IF FOUND THEN
      IF p_mode='skip_existing' OR previous.deleted_at IS NOT NULL THEN
        skipped_count := skipped_count+1; CONTINUE;
      END IF;
      payload := to_jsonb(previous) || (entry - ARRAY['id','user_id','created_at','deleted_at','manual_fields']);
      FOREACH field IN ARRAY previous.manual_fields LOOP
        payload := jsonb_set(payload, ARRAY[field], to_jsonb(previous)->field);
      END LOOP;
      payload := payload || jsonb_build_object('updated_at', now());
      next_row := jsonb_populate_record(NULL::wardrobe_items, payload);
      UPDATE wardrobe_items SET
        name=next_row.name,category=next_row.category,subcategory=next_row.subcategory,color_family=next_row.color_family,
        primary_color=next_row.primary_color,fit=next_row.fit,pattern=next_row.pattern,seasons=next_row.seasons,
        style_tags=next_row.style_tags,occasions=next_row.occasions,formality=next_row.formality,brand=next_row.brand,
        size=next_row.size,material=next_row.material,notes=next_row.notes,status=next_row.status,
        needs_review=next_row.needs_review,image_object_key=next_row.image_object_key,image_sha256=next_row.image_sha256,
        updated_at=now() WHERE id=previous.id AND user_id=p_owner;
      updated_count := updated_count+1;
    ELSE
      payload := entry || jsonb_build_object('id',gen_random_uuid(),'user_id',p_owner,'manual_fields','[]'::jsonb,'created_at',now(),'updated_at',now(),'deleted_at',null);
      INSERT INTO wardrobe_items SELECT (jsonb_populate_record(NULL::wardrobe_items,payload)).*;
      created_count := created_count+1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('created',created_count,'skipped',skipped_count,'updated',updated_count,'failed',0,'errors','[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.wardrobe_patch_item(p_owner text, p_id uuid, p_patch jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE previous wardrobe_items; next_row wardrobe_items; field text; allowed text[] := ARRAY[
 'name','category','subcategory','color_family','primary_color','fit','pattern','seasons','style_tags','occasions',
 'formality','brand','size','material','notes','status','needs_review','image_object_key','image_sha256','deleted_at'];
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('wardrobe:' || p_owner,0));
  SELECT * INTO previous FROM wardrobe_items WHERE id=p_id AND user_id=p_owner AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'wardrobe item not found' USING ERRCODE='P0002'; END IF;
  FOR field IN SELECT jsonb_object_keys(p_patch) LOOP
    IF NOT field=ANY(allowed) THEN RAISE EXCEPTION 'invalid patch field'; END IF;
  END LOOP;
  next_row := jsonb_populate_record(previous, p_patch);
  UPDATE wardrobe_items SET name=next_row.name,category=next_row.category,subcategory=next_row.subcategory,
   color_family=next_row.color_family,primary_color=next_row.primary_color,fit=next_row.fit,pattern=next_row.pattern,
   seasons=next_row.seasons,style_tags=next_row.style_tags,occasions=next_row.occasions,formality=next_row.formality,
   brand=next_row.brand,size=next_row.size,material=next_row.material,notes=next_row.notes,status=next_row.status,
   needs_review=next_row.needs_review,image_object_key=next_row.image_object_key,image_sha256=next_row.image_sha256,
   deleted_at=next_row.deleted_at,updated_at=now(),
   manual_fields=ARRAY(SELECT DISTINCT unnest(previous.manual_fields || ARRAY(SELECT jsonb_object_keys(p_patch))))
   WHERE id=p_id AND user_id=p_owner RETURNING * INTO next_row;
  RETURN to_jsonb(next_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.wardrobe_save_outfit(p_owner text,p_id uuid,p_name text,p_occasion text,p_notes text,p_item_ids uuid[])
RETURNS uuid LANGUAGE plpgsql SET search_path = public AS $$
DECLARE result uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('wardrobe:' || p_owner,0));
  IF cardinality(p_item_ids) NOT BETWEEN 1 AND 100 OR cardinality(p_item_ids) <> (SELECT count(DISTINCT value) FROM unnest(p_item_ids) value)
    OR EXISTS (SELECT 1 FROM unnest(p_item_ids) wanted WHERE NOT EXISTS (SELECT 1 FROM wardrobe_items WHERE id=wanted AND user_id=p_owner AND deleted_at IS NULL)) THEN
    RAISE EXCEPTION 'invalid outfit items' USING ERRCODE='22023';
  END IF;
  IF p_id IS NULL THEN
    INSERT INTO wardrobe_outfits(user_id,name,occasion,notes) VALUES(p_owner,p_name,p_occasion,p_notes) RETURNING id INTO result;
  ELSE
    UPDATE wardrobe_outfits SET name=p_name,occasion=p_occasion,notes=p_notes,updated_at=now() WHERE id=p_id AND user_id=p_owner RETURNING id INTO result;
    IF result IS NULL THEN RAISE EXCEPTION 'outfit not found' USING ERRCODE='P0002'; END IF;
    DELETE FROM wardrobe_outfit_items WHERE outfit_id=result;
  END IF;
  INSERT INTO wardrobe_outfit_items(outfit_id,item_id,position) SELECT result,value,ordinality-1 FROM unnest(p_item_ids) WITH ORDINALITY AS list(value,ordinality);
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.wardrobe_import(text,jsonb,text), public.wardrobe_patch_item(text,uuid,jsonb), public.wardrobe_save_outfit(text,uuid,text,text,text,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.wardrobe_import(text,jsonb,text), public.wardrobe_patch_item(text,uuid,jsonb), public.wardrobe_save_outfit(text,uuid,text,text,text,uuid[]) TO service_role;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 VALUES('wardrobe-images','wardrobe-images',false,8388608,ARRAY['image/jpeg','image/png','image/webp'])
 ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=8388608,allowed_mime_types=EXCLUDED.allowed_mime_types;
NOTIFY pgrst, 'reload schema';
COMMIT;
