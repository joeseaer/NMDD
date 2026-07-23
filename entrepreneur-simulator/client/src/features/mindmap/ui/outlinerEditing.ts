import type {
  BranchSide,
  MindMapDocumentV1,
  RichText,
  SheetId,
  TopicId,
} from '../domain/types';
import {
  getChildEdgesSorted,
  getParentEdge,
  wouldCreateCycle,
} from '../domain/tree';
import type {
  MindMapCommand,
  ReorderTopicCommand,
  ReparentTopicCommand,
  UpdateTopicTitleCommand,
} from '../commands/types';
import { planUpdateTopicTitleCommand } from './commandPlanning';
import {
  planReorderTopicCommand,
  planReparentTopicCommand,
} from './dragPlanning';

export type OutlinerMutationSource = 'editor' | 'keyboard' | 'button' | 'drag';

interface OutlinerMutationBase {
  readonly sheetId: SheetId;
  readonly topicId: TopicId;
  readonly source: OutlinerMutationSource;
}

export interface OutlinerUpdateTitleIntent extends OutlinerMutationBase {
  readonly kind: 'update-title';
  /** Complete canonical value; Outliner title edits must never flatten RichText. */
  readonly title: RichText;
}

export interface OutlinerReparentIntent extends OutlinerMutationBase {
  readonly kind: 'reparent';
  readonly parentTopicId: TopicId;
  /** Zero-based position among the destination parent's children. */
  readonly index: number;
  /** Explicit only when a root-level drop adopts the target branch side. */
  readonly side?: BranchSide;
}

export interface OutlinerReorderIntent extends OutlinerMutationBase {
  readonly kind: 'reorder';
  /** Zero-based final position among the current parent's children. */
  readonly index: number;
  /** Explicit only when a root-level drop crosses to another branch side. */
  readonly side?: BranchSide;
}

export type OutlinerMutationIntent =
  | OutlinerUpdateTitleIntent
  | OutlinerReparentIntent
  | OutlinerReorderIntent;

export type OutlinerMutationCommand =
  | UpdateTopicTitleCommand
  | ReparentTopicCommand
  | ReorderTopicCommand;

const isEmptyParagraph = (block: RichText['blocks'][number] | undefined): boolean =>
  block?.type === 'paragraph' && block.children.length === 0;

/**
 * ProseMirror keeps an editable trailing paragraph after a document-ending
 * list. That UI-only cursor target must not become a new canonical block on
 * an Outliner commit unless the user actually puts content in it.
 */
export const normalizeOutlinerRichTextCommit = (
  initial: RichText,
  committed: RichText,
): RichText => {
  const initialLast = initial.blocks[initial.blocks.length - 1];
  const committedLast = committed.blocks[committed.blocks.length - 1];
  const committedBeforeLast = committed.blocks[committed.blocks.length - 2];
  if (
    initialLast?.type !== 'paragraph'
    && committedBeforeLast?.type !== 'paragraph'
    && isEmptyParagraph(committedLast)
  ) {
    return { ...committed, blocks: committed.blocks.slice(0, -1) };
  }
  return committed;
};

const getSheet = (document: MindMapDocumentV1, sheetId: SheetId) =>
  document.sheets[sheetId];

/**
 * XMind-style Tab: make the topic the final child of its previous sibling.
 * Returns undefined for roots and first siblings, making unavailable actions
 * explicit without ever mutating the document.
 */
export const planOutlinerIndentIntent = (
  document: MindMapDocumentV1,
  sheetId: SheetId,
  topicId: TopicId,
  source: OutlinerMutationSource = 'keyboard',
): OutlinerReparentIntent | undefined => {
  const sheet = getSheet(document, sheetId);
  if (!sheet?.topics[topicId]) return undefined;
  const incoming = getParentEdge(sheet, topicId);
  if (!incoming) return undefined;
  const siblings = getChildEdgesSorted(sheet, incoming.parentTopicId);
  const currentIndex = siblings.findIndex((edge) => edge.childTopicId === topicId);
  const previousSibling = siblings[currentIndex - 1];
  if (!previousSibling) return undefined;
  return {
    kind: 'reparent',
    sheetId,
    topicId,
    parentTopicId: previousSibling.childTopicId,
    index: getChildEdgesSorted(sheet, previousSibling.childTopicId).length,
    source,
  };
};

/** XMind-style Shift+Tab: place the topic immediately after its old parent. */
export const planOutlinerOutdentIntent = (
  document: MindMapDocumentV1,
  sheetId: SheetId,
  topicId: TopicId,
  source: OutlinerMutationSource = 'keyboard',
): OutlinerReparentIntent | undefined => {
  const sheet = getSheet(document, sheetId);
  if (!sheet?.topics[topicId]) return undefined;
  const incoming = getParentEdge(sheet, topicId);
  if (!incoming) return undefined;
  const parentIncoming = getParentEdge(sheet, incoming.parentTopicId);
  if (!parentIncoming) return undefined;
  const parentSiblings = getChildEdgesSorted(sheet, parentIncoming.parentTopicId);
  const parentIndex = parentSiblings.findIndex(
    (edge) => edge.childTopicId === incoming.parentTopicId,
  );
  if (parentIndex < 0) return undefined;
  return {
    kind: 'reparent',
    sheetId,
    topicId,
    parentTopicId: parentIncoming.parentTopicId,
    index: parentIndex + 1,
    source,
  };
};

export const planOutlinerSiblingMoveIntent = (
  document: MindMapDocumentV1,
  sheetId: SheetId,
  topicId: TopicId,
  direction: 'up' | 'down',
  source: OutlinerMutationSource = 'keyboard',
): OutlinerReorderIntent | undefined => {
  const sheet = getSheet(document, sheetId);
  if (!sheet?.topics[topicId]) return undefined;
  const incoming = getParentEdge(sheet, topicId);
  if (!incoming) return undefined;
  const siblings = getChildEdgesSorted(sheet, incoming.parentTopicId);
  const currentIndex = siblings.findIndex((edge) => edge.childTopicId === topicId);
  const index = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
  if (currentIndex < 0 || index < 0 || index >= siblings.length) return undefined;
  return { kind: 'reorder', sheetId, topicId, index, source };
};

export type OutlinerDropPosition = 'before' | 'inside' | 'after';

export interface OutlinerDropCursor {
  readonly sheetId: SheetId;
  readonly topicId: TopicId;
}

const usableRootBranchSide = (
  side: BranchSide | undefined,
): BranchSide | undefined => side === 'inherit' || side === 'center' ? undefined : side;

/**
 * Converts an XMind-style Outliner drop into one canonical structural intent.
 *
 * - before/after use the target's parent and exact sibling position;
 * - inside appends to the target's children;
 * - a move below itself or any descendant is rejected before command planning;
 * - cross-Sheet moves are deliberately unsupported because topic IDs and all
 *   referenced semantic entities are Sheet-owned.
 */
export const planOutlinerDropIntent = (
  document: MindMapDocumentV1,
  dragged: OutlinerDropCursor,
  target: OutlinerDropCursor,
  position: OutlinerDropPosition,
): OutlinerReparentIntent | OutlinerReorderIntent | undefined => {
  if (dragged.sheetId !== target.sheetId || dragged.topicId === target.topicId) {
    return undefined;
  }
  const sheet = getSheet(document, dragged.sheetId);
  if (!sheet?.topics[dragged.topicId] || !sheet.topics[target.topicId]) return undefined;
  if (dragged.topicId === sheet.rootTopicId) return undefined;

  const draggedIncoming = getParentEdge(sheet, dragged.topicId);
  if (!draggedIncoming) return undefined;

  const targetIncoming = getParentEdge(sheet, target.topicId);
  const destinationParentTopicId = position === 'inside'
    ? target.topicId
    : targetIncoming?.parentTopicId;
  if (!destinationParentTopicId) return undefined;
  if (wouldCreateCycle(sheet, destinationParentTopicId, dragged.topicId)) {
    return undefined;
  }

  const destinationEdges = getChildEdgesSorted(sheet, destinationParentTopicId)
    .filter((edge) => edge.childTopicId !== dragged.topicId);
  let index: number;
  if (position === 'inside') {
    index = destinationEdges.length;
  } else {
    const targetIndex = destinationEdges.findIndex(
      (edge) => edge.childTopicId === target.topicId,
    );
    if (targetIndex < 0) return undefined;
    index = targetIndex + (position === 'after' ? 1 : 0);
  }

  const targetSide = destinationParentTopicId === sheet.rootTopicId
    ? usableRootBranchSide(targetIncoming?.side)
    : undefined;
  if (draggedIncoming.parentTopicId === destinationParentTopicId) {
    const currentIndex = getChildEdgesSorted(sheet, destinationParentTopicId)
      .findIndex((edge) => edge.childTopicId === dragged.topicId);
    const reorderSide = targetSide !== undefined && targetSide !== draggedIncoming.side
      ? targetSide
      : undefined;
    const sideChanged = reorderSide !== undefined;
    if (currentIndex < 0 || (index === currentIndex && !sideChanged)) return undefined;
    return {
      kind: 'reorder',
      sheetId: dragged.sheetId,
      topicId: dragged.topicId,
      index,
      ...(reorderSide === undefined ? {} : { side: reorderSide }),
      source: 'drag',
    };
  }

  return {
    kind: 'reparent',
    sheetId: dragged.sheetId,
    topicId: dragged.topicId,
    parentTopicId: destinationParentTopicId,
    index,
    ...(targetSide === undefined ? {} : { side: targetSide }),
    source: 'drag',
  };
};

/**
 * Optional host adapter. It deliberately delegates to the existing canonical
 * planners so Outliner edits share validation, history and undo semantics with
 * the canvas.
 */
export const planOutlinerMutationCommand = (
  document: MindMapDocumentV1,
  intent: OutlinerMutationIntent,
): OutlinerMutationCommand => {
  const metadata = {
    document,
    sheetId: intent.sheetId,
    topicId: intent.topicId,
    origin: 'mindmap-v2-outliner',
  } as const;
  if (intent.kind === 'update-title') {
    return planUpdateTopicTitleCommand({ ...metadata, title: intent.title });
  }
  if (intent.kind === 'reparent') {
    return planReparentTopicCommand({
      ...metadata,
      parentTopicId: intent.parentTopicId,
      index: intent.index,
      ...(intent.side === undefined ? {} : { side: intent.side }),
    });
  }
  return planReorderTopicCommand({
    ...metadata,
    index: intent.index,
    ...(intent.side === undefined ? {} : { side: intent.side }),
  });
};

// Compile-time guard: the adapter must only ever return canonical commands.
const _canonicalCommandGuard = (command: OutlinerMutationCommand): MindMapCommand => command;
void _canonicalCommandGuard;
