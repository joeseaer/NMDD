import { describe, expect, it } from 'vitest';

import {
  createNewMindMapDocument,
  createRichText,
  createTopicTask,
} from '../domain/defaults';
import type * as Domain from '../domain/types';
import { createMindMapElementsFixture } from '../testing/fixtures';
import { mindMapRichTextToPlainText } from '../view/text';
import {
  TASK_CSV_COLUMNS,
  encodeTaskCsvField,
  exportMindMapToTaskCsv,
  exportMindMapToTaskIcs,
  foldIcsLine,
  projectMindMapTasks,
} from './taskExport';

const id = <K extends string>(counter: number): Domain.Id<K> => (
  `018f8000-0000-7000-8000-${counter.toString(16).padStart(12, '0')}` as Domain.Id<K>
);

const findTopic = (sheet: Domain.MindMapSheet, title: string): Domain.Topic => {
  const topic = Object.values(sheet.topics)
    .find((candidate) => mindMapRichTextToPlainText(candidate.title) === title);
  if (!topic) throw new Error(`Missing fixture topic: ${title}`);
  return topic;
};

interface RichTaskFixture {
  readonly document: Domain.MindMapDocumentV1;
  readonly targetTaskId: Domain.TaskId;
  readonly targetTopicId: Domain.TopicId;
  readonly todoId: Domain.TodoId;
  readonly undatedTopicId: Domain.TopicId;
}

const createRichTaskFixture = (): RichTaskFixture => {
  const document = createMindMapElementsFixture();
  document.title = '国际化发布日历 🚀';
  const sheet = Object.values(document.sheets)[0];
  sheet.orderKey = 'z';
  const root = sheet.topics[sheet.rootTopicId];
  const targetTopic = findTopic(sheet, '产品设计');
  const undatedTopic = findTopic(sheet, '交互验收');
  const todoTopic = findTopic(sheet, '市场发布');
  const resourceTopic = findTopic(sheet, '发布资料');
  targetTopic.title = createRichText(`产品/设计,🚀\n${'国际化'.repeat(24)}`);

  const existingTasks = Object.values(sheet.tasks);
  const targetTask = existingTasks.find((task) => task.topicId === targetTopic.id);
  const undatedTask = existingTasks.find((task) => task.topicId === undatedTopic.id);
  if (!targetTask || !undatedTask) throw new Error('MM-RICH Task fixture is incomplete.');

  const actorA = id<'Actor'>(1);
  const actorB = id<'Actor'>(2);
  document.actors[actorA] = {
    displayName: 'Ada, 阿达',
    id: actorA,
    status: 'active',
  };
  document.actors[actorB] = {
    displayName: '李\n雷',
    id: actorB,
    status: 'active',
  };
  Object.assign(targetTask, {
    assigneeIds: [actorA, actorB],
    audit: {
      createdAt: '2026-07-01T10:00:00+08:00',
      updatedAt: '2026-07-19T17:30:45+08:00',
    },
    dueDate: '2026-07-22',
    durationMinutes: 480,
    milestone: true,
    priority: 1,
    progress: 0.375,
    startDate: '2026-07-20',
    status: 'in-progress',
  } satisfies Partial<Domain.TopicTask>);
  Object.assign(undatedTask, {
    dueDate: '2026-08-15',
    durationMinutes: 90,
    milestone: false,
    priority: 2,
    progress: 0,
    status: 'not-started',
  } satisfies Partial<Domain.TopicTask>);

  const rootTask = createTopicTask({ id: id<'Task'>(10), topicId: root.id });
  const todoTopicTask = createTopicTask({ id: id<'Task'>(11), topicId: todoTopic.id });
  const resourceTask = createTopicTask({ id: id<'Task'>(12), topicId: resourceTopic.id });
  sheet.tasks[rootTask.id] = rootTask;
  sheet.tasks[todoTopicTask.id] = todoTopicTask;
  sheet.tasks[resourceTask.id] = resourceTask;
  sheet.taskDependencies = {} as Domain.TaskDependencyMap;
  const dependencyInputs: Array<[
    Domain.TaskId,
    Domain.TaskDependencyType,
    Domain.TaskDependencyId,
  ]> = [
    [rootTask.id, 'finish-start', id<'TaskDependency'>(20)],
    [todoTopicTask.id, 'start-start', id<'TaskDependency'>(21)],
    [resourceTask.id, 'finish-finish', id<'TaskDependency'>(22)],
    [undatedTask.id, 'start-finish', id<'TaskDependency'>(23)],
  ];
  for (const [predecessorTaskId, type, dependencyId] of dependencyInputs) {
    sheet.taskDependencies[dependencyId] = {
      id: dependencyId,
      predecessorTaskId,
      successorTaskId: targetTask.id,
      type,
    };
  }

  // Add an earlier Sheet after the rich Sheet to prove orderKey/ID—not object
  // insertion order—controls cross-Sheet bytes.
  const earlier = createNewMindMapDocument({
    documentId: id<'Document'>(30),
    rootTitle: '跨 Sheet 任务',
    rootTopicId: id<'Topic'>(31),
    sheetId: id<'Sheet'>(32),
    sheetOrderKey: 'a',
    sheetTitle: '最早 Sheet',
    themeId: id<'Theme'>(33),
    title: 'unused',
  });
  const earlierSheet = earlier.sheets[id<'Sheet'>(32)];
  const earlierTask = createTopicTask({
    id: id<'Task'>(34),
    topicId: earlierSheet.rootTopicId,
  });
  Object.assign(earlierTask, {
    progress: 1,
    startDate: '2026-07-01',
    status: 'done',
  } satisfies Partial<Domain.TopicTask>);
  earlierSheet.tasks[earlierTask.id] = earlierTask;
  document.sheets[earlierSheet.id] = earlierSheet;
  Object.assign(document.themes, earlier.themes);

  const todo = Object.values(sheet.todos)[0];
  if (!todo) throw new Error('MM-RICH Todo fixture is incomplete.');
  return {
    document,
    targetTaskId: targetTask.id,
    targetTopicId: targetTopic.id,
    todoId: todo.id,
    undatedTopicId: undatedTopic.id,
  };
};

const reverseRecord = <T>(record: Readonly<Record<string, T>>): Record<string, T> => (
  Object.fromEntries(Object.entries(record).reverse())
);

const permuteRecordInsertionOrder = (
  source: Domain.MindMapDocumentV1,
): Domain.MindMapDocumentV1 => {
  const document = structuredClone(source);
  document.sheets = reverseRecord(document.sheets) as Record<Domain.SheetId, Domain.MindMapSheet>;
  document.actors = reverseRecord(document.actors) as Record<Domain.ActorId, Domain.ActorSnapshot>;
  for (const sheet of Object.values(document.sheets)) {
    sheet.topics = reverseRecord(sheet.topics) as Domain.TopicMap;
    sheet.treeEdges = reverseRecord(sheet.treeEdges) as Domain.TreeEdgeMap;
    sheet.tasks = reverseRecord(sheet.tasks) as Domain.TopicTaskMap;
    sheet.taskDependencies = reverseRecord(sheet.taskDependencies) as Domain.TaskDependencyMap;
    sheet.todos = reverseRecord(sheet.todos) as Domain.TopicTodoMap;
  }
  return document;
};

const count = (source: string, token: string): number => source.split(token).length - 1;

const parseCsv = (source: string): string[][] => {
  const input = source.startsWith('\uFEFF') ? source.slice(1) : source;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\r' && input[index + 1] === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      index += 1;
    } else field += character;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
};

describe('ACC-IO-008 Task CSV/ICS export', () => {
  it('exports MM-RICH Task CSV with Topic IDs, slash paths, assignees, four dependency types and RFC 4180 encoding', () => {
    const fixture = createRichTaskFixture();
    const rows = projectMindMapTasks(fixture.document);
    const target = rows.find((row) => row.taskId === fixture.targetTopicId);
    expect(target).toMatchObject({
      assignees: ['Ada, 阿达', '李\n雷'],
      durationMinutes: 480,
      milestone: true,
      priority: 1,
      progress: 0.375,
      startDate: '2026-07-20',
      status: 'in-progress',
      taskId: fixture.targetTopicId,
    });
    expect(target?.taskPath).toContain('产品发布计划/产品\\/设计,🚀\n');
    expect(target?.dependencies).toEqual([
      `${Object.values(fixture.document.sheets)
        .find((sheet) => sheet.tasks[fixture.targetTaskId])!.rootTopicId}FS`,
      `${findTopic(Object.values(fixture.document.sheets)
        .find((sheet) => sheet.tasks[fixture.targetTaskId])!, '市场发布').id}SS`,
      `${fixture.undatedTopicId}SF`,
      `${findTopic(Object.values(fixture.document.sheets)
        .find((sheet) => sheet.tasks[fixture.targetTaskId])!, '发布资料').id}FF`,
    ]);
    expect(rows[0]).toMatchObject({ sheet: '最早 Sheet', task: '跨 Sheet 任务' });

    const csv = exportMindMapToTaskCsv(fixture.document);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toMatch(/^\uFEFFTask ID,Sheet,Task,Task Path,/u);
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(csv.replace(/\r\n/gu, '')).not.toContain('\n');
    expect(csv).toContain('37.5%');
    expect(csv).toContain('Ada, 阿达, 李');
    expect(csv).toContain(`${fixture.undatedTopicId}SF`);
    expect(csv).not.toContain(fixture.targetTaskId);
    expect(csv).not.toContain(fixture.todoId);
    expect(csv).not.toContain('assets/launch.png');
    expect(csv).not.toContain('brief.pdf');
    const parsed = parseCsv(csv);
    expect(parsed).toHaveLength(rows.length + 1);
    expect(parsed.every((row) => row.length === TASK_CSV_COLUMNS.length)).toBe(true);

    expect(encodeTaskCsvField('逗号, "引号"\n换行'))
      .toBe('"逗号, ""引号""\r\n换行"');
    expect(encodeTaskCsvField('=HYPERLINK("https://bad")'))
      .toBe('"\'=HYPERLINK(""https://bad"")"');
  });

  it('exports only start-dated TopicTasks to deterministic, folded ICS and never exports Todo/internal resource data', () => {
    const fixture = createRichTaskFixture();
    const first = exportMindMapToTaskIcs(fixture.document);
    const reordered = exportMindMapToTaskIcs(permuteRecordInsertionOrder(fixture.document));
    expect(reordered).toBe(first);
    expect(exportMindMapToTaskIcs(fixture.document)).toBe(first);

    expect(first.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(first.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(count(first, 'BEGIN:VEVENT')).toBe(2);
    expect(first).toContain(`UID:${fixture.targetTopicId}@mindmap.nmdd.app`);
    expect(first).toContain('DTSTAMP:20260719T093045Z');
    expect(first).toContain('DTSTART;VALUE=DATE:20260720');
    expect(first).toContain('DTEND;VALUE=DATE:20260723');
    expect(first).toContain('X-NMDD-TASK-STATUS:in-progress');
    expect(first).toContain('X-NMDD-PROGRESS:37.5');
    expect(first).toContain('X-NMDD-DURATION-MINUTES:480');
    expect(first).toContain('X-NMDD-MILESTONE:TRUE');
    expect(first).not.toContain(`${fixture.undatedTopicId}@mindmap.nmdd.app`);
    expect(first).not.toContain(fixture.targetTaskId);
    expect(first).not.toContain(fixture.todoId);
    expect(first).not.toContain('relativePath');
    expect(first).not.toContain('assets/launch.png');

    const physicalLines = first.split('\r\n').filter((line) => line !== '');
    for (const line of physicalLines) {
      expect(new TextEncoder().encode(line).byteLength).toBeLessThanOrEqual(75);
    }
    const unfolded = first.replace(/\r\n /gu, '');
    expect(unfolded).toContain('SUMMARY:产品/设计\\,🚀\\n国际化');
    expect(unfolded).toContain('X-NMDD-ASSIGNEES:Ada\\, 阿达\\, 李\\n雷');
  });

  it('emits a legal header-only CSV/calendar for an empty Task model and uses UTC for future date-time Schema values', () => {
    const empty = createNewMindMapDocument({
      documentId: id<'Document'>(50),
      rootTitle: 'Root',
      rootTopicId: id<'Topic'>(51),
      sheetId: id<'Sheet'>(52),
      sheetOrderKey: 'a',
      sheetTitle: 'Sheet',
      themeId: id<'Theme'>(53),
      title: 'Empty',
    });
    expect(exportMindMapToTaskCsv(empty)).toBe(
      `\uFEFF${TASK_CSV_COLUMNS.join(',')}\r\n`,
    );
    expect(exportMindMapToTaskIcs(empty)).toBe([
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//NMDD//Mind Map Task Export 1.0//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:Empty',
      'END:VCALENDAR',
      '',
    ].join('\r\n'));

    const sheet = empty.sheets[id<'Sheet'>(52)];
    const task = createTopicTask({ id: id<'Task'>(54), topicId: sheet.rootTopicId });
    task.startDate = '2026-07-20T08:30:00+08:00';
    task.dueDate = '2026-07-20T10:00:00+08:00';
    sheet.tasks[task.id] = task;
    const futureIcs = exportMindMapToTaskIcs(empty);
    expect(futureIcs).toContain('DTSTART:20260720T003000Z');
    expect(futureIcs).toContain('DTEND:20260720T020000Z');

    expect(foldIcsLine(`SUMMARY:${'🚀'.repeat(40)}`).split('\r\n').length)
      .toBeGreaterThan(1);
  });
});
