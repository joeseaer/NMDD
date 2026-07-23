import { createEntityId } from '../domain/ids';
import { wouldCreateCycle, getChildEdgesSorted, getDescendants, getParentEdge } from '../domain/tree';
import type {
  BranchSide,
  CommandId,
  MindMapDocumentV1,
  MindMapSheet,
  OrderKey,
  SheetId,
  TopicId,
  TreeEdge,
  TreeEdgeId,
} from '../domain/types';
import {
  MIND_MAP_COMMAND_TYPES,
  type ReorderTopicCommand,
  type ReparentTopicCommand,
} from '../commands/types';
import { createAvailableOrderKey } from './commandPlanning';
import { materializeBoundaryScopeChanges } from './boundaryScopePlanning';
import { materializeSummaryScopeChanges } from './summaryScopePlanning';
import { projectSummaryScopeNormalizationAfter } from '../domain/semanticScope';

const ORDER_KEY_ALPHABET = '-.0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz~';

export interface TopicRect {
  readonly id: TopicId;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type TopicDropIntent =
  | { readonly kind: 'none'; readonly reason: string }
  | { readonly kind: 'reparent'; readonly parentTopicId: TopicId }
  | { readonly kind: 'reorder'; readonly parentTopicId: TopicId; readonly index: number };

const center = (rect: TopicRect): { x: number; y: number } => ({
  x: rect.x + rect.width / 2,
  y: rect.y + rect.height / 2,
});

const containsCenter = (container: TopicRect, point: { x: number; y: number }): boolean => {
  const padding = 14;
  return point.x >= container.x - padding
    && point.x <= container.x + container.width + padding
    && point.y >= container.y - padding
    && point.y <= container.y + container.height + padding;
};

const primaryAxis = (sheet: MindMapSheet): 'x' | 'y' => {
  const direction = sheet.defaultBranchLayout.direction;
  return direction === 'top-to-bottom' || direction === 'bottom-to-top' ? 'x' : 'y';
};

/** Converts a drag stop into a deterministic structural intent. */
export const detectTopicDropIntent = (input: {
  readonly sheet: MindMapSheet;
  readonly topicId: TopicId;
  readonly dragged: TopicRect;
  readonly topics: readonly TopicRect[];
}): TopicDropIntent => {
  const { sheet, topicId, dragged, topics } = input;
  if (topicId === sheet.rootTopicId) return { kind: 'none', reason: 'central-topic' };
  const incoming = getParentEdge(sheet, topicId);
  if (!incoming) return { kind: 'none', reason: 'floating-topic' };
  const excludedParents = new Set<TopicId>([
    topicId,
    ...getDescendants(sheet, topicId).map((topic) => topic.id),
  ]);
  const point = center(dragged);
  const parentCandidate = topics
    .filter((candidate) => !excludedParents.has(candidate.id))
    .filter((candidate) => containsCenter(candidate, point))
    .sort((left, right) => {
      const leftCenter = center(left);
      const rightCenter = center(right);
      const leftDistance = Math.hypot(leftCenter.x - point.x, leftCenter.y - point.y);
      const rightDistance = Math.hypot(rightCenter.x - point.x, rightCenter.y - point.y);
      return leftDistance - rightDistance || (left.id < right.id ? -1 : 1);
    })[0];
  if (parentCandidate && parentCandidate.id !== incoming.parentTopicId) {
    return { kind: 'reparent', parentTopicId: parentCandidate.id };
  }

  const siblingIds = getChildEdgesSorted(sheet, incoming.parentTopicId)
    .map((edge) => edge.childTopicId);
  const currentIndex = siblingIds.indexOf(topicId);
  const remaining = siblingIds.filter((id) => id !== topicId);
  const rectById = new Map(topics.map((topic) => [topic.id, topic] as const));
  const axis = primaryAxis(sheet);
  const coordinate = axis === 'x' ? point.x : point.y;
  let nextIndex = remaining.findIndex((id) => {
    const rect = rectById.get(id);
    if (!rect) return false;
    const siblingCenter = center(rect);
    return coordinate < (axis === 'x' ? siblingCenter.x : siblingCenter.y);
  });
  if (nextIndex < 0) nextIndex = remaining.length;
  const unchangedIndex = currentIndex < 0 ? nextIndex : currentIndex;
  if (nextIndex === unchangedIndex) return { kind: 'none', reason: 'unchanged' };
  return { kind: 'reorder', parentTopicId: incoming.parentTopicId, index: nextIndex };
};

/**
 * Creates a key between arbitrary legacy/generated ASCII keys. The only
 * impossible case is the adjacent prefix pair `a` / `a-`, which requires a
 * sibling rebalance instead of silently creating a duplicate.
 */
export const createAsciiOrderKeyBetween = (
  before?: OrderKey | null,
  after?: OrderKey | null,
): OrderKey => {
  if (before == null && after == null) return createAvailableOrderKey([]);
  if (before == null) {
    const first = after?.[0];
    const index = first ? ORDER_KEY_ALPHABET.indexOf(first) : -1;
    if (index <= 0) throw new Error('Sibling order keys require rebalance before insertion.');
    return ORDER_KEY_ALPHABET[Math.floor((index - 1) / 2)] as OrderKey;
  }
  if (after == null) {
    if (before.length >= 256) throw new Error('Sibling order key reached its maximum length.');
    return `${before}~`;
  }
  if (before >= after) throw new Error('Order key neighbors are not strictly ordered.');
  if (!after.startsWith(before)) {
    if (before.length >= 256) throw new Error('Sibling order key reached its maximum length.');
    return `${before}~`;
  }
  const nextCharacter = after[before.length];
  const index = ORDER_KEY_ALPHABET.indexOf(nextCharacter);
  if (index <= 0 || before.length >= 256) {
    throw new Error('Sibling order keys require rebalance before insertion.');
  }
  return `${before}${ORDER_KEY_ALPHABET[Math.floor((index - 1) / 2)]}`;
};

interface PlannerMetadata {
  readonly document: MindMapDocumentV1;
  readonly sheetId: SheetId;
  readonly topicId: TopicId;
  readonly commandId?: CommandId;
  readonly groupId?: string;
  readonly timestamp?: string;
  readonly origin?: string;
}

const sideForReparent = (
  sheet: MindMapSheet,
  parentTopicId: TopicId,
  incomingSide: BranchSide | undefined,
  explicitSide: BranchSide | undefined,
): BranchSide => {
  if (explicitSide) return explicitSide;
  if (parentTopicId !== sheet.rootTopicId) return 'inherit';
  if (incomingSide && incomingSide !== 'inherit' && incomingSide !== 'center') {
    return incomingSide;
  }
  const direction = sheet.defaultBranchLayout.direction;
  if (direction === 'right-to-left') return 'left';
  if (direction === 'top-to-bottom') return 'bottom';
  if (direction === 'bottom-to-top') return 'top';
  return 'right';
};

const metadata = (input: PlannerMetadata) => ({
  commandId: input.commandId ?? createEntityId<'Command'>(),
  sheetId: input.sheetId,
  baseRevision: input.document.contentRevision,
  ...(input.groupId ? { groupId: input.groupId } : {}),
  origin: input.origin ?? 'mindmap-v2-drag',
  timestamp: input.timestamp ?? new Date().toISOString(),
});

export const planReparentTopicCommand = (
  input: PlannerMetadata & {
    readonly parentTopicId: TopicId;
    readonly edgeId?: TreeEdgeId;
    readonly side?: BranchSide;
    /** Optional zero-based destination position; omitted means append. */
    readonly index?: number;
  },
): ReparentTopicCommand => {
  const sheet = input.document.sheets[input.sheetId];
  if (!sheet?.topics[input.topicId] || !sheet.topics[input.parentTopicId]) {
    throw new Error('Drag reparent requires existing topic and parent.');
  }
  if (wouldCreateCycle(sheet, input.parentTopicId, input.topicId)) {
    throw new Error('Drag reparent would create a cycle.');
  }
  const incoming = getParentEdge(sheet, input.topicId);
  const siblings = getChildEdgesSorted(sheet, input.parentTopicId)
    .filter((edge) => edge.childTopicId !== input.topicId);
  const siblingKeys = siblings.map((edge) => edge.orderKey);
  const insertionIndex = input.index === undefined
    ? siblings.length
    : Math.max(0, Math.min(input.index, siblings.length));
  const edge = {
    id: input.edgeId ?? incoming?.id ?? createEntityId<'TreeEdge'>(),
    parentTopicId: input.parentTopicId,
    childTopicId: input.topicId,
    orderKey: input.index === undefined
      ? createAvailableOrderKey(siblingKeys)
      : createAsciiOrderKeyBetween(
          siblings[insertionIndex - 1]?.orderKey,
          siblings[insertionIndex]?.orderKey,
        ),
    side: sideForReparent(
      sheet,
      input.parentTopicId,
      incoming?.side,
      input.side,
    ),
  } satisfies TreeEdge;
  const after = structuredClone(sheet);
  for (const candidate of Object.values(after.treeEdges)) {
    if (candidate.childTopicId === input.topicId) delete after.treeEdges[candidate.id];
  }
  after.treeEdges[edge.id] = edge;
  const summaryScopeChanges = materializeSummaryScopeChanges({ before: sheet, after });
  const normalizedAfter = projectSummaryScopeNormalizationAfter(sheet, after);
  const boundaryScopeChanges = materializeBoundaryScopeChanges({ before: sheet, after: normalizedAfter });
  return {
    ...metadata(input),
    type: MIND_MAP_COMMAND_TYPES.reparentTopic,
    payload: {
      topicId: input.topicId,
      edge,
      ...(summaryScopeChanges.length === 0 ? {} : { summaryScopeChanges }),
      ...(boundaryScopeChanges.length === 0 ? {} : { boundaryScopeChanges }),
    },
  };
};

export const planReorderTopicCommand = (
  input: PlannerMetadata & {
    readonly index: number;
    /** Optional root-branch side change, applied atomically with ordering. */
    readonly side?: BranchSide;
  },
): ReorderTopicCommand => {
  const sheet = input.document.sheets[input.sheetId];
  const incoming = sheet && getParentEdge(sheet, input.topicId);
  if (!sheet || !incoming) throw new Error('Drag reorder requires a tree topic.');
  const siblings = getChildEdgesSorted(sheet, incoming.parentTopicId)
    .filter((edge) => edge.childTopicId !== input.topicId);
  const index = Math.max(0, Math.min(input.index, siblings.length));
  const orderKey = createAsciiOrderKeyBetween(
    siblings[index - 1]?.orderKey,
    siblings[index]?.orderKey,
  );
  const side = input.side ?? incoming.side;
  const after = structuredClone(sheet);
  const afterIncoming = after.treeEdges[incoming.id];
  afterIncoming.orderKey = orderKey;
  afterIncoming.side = side;
  const summaryScopeChanges = materializeSummaryScopeChanges({ before: sheet, after });
  const normalizedAfter = projectSummaryScopeNormalizationAfter(sheet, after);
  const boundaryScopeChanges = materializeBoundaryScopeChanges({ before: sheet, after: normalizedAfter });
  return {
    ...metadata(input),
    type: MIND_MAP_COMMAND_TYPES.reorderTopic,
    payload: {
      topicId: input.topicId,
      orderKey,
      side,
      ...(incoming.slot === undefined ? {} : { slot: incoming.slot }),
      ...(summaryScopeChanges.length === 0 ? {} : { summaryScopeChanges }),
      ...(boundaryScopeChanges.length === 0 ? {} : { boundaryScopeChanges }),
    },
  };
};
