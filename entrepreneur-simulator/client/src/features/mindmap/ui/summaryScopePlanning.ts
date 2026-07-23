import { createEntityId } from '../domain/ids';
import {
  collectSummaryResultSemanticClosure,
  expandSemanticTopicScope,
  planSummaryScopeNormalizations,
} from '../domain/semanticScope';
import type {
  Attachment,
  AudioClip,
  Boundary,
  Callout,
  Equation,
  Id,
  LinkId,
  MarkerInstance,
  MindMapSheet,
  Note,
  Relationship,
  RelationshipTargetRef,
  Summary,
  SummaryId,
  TaskDependency,
  TaskId,
  Topic,
  TopicId,
  TopicImage,
  TopicLink,
  TopicTask,
  TopicTodo,
  TopicScope,
  TreeEdge,
  TreeEdgeId,
  Zone,
} from '../domain/types';
import type {
  SummaryResultSubtreeClone,
  SummaryScopeChange,
} from '../commands/types';

export interface MaterializeSummaryScopeChangesInput {
  readonly before: MindMapSheet;
  readonly after: MindMapSheet;
  /** Optional deterministic queue for the additional split Summary IDs. */
  readonly splitSummaryIds?: readonly SummaryId[];
}

const compareAscii = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const sortedById = <T extends { readonly id: string }>(values: readonly T[]): T[] =>
  [...values].sort((left, right) => compareAscii(left.id, right.id));

const compareTreeEdges = (left: TreeEdge, right: TreeEdge): number =>
  compareAscii(left.orderKey, right.orderKey) || compareAscii(left.id, right.id);

const collectEntityIds = (value: unknown, result = new Set<string>()): Set<string> => {
  if (!value || typeof value !== 'object') return result;
  if (!Array.isArray(value) && typeof (value as { id?: unknown }).id === 'string') {
    result.add((value as { id: string }).id);
  }
  for (const child of Object.values(value)) collectEntityIds(child, result);
  return result;
};

const allocateFreshId = <Kind extends string>(
  occupied: Set<string>,
  supplied?: Id<Kind>,
): Id<Kind> => {
  if (supplied !== undefined) {
    if (occupied.has(supplied)) throw new Error(`Summary split ID ${supplied} is already in use.`);
    occupied.add(supplied);
    return supplied;
  }
  let id = createEntityId<Kind>();
  while (occupied.has(id)) id = createEntityId<Kind>();
  occupied.add(id);
  return id;
};

const cloneTopicOwnedEntities = <T extends { id: Id<Kind>; topicId: TopicId }, Kind extends string>(
  values: readonly T[],
  topicIds: ReadonlySet<TopicId>,
  topicMap: ReadonlyMap<TopicId, TopicId>,
  occupied: Set<string>,
): T[] => sortedById(values.filter((value) => topicIds.has(value.topicId))).map((value) => ({
  ...structuredClone(value),
  id: allocateFreshId(occupied) as Id<Kind>,
  topicId: topicMap.get(value.topicId)!,
} as T));

const remapScope = (
  scope: TopicScope,
  topicMap: ReadonlyMap<TopicId, TopicId>,
  edgeMap: ReadonlyMap<TreeEdgeId, TreeEdgeId>,
): TopicScope => {
  if (scope.kind === 'explicit') {
    return {
      kind: 'explicit',
      topicIds: scope.topicIds.map((topicId) => topicMap.get(topicId)
        ?? (() => { throw new Error(`Summary clone scope Topic ${topicId} is outside closure.`); })()),
    };
  }
  if (scope.kind === 'subtree') {
    const rootTopicId = topicMap.get(scope.rootTopicId);
    if (!rootTopicId) throw new Error(`Summary clone scope root ${scope.rootTopicId} is outside closure.`);
    return { ...structuredClone(scope), rootTopicId };
  }
  const parentTopicId = topicMap.get(scope.parentTopicId);
  const firstEdgeId = edgeMap.get(scope.firstEdgeId);
  const lastEdgeId = edgeMap.get(scope.lastEdgeId);
  if (!parentTopicId || !firstEdgeId || !lastEdgeId) {
    throw new Error('Summary clone sibling range is not fully contained in the result closure.');
  }
  return { ...structuredClone(scope), parentTopicId, firstEdgeId, lastEdgeId };
};

const scopeIsFullyContained = (
  sheet: MindMapSheet,
  scope: TopicScope,
  topicIds: ReadonlySet<TopicId>,
): boolean => {
  const members = expandSemanticTopicScope(sheet, scope);
  return members.length > 0 && members.every((topicId) => topicIds.has(topicId));
};

const remapRelationshipTarget = (
  target: RelationshipTargetRef,
  topicMap: ReadonlyMap<TopicId, TopicId>,
  boundaryMap: ReadonlyMap<string, Boundary['id']>,
  calloutMap: ReadonlyMap<string, Callout['id']>,
  zoneMap: ReadonlyMap<string, Zone['id']>,
): RelationshipTargetRef | undefined => {
  if (target.kind === 'topic') {
    const topicId = topicMap.get(target.topicId);
    return topicId ? { kind: 'topic', topicId } : undefined;
  }
  if (target.kind === 'boundary') {
    const boundaryId = boundaryMap.get(target.boundaryId);
    return boundaryId ? { kind: 'boundary', boundaryId } : undefined;
  }
  if (target.kind === 'callout') {
    const calloutId = calloutMap.get(target.calloutId);
    return calloutId ? { kind: 'callout', calloutId } : undefined;
  }
  const zoneId = zoneMap.get(target.zoneId);
  return zoneId ? { kind: 'zone', zoneId } : undefined;
};

const cloneResultSubtree = (
  sheet: MindMapSheet,
  rootTopicId: TopicId,
  sourceSummaryId: SummaryId,
  occupied: Set<string>,
): SummaryResultSubtreeClone => {
  const closure = collectSummaryResultSemanticClosure(
    sheet,
    rootTopicId,
    new Set([sourceSummaryId]),
  );
  const sourceTopics = closure.topicIds
    .map((topicId) => sheet.topics[topicId])
    .filter((topic): topic is Topic => Boolean(topic));
  if (sourceTopics.length === 0) {
    throw new Error(`Summary result topic ${rootTopicId} does not exist.`);
  }
  const sourceTopicIds = new Set(sourceTopics.map((topic) => topic.id));
  const topicMap = new Map<TopicId, TopicId>();
  for (const topic of sourceTopics) {
    topicMap.set(topic.id, allocateFreshId<'Topic'>(occupied));
  }
  const topics = sourceTopics.map<Topic>((topic) => ({
    ...structuredClone(topic),
    id: topicMap.get(topic.id)!,
  }));

  const sourceEdges = Object.values(sheet.treeEdges).filter((edge) =>
    sourceTopicIds.has(edge.parentTopicId) && sourceTopicIds.has(edge.childTopicId))
    .sort(compareTreeEdges);
  const edgeMap = new Map<TreeEdgeId, TreeEdgeId>();
  const treeEdges = sourceEdges.map<TreeEdge>((edge) => {
    const id = allocateFreshId<'TreeEdge'>(occupied);
    edgeMap.set(edge.id, id);
    return {
      ...structuredClone(edge),
      id,
      parentTopicId: topicMap.get(edge.parentTopicId)!,
      childTopicId: topicMap.get(edge.childTopicId)!,
    };
  });

  const nestedSummaryMap = new Map<SummaryId, SummaryId>();
  const sourceNestedSummaries = closure.summaryIds.map((summaryId) => sheet.summaries[summaryId]);
  for (const summary of sourceNestedSummaries) {
    nestedSummaryMap.set(summary.id, allocateFreshId<'Summary'>(occupied));
  }
  const summaries = sourceNestedSummaries.map<Summary>((summary) => ({
    ...structuredClone(summary),
    id: nestedSummaryMap.get(summary.id)!,
    scope: remapScope(summary.scope, topicMap, edgeMap),
    resultTopicId: topicMap.get(summary.resultTopicId)!,
  }));

  const sourceBoundaries = sortedById(Object.values(sheet.boundaries).filter((boundary) =>
    scopeIsFullyContained(sheet, boundary.scope, sourceTopicIds)));
  const boundaryMap = new Map<string, Boundary['id']>();
  const boundaries = sourceBoundaries.map<Boundary>((boundary) => {
    const id = allocateFreshId<'Boundary'>(occupied);
    boundaryMap.set(boundary.id, id);
    return {
      ...structuredClone(boundary),
      id,
      scope: remapScope(boundary.scope, topicMap, edgeMap),
    };
  });

  const sourceCallouts = sortedById(Object.values(sheet.callouts).filter((callout) =>
    sourceTopicIds.has(callout.targetTopicId)));
  const calloutMap = new Map<string, Callout['id']>();
  const callouts = sourceCallouts.map<Callout>((callout) => {
    const id = allocateFreshId<'Callout'>(occupied);
    calloutMap.set(callout.id, id);
    return {
      ...structuredClone(callout),
      id,
      targetTopicId: topicMap.get(callout.targetTopicId)!,
    };
  });

  // A valid result closure contains summary-result/regular Topics. Zone roots
  // must be parentless floating-root Topics, so this is normally empty; the
  // containment filter keeps the contract explicit and future-proof.
  const sourceZones = sortedById(Object.values(sheet.zones).filter((zone) =>
    zone.rootTopicIds.length > 0
    && zone.rootTopicIds.every((topicId) => sourceTopicIds.has(topicId))));
  const zoneMap = new Map<string, Zone['id']>();
  const zones = sourceZones.map<Zone>((zone) => {
    const id = allocateFreshId<'Zone'>(occupied);
    zoneMap.set(zone.id, id);
    return {
      ...structuredClone(zone),
      id,
      rootTopicIds: zone.rootTopicIds.map((topicId) => topicMap.get(topicId)!),
    };
  });

  const relationships = sortedById(Object.values(sheet.relationships)).flatMap<Relationship>(
    (relationship) => {
      const source = remapRelationshipTarget(
        relationship.source.element, topicMap, boundaryMap, calloutMap, zoneMap,
      );
      const target = remapRelationshipTarget(
        relationship.target.element, topicMap, boundaryMap, calloutMap, zoneMap,
      );
      // Cross-closure relationships remain attached only to the retained source
      // group. A clone never points back to an original semantic entity.
      if (!source || !target) return [];
      const controlPoints = relationship.controlPoints === undefined
        ? undefined
        : Object.fromEntries(
            sortedById(Object.values(relationship.controlPoints)).map((point) => {
              const id = allocateFreshId<'RelationshipControlPoint'>(occupied);
              return [id, { ...structuredClone(point), id }];
            }),
          ) as NonNullable<Relationship['controlPoints']>;
      return [{
        ...structuredClone(relationship),
        id: allocateFreshId<'Relationship'>(occupied),
        source: { ...structuredClone(relationship.source), element: source },
        target: { ...structuredClone(relationship.target), element: target },
        ...(controlPoints === undefined ? {} : { controlPoints }),
      }];
    },
  );

  const markerInstances = cloneTopicOwnedEntities<MarkerInstance, 'MarkerInstance'>(
    Object.values(sheet.markerInstances), sourceTopicIds, topicMap, occupied,
  );
  const notes = cloneTopicOwnedEntities<Note, 'Note'>(
    Object.values(sheet.notes), sourceTopicIds, topicMap, occupied,
  );
  const links = sortedById(Object.values(sheet.links).filter((link) =>
    sourceTopicIds.has(link.topicId))).map<TopicLink>((link) => {
    const cloned = {
      ...structuredClone(link),
      id: allocateFreshId<'Link'>(occupied) as LinkId,
      topicId: topicMap.get(link.topicId)!,
    } as TopicLink;
    if (
      cloned.kind === 'topic'
      && cloned.targetSheetId === sheet.id
      && topicMap.has(cloned.targetTopicId)
    ) cloned.targetTopicId = topicMap.get(cloned.targetTopicId)!;
    return cloned;
  });
  const attachments = cloneTopicOwnedEntities<Attachment, 'Attachment'>(
    Object.values(sheet.attachments), sourceTopicIds, topicMap, occupied,
  );
  const images = cloneTopicOwnedEntities<TopicImage, 'Image'>(
    Object.values(sheet.images), sourceTopicIds, topicMap, occupied,
  );
  const equations = cloneTopicOwnedEntities<Equation, 'Equation'>(
    Object.values(sheet.equations), sourceTopicIds, topicMap, occupied,
  );
  const audioClips = cloneTopicOwnedEntities<AudioClip, 'Audio'>(
    Object.values(sheet.audioClips), sourceTopicIds, topicMap, occupied,
  );
  const todos = cloneTopicOwnedEntities<TopicTodo, 'Todo'>(
    Object.values(sheet.todos), sourceTopicIds, topicMap, occupied,
  );
  const sourceTasks = sortedById(Object.values(sheet.tasks).filter((task) =>
    sourceTopicIds.has(task.topicId)));
  const taskMap = new Map<TaskId, TaskId>();
  const tasks = sourceTasks.map<TopicTask>((task) => {
    const id = allocateFreshId<'Task'>(occupied);
    taskMap.set(task.id, id);
    return {
      ...structuredClone(task),
      id,
      topicId: topicMap.get(task.topicId)!,
    };
  });
  const taskDependencies = sortedById(Object.values(sheet.taskDependencies).filter((dependency) =>
    taskMap.has(dependency.predecessorTaskId) && taskMap.has(dependency.successorTaskId)))
    .map<TaskDependency>((dependency) => ({
      ...structuredClone(dependency),
      id: allocateFreshId<'TaskDependency'>(occupied),
      predecessorTaskId: taskMap.get(dependency.predecessorTaskId)!,
      successorTaskId: taskMap.get(dependency.successorTaskId)!,
    }));

  return {
    topics,
    treeEdges,
    boundaries,
    summaries,
    callouts,
    relationships,
    zones,
    markerInstances,
    notes,
    links,
    attachments,
    images,
    equations,
    audioClips,
    todos,
    tasks,
    taskDependencies,
  };
};

/**
 * Adds all planner-owned identities to pure Summary normalization. The source
 * Summary/result subtree is retained by the first deterministic range.
 */
export const materializeSummaryScopeChanges = (
  input: MaterializeSummaryScopeChangesInput,
): SummaryScopeChange[] => {
  const suppliedSummaryIds = [...(input.splitSummaryIds ?? [])];
  let suppliedCursor = 0;
  const occupied = collectEntityIds(input.before);
  const changes: SummaryScopeChange[] = [];
  for (const plan of planSummaryScopeNormalizations(input.before, input.after)) {
    const source = input.before.summaries[plan.summaryId];
    if (!source) continue;
    const replacements = plan.scopes.map((scope, index) => {
      if (index === 0) {
        return {
          summary: {
            ...structuredClone(source),
            scope: structuredClone(scope),
          },
        };
      }
      const supplied = suppliedSummaryIds[suppliedCursor];
      if (supplied !== undefined) suppliedCursor += 1;
      const summaryId = allocateFreshId<'Summary'>(occupied, supplied);
      const resultSubtree = cloneResultSubtree(
        input.before,
        source.resultTopicId,
        source.id,
        occupied,
      );
      const resultTopicId = resultSubtree.topics[0]?.id;
      if (!resultTopicId) throw new Error(`Summary ${source.id} has no result subtree to clone.`);
      const summary: Summary = {
        ...structuredClone(source),
        id: summaryId,
        scope: structuredClone(scope),
        resultTopicId,
      };
      return { summary, resultSubtree };
    });
    changes.push({ summaryId: plan.summaryId, replacements });
  }
  if (suppliedCursor !== suppliedSummaryIds.length) {
    throw new Error(
      `Summary split supplied ${suppliedSummaryIds.length} IDs but only ${suppliedCursor} were required.`,
    );
  }
  return changes;
};
