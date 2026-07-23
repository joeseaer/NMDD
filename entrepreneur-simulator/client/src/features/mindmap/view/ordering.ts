import type {
  MindMapDocumentV1,
  MindMapSheet,
  SheetId,
  Topic,
  TopicId,
  TreeEdge,
  TreeEdgeId,
} from '../domain/types';

export const compareMindMapViewText = (left: string, right: string): number => {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
};

export const compareMindMapViewOrderedEntities = (
  left: { readonly orderKey: string; readonly id: string },
  right: { readonly orderKey: string; readonly id: string },
): number => compareMindMapViewText(left.orderKey, right.orderKey)
  || compareMindMapViewText(left.id, right.id);

export const getMindMapSheetsInViewOrder = (
  document: MindMapDocumentV1,
): MindMapSheet[] => Object.values(document.sheets)
  .sort(compareMindMapViewOrderedEntities);

export interface MindMapTopicTraversalEntry {
  readonly ordinal: number;
  readonly sheetId: SheetId;
  readonly sheetTitle: string;
  readonly topic: Topic;
  readonly parentTopicId?: TopicId;
  readonly treeEdgeId?: TreeEdgeId;
  readonly ancestorTopicIds: readonly TopicId[];
  readonly depth: number;
}

interface PendingTopic {
  readonly topicId: TopicId;
  readonly parentTopicId?: TopicId;
  readonly treeEdgeId?: TreeEdgeId;
  readonly ancestorTopicIds: readonly TopicId[];
}

const compareTreeEdges = (left: TreeEdge, right: TreeEdge): number => (
  compareMindMapViewOrderedEntities(left, right)
);

export const collectSheetTopicTraversal = (
  sheet: MindMapSheet,
  initialOrdinal = 0,
): MindMapTopicTraversalEntry[] => {
  const childEdges = new Map<TopicId, TreeEdge[]>();
  const childIds = new Set<TopicId>();
  for (const edge of Object.values(sheet.treeEdges)) {
    childIds.add(edge.childTopicId);
    const siblings = childEdges.get(edge.parentTopicId);
    if (siblings) siblings.push(edge);
    else childEdges.set(edge.parentTopicId, [edge]);
  }
  for (const siblings of childEdges.values()) siblings.sort(compareTreeEdges);

  const candidateRoots = Object.values(sheet.topics)
    .filter((topic) => !childIds.has(topic.id))
    .sort((left, right) => {
      if (left.id === sheet.rootTopicId) return -1;
      if (right.id === sheet.rootTopicId) return 1;
      return compareMindMapViewText(left.id, right.id);
    });

  const rootIds = candidateRoots.map((topic) => topic.id);
  if (sheet.topics[sheet.rootTopicId] && !rootIds.includes(sheet.rootTopicId)) {
    rootIds.unshift(sheet.rootTopicId);
  }

  const entries: MindMapTopicTraversalEntry[] = [];
  const visited = new Set<TopicId>();
  let ordinal = initialOrdinal;

  const visitFrom = (rootTopicId: TopicId): void => {
    const stack: PendingTopic[] = [{
      topicId: rootTopicId,
      ancestorTopicIds: [],
    }];
    while (stack.length > 0) {
      const pending = stack.pop();
      if (!pending || visited.has(pending.topicId)) continue;
      const topic = sheet.topics[pending.topicId];
      if (!topic) continue;
      visited.add(topic.id);
      entries.push({
        ordinal,
        sheetId: sheet.id,
        sheetTitle: sheet.title,
        topic,
        ...(pending.parentTopicId ? { parentTopicId: pending.parentTopicId } : {}),
        ...(pending.treeEdgeId ? { treeEdgeId: pending.treeEdgeId } : {}),
        ancestorTopicIds: pending.ancestorTopicIds,
        depth: pending.ancestorTopicIds.length,
      });
      ordinal += 1;

      const nextAncestors = [...pending.ancestorTopicIds, topic.id];
      const edges = childEdges.get(topic.id) ?? [];
      for (let index = edges.length - 1; index >= 0; index -= 1) {
        const edge = edges[index];
        stack.push({
          topicId: edge.childTopicId,
          parentTopicId: topic.id,
          treeEdgeId: edge.id,
          ancestorTopicIds: nextAncestors,
        });
      }
    }
  };

  for (const rootTopicId of rootIds) visitFrom(rootTopicId);
  for (const topic of Object.values(sheet.topics).sort((left, right) => (
    compareMindMapViewText(left.id, right.id)
  ))) {
    if (!visited.has(topic.id)) visitFrom(topic.id);
  }

  return entries;
};

export const collectDocumentTopicTraversal = (
  document: MindMapDocumentV1,
): MindMapTopicTraversalEntry[] => {
  const entries: MindMapTopicTraversalEntry[] = [];
  for (const sheet of getMindMapSheetsInViewOrder(document)) {
    entries.push(...collectSheetTopicTraversal(sheet, entries.length));
  }
  return entries;
};

export const mindMapTopicKey = (sheetId: SheetId, topicId: TopicId): string => (
  `${sheetId}:${topicId}`
);
