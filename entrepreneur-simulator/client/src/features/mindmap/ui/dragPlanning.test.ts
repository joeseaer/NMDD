import { describe, expect, it } from 'vitest';

import { executeMindMapCommand } from '../commands';
import { getChildEdgesSorted } from '../domain/tree';
import type { TopicId } from '../domain/types';
import { createMindMapV1SmallFixture } from '../testing';
import { richTextToPlainText } from './projection';
import {
  createAsciiOrderKeyBetween,
  detectTopicDropIntent,
  planReorderTopicCommand,
  planReparentTopicCommand,
  type TopicRect,
} from './dragPlanning';

const fixture = () => {
  const document = createMindMapV1SmallFixture();
  const sheet = Object.values(document.sheets)[0];
  const byTitle = Object.fromEntries(Object.values(sheet.topics)
    .map((topic) => [richTextToPlainText(topic.title), topic.id])) as Record<string, TopicId>;
  return { document, sheet, byTitle };
};

describe('mind map drag planning', () => {
  it('creates order keys between legacy ASCII neighbors', () => {
    expect(createAsciiOrderKeyBetween('c000000', 'c000001')).toBe('c000000~');
    expect(createAsciiOrderKeyBetween(undefined, 'c000000') < 'c000000').toBe(true);
    expect(createAsciiOrderKeyBetween('c000001', undefined)).toBe('c000001~');
    expect(() => createAsciiOrderKeyBetween('a', 'a-')).toThrow(/rebalance/);
  });

  it('detects a safe reparent drop and rejects descendants as parents', () => {
    const { sheet, byTitle } = fixture();
    const rect = (id: TopicId, x: number, y: number): TopicRect =>
      ({ id, x, y, width: 100, height: 40 });
    const topics = [
      rect(byTitle['主主题 1'], 0, 0),
      rect(byTitle['分支 1.1'], 200, 0),
      rect(byTitle['主主题 2'], 0, 100),
    ];
    expect(detectTopicDropIntent({
      sheet,
      topicId: byTitle['分支 1.1'],
      dragged: rect(byTitle['分支 1.1'], 0, 100),
      topics,
    })).toEqual({ kind: 'reparent', parentTopicId: byTitle['主主题 2'] });
    expect(detectTopicDropIntent({
      sheet,
      topicId: byTitle['主主题 1'],
      dragged: rect(byTitle['主主题 1'], 200, 0),
      topics,
    }).kind).not.toBe('reparent');
  });

  it('plans valid reparent and reorder commands through the command engine', () => {
    const { document, sheet, byTitle } = fixture();
    const reparent = planReparentTopicCommand({
      document,
      sheetId: sheet.id,
      topicId: byTitle['分支 1.1'],
      parentTopicId: byTitle['主主题 2'],
    });
    const reparented = executeMindMapCommand(document, reparent).document;
    expect(getChildEdgesSorted(reparented.sheets[sheet.id], byTitle['主主题 2'])
      .map((edge) => edge.childTopicId)).toContain(byTitle['分支 1.1']);

    const reorder = planReorderTopicCommand({
      document: reparented,
      sheetId: sheet.id,
      topicId: byTitle['主主题 3'],
      index: 0,
    });
    const reordered = executeMindMapCommand(reparented, reorder).document;
    expect(getChildEdgesSorted(reordered.sheets[sheet.id], sheet.rootTopicId)[0].childTopicId)
      .toBe(byTitle['主主题 3']);

    const moveToRoot = planReparentTopicCommand({
      document,
      sheetId: sheet.id,
      topicId: byTitle['分支 1.1'],
      parentTopicId: sheet.rootTopicId,
    });
    const movedToRoot = executeMindMapCommand(document, moveToRoot).document;
    const rootEdge = getChildEdgesSorted(movedToRoot.sheets[sheet.id], sheet.rootTopicId)
      .find((edge) => edge.childTopicId === byTitle['分支 1.1']);
    expect(rootEdge?.side).not.toBe('inherit');
  });
});
