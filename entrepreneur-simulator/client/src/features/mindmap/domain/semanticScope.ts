import type {
  BoundaryId,
  BranchSide,
  MindMapSheet,
  SummaryId,
  TopicId,
  TopicScope,
  TreeEdge,
} from './types';

export type ResolvedBranchSide = Exclude<BranchSide, 'inherit'>;

const compareAscii = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

export const compareSemanticScopeEdges = (left: TreeEdge, right: TreeEdge): number =>
  compareAscii(left.orderKey, right.orderKey) || compareAscii(left.id, right.id);

const fallbackSide = (sheet: MindMapSheet): ResolvedBranchSide => {
  switch (sheet.defaultBranchLayout.direction) {
    case 'right-to-left': return 'left';
    case 'top-to-bottom': return 'bottom';
    case 'bottom-to-top': return 'top';
    default: return 'right';
  }
};

const incomingByTopic = (sheet: MindMapSheet): Map<TopicId, TreeEdge> => {
  const result = new Map<TopicId, TreeEdge>();
  for (const edge of Object.values(sheet.treeEdges).sort(compareSemanticScopeEdges)) {
    if (!result.has(edge.childTopicId)) result.set(edge.childTopicId, edge);
  }
  return result;
};

/**
 * Resolves `inherit` through the structural ancestor chain. Semantic ranges
 * must compare this value, never the raw edge.side value.
 */
export const resolveSemanticEdgeSide = (
  sheet: MindMapSheet,
  edge: TreeEdge,
): ResolvedBranchSide => {
  const incoming = incomingByTopic(sheet);
  const visited = new Set<TopicId>();
  let cursor: TreeEdge | undefined = edge;
  while (cursor) {
    if (cursor.side !== 'inherit') return cursor.side;
    if (visited.has(cursor.parentTopicId)) break;
    visited.add(cursor.parentTopicId);
    cursor = incoming.get(cursor.parentTopicId);
  }
  return fallbackSide(sheet);
};

export const semanticSiblingEdges = (
  sheet: MindMapSheet,
  edge: TreeEdge,
): TreeEdge[] => {
  const side = resolveSemanticEdgeSide(sheet, edge);
  return Object.values(sheet.treeEdges)
    .filter((candidate) =>
      candidate.parentTopicId === edge.parentTopicId
      && candidate.slot === edge.slot
      && resolveSemanticEdgeSide(sheet, candidate) === side)
    .sort(compareSemanticScopeEdges);
};

const childrenByParent = (sheet: MindMapSheet): Map<TopicId, TreeEdge[]> => {
  const result = new Map<TopicId, TreeEdge[]>();
  for (const edge of Object.values(sheet.treeEdges)) {
    const group = result.get(edge.parentTopicId) ?? [];
    group.push(edge);
    result.set(edge.parentTopicId, group);
  }
  for (const group of result.values()) group.sort(compareSemanticScopeEdges);
  return result;
};

const descendantsFrom = (
  sheet: MindMapSheet,
  rootTopicId: TopicId,
  maximumDepth = Number.POSITIVE_INFINITY,
): TopicId[] => {
  const children = childrenByParent(sheet);
  const result: TopicId[] = [];
  const visited = new Set<TopicId>();
  const visit = (topicId: TopicId, depth: number): void => {
    if (!sheet.topics[topicId] || visited.has(topicId)) return;
    visited.add(topicId);
    result.push(topicId);
    if (depth >= maximumDepth) return;
    for (const edge of children.get(topicId) ?? []) visit(edge.childTopicId, depth + 1);
  };
  visit(rootTopicId, 0);
  return result;
};

/** Expands a canonical scope in deterministic structural order. */
export const expandSemanticTopicScope = (
  sheet: MindMapSheet,
  scope: TopicScope,
): TopicId[] => {
  if (scope.kind === 'subtree') {
    return descendantsFrom(
      sheet,
      scope.rootTopicId,
      scope.depth === 'all' ? Number.POSITIVE_INFINITY : Math.max(0, scope.depth),
    );
  }
  if (scope.kind === 'explicit') {
    return [...new Set(scope.topicIds)]
      .filter((topicId) => Boolean(sheet.topics[topicId]))
      .sort(compareAscii);
  }
  const first = sheet.treeEdges[scope.firstEdgeId];
  const last = sheet.treeEdges[scope.lastEdgeId];
  if (
    !first
    || !last
    || first.parentTopicId !== scope.parentTopicId
    || last.parentTopicId !== scope.parentTopicId
    || first.slot !== last.slot
    || resolveSemanticEdgeSide(sheet, first) !== resolveSemanticEdgeSide(sheet, last)
  ) return [];
  const siblings = semanticSiblingEdges(sheet, first);
  const firstIndex = siblings.findIndex((edge) => edge.id === first.id);
  const lastIndex = siblings.findIndex((edge) => edge.id === last.id);
  if (firstIndex < 0 || lastIndex < firstIndex) return [];
  const result: TopicId[] = [];
  const seen = new Set<TopicId>();
  for (const edge of siblings.slice(firstIndex, lastIndex + 1)) {
    const members = scope.includeDescendants
      ? descendantsFrom(sheet, edge.childTopicId)
      : [edge.childTopicId];
    for (const topicId of members) {
      if (!seen.has(topicId)) {
        seen.add(topicId);
        result.push(topicId);
      }
    }
  }
  return result;
};

interface ScopeAnchor {
  readonly topicId: TopicId;
  readonly edge?: TreeEdge;
  readonly includeDescendants: boolean;
}

export interface SemanticScopeGroup {
  readonly scope: TopicScope;
  readonly topicIds: readonly TopicId[];
  readonly parentTopicId?: TopicId;
  readonly resolvedSide?: ResolvedBranchSide;
  readonly slot?: string;
}

export interface SemanticScopeNormalization {
  readonly groups: readonly SemanticScopeGroup[];
  readonly rejectedTopicIds: readonly TopicId[];
  readonly splitReasons: readonly ('cross-branch' | 'non-contiguous')[];
}

const stableTopicOrder = (sheet: MindMapSheet): TopicId[] => {
  const incoming = incomingByTopic(sheet);
  const roots = Object.values(sheet.topics)
    .filter((topic) => !incoming.has(topic.id))
    .sort((left, right) => {
      if (left.id === sheet.rootTopicId) return -1;
      if (right.id === sheet.rootTopicId) return 1;
      return compareAscii(left.id, right.id);
    });
  const result: TopicId[] = [];
  const seen = new Set<TopicId>();
  for (const root of roots) {
    for (const topicId of descendantsFrom(sheet, root.id)) {
      if (!seen.has(topicId)) {
        seen.add(topicId);
        result.push(topicId);
      }
    }
  }
  for (const topic of Object.values(sheet.topics).sort((a, b) => compareAscii(a.id, b.id))) {
    if (!seen.has(topic.id)) result.push(topic.id);
  }
  return result;
};

const groupAnchors = (
  sheet: MindMapSheet,
  anchors: readonly ScopeAnchor[],
): SemanticScopeNormalization => {
  const rank = new Map(stableTopicOrder(sheet).map((topicId, index) => [topicId, index]));
  const roots = anchors.filter((anchor) => !anchor.edge);
  const edgeAnchors = anchors.filter(
    (anchor): anchor is ScopeAnchor & { readonly edge: TreeEdge } => Boolean(anchor.edge),
  );
  const buckets = new Map<string, Array<ScopeAnchor & { readonly edge: TreeEdge }>>();
  for (const anchor of edgeAnchors) {
    const side = resolveSemanticEdgeSide(sheet, anchor.edge);
    const key = `${anchor.edge.parentTopicId}\u0000${side}\u0000${anchor.edge.slot ?? ''}\u0000${anchor.includeDescendants ? '1' : '0'}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(anchor);
    buckets.set(key, bucket);
  }

  const groups: SemanticScopeGroup[] = roots.map((anchor) => ({
    scope: {
      kind: 'subtree',
      rootTopicId: anchor.topicId,
      depth: anchor.includeDescendants ? 'all' : 0,
    },
    topicIds: [anchor.topicId],
  }));
  let nonContiguous = false;
  for (const bucket of buckets.values()) {
    const sample = bucket[0];
    const siblings = semanticSiblingEdges(sheet, sample.edge);
    const selected = new Map(bucket.map((anchor) => [anchor.edge.id, anchor]));
    let segment: Array<ScopeAnchor & { readonly edge: TreeEdge }> = [];
    const flush = (): void => {
      if (segment.length === 0) return;
      const first = segment[0];
      const last = segment[segment.length - 1];
      groups.push({
        scope: {
          kind: 'sibling-range',
          parentTopicId: first.edge.parentTopicId,
          firstEdgeId: first.edge.id,
          lastEdgeId: last.edge.id,
          includeDescendants: first.includeDescendants,
        },
        topicIds: segment.map((anchor) => anchor.topicId),
        parentTopicId: first.edge.parentTopicId,
        resolvedSide: resolveSemanticEdgeSide(sheet, first.edge),
        ...(first.edge.slot === undefined ? {} : { slot: first.edge.slot }),
      });
      segment = [];
    };
    let sawGapAfterSelection = false;
    for (const sibling of siblings) {
      const anchor = selected.get(sibling.id);
      if (anchor) {
        if (sawGapAfterSelection) nonContiguous = true;
        segment.push(anchor);
        sawGapAfterSelection = false;
      } else if (segment.length > 0) {
        flush();
        sawGapAfterSelection = true;
      }
    }
    flush();
  }
  groups.sort((left, right) => {
    const leftRank = Math.min(...left.topicIds.map((id) => rank.get(id) ?? Number.MAX_SAFE_INTEGER));
    const rightRank = Math.min(...right.topicIds.map((id) => rank.get(id) ?? Number.MAX_SAFE_INTEGER));
    return leftRank - rightRank
      || compareAscii(JSON.stringify(left.scope), JSON.stringify(right.scope));
  });
  const structuralKeys = new Set(groups.map((group) => group.scope.kind === 'sibling-range'
    ? `${group.scope.parentTopicId}\u0000${group.resolvedSide}\u0000${group.slot ?? ''}`
    : group.scope.kind === 'subtree'
      ? `root:${group.scope.rootTopicId}`
      : `explicit:${group.scope.topicIds.join(',')}`));
  const splitReasons: Array<'cross-branch' | 'non-contiguous'> = [];
  if (structuralKeys.size > 1) splitReasons.push('cross-branch');
  if (nonContiguous) splitReasons.push('non-contiguous');
  return { groups, rejectedTopicIds: [], splitReasons };
};

const hasSelectedAncestor = (
  topicId: TopicId,
  selected: ReadonlySet<TopicId>,
  incoming: ReadonlyMap<TopicId, TreeEdge>,
): boolean => {
  const visited = new Set<TopicId>();
  let edge = incoming.get(topicId);
  while (edge && !visited.has(edge.parentTopicId)) {
    if (selected.has(edge.parentTopicId)) return true;
    visited.add(edge.parentTopicId);
    edge = incoming.get(edge.parentTopicId);
  }
  return false;
};

/** Normalizes a visible user selection; each selected anchor includes its descendants. */
export const normalizeSemanticScopeSelection = (
  sheet: MindMapSheet,
  topicIds: readonly TopicId[],
): SemanticScopeNormalization => {
  const unique = [...new Set(topicIds)];
  const rejectedTopicIds = unique.filter((topicId) => !sheet.topics[topicId]);
  const selected = new Set(unique.filter((topicId) => Boolean(sheet.topics[topicId])));
  const incoming = incomingByTopic(sheet);
  const anchors = [...selected]
    .filter((topicId) => !hasSelectedAncestor(topicId, selected, incoming))
    .map<ScopeAnchor>((topicId) => ({
      topicId,
      edge: incoming.get(topicId),
      includeDescendants: true,
    }));
  const normalized = groupAnchors(sheet, anchors);
  return { ...normalized, rejectedTopicIds };
};

const subtreeIsSelected = (
  sheet: MindMapSheet,
  topicId: TopicId,
  selected: ReadonlySet<TopicId>,
): boolean => descendantsFrom(sheet, topicId).every((id) => selected.has(id));

/**
 * Re-encodes an exact pre-mutation member intent against a post-mutation tree.
 * Maximal complete subtrees stay compact; partial trees are represented by
 * deterministic sibling ranges without accidentally absorbing new Topics.
 */
export const normalizeExactSemanticScopeMembers = (
  sheet: MindMapSheet,
  memberTopicIds: readonly TopicId[],
): SemanticScopeNormalization => {
  const rejectedTopicIds = [...new Set(memberTopicIds)]
    .filter((topicId) => !sheet.topics[topicId]);
  const selected = new Set(memberTopicIds.filter((topicId) => Boolean(sheet.topics[topicId])));
  const covered = new Set<TopicId>();
  const incoming = incomingByTopic(sheet);
  const anchors: ScopeAnchor[] = [];
  for (const topicId of stableTopicOrder(sheet)) {
    if (!selected.has(topicId) || covered.has(topicId)) continue;
    const includeDescendants = subtreeIsSelected(sheet, topicId, selected);
    anchors.push({ topicId, edge: incoming.get(topicId), includeDescendants });
    if (includeDescendants) {
      for (const coveredId of descendantsFrom(sheet, topicId)) covered.add(coveredId);
    } else {
      covered.add(topicId);
    }
  }
  const normalized = groupAnchors(sheet, anchors);
  return { ...normalized, rejectedTopicIds };
};

export const semanticScopesEqual = (left: TopicScope, right: TopicScope): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

export interface BoundaryScopeNormalizationPlan {
  readonly boundaryId: BoundaryId;
  readonly scopes: readonly TopicScope[];
}

export interface SummaryScopeNormalizationPlan {
  readonly summaryId: SummaryId;
  readonly scopes: readonly TopicScope[];
}

export interface SummaryResultSemanticClosure {
  /** Outer result tree first, then nested Summary result trees in stable order. */
  readonly topicIds: readonly TopicId[];
  /** Summaries whose complete scopes are inside the accumulated Topic closure. */
  readonly summaryIds: readonly SummaryId[];
}

/**
 * Collects a result subtree plus recursively owned nested Summary result trees.
 * The Summary being split must be excluded so a pathological scope inside its
 * own result tree cannot recursively clone the source owner.
 */
export const collectSummaryResultSemanticClosure = (
  sheet: MindMapSheet,
  rootTopicId: TopicId,
  excludedSummaryIds: ReadonlySet<SummaryId> = new Set(),
): SummaryResultSemanticClosure => {
  const topicIds: TopicId[] = [];
  const topicSet = new Set<TopicId>();
  const summaryIds: SummaryId[] = [];
  const summarySet = new Set<SummaryId>(excludedSummaryIds);
  const addResultTree = (resultTopicId: TopicId): void => {
    for (const topicId of descendantsFrom(sheet, resultTopicId)) {
      if (topicSet.has(topicId)) continue;
      topicSet.add(topicId);
      topicIds.push(topicId);
    }
  };
  addResultTree(rootTopicId);
  let changed = true;
  while (changed) {
    changed = false;
    for (const summary of Object.values(sheet.summaries)
      .sort((left, right) => compareAscii(left.id, right.id))) {
      if (summarySet.has(summary.id)) continue;
      const members = expandSemanticTopicScope(sheet, summary.scope);
      if (members.length === 0 || !members.every((topicId) => topicSet.has(topicId))) continue;
      summarySet.add(summary.id);
      summaryIds.push(summary.id);
      const beforeSize = topicSet.size;
      addResultTree(summary.resultTopicId);
      if (topicSet.size > beforeSize) changed = true;
    }
  }
  return { topicIds, summaryIds };
};

/** Computes only affected Boundary scope plans; identity allocation stays with commands. */
export const planBoundaryScopeNormalizations = (
  before: MindMapSheet,
  after: MindMapSheet,
): readonly BoundaryScopeNormalizationPlan[] => Object.values(before.boundaries)
  .sort((left, right) => compareAscii(left.id, right.id))
  .flatMap((boundary) => {
    const intendedMembers = expandSemanticTopicScope(before, boundary.scope);
    const stillCovered = expandSemanticTopicScope(after, boundary.scope);
    const intendedSet = new Set(intendedMembers);
    if (
      intendedMembers.length > 0
      && intendedSet.size === stillCovered.length
      && stillCovered.every((topicId) => intendedSet.has(topicId))
    ) return [];
    const scopes = normalizeExactSemanticScopeMembers(after, intendedMembers)
      .groups.map((group) => group.scope);
    return scopes.length === 1 && semanticScopesEqual(scopes[0], boundary.scope)
      ? []
      : [{ boundaryId: boundary.id, scopes }];
  });

const deleteTopicSubtreeFromProjection = (
  sheet: MindMapSheet,
  rootTopicId: TopicId,
): boolean => {
  if (!sheet.topics[rootTopicId]) return false;
  const deleted = new Set(descendantsFrom(sheet, rootTopicId));
  for (const topicId of deleted) delete sheet.topics[topicId];
  for (const edge of Object.values(sheet.treeEdges)) {
    if (deleted.has(edge.parentTopicId) || deleted.has(edge.childTopicId)) {
      delete sheet.treeEdges[edge.id];
    }
  }
  return deleted.size > 0;
};

const rawSummaryScopeNormalizations = (
  before: MindMapSheet,
  after: MindMapSheet,
): SummaryScopeNormalizationPlan[] => Object.values(before.summaries)
  .sort((left, right) => compareAscii(left.id, right.id))
  .flatMap((summary) => {
    if (!after.topics[summary.resultTopicId]) {
      return [{ summaryId: summary.id, scopes: [] }];
    }
    const intendedMembers = expandSemanticTopicScope(before, summary.scope);
    const stillCovered = expandSemanticTopicScope(after, summary.scope);
    const intendedSet = new Set(intendedMembers);
    if (
      intendedMembers.length > 0
      && intendedSet.size === stillCovered.length
      && stillCovered.every((topicId) => intendedSet.has(topicId))
    ) return [];
    const scopes = normalizeExactSemanticScopeMembers(after, intendedMembers)
      .groups.map((group) => group.scope);
    return scopes.length === 1 && semanticScopesEqual(scopes[0], summary.scope)
      ? []
      : [{ summaryId: summary.id, scopes }];
  });

/**
 * Projects the structural side effects of Summary normalization. Empty scopes
 * delete their owned result subtrees, and that removal can in turn empty a
 * Summary nested in the deleted result tree. The fixed point deliberately does
 * not delete a result merely because one member disappeared.
 */
export const projectSummaryScopeNormalizationAfter = (
  before: MindMapSheet,
  after: MindMapSheet,
): MindMapSheet => {
  const projected = structuredClone(after);
  const deletedSummaryIds = new Set<SummaryId>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const plan of rawSummaryScopeNormalizations(before, projected)) {
      if (plan.scopes.length !== 0 || deletedSummaryIds.has(plan.summaryId)) continue;
      deletedSummaryIds.add(plan.summaryId);
      const source = before.summaries[plan.summaryId];
      if (source && deleteTopicSubtreeFromProjection(projected, source.resultTopicId)) {
        changed = true;
      }
    }
  }
  return projected;
};

/**
 * Re-encodes every affected Summary against the exact pre-mutation member
 * intent. Zero groups delete the Summary/result tree, one group preserves its
 * identity, and multiple groups retain the source for the first range while a
 * command planner allocates the remaining identities.
 */
export const planSummaryScopeNormalizations = (
  before: MindMapSheet,
  after: MindMapSheet,
): readonly SummaryScopeNormalizationPlan[] => rawSummaryScopeNormalizations(
  before,
  projectSummaryScopeNormalizationAfter(before, after),
);

/**
 * Mirrors the existing high-risk subtree/Summary cascade: any Summary whose
 * result or scope is touched contributes its complete result subtree, then the
 * process repeats to a fixed point.
 */
export const collectSummaryCascadeDeletionTopicIds = (
  sheet: MindMapSheet,
  initialTopicIds: ReadonlySet<TopicId>,
): Set<TopicId> => {
  const deleted = new Set(initialTopicIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const summary of Object.values(sheet.summaries)) {
      const scopeMembers = expandSemanticTopicScope(sheet, summary.scope);
      if (
        !deleted.has(summary.resultTopicId)
        && !scopeMembers.some((topicId) => deleted.has(topicId))
      ) continue;
      for (const topicId of descendantsFrom(sheet, summary.resultTopicId)) {
        if (!deleted.has(topicId)) {
          deleted.add(topicId);
          changed = true;
        }
      }
    }
  }
  return deleted;
};
