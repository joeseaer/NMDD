import type {
  Boundary,
  BoundaryId,
  Callout,
  CalloutId,
  MindMapDocumentV1,
  MindMapSheet,
  Point,
  Relationship,
  RelationshipEndpoint,
  RelationshipId,
  RelationshipTargetRef,
  SheetId,
  Summary,
  SummaryId,
  Topic,
  TopicId,
  TopicScope,
  TreeEdge,
  TreeEdgeId,
  Zone,
  ZoneId,
} from '../domain/types';
import { expandSemanticTopicScope } from '../domain/semanticScope';

export type RenderVisibility = 'visible' | 'hidden';
export type RenderEndpointVisibility = RenderVisibility | 'missing';

export interface CanonicalRenderItem<
  TKind extends string,
  TEntityId extends string,
  TEntity,
> {
  readonly kind: TKind;
  /** Stable identity for selection, commands, and renderer reconciliation. */
  readonly entityId: TEntityId;
  /** Read-only reference to the canonical entity; never renderer-owned state. */
  readonly entity: Readonly<TEntity>;
}

export type AutoTopicPlacementState =
  | { readonly status: 'not-applicable' }
  | { readonly status: 'pending' }
  | {
      readonly status: 'resolved';
      readonly position: Readonly<Point>;
    };

export type TopicRenderItem = CanonicalRenderItem<'topic', TopicId, Topic> & {
  readonly rootTopicId: TopicId;
  readonly parentTopicId?: TopicId;
  readonly incomingTreeEdgeId?: TreeEdgeId;
  readonly depth: number;
  readonly collapsed: boolean;
  /** Canonical absolute/offset/auto intent, kept separate from layout output. */
  readonly persistedPlacement: Readonly<Topic['placement']>;
  /** Derived coordinates exist only for canonical `mode: "auto"`. */
  readonly autoPlacement: AutoTopicPlacementState;
};

export type TreeEdgeRenderItem = CanonicalRenderItem<
  'tree-edge',
  TreeEdgeId,
  TreeEdge
> & {
  readonly parentDepth: number;
  readonly childDepth: number;
};

export interface RenderScopeMembership {
  readonly topicIds: readonly TopicId[];
  readonly visibleTopicIds: readonly TopicId[];
  readonly hiddenTopicIds: readonly TopicId[];
}

export type BoundaryRenderItem = CanonicalRenderItem<
  'boundary',
  BoundaryId,
  Boundary
> & {
  readonly membership: RenderScopeMembership;
  readonly visibility: RenderVisibility;
};

export type SummaryRenderItem = CanonicalRenderItem<
  'summary',
  SummaryId,
  Summary
> & {
  readonly membership: RenderScopeMembership;
  readonly resultTopicVisibility: RenderEndpointVisibility;
  readonly visibility: RenderVisibility;
};

export type CalloutRenderItem = CanonicalRenderItem<
  'callout',
  CalloutId,
  Callout
> & {
  readonly targetTopicVisibility: RenderEndpointVisibility;
  readonly visibility: RenderVisibility;
};

export type ZoneRenderItem = CanonicalRenderItem<'zone', ZoneId, Zone> & {
  readonly visibleRootTopicIds: readonly TopicId[];
  readonly hiddenRootTopicIds: readonly TopicId[];
  readonly visibility: RenderVisibility;
};

export interface RelationshipEndpointRenderState {
  readonly endpoint: Readonly<RelationshipEndpoint>;
  readonly targetKind: RelationshipTargetRef['kind'];
  readonly entityId: TopicId | BoundaryId | CalloutId | ZoneId;
  readonly visibility: RenderEndpointVisibility;
}

export type RelationshipRenderItem = CanonicalRenderItem<
  'relationship',
  RelationshipId,
  Relationship
> & {
  readonly source: RelationshipEndpointRenderState;
  readonly target: RelationshipEndpointRenderState;
  readonly visibility: RenderVisibility;
};

export interface VisibleTopicForest {
  readonly rootTopicIds: readonly TopicId[];
  readonly parentByTopicId: Readonly<Record<string, TopicId | null>>;
  readonly childrenByTopicId: Readonly<Record<string, readonly TopicId[]>>;
}

export interface MindMapRenderModel {
  readonly sheetEntityId: SheetId;
  readonly sheet: Readonly<MindMapSheet>;
  readonly focusRootTopicId?: TopicId;
  readonly collapsedTopicIds: readonly TopicId[];
  readonly hiddenTopicIds: readonly TopicId[];
  readonly visibleTopicForest: VisibleTopicForest;
  readonly topics: readonly TopicRenderItem[];
  readonly treeEdges: readonly TreeEdgeRenderItem[];
  readonly relationships: readonly RelationshipRenderItem[];
  readonly boundaries: readonly BoundaryRenderItem[];
  readonly summaries: readonly SummaryRenderItem[];
  readonly callouts: readonly CalloutRenderItem[];
  readonly zones: readonly ZoneRenderItem[];
}

export interface MindMapRenderProjectionInput {
  readonly document: Readonly<MindMapDocumentV1>;
  readonly activeSheetId: SheetId;
  /**
   * Effective collapsed IDs. When omitted, Topic.defaultCollapsed is used;
   * when supplied (including an empty collection), it is authoritative.
   */
  readonly collapsedTopicIds?: readonly TopicId[] | ReadonlySet<TopicId>;
  readonly focusRootTopicId?: TopicId;
  /** Layout-engine output. Entries for absolute/offset Topics are ignored. */
  readonly derivedAutoTopicPositions?: Readonly<Record<string, Readonly<Point>>>;
}

interface TreeIndex {
  readonly childrenByParent: ReadonlyMap<TopicId, readonly TreeEdge[]>;
  readonly incomingByChild: ReadonlyMap<TopicId, TreeEdge>;
}

const compareAscii = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const compareTreeEdges = (left: TreeEdge, right: TreeEdge): number =>
  compareAscii(left.orderKey, right.orderKey) || compareAscii(left.id, right.id);

const compareEntities = <T extends { id: string }>(left: T, right: T): number =>
  compareAscii(left.id, right.id);

const freezeArray = <T>(items: T[]): readonly T[] => Object.freeze(items);

const buildTreeIndex = (sheet: MindMapSheet): TreeIndex => {
  const children = new Map<TopicId, TreeEdge[]>();
  const incoming = new Map<TopicId, TreeEdge>();
  const edges = Object.values(sheet.treeEdges)
    .filter((edge) => sheet.topics[edge.parentTopicId] && sheet.topics[edge.childTopicId])
    .sort(compareTreeEdges);

  for (const edge of edges) {
    const group = children.get(edge.parentTopicId) ?? [];
    group.push(edge);
    children.set(edge.parentTopicId, group);
    if (!incoming.has(edge.childTopicId)) incoming.set(edge.childTopicId, edge);
  }
  for (const group of children.values()) group.sort(compareTreeEdges);
  return { childrenByParent: children, incomingByChild: incoming };
};

const stableRootTopicIds = (sheet: MindMapSheet, index: TreeIndex): TopicId[] => {
  const roleRank: Record<Topic['role'], number> = {
    central: 0,
    'floating-root': 1,
    'summary-result': 2,
    regular: 3,
  };
  return Object.values(sheet.topics)
    .filter((topic) => !index.incomingByChild.has(topic.id))
    .sort((left, right) => {
      if (left.id === sheet.rootTopicId) return -1;
      if (right.id === sheet.rootTopicId) return 1;
      return roleRank[left.role] - roleRank[right.role] || compareAscii(left.id, right.id);
    })
    .map((topic) => topic.id);
};

/** Expands canonical scope semantics using TreeEdge only, in stable visual order. */
export const expandTopicScope = (
  sheet: MindMapSheet,
  scope: TopicScope,
): readonly TopicId[] => freezeArray(expandSemanticTopicScope(sheet, scope));

const endpointEntityId = (
  target: RelationshipTargetRef,
): TopicId | BoundaryId | CalloutId | ZoneId => {
  switch (target.kind) {
    case 'topic': return target.topicId;
    case 'boundary': return target.boundaryId;
    case 'callout': return target.calloutId;
    case 'zone': return target.zoneId;
  }
};

const scopeMembership = (
  sheet: MindMapSheet,
  scope: TopicScope,
  visibleTopicIds: ReadonlySet<TopicId>,
): RenderScopeMembership => {
  const topicIds = expandTopicScope(sheet, scope);
  const visible = topicIds.filter((id) => visibleTopicIds.has(id));
  const hidden = topicIds.filter((id) => !visibleTopicIds.has(id));
  return Object.freeze({
    topicIds,
    visibleTopicIds: freezeArray(visible),
    hiddenTopicIds: freezeArray(hidden),
  });
};

/**
 * Builds renderer-neutral, read-only derived state. The function reads
 * Relationship only after the visible forest has been finalized, so a
 * Relationship can never introduce descendants or change collapse behavior.
 */
export const projectMindMapToRenderModel = (
  input: MindMapRenderProjectionInput,
): MindMapRenderModel | null => {
  const sheet = input.document.sheets[input.activeSheetId];
  if (!sheet) return null;

  const index = buildTreeIndex(sheet);
  const requestedCollapsed = input.collapsedTopicIds === undefined
    ? new Set(Object.values(sheet.topics)
        .filter((topic) => topic.defaultCollapsed)
        .map((topic) => topic.id))
    : new Set(input.collapsedTopicIds);
  const requestedFocus = input.focusRootTopicId;
  const focusRootTopicId = requestedFocus && sheet.topics[requestedFocus]
    ? requestedFocus
    : undefined;
  const focusLineage: TopicId[] = [];
  if (focusRootTopicId) {
    const seen = new Set<TopicId>();
    let cursor: TopicId | undefined = focusRootTopicId;
    while (cursor && sheet.topics[cursor] && !seen.has(cursor)) {
      seen.add(cursor);
      focusLineage.unshift(cursor);
      cursor = index.incomingByChild.get(cursor)?.parentTopicId;
    }
  }
  const focusAncestorIds = new Set(focusLineage.slice(0, -1));
  const collapsed = new Set(
    [...requestedCollapsed].filter((topicId) => !focusAncestorIds.has(topicId)),
  );
  const focusPathChildByParent = new Map<TopicId, TopicId>();
  for (let pathIndex = 0; pathIndex < focusLineage.length - 1; pathIndex += 1) {
    focusPathChildByParent.set(focusLineage[pathIndex], focusLineage[pathIndex + 1]);
  }
  const candidateRoots = focusRootTopicId
    ? [focusLineage[0] ?? focusRootTopicId]
    : stableRootTopicIds(sheet, index);

  const topicItems: TopicRenderItem[] = [];
  const edgeItems: TreeEdgeRenderItem[] = [];
  const visible = new Set<TopicId>();
  const rootTopicIds: TopicId[] = [];
  const parentByTopicId: Record<string, TopicId | null> = {};
  const childrenByTopicId: Record<string, TopicId[]> = {};

  interface PendingTopic {
    topicId: TopicId;
    rootTopicId: TopicId;
    parentTopicId?: TopicId;
    incomingEdge?: TreeEdge;
    depth: number;
  }

  const visitRoot = (rootTopicId: TopicId): void => {
    if (!sheet.topics[rootTopicId] || visible.has(rootTopicId)) return;
    rootTopicIds.push(rootTopicId);
    const pending: PendingTopic[] = [{ topicId: rootTopicId, rootTopicId, depth: 0 }];
    while (pending.length > 0) {
      const current = pending.pop()!;
      const topic = sheet.topics[current.topicId];
      if (!topic || visible.has(topic.id)) continue;
      visible.add(topic.id);
      parentByTopicId[topic.id] = current.parentTopicId ?? null;
      childrenByTopicId[topic.id] = [];
      if (current.parentTopicId) {
        childrenByTopicId[current.parentTopicId]?.push(topic.id);
      }

      const persistedPlacement = Object.freeze({ ...topic.placement }) as Readonly<Topic['placement']>;
      let autoPlacement: AutoTopicPlacementState = Object.freeze({ status: 'not-applicable' });
      if (topic.placement.mode === 'auto') {
        const derived = input.derivedAutoTopicPositions?.[topic.id];
        autoPlacement = derived
          ? Object.freeze({
              status: 'resolved',
              position: Object.freeze({ x: derived.x, y: derived.y }),
            })
          : Object.freeze({ status: 'pending' });
      }
      topicItems.push(Object.freeze({
        kind: 'topic',
        entityId: topic.id,
        entity: topic,
        rootTopicId: current.rootTopicId,
        ...(current.parentTopicId ? { parentTopicId: current.parentTopicId } : {}),
        ...(current.incomingEdge ? { incomingTreeEdgeId: current.incomingEdge.id } : {}),
        depth: current.depth,
        collapsed: collapsed.has(topic.id),
        persistedPlacement,
        autoPlacement,
      }));
      if (current.incomingEdge) {
        edgeItems.push(Object.freeze({
          kind: 'tree-edge',
          entityId: current.incomingEdge.id,
          entity: current.incomingEdge,
          parentDepth: current.depth - 1,
          childDepth: current.depth,
        }));
      }
      if (collapsed.has(topic.id)) continue;
      const allChildEdges = index.childrenByParent.get(topic.id) ?? [];
      const focusPathChild = focusPathChildByParent.get(topic.id);
      const childEdges = focusPathChild
        ? allChildEdges.filter((edge) => edge.childTopicId === focusPathChild)
        : allChildEdges;
      for (let childIndex = childEdges.length - 1; childIndex >= 0; childIndex -= 1) {
        const edge = childEdges[childIndex];
        pending.push({
          topicId: edge.childTopicId,
          rootTopicId: current.rootTopicId,
          parentTopicId: topic.id,
          incomingEdge: edge,
          depth: current.depth + 1,
        });
      }
    }
  };

  for (const rootId of candidateRoots) visitRoot(rootId);

  const visibleTopicIds = visible as ReadonlySet<TopicId>;
  const hiddenTopicIds = Object.values(sheet.topics)
    .map((topic) => topic.id)
    .filter((id) => !visible.has(id))
    .sort(compareAscii);

  const boundaries: BoundaryRenderItem[] = Object.values(sheet.boundaries)
    .sort(compareEntities)
    .map((entity) => {
      const membership = scopeMembership(sheet, entity.scope, visibleTopicIds);
      return Object.freeze({
        kind: 'boundary' as const,
        entityId: entity.id,
        entity,
        membership,
        visibility: membership.visibleTopicIds.length > 0 ? 'visible' as const : 'hidden' as const,
      });
    });
  const boundaryVisibility = new Map(boundaries.map((item) => [item.entityId, item.visibility]));

  const summaries: SummaryRenderItem[] = Object.values(sheet.summaries)
    .sort(compareEntities)
    .map((entity) => {
      const membership = scopeMembership(sheet, entity.scope, visibleTopicIds);
      const resultTopicVisibility: RenderEndpointVisibility = !sheet.topics[entity.resultTopicId]
        ? 'missing'
        : visible.has(entity.resultTopicId) ? 'visible' : 'hidden';
      return Object.freeze({
        kind: 'summary' as const,
        entityId: entity.id,
        entity,
        membership,
        resultTopicVisibility,
        visibility: membership.visibleTopicIds.length > 0 && resultTopicVisibility === 'visible'
          ? 'visible' as const
          : 'hidden' as const,
      });
    });

  const callouts: CalloutRenderItem[] = Object.values(sheet.callouts)
    .sort(compareEntities)
    .map((entity) => {
      const targetTopicVisibility: RenderEndpointVisibility = !sheet.topics[entity.targetTopicId]
        ? 'missing'
        : visible.has(entity.targetTopicId) ? 'visible' : 'hidden';
      return Object.freeze({
        kind: 'callout' as const,
        entityId: entity.id,
        entity,
        targetTopicVisibility,
        visibility: targetTopicVisibility === 'visible' ? 'visible' as const : 'hidden' as const,
      });
    });
  const calloutVisibility = new Map(callouts.map((item) => [item.entityId, item.visibility]));

  const zones: ZoneRenderItem[] = Object.values(sheet.zones)
    .sort((left, right) =>
      compareAscii(left.zOrderKey, right.zOrderKey) || compareAscii(left.id, right.id))
    .map((entity) => {
      const visibleRoots = entity.rootTopicIds.filter((id) => visible.has(id));
      const hiddenRoots = entity.rootTopicIds.filter((id) => !visible.has(id));
      return Object.freeze({
        kind: 'zone' as const,
        entityId: entity.id,
        entity,
        visibleRootTopicIds: freezeArray(visibleRoots),
        hiddenRootTopicIds: freezeArray(hiddenRoots),
        visibility: visibleRoots.length > 0 ? 'visible' as const : 'hidden' as const,
      });
    });
  const zoneVisibility = new Map(zones.map((item) => [item.entityId, item.visibility]));

  const endpointState = (endpoint: RelationshipEndpoint): RelationshipEndpointRenderState => {
    const target = endpoint.element;
    let visibility: RenderEndpointVisibility;
    switch (target.kind) {
      case 'topic':
        visibility = !sheet.topics[target.topicId]
          ? 'missing'
          : visible.has(target.topicId) ? 'visible' : 'hidden';
        break;
      case 'boundary':
        visibility = !sheet.boundaries[target.boundaryId]
          ? 'missing'
          : boundaryVisibility.get(target.boundaryId) ?? 'hidden';
        break;
      case 'callout':
        visibility = !sheet.callouts[target.calloutId]
          ? 'missing'
          : calloutVisibility.get(target.calloutId) ?? 'hidden';
        break;
      case 'zone':
        visibility = !sheet.zones[target.zoneId]
          ? 'missing'
          : zoneVisibility.get(target.zoneId) ?? 'hidden';
        break;
    }
    return Object.freeze({
      endpoint,
      targetKind: target.kind,
      entityId: endpointEntityId(target),
      visibility,
    });
  };

  const relationships: RelationshipRenderItem[] = Object.values(sheet.relationships)
    .sort(compareEntities)
    .map((entity) => {
      const source = endpointState(entity.source);
      const target = endpointState(entity.target);
      return Object.freeze({
        kind: 'relationship' as const,
        entityId: entity.id,
        entity,
        source,
        target,
        visibility: source.visibility === 'visible' && target.visibility === 'visible'
          ? 'visible' as const
          : 'hidden' as const,
      });
    });

  const readonlyChildren: Record<string, readonly TopicId[]> = {};
  for (const [topicId, children] of Object.entries(childrenByTopicId)) {
    readonlyChildren[topicId] = freezeArray(children);
  }
  const visibleTopicForest: VisibleTopicForest = Object.freeze({
    rootTopicIds: freezeArray(rootTopicIds),
    parentByTopicId: Object.freeze(parentByTopicId),
    childrenByTopicId: Object.freeze(readonlyChildren),
  });

  return Object.freeze({
    sheetEntityId: sheet.id,
    sheet,
    ...(focusRootTopicId ? { focusRootTopicId } : {}),
    collapsedTopicIds: freezeArray([...collapsed].filter((id) => Boolean(sheet.topics[id])).sort(compareAscii)),
    hiddenTopicIds: freezeArray(hiddenTopicIds),
    visibleTopicForest,
    topics: freezeArray(topicItems),
    treeEdges: freezeArray(edgeItems),
    relationships: freezeArray(relationships),
    boundaries: freezeArray(boundaries),
    summaries: freezeArray(summaries),
    callouts: freezeArray(callouts),
    zones: freezeArray(zones),
  });
};
