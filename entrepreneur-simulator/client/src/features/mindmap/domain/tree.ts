import type {
  MindMapSheet,
  Topic,
  TopicId,
  TreeEdge,
  TreeEdgeId,
} from './types';

const compareAscii = (left: string, right: string): number => {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
};

const compareTreeEdges = (left: TreeEdge, right: TreeEdge): number =>
  compareAscii(left.orderKey, right.orderKey) || compareAscii(left.id, right.id);

export const getIncomingTreeEdges = (
  sheet: MindMapSheet,
  topicId: TopicId,
): TreeEdge[] => Object.values(sheet.treeEdges)
  .filter((edge) => edge.childTopicId === topicId)
  .sort(compareTreeEdges);

export const getParentEdge = (
  sheet: MindMapSheet,
  topicId: TopicId,
): TreeEdge | undefined => getIncomingTreeEdges(sheet, topicId)[0];

export const getParent = (
  sheet: MindMapSheet,
  topicId: TopicId,
): Topic | undefined => {
  const edge = getParentEdge(sheet, topicId);
  return edge ? sheet.topics[edge.parentTopicId] : undefined;
};

export const getChildEdgesSorted = (
  sheet: MindMapSheet,
  parentTopicId: TopicId,
): TreeEdge[] => Object.values(sheet.treeEdges)
  .filter((edge) => edge.parentTopicId === parentTopicId)
  .sort(compareTreeEdges);

export const getChildrenSorted = (
  sheet: MindMapSheet,
  parentTopicId: TopicId,
): Topic[] => getChildEdgesSorted(sheet, parentTopicId)
  .map((edge) => sheet.topics[edge.childTopicId])
  .filter((topic): topic is Topic => topic !== undefined);

export const getAncestors = (
  sheet: MindMapSheet,
  topicId: TopicId,
): Topic[] => {
  const ancestors: Topic[] = [];
  const visited = new Set<TopicId>([topicId]);
  let cursor = topicId;

  while (true) {
    const parent = getParent(sheet, cursor);
    if (!parent || visited.has(parent.id)) return ancestors;
    visited.add(parent.id);
    ancestors.push(parent);
    cursor = parent.id;
  }
};

export const getDescendants = (
  sheet: MindMapSheet,
  topicId: TopicId,
): Topic[] => {
  const descendants: Topic[] = [];
  const visited = new Set<TopicId>([topicId]);

  const visit = (parentId: TopicId): void => {
    for (const child of getChildrenSorted(sheet, parentId)) {
      if (visited.has(child.id)) continue;
      visited.add(child.id);
      descendants.push(child);
      visit(child.id);
    }
  };

  visit(topicId);
  return descendants;
};

export const wouldCreateCycle = (
  sheet: MindMapSheet,
  parentTopicId: TopicId,
  childTopicId: TopicId,
): boolean => {
  if (parentTopicId === childTopicId) return true;
  return getDescendants(sheet, childTopicId)
    .some((topic) => topic.id === parentTopicId);
};

export const getTreeRoots = (sheet: MindMapSheet): Topic[] => {
  const childIds = new Set(
    Object.values(sheet.treeEdges).map((edge) => edge.childTopicId),
  );

  return Object.values(sheet.topics)
    .filter((topic) => !childIds.has(topic.id))
    .sort((left, right) => {
      if (left.id === sheet.rootTopicId) return -1;
      if (right.id === sheet.rootTopicId) return 1;
      return compareAscii(left.id, right.id);
    });
};

export const getTreeEdge = (
  sheet: MindMapSheet,
  edgeId: TreeEdgeId,
): TreeEdge | undefined => sheet.treeEdges[edgeId];

