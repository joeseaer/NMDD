import type {
  ActorId,
  DocumentId,
  MarkerDefinitionId,
  SheetId,
  TopicId,
} from '../domain/types';

export type MindMapSearchField =
  | 'topic'
  | 'note'
  | 'label'
  | 'marker'
  | 'todo'
  | 'task';

export const MIND_MAP_SEARCH_FIELDS: readonly MindMapSearchField[] = Object.freeze([
  'topic',
  'note',
  'label',
  'marker',
  'todo',
  'task',
]);

export type MindMapSearchScope =
  | { readonly kind: 'all-sheets' }
  | { readonly kind: 'sheet'; readonly sheetId: SheetId }
  | {
      readonly kind: 'branch';
      readonly sheetId: SheetId;
      readonly rootTopicId: TopicId;
    };

export interface MindMapSearchQuery {
  readonly text: string;
  readonly caseSensitive?: boolean;
  readonly wholeWord?: boolean;
  readonly fields?: readonly MindMapSearchField[];
  readonly scope?: MindMapSearchScope;
}

export interface MindMapSearchIndexedValue {
  readonly field: MindMapSearchField;
  readonly text: string;
  readonly sourceId?: string;
  readonly attribute?: string;
}

export interface MindMapSearchIndexEntry {
  readonly key: string;
  readonly ordinal: number;
  readonly sheetId: SheetId;
  readonly sheetTitle: string;
  readonly topicId: TopicId;
  readonly topicTitle: string;
  readonly parentTopicId?: TopicId;
  /** Ordered from the Sheet root (or defensive tree root) to the direct parent. */
  readonly ancestorTopicIds: readonly TopicId[];
  readonly depth: number;
  readonly values: readonly MindMapSearchIndexedValue[];
}

export interface MindMapSearchIndex {
  readonly version: 'mindmap-search-index@2026-07-19';
  readonly documentId: DocumentId;
  readonly contentRevision: number;
  readonly entries: readonly MindMapSearchIndexEntry[];
  readonly entryByTopicKey: Readonly<Record<string, MindMapSearchIndexEntry>>;
}

export interface MindMapSearchTopicRef {
  readonly sheetId: SheetId;
  readonly topicId: TopicId;
}

/**
 * Callers provide the canonical entities affected by a content transaction.
 * Tree/order or Sheet-wide changes belong in `sheets`; a missing change set
 * intentionally falls back to a complete rebuild.
 */
export interface MindMapSearchIndexChanges {
  readonly topics?: readonly MindMapSearchTopicRef[];
  readonly sheets?: readonly SheetId[];
  readonly markerDefinitions?: readonly MarkerDefinitionId[];
  readonly actors?: readonly ActorId[];
}

export interface MindMapSearchTextRange {
  readonly start: number;
  readonly end: number;
}

export interface MindMapSearchFieldMatch extends MindMapSearchIndexedValue {
  readonly ranges: readonly MindMapSearchTextRange[];
}

export interface MindMapSearchMatch {
  readonly key: string;
  readonly ordinal: number;
  readonly sheetId: SheetId;
  readonly sheetTitle: string;
  readonly topicId: TopicId;
  readonly topicTitle: string;
  readonly fields: readonly MindMapSearchFieldMatch[];
}

export interface MindMapSearchResultSet {
  readonly query: MindMapSearchQuery;
  readonly active: boolean;
  readonly matches: readonly MindMapSearchMatch[];
  readonly total: number;
}

export interface MindMapSearchCursor {
  readonly sheetId: SheetId;
  readonly topicId: TopicId;
}

export type MindMapSearchNavigationDirection = 'next' | 'previous';

export type MindMapSearchFilterMode = 'hide' | 'dim';

export interface MindMapSearchFilterSheetProjection {
  readonly sheetId: SheetId;
  readonly allTopicIds: readonly TopicId[];
  readonly matchedTopicIds: readonly TopicId[];
  readonly contextTopicIds: readonly TopicId[];
  /** Matches plus their ancestors, in deterministic outline order. */
  readonly includedTopicIds: readonly TopicId[];
  readonly hiddenTopicIds: readonly TopicId[];
  readonly dimmedTopicIds: readonly TopicId[];
}

export interface MindMapSearchFilterProjection {
  readonly active: boolean;
  readonly mode: MindMapSearchFilterMode;
  readonly sheets: Readonly<Partial<Record<SheetId, MindMapSearchFilterSheetProjection>>>;
}

export interface MindMapOutlinerViewState {
  /** UI-only Sheet disclosure state; never persisted into MindMapDocument. */
  readonly collapsedSheetIds?: readonly SheetId[];
  /** UI-only topic disclosure overrides layered over Topic.defaultCollapsed. */
  readonly foldOverrides?: Readonly<
    Partial<Record<SheetId, Readonly<Partial<Record<TopicId, boolean>>>>>
  >;
}

export interface MindMapOutlinerBranchFocus {
  readonly sheetId: SheetId;
  readonly rootTopicId: TopicId;
}

export type MindMapOutlinerMatchState =
  | 'normal'
  | 'match'
  | 'context'
  | 'dimmed';

export interface MindMapOutlinerTopicNode {
  readonly kind: 'topic';
  readonly sheetId: SheetId;
  readonly topicId: TopicId;
  readonly parentTopicId?: TopicId;
  readonly title: string;
  readonly depth: number;
  readonly collapsed: boolean;
  readonly hasChildren: boolean;
  readonly matchState: MindMapOutlinerMatchState;
  readonly children: readonly MindMapOutlinerTopicNode[];
}

export interface MindMapOutlinerTopicRow
  extends Omit<MindMapOutlinerTopicNode, 'children' | 'kind'> {
  readonly kind: 'topic';
  /** Includes the Sheet row, so a Sheet root topic begins at level 1. */
  readonly rowDepth: number;
}

export interface MindMapOutlinerSheetRow {
  readonly kind: 'sheet';
  readonly sheetId: SheetId;
  readonly title: string;
  readonly collapsed: boolean;
  readonly rowDepth: 0;
}

export type MindMapOutlinerRow =
  | MindMapOutlinerSheetRow
  | MindMapOutlinerTopicRow;

export interface MindMapOutlinerSheetProjection {
  readonly sheetId: SheetId;
  readonly title: string;
  readonly collapsed: boolean;
  readonly topicCount: number;
  readonly visibleTopicCount: number;
  readonly roots: readonly MindMapOutlinerTopicNode[];
  readonly rows: readonly MindMapOutlinerRow[];
}

export interface MindMapOutlinerProjection {
  readonly sheets: readonly MindMapOutlinerSheetProjection[];
  readonly rows: readonly MindMapOutlinerRow[];
}
