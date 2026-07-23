import { describe, expect, it } from 'vitest';
import {
  compareOrderedEntities,
  createOrderKeyBetween,
  InvalidOrderKeyError,
  isGeneratedOrderKey,
  rebalanceOrderKeys,
} from './orderKey';

describe('order keys', () => {
  it('creates stable ASCII-sortable keys between neighbors', () => {
    const center = createOrderKeyBetween();
    const before = createOrderKeyBetween(null, center);
    const after = createOrderKeyBetween(center, null);

    expect([after, before, center].sort()).toEqual([before, center, after]);
    expect([before, center, after].every(isGeneratedOrderKey)).toBe(true);
  });

  it('rebalances deterministically while preserving the supplied order', () => {
    const first = rebalanceOrderKeys(['topic-c', 'topic-a', 'topic-b']);
    const second = rebalanceOrderKeys(['topic-c', 'topic-a', 'topic-b']);

    expect(first).toEqual(second);
    expect([first['topic-c'], first['topic-a'], first['topic-b']])
      .toEqual([...Object.values(first)].sort());
  });

  it('uses entity ids as the deterministic collision tie-break', () => {
    const orderKey = createOrderKeyBetween();
    const entities = [
      { id: 'b', orderKey },
      { id: 'a', orderKey },
    ];
    expect(entities.sort(compareOrderedEntities).map((entity) => entity.id))
      .toEqual(['a', 'b']);
  });

  it('rejects keys outside the generated format', () => {
    expect(isGeneratedOrderKey('legacy-a')).toBe(false);
    expect(() => createOrderKeyBetween('legacy-a', null)).toThrow(InvalidOrderKeyError);
  });
});
