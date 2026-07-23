const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PlanningStateValidationError,
  cloneDefaultPlanningState,
  normalizePlanningState,
} = require('../services/relationshipPlanningState');

function node(id, parentId = null, overrides = {}) {
  return {
    id,
    parent_id: parentId,
    title: id,
    status: 'planned',
    current_fact: '',
    completion_standard: '',
    missing_evidence: '',
    next_validation: '',
    ...overrides,
  };
}

test('default planning state upgrades the former five-stage client route into editable data', () => {
  const state = cloneDefaultPlanningState();
  assert.equal(state.current_node_id, 'paid-need');
  assert.equal(state.nodes.length, 5);
  assert.equal(state.nodes[1].parent_id, 'paid-need');
  assert.equal(state.overall_gaps.length, 5);
  assert.deepEqual(
    state.stage_gaps['paid-need'].map((gap) => [gap.label, gap.current_value, gap.target_value, gap.unit]),
    [['客户访谈', 0, 5, '次'], ['具体报价', 0, 3, '次'], ['真实付款', 0, 1, '笔']]
  );
});

test('normalizes an arbitrary branching tree, editable fields, quantified gaps and source aliases', () => {
  const branchA = node('branch-a', 'root', { status: 'in_progress' });
  delete branchA.current_fact;
  branchA.currentFact = 'A fact';
  const state = normalizePlanningState({
    schemaVersion: 1,
    currentNodeId: 'branch-a',
    nodes: [
      node('root'),
      branchA,
      node('branch-b', 'root'),
    ],
    overallGaps: [{
      id: 'cash', label: '现金流', currentState: '0', targetState: '5万', primaryGap: '5万', nextEvidence: '首单',
      currentValue: 0, targetValue: 50000, unit: '元/月',
    }],
    stageGaps: {
      'branch-a': [{
        id: 'calls', label: '访谈', current_state: '0', target_state: '5', primary_gap: '5', next_evidence: '第1次',
        current_value: 0, target_value: 5, unit: '次',
      }],
    },
    dailyGuidance: {
      focus: '先访谈', why: '缺证据', avoid: '不要开发', observe: '是否愿意付费',
      sources: [{ type: 'goal', id: 'branch-a', label: '支线A' }],
      dataSources: [{ domain: 'goals', label: '目标与差距', count: 3, status: 'truncated' }],
      snapshotHash: 'a'.repeat(64),
      basedOnCompassVersion: 4,
    },
  });
  assert.equal(state.nodes.length, 3);
  assert.equal(state.nodes[1].current_fact, 'A fact');
  assert.equal(state.overall_gaps[0].target_value, 50000);
  assert.equal(state.stage_gaps['branch-a'][0].goal_node_id, 'branch-a');
  assert.deepEqual(state.daily_guidance.sources[0], { domain: 'goal', id: 'branch-a', label: '支线A' });
  assert.deepEqual(state.daily_guidance.data_sources[0], {
    domain: 'goals', id: '', label: '目标与差距', count: 3, status: 'truncated',
  });
  assert.equal(state.daily_guidance.snapshot_hash, 'a'.repeat(64));
  assert.equal(state.daily_guidance.based_on_compass_version, 4);
});

test('an explicitly saved empty tree remains empty', () => {
  const state = normalizePlanningState({ nodes: [], overall_gaps: [], stage_gaps: {}, current_node_id: null });
  assert.equal(state.current_node_id, null);
  assert.deepEqual(state.nodes, []);
});

for (const [name, state] of [
  ['duplicate IDs', { nodes: [node('same'), node('same')] }],
  ['missing parent', { nodes: [node('child', 'missing')] }],
  ['self parent', { nodes: [node('self', 'self')] }],
  ['cycle', { nodes: [node('a', 'b'), node('b', 'a')] }],
  ['missing current node', { current_node_id: 'missing', nodes: [node('root')] }],
  ['invalid status', { nodes: [node('root', null, { status: 'unknown' })] }],
  ['non-finite gap', {
    nodes: [node('root')],
    overall_gaps: [{ id: 'gap', label: 'Gap', current_value: Number.NaN }],
  }],
]) {
  test(`rejects ${name}`, () => {
    assert.throws(() => normalizePlanningState(state), PlanningStateValidationError);
  });
}
