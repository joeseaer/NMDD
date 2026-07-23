import { describe, expect, it } from 'vitest';

import { createRichText } from '../domain/defaults';
import type {
  CommandId,
  LinkId,
  NoteId,
  RichText,
  SheetId,
  TodoId,
  TopicId,
} from '../domain/types';
import { createMindMapElementsFixture } from '../testing/fixtures';
import { mindMapRichTextToPlainText } from '../view/text';
import {
  normalizeExternalTopicLink,
  planDeleteTopicLinkCommand,
  planDeleteTopicNoteCommand,
  planDeleteTopicTodoCommand,
  planUpdateTopicLabelsCommand,
  planUpsertExternalTopicLinkCommand,
  planUpsertTopicNoteCommand,
  planUpsertTopicTodoCommand,
} from '../ui/enrichmentPlanning';
import { CommandValidationError, ReadOnlyCommandError } from './errors';
import { executeMindMapCommand } from './engine';
import { PatchCommandHistory } from './history';
import {
  MIND_MAP_COMMAND_TYPES,
  type UpsertLinkCommand as LinkCommand,
  type UpsertTodoCommand,
} from './types';

const setup = () => {
  const document = createMindMapElementsFixture();
  const sheetId = Object.keys(document.sheets)[0] as SheetId;
  const sheet = document.sheets[sheetId];
  const topicIds = Object.keys(sheet.topics) as TopicId[];
  const note = Object.values(sheet.notes)[0];
  const linked = Object.values(sheet.links)[0];
  const topicWithoutNote = topicIds.find((topicId) => topicId !== note.topicId)!;
  const topicWithoutLink = topicIds.find((topicId) => topicId !== linked.topicId)!;
  const todoTopicIds = new Set(Object.values(sheet.todos).map((todo) => todo.topicId));
  const topicWithoutTodo = topicIds.find((topicId) => !todoTopicIds.has(topicId))!;
  return {
    document,
    sheet,
    sheetId,
    note,
    linked,
    topicWithoutNote,
    topicWithoutLink,
    topicWithoutTodo,
  };
};

describe('topic enrichment commands', () => {
  it('ACC-SEM-015 updates normalized labels as one undoable content command', () => {
    const { document, sheetId, topicWithoutNote } = setup();
    const command = planUpdateTopicLabelsCommand({
      document,
      sheetId,
      topicId: topicWithoutNote,
      labels: [' 产品 ', '发布', '产品'],
      commandId: 'enrichment-labels' as CommandId,
      timestamp: '2026-07-20T00:00:00.000Z',
    });
    expect(command.payload.labels).toEqual(['产品', '发布']);

    const execution = executeMindMapCommand(document, command);
    expect(execution.document.sheets[sheetId].topics[topicWithoutNote].labels)
      .toEqual(['产品', '发布']);

    const history = new PatchCommandHistory();
    history.record(execution.applied);
    const undone = history.undo(execution.document)!;
    expect(undone.document).toEqual(document);
    expect(history.redo(undone.document)!.document).toEqual(execution.document);
  });

  it('ACC-SEM-015 creates, replaces, and deletes the single rich-text Note without losing lists', () => {
    const { document, sheetId, topicWithoutNote } = setup();
    const content: RichText = {
      type: 'doc',
      version: 1,
      blocks: [{
        type: 'bulletList',
        items: [{
          type: 'listItem',
          children: [
            { type: 'paragraph', children: [{ type: 'text', text: '一级' }] },
            {
              type: 'orderedList',
              items: [{
                type: 'listItem',
                children: [{ type: 'paragraph', children: [{ type: 'text', text: '二级' }] }],
              }],
            },
          ],
        }],
      }],
    };
    const create = planUpsertTopicNoteCommand({
      document,
      sheetId,
      topicId: topicWithoutNote,
      content,
      noteId: '018f0000-0000-7000-8000-000000009901' as NoteId,
    });
    const created = executeMindMapCommand(document, create).document;
    const note = Object.values(created.sheets[sheetId].notes)
      .find((candidate) => candidate.topicId === topicWithoutNote)!;
    expect(note.content).toEqual(content);

    const update = planUpsertTopicNoteCommand({
      document: created,
      sheetId,
      topicId: topicWithoutNote,
      content: createRichText('更新后的笔记'),
    });
    expect(update.payload.note.id).toBe(note.id);
    const updated = executeMindMapCommand(created, update).document;
    expect(mindMapRichTextToPlainText(updated.sheets[sheetId].notes[note.id].content))
      .toBe('更新后的笔记');

    const remove = planDeleteTopicNoteCommand({
      document: updated,
      sheetId,
      topicId: topicWithoutNote,
    });
    const removed = executeMindMapCommand(updated, remove).document;
    expect(removed.sheets[sheetId].notes[note.id]).toBeUndefined();
  });

  it('ACC-KBD-022 and ACC-SEM-016 normalize safe external Links and reject dangerous schemes', () => {
    expect(normalizeExternalTopicLink('example.com/docs')).toMatchObject({
      kind: 'web',
      href: 'https://example.com/docs',
    });
    expect(normalizeExternalTopicLink('owner@example.com')).toEqual({
      kind: 'email',
      href: 'mailto:owner@example.com',
    });
    expect(() => normalizeExternalTopicLink('javascript:alert(1)')).toThrow(/仅支持/);
    expect(() => normalizeExternalTopicLink('data:text/html,bad')).toThrow(/仅支持/);
  });

  it('ACC-SEM-016 creates, edits, deletes, and restores a Link with stable identity and order', () => {
    const { document, sheetId, topicWithoutLink } = setup();
    const create = planUpsertExternalTopicLinkCommand({
      document,
      sheetId,
      topicId: topicWithoutLink,
      href: 'https://example.org/path',
      title: '参考资料',
      linkId: '018f0000-0000-7000-8000-000000009902' as LinkId,
    });
    const execution = executeMindMapCommand(document, create);
    const created = execution.document.sheets[sheetId].links[create.payload.link.id];
    expect(created).toMatchObject({ kind: 'web', title: '参考资料', status: 'active' });

    const edit = planUpsertExternalTopicLinkCommand({
      document: execution.document,
      sheetId,
      topicId: topicWithoutLink,
      href: 'mail@example.org',
      title: '联系作者',
      linkId: created.id,
    });
    expect(edit.payload.link.id).toBe(created.id);
    expect(edit.payload.link.orderKey).toBe(created.orderKey);
    const edited = executeMindMapCommand(execution.document, edit).document;
    expect(edited.sheets[sheetId].links[created.id]).toMatchObject({
      kind: 'email',
      href: 'mailto:mail@example.org',
    });

    const remove = planDeleteTopicLinkCommand({
      document: edited,
      sheetId,
      topicId: topicWithoutLink,
      linkId: created.id,
    });
    expect(executeMindMapCommand(edited, remove).document.sheets[sheetId].links[created.id])
      .toBeUndefined();
  });

  it('ACC-SEM-016 rejects unsafe command payloads again at the reducer boundary', () => {
    const { document, sheetId, topicWithoutLink } = setup();
    const unsafe: LinkCommand = {
      commandId: 'unsafe-link' as CommandId,
      type: MIND_MAP_COMMAND_TYPES.upsertLink,
      sheetId,
      baseRevision: document.contentRevision,
      origin: 'test',
      timestamp: '2026-07-20T00:00:00.000Z',
      payload: {
        link: {
          id: '018f0000-0000-7000-8000-000000009903' as LinkId,
          topicId: topicWithoutLink,
          orderKey: 'unsafe-link-order',
          kind: 'web',
          href: 'javascript:alert(1)',
          status: 'active',
        },
      },
    };
    expect(() => executeMindMapCommand(document, unsafe)).toThrow(CommandValidationError);
    expect(() => executeMindMapCommand(document, unsafe, { readOnly: true }))
      .toThrow(ReadOnlyCommandError);
  });

  it('ACC-SEM-019 creates, completes, reopens, deletes, and restores one lightweight To-do', () => {
    const { document, sheetId, topicWithoutTodo } = setup();
    const todoId = '018f0000-0000-7000-8000-000000009904' as TodoId;
    const create = planUpsertTopicTodoCommand({
      document,
      sheetId,
      topicId: topicWithoutTodo,
      todoId,
      completed: false,
      timestamp: '2026-07-20T01:00:00.000Z',
    });
    const createdExecution = executeMindMapCommand(document, create);
    expect(createdExecution.document.sheets[sheetId].todos[todoId]).toEqual({
      id: todoId,
      topicId: topicWithoutTodo,
      completed: false,
    });

    const complete = planUpsertTopicTodoCommand({
      document: createdExecution.document,
      sheetId,
      topicId: topicWithoutTodo,
      completed: true,
      timestamp: '2026-07-20T02:00:00.000Z',
    });
    expect(complete.payload.todo.id).toBe(todoId);
    const completedExecution = executeMindMapCommand(createdExecution.document, complete);
    expect(completedExecution.document.sheets[sheetId].todos[todoId]).toMatchObject({
      completed: true,
      completedAt: '2026-07-20T02:00:00.000Z',
    });

    const history = new PatchCommandHistory();
    history.record(completedExecution.applied);
    const undone = history.undo(completedExecution.document)!;
    expect(undone.document.sheets[sheetId].todos[todoId]).toEqual(
      createdExecution.document.sheets[sheetId].todos[todoId],
    );
    expect(history.redo(undone.document)!.document.sheets[sheetId].todos[todoId])
      .toEqual(completedExecution.document.sheets[sheetId].todos[todoId]);

    const reopen = planUpsertTopicTodoCommand({
      document: completedExecution.document,
      sheetId,
      topicId: topicWithoutTodo,
      completed: false,
    });
    const reopened = executeMindMapCommand(completedExecution.document, reopen).document;
    expect(reopened.sheets[sheetId].todos[todoId]).toEqual({
      id: todoId,
      topicId: topicWithoutTodo,
      completed: false,
    });

    const remove = planDeleteTopicTodoCommand({
      document: reopened,
      sheetId,
      topicId: topicWithoutTodo,
    });
    expect(executeMindMapCommand(reopened, remove).document.sheets[sheetId].todos[todoId])
      .toBeUndefined();
  });

  it('ACC-SEM-019 rejects invalid or duplicate To-dos at the command boundary and in read-only mode', () => {
    const { document, sheetId, topicWithoutTodo } = setup();
    const valid = planUpsertTopicTodoCommand({
      document,
      sheetId,
      topicId: topicWithoutTodo,
      todoId: '018f0000-0000-7000-8000-000000009905' as TodoId,
      completed: false,
    });
    expect(() => executeMindMapCommand(document, valid, { readOnly: true }))
      .toThrow(ReadOnlyCommandError);

    const invalid: UpsertTodoCommand = {
      ...valid,
      payload: {
        todo: {
          ...valid.payload.todo,
          completedAt: '2026-07-20T03:00:00.000Z',
        },
      },
    };
    expect(() => executeMindMapCommand(document, invalid)).toThrow(CommandValidationError);

    const created = executeMindMapCommand(document, valid).document;
    const duplicate = planUpsertTopicTodoCommand({
      document: created,
      sheetId,
      topicId: topicWithoutTodo,
      completed: true,
    });
    const duplicateIdCommand: UpsertTodoCommand = {
      ...duplicate,
      payload: {
        todo: {
          ...duplicate.payload.todo,
          id: '018f0000-0000-7000-8000-000000009906' as TodoId,
        },
      },
    };
    expect(() => executeMindMapCommand(created, duplicateIdCommand))
      .toThrow(CommandValidationError);
  });
});
