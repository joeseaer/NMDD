import { describe, expect, it, vi } from 'vitest';
import {
  createMindMapViewState,
  MindMapViewStateStore,
} from './store';
import type { Id } from '../domain/types';

const asId = <K extends string>(value: string): Id<K> => value as Id<K>;
const documentId = asId<'Document'>('018f0000-0000-7000-8000-000000000001');
const sheetId = asId<'Sheet'>('018f0000-0000-7000-8000-000000000002');
const otherSheetId = asId<'Sheet'>('018f0000-0000-7000-8000-000000000003');
const topicId = asId<'Topic'>('018f0000-0000-7000-8000-000000000004');

describe('MindMapViewStateStore', () => {
  it('keeps selection, viewport and panels outside canonical content', () => {
    const store = new MindMapViewStateStore(createMindMapViewState({ documentId, activeSheetId: sheetId }));
    const listener = vi.fn();
    store.subscribe(listener);

    store.setSelection(sheetId, [
      { kind: 'topic', id: topicId },
      { kind: 'topic', id: topicId },
    ]);
    store.setViewport(sheetId, { x: 20, y: -10, zoom: 1.5 });
    store.setPanel(sheetId, 'format');

    expect(store.getSnapshot().sheets[sheetId]).toMatchObject({
      selection: [{ kind: 'topic', id: topicId }],
      viewport: { x: 20, y: -10, zoom: 1.5 },
      panel: 'format',
    });
    expect(JSON.stringify(store.getSnapshot())).not.toContain('contentRevision');
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('does not notify for normalized no-op updates', () => {
    const store = new MindMapViewStateStore(createMindMapViewState({ documentId, activeSheetId: sheetId }));
    const listener = vi.fn();
    store.subscribe(listener);
    store.setSelection(sheetId, []);
    store.setViewport(sheetId, { x: 0, y: 0, zoom: 1 });
    store.setActiveSheet(sheetId);
    expect(listener).not.toHaveBeenCalled();
  });

  it('creates per-sheet state lazily and keeps fold overrides ephemeral', () => {
    const store = new MindMapViewStateStore(createMindMapViewState({ documentId, activeSheetId: sheetId }));
    store.setActiveSheet(otherSheetId);
    store.setFoldOverride(otherSheetId, topicId, true);
    expect(store.getSnapshot().sheets[otherSheetId]?.foldOverrides?.[topicId]).toBe(true);
    store.setFoldOverride(otherSheetId, topicId, undefined);
    expect(store.getSnapshot().sheets[otherSheetId]?.foldOverrides).toBeUndefined();
  });

  it('rejects unsafe viewport values', () => {
    const store = new MindMapViewStateStore(createMindMapViewState({ documentId, activeSheetId: sheetId }));
    expect(() => store.setViewport(sheetId, { x: 0, y: 0, zoom: Number.NaN })).toThrow(RangeError);
    expect(() => store.setViewport(sheetId, { x: 0, y: 0, zoom: 9 })).toThrow(RangeError);
  });
});

