import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNewMindMapDocument } from '../domain/defaults';
import type { Id, MindMapDocumentV1 } from '../domain/types';
import {
  MindMapAttributeBridge,
  MindMapBridgeReadOnlyError,
  MindMapRevisionError,
  type MindMapAttributeWrite,
} from './attributeBridge';

const asId = <K extends string>(value: string): Id<K> => value as Id<K>;

const createDocument = (contentRevision = 0): MindMapDocumentV1 =>
  createNewMindMapDocument({
    documentId: asId<'Document'>('018f0000-0000-7000-8000-000000000001'),
    sheetId: asId<'Sheet'>('018f0000-0000-7000-8000-000000000002'),
    rootTopicId: asId<'Topic'>('018f0000-0000-7000-8000-000000000003'),
    themeId: asId<'Theme'>('018f0000-0000-7000-8000-000000000004'),
    sheetOrderKey: 'a0',
    contentRevision,
  });

const nextRevision = (source: MindMapDocumentV1, revision: number): MindMapDocumentV1 => ({
  ...source,
  contentRevision: revision,
  title: `Revision ${revision}`,
});

describe('MindMapAttributeBridge', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('coalesces one command group into one canonical attribute write', () => {
    const writes: MindMapAttributeWrite[] = [];
    const initial = createDocument();
    const bridge = new MindMapAttributeBridge(initial, (write) => writes.push(write));

    bridge.scheduleContentCommit(nextRevision(initial, 1), 'typing-1');
    bridge.scheduleContentCommit(nextRevision(initial, 2), 'typing-1');
    vi.advanceTimersByTime(249);
    expect(writes).toEqual([]);
    vi.advanceTimersByTime(1);

    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ groupId: 'typing-1', contentRevision: 2 });
    expect(JSON.parse(writes[0].data)).toMatchObject({ contentRevision: 2, title: 'Revision 2' });
  });

  it('does not merge distinct command groups across the debounce window', () => {
    const writes: MindMapAttributeWrite[] = [];
    const initial = createDocument();
    const bridge = new MindMapAttributeBridge(initial, (write) => writes.push(write));

    bridge.scheduleContentCommit(nextRevision(initial, 1), 'command-a');
    bridge.scheduleContentCommit(nextRevision(initial, 2), 'command-b');
    expect(writes.map((write) => write.groupId)).toEqual(['command-a']);
    vi.runAllTimers();
    expect(writes.map((write) => write.groupId)).toEqual(['command-a', 'command-b']);
  });

  it('rejects non-increasing revisions and read-only loads', () => {
    const initial = createDocument();
    const bridge = new MindMapAttributeBridge(initial, () => undefined);
    expect(() => bridge.scheduleContentCommit(nextRevision(initial, 0), 'same'))
      .toThrow(MindMapRevisionError);

    const readOnly = new MindMapAttributeBridge(initial, () => undefined, { readOnly: true });
    expect(() => readOnly.scheduleContentCommit(nextRevision(initial, 1), 'blocked'))
      .toThrow(MindMapBridgeReadOnlyError);
  });

  it('lets an external Tiptap undo replace state and cancel pending writes', () => {
    const writes: MindMapAttributeWrite[] = [];
    const initial = createDocument();
    const bridge = new MindMapAttributeBridge(initial, (write) => writes.push(write));
    bridge.scheduleContentCommit(nextRevision(initial, 1), 'pending');

    const replacement = nextRevision(initial, 4);
    const result = bridge.replaceFromExternal(replacement);
    vi.runAllTimers();

    expect(result.ok).toBe(true);
    expect(bridge.document?.contentRevision).toBe(4);
    expect(writes).toEqual([]);
  });

  it('allows explicit history transitions to restore an older canonical revision', () => {
    const writes: MindMapAttributeWrite[] = [];
    const initial = createDocument();
    const bridge = new MindMapAttributeBridge(initial, (write) => writes.push(write));
    const changed = nextRevision(initial, 1);
    bridge.scheduleContentCommit(changed, 'change');
    vi.runAllTimers();

    bridge.scheduleHistoryCommit(initial, 'undo-change');
    vi.runAllTimers();

    expect(writes.map((write) => write.contentRevision)).toEqual([1, 0]);
  });

  it('persists redo even when its payload equals the write immediately before undo', () => {
    const writes: MindMapAttributeWrite[] = [];
    const initial = createDocument();
    const changed = nextRevision(initial, 1);
    const bridge = new MindMapAttributeBridge(initial, (write) => writes.push(write));

    bridge.scheduleContentCommit(changed, 'change');
    bridge.scheduleHistoryCommit(initial, 'undo-change');
    bridge.scheduleHistoryCommit(changed, 'redo-change');
    vi.runAllTimers();

    expect(writes.map((write) => write.contentRevision)).toEqual([1, 0, 1]);
    expect(JSON.parse(writes[writes.length - 1].data)).toMatchObject({
      contentRevision: 1,
      title: 'Revision 1',
    });
  });
});
