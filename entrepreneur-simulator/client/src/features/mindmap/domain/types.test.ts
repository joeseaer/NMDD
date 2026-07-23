import { describe, expect, expectTypeOf, it } from 'vitest';

import type {
  BoundaryId,
  Id,
  RelationshipTargetRef,
  ResolvedBranchLayoutSpec,
  SheetId,
  TopicId,
  TopicLink,
  TopicPlacement,
} from './types';

const asId = <K extends string>(value: string): Id<K> => value as Id<K>;

describe('canonical domain types', () => {
  it('keeps entity IDs branded by entity kind', () => {
    expectTypeOf<TopicId>().not.toEqualTypeOf<SheetId>();
    expectTypeOf<BoundaryId>().not.toEqualTypeOf<TopicId>();

    const topicId = asId<'Topic'>('018f0000-0000-7000-8000-000000000001');
    expect(topicId).toBe('018f0000-0000-7000-8000-000000000001');
  });

  it('narrows TopicLink by its canonical discriminator', () => {
    const topicId = asId<'Topic'>('018f0000-0000-7000-8000-000000000001');
    const sheetId = asId<'Sheet'>('018f0000-0000-7000-8000-000000000002');
    const linkId = asId<'Link'>('018f0000-0000-7000-8000-000000000003');
    const link: TopicLink = {
      id: linkId,
      topicId,
      orderKey: 'a0',
      status: 'active',
      kind: 'topic',
      targetSheetId: sheetId,
      targetTopicId: topicId,
    };

    if (link.kind !== 'topic') throw new Error('expected a topic link');
    expectTypeOf(link.targetTopicId).toEqualTypeOf<TopicId>();
    expect(link.targetSheetId).toBe(sheetId);
  });

  it('narrows placement and relationship target unions', () => {
    const placement: TopicPlacement = { mode: 'offset', dx: 12, dy: -4 };
    if (placement.mode !== 'offset') throw new Error('expected an offset');
    expect(placement.dx + placement.dy).toBe(8);

    const target: RelationshipTargetRef = {
      kind: 'boundary',
      boundaryId: asId<'Boundary'>('018f0000-0000-7000-8000-000000000004'),
    };
    if (target.kind !== 'boundary') throw new Error('expected a boundary');
    expectTypeOf(target.boundaryId).toEqualTypeOf<BoundaryId>();
  });

  it('does not allow inherit in resolved layout fields', () => {
    expectTypeOf<ResolvedBranchLayoutSpec['direction']>().not.toEqualTypeOf<'inherit'>();
    expectTypeOf<ResolvedBranchLayoutSpec['structure']>().not.toEqualTypeOf<'inherit'>();

    const layout: ResolvedBranchLayoutSpec = {
      structure: 'core:mind-map',
      direction: 'both',
      mode: 'auto',
    };
    expect(layout).toEqual({
      structure: 'core:mind-map',
      direction: 'both',
      mode: 'auto',
    });
  });
});
