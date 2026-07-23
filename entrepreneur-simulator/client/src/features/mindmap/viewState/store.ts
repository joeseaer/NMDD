import type {
  ActorId,
  DocumentId,
  ElementRef,
  MindMapSheet,
  MindMapViewStateV1,
  SheetId,
  SheetViewState,
  TopicId,
  Viewport,
} from '../domain/types';
import {
  clearBranchFocus,
  enterBranchFocus as transitionIntoBranchFocus,
  exitBranchFocus as transitionOutOfBranchFocus,
  type BranchFocusSession,
} from './focusBranch';

export type MindMapViewStateListener = () => void;

export interface CreateMindMapViewStateInput {
  documentId: DocumentId;
  activeSheetId: SheetId;
  userId?: ActorId;
}

const DEFAULT_VIEWPORT: Readonly<Viewport> = Object.freeze({ x: 0, y: 0, zoom: 1 });

const createSheetViewState = (): SheetViewState => ({
  viewport: { ...DEFAULT_VIEWPORT },
  selection: [],
});

export const createMindMapViewState = (
  input: CreateMindMapViewStateInput,
): MindMapViewStateV1 => ({
  schema: 'app.nmdd.mindmap-view-state',
  schemaVersion: 1,
  documentId: input.documentId,
  ...(input.userId ? { userId: input.userId } : {}),
  activeSheetId: input.activeSheetId,
  sheets: { [input.activeSheetId]: createSheetViewState() },
});

const elementRefKey = (reference: ElementRef): string => `${reference.kind}:${reference.id}`;

const normalizeSelection = (selection: readonly ElementRef[]): ElementRef[] => {
  const seen = new Set<string>();
  return selection.filter((reference) => {
    const key = elementRefKey(reference);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const sameSelection = (left: readonly ElementRef[], right: readonly ElementRef[]): boolean =>
  left.length === right.length
  && left.every((reference, index) => elementRefKey(reference) === elementRefKey(right[index]));

const assertViewport = (viewport: Viewport): void => {
  if (
    !Number.isFinite(viewport.x)
    || !Number.isFinite(viewport.y)
    || !Number.isFinite(viewport.zoom)
    || viewport.zoom < 0.05
    || viewport.zoom > 8
  ) {
    throw new RangeError('Viewport coordinates must be finite and zoom must be between 0.05 and 8.');
  }
};

export class MindMapViewStateStore {
  private listeners = new Set<MindMapViewStateListener>();
  private branchFocusSessions = new Map<SheetId, BranchFocusSession>();
  private value: MindMapViewStateV1;

  constructor(initialState: MindMapViewStateV1) {
    this.value = initialState;
  }

  getSnapshot = (): MindMapViewStateV1 => this.value;

  subscribe = (listener: MindMapViewStateListener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  replace(state: MindMapViewStateV1): void {
    if (state === this.value) return;
    this.branchFocusSessions.clear();
    this.value = state;
    this.emit();
  }

  setActiveSheet(sheetId: SheetId): void {
    const existing = this.value.sheets[sheetId];
    if (this.value.activeSheetId === sheetId && existing) return;
    this.value = {
      ...this.value,
      activeSheetId: sheetId,
      sheets: existing
        ? this.value.sheets
        : { ...this.value.sheets, [sheetId]: createSheetViewState() },
    };
    this.emit();
  }

  setSelection(sheetId: SheetId, selection: readonly ElementRef[]): void {
    const nextSelection = normalizeSelection(selection);
    const sheet = this.value.sheets[sheetId] ?? createSheetViewState();
    if (sameSelection(sheet.selection, nextSelection)) return;
    this.updateSheet(sheetId, { ...sheet, selection: nextSelection });
  }

  setViewport(sheetId: SheetId, viewport: Viewport): void {
    assertViewport(viewport);
    const sheet = this.value.sheets[sheetId] ?? createSheetViewState();
    if (
      sheet.viewport.x === viewport.x
      && sheet.viewport.y === viewport.y
      && sheet.viewport.zoom === viewport.zoom
    ) return;
    this.updateSheet(sheetId, { ...sheet, viewport: { ...viewport } });
  }

  setFoldOverride(sheetId: SheetId, topicId: TopicId, collapsed?: boolean): void {
    const sheet = this.value.sheets[sheetId] ?? createSheetViewState();
    const current = sheet.foldOverrides?.[topicId];
    if (current === collapsed) return;
    const overrides = { ...(sheet.foldOverrides ?? {}) };
    if (collapsed === undefined) delete overrides[topicId];
    else overrides[topicId] = collapsed;
    this.updateSheet(sheetId, {
      ...sheet,
      ...(Object.keys(overrides).length > 0 ? { foldOverrides: overrides } : { foldOverrides: undefined }),
    });
  }

  setPanel(sheetId: SheetId, panel: SheetViewState['panel']): void {
    const sheet = this.value.sheets[sheetId] ?? createSheetViewState();
    if (sheet.panel === panel) return;
    this.updateSheet(sheetId, { ...sheet, panel });
  }

  /** Returns runtime-only restore metadata; it is never serialized into view state. */
  getBranchFocusSession(sheetId: SheetId): Readonly<BranchFocusSession> | undefined {
    return this.branchFocusSessions.get(sheetId);
  }

  /**
   * Starts or retargets XMind-style “Show Branch Only”. This updates view state
   * once and never dispatches a canonical command.
   */
  focusBranch(
    sheetId: SheetId,
    sheet: Readonly<MindMapSheet>,
    rootTopicId: TopicId,
  ): boolean {
    const current = this.value.sheets[sheetId] ?? createSheetViewState();
    const transition = transitionIntoBranchFocus(
      sheet,
      current,
      rootTopicId,
      this.branchFocusSessions.get(sheetId),
    );
    if (!transition) return false;
    this.branchFocusSessions.set(sheetId, transition.session);
    this.updateSheet(sheetId, transition.sheetViewState);
    return true;
  }

  /** Restores the exact selection, viewport and folds captured on first entry. */
  exitBranchFocus(sheetId: SheetId): boolean {
    const current = this.value.sheets[sheetId];
    if (!current?.focusedBranchRootId) return false;
    const session = this.branchFocusSessions.get(sheetId);
    this.branchFocusSessions.delete(sheetId);
    this.updateSheet(
      sheetId,
      session
        ? transitionOutOfBranchFocus(current, session)
        : clearBranchFocus(current),
    );
    return true;
  }

  private updateSheet(sheetId: SheetId, sheet: SheetViewState): void {
    this.value = {
      ...this.value,
      sheets: { ...this.value.sheets, [sheetId]: sheet },
    };
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
