import { applyPatches, enablePatches, type Patch } from 'immer';

import type { MindMapDocumentV1 } from '../domain/types';
import { HistoryRevisionError } from './errors';
import { measureAppliedCommandBytes } from './engine';
import {
  CORE_MIND_MAP_COMMAND_REGISTRY,
  type MindMapCommandRegistry,
} from './registry';
import type { AppliedMindMapCommand, MindMapCommand } from './types';

enablePatches();

export const DEFAULT_HISTORY_BYTE_BUDGET = 8 * 1024 * 1024;

export interface PatchHistoryEntry {
  commands: MindMapCommand[];
  beforeRevision: number;
  afterRevision: number;
  forwardPatches: Patch[];
  inversePatches: Patch[];
  byteSize: number;
}

export interface PatchHistoryOptions {
  byteBudget?: number;
  registry?: MindMapCommandRegistry;
}

export interface PatchHistoryTransition {
  document: MindMapDocumentV1;
  entry: PatchHistoryEntry;
}

const clonePatches = (patches: readonly Patch[]): Patch[] =>
  patches.map((patch) => ({ ...patch, path: [...patch.path] }));

const measureHistoryEntry = (entry: PatchHistoryEntry): number =>
  measureAppliedCommandBytes({
    command: entry.commands,
    forwardPatches: entry.forwardPatches,
    inversePatches: entry.inversePatches,
  });

const createEntry = (applied: AppliedMindMapCommand): PatchHistoryEntry => {
  const entry: PatchHistoryEntry = {
    commands: [applied.command],
    beforeRevision: applied.beforeRevision,
    afterRevision: applied.afterRevision,
    forwardPatches: clonePatches(applied.forwardPatches),
    inversePatches: clonePatches(applied.inversePatches),
    byteSize: 0,
  };
  entry.byteSize = measureHistoryEntry(entry);
  return entry;
};

const mergeEntries = (
  previous: PatchHistoryEntry,
  next: PatchHistoryEntry,
): PatchHistoryEntry => {
  const entry: PatchHistoryEntry = {
    commands: [...previous.commands, ...next.commands],
    beforeRevision: previous.beforeRevision,
    afterRevision: next.afterRevision,
    forwardPatches: [...previous.forwardPatches, ...next.forwardPatches],
    // Undo must run newest -> oldest.
    inversePatches: [...next.inversePatches, ...previous.inversePatches],
    byteSize: 0,
  };
  entry.byteSize = measureHistoryEntry(entry);
  return entry;
};

export class PatchCommandHistory {
  private readonly futureEntries: PatchHistoryEntry[] = [];
  private readonly pastEntries: PatchHistoryEntry[] = [];
  private totalBytes = 0;
  readonly byteBudget: number;
  readonly registry: MindMapCommandRegistry;

  constructor(options: PatchHistoryOptions = {}) {
    const byteBudget = options.byteBudget ?? DEFAULT_HISTORY_BYTE_BUDGET;
    if (!Number.isSafeInteger(byteBudget) || byteBudget < 0) {
      throw new RangeError('History byteBudget must be a non-negative safe integer.');
    }
    this.byteBudget = byteBudget;
    this.registry = options.registry ?? CORE_MIND_MAP_COMMAND_REGISTRY;
  }

  get canUndo(): boolean {
    return this.pastEntries.length > 0;
  }

  get canRedo(): boolean {
    return this.futureEntries.length > 0;
  }

  get byteSize(): number {
    return this.totalBytes;
  }

  get undoDepth(): number {
    return this.pastEntries.length;
  }

  get redoDepth(): number {
    return this.futureEntries.length;
  }

  get past(): readonly PatchHistoryEntry[] {
    return this.pastEntries;
  }

  get future(): readonly PatchHistoryEntry[] {
    return this.futureEntries;
  }

  record(applied: AppliedMindMapCommand): void {
    for (const entry of this.futureEntries) this.totalBytes -= entry.byteSize;
    this.futureEntries.length = 0;

    const next = createEntry(applied);
    const previous = this.pastEntries[this.pastEntries.length - 1];
    const previousCommand = previous?.commands[previous.commands.length - 1];
    if (
      previous
      && previousCommand
      && previous.afterRevision === next.beforeRevision
      && this.registry.shouldMerge(previousCommand, applied.command)
    ) {
      this.pastEntries.pop();
      this.totalBytes -= previous.byteSize;
      const merged = mergeEntries(previous, next);
      this.pastEntries.push(merged);
      this.totalBytes += merged.byteSize;
    } else {
      this.pastEntries.push(next);
      this.totalBytes += next.byteSize;
    }
    this.enforceBudget();
  }

  undo(document: MindMapDocumentV1): PatchHistoryTransition | undefined {
    const entry = this.pastEntries[this.pastEntries.length - 1];
    if (!entry) return undefined;
    if (document.contentRevision !== entry.afterRevision) {
      throw new HistoryRevisionError(entry.afterRevision, document.contentRevision);
    }
    const nextDocument = applyPatches(document, entry.inversePatches);
    this.pastEntries.pop();
    this.futureEntries.push(entry);
    return { document: nextDocument, entry };
  }

  redo(document: MindMapDocumentV1): PatchHistoryTransition | undefined {
    const entry = this.futureEntries[this.futureEntries.length - 1];
    if (!entry) return undefined;
    if (document.contentRevision !== entry.beforeRevision) {
      throw new HistoryRevisionError(entry.beforeRevision, document.contentRevision);
    }
    const nextDocument = applyPatches(document, entry.forwardPatches);
    this.futureEntries.pop();
    this.pastEntries.push(entry);
    return { document: nextDocument, entry };
  }

  clear(): void {
    this.pastEntries.length = 0;
    this.futureEntries.length = 0;
    this.totalBytes = 0;
  }

  private enforceBudget(): void {
    while (this.totalBytes > this.byteBudget && this.pastEntries.length > 0) {
      const evicted = this.pastEntries.shift();
      if (evicted) this.totalBytes -= evicted.byteSize;
    }
  }
}
