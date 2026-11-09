-- Additive schema for personal MCP authorization and reviewed outfit inspirations.
BEGIN;
CREATE TABLE IF NOT EXISTS public.nmdd_oauth_clients (
  client_id text PRIMARY KEY,
  client_name text NOT NULL CHECK (length(client_name) BETWEEN 1 AND 200),
  token_endpoint_auth_method text NOT NULL DEFAULT 'none' CHECK (token_endpoint_auth_method IN ('none','client_secret_post')),
  client_secret_ciphertext text,
  redirect_uris text[] NOT NULL CHECK (cardinality(redirect_uris) BETWEEN 1 AND 5),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.nmdd_oauth_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id text NOT NULL,
  client_id text NOT NULL REFERENCES public.nmdd_oauth_clients(client_id),
  scopes text[] NOT NULL,
  issuer text NOT NULL,
  resource text NOT NULL,
  redirect_uri text NOT NULL,
  code_hash text NOT NULL UNIQUE CHECK (code_hash ~ '^[a-f0-9]{64}$'),
  consent_hash text UNIQUE CHECK (consent_hash ~ '^[a-f0-9]{64}$'),
  code_challenge text NOT NULL,
  code_expires_at timestamptz NOT NULL,
  code_consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS nmdd_oauth_grants_owner ON public.nmdd_oauth_grants(owner_id,created_at DESC);
CREATE INDEX IF NOT EXISTS nmdd_oauth_grants_client ON public.nmdd_oauth_grants(client_id);
CREATE TABLE IF NOT EXISTS public.nmdd_oauth_tokens (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  grant_id uuid NOT NULL REFERENCES public.nmdd_oauth_grants(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('access','refresh')),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS nmdd_oauth_tokens_grant ON public.nmdd_oauth_tokens(grant_id);
CREATE TABLE IF NOT EXISTS public.nmdd_write_requests (
  owner_id text NOT NULL, operation text NOT NULL,
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 200),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  response_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_id,operation,idempotency_key)
);
CREATE TABLE IF NOT EXISTS public.nmdd_tool_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id text,
  actor text NOT NULL, action text NOT NULL, outcome text NOT NULL,
  record_id uuid, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS nmdd_tool_audit_owner ON public.nmdd_tool_audit(owner_id,created_at DESC);
CREATE TABLE IF NOT EXISTS public.wardrobe_inspiration_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id text NOT NULL,
  object_key text NOT NULL, sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','image/webp')),
  byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 8388608),
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(owner_id,sha256)
);
CREATE TABLE IF NOT EXISTS public.wardrobe_inspirations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id text NOT NULL,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  source_image_id uuid REFERENCES public.wardrobe_inspiration_images(id), source_image_key text,
  source_url text, overall_style text,
  color_palette text[] NOT NULL DEFAULT '{}',
  occasions text[] NOT NULL DEFAULT '{}' CHECK (occasions <@ ARRAY['academic_conference','business_social','daily','other']::text[]),
  styling_notes text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  analysis_status text NOT NULL DEFAULT 'ready' CHECK (analysis_status IN ('pending','analyzing','ready','failed')),
  analysis_error text,
  source text NOT NULL CHECK (source IN ('website','chatgpt','json-import')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS wardrobe_inspirations_owner ON public.wardrobe_inspirations(owner_id,updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS wardrobe_inspirations_image ON public.wardrobe_inspirations(source_image_id);
CREATE TABLE IF NOT EXISTS public.wardrobe_inspiration_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inspiration_id uuid NOT NULL REFERENCES public.wardrobe_inspirations(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position >= 0),
  category text NOT NULL CHECK (category IN ('tops','bottoms','outerwear','shoes','accessories','other')),
  subcategory text, primary_color text,
  color_family text CHECK (color_family IN ('black','white','gray','blue','brown','beige','green','red','yellow','purple','orange','pink','multicolor','other')),
  pattern text CHECK (pattern IN ('solid','striped','checked','printed','other','unknown')),
  design_features text[] NOT NULL DEFAULT '{}', style_tags text[] NOT NULL DEFAULT '{}',
  bounding_box jsonb,
  visibility text NOT NULL DEFAULT 'unclear' CHECK (visibility IN ('visible','partial','unclear')),
  matched_wardrobe_item_id uuid REFERENCES public.wardrobe_items(id),
  match_reason text, match_score numeric CHECK (match_score BETWEEN 0 AND 1), needs_review boolean NOT NULL DEFAULT true,
  UNIQUE(inspiration_id,position)
);
CREATE INDEX IF NOT EXISTS wardrobe_inspiration_items_match ON public.wardrobe_inspiration_items(matched_wardrobe_item_id);

DO $$ DECLARE name text; BEGIN
  FOREACH name IN ARRAY ARRAY['nmdd_oauth_clients','nmdd_oauth_grants','nmdd_oauth_tokens','nmdd_write_requests','nmdd_tool_audit','wardrobe_inspiration_images','wardrobe_inspirations','wardrobe_inspiration_items'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',name);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon,authenticated',name);
    EXECUTE format('GRANT ALL ON public.%I TO service_role',name);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.nmdd_oauth_exchange(
  p_kind text,p_secret_hash text,p_client_id text,p_redirect_uri text,p_resource text,p_challenge text,p_access_hash text,p_refresh_hash text
) RETURNS jsonb LANGUAGE plpgsql SET search_path=public AS $$
DECLARE grant_row nmdd_oauth_grants; refresh_row nmdd_oauth_tokens;
BEGIN
  IF p_kind='authorization_code' THEN
    SELECT * INTO grant_row FROM nmdd_oauth_grants WHERE code_hash=p_secret_hash FOR UPDATE;
    IF NOT FOUND OR grant_row.client_id<>p_client_id OR grant_row.redirect_uri<>p_redirect_uri
      OR grant_row.resource<>p_resource OR grant_row.code_challenge<>p_challenge OR grant_row.code_expires_at<=now() OR grant_row.revoked_at IS NOT NULL THEN
      RETURN jsonb_build_object('error','invalid_grant');
    END IF;
    IF grant_row.code_consumed_at IS NOT NULL THEN
      UPDATE nmdd_oauth_grants SET revoked_at=now() WHERE id=grant_row.id;
      RETURN jsonb_build_object('error','invalid_grant');
    END IF;
    UPDATE nmdd_oauth_grants SET code_consumed_at=now() WHERE id=grant_row.id;
  ELSIF p_kind='refresh_token' THEN
    SELECT * INTO refresh_row FROM nmdd_oauth_tokens WHERE token_hash=p_secret_hash AND kind='refresh' FOR UPDATE;
    IF NOT FOUND OR refresh_row.expires_at<=now() THEN RETURN jsonb_build_object('error','invalid_grant'); END IF;
    SELECT * INTO grant_row FROM nmdd_oauth_grants WHERE id=refresh_row.grant_id FOR UPDATE;
    IF grant_row.client_id<>p_client_id OR grant_row.resource<>p_resource OR grant_row.revoked_at IS NOT NULL THEN RETURN jsonb_build_object('error','invalid_grant'); END IF;
    IF refresh_row.used_at IS NOT NULL THEN
      UPDATE nmdd_oauth_grants SET revoked_at=now() WHERE id=grant_row.id;
      RETURN jsonb_build_object('error','invalid_grant');
    END IF;
    UPDATE nmdd_oauth_tokens SET used_at=now() WHERE token_hash=p_secret_hash;
  ELSE RETURN jsonb_build_object('error','unsupported_grant_type');
  END IF;
  INSERT INTO nmdd_oauth_tokens(token_hash,grant_id,kind,expires_at) VALUES
    (p_access_hash,grant_row.id,'access',now()+interval '10 minutes'),
    (p_refresh_hash,grant_row.id,'refresh',now()+interval '30 days');
  INSERT INTO nmdd_tool_audit(owner_id,actor,action,outcome) VALUES(grant_row.owner_id,p_client_id,'oauth_token','issued');
  RETURN jsonb_build_object('grant_id',grant_row.id,'owner_id',grant_row.owner_id,'scopes',grant_row.scopes,'issuer',grant_row.issuer,'resource',grant_row.resource);
END $$;

CREATE OR REPLACE FUNCTION public.nmdd_inspiration_mutate(
  p_owner text,p_operation text,p_id uuid,p_expected_revision integer,p_payload jsonb,p_key text,p_hash text,p_actor text
) RETURNS jsonb LANGUAGE plpgsql SET search_path=public AS $$
DECLARE prior nmdd_write_requests; row_value wardrobe_inspirations; picture wardrobe_inspiration_images;
  reference jsonb; reference_id uuid; reference_ids uuid[] := '{}'; ordinal integer := 0; response jsonb;
BEGIN
  IF p_owner IS NULL OR length(btrim(p_owner))=0 OR length(p_key) NOT BETWEEN 8 AND 200 THEN RAISE EXCEPTION 'INVALID_REQUEST' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('nmdd:idem:'||p_owner||':'||p_operation||':'||p_key,0));
  SELECT * INTO prior FROM nmdd_write_requests WHERE owner_id=p_owner AND operation=p_operation AND idempotency_key=p_key;
  IF FOUND THEN
    IF prior.request_hash<>p_hash THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE='22023'; END IF;
    RETURN prior.response_json;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('wardrobe:'||p_owner,0));
  IF p_operation NOT IN ('inspiration_create','inspiration_update','inspiration_publish','inspiration_delete') THEN RAISE EXCEPTION 'INVALID_REQUEST' USING ERRCODE='22023'; END IF;
  IF p_operation<>'inspiration_create' THEN
    SELECT * INTO row_value FROM wardrobe_inspirations WHERE id=p_id AND owner_id=p_owner AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0002'; END IF;
    IF p_expected_revision IS NULL OR row_value.revision<>p_expected_revision THEN RAISE EXCEPTION 'REVISION_CONFLICT' USING ERRCODE='22023'; END IF;
  END IF;
  IF p_operation IN ('inspiration_create','inspiration_update') THEN
    IF jsonb_typeof(p_payload->'reference_items')<>'array' OR jsonb_array_length(p_payload->'reference_items')>30 THEN RAISE EXCEPTION 'INVALID_REFERENCES' USING ERRCODE='22023'; END IF;
    IF p_payload->>'source_image_id' IS NOT NULL THEN
      SELECT * INTO picture FROM wardrobe_inspiration_images WHERE id=(p_payload->>'source_image_id')::uuid AND owner_id=p_owner;
      IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_IMAGE' USING ERRCODE='22023'; END IF;
    END IF;
    FOR reference IN SELECT value FROM jsonb_array_elements(p_payload->'reference_items') LOOP
      IF reference->>'matched_wardrobe_item_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM wardrobe_items WHERE id=(reference->>'matched_wardrobe_item_id')::uuid AND user_id=p_owner AND deleted_at IS NULL) THEN RAISE EXCEPTION 'INVALID_MATCH' USING ERRCODE='22023'; END IF;
      IF reference->>'id' IS NOT NULL THEN
        reference_id:=(reference->>'id')::uuid;
        IF p_operation='inspiration_create' OR NOT EXISTS(SELECT 1 FROM wardrobe_inspiration_items WHERE id=reference_id AND inspiration_id=row_value.id) OR reference_id=ANY(reference_ids) THEN RAISE EXCEPTION 'INVALID_REFERENCE_ID' USING ERRCODE='22023'; END IF;
        reference_ids:=array_append(reference_ids,reference_id);
      END IF;
    END LOOP;
    IF p_operation='inspiration_create' THEN
      INSERT INTO wardrobe_inspirations(owner_id,title,source_image_id,source_image_key,source_url,overall_style,color_palette,occasions,styling_notes,analysis_status,analysis_error,source)
      VALUES(p_owner,p_payload->>'title',picture.id,picture.object_key,p_payload->>'source_url',p_payload->>'overall_style',ARRAY(SELECT jsonb_array_elements_text(p_payload->'color_palette')),ARRAY(SELECT jsonb_array_elements_text(p_payload->'occasions')),p_payload->>'styling_notes',p_payload->>'analysis_status',p_payload->>'analysis_error',p_payload->>'source') RETURNING * INTO row_value;
    ELSE
      UPDATE wardrobe_inspirations SET title=p_payload->>'title',source_image_id=picture.id,source_image_key=picture.object_key,source_url=p_payload->>'source_url',overall_style=p_payload->>'overall_style',color_palette=ARRAY(SELECT jsonb_array_elements_text(p_payload->'color_palette')),occasions=ARRAY(SELECT jsonb_array_elements_text(p_payload->'occasions')),styling_notes=p_payload->>'styling_notes',analysis_status=p_payload->>'analysis_status',analysis_error=p_payload->>'analysis_error',status='draft',revision=revision+1,updated_at=now() WHERE id=row_value.id RETURNING * INTO row_value;
      DELETE FROM wardrobe_inspiration_items WHERE inspiration_id=row_value.id;
    END IF;
    FOR reference IN SELECT value FROM jsonb_array_elements(p_payload->'reference_items') LOOP
      INSERT INTO wardrobe_inspiration_items(id,inspiration_id,position,category,subcategory,primary_color,color_family,pattern,design_features,style_tags,bounding_box,visibility,matched_wardrobe_item_id,match_reason,match_score,needs_review)
      VALUES(coalesce((reference->>'id')::uuid,gen_random_uuid()),row_value.id,ordinal,reference->>'category',reference->>'subcategory',reference->>'primary_color',reference->>'color_family',reference->>'pattern',ARRAY(SELECT jsonb_array_elements_text(reference->'design_features')),ARRAY(SELECT jsonb_array_elements_text(reference->'style_tags')),NULLIF(reference->'bounding_box','null'::jsonb),reference->>'visibility',(reference->>'matched_wardrobe_item_id')::uuid,reference->>'match_reason',(reference->>'match_score')::numeric,(reference->>'needs_review')::boolean);
      ordinal:=ordinal+1;
    END LOOP;
  ELSIF p_operation='inspiration_publish' THEN
    IF row_value.source_image_id IS NULL OR row_value.analysis_status<>'ready' OR NOT EXISTS(SELECT 1 FROM wardrobe_inspiration_items WHERE inspiration_id=row_value.id) THEN RAISE EXCEPTION 'INCOMPLETE_DRAFT' USING ERRCODE='22023'; END IF;
    IF EXISTS(SELECT 1 FROM wardrobe_inspiration_items r LEFT JOIN wardrobe_items i ON i.id=r.matched_wardrobe_item_id WHERE r.inspiration_id=row_value.id AND r.matched_wardrobe_item_id IS NOT NULL AND (i.id IS NULL OR i.user_id<>p_owner OR i.deleted_at IS NOT NULL)) THEN RAISE EXCEPTION 'INVALID_MATCH' USING ERRCODE='22023'; END IF;
    UPDATE wardrobe_inspirations SET status='published',revision=revision+1,updated_at=now() WHERE id=row_value.id RETURNING * INTO row_value;
  ELSE
    UPDATE wardrobe_inspirations SET deleted_at=now(),revision=revision+1,updated_at=now() WHERE id=row_value.id RETURNING * INTO row_value;
  END IF;
  SELECT to_jsonb(row_value)||jsonb_build_object('reference_items',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY position) FROM wardrobe_inspiration_items r WHERE inspiration_id=row_value.id),'[]'::jsonb)) INTO response;
  INSERT INTO nmdd_write_requests(owner_id,operation,idempotency_key,request_hash,response_json) VALUES(p_owner,p_operation,p_key,p_hash,response);
  INSERT INTO nmdd_tool_audit(owner_id,actor,action,outcome,record_id) VALUES(p_owner,p_actor,p_operation,'success',row_value.id);
  RETURN response;
END $$;

CREATE OR REPLACE FUNCTION public.nmdd_wardrobe_mutate(p_owner text,p_operation text,p_id uuid,p_payload jsonb,p_key text,p_hash text,p_actor text)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public AS $$
DECLARE prior nmdd_write_requests; response jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('nmdd:idem:'||p_owner||':'||p_operation||':'||p_key,0));
  SELECT * INTO prior FROM nmdd_write_requests WHERE owner_id=p_owner AND operation=p_operation AND idempotency_key=p_key;
  IF FOUND THEN
    IF prior.request_hash<>p_hash THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE='22023'; END IF;
    RETURN prior.response_json;
  END IF;
  IF p_operation='wardrobe_create' THEN
    PERFORM wardrobe_import(p_owner,jsonb_build_array(p_payload),'skip_existing');
    SELECT to_jsonb(i) INTO response FROM wardrobe_items i WHERE user_id=p_owner AND external_id=p_payload->>'external_id';
  ELSIF p_operation='wardrobe_update' THEN
    response:=wardrobe_patch_item(p_owner,p_id,p_payload);
  ELSE RAISE EXCEPTION 'INVALID_REQUEST' USING ERRCODE='22023'; END IF;
  INSERT INTO nmdd_write_requests(owner_id,operation,idempotency_key,request_hash,response_json) VALUES(p_owner,p_operation,p_key,p_hash,response);
  INSERT INTO nmdd_tool_audit(owner_id,actor,action,outcome,record_id) VALUES(p_owner,p_actor,p_operation,'success',(response->>'id')::uuid);
  RETURN response;
END $$;
CREATE OR REPLACE FUNCTION public.nmdd_inspiration_image(p_owner text,p_payload jsonb,p_key text,p_hash text,p_actor text)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public AS $$
DECLARE prior nmdd_write_requests; picture wardrobe_inspiration_images; response jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('nmdd:idem:'||p_owner||':image_upload:'||p_key,0));
  SELECT * INTO prior FROM nmdd_write_requests WHERE owner_id=p_owner AND operation='image_upload' AND idempotency_key=p_key;
  IF FOUND THEN
    IF prior.request_hash<>p_hash THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE='22023'; END IF;
    RETURN prior.response_json;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('wardrobe:'||p_owner,0));
  SELECT * INTO picture FROM wardrobe_inspiration_images WHERE owner_id=p_owner AND sha256=p_payload->>'sha256';
  IF NOT FOUND THEN
    INSERT INTO wardrobe_inspiration_images(owner_id,object_key,sha256,mime_type,byte_size)
    VALUES(p_owner,p_payload->>'object_key',p_payload->>'sha256',p_payload->>'mime_type',(p_payload->>'byte_size')::integer) RETURNING * INTO picture;
  END IF;
  response:=to_jsonb(picture);
  INSERT INTO nmdd_write_requests(owner_id,operation,idempotency_key,request_hash,response_json) VALUES(p_owner,'image_upload',p_key,p_hash,response);
  INSERT INTO nmdd_tool_audit(owner_id,actor,action,outcome,record_id) VALUES(p_owner,p_actor,'image_upload','success',picture.id);
  RETURN response;
END $$;
REVOKE ALL ON FUNCTION public.nmdd_oauth_exchange(text,text,text,text,text,text,text,text),public.nmdd_inspiration_mutate(text,text,uuid,integer,jsonb,text,text,text),public.nmdd_wardrobe_mutate(text,text,uuid,jsonb,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.nmdd_oauth_exchange(text,text,text,text,text,text,text,text),public.nmdd_inspiration_mutate(text,text,uuid,integer,jsonb,text,text,text),public.nmdd_wardrobe_mutate(text,text,uuid,jsonb,text,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.nmdd_inspiration_image(text,jsonb,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.nmdd_inspiration_image(text,jsonb,text,text,text) TO service_role;
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('wardrobe-inspiration-images','wardrobe-inspiration-images',false,8388608,ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=8388608,allowed_mime_types=EXCLUDED.allowed_mime_types;
NOTIFY pgrst,'reload schema';
COMMIT;
