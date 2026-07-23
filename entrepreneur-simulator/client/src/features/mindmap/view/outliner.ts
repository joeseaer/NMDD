import type {
  MindMapDocumentV1,
  MindMapSheet,
  SheetId,
  TopicId,
} from '../domain/types';
import {
  collectSheetTopicTraversal,
  getMindMapSheetsInViewOrder,
} from './ordering';
import { mindMapRichTextToPlainText } from './text';
import type {
  MindMapOutlinerBranchFocus,
  MindMapOutlinerMatchState,
  MindMapOutlinerProjection,
  MindMapOutlinerRow,
  MindMapOutlinerSheetProjection,
  MindMapOutlinerTopicNode,
  MindMapOutlinerTopicRow,
  MindMapOutlinerViewState,
  MindMapSearchFilterProjection,
} from './types';

export interface ProjectMindMapOutlinerInput {
  readonly document: MindMapDocumentV1;
  readonly viewState?: MindMapOutlinerViewState;
  readonly branch?: MindMapOutlinerBranchFocus;
  readonly filter?: MindMapSearchFilterProjection;
}

interface MutableOutlinerTopicNode {
  kind: 'topic';
  sheetId: SheetId;
  topicId: TopicId;
  parentTopicId?: TopicId;
  title: string;
  depth: number;
  collapsed: boolean;
  hasChildren: boolean;
  matchState: MindMapOutlinerMatchState;
  children: MutableOutlinerTopicNode[];
}

interface FilterSets {
  readonly included?: ReadonlySet<TopicId>;
  readonly matched: ReadonlySet<TopicId>;
  readonly context: ReadonlySet<TopicId>;
  readonly dimmed: ReadonlySet<TopicId>;
}

const getFilterSets = (
  filter: MindMapSearchFilterProjection | undefined,
  sheetId: SheetId,
): FilterSets => {
  const sheet = filter?.sheets[sheetId];
  return {
    ...(filter?.active && filter.mode === 'hide'
      ? { included: new Set(sheet?.includedTopicIds ?? []) }
      : {}),
    matched: new Set(sheet?.matchedTopicIds ?? []),
    context: new Set(sheet?.contextTopicIds ?? []),
    dimmed: new Set(sheet?.dimmedTopicIds ?? []),
  };
};

const getMatchState = (
  topicId: TopicId,
  filter: FilterSets,
): MindMapOutlinerMatchState => {
  if (filter.matched.has(topicId)) return 'match';
  if (filter.context.has(topicId)) return 'context';
  if (filter.dimmed.has(topicId)) return 'dimmed';
  return 'normal';
};

const createSheetProjection = (
  sheet: MindMapSheet,
  input: ProjectMindMapOutlinerInput,
): MindMapOutlinerSheetProjection => {
  const collapsedSheetIds = new Set(input.viewState?.collapsedSheetIds ?? []);
  const collapsed = collapsedSheetIds.has(sheet.id);
  const foldOverrides = input.viewState?.foldOverrides?.[sheet.id];
  const filter = getFilterSets(input.filter, sheet.id);
  const traversal = collectSheetTopicTraversal(sheet);
  const branchRoot = input.branch?.sheetId === sheet.id
    ? input.branch.rootTopicId
    : undefined;
  const selectedTraversal = traversal.filter((entry) => {
    const inBranch = branchRoot === undefined
      || entry.topic.id === branchRoot
      || entry.ancestorTopicIds.includes(branchRoot);
    return inBranch && (filter.included?.has(entry.topic.id) ?? true);
  });

  const nodeById = new Map<TopicId, MutableOutlinerTopicNode>();
  const roots: MutableOutlinerTopicNode[] = [];
  for (const entry of selectedTraversal) {
    const parent = entry.parentTopicId
      ? nodeById.get(entry.parentTopicId)
      : undefined;
    const node: MutableOutlinerTopicNode = {
      kind: 'topic',
      sheetId: sheet.id,
      topicId: entry.topic.id,
      ...(parent ? { parentTopicId: parent.topicId } : {}),
      title: mindMapRichTextToPlainText(entry.topic.title),
      depth: parent ? parent.depth + 1 : 0,
      collapsed: foldOverrides?.[entry.topic.id] ?? entry.topic.defaultCollapsed,
      hasChildren: false,
      matchState: getMatchState(entry.topic.id, filter),
      children: [],
    };
    nodeById.set(node.topicId, node);
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  for (const node of nodeById.values()) node.hasChildren = node.children.length > 0;

  const rows: MindMapOutlinerRow[] = [{
    kind: 'sheet',
    sheetId: sheet.id,
    title: sheet.title,
    collapsed,
    rowDepth: 0,
  }];
  if (!collapsed) {
    const stack = [...roots].reverse();
    while (stack.length > 0) {
      const node = stack.pop();
      if (!node) continue;
      const row: MindMapOutlinerTopicRow = {
        kind: 'topic',
        sheetId: node.sheetId,
        topicId: node.topicId,
        ...(node.parentTopicId ? { parentTopicId: node.parentTopicId } : {}),
        title: node.title,
        depth: node.depth,
        rowDepth: node.depth + 1,
        collapsed: node.collapsed,
        hasChildren: node.hasChildren,
        matchState: node.matchState,
      };
      rows.push(row);
      if (!node.collapsed) {
        for (let index = node.children.length - 1; index >= 0; index -= 1) {
          stack.push(node.children[index]);
        }
      }
    }
  }

  return {
    sheetId: sheet.id,
    title: sheet.title,
    collapsed,
    topicCount: nodeById.size,
    visibleTopicCount: rows.length - 1,
    roots: roots as MindMapOutlinerTopicNode[],
    rows,
  };
};

/**
 * Builds a renderer-neutral, multi-Sheet outline. All disclosure state is an
 * input and the canonical document is only read, so opening/collapsing the
 * Outliner cannot create a content transaction.
 */
export const projectMindMapOutliner = (
  input: ProjectMindMapOutlinerInput,
): MindMapOutlinerProjection => {
  const sheets = getMindMapSheetsInViewOrder(input.document)
    .filter((sheet) => input.branch === undefined || sheet.id === input.branch.sheetId)
    .map((sheet) => createSheetProjection(sheet, input));
  return {
    sheets,
    rows: sheets.flatMap((sheet) => sheet.rows),
  };
};
