import { describe, expect, it } from 'vitest';

import { executeMindMapCommand, PatchCommandHistory } from '../commands';
import { getChildEdgesSorted, getParentEdge } from '../domain/tree';
import type { RichText, SheetId, TopicId } from '../domain/types';
import { createMindMapV1SmallFixture } from '../testing';
import { richTextToPlainText } from './projection';
import {
  planOutlinerDropIntent,
  planOutlinerIndentIntent,
  planOutlinerMutationCommand,
  normalizeOutlinerRichTextCommit,
  planOutlinerOutdentIntent,
  planOutlinerSiblingMoveIntent,
} from './outlinerEditing';

const fixture = () => {
  const document = createMindMapV1SmallFixture();
  const sheet = Object.values(document.sheets)[0];
  const byTitle = Object.fromEntries(Object.values(sheet.topics)
    .map((topic) => [richTextToPlainText(topic.title), topic.id])) as Record<string, TopicId>;
  return { document, sheet, byTitle };
};

describe('Outliner edit planning', () => {
  it('removes only ProseMirror synthetic trailing blocks after a canonical list', () => {
    const initial: RichText = {
      type: 'doc',
      version: 1,
      blocks: [
        {
          type: 'paragraph',
          children: [
            { type: 'text', text: '标记', marks: [{ type: 'bold' }] },
            { type: 'hardBreak' },
            { type: 'text', text: '换行' },
          ],
        },
        {
          type: 'bulletList',
          items: [{
            type: 'listItem',
            children: [{
              type: 'paragraph',
              children: [{ type: 'text', text: '列表' }],
            }],
          }],
        },
      ],
    };
    const committed = {
      ...structuredClone(initial),
      blocks: [
        ...structuredClone(initial.blocks),
        { type: 'paragraph' as const, children: [] },
      ],
    };
    expect(normalizeOutlinerRichTextCommit(initial, committed)).toEqual(initial);
    const authoredTrailing = structuredClone(committed);
    authoredTrailing.blocks[2] = {
      type: 'paragraph',
      children: [{ type: 'text', text: '用户输入' }],
    };
    expect(normalizeOutlinerRichTextCommit(initial, authoredTrailing).blocks)
      .toHaveLength(3);
  });

  it('derives deterministic indent, outdent and sibling movement intents', () => {
    const { document, sheet, byTitle } = fixture();
    const indent = planOutlinerIndentIntent(
      document,
      sheet.id,
      byTitle['主主题 2'],
    );
    expect(indent).toEqual({
      kind: 'reparent',
      sheetId: sheet.id,
      topicId: byTitle['主主题 2'],
      parentTopicId: byTitle['主主题 1'],
      index: getChildEdgesSorted(sheet, byTitle['主主题 1']).length,
      source: 'keyboard',
    });

    expect(planOutlinerOutdentIntent(
      document,
      sheet.id,
      byTitle['分支 1.1'],
    )).toEqual({
      kind: 'reparent',
      sheetId: sheet.id,
      topicId: byTitle['分支 1.1'],
      parentTopicId: sheet.rootTopicId,
      index: 1,
      source: 'keyboard',
    });

    expect(planOutlinerSiblingMoveIntent(
      document,
      sheet.id,
      byTitle['主主题 1'],
      'up',
    )).toBeUndefined();
    expect(planOutlinerSiblingMoveIntent(
      document,
      sheet.id,
      byTitle['主主题 1'],
      'down',
    )).toMatchObject({ kind: 'reorder', index: 1 });
  });

  it('plans before, after and inside drops across outline levels', () => {
    const { document, sheet, byTitle } = fixture();
    expect(planOutlinerDropIntent(
      document,
      { sheetId: sheet.id, topicId: byTitle['主主题 3'] },
      { sheetId: sheet.id, topicId: byTitle['主主题 1'] },
      'before',
    )).toEqual({
      kind: 'reorder',
      sheetId: sheet.id,
      topicId: byTitle['主主题 3'],
      index: 0,
      side: 'left',
      source: 'drag',
    });

    expect(planOutlinerDropIntent(
      document,
      { sheetId: sheet.id, topicId: byTitle['分支 1.1'] },
      { sheetId: sheet.id, topicId: byTitle['主主题 2'] },
      'before',
    )).toEqual({
      kind: 'reparent',
      sheetId: sheet.id,
      topicId: byTitle['分支 1.1'],
      parentTopicId: sheet.rootTopicId,
      index: 1,
      side: 'right',
      source: 'drag',
    });

    expect(planOutlinerDropIntent(
      document,
      { sheetId: sheet.id, topicId: byTitle['分支 1.1'] },
      { sheetId: sheet.id, topicId: byTitle['主主题 2'] },
      'after',
    )).toMatchObject({ kind: 'reparent', index: 2, side: 'right' });

    expect(planOutlinerDropIntent(
      document,
      { sheetId: sheet.id, topicId: byTitle['主主题 3'] },
      { sheetId: sheet.id, topicId: byTitle['主主题 1'] },
      'inside',
    )).toEqual({
      kind: 'reparent',
      sheetId: sheet.id,
      topicId: byTitle['主主题 3'],
      parentTopicId: byTitle['主主题 1'],
      index: 2,
      source: 'drag',
    });

    expect(planOutlinerDropIntent(
      document,
      { sheetId: sheet.id, topicId: byTitle['分支 1.1'] },
      { sheetId: sheet.id, topicId: byTitle['主主题 1'] },
      'inside',
    )).toMatchObject({ kind: 'reorder', index: 1 });
  });

  it('rejects root, self, descendant-cycle and cross-Sheet drops', () => {
    const { document, sheet, byTitle } = fixture();
    const otherSheetId = '018f0000-0000-7000-8000-000000000099' as SheetId;
    expect(planOutlinerDropIntent(
      document,
      { sheetId: sheet.id, topicId: sheet.rootTopicId },
      { sheetId: sheet.id, topicId: byTitle['主主题 1'] },
      'inside',
    )).toBeUndefined();
    expect(planOutlinerDropIntent(
      document,
      { sheetId: sheet.id, topicId: byTitle['主主题 1'] },
      { sheetId: sheet.id, topicId: byTitle['主主题 1'] },
      'inside',
    )).toBeUndefined();
    expect(planOutlinerDropIntent(
      document,
      { sheetId: sheet.id, topicId: byTitle['主主题 1'] },
      { sheetId: sheet.id, topicId: byTitle['分支 1.1'] },
      'inside',
    )).toBeUndefined();
    expect(planOutlinerDropIntent(
      document,
      { sheetId: sheet.id, topicId: byTitle['主主题 1'] },
      { sheetId: sheet.id, topicId: byTitle['分支 1.1'] },
      'before',
    )).toBeUndefined();
    expect(planOutlinerDropIntent(
      document,
      { sheetId: sheet.id, topicId: byTitle['主主题 1'] },
      { sheetId: otherSheetId, topicId: byTitle['主主题 2'] },
      'after',
    )).toBeUndefined();
  });

  it('preserves edge identity, order and branch side in one undoable command', () => {
    const { document, sheet, byTitle } = fixture();
    const topicId = byTitle['分支 1.1'];
    const originalEdge = getParentEdge(sheet, topicId)!;
    const intent = planOutlinerDropIntent(
      document,
      { sheetId: sheet.id, topicId },
      { sheetId: sheet.id, topicId: byTitle['主主题 2'] },
      'before',
    );
    expect(intent?.kind).toBe('reparent');
    if (intent?.kind !== 'reparent') throw new Error('Expected a reparent intent.');

    const command = planOutlinerMutationCommand(document, intent);
    expect(command.type).toBe('topic.reparent');
    if (command.type !== 'topic.reparent') throw new Error('Expected a reparent command.');
    const rootChildren = getChildEdgesSorted(sheet, sheet.rootTopicId);
    expect(command.payload.edge).toMatchObject({
      id: originalEdge.id,
      parentTopicId: sheet.rootTopicId,
      childTopicId: topicId,
      side: 'right',
    });
    expect(command.payload.edge.orderKey > rootChildren[0].orderKey).toBe(true);
    expect(command.payload.edge.orderKey < rootChildren[1].orderKey).toBe(true);

    const execution = executeMindMapCommand(document, command);
    const history = new PatchCommandHistory();
    history.record(execution.applied);
    expect(history.undoDepth).toBe(1);
    expect(history.past[0].commands).toHaveLength(1);
    const undone = history.undo(execution.document)!;
    expect(undone.document).toEqual(document);
    expect(history.redo(undone.document)?.document).toEqual(execution.document);
  });

  it('changes a root sibling branch side atomically when dropped across sides', () => {
    const { document, sheet, byTitle } = fixture();
    const topicId = byTitle['主主题 3'];
    const originalEdge = getParentEdge(sheet, topicId)!;
    expect(originalEdge.side).toBe('right');
    const intent = planOutlinerDropIntent(
      document,
      { sheetId: sheet.id, topicId },
      { sheetId: sheet.id, topicId: byTitle['主主题 1'] },
      'before',
    );
    expect(intent).toMatchObject({ kind: 'reorder', index: 0, side: 'left' });
    if (intent?.kind !== 'reorder') throw new Error('Expected a reorder intent.');

    const command = planOutlinerMutationCommand(document, intent);
    expect(command.type).toBe('topic.reorder');
    if (command.type !== 'topic.reorder') throw new Error('Expected a reorder command.');
    expect(command.payload.side).toBe('left');
    const moved = executeMindMapCommand(document, command).document;
    const movedEdge = getParentEdge(moved.sheets[sheet.id], topicId)!;
    expect(movedEdge.id).toBe(originalEdge.id);
    expect(movedEdge.side).toBe('left');
    expect(getChildEdgesSorted(moved.sheets[sheet.id], sheet.rootTopicId)[0].childTopicId)
      .toBe(topicId);
  });

  it('adapts intents through the existing command planners and engine', () => {
    const { document, sheet, byTitle } = fixture();
    const titleCommand = planOutlinerMutationCommand(document, {
      kind: 'update-title',
      sheetId: sheet.id,
      topicId: byTitle['主主题 1'],
      title: {
        type: 'doc',
        version: 1,
        blocks: [{
          type: 'paragraph',
          children: [{ type: 'text', text: '重新命名', marks: [{ type: 'bold' }] }],
        }],
      },
      source: 'editor',
    });
    expect(titleCommand.origin).toBe('mindmap-v2-outliner');
    const renamed = executeMindMapCommand(document, titleCommand).document;
    expect(richTextToPlainText(
      renamed.sheets[sheet.id].topics[byTitle['主主题 1']].title,
    )).toBe('重新命名');
    expect(renamed.sheets[sheet.id].topics[byTitle['主主题 1']].title.blocks[0])
      .toEqual({
        type: 'paragraph',
        children: [{ type: 'text', text: '重新命名', marks: [{ type: 'bold' }] }],
      });

    const reparentCommand = planOutlinerMutationCommand(renamed, {
      kind: 'reparent',
      sheetId: sheet.id,
      topicId: byTitle['主主题 2'],
      parentTopicId: byTitle['主主题 1'],
      index: 0,
      source: 'keyboard',
    });
    const reparented = executeMindMapCommand(renamed, reparentCommand).document;
    expect(getChildEdgesSorted(reparented.sheets[sheet.id], byTitle['主主题 1'])[0]
      ?.childTopicId).toBe(byTitle['主主题 2']);

    const reorderCommand = planOutlinerMutationCommand(reparented, {
      kind: 'reorder',
      sheetId: sheet.id,
      topicId: byTitle['分支 1.1'],
      index: 0,
      source: 'button',
    });
    const reordered = executeMindMapCommand(reparented, reorderCommand).document;
    expect(getChildEdgesSorted(reordered.sheets[sheet.id], byTitle['主主题 1'])[0]
      ?.childTopicId).toBe(byTitle['分支 1.1']);
  });
});
