import { describe, expect, it } from 'vitest';

import { createRichText } from '../domain/defaults';
import type {
  CommandId,
  SheetId,
  Zone,
  ZoneId,
} from '../domain/types';
import { createMindMapElementsFixture } from '../testing/fixtures';
import { mindMapRichTextToPlainText } from '../view/text';
import { CommandValidationError, ReadOnlyCommandError } from './errors';
import { executeMindMapCommand } from './engine';
import { PatchCommandHistory } from './history';
import {
  MIND_MAP_COMMAND_TYPES,
  type UpdateZoneCommand,
} from './types';

const timestamp = '2026-07-19T08:00:00.000Z';

const setup = () => {
  const document = createMindMapElementsFixture();
  const sheetId = Object.keys(document.sheets)[0] as SheetId;
  const sheet = document.sheets[sheetId];
  const zone = Object.values(sheet.zones)[0];
  return { document, sheet, sheetId, zone };
};

const commandFor = (
  document: ReturnType<typeof createMindMapElementsFixture>,
  sheetId: SheetId,
  zone: Zone,
  suffix: string,
): UpdateZoneCommand => ({
  commandId: `zone-update-${suffix}` as CommandId,
  type: MIND_MAP_COMMAND_TYPES.updateZone,
  sheetId,
  payload: { zone },
  baseRevision: document.contentRevision,
  origin: 'test',
  timestamp,
});

describe('zone.update command', () => {
  it('applies one strict canonical replacement and round-trips through undo/redo', () => {
    const { document, sheetId, zone } = setup();
    const replacement: Zone = {
      ...structuredClone(zone),
      title: createRichText('更新后的区域'),
      collapsed: true,
    };
    const execution = executeMindMapCommand(
      document,
      commandFor(document, sheetId, replacement, 'valid'),
    );

    const updated = execution.document.sheets[sheetId].zones[zone.id];
    expect(mindMapRichTextToPlainText(updated.title)).toBe('更新后的区域');
    expect(updated.collapsed).toBe(true);
    expect(execution.applied.forwardPatches).not.toHaveLength(0);
    expect(execution.applied.inversePatches).not.toHaveLength(0);

    const history = new PatchCommandHistory();
    history.record(execution.applied);
    const undone = history.undo(execution.document);
    expect(undone?.document).toEqual(document);
    const redone = history.redo(undone!.document);
    expect(redone?.document).toEqual(execution.document);
  });

  it('rejects malformed shape, undersized geometry, invalid roots, and unknown IDs', () => {
    const { document, sheet, sheetId, zone } = setup();
    const malformed = {
      ...structuredClone(zone),
      unexpectedHtml: '<script>alert(1)</script>',
    } as Zone;
    const candidates: Zone[] = [
      malformed,
      { ...structuredClone(zone), rect: { ...zone.rect, width: 99 } },
      { ...structuredClone(zone), rootTopicIds: [sheet.rootTopicId] },
      {
        ...structuredClone(zone),
        id: '018f0000-0000-7000-8000-000000009999' as ZoneId,
      },
    ];

    for (const [index, candidate] of candidates.entries()) {
      expect(() => executeMindMapCommand(
        document,
        commandFor(document, sheetId, candidate, `invalid-${index}`),
      )).toThrow(CommandValidationError);
      expect(document.contentRevision).toBe(0);
      expect(document.sheets[sheetId].zones[zone.id]).toEqual(zone);
    }
  });

  it('cannot bypass read-only execution', () => {
    const { document, sheetId, zone } = setup();
    const command = commandFor(document, sheetId, {
      ...structuredClone(zone),
      title: createRichText('不应写入'),
    }, 'read-only');

    expect(() => executeMindMapCommand(document, command, { readOnly: true }))
      .toThrow(ReadOnlyCommandError);
    expect(document.contentRevision).toBe(0);
  });
});
