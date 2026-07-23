import { MindMapAttributeBridge, type MindMapAttributeWrite } from '../bridge';
import {
  executeMindMapCommand,
  PatchCommandHistory,
  ReadOnlyCommandError,
  type MindMapCommand,
  type PatchHistoryOptions,
} from '../commands';
import {
  validateMindMapDocument,
  type MindMapDocumentV1,
  type MindMapParseResult,
  type ValidationIssue,
} from '../domain';

export interface MindMapContentStoreOptions {
  readonly readOnly?: boolean;
  readonly debounceMs?: number;
  readonly history?: PatchHistoryOptions;
}

export class MindMapCommandPostconditionError extends Error {
  readonly issues: readonly ValidationIssue[];

  constructor(issues: readonly ValidationIssue[]) {
    super('Mind map command violated a schema or domain postcondition.');
    this.name = 'MindMapCommandPostconditionError';
    this.issues = issues;
  }
}

export type MindMapContentListener = () => void;

const SELF_EMISSION_TTL_MS = 2_000;
const MAX_RECENT_SELF_EMISSIONS = 32;

export class MindMapContentStore {
  private readonly bridge: MindMapAttributeBridge;
  private readonly history: PatchCommandHistory;
  private readonly listeners = new Set<MindMapContentListener>();
  private explicitlyReadOnly: boolean;
  private currentDocument: MindMapDocumentV1 | null;
  private currentParseResult: MindMapParseResult;
  private readonly recentSelfEmissions = new Map<string, number>();

  constructor(
    rawAttribute: unknown,
    onAttributeWrite: (write: MindMapAttributeWrite) => void,
    options: MindMapContentStoreOptions = {},
  ) {
    this.explicitlyReadOnly = options.readOnly ?? false;
    this.history = new PatchCommandHistory(options.history);
    this.bridge = new MindMapAttributeBridge(
      rawAttribute,
      (write) => {
        this.rememberSelfEmission(write.data);
        onAttributeWrite(write);
      },
      { debounceMs: options.debounceMs, readOnly: this.explicitlyReadOnly },
    );
    this.currentParseResult = this.bridge.result;
    this.currentDocument = this.bridge.document;
  }

  getSnapshot = (): MindMapDocumentV1 | null => this.currentDocument;

  get parseResult(): MindMapParseResult {
    return this.currentParseResult;
  }

  get readOnly(): boolean {
    return this.explicitlyReadOnly || this.bridge.readOnly;
  }

  setReadOnly(readOnly: boolean): void {
    if (readOnly && !this.explicitlyReadOnly) this.bridge.flush();
    this.explicitlyReadOnly = readOnly;
    this.bridge.setReadOnly(readOnly);
  }

  get canUndo(): boolean {
    return this.history.canUndo;
  }

  get canRedo(): boolean {
    return this.history.canRedo;
  }

  get historyByteSize(): number {
    return this.history.byteSize;
  }

  subscribe = (listener: MindMapContentListener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  dispatch(command: MindMapCommand): MindMapDocumentV1 {
    if (this.readOnly || !this.currentDocument) throw new ReadOnlyCommandError();
    const execution = executeMindMapCommand(this.currentDocument, command);
    this.assertPostconditions(execution.document);

    this.history.record(execution.applied);
    this.currentDocument = execution.document;
    this.bridge.scheduleContentCommit(
      execution.document,
      command.groupId ?? command.commandId,
    );
    this.emit();
    return execution.document;
  }

  undo(): MindMapDocumentV1 | undefined {
    if (this.readOnly || !this.currentDocument) throw new ReadOnlyCommandError();
    const transition = this.history.undo(this.currentDocument);
    if (!transition) return undefined;
    this.assertPostconditions(transition.document);
    this.currentDocument = transition.document;
    this.bridge.scheduleHistoryCommit(
      transition.document,
      `history:undo:${transition.entry.commands[0]?.commandId ?? transition.entry.afterRevision}`,
    );
    // History transitions must reach the host before a following mode change or
    // gesture can expose an older attribute value. Content edits remain
    // debounced; undo/redo are explicit state boundaries and persist eagerly.
    this.bridge.flush();
    this.emit();
    return transition.document;
  }

  redo(): MindMapDocumentV1 | undefined {
    if (this.readOnly || !this.currentDocument) throw new ReadOnlyCommandError();
    const transition = this.history.redo(this.currentDocument);
    if (!transition) return undefined;
    this.assertPostconditions(transition.document);
    this.currentDocument = transition.document;
    this.bridge.scheduleHistoryCommit(
      transition.document,
      `history:redo:${transition.entry.commands[0]?.commandId ?? transition.entry.beforeRevision}`,
    );
    this.bridge.flush();
    this.emit();
    return transition.document;
  }

  replaceFromExternal(rawAttribute: unknown): MindMapParseResult {
    if (typeof rawAttribute === 'string' && this.isRecentSelfEmission(rawAttribute)) {
      return this.currentParseResult;
    }

    this.recentSelfEmissions.clear();
    this.currentParseResult = this.bridge.replaceFromExternal(rawAttribute);
    this.currentDocument = this.bridge.document;
    this.history.clear();
    this.emit();
    return this.currentParseResult;
  }

  flush(): void {
    this.bridge.flush();
  }

  dispose(options: { flush?: boolean } = {}): void {
    this.bridge.dispose(options);
    this.listeners.clear();
  }

  private assertPostconditions(document: MindMapDocumentV1): void {
    const validation = validateMindMapDocument(document);
    if (!validation.valid) throw new MindMapCommandPostconditionError(validation.issues);
  }

  private rememberSelfEmission(data: string): void {
    const now = Date.now();
    this.pruneExpiredSelfEmissions(now);
    this.recentSelfEmissions.delete(data);
    this.recentSelfEmissions.set(data, now + SELF_EMISSION_TTL_MS);

    while (this.recentSelfEmissions.size > MAX_RECENT_SELF_EMISSIONS) {
      const oldest = this.recentSelfEmissions.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.recentSelfEmissions.delete(oldest);
    }
  }

  private isRecentSelfEmission(data: string): boolean {
    const now = Date.now();
    this.pruneExpiredSelfEmissions(now);
    return (this.recentSelfEmissions.get(data) ?? 0) > now;
  }

  private pruneExpiredSelfEmissions(now: number): void {
    for (const [data, expiresAt] of this.recentSelfEmissions) {
      if (expiresAt <= now) this.recentSelfEmissions.delete(data);
    }
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
