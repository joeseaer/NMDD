-- People overview: persist AI attention recommendations as proposals. The
-- proposal table already separates AI drafts from user-confirmed relationship
-- state; this migration only adds the query index and an atomic decision RPC.

CREATE INDEX IF NOT EXISTS relationship_ai_proposals_attention_run_idx
  ON relationship_ai_proposals (user_id, proposal_type, status, created_at DESC)
  WHERE proposal_type IN ('attention_recommendation', 'attention_recommendation_run');

CREATE OR REPLACE FUNCTION decide_relationship_attention_recommendation(
  p_user_id TEXT,
  p_recommendation_id UUID,
  p_decision TEXT,
  p_reason TEXT DEFAULT NULL,
  p_observe_next TEXT DEFAULT NULL,
  p_expected_version INTEGER DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  v_proposal relationship_ai_proposals%ROWTYPE;
  v_context relationship_contexts%ROWTYPE;
  v_has_context BOOLEAN := FALSE;
  v_reason TEXT;
  v_observe_next TEXT;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid()::TEXT <> p_user_id THEN
    RAISE EXCEPTION 'RS_NOT_FOUND';
  END IF;
  IF p_decision NOT IN ('accept', 'dismiss') THEN
    RAISE EXCEPTION 'RS_INVALID_DECISION';
  END IF;

  SELECT * INTO v_proposal
  FROM relationship_ai_proposals
  WHERE id = p_recommendation_id
    AND user_id = p_user_id
    AND proposal_type = 'attention_recommendation'
    AND person_id IS NOT NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'RS_NOT_FOUND';
  END IF;

  IF p_decision = 'accept' AND v_proposal.status = 'confirmed' THEN
    SELECT * INTO v_context
    FROM relationship_contexts
    WHERE id = v_proposal.confirmed_entity_id AND user_id = p_user_id;
    RETURN jsonb_build_object(
      'recommendation', to_jsonb(v_proposal),
      'context', CASE WHEN FOUND THEN to_jsonb(v_context) ELSE NULL END,
      'duplicate', TRUE
    );
  END IF;
  IF p_decision = 'dismiss'
    AND v_proposal.status = 'rejected'
    AND v_proposal.error->>'code' = 'USER_DISMISSED' THEN
    RETURN jsonb_build_object('recommendation', to_jsonb(v_proposal), 'context', NULL, 'duplicate', TRUE);
  END IF;
  IF v_proposal.status <> 'draft' THEN
    RAISE EXCEPTION 'RS_DECISION_CONFLICT';
  END IF;
  IF p_expected_version IS NOT NULL AND p_expected_version <> v_proposal.version THEN
    RAISE EXCEPTION 'RS_VERSION_CONFLICT';
  END IF;

  v_reason := COALESCE(NULLIF(BTRIM(p_reason), ''), NULLIF(BTRIM(v_proposal.payload->>'reason'), ''));
  v_observe_next := COALESCE(
    NULLIF(BTRIM(p_observe_next), ''),
    NULLIF(BTRIM(v_proposal.payload->>'observe_next'), '')
  );

  IF p_decision = 'accept' THEN
    SELECT * INTO v_context
    FROM relationship_contexts
    WHERE user_id = p_user_id AND person_id = v_proposal.person_id
    ORDER BY is_primary DESC, updated_at DESC
    LIMIT 1
    FOR UPDATE;
    v_has_context := FOUND;

    IF v_has_context THEN
      IF v_context.attention_status IN ('repair', 'boundary') THEN
        RAISE EXCEPTION 'RS_CONTEXT_STATE_CONFLICT';
      END IF;
      UPDATE relationship_contexts
      SET attention_status = 'focus',
          is_primary = TRUE,
          why_matters_now = COALESCE(v_reason, why_matters_now),
          urgency = CASE
            WHEN v_observe_next IS NULL THEN COALESCE(urgency, '{}'::JSONB)
            ELSE COALESCE(urgency, '{}'::JSONB) || jsonb_build_object('observe_next', v_observe_next)
          END,
          version = version + 1,
          updated_at = NOW()
      WHERE id = v_context.id AND user_id = p_user_id
      RETURNING * INTO v_context;
    ELSE
      INSERT INTO relationship_contexts (
        user_id, person_id, context_type, attention_status, why_matters_now,
        urgency, is_primary
      ) VALUES (
        p_user_id, v_proposal.person_id, 'other', 'focus', v_reason,
        CASE WHEN v_observe_next IS NULL THEN '{}'::JSONB
             ELSE jsonb_build_object('observe_next', v_observe_next) END,
        TRUE
      ) RETURNING * INTO v_context;
    END IF;

    UPDATE relationship_ai_proposals
    SET status = 'confirmed',
        payload = COALESCE(payload, '{}'::JSONB)
          || jsonb_strip_nulls(jsonb_build_object('reason', v_reason, 'observe_next', v_observe_next)),
        error = NULL,
        confirmed_entity_type = 'relationship_context',
        confirmed_entity_id = v_context.id,
        confirmed_at = NOW(),
        version = version + 1,
        updated_at = NOW()
    WHERE id = v_proposal.id AND user_id = p_user_id
    RETURNING * INTO v_proposal;

    RETURN jsonb_build_object(
      'recommendation', to_jsonb(v_proposal),
      'context', to_jsonb(v_context),
      'duplicate', FALSE
    );
  END IF;

  UPDATE relationship_ai_proposals
  SET status = 'rejected',
      payload = COALESCE(payload, '{}'::JSONB)
        || jsonb_strip_nulls(jsonb_build_object('reason', v_reason, 'observe_next', v_observe_next)),
      error = jsonb_build_object('code', 'USER_DISMISSED', 'message', 'User chose not to focus on this person now.'),
      confirmed_at = NOW(),
      version = version + 1,
      updated_at = NOW()
  WHERE id = v_proposal.id AND user_id = p_user_id
  RETURNING * INTO v_proposal;

  RETURN jsonb_build_object(
    'recommendation', to_jsonb(v_proposal),
    'context', NULL,
    'duplicate', FALSE
  );
END
$function$;

COMMENT ON FUNCTION decide_relationship_attention_recommendation(TEXT, UUID, TEXT, TEXT, TEXT, INTEGER)
  IS 'Atomically applies or dismisses a user-owned AI attention recommendation. AI generation itself never changes relationship attention.';
