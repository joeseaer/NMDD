import { describe, expect, it } from 'vitest';

import type { SheetId, TodoId, TopicId } from '../domain/types';
import { getChildrenSorted } from '../domain/tree';
import { validateMindMapDocument } from '../domain/validation';
import { createMindMapElementsFixture } from '../testing/fixtures';
import {
  planBatchTopicTodosCommand,
  planDirectChildTodosCompletionCommand,
} from '../ui/enrichmentPlanning';
import { buildTopicEnrichmentsProjection } from '../ui/enrichmentProjection';
import { ReadOnlyCommandError } from './errors';
import { executeMindMapCommand } from './engine';
import { PatchCommandHistory } from './history';

const TODO_IDS = {
  childA: '018f0000-0000-7000-8000-000000009920' as TodoId,
  childB: '018f0000-0000-7000-8000-000000009921' as TodoId,
  grandchild: '018f0000-0000-7000-8000-000000009922' as TodoId,
};

const hierarchy = () => {
  const document = createMindMapElementsFixture();
  const sheetId = Object.keys(document.sheets)[0] as SheetId;
  const sheet = document.sheets[sheetId];
  const rootId = sheet.rootTopicId;
  const directChildren = getChildrenSorted(sheet, rootId);
  const childA = directChildren[0];
  const childB = directChildren[1];
  const grandchild = getChildrenSorted(sheet, childA.id)[0];
  if (!childA || !childB || !grandchild) throw new Error('Fixture hierarchy is incomplete.');
  return { document, sheet, sheetId, rootId, childA, childB, grandchild };
};

describe('ACC-SEM-019 full To-do bulk behavior', () => {
  it('de-duplicates a parent/child mixed selection and makes apply, complete, remove, undo, and redo one transaction each', () => {
    const { document, sheet, sheetId, rootId, childA } = hierarchy();
    sheet.todos = {};
    const tasksBefore = structuredClone(sheet.tasks);

    const apply = planBatchTopicTodosCommand({
      document,
      sheetId,
      topicIds: [rootId, childA.id, childA.id, rootId],
      action: 'apply',
      timestamp: '2026-07-20T06:00:00.000Z',
    });
    expect(apply.payload.upserts).toHaveLength(2);
    expect(new Set(apply.payload.upserts.map((todo) => todo.topicId))).toEqual(
      new Set<TopicId>([rootId, childA.id]),
    );

    const applied = executeMindMapCommand(document, apply);
    expect(applied.document.contentRevision).toBe(document.contentRevision + 1);
    const appliedTodos = Object.values(applied.document.sheets[sheetId].todos);
    expect(appliedTodos).toHaveLength(2);
    const stableIds = new Map(appliedTodos.map((todo) => [todo.topicId, todo.id]));

    const complete = planBatchTopicTodosCommand({
      document: applied.document,
      sheetId,
      topicIds: [childA.id, rootId, childA.id],
      action: 'complete',
      timestamp: '2026-07-20T07:00:00.000Z',
    });
    expect(complete.payload.upserts).toHaveLength(2);
    expect(complete.payload.upserts.every((todo) => todo.completed)).toBe(true);
    expect(complete.payload.upserts.every(
      (todo) => todo.id === stableIds.get(todo.topicId),
    )).toBe(true);
    const completed = executeMindMapCommand(applied.document, complete);

    const history = new PatchCommandHistory();
    history.record(completed.applied);
    expect(history.undoDepth).toBe(1);
    expect(history.past[0].commands).toHaveLength(1);
    const undone = history.undo(completed.document)!;
    expect(undone.document).toEqual(applied.document);
    expect(history.redo(undone.document)!.document).toEqual(completed.document);

    const remove = planBatchTopicTodosCommand({
      document: completed.document,
      sheetId,
      topicIds: [rootId, childA.id, rootId],
      action: 'remove',
    });
    expect(new Set(remove.payload.deleteTodoIds)).toEqual(new Set(stableIds.values()));
    const removed = executeMindMapCommand(completed.document, remove);
    expect(Object.keys(removed.document.sheets[sheetId].todos)).toHaveLength(0);
    expect(removed.document.sheets[sheetId].tasks).toEqual(tasksBefore);
    expect(validateMindMapDocument(removed.document).valid).toBe(true);

    expect(() => executeMindMapCommand(completed.document, remove, { readOnly: true }))
      .toThrow(ReadOnlyCommandError);
    expect(Object.keys(completed.document.sheets[sheetId].todos)).toHaveLength(2);
  });

  it('completes and reopens all existing direct-child To-dos only, with live derived progress and no parent/Task synthesis', () => {
    const { document, sheet, sheetId, rootId, childA, childB, grandchild } = hierarchy();
    sheet.todos = {
      [TODO_IDS.childA]: { id: TODO_IDS.childA, topicId: childA.id, completed: false },
      [TODO_IDS.childB]: { id: TODO_IDS.childB, topicId: childB.id, completed: false },
      [TODO_IDS.grandchild]: {
        id: TODO_IDS.grandchild,
        topicId: grandchild.id,
        completed: false,
      },
    };
    const tasksBefore = structuredClone(sheet.tasks);
    expect(buildTopicEnrichmentsProjection({ document, sheetId }).byTopicId[rootId]
      .childTodoProgress).toMatchObject({ completedCount: 0, totalCount: 2, progress: 0 });

    const completeChildren = planDirectChildTodosCompletionCommand({
      document,
      sheetId,
      parentTopicId: rootId,
      completed: true,
      timestamp: '2026-07-20T08:00:00.000Z',
    });
    expect(new Set(completeChildren.payload.upserts.map((todo) => todo.topicId))).toEqual(
      new Set<TopicId>([childA.id, childB.id]),
    );
    expect(completeChildren.payload.upserts.map((todo) => todo.id)).toEqual([
      TODO_IDS.childA,
      TODO_IDS.childB,
    ]);

    const completed = executeMindMapCommand(document, completeChildren);
    const completedSheet = completed.document.sheets[sheetId];
    expect(completedSheet.todos[TODO_IDS.childA]).toMatchObject({
      completed: true,
      completedAt: '2026-07-20T08:00:00.000Z',
    });
    expect(completedSheet.todos[TODO_IDS.childB]).toMatchObject({ completed: true });
    expect(completedSheet.todos[TODO_IDS.grandchild]).toEqual(sheet.todos[TODO_IDS.grandchild]);
    expect(Object.values(completedSheet.todos).some((todo) => todo.topicId === rootId)).toBe(false);
    expect(completedSheet.tasks).toEqual(tasksBefore);
    expect(buildTopicEnrichmentsProjection({ document: completed.document, sheetId })
      .byTopicId[rootId].childTodoProgress).toMatchObject({
      completedCount: 2,
      totalCount: 2,
      progress: 1,
    });

    const reopenChildren = planDirectChildTodosCompletionCommand({
      document: completed.document,
      sheetId,
      parentTopicId: rootId,
      completed: false,
    });
    const reopened = executeMindMapCommand(completed.document, reopenChildren).document;
    expect(reopened.sheets[sheetId].todos[TODO_IDS.childA]).toEqual({
      id: TODO_IDS.childA,
      topicId: childA.id,
      completed: false,
    });
    expect(reopened.sheets[sheetId].todos[TODO_IDS.childB]).toEqual({
      id: TODO_IDS.childB,
      topicId: childB.id,
      completed: false,
    });
  });
});
