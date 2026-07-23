import {
  getAncestors,
  getChildEdgesSorted,
  getParentEdge,
} from '../domain/tree';
import type {
  ElementRef,
  MindMapSheet,
  TopicId,
} from '../domain/types';

export interface SelectionModifiers {
  readonly toggle?: boolean;
  readonly range?: boolean;
}

export interface PositionedTopic {
  readonly id: TopicId;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type NavigationDirection = 'left' | 'right' | 'up' | 'down';

export const elementRefKey = (reference: ElementRef): string =>
  `${reference.kind}:${reference.id}`;

export const normalizeElementSelection = (
  selection: readonly ElementRef[],
): ElementRef[] => {
  const seen = new Set<string>();
  return selection.filter((reference) => {
    const key = elementRefKey(reference);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const sameParent = (
  sheet: MindMapSheet,
  left: TopicId,
  right: TopicId,
): TopicId | undefined => {
  const leftParent = getParentEdge(sheet, left)?.parentTopicId;
  const rightParent = getParentEdge(sheet, right)?.parentTopicId;
  return leftParent && leftParent === rightParent ? leftParent : undefined;
};

const siblingRange = (
  sheet: MindMapSheet,
  anchorId: TopicId,
  targetId: TopicId,
): ElementRef[] | undefined => {
  const parentId = sameParent(sheet, anchorId, targetId);
  if (!parentId) return undefined;
  const orderedIds = getChildEdgesSorted(sheet, parentId)
    .map((edge) => edge.childTopicId);
  const anchorIndex = orderedIds.indexOf(anchorId);
  const targetIndex = orderedIds.indexOf(targetId);
  if (anchorIndex < 0 || targetIndex < 0) return undefined;
  const start = Math.min(anchorIndex, targetIndex);
  const end = Math.max(anchorIndex, targetIndex);
  return orderedIds.slice(start, end + 1)
    .map((id) => ({ kind: 'topic', id }));
};

/**
 * Applies desktop selection semantics without touching canonical content.
 * The final item is the primary/anchor selection.
 */
export const selectElement = (
  sheet: MindMapSheet,
  selection: readonly ElementRef[],
  target: ElementRef,
  modifiers: SelectionModifiers = {},
): ElementRef[] => {
  const normalized = normalizeElementSelection(selection);
  if (modifiers.range && target.kind === 'topic') {
    const anchor = [...normalized].reverse()
      .find((reference): reference is Extract<ElementRef, { kind: 'topic' }> =>
        reference.kind === 'topic');
    if (anchor) {
      const range = siblingRange(sheet, anchor.id, target.id);
      if (range) return range;
    }
  }

  if (!modifiers.toggle) return [target];
  const targetKey = elementRefKey(target);
  const index = normalized.findIndex((reference) => elementRefKey(reference) === targetKey);
  if (index >= 0) return normalized.filter((_reference, itemIndex) => itemIndex !== index);
  return [...normalized, target];
};

/** Removes selected descendants when their ancestor is already selected. */
export const normalizeTopLevelTopicSelection = (
  sheet: MindMapSheet,
  selection: readonly ElementRef[],
): TopicId[] => {
  const selectedIds = new Set(
    selection
      .filter((reference): reference is Extract<ElementRef, { kind: 'topic' }> =>
        reference.kind === 'topic')
      .map((reference) => reference.id),
  );
  const result: TopicId[] = [];
  const seen = new Set<TopicId>();
  for (const reference of selection) {
    if (reference.kind !== 'topic' || seen.has(reference.id)) continue;
    seen.add(reference.id);
    const hasSelectedAncestor = getAncestors(sheet, reference.id)
      .some((ancestor) => selectedIds.has(ancestor.id));
    if (!hasSelectedAncestor) result.push(reference.id);
  }
  return result;
};

const topicCenter = (topic: PositionedTopic): { x: number; y: number } => ({
  x: topic.x + topic.width / 2,
  y: topic.y + topic.height / 2,
});

/**
 * Finds the most natural topic in an arrow-key direction. Candidates outside
 * the requested half-plane are ignored; perpendicular drift is penalized.
 */
export const findDirectionalTopic = (
  topics: readonly PositionedTopic[],
  currentId: TopicId,
  direction: NavigationDirection,
): TopicId | undefined => {
  const current = topics.find((topic) => topic.id === currentId);
  if (!current) return undefined;
  const origin = topicCenter(current);
  let best: { id: TopicId; score: number; distance: number } | undefined;

  for (const candidate of topics) {
    if (candidate.id === currentId) continue;
    const center = topicCenter(candidate);
    const dx = center.x - origin.x;
    const dy = center.y - origin.y;
    const primary = direction === 'left' ? -dx
      : direction === 'right' ? dx
        : direction === 'up' ? -dy
          : dy;
    if (primary <= 0) continue;
    const perpendicular = direction === 'left' || direction === 'right'
      ? Math.abs(dy)
      : Math.abs(dx);
    const distance = Math.hypot(dx, dy);
    const score = primary + perpendicular * 2.25 + distance * 0.05;
    if (
      !best
      || score < best.score
      || (score === best.score && distance < best.distance)
      || (score === best.score && distance === best.distance && candidate.id < best.id)
    ) {
      best = { id: candidate.id, score, distance };
    }
  }
  return best?.id;
};

