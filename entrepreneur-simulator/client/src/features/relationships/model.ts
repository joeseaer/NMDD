export type AttentionState =
  | 'focus'
  | 'maintain'
  | 'observe'
  | 'repair'
  | 'boundary'
  | 'dormant'
  | 'archived';

export type ConfidenceLevel =
  | 'insufficient'
  | 'initial'
  | 'mixed'
  | 'repeated'
  | 'direct_report'
  | 'behavior_supported';

export type ClaimStatus = 'proposed' | 'testing' | 'mixed' | 'supported' | 'contradicted' | 'retired';
export type DecisionStatus = 'draft' | 'chosen' | 'executed' | 'reviewed' | 'cancelled';
export type OpportunityStage =
  | 'signal'
  | 'problem_hypothesis'
  | 'interview'
  | 'offer_test'
  | 'paid_validation'
  | 'repeatable'
  | 'scaling'
  | 'stopped'
  | 'archived';

export type ResourceStatus = 'idle' | 'loading' | 'success' | 'error';

export interface PersonSummary {
  id: string;
  name: string;
  identity?: string | null;
  field?: string | null;
  roles: string[];
  tags: string[];
  attention_state: AttentionState;
  focus_reason?: string | null;
  last_interaction_at?: string | null;
  last_interaction_summary?: string | null;
  primary_context_id?: string | null;
  context_version?: number;
  current_goal?: string | null;
  current_state?: string | null;
  observe_next?: string | null;
  attention_layer?: 'current' | 'library' | null;
  current_attention?: boolean;
  relationship_mode?: string | null;
  updated_at?: string | null;
  version?: number;
  is_legacy?: boolean;
}

export interface AttentionRecommendationEvidence {
  id?: string | null;
  type?: string | null;
  label: string;
  summary?: string | null;
  occurred_at?: string | null;
  source_id?: string | null;
}

export interface AttentionRecommendation {
  id: string;
  person_id: string;
  person: PersonSummary;
  status: 'pending' | 'accepted' | 'dismissed';
  reason?: string | null;
  why_now?: string | null;
  life_domains: string[];
  observe_next?: string | null;
  evidence_refs: AttentionRecommendationEvidence[];
  confidence?: string | null;
  suggested_until?: string | null;
  generated_at?: string | null;
  version?: number;
}

export interface PeopleOverviewCounts {
  tracked: number;
  attention: number;
  library: number;
  recommendations: number;
}

export interface AttentionRecommendationRun {
  id: string;
  generated_at?: string | null;
  snapshot_hash?: string | null;
  status: 'ai' | 'fallback' | 'empty';
  warning?: string | null;
  source_status: Record<string, { available: boolean; count: number; error?: string | null }>;
  recommendation_count: number;
  model?: string | null;
  prompt_version?: string | null;
}

export interface PeopleOverviewData {
  generated_at?: string | null;
  recommendations: AttentionRecommendation[];
  attention_people: PersonSummary[];
  library_people: PersonSummary[];
  counts: PeopleOverviewCounts;
  recommendation_run?: AttentionRecommendationRun | null;
  cached?: boolean;
  warning?: string | null;
}

export interface CompassSnapshot {
  headline: string;
  outcome_12m?: string | null;
  focus_90d?: string | null;
  cashflow_target?: number | null;
  metric_definition?: string | null;
}

export interface CompassPlan {
  id?: string | null;
  version: number;
  title: string;
  horizon_date?: string | null;
  outcome_statement: string;
  success_metrics: string[];
  current_assets: string[];
  current_constraints: string[];
  ninety_day_bet?: string | null;
  non_negotiables: string[];
  planning_state: PlanningState;
}

export type GoalNodeStatus = 'planned' | 'in_progress' | 'completed' | 'paused';

export interface GoalNode {
  id: string;
  parent_id: string | null;
  title: string;
  status: GoalNodeStatus;
  sort_order: number;
  current_fact: string;
  completion_standard: string;
  missing_evidence: string;
  next_validation: string;
}

export interface CompassGap {
  id: string;
  label: string;
  current_state: string;
  target_state: string;
  primary_gap: string;
  next_evidence: string;
  current_value?: number | null;
  target_value?: number | null;
  unit?: string | null;
}

export interface DailyGuidanceSource {
  domain: string;
  id?: string | null;
  label: string;
  count?: number | null;
  status?: 'included' | 'unavailable' | 'empty' | 'truncated';
  last_updated_at?: string | null;
}

export interface DailyGuidance {
  focus: string;
  why: string;
  avoid: string;
  observe: string;
  generated_at?: string | null;
  snapshot_hash?: string | null;
  based_on_compass_version?: number | null;
  data_sources: DailyGuidanceSource[];
  sources: DailyGuidanceSource[];
  fallback?: boolean;
  warning?: string | null;
}

export interface PlanningState {
  schema_version: 1;
  current_node_id: string | null;
  nodes: GoalNode[];
  overall_gaps: CompassGap[];
  stage_gaps: Record<string, CompassGap[]>;
  daily_guidance?: DailyGuidance | null;
}

export interface PlannerTaskSummary {
  id: string;
  title: string;
  due_at?: string | null;
}

export interface CompassPageData {
  plan: CompassPlan;
  today_tasks: PlannerTaskSummary[];
  planner_available: boolean;
}

export interface Commitment {
  id: string;
  person_id?: string | null;
  person_name?: string | null;
  title: string;
  owner: 'me' | 'them' | 'shared';
  due_at?: string | null;
  status: 'open' | 'done' | 'cancelled';
  source_interaction_id?: string | null;
}

export interface Interaction {
  id: string;
  person_id: string;
  occurred_at: string;
  context?: string | null;
  facts: string[];
  my_action?: string | null;
  their_reaction?: string | null;
  my_feelings?: string[];
  interpretation?: string | null;
  actual_result?: string | null;
  prediction_match?: 'matched' | 'partly' | 'not_matched' | 'unknown' | null;
  commitments: Commitment[];
  opportunity_signal_ids: string[];
  created_at?: string | null;
}

export interface EvidenceReference {
  id: string;
  source_type: 'interaction' | 'direct_statement' | 'document' | 'manual' | 'other';
  source_id?: string | null;
  excerpt: string;
  occurred_at?: string | null;
  direction: 'support' | 'counter' | 'neutral';
}

export interface PersonClaim {
  id: string;
  person_id: string;
  context: string;
  statement: string;
  status: ClaimStatus;
  confidence: ConfidenceLevel;
  evidence: EvidenceReference[];
  alternative_explanations: string[];
  suggested_approach?: string | null;
  last_verified_at?: string | null;
  user_confirmed?: boolean;
  version?: number;
}

export interface DecisionOption {
  id?: string;
  label: string;
  upside?: string | null;
  downside?: string | null;
}

export interface DecisionOutcome {
  actual_result: string;
  observed_signals: string[];
  prediction_match: 'matched' | 'partly' | 'not_matched' | 'unknown';
  lesson?: string | null;
  recorded_at?: string | null;
}

export interface RelationshipDecision {
  id: string;
  person_id: string;
  goal: string;
  why_now?: string | null;
  mutual_value?: string | null;
  trust_context?: string | null;
  options: DecisionOption[];
  recommendation?: string | null;
  next_step?: string | null;
  feedback_signals: string[];
  risks: string[];
  boundaries: string[];
  stop_conditions: string[];
  status: DecisionStatus;
  outcome?: DecisionOutcome | null;
  created_at?: string | null;
  version?: number;
}

export interface SituationBrief {
  why_now?: string | null;
  current_state?: string | null;
  recent_change?: string | null;
  current_goal?: string | null;
  current_boundary?: string | null;
  observe_next?: string | null;
}

export interface PrimaryRelationshipContext {
  id: string;
  version?: number;
  attention_status: AttentionState;
  why?: string | null;
  current_state?: string | null;
  current_goal?: string | null;
  mutual_value?: string | null;
  boundaries: string[];
  observe_next?: string | null;
}

export interface PersonWorkspace {
  person: PersonSummary;
  primary_context: PrimaryRelationshipContext | null;
  brief: SituationBrief;
  confirmed_guides: PersonClaim[];
  hypotheses: PersonClaim[];
  inactive_claims: PersonClaim[];
  commitments: Commitment[];
  next_action?: RelationshipDecision | null;
  decisions: RelationshipDecision[];
  interactions: Interaction[];
  related_people: PersonSummary[];
}

export interface OpportunityEvidence {
  id: string;
  kind: 'complaint' | 'repeated_problem' | 'workaround' | 'existing_spend' | 'quote' | 'payment' | 'repeat' | 'referral' | 'other';
  summary: string;
  person_id?: string | null;
  person_name?: string | null;
  amount?: number | null;
  occurred_at?: string | null;
}

export interface OpportunityExperiment {
  id: string;
  opportunity_id: string;
  hypothesis: string;
  method: string;
  success_signal: string;
  due_at?: string | null;
  status: 'planned' | 'running' | 'completed' | 'cancelled';
  result?: string | null;
  evidence?: string | null;
  payment_amount?: number | null;
  next_decision?: 'continue' | 'adjust' | 'stop' | null;
  created_at?: string | null;
}

export interface BusinessOpportunity {
  id: string;
  title: string;
  problem: string;
  customer?: string | null;
  user_role?: string | null;
  beneficiary_role?: string | null;
  decision_maker_role?: string | null;
  payer_role?: string | null;
  frequency?: string | null;
  cost?: string | null;
  urgency?: string | null;
  current_workaround?: string | null;
  access_advantage?: string | null;
  missing_evidence?: string | null;
  next_experiment?: string | null;
  stage: OpportunityStage;
  evidence: OpportunityEvidence[];
  experiments: OpportunityExperiment[];
  related_people: PersonSummary[];
  cashflow_total?: number | null;
  updated_at?: string | null;
  version?: number;
}

export interface TodayData {
  compass: CompassSnapshot;
  priority_people: PersonSummary[];
  commitments: Commitment[];
  momentum_people: PersonSummary[];
  active_opportunity?: BusinessOpportunity | null;
  weekly_review_due: boolean;
  weekly_review_label?: string | null;
}

export interface WeeklyReviewAction {
  id?: string;
  person_id?: string | null;
  person_name?: string | null;
  title: string;
  due_at?: string | null;
}

export interface WeeklyReviewDraft {
  id: string;
  week_start: string;
  week_end: string;
  status: 'draft' | 'completed';
  important_changes: string[];
  neglected_relationships: string[];
  open_commitments: Commitment[];
  asymmetry_warnings: string[];
  contradicted_claims: PersonClaim[];
  opportunity_signals: string[];
  self_pattern_candidate?: string | null;
  principle_candidate?: string | null;
  relationship_actions: WeeklyReviewAction[];
  opportunity_experiment?: string | null;
}

export interface GrowthPrinciple {
  id: string;
  statement: string;
  evidence_count: number;
  counterexample_count: number;
  status: 'candidate' | 'confirmed' | 'retired';
  updated_at?: string | null;
}

export interface SelfPattern {
  id: string;
  statement: string;
  status: 'candidate' | 'confirmed' | 'rejected';
  evidence_count: number;
  counterexample_count: number;
  next_practice?: string | null;
}

export interface CalibrationPoint {
  label: string;
  predicted: number;
  actual: number;
}

export interface GrowthData {
  principles: GrowthPrinciple[];
  patterns: SelfPattern[];
  calibration: CalibrationPoint[];
  independent_judgment_rate?: number | null;
  closed_loop_count?: number | null;
  commitment_completion_rate?: number | null;
}

export interface ExtractedInteractionDraft {
  proposal_id: string;
  person_id: string;
  occurred_at: string;
  context?: string | null;
  facts: string[];
  my_action?: string | null;
  their_reaction?: string | null;
  my_feelings?: string[];
  interpretation?: string | null;
  commitments: Array<Pick<Commitment, 'title' | 'owner' | 'due_at'>>;
  opportunity_signals: string[];
  hypothesis_updates: string[];
  duplicate_candidates: Array<{ id: string; summary: string; occurred_at?: string | null }>;
  warnings?: string[];
}

export interface DecisionProposal {
  proposal_id: string;
  person_id: string;
  goal: string;
  why_now?: string | null;
  mutual_value?: string | null;
  trust_context?: string | null;
  options: DecisionOption[];
  recommendation?: string | null;
  next_step?: string | null;
  feedback_signals: string[];
  risks: string[];
  boundaries: string[];
  stop_conditions: string[];
  evidence_ids: string[];
  counterview?: string | null;
}

export interface LegacyPerson {
  id: string;
  name?: string | null;
  identity?: string | null;
  field?: string | null;
  tags?: string[] | null;
  contact_info?: string | null;
  notes?: string | null;
  private_info?: string | null;
  relationship_strength?: number | null;
  disc_type?: string | null;
  mbti_type?: string | null;
  updated_at?: string | null;
}

export const ATTENTION_LABELS: Record<AttentionState, string> = {
  focus: '重点投入',
  maintain: '稳定维护',
  observe: '继续探索',
  repair: '尝试修复',
  boundary: '保持边界',
  dormant: '暂时休眠',
  archived: '已归档',
};

export const CONFIDENCE_LABELS: Record<ConfidenceLevel, string> = {
  insufficient: '证据不足',
  initial: '初步迹象',
  mixed: '证据混合',
  repeated: '多次重复',
  direct_report: '本人直接表达',
  behavior_supported: '行为持续支持',
};

export const OPPORTUNITY_STAGE_LABELS: Record<OpportunityStage, string> = {
  signal: '信号',
  problem_hypothesis: '问题假设',
  interview: '客户访谈',
  offer_test: '报价测试',
  paid_validation: '付费验证',
  repeatable: '可重复',
  scaling: '扩大',
  stopped: '已停止',
  archived: '已归档',
};

export const EMPTY_TODAY_DATA: TodayData = {
  compass: { headline: '先从一条真实互动开始积累判断。' },
  priority_people: [],
  commitments: [],
  momentum_people: [],
  active_opportunity: null,
  weekly_review_due: false,
};

export const EMPTY_GROWTH_DATA: GrowthData = {
  principles: [],
  patterns: [],
  calibration: [],
  independent_judgment_rate: null,
  closed_loop_count: 0,
  commitment_completion_rate: null,
};
