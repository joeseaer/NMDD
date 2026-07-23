import { describe, expect, it } from 'vitest';

import { createMindMapSheet } from '../domain/defaults';
import type {
  ActorId,
  CommandId,
  SheetId,
  TaskId,
  TopicId,
} from '../domain/types';
import { createMindMapElementsFixture } from '../testing/fixtures';
import {
  planDeleteTopicTaskCommand,
  planUpsertTopicTaskCommand,
} from '../ui/enrichmentPlanning';
import { buildTopicEnrichmentsProjection } from '../ui/enrichmentProjection';
import { buildMindMapSearchIndex, searchMindMapIndex } from '../view/search';
import { CommandValidationError, ReadOnlyCommandError } from './errors';
import { executeMindMapCommand } from './engine';
import { PatchCommandHistory } from './history';
import type { UpsertTaskCommand } from './types';

const IDS = {
  actor: '018f0000-0000-7000-8000-000000009920' as ActorId,
  task: '018f0000-0000-7000-8000-000000009921' as TaskId,
  secondSheet: '018f0000-0000-7000-8000-000000009922' as SheetId,
  secondRoot: '018f0000-0000-7000-8000-000000009923' as TopicId,
};

const setup = () => {
  const document = createMindMapElementsFixture();
  document.actors[IDS.actor] = {
    id: IDS.actor,
    displayName: 'Ada Task Owner',
    email: 'ada.task@example.test',
    status: 'active',
  };
  const sheetId = Object.keys(document.sheets)[0] as SheetId;
  const sheet = document.sheets[sheetId];
  const occupied = new Set(Object.values(sheet.tasks).map((task) => task.topicId));
  const topicId = (Object.keys(sheet.topics) as TopicId[])
    .find((candidate) => !occupied.has(candidate))!;
  return { document, sheet, sheetId, topicId };
};

describe('Topic Task commands', () => {
  it('ACC-SEM-028 creates and edits a complete searchable Task with stable identity and undo/redo', () => {
    const { document, sheetId, topicId } = setup();
    const create = planUpsertTopicTaskCommand({
      document,
      sheetId,
      topicId,
      taskId: IDS.task,
      status: 'in-progress',
      progressPercent: 40,
      priority: 2,
      startDate: '2026-07-20',
      dueDate: '2026-07-25',
      durationMinutes: 240,
      milestone: true,
      assigneeIds: [IDS.actor, IDS.actor],
      displayFields: ['status', 'progress', 'priority', 'assignees', 'priority'],
      commandId: 'task-create' as CommandId,
      timestamp: '2026-07-20T00:00:00.000Z',
    });
    expect(create.payload.task).toMatchObject({
      id: IDS.task,
      topicId,
      status: 'in-progress',
      progress: 0.4,
      priority: 2,
      startDate: '2026-07-20',
      dueDate: '2026-07-25',
      durationMinutes: 240,
      milestone: true,
      assigneeIds: [IDS.actor],
      displayFields: ['status', 'progress', 'priority', 'assignees'],
    });

    const execution = executeMindMapCommand(document, create);
    const taskProjection = buildTopicEnrichmentsProjection({
      document: execution.document,
      sheetId,
    }).byTopicId[topicId].tasks[0];
    expect(taskProjection).toMatchObject({ status: 'in-progress', progress: 0.4 });
    expect(taskProjection.assignees).toEqual([{
      id: IDS.actor,
      displayName: 'Ada Task Owner',
      missingActor: false,
    }]);
    const results = searchMindMapIndex(buildMindMapSearchIndex(execution.document), {
      text: 'Ada Task Owner',
      fields: ['task'],
    });
    expect(results.matches.map((match) => match.topicId)).toContain(topicId);
    const progressResults = searchMindMapIndex(buildMindMapSearchIndex(execution.document), {
      text: '40%',
      fields: ['task'],
    });
    expect(progressResults.matches.map((match) => match.topicId)).toContain(topicId);

    const history = new PatchCommandHistory();
    history.record(execution.applied);
    const undone = history.undo(execution.document)!;
    expect(undone.document.sheets[sheetId].tasks[IDS.task]).toBeUndefined();
    expect(history.redo(undone.document)!.document.sheets[sheetId].tasks[IDS.task])
      .toEqual(execution.document.sheets[sheetId].tasks[IDS.task]);

    const edit = planUpsertTopicTaskCommand({
      document: execution.document,
      sheetId,
      topicId,
      status: 'blocked',
      progressPercent: 40,
      priority: 1,
      assigneeIds: [IDS.actor],
      displayFields: ['status', 'progress'],
    });
    expect(edit.payload.task.id).toBe(IDS.task);
    expect(edit.payload.task.progress).toBe(0.4);
    expect(executeMindMapCommand(execution.document, edit).document.sheets[sheetId].tasks[IDS.task])
      .toMatchObject({ status: 'blocked', progress: 0.4, priority: 1 });
  });

  it('ACC-SEM-028 deletes a Task and its dependencies as one undoable command', () => {
    const { document, sheet, sheetId } = setup();
    const task = Object.values(sheet.tasks)[0];
    const dependency = Object.values(sheet.taskDependencies)
      .find((candidate) => candidate.predecessorTaskId === task.id
        || candidate.successorTaskId === task.id)!;
    const remove = planDeleteTopicTaskCommand({
      document,
      sheetId,
      topicId: task.topicId,
      taskId: task.id,
    });
    const execution = executeMindMapCommand(document, remove);
    expect(execution.document.sheets[sheetId].tasks[task.id]).toBeUndefined();
    expect(execution.document.sheets[sheetId].taskDependencies[dependency.id]).toBeUndefined();

    const history = new PatchCommandHistory();
    history.record(execution.applied);
    const restored = history.undo(execution.document)!.document;
    expect(restored.sheets[sheetId].tasks[task.id]).toEqual(task);
    expect(restored.sheets[sheetId].taskDependencies[dependency.id]).toEqual(dependency);
  });

  it('ACC-SEM-028 rejects inconsistent progress, invalid scheduling, unknown actors, duplicate ownership, and read-only writes', () => {
    const { document, sheet, sheetId, topicId } = setup();
    const valid = planUpsertTopicTaskCommand({
      document,
      sheetId,
      topicId,
      taskId: IDS.task,
      status: 'in-progress',
      progressPercent: 25,
      assigneeIds: [IDS.actor],
    });
    expect(() => executeMindMapCommand(document, valid, { readOnly: true }))
      .toThrow(ReadOnlyCommandError);

    const legalStatusProgress = [
      ['not-started', 0],
      ['in-progress', 1],
      ['in-progress', 99],
      ['blocked', 0],
      ['blocked', 75],
      ['cancelled', 0],
      ['cancelled', 99],
      ['done', 100],
    ] as const;
    for (const [status, progressPercent] of legalStatusProgress) {
      const command = planUpsertTopicTaskCommand({
        document,
        sheetId,
        topicId,
        taskId: IDS.task,
        status,
        progressPercent,
      });
      expect(() => executeMindMapCommand(document, command)).not.toThrow();
    }

    const inconsistent: UpsertTaskCommand = {
      ...valid,
      payload: { task: { ...valid.payload.task, status: 'done', progress: 0.99 } },
    };
    expect(() => executeMindMapCommand(document, inconsistent)).toThrow(CommandValidationError);
    const fakeDone: UpsertTaskCommand = {
      ...valid,
      payload: { task: { ...valid.payload.task, status: 'blocked', progress: 1 } },
    };
    expect(() => executeMindMapCommand(document, fakeDone)).toThrow(CommandValidationError);
    const zeroDuration: UpsertTaskCommand = {
      ...valid,
      payload: { task: { ...valid.payload.task, durationMinutes: 0 } },
    };
    expect(() => executeMindMapCommand(document, zeroDuration)).toThrow(CommandValidationError);
    const invalidPriority: UpsertTaskCommand = {
      ...valid,
      payload: {
        task: { ...valid.payload.task, priority: 6 as 1 },
      },
    };
    expect(() => executeMindMapCommand(document, invalidPriority)).toThrow(CommandValidationError);
    const duplicateAssignees: UpsertTaskCommand = {
      ...valid,
      payload: {
        task: { ...valid.payload.task, assigneeIds: [IDS.actor, IDS.actor] },
      },
    };
    expect(() => executeMindMapCommand(document, duplicateAssignees))
      .toThrow(CommandValidationError);
    const unknownActor: UpsertTaskCommand = {
      ...valid,
      payload: {
        task: {
          ...valid.payload.task,
          assigneeIds: ['018f0000-0000-7000-8000-000000009999' as ActorId],
        },
      },
    };
    expect(() => executeMindMapCommand(document, unknownActor)).toThrow(CommandValidationError);
    expect(() => planUpsertTopicTaskCommand({
      document,
      sheetId,
      topicId,
      status: 'in-progress',
      progressPercent: 50,
      startDate: '2026-07-25',
      dueDate: '2026-07-20',
    })).toThrow(/截止日期不能早于开始日期/);
    expect(() => planUpsertTopicTaskCommand({
      document,
      sheetId,
      topicId,
      status: 'not-started',
      progressPercent: 0,
      startDate: '2026-02-30',
    })).toThrow(/不是有效日期/);

    const existingTask = Object.values(sheet.tasks)[0];
    expect(() => planUpsertTopicTaskCommand({
      document,
      sheetId,
      topicId: existingTask.topicId,
      taskId: IDS.task,
      status: 'not-started',
      progressPercent: 0,
    })).toThrow(/每个主题只能有一个任务/);
  });

  it('rejects a Task ID already owned by another Sheet', () => {
    const { document, sheet, sheetId, topicId } = setup();
    const secondSheet = createMindMapSheet({
      id: IDS.secondSheet,
      orderKey: 'z',
      rootTopicId: IDS.secondRoot,
      themeId: sheet.themeId,
      title: 'Second',
    });
    secondSheet.tasks[IDS.task] = {
      id: IDS.task,
      topicId: IDS.secondRoot,
      status: 'not-started',
      progress: 0,
    };
    document.sheets[IDS.secondSheet] = secondSheet;
    const command = planUpsertTopicTaskCommand({
      document,
      sheetId,
      topicId,
      taskId: IDS.task,
      status: 'not-started',
      progressPercent: 0,
    });
    expect(() => executeMindMapCommand(document, command)).toThrow(/another Sheet/);
  });
});
