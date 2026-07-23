import { describe, expect, it } from 'vitest';

import { MIND_MAP_COMMAND_TYPES } from '../commands/types';
import type {
  MarkerDefinitionId,
  MarkerGroupId,
  MarkerInstanceId,
  SheetId,
} from '../domain/types';
import { createMindMapElementsFixture } from '../testing/fixtures';
import {
  BUILTIN_MARKER_LIBRARY_EXTENSION,
  XMIND_MARKER_SOURCE_ID_EXTENSION,
  markerGroupDeleteImpact,
  markerLegendDefinitionIds,
  planInstallBuiltinMarkerLibraryCommand,
  planReorderMarkerDefinitionCommand,
  planReorderMarkerGroupCommand,
  planToggleTopicMarkerCommand,
} from './markerPlanning';

const IDS = {
  groupA: '018f0000-0000-7000-8000-00000000c001' as MarkerGroupId,
  groupB: '018f0000-0000-7000-8000-00000000c002' as MarkerGroupId,
  definitionA: '018f0000-0000-7000-8000-00000000c003' as MarkerDefinitionId,
  definitionB: '018f0000-0000-7000-8000-00000000c004' as MarkerDefinitionId,
  marker: '018f0000-0000-7000-8000-00000000c005' as MarkerInstanceId,
};

const setup = () => {
  const document = createMindMapElementsFixture();
  const sheetId = Object.keys(document.sheets)[0] as SheetId;
  const sheet = document.sheets[sheetId];
  const currentMarker = Object.values(sheet.markerInstances)[0];
  return { document, sheet, sheetId, currentMarker };
};

describe('marker planning', () => {
  it('installs only missing built-ins with stable XMind group IDs and unique canonical order', () => {
    const { document, sheetId } = setup();
    const command = planInstallBuiltinMarkerLibraryCommand({ document, sheetId });
    expect(command.payload.groups.map((group) => group.extensions)).toEqual([
      expect.objectContaining({
        [BUILTIN_MARKER_LIBRARY_EXTENSION]: 'progress',
        [XMIND_MARKER_SOURCE_ID_EXTENSION]: 'progress',
      }),
      expect.objectContaining({ [XMIND_MARKER_SOURCE_ID_EXTENSION]: 'flag' }),
      expect.objectContaining({ [XMIND_MARKER_SOURCE_ID_EXTENSION]: 'star' }),
      expect.objectContaining({ [XMIND_MARKER_SOURCE_ID_EXTENSION]: 'arrow' }),
    ]);
    expect(new Set(command.payload.groups.map(({ id }) => id)).size).toBe(4);
    expect(new Set(command.payload.groups.map(({ orderKey }) => orderKey)).size).toBe(4);
    expect(command.payload.definitions.every((definition) =>
      command.payload.groups.some((group) => group.id === definition.groupId))).toBe(true);
  });

  it('plans group and definition moves as atomic key swaps with stable IDs', () => {
    const { document, sheetId } = setup();
    document.markerGroups[IDS.groupA] = {
      id: IDS.groupA,
      orderKey: 'b',
      name: 'A',
      kind: 'custom',
      exclusive: false,
    };
    document.markerGroups[IDS.groupB] = {
      id: IDS.groupB,
      orderKey: 'c',
      name: 'B',
      kind: 'custom',
      exclusive: false,
    };
    document.markerDefinitions[IDS.definitionA] = {
      id: IDS.definitionA,
      groupId: IDS.groupA,
      orderKey: 'a',
      name: 'A1',
      source: { kind: 'builtin', key: 'custom-circle' },
    };
    document.markerDefinitions[IDS.definitionB] = {
      id: IDS.definitionB,
      groupId: IDS.groupA,
      orderKey: 'b',
      name: 'A2',
      source: { kind: 'builtin', key: 'custom-square' },
    };
    expect(planReorderMarkerGroupCommand({
      document,
      sheetId,
      markerGroupId: IDS.groupB,
      direction: 'up',
    }).payload.updates).toEqual([
      { groupId: IDS.groupB, orderKey: 'b' },
      { groupId: IDS.groupA, orderKey: 'c' },
    ]);
    expect(planReorderMarkerDefinitionCommand({
      document,
      sheetId,
      markerDefinitionId: IDS.definitionB,
      direction: 'up',
    }).payload.updates).toEqual([
      { definitionId: IDS.definitionB, orderKey: 'a' },
      { definitionId: IDS.definitionA, orderKey: 'b' },
    ]);
  });

  it('plans active toggles as detach and exclusive replacement as stable-ID update', () => {
    const { document, sheetId, currentMarker } = setup();
    expect(planToggleTopicMarkerCommand({
      document,
      sheetId,
      topicId: currentMarker.topicId,
      markerDefinitionId: currentMarker.markerDefinitionId,
    })).toMatchObject({
      type: MIND_MAP_COMMAND_TYPES.detachMarker,
      payload: { markerInstanceId: currentMarker.id },
    });

    const definition = document.markerDefinitions[currentMarker.markerDefinitionId];
    document.markerDefinitions[IDS.definitionA] = {
      ...definition,
      id: IDS.definitionA,
      orderKey: 'b',
      name: 'Priority 2',
      source: { kind: 'builtin', key: 'priority-2' },
    };
    expect(planToggleTopicMarkerCommand({
      document,
      sheetId,
      topicId: currentMarker.topicId,
      markerDefinitionId: IDS.definitionA,
    })).toMatchObject({
      type: MIND_MAP_COMMAND_TYPES.updateMarker,
      payload: { marker: {
        id: currentMarker.id,
        markerDefinitionId: IDS.definitionA,
        orderKey: currentMarker.orderKey,
      } },
    });
  });

  it('uses only active definitions by default, but respects an explicit empty legend and reports cascade impact', () => {
    const { document, sheet, sheetId, currentMarker } = setup();
    delete sheet.markerLegend.itemOrder;
    expect(markerLegendDefinitionIds(document, sheetId)).toEqual([currentMarker.markerDefinitionId]);
    sheet.markerLegend.itemOrder = [];
    expect(markerLegendDefinitionIds(document, sheetId)).toEqual([]);

    const definition = document.markerDefinitions[currentMarker.markerDefinitionId];
    expect(markerGroupDeleteImpact(document, definition.groupId)).toEqual({
      definitions: 1,
      instances: 1,
      legendItems: 0,
    });
  });
});
