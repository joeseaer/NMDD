-- Editable, branching goal plan for the relationship/life compass.
-- Existing compasses receive the five-stage plan that was previously rendered
-- only in the client. An explicitly saved empty nodes array remains empty.

ALTER TABLE relationship_compasses
  ADD COLUMN IF NOT EXISTS planning_state JSONB NOT NULL DEFAULT $planning_state$
  {
    "schema_version": 1,
    "current_node_id": "paid-need",
    "nodes": [
      {
        "id": "paid-need",
        "parent_id": null,
        "sort_order": 0,
        "title": "找到真实付费需求",
        "status": "in_progress",
        "current_fact": "已有技术与学习能力，但尚未形成可重复的付费需求证据。",
        "completion_standard": "找到能接触到的真实客户问题，并获得明确投入或付款信号。",
        "missing_evidence": "具体客户的持续痛点、现有替代成本与真实付费意愿。",
        "next_validation": "完成一次客户访谈、具体报价或小额付费验证。"
      },
      {
        "id": "first-delivery",
        "parent_id": "paid-need",
        "sort_order": 0,
        "title": "完成首次收费与交付",
        "status": "planned",
        "current_fact": "尚未进入本阶段；需要先确认问题和付费意愿。",
        "completion_standard": "完成一次真实收费，并交付对方认可的结果。",
        "missing_evidence": "明确报价、付款记录、交付范围与客户反馈。",
        "next_validation": "用最小可交付服务完成第一笔闭环交易。"
      },
      {
        "id": "repeatable",
        "parent_id": "first-delivery",
        "sort_order": 0,
        "title": "形成重复获客与交付",
        "status": "planned",
        "current_fact": "尚未进入本阶段；一次交易不能证明模式可重复。",
        "completion_standard": "不同客户愿意为相似价值付费，交付过程可以复用。",
        "missing_evidence": "第二次独立获客、复购或转介绍，以及稳定交付成本。",
        "next_validation": "复用同一报价与交付方式，验证第二次真实交易。"
      },
      {
        "id": "predictable-cashflow",
        "parent_id": "repeatable",
        "sort_order": 0,
        "title": "获得可预测现金流",
        "status": "planned",
        "current_fact": "尚未进入本阶段；目前没有连续经营数据。",
        "completion_standard": "能够根据客户管道和交付能力预测下一周期收入。",
        "missing_evidence": "稳定线索来源、成交率、交付产能和实际利润。",
        "next_validation": "连续记录获客、报价、成交、成本与回款。"
      },
      {
        "id": "stable-business",
        "parent_id": "predictable-cashflow",
        "sort_order": 0,
        "title": "稳定约 5 万元/月",
        "status": "planned",
        "current_fact": "这是目标状态，不以单月偶然收入作为完成。",
        "completion_standard": "连续数月达到约 5 万元经营性现金流，并能持续交付价值。",
        "missing_evidence": "连续现金流、健康利润、复购与可持续的个人投入。",
        "next_validation": "在前序模式稳定后，逐步扩大有效获客和交付能力。"
      }
    ],
    "overall_gaps": [
      {"id":"business-result","label":"经营结果","current_state":"尚未记录稳定的自营业务现金流。","target_state":"连续数月形成约 5 万元经营性现金流。","primary_gap":"缺少从真实交易到持续回款的完整证据。","next_evidence":"第一笔真实付款与对应交付结果。","current_value":null,"target_value":null,"unit":null},
      {"id":"demand","label":"需求与机会","current_state":"有过中介尝试，但尚未形成可重复付费模式。","target_state":"同类客户持续认可问题，并出现付费、复购或转介绍。","primary_gap":"真实客户问题、替代成本和付费意愿仍需验证。","next_evidence":"一次具体访谈、报价或付费行为。","current_value":null,"target_value":null,"unit":null},
      {"id":"operation","label":"项目操盘","current_state":"长期写代码形成了技术执行能力，但尚未建立全周期商业证据。","target_state":"能够独立完成获客、报价、交付、收款和复盘。","primary_gap":"技术执行能力还没有转化成全周期经营证据。","next_evidence":"跑通一次范围明确、有人付款的最小交付。","current_value":null,"target_value":null,"unit":null},
      {"id":"relationships","label":"处事与关系","current_state":"较少进行互动前判断、互动后复盘和人物模型校准。","target_state":"能够基于事实、反证和边界选择合适的相处方式。","primary_gap":"缺少持续记录“判断—行动—反应—修正”的真实样本。","next_evidence":"完成一次重要互动的事前判断与事后校准。","current_value":null,"target_value":null,"unit":null},
      {"id":"runway","label":"现实余量","current_state":"博士任务与现实经济压力并存。","target_state":"形成低成本、短周期且不破坏博士主线与生存安全的验证节奏。","primary_gap":"时间和经济压力要求每次尝试都有明确上限。","next_evidence":"为当前实验设定时间、资金和停止条件。","current_value":null,"target_value":null,"unit":null}
    ],
    "stage_gaps": {
      "paid-need": [
        {"id":"paid-need-interviews","goal_node_id":"paid-need","label":"客户访谈","current_state":"尚未记录完成的真实客户访谈。","target_state":"完成 5 次围绕同一问题的真实客户访谈。","primary_gap":"还缺少 5 次来自潜在客户的一手问题证据。","next_evidence":"完成并记录第 1 次客户访谈。","current_value":0,"target_value":5,"unit":"次"},
        {"id":"paid-need-quotes","goal_node_id":"paid-need","label":"具体报价","current_state":"尚未记录向真实客户提出的具体报价。","target_state":"向 3 位潜在客户提出范围和价格明确的报价。","primary_gap":"还缺少 3 次对真实价格接受度的验证。","next_evidence":"提出并记录第 1 次具体报价及对方反应。","current_value":0,"target_value":3,"unit":"次"},
        {"id":"paid-need-payments","goal_node_id":"paid-need","label":"真实付款","current_state":"尚未记录由当前需求产生的真实付款。","target_state":"获得至少 1 笔真实客户付款。","primary_gap":"还缺少 1 笔能证明付费意愿的交易。","next_evidence":"完成一次小额付费验证并保留付款与交付记录。","current_value":0,"target_value":1,"unit":"笔"}
      ]
    },
    "daily_guidance": null
  }
  $planning_state$::jsonb;

DO $planning_state_check$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'relationship_compasses_planning_state_object_check'
      AND conrelid = 'relationship_compasses'::regclass
  ) THEN
    ALTER TABLE relationship_compasses
      ADD CONSTRAINT relationship_compasses_planning_state_object_check
      CHECK (jsonb_typeof(planning_state) = 'object');
  END IF;
END
$planning_state_check$;
