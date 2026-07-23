import { getAncestors, getDescendants } from '../domain/tree';
import type {
  ElementRef,
  MindMapSheet,
  SheetViewState,
  TopicId,
  Viewport,
} from '../domain/types';

export interface FocusedBranchContext {
  /** Topic selected as the root of “Show Branch Only”. */
  readonly rootTopicId: TopicId;
  /** Root-most to nearest-parent, so renderers can keep an orientation breadcrumb. */
  readonly ancestorTopicIds: readonly TopicId[];
  /** Focus root followed by all of its descendants in deterministic tree order. */
  readonly branchTopicIds: readonly TopicId[];
  /** Ancestors followed by the focused branch; siblings and unrelated roots are absent. */
  readonly visibleTopicIds: readonly TopicId[];
}

export interface BranchFocusRestoreSnapshot {
  readonly selection: readonly ElementRef[];
  readonly viewport: Readonly<Viewport>;
  readonly foldOverrides?: Readonly<Record<TopicId, boolean>>;
}

/**
 * Runtime-only focus session. It deliberately lives outside canonical content and
 * outside command history; the snapshot exists solely to make exit lossless.
 */
export interface BranchFocusSession {
  readonly rootTopicId: TopicId;
  readonly forcedExpandedTopicIds: readonly TopicId[];
  readonly restore: BranchFocusRestoreSnapshot;
}

export interface BranchFocusTransition {
  readonly sheetViewState: SheetViewState;
  readonly session: BranchFocusSession;
  readonly context: FocusedBranchContext;
}

export interface SheetViewRenderOptions {
  readonly focusRootTopicId?: TopicId;
  readonly collapsedTopicIds: readonly TopicId[];
}

const cloneSelection = (selection: readonly ElementRef[]): ElementRef[] =>
  selection.map((reference) => ({ ...reference })) as ElementRef[];

const cloneFoldOverrides = (
  overrides: Readonly<Record<TopicId, boolean>> | undefined,
): Record<TopicId, boolean> | undefined => overrides
  ? { ...overrides }
  : undefined;

const withoutUndefinedFoldOverrides = (
  state: SheetViewState,
  overrides: Record<TopicId, boolean>,
): SheetViewState => {
  if (Object.keys(overrides).length > 0) return { ...state, foldOverrides: overrides };
  const { foldOverrides: _ignored, ...rest } = state;
  return rest;
};

/**
 * Computes the exact focus aperture without reading Relationship or mutating the
 * Sheet. A malformed cycle is bounded by the domain tree helpers' visited sets.
 */
export const projectFocusedBranchContext = (
  sheet: Readonly<MindMapSheet>,
  rootTopicId: TopicId,
): FocusedBranchContext | null => {
  if (!sheet.topics[rootTopicId]) return null;

  const ancestorTopicIds = getAncestors(sheet as MindMapSheet, rootTopicId)
    .map((topic) => topic.id)
    .reverse();
  const branchTopicIds = [
    rootTopicId,
    ...getDescendants(sheet as MindMapSheet, rootTopicId).map((topic) => topic.id),
  ];

  return Object.freeze({
    rootTopicId,
    ancestorTopicIds: Object.freeze(ancestorTopicIds),
    branchTopicIds: Object.freeze(branchTopicIds),
    visibleTopicIds: Object.freeze([...ancestorTopicIds, ...branchTopicIds]),
  });
};

/**
 * Bridges ephemeral Sheet view state into the renderer-neutral projection API.
 * This is the only data root integration needs to spread into
 * `projectMindMapToRenderModel`; no view data is written back to the Sheet.
 */
export const projectSheetViewStateForRender = (
  sheet: Readonly<MindMapSheet>,
  state: Readonly<SheetViewState>,
): SheetViewRenderOptions => {
  const collapsedTopicIds = Object.values(sheet.topics)
    .filter((topic) => state.foldOverrides?.[topic.id] ?? topic.defaultCollapsed)
    .map((topic) => topic.id)
    .sort();
  const focusRootTopicId = state.focusedBranchRootId
    && sheet.topics[state.focusedBranchRootId]
    ? state.focusedBranchRootId
    : undefined;
  return Object.freeze({
    ...(focusRootTopicId ? { focusRootTopicId } : {}),
    collapsedTopicIds: Object.freeze(collapsedTopicIds),
  });
};

const captureRestoreSnapshot = (
  state: Readonly<SheetViewState>,
): BranchFocusRestoreSnapshot => Object.freeze({
  selection: Object.freeze(cloneSelection(state.selection)),
  viewport: Object.freeze({ ...state.viewport }),
  ...(state.foldOverrides
    ? { foldOverrides: Object.freeze({ ...state.foldOverrides }) }
    : {}),
});

/**
 * Enters (or retargets) “Show Branch Only”. Retargeting retains the very first
 * restore point, so one exit always returns to the pre-focus canvas state.
 */
export const enterBranchFocus = (
  sheet: Readonly<MindMapSheet>,
  state: Readonly<SheetViewState>,
  rootTopicId: TopicId,
  currentSession?: Readonly<BranchFocusSession>,
): BranchFocusTransition | null => {
  const context = projectFocusedBranchContext(sheet, rootTopicId);
  if (!context) return null;

  const restore = currentSession?.restore ?? captureRestoreSnapshot(state);
  const overrides = { ...(state.foldOverrides ?? {}) };

  // Remove temporary expansion from the old path before applying the new one.
  // User folds elsewhere in the focused branch remain intact.
  for (const topicId of currentSession?.forcedExpandedTopicIds ?? []) {
    const restored = restore.foldOverrides?.[topicId];
    if (restored === undefined) delete overrides[topicId];
    else overrides[topicId] = restored;
  }

  const forcedExpandedTopicIds = [...context.ancestorTopicIds, rootTopicId];
  for (const topicId of forcedExpandedTopicIds) overrides[topicId] = false;

  const focusedState = withoutUndefinedFoldOverrides({
    ...state,
    focusedBranchRootId: rootTopicId,
    selection: [{ kind: 'topic', id: rootTopicId }],
  }, overrides);
  const session: BranchFocusSession = Object.freeze({
    rootTopicId,
    forcedExpandedTopicIds: Object.freeze(forcedExpandedTopicIds),
    restore,
  });

  return Object.freeze({ sheetViewState: focusedState, session, context });
};

/** Restores selection, viewport and fold state exactly as they were on entry. */
export const exitBranchFocus = (
  state: Readonly<SheetViewState>,
  session: Readonly<BranchFocusSession>,
): SheetViewState => {
  const { focusedBranchRootId: _ignored, foldOverrides: _folds, ...rest } = state;
  const restored: SheetViewState = {
    ...rest,
    selection: cloneSelection(session.restore.selection),
    viewport: { ...session.restore.viewport },
  };
  const foldOverrides = cloneFoldOverrides(session.restore.foldOverrides);
  return foldOverrides ? { ...restored, foldOverrides } : restored;
};

/** Clears focus safely when no in-memory restore session is available. */
export const clearBranchFocus = (state: Readonly<SheetViewState>): SheetViewState => {
  if (!state.focusedBranchRootId) return state as SheetViewState;
  const { focusedBranchRootId: _ignored, ...rest } = state;
  return rest;
};
