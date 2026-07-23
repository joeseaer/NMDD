import {
  encodeMindMapClipboard,
  MindMapClipboardError,
  remapMindMapClipboard,
  type ClipboardIdFactory,
  type EncodedMindMapClipboard,
  type MindMapClipboardEnvelopeV1,
} from '../clipboard';
import { createEntityId } from '../domain/ids';
import {
  normalizeExactSemanticScopeMembers,
  resolveSemanticEdgeSide,
  expandSemanticTopicScope,
} from '../domain/semanticScope';
import { getParentEdge } from '../domain/tree';
import type {
  BoundaryId,
  BranchSide,
  CommandId,
  MindMapDocumentV1,
  SheetId,
  TopicId,
  TreeEdgeId,
} from '../domain/types';
import {
  MIND_MAP_COMMAND_TYPES,
  type PasteClipboardFragmentCommand,
} from '../commands/types';
import {
  createAvailableOrderKey,
  planCreateTopicCommand,
  type PlanCreateTopicInput,
} from './commandPlanning';

export interface PlanPasteClipboardFragmentInput {
  readonly document: MindMapDocumentV1;
  readonly sheetId: SheetId;
  readonly parentTopicId: TopicId;
  readonly envelope: MindMapClipboardEnvelopeV1;
  readonly commandId?: CommandId;
  readonly groupId?: string;
  readonly origin?: string;
  readonly timestamp?: string;
  readonly idFactory?: ClipboardIdFactory;
  readonly attachmentEdgeIdFactory?: (
    rootTopicId: TopicId,
    index: number,
  ) => TreeEdgeId;
}

export interface PlanCutMindMapClipboardInput {
  readonly document: MindMapDocumentV1;
  readonly sheetId: SheetId;
  readonly selectedTopicIds: readonly TopicId[];
}

export interface PlannedMindMapCut {
  readonly clipboard: EncodedMindMapClipboard;
  readonly rootTopicIds: readonly TopicId[];
}

const collectExistingCanonicalIds = (document: MindMapDocumentV1): Set<string> => {
  const ids = new Set<string>();
  const visited = new Set<object>();
  const visit = (candidate: unknown): void => {
    if (candidate === null || typeof candidate !== 'object' || visited.has(candidate)) return;
    visited.add(candidate);
    if (Array.isArray(candidate)) {
      for (const child of candidate) visit(child);
      return;
    }
    const record = candidate as Record<string, unknown>;
    if (typeof record.id === 'string' && record.id.length > 0) ids.add(record.id);
    for (const child of Object.values(record)) visit(child);
  };
  visit(document);
  return ids;
};

const defaultSideForParent = (
  document: MindMapDocumentV1,
  sheetId: SheetId,
  parentTopicId: TopicId,
): BranchSide => {
  const sheet = document.sheets[sheetId];
  const parentEdge = getParentEdge(sheet, parentTopicId);
  const inherited = parentEdge ? resolveSemanticEdgeSide(sheet, parentEdge) : undefined;
  if (inherited && inherited !== 'center') return inherited;
  const direction = sheet.defaultBranchLayout.direction;
  if (direction === 'right-to-left') return 'left';
  if (direction === 'top-to-bottom') return 'bottom';
  if (direction === 'bottom-to-top') return 'top';
  return 'right';
};

const resolveRootSide = (
  hint: MindMapClipboardEnvelopeV1['rootHints'][number] | undefined,
  fallback: BranchSide,
): BranchSide => hint && hint.side !== 'center' && hint.side !== 'inherit'
  ? hint.side
  : fallback;

const createUniqueAttachmentEdgeId = (
  occupied: Set<string>,
  rootTopicId: TopicId,
  index: number,
  factory?: PlanPasteClipboardFragmentInput['attachmentEdgeIdFactory'],
): TreeEdgeId => {
  for (let attempt = 0; attempt < 1024; attempt += 1) {
    const candidate = factory
      ? factory(rootTopicId, index + attempt)
      : createEntityId<'TreeEdge'>();
    if (!occupied.has(candidate)) {
      occupied.add(candidate);
      return candidate;
    }
  }
  throw new MindMapClipboardError(
    'clipboard.id-generation-failed',
    'Could not generate a unique clipboard attachment edge ID.',
    [rootTopicId],
  );
};

export const planPasteClipboardFragmentCommand = (
  input: PlanPasteClipboardFragmentInput,
): PasteClipboardFragmentCommand => {
  const sheet = input.document.sheets[input.sheetId];
  if (!sheet) throw new Error(`Sheet ${input.sheetId} does not exist.`);
  if (!sheet.topics[input.parentTopicId]) {
    throw new Error(`Clipboard destination topic ${input.parentTopicId} does not exist.`);
  }

  const existingIds = collectExistingCanonicalIds(input.document);
  const remapped = remapMindMapClipboard(input.envelope, {
    destinationDocumentId: input.document.id,
    destinationSheetId: input.sheetId,
    existingIds,
    ...(input.idFactory ? { idFactory: input.idFactory } : {}),
  });
  const fragment = structuredClone(remapped.fragment);
  const markerGroupKeys = Object.values(input.document.markerGroups)
    .map((group) => group.orderKey);
  for (const group of Object.values(fragment.markerGroups).sort((left, right) =>
    left.orderKey.localeCompare(right.orderKey) || left.id.localeCompare(right.id))) {
    group.orderKey = createAvailableOrderKey(markerGroupKeys);
    markerGroupKeys.push(group.orderKey);
  }
  const zoneOrderKeys = Object.values(sheet.zones).map((zone) => zone.zOrderKey);
  for (const zone of Object.values(fragment.zones).sort((left, right) =>
    left.zOrderKey.localeCompare(right.zOrderKey) || left.id.localeCompare(right.id))) {
    zone.zOrderKey = createAvailableOrderKey(zoneOrderKeys);
    zoneOrderKeys.push(zone.zOrderKey);
  }
  const summaryResultIds = new Set(
    Object.values(fragment.summaries).map((summary) => summary.resultTopicId),
  );
  for (const rootTopicId of remapped.rootTopicIds) {
    const root = fragment.topics[rootTopicId];
    if (!root) throw new Error(`Remapped clipboard root ${rootTopicId} is missing.`);
    if (summaryResultIds.has(rootTopicId)) {
      throw new Error('A summary result topic cannot be attached as a pasted branch root.');
    }
    if (root.role !== 'regular') {
      root.role = 'regular';
      root.placement = { mode: 'auto' };
    }
  }

  const occupiedIds = new Set([
    ...existingIds,
    ...Object.values(remapped.idMap),
  ]);
  const siblingKeys = Object.values(sheet.treeEdges)
    .filter((edge) => edge.parentTopicId === input.parentTopicId)
    .map((edge) => edge.orderKey);
  const fallbackSide = defaultSideForParent(
    input.document,
    input.sheetId,
    input.parentTopicId,
  );
  const attachmentEdges = remapped.rootTopicIds.map((rootTopicId, index) => {
    const hint = remapped.rootHints.find((candidate) => candidate.topicId === rootTopicId);
    const orderKey = createAvailableOrderKey(siblingKeys);
    siblingKeys.push(orderKey);
    return {
      id: createUniqueAttachmentEdgeId(
        occupiedIds,
        rootTopicId,
        index,
        input.attachmentEdgeIdFactory,
      ),
      parentTopicId: input.parentTopicId,
      childTopicId: rootTopicId,
      orderKey,
      side: resolveRootSide(hint, fallbackSide),
      ...(hint?.slot === undefined ? {} : { slot: hint.slot }),
    };
  });

  // Clipboard collection deliberately stores exact Boundary membership as an
  // explicit scope because detached roots have no incoming edge. Re-canonicalize
  // after destination attachment is known so range handles/native export remain
  // available after paste.
  const projectedSheet = structuredClone(sheet);
  Object.assign(projectedSheet.topics, fragment.topics);
  Object.assign(projectedSheet.treeEdges, fragment.treeEdges);
  for (const edge of attachmentEdges) projectedSheet.treeEdges[edge.id] = edge;
  const createUniqueSplitBoundaryId = (): BoundaryId => {
    for (let attempt = 0; attempt < 1024; attempt += 1) {
      const candidate = createEntityId<'Boundary'>();
      if (!occupiedIds.has(candidate)) {
        occupiedIds.add(candidate);
        return candidate;
      }
    }
    throw new MindMapClipboardError(
      'clipboard.id-generation-failed',
      'Could not generate a unique split Boundary ID.',
    );
  };
  for (const boundary of Object.values(fragment.boundaries)
    .sort((left, right) => left.id.localeCompare(right.id))) {
    const exactMembers = expandSemanticTopicScope(projectedSheet, boundary.scope);
    const normalized = normalizeExactSemanticScopeMembers(projectedSheet, exactMembers);
    if (normalized.groups.length === 0) {
      delete fragment.boundaries[boundary.id];
      continue;
    }
    boundary.scope = normalized.groups[0].scope;
    for (const group of normalized.groups.slice(1)) {
      const id = createUniqueSplitBoundaryId();
      fragment.boundaries[id] = {
        ...structuredClone(boundary),
        id,
        scope: group.scope,
      };
    }
  }
  // Summary collection uses the same explicit exact-membership transport.
  // Re-canonicalize when it maps to one legal destination range. A rare
  // compatibility fragment that still spans multiple groups remains explicit
  // so one result Topic is never duplicated without a fully remapped subtree.
  for (const summary of Object.values(fragment.summaries)
    .sort((left, right) => left.id.localeCompare(right.id))) {
    const exactMembers = expandSemanticTopicScope(projectedSheet, summary.scope);
    const normalized = normalizeExactSemanticScopeMembers(projectedSheet, exactMembers);
    if (normalized.groups.length === 1) summary.scope = normalized.groups[0].scope;
  }

  return {
    commandId: input.commandId ?? createEntityId<'Command'>(),
    type: MIND_MAP_COMMAND_TYPES.pasteClipboardFragment,
    sheetId: input.sheetId,
    payload: {
      fragment,
      rootTopicIds: [...remapped.rootTopicIds],
      attachmentEdges,
    },
    baseRevision: input.document.contentRevision,
    ...(input.groupId ? { groupId: input.groupId } : {}),
    origin: input.origin ?? 'mindmap-v2-clipboard',
    timestamp: input.timestamp ?? new Date().toISOString(),
  };
};

export const planCutMindMapClipboard = (
  input: PlanCutMindMapClipboardInput,
): PlannedMindMapCut => {
  const clipboard = encodeMindMapClipboard(input);
  const sheet = input.document.sheets[input.sheetId];
  if (clipboard.envelope.rootTopicIds.includes(sheet.rootTopicId)) {
    throw new MindMapClipboardError(
      'clipboard.invalid-selection',
      'The central topic cannot be cut.',
      [sheet.rootTopicId],
    );
  }
  return {
    clipboard,
    rootTopicIds: clipboard.envelope.rootTopicIds,
  };
};

const MAX_FALLBACK_TITLE_LENGTH = 1_000;

export const clipboardFallbackTitle = (raw: string): string | null => {
  const line = raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((candidate) => candidate.trim())
    .find(Boolean);
  if (!line) return null;
  const withoutOutlineMarker = line.replace(/^(?:[-*+]\s+|\d+[.)]\s+)/, '').trim();
  const title = withoutOutlineMarker || line;
  return [...title].slice(0, MAX_FALLBACK_TITLE_LENGTH).join('');
};

export const planPasteTextTopicCommand = (
  input: Omit<PlanCreateTopicInput, 'title'> & { readonly text: string },
) => {
  const title = clipboardFallbackTitle(input.text);
  if (!title) throw new Error('Clipboard text does not contain a topic title.');
  return planCreateTopicCommand({ ...input, title, origin: input.origin ?? 'mindmap-v2-clipboard' });
};
