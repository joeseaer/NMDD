import { describe, expect, it } from 'vitest';

import { createMindMapSheet } from '../domain/defaults';
import type {
  CommandId,
  LinkId,
  SavedViewId,
  SheetId,
  TopicId,
} from '../domain/types';
import { createMindMapV1SmallFixture } from '../testing';
import { CommandValidationError } from './errors';
import { executeMindMapCommand } from './engine';
import { PatchCommandHistory } from './history';
import {
  MIND_MAP_COMMAND_TYPES,
  type CreateSheetCommand,
  type DeleteSheetCommand,
  type RenameSheetCommand,
  type ReorderSheetCommand,
  type UpdateSheetLayoutCommand,
} from './types';

const IDS = {
  sheet: '018f0000-0000-7000-8000-000000000201' as SheetId,
  root: '018f0000-0000-7000-8000-000000000202' as TopicId,
  link: '018f0000-0000-7000-8000-000000000203' as LinkId,
  view: '018f0000-0000-7000-8000-000000000204' as SavedViewId,
};
const timestamp = '2026-07-18T12:00:00.000Z';
const commandId = (suffix: string) =>
  `018f0000-0000-7000-8000-000000000${suffix}` as CommandId;

describe('sheet commands', () => {
  it('creates, renames, reorders, and deletes a sheet with reference repair and undo', () => {
    const initial = createMindMapV1SmallFixture();
    const firstSheet = Object.values(initial.sheets)[0];
    const secondSheet = createMindMapSheet({
      id: IDS.sheet,
      rootTopicId: IDS.root,
      themeId: firstSheet.themeId,
      orderKey: 'z',
      title: '第二画布',
      rootTitle: '第二中心主题',
    });
    const create: CreateSheetCommand = {
      commandId: commandId('211'),
      type: MIND_MAP_COMMAND_TYPES.createSheet,
      sheetId: firstSheet.id,
      payload: { sheet: secondSheet },
      baseRevision: initial.contentRevision,
      origin: 'test',
      timestamp,
    };
    const created = executeMindMapCommand(initial, create);
    expect(created.document.sheets[IDS.sheet]).toEqual(secondSheet);

    const rename: RenameSheetCommand = {
      commandId: commandId('212'),
      type: MIND_MAP_COMMAND_TYPES.renameSheet,
      sheetId: IDS.sheet,
      payload: { title: '研究画布' },
      baseRevision: created.document.contentRevision,
      origin: 'test',
      timestamp,
    };
    const renamed = executeMindMapCommand(created.document, rename);
    expect(renamed.document.sheets[IDS.sheet].title).toBe('研究画布');

    const reorder: ReorderSheetCommand = {
      commandId: commandId('213'),
      type: MIND_MAP_COMMAND_TYPES.reorderSheet,
      sheetId: IDS.sheet,
      payload: { orderKey: '0' },
      baseRevision: renamed.document.contentRevision,
      origin: 'test',
      timestamp,
    };
    const reordered = structuredClone(
      executeMindMapCommand(renamed.document, reorder).document,
    );
    reordered.sheets[firstSheet.id].links[IDS.link] = {
      id: IDS.link,
      topicId: firstSheet.rootTopicId,
      orderKey: 'a',
      kind: 'sheet',
      targetSheetId: IDS.sheet,
      status: 'active',
    };
    reordered.savedViews[IDS.view] = {
      id: IDS.view,
      orderKey: 'a',
      name: '第二画布视图',
      sheetId: IDS.sheet,
      viewport: { x: 0, y: 0, zoom: 1 },
    };

    const deletion: DeleteSheetCommand = {
      commandId: commandId('214'),
      type: MIND_MAP_COMMAND_TYPES.deleteSheet,
      sheetId: IDS.sheet,
      payload: {},
      baseRevision: reordered.contentRevision,
      origin: 'test',
      timestamp,
    };
    const deleted = executeMindMapCommand(reordered, deletion);
    expect(deleted.document.sheets[IDS.sheet]).toBeUndefined();
    expect(deleted.document.savedViews[IDS.view]).toBeUndefined();
    expect(deleted.document.sheets[firstSheet.id].links[IDS.link].status).toBe('broken');

    const history = new PatchCommandHistory();
    history.record(deleted.applied);
    const restored = history.undo(deleted.document)!.document;
    expect(restored.sheets[IDS.sheet]).toEqual(reordered.sheets[IDS.sheet]);
    expect(restored.savedViews[IDS.view]).toEqual(reordered.savedViews[IDS.view]);
    expect(restored.sheets[firstSheet.id].links[IDS.link].status).toBe('active');
  });

  it('rejects deletion of the final sheet and duplicate sheet order keys', () => {
    const document = createMindMapV1SmallFixture();
    const sheet = Object.values(document.sheets)[0];
    expect(() => executeMindMapCommand(document, {
      commandId: commandId('221'),
      type: MIND_MAP_COMMAND_TYPES.deleteSheet,
      sheetId: sheet.id,
      payload: {},
      baseRevision: document.contentRevision,
      origin: 'test',
      timestamp,
    })).toThrow(CommandValidationError);

    const duplicate = createMindMapSheet({
      id: IDS.sheet,
      rootTopicId: IDS.root,
      themeId: sheet.themeId,
      orderKey: sheet.orderKey,
    });
    expect(() => executeMindMapCommand(document, {
      commandId: commandId('222'),
      type: MIND_MAP_COMMAND_TYPES.createSheet,
      sheetId: sheet.id,
      payload: { sheet: duplicate },
      baseRevision: document.contentRevision,
      origin: 'test',
      timestamp,
    })).toThrow(CommandValidationError);
  });

  it('updates the complete Sheet layout atomically and round-trips through history', () => {
    const initial = createMindMapV1SmallFixture();
    const sheet = Object.values(initial.sheets)[0];
    const command: UpdateSheetLayoutCommand = {
      commandId: commandId('231'),
      type: MIND_MAP_COMMAND_TYPES.updateSheetLayout,
      sheetId: sheet.id,
      payload: {
        defaultBranchLayout: {
          structure: 'core:timeline',
          direction: 'left-to-right',
          mode: 'auto',
          variantId: 'horizontal-off-axis',
          compact: true,
          spacing: { sibling: 36, level: 80 },
          options: { alternate: true, axisGap: 42 },
        },
        advancedLayout: {
          flexibleFloatingTopics: true,
          allowTopicOverlap: false,
        },
      },
      baseRevision: initial.contentRevision,
      origin: 'test',
      timestamp,
    };

    const updated = executeMindMapCommand(initial, command);
    expect(updated.document.sheets[sheet.id].defaultBranchLayout).toEqual(
      command.payload.defaultBranchLayout,
    );
    expect(updated.document.sheets[sheet.id].advancedLayout).toEqual(
      command.payload.advancedLayout,
    );
    const history = new PatchCommandHistory();
    history.record(updated.applied);
    const undone = history.undo(updated.document)!;
    expect(undone.document).toEqual(initial);
    expect(history.redo(undone.document)!.document).toEqual(updated.document);
  });

  it('rejects unresolved or non-finite Sheet layouts without a transaction', () => {
    const document = createMindMapV1SmallFixture();
    const sheet = Object.values(document.sheets)[0];
    const invalid = (layout: UpdateSheetLayoutCommand['payload']['defaultBranchLayout']) =>
      executeMindMapCommand(document, {
        commandId: commandId('232'),
        type: MIND_MAP_COMMAND_TYPES.updateSheetLayout,
        sheetId: sheet.id,
        payload: { defaultBranchLayout: layout },
        baseRevision: document.contentRevision,
        origin: 'test',
        timestamp,
      });

    expect(() => invalid({
      structure: 'inherit' as never,
      direction: 'left-to-right',
      mode: 'auto',
    })).toThrow(CommandValidationError);
    expect(() => invalid({
      structure: 'core:grid',
      direction: 'top-to-bottom',
      mode: 'auto',
      spacing: { sibling: Number.POSITIVE_INFINITY, level: 20 },
    })).toThrow(CommandValidationError);
  });
});
