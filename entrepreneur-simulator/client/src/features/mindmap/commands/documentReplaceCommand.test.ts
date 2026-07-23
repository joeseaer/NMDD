import { describe, expect, it } from 'vitest';

import type { CommandId, MindMapDocumentV1, TopicId } from '../domain/types';
import {
  createMindMapElementsFixture,
  createMindMapV1SmallFixture,
} from '../testing';
import { CommandValidationError } from './errors';
import { executeMindMapCommand } from './engine';
import { PatchCommandHistory } from './history';
import { CORE_MIND_MAP_COMMAND_REGISTRY } from './registry';
import {
  MIND_MAP_COMMAND_TYPES,
  type ReplaceImportedDocumentCommand,
} from './types';

const timestamp = '2026-07-19T08:00:00.000Z';

const replacement = (
  current: MindMapDocumentV1,
  candidate: MindMapDocumentV1,
  suffix = '001',
): ReplaceImportedDocumentCommand => ({
  commandId: `018f0000-0000-7000-8000-000000000${suffix}` as CommandId,
  type: MIND_MAP_COMMAND_TYPES.replaceImportedDocument,
  sheetId: Object.values(current.sheets)[0].id,
  payload: { candidate },
  baseRevision: current.contentRevision,
  groupId: 'same-import-session',
  origin: 'test-import',
  timestamp,
});

describe('document.replace-imported command', () => {
  it('atomically replaces canonical content while the engine alone advances revision', () => {
    const before = createMindMapV1SmallFixture();
    before.contentRevision = 7;
    before.locale = 'zh-CN';
    const candidate = createMindMapElementsFixture();
    candidate.contentRevision = 999;
    const candidateSnapshot = structuredClone(candidate);

    const execution = executeMindMapCommand(before, replacement(before, candidate));

    expect(execution.document).toEqual({
      ...candidateSnapshot,
      contentRevision: 8,
    });
    expect(execution.document.locale).toBeUndefined();
    expect(execution.document).not.toBe(candidate);
    expect(candidate).toEqual(candidateSnapshot);
    expect(Object.isFrozen(candidate)).toBe(false);
    expect(Object.isFrozen(candidate.sheets)).toBe(false);
    expect(before.contentRevision).toBe(7);
  });

  it('undoes and redoes the whole import exactly as one patch transaction', () => {
    const before = createMindMapV1SmallFixture();
    const candidate = createMindMapElementsFixture();
    const execution = executeMindMapCommand(before, replacement(before, candidate));
    const history = new PatchCommandHistory();
    history.record(execution.applied);

    expect(history.undoDepth).toBe(1);
    expect(history.past[0].commands).toHaveLength(1);
    const undone = history.undo(execution.document);
    expect(JSON.stringify(undone?.document)).toBe(JSON.stringify(before));
    const redone = history.redo(undone!.document);
    expect(JSON.stringify(redone?.document)).toBe(JSON.stringify(execution.document));
  });

  it('never merges two imported-document replacements', () => {
    const current = createMindMapV1SmallFixture();
    const first = replacement(current, createMindMapElementsFixture(), '011');
    const second = replacement(current, structuredClone(first.payload.candidate), '012');

    expect(CORE_MIND_MAP_COMMAND_REGISTRY.shouldMerge(first, second)).toBe(false);
  });

  it('rejects the current document reference and both schema/domain-invalid candidates', () => {
    const current = createMindMapV1SmallFixture();
    expect(() => executeMindMapCommand(current, replacement(current, current)))
      .toThrowError(/must not be the current document reference/);

    const schemaInvalid = structuredClone(createMindMapElementsFixture()) as unknown as {
      schemaVersion: number;
    };
    schemaInvalid.schemaVersion = 2;
    expect(() => executeMindMapCommand(
      current,
      replacement(current, schemaInvalid as unknown as MindMapDocumentV1),
    )).toThrow(CommandValidationError);

    const domainInvalid = structuredClone(createMindMapElementsFixture());
    const importedSheet = Object.values(domainInvalid.sheets)[0];
    importedSheet.rootTopicId = '018f0000-0000-7000-8000-ffffffffffff' as TopicId;
    expect(() => executeMindMapCommand(current, replacement(current, domainInvalid)))
      .toThrow(CommandValidationError);
  });
});
