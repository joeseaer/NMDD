import type {
  MarkerInstance,
  MindMapDocumentV1,
  MindMapSheet,
  Note,
  SheetId,
  Topic,
  TopicId,
  TopicTask,
  TopicTodo,
} from '../domain/types';
import {
  collectDocumentTopicTraversal,
  mindMapTopicKey,
  type MindMapTopicTraversalEntry,
} from './ordering';
import { mindMapRichTextToPlainText } from './text';
import {
  MIND_MAP_SEARCH_FIELDS,
  type MindMapSearchCursor,
  type MindMapSearchField,
  type MindMapSearchFieldMatch,
  type MindMapSearchFilterMode,
  type MindMapSearchFilterProjection,
  type MindMapSearchFilterSheetProjection,
  type MindMapSearchIndex,
  type MindMapSearchIndexChanges,
  type MindMapSearchIndexedValue,
  type MindMapSearchIndexEntry,
  type MindMapSearchMatch,
  type MindMapSearchNavigationDirection,
  type MindMapSearchQuery,
  type MindMapSearchResultSet,
  type MindMapSearchTextRange,
} from './types';

interface SheetSearchSources {
  readonly markers: ReadonlyMap<TopicId, readonly MarkerInstance[]>;
  readonly notes: ReadonlyMap<TopicId, readonly Note[]>;
  readonly tasks: ReadonlyMap<TopicId, readonly TopicTask[]>;
  readonly todos: ReadonlyMap<TopicId, readonly TopicTodo[]>;
}

const byId = <T extends { readonly id: string }>(left: T, right: T): number => {
  if (left.id < right.id) return -1;
  if (left.id > right.id) return 1;
  return 0;
};

const byOrderThenId = <T extends { readonly id: string; readonly orderKey: string }>(
  left: T,
  right: T,
): number => {
  if (left.orderKey < right.orderKey) return -1;
  if (left.orderKey > right.orderKey) return 1;
  return byId(left, right);
};

const groupByTopic = <T extends { readonly topicId: TopicId }>(
  values: readonly T[],
  compare: (left: T, right: T) => number,
): ReadonlyMap<TopicId, readonly T[]> => {
  const groups = new Map<TopicId, T[]>();
  for (const value of values) {
    const group = groups.get(value.topicId);
    if (group) group.push(value);
    else groups.set(value.topicId, [value]);
  }
  for (const group of groups.values()) group.sort(compare);
  return groups;
};

const collectSheetSearchSources = (sheet: MindMapSheet): SheetSearchSources => ({
  markers: groupByTopic(Object.values(sheet.markerInstances), byOrderThenId),
  notes: groupByTopic(Object.values(sheet.notes), byId),
  tasks: groupByTopic(Object.values(sheet.tasks), byId),
  todos: groupByTopic(Object.values(sheet.todos), byId),
});

const valueText = (value: string | number | boolean | undefined): string | undefined => {
  if (value === undefined) return undefined;
  const text = String(value);
  return text.length > 0 ? text : undefined;
};

const collectIndexedValues = (
  document: MindMapDocumentV1,
  topic: Topic,
  sources: SheetSearchSources,
): MindMapSearchIndexedValue[] => {
  const values: MindMapSearchIndexedValue[] = [];
  const add = (
    field: MindMapSearchField,
    text: string | number | boolean | undefined,
    sourceId?: string,
    attribute?: string,
  ): void => {
    const normalized = valueText(text);
    if (normalized === undefined) return;
    values.push({
      field,
      text: normalized,
      ...(sourceId ? { sourceId } : {}),
      ...(attribute ? { attribute } : {}),
    });
  };

  add('topic', mindMapRichTextToPlainText(topic.title), topic.id, 'title');
  for (const label of topic.labels ?? []) add('label', label, topic.id, 'label');

  for (const note of sources.notes.get(topic.id) ?? []) {
    add('note', mindMapRichTextToPlainText(note.content), note.id, 'content');
  }

  for (const marker of sources.markers.get(topic.id) ?? []) {
    const definition = document.markerDefinitions[marker.markerDefinitionId];
    const group = definition ? document.markerGroups[definition.groupId] : undefined;
    add('marker', definition?.name, marker.id, 'name');
    add('marker', group?.name, marker.id, 'group');
    add(
      'marker',
      definition?.source.kind === 'builtin' ? definition.source.key : undefined,
      marker.id,
      'builtin-key',
    );
    add('marker', definition?.semanticValue, marker.id, 'semantic-value');
    add('marker', marker.value, marker.id, 'value');
  }

  for (const todo of sources.todos.get(topic.id) ?? []) {
    add('todo', 'To-do', todo.id, 'kind');
    add('todo', todo.completed ? 'completed' : 'incomplete', todo.id, 'status');
    add('todo', todo.completed, todo.id, 'completed');
    add('todo', todo.completedAt, todo.id, 'completed-at');
  }

  for (const task of sources.tasks.get(topic.id) ?? []) {
    add('task', 'Task', task.id, 'kind');
    add('task', task.status, task.id, 'status');
    const progressPercent = Math.round(task.progress * 10_000) / 100;
    add('task', `${task.progress} ${progressPercent}%`, task.id, 'progress');
    add('task', task.priority, task.id, 'priority');
    add('task', task.startDate, task.id, 'start-date');
    add('task', task.dueDate, task.id, 'due-date');
    add('task', task.durationMinutes, task.id, 'duration-minutes');
    add('task', task.milestone, task.id, 'milestone');
    add('task', task.displayFields?.join(' '), task.id, 'display-fields');
    for (const actorId of task.assigneeIds ?? []) {
      const actor = document.actors[actorId];
      add('task', actor?.displayName, task.id, 'assignee-name');
      add('task', actor?.email, task.id, 'assignee-email');
    }
  }

  return values;
};

const createSearchEntry = (
  document: MindMapDocumentV1,
  traversal: MindMapTopicTraversalEntry,
  sources: SheetSearchSources,
): MindMapSearchIndexEntry => {
  return {
    key: mindMapTopicKey(traversal.sheetId, traversal.topic.id),
    ordinal: traversal.ordinal,
    sheetId: traversal.sheetId,
    sheetTitle: traversal.sheetTitle,
    topicId: traversal.topic.id,
    topicTitle: mindMapRichTextToPlainText(traversal.topic.title),
    ...(traversal.parentTopicId ? { parentTopicId: traversal.parentTopicId } : {}),
    ancestorTopicIds: [...traversal.ancestorTopicIds],
    depth: traversal.depth,
    values: collectIndexedValues(document, traversal.topic, sources),
  };
};

const createIndex = (
  document: MindMapDocumentV1,
  entries: readonly MindMapSearchIndexEntry[],
): MindMapSearchIndex => {
  const entryByTopicKey: Record<string, MindMapSearchIndexEntry> = {};
  for (const entry of entries) entryByTopicKey[entry.key] = entry;
  return {
    version: 'mindmap-search-index@2026-07-19',
    documentId: document.id,
    contentRevision: document.contentRevision,
    entries,
    entryByTopicKey,
  };
};

export const buildMindMapSearchIndex = (
  document: MindMapDocumentV1,
): MindMapSearchIndex => {
  const sources = new Map<SheetId, SheetSearchSources>();
  const entries = collectDocumentTopicTraversal(document).map((traversal) => {
    let sheetSources = sources.get(traversal.sheetId);
    if (!sheetSources) {
      sheetSources = collectSheetSearchSources(document.sheets[traversal.sheetId]);
      sources.set(traversal.sheetId, sheetSources);
    }
    return createSearchEntry(document, traversal, sheetSources);
  });
  return createIndex(document, entries);
};

const sameIds = (left: readonly string[], right: readonly string[]): boolean => (
  left.length === right.length && left.every((id, index) => id === right[index])
);

const rebaseSearchEntry = (
  previous: MindMapSearchIndexEntry,
  traversal: MindMapTopicTraversalEntry,
): MindMapSearchIndexEntry => {
  if (
    previous.ordinal === traversal.ordinal
    && previous.sheetTitle === traversal.sheetTitle
    && previous.parentTopicId === traversal.parentTopicId
    && previous.depth === traversal.depth
    && sameIds(previous.ancestorTopicIds, traversal.ancestorTopicIds)
  ) return previous;
  return {
    ...previous,
    ordinal: traversal.ordinal,
    sheetTitle: traversal.sheetTitle,
    ...(traversal.parentTopicId
      ? { parentTopicId: traversal.parentTopicId }
      : { parentTopicId: undefined }),
    ancestorTopicIds: [...traversal.ancestorTopicIds],
    depth: traversal.depth,
  };
};

/**
 * Incrementally refreshes searchable content while always recomputing the
 * inexpensive traversal metadata, so insertions/reorders cannot leave stale
 * result ordering. Omit `changes` to request a correctness-first full rebuild.
 */
export const updateMindMapSearchIndex = (
  previous: MindMapSearchIndex,
  document: MindMapDocumentV1,
  changes?: MindMapSearchIndexChanges,
): MindMapSearchIndex => {
  if (previous.documentId !== document.id || changes === undefined) {
    return buildMindMapSearchIndex(document);
  }

  const affectedKeys = new Set<string>();
  const affectedSheets = new Set(changes.sheets ?? []);
  for (const topic of changes.topics ?? []) {
    affectedKeys.add(mindMapTopicKey(topic.sheetId, topic.topicId));
  }

  const markerDefinitions = new Set(changes.markerDefinitions ?? []);
  const actors = new Set(changes.actors ?? []);
  if (markerDefinitions.size > 0 || actors.size > 0) {
    for (const sheet of Object.values(document.sheets)) {
      if (markerDefinitions.size > 0) {
        for (const marker of Object.values(sheet.markerInstances)) {
          if (markerDefinitions.has(marker.markerDefinitionId)) {
            affectedKeys.add(mindMapTopicKey(sheet.id, marker.topicId));
          }
        }
      }
      if (actors.size > 0) {
        for (const task of Object.values(sheet.tasks)) {
          if (task.assigneeIds?.some((actorId) => actors.has(actorId))) {
            affectedKeys.add(mindMapTopicKey(sheet.id, task.topicId));
          }
        }
      }
    }
  }

  const sources = new Map<SheetId, SheetSearchSources>();
  const entries = collectDocumentTopicTraversal(document).map((traversal) => {
    const key = mindMapTopicKey(traversal.sheetId, traversal.topic.id);
    const existing = previous.entryByTopicKey[key];
    if (
      existing
      && !affectedSheets.has(traversal.sheetId)
      && !affectedKeys.has(key)
    ) return rebaseSearchEntry(existing, traversal);

    let sheetSources = sources.get(traversal.sheetId);
    if (!sheetSources) {
      sheetSources = collectSheetSearchSources(document.sheets[traversal.sheetId]);
      sources.set(traversal.sheetId, sheetSources);
    }
    return createSearchEntry(document, traversal, sheetSources);
  });
  return createIndex(document, entries);
};

const isWordCharacter = (character: string | undefined): boolean => (
  character !== undefined && /[\p{L}\p{N}_]/u.test(character)
);

/** Literal matching only: regex metacharacters in user input have no syntax. */
export const findMindMapSearchRanges = (
  text: string,
  query: string,
  caseSensitive = false,
  wholeWord = false,
): MindMapSearchTextRange[] => {
  if (query.length === 0) return [];
  const haystack = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  const ranges: MindMapSearchTextRange[] = [];
  let offset = 0;
  while (offset <= haystack.length - needle.length) {
    const start = haystack.indexOf(needle, offset);
    if (start < 0) break;
    const end = start + needle.length;
    const leftBoundary = !isWordCharacter(needle[0])
      || !isWordCharacter(haystack[start - 1]);
    const rightBoundary = !isWordCharacter(needle[needle.length - 1])
      || !isWordCharacter(haystack[end]);
    if (!wholeWord || (leftBoundary && rightBoundary)) ranges.push({ start, end });
    offset = start + Math.max(needle.length, 1);
  }
  return ranges;
};

const entryIsInScope = (
  entry: MindMapSearchIndexEntry,
  query: MindMapSearchQuery,
): boolean => {
  const scope = query.scope ?? { kind: 'all-sheets' };
  if (scope.kind === 'all-sheets') return true;
  if (entry.sheetId !== scope.sheetId) return false;
  if (scope.kind === 'sheet') return true;
  return entry.topicId === scope.rootTopicId
    || entry.ancestorTopicIds.includes(scope.rootTopicId);
};

export const searchMindMapIndex = (
  index: MindMapSearchIndex,
  query: MindMapSearchQuery,
): MindMapSearchResultSet => {
  const active = query.text.length > 0;
  if (!active) return { query, active, matches: [], total: 0 };
  const allowedFields = new Set(query.fields ?? MIND_MAP_SEARCH_FIELDS);
  const matches: MindMapSearchMatch[] = [];

  for (const entry of index.entries) {
    if (!entryIsInScope(entry, query)) continue;
    const fields: MindMapSearchFieldMatch[] = [];
    for (const value of entry.values) {
      if (!allowedFields.has(value.field)) continue;
      const ranges = findMindMapSearchRanges(
        value.text,
        query.text,
        query.caseSensitive,
        query.wholeWord,
      );
      if (ranges.length > 0) fields.push({ ...value, ranges });
    }
    if (fields.length === 0) continue;
    matches.push({
      key: entry.key,
      ordinal: entry.ordinal,
      sheetId: entry.sheetId,
      sheetTitle: entry.sheetTitle,
      topicId: entry.topicId,
      topicTitle: entry.topicTitle,
      fields,
    });
  }
  return { query, active, matches, total: matches.length };
};

export const navigateMindMapSearchResults = (
  results: MindMapSearchResultSet,
  current: MindMapSearchCursor | undefined,
  direction: MindMapSearchNavigationDirection,
  wrap = true,
): MindMapSearchMatch | undefined => {
  if (results.matches.length === 0) return undefined;
  const currentIndex = current === undefined
    ? -1
    : results.matches.findIndex((match) => (
      match.sheetId === current.sheetId && match.topicId === current.topicId
    ));
  if (currentIndex < 0) {
    return direction === 'next'
      ? results.matches[0]
      : results.matches[results.matches.length - 1];
  }
  const delta = direction === 'next' ? 1 : -1;
  const requested = currentIndex + delta;
  if (requested >= 0 && requested < results.matches.length) {
    return results.matches[requested];
  }
  if (!wrap) return undefined;
  return direction === 'next'
    ? results.matches[0]
    : results.matches[results.matches.length - 1];
};

export const projectMindMapSearchFilter = (
  index: MindMapSearchIndex,
  results: MindMapSearchResultSet,
  mode: MindMapSearchFilterMode = 'hide',
): MindMapSearchFilterProjection => {
  const entriesBySheet = new Map<SheetId, MindMapSearchIndexEntry[]>();
  for (const entry of index.entries) {
    const entries = entriesBySheet.get(entry.sheetId);
    if (entries) entries.push(entry);
    else entriesBySheet.set(entry.sheetId, [entry]);
  }

  const matchedKeys = new Set(results.matches.map((match) => match.key));
  const contextKeys = new Set<string>();
  if (results.active) {
    for (const match of results.matches) {
      const entry = index.entryByTopicKey[match.key];
      if (!entry) continue;
      for (const ancestorTopicId of entry.ancestorTopicIds) {
        const key = mindMapTopicKey(entry.sheetId, ancestorTopicId);
        if (!matchedKeys.has(key)) contextKeys.add(key);
      }
    }
  }

  const sheets: Partial<Record<SheetId, MindMapSearchFilterSheetProjection>> = {};
  for (const [sheetId, entries] of entriesBySheet) {
    const allTopicIds = entries.map((entry) => entry.topicId);
    const matchedTopicIds = results.active
      ? entries.filter((entry) => matchedKeys.has(entry.key)).map((entry) => entry.topicId)
      : [];
    const contextTopicIds = results.active
      ? entries.filter((entry) => contextKeys.has(entry.key)).map((entry) => entry.topicId)
      : [];
    const includedTopicIds = results.active
      ? entries
        .filter((entry) => matchedKeys.has(entry.key) || contextKeys.has(entry.key))
        .map((entry) => entry.topicId)
      : allTopicIds;
    const included = new Set(includedTopicIds);
    const excludedTopicIds = entries
      .filter((entry) => !included.has(entry.topicId))
      .map((entry) => entry.topicId);
    sheets[sheetId] = {
      sheetId,
      allTopicIds,
      matchedTopicIds,
      contextTopicIds,
      includedTopicIds,
      hiddenTopicIds: results.active && mode === 'hide' ? excludedTopicIds : [],
      dimmedTopicIds: results.active && mode === 'dim' ? excludedTopicIds : [],
    };
  }
  return { active: results.active, mode, sheets };
};
