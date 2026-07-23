import type {
  MindMapDocumentV1,
  MindMapSheet,
  RelationshipTargetRef,
  SheetId,
  TopicId,
  TopicScope,
} from '../domain/types';
import { getDescendants } from '../domain/tree';
import { expandTopicScope } from '../render/model';
import { getMindMapSheetsInViewOrder } from '../view/ordering';

export type MindMapStaticExportScope =
  | { readonly kind: 'all-sheets' }
  | { readonly kind: 'sheet'; readonly sheetId: SheetId }
  | { readonly kind: 'selected-sheets'; readonly sheetIds: readonly SheetId[] }
  | {
      readonly kind: 'branch';
      readonly rootTopicId: TopicId;
      readonly sheetId: SheetId;
    };

export class MindMapStaticExportScopeError extends Error {
  readonly code:
    | 'sheet-unavailable'
    | 'branch-root-unavailable'
    | 'selected-sheets-empty'
    | 'selected-sheets-duplicate';

  constructor(code: MindMapStaticExportScopeError['code']) {
    const messages: Record<MindMapStaticExportScopeError['code'], string> = {
      'branch-root-unavailable': 'The selected export branch root is unavailable.',
      'selected-sheets-duplicate': 'The selected export Sheet list contains a duplicate.',
      'selected-sheets-empty': 'At least one export Sheet must be selected.',
      'sheet-unavailable': 'The selected export Sheet is unavailable.',
    };
    super(messages[code]);
    this.name = 'MindMapStaticExportScopeError';
    this.code = code;
  }
}

const explicitIntersection = (
  sheet: Readonly<MindMapSheet>,
  scope: Readonly<TopicScope>,
  includedTopicIds: ReadonlySet<TopicId>,
): TopicId[] => expandTopicScope(sheet as MindMapSheet, scope)
  .filter((topicId) => includedTopicIds.has(topicId));

const targetIsIncluded = (
  target: Readonly<RelationshipTargetRef>,
  included: {
    readonly boundaries: ReadonlySet<string>;
    readonly callouts: ReadonlySet<string>;
    readonly topics: ReadonlySet<TopicId>;
    readonly zones: ReadonlySet<string>;
  },
): boolean => {
  if (target.kind === 'topic') return included.topics.has(target.topicId);
  if (target.kind === 'boundary') return included.boundaries.has(target.boundaryId);
  if (target.kind === 'callout') return included.callouts.has(target.calloutId);
  return included.zones.has(target.zoneId);
};

const branchSheet = (
  source: Readonly<MindMapSheet>,
  rootTopicId: TopicId,
): MindMapSheet => {
  if (!source.topics[rootTopicId]) {
    throw new MindMapStaticExportScopeError('branch-root-unavailable');
  }

  const includedTopicIds = new Set<TopicId>([
    rootTopicId,
    ...getDescendants(source as MindMapSheet, rootTopicId).map((topic) => topic.id),
  ]);
  const includedSummaryIds = new Set<string>();

  // Summary results are independently rooted trees. Pull them into a branch
  // export whenever the Summary scope intersects the selected structural branch;
  // repeat so nested Summary result trees are closed transitively.
  let changed = true;
  while (changed) {
    changed = false;
    for (const summary of Object.values(source.summaries)) {
      if (includedSummaryIds.has(summary.id)) continue;
      if (explicitIntersection(source, summary.scope, includedTopicIds).length === 0) continue;
      includedSummaryIds.add(summary.id);
      const result = source.topics[summary.resultTopicId];
      if (result && !includedTopicIds.has(result.id)) {
        includedTopicIds.add(result.id);
        for (const descendant of getDescendants(source as MindMapSheet, result.id)) {
          includedTopicIds.add(descendant.id);
        }
        changed = true;
      }
    }
  }

  const topics = Object.fromEntries(Object.entries(source.topics)
    .filter(([topicId]) => includedTopicIds.has(topicId as TopicId))) as MindMapSheet['topics'];
  const treeEdges = Object.fromEntries(Object.entries(source.treeEdges)
    .filter(([, edge]) => (
      includedTopicIds.has(edge.parentTopicId) && includedTopicIds.has(edge.childTopicId)
    ))) as MindMapSheet['treeEdges'];
  const images = Object.fromEntries(Object.entries(source.images)
    .filter(([, image]) => includedTopicIds.has(image.topicId))) as MindMapSheet['images'];
  const markerInstances = Object.fromEntries(Object.entries(source.markerInstances)
    .filter(([, marker]) => includedTopicIds.has(marker.topicId))) as MindMapSheet['markerInstances'];
  const notes = Object.fromEntries(Object.entries(source.notes)
    .filter(([, note]) => includedTopicIds.has(note.topicId))) as MindMapSheet['notes'];
  const links = Object.fromEntries(Object.entries(source.links)
    .filter(([, link]) => includedTopicIds.has(link.topicId))) as MindMapSheet['links'];
  const attachments = Object.fromEntries(Object.entries(source.attachments)
    .filter(([, attachment]) => includedTopicIds.has(attachment.topicId))) as MindMapSheet['attachments'];
  const equations = Object.fromEntries(Object.entries(source.equations)
    .filter(([, equation]) => includedTopicIds.has(equation.topicId))) as MindMapSheet['equations'];
  const audioClips = Object.fromEntries(Object.entries(source.audioClips)
    .filter(([, audio]) => includedTopicIds.has(audio.topicId))) as MindMapSheet['audioClips'];
  const todos = Object.fromEntries(Object.entries(source.todos)
    .filter(([, todo]) => includedTopicIds.has(todo.topicId))) as MindMapSheet['todos'];
  const tasks = Object.fromEntries(Object.entries(source.tasks)
    .filter(([, task]) => includedTopicIds.has(task.topicId))) as MindMapSheet['tasks'];
  const retainedTaskIds = new Set(Object.keys(tasks));
  const taskDependencies = Object.fromEntries(Object.entries(source.taskDependencies)
    .filter(([, dependency]) => (
      retainedTaskIds.has(dependency.predecessorTaskId)
      && retainedTaskIds.has(dependency.successorTaskId)
    ))) as MindMapSheet['taskDependencies'];

  const boundaries = Object.fromEntries(Object.values(source.boundaries)
    .map((boundary) => ({
      boundary,
      topicIds: explicitIntersection(source, boundary.scope, includedTopicIds),
    }))
    .filter(({ topicIds }) => topicIds.length > 0)
    .map(({ boundary, topicIds }) => [boundary.id, {
      ...boundary,
      scope: { kind: 'explicit' as const, topicIds },
    }])) as MindMapSheet['boundaries'];
  const summaries = Object.fromEntries(Object.values(source.summaries)
    .filter((summary) => includedSummaryIds.has(summary.id))
    .map((summary) => [summary.id, {
      ...summary,
      scope: {
        kind: 'explicit' as const,
        topicIds: explicitIntersection(source, summary.scope, includedTopicIds),
      },
    }])) as MindMapSheet['summaries'];
  const callouts = Object.fromEntries(Object.entries(source.callouts)
    .filter(([, callout]) => includedTopicIds.has(callout.targetTopicId))) as MindMapSheet['callouts'];
  const zones = {} as MindMapSheet['zones'];
  for (const zone of Object.values(source.zones)) {
    const rootTopicIds = zone.rootTopicIds.filter((topicId) => includedTopicIds.has(topicId));
    if (rootTopicIds.length > 0) zones[zone.id] = { ...zone, rootTopicIds };
  }

  const retained = {
    boundaries: new Set(Object.keys(boundaries)),
    callouts: new Set(Object.keys(callouts)),
    topics: includedTopicIds,
    zones: new Set(Object.keys(zones)),
  };
  const relationships = Object.fromEntries(Object.entries(source.relationships)
    .filter(([, relationship]) => (
      targetIsIncluded(relationship.source.element, retained)
      && targetIsIncluded(relationship.target.element, retained)
    ))) as MindMapSheet['relationships'];

  return {
    ...source,
    rootTopicId,
    topics,
    treeEdges,
    images,
    markerInstances,
    notes,
    links,
    attachments,
    equations,
    audioClips,
    todos,
    tasks,
    taskDependencies,
    boundaries,
    summaries,
    callouts,
    zones,
    relationships,
  };
};

/** Creates an immutable export view; the canonical document is never mutated. */
export const projectMindMapDocumentForStaticExport = (
  document: Readonly<MindMapDocumentV1>,
  scope: Readonly<MindMapStaticExportScope> = { kind: 'all-sheets' },
): MindMapDocumentV1 => {
  if (scope.kind === 'all-sheets') return document as MindMapDocumentV1;
  if (scope.kind === 'selected-sheets') {
    if (scope.sheetIds.length === 0) {
      throw new MindMapStaticExportScopeError('selected-sheets-empty');
    }
    const selectedSheetIds = new Set<SheetId>();
    for (const selectedSheetId of scope.sheetIds) {
      if (selectedSheetIds.has(selectedSheetId)) {
        throw new MindMapStaticExportScopeError('selected-sheets-duplicate');
      }
      if (!document.sheets[selectedSheetId]) {
        throw new MindMapStaticExportScopeError('sheet-unavailable');
      }
      selectedSheetIds.add(selectedSheetId);
    }
    const sheets = Object.fromEntries(
      getMindMapSheetsInViewOrder(document as MindMapDocumentV1)
        .filter((sheet) => selectedSheetIds.has(sheet.id))
        .map((sheet) => [sheet.id, sheet]),
    ) as MindMapDocumentV1['sheets'];
    return { ...document, sheets } as MindMapDocumentV1;
  }
  const sheet = document.sheets[scope.sheetId];
  if (!sheet) throw new MindMapStaticExportScopeError('sheet-unavailable');
  const selectedSheet = scope.kind === 'branch'
    ? branchSheet(sheet, scope.rootTopicId)
    : sheet;
  return {
    ...document,
    sheets: { [selectedSheet.id]: selectedSheet },
  } as MindMapDocumentV1;
};
