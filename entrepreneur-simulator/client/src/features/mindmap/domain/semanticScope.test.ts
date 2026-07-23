import { describe, expect, it } from 'vitest';

import { createTopic } from './defaults';
import { createEntityId } from './ids';
import type { TopicId, TreeEdgeId } from './types';
import {
  normalizeSemanticScopeSelection,
  planBoundaryScopeNormalizations,
  resolveSemanticEdgeSide,
} from './semanticScope';
import {
  createMindMapElementsFixture,
  createMindMapV1SmallFixture,
} from '../testing/fixtures';

describe('semantic scope normalization', () => {
  it('resolves inherit through structural ancestors instead of the sheet default', () => {
    const document = createMindMapElementsFixture();
    const sheet = Object.values(document.sheets)[0];
    const rootEdge = Object.values(sheet.treeEdges).find(
      (edge) => edge.parentTopicId === sheet.rootTopicId && edge.side === 'right',
    );
    if (!rootEdge) throw new Error('Fixture root branch is missing.');
    const inherited = Object.values(sheet.treeEdges).find(
      (edge) => edge.parentTopicId === rootEdge.childTopicId && edge.side === 'inherit',
    );
    if (!inherited) throw new Error('Fixture inherit edge is missing.');
    rootEdge.side = 'left';
    sheet.defaultBranchLayout.direction = 'left-to-right';
    expect(resolveSemanticEdgeSide(sheet, inherited)).toBe('left');
  });

  it('splits cross-branch and non-contiguous selections deterministically', () => {
    const document = createMindMapV1SmallFixture();
    const sheet = Object.values(document.sheets)[0];
    const rootEdges = Object.values(sheet.treeEdges)
      .filter((edge) => edge.parentTopicId === sheet.rootTopicId)
      .sort((left, right) => left.orderKey.localeCompare(right.orderKey));
    const left = rootEdges.find((edge) => edge.side === 'left');
    const right = rootEdges.filter((edge) => edge.side === 'right');
    if (!left || right.length < 2) throw new Error('Fixture branch groups are incomplete.');
    const addedTopicId = createEntityId<'Topic'>() as TopicId;
    const addedEdgeId = createEntityId<'TreeEdge'>() as TreeEdgeId;
    sheet.topics[addedTopicId] = createTopic({ id: addedTopicId, title: 'Late right branch' });
    sheet.treeEdges[addedEdgeId] = {
      id: addedEdgeId,
      parentTopicId: sheet.rootTopicId,
      childTopicId: addedTopicId,
      orderKey: 'zzzz',
      side: 'right',
    };

    const normalized = normalizeSemanticScopeSelection(sheet, [
      left.childTopicId,
      right[0].childTopicId,
      addedTopicId,
    ]);
    expect(normalized.groups).toHaveLength(3);
    expect(normalized.splitReasons).toEqual(['cross-branch', 'non-contiguous']);
    expect(normalized.groups.map((group) => group.topicIds[0]))
      .toEqual([left.childTopicId, right[0].childTopicId, addedTopicId]);
  });

  it('does not churn an unchanged Boundary and splits it after a resolved-side change', () => {
    const document = createMindMapElementsFixture();
    const before = Object.values(document.sheets)[0];
    const unrelated = structuredClone(before);
    const floating = Object.values(unrelated.topics).find(
      (topic) => topic.role === 'floating-root',
    );
    if (!floating || floating.placement.mode !== 'absolute') {
      throw new Error('Fixture floating Topic is missing.');
    }
    floating.placement.x += 25;
    expect(planBoundaryScopeNormalizations(before, unrelated)).toEqual([]);

    const after = structuredClone(before);
    const boundary = Object.values(after.boundaries)[0];
    if (boundary.scope.kind !== 'sibling-range') throw new Error('Fixture Boundary changed.');
    after.treeEdges[boundary.scope.lastEdgeId].side = 'left';
    const plans = planBoundaryScopeNormalizations(before, after);
    expect(plans).toHaveLength(1);
    expect(plans[0].boundaryId).toBe(boundary.id);
    expect(plans[0].scopes).toHaveLength(2);
    expect(plans[0].scopes.every((scope) => scope.kind === 'sibling-range')).toBe(true);
  });
});
