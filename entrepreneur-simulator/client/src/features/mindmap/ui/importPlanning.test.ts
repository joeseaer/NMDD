import { describe, expect, it } from 'vitest';

import type { CommandId, ISODateTime, SheetId } from '../domain/types';
import {
  createMindMapElementsFixture,
  createMindMapV1SmallFixture,
} from '../testing';
import { MIND_MAP_COMMAND_TYPES } from '../commands/types';
import { planReplaceImportedDocumentCommand } from './importPlanning';

describe('import command planning', () => {
  it('injects deterministic metadata, anchors in the current document, and keeps candidate by reference', () => {
    const document = createMindMapV1SmallFixture();
    document.contentRevision = 41;
    const candidate = createMindMapElementsFixture();
    const anchor = Object.values(document.sheets)[0].id;
    const commandId = '018f0000-0000-7000-8000-000000000099' as CommandId;
    const timestamp = '2026-07-19T08:30:00.000Z' as ISODateTime;

    const command = planReplaceImportedDocumentCommand(
      { document, candidate },
      { createCommandId: () => commandId, now: () => timestamp },
    );

    expect(command).toMatchObject({
      commandId,
      type: MIND_MAP_COMMAND_TYPES.replaceImportedDocument,
      sheetId: anchor,
      baseRevision: 41,
      origin: 'mindmap-v2-import',
      timestamp,
    });
    expect(command.payload.candidate).toBe(candidate);
  });

  it('accepts only an envelope anchor from the current document', () => {
    const document = createMindMapV1SmallFixture();
    const candidate = createMindMapElementsFixture();
    const missing = '018f0000-0000-7000-8000-ffffffffffff' as SheetId;

    expect(() => planReplaceImportedDocumentCommand(
      { document, candidate, sheetId: missing },
      {
        createCommandId: () => '018f0000-0000-7000-8000-000000000098' as CommandId,
        now: () => '2026-07-19T08:30:00.000Z',
      },
    )).toThrowError(/does not exist in the current document/);
  });
});
