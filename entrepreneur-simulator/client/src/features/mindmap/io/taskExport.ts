import type {
  MindMapDocumentV1,
  MindMapSheet,
  TaskDependencyType,
  TaskStatus,
  TopicId,
  TopicTask,
} from '../domain/types';
import {
  collectSheetTopicTraversal,
  compareMindMapViewText,
  getMindMapSheetsInViewOrder,
} from '../view/ordering';
import { mindMapRichTextToPlainText } from '../view/text';

export const TASK_CSV_COLUMNS = [
  'Task ID',
  'Sheet',
  'Task',
  'Task Path',
  'Status',
  'Progress',
  'Priority',
  'Assignees',
  'Start Date',
  'Due Date',
  'Duration (minutes)',
  'Milestone',
  'Dependencies',
] as const;

export interface MindMapTaskExportRow {
  /** XMind-compatible external task ID. This is deliberately the Topic ID. */
  readonly taskId: TopicId;
  readonly sheet: string;
  readonly task: string;
  readonly taskPath: string;
  readonly status: TaskStatus;
  readonly progress: number;
  readonly priority?: 1 | 2 | 3 | 4 | 5;
  readonly assignees: readonly string[];
  readonly startDate?: string;
  readonly dueDate?: string;
  readonly durationMinutes?: number;
  readonly milestone: boolean;
  readonly dependencies: readonly string[];
  /** Stable RFC 5545 timestamp source; never serialized as an internal ID. */
  readonly updatedAt?: string;
}

const TASK_DEPENDENCY_SUFFIX: Readonly<Record<TaskDependencyType, string>> = {
  'finish-start': 'FS',
  'start-start': 'SS',
  'finish-finish': 'FF',
  'start-finish': 'SF',
};

const CSV_BOM = '\uFEFF';
const CRLF = '\r\n';
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;
const UUID_V7 = /^([0-9a-f]{8})-([0-9a-f]{4})-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SPREADSHEET_FORMULA_PREFIX = /^[\t\r\n ]*[=+\-@]/u;

const taskByTopic = (sheet: MindMapSheet): Map<TopicId, TopicTask[]> => {
  const result = new Map<TopicId, TopicTask[]>();
  for (const task of Object.values(sheet.tasks)) {
    const tasks = result.get(task.topicId);
    if (tasks) tasks.push(task);
    else result.set(task.topicId, [task]);
  }
  for (const tasks of result.values()) {
    tasks.sort((left, right) => compareMindMapViewText(left.id, right.id));
  }
  return result;
};

const dependencyTextBySuccessor = (sheet: MindMapSheet): Map<string, string[]> => {
  const result = new Map<string, Array<{ id: string; value: string }>>();
  for (const dependency of Object.values(sheet.taskDependencies)) {
    const predecessor = sheet.tasks[dependency.predecessorTaskId];
    const successor = sheet.tasks[dependency.successorTaskId];
    if (!predecessor || !successor) continue;
    const values = result.get(successor.id);
    const value = `${predecessor.topicId}${TASK_DEPENDENCY_SUFFIX[dependency.type]}`;
    const item = { id: dependency.id, value };
    if (values) values.push(item);
    else result.set(successor.id, [item]);
  }

  const normalized = new Map<string, string[]>();
  for (const [taskId, dependencies] of result) {
    dependencies.sort((left, right) => (
      compareMindMapViewText(left.value, right.value)
      || compareMindMapViewText(left.id, right.id)
    ));
    normalized.set(taskId, dependencies.map(({ value }) => value));
  }
  return normalized;
};

/**
 * Escapes the two structural characters in an XMind-style slash path while
 * leaving Unicode and line breaks intact for the target serializer to encode.
 */
export const escapeTaskPathSegment = (value: string): string => value
  .replace(/\\/gu, '\\\\')
  .replace(/\//gu, '\\/');

/**
 * Produces the shared, renderer-independent task projection used by CSV/ICS.
 * Sheet and topic ordering are canonical (`orderKey`, then entity ID); object
 * insertion order and React Flow state can never affect exported bytes.
 */
export function projectMindMapTasks(
  document: MindMapDocumentV1,
): readonly MindMapTaskExportRow[] {
  const rows: MindMapTaskExportRow[] = [];

  for (const sheet of getMindMapSheetsInViewOrder(document)) {
    const tasks = taskByTopic(sheet);
    const dependencies = dependencyTextBySuccessor(sheet);
    for (const entry of collectSheetTopicTraversal(sheet)) {
      const topicTasks = tasks.get(entry.topic.id) ?? [];
      if (topicTasks.length === 0) continue;
      const pathIds = [...entry.ancestorTopicIds, entry.topic.id];
      const taskPath = pathIds
        .map((topicId) => sheet.topics[topicId])
        .filter((topic) => topic !== undefined)
        .map((topic) => escapeTaskPathSegment(mindMapRichTextToPlainText(topic.title)))
        .join('/');

      for (const task of topicTasks) {
        rows.push({
          taskId: entry.topic.id,
          sheet: sheet.title,
          task: mindMapRichTextToPlainText(entry.topic.title),
          taskPath,
          status: task.status,
          progress: task.progress,
          ...(task.priority === undefined ? {} : { priority: task.priority }),
          assignees: (task.assigneeIds ?? []).map((actorId) => (
            document.actors[actorId]?.displayName ?? 'Unknown'
          )),
          ...(task.startDate === undefined ? {} : { startDate: task.startDate }),
          ...(task.dueDate === undefined ? {} : { dueDate: task.dueDate }),
          ...(task.durationMinutes === undefined
            ? {}
            : { durationMinutes: task.durationMinutes }),
          milestone: task.milestone ?? false,
          dependencies: dependencies.get(task.id) ?? [],
          ...(task.audit?.updatedAt === undefined
            ? {}
            : { updatedAt: task.audit.updatedAt }),
        });
      }
    }
  }

  return rows;
}

const spreadsheetSafeText = (value: string): string => (
  SPREADSHEET_FORMULA_PREFIX.test(value) ? `'${value}` : value
);

/** RFC 4180 field encoding, with formula-prefix hardening for spreadsheet apps. */
export const encodeTaskCsvField = (value: string): string => {
  const normalized = value.replace(/\r\n|\r|\n/gu, CRLF);
  const safe = spreadsheetSafeText(normalized);
  if (!/[",\r\n]/u.test(safe)) return safe;
  return `"${safe.replace(/"/gu, '""')}"`;
};

const formatProgress = (progress: number): string => {
  const percentage = Number((progress * 100).toFixed(10));
  return `${percentage}%`;
};

const taskRowToCsv = (row: MindMapTaskExportRow): string => [
  row.taskId,
  row.sheet,
  row.task,
  row.taskPath,
  row.status,
  formatProgress(row.progress),
  row.priority?.toString() ?? '',
  row.assignees.join(', '),
  row.startDate ?? '',
  row.dueDate ?? '',
  row.durationMinutes?.toString() ?? '',
  row.milestone ? 'true' : 'false',
  row.dependencies.join(', '),
].map(encodeTaskCsvField).join(',');

/** Exports all TopicTask entities as a UTF-8-BOM, RFC 4180 CSV document. */
export function exportMindMapToTaskCsv(document: MindMapDocumentV1): string {
  const lines = [
    TASK_CSV_COLUMNS.map(encodeTaskCsvField).join(','),
    ...projectMindMapTasks(document).map(taskRowToCsv),
  ];
  return `${CSV_BOM}${lines.join(CRLF)}${CRLF}`;
}

/** Backwards-friendly plural spelling for adapter callers. */
export const exportMindMapTasksToCsv = exportMindMapToTaskCsv;

const validIsoDateParts = (value: string): [number, number, number] | undefined => {
  const match = ISO_DATE.exec(value);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return undefined;
  return [year, month, day];
};

const formatIcsDate = ([year, month, day]: readonly number[]): string => (
  `${year.toString().padStart(4, '0')}${month.toString().padStart(2, '0')}${day.toString().padStart(2, '0')}`
);

const addDays = (parts: readonly number[], days: number): [number, number, number] => {
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + days));
  return [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()];
};

const formatUtcDateTime = (value: string | number): string | undefined => {
  const timestamp = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(timestamp)) return undefined;
  const date = new Date(timestamp);
  return `${date.getUTCFullYear().toString().padStart(4, '0')}`
    + `${(date.getUTCMonth() + 1).toString().padStart(2, '0')}`
    + `${date.getUTCDate().toString().padStart(2, '0')}T`
    + `${date.getUTCHours().toString().padStart(2, '0')}`
    + `${date.getUTCMinutes().toString().padStart(2, '0')}`
    + `${date.getUTCSeconds().toString().padStart(2, '0')}Z`;
};

const topicIdTimestamp = (topicId: TopicId): string | undefined => {
  const match = UUID_V7.exec(topicId);
  if (!match) return undefined;
  const milliseconds = Number.parseInt(`${match[1]}${match[2]}`, 16);
  return formatUtcDateTime(milliseconds);
};

/** RFC 5545 TEXT escaping. */
export const escapeIcsText = (value: string): string => value
  .replace(/\\/gu, '\\\\')
  .replace(/\r\n|\r|\n/gu, '\\n')
  .replace(/;/gu, '\\;')
  .replace(/,/gu, '\\,');

const utf8Length = (value: string): number => new TextEncoder().encode(value).byteLength;

/**
 * Folds an iCalendar content line at 75 UTF-8 octets without splitting a
 * Unicode code point. Continuation whitespace counts toward the 75-octet cap.
 */
export const foldIcsLine = (line: string): string => {
  const folded: string[] = [];
  let current = '';
  let limit = 75;

  for (const character of line) {
    if (current !== '' && utf8Length(current) + utf8Length(character) > limit) {
      folded.push(current);
      current = character;
      limit = 74;
    } else {
      current += character;
    }
  }
  folded.push(current);
  return folded.join(`${CRLF} `);
};

const contentLine = (name: string, value: string): string => foldIcsLine(`${name}:${value}`);

const eventStatus = (status: TaskStatus): 'CANCELLED' | 'CONFIRMED' => (
  status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'
);

const progressPercentage = (value: number): string => (
  Number((value * 100).toFixed(10)).toString()
);

const eventDateLines = (row: MindMapTaskExportRow): string[] | undefined => {
  if (row.startDate === undefined) return undefined;
  const startDate = validIsoDateParts(row.startDate);
  if (startDate) {
    const dueDate = row.dueDate === undefined ? undefined : validIsoDateParts(row.dueDate);
    const endDate = dueDate && Date.UTC(...[
      dueDate[0], dueDate[1] - 1, dueDate[2],
    ] as [number, number, number]) >= Date.UTC(startDate[0], startDate[1] - 1, startDate[2])
      ? addDays(dueDate, 1)
      : addDays(startDate, 1);
    return [
      contentLine('DTSTART;VALUE=DATE', formatIcsDate(startDate)),
      contentLine('DTEND;VALUE=DATE', formatIcsDate(endDate)),
    ];
  }

  // TopicTask V1 currently uses Schema `format: date`; this branch keeps the
  // adapter forward-compatible if a future Schema revision permits date-time.
  const startDateTime = formatUtcDateTime(row.startDate);
  if (!startDateTime) return undefined;
  const lines = [contentLine('DTSTART', startDateTime)];
  const dueDateTime = row.dueDate === undefined ? undefined : formatUtcDateTime(row.dueDate);
  if (dueDateTime && dueDateTime >= startDateTime) {
    lines.push(contentLine('DTEND', dueDateTime));
  } else if (row.durationMinutes !== undefined) {
    lines.push(contentLine('DURATION', `PT${row.durationMinutes}M`));
  }
  return lines;
};

const taskRowToIcsEvent = (row: MindMapTaskExportRow): string[] | undefined => {
  const dates = eventDateLines(row);
  if (!dates) return undefined;
  const stamp = formatUtcDateTime(row.updatedAt ?? '')
    ?? topicIdTimestamp(row.taskId)
    ?? '19700101T000000Z';
  const lines = [
    'BEGIN:VEVENT',
    contentLine('UID', `${row.taskId}@mindmap.nmdd.app`),
    contentLine('DTSTAMP', stamp),
    ...dates,
    contentLine('SUMMARY', escapeIcsText(row.task)),
    contentLine('STATUS', eventStatus(row.status)),
    contentLine('X-NMDD-TASK-ID', row.taskId),
    contentLine('X-NMDD-SHEET', escapeIcsText(row.sheet)),
    contentLine('X-NMDD-TASK-PATH', escapeIcsText(row.taskPath)),
    contentLine('X-NMDD-TASK-STATUS', row.status),
    contentLine('X-NMDD-PROGRESS', progressPercentage(row.progress)),
    contentLine('X-NMDD-MILESTONE', row.milestone ? 'TRUE' : 'FALSE'),
  ];
  if (row.priority !== undefined) lines.push(contentLine('PRIORITY', row.priority.toString()));
  if (row.durationMinutes !== undefined) {
    lines.push(contentLine('X-NMDD-DURATION-MINUTES', row.durationMinutes.toString()));
  }
  if (row.assignees.length > 0) {
    lines.push(contentLine('X-NMDD-ASSIGNEES', escapeIcsText(row.assignees.join(', '))));
  }
  if (row.dependencies.length > 0) {
    lines.push(contentLine(
      'X-NMDD-DEPENDENCIES',
      escapeIcsText(row.dependencies.join(', ')),
    ));
  }
  lines.push('END:VEVENT');
  return lines;
};

/**
 * Exports start-dated TopicTask entities as a deterministic RFC 5545 calendar.
 * Date-only Schema values are all-day VEVENTs; date-times are normalized to UTC.
 */
export function exportMindMapToTaskIcs(document: MindMapDocumentV1): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//NMDD//Mind Map Task Export 1.0//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    contentLine('X-WR-CALNAME', escapeIcsText(document.title)),
  ];
  for (const row of projectMindMapTasks(document)) {
    const event = taskRowToIcsEvent(row);
    if (event) lines.push(...event);
  }
  lines.push('END:VCALENDAR');
  return `${lines.join(CRLF)}${CRLF}`;
}

/** Backwards-friendly plural spelling for adapter callers. */
export const exportMindMapTasksToIcs = exportMindMapToTaskIcs;
