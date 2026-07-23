import { describe, expect, it } from 'vitest';

import {
  createNewMindMapDocument,
  createRichText,
} from '../domain/defaults';
import { getChildEdgesSorted } from '../domain/tree';
import type {
  CommandId,
  DocumentId,
  SheetId,
  ThemeId,
  TopicId,
} from '../domain/types';
import { createMindMapV1SmallFixture } from '../testing';
import { executeMindMapCommand } from './engine';
import { PatchCommandHistory } from './history';
import {
  MIND_MAP_COMMAND_TYPES,
  type DeleteTopicSubtreeCommand,
  type UpdateTopicTitleCommand,
} from './types';

const IDS = {
  document: '018f0000-0000-7000-8000-000000000011' as DocumentId,
  sheet: '018f0000-0000-7000-8000-000000000012' as SheetId,
  theme: '018f0000-0000-7000-8000-000000000013' as ThemeId,
  root: '018f0000-0000-7000-8000-000000000014' as TopicId,
};

const timestamp = '2026-07-18T12:00:00.000Z';

const createDocument = () => createNewMindMapDocument({
  documentId: IDS.document,
  sheetId: IDS.sheet,
  rootTopicId: IDS.root,
  themeId: IDS.theme,
  sheetOrderKey: 'K00000000000000000000000000000000',
  rootTitle: 'Before',
});

const updateTitle = (
  title: string,
  baseRevision: number,
  groupId?: string,
): UpdateTopicTitleCommand => ({
  commandId: `history-title-${baseRevision}` as CommandId,
  type: MIND_MAP_COMMAND_TYPES.updateTopicTitle,
  sheetId: IDS.sheet,
  payload: { topicId: IDS.root, title: createRichText(title) },
  baseRevision,
  groupId,
  origin: 'keyboard',
  timestamp,
});

describe('patch command history', () => {
  it('undoes and redoes to byte-equivalent JSON using patches only', () => {
    const before = createDocument();
    const execution = executeMindMapCommand(before, updateTitle('After', 0));
    const history = new PatchCommandHistory();
    history.record(execution.applied);

    const undone = history.undo(execution.document);
    expect(undone).toBeDefined();
    expect(JSON.stringify(undone?.document)).toBe(JSON.stringify(before));
    expect(history.canRedo).toBe(true);

    const redone = history.redo(undone!.document);
    expect(redone).toBeDefined();
    expect(JSON.stringify(redone?.document)).toBe(JSON.stringify(execution.document));
    expect(Object.keys(history.past[0])).not.toContain('snapshot');
  });

  it('merges same-topic edits in one group into a single undo unit', () => {
    const before = createDocument();
    const first = executeMindMapCommand(before, updateTitle('A', 0, 'edit-session'));
    const second = executeMindMapCommand(
      first.document,
      updateTitle('AB', 1, 'edit-session'),
    );
    const history = new PatchCommandHistory();
    history.record(first.applied);
    history.record(second.applied);

    expect(history.undoDepth).toBe(1);
    expect(history.past[0].commands).toHaveLength(2);
    expect(history.undo(second.document)?.document).toEqual(before);
  });

  it('merges a grouped multi-topic delete into one undo unit', () => {
    const before = createMindMapV1SmallFixture();
    const sheet = Object.values(before.sheets)[0];
    const [firstEdge, secondEdge] = getChildEdgesSorted(sheet, sheet.rootTopicId);
    const deletion = (
      topicId: TopicId,
      baseRevision: number,
      suffix: string,
    ): DeleteTopicSubtreeCommand => ({
      commandId: `018f0000-0000-7000-8000-0000000000${suffix}` as CommandId,
      type: MIND_MAP_COMMAND_TYPES.deleteTopicSubtree,
      sheetId: sheet.id,
      payload: { topicId },
      baseRevision,
      groupId: 'delete-selection',
      origin: 'keyboard',
      timestamp,
    });
    const first = executeMindMapCommand(
      before,
      deletion(firstEdge.childTopicId, before.contentRevision, '31'),
    );
    const second = executeMindMapCommand(
      first.document,
      deletion(secondEdge.childTopicId, first.document.contentRevision, '32'),
    );
    const history = new PatchCommandHistory();
    history.record(first.applied);
    history.record(second.applied);

    expect(history.undoDepth).toBe(1);
    expect(history.past[0].commands).toHaveLength(2);
    expect(history.undo(second.document)?.document).toEqual(before);
  });

  it('evicts oldest entries until the byte budget is respected', () => {
    const before = createDocument();
    const execution = executeMindMapCommand(before, updateTitle('large payload', 0));
    const history = new PatchCommandHistory({ byteBudget: 1 });
    history.record(execution.applied);

    expect(history.byteSize).toBeLessThanOrEqual(1);
    expect(history.canUndo).toBe(false);
    expect(history.undoDepth).toBe(0);
  });
});
