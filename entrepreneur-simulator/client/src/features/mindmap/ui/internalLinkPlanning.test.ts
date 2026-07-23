import { describe, expect, it } from 'vitest';

import { executeMindMapCommand } from '../commands/engine';
import { createMindMapSheet } from '../domain/defaults';
import { createEntityId } from '../domain/ids';
import { compareOrderedEntities } from '../domain/orderKey';
import type { LinkId, OrderKey, SheetId, TopicId } from '../domain/types';
import { createMindMapV1SmallFixture } from '../testing/fixtures';
import {
  listInternalLinkTargets,
  planUpsertInternalTopicLinkCommand,
} from './internalLinkPlanning';

const firstSheet = (document: ReturnType<typeof createMindMapV1SmallFixture>) => Object.values(document.sheets)[0]!;

const addSecondSheet = (document: ReturnType<typeof createMindMapV1SmallFixture>) => {
  const first = firstSheet(document);
  const id = createEntityId<'Sheet'>() as SheetId;
  const rootTopicId = createEntityId<'Topic'>() as TopicId;
  const sheet = createMindMapSheet({
    id,
    rootTopicId,
    themeId: first.themeId,
    orderKey: 'z' as OrderKey,
    title: '市场计划',
    rootTitle: '渠道策略',
  });
  document.sheets[id] = sheet;
  return sheet;
};

describe('internal Link planning', () => {
  it('lists Sheets and Topics in Sheet/tree order and supports normalized path search', () => {
    const document = createMindMapV1SmallFixture();
    const first = firstSheet(document);
    const second = addSecondSheet(document);

    const all = listInternalLinkTargets(document);
    expect(all[0]).toMatchObject({ kind: 'sheet', sheetId: first.id, depth: 0 });
    expect(all[1]).toMatchObject({ kind: 'topic', sheetId: first.id, topicId: first.rootTopicId, depth: 0 });
    expect(all.findIndex((candidate) => candidate.key === `sheet:${second.id}`)).toBeGreaterThan(1);

    const searched = listInternalLinkTargets(document, { query: ' 市场  渠道 ' });
    expect(searched).toHaveLength(1);
    expect(searched[0]).toMatchObject({
      kind: 'topic',
      sheetId: second.id,
      topicId: second.rootTopicId,
      path: ['渠道策略'],
    });
  });

  it('creates cross-Sheet Topic and Sheet links with stable order, then applies canonically', () => {
    const document = createMindMapV1SmallFixture();
    const source = firstSheet(document);
    const target = addSecondSheet(document);
    const topicId = source.rootTopicId;
    const timestamp = '2026-07-20T00:00:00.000Z';

    const topicCommand = planUpsertInternalTopicLinkCommand({
      document,
      sheetId: source.id,
      topicId,
      target: { kind: 'topic', targetSheetId: target.id, targetTopicId: target.rootTopicId },
      title: '  跳转到渠道  ',
      timestamp,
    });
    const afterTopic = executeMindMapCommand(document, topicCommand).document;
    const topicLink = Object.values(afterTopic.sheets[source.id].links)[0]!;
    expect(topicLink).toMatchObject({
      kind: 'topic',
      topicId,
      targetSheetId: target.id,
      targetTopicId: target.rootTopicId,
      title: '跳转到渠道',
      status: 'active',
    });

    const sheetCommand = planUpsertInternalTopicLinkCommand({
      document: afterTopic,
      sheetId: source.id,
      topicId,
      target: { kind: 'sheet', targetSheetId: target.id },
      timestamp,
    });
    const afterSheet = executeMindMapCommand(afterTopic, sheetCommand).document;
    const links = Object.values(afterSheet.sheets[source.id].links)
      .sort(compareOrderedEntities);
    expect(links).toHaveLength(2);
    expect(links[1]).toMatchObject({ kind: 'sheet', targetSheetId: target.id, status: 'active' });
    expect(compareOrderedEntities(links[1]!, links[0]!)).toBeGreaterThan(0);
  });

  it('retargets a broken Link in place and preserves its ID and order key', () => {
    const document = createMindMapV1SmallFixture();
    const sheet = firstSheet(document);
    const sourceTopicId = sheet.rootTopicId;
    const targetTopicId = Object.keys(sheet.topics).find((id) => id !== sourceTopicId)! as TopicId;
    const linkId = createEntityId<'Link'>() as LinkId;
    sheet.links[linkId] = {
      id: linkId,
      topicId: sourceTopicId,
      orderKey: 'm' as OrderKey,
      kind: 'topic',
      targetSheetId: sheet.id,
      targetTopicId: createEntityId<'Topic'>() as TopicId,
      status: 'broken',
      title: '旧标题',
    };

    const command = planUpsertInternalTopicLinkCommand({
      document,
      sheetId: sheet.id,
      topicId: sourceTopicId,
      linkId,
      target: { kind: 'topic', targetSheetId: sheet.id, targetTopicId },
      title: '',
      timestamp: '2026-07-20T00:00:00.000Z',
    });
    expect(command.payload.link).toMatchObject({ id: linkId, orderKey: 'm', status: 'active' });
    expect(command.payload.link).not.toHaveProperty('title');
  });

  it('rejects missing targets and foreign-owned Link IDs without producing a command', () => {
    const document = createMindMapV1SmallFixture();
    const sheet = firstSheet(document);
    const [sourceTopicId, otherTopicId] = Object.keys(sheet.topics) as TopicId[];
    const linkId = createEntityId<'Link'>() as LinkId;
    sheet.links[linkId] = {
      id: linkId,
      topicId: otherTopicId!,
      orderKey: 'm' as OrderKey,
      kind: 'sheet',
      targetSheetId: sheet.id,
      status: 'active',
    };

    expect(() => planUpsertInternalTopicLinkCommand({
      document,
      sheetId: sheet.id,
      topicId: sourceTopicId!,
      linkId,
      target: { kind: 'sheet', targetSheetId: sheet.id },
    })).toThrow('不能把链接移动到其他主题');
    expect(() => planUpsertInternalTopicLinkCommand({
      document,
      sheetId: sheet.id,
      topicId: sourceTopicId!,
      target: { kind: 'topic', targetSheetId: sheet.id, targetTopicId: createEntityId<'Topic'>() as TopicId },
    })).toThrow('目标主题不存在');
    expect(() => planUpsertInternalTopicLinkCommand({
      document,
      sheetId: sheet.id,
      topicId: sourceTopicId!,
      target: { kind: 'sheet', targetSheetId: createEntityId<'Sheet'>() as SheetId },
    })).toThrow('目标 Sheet 不存在');
  });
});
