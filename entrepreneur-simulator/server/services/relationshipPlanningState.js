const PLANNING_STATE_SCHEMA_VERSION = 1;
const MAX_SERIALIZED_BYTES = 512 * 1024;
const MAX_NODES = 1000;
const MAX_GAPS = 1000;
const MAX_TREE_DEPTH = 64;

const GOAL_STATUSES = new Set(['planned', 'in_progress', 'completed', 'paused']);

class PlanningStateValidationError extends Error {
  constructor(message, details = undefined) {
    super(message);
    this.name = 'PlanningStateValidationError';
    this.code = 'VALIDATION_ERROR';
    this.details = details;
  }
}

function validationError(message, field, extra = undefined) {
  throw new PlanningStateValidationError(message, {
    field,
    ...(extra || {}),
  });
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneDefaultPlanningState() {
  return {
    schema_version: PLANNING_STATE_SCHEMA_VERSION,
    current_node_id: 'paid-need',
    nodes: [
      {
        id: 'paid-need',
        parent_id: null,
        sort_order: 0,
        title: '找到真实付费需求',
        status: 'in_progress',
        current_fact: '已有技术与学习能力，但尚未形成可重复的付费需求证据。',
        completion_standard: '找到能接触到的真实客户问题，并获得明确投入或付款信号。',
        missing_evidence: '具体客户的持续痛点、现有替代成本与真实付费意愿。',
        next_validation: '完成一次客户访谈、具体报价或小额付费验证。',
      },
      {
        id: 'first-delivery',
        parent_id: 'paid-need',
        sort_order: 0,
        title: '完成首次收费与交付',
        status: 'planned',
        current_fact: '尚未进入本阶段；需要先确认问题和付费意愿。',
        completion_standard: '完成一次真实收费，并交付对方认可的结果。',
        missing_evidence: '明确报价、付款记录、交付范围与客户反馈。',
        next_validation: '用最小可交付服务完成第一笔闭环交易。',
      },
      {
        id: 'repeatable',
        parent_id: 'first-delivery',
        sort_order: 0,
        title: '形成重复获客与交付',
        status: 'planned',
        current_fact: '尚未进入本阶段；一次交易不能证明模式可重复。',
        completion_standard: '不同客户愿意为相似价值付费，交付过程可以复用。',
        missing_evidence: '第二次独立获客、复购或转介绍，以及稳定交付成本。',
        next_validation: '复用同一报价与交付方式，验证第二次真实交易。',
      },
      {
        id: 'predictable-cashflow',
        parent_id: 'repeatable',
        sort_order: 0,
        title: '获得可预测现金流',
        status: 'planned',
        current_fact: '尚未进入本阶段；目前没有连续经营数据。',
        completion_standard: '能够根据客户管道和交付能力预测下一周期收入。',
        missing_evidence: '稳定线索来源、成交率、交付产能和实际利润。',
        next_validation: '连续记录获客、报价、成交、成本与回款。',
      },
      {
        id: 'stable-business',
        parent_id: 'predictable-cashflow',
        sort_order: 0,
        title: '稳定约 5 万元/月',
        status: 'planned',
        current_fact: '这是目标状态，不以单月偶然收入作为完成。',
        completion_standard: '连续数月达到约 5 万元经营性现金流，并能持续交付价值。',
        missing_evidence: '连续现金流、健康利润、复购与可持续的个人投入。',
        next_validation: '在前序模式稳定后，逐步扩大有效获客和交付能力。',
      },
    ],
    overall_gaps: [
      {
        id: 'business-result',
        label: '经营结果',
        current_state: '尚未记录稳定的自营业务现金流。',
        target_state: '连续数月形成约 5 万元经营性现金流。',
        primary_gap: '缺少从真实交易到持续回款的完整证据。',
        next_evidence: '第一笔真实付款与对应交付结果。',
        current_value: null,
        target_value: null,
        unit: null,
      },
      {
        id: 'demand',
        label: '需求与机会',
        current_state: '有过中介尝试，但尚未形成可重复付费模式。',
        target_state: '同类客户持续认可问题，并出现付费、复购或转介绍。',
        primary_gap: '真实客户问题、替代成本和付费意愿仍需验证。',
        next_evidence: '一次具体访谈、报价或付费行为。',
        current_value: null,
        target_value: null,
        unit: null,
      },
      {
        id: 'operation',
        label: '项目操盘',
        current_state: '长期写代码形成了技术执行能力，但尚未建立全周期商业证据。',
        target_state: '能够独立完成获客、报价、交付、收款和复盘。',
        primary_gap: '技术执行能力还没有转化成全周期经营证据。',
        next_evidence: '跑通一次范围明确、有人付款的最小交付。',
        current_value: null,
        target_value: null,
        unit: null,
      },
      {
        id: 'relationships',
        label: '处事与关系',
        current_state: '较少进行互动前判断、互动后复盘和人物模型校准。',
        target_state: '能够基于事实、反证和边界选择合适的相处方式。',
        primary_gap: '缺少持续记录“判断—行动—反应—修正”的真实样本。',
        next_evidence: '完成一次重要互动的事前判断与事后校准。',
        current_value: null,
        target_value: null,
        unit: null,
      },
      {
        id: 'runway',
        label: '现实余量',
        current_state: '博士任务与现实经济压力并存。',
        target_state: '形成低成本、短周期且不破坏博士主线与生存安全的验证节奏。',
        primary_gap: '时间和经济压力要求每次尝试都有明确上限。',
        next_evidence: '为当前实验设定时间、资金和停止条件。',
        current_value: null,
        target_value: null,
        unit: null,
      },
    ],
    stage_gaps: {
      'paid-need': [
        {
          id: 'paid-need-interviews',
          goal_node_id: 'paid-need',
          label: '客户访谈',
          current_state: '尚未记录完成的真实客户访谈。',
          target_state: '完成 5 次围绕同一问题的真实客户访谈。',
          primary_gap: '还缺少 5 次来自潜在客户的一手问题证据。',
          next_evidence: '完成并记录第 1 次客户访谈。',
          current_value: 0,
          target_value: 5,
          unit: '次',
        },
        {
          id: 'paid-need-quotes',
          goal_node_id: 'paid-need',
          label: '具体报价',
          current_state: '尚未记录向真实客户提出的具体报价。',
          target_state: '向 3 位潜在客户提出范围和价格明确的报价。',
          primary_gap: '还缺少 3 次对真实价格接受度的验证。',
          next_evidence: '提出并记录第 1 次具体报价及对方反应。',
          current_value: 0,
          target_value: 3,
          unit: '次',
        },
        {
          id: 'paid-need-payments',
          goal_node_id: 'paid-need',
          label: '真实付款',
          current_state: '尚未记录由当前需求产生的真实付款。',
          target_state: '获得至少 1 笔真实客户付款。',
          primary_gap: '还缺少 1 笔能证明付费意愿的交易。',
          next_evidence: '完成一次小额付费验证并保留付款与交付记录。',
          current_value: 0,
          target_value: 1,
          unit: '笔',
        },
      ],
    },
    daily_guidance: null,
  };
}

function readAlias(object, snakeName, camelName) {
  if (Object.prototype.hasOwnProperty.call(object, snakeName)) return object[snakeName];
  if (camelName && Object.prototype.hasOwnProperty.call(object, camelName)) return object[camelName];
  return undefined;
}

function text(value, field, options = {}) {
  const { required = false, maxLength = 10000, nullable = false } = options;
  if (value === undefined || value === null) {
    if (required) validationError(`${field} is required.`, field);
    return nullable ? null : '';
  }
  if (typeof value !== 'string') validationError(`${field} must be a string.`, field);
  const normalized = value.trim();
  if (required && !normalized) validationError(`${field} is required.`, field);
  if (normalized.length > maxLength) {
    validationError(`${field} is too long.`, field, { maxLength });
  }
  return normalized || (nullable ? null : '');
}

function idText(value, field, options = {}) {
  const normalized = text(value, field, {
    required: options.required !== false,
    nullable: Boolean(options.nullable),
    maxLength: 128,
  });
  if (normalized === null) return null;
  if (normalized && !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(normalized)) {
    validationError(`${field} contains unsupported characters.`, field);
  }
  return normalized;
}

function finiteNumber(value, field, options = {}) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    validationError(`${field} must be a finite number.`, field);
  }
  if (Math.abs(value) > (options.maxAbsolute || 1e15)) {
    validationError(`${field} is outside the supported range.`, field);
  }
  return value;
}

function integer(value, field, fallback) {
  if (value === undefined || value === null) return fallback;
  if (!Number.isSafeInteger(value)) validationError(`${field} must be an integer.`, field);
  return value;
}

function normalizeNode(value, index) {
  const field = `planningState.nodes[${index}]`;
  if (!isObject(value)) validationError(`${field} must be an object.`, field);
  const rawStatus = readAlias(value, 'status') ?? 'planned';
  if (!GOAL_STATUSES.has(rawStatus)) {
    validationError(`${field}.status is invalid.`, `${field}.status`, {
      allowed: Array.from(GOAL_STATUSES),
    });
  }
  return {
    id: idText(value.id, `${field}.id`),
    parent_id: idText(readAlias(value, 'parent_id', 'parentId'), `${field}.parent_id`, {
      required: false,
      nullable: true,
    }),
    sort_order: integer(readAlias(value, 'sort_order', 'sortOrder'), `${field}.sort_order`, index),
    title: text(value.title, `${field}.title`, { required: true, maxLength: 300 }),
    status: rawStatus,
    current_fact: text(readAlias(value, 'current_fact', 'currentFact'), `${field}.current_fact`, { maxLength: 10000 }),
    completion_standard: text(
      readAlias(value, 'completion_standard', 'completionStandard'),
      `${field}.completion_standard`,
      { maxLength: 10000 }
    ),
    missing_evidence: text(
      readAlias(value, 'missing_evidence', 'missingEvidence'),
      `${field}.missing_evidence`,
      { maxLength: 10000 }
    ),
    next_validation: text(
      readAlias(value, 'next_validation', 'nextValidation'),
      `${field}.next_validation`,
      { maxLength: 10000 }
    ),
  };
}

function normalizeGap(value, field, options = {}) {
  if (!isObject(value)) validationError(`${field} must be an object.`, field);
  const normalized = {
    id: idText(value.id, `${field}.id`),
    label: text(value.label, `${field}.label`, { required: true, maxLength: 200 }),
    current_state: text(readAlias(value, 'current_state', 'currentState'), `${field}.current_state`, { maxLength: 10000 }),
    target_state: text(readAlias(value, 'target_state', 'targetState'), `${field}.target_state`, { maxLength: 10000 }),
    primary_gap: text(readAlias(value, 'primary_gap', 'primaryGap'), `${field}.primary_gap`, { maxLength: 10000 }),
    next_evidence: text(readAlias(value, 'next_evidence', 'nextEvidence'), `${field}.next_evidence`, { maxLength: 10000 }),
    current_value: finiteNumber(readAlias(value, 'current_value', 'currentValue'), `${field}.current_value`),
    target_value: finiteNumber(readAlias(value, 'target_value', 'targetValue'), `${field}.target_value`),
    unit: text(value.unit, `${field}.unit`, { nullable: true, maxLength: 80 }),
  };
  if (options.goalNodeId) normalized.goal_node_id = options.goalNodeId;
  return normalized;
}

function normalizeSource(value, index, collectionName = 'sources') {
  const field = `planningState.daily_guidance.${collectionName}[${index}]`;
  if (!isObject(value)) validationError(`${field} must be an object.`, field);
  const normalized = {
    domain: text(value.domain ?? value.type, `${field}.domain`, { required: true, maxLength: 80 }),
    id: text(value.id, `${field}.id`, { maxLength: 200 }),
    label: text(value.label, `${field}.label`, { required: true, maxLength: 300 }),
  };
  const count = finiteNumber(value.count, `${field}.count`, { maxAbsolute: 1e9 });
  if (count !== null) {
    if (!Number.isSafeInteger(count) || count < 0) validationError(`${field}.count must be a non-negative integer.`, `${field}.count`);
    normalized.count = count;
  }
  if (value.status !== undefined && value.status !== null && value.status !== '') {
    if (!['included', 'unavailable', 'empty', 'truncated'].includes(value.status)) {
      validationError(`${field}.status is invalid.`, `${field}.status`);
    }
    normalized.status = value.status;
  }
  const lastUpdatedAt = readAlias(value, 'last_updated_at', 'lastUpdatedAt');
  if (lastUpdatedAt) {
    const parsed = new Date(lastUpdatedAt);
    if (Number.isNaN(parsed.getTime())) validationError(`${field}.last_updated_at is invalid.`, `${field}.last_updated_at`);
    normalized.last_updated_at = parsed.toISOString();
  }
  return normalized;
}

function normalizeDailyGuidance(value) {
  if (value === undefined || value === null) return null;
  const field = 'planningState.daily_guidance';
  if (!isObject(value)) validationError(`${field} must be an object or null.`, field);
  const generatedAt = readAlias(value, 'generated_at', 'generatedAt');
  let normalizedGeneratedAt = null;
  if (generatedAt !== undefined && generatedAt !== null && generatedAt !== '') {
    const parsed = new Date(generatedAt);
    if (Number.isNaN(parsed.getTime())) validationError(`${field}.generated_at is invalid.`, `${field}.generated_at`);
    normalizedGeneratedAt = parsed.toISOString();
  }
  const sources = value.sources === undefined ? [] : value.sources;
  if (!Array.isArray(sources)) validationError(`${field}.sources must be an array.`, `${field}.sources`);
  if (sources.length > 100) validationError(`${field}.sources has too many entries.`, `${field}.sources`, { maxItems: 100 });
  const dataSources = readAlias(value, 'data_sources', 'dataSources') ?? [];
  if (!Array.isArray(dataSources)) validationError(`${field}.data_sources must be an array.`, `${field}.data_sources`);
  if (dataSources.length > 20) validationError(`${field}.data_sources has too many entries.`, `${field}.data_sources`, { maxItems: 20 });
  const snapshotHash = text(readAlias(value, 'snapshot_hash', 'snapshotHash'), `${field}.snapshot_hash`, {
    nullable: true,
    maxLength: 64,
  });
  if (snapshotHash && !/^[a-f0-9]{64}$/i.test(snapshotHash)) {
    validationError(`${field}.snapshot_hash is invalid.`, `${field}.snapshot_hash`);
  }
  const basedOnCompassVersionRaw = readAlias(value, 'based_on_compass_version', 'basedOnCompassVersion');
  const basedOnCompassVersion = basedOnCompassVersionRaw === undefined || basedOnCompassVersionRaw === null
    ? null
    : integer(basedOnCompassVersionRaw, `${field}.based_on_compass_version`);
  if (basedOnCompassVersion !== null && basedOnCompassVersion < 0) {
    validationError(`${field}.based_on_compass_version cannot be negative.`, `${field}.based_on_compass_version`);
  }
  return {
    focus: text(value.focus, `${field}.focus`, { required: true, maxLength: 3000 }),
    why: text(value.why, `${field}.why`, { required: true, maxLength: 5000 }),
    avoid: text(value.avoid, `${field}.avoid`, { required: true, maxLength: 5000 }),
    observe: text(value.observe, `${field}.observe`, { required: true, maxLength: 5000 }),
    generated_at: normalizedGeneratedAt,
    sources: sources.map((source, index) => normalizeSource(source, index, 'sources')),
    data_sources: dataSources.map((source, index) => normalizeSource(source, index, 'data_sources')),
    snapshot_hash: snapshotHash,
    based_on_compass_version: basedOnCompassVersion,
    fallback: Boolean(value.fallback),
    warning: text(value.warning, `${field}.warning`, { nullable: true, maxLength: 1000 }),
  };
}

function assertTree(nodes, nodeById) {
  for (const node of nodes) {
    if (node.parent_id === node.id) {
      validationError('A goal node cannot be its own parent.', `planningState.nodes.${node.id}.parent_id`);
    }
    if (node.parent_id && !nodeById.has(node.parent_id)) {
      validationError('A goal node references a missing parent.', `planningState.nodes.${node.id}.parent_id`, {
        parentId: node.parent_id,
      });
    }
  }

  const visitState = new Map();
  const visit = (node, depth) => {
    if (depth > MAX_TREE_DEPTH) {
      validationError('The goal tree is too deep.', `planningState.nodes.${node.id}`, { maxDepth: MAX_TREE_DEPTH });
    }
    const state = visitState.get(node.id);
    if (state === 'visiting') {
      validationError('The goal tree contains a cycle.', `planningState.nodes.${node.id}.parent_id`);
    }
    if (state === 'visited') return;
    visitState.set(node.id, 'visiting');
    if (node.parent_id) visit(nodeById.get(node.parent_id), depth + 1);
    visitState.set(node.id, 'visited');
  };
  nodes.forEach((node) => visit(node, 1));
}

function normalizePlanningState(value) {
  if (value === undefined || value === null) return cloneDefaultPlanningState();
  if (!isObject(value)) {
    validationError('planningState must be an object.', 'planningState');
  }

  let inputBytes;
  try {
    inputBytes = Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    validationError('planningState must be JSON serializable.', 'planningState');
  }
  if (inputBytes > MAX_SERIALIZED_BYTES) {
    validationError('planningState is too large.', 'planningState', { maxBytes: MAX_SERIALIZED_BYTES });
  }

  const rawSchemaVersion = readAlias(value, 'schema_version', 'schemaVersion') ?? PLANNING_STATE_SCHEMA_VERSION;
  if (rawSchemaVersion !== PLANNING_STATE_SCHEMA_VERSION) {
    validationError('planningState schema version is unsupported.', 'planningState.schema_version', {
      supportedVersion: PLANNING_STATE_SCHEMA_VERSION,
    });
  }

  const rawNodes = value.nodes === undefined ? [] : value.nodes;
  if (!Array.isArray(rawNodes)) validationError('planningState.nodes must be an array.', 'planningState.nodes');
  if (rawNodes.length > MAX_NODES) {
    validationError('planningState has too many nodes.', 'planningState.nodes', { maxItems: MAX_NODES });
  }
  const nodes = rawNodes.map(normalizeNode);
  const nodeById = new Map();
  for (const node of nodes) {
    if (nodeById.has(node.id)) validationError('Goal node IDs must be unique.', `planningState.nodes.${node.id}.id`);
    nodeById.set(node.id, node);
  }
  assertTree(nodes, nodeById);

  const currentNodeId = idText(
    readAlias(value, 'current_node_id', 'currentNodeId'),
    'planningState.current_node_id',
    { required: false, nullable: true }
  );
  if (currentNodeId && !nodeById.has(currentNodeId)) {
    validationError('planningState.current_node_id references a missing node.', 'planningState.current_node_id');
  }

  const rawOverallGaps = readAlias(value, 'overall_gaps', 'overallGaps') ?? [];
  if (!Array.isArray(rawOverallGaps)) validationError('planningState.overall_gaps must be an array.', 'planningState.overall_gaps');
  if (rawOverallGaps.length > MAX_GAPS) {
    validationError('planningState.overall_gaps has too many entries.', 'planningState.overall_gaps', { maxItems: MAX_GAPS });
  }
  const overallGaps = rawOverallGaps.map((gap, index) => normalizeGap(gap, `planningState.overall_gaps[${index}]`));

  const rawStageGaps = readAlias(value, 'stage_gaps', 'stageGaps') ?? {};
  if (!isObject(rawStageGaps)) validationError('planningState.stage_gaps must be an object.', 'planningState.stage_gaps');
  const stageGaps = {};
  let stageGapCount = 0;
  for (const [nodeId, gaps] of Object.entries(rawStageGaps)) {
    const normalizedNodeId = idText(nodeId, `planningState.stage_gaps.${nodeId}`);
    if (!nodeById.has(normalizedNodeId)) {
      validationError('planningState.stage_gaps references a missing node.', `planningState.stage_gaps.${nodeId}`);
    }
    if (!Array.isArray(gaps)) validationError('Stage gaps must be arrays.', `planningState.stage_gaps.${nodeId}`);
    stageGapCount += gaps.length;
    if (stageGapCount > MAX_GAPS) {
      validationError('planningState.stage_gaps has too many entries.', 'planningState.stage_gaps', { maxItems: MAX_GAPS });
    }
    stageGaps[normalizedNodeId] = gaps.map((gap, index) => normalizeGap(
      gap,
      `planningState.stage_gaps.${nodeId}[${index}]`,
      { goalNodeId: normalizedNodeId }
    ));
  }

  const gapIds = new Set();
  for (const gap of [...overallGaps, ...Object.values(stageGaps).flat()]) {
    if (gapIds.has(gap.id)) validationError('Gap IDs must be unique.', `planningState.gaps.${gap.id}.id`);
    gapIds.add(gap.id);
  }

  return {
    schema_version: PLANNING_STATE_SCHEMA_VERSION,
    current_node_id: currentNodeId,
    nodes,
    overall_gaps: overallGaps,
    stage_gaps: stageGaps,
    daily_guidance: normalizeDailyGuidance(readAlias(value, 'daily_guidance', 'dailyGuidance')),
  };
}

module.exports = {
  GOAL_STATUSES,
  MAX_GAPS,
  MAX_NODES,
  MAX_SERIALIZED_BYTES,
  MAX_TREE_DEPTH,
  PLANNING_STATE_SCHEMA_VERSION,
  PlanningStateValidationError,
  cloneDefaultPlanningState,
  normalizePlanningState,
};
