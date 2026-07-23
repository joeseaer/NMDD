import { describe, expect, it } from 'vitest';

import { executeMindMapCommand } from '../commands';
import type { CommandId, SheetId, TopicId } from '../domain/types';
import { createMindMapV1SmallFixture } from '../testing';
import {
  planCreateSheetCommand,
  planDeleteSheetCommand,
  planRenameSheetCommand,
  planUpdateSheetLayoutCommand,
} from './sheetPlanning';

describe('sheet command planning', () => {
  it('preallocates a canonical sheet and plans rename/delete operations', () => {
    const document = createMindMapV1SmallFixture();
    const source = Object.values(document.sheets)[0];
    const createdCommand = planCreateSheetCommand({
      document,
      sheetId: source.id,
      newSheetId: '018f0000-0000-7000-8000-000000000301' as SheetId,
      rootTopicId: '018f0000-0000-7000-8000-000000000302' as TopicId,
      commandId: '018f0000-0000-7000-8000-000000000303' as CommandId,
      title: '第二画布',
    });
    const created = executeMindMapCommand(document, createdCommand).document;
    expect(created.sheets[createdCommand.payload.sheet.id].title).toBe('第二画布');

    const rename = planRenameSheetCommand({
      document: created,
      sheetId: createdCommand.payload.sheet.id,
      title: '产品路线',
    });
    const renamed = executeMindMapCommand(created, rename).document;
    expect(renamed.sheets[rename.sheetId].title).toBe('产品路线');

    const updateLayout = planUpdateSheetLayoutCommand({
      document: renamed,
      sheetId: rename.sheetId,
      defaultBranchLayout: {
        structure: 'core:fishbone',
        direction: 'right-to-left',
        mode: 'auto',
        variantId: 'standard',
      },
    });
    const relaid = executeMindMapCommand(renamed, updateLayout).document;
    expect(relaid.sheets[rename.sheetId].defaultBranchLayout).toEqual(
      updateLayout.payload.defaultBranchLayout,
    );

    const deletion = planDeleteSheetCommand({ document: relaid, sheetId: rename.sheetId });
    const deleted = executeMindMapCommand(relaid, deletion).document;
    expect(deleted.sheets[rename.sheetId]).toBeUndefined();
  });
});
