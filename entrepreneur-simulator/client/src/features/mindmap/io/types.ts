import type {
  ExtensionBag,
  MindMapDocumentV1,
  SheetId,
  TopicId,
} from '../domain/types';

export type MindMapOutlineFormat =
  | 'markdown-outline'
  | 'opml-2.0'
  | 'xmind-content-json';

export interface NormalizedOutlineNode {
  readonly title: string;
  readonly children: readonly NormalizedOutlineNode[];
  readonly extensions?: Readonly<ExtensionBag>;
  readonly sourceTopicId?: TopicId;
}

export interface NormalizedOutlineSheet {
  readonly title: string;
  readonly roots: readonly NormalizedOutlineNode[];
  readonly extensions?: Readonly<ExtensionBag>;
  readonly sourceSheetId?: SheetId;
}

export interface NormalizedOutlineDocument {
  readonly title: string;
  readonly sheets: readonly NormalizedOutlineSheet[];
  readonly extensions?: Readonly<ExtensionBag>;
}

export type MindMapImportEntityKind =
  | 'document'
  | 'sheet'
  | 'topic'
  | 'tree-edge'
  | 'theme'
  | 'relationship'
  | 'relationship-control-point'
  | 'boundary'
  | 'summary'
  | 'marker-group'
  | 'marker-definition'
  | 'marker-instance'
  | 'note'
  | 'link'
  | 'asset'
  | 'image'
  | 'todo';

export type MindMapImportIdFactory = (
  kind: MindMapImportEntityKind,
) => string;

export interface MindMapImportLimits {
  readonly maxDepth: number;
  readonly maxInputBytes: number;
  readonly maxNodes: number;
  readonly maxTitleLength: number;
}

export interface MindMapImportOptions {
  readonly idFactory?: MindMapImportIdFactory;
  readonly limits?: Partial<MindMapImportLimits>;
  readonly locale?: string;
}

export type MindMapImportDiagnosticDisposition =
  | 'degraded'
  | 'ignored'
  | 'preserved'
  | 'rejected';

export type MindMapImportDiagnosticSeverity = 'error' | 'info' | 'warning';

export interface MindMapImportDiagnostic {
  readonly code: string;
  readonly disposition: MindMapImportDiagnosticDisposition;
  readonly message: string;
  readonly path?: string;
  readonly severity: MindMapImportDiagnosticSeverity;
}

export interface MindMapImportReport {
  readonly degradedItems: number;
  readonly diagnostics: readonly MindMapImportDiagnostic[];
  readonly format: MindMapOutlineFormat;
  readonly ignoredItems: number;
  readonly importedSheets: number;
  readonly importedTopics: number;
  readonly inputBytes: number;
  readonly preservedAttributes: number;
  readonly success: boolean;
}

export interface MindMapImportResult {
  readonly document: MindMapDocumentV1 | null;
  readonly report: MindMapImportReport;
}

export interface OpmlExtensionAttribute {
  readonly name: string;
  readonly value: string;
}

export const OPML_ATTRIBUTES_EXTENSION_KEY = 'io.opml.attributes' as const;
export const OPML_NAMESPACES_EXTENSION_KEY = 'io.opml.namespaces' as const;
export const OPML_ROOT_ATTRIBUTES_EXTENSION_KEY = 'io.opml.root-attributes' as const;
