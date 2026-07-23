import { createEntityId } from '../domain/ids';
import type * as Domain from '../domain/types';
import {
  MIND_MAP_CLIPBOARD_SCHEMA,
  MIND_MAP_CLIPBOARD_SCHEMA_VERSION,
  MindMapClipboardError,
  type ClipboardEntityType,
  type ClipboardIdFactory,
  type MindMapClipboardEnvelopeV1,
  type MindMapClipboardFragment,
  type RemappedMindMapClipboardFragment,
  type RemapMindMapClipboardOptions,
} from './types';
import { validateMindMapClipboardReferences } from './validation';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

interface SourceEntityId {
  readonly entityType: ClipboardEntityType;
  readonly id: string;
}

function collectSourceEntityIds(fragment: MindMapClipboardFragment): SourceEntityId[] {
  const result: SourceEntityId[] = [];
  const addRecord = (
    entityType: ClipboardEntityType,
    record: Record<string, { id: string }>,
  ): void => {
    for (const entity of Object.values(record)) result.push({ entityType, id: entity.id });
  };

  addRecord('topic', fragment.topics);
  addRecord('tree-edge', fragment.treeEdges);
  addRecord('relationship', fragment.relationships);
  for (const relationship of Object.values(fragment.relationships)) {
    addRecord('relationship-control-point', relationship.controlPoints ?? {});
  }
  addRecord('boundary', fragment.boundaries);
  addRecord('summary', fragment.summaries);
  addRecord('callout', fragment.callouts);
  addRecord('zone', fragment.zones);
  addRecord('style', fragment.styles);
  addRecord('marker-group', fragment.markerGroups);
  addRecord('marker-definition', fragment.markerDefinitions);
  addRecord('marker-instance', fragment.markerInstances);
  addRecord('note', fragment.notes);
  addRecord('link', fragment.links);
  addRecord('asset', fragment.assets);
  addRecord('attachment', fragment.attachments);
  addRecord('image', fragment.images);
  addRecord('equation', fragment.equations);
  addRecord('audio-clip', fragment.audioClips);
  addRecord('todo', fragment.todos);
  addRecord('task', fragment.tasks);
  addRecord('task-dependency', fragment.taskDependencies);
  return result;
}

function createIdMap(
  fragment: MindMapClipboardFragment,
  options: RemapMindMapClipboardOptions,
): Map<string, string> {
  const sourceEntities = collectSourceEntityIds(fragment);
  const sourceIds = new Set(sourceEntities.map((entity) => entity.id));
  const used = new Set(options.existingIds ?? []);
  for (const sourceId of sourceIds) used.add(sourceId);

  const factory: ClipboardIdFactory = options.idFactory ?? (() => createEntityId());
  const mapping = new Map<string, string>();
  for (const source of sourceEntities) {
    let generated: string | undefined;
    for (let attempt = 0; attempt < 1024; attempt += 1) {
      const candidate = factory(source.entityType, source.id);
      if (UUID_V7.test(candidate) && !used.has(candidate)) {
        generated = candidate;
        break;
      }
    }
    if (!generated) {
      throw new MindMapClipboardError(
        'clipboard.id-generation-failed',
        `Could not allocate a unique UUIDv7 for ${source.entityType} ${source.id}.`,
        [source.id],
      );
    }
    mapping.set(source.id, generated);
    used.add(generated);
  }
  return mapping;
}

function requireMapped(mapping: ReadonlyMap<string, string>, sourceId: string): string {
  const targetId = mapping.get(sourceId);
  if (!targetId) {
    throw new MindMapClipboardError(
      'clipboard.invalid-reference',
      `Clipboard reference ${sourceId} was not allocated before remapping.`,
      [sourceId],
    );
  }
  return targetId;
}

function remapOpaque(value: unknown, mapping: ReadonlyMap<string, string>): unknown {
  if (typeof value === 'string') return mapping.get(value) ?? value;
  if (Array.isArray(value)) return value.map((entry) => remapOpaque(entry, mapping));
  if (value === null || typeof value !== 'object') return value;
  const target: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    target[mapping.get(key) ?? key] = remapOpaque(entry, mapping);
  }
  return target;
}

function cloneEntity<T extends { audit?: Domain.EntityAudit; extensions?: Domain.ExtensionBag; id: string }>(
  source: T,
  mapping: ReadonlyMap<string, string>,
): T {
  const clone = structuredClone(source);
  clone.id = requireMapped(mapping, source.id);
  delete clone.audit;
  if (clone.extensions) {
    clone.extensions = remapOpaque(clone.extensions, mapping) as Domain.ExtensionBag;
  }
  return clone;
}

function remapStyleBinding(
  binding: Domain.StyleBinding | undefined,
  mapping: ReadonlyMap<string, string>,
): Domain.StyleBinding | undefined {
  if (!binding) return undefined;
  const clone = structuredClone(binding);
  if (clone.styleId) clone.styleId = requireMapped(mapping, clone.styleId) as Domain.StyleId;
  return clone;
}

function remapScope(
  scope: Domain.TopicScope,
  mapping: ReadonlyMap<string, string>,
): Domain.TopicScope {
  if (scope.kind === 'explicit') {
    return {
      kind: 'explicit',
      topicIds: scope.topicIds.map(
        (id) => requireMapped(mapping, id) as Domain.TopicId,
      ),
    };
  }
  if (scope.kind === 'subtree') {
    return {
      depth: scope.depth,
      kind: 'subtree',
      rootTopicId: requireMapped(mapping, scope.rootTopicId) as Domain.TopicId,
    };
  }
  return {
    firstEdgeId: requireMapped(mapping, scope.firstEdgeId) as Domain.TreeEdgeId,
    includeDescendants: scope.includeDescendants,
    kind: 'sibling-range',
    lastEdgeId: requireMapped(mapping, scope.lastEdgeId) as Domain.TreeEdgeId,
    parentTopicId: requireMapped(mapping, scope.parentTopicId) as Domain.TopicId,
  };
}

function remapEndpoint(
  endpoint: Domain.RelationshipEndpoint,
  mapping: ReadonlyMap<string, string>,
): Domain.RelationshipEndpoint {
  const element = endpoint.element;
  const anchor = structuredClone(endpoint.anchor);
  switch (element.kind) {
    case 'topic':
      return {
        anchor,
        element: {
          kind: 'topic',
          topicId: requireMapped(mapping, element.topicId) as Domain.TopicId,
        },
      };
    case 'boundary':
      return {
        anchor,
        element: {
          boundaryId: requireMapped(mapping, element.boundaryId) as Domain.BoundaryId,
          kind: 'boundary',
        },
      };
    case 'callout':
      return {
        anchor,
        element: {
          calloutId: requireMapped(mapping, element.calloutId) as Domain.CalloutId,
          kind: 'callout',
        },
      };
    case 'zone':
      return {
        anchor,
        element: {
          kind: 'zone',
          zoneId: requireMapped(mapping, element.zoneId) as Domain.ZoneId,
        },
      };
  }
}

function remapFragment(
  source: MindMapClipboardFragment,
  mapping: ReadonlyMap<string, string>,
  destinationSheetId: Domain.SheetId,
): MindMapClipboardFragment {
  const topics = {} as Domain.TopicMap;
  for (const topic of Object.values(source.topics)) {
    const copy = cloneEntity(topic, mapping);
    copy.id = requireMapped(mapping, topic.id) as Domain.TopicId;
    copy.style = remapStyleBinding(topic.style, mapping);
    topics[copy.id] = copy;
  }

  const treeEdges = {} as Domain.TreeEdgeMap;
  for (const edge of Object.values(source.treeEdges)) {
    const copy = cloneEntity(edge, mapping);
    copy.id = requireMapped(mapping, edge.id) as Domain.TreeEdgeId;
    copy.parentTopicId = requireMapped(mapping, edge.parentTopicId) as Domain.TopicId;
    copy.childTopicId = requireMapped(mapping, edge.childTopicId) as Domain.TopicId;
    copy.style = remapStyleBinding(edge.style, mapping);
    treeEdges[copy.id] = copy;
  }

  const relationships = {} as Domain.RelationshipMap;
  for (const relationship of Object.values(source.relationships)) {
    const copy = cloneEntity(relationship, mapping);
    copy.id = requireMapped(mapping, relationship.id) as Domain.RelationshipId;
    copy.source = remapEndpoint(relationship.source, mapping);
    copy.target = remapEndpoint(relationship.target, mapping);
    copy.style = remapStyleBinding(relationship.style, mapping);
    if (relationship.controlPoints) {
      const controlPoints = {} as Domain.RelationshipControlPointMap;
      for (const point of Object.values(relationship.controlPoints)) {
        const id = requireMapped(mapping, point.id) as Domain.ControlPointId;
        controlPoints[id] = { ...structuredClone(point), id };
      }
      copy.controlPoints = controlPoints;
    }
    relationships[copy.id] = copy;
  }

  const boundaries = {} as Domain.BoundaryMap;
  for (const boundary of Object.values(source.boundaries)) {
    const copy = cloneEntity(boundary, mapping);
    copy.id = requireMapped(mapping, boundary.id) as Domain.BoundaryId;
    copy.scope = remapScope(boundary.scope, mapping);
    copy.style = remapStyleBinding(boundary.style, mapping);
    boundaries[copy.id] = copy;
  }

  const summaries = {} as Domain.SummaryMap;
  for (const summary of Object.values(source.summaries)) {
    const copy = cloneEntity(summary, mapping);
    copy.id = requireMapped(mapping, summary.id) as Domain.SummaryId;
    copy.scope = remapScope(summary.scope, mapping);
    copy.resultTopicId = requireMapped(mapping, summary.resultTopicId) as Domain.TopicId;
    copy.style = remapStyleBinding(summary.style, mapping);
    summaries[copy.id] = copy;
  }

  const callouts = {} as Domain.CalloutMap;
  for (const callout of Object.values(source.callouts)) {
    const copy = cloneEntity(callout, mapping);
    copy.id = requireMapped(mapping, callout.id) as Domain.CalloutId;
    copy.targetTopicId = requireMapped(mapping, callout.targetTopicId) as Domain.TopicId;
    copy.style = remapStyleBinding(callout.style, mapping);
    callouts[copy.id] = copy;
  }

  const zones = {} as Domain.ZoneMap;
  for (const zone of Object.values(source.zones)) {
    const copy = cloneEntity(zone, mapping);
    copy.id = requireMapped(mapping, zone.id) as Domain.ZoneId;
    copy.rootTopicIds = zone.rootTopicIds.map(
      (id) => requireMapped(mapping, id) as Domain.TopicId,
    );
    copy.style = remapStyleBinding(zone.style, mapping);
    zones[copy.id] = copy;
  }

  const styles = {} as Domain.StyleDefinitionMap;
  for (const style of Object.values(source.styles)) {
    const copy = cloneEntity(style, mapping);
    copy.id = requireMapped(mapping, style.id) as Domain.StyleId;
    if (style.basedOnStyleId) {
      copy.basedOnStyleId = requireMapped(mapping, style.basedOnStyleId) as Domain.StyleId;
    }
    styles[copy.id] = copy;
  }

  const markerGroups = {} as Domain.MarkerGroupMap;
  for (const group of Object.values(source.markerGroups)) {
    const copy = cloneEntity(group, mapping);
    copy.id = requireMapped(mapping, group.id) as Domain.MarkerGroupId;
    markerGroups[copy.id] = copy;
  }

  const markerDefinitions = {} as Domain.MarkerDefinitionMap;
  for (const definition of Object.values(source.markerDefinitions)) {
    const copy = cloneEntity(definition, mapping);
    copy.id = requireMapped(mapping, definition.id) as Domain.MarkerDefinitionId;
    copy.groupId = requireMapped(mapping, definition.groupId) as Domain.MarkerGroupId;
    if (definition.source.kind === 'asset') {
      copy.source = {
        assetId: requireMapped(mapping, definition.source.assetId) as Domain.AssetId,
        kind: 'asset',
      };
    }
    markerDefinitions[copy.id] = copy;
  }

  const markerInstances = {} as Domain.MarkerInstanceMap;
  for (const instance of Object.values(source.markerInstances)) {
    const copy = cloneEntity(instance, mapping);
    copy.id = requireMapped(mapping, instance.id) as Domain.MarkerInstanceId;
    copy.topicId = requireMapped(mapping, instance.topicId) as Domain.TopicId;
    copy.markerDefinitionId = requireMapped(
      mapping,
      instance.markerDefinitionId,
    ) as Domain.MarkerDefinitionId;
    markerInstances[copy.id] = copy;
  }

  const notes = {} as Domain.NoteMap;
  for (const note of Object.values(source.notes)) {
    const copy = cloneEntity(note, mapping);
    copy.id = requireMapped(mapping, note.id) as Domain.NoteId;
    copy.topicId = requireMapped(mapping, note.topicId) as Domain.TopicId;
    notes[copy.id] = copy;
  }

  const links = {} as Domain.TopicLinkMap;
  for (const link of Object.values(source.links)) {
    const copy = cloneEntity(link, mapping);
    copy.id = requireMapped(mapping, link.id) as Domain.LinkId;
    copy.topicId = requireMapped(mapping, link.topicId) as Domain.TopicId;
    if (copy.kind === 'topic') {
      copy.targetSheetId = destinationSheetId;
      copy.targetTopicId = requireMapped(mapping, copy.targetTopicId) as Domain.TopicId;
    } else if (copy.kind === 'sheet') {
      throw new MindMapClipboardError(
        'clipboard.invalid-reference',
        `Sheet link ${copy.id} cannot be remapped without an explicit destination.`,
        [copy.id],
      );
    }
    links[copy.id] = copy;
  }

  const assets = {} as Domain.AssetMap;
  for (const asset of Object.values(source.assets)) {
    const copy = cloneEntity(asset, mapping);
    copy.id = requireMapped(mapping, asset.id) as Domain.AssetId;
    assets[copy.id] = copy;
  }

  const attachments = {} as Domain.AttachmentMap;
  for (const attachment of Object.values(source.attachments)) {
    const copy = cloneEntity(attachment, mapping);
    copy.id = requireMapped(mapping, attachment.id) as Domain.AttachmentId;
    copy.topicId = requireMapped(mapping, attachment.topicId) as Domain.TopicId;
    copy.assetId = requireMapped(mapping, attachment.assetId) as Domain.AssetId;
    attachments[copy.id] = copy;
  }

  const images = {} as Domain.TopicImageMap;
  for (const image of Object.values(source.images)) {
    const copy = cloneEntity(image, mapping);
    copy.id = requireMapped(mapping, image.id) as Domain.ImageId;
    copy.topicId = requireMapped(mapping, image.topicId) as Domain.TopicId;
    copy.assetId = requireMapped(mapping, image.assetId) as Domain.AssetId;
    images[copy.id] = copy;
  }

  const equations = {} as Domain.EquationMap;
  for (const equation of Object.values(source.equations)) {
    const copy = cloneEntity(equation, mapping);
    copy.id = requireMapped(mapping, equation.id) as Domain.EquationId;
    copy.topicId = requireMapped(mapping, equation.topicId) as Domain.TopicId;
    equations[copy.id] = copy;
  }

  const audioClips = {} as Domain.AudioClipMap;
  for (const clip of Object.values(source.audioClips)) {
    const copy = cloneEntity(clip, mapping);
    copy.id = requireMapped(mapping, clip.id) as Domain.AudioId;
    copy.topicId = requireMapped(mapping, clip.topicId) as Domain.TopicId;
    copy.assetId = requireMapped(mapping, clip.assetId) as Domain.AssetId;
    audioClips[copy.id] = copy;
  }

  const todos = {} as Domain.TopicTodoMap;
  for (const todo of Object.values(source.todos)) {
    const copy = cloneEntity(todo, mapping);
    copy.id = requireMapped(mapping, todo.id) as Domain.TodoId;
    copy.topicId = requireMapped(mapping, todo.topicId) as Domain.TopicId;
    todos[copy.id] = copy;
  }

  const tasks = {} as Domain.TopicTaskMap;
  for (const task of Object.values(source.tasks)) {
    const copy = cloneEntity(task, mapping);
    copy.id = requireMapped(mapping, task.id) as Domain.TaskId;
    copy.topicId = requireMapped(mapping, task.topicId) as Domain.TopicId;
    delete copy.assigneeIds;
    tasks[copy.id] = copy;
  }

  const taskDependencies = {} as Domain.TaskDependencyMap;
  for (const dependency of Object.values(source.taskDependencies)) {
    const copy = cloneEntity(dependency, mapping);
    copy.id = requireMapped(mapping, dependency.id) as Domain.TaskDependencyId;
    copy.predecessorTaskId = requireMapped(
      mapping,
      dependency.predecessorTaskId,
    ) as Domain.TaskId;
    copy.successorTaskId = requireMapped(
      mapping,
      dependency.successorTaskId,
    ) as Domain.TaskId;
    taskDependencies[copy.id] = copy;
  }

  return {
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
  };
}

export function remapMindMapClipboard(
  envelope: MindMapClipboardEnvelopeV1,
  options: RemapMindMapClipboardOptions,
): RemappedMindMapClipboardFragment {
  const mapping = createIdMap(envelope.fragment, options);
  const referenceMapping = new Map(mapping);
  referenceMapping.set(envelope.source.documentId, options.destinationDocumentId);
  referenceMapping.set(envelope.source.sheetId, options.destinationSheetId);
  const fragment = remapFragment(
    envelope.fragment,
    referenceMapping,
    options.destinationSheetId,
  );
  const rootTopicIds = envelope.rootTopicIds.map(
    (id) => requireMapped(mapping, id) as Domain.TopicId,
  );
  const rootHints = envelope.rootHints.map((hint) => ({
    ...hint,
    topicId: requireMapped(mapping, hint.topicId) as Domain.TopicId,
  }));

  const validationEnvelope: MindMapClipboardEnvelopeV1 = {
    fragment,
    report: { omissions: [] },
    rootHints,
    rootTopicIds,
    schema: MIND_MAP_CLIPBOARD_SCHEMA,
    schemaVersion: MIND_MAP_CLIPBOARD_SCHEMA_VERSION,
    source: {
      contentRevision: 0,
      documentId: options.destinationDocumentId,
      sheetId: options.destinationSheetId,
    },
  };
  const referenceErrors = validateMindMapClipboardReferences(validationEnvelope);
  if (referenceErrors.length > 0) {
    throw new MindMapClipboardError(
      'clipboard.invalid-reference',
      'Remapped clipboard fragment failed postcondition validation.',
      referenceErrors,
    );
  }

  return {
    destination: {
      documentId: options.destinationDocumentId,
      sheetId: options.destinationSheetId,
    },
    fragment,
    idMap: Object.freeze(Object.fromEntries(mapping)),
    rootHints,
    rootTopicIds,
  };
}
