import { describe, expect, it } from 'vitest';

import { createMindMapSheet } from '../domain/defaults';
import { validateMindMapDocument } from '../domain/validation';
import type {
  CommandId,
  MarkerDefinitionId,
  MarkerGroupId,
  MarkerInstanceId,
  SheetId,
  TopicId,
} from '../domain/types';
import { createMindMapElementsFixture } from '../testing/fixtures';
import {
  BUILTIN_MARKER_LIBRARY,
  markerDefinitionsForGroup,
  planAttachTopicMarkerCommand,
  planCreateCustomMarkerGroupCommand,
  planCreateMarkerDefinitionCommand,
  planDeleteMarkerGroupCommand,
  planInstallBuiltinMarkerLibraryCommand,
  planMoveMarkerLegendCommand,
  planPatchMarkerLegendCommand,
  planReorderMarkerLegendItemsCommand,
} from '../ui/markerPlanning';
import { CommandValidationError, ReadOnlyCommandError } from './errors';
import { executeMindMapCommand } from './engine';
import { PatchCommandHistory } from './history';
import {
  MIND_MAP_COMMAND_TYPES,
  type AttachMarkerCommand,
  type CreateMarkerGroupCommand,
  type RenameMarkerGroupCommand,
  type UpdateMarkerDefinitionCommand,
} from './types';

const IDS = {
  customGroup: '018f0000-0000-7000-8000-00000000a001' as MarkerGroupId,
  nonexclusiveGroup: '018f0000-0000-7000-8000-00000000a002' as MarkerGroupId,
  definitionA: '018f0000-0000-7000-8000-00000000a003' as MarkerDefinitionId,
  definitionB: '018f0000-0000-7000-8000-00000000a004' as MarkerDefinitionId,
  markerA: '018f0000-0000-7000-8000-00000000a005' as MarkerInstanceId,
  markerB: '018f0000-0000-7000-8000-00000000a006' as MarkerInstanceId,
  secondSheet: '018f0000-0000-7000-8000-00000000a007' as SheetId,
  secondRoot: '018f0000-0000-7000-8000-00000000a008' as TopicId,
};

const setup = () => {
  const document = createMindMapElementsFixture();
  const sheetId = Object.keys(document.sheets)[0] as SheetId;
  const sheet = document.sheets[sheetId];
  const topicId = Object.keys(sheet.topics).find((id) => id !== sheet.rootTopicId) as TopicId;
  return { document, sheet, sheetId, topicId };
};

describe('Marker and legend canonical commands', () => {
  it('installs all five standard marker groups and their definitions as one undoable transaction', () => {
    const { document, sheetId } = setup();
    const command = planInstallBuiltinMarkerLibraryCommand({
      document,
      sheetId,
      commandId: 'marker-library-install' as CommandId,
      timestamp: '2026-07-20T00:00:00.000Z',
    });
    expect(command.payload.groups.map((group) => group.name)).toEqual(
      BUILTIN_MARKER_LIBRARY.slice(1).map((group) => group.name),
    );
    expect(new Set(command.payload.groups.map((group) => group.orderKey)).size)
      .toBe(command.payload.groups.length);

    const execution = executeMindMapCommand(document, command);
    expect(execution.document.contentRevision).toBe(document.contentRevision + 1);
    expect(Object.values(execution.document.markerGroups).filter(({ kind }) => kind === 'builtin'))
      .toHaveLength(BUILTIN_MARKER_LIBRARY.length);
    for (const group of command.payload.groups) {
      expect(markerDefinitionsForGroup(execution.document, group.id).length).toBeGreaterThan(0);
    }

    const history = new PatchCommandHistory();
    history.record(execution.applied);
    expect(history.undoDepth).toBe(1);
    const undone = history.undo(execution.document)!.document;
    for (const group of command.payload.groups) expect(undone.markerGroups[group.id]).toBeUndefined();
    expect(history.redo(undone)!.document).toEqual(execution.document);
  });

  it('atomically replaces an exclusive marker while preserving the instance ID and supports undo/redo/read-only', () => {
    const { document, sheet, sheetId } = setup();
    const current = Object.values(sheet.markerInstances)[0];
    const currentDefinition = document.markerDefinitions[current.markerDefinitionId];
    document.markerDefinitions[IDS.definitionA] = {
      id: IDS.definitionA,
      groupId: currentDefinition.groupId,
      orderKey: 'b',
      name: '优先级 2',
      source: { kind: 'builtin', key: 'priority-2' },
      semanticValue: 2,
    };
    const withDefinition = document;
    const replace = planAttachTopicMarkerCommand({
      document: withDefinition,
      sheetId,
      topicId: current.topicId,
      markerDefinitionId: IDS.definitionA,
    });
    expect(replace.type).toBe(MIND_MAP_COMMAND_TYPES.updateMarker);
    expect(replace.payload.marker.id).toBe(current.id);
    expect(replace.payload.marker.orderKey).toBe(current.orderKey);
    expect(() => executeMindMapCommand(withDefinition, replace, { readOnly: true }))
      .toThrow(ReadOnlyCommandError);

    const execution = executeMindMapCommand(withDefinition, replace);
    const topicMarkers = Object.values(execution.document.sheets[sheetId].markerInstances)
      .filter((marker) => marker.topicId === current.topicId);
    expect(topicMarkers).toEqual([expect.objectContaining({
      id: current.id,
      markerDefinitionId: IDS.definitionA,
    })]);

    const history = new PatchCommandHistory();
    history.record(execution.applied);
    const restored = history.undo(execution.document)!.document;
    expect(restored.sheets[sheetId].markerInstances[current.id]).toEqual(current);
    expect(history.redo(restored)!.document).toEqual(execution.document);
  });

  it('allows nonexclusive stacking but rejects duplicate definitions and duplicate final order keys before mutation', () => {
    const { document, sheetId, topicId } = setup();
    const createGroup = planCreateCustomMarkerGroupCommand({
      document,
      sheetId,
      markerGroupId: IDS.nonexclusiveGroup,
      name: '多选标记',
      exclusive: false,
    });
    let current = executeMindMapCommand(document, createGroup).document;
    for (const [definitionId, name, sourceKey] of [
      [IDS.definitionA, '风险', 'custom-triangle'],
      [IDS.definitionB, '机会', 'custom-diamond'],
    ] as const) {
      current = executeMindMapCommand(current, planCreateMarkerDefinitionCommand({
        document: current,
        sheetId,
        markerGroupId: IDS.nonexclusiveGroup,
        markerDefinitionId: definitionId,
        name,
        sourceKey,
      })).document;
    }
    const first = planAttachTopicMarkerCommand({
      document: current,
      sheetId,
      topicId,
      markerDefinitionId: IDS.definitionA,
      markerInstanceId: IDS.markerA,
    });
    current = executeMindMapCommand(current, first).document;
    const second = planAttachTopicMarkerCommand({
      document: current,
      sheetId,
      topicId,
      markerDefinitionId: IDS.definitionB,
      markerInstanceId: IDS.markerB,
    });
    const stacked = executeMindMapCommand(current, second).document;
    expect(Object.values(stacked.sheets[sheetId].markerInstances)
      .filter((marker) => marker.topicId === topicId && [IDS.definitionA, IDS.definitionB]
        .includes(marker.markerDefinitionId as typeof IDS.definitionA))).toHaveLength(2);

    expect(() => planAttachTopicMarkerCommand({
      document: stacked,
      sheetId,
      topicId,
      markerDefinitionId: IDS.definitionA,
    })).toThrow(/已经包含/);

    const duplicateOrder: AttachMarkerCommand = {
      ...(second as AttachMarkerCommand),
      commandId: 'duplicate-marker-order' as CommandId,
      baseRevision: stacked.contentRevision,
      payload: {
        marker: {
          id: '018f0000-0000-7000-8000-00000000a099' as MarkerInstanceId,
          topicId,
          markerDefinitionId: IDS.definitionB,
          orderKey: stacked.sheets[sheetId].markerInstances[IDS.markerA].orderKey,
        },
      },
    };
    const before = JSON.stringify(stacked);
    expect(() => executeMindMapCommand(stacked, duplicateOrder)).toThrow(CommandValidationError);
    expect(JSON.stringify(stacked)).toBe(before);
  });

  it('cascades custom-group deletion through definitions, instances and legend order in every Sheet, then undo restores exactly', () => {
    const { document, sheet, sheetId, topicId } = setup();
    let current = executeMindMapCommand(document, planCreateCustomMarkerGroupCommand({
      document,
      sheetId,
      markerGroupId: IDS.customGroup,
      name: '风险组',
      exclusive: true,
    })).document;
    current = executeMindMapCommand(current, planCreateMarkerDefinitionCommand({
      document: current,
      sheetId,
      markerGroupId: IDS.customGroup,
      markerDefinitionId: IDS.definitionA,
      name: '高风险',
      sourceKey: 'custom-triangle',
    })).document;
    current = executeMindMapCommand(current, planAttachTopicMarkerCommand({
      document: current,
      sheetId,
      topicId,
      markerDefinitionId: IDS.definitionA,
      markerInstanceId: IDS.markerA,
    })).document;

    current = structuredClone(current);
    const secondSheet = createMindMapSheet({
      id: IDS.secondSheet,
      orderKey: 'z',
      rootTopicId: IDS.secondRoot,
      themeId: sheet.themeId,
      title: 'Second',
    });
    secondSheet.markerInstances[IDS.markerB] = {
      id: IDS.markerB,
      topicId: IDS.secondRoot,
      markerDefinitionId: IDS.definitionA,
      orderKey: 'a',
    };
    secondSheet.markerLegend.itemOrder = [IDS.definitionA];
    current.sheets[IDS.secondSheet] = secondSheet;
    current.sheets[sheetId].markerLegend.itemOrder = [
      ...(current.sheets[sheetId].markerLegend.itemOrder ?? []),
      IDS.definitionA,
    ];
    expect(validateMindMapDocument(current).valid).toBe(true);

    const remove = planDeleteMarkerGroupCommand({
      document: current,
      sheetId,
      markerGroupId: IDS.customGroup,
    });
    const execution = executeMindMapCommand(current, remove);
    expect(execution.document.markerGroups[IDS.customGroup]).toBeUndefined();
    expect(execution.document.markerDefinitions[IDS.definitionA]).toBeUndefined();
    expect(execution.document.sheets[sheetId].markerInstances[IDS.markerA]).toBeUndefined();
    expect(execution.document.sheets[IDS.secondSheet].markerInstances[IDS.markerB]).toBeUndefined();
    expect(execution.document.sheets[sheetId].markerLegend.itemOrder).not.toContain(IDS.definitionA);
    expect(execution.document.sheets[IDS.secondSheet].markerLegend.itemOrder).toEqual([]);

    const history = new PatchCommandHistory();
    history.record(execution.applied);
    expect(history.undo(execution.document)!.document).toEqual(current);
    const builtinGroup = Object.values(current.markerGroups).find(({ kind }) => kind === 'builtin')!;
    expect(() => planDeleteMarkerGroupCommand({
      document: current,
      sheetId,
      markerGroupId: builtinGroup.id,
    })).toThrow(/内置标记组不能删除/);
  });

  it('patches, moves and explicitly orders the legend while rejecting invalid references and non-finite coordinates', () => {
    const { document, sheetId } = setup();
    const definitionId = Object.keys(document.markerDefinitions)[0] as MarkerDefinitionId;
    let current = executeMindMapCommand(document, planPatchMarkerLegendCommand({
      document,
      sheetId,
      visible: true,
      title: '风险图例',
    })).document;
    current = executeMindMapCommand(current, planMoveMarkerLegendCommand({
      document: current,
      sheetId,
      position: { x: 123.5, y: -45.25 },
    })).document;
    current = executeMindMapCommand(current, planReorderMarkerLegendItemsCommand({
      document: current,
      sheetId,
      itemOrder: [definitionId],
    })).document;
    expect(current.sheets[sheetId].markerLegend).toMatchObject({
      visible: true,
      title: '风险图例',
      position: { x: 123.5, y: -45.25 },
      itemOrder: [definitionId],
    });
    expect(() => planMoveMarkerLegendCommand({
      document: current,
      sheetId,
      position: { x: Number.NaN, y: 0 },
    })).toThrow(/有限坐标/);
    expect(() => planReorderMarkerLegendItemsCommand({
      document: current,
      sheetId,
      itemOrder: [definitionId, definitionId],
    })).toThrow(/不能重复/);
  });

  it('rejects cross-kind ID collisions and duplicate group order keys with zero transaction', () => {
    const { document, sheetId, topicId } = setup();
    const firstGroup = Object.values(document.markerGroups)[0];
    const collision: CreateMarkerGroupCommand = {
      commandId: 'marker-id-collision' as CommandId,
      type: MIND_MAP_COMMAND_TYPES.createMarkerGroup,
      sheetId,
      baseRevision: document.contentRevision,
      origin: 'test',
      timestamp: '2026-07-20T00:00:00.000Z',
      payload: {
        groups: [{
          id: topicId as unknown as MarkerGroupId,
          name: 'Collision',
          kind: 'custom',
          exclusive: false,
          orderKey: 'collision',
        }],
        definitions: [],
      },
    };
    expect(() => executeMindMapCommand(document, collision)).toThrow(/already exists/);
    expect(document.contentRevision).toBe(collision.baseRevision);

    const duplicateOrder: CreateMarkerGroupCommand = {
      ...collision,
      commandId: 'marker-order-collision' as CommandId,
      payload: {
        groups: [{
          id: IDS.customGroup,
          name: 'Duplicate order',
          kind: 'custom',
          exclusive: false,
          orderKey: firstGroup.orderKey,
        }],
        definitions: [],
      },
    };
    expect(() => executeMindMapCommand(document, duplicateOrder)).toThrow(/share orderKey/);
    expect(document.markerGroups[IDS.customGroup]).toBeUndefined();
  });

  it('protects built-in groups and definitions at the command boundary, not only in the UI', () => {
    const { document, sheetId } = setup();
    const group = Object.values(document.markerGroups).find(({ kind }) => kind === 'builtin')!;
    const definition = Object.values(document.markerDefinitions)
      .find((candidate) => candidate.groupId === group.id)!;
    const envelope = {
      commandId: 'builtin-marker-protection' as CommandId,
      sheetId,
      baseRevision: document.contentRevision,
      origin: 'test',
      timestamp: '2026-07-20T00:00:00.000Z',
    };
    const rename: RenameMarkerGroupCommand = {
      ...envelope,
      type: MIND_MAP_COMMAND_TYPES.renameMarkerGroup,
      payload: { groupId: group.id, name: 'Changed' },
    };
    const updateDefinition: UpdateMarkerDefinitionCommand = {
      ...envelope,
      type: MIND_MAP_COMMAND_TYPES.updateMarkerDefinition,
      payload: { definition: { ...definition, name: 'Changed' } },
    };
    expect(() => executeMindMapCommand(document, rename)).toThrow(/Built-in marker groups cannot be renamed/);
    expect(() => executeMindMapCommand(document, updateDefinition))
      .toThrow(/Built-in marker definitions cannot be updated/);
    expect(document.markerGroups[group.id].name).toBe(group.name);
    expect(document.markerDefinitions[definition.id].name).toBe(definition.name);
  });

  it('reports exclusive, duplicate-definition, instance-order and legend-order invariant corruption', () => {
    const { document, sheet, sheetId } = setup();
    const existing = Object.values(sheet.markerInstances)[0];
    const duplicateId = IDS.markerA;
    sheet.markerInstances[duplicateId] = {
      ...existing,
      id: duplicateId,
    };
    sheet.markerLegend.itemOrder = [existing.markerDefinitionId, existing.markerDefinitionId];
    const result = validateMindMapDocument(document);
    expect(result.valid).toBe(false);
    // Schema detects duplicate legend items before invariant evaluation. Remove
    // that shape error to inspect the marker semantic invariants themselves.
    sheet.markerLegend.itemOrder = [existing.markerDefinitionId];
    const invariantResult = validateMindMapDocument(document);
    expect(invariantResult.issues.map(({ code }) => code)).toEqual(expect.arrayContaining([
      'invariant.marker.instance-order-key',
      'invariant.marker.duplicate-definition',
      'invariant.marker.exclusive-group',
    ]));
    expect(invariantResult.issues.some(({ path }) => path.includes(`/sheets/${sheetId}/markerInstances/`)))
      .toBe(true);
  });
});
