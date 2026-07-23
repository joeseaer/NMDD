import type { ExtensionBag, MindMapSheet, TopicId, TreeEdge } from '../domain/types';
import {
  compareMindMapViewOrderedEntities,
  compareMindMapViewText,
  getMindMapSheetsInViewOrder,
} from '../view/ordering';
import { mindMapRichTextToPlainText } from '../view/text';
import type {
  NormalizedOutlineDocument,
  NormalizedOutlineNode,
  NormalizedOutlineSheet,
} from './types';

interface MutableOutlineNode {
  title: string;
  children: MutableOutlineNode[];
  extensions?: ExtensionBag;
  sourceTopicId?: TopicId;
}

function copyExtensions(extensions: ExtensionBag | undefined): ExtensionBag | undefined {
  return extensions === undefined ? undefined : { ...extensions };
}

function collectCandidateRootIds(sheet: MindMapSheet): TopicId[] {
  const childIds = new Set(Object.values(sheet.treeEdges).map((edge) => edge.childTopicId));
  const remainingRoots = Object.values(sheet.topics)
    .filter((topic) => topic.id !== sheet.rootTopicId && !childIds.has(topic.id))
    .sort((left, right) => compareMindMapViewText(left.id, right.id))
    .map((topic) => topic.id);
  const remainingTopics = Object.values(sheet.topics)
    .filter((topic) => topic.id !== sheet.rootTopicId && childIds.has(topic.id))
    .sort((left, right) => compareMindMapViewText(left.id, right.id))
    .map((topic) => topic.id);

  return [sheet.rootTopicId, ...remainingRoots, ...remainingTopics];
}

function projectSheetRoots(sheet: MindMapSheet): NormalizedOutlineNode[] {
  const childrenByParent = new Map<TopicId, TreeEdge[]>();
  for (const edge of Object.values(sheet.treeEdges)) {
    const edges = childrenByParent.get(edge.parentTopicId);
    if (edges) edges.push(edge);
    else childrenByParent.set(edge.parentTopicId, [edge]);
  }
  for (const edges of childrenByParent.values()) {
    edges.sort(compareMindMapViewOrderedEntities);
  }

  const visited = new Set<TopicId>();
  const roots: MutableOutlineNode[] = [];

  for (const candidateId of collectCandidateRootIds(sheet)) {
    const candidate = sheet.topics[candidateId];
    if (!candidate || visited.has(candidate.id)) continue;

    const root: MutableOutlineNode = {
      children: [],
      ...(candidate.extensions === undefined
        ? {}
        : { extensions: copyExtensions(candidate.extensions) }),
      sourceTopicId: candidate.id,
      title: mindMapRichTextToPlainText(candidate.title),
    };
    roots.push(root);
    visited.add(candidate.id);

    const stack: Array<{ node: MutableOutlineNode; topicId: TopicId }> = [{
      node: root,
      topicId: candidate.id,
    }];
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) break;
      const projectedChildren: Array<{
        node: MutableOutlineNode;
        topicId: TopicId;
      }> = [];
      for (const edge of childrenByParent.get(current.topicId) ?? []) {
        const child = sheet.topics[edge.childTopicId];
        if (!child || visited.has(child.id)) continue;
        visited.add(child.id);
        const childNode: MutableOutlineNode = {
          children: [],
          ...(child.extensions === undefined
            ? {}
            : { extensions: copyExtensions(child.extensions) }),
          sourceTopicId: child.id,
          title: mindMapRichTextToPlainText(child.title),
        };
        current.node.children.push(childNode);
        projectedChildren.push({ node: childNode, topicId: child.id });
      }
      for (let index = projectedChildren.length - 1; index >= 0; index -= 1) {
        stack.push(projectedChildren[index]);
      }
    }
  }

  return roots;
}

/**
 * Renderer-neutral, deterministic projection used by every outline adapter.
 * Sheet order comes from canonical orderKey/id ordering; child order comes from
 * canonical tree-edge orderKey/id ordering. React Flow state is never read.
 */
export function projectMindMapToNormalizedOutline(
  document: import('../domain/types').MindMapDocumentV1,
): NormalizedOutlineDocument {
  const sheets: NormalizedOutlineSheet[] = getMindMapSheetsInViewOrder(document)
    .map((sheet) => ({
      ...(sheet.extensions === undefined
        ? {}
        : { extensions: copyExtensions(sheet.extensions) }),
      roots: projectSheetRoots(sheet),
      sourceSheetId: sheet.id,
      title: sheet.title,
    }));

  return {
    ...(document.extensions === undefined
      ? {}
      : { extensions: copyExtensions(document.extensions) }),
    sheets,
    title: document.title,
  };
}
