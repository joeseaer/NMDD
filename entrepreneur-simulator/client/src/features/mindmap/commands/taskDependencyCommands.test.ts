import { describe, expect, it } from 'vitest';

import { createMindMapSheet, createTopic } from '../domain/defaults';
import { validateMindMapDocument } from '../domain/validation';
import type {
  CommandId,
  MindMapDocumentV1,
  SheetId,
  TaskDependencyId,
  TaskId,
  TopicId,
} from '../domain/types';
import { createMindMapElementsFixture } from '../testing/fixtures';
import { exportMindMapToTaskCsv } from '../io/taskExport';
import {
  listTopicTaskDependencies,
  listTopicTaskDependencyCandidates,
  planDeleteTopicTaskDependencyCommand,
  planUpsertTopicTaskDependencyCommand,
} from '../ui/enrichmentPlanning';
import { mindMapRichTextToPlainText } from '../view/text';
import { CommandValidationError, ReadOnlyCommandError } from './errors';
import { executeMindMapCommand } from './engine';
import { PatchCommandHistory } from './history';
import type { UpsertTaskDependencyCommand } from './types';

const id = <K extends string>(counter: number): string & { readonly __id: K } => (
  `018f9000-0000-7000-8000-${counter.toString(16).padStart(12, '0')}` as string & {
    readonly __id: K;
  }
);

const setup = () => {
  const document = createMindMapElementsFixture();
  const sheetId = Object.keys(document.sheets)[0] as SheetId;
  const sheet = document.sheets[sheetId];
  const [existingDependency] = Object.values(sheet.taskDependencies);
  const predecessorTask = sheet.tasks[existingDependency.predecessorTaskId];
  const successorTask = sheet.tasks[existingDependency.successorTaskId];
  return {
    document,
    existingDependency,
    predecessorTask,
    sheet,
    sheetId,
    successorTask,
  };
};

const rawCommand = (
  document: MindMapDocumentV1,
  sheetId: SheetId,
  dependency: UpsertTaskDependencyCommand['payload']['dependency'],
): UpsertTaskDependencyCommand => ({
  baseRevision: document.contentRevision,
  commandId: id<'Command'>(900) as CommandId,
  origin: 'task-dependency-test',
  payload: { dependency },
  sheetId,
  timestamp: '2026-07-20T00:00:00.000Z',
  type: 'task-dependency.upsert',
});

describe('Task dependency commands and planning', () => {
  it('lists only Tasks in canonical tree order and projects incoming/outgoing titles', () => {
    const {
      document,
      existingDependency,
      predecessorTask,
      sheet,
      sheetId,
      successorTask,
    } = setup();
    const topicByTitle = Object.values(sheet.topics).reduce<Record<string, TopicId>>(
      (result, topic) => {
        result[mindMapRichTextToPlainText(topic.title)] = topic.id;
        return result;
      },
      {},
    );
    const addedTasks = [
      [id<'Task'>(700) as TaskId, sheet.rootTopicId],
      [id<'Task'>(701) as TaskId, topicByTitle['发布资料']],
      [id<'Task'>(702) as TaskId, topicByTitle['停车场']],
    ] as const;
    for (const [taskId, topicId] of addedTasks) {
      sheet.tasks[taskId] = { id: taskId, progress: 0, status: 'not-started', topicId };
    }
    const candidates = listTopicTaskDependencyCandidates({
      document,
      sheetId,
      topicId: predecessorTask.topicId,
    });
    expect(candidates.map((candidate) => candidate.topicTitle)).toEqual([
      '产品发布计划',
      '交互验收',
      '发布资料',
      '停车场',
    ]);
    expect(candidates[1]).toMatchObject({
      topicId: successorTask.topicId,
      topicTitle: mindMapRichTextToPlainText(sheet.topics[successorTask.topicId].title),
    });
    const todoOnlyTopicIds = Object.values(sheet.todos)
      .map((todo) => todo.topicId)
      .filter((todoTopicId) => !Object.values(sheet.tasks)
        .some((candidateTask) => candidateTask.topicId === todoTopicId));
    for (const todoOnlyTopicId of todoOnlyTopicIds) {
      expect(candidates.map((candidate) => candidate.topicId)).not.toContain(todoOnlyTopicId);
    }

    const predecessorView = listTopicTaskDependencies({
      document,
      sheetId,
      topicId: predecessorTask.topicId,
    });
    expect(predecessorView).toEqual([expect.objectContaining({
      dependency: existingDependency,
      direction: 'successor',
      otherTaskId: successorTask.id,
    })]);
    const successorView = listTopicTaskDependencies({
      document,
      sheetId,
      topicId: successorTask.topicId,
    });
    expect(successorView).toEqual([expect.objectContaining({
      dependency: existingDependency,
      direction: 'predecessor',
      otherTaskId: predecessorTask.id,
    })]);
  });

  it('edits a stable dependency, updates Task CSV, and supports atomic undo/redo/delete', () => {
    const {
      document,
      existingDependency,
      predecessorTask,
      sheetId,
      successorTask,
    } = setup();
    const edit = planUpsertTopicTaskDependencyCommand({
      commandId: id<'Command'>(1) as CommandId,
      dependencyId: existingDependency.id,
      direction: 'successor',
      document,
      lagMinutes: 90,
      otherTaskId: successorTask.id,
      sheetId,
      timestamp: '2026-07-20T00:00:00.000Z',
      topicId: predecessorTask.topicId,
      type: 'start-start',
    });
    expect(edit.payload.dependency).toMatchObject({
      id: existingDependency.id,
      lagMinutes: 90,
      predecessorTaskId: predecessorTask.id,
      successorTaskId: successorTask.id,
      type: 'start-start',
    });

    const edited = executeMindMapCommand(document, edit);
    expect(edited.document.contentRevision).toBe(document.contentRevision + 1);
    const csv = exportMindMapToTaskCsv(edited.document);
    expect(csv).toContain(`${predecessorTask.topicId}SS`);
    expect(csv).not.toContain(`${predecessorTask.topicId}FS`);

    const history = new PatchCommandHistory();
    history.record(edited.applied);
    const undone = history.undo(edited.document)!;
    expect(undone.document.sheets[sheetId].taskDependencies[existingDependency.id])
      .toEqual(existingDependency);
    const redone = history.redo(undone.document)!;
    expect(redone.document.sheets[sheetId].taskDependencies[existingDependency.id])
      .toEqual(edit.payload.dependency);

    const remove = planDeleteTopicTaskDependencyCommand({
      commandId: id<'Command'>(2) as CommandId,
      dependencyId: existingDependency.id,
      document: redone.document,
      sheetId,
      timestamp: '2026-07-20T00:01:00.000Z',
      topicId: predecessorTask.topicId,
    });
    const deleted = executeMindMapCommand(redone.document, remove);
    expect(deleted.document.sheets[sheetId].taskDependencies[existingDependency.id])
      .toBeUndefined();
    const deleteHistory = new PatchCommandHistory();
    deleteHistory.record(deleted.applied);
    expect(deleteHistory.undo(deleted.document)!.document.sheets[sheetId]
      .taskDependencies[existingDependency.id]).toEqual(edit.payload.dependency);
  });

  it('creates predecessor and successor edges with stable IDs and one revision each', () => {
    const { document, existingDependency, predecessorTask, sheetId, successorTask } = setup();
    delete document.sheets[sheetId].taskDependencies[existingDependency.id];
    const create = planUpsertTopicTaskDependencyCommand({
      direction: 'predecessor',
      document,
      lagMinutes: -30,
      otherTaskId: predecessorTask.id,
      sheetId,
      topicId: successorTask.topicId,
      type: 'finish-start',
    });
    const created = executeMindMapCommand(document, create);
    expect(created.document.sheets[sheetId].taskDependencies[create.payload.dependency.id])
      .toEqual(create.payload.dependency);
    expect(created.document.contentRevision).toBe(document.contentRevision + 1);

    const edit = planUpsertTopicTaskDependencyCommand({
      dependencyId: create.payload.dependency.id,
      direction: 'successor',
      document: created.document,
      otherTaskId: successorTask.id,
      sheetId,
      topicId: predecessorTask.topicId,
      type: 'finish-finish',
    });
    expect(edit.payload.dependency.id).toBe(create.payload.dependency.id);
    expect(executeMindMapCommand(created.document, edit).document.contentRevision)
      .toBe(created.document.contentRevision + 1);
  });

  it('zero-transaction rejects cycles, duplicates, self links, invalid types/lags, and read-only writes', () => {
    const { document, existingDependency, predecessorTask, sheetId, successorTask } = setup();
    const snapshot = structuredClone(document);
    const cycle = planUpsertTopicTaskDependencyCommand({
      direction: 'successor',
      document,
      otherTaskId: predecessorTask.id,
      sheetId,
      topicId: successorTask.topicId,
      type: 'finish-start',
    });
    expect(() => executeMindMapCommand(document, cycle)).toThrow(/directed cycle/);
    expect(document).toEqual(snapshot);

    const duplicate = rawCommand(document, sheetId, {
      ...existingDependency,
      id: id<'TaskDependency'>(20) as TaskDependencyId,
    });
    expect(() => executeMindMapCommand(document, duplicate)).toThrow(/duplicates existing/);

    const self = rawCommand(document, sheetId, {
      id: id<'TaskDependency'>(21) as TaskDependencyId,
      predecessorTaskId: predecessorTask.id,
      successorTaskId: predecessorTask.id,
      type: 'finish-start',
    });
    expect(() => executeMindMapCommand(document, self)).toThrow(CommandValidationError);

    const invalidType = rawCommand(document, sheetId, {
      id: id<'TaskDependency'>(22) as TaskDependencyId,
      predecessorTaskId: predecessorTask.id,
      successorTaskId: successorTask.id,
      type: 'FS' as 'finish-start',
    });
    expect(() => executeMindMapCommand(document, invalidType)).toThrow(/canonical schema/);

    for (const lagMinutes of [1.5, Number.MAX_SAFE_INTEGER, -525_960_001, 525_960_001]) {
      const invalidLag = rawCommand(document, sheetId, {
        id: id<'TaskDependency'>(30 + Math.abs(Math.trunc(lagMinutes)) % 10) as TaskDependencyId,
        lagMinutes,
        predecessorTaskId: predecessorTask.id,
        successorTaskId: successorTask.id,
        type: 'start-finish',
      });
      expect(() => executeMindMapCommand(document, invalidLag)).toThrow(CommandValidationError);
    }
    for (const [index, lagMinutes] of [Number.NaN, Number.POSITIVE_INFINITY].entries()) {
      const nonFiniteLag = rawCommand(document, sheetId, {
        id: id<'TaskDependency'>(50 + index) as TaskDependencyId,
        lagMinutes,
        predecessorTaskId: predecessorTask.id,
        successorTaskId: successorTask.id,
        type: 'start-finish',
      });
      expect(() => executeMindMapCommand(document, nonFiniteLag))
        .toThrow(CommandValidationError);
    }
    expect(() => executeMindMapCommand(document, cycle, { readOnly: true }))
      .toThrow(ReadOnlyCommandError);
  });

  it('rejects cross-Sheet endpoints and globally duplicate dependency IDs', () => {
    const { document, existingDependency, predecessorTask, sheet, sheetId } = setup();
    const secondSheetId = id<'Sheet'>(100) as SheetId;
    const secondRootId = id<'Topic'>(101) as TopicId;
    const secondTaskId = id<'Task'>(102) as TaskId;
    const secondFloatingId = id<'Topic'>(104) as TopicId;
    const secondFloatingTaskId = id<'Task'>(105) as TaskId;
    const second = createMindMapSheet({
      id: secondSheetId,
      orderKey: 'z',
      rootTopicId: secondRootId,
      themeId: sheet.themeId,
      title: 'Second Sheet',
    });
    second.tasks[secondTaskId] = {
      id: secondTaskId,
      progress: 0,
      status: 'not-started',
      topicId: secondRootId,
    };
    second.topics[secondFloatingId] = createTopic({
      id: secondFloatingId,
      placement: { mode: 'absolute', x: 240, y: 0 },
      role: 'floating-root',
      title: 'Second floating Task',
    });
    second.tasks[secondFloatingTaskId] = {
      id: secondFloatingTaskId,
      progress: 0,
      status: 'not-started',
      topicId: secondFloatingId,
    };
    document.sheets[secondSheetId] = second;
    expect(validateMindMapDocument(document).valid).toBe(true);

    expect(() => planUpsertTopicTaskDependencyCommand({
      direction: 'successor',
      document,
      otherTaskId: secondTaskId,
      sheetId,
      topicId: predecessorTask.topicId,
      type: 'finish-start',
    })).toThrow(/当前 Sheet/);

    const crossSheetEndpoint = rawCommand(document, sheetId, {
      id: id<'TaskDependency'>(103) as TaskDependencyId,
      predecessorTaskId: predecessorTask.id,
      successorTaskId: secondTaskId,
      type: 'finish-start',
    });
    expect(() => executeMindMapCommand(document, crossSheetEndpoint))
      .toThrow(/must belong to the current Sheet/);

    const duplicateId = rawCommand(document, sheetId, {
      id: existingDependency.id,
      predecessorTaskId: predecessorTask.id,
      successorTaskId: Object.values(sheet.tasks)
        .find((task) => task.id !== predecessorTask.id)!.id,
      type: 'finish-finish',
    });
    delete sheet.taskDependencies[existingDependency.id];
    second.taskDependencies[existingDependency.id] = {
      id: existingDependency.id,
      predecessorTaskId: secondTaskId,
      successorTaskId: secondFloatingTaskId,
      type: 'finish-start',
    };
    expect(validateMindMapDocument(document).valid).toBe(true);
    expect(() => executeMindMapCommand(document, duplicateId))
      .toThrow(/already exists in another Sheet/);
  });
});
