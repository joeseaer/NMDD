import type {
  AssetMap,
  AttachmentMap,
  AudioClipMap,
  BoundaryMap,
  CalloutMap,
  DocumentId,
  EquationMap,
  MarkerDefinitionMap,
  MarkerGroupMap,
  MarkerInstanceMap,
  MindMapDocumentV1,
  NoteMap,
  RelationshipMap,
  SheetId,
  StyleDefinitionMap,
  TaskDependencyMap,
  TopicId,
  TopicImageMap,
  TopicLinkMap,
  TopicMap,
  TopicTaskMap,
  TopicTodoMap,
  TreeEdgeMap,
  ZoneMap,
  SummaryMap,
} from '../domain/types';
import type { MindMapJsonLimits } from '../domain/safeJson';

export const MIND_MAP_CLIPBOARD_MIME = 'application/vnd.nmdd.mindmap+json';
export const MIND_MAP_CLIPBOARD_HTML_MIME = 'text/html';
export const MIND_MAP_CLIPBOARD_MARKDOWN_MIME = 'text/markdown';
export const MIND_MAP_CLIPBOARD_TEXT_MIME = 'text/plain';

export const MIND_MAP_CLIPBOARD_SCHEMA = 'app.nmdd.mindmap.clipboard' as const;
export const MIND_MAP_CLIPBOARD_SCHEMA_VERSION = 1 as const;

export type ClipboardEntityType =
  | 'topic'
  | 'tree-edge'
  | 'relationship'
  | 'relationship-control-point'
  | 'boundary'
  | 'summary'
  | 'callout'
  | 'zone'
  | 'style'
  | 'marker-group'
  | 'marker-definition'
  | 'marker-instance'
  | 'note'
  | 'link'
  | 'asset'
  | 'attachment'
  | 'image'
  | 'equation'
  | 'audio-clip'
  | 'todo'
  | 'task'
  | 'task-dependency';

export type ClipboardOmissionReason =
  | 'external-endpoint'
  | 'external-scope'
  | 'external-topic-link'
  | 'sheet-link'
  | 'partial-zone';

export interface ClipboardOmission {
  readonly entityId: string;
  readonly entityType: ClipboardEntityType;
  readonly reason: ClipboardOmissionReason;
}

export interface ClipboardRootHint {
  readonly orderKey: string;
  readonly side: 'left' | 'right' | 'top' | 'bottom' | 'center' | 'inherit';
  readonly slot?: string;
  readonly topicId: TopicId;
}

/**
 * A detached, canonical entity graph. Incoming TreeEdges for rootTopicIds are
 * deliberately absent, so a paste command can attach the roots atomically.
 */
export interface MindMapClipboardFragment {
  readonly assets: AssetMap;
  readonly attachments: AttachmentMap;
  readonly audioClips: AudioClipMap;
  readonly boundaries: BoundaryMap;
  readonly callouts: CalloutMap;
  readonly equations: EquationMap;
  readonly images: TopicImageMap;
  readonly links: TopicLinkMap;
  readonly markerDefinitions: MarkerDefinitionMap;
  readonly markerGroups: MarkerGroupMap;
  readonly markerInstances: MarkerInstanceMap;
  readonly notes: NoteMap;
  readonly relationships: RelationshipMap;
  readonly styles: StyleDefinitionMap;
  readonly summaries: SummaryMap;
  readonly taskDependencies: TaskDependencyMap;
  readonly tasks: TopicTaskMap;
  readonly todos: TopicTodoMap;
  readonly topics: TopicMap;
  readonly treeEdges: TreeEdgeMap;
  readonly zones: ZoneMap;
}

export interface MindMapClipboardEnvelopeV1 {
  readonly fragment: MindMapClipboardFragment;
  readonly report: {
    readonly omissions: readonly ClipboardOmission[];
  };
  readonly rootHints: readonly ClipboardRootHint[];
  readonly rootTopicIds: readonly TopicId[];
  readonly schema: typeof MIND_MAP_CLIPBOARD_SCHEMA;
  readonly schemaVersion: typeof MIND_MAP_CLIPBOARD_SCHEMA_VERSION;
  readonly source: {
    readonly contentRevision: number;
    readonly documentId: DocumentId;
    readonly sheetId: SheetId;
  };
}

export interface EncodeMindMapClipboardInput {
  readonly document: MindMapDocumentV1;
  readonly selectedTopicIds: readonly TopicId[];
  readonly sheetId: SheetId;
}

export interface EncodedMindMapClipboard {
  readonly envelope: MindMapClipboardEnvelopeV1;
  /** Values ready for a future ClipboardItem/DataTransfer adapter. */
  readonly mimeData: Readonly<Record<string, string>>;
}

export interface ClipboardDecodeOptions {
  readonly limits?: Readonly<MindMapJsonLimits>;
}

export type ClipboardDecodeErrorCode =
  | 'clipboard.empty-selection'
  | 'clipboard.id-generation-failed'
  | 'clipboard.invalid-selection'
  | 'clipboard.invalid-envelope'
  | 'clipboard.invalid-reference'
  | 'clipboard.missing-custom-mime'
  | 'clipboard.unsafe-key'
  | 'clipboard.unsafe-url'
  | 'clipboard.unsupported-version';

export class MindMapClipboardError extends Error {
  readonly code: ClipboardDecodeErrorCode;
  readonly details: readonly string[];
  readonly originalError?: unknown;

  constructor(
    code: ClipboardDecodeErrorCode,
    message: string,
    details: readonly string[] = [],
    originalError?: unknown,
  ) {
    super(message);
    this.name = 'MindMapClipboardError';
    this.code = code;
    this.details = details;
    this.originalError = originalError;
  }
}

export type ClipboardIdFactory = (
  entityType: ClipboardEntityType,
  sourceId: string,
) => string;

export interface RemapMindMapClipboardOptions {
  readonly destinationDocumentId: DocumentId;
  readonly destinationSheetId: SheetId;
  /** IDs already present in the destination document. */
  readonly existingIds?: Iterable<string>;
  readonly idFactory?: ClipboardIdFactory;
}

export interface RemappedMindMapClipboardFragment {
  readonly destination: {
    readonly documentId: DocumentId;
    readonly sheetId: SheetId;
  };
  readonly fragment: MindMapClipboardFragment;
  readonly idMap: Readonly<Record<string, string>>;
  readonly rootHints: readonly ClipboardRootHint[];
  readonly rootTopicIds: readonly TopicId[];
}

export interface OutlineProjectionOptions {
  readonly format?: 'markdown' | 'plain';
  readonly indent?: string;
}
