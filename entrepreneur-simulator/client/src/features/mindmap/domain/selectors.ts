import type {
  Boundary,
  Callout,
  MindMapSheet,
  Relationship,
  RelationshipTargetRef,
  Summary,
  TopicId,
  TopicScope,
  Zone,
} from './types';

const targetKey = (target: RelationshipTargetRef): string => {
  switch (target.kind) {
    case 'topic':
      return `topic:${target.topicId}`;
    case 'boundary':
      return `boundary:${target.boundaryId}`;
    case 'callout':
      return `callout:${target.calloutId}`;
    case 'zone':
      return `zone:${target.zoneId}`;
  }
};

export const getRelationshipsForElement = (
  sheet: MindMapSheet,
  target: RelationshipTargetRef,
): Relationship[] => {
  const key = targetKey(target);
  return Object.values(sheet.relationships)
    .filter((relationship) => (
      targetKey(relationship.source.element) === key
      || targetKey(relationship.target.element) === key
    ));
};

const scopeDirectlyReferencesTopic = (
  sheet: MindMapSheet,
  scope: TopicScope,
  topicId: TopicId,
): boolean => {
  if (scope.kind === 'subtree') return scope.rootTopicId === topicId;
  if (scope.kind === 'explicit') return scope.topicIds.includes(topicId);
  if (scope.parentTopicId === topicId) return true;

  const first = sheet.treeEdges[scope.firstEdgeId];
  const last = sheet.treeEdges[scope.lastEdgeId];
  return first?.childTopicId === topicId || last?.childTopicId === topicId;
};

export const getBoundariesForTopic = (
  sheet: MindMapSheet,
  topicId: TopicId,
): Boundary[] => Object.values(sheet.boundaries)
  .filter((boundary) => scopeDirectlyReferencesTopic(sheet, boundary.scope, topicId));

export const getSummariesForTopic = (
  sheet: MindMapSheet,
  topicId: TopicId,
): Summary[] => Object.values(sheet.summaries)
  .filter((summary) => (
    summary.resultTopicId === topicId
    || scopeDirectlyReferencesTopic(sheet, summary.scope, topicId)
  ));

export const getCalloutsForTopic = (
  sheet: MindMapSheet,
  topicId: TopicId,
): Callout[] => Object.values(sheet.callouts)
  .filter((callout) => callout.targetTopicId === topicId);

export const getZonesForTopic = (
  sheet: MindMapSheet,
  topicId: TopicId,
): Zone[] => Object.values(sheet.zones)
  .filter((zone) => zone.rootTopicIds.includes(topicId));

