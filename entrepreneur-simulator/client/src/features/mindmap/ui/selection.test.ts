import { describe, expect, it } from 'vitest';

import { createMindMapV1SmallFixture } from '../testing';
import type { ElementRef, TopicId } from '../domain/types';
import {
  findDirectionalTopic,
  normalizeElementSelection,
  normalizeTopLevelTopicSelection,
  selectElement,
} from './selection';
import { richTextToPlainText } from './projection';

const getFixture = () => {
  const document = createMindMapV1SmallFixture();
  const sheet = Object.values(document.sheets)[0];
  const byTitle = Object.fromEntries(
    Object.values(sheet.topics).map((topic) => [
      richTextToPlainText(topic.title),
      topic.id,
    ]),
  ) as Record<string, TopicId>;
  return { sheet, byTitle };
};

describe('mind map selection helpers', () => {
  it('deduplicates and toggles element selections without changing order', () => {
    const { sheet, byTitle } = getFixture();
    const one = { kind: 'topic', id: byTitle['主主题 1'] } as const;
    const two = { kind: 'topic', id: byTitle['主主题 2'] } as const;
    expect(normalizeElementSelection([one, one, two])).toEqual([one, two]);
    expect(selectElement(sheet, [one], two, { toggle: true })).toEqual([one, two]);
    expect(selectElement(sheet, [one, two], one, { toggle: true })).toEqual([two]);
    expect(selectElement(sheet, [one, two], one)).toEqual([one]);
  });

  it('selects a contiguous sibling range and falls back to a single target', () => {
    const { sheet, byTitle } = getFixture();
    const first = { kind: 'topic', id: byTitle['主主题 1'] } as const;
    const third = { kind: 'topic', id: byTitle['主主题 3'] } as const;
    const branch = { kind: 'topic', id: byTitle['分支 1.1'] } as const;
    expect(selectElement(sheet, [first], third, { range: true }).map((item) => item.id))
      .toEqual([byTitle['主主题 1'], byTitle['主主题 2'], byTitle['主主题 3']]);
    expect(selectElement(sheet, [first], branch, { range: true })).toEqual([branch]);
  });

  it('normalizes a branch selection to highest selected ancestors', () => {
    const { sheet, byTitle } = getFixture();
    const selection: ElementRef[] = [
      { kind: 'topic', id: byTitle['分支 1.1'] },
      { kind: 'topic', id: byTitle['主主题 1'] },
      { kind: 'topic', id: byTitle['分支 1.2'] },
      { kind: 'topic', id: byTitle['主主题 2'] },
    ];
    expect(normalizeTopLevelTopicSelection(sheet, selection)).toEqual([
      byTitle['主主题 1'],
      byTitle['主主题 2'],
    ]);
  });

  it('uses geometry for deterministic arrow-key navigation', () => {
    const current = '01890f1a-0000-7000-8000-000000000001' as TopicId;
    const rightNear = '01890f1a-0000-7000-8000-000000000002' as TopicId;
    const rightFar = '01890f1a-0000-7000-8000-000000000003' as TopicId;
    const down = '01890f1a-0000-7000-8000-000000000004' as TopicId;
    const topics = [
      { id: current, x: 0, y: 0, width: 100, height: 40 },
      { id: rightNear, x: 150, y: 10, width: 100, height: 40 },
      { id: rightFar, x: 260, y: 0, width: 100, height: 40 },
      { id: down, x: 5, y: 130, width: 100, height: 40 },
    ];
    expect(findDirectionalTopic(topics, current, 'right')).toBe(rightNear);
    expect(findDirectionalTopic(topics, current, 'down')).toBe(down);
    expect(findDirectionalTopic(topics, current, 'left')).toBeUndefined();
  });
});
