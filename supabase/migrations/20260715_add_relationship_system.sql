-- Relationship & Opportunity System (additive migration)
-- This migration deliberately leaves people_profiles, interaction_logs and private_info untouched.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Required by composite foreign keys below. It also makes ownership part of the
-- database relationship instead of relying only on application filters.
CREATE UNIQUE INDEX IF NOT EXISTS people_profiles_id_user_uidx
  ON people_profiles (id, user_id);

CREATE TABLE IF NOT EXISTS relationship_compasses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '当前生活与事业罗盘',
  horizon_date DATE,
  outcome_statement TEXT,
  success_metrics JSONB NOT NULL DEFAULT '[]'::jsonb,
  current_assets JSONB NOT NULL DEFAULT '[]'::jsonb,
  current_constraints JSONB NOT NULL DEFAULT '[]'::jsonb,
  ninety_day_bet TEXT,
  non_negotiables JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS relationship_compasses_one_active_user_uidx
  ON relationship_compasses (user_id) WHERE is_active;

CREATE TABLE IF NOT EXISTS relationship_contexts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,
  person_id UUID NOT NULL,
  context_type TEXT NOT NULL DEFAULT 'other'
    CHECK (context_type IN ('family', 'partner', 'friend', 'mentor', 'colleague', 'business', 'customer', 'other')),
  label TEXT,
  attention_status TEXT NOT NULL DEFAULT 'observe'
    CHECK (attention_status IN ('focus', 'maintain', 'observe', 'repair', 'boundary', 'sleep', 'archived')),
  why_matters_now TEXT,
  current_state TEXT,
  current_goal TEXT,
  mutual_value TEXT,
  boundaries JSONB NOT NULL DEFAULT '[]'::jsonb,
  relationship_health JSONB NOT NULL DEFAULT '{}'::jsonb,
  urgency JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, user_id),
  CONSTRAINT relationship_contexts_person_owner_fk
    FOREIGN KEY (person_id, user_id) REFERENCES people_profiles (id, user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS relationship_contexts_user_attention_idx
  ON relationship_contexts (user_id, attention_status, updated_at DESC);
CREATE INDEX IF NOT EXISTS relationship_contexts_person_idx
  ON relationship_contexts (user_id, person_id, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS relationship_contexts_primary_person_uidx
  ON relationship_contexts (user_id, person_id) WHERE is_primary;

CREATE TABLE IF NOT EXISTS relationship_interactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,
  person_id UUID NOT NULL,
  context_id UUID,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source_type TEXT NOT NULL DEFAULT 'text'
    CHECK (source_type IN ('text', 'voice', 'manual', 'import')),
  raw_text TEXT,
  summary TEXT NOT NULL,
  observed_facts JSONB NOT NULL DEFAULT '[]'::jsonb,
  my_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  their_reactions JSONB NOT NULL DEFAULT '[]'::jsonb,
  my_feelings JSONB NOT NULL DEFAULT '[]'::jsonb,
  interpretations JSONB NOT NULL DEFAULT '[]'::jsonb,
  commitments JSONB NOT NULL DEFAULT '[]'::jsonb,
  relationship_signals JSONB NOT NULL DEFAULT '[]'::jsonb,
  opportunity_signals JSONB NOT NULL DEFAULT '[]'::jsonb,
  review JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_proposal_id UUID,
  client_idempotency_key TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, user_id),
  UNIQUE (user_id, client_idempotency_key),
  CONSTRAINT relationship_interactions_person_owner_fk
    FOREIGN KEY (person_id, user_id) REFERENCES people_profiles (id, user_id) ON DELETE CASCADE,
  CONSTRAINT relationship_interactions_context_owner_fk
    FOREIGN KEY (context_id, user_id) REFERENCES relationship_contexts (id, user_id)
);

CREATE INDEX IF NOT EXISTS relationship_interactions_person_time_idx
  ON relationship_interactions (user_id, person_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS relationship_claims (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,
  person_id UUID NOT NULL,
  context_id UUID,
  dimension TEXT NOT NULL DEFAULT 'other',
  statement TEXT NOT NULL,
  situation TEXT,
  status TEXT NOT NULL DEFAULT 'hypothesis'
    CHECK (status IN ('hypothesis', 'testing', 'mixed', 'supported', 'contradicted', 'retired')),
  confidence_level TEXT NOT NULL DEFAULT 'insufficient'
    CHECK (confidence_level IN ('insufficient', 'initial', 'mixed', 'repeated', 'direct_report', 'behavior_supported')),
  alternative_explanations JSONB NOT NULL DEFAULT '[]'::jsonb,
  counterevidence_notes TEXT,
  source_type TEXT NOT NULL DEFAULT 'user'
    CHECK (source_type IN ('user', 'ai_proposal', 'imported')),
  user_confirmed BOOLEAN NOT NULL DEFAULT TRUE,
  last_verified_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, user_id),
  CONSTRAINT relationship_claims_person_owner_fk
    FOREIGN KEY (person_id, user_id) REFERENCES people_profiles (id, user_id) ON DELETE CASCADE,
  CONSTRAINT relationship_claims_context_owner_fk
    FOREIGN KEY (context_id, user_id) REFERENCES relationship_contexts (id, user_id)
);

CREATE INDEX IF NOT EXISTS relationship_claims_person_status_idx
  ON relationship_claims (user_id, person_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS relationship_claim_evidence (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,
  claim_id UUID NOT NULL,
  interaction_id UUID,
  evidence_type TEXT NOT NULL
    CHECK (evidence_type IN ('supports', 'contradicts', 'neutral')),
  content TEXT NOT NULL,
  occurred_at TIMESTAMPTZ,
  source_label TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, user_id),
  CONSTRAINT relationship_claim_evidence_claim_owner_fk
    FOREIGN KEY (claim_id, user_id) REFERENCES relationship_claims (id, user_id) ON DELETE CASCADE,
  CONSTRAINT relationship_claim_evidence_interaction_owner_fk
    FOREIGN KEY (interaction_id, user_id) REFERENCES relationship_interactions (id, user_id)
);

CREATE INDEX IF NOT EXISTS relationship_claim_evidence_claim_idx
  ON relationship_claim_evidence (user_id, claim_id, created_at DESC);

CREATE TABLE IF NOT EXISTS relationship_decisions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,
  person_id UUID NOT NULL,
  context_id UUID,
  decision_type TEXT NOT NULL DEFAULT 'other'
    CHECK (decision_type IN ('contact', 'wait', 'advance', 'care', 'ask', 'negotiate', 'conflict', 'repair', 'boundary', 'decline', 'gratitude', 'opportunity', 'other')),
  relationship_mode TEXT CHECK (relationship_mode IN ('long_term', 'transaction', 'mixed')),
  goal TEXT NOT NULL,
  why_now TEXT,
  mutual_value TEXT,
  options JSONB NOT NULL DEFAULT '[]'::jsonb,
  selected_option JSONB,
  recommendation TEXT,
  risks JSONB NOT NULL DEFAULT '[]'::jsonb,
  boundaries JSONB NOT NULL DEFAULT '[]'::jsonb,
  feedback_signals JSONB NOT NULL DEFAULT '[]'::jsonb,
  stop_conditions JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'chosen', 'executing', 'completed', 'cancelled')),
  due_at TIMESTAMPTZ,
  chosen_at TIMESTAMPTZ,
  source_proposal_id UUID,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, user_id),
  CONSTRAINT relationship_decisions_person_owner_fk
    FOREIGN KEY (person_id, user_id) REFERENCES people_profiles (id, user_id) ON DELETE CASCADE,
  CONSTRAINT relationship_decisions_context_owner_fk
    FOREIGN KEY (context_id, user_id) REFERENCES relationship_contexts (id, user_id)
);

CREATE INDEX IF NOT EXISTS relationship_decisions_user_status_due_idx
  ON relationship_decisions (user_id, status, due_at, updated_at DESC);
CREATE INDEX IF NOT EXISTS relationship_decisions_person_idx
  ON relationship_decisions (user_id, person_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS relationship_decision_outcomes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,
  decision_id UUID NOT NULL,
  executed_at TIMESTAMPTZ,
  execution_notes TEXT,
  actual_response TEXT,
  result TEXT,
  expected_match TEXT CHECK (expected_match IN ('matched', 'partly', 'unexpected', 'unknown')),
  learning_about_them TEXT,
  learning_about_self TEXT,
  follow_up TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, user_id),
  UNIQUE (user_id, decision_id),
  CONSTRAINT relationship_decision_outcomes_decision_owner_fk
    FOREIGN KEY (decision_id, user_id) REFERENCES relationship_decisions (id, user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS relationship_opportunities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  problem_statement TEXT NOT NULL,
  target_customer TEXT,
  beneficiary TEXT,
  decision_maker TEXT,
  payer TEXT,
  frequency TEXT,
  cost_of_problem TEXT,
  urgency TEXT,
  current_workaround TEXT,
  access_channel TEXT,
  evidence_summary TEXT,
  payment_signal TEXT,
  next_missing_evidence TEXT,
  stage TEXT NOT NULL DEFAULT 'signal'
    CHECK (stage IN ('signal', 'problem_hypothesis', 'customer_interview', 'quote_test', 'paid_test', 'repeatable', 'scale', 'stopped', 'archived')),
  source_person_id UUID,
  related_person_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'closed')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, user_id),
  CONSTRAINT relationship_opportunities_source_person_owner_fk
    FOREIGN KEY (source_person_id, user_id) REFERENCES people_profiles (id, user_id)
);

CREATE INDEX IF NOT EXISTS relationship_opportunities_user_stage_idx
  ON relationship_opportunities (user_id, status, stage, updated_at DESC);

CREATE TABLE IF NOT EXISTS relationship_opportunity_experiments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,
  opportunity_id UUID NOT NULL,
  experiment_type TEXT NOT NULL DEFAULT 'other'
    CHECK (experiment_type IN ('interview', 'quote', 'preorder', 'manual_service', 'channel', 'delivery', 'repurchase', 'other')),
  hypothesis TEXT NOT NULL,
  method TEXT,
  success_criteria TEXT,
  planned_at TIMESTAMPTZ,
  executed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'running', 'completed', 'cancelled')),
  result TEXT,
  outcome TEXT CHECK (outcome IN ('validated', 'partly', 'invalidated', 'inconclusive')),
  revenue_amount NUMERIC(14, 2),
  currency TEXT NOT NULL DEFAULT 'CNY',
  next_step TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, user_id),
  CONSTRAINT relationship_opportunity_experiments_opportunity_owner_fk
    FOREIGN KEY (opportunity_id, user_id) REFERENCES relationship_opportunities (id, user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS relationship_experiments_opportunity_idx
  ON relationship_opportunity_experiments (user_id, opportunity_id, created_at DESC);

CREATE TABLE IF NOT EXISTS relationship_weekly_reviews (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,
  week_start DATE NOT NULL,
  summary TEXT,
  important_changes JSONB NOT NULL DEFAULT '[]'::jsonb,
  neglected_relationships JSONB NOT NULL DEFAULT '[]'::jsonb,
  open_commitments JSONB NOT NULL DEFAULT '[]'::jsonb,
  overinvestment_signals JSONB NOT NULL DEFAULT '[]'::jsonb,
  contradicted_claims JSONB NOT NULL DEFAULT '[]'::jsonb,
  opportunity_signals JSONB NOT NULL DEFAULT '[]'::jsonb,
  self_pattern TEXT,
  principle TEXT,
  next_people_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  next_opportunity_experiment JSONB,
  user_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, user_id),
  UNIQUE (user_id, week_start)
);

CREATE INDEX IF NOT EXISTS relationship_weekly_reviews_user_week_idx
  ON relationship_weekly_reviews (user_id, week_start DESC);

CREATE TABLE IF NOT EXISTS relationship_growth_patterns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'people_skill'
    CHECK (category IN ('people_skill', 'boundary', 'conflict', 'reciprocity', 'commercial', 'self_management', 'other')),
  title TEXT NOT NULL,
  pattern_statement TEXT NOT NULL,
  evidence_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  counterexamples JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'hypothesis'
    CHECK (status IN ('hypothesis', 'testing', 'supported', 'reframed', 'retired')),
  training_action TEXT,
  next_review_at TIMESTAMPTZ,
  source_weekly_review_id UUID,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, user_id),
  UNIQUE (user_id, source_weekly_review_id),
  CONSTRAINT relationship_growth_patterns_weekly_review_owner_fk
    FOREIGN KEY (source_weekly_review_id, user_id) REFERENCES relationship_weekly_reviews (id, user_id)
);

CREATE INDEX IF NOT EXISTS relationship_growth_patterns_user_status_idx
  ON relationship_growth_patterns (user_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS relationship_ai_proposals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,
  person_id UUID,
  proposal_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'confirmed', 'rejected', 'failed')),
  input_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload JSONB,
  evidence_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  error JSONB,
  model TEXT,
  prompt_version TEXT,
  confirmed_entity_type TEXT,
  confirmed_entity_id UUID,
  confirmed_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, user_id),
  CONSTRAINT relationship_ai_proposals_person_owner_fk
    FOREIGN KEY (person_id, user_id) REFERENCES people_profiles (id, user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS relationship_ai_proposals_user_status_idx
  ON relationship_ai_proposals (user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS relationship_ai_proposals_person_idx
  ON relationship_ai_proposals (user_id, person_id, created_at DESC);

-- RLS is defense in depth for direct Supabase clients. The service role used by
-- the local Fastify server bypasses RLS, so every service query also filters by
-- the server-owned DEFAULT_USER_ID and validates parent ownership.
DO $rls$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'relationship_compasses',
    'relationship_contexts',
    'relationship_interactions',
    'relationship_claims',
    'relationship_claim_evidence',
    'relationship_decisions',
    'relationship_decision_outcomes',
    'relationship_opportunities',
    'relationship_opportunity_experiments',
    'relationship_weekly_reviews',
    'relationship_growth_patterns',
    'relationship_ai_proposals'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS rs_owner_all ON %I', table_name);
    EXECUTE format(
      'CREATE POLICY rs_owner_all ON %I FOR ALL USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id)',
      table_name
    );
  END LOOP;
END
$rls$;
