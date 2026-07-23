import {
  parseMindMapAttribute,
  serializeMindMapDocument,
} from '../domain/persistence';
import type {
  MindMapParseResult,
  MindMapDocumentV1,
} from '../domain';

export interface MindMapAttributeWrite {
  readonly data: string;
  readonly groupId: string;
  readonly contentRevision: number;
}

export interface MindMapAttributeBridgeOptions {
  readonly debounceMs?: number;
  readonly readOnly?: boolean;
}

export class MindMapBridgeReadOnlyError extends Error {
  constructor() {
    super('The mind map attribute bridge is read-only.');
    this.name = 'MindMapBridgeReadOnlyError';
  }
}

export class MindMapRevisionError extends Error {
  constructor(previousRevision: number, nextRevision: number) {
    super(`Content revision must increase (${previousRevision} -> ${nextRevision}).`);
    this.name = 'MindMapRevisionError';
  }
}

interface PendingWrite extends MindMapAttributeWrite {
  readonly document: MindMapDocumentV1;
}

export class MindMapAttributeBridge {
  private readonly debounceMs: number;
  private readonly onWrite: (write: MindMapAttributeWrite) => void;
  private explicitlyReadOnly: boolean;
  private parseResult: MindMapParseResult;
  private currentDocument: MindMapDocumentV1 | null;
  private pending: PendingWrite | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastWrittenData: string | null = null;

  constructor(
    rawAttribute: unknown,
    onWrite: (write: MindMapAttributeWrite) => void,
    options: MindMapAttributeBridgeOptions = {},
  ) {
    this.onWrite = onWrite;
    this.debounceMs = options.debounceMs ?? 250;
    this.explicitlyReadOnly = options.readOnly ?? false;
    this.parseResult = parseMindMapAttribute(rawAttribute);
    this.currentDocument = this.parseResult.ok ? this.parseResult.document : null;
  }

  get result(): MindMapParseResult {
    return this.parseResult;
  }

  get document(): MindMapDocumentV1 | null {
    return this.currentDocument;
  }

  get readOnly(): boolean {
    return this.explicitlyReadOnly || !this.parseResult.ok || this.parseResult.readOnly;
  }

  setReadOnly(readOnly: boolean): void {
    this.explicitlyReadOnly = readOnly;
  }

  scheduleContentCommit(document: MindMapDocumentV1, groupId: string): void {
    this.schedule(document, groupId, true);
  }

  scheduleHistoryCommit(document: MindMapDocumentV1, groupId: string): void {
    this.schedule(document, groupId, false);
  }

  private schedule(
    document: MindMapDocumentV1,
    groupId: string,
    requireIncreasingRevision: boolean,
  ): void {
    if (this.readOnly) throw new MindMapBridgeReadOnlyError();
    const previousRevision = this.currentDocument?.contentRevision ?? -1;
    if (
      (requireIncreasingRevision && document.contentRevision <= previousRevision)
      || (!requireIncreasingRevision && document.contentRevision === previousRevision)
    ) {
      throw new MindMapRevisionError(previousRevision, document.contentRevision);
    }

    const data = serializeMindMapDocument(document);
    // A different pending history state must be persisted before deduping
    // against the last write. Otherwise create -> undo -> redo can leave the
    // pending undo payload as the final saved value because redo equals the
    // write that preceded undo.
    if (this.pending && this.pending.groupId !== groupId) this.flush();
    if (data === this.lastWrittenData) {
      this.currentDocument = document;
      return;
    }

    this.currentDocument = document;
    this.pending = {
      data,
      document,
      groupId,
      contentRevision: document.contentRevision,
    };
    this.armTimer();
  }

  flush(): void {
    this.clearTimer();
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    if (pending.data === this.lastWrittenData) return;
    this.onWrite({
      data: pending.data,
      groupId: pending.groupId,
      contentRevision: pending.contentRevision,
    });
    this.lastWrittenData = pending.data;
  }

  replaceFromExternal(rawAttribute: unknown): MindMapParseResult {
    this.clearTimer();
    this.pending = null;
    this.parseResult = parseMindMapAttribute(rawAttribute);
    this.currentDocument = this.parseResult.ok ? this.parseResult.document : null;
    this.lastWrittenData = this.parseResult.ok
      ? serializeMindMapDocument(this.parseResult.document)
      : null;
    return this.parseResult;
  }

  dispose(options: { flush?: boolean } = {}): void {
    if (options.flush) this.flush();
    else {
      this.clearTimer();
      this.pending = null;
    }
  }

  private armTimer(): void {
    this.clearTimer();
    this.timer = setTimeout(() => this.flush(), this.debounceMs);
  }

  private clearTimer(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }
}
