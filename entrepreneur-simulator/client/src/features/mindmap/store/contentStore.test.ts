import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNewMindMapDocument, createRichText } from '../domain/defaults';
import type { Id, MindMapDocumentV1 } from '../domain/types';
import { MIND_MAP_COMMAND_TYPES, ReadOnlyCommandError } from '../commands';
import { mindMapRichTextToPlainText } from '../view/text';
import { MindMapContentStore } from './contentStore';

const asId = <K extends string>(value: string): Id<K> => value as Id<K>;
const IDS = {
  document: asId<'Document'>('018f0000-0000-7000-8000-000000000001'),
  sheet: asId<'Sheet'>('018f0000-0000-7000-8000-000000000002'),
  root: asId<'Topic'>('018f0000-0000-7000-8000-000000000003'),
  theme: asId<'Theme'>('018f0000-0000-7000-8000-000000000004'),
  command: asId<'Command'>('018f0000-0000-7000-8000-000000000005'),
};

const createDocument = (contentRevision = 0): MindMapDocumentV1 =>
  createNewMindMapDocument({
    documentId: IDS.document,
    sheetId: IDS.sheet,
    rootTopicId: IDS.root,
    themeId: IDS.theme,
    sheetOrderKey: 'a0',
    contentRevision,
    rootTitle: 'Before',
  });

const updateTitleCommand = (baseRevision = 0) => ({
  commandId: IDS.command,
  type: MIND_MAP_COMMAND_TYPES.updateTopicTitle,
  sheetId: IDS.sheet,
  payload: { topicId: IDS.root, title: createRichText('After') },
  baseRevision,
  groupId: 'edit-root',
  origin: 'test',
  timestamp: '2026-07-18T00:00:00.000Z',
} as const);

describe('MindMapContentStore', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('atomically dispatches, validates, records and persists a content command', () => {
    const writes: string[] = [];
    const listener = vi.fn();
    const store = new MindMapContentStore(createDocument(), (write) => writes.push(write.data));
    store.subscribe(listener);

    const next = store.dispatch(updateTitleCommand());
    expect(next.contentRevision).toBe(1);
    expect(store.canUndo).toBe(true);
    expect(listener).toHaveBeenCalledOnce();
    expect(writes).toEqual([]);
    vi.runAllTimers();
    expect(JSON.parse(writes[0])).toMatchObject({ contentRevision: 1 });
  });

  it('undoes and redoes with inverse/forward patches and persistence transitions', () => {
    const revisions: number[] = [];
    const store = new MindMapContentStore(createDocument(), (write) => {
      revisions.push(write.contentRevision);
    });
    store.dispatch(updateTitleCommand());
    vi.runAllTimers();
    expect(store.undo()?.contentRevision).toBe(0);
    vi.runAllTimers();
    expect(store.redo()?.contentRevision).toBe(1);
    vi.runAllTimers();
    expect(revisions).toEqual([1, 0, 1]);
  });

  it('persists explicit history boundaries eagerly before a following mode change', () => {
    const revisions: number[] = [];
    const store = new MindMapContentStore(createDocument(), (write) => {
      revisions.push(write.contentRevision);
    });
    store.dispatch(updateTitleCommand());
    store.flush();

    store.undo();
    expect(revisions).toEqual([1, 0]);
    store.redo();
    expect(revisions).toEqual([1, 0, 1]);
  });

  it('does not clear local history when Tiptap echoes the store own write', () => {
    let emitted = '';
    const store = new MindMapContentStore(createDocument(), (write) => {
      emitted = write.data;
    });
    store.dispatch(updateTitleCommand());
    vi.runAllTimers();
    store.replaceFromExternal(emitted);
    expect(store.canUndo).toBe(true);
  });

  it('ignores delayed out-of-order self echoes without losing the undo/redo state', () => {
    const writes: string[] = [];
    const store = new MindMapContentStore(createDocument(), (write) => {
      writes.push(write.data);
    });

    store.dispatch(updateTitleCommand());
    vi.runAllTimers();
    store.undo();
    store.setReadOnly(true);

    expect(writes).toHaveLength(2);
    expect(JSON.parse(writes[0])).toMatchObject({ contentRevision: 1 });
    expect(JSON.parse(writes[1])).toMatchObject({ contentRevision: 0 });

    store.replaceFromExternal(writes[0]);
    expect(store.getSnapshot()?.contentRevision).toBe(0);
    expect(
      mindMapRichTextToPlainText(
        store.getSnapshot()?.sheets[IDS.sheet]?.topics[IDS.root]?.title,
      ),
    ).toBe('Before');
    expect(store.canRedo).toBe(true);

    store.replaceFromExternal(writes[1]);
    expect(store.getSnapshot()?.contentRevision).toBe(0);
    expect(store.canRedo).toBe(true);

    vi.advanceTimersByTime(2_001);
    store.replaceFromExternal(writes[0]);
    expect(store.getSnapshot()?.contentRevision).toBe(1);
    expect(
      mindMapRichTextToPlainText(
        store.getSnapshot()?.sheets[IDS.sheet]?.topics[IDS.root]?.title,
      ),
    ).toBe('After');
    expect(store.canUndo).toBe(false);
    expect(store.canRedo).toBe(false);
  });

  it('clears history and replaces content for an actual external undo/restore', () => {
    const store = new MindMapContentStore(createDocument(), () => undefined);
    store.dispatch(updateTitleCommand());
    const restored = createDocument(7);
    store.replaceFromExternal(restored);
    expect(store.getSnapshot()?.contentRevision).toBe(7);
    expect(store.canUndo).toBe(false);
  });

  it('rejects content commands for invalid or explicitly read-only loads', () => {
    const invalid = new MindMapContentStore({ hello: 'world' }, () => undefined);
    expect(() => invalid.dispatch(updateTitleCommand())).toThrow(ReadOnlyCommandError);
    const readOnly = new MindMapContentStore(createDocument(), () => undefined, { readOnly: true });
    expect(() => readOnly.dispatch(updateTitleCommand())).toThrow(ReadOnlyCommandError);
  });

  it('toggles read-only mode without replacing local content or history', () => {
    const writes: number[] = [];
    const store = new MindMapContentStore(createDocument(), (write) => {
      writes.push(write.contentRevision);
    });
    store.dispatch(updateTitleCommand());

    store.setReadOnly(true);
    expect(store.getSnapshot()?.contentRevision).toBe(1);
    expect(store.canUndo).toBe(true);
    expect(() => store.undo()).toThrow(ReadOnlyCommandError);
    vi.runAllTimers();
    expect(writes).toEqual([1]);

    store.setReadOnly(false);
    expect(store.undo()?.contentRevision).toBe(0);
  });
});
