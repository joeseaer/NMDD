import {
  createRichText,
  createTopic,
} from '../domain/defaults';
import { createEntityId } from '../domain/ids';
import {
  projectSummaryScopeNormalizationAfter,
} from '../domain/semanticScope';
import {
  createOrderKeyBetween,
  isGeneratedOrderKey,
  rebalanceOrderKeys,
} from '../domain/orderKey';
import { getDescendants, getIncomingTreeEdges, getParentEdge } from '../domain/tree';
import type {
  BranchSide,
  CommandId,
  MindMapDocumentV1,
  OrderKey,
  RichText,
  SheetId,
  TopicId,
  TreeEdge,
  TreeEdgeId,
} from '../domain/types';
import {
  MIND_MAP_COMMAND_TYPES,
  type CreateTopicCommand,
  type DeleteCurrentTopicCommand,
  type DeleteTopicSubtreeCommand,
  type InsertParentTopicCommand,
  type ToggleTopicCollapseCommand,
  type UpdateTopicTitleCommand,
} from '../commands/types';
import { materializeBoundaryScopeChanges } from './boundaryScopePlanning';
import { materializeSummaryScopeChanges } from './summaryScopePlanning';

export interface PlannedCommandIds {
  readonly commandId: CommandId;
  readonly topicId: TopicId;
  readonly treeEdgeId: TreeEdgeId;
}

export interface PlanCreateTopicInput {
  readonly document: MindMapDocumentV1;
  readonly sheetId: SheetId;
  readonly parentTopicId: TopicId;
  readonly title?: string;
  readonly side?: BranchSide;
  readonly groupId?: string;
  readonly origin?: string;
  readonly timestamp?: string;
  readonly ids?: PlannedCommandIds;
  /** Optional exact sibling insertion used by Enter/Shift+Enter and menus. */
  readonly insertion?: {
    readonly relativeTopicId: TopicId;
    readonly position: 'before' | 'after';
  };
}

const createPlannedIds = (): PlannedCommandIds => ({
  commandId: createEntityId<'Command'>(),
  topicId: createEntityId<'Topic'>(),
  treeEdgeId: createEntityId<'TreeEdge'>(),
});

/** Returns a generated, collision-free key without rewriting sibling keys. */
export const createAvailableOrderKey = (
  existingKeys: readonly OrderKey[],
): OrderKey => {
  const occupied = new Set(existingKeys);
  if (occupied.size === 0) return createOrderKeyBetween();
  const ordered = [...occupied].sort();
  const maximum = ordered[ordered.length - 1];
  if (isGeneratedOrderKey(maximum)) {
    try {
      const candidate = createOrderKeyBetween(maximum, null);
      if (!occupied.has(candidate)) return candidate;
    } catch {
      // A legal ASCII suffix below is still deterministic and append-only.
    }
  }

  if (maximum.length >= 256) {
    throw new Error('No append-only orderKey fits the 256-character limit.');
  }
  const candidate = `${maximum}~` as OrderKey;
  if (occupied.has(candidate)) {
    throw new Error('Could not create a collision-free append orderKey.');
  }
  return candidate;
};

/** Finds a non-conflicting key between arbitrary canonical/migrated neighbors. */
export const createAvailableOrderKeyBetween = (
  existingKeys: readonly OrderKey[],
  before: OrderKey | null,
  after: OrderKey | null,
): OrderKey => {
  const occupied = new Set(existingKeys);
  if (before !== null && after !== null && before >= after) {
    throw new Error('Sibling order neighbors must be strictly increasing.');
  }
  if (before === null && after === null) return createAvailableOrderKey(existingKeys);

  if (
    (before === null || isGeneratedOrderKey(before))
    && (after === null || isGeneratedOrderKey(after))
  ) {
    const candidate = createOrderKeyBetween(before, after);
    if (!occupied.has(candidate)) return candidate;
  }

  if (after === null) return createAvailableOrderKey(existingKeys);
  if (before === null) {
    for (let code = 32; code < 127; code += 1) {
      const candidate = String.fromCharCode(code) as OrderKey;
      if (candidate < after && !occupied.has(candidate)) return candidate;
    }
    throw new Error('No printable orderKey fits before the first sibling; rebalance is required.');
  }

  if (before.length < 256) {
    const appended = `${before}~` as OrderKey;
    if (appended < after && !occupied.has(appended)) return appended;
    for (let code = 126; code >= 32; code -= 1) {
      const candidate = `${before}${String.fromCharCode(code)}` as OrderKey;
      if (candidate < after && !occupied.has(candidate)) return candidate;
    }
  }
  throw new Error('No printable orderKey fits between siblings; rebalance is required.');
};

const defaultSideForParent = (
  document: MindMapDocumentV1,
  sheetId: SheetId,
  parentTopicId: TopicId,
): BranchSide => {
  const sheet = document.sheets[sheetId];
  const inherited = getParentEdge(sheet, parentTopicId)?.side;
  if (inherited && inherited !== 'inherit' && inherited !== 'center') return inherited;
  const direction = sheet.defaultBranchLayout.direction;
  if (direction === 'right-to-left') return 'left';
  if (direction === 'top-to-bottom') return 'bottom';
  if (direction === 'bottom-to-top') return 'top';
  return 'right';
};

export const planCreateTopicCommand = (
  input: PlanCreateTopicInput,
): CreateTopicCommand => {
  const sheet = input.document.sheets[input.sheetId];
  if (!sheet) throw new Error(`Sheet ${input.sheetId} does not exist.`);
  if (!sheet.topics[input.parentTopicId]) {
    throw new Error(`Parent topic ${input.parentTopicId} does not exist.`);
  }
  const siblingKeys = Object.values(sheet.treeEdges)
    .filter((edge) => edge.parentTopicId === input.parentTopicId)
    .map((edge) => edge.orderKey);
  const insertionEdge = input.insertion
    ? getParentEdge(sheet, input.insertion.relativeTopicId)
    : undefined;
  if (input.insertion && !insertionEdge) {
    throw new Error(`Relative topic ${input.insertion.relativeTopicId} has no structural parent.`);
  }
  if (insertionEdge && insertionEdge.parentTopicId !== input.parentTopicId) {
    throw new Error(
      `Relative topic ${insertionEdge.childTopicId} is not a child of ${input.parentTopicId}.`,
    );
  }
  const orderedSiblings = insertionEdge
    ? Object.values(sheet.treeEdges)
        .filter((edge) => edge.parentTopicId === input.parentTopicId)
        .sort((left, right) =>
          left.orderKey.localeCompare(right.orderKey) || left.id.localeCompare(right.id))
    : [];
  const insertionIndex = insertionEdge
    ? orderedSiblings.findIndex((edge) => edge.id === insertionEdge.id)
    : -1;
  const orderKey = insertionEdge && input.insertion
    ? createAvailableOrderKeyBetween(
        siblingKeys,
        input.insertion.position === 'after'
          ? insertionEdge.orderKey
          : orderedSiblings[insertionIndex - 1]?.orderKey ?? null,
        input.insertion.position === 'after'
          ? orderedSiblings[insertionIndex + 1]?.orderKey ?? null
          : insertionEdge.orderKey,
      )
    : createAvailableOrderKey(siblingKeys);
  const ids = input.ids ?? createPlannedIds();
  return {
    commandId: ids.commandId,
    type: MIND_MAP_COMMAND_TYPES.createTopic,
    sheetId: input.sheetId,
    payload: {
      topic: createTopic({ id: ids.topicId, title: input.title ?? '新主题' }),
      edge: {
        id: ids.treeEdgeId,
        parentTopicId: input.parentTopicId,
        childTopicId: ids.topicId,
        orderKey,
        side: input.side
          ?? insertionEdge?.side
          ?? defaultSideForParent(input.document, input.sheetId, input.parentTopicId),
        ...(insertionEdge?.slot === undefined ? {} : { slot: insertionEdge.slot }),
      },
    },
    baseRevision: input.document.contentRevision,
    ...(input.groupId ? { groupId: input.groupId } : {}),
    origin: input.origin ?? 'mindmap-v2-ui',
    timestamp: input.timestamp ?? new Date().toISOString(),
  };
};

interface BaseTopicCommandInput {
  readonly document: MindMapDocumentV1;
  readonly sheetId: SheetId;
  readonly topicId: TopicId;
  readonly commandId?: CommandId;
  readonly groupId?: string;
  readonly origin?: string;
  readonly timestamp?: string;
}

const commandMetadata = (input: BaseTopicCommandInput) => ({
  commandId: input.commandId ?? createEntityId<'Command'>(),
  sheetId: input.sheetId,
  baseRevision: input.document.contentRevision,
  ...(input.groupId ? { groupId: input.groupId } : {}),
  origin: input.origin ?? 'mindmap-v2-ui',
  timestamp: input.timestamp ?? new Date().toISOString(),
});

export interface PlanInsertParentTopicInput extends BaseTopicCommandInput {
  readonly title?: string;
  /** IDs for every newly created canonical entity, injectable for replay/tests. */
  readonly ids?: PlannedCommandIds;
}

export const planInsertParentTopicCommand = (
  input: PlanInsertParentTopicInput,
): InsertParentTopicCommand => {
  const sheet = input.document.sheets[input.sheetId];
  if (!sheet) throw new Error(`Sheet ${input.sheetId} does not exist.`);
  const topic = sheet.topics[input.topicId];
  if (!topic) throw new Error(`Topic ${input.topicId} does not exist.`);
  if (input.topicId === sheet.rootTopicId || topic.role === 'central') {
    throw new Error('The sheet central root cannot receive an inserted parent topic.');
  }
  if (topic.role === 'floating-root' || topic.role === 'summary-result') {
    throw new Error(`Topic role ${topic.role} has no structural parent to replace.`);
  }
  const incomingEdges = getIncomingTreeEdges(sheet, input.topicId);
  if (incomingEdges.length !== 1) {
    throw new Error(`Topic ${input.topicId} must have exactly one incoming edge.`);
  }
  const incoming = incomingEdges[0];
  const ids = input.ids ?? createPlannedIds();
  const childEdge: TreeEdge = {
    id: ids.treeEdgeId,
    parentTopicId: ids.topicId,
    childTopicId: input.topicId,
    orderKey: incoming.orderKey,
    side: incoming.side,
    ...(incoming.slot === undefined ? {} : { slot: incoming.slot }),
  };
  return {
    ...commandMetadata({ ...input, commandId: ids.commandId }),
    type: MIND_MAP_COMMAND_TYPES.insertParentTopic,
    payload: {
      topicId: input.topicId,
      parentTopic: createTopic({ id: ids.topicId, title: input.title ?? '新主题' }),
      childEdge,
    },
  };
};

const compareTreeEdges = (left: TreeEdge, right: TreeEdge): number =>
  (left.orderKey < right.orderKey ? -1 : left.orderKey > right.orderKey ? 1 : 0)
  || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);

export const planDeleteCurrentTopicCommand = (
  input: BaseTopicCommandInput,
): DeleteCurrentTopicCommand => {
  const sheet = input.document.sheets[input.sheetId];
  if (!sheet) throw new Error(`Sheet ${input.sheetId} does not exist.`);
  const topic = sheet.topics[input.topicId];
  if (!topic) throw new Error(`Topic ${input.topicId} does not exist.`);
  if (input.topicId === sheet.rootTopicId || topic.role === 'central') {
    throw new Error('The sheet central root cannot be deleted while preserving its children.');
  }
  if (topic.role === 'floating-root' || topic.role === 'summary-result') {
    throw new Error(`Topic role ${topic.role} has no structural parent for child promotion.`);
  }
  const incomingEdges = getIncomingTreeEdges(sheet, input.topicId);
  if (incomingEdges.length !== 1) {
    throw new Error(`Topic ${input.topicId} must have exactly one incoming edge.`);
  }
  const incoming = incomingEdges[0];
  const directChildren = Object.values(sheet.treeEdges)
    .filter((edge) => edge.parentTopicId === input.topicId)
    .sort(compareTreeEdges);
  const siblingGroup = Object.values(sheet.treeEdges)
    .filter((edge) =>
      edge.parentTopicId === incoming.parentTopicId
      && edge.side === incoming.side
      && edge.slot === incoming.slot)
    .sort(compareTreeEdges);
  const finalEdgeIds = siblingGroup.flatMap((edge) =>
    edge.id === incoming.id ? directChildren.map((child) => child.id) : [edge.id]);
  const orderKeys = rebalanceOrderKeys(finalEdgeIds);
  const promotedEdges = directChildren.map<TreeEdge>((edge) => {
    const promoted: TreeEdge = {
      ...edge,
      parentTopicId: incoming.parentTopicId,
      orderKey: orderKeys[edge.id],
      side: incoming.side,
    };
    if (incoming.slot === undefined) delete promoted.slot;
    else promoted.slot = incoming.slot;
    return promoted;
  });
  const siblingOrderUpdates = siblingGroup
    .filter((edge) => edge.id !== incoming.id && edge.orderKey !== orderKeys[edge.id])
    .map((edge) => ({ edgeId: edge.id, orderKey: orderKeys[edge.id] }));
  const after = structuredClone(sheet);
  for (const update of siblingOrderUpdates) {
    after.treeEdges[update.edgeId].orderKey = update.orderKey;
  }
  delete after.treeEdges[incoming.id];
  for (const edge of promotedEdges) after.treeEdges[edge.id] = structuredClone(edge);
  delete after.topics[input.topicId];
  const summaryScopeChanges = materializeSummaryScopeChanges({ before: sheet, after });
  const normalizedAfter = projectSummaryScopeNormalizationAfter(sheet, after);
  const boundaryScopeChanges = materializeBoundaryScopeChanges({ before: sheet, after: normalizedAfter });

  return {
    ...commandMetadata(input),
    type: MIND_MAP_COMMAND_TYPES.deleteCurrentTopic,
    payload: {
      topicId: input.topicId,
      promotedEdges,
      siblingOrderUpdates,
      ...(summaryScopeChanges.length === 0 ? {} : { summaryScopeChanges }),
      ...(boundaryScopeChanges.length === 0 ? {} : { boundaryScopeChanges }),
    },
  };
};

export const planUpdateTopicTitleCommand = (
  input: BaseTopicCommandInput & { readonly title: string | RichText },
): UpdateTopicTitleCommand => ({
  ...commandMetadata(input),
  type: MIND_MAP_COMMAND_TYPES.updateTopicTitle,
  payload: {
    topicId: input.topicId,
    title: typeof input.title === 'string'
      ? createRichText(input.title)
      : structuredClone(input.title),
  },
});

export const planDeleteTopicSubtreeCommand = (
  input: BaseTopicCommandInput,
): DeleteTopicSubtreeCommand => {
  const sheet = input.document.sheets[input.sheetId];
  if (!sheet?.topics[input.topicId]) {
    throw new Error(`Topic ${input.topicId} does not exist.`);
  }
  const deletedTopicIds = new Set<TopicId>([
    input.topicId,
    ...getDescendants(sheet, input.topicId).map((topic) => topic.id),
  ]);
  const after = structuredClone(sheet);
  for (const topicId of deletedTopicIds) delete after.topics[topicId];
  for (const edge of Object.values(after.treeEdges)) {
    if (deletedTopicIds.has(edge.parentTopicId) || deletedTopicIds.has(edge.childTopicId)) {
      delete after.treeEdges[edge.id];
    }
  }
  const summaryScopeChanges = materializeSummaryScopeChanges({ before: sheet, after });
  const normalizedAfter = projectSummaryScopeNormalizationAfter(sheet, after);
  const boundaryScopeChanges = materializeBoundaryScopeChanges({ before: sheet, after: normalizedAfter });
  return {
    ...commandMetadata(input),
    type: MIND_MAP_COMMAND_TYPES.deleteTopicSubtree,
    payload: {
      topicId: input.topicId,
      ...(summaryScopeChanges.length === 0 ? {} : { summaryScopeChanges }),
      ...(boundaryScopeChanges.length === 0 ? {} : { boundaryScopeChanges }),
    },
  };
};

export const planToggleTopicCollapseCommand = (
  input: BaseTopicCommandInput & { readonly collapsed?: boolean },
): ToggleTopicCollapseCommand => ({
  ...commandMetadata(input),
  type: MIND_MAP_COMMAND_TYPES.toggleTopicCollapse,
  payload: {
    topicId: input.topicId,
    ...(input.collapsed === undefined ? {} : { collapsed: input.collapsed }),
  },
});
