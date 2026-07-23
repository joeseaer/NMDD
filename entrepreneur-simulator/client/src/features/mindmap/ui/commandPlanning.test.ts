import { describe, expect, it } from 'vitest';

import { createNewMindMapDocument, createRichText } from '../domain/defaults';
import { createOrderKeyBetween } from '../domain/orderKey';
import type {
  CommandId,
  DocumentId,
  SheetId,
  ThemeId,
  TopicId,
  TreeEdgeId,
} from '../domain/types';
import {
  createAvailableOrderKey,
  createAvailableOrderKeyBetween,
  planCreateTopicCommand,
  planUpdateTopicTitleCommand,
} from './commandPlanning';

const IDS = {
  document: 'planning-document' as DocumentId,
  sheet: 'planning-sheet' as SheetId,
  theme: 'planning-theme' as ThemeId,
  root: 'planning-root' as TopicId,
  child: '01900000-0000-7000-8000-000000000001' as TopicId,
  edge: '01900000-0000-7000-8000-000000000002' as TreeEdgeId,
  command: '01900000-0000-7000-8000-000000000003' as CommandId,
};

describe('MindMap V2 command planning', () => {
  it('appends after migrated ASCII keys instead of putting K keys first', () => {
    const key = createAvailableOrderKey(['a000000', 'a999999']);
    expect(key).toBe('a999999~');
    expect(key > 'a999999').toBe(true);
    expect(key.length).toBeLessThanOrEqual(256);
  });

  it('uses fractional generated order keys when the maximum is generated', () => {
    const first = createOrderKeyBetween();
    const next = createAvailableOrderKey([first]);
    expect(next > first).toBe(true);
  });

  it('creates printable keys between migrated ASCII siblings', () => {
    expect(createAvailableOrderKeyBetween(['a000000', 'a000001'], 'a000000', 'a000001'))
      .toSatisfy((value: string) => value > 'a000000' && value < 'a000001');
  });

  it('plans UUID-owned canonical entities without mutating the document', () => {
    const document = createNewMindMapDocument({
      documentId: IDS.document,
      sheetId: IDS.sheet,
      rootTopicId: IDS.root,
      themeId: IDS.theme,
      sheetOrderKey: 'sheet-a',
      contentRevision: 7,
    });
    const before = JSON.stringify(document);
    const command = planCreateTopicCommand({
      document,
      sheetId: IDS.sheet,
      parentTopicId: IDS.root,
      title: 'Planned child',
      ids: {
        commandId: IDS.command,
        topicId: IDS.child,
        treeEdgeId: IDS.edge,
      },
      timestamp: '2026-07-18T00:00:00.000Z',
    });

    expect(command).toMatchObject({
      commandId: IDS.command,
      baseRevision: 7,
      sheetId: IDS.sheet,
      payload: {
        topic: { id: IDS.child, role: 'regular' },
        edge: {
          id: IDS.edge,
          parentTopicId: IDS.root,
          childTopicId: IDS.child,
          side: 'right',
        },
      },
    });
    expect(JSON.stringify(document)).toBe(before);
  });

  it('plans a same-side sibling directly after the selected topic', () => {
    const document = createNewMindMapDocument({
      documentId: IDS.document,
      sheetId: IDS.sheet,
      rootTopicId: IDS.root,
      themeId: IDS.theme,
      sheetOrderKey: 'sheet-a',
    });
    const sheet = document.sheets[IDS.sheet];
    const secondTopicId = '01900000-0000-7000-8000-000000000011' as TopicId;
    const secondEdgeId = '01900000-0000-7000-8000-000000000012' as TreeEdgeId;
    sheet.topics[IDS.child] = {
      ...sheet.topics[IDS.root],
      id: IDS.child,
      role: 'regular',
    };
    sheet.topics[secondTopicId] = {
      ...sheet.topics[IDS.root],
      id: secondTopicId,
      role: 'regular',
    };
    sheet.treeEdges[IDS.edge] = {
      id: IDS.edge,
      parentTopicId: IDS.root,
      childTopicId: IDS.child,
      orderKey: 'a000000',
      side: 'left',
    };
    sheet.treeEdges[secondEdgeId] = {
      id: secondEdgeId,
      parentTopicId: IDS.root,
      childTopicId: secondTopicId,
      orderKey: 'a000001',
      side: 'right',
    };

    const command = planCreateTopicCommand({
      document,
      sheetId: IDS.sheet,
      parentTopicId: IDS.root,
      insertion: { relativeTopicId: IDS.child, position: 'after' },
      ids: {
        commandId: IDS.command,
        topicId: '01900000-0000-7000-8000-000000000021' as TopicId,
        treeEdgeId: '01900000-0000-7000-8000-000000000022' as TreeEdgeId,
      },
      timestamp: '2026-07-19T00:00:00.000Z',
    });
    expect(command.payload.edge?.orderKey).toSatisfy(
      (value: string) => value > 'a000000' && value < 'a000001',
    );
    expect(command.payload.edge?.side).toBe('left');
  });

  it('retains and snapshots canonical rich-text marks in title commands', () => {
    const document = createNewMindMapDocument({
      documentId: IDS.document,
      sheetId: IDS.sheet,
      rootTopicId: IDS.root,
      themeId: IDS.theme,
      sheetOrderKey: 'sheet-a',
    });
    const title = createRichText('Styled title');
    const paragraph = title.blocks[0];
    if (paragraph?.type !== 'paragraph' || paragraph.children[0]?.type !== 'text') {
      throw new Error('Expected createRichText to create one text paragraph.');
    }
    paragraph.children[0].marks = [
      { type: 'bold' },
      { type: 'color', value: '#2563EB' },
    ];

    const command = planUpdateTopicTitleCommand({
      document,
      sheetId: IDS.sheet,
      topicId: IDS.root,
      title,
      commandId: IDS.command,
      timestamp: '2026-07-19T00:00:00.000Z',
    });

    expect(command.payload.title).toEqual(title);
    expect(command.payload.title).not.toBe(title);
    paragraph.children[0].text = 'Mutated after planning';
    expect(command.payload.title.blocks[0]).toMatchObject({
      children: [{ text: 'Styled title', marks: [{ type: 'bold' }, { type: 'color' }] }],
    });
  });
});
