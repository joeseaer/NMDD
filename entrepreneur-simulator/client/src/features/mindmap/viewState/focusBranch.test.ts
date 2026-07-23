import { describe, expect, it, vi } from 'vitest';

import {
  createNewMindMapDocument,
  createTopic,
} from '../domain/defaults';
import type * as Domain from '../domain/types';
import {
  enterBranchFocus,
  exitBranchFocus,
  projectFocusedBranchContext,
  projectSheetViewStateForRender,
} from './focusBranch';
import { createMindMapViewState, MindMapViewStateStore } from './store';

const id = <K extends string>(counter: number): Domain.Id<K> => (
  `018f7200-0000-7000-8000-${counter.toString(16).padStart(12, '0')}` as Domain.Id<K>
);

const createFixture = () => {
  const documentId = id<'Document'>(1);
  const sheetId = id<'Sheet'>(2);
  const rootId = id<'Topic'>(3);
  const branchId = id<'Topic'>(4);
  const leafId = id<'Topic'>(5);
  const siblingId = id<'Topic'>(6);
  const document = createNewMindMapDocument({
    documentId,
    sheetId,
    rootTopicId: rootId,
    themeId: id<'Theme'>(7),
    sheetOrderKey: 'a',
    sheetTitle: 'Sheet',
    rootTitle: 'Root',
  });
  const sheet = document.sheets[sheetId];
  sheet.topics[branchId] = createTopic({ id: branchId, title: 'Branch' });
  sheet.topics[leafId] = createTopic({ id: leafId, title: 'Leaf' });
  sheet.topics[siblingId] = createTopic({ id: siblingId, title: 'Sibling' });
  sheet.treeEdges[id<'TreeEdge'>(8)] = {
    id: id<'TreeEdge'>(8),
    parentTopicId: rootId,
    childTopicId: branchId,
    orderKey: 'a',
    side: 'right',
  };
  sheet.treeEdges[id<'TreeEdge'>(9)] = {
    id: id<'TreeEdge'>(9),
    parentTopicId: branchId,
    childTopicId: leafId,
    orderKey: 'a',
    side: 'right',
  };
  sheet.treeEdges[id<'TreeEdge'>(10)] = {
    id: id<'TreeEdge'>(10),
    parentTopicId: rootId,
    childTopicId: siblingId,
    orderKey: 'b',
    side: 'right',
  };
  return { document, documentId, sheet, sheetId, rootId, branchId, leafId, siblingId };
};

describe('focused branch view state', () => {
  it('projects the focused subtree with root-most ancestor context and no siblings', () => {
    const fixture = createFixture();
    const context = projectFocusedBranchContext(fixture.sheet, fixture.branchId)!;

    expect(context.ancestorTopicIds).toEqual([fixture.rootId]);
    expect(context.branchTopicIds).toEqual([fixture.branchId, fixture.leafId]);
    expect(context.visibleTopicIds).toEqual([
      fixture.rootId,
      fixture.branchId,
      fixture.leafId,
    ]);
    expect(context.visibleTopicIds).not.toContain(fixture.siblingId);
    expect(Object.isFrozen(context.visibleTopicIds)).toBe(true);
    expect(projectFocusedBranchContext(fixture.sheet, id<'Topic'>(999))).toBeNull();
  });

  it('restores the original selection, viewport and fold overrides exactly on exit', () => {
    const fixture = createFixture();
    const original: Domain.SheetViewState = {
      viewport: { x: -280, y: 96, zoom: 1.4 },
      selection: [{ kind: 'topic', id: fixture.siblingId }],
      foldOverrides: {
        [fixture.rootId]: true,
        [fixture.siblingId]: true,
      } as Record<Domain.TopicId, boolean>,
      panel: 'outline',
    };
    const transition = enterBranchFocus(
      fixture.sheet,
      original,
      fixture.leafId,
    )!;

    expect(transition.sheetViewState).toMatchObject({
      focusedBranchRootId: fixture.leafId,
      selection: [{ kind: 'topic', id: fixture.leafId }],
      foldOverrides: {
        [fixture.rootId]: false,
        [fixture.branchId]: false,
        [fixture.leafId]: false,
        [fixture.siblingId]: true,
      },
    });

    // Viewport/selection/folds may move while focused; exit still uses entry state.
    const changedWhileFocused: Domain.SheetViewState = {
      ...transition.sheetViewState,
      viewport: { x: 10, y: 20, zoom: 2 },
      selection: [{ kind: 'topic', id: fixture.rootId }],
      foldOverrides: {
        ...transition.sheetViewState.foldOverrides,
        [fixture.siblingId]: false,
      },
    };
    expect(exitBranchFocus(changedWhileFocused, transition.session)).toEqual(original);
  });

  it('retargets focus while retaining the first restore point', () => {
    const fixture = createFixture();
    const original: Domain.SheetViewState = {
      viewport: { x: 1, y: 2, zoom: 0.8 },
      selection: [{ kind: 'topic', id: fixture.leafId }],
      foldOverrides: { [fixture.branchId]: true } as Record<Domain.TopicId, boolean>,
    };
    const first = enterBranchFocus(fixture.sheet, original, fixture.leafId)!;
    const second = enterBranchFocus(
      fixture.sheet,
      first.sheetViewState,
      fixture.siblingId,
      first.session,
    )!;

    expect(second.session.restore).toBe(first.session.restore);
    expect(second.sheetViewState.focusedBranchRootId).toBe(fixture.siblingId);
    expect(second.sheetViewState.foldOverrides).toMatchObject({
      [fixture.branchId]: true,
      [fixture.rootId]: false,
      [fixture.siblingId]: false,
    });
    expect(second.sheetViewState.foldOverrides).not.toHaveProperty(fixture.leafId);
    expect(exitBranchFocus(second.sheetViewState, second.session)).toEqual(original);
  });

  it('bridges focus and effective folds into render options without canonical writes', () => {
    const fixture = createFixture();
    fixture.sheet.topics[fixture.branchId].defaultCollapsed = true;
    const before = JSON.stringify(fixture.sheet);
    const options = projectSheetViewStateForRender(fixture.sheet, {
      viewport: { x: 0, y: 0, zoom: 1 },
      selection: [],
      focusedBranchRootId: fixture.branchId,
      foldOverrides: {
        [fixture.branchId]: false,
        [fixture.siblingId]: true,
      } as Record<Domain.TopicId, boolean>,
    });

    expect(options).toEqual({
      focusRootTopicId: fixture.branchId,
      collapsedTopicIds: [fixture.siblingId],
    });
    expect(JSON.stringify(fixture.sheet)).toBe(before);
  });

  it('integrates with the store as one view-only notification per enter/exit', () => {
    const fixture = createFixture();
    const canonicalBefore = JSON.stringify(fixture.document);
    const store = new MindMapViewStateStore(createMindMapViewState({
      documentId: fixture.documentId,
      activeSheetId: fixture.sheetId,
    }));
    const listener = vi.fn();
    store.subscribe(listener);
    store.setSelection(fixture.sheetId, [{ kind: 'topic', id: fixture.siblingId }]);
    store.setViewport(fixture.sheetId, { x: 50, y: -30, zoom: 1.25 });
    listener.mockClear();

    expect(store.focusBranch(fixture.sheetId, fixture.sheet, fixture.branchId)).toBe(true);
    expect(store.getSnapshot().sheets[fixture.sheetId]).toMatchObject({
      focusedBranchRootId: fixture.branchId,
      selection: [{ kind: 'topic', id: fixture.branchId }],
    });
    expect(store.getBranchFocusSession(fixture.sheetId)?.restore).toMatchObject({
      viewport: { x: 50, y: -30, zoom: 1.25 },
      selection: [{ kind: 'topic', id: fixture.siblingId }],
    });
    expect(listener).toHaveBeenCalledTimes(1);

    expect(store.exitBranchFocus(fixture.sheetId)).toBe(true);
    expect(store.getSnapshot().sheets[fixture.sheetId]).toMatchObject({
      viewport: { x: 50, y: -30, zoom: 1.25 },
      selection: [{ kind: 'topic', id: fixture.siblingId }],
    });
    expect(store.getSnapshot().sheets[fixture.sheetId]).not.toHaveProperty('focusedBranchRootId');
    expect(store.getBranchFocusSession(fixture.sheetId)).toBeUndefined();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(store.exitBranchFocus(fixture.sheetId)).toBe(false);
    expect(store.focusBranch(fixture.sheetId, fixture.sheet, id<'Topic'>(999))).toBe(false);
    expect(JSON.stringify(fixture.document)).toBe(canonicalBefore);
  });
});
