import type * as Domain from '../domain/types';
import {
  getChildEdgesSorted,
  getDescendants,
  getParentEdge,
  getTreeRoots,
} from '../domain/tree';
import { expandSemanticTopicScope } from '../domain/semanticScope';
import {
  MIND_MAP_CLIPBOARD_SCHEMA,
  MIND_MAP_CLIPBOARD_SCHEMA_VERSION,
  MindMapClipboardError,
  type ClipboardOmission,
  type ClipboardRootHint,
  type EncodeMindMapClipboardInput,
  type MindMapClipboardEnvelopeV1,
  type MindMapClipboardFragment,
} from './types';

type AuditedEntity = { audit?: Domain.EntityAudit; id: string };

function cloneEntity<T extends AuditedEntity>(entity: T): T {
  const clone = structuredClone(entity);
  delete clone.audit;
  return clone;
}

function traversalRank(sheet: Domain.MindMapSheet): Map<Domain.TopicId, number> {
  const rank = new Map<Domain.TopicId, number>();
  const visited = new Set<Domain.TopicId>();
  let nextRank = 0;

  const visit = (topicId: Domain.TopicId): void => {
    if (visited.has(topicId) || !sheet.topics[topicId]) return;
    visited.add(topicId);
    rank.set(topicId, nextRank);
    nextRank += 1;
    for (const edge of getChildEdgesSorted(sheet, topicId)) visit(edge.childTopicId);
  };

  for (const root of getTreeRoots(sheet)) visit(root.id);
  for (const topicId of Object.keys(sheet.topics).sort() as Domain.TopicId[]) visit(topicId);
  return rank;
}

function normalizeSelection(
  sheet: Domain.MindMapSheet,
  selectedTopicIds: readonly Domain.TopicId[],
): Domain.TopicId[] {
  if (selectedTopicIds.length === 0) {
    throw new MindMapClipboardError(
      'clipboard.empty-selection',
      'At least one topic must be selected for clipboard encoding.',
    );
  }

  const unique = new Set<Domain.TopicId>();
  for (const topicId of selectedTopicIds) {
    if (!sheet.topics[topicId]) {
      throw new MindMapClipboardError(
        'clipboard.invalid-selection',
        `Selected topic ${topicId} does not exist in the source sheet.`,
        [topicId],
      );
    }
    unique.add(topicId);
  }

  const roots = [...unique].filter((topicId) => {
    const visited = new Set<Domain.TopicId>([topicId]);
    let edge = getParentEdge(sheet, topicId);
    while (edge) {
      if (unique.has(edge.parentTopicId)) return false;
      if (visited.has(edge.parentTopicId)) break;
      visited.add(edge.parentTopicId);
      edge = getParentEdge(sheet, edge.parentTopicId);
    }
    return true;
  });

  const rank = traversalRank(sheet);
  return roots.sort((left, right) =>
    (rank.get(left) ?? Number.MAX_SAFE_INTEGER) -
      (rank.get(right) ?? Number.MAX_SAFE_INTEGER) ||
    (left < right ? -1 : left > right ? 1 : 0));
}

function collectSubtreeTopicIds(
  sheet: Domain.MindMapSheet,
  rootTopicIds: readonly Domain.TopicId[],
): Set<Domain.TopicId> {
  const topicIds = new Set<Domain.TopicId>();
  for (const rootTopicId of rootTopicIds) {
    topicIds.add(rootTopicId);
    for (const descendant of getDescendants(sheet, rootTopicId)) topicIds.add(descendant.id);
  }
  return topicIds;
}

function expandTopicScope(
  sheet: Domain.MindMapSheet,
  scope: Domain.TopicScope,
): Domain.TopicId[] | undefined {
  const expanded = expandSemanticTopicScope(sheet, scope);
  return expanded.length > 0 ? expanded : undefined;
}

function copyRecord<I extends string, E extends AuditedEntity>(
  source: Record<I, E>,
  predicate: (entity: E) => boolean,
): Record<I, E> {
  const target = {} as Record<I, E>;
  for (const entity of Object.values(source) as E[]) {
    if (predicate(entity)) target[entity.id as I] = cloneEntity(entity);
  }
  return target;
}

function endpointIncluded(
  endpoint: Domain.RelationshipEndpoint,
  fragment: Pick<
    MindMapClipboardFragment,
    'boundaries' | 'callouts' | 'topics' | 'zones'
  >,
): boolean {
  const element = endpoint.element;
  switch (element.kind) {
    case 'topic':
      return fragment.topics[element.topicId] !== undefined;
    case 'boundary':
      return fragment.boundaries[element.boundaryId] !== undefined;
    case 'callout':
      return fragment.callouts[element.calloutId] !== undefined;
    case 'zone':
      return fragment.zones[element.zoneId] !== undefined;
  }
}

function collectReferencedStyleIds(
  document: Domain.MindMapDocumentV1,
  entities: ReadonlyArray<{ style?: Domain.StyleBinding }>,
): Domain.StyleId[] {
  const pending = entities
    .map((entity) => entity.style?.styleId)
    .filter((id): id is Domain.StyleId => id !== undefined);
  const collected = new Set<Domain.StyleId>();

  while (pending.length > 0) {
    const styleId = pending.pop();
    if (!styleId || collected.has(styleId)) continue;
    const definition = document.styles[styleId];
    if (!definition) continue;
    collected.add(styleId);
    if (definition.basedOnStyleId) pending.push(definition.basedOnStyleId);
  }
  return [...collected];
}

function makeRootHints(
  sheet: Domain.MindMapSheet,
  rootTopicIds: readonly Domain.TopicId[],
): ClipboardRootHint[] {
  return rootTopicIds.map((topicId, index) => {
    const incoming = getParentEdge(sheet, topicId);
    return {
      orderKey: incoming?.orderKey ?? `root-${index.toString(36)}`,
      side: incoming?.side ?? 'center',
      ...(incoming?.slot === undefined ? {} : { slot: incoming.slot }),
      topicId,
    };
  });
}

export function collectMindMapClipboardEnvelope(
  input: EncodeMindMapClipboardInput,
): MindMapClipboardEnvelopeV1 {
  const sheet = input.document.sheets[input.sheetId];
  if (!sheet) {
    throw new MindMapClipboardError(
      'clipboard.invalid-selection',
      `Source sheet ${input.sheetId} does not exist.`,
      [input.sheetId],
    );
  }

  const rootTopicIds = normalizeSelection(sheet, input.selectedTopicIds);
  const topicIds = collectSubtreeTopicIds(sheet, rootTopicIds);
  const omissions: ClipboardOmission[] = [];

  // Summary result topics are separate canonical roots. When the complete
  // summarized scope is copied, pull the result subtree into the fragment so
  // the Summary remains a valid semantic entity after a cross-document paste.
  let expandedSummaryResult = true;
  while (expandedSummaryResult) {
    expandedSummaryResult = false;
    for (const summary of Object.values(sheet.summaries)) {
      const scopeTopicIds = expandTopicScope(sheet, summary.scope);
      if (
        !scopeTopicIds ||
        scopeTopicIds.length === 0 ||
        !scopeTopicIds.every((id) => topicIds.has(id)) ||
        topicIds.has(summary.resultTopicId) ||
        !sheet.topics[summary.resultTopicId]
      ) {
        continue;
      }
      topicIds.add(summary.resultTopicId);
      for (const descendant of getDescendants(sheet, summary.resultTopicId)) {
        topicIds.add(descendant.id);
      }
      expandedSummaryResult = true;
    }
  }

  const topics = copyRecord(sheet.topics, (topic) => topicIds.has(topic.id));
  const treeEdges = copyRecord(
    sheet.treeEdges,
    (edge) => topicIds.has(edge.parentTopicId) && topicIds.has(edge.childTopicId),
  );

  const boundaries = {} as Domain.BoundaryMap;
  for (const boundary of Object.values(sheet.boundaries)) {
    const scopeTopicIds = expandTopicScope(sheet, boundary.scope);
    if (scopeTopicIds && scopeTopicIds.length > 0 && scopeTopicIds.every((id) => topicIds.has(id))) {
      const copy = cloneEntity(boundary);
      copy.scope = { kind: 'explicit', topicIds: scopeTopicIds };
      boundaries[copy.id] = copy;
    } else if (scopeTopicIds?.some((id) => topicIds.has(id))) {
      omissions.push({
        entityId: boundary.id,
        entityType: 'boundary',
        reason: 'external-scope',
      });
    }
  }

  const summaries = {} as Domain.SummaryMap;
  for (const summary of Object.values(sheet.summaries)) {
    const scopeTopicIds = expandTopicScope(sheet, summary.scope);
    if (
      topicIds.has(summary.resultTopicId) &&
      scopeTopicIds &&
      scopeTopicIds.length > 0 &&
      scopeTopicIds.every((id) => topicIds.has(id))
    ) {
      const copy = cloneEntity(summary);
      copy.scope = { kind: 'explicit', topicIds: scopeTopicIds };
      summaries[copy.id] = copy;
    } else if (
      topicIds.has(summary.resultTopicId) ||
      scopeTopicIds?.some((id) => topicIds.has(id))
    ) {
      omissions.push({
        entityId: summary.id,
        entityType: 'summary',
        reason: 'external-scope',
      });
    }
  }

  const callouts = copyRecord(sheet.callouts, (callout) => topicIds.has(callout.targetTopicId));
  const zones = {} as Domain.ZoneMap;
  for (const zone of Object.values(sheet.zones)) {
    const includedRoots = zone.rootTopicIds.filter((id) => topicIds.has(id));
    if (zone.rootTopicIds.length > 0 && includedRoots.length === zone.rootTopicIds.length) {
      zones[zone.id] = cloneEntity(zone);
    } else if (includedRoots.length > 0) {
      omissions.push({ entityId: zone.id, entityType: 'zone', reason: 'partial-zone' });
    }
  }

  const relationshipContext = { boundaries, callouts, topics, zones };
  const relationships = {} as Domain.RelationshipMap;
  for (const relationship of Object.values(sheet.relationships)) {
    if (
      endpointIncluded(relationship.source, relationshipContext) &&
      endpointIncluded(relationship.target, relationshipContext)
    ) {
      relationships[relationship.id] = cloneEntity(relationship);
    } else if (
      endpointIncluded(relationship.source, relationshipContext) ||
      endpointIncluded(relationship.target, relationshipContext)
    ) {
      omissions.push({
        entityId: relationship.id,
        entityType: 'relationship',
        reason: 'external-endpoint',
      });
    }
  }

  const markerInstances = copyRecord(
    sheet.markerInstances,
    (instance) => topicIds.has(instance.topicId),
  );
  const markerDefinitionIds = new Set(
    Object.values(markerInstances).map((instance) => instance.markerDefinitionId),
  );
  const markerDefinitions = copyRecord(
    input.document.markerDefinitions,
    (definition) => markerDefinitionIds.has(definition.id),
  );
  const markerGroupIds = new Set(
    Object.values(markerDefinitions).map((definition) => definition.groupId),
  );
  const markerGroups = copyRecord(
    input.document.markerGroups,
    (group) => markerGroupIds.has(group.id),
  );

  const notes = copyRecord(sheet.notes, (note) => topicIds.has(note.topicId));
  const attachments = copyRecord(
    sheet.attachments,
    (attachment) => topicIds.has(attachment.topicId),
  );
  const images = copyRecord(sheet.images, (image) => topicIds.has(image.topicId));
  const equations = copyRecord(
    sheet.equations,
    (equation) => topicIds.has(equation.topicId),
  );
  const audioClips = copyRecord(
    sheet.audioClips,
    (clip) => topicIds.has(clip.topicId),
  );
  const todos = copyRecord(sheet.todos, (todo) => topicIds.has(todo.topicId));
  const tasks = copyRecord(sheet.tasks, (task) => topicIds.has(task.topicId));
  for (const task of Object.values(tasks)) delete task.assigneeIds;
  const taskIds = new Set(Object.keys(tasks) as Domain.TaskId[]);
  const taskDependencies = copyRecord(
    sheet.taskDependencies,
    (dependency) =>
      taskIds.has(dependency.predecessorTaskId) && taskIds.has(dependency.successorTaskId),
  );

  const links = {} as Domain.TopicLinkMap;
  for (const link of Object.values(sheet.links)) {
    if (!topicIds.has(link.topicId)) continue;
    if (link.kind === 'sheet') {
      omissions.push({ entityId: link.id, entityType: 'link', reason: 'sheet-link' });
      continue;
    }
    if (link.kind === 'topic') {
      if (link.targetSheetId !== input.sheetId || !topicIds.has(link.targetTopicId)) {
        omissions.push({
          entityId: link.id,
          entityType: 'link',
          reason: 'external-topic-link',
        });
        continue;
      }
    }
    links[link.id] = cloneEntity(link);
  }

  const assetIds = new Set<Domain.AssetId>();
  for (const attachment of Object.values(attachments)) assetIds.add(attachment.assetId);
  for (const image of Object.values(images)) assetIds.add(image.assetId);
  for (const clip of Object.values(audioClips)) assetIds.add(clip.assetId);
  for (const definition of Object.values(markerDefinitions)) {
    if (definition.source.kind === 'asset') assetIds.add(definition.source.assetId);
  }
  const assets = copyRecord(input.document.assets, (asset) => assetIds.has(asset.id));

  const styledEntities: Array<{ style?: Domain.StyleBinding }> = [
    ...Object.values(topics),
    ...Object.values(treeEdges),
    ...Object.values(relationships),
    ...Object.values(boundaries),
    ...Object.values(summaries),
    ...Object.values(callouts),
    ...Object.values(zones),
  ];
  const styleIds = new Set(collectReferencedStyleIds(input.document, styledEntities));
  const styles = copyRecord(input.document.styles, (style) => styleIds.has(style.id));

  return {
    fragment: {
      assets,
      attachments,
      audioClips,
      boundaries,
      callouts,
      equations,
      images,
      links,
      markerDefinitions,
      markerGroups,
      markerInstances,
      notes,
      relationships,
      styles,
      summaries,
      taskDependencies,
      tasks,
      todos,
      topics,
      treeEdges,
      zones,
    },
    report: { omissions },
    rootHints: makeRootHints(sheet, rootTopicIds),
    rootTopicIds,
    schema: MIND_MAP_CLIPBOARD_SCHEMA,
    schemaVersion: MIND_MAP_CLIPBOARD_SCHEMA_VERSION,
    source: {
      contentRevision: input.document.contentRevision,
      documentId: input.document.id,
      sheetId: input.sheetId,
    },
  };
}
