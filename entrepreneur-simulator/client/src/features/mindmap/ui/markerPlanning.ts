import {
  MIND_MAP_COMMAND_TYPES,
  type AttachMarkerCommand,
  type CreateMarkerDefinitionCommand,
  type CreateMarkerGroupCommand,
  type DeleteMarkerDefinitionCommand,
  type DeleteMarkerGroupCommand,
  type DetachMarkerCommand,
  type MoveMarkerLegendCommand,
  type PatchMarkerLegendCommand,
  type RenameMarkerGroupCommand,
  type ReorderMarkerDefinitionCommand,
  type ReorderMarkerGroupCommand,
  type ReorderMarkerLegendItemsCommand,
  type UpdateMarkerCommand,
  type UpdateMarkerDefinitionCommand,
} from '../commands/types';
import { createEntityId } from '../domain/ids';
import {
  compareOrderedEntities,
  createOrderKeyBetween,
  rebalanceOrderKeys,
} from '../domain/orderKey';
import type {
  CommandId,
  MarkerDefinition,
  MarkerDefinitionId,
  MarkerGroup,
  MarkerGroupId,
  MarkerInstance,
  MarkerInstanceId,
  MindMapDocumentV1,
  OrderKey,
  Point,
  SheetId,
  StyleBinding,
  TopicId,
} from '../domain/types';

export const BUILTIN_MARKER_LIBRARY_EXTENSION = 'app.nmdd.marker-library-key';
export const XMIND_MARKER_SOURCE_ID_EXTENSION = 'io.xmind.source-id';

export interface BuiltinMarkerDefinitionSpec {
  readonly key: string;
  readonly name: string;
  readonly semanticValue?: string | number | boolean;
}

export interface BuiltinMarkerGroupSpec {
  readonly key: 'priority' | 'progress' | 'flag' | 'star' | 'arrow';
  readonly name: string;
  readonly aliases: readonly string[];
  readonly exclusive: boolean;
  readonly definitions: readonly BuiltinMarkerDefinitionSpec[];
}

/** Product-owned, non-branded marker vocabulary; Task/To-do remain separate. */
export const BUILTIN_MARKER_LIBRARY: readonly BuiltinMarkerGroupSpec[] = Object.freeze([
  {
    key: 'priority',
    name: '优先级',
    aliases: ['priority'],
    exclusive: true,
    definitions: [1, 2, 3, 4, 5].map((value) => ({
      key: `priority-${value}`,
      name: `优先级 ${value}`,
      semanticValue: value,
    })),
  },
  {
    key: 'progress',
    name: '进度',
    aliases: ['progress'],
    exclusive: true,
    definitions: [0, 25, 50, 75, 100].map((value) => ({
      key: `progress-${value}`,
      name: `进度 ${value}%`,
      semanticValue: value,
    })),
  },
  {
    key: 'flag',
    name: '旗帜',
    aliases: ['flag', 'flags'],
    exclusive: true,
    definitions: [
      { key: 'flag-red', name: '红旗' },
      { key: 'flag-yellow', name: '黄旗' },
      { key: 'flag-green', name: '绿旗' },
      { key: 'flag-blue', name: '蓝旗' },
    ],
  },
  {
    key: 'star',
    name: '星标',
    aliases: ['star', 'stars'],
    exclusive: true,
    definitions: [
      { key: 'star-filled', name: '实心星标', semanticValue: true },
      { key: 'star-outline', name: '空心星标', semanticValue: false },
    ],
  },
  {
    key: 'arrow',
    name: '箭头',
    aliases: ['arrow', 'arrows'],
    exclusive: true,
    definitions: [
      { key: 'arrow-up', name: '向上箭头' },
      { key: 'arrow-right', name: '向右箭头' },
      { key: 'arrow-down', name: '向下箭头' },
      { key: 'arrow-left', name: '向左箭头' },
    ],
  },
]);

interface MarkerPlanningInput {
  readonly document: MindMapDocumentV1;
  readonly sheetId: SheetId;
  readonly commandId?: CommandId;
  readonly groupId?: string;
  readonly origin?: string;
  readonly timestamp?: string;
}

export type MarkerLegendCommand =
  | CreateMarkerGroupCommand
  | RenameMarkerGroupCommand
  | ReorderMarkerGroupCommand
  | DeleteMarkerGroupCommand
  | CreateMarkerDefinitionCommand
  | UpdateMarkerDefinitionCommand
  | ReorderMarkerDefinitionCommand
  | DeleteMarkerDefinitionCommand
  | AttachMarkerCommand
  | UpdateMarkerCommand
  | DetachMarkerCommand
  | PatchMarkerLegendCommand
  | MoveMarkerLegendCommand
  | ReorderMarkerLegendItemsCommand;

const commandMetadata = (input: MarkerPlanningInput) => ({
  commandId: input.commandId ?? createEntityId<'Command'>(),
  sheetId: input.sheetId,
  baseRevision: input.document.contentRevision,
  ...(input.groupId ? { groupId: input.groupId } : {}),
  origin: input.origin ?? 'mindmap-v2-marker-panel',
  timestamp: input.timestamp ?? new Date().toISOString(),
});

const canonicalName = (value: string, label: string): string => {
  const name = value.trim();
  if (!name || name.length > 512 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new Error(`${label}必须是 1–512 个字符，且不能包含控制字符。`);
  }
  return name;
};

const getSheet = (input: MarkerPlanningInput) => {
  const sheet = input.document.sheets[input.sheetId];
  if (!sheet) throw new Error(`Sheet ${input.sheetId} does not exist.`);
  return sheet;
};

const appendOrderKey = (last?: OrderKey): OrderKey => {
  if (last === undefined) return createOrderKeyBetween();
  try {
    return createOrderKeyBetween(last, null);
  } catch {
    if (last.length < 256) return `${last}~` as OrderKey;
    throw new Error('标记顺序空间已用尽，请先重排后再添加。');
  }
};

const groupLibraryKey = (
  document: MindMapDocumentV1,
  group: MarkerGroup,
): string | undefined => {
  const explicit = group.extensions?.[BUILTIN_MARKER_LIBRARY_EXTENSION];
  if (typeof explicit === 'string') return explicit;
  const lowerName = group.name.trim().toLocaleLowerCase('en-US');
  const sourceKeys = Object.values(document.markerDefinitions)
    .filter((definition) => definition.groupId === group.id && definition.source.kind === 'builtin')
    .map((definition) => definition.source.kind === 'builtin' ? definition.source.key : '');
  return BUILTIN_MARKER_LIBRARY.find((spec) =>
    spec.name === group.name
    || spec.aliases.includes(lowerName)
    || spec.definitions.some((definition) => sourceKeys.includes(definition.key)))?.key;
};

export const installedBuiltinMarkerKeys = (
  document: MindMapDocumentV1,
): ReadonlySet<string> => new Set(
  Object.values(document.markerGroups)
    .filter((group) => group.kind === 'builtin')
    .flatMap((group) => {
      const key = groupLibraryKey(document, group);
      return key ? [key] : [];
    }),
);

export const markerDefinitionsForGroup = (
  document: MindMapDocumentV1,
  groupId: MarkerGroupId,
): MarkerDefinition[] => Object.values(document.markerDefinitions)
  .filter((definition) => definition.groupId === groupId)
  .sort(compareOrderedEntities);

export const orderedMarkerGroups = (
  document: MindMapDocumentV1,
): MarkerGroup[] => Object.values(document.markerGroups).sort(compareOrderedEntities);

export const markerInstancesForTopic = (
  document: MindMapDocumentV1,
  sheetId: SheetId,
  topicId: TopicId,
): MarkerInstance[] => {
  const sheet = document.sheets[sheetId];
  if (!sheet?.topics[topicId]) return [];
  return Object.values(sheet.markerInstances)
    .filter((marker) => marker.topicId === topicId)
    .sort(compareOrderedEntities);
};

export interface PlanInstallBuiltinMarkerLibraryInput extends MarkerPlanningInput {}

/** Installs every missing standard group and definition as one undo unit. */
export const planInstallBuiltinMarkerLibraryCommand = (
  input: PlanInstallBuiltinMarkerLibraryInput,
): CreateMarkerGroupCommand => {
  getSheet(input);
  const installed = installedBuiltinMarkerKeys(input.document);
  const missing = BUILTIN_MARKER_LIBRARY.filter((spec) => !installed.has(spec.key));
  if (missing.length === 0) throw new Error('标准标记库已经完整安装。');

  const existingGroups = orderedMarkerGroups(input.document);
  let lastGroupOrderKey = existingGroups[existingGroups.length - 1]?.orderKey;
  const groups: MarkerGroup[] = [];
  const definitions: MarkerDefinition[] = [];
  for (const spec of missing) {
    const id = createEntityId<'MarkerGroup'>();
    const orderKey = appendOrderKey(lastGroupOrderKey);
    lastGroupOrderKey = orderKey;
    groups.push({
      id,
      orderKey,
      name: spec.name,
      kind: 'builtin',
      exclusive: spec.exclusive,
      extensions: {
        [BUILTIN_MARKER_LIBRARY_EXTENSION]: spec.key,
        [XMIND_MARKER_SOURCE_ID_EXTENSION]: spec.key,
      },
    });
    const definitionIds = spec.definitions.map(() => createEntityId<'MarkerDefinition'>());
    const orderKeys = rebalanceOrderKeys(definitionIds);
    spec.definitions.forEach((definition, index) => {
      const definitionId = definitionIds[index];
      definitions.push({
        id: definitionId,
        groupId: id,
        orderKey: orderKeys[definitionId],
        name: definition.name,
        source: { kind: 'builtin', key: definition.key },
        ...(definition.semanticValue !== undefined
          ? { semanticValue: definition.semanticValue }
          : {}),
      });
    });
  }
  return {
    ...commandMetadata(input),
    type: MIND_MAP_COMMAND_TYPES.createMarkerGroup,
    payload: { groups, definitions },
  };
};

export interface PlanCreateCustomMarkerGroupInput extends MarkerPlanningInput {
  readonly name: string;
  readonly exclusive: boolean;
  readonly markerGroupId?: MarkerGroupId;
}

export const planCreateCustomMarkerGroupCommand = (
  input: PlanCreateCustomMarkerGroupInput,
): CreateMarkerGroupCommand => {
  getSheet(input);
  const orderedGroups = orderedMarkerGroups(input.document);
  const last = orderedGroups[orderedGroups.length - 1];
  const group: MarkerGroup = {
    id: input.markerGroupId ?? createEntityId<'MarkerGroup'>(),
    orderKey: appendOrderKey(last?.orderKey),
    name: canonicalName(input.name, '自定义标记组名称'),
    kind: 'custom',
    exclusive: input.exclusive,
  };
  return {
    ...commandMetadata(input),
    type: MIND_MAP_COMMAND_TYPES.createMarkerGroup,
    payload: { groups: [group], definitions: [] },
  };
};

export interface PlanRenameMarkerGroupInput extends MarkerPlanningInput {
  readonly markerGroupId: MarkerGroupId;
  readonly name: string;
}

export const planRenameMarkerGroupCommand = (
  input: PlanRenameMarkerGroupInput,
): RenameMarkerGroupCommand => {
  if (!input.document.markerGroups[input.markerGroupId]) throw new Error('标记组不存在。');
  if (input.document.markerGroups[input.markerGroupId].kind !== 'custom') {
    throw new Error('内置标记组不能重命名。');
  }
  return {
    ...commandMetadata(input),
    type: MIND_MAP_COMMAND_TYPES.renameMarkerGroup,
    payload: {
      groupId: input.markerGroupId,
      name: canonicalName(input.name, '标记组名称'),
    },
  };
};

const adjacentSwap = <T extends { readonly id: string; readonly orderKey: OrderKey }>(
  ordered: readonly T[],
  id: string,
  direction: 'up' | 'down',
): readonly [T, T] => {
  const index = ordered.findIndex((entity) => entity.id === id);
  const otherIndex = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || otherIndex < 0 || otherIndex >= ordered.length) {
    throw new Error(direction === 'up' ? '已经位于最上方。' : '已经位于最下方。');
  }
  return [ordered[index], ordered[otherIndex]];
};

export interface PlanReorderMarkerGroupInput extends MarkerPlanningInput {
  readonly markerGroupId: MarkerGroupId;
  readonly direction: 'up' | 'down';
}

export const planReorderMarkerGroupCommand = (
  input: PlanReorderMarkerGroupInput,
): ReorderMarkerGroupCommand => {
  const [target, neighbor] = adjacentSwap(
    orderedMarkerGroups(input.document),
    input.markerGroupId,
    input.direction,
  );
  return {
    ...commandMetadata(input),
    type: MIND_MAP_COMMAND_TYPES.reorderMarkerGroup,
    payload: {
      updates: [
        { groupId: target.id, orderKey: neighbor.orderKey },
        { groupId: neighbor.id, orderKey: target.orderKey },
      ],
    },
  };
};

export interface MarkerDeleteImpact {
  readonly definitions: number;
  readonly instances: number;
  readonly legendItems: number;
}

export const markerGroupDeleteImpact = (
  document: MindMapDocumentV1,
  groupId: MarkerGroupId,
): MarkerDeleteImpact => {
  const definitionIds = new Set(markerDefinitionsForGroup(document, groupId).map(({ id }) => id));
  let instances = 0;
  let legendItems = 0;
  for (const sheet of Object.values(document.sheets)) {
    instances += Object.values(sheet.markerInstances)
      .filter((marker) => definitionIds.has(marker.markerDefinitionId)).length;
    legendItems += (sheet.markerLegend.itemOrder ?? [])
      .filter((definitionId) => definitionIds.has(definitionId)).length;
  }
  return { definitions: definitionIds.size, instances, legendItems };
};

export interface PlanDeleteMarkerGroupInput extends MarkerPlanningInput {
  readonly markerGroupId: MarkerGroupId;
}

export const planDeleteMarkerGroupCommand = (
  input: PlanDeleteMarkerGroupInput,
): DeleteMarkerGroupCommand => {
  const group = input.document.markerGroups[input.markerGroupId];
  if (!group) throw new Error('标记组不存在。');
  if (group.kind === 'builtin') throw new Error('内置标记组不能删除。');
  return {
    ...commandMetadata(input),
    type: MIND_MAP_COMMAND_TYPES.deleteMarkerGroup,
    payload: { groupId: input.markerGroupId },
  };
};

export interface PlanCreateMarkerDefinitionInput extends MarkerPlanningInput {
  readonly markerGroupId: MarkerGroupId;
  readonly name: string;
  readonly sourceKey?: string;
  readonly semanticValue?: string | number | boolean;
  readonly markerDefinitionId?: MarkerDefinitionId;
}

export const planCreateMarkerDefinitionCommand = (
  input: PlanCreateMarkerDefinitionInput,
): CreateMarkerDefinitionCommand => {
  const group = input.document.markerGroups[input.markerGroupId];
  if (!group) throw new Error('标记组不存在。');
  if (group.kind !== 'custom') throw new Error('只能向自定义标记组添加定义。');
  const definitions = markerDefinitionsForGroup(input.document, input.markerGroupId);
  const name = canonicalName(input.name, '标记名称');
  const sourceKey = canonicalName(input.sourceKey ?? 'custom-diamond', '标记图形键').slice(0, 256);
  const definition: MarkerDefinition = {
    id: input.markerDefinitionId ?? createEntityId<'MarkerDefinition'>(),
    groupId: group.id,
    orderKey: appendOrderKey(definitions[definitions.length - 1]?.orderKey),
    name,
    source: { kind: 'builtin', key: sourceKey },
    ...(input.semanticValue !== undefined ? { semanticValue: input.semanticValue } : {}),
  };
  return {
    ...commandMetadata(input),
    type: MIND_MAP_COMMAND_TYPES.createMarkerDefinition,
    payload: { definition },
  };
};

export interface PlanUpdateMarkerDefinitionInput extends MarkerPlanningInput {
  readonly markerDefinitionId: MarkerDefinitionId;
  readonly name?: string;
  readonly sourceKey?: string;
  readonly semanticValue?: string | number | boolean | null;
}

export const planUpdateMarkerDefinitionCommand = (
  input: PlanUpdateMarkerDefinitionInput,
): UpdateMarkerDefinitionCommand => {
  const current = input.document.markerDefinitions[input.markerDefinitionId];
  if (!current) throw new Error('标记定义不存在。');
  if (input.document.markerGroups[current.groupId]?.kind !== 'custom') {
    throw new Error('内置标记定义不能修改。');
  }
  const definition: MarkerDefinition = {
    ...current,
    ...(input.name !== undefined ? { name: canonicalName(input.name, '标记名称') } : {}),
    ...(input.sourceKey !== undefined
      ? { source: { kind: 'builtin' as const, key: canonicalName(input.sourceKey, '标记图形键').slice(0, 256) } }
      : {}),
  };
  if (input.semanticValue === null) delete definition.semanticValue;
  else if (input.semanticValue !== undefined) definition.semanticValue = input.semanticValue;
  return {
    ...commandMetadata(input),
    type: MIND_MAP_COMMAND_TYPES.updateMarkerDefinition,
    payload: { definition },
  };
};

export interface PlanReorderMarkerDefinitionInput extends MarkerPlanningInput {
  readonly markerDefinitionId: MarkerDefinitionId;
  readonly direction: 'up' | 'down';
}

export const planReorderMarkerDefinitionCommand = (
  input: PlanReorderMarkerDefinitionInput,
): ReorderMarkerDefinitionCommand => {
  const definition = input.document.markerDefinitions[input.markerDefinitionId];
  if (!definition) throw new Error('标记定义不存在。');
  if (input.document.markerGroups[definition.groupId]?.kind !== 'custom') {
    throw new Error('内置标记定义不能重排。');
  }
  const [target, neighbor] = adjacentSwap(
    markerDefinitionsForGroup(input.document, definition.groupId),
    definition.id,
    input.direction,
  );
  return {
    ...commandMetadata(input),
    type: MIND_MAP_COMMAND_TYPES.reorderMarkerDefinition,
    payload: {
      updates: [
        { definitionId: target.id, orderKey: neighbor.orderKey },
        { definitionId: neighbor.id, orderKey: target.orderKey },
      ],
    },
  };
};

export const markerDefinitionDeleteImpact = (
  document: MindMapDocumentV1,
  definitionId: MarkerDefinitionId,
): Omit<MarkerDeleteImpact, 'definitions'> => {
  let instances = 0;
  let legendItems = 0;
  for (const sheet of Object.values(document.sheets)) {
    instances += Object.values(sheet.markerInstances)
      .filter((marker) => marker.markerDefinitionId === definitionId).length;
    legendItems += (sheet.markerLegend.itemOrder ?? [])
      .filter((candidate) => candidate === definitionId).length;
  }
  return { instances, legendItems };
};

export interface PlanDeleteMarkerDefinitionInput extends MarkerPlanningInput {
  readonly markerDefinitionId: MarkerDefinitionId;
}

export const planDeleteMarkerDefinitionCommand = (
  input: PlanDeleteMarkerDefinitionInput,
): DeleteMarkerDefinitionCommand => {
  const definition = input.document.markerDefinitions[input.markerDefinitionId];
  if (!definition) {
    throw new Error('标记定义不存在。');
  }
  if (input.document.markerGroups[definition.groupId]?.kind !== 'custom') {
    throw new Error('内置标记定义不能删除。');
  }
  return {
    ...commandMetadata(input),
    type: MIND_MAP_COMMAND_TYPES.deleteMarkerDefinition,
    payload: { definitionId: input.markerDefinitionId },
  };
};

const topicAndDefinition = (
  input: MarkerPlanningInput,
  topicId: TopicId,
  definitionId: MarkerDefinitionId,
) => {
  const sheet = getSheet(input);
  if (!sheet.topics[topicId]) throw new Error('主题不存在。');
  const definition = input.document.markerDefinitions[definitionId];
  if (!definition) throw new Error('标记定义不存在。');
  const group = input.document.markerGroups[definition.groupId];
  if (!group) throw new Error('标记组不存在。');
  return { sheet, definition, group };
};

export interface PlanAttachTopicMarkerInput extends MarkerPlanningInput {
  readonly topicId: TopicId;
  readonly markerDefinitionId: MarkerDefinitionId;
  readonly markerInstanceId?: MarkerInstanceId;
  readonly value?: string | number | boolean;
}

export const planAttachTopicMarkerCommand = (
  input: PlanAttachTopicMarkerInput,
): AttachMarkerCommand | UpdateMarkerCommand => {
  const { sheet, group } = topicAndDefinition(input, input.topicId, input.markerDefinitionId);
  const topicMarkers = markerInstancesForTopic(input.document, input.sheetId, input.topicId);
  const sameDefinition = topicMarkers.find(
    (marker) => marker.markerDefinitionId === input.markerDefinitionId,
  );
  if (sameDefinition) throw new Error('当前主题已经包含该标记。');
  const existingInExclusiveGroup = group.exclusive
    ? topicMarkers.find((marker) =>
        input.document.markerDefinitions[marker.markerDefinitionId]?.groupId === group.id)
    : undefined;
  if (existingInExclusiveGroup) {
    const marker: MarkerInstance = {
      id: existingInExclusiveGroup.id,
      topicId: input.topicId,
      markerDefinitionId: input.markerDefinitionId,
      orderKey: existingInExclusiveGroup.orderKey,
      ...(input.value !== undefined ? { value: input.value } : {}),
    };
    return {
      ...commandMetadata(input),
      type: MIND_MAP_COMMAND_TYPES.updateMarker,
      payload: { marker },
    };
  }

  const marker: MarkerInstance = {
    id: input.markerInstanceId ?? createEntityId<'MarkerInstance'>(),
    topicId: input.topicId,
    markerDefinitionId: input.markerDefinitionId,
    orderKey: appendOrderKey(topicMarkers[topicMarkers.length - 1]?.orderKey),
    ...(input.value !== undefined ? { value: input.value } : {}),
  };
  // Access is deliberate: it ensures a stale sheet fails during planning,
  // before the command reaches the engine.
  void sheet.topics[input.topicId];
  return {
    ...commandMetadata(input),
    type: MIND_MAP_COMMAND_TYPES.attachMarker,
    payload: { marker },
  };
};

export interface PlanUpdateTopicMarkerInput extends MarkerPlanningInput {
  readonly markerInstanceId: MarkerInstanceId;
  readonly markerDefinitionId?: MarkerDefinitionId;
  readonly value?: string | number | boolean | null;
}

export const planUpdateTopicMarkerCommand = (
  input: PlanUpdateTopicMarkerInput,
): UpdateMarkerCommand => {
  const sheet = getSheet(input);
  const current = sheet.markerInstances[input.markerInstanceId];
  if (!current) throw new Error('主题标记不存在。');
  const definitionId = input.markerDefinitionId ?? current.markerDefinitionId;
  topicAndDefinition(input, current.topicId, definitionId);
  const marker: MarkerInstance = {
    ...current,
    markerDefinitionId: definitionId,
  };
  if (input.value === null) delete marker.value;
  else if (input.value !== undefined) marker.value = input.value;
  return {
    ...commandMetadata(input),
    type: MIND_MAP_COMMAND_TYPES.updateMarker,
    payload: { marker },
  };
};

export interface PlanDetachTopicMarkerInput extends MarkerPlanningInput {
  readonly markerInstanceId: MarkerInstanceId;
}

export const planDetachTopicMarkerCommand = (
  input: PlanDetachTopicMarkerInput,
): DetachMarkerCommand => {
  if (!getSheet(input).markerInstances[input.markerInstanceId]) {
    throw new Error('主题标记不存在。');
  }
  return {
    ...commandMetadata(input),
    type: MIND_MAP_COMMAND_TYPES.detachMarker,
    payload: { markerInstanceId: input.markerInstanceId },
  };
};

export type TopicMarkerToggleCommand = AttachMarkerCommand | UpdateMarkerCommand | DetachMarkerCommand;

export interface PlanToggleTopicMarkerInput extends MarkerPlanningInput {
  readonly topicId: TopicId;
  readonly markerDefinitionId: MarkerDefinitionId;
}

export const planToggleTopicMarkerCommand = (
  input: PlanToggleTopicMarkerInput,
): TopicMarkerToggleCommand => {
  const active = markerInstancesForTopic(input.document, input.sheetId, input.topicId)
    .find((marker) => marker.markerDefinitionId === input.markerDefinitionId);
  return active
    ? planDetachTopicMarkerCommand({ ...input, markerInstanceId: active.id })
    : planAttachTopicMarkerCommand(input);
};

export interface PlanPatchMarkerLegendInput extends MarkerPlanningInput {
  readonly visible?: boolean;
  readonly title?: string | null;
  readonly style?: StyleBinding | null;
}

export const planPatchMarkerLegendCommand = (
  input: PlanPatchMarkerLegendInput,
): PatchMarkerLegendCommand => {
  getSheet(input);
  const patch: PatchMarkerLegendCommand['payload']['patch'] = {
    ...(input.visible !== undefined ? { visible: input.visible } : {}),
    ...(input.title !== undefined
      ? { title: input.title === null ? null : canonicalName(input.title, '图例标题') }
      : {}),
    ...(input.style !== undefined ? { style: input.style } : {}),
  };
  if (Object.keys(patch).length === 0) throw new Error('没有可更新的图例字段。');
  return {
    ...commandMetadata(input),
    type: MIND_MAP_COMMAND_TYPES.patchMarkerLegend,
    payload: { patch },
  };
};

export interface PlanMoveMarkerLegendInput extends MarkerPlanningInput {
  readonly position: Point;
}

export const planMoveMarkerLegendCommand = (
  input: PlanMoveMarkerLegendInput,
): MoveMarkerLegendCommand => {
  getSheet(input);
  if (!Number.isFinite(input.position.x) || !Number.isFinite(input.position.y)) {
    throw new Error('图例位置必须是有限坐标。');
  }
  return {
    ...commandMetadata(input),
    type: MIND_MAP_COMMAND_TYPES.moveMarkerLegend,
    payload: { position: { ...input.position } },
  };
};

export interface PlanReorderMarkerLegendItemsInput extends MarkerPlanningInput {
  readonly itemOrder: readonly MarkerDefinitionId[];
}

export const planReorderMarkerLegendItemsCommand = (
  input: PlanReorderMarkerLegendItemsInput,
): ReorderMarkerLegendItemsCommand => {
  getSheet(input);
  const itemOrder = [...new Set(input.itemOrder)];
  if (itemOrder.length !== input.itemOrder.length) throw new Error('图例项目不能重复。');
  for (const definitionId of itemOrder) {
    if (!input.document.markerDefinitions[definitionId]) throw new Error('图例引用了不存在的标记。');
  }
  return {
    ...commandMetadata(input),
    type: MIND_MAP_COMMAND_TYPES.reorderMarkerLegendItems,
    payload: { itemOrder },
  };
};

export const markerLegendDefinitionIds = (
  document: MindMapDocumentV1,
  sheetId: SheetId,
): MarkerDefinitionId[] => {
  const sheet = document.sheets[sheetId];
  if (!sheet) return [];
  if (sheet.markerLegend.itemOrder !== undefined) return [...sheet.markerLegend.itemOrder];
  const usedIds = new Set(
    Object.values(sheet.markerInstances).map((marker) => marker.markerDefinitionId),
  );
  return orderedMarkerGroups(document).flatMap((group) =>
    markerDefinitionsForGroup(document, group.id)
      .filter((definition) => usedIds.has(definition.id))
      .map((definition) => definition.id));
};
