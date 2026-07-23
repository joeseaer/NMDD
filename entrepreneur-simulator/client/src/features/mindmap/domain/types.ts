/**
 * Canonical MindMap V1 domain types.
 *
 * Keep this module UI and renderer agnostic. Runtime shape validation belongs to
 * mindmap.schema.json; cross-reference and graph invariants belong to the
 * semantic validator.
 */

export type Id<K extends string> = string & { readonly __id: K };

export type DocumentId = Id<'Document'>;
export type SheetId = Id<'Sheet'>;
export type TopicId = Id<'Topic'>;
export type TreeEdgeId = Id<'TreeEdge'>;
export type RelationshipId = Id<'Relationship'>;
export type ControlPointId = Id<'RelationshipControlPoint'>;
export type BoundaryId = Id<'Boundary'>;
export type SummaryId = Id<'Summary'>;
export type CalloutId = Id<'Callout'>;
export type ZoneId = Id<'Zone'>;
export type StyleId = Id<'Style'>;
export type ThemeId = Id<'Theme'>;
export type ThemeRuleId = Id<'ThemeRule'>;
export type MarkerGroupId = Id<'MarkerGroup'>;
export type MarkerDefinitionId = Id<'MarkerDefinition'>;
export type MarkerInstanceId = Id<'MarkerInstance'>;
export type NoteId = Id<'Note'>;
export type LinkId = Id<'Link'>;
export type AssetId = Id<'Asset'>;
export type AttachmentId = Id<'Attachment'>;
export type ImageId = Id<'Image'>;
export type EquationId = Id<'Equation'>;
export type AudioId = Id<'Audio'>;
export type TodoId = Id<'Todo'>;
export type TaskId = Id<'Task'>;
export type TaskDependencyId = Id<'TaskDependency'>;
export type CalendarExceptionId = Id<'CalendarException'>;
export type PresentationId = Id<'Presentation'>;
export type SlideId = Id<'Slide'>;
export type BuildId = Id<'PresentationBuild'>;
export type SavedViewId = Id<'SavedView'>;
export type CommentThreadId = Id<'CommentThread'>;
export type CommentId = Id<'Comment'>;
export type ActorId = Id<'Actor'>;
export type CommandId = Id<'Command'>;

export type ISODateTime = string;
export type OrderKey = string;
export type ExtensionBag = Record<string, unknown>;

export interface EntityAudit {
  createdAt: ISODateTime;
  createdBy?: ActorId;
  updatedAt: ISODateTime;
  updatedBy?: ActorId;
}

export interface EntityBase<I extends string> {
  id: I;
  audit?: EntityAudit;
  extensions?: ExtensionBag;
}

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export type PartialSize =
  | { width: number; height?: number }
  | { width?: number; height: number };

export interface Rect extends Point, Size {}

/** Same wire shape as Rect; semantic validation enforces width/height >= 100. */
export interface ZoneRect extends Rect {}

export interface Viewport extends Point {
  zoom: number;
}

export type ColorValue =
  | { kind: 'literal'; value: string }
  | { kind: 'token'; token: string };

export type CanvasBackground =
  | { kind: 'solid'; color: ColorValue }
  | { kind: 'gradient'; from: ColorValue; to: ColorValue; angle: number }
  | { kind: 'image'; assetId: AssetId; fit: 'cover' | 'contain' | 'tile' };

export interface CanvasGrid {
  enabled: boolean;
  size: number;
  color: ColorValue;
}

export interface CanvasSpec {
  background: CanvasBackground;
  grid?: CanvasGrid;
}

export type RichMark =
  | { type: 'bold' | 'italic' | 'underline' | 'strike' | 'code' }
  | { type: 'color'; value: string }
  | { type: 'fontFamily'; value: string }
  | { type: 'fontSize'; value: number }
  | {
      type: 'textTransform';
      value: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
    }
  | { type: 'link'; href: string; title?: string };

export type RichInline =
  | { type: 'text'; text: string; marks?: RichMark[] }
  | { type: 'hardBreak' };

export interface Paragraph {
  type: 'paragraph';
  align?: 'left' | 'center' | 'right';
  children: RichInline[];
}

export interface RichListItem {
  type: 'listItem';
  children: Array<Paragraph | RichList>;
}

export interface RichList {
  type: 'bulletList' | 'orderedList';
  start?: number;
  items: RichListItem[];
}

export interface RichText {
  type: 'doc';
  version: 1;
  blocks: Array<Paragraph | RichList>;
}

export type TopicRole = 'central' | 'regular' | 'floating-root' | 'summary-result';

export type CoreStructureId =
  | 'core:mind-map'
  | 'core:logic-chart'
  | 'core:org-chart'
  | 'core:tree-chart'
  | 'core:timeline'
  | 'core:fishbone'
  | 'core:matrix'
  | 'core:brace-map'
  | 'core:tree-table'
  | 'core:grid';

export type ExtensionStructureId = string & {
  readonly __extensionStructureId: true;
};

export type StructureId = CoreStructureId | ExtensionStructureId;

export type LayoutDirection =
  | 'left-to-right'
  | 'right-to-left'
  | 'top-to-bottom'
  | 'bottom-to-top'
  | 'both'
  | 'radial'
  | 'clockwise'
  | 'counterclockwise'
  | 'inherit';

export type ResolvedLayoutDirection = Exclude<LayoutDirection, 'inherit'>;

export interface BranchLayoutSpec {
  structure: StructureId | 'inherit';
  direction: LayoutDirection;
  mode: 'auto' | 'hybrid' | 'manual';
  compact?: boolean;
  balance?: 'none' | 'automatic' | 'locked';
  freePositioning?: boolean;
  justifyTopicAlignment?: boolean;
  spacing?: { sibling: number; level: number };
  variantId?: string;
  options?: Record<string, string | number | boolean>;
}

export type ResolvedBranchLayoutSpec = Omit<
  BranchLayoutSpec,
  'structure' | 'direction'
> & {
  structure: StructureId;
  direction: ResolvedLayoutDirection;
};

export interface AdvancedLayoutSpec {
  flexibleFloatingTopics: boolean;
  allowTopicOverlap: boolean;
}

export type StructureSemantics =
  | {
      kind: 'timeline';
      orientationSource: 'direction';
      offAxisSource: 'variantId';
    }
  | {
      kind: 'matrix';
      columnAxisSource: 'direct-child-topic';
      rowAxisSource: 'topic-label';
      unlabeledPolicy: string;
      multiLabelPolicy: string;
      duplicateLabelPolicy: string;
    };

export interface StructureLayoutDescriptor {
  structure: StructureId;
  allowedDirections: ResolvedLayoutDirection[];
  variantIds: string[];
  optionSchemaId: string;
  semantics?: StructureSemantics;
}

export type TopicPlacement =
  | { mode: 'auto' }
  | { mode: 'offset'; dx: number; dy: number }
  | { mode: 'absolute'; x: number; y: number };

export type TopicWidth =
  | { mode: 'fit' }
  | { mode: 'fixed'; value: number };

export interface NumberingSpec {
  enabled: boolean;
  style:
    | 'decimal'
    | 'roman-lower'
    | 'roman-upper'
    | 'alpha-lower'
    | 'alpha-upper'
    | 'chinese';
  startAt: number;
  prefix?: string;
  suffix?: string;
  separator?: string;
}

export type BranchSide =
  | 'left'
  | 'right'
  | 'top'
  | 'bottom'
  | 'center'
  | 'inherit';

export type StyleScope =
  | 'sheet'
  | 'topic'
  | 'tree-edge'
  | 'relationship'
  | 'boundary'
  | 'summary'
  | 'callout'
  | 'zone'
  | 'marker'
  | 'presentation';

export interface Padding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface TypographyStyle {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  lineHeight?: number;
  letterSpacing?: number;
  color?: ColorValue;
  align?: 'left' | 'center' | 'right';
}

export interface FillStyle {
  color?: ColorValue;
  opacity?: number;
}

export interface BorderStyle {
  color?: ColorValue;
  width?: number;
  dash?: number[];
  radius?: number;
}

export interface ShadowStyle {
  color: ColorValue;
  blur: number;
  x: number;
  y: number;
}

export interface ConnectorStyle {
  color?: ColorValue;
  width?: number;
  dash?: number[];
  shape?: 'straight' | 'curve' | 'elbow' | 'rounded-elbow';
  startCap?: 'butt' | 'round' | 'square' | 'arrow';
  endCap?: 'butt' | 'round' | 'square' | 'arrow';
  taper?: 'none' | 'start' | 'end' | 'both';
  colorMode?: 'single' | 'by-main-branch' | 'palette';
  palette?: ColorValue[];
}

export interface StyleProperties {
  opacity?: number;
  typography?: TypographyStyle;
  fill?: FillStyle;
  border?: BorderStyle;
  shape?: string;
  padding?: Padding;
  minSize?: PartialSize;
  maxSize?: PartialSize;
  shadow?: ShadowStyle;
  connector?: ConnectorStyle;
}

export interface StyleBinding {
  styleId?: StyleId;
  inheritance?: 'default' | 'break';
  overrides?: StyleProperties;
}

export interface Topic extends EntityBase<TopicId> {
  role: TopicRole;
  title: RichText;
  branchLayout?: BranchLayoutSpec;
  childNumbering?: NumberingSpec;
  placement: TopicPlacement;
  sizing: { width: TopicWidth };
  defaultCollapsed: boolean;
  style?: StyleBinding;
  labels?: string[];
}

export interface TreeEdge extends EntityBase<TreeEdgeId> {
  parentTopicId: TopicId;
  childTopicId: TopicId;
  orderKey: OrderKey;
  side: BranchSide;
  slot?: string;
  style?: StyleBinding;
}

export type RelationshipTargetRef =
  | { kind: 'topic'; topicId: TopicId }
  | { kind: 'boundary'; boundaryId: BoundaryId }
  | { kind: 'callout'; calloutId: CalloutId }
  | { kind: 'zone'; zoneId: ZoneId };

export type RelationshipAnchor =
  | 'auto'
  | 'left'
  | 'right'
  | 'top'
  | 'bottom'
  | { xRatio: number; yRatio: number };

export interface RelationshipEndpoint {
  element: RelationshipTargetRef;
  anchor: RelationshipAnchor;
}

export interface RelationshipControlPoint {
  id: ControlPointId;
  orderKey: OrderKey;
  x: number;
  y: number;
}

export type ArrowHead =
  | 'none'
  | 'triangle'
  | 'open-triangle'
  | 'diamond'
  | 'open-diamond'
  | 'circle'
  | 'open-circle'
  | 'square'
  | 'open-square'
  | 'bar'
  | 'double-bar';

export interface Relationship extends EntityBase<RelationshipId> {
  source: RelationshipEndpoint;
  target: RelationshipEndpoint;
  title?: RichText;
  routing: 'straight' | 'curve' | 'orthogonal' | 'manual';
  controlPoints?: Record<ControlPointId, RelationshipControlPoint>;
  startArrow: ArrowHead;
  endArrow: ArrowHead;
  style?: StyleBinding;
}

export type TopicScope =
  | { kind: 'subtree'; rootTopicId: TopicId; depth: 'all' | number }
  | {
      kind: 'sibling-range';
      parentTopicId: TopicId;
      firstEdgeId: TreeEdgeId;
      lastEdgeId: TreeEdgeId;
      includeDescendants: boolean;
    }
  | { kind: 'explicit'; topicIds: TopicId[] };

export interface Boundary extends EntityBase<BoundaryId> {
  scope: TopicScope;
  title?: RichText;
  padding: number;
  style?: StyleBinding;
}

export interface Summary extends EntityBase<SummaryId> {
  scope: TopicScope;
  resultTopicId: TopicId;
  orientation: 'left' | 'right' | 'top' | 'bottom' | 'auto';
  style?: StyleBinding;
}

export type CalloutPlacement =
  | { mode: 'auto'; preferredSide?: BranchSide }
  | { mode: 'offset'; dx: number; dy: number };

export interface Callout extends EntityBase<CalloutId> {
  targetTopicId: TopicId;
  content: RichText;
  placement: CalloutPlacement;
  tail: 'line' | 'triangle' | 'curve';
  style?: StyleBinding;
}

export interface Zone extends EntityBase<ZoneId> {
  rootTopicIds: TopicId[];
  title?: RichText;
  rect: ZoneRect;
  autoResize: boolean;
  lockAspectRatio: boolean;
  collapsed: boolean;
  zOrderKey: OrderKey;
  padding: number;
  style?: StyleBinding;
}

export interface StyleDefinition extends EntityBase<StyleId> {
  name: string;
  scope: StyleScope;
  basedOnStyleId?: StyleId;
  properties: StyleProperties;
}

export interface ThemeRuleSelector {
  scope: StyleScope;
  topicRole?: TopicRole;
  level?: number;
  side?: BranchSide;
  structure?: StructureId;
}

export interface ThemeRule extends EntityBase<ThemeRuleId> {
  orderKey: OrderKey;
  selector: ThemeRuleSelector;
  binding: StyleBinding;
}

export interface MindMapTheme extends EntityBase<ThemeId> {
  name: string;
  tokens: Record<string, string | number>;
  defaultStyles: Partial<Record<StyleScope, StyleBinding>>;
  rules: Record<ThemeRuleId, ThemeRule>;
  defaultBranchLayout?: BranchLayoutSpec;
}

export interface MarkerGroup extends EntityBase<MarkerGroupId> {
  orderKey: OrderKey;
  name: string;
  kind: 'builtin' | 'custom';
  exclusive: boolean;
}

export type MarkerSource =
  | { kind: 'builtin'; key: string }
  | { kind: 'asset'; assetId: AssetId };

export interface MarkerDefinition extends EntityBase<MarkerDefinitionId> {
  groupId: MarkerGroupId;
  orderKey: OrderKey;
  name: string;
  source: MarkerSource;
  semanticValue?: string | number | boolean;
}

export interface MarkerInstance extends EntityBase<MarkerInstanceId> {
  topicId: TopicId;
  markerDefinitionId: MarkerDefinitionId;
  orderKey: OrderKey;
  value?: string | number | boolean;
}

export interface MarkerLegendSpec {
  visible: boolean;
  position: Point;
  title?: string;
  itemOrder?: MarkerDefinitionId[];
  style?: StyleBinding;
}

export interface Note extends EntityBase<NoteId> {
  topicId: TopicId;
  content: RichText;
}

export interface TopicLinkBase extends EntityBase<LinkId> {
  topicId: TopicId;
  orderKey: OrderKey;
  title?: string;
  status: 'active' | 'broken';
}

export type TopicLink =
  | (TopicLinkBase & {
      kind: 'web' | 'email' | 'file' | 'folder';
      href: string;
    })
  | (TopicLinkBase & { kind: 'sheet'; targetSheetId: SheetId })
  | (TopicLinkBase & {
      kind: 'topic';
      targetSheetId: SheetId;
      targetTopicId: TopicId;
    })
  | (TopicLinkBase & {
      kind: 'document-page';
      targetDocumentPage: { documentId: string; pageId: string };
    });

export type AssetSource =
  | { kind: 'embedded'; relativePath: string }
  | { kind: 'managed'; objectKey: string }
  | { kind: 'remote'; url: string; etag?: string };

export interface Asset extends EntityBase<AssetId> {
  fileName: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  source: AssetSource;
  intrinsicSize?: Size;
  durationMs?: number;
}

export interface Attachment extends EntityBase<AttachmentId> {
  topicId: TopicId;
  assetId: AssetId;
  orderKey: OrderKey;
}

export interface TopicImagePlacement {
  side: 'top' | 'bottom' | 'left' | 'right' | 'overlay';
  align: 'start' | 'center' | 'end';
  offset: Point;
}

export interface TopicImage extends EntityBase<ImageId> {
  topicId: TopicId;
  assetId: AssetId;
  orderKey: OrderKey;
  role: 'inline' | 'thumbnail' | 'background' | 'sticker';
  placement: TopicImagePlacement;
  size?: Size;
  crop?: Rect;
  alt?: string;
}

export interface Equation extends EntityBase<EquationId> {
  topicId: TopicId;
  orderKey: OrderKey;
  syntax: 'latex' | 'mathml';
  source: string;
  display: 'inline' | 'block';
  scale: number;
  alt?: string;
}

export interface AudioClip extends EntityBase<AudioId> {
  topicId: TopicId;
  assetId: AssetId;
  orderKey: OrderKey;
  transcript?: RichText;
}

export interface TopicTodo extends EntityBase<TodoId> {
  topicId: TopicId;
  completed: boolean;
  completedAt?: ISODateTime;
}

export type TaskStatus =
  | 'not-started'
  | 'in-progress'
  | 'blocked'
  | 'done'
  | 'cancelled';

export type TaskDisplayField =
  | 'status'
  | 'progress'
  | 'priority'
  | 'assignees'
  | 'start-date'
  | 'due-date'
  | 'duration'
  | 'dependencies'
  | 'creator';

export interface TopicTask extends EntityBase<TaskId> {
  topicId: TopicId;
  status: TaskStatus;
  progress: number;
  priority?: 1 | 2 | 3 | 4 | 5;
  startDate?: string;
  dueDate?: string;
  durationMinutes?: number;
  milestone?: boolean;
  assigneeIds?: ActorId[];
  displayFields?: TaskDisplayField[];
}

export type TaskDependencyType =
  | 'finish-start'
  | 'start-start'
  | 'finish-finish'
  | 'start-finish';

export interface TaskDependency extends EntityBase<TaskDependencyId> {
  predecessorTaskId: TaskId;
  successorTaskId: TaskId;
  type: TaskDependencyType;
  lagMinutes?: number;
}

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface WorkCalendarException
  extends EntityBase<CalendarExceptionId> {
  orderKey: OrderKey;
  title?: string;
  startDate: string;
  endDate?: string;
  type: 'working-day' | 'day-off';
  repeat: 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
}

export interface WorkCalendar {
  timeZone: string;
  weekStartsOn: Weekday;
  workingWeekdays: Weekday[];
  workdayMinutes: number;
  skipNonWorkingDays: boolean;
  exceptions: Record<CalendarExceptionId, WorkCalendarException>;
}

export type PresentationTarget =
  | { kind: 'sheet'; sheetId: SheetId }
  | {
      kind: 'topic';
      sheetId: SheetId;
      topicId: TopicId;
      includeDescendants: boolean;
    }
  | { kind: 'boundary'; sheetId: SheetId; boundaryId: BoundaryId }
  | { kind: 'zone'; sheetId: SheetId; zoneId: ZoneId }
  | { kind: 'frame'; sheetId: SheetId; rect: Rect };

export type PresentationBuildTarget =
  | { kind: 'topic'; topicId: TopicId }
  | { kind: 'relationship'; relationshipId: RelationshipId };

export interface PresentationBuild extends EntityBase<BuildId> {
  orderKey: OrderKey;
  target: PresentationBuildTarget;
  animation: 'appear' | 'fade' | 'draw' | 'emphasize';
}

export interface PresentationCamera {
  padding: number;
  zoom?: number;
}

export interface PresentationTransition {
  type: 'none' | 'fade' | 'pan' | 'zoom';
  durationMs: number;
}

export interface PresentationImageOverride {
  position: { xRatio: number; yRatio: number };
  size?: Size;
  crop?: Rect;
}

export interface PresentationSlide extends EntityBase<SlideId> {
  orderKey: OrderKey;
  title?: string;
  target: PresentationTarget;
  camera?: PresentationCamera;
  transition?: PresentationTransition;
  speakerNotes?: RichText;
  narrationAudioId?: AudioId;
  imageOverrides?: Record<ImageId, PresentationImageOverride>;
  builds: Record<BuildId, PresentationBuild>;
}

export interface PresentationSettings {
  generationMode: 'auto' | 'manual';
  delivery: 'walk-through' | 'drill-down' | 'slide-show';
  layout: 'auto' | 'map-focus' | 'content-card';
  transition: 'none' | 'fade' | 'pan' | 'zoom';
  animationsEnabled: boolean;
  includedTopicIds?: TopicId[];
  excludedTopicIds?: TopicId[];
}

export interface PresentationDeck extends EntityBase<PresentationId> {
  sheetId: SheetId;
  name: string;
  aspectRatio: '16:9' | '4:3' | 'custom';
  customSize?: Size;
  themeId?: ThemeId;
  settings: PresentationSettings;
  slides: Record<SlideId, PresentationSlide>;
}

export type ElementRef =
  | { kind: 'topic'; id: TopicId }
  | { kind: 'relationship'; id: RelationshipId }
  | { kind: 'boundary'; id: BoundaryId }
  | { kind: 'summary'; id: SummaryId }
  | { kind: 'callout'; id: CalloutId }
  | { kind: 'zone'; id: ZoneId };

export type FilterExpression =
  | { op: 'predicate'; kind: string; value: string }
  | { op: 'all' | 'any'; clauses: FilterExpression[] }
  | { op: 'not'; clause: FilterExpression };

export interface SavedView extends EntityBase<SavedViewId> {
  orderKey: OrderKey;
  name: string;
  sheetId: SheetId;
  viewport: Viewport;
  focusedBranchRootId?: TopicId;
  foldOverrides?: Record<TopicId, boolean>;
  selection?: ElementRef[];
  filters?: FilterExpression;
}

export interface ActorSnapshot extends EntityBase<ActorId> {
  displayName: string;
  email?: string;
  avatarAssetId?: AssetId;
  externalRef?: { provider: string; subject: string };
  status: 'active' | 'deactivated';
}

export type CommentAnchor =
  | ElementRef
  | { kind: 'canvas'; sheetId: SheetId; point: Point };

export interface Comment extends EntityBase<CommentId> {
  authorId: ActorId;
  body: RichText;
  replyToId?: CommentId;
}

export interface CommentThread extends EntityBase<CommentThreadId> {
  anchor: CommentAnchor;
  resolved: boolean;
  orphaned: boolean;
  comments: Record<CommentId, Comment>;
}

export interface CollaborationRemote {
  provider: string;
  remoteDocumentId: string;
  serverRevision?: string;
  baseSnapshotHash?: string;
}

export interface CollaborationMetadata {
  mode: 'single-user' | 'server-revision' | 'crdt';
  remote?: CollaborationRemote;
  logicalClock?: Record<ActorId, number>;
  lastCommandId?: CommandId;
  accessPolicyRef?: string;
  commentThreads?: Record<CommentThreadId, CommentThread>;
  extensions?: ExtensionBag;
}

export interface MindMapSheet extends EntityBase<SheetId> {
  orderKey: OrderKey;
  title: string;
  rootTopicId: TopicId;
  themeId: ThemeId;
  defaultSavedViewId?: SavedViewId;
  defaultBranchLayout: ResolvedBranchLayoutSpec;
  advancedLayout: AdvancedLayoutSpec;
  canvas: CanvasSpec;
  workCalendar: WorkCalendar;
  markerLegend: MarkerLegendSpec;
  topics: Record<TopicId, Topic>;
  treeEdges: Record<TreeEdgeId, TreeEdge>;
  relationships: Record<RelationshipId, Relationship>;
  boundaries: Record<BoundaryId, Boundary>;
  summaries: Record<SummaryId, Summary>;
  callouts: Record<CalloutId, Callout>;
  zones: Record<ZoneId, Zone>;
  markerInstances: Record<MarkerInstanceId, MarkerInstance>;
  notes: Record<NoteId, Note>;
  links: Record<LinkId, TopicLink>;
  attachments: Record<AttachmentId, Attachment>;
  images: Record<ImageId, TopicImage>;
  equations: Record<EquationId, Equation>;
  audioClips: Record<AudioId, AudioClip>;
  todos: Record<TodoId, TopicTodo>;
  tasks: Record<TaskId, TopicTask>;
  taskDependencies: Record<TaskDependencyId, TaskDependency>;
}

export interface MindMapDocumentV1 extends EntityBase<DocumentId> {
  schema: 'app.nmdd.mindmap';
  schemaVersion: 1;
  minimumReaderVersion: 1;
  contentRevision: number;
  title: string;
  locale?: string;
  sheets: Record<SheetId, MindMapSheet>;
  assets: Record<AssetId, Asset>;
  styles: Record<StyleId, StyleDefinition>;
  themes: Record<ThemeId, MindMapTheme>;
  markerGroups: Record<MarkerGroupId, MarkerGroup>;
  markerDefinitions: Record<MarkerDefinitionId, MarkerDefinition>;
  presentations: Record<PresentationId, PresentationDeck>;
  savedViews: Record<SavedViewId, SavedView>;
  actors: Record<ActorId, ActorSnapshot>;
  collaboration?: CollaborationMetadata;
}

export interface SheetViewState {
  viewport: Viewport;
  selection: ElementRef[];
  focusedBranchRootId?: TopicId;
  foldOverrides?: Record<TopicId, boolean>;
  panel?: 'none' | 'format' | 'marker' | 'task' | 'outline' | 'search';
  searchQuery?: string;
  filters?: FilterExpression;
}

export interface MindMapViewStateV1 {
  schema: 'app.nmdd.mindmap-view-state';
  schemaVersion: 1;
  documentId: DocumentId;
  userId?: ActorId;
  activeSheetId: SheetId;
  sheets: Partial<Record<SheetId, SheetViewState>>;
  activePresentationId?: PresentationId;
  activeSlideId?: SlideId;
}

export type CommandPrecondition =
  | { kind: 'entity-exists'; id: string }
  | { kind: 'entity-revision'; id: string; revision: number }
  | {
      kind: 'tree-parent-is';
      topicId: TopicId;
      parentTopicId?: TopicId;
    };

export interface CommandEnvelope<TType extends string, TPayload> {
  commandId: CommandId;
  documentId: DocumentId;
  actorId: ActorId;
  issuedAt: ISODateTime;
  type: TType;
  payload: TPayload;
  baseRevision?: number;
  transactionId?: string;
  undoOf?: CommandId;
  preconditions?: CommandPrecondition[];
}

export type ActorMap = Record<ActorId, ActorSnapshot>;
export type SheetMap = Record<SheetId, MindMapSheet>;
export type TopicMap = Record<TopicId, Topic>;
export type TreeEdgeMap = Record<TreeEdgeId, TreeEdge>;
export type RelationshipMap = Record<RelationshipId, Relationship>;
export type RelationshipControlPointMap = Record<
  ControlPointId,
  RelationshipControlPoint
>;
export type BoundaryMap = Record<BoundaryId, Boundary>;
export type SummaryMap = Record<SummaryId, Summary>;
export type CalloutMap = Record<CalloutId, Callout>;
export type ZoneMap = Record<ZoneId, Zone>;
export type StyleDefinitionMap = Record<StyleId, StyleDefinition>;
export type ThemeRuleMap = Record<ThemeRuleId, ThemeRule>;
export type ThemeMap = Record<ThemeId, MindMapTheme>;
export type MarkerGroupMap = Record<MarkerGroupId, MarkerGroup>;
export type MarkerDefinitionMap = Record<MarkerDefinitionId, MarkerDefinition>;
export type MarkerInstanceMap = Record<MarkerInstanceId, MarkerInstance>;
export type NoteMap = Record<NoteId, Note>;
export type TopicLinkMap = Record<LinkId, TopicLink>;
export type AssetMap = Record<AssetId, Asset>;
export type AttachmentMap = Record<AttachmentId, Attachment>;
export type TopicImageMap = Record<ImageId, TopicImage>;
export type EquationMap = Record<EquationId, Equation>;
export type AudioClipMap = Record<AudioId, AudioClip>;
export type TopicTodoMap = Record<TodoId, TopicTodo>;
export type TopicTaskMap = Record<TaskId, TopicTask>;
export type TaskDependencyMap = Record<TaskDependencyId, TaskDependency>;
export type PresentationBuildMap = Record<BuildId, PresentationBuild>;
export type PresentationSlideMap = Record<SlideId, PresentationSlide>;
export type PresentationDeckMap = Record<PresentationId, PresentationDeck>;
export type SavedViewMap = Record<SavedViewId, SavedView>;
export type CommentMap = Record<CommentId, Comment>;
export type CommentThreadMap = Record<CommentThreadId, CommentThread>;
