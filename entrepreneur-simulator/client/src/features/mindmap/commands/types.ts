import type { Patch } from 'immer';

import type { MindMapClipboardFragment } from '../clipboard/types';
import type {
  Asset,
  AssetId,
  Attachment,
  AudioClip,
  Boundary,
  BoundaryId,
  BranchSide,
  Callout,
  CalloutId,
  CommandId,
  Equation,
  ISODateTime,
  ImageId,
  MindMapDocumentV1,
  MindMapSheet,
  LinkId,
  MarkerDefinition,
  MarkerDefinitionId,
  MarkerGroup,
  MarkerGroupId,
  MarkerInstance,
  MarkerInstanceId,
  Note,
  NoteId,
  OrderKey,
  Point,
  AdvancedLayoutSpec,
  ResolvedBranchLayoutSpec,
  Relationship,
  RelationshipId,
  RichText,
  SheetId,
  Summary,
  SummaryId,
  StyleBinding,
  Topic,
  TopicId,
  TopicLink,
  TopicImage,
  TopicTask,
  TopicScope,
  TaskDependency,
  TaskDependencyId,
  TopicTodo,
  TaskId,
  TodoId,
  TreeEdge,
  TreeEdgeId,
  Zone,
  ZoneId,
} from '../domain/types';

/**
 * Stable command names. View-only interactions intentionally do not appear here.
 */
export const MIND_MAP_COMMAND_TYPES = {
  replaceImportedDocument: 'document.replace-imported',
  pasteClipboardFragment: 'clipboard.paste-fragment',
  createTopic: 'topic.create',
  insertParentTopic: 'topic.insert-parent',
  updateTopicTitle: 'topic.update-title',
  updateTopicLabels: 'topic.update-labels',
  reparentTopic: 'topic.reparent',
  reorderTopic: 'topic.reorder',
  deleteCurrentTopic: 'topic.delete-current',
  deleteTopicSubtree: 'topic.delete-subtree',
  toggleTopicCollapse: 'topic.toggle-collapse',
  updateStyleBindings: 'style.update-bindings',
  createRelationship: 'relationship.create',
  updateRelationship: 'relationship.update',
  deleteRelationship: 'relationship.delete',
  createBoundary: 'boundary.create',
  updateBoundary: 'boundary.update',
  deleteBoundary: 'boundary.delete',
  createSummary: 'summary.create',
  updateSummary: 'summary.update',
  deleteSummary: 'summary.delete',
  createCallout: 'callout.create',
  updateCallout: 'callout.update',
  deleteCallout: 'callout.delete',
  updateZone: 'zone.update',
  createImage: 'image.create',
  updateImage: 'image.update',
  deleteImage: 'image.delete',
  createMarkerGroup: 'marker-group.create',
  renameMarkerGroup: 'marker-group.rename',
  reorderMarkerGroup: 'marker-group.reorder',
  deleteMarkerGroup: 'marker-group.delete',
  createMarkerDefinition: 'marker-definition.create',
  updateMarkerDefinition: 'marker-definition.update',
  reorderMarkerDefinition: 'marker-definition.reorder',
  deleteMarkerDefinition: 'marker-definition.delete',
  attachMarker: 'marker.attach',
  updateMarker: 'marker.update',
  detachMarker: 'marker.detach',
  patchMarkerLegend: 'marker-legend.patch',
  moveMarkerLegend: 'marker-legend.move',
  reorderMarkerLegendItems: 'marker-legend.reorder-items',
  upsertNote: 'note.upsert',
  deleteNote: 'note.delete',
  upsertLink: 'link.upsert',
  deleteLink: 'link.delete',
  upsertTodo: 'todo.upsert',
  deleteTodo: 'todo.delete',
  batchUpdateTodos: 'todo.batch-update',
  upsertTask: 'task.upsert',
  deleteTask: 'task.delete',
  upsertTaskDependency: 'task-dependency.upsert',
  deleteTaskDependency: 'task-dependency.delete',
  createSheet: 'sheet.create',
  renameSheet: 'sheet.rename',
  reorderSheet: 'sheet.reorder',
  updateSheetLayout: 'sheet.update-layout',
  deleteSheet: 'sheet.delete',
} as const;

export type MindMapCommandType =
  (typeof MIND_MAP_COMMAND_TYPES)[keyof typeof MIND_MAP_COMMAND_TYPES];

/**
 * Origin is diagnostic metadata, not reducer input. Keeping it open allows an
 * embedding editor to use its own stable origin vocabulary.
 */
export type MindMapCommandOrigin = string;

export interface MindMapCommandEnvelope<
  TType extends MindMapCommandType,
  TPayload,
> {
  commandId: CommandId;
  type: TType;
  sheetId: SheetId;
  payload: TPayload;
  baseRevision: number;
  groupId?: string;
  origin: MindMapCommandOrigin;
  timestamp: ISODateTime;
}

export interface CreateTopicPayload {
  topic: Topic;
  /** Omit only for a floating root. All IDs and the order key are planner-owned. */
  edge?: TreeEdge;
}

/**
 * A complete, already parsed canonical document. The reducer deliberately
 * ignores its contentRevision; only the command engine may advance revision.
 */
export interface ReplaceImportedDocumentPayload {
  candidate: MindMapDocumentV1;
}

export type ReplaceImportedDocumentCommand = MindMapCommandEnvelope<
  typeof MIND_MAP_COMMAND_TYPES.replaceImportedDocument,
  ReplaceImportedDocumentPayload
>;

/**
 * A complete remapped canonical fragment plus the destination-owned tree
 * edges that attach its detached roots. Keeping this as one command prevents
 * intermediate dangling references and makes one paste exactly one undo unit.
 */
export interface PasteClipboardFragmentPayload {
  fragment: MindMapClipboardFragment;
  rootTopicIds: TopicId[];
  attachmentEdges: TreeEdge[];
}

export type PasteClipboardFragmentCommand = MindMapCommandEnvelope<
  typeof MIND_MAP_COMMAND_TYPES.pasteClipboardFragment,
  PasteClipboardFragmentPayload
>;

export type CreateTopicCommand = MindMapCommandEnvelope<
  typeof MIND_MAP_COMMAND_TYPES.createTopic,
  CreateTopicPayload
>;

/**
 * Inserts one regular topic between an existing regular topic and its unique
 * structural parent. The reducer reuses (and only retargets) the existing
 * incoming edge, so its ID, sibling order, side, slot, style and references
 * remain stable. The planner owns the new topic and child-edge IDs.
 */
export interface InsertParentTopicPayload {
  topicId: TopicId;
  parentTopic: Topic;
  childEdge: TreeEdge;
}

export type InsertParentTopicCommand = MindMapCommandEnvelope<
  typeof MIND_MAP_COMMAND_TYPES.insertParentTopic,
  InsertParentTopicPayload
>;

export interface UpdateTopicTitlePayload {
  topicId: TopicId;
  title: RichText;
}

export type UpdateTopicTitleCommand = MindMapCommandEnvelope<
  typeof MIND_MAP_COMMAND_TYPES.updateTopicTitle,
  UpdateTopicTitlePayload
>;

export interface UpdateTopicLabelsPayload {
  topicId: TopicId;
  labels: string[];
}

export type UpdateTopicLabelsCommand = MindMapCommandEnvelope<
  typeof MIND_MAP_COMMAND_TYPES.updateTopicLabels,
  UpdateTopicLabelsPayload
>;

export interface ReparentTopicPayload {
  topicId: TopicId;
  /**
   * Complete replacement incoming edge. This makes floating-root -> branch
   * moves deterministic and keeps ID/orderKey generation outside the reducer.
   */
  edge: TreeEdge;
  /** Planner-owned Boundary normalization against the post-move tree. */
  boundaryScopeChanges?: BoundaryScopeChange[];
  /** Planner-owned Summary normalization against the same post-move tree. */
  summaryScopeChanges?: SummaryScopeChange[];
}

export type ReparentTopicCommand = MindMapCommandEnvelope<
  typeof MIND_MAP_COMMAND_TYPES.reparentTopic,
  ReparentTopicPayload
>;

export interface ReorderTopicPayload {
  topicId: TopicId;
  orderKey: OrderKey;
  side?: BranchSide;
  /** null clears the slot; undefined preserves it. */
  slot?: string | null;
  /** Planner-owned Boundary normalization against the post-order/side tree. */
  boundaryScopeChanges?: BoundaryScopeChange[];
  summaryScopeChanges?: SummaryScopeChange[];
}

export type ReorderTopicCommand = MindMapCommandEnvelope<
  typeof MIND_MAP_COMMAND_TYPES.reorderTopic,
  ReorderTopicPayload
>;

export interface TreeEdgeOrderUpdate {
  edgeId: TreeEdgeId;
  orderKey: OrderKey;
}

/**
 * Deletes exactly one regular topic while keeping its structural descendants.
 * Direct child edges are promoted to the deleted topic's parent. Replacement
 * edges and any sibling-key rebalance are planner-owned, making replay fully
 * deterministic and the whole operation one undo unit.
 */
export interface DeleteCurrentTopicPayload {
  topicId: TopicId;
  promotedEdges: TreeEdge[];
  siblingOrderUpdates: TreeEdgeOrderUpdate[];
  /** Planner-owned Boundary normalization; split IDs are never reducer-created. */
  boundaryScopeChanges?: BoundaryScopeChange[];
  summaryScopeChanges?: SummaryScopeChange[];
}

export type DeleteCurrentTopicCommand = MindMapCommandEnvelope<
  typeof MIND_MAP_COMMAND_TYPES.deleteCurrentTopic,
  DeleteCurrentTopicPayload
>;

export interface DeleteTopicSubtreePayload {
  topicId: TopicId;
  /** Planner-owned Boundary normalization after removing the complete subtree. */
  boundaryScopeChanges?: BoundaryScopeChange[];
  summaryScopeChanges?: SummaryScopeChange[];
}

export type DeleteTopicSubtreeCommand = MindMapCommandEnvelope<
  typeof MIND_MAP_COMMAND_TYPES.deleteTopicSubtree,
  DeleteTopicSubtreePayload
>;

export interface ToggleTopicCollapsePayload {
  topicId: TopicId;
  /** Omit to invert the current canonical default. */
  collapsed?: boolean;
}

export type ToggleTopicCollapseCommand = MindMapCommandEnvelope<
  typeof MIND_MAP_COMMAND_TYPES.toggleTopicCollapse,
  ToggleTopicCollapsePayload
>;

/** Canonical entities that own an element-level StyleBinding. */
export type StyleBindingTarget =
  | { scope: 'topic'; id: TopicId }
  | { scope: 'tree-edge'; id: TreeEdgeId }
  | { scope: 'relationship'; id: RelationshipId }
  | { scope: 'boundary'; id: BoundaryId }
  | { scope: 'summary'; id: SummaryId }
  | { scope: 'callout'; id: CalloutId }
  | { scope: 'zone'; id: ZoneId };

export interface StyleBindingReplacement {
  target: StyleBindingTarget;
  /** null removes the entity binding and restores the Theme/Skeleton cascade. */
  binding: StyleBinding | null;
}

/**
 * Complete binding replacements are planner-owned. A single command may update
 * heterogeneous selections atomically without asking the reducer to interpret
 * UI-level mixed values or reset sentinels.
 */
export interface UpdateStyleBindingsPayload {
  replacements: StyleBindingReplacement[];
}

export type UpdateStyleBindingsCommand = MindMapCommandEnvelope<
  typeof MIND_MAP_COMMAND_TYPES.updateStyleBindings,
  UpdateStyleBindingsPayload
>;

export interface CreateRelationshipPayload {
  relationship: Relationship;
}

export type CreateRelationshipCommand = MindMapCommandEnvelope<
  typeof MIND_MAP_COMMAND_TYPES.createRelationship,
  CreateRelationshipPayload
>;

/** Full canonical replacement; the entity ID is immutable. */
export interface UpdateRelationshipPayload {
  relationship: Relationship;
}

export type UpdateRelationshipCommand = MindMapCommandEnvelope<
  typeof MIND_MAP_COMMAND_TYPES.updateRelationship,
  UpdateRelationshipPayload
>;

export interface DeleteRelationshipPayload {
  relationshipId: RelationshipId;
}

export type DeleteRelationshipCommand = MindMapCommandEnvelope<
  typeof MIND_MAP_COMMAND_TYPES.deleteRelationship,
  DeleteRelationshipPayload
>;

export interface CreateBoundaryPayload {
  /** Original normalized user intent lets the command boundary prove every split. */
  selectedTopicIds?: TopicId[];
  /** Deterministic first group; kept singular for stable selection and compatibility. */
  boundary: Boundary;
  /** Further cross-branch/non-contiguous groups created in this same history unit. */
  additionalBoundaries?: Boundary[];
}

export interface BoundaryScopeReplacement {
  boundaryId: BoundaryId;
  scope: TopicScope;
}

/**
 * One source Boundary becomes zero, one, or many canonical ranges. The first
 * replacement must reuse `boundaryId`; every extra ID is allocated by planner.
 */
export interface BoundaryScopeChange {
  boundaryId: BoundaryId;
  replacements: BoundaryScopeReplacement[];
}

export type CreateBoundaryCommand = MindMapCommandEnvelope<
  typeof MIND_MAP_COMMAND_TYPES.createBoundary,
  CreateBoundaryPayload
>;

/** Full canonical replacement; the entity ID is immutable. */
export interface UpdateBoundaryPayload {
  boundary: Boundary;
}

export type UpdateBoundaryCommand = MindMapCommandEnvelope<
  typeof MIND_MAP_COMMAND_TYPES.updateBoundary,
  UpdateBoundaryPayload
>;

export interface DeleteBoundaryPayload {
  boundaryId: BoundaryId;
}

export type DeleteBoundaryCommand = MindMapCommandEnvelope<
  typeof MIND_MAP_COMMAND_TYPES.deleteBoundary,
  DeleteBoundaryPayload
>;

export interface SummaryCreation {
  summary: Summary;
  resultTopic: Topic;
}

/** One user action may atomically create one Summary per normalized range. */
export interface CreateSummaryPayload {
  selectedTopicIds: TopicId[];
  creations: SummaryCreation[];
}

/**
 * A complete planner-owned clone of the source result Topic subtree. Shared
 * document Assets remain referenced; every sheet-local entity gets a new ID.
 */
export interface SummaryResultSubtreeClone {
  topics: Topic[];
  treeEdges: TreeEdge[];
  /** Only semantic elements whose complete ownership/reference closure is cloned. */
  boundaries: Boundary[];
  summaries: Summary[];
  callouts: Callout[];
  relationships: Relationship[];
  /** Normally empty: Zone roots must be parentless floating-root Topics. */
  zones: Zone[];
  markerInstances: MarkerInstance[];
  notes: Note[];
  links: TopicLink[];
  attachments: Attachment[];
  images: TopicImage[];
  equations: Equation[];
  audioClips: AudioClip[];
  todos: TopicTodo[];
  tasks: TopicTask[];
  taskDependencies: TaskDependency[];
}

export interface SummaryScopeReplacement {
  /** Full Summary replacement; the first one retains the source identities. */
  summary: Summary;
  /** Required only for split groups after the first. */
  resultSubtree?: SummaryResultSubtreeClone;
}

/** One source Summary becomes zero, one, or many exact canonical ranges. */
export interface SummaryScopeChange {
  summaryId: SummaryId;
  replacements: SummaryScopeReplacement[];
}

export type CreateSummaryCommand = MindMapCommandEnvelope<
  typeof MIND_MAP_COMMAND_TYPES.createSummary,
  CreateSummaryPayload
>;

/**
 * Full canonical Summary replacement. resultTopicId is immutable; use delete
 * plus create when replacing the owned result subtree.
 */
export interface UpdateSummaryPayload {
  summary: Summary;
}

export type UpdateSummaryCommand = MindMapCommandEnvelope<
  typeof MIND_MAP_COMMAND_TYPES.updateSummary,
  UpdateSummaryPayload
>;

export interface DeleteSummaryPayload {
  summaryId: SummaryId;
  /** Boundaries may include the owned result subtree being deleted. */
  boundaryScopeChanges?: BoundaryScopeChange[];
}

export type DeleteSummaryCommand = MindMapCommandEnvelope<
  typeof MIND_MAP_COMMAND_TYPES.deleteSummary,
  DeleteSummaryPayload
>;

export interface CreateCalloutPayload {
  callout: Callout;
}

export type CreateCalloutCommand = MindMapCommandEnvelope<
  typeof MIND_MAP_COMMAND_TYPES.createCallout,
  CreateCalloutPayload
>;

/** Full canonical replacement; the entity ID is immutable. */
export interface UpdateCalloutPayload {
  callout: Callout;
}

export type UpdateCalloutCommand = MindMapCommandEnvelope<
  typeof MIND_MAP_COMMAND_TYPES.updateCallout,
  UpdateCalloutPayload
>;

export interface DeleteCalloutPayload {
  calloutId: CalloutId;
}

export type DeleteCalloutCommand = MindMapCommandEnvelope<
  typeof MIND_MAP_COMMAND_TYPES.deleteCallout,
  DeleteCalloutPayload
>;

/** Full canonical replacement; the entity ID is immutable. */
export interface UpdateZonePayload {
  zone: Zone;
}

export type UpdateZoneCommand = MindMapCommandEnvelope<
  typeof MIND_MAP_COMMAND_TYPES.updateZone,
  UpdateZonePayload
>;

/**
 * Local-image insertion is one atomic transaction: both identities are
 * allocated before dispatch, and the reducer never derives either entity.
 */
export interface CreateImagePayload {
  asset: Asset;
  image: TopicImage;
}

export type CreateImageCommand = MindMapCommandEnvelope<
  typeof MIND_MAP_COMMAND_TYPES.createImage,
  CreateImagePayload
>;

/**
 * Complete canonical replacement. Image identity, Topic ownership, and Asset
 * ownership are immutable; callers may replace every other validated field.
 */
export interface UpdateImagePayload {
  image: TopicImage;
}

export type UpdateImageCommand = MindMapCommandEnvelope<
  typeof MIND_MAP_COMMAND_TYPES.updateImage,
  UpdateImagePayload
>;

export interface DeleteImagePayload {
  imageId: ImageId;
  /** Planner-owned orphan pruning; validation proves no document reference remains. */
  pruneAssetId?: AssetId;
}

export type DeleteImageCommand = MindMapCommandEnvelope<
  typeof MIND_MAP_COMMAND_TYPES.deleteImage,
  DeleteImagePayload
>;

/**
 * Creates one or more groups together with their initial definitions. The
 * plural payload lets the standard built-in library install as one history
 * unit while ordinary custom-group creation still supplies a single group.
 */
export type CreateMarkerGroupCommand = MindMapCommandEnvelope<
  typeof MIND_MAP_COMMAND_TYPES.createMarkerGroup,
  { groups: MarkerGroup[]; definitions: MarkerDefinition[] }
>;

export type RenameMarkerGroupCommand = MindMapCommandEnvelope<
  typeof MIND_MAP_COMMAND_TYPES.renameMarkerGroup,
  { groupId: MarkerGroupId; name: string }
>;

export interface MarkerGroupOrderUpdate {
  readonly groupId: MarkerGroupId;
  readonly orderKey: OrderKey;
}

/** Complete atomic order-key updates; planners can safely swap adjacent rows. */
export type ReorderMarkerGroupCommand = MindMapCommandEnvelope<
  typeof MIND_MAP_COMMAND_TYPES.reorderMarkerGroup,
  { updates: MarkerGroupOrderUpdate[] }
>;

export type DeleteMarkerGroupCommand = MindMapCommandEnvelope<
  typeof MIND_MAP_COMMAND_TYPES.deleteMarkerGroup,
  { groupId: MarkerGroupId }
>;

export type CreateMarkerDefinitionCommand = MindMapCommandEnvelope<
  typeof MIND_MAP_COMMAND_TYPES.createMarkerDefinition,
  { definition: MarkerDefinition }
>;

/** Full canonical replacement; the definition ID and owning group are immutable. */
export type UpdateMarkerDefinitionCommand = MindMapCommandEnvelope<
  typeof MIND_MAP_COMMAND_TYPES.updateMarkerDefinition,
  { definition: MarkerDefinition }
>;

export interface MarkerDefinitionOrderUpdate {
  readonly definitionId: MarkerDefinitionId;
  readonly orderKey: OrderKey;
}

export type ReorderMarkerDefinitionCommand = MindMapCommandEnvelope<
  typeof MIND_MAP_COMMAND_TYPES.reorderMarkerDefinition,
  { updates: MarkerDefinitionOrderUpdate[] }
>;

export type DeleteMarkerDefinitionCommand = MindMapCommandEnvelope<
  typeof MIND_MAP_COMMAND_TYPES.deleteMarkerDefinition,
  { definitionId: MarkerDefinitionId }
>;

/** Attaches a new instance; exclusive-group conflicts are replaced atomically. */
export type AttachMarkerCommand = MindMapCommandEnvelope<
  typeof MIND_MAP_COMMAND_TYPES.attachMarker,
  { marker: MarkerInstance }
>;

/** Full instance replacement with a stable ID and immutable owning Topic. */
export type UpdateMarkerCommand = MindMapCommandEnvelope<
  typeof MIND_MAP_COMMAND_TYPES.updateMarker,
  { marker: MarkerInstance }
>;

export type DetachMarkerCommand = MindMapCommandEnvelope<
  typeof MIND_MAP_COMMAND_TYPES.detachMarker,
  { markerInstanceId: MarkerInstanceId }
>;

export interface MarkerLegendPatch {
  readonly visible?: boolean;
  /** null removes the optional title. */
  readonly title?: string | null;
  /** null removes the optional StyleBinding. */
  readonly style?: StyleBinding | null;
}

export type PatchMarkerLegendCommand = MindMapCommandEnvelope<
  typeof MIND_MAP_COMMAND_TYPES.patchMarkerLegend,
  { patch: MarkerLegendPatch }
>;

export type MoveMarkerLegendCommand = MindMapCommandEnvelope<
  typeof MIND_MAP_COMMAND_TYPES.moveMarkerLegend,
  { position: Point }
>;

export type ReorderMarkerLegendItemsCommand = MindMapCommandEnvelope<
  typeof MIND_MAP_COMMAND_TYPES.reorderMarkerLegendItems,
  { itemOrder: MarkerDefinitionId[] }
>;

/** Create or replace the single canonical Note owned by a Topic. */
export type UpsertNoteCommand = MindMapCommandEnvelope<
  typeof MIND_MAP_COMMAND_TYPES.upsertNote,
  { note: Note }
>;

export type DeleteNoteCommand = MindMapCommandEnvelope<
  typeof MIND_MAP_COMMAND_TYPES.deleteNote,
  { noteId: NoteId }
>;

/** Create or replace a canonical TopicLink while keeping its stable ID. */
export type UpsertLinkCommand = MindMapCommandEnvelope<
  typeof MIND_MAP_COMMAND_TYPES.upsertLink,
  { link: TopicLink }
>;

export type DeleteLinkCommand = MindMapCommandEnvelope<
  typeof MIND_MAP_COMMAND_TYPES.deleteLink,
  { linkId: LinkId }
>;

/** Create or replace the single lightweight To-do owned by a Topic. */
export type UpsertTodoCommand = MindMapCommandEnvelope<
  typeof MIND_MAP_COMMAND_TYPES.upsertTodo,
  { todo: TopicTodo }
>;

export type DeleteTodoCommand = MindMapCommandEnvelope<
  typeof MIND_MAP_COMMAND_TYPES.deleteTodo,
  { todoId: TodoId }
>;

/**
 * Applies one user-visible To-do bulk action as a single canonical transaction.
 * IDs are allocated by the planner and remain stable through undo/redo.
 */
export type BatchUpdateTodosCommand = MindMapCommandEnvelope<
  typeof MIND_MAP_COMMAND_TYPES.batchUpdateTodos,
  {
    upserts: TopicTodo[];
    deleteTodoIds: TodoId[];
  }
>;

/** Create or replace the single project Task owned by a Topic. */
export type UpsertTaskCommand = MindMapCommandEnvelope<
  typeof MIND_MAP_COMMAND_TYPES.upsertTask,
  { task: TopicTask }
>;

/** Deletes a Task and every dependency edge that references it. */
export type DeleteTaskCommand = MindMapCommandEnvelope<
  typeof MIND_MAP_COMMAND_TYPES.deleteTask,
  { taskId: TaskId }
>;

/** Creates or atomically replaces one directed dependency between two Tasks. */
export type UpsertTaskDependencyCommand = MindMapCommandEnvelope<
  typeof MIND_MAP_COMMAND_TYPES.upsertTaskDependency,
  { dependency: TaskDependency }
>;

export type DeleteTaskDependencyCommand = MindMapCommandEnvelope<
  typeof MIND_MAP_COMMAND_TYPES.deleteTaskDependency,
  { dependencyId: TaskDependencyId }
>;

export type CreateSheetCommand = MindMapCommandEnvelope<
  typeof MIND_MAP_COMMAND_TYPES.createSheet,
  { sheet: MindMapSheet }
>;

export type RenameSheetCommand = MindMapCommandEnvelope<
  typeof MIND_MAP_COMMAND_TYPES.renameSheet,
  { title: string }
>;

export type ReorderSheetCommand = MindMapCommandEnvelope<
  typeof MIND_MAP_COMMAND_TYPES.reorderSheet,
  { orderKey: OrderKey }
>;

export interface UpdateSheetLayoutPayload {
  defaultBranchLayout: ResolvedBranchLayoutSpec;
  /** Omit to preserve the current overlap/floating behavior. */
  advancedLayout?: AdvancedLayoutSpec;
}

export type UpdateSheetLayoutCommand = MindMapCommandEnvelope<
  typeof MIND_MAP_COMMAND_TYPES.updateSheetLayout,
  UpdateSheetLayoutPayload
>;

export type DeleteSheetCommand = MindMapCommandEnvelope<
  typeof MIND_MAP_COMMAND_TYPES.deleteSheet,
  Record<string, never>
>;

export type MindMapCommand =
  | ReplaceImportedDocumentCommand
  | PasteClipboardFragmentCommand
  | CreateTopicCommand
  | InsertParentTopicCommand
  | UpdateTopicTitleCommand
  | UpdateTopicLabelsCommand
  | ReparentTopicCommand
  | ReorderTopicCommand
  | DeleteCurrentTopicCommand
  | DeleteTopicSubtreeCommand
  | ToggleTopicCollapseCommand
  | UpdateStyleBindingsCommand
  | CreateRelationshipCommand
  | UpdateRelationshipCommand
  | DeleteRelationshipCommand
  | CreateBoundaryCommand
  | UpdateBoundaryCommand
  | DeleteBoundaryCommand
  | CreateSummaryCommand
  | UpdateSummaryCommand
  | DeleteSummaryCommand
  | CreateCalloutCommand
  | UpdateCalloutCommand
  | DeleteCalloutCommand
  | UpdateZoneCommand
  | CreateImageCommand
  | UpdateImageCommand
  | DeleteImageCommand
  | CreateMarkerGroupCommand
  | RenameMarkerGroupCommand
  | ReorderMarkerGroupCommand
  | DeleteMarkerGroupCommand
  | CreateMarkerDefinitionCommand
  | UpdateMarkerDefinitionCommand
  | ReorderMarkerDefinitionCommand
  | DeleteMarkerDefinitionCommand
  | AttachMarkerCommand
  | UpdateMarkerCommand
  | DetachMarkerCommand
  | PatchMarkerLegendCommand
  | MoveMarkerLegendCommand
  | ReorderMarkerLegendItemsCommand
  | UpsertNoteCommand
  | DeleteNoteCommand
  | UpsertLinkCommand
  | DeleteLinkCommand
  | UpsertTodoCommand
  | DeleteTodoCommand
  | BatchUpdateTodosCommand
  | UpsertTaskCommand
  | DeleteTaskCommand
  | UpsertTaskDependencyCommand
  | DeleteTaskDependencyCommand
  | CreateSheetCommand
  | RenameSheetCommand
  | ReorderSheetCommand
  | UpdateSheetLayoutCommand
  | DeleteSheetCommand;

export interface AppliedMindMapCommand<
  TCommand extends MindMapCommand = MindMapCommand,
> {
  command: TCommand;
  beforeRevision: number;
  afterRevision: number;
  forwardPatches: Patch[];
  inversePatches: Patch[];
  byteSize: number;
}

export interface MindMapCommandExecution<
  TCommand extends MindMapCommand = MindMapCommand,
> {
  document: MindMapDocumentV1;
  applied: AppliedMindMapCommand<TCommand>;
}

export interface CommandValidationContext {
  document: MindMapDocumentV1;
  sheetId: SheetId;
}

export type CommandMergeDecision = 'merge' | 'separate';

export interface CommandMergePolicy<
  TCommand extends MindMapCommand = MindMapCommand,
> {
  decide(previous: MindMapCommand, next: TCommand): CommandMergeDecision;
}
