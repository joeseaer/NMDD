import { current, type Draft, type Patch } from 'immer';

import {
  getDescendants,
  getIncomingTreeEdges,
  wouldCreateCycle,
} from '../domain/tree';
import {
  expandSemanticTopicScope,
  collectSummaryResultSemanticClosure,
  collectSummaryCascadeDeletionTopicIds,
  planBoundaryScopeNormalizations,
  planSummaryScopeNormalizations,
  projectSummaryScopeNormalizationAfter,
  normalizeSemanticScopeSelection,
  resolveSemanticEdgeSide,
  semanticSiblingEdges,
} from '../domain/semanticScope';
import {
  validateMindMapMarkerDefinitionSchema,
  validateMindMapMarkerGroupSchema,
  validateMindMapMarkerInstanceSchema,
  validateMindMapMarkerLegendSchema,
  validateMindMapTaskDependencySchema,
  validateMindMapNoteSchema,
  validateMindMapTopicLinkSchema,
  validateMindMapTopicTaskSchema,
  validateMindMapTopicTodoSchema,
  validateMindMapZoneSchema,
} from '../domain/schema';
import {
  BOUNDARY_FRAME_EXTENSION_KEY,
  isBoundaryFrameExtensionV1,
} from '../domain/boundaryFrame';
import type {
  Asset,
  AssetId,
  Boundary,
  ImageId,
  MindMapDocumentV1,
  MindMapSheet,
  Relationship,
  RelationshipTargetRef,
  Summary,
  SummaryId,
  TaskDependency,
  TopicImage,
  TopicId,
  TopicScope,
  TreeEdge,
  TreeEdgeId,
  Zone,
} from '../domain/types';
import { CommandValidationError, UnknownMindMapCommandError } from './errors';
import {
  applyReplaceImportedDocument,
  validateReplaceImportedDocument,
} from './documentReplaceCommand';
import {
  applyUpdateStyleBindings,
  validateUpdateStyleBindings,
} from './styleBindingCommand';
import {
  MIND_MAP_COMMAND_TYPES,
  type CommandMergePolicy,
  type BatchUpdateTodosCommand,
  type BoundaryScopeChange,
  type SummaryResultSubtreeClone,
  type SummaryScopeChange,
  type AttachMarkerCommand,
  type CommandValidationContext,
  type CreateBoundaryCommand,
  type CreateCalloutCommand,
  type CreateImageCommand,
  type CreateMarkerDefinitionCommand,
  type CreateMarkerGroupCommand,
  type CreateRelationshipCommand,
  type CreateSummaryCommand,
  type CreateSheetCommand,
  type CreateTopicCommand,
  type DeleteCurrentTopicCommand,
  type DeleteBoundaryCommand,
  type DeleteCalloutCommand,
  type DeleteImageCommand,
  type DeleteLinkCommand,
  type DeleteMarkerDefinitionCommand,
  type DeleteMarkerGroupCommand,
  type DetachMarkerCommand,
  type DeleteNoteCommand,
  type DeleteRelationshipCommand,
  type DeleteSummaryCommand,
  type DeleteSheetCommand,
  type DeleteTopicSubtreeCommand,
  type DeleteTaskCommand,
  type DeleteTaskDependencyCommand,
  type DeleteTodoCommand,
  type MindMapCommand,
  type MindMapCommandType,
  type MoveMarkerLegendCommand,
  type PatchMarkerLegendCommand,
  type InsertParentTopicCommand,
  type PasteClipboardFragmentCommand,
  type ReorderTopicCommand,
  type ReplaceImportedDocumentCommand,
  type ReparentTopicCommand,
  type RenameSheetCommand,
  type RenameMarkerGroupCommand,
  type ReorderMarkerDefinitionCommand,
  type ReorderMarkerGroupCommand,
  type ReorderMarkerLegendItemsCommand,
  type ReorderSheetCommand,
  type ToggleTopicCollapseCommand,
  type UpdateBoundaryCommand,
  type UpdateCalloutCommand,
  type UpdateImageCommand,
  type UpdateMarkerCommand,
  type UpdateMarkerDefinitionCommand,
  type UpdateRelationshipCommand,
  type UpdateSheetLayoutCommand,
  type UpdateStyleBindingsCommand,
  type UpdateSummaryCommand,
  type UpdateTopicTitleCommand,
  type UpdateTopicLabelsCommand,
  type UpdateZoneCommand,
  type UpsertLinkCommand,
  type UpsertNoteCommand,
  type UpsertTaskCommand,
  type UpsertTaskDependencyCommand,
  type UpsertTodoCommand,
} from './types';

type CommandFor<TType extends MindMapCommandType> = Extract<
  MindMapCommand,
  { type: TType }
>;

export interface CommandDefinition<TCommand extends MindMapCommand> {
  validate(context: CommandValidationContext, command: TCommand): void;
  /** Returning a document performs a whole-root replacement transaction. */
  apply(
    document: Draft<MindMapDocumentV1>,
    command: TCommand,
  ): void | MindMapDocumentV1;
  /** Converts Immer's generated inverse into the history representation. */
  invert(command: TCommand, inversePatches: readonly Patch[]): Patch[];
  mergePolicy: CommandMergePolicy<TCommand>;
}

export type MindMapCommandDefinitions = {
  [TType in MindMapCommandType]: CommandDefinition<CommandFor<TType>>;
};

const invalid = (message: string): never => {
  throw new CommandValidationError(message);
};

const getSheet = (
  context: CommandValidationContext,
): MindMapSheet => context.document.sheets[context.sheetId]
  ?? invalid(`Sheet ${context.sheetId} does not exist.`);

const assertTopicExists = (sheet: MindMapSheet, topicId: TopicId): void => {
  if (!sheet.topics[topicId]) invalid(`Topic ${topicId} does not exist.`);
};

const assertNonEmptyOrderKey = (orderKey: string): void => {
  if (orderKey.length === 0) invalid('Tree edge orderKey cannot be empty.');
};

const CANONICAL_ORDER_KEY = /^[0-9A-Za-z._~-]{1,256}$/;

const assertCanonicalOrderKey = (orderKey: unknown, label = 'Tree edge orderKey'): void => {
  if (typeof orderKey !== 'string' || !CANONICAL_ORDER_KEY.test(orderKey)) {
    invalid(`${label} must be 1-256 canonical ASCII order-key characters.`);
  }
};

const assertRichText = (value: unknown, label = 'Topic title'): void => {
  if (
    typeof value !== 'object'
    || value === null
    || (value as { type?: unknown }).type !== 'doc'
    || (value as { version?: unknown }).version !== 1
    || !Array.isArray((value as { blocks?: unknown }).blocks)
  ) {
    invalid(`${label} must be canonical RichText V1.`);
  }
};

const assertEntityPayload: (
  entity: unknown,
  label: string,
) => asserts entity is { id: string } = (
  entity: unknown,
  label: string,
): asserts entity is { id: string } => {
  if (
    typeof entity !== 'object'
    || entity === null
    || typeof (entity as { id?: unknown }).id !== 'string'
    || (entity as { id: string }).id.length === 0
  ) {
    invalid(`${label} payload must contain a canonical entity with an ID.`);
  }
};

const targetIdentity = (target: RelationshipTargetRef): string => {
  if (target.kind === 'topic') return `topic:${target.topicId}`;
  if (target.kind === 'boundary') return `boundary:${target.boundaryId}`;
  if (target.kind === 'callout') return `callout:${target.calloutId}`;
  return `zone:${target.zoneId}`;
};

const assertRelationshipTargetExists = (
  sheet: MindMapSheet,
  target: RelationshipTargetRef,
): void => {
  if (target.kind === 'topic' && !sheet.topics[target.topicId]) {
    invalid(`Relationship topic endpoint ${target.topicId} does not exist.`);
  }
  if (target.kind === 'boundary' && !sheet.boundaries[target.boundaryId]) {
    invalid(`Relationship boundary endpoint ${target.boundaryId} does not exist.`);
  }
  if (target.kind === 'callout' && !sheet.callouts[target.calloutId]) {
    invalid(`Relationship callout endpoint ${target.calloutId} does not exist.`);
  }
  if (target.kind === 'zone' && !sheet.zones[target.zoneId]) {
    invalid(`Relationship zone endpoint ${target.zoneId} does not exist.`);
  }
};

const assertRelationshipCandidate = (
  sheet: MindMapSheet,
  relationship: Relationship,
): void => {
  assertRelationshipTargetExists(sheet, relationship.source.element);
  assertRelationshipTargetExists(sheet, relationship.target.element);
  if (
    targetIdentity(relationship.source.element)
    === targetIdentity(relationship.target.element)
  ) {
    invalid('Relationship endpoints cannot reference the same entity.');
  }

  const sourceKind = relationship.source.element.kind;
  const targetKind = relationship.target.element.kind;
  const legalPair =
    (sourceKind === 'topic' && targetKind === 'topic')
    || (sourceKind === 'boundary' && targetKind === 'topic')
    || sourceKind === 'zone'
    || targetKind === 'zone';
  if (!legalPair) {
    invalid(`Relationship pair ${sourceKind} -> ${targetKind} is not allowed.`);
  }
  if (relationship.title !== undefined) {
    assertRichText(relationship.title, 'Relationship title');
  }
};

const sameOptionalString = (left: string | undefined, right: string | undefined): boolean =>
  left === right;

/** Resolves and validates a scope before the reducer mutates canonical state. */
const resolveScopeMembers = (
  sheet: MindMapSheet,
  scope: TopicScope,
): Set<TopicId> => {
  if (!scope || typeof scope !== 'object') invalid('Topic scope is required.');
  if (scope.kind === 'explicit') {
    if (scope.topicIds.length === 0) invalid('Topic scope cannot be empty.');
    const members = new Set<TopicId>();
    for (const topicId of scope.topicIds) {
      assertTopicExists(sheet, topicId);
      if (members.has(topicId)) invalid(`Topic scope repeats topic ${topicId}.`);
      members.add(topicId);
    }
    return members;
  }

  if (scope.kind === 'subtree') {
    assertTopicExists(sheet, scope.rootTopicId);
    if (
      scope.depth !== 'all'
      && (!Number.isSafeInteger(scope.depth) || scope.depth < 0)
    ) {
      invalid('Subtree scope depth must be "all" or a non-negative integer.');
    }
    const members = new Set<TopicId>();
    const maximumDepth = scope.depth === 'all' ? Number.POSITIVE_INFINITY : scope.depth;
    const queue: Array<readonly [TopicId, number]> = [[scope.rootTopicId, 0]];
    while (queue.length > 0) {
      const [topicId, depth] = queue.shift()!;
      if (members.has(topicId)) continue;
      members.add(topicId);
      if (depth >= maximumDepth) continue;
      for (const edge of Object.values(sheet.treeEdges)) {
        if (edge.parentTopicId === topicId) queue.push([edge.childTopicId, depth + 1]);
      }
    }
    return members;
  }

  assertTopicExists(sheet, scope.parentTopicId);
  const first = sheet.treeEdges[scope.firstEdgeId]
    ?? invalid(`First scope edge ${scope.firstEdgeId} does not exist.`);
  const last = sheet.treeEdges[scope.lastEdgeId]
    ?? invalid(`Last scope edge ${scope.lastEdgeId} does not exist.`);
  if (
    first.parentTopicId !== scope.parentTopicId
    || last.parentTopicId !== scope.parentTopicId
    || resolveSemanticEdgeSide(sheet, first) !== resolveSemanticEdgeSide(sheet, last)
    || !sameOptionalString(first.slot, last.slot)
  ) {
    invalid('Sibling range edges must share parent, resolved side, and slot.');
  }
  const candidates = semanticSiblingEdges(sheet, first);
  const firstIndex = candidates.findIndex((edge) => edge.id === scope.firstEdgeId);
  const lastIndex = candidates.findIndex((edge) => edge.id === scope.lastEdgeId);
  if (firstIndex < 0 || lastIndex < firstIndex) {
    invalid('Sibling range first/last edges are not in canonical order.');
  }
  return new Set(expandSemanticTopicScope(sheet, scope));
};

const assertUniqueSiblingOrderKey = (
  sheet: MindMapSheet,
  edge: TreeEdge,
  ignoredEdgeIds: ReadonlySet<TreeEdgeId> = new Set(),
): void => {
  const duplicate = Object.values(sheet.treeEdges).find((candidate) =>
    !ignoredEdgeIds.has(candidate.id)
    && candidate.parentTopicId === edge.parentTopicId
    && candidate.side === edge.side
    && sameOptionalString(candidate.slot, edge.slot)
    && candidate.orderKey === edge.orderKey,
  );
  if (duplicate) {
    invalid(
      `Tree edge ${edge.id} reuses sibling orderKey ${edge.orderKey} from ${duplicate.id}.`,
    );
  }
};

const cloneInversePatches = (
  _command: MindMapCommand,
  inversePatches: readonly Patch[],
): Patch[] => inversePatches.map((patch) => ({ ...patch, path: [...patch.path] }));

const neverMerge: CommandMergePolicy = {
  decide: () => 'separate',
};

const mergeSameTypeAndGroup: CommandMergePolicy = {
  decide: (previous, next) =>
    previous.type === next.type
    && previous.groupId !== undefined
    && previous.groupId === next.groupId
      ? 'merge'
      : 'separate',
};

const mergeSameTitleSession: CommandMergePolicy<UpdateTopicTitleCommand> = {
  decide: (previous, next) =>
    previous.type === MIND_MAP_COMMAND_TYPES.updateTopicTitle
    && previous.payload.topicId === next.payload.topicId
    && previous.groupId !== undefined
    && previous.groupId === next.groupId
      ? 'merge'
      : 'separate',
};

const collectCanonicalEntityIds = (value: unknown): string[] => {
  const ids: string[] = [];
  const visited = new Set<object>();
  const visit = (candidate: unknown): void => {
    if (candidate === null || typeof candidate !== 'object' || visited.has(candidate)) return;
    visited.add(candidate);
    if (Array.isArray(candidate)) {
      for (const child of candidate) visit(child);
      return;
    }
    const record = candidate as Record<string, unknown>;
    if (typeof record.id === 'string' && record.id.length > 0) ids.push(record.id);
    for (const child of Object.values(record)) visit(child);
  };
  visit(value);
  return ids;
};

export interface AssetReferenceQuery {
  /** Excludes the image being deleted while proving whether its Asset is orphaned. */
  ignoreImageId?: ImageId;
}

/**
 * Enumerates every canonical Asset reference in the document. Keeping this
 * explicit prevents image deletion from pruning Assets still used by canvas
 * backgrounds, markers, other resources, or actor avatars.
 */
export const documentReferencesAsset = (
  document: MindMapDocumentV1,
  assetId: AssetId,
  query: AssetReferenceQuery = {},
): boolean => {
  if (Object.values(document.markerDefinitions).some(
    (definition) => definition.source.kind === 'asset'
      && definition.source.assetId === assetId,
  )) return true;
  if (Object.values(document.actors).some((actor) => actor.avatarAssetId === assetId)) {
    return true;
  }

  for (const sheet of Object.values(document.sheets)) {
    if (sheet.canvas.background.kind === 'image' && sheet.canvas.background.assetId === assetId) {
      return true;
    }
    if (Object.values(sheet.attachments).some((attachment) => attachment.assetId === assetId)) {
      return true;
    }
    if (Object.values(sheet.audioClips).some((clip) => clip.assetId === assetId)) return true;
    if (Object.values(sheet.images).some(
      (image) => image.id !== query.ignoreImageId && image.assetId === assetId,
    )) return true;
  }
  return false;
};

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MIME_TYPE = /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/;
const SHA256 = /^[0-9a-f]{64}$/;
const MAX_CANONICAL_COORDINATE = 1_000_000;

const assertCanonicalUuidV7 = (value: unknown, label: string): void => {
  if (typeof value !== 'string' || !UUID_V7.test(value)) {
    invalid(`${label} must be a canonical UUIDv7.`);
  }
};

const assertPlainRecord = (
  value: unknown,
  label: string,
): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    invalid(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
};

const assertOnlyKeys = (
  record: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void => {
  const allowedSet = new Set(allowed);
  const extra = Object.keys(record).find((key) => !allowedSet.has(key));
  if (extra) invalid(`${label} contains unsupported property ${extra}.`);
};

const assertBoundedNumber = (
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
  exclusiveMinimum = false,
): number => {
  if (
    typeof value !== 'number'
    || !Number.isFinite(value)
    || (exclusiveMinimum ? value <= minimum : value < minimum)
    || value > maximum
  ) {
    const comparison = exclusiveMinimum ? 'greater than' : 'at least';
    invalid(`${label} must be finite, ${comparison} ${minimum}, and at most ${maximum}.`);
  }
  return value as number;
};

const assertCanonicalSize = (
  value: unknown,
  label: string,
): { width: number; height: number } => {
  const size = assertPlainRecord(value, label);
  assertOnlyKeys(size, ['width', 'height'], label);
  const width = assertBoundedNumber(
    size.width,
    `${label}.width`,
    0,
    MAX_CANONICAL_COORDINATE,
    true,
  );
  const height = assertBoundedNumber(
    size.height,
    `${label}.height`,
    0,
    MAX_CANONICAL_COORDINATE,
    true,
  );
  return { width, height };
};

const hasUnsafeAssetPath = (value: string): boolean => {
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // A literal percent sign is allowed; raw-path checks still apply.
  }
  return [value, decoded].some((candidate) =>
    /[\u0000-\u001f\u007f]/.test(candidate)
    || candidate.includes('\\')
    || candidate.startsWith('/')
    || /^[A-Za-z]:\//.test(candidate)
    || candidate.split('/').some((segment) => segment === '.' || segment === '..'),
  );
};

const SENSITIVE_REMOTE_QUERY_KEYS = new Set([
  'access_token',
  'apikey',
  'api_key',
  'authorization',
  'key-pair-id',
  'sig',
  'signature',
  'token',
  'x-amz-credential',
  'x-amz-security-token',
  'x-amz-signature',
  'x-goog-credential',
  'x-goog-signature',
]);

const hasSensitiveRemoteQuery = (url: URL): boolean =>
  [...url.searchParams.keys()].some((key) =>
    SENSITIVE_REMOTE_QUERY_KEYS.has(key.toLocaleLowerCase('en-US')),
  );

const assertImageAssetCandidate = (asset: Asset): void => {
  const candidate = assertPlainRecord(asset, 'Image Asset');
  assertOnlyKeys(candidate, [
    'id',
    'fileName',
    'mimeType',
    'byteSize',
    'sha256',
    'source',
    'intrinsicSize',
    'durationMs',
    'audit',
    'extensions',
  ], 'Image Asset');
  assertCanonicalUuidV7(candidate.id, 'Image Asset ID');
  if (
    typeof candidate.fileName !== 'string'
    || candidate.fileName.length < 1
    || candidate.fileName.length > 1_024
  ) invalid('Image Asset fileName must contain 1-1024 characters.');
  if (
    typeof candidate.mimeType !== 'string'
    || candidate.mimeType.length > 256
    || !MIME_TYPE.test(candidate.mimeType)
    || !candidate.mimeType.toLocaleLowerCase('en-US').startsWith('image/')
  ) invalid('Local image Asset mimeType must be image/*.');
  if (
    !Number.isSafeInteger(candidate.byteSize)
    || Number(candidate.byteSize) < 0
    || Number(candidate.byteSize) > 1_099_511_627_776
  ) invalid('Image Asset byteSize must be a non-negative safe integer within 1 TiB.');
  if (typeof candidate.sha256 !== 'string' || !SHA256.test(candidate.sha256)) {
    invalid('Image Asset sha256 must be 64 lowercase hexadecimal characters.');
  }

  const source = assertPlainRecord(candidate.source, 'Image Asset source');
  if (source.kind === 'embedded') {
    assertOnlyKeys(source, ['kind', 'relativePath'], 'Embedded image source');
    if (
      typeof source.relativePath !== 'string'
      || source.relativePath.length < 1
      || source.relativePath.length > 4_096
      || hasUnsafeAssetPath(source.relativePath)
    ) invalid('Embedded image source relativePath must contain 1-4096 characters.');
  } else if (source.kind === 'managed') {
    assertOnlyKeys(source, ['kind', 'objectKey'], 'Managed image source');
    if (
      typeof source.objectKey !== 'string'
      || source.objectKey.length < 1
      || source.objectKey.length > 4_096
      || hasUnsafeAssetPath(source.objectKey)
    ) invalid('Managed image source objectKey must contain 1-4096 characters.');
  } else if (source.kind === 'remote') {
    assertOnlyKeys(source, ['kind', 'url', 'etag'], 'Remote image source');
    if (typeof source.url !== 'string' || source.url.length > 16_384) {
      invalid('Remote image source URL must be a canonical URI.');
    }
    const url = (() => {
      try {
        return new URL(source.url as string);
      } catch {
        return invalid('Remote image source URL must be a canonical URI.');
      }
    })();
    if (
      (url.protocol !== 'https:' && url.protocol !== 'http:')
      || url.username.length > 0
      || url.password.length > 0
      || hasSensitiveRemoteQuery(url)
    ) invalid('Remote image source URL must use http(s) without embedded credentials.');
    if (source.etag !== undefined && (
      typeof source.etag !== 'string' || source.etag.length > 1_024
    )) invalid('Remote image source etag must contain at most 1024 characters.');
  } else {
    invalid('Image Asset source kind must be embedded, managed, or remote.');
  }

  if (candidate.intrinsicSize !== undefined) {
    assertCanonicalSize(candidate.intrinsicSize, 'Image Asset intrinsicSize');
  }
  if (candidate.durationMs !== undefined && (
    !Number.isSafeInteger(candidate.durationMs)
    || Number(candidate.durationMs) < 0
    || Number(candidate.durationMs) > 315_576_000_000
  )) invalid('Image Asset durationMs is outside the canonical range.');
};

const assertImageCandidate = (
  sheet: MindMapSheet,
  image: TopicImage,
  asset: Asset,
  ignoredImageId?: ImageId,
): void => {
  const candidate = assertPlainRecord(image, 'Topic image');
  assertOnlyKeys(candidate, [
    'id',
    'topicId',
    'assetId',
    'orderKey',
    'role',
    'placement',
    'size',
    'crop',
    'alt',
    'audit',
    'extensions',
  ], 'Topic image');
  assertCanonicalUuidV7(candidate.id, 'Topic image ID');
  assertCanonicalUuidV7(candidate.topicId, 'Topic image Topic ID');
  assertCanonicalUuidV7(candidate.assetId, 'Topic image Asset ID');
  assertTopicExists(sheet, image.topicId);
  if (image.assetId !== asset.id) invalid(`Topic image ${image.id} references another Asset.`);
  assertCanonicalOrderKey(image.orderKey, 'Topic image orderKey');
  const duplicateOrder = Object.values(sheet.images).find(
    (other) => other.id !== ignoredImageId
      && other.topicId === image.topicId
      && other.orderKey === image.orderKey,
  );
  if (duplicateOrder) {
    invalid(
      `Topic image ${image.id} reuses orderKey ${image.orderKey} from ${duplicateOrder.id}.`,
    );
  }

  if (!['inline', 'thumbnail', 'background', 'sticker'].includes(image.role)) {
    invalid(`Topic image ${image.id} has an unsupported role.`);
  }
  const placement = assertPlainRecord(candidate.placement, 'Topic image placement');
  assertOnlyKeys(placement, ['side', 'align', 'offset'], 'Topic image placement');
  const side = placement.side;
  if (!['top', 'bottom', 'left', 'right', 'overlay'].includes(String(side))) {
    invalid('Topic image placement side is invalid.');
  }
  if (!['start', 'center', 'end'].includes(String(placement.align))) {
    invalid('Topic image placement alignment is invalid.');
  }
  // Background stays schema-compatible, while every non-sticker local image
  // follows XMind's ordinary top/bottom placement rule. Overlay is sticker-only.
  if (image.role !== 'sticker' && side !== 'top' && side !== 'bottom') {
    invalid('Only sticker images may use left, right, or overlay placement.');
  }

  const offset = assertPlainRecord(placement.offset, 'Topic image placement offset');
  assertOnlyKeys(offset, ['x', 'y'], 'Topic image placement offset');
  assertBoundedNumber(
    offset.x,
    'Topic image placement offset.x',
    -MAX_CANONICAL_COORDINATE,
    MAX_CANONICAL_COORDINATE,
  );
  assertBoundedNumber(
    offset.y,
    'Topic image placement offset.y',
    -MAX_CANONICAL_COORDINATE,
    MAX_CANONICAL_COORDINATE,
  );

  if (candidate.size !== undefined) assertCanonicalSize(candidate.size, 'Topic image size');
  if (candidate.crop !== undefined) {
    const crop = assertPlainRecord(candidate.crop, 'Topic image crop');
    assertOnlyKeys(crop, ['x', 'y', 'width', 'height'], 'Topic image crop');
    const x = assertBoundedNumber(crop.x, 'Topic image crop.x', 0, MAX_CANONICAL_COORDINATE);
    const y = assertBoundedNumber(crop.y, 'Topic image crop.y', 0, MAX_CANONICAL_COORDINATE);
    const width = assertBoundedNumber(
      crop.width,
      'Topic image crop.width',
      0,
      MAX_CANONICAL_COORDINATE,
      true,
    );
    const height = assertBoundedNumber(
      crop.height,
      'Topic image crop.height',
      0,
      MAX_CANONICAL_COORDINATE,
      true,
    );
    const intrinsic = asset.intrinsicSize
      ?? invalid('A cropped Topic image requires Asset intrinsicSize.');
    if (
      x + width > intrinsic.width
      || y + height > intrinsic.height
    ) invalid('Topic image crop must stay within Asset intrinsicSize.');
  }
  if (candidate.alt !== undefined && (
    typeof candidate.alt !== 'string' || candidate.alt.length > 4_096
  )) invalid('Topic image alt text must contain at most 4096 characters.');
};

const validatePasteClipboardFragment = (
  context: CommandValidationContext,
  command: PasteClipboardFragmentCommand,
): void => {
  const sheet = getSheet(context);
  const { attachmentEdges, fragment, rootTopicIds } = command.payload;
  if (!fragment || typeof fragment !== 'object') invalid('Clipboard fragment is required.');
  if (!Array.isArray(rootTopicIds) || rootTopicIds.length === 0) {
    invalid('Clipboard paste requires at least one detached root topic.');
  }
  if (!Array.isArray(attachmentEdges) || attachmentEdges.length !== rootTopicIds.length) {
    invalid('Clipboard paste requires exactly one destination edge per root topic.');
  }

  const fragmentRecord = fragment as unknown as Record<string, unknown>;
  for (const [recordName, recordValue] of Object.entries(fragmentRecord)) {
    if (recordValue === null || typeof recordValue !== 'object' || Array.isArray(recordValue)) {
      invalid(`Clipboard fragment record ${recordName} must be an entity map.`);
    }
    for (const [recordId, entityValue] of Object.entries(
      recordValue as Record<string, unknown>,
    )) {
      if (
        entityValue === null
        || typeof entityValue !== 'object'
        || (entityValue as { id?: unknown }).id !== recordId
      ) {
        invalid(`Clipboard fragment ${recordName}[${recordId}] has a mismatched entity ID.`);
      }
    }
  }

  const existingIds = new Set(collectCanonicalEntityIds(context.document));
  const pastedIds = collectCanonicalEntityIds(fragment);
  const uniquePastedIds = new Set<string>();
  for (const id of pastedIds) {
    if (uniquePastedIds.has(id)) invalid(`Clipboard fragment repeats entity ID ${id}.`);
    if (existingIds.has(id)) invalid(`Clipboard entity ID ${id} already exists.`);
    uniquePastedIds.add(id);
  }

  const roots = new Set<TopicId>();
  for (const rootTopicId of rootTopicIds) {
    if (roots.has(rootTopicId)) invalid(`Clipboard root ${rootTopicId} is repeated.`);
    const root = fragment.topics[rootTopicId]
      ?? invalid(`Clipboard root topic ${rootTopicId} does not exist in the fragment.`);
    if (root.role !== 'regular') {
      invalid(`Attached clipboard root ${rootTopicId} must use the regular topic role.`);
    }
    roots.add(rootTopicId);
  }
  for (const edge of Object.values(fragment.treeEdges)) {
    if (!fragment.topics[edge.parentTopicId] || !fragment.topics[edge.childTopicId]) {
      invalid(`Clipboard tree edge ${edge.id} must stay inside the fragment.`);
    }
    if (roots.has(edge.childTopicId)) {
      invalid(`Clipboard root ${edge.childTopicId} must not have an internal incoming edge.`);
    }
  }

  const attachedRoots = new Set<TopicId>();
  const siblingOrderKeys = new Set(
    Object.values(sheet.treeEdges).map((edge) => `${edge.parentTopicId}\u0000${edge.orderKey}`),
  );
  const attachmentIds = new Set<string>();
  for (const edge of attachmentEdges) {
    assertEntityPayload(edge, 'Clipboard attachment edge');
    if (existingIds.has(edge.id) || uniquePastedIds.has(edge.id) || attachmentIds.has(edge.id)) {
      invalid(`Clipboard attachment edge ID ${edge.id} already exists.`);
    }
    if (!sheet.topics[edge.parentTopicId]) {
      invalid(`Clipboard destination parent ${edge.parentTopicId} does not exist.`);
    }
    if (!roots.has(edge.childTopicId)) {
      invalid(`Clipboard attachment edge ${edge.id} targets a non-root topic.`);
    }
    if (attachedRoots.has(edge.childTopicId)) {
      invalid(`Clipboard root ${edge.childTopicId} has multiple destination edges.`);
    }
    assertNonEmptyOrderKey(edge.orderKey);
    const siblingKey = `${edge.parentTopicId}\u0000${edge.orderKey}`;
    if (siblingOrderKeys.has(siblingKey)) {
      invalid(`Clipboard attachment edge ${edge.id} reuses sibling orderKey ${edge.orderKey}.`);
    }
    siblingOrderKeys.add(siblingKey);
    attachmentIds.add(edge.id);
    attachedRoots.add(edge.childTopicId);
  }
  if (attachedRoots.size !== roots.size) {
    invalid('Every clipboard root must be attached exactly once.');
  }
};

const applyPasteClipboardFragment = (
  document: Draft<MindMapDocumentV1>,
  command: PasteClipboardFragmentCommand,
): void => {
  const { attachmentEdges, fragment } = command.payload;
  const sheet = document.sheets[command.sheetId];

  for (const entity of Object.values(fragment.assets)) document.assets[entity.id] = entity;
  for (const entity of Object.values(fragment.styles)) document.styles[entity.id] = entity;
  for (const entity of Object.values(fragment.markerGroups)) {
    document.markerGroups[entity.id] = entity;
  }
  for (const entity of Object.values(fragment.markerDefinitions)) {
    document.markerDefinitions[entity.id] = entity;
  }

  for (const entity of Object.values(fragment.topics)) sheet.topics[entity.id] = entity;
  for (const entity of Object.values(fragment.treeEdges)) sheet.treeEdges[entity.id] = entity;
  for (const entity of attachmentEdges) sheet.treeEdges[entity.id] = entity;
  for (const entity of Object.values(fragment.relationships)) {
    sheet.relationships[entity.id] = entity;
  }
  for (const entity of Object.values(fragment.boundaries)) sheet.boundaries[entity.id] = entity;
  for (const entity of Object.values(fragment.summaries)) sheet.summaries[entity.id] = entity;
  for (const entity of Object.values(fragment.callouts)) sheet.callouts[entity.id] = entity;
  for (const entity of Object.values(fragment.zones)) sheet.zones[entity.id] = entity;
  for (const entity of Object.values(fragment.markerInstances)) {
    sheet.markerInstances[entity.id] = entity;
  }
  for (const entity of Object.values(fragment.notes)) sheet.notes[entity.id] = entity;
  for (const entity of Object.values(fragment.links)) sheet.links[entity.id] = entity;
  for (const entity of Object.values(fragment.attachments)) sheet.attachments[entity.id] = entity;
  for (const entity of Object.values(fragment.images)) sheet.images[entity.id] = entity;
  for (const entity of Object.values(fragment.equations)) sheet.equations[entity.id] = entity;
  for (const entity of Object.values(fragment.audioClips)) sheet.audioClips[entity.id] = entity;
  for (const entity of Object.values(fragment.todos)) sheet.todos[entity.id] = entity;
  for (const entity of Object.values(fragment.tasks)) sheet.tasks[entity.id] = entity;
  for (const entity of Object.values(fragment.taskDependencies)) {
    sheet.taskDependencies[entity.id] = entity;
  }
};

const validateCreateTopic = (
  context: CommandValidationContext,
  command: CreateTopicCommand,
): void => {
  const sheet = getSheet(context);
  const { edge, topic } = command.payload;
  if (!topic || typeof topic !== 'object') invalid('Create topic payload is missing topic.');
  if (sheet.topics[topic.id]) invalid(`Topic ${topic.id} already exists.`);
  assertRichText(topic.title);

  if (!edge) {
    if (topic.role !== 'floating-root') {
      invalid('Only a floating-root topic may be created without an incoming edge.');
    }
    return;
  }

  if (sheet.treeEdges[edge.id]) invalid(`Tree edge ${edge.id} already exists.`);
  if (edge.childTopicId !== topic.id) {
    invalid(`Tree edge ${edge.id} must target newly created topic ${topic.id}.`);
  }
  assertTopicExists(sheet, edge.parentTopicId);
  assertNonEmptyOrderKey(edge.orderKey);
  assertUniqueSiblingOrderKey(sheet, edge);
  if (topic.role === 'central' || topic.role === 'floating-root' || topic.role === 'summary-result') {
    invalid(`Topic role ${topic.role} cannot have an incoming tree edge.`);
  }
};

const applyCreateTopic = (
  document: Draft<MindMapDocumentV1>,
  command: CreateTopicCommand,
): void => {
  const sheet = document.sheets[command.sheetId];
  sheet.topics[command.payload.topic.id] = command.payload.topic;
  if (command.payload.edge) {
    sheet.treeEdges[command.payload.edge.id] = command.payload.edge;
  }
};

const validateInsertParentTopic = (
  context: CommandValidationContext,
  command: InsertParentTopicCommand,
): void => {
  const sheet = getSheet(context);
  const { childEdge, parentTopic, topicId } = command.payload;
  assertTopicExists(sheet, topicId);
  const topic = sheet.topics[topicId];
  if (topicId === sheet.rootTopicId || topic.role === 'central') {
    invalid('The sheet central root cannot receive an inserted parent topic.');
  }
  if (topic.role === 'floating-root' || topic.role === 'summary-result') {
    invalid(`Topic role ${topic.role} has no structural parent to replace.`);
  }

  const incoming = getIncomingTreeEdges(sheet, topicId);
  if (incoming.length !== 1) {
    invalid(`Topic ${topicId} must have exactly one incoming edge to insert a parent.`);
  }
  assertEntityPayload(parentTopic, 'Inserted parent topic');
  if (sheet.topics[parentTopic.id]) invalid(`Topic ${parentTopic.id} already exists.`);
  if (parentTopic.id === topicId) invalid('Inserted parent topic must use a new ID.');
  if (parentTopic.role !== 'regular') invalid('Inserted parent topic must use role regular.');
  assertRichText(parentTopic.title, 'Inserted parent title');

  assertEntityPayload(childEdge, 'Inserted parent child edge');
  if (sheet.treeEdges[childEdge.id]) invalid(`Tree edge ${childEdge.id} already exists.`);
  if (childEdge.parentTopicId !== parentTopic.id || childEdge.childTopicId !== topicId) {
    invalid('Inserted parent child edge must connect the new parent to the selected topic.');
  }
  assertCanonicalOrderKey(childEdge.orderKey);
  const currentIncoming = incoming[0];
  if (
    childEdge.orderKey !== currentIncoming.orderKey
    || childEdge.side !== currentIncoming.side
    || !sameOptionalString(childEdge.slot, currentIncoming.slot)
  ) {
    invalid('Inserted parent child edge must preserve the selected branch order, side, and slot.');
  }
};

const applyInsertParentTopic = (
  document: Draft<MindMapDocumentV1>,
  command: InsertParentTopicCommand,
): void => {
  const sheet = document.sheets[command.sheetId];
  const incoming = Object.values(sheet.treeEdges).find(
    (edge) => edge.childTopicId === command.payload.topicId,
  );
  if (!incoming) return;
  sheet.topics[command.payload.parentTopic.id] = command.payload.parentTopic;
  // Reusing the original edge is intentional: sibling position, branch
  // metadata, styling, audit data and edge-based semantic references survive.
  incoming.childTopicId = command.payload.parentTopic.id;
  sheet.treeEdges[command.payload.childEdge.id] = command.payload.childEdge;
};

const validateUpdateTopicTitle = (
  context: CommandValidationContext,
  command: UpdateTopicTitleCommand,
): void => {
  assertTopicExists(getSheet(context), command.payload.topicId);
  assertRichText(command.payload.title);
};

const applyUpdateTopicTitle = (
  document: Draft<MindMapDocumentV1>,
  command: UpdateTopicTitleCommand,
): void => {
  document.sheets[command.sheetId].topics[command.payload.topicId].title = command.payload.title;
};

const validateUpdateTopicLabels = (
  context: CommandValidationContext,
  command: UpdateTopicLabelsCommand,
): void => {
  const sheet = getSheet(context);
  assertTopicExists(sheet, command.payload.topicId);
  const { labels } = command.payload;
  if (!Array.isArray(labels) || labels.length > 1024) {
    invalid('Topic labels must be an array with at most 1024 items.');
  }
  const unique = new Set<string>();
  for (const label of labels) {
    if (
      typeof label !== 'string'
      || label.length < 1
      || label.length > 256
      || label.trim() !== label
      || /[\u0000-\u001f\u007f]/.test(label)
    ) {
      invalid('Each Topic label must be a trimmed 1-256 character string.');
    }
    if (unique.has(label)) invalid(`Topic label ${label} is duplicated.`);
    unique.add(label);
  }
};

const applyUpdateTopicLabels = (
  document: Draft<MindMapDocumentV1>,
  command: UpdateTopicLabelsCommand,
): void => {
  const topic = document.sheets[command.sheetId].topics[command.payload.topicId];
  if (command.payload.labels.length === 0) delete topic.labels;
  else topic.labels = [...command.payload.labels];
};

const validationSummary = (label: string, errors: readonly { message: string }[]): string =>
  `${label} does not match the canonical schema: ${errors.map((error) => error.message).join('; ')}`;

const ROOT_ENTITY_MAP_NAMES = [
  'sheets',
  'assets',
  'styles',
  'themes',
  'markerGroups',
  'markerDefinitions',
  'presentations',
  'savedViews',
  'actors',
] as const;

const SHEET_ENTITY_MAP_NAMES = [
  'topics',
  'treeEdges',
  'relationships',
  'boundaries',
  'summaries',
  'callouts',
  'zones',
  'markerInstances',
  'notes',
  'links',
  'attachments',
  'images',
  'equations',
  'audioClips',
  'todos',
  'tasks',
  'taskDependencies',
] as const;

/** Canonical IDs are document-wide unique, including nested entity maps. */
const canonicalEntityIdExists = (
  document: MindMapDocumentV1,
  id: string,
): boolean => {
  if (document.id === id) return true;
  for (const mapName of ROOT_ENTITY_MAP_NAMES) {
    if (Object.prototype.hasOwnProperty.call(document[mapName], id)) return true;
  }
  for (const theme of Object.values(document.themes)) {
    if (Object.prototype.hasOwnProperty.call(theme.rules, id)) return true;
  }
  for (const sheet of Object.values(document.sheets)) {
    for (const mapName of SHEET_ENTITY_MAP_NAMES) {
      if (Object.prototype.hasOwnProperty.call(sheet[mapName], id)) return true;
    }
    if (Object.prototype.hasOwnProperty.call(sheet.workCalendar.exceptions, id)) return true;
  }
  for (const deck of Object.values(document.presentations)) {
    if (Object.prototype.hasOwnProperty.call(deck.slides, id)) return true;
    for (const slide of Object.values(deck.slides)) {
      if (Object.prototype.hasOwnProperty.call(slide.builds, id)) return true;
    }
  }
  const threads = document.collaboration?.commentThreads;
  if (threads) {
    if (Object.prototype.hasOwnProperty.call(threads, id)) return true;
    for (const thread of Object.values(threads)) {
      if (Object.prototype.hasOwnProperty.call(thread.comments, id)) return true;
    }
  }
  return false;
};

const assertNewCanonicalEntityId = (
  document: MindMapDocumentV1,
  id: string,
  label: string,
): void => {
  if (canonicalEntityIdExists(document, id)) {
    invalid(`${label} ID ${id} already exists in this document.`);
  }
};

const assertMarkerName = (name: unknown, label: string): void => {
  if (
    typeof name !== 'string'
    || name.length < 1
    || name.length > 512
    || name.trim() !== name
    || /[\u0000-\u001f\u007f]/.test(name)
  ) invalid(`${label} must be a trimmed 1-512 character string.`);
};

const assertMarkerDefinitionReferences = (
  document: MindMapDocumentV1,
  definition: CreateMarkerDefinitionCommand['payload']['definition'],
  availableGroupIds: ReadonlySet<string> = new Set(Object.keys(document.markerGroups)),
): void => {
  if (!availableGroupIds.has(definition.groupId)) {
    invalid(`Marker group ${definition.groupId} does not exist.`);
  }
  if (
    definition.source.kind === 'asset'
    && !document.assets[definition.source.assetId]
  ) invalid(`Marker asset ${definition.source.assetId} does not exist.`);
};

const assertUniqueMarkerGroupOrderKeys = (
  document: MindMapDocumentV1,
  replacements: ReadonlyMap<string, string>,
  additions: readonly { readonly id: string; readonly orderKey: string }[] = [],
): void => {
  const seen = new Map<string, string>();
  for (const group of [...Object.values(document.markerGroups), ...additions]) {
    const orderKey = replacements.get(group.id) ?? group.orderKey;
    assertCanonicalOrderKey(orderKey, 'Marker group orderKey');
    const previous = seen.get(orderKey);
    if (previous) invalid(`Marker groups ${previous} and ${group.id} share orderKey ${orderKey}.`);
    seen.set(orderKey, group.id);
  }
};

const assertUniqueMarkerDefinitionOrderKeys = (
  document: MindMapDocumentV1,
  replacements: ReadonlyMap<string, string>,
  additions: readonly { readonly groupId: string; readonly id: string; readonly orderKey: string }[] = [],
): void => {
  const seen = new Map<string, string>();
  for (const definition of [...Object.values(document.markerDefinitions), ...additions]) {
    const orderKey = replacements.get(definition.id) ?? definition.orderKey;
    assertCanonicalOrderKey(orderKey, 'Marker definition orderKey');
    const identity = `${definition.groupId}\u0000${orderKey}`;
    const previous = seen.get(identity);
    if (previous) {
      invalid(`Marker definitions ${previous} and ${definition.id} share orderKey ${orderKey} in group ${definition.groupId}.`);
    }
    seen.set(identity, definition.id);
  }
};

const validateCreateMarkerGroup = (
  context: CommandValidationContext,
  command: CreateMarkerGroupCommand,
): void => {
  const { definitions, groups } = command.payload;
  if (!Array.isArray(groups) || groups.length === 0) {
    invalid('Marker group creation requires at least one group.');
  }
  if (!Array.isArray(definitions)) invalid('Marker definitions must be an array.');

  const payloadIds = new Set<string>();
  for (const group of groups) {
    const schema = validateMindMapMarkerGroupSchema(group);
    if (!schema.valid) invalid(validationSummary('Marker group', schema.errors));
    assertMarkerName(group.name, 'Marker group name');
    if (payloadIds.has(group.id)) invalid(`Marker creation repeats ID ${group.id}.`);
    payloadIds.add(group.id);
    assertNewCanonicalEntityId(context.document, group.id, 'Marker group');
  }
  const availableGroupIds = new Set([
    ...Object.keys(context.document.markerGroups),
    ...groups.map((group) => group.id),
  ]);
  for (const definition of definitions) {
    const schema = validateMindMapMarkerDefinitionSchema(definition);
    if (!schema.valid) invalid(validationSummary('Marker definition', schema.errors));
    assertMarkerName(definition.name, 'Marker definition name');
    if (payloadIds.has(definition.id)) invalid(`Marker creation repeats ID ${definition.id}.`);
    payloadIds.add(definition.id);
    assertNewCanonicalEntityId(context.document, definition.id, 'Marker definition');
    assertMarkerDefinitionReferences(context.document, definition, availableGroupIds);
  }
  assertUniqueMarkerGroupOrderKeys(context.document, new Map(), groups);
  assertUniqueMarkerDefinitionOrderKeys(context.document, new Map(), definitions);
};

const applyCreateMarkerGroup = (
  document: Draft<MindMapDocumentV1>,
  command: CreateMarkerGroupCommand,
): void => {
  for (const group of command.payload.groups) document.markerGroups[group.id] = group;
  for (const definition of command.payload.definitions) {
    document.markerDefinitions[definition.id] = definition;
  }
};

const validateRenameMarkerGroup = (
  context: CommandValidationContext,
  command: RenameMarkerGroupCommand,
): void => {
  const group = context.document.markerGroups[command.payload.groupId];
  if (!group) {
    invalid(`Marker group ${command.payload.groupId} does not exist.`);
  }
  if (group.kind === 'builtin') invalid('Built-in marker groups cannot be renamed.');
  assertMarkerName(command.payload.name, 'Marker group name');
};

const applyRenameMarkerGroup = (
  document: Draft<MindMapDocumentV1>,
  command: RenameMarkerGroupCommand,
): void => {
  document.markerGroups[command.payload.groupId].name = command.payload.name;
};

const validateReorderMarkerGroup = (
  context: CommandValidationContext,
  command: ReorderMarkerGroupCommand,
): void => {
  const { updates } = command.payload;
  if (!Array.isArray(updates) || updates.length === 0) {
    invalid('Marker group reorder requires at least one update.');
  }
  const replacements = new Map<string, string>();
  for (const update of updates) {
    if (!context.document.markerGroups[update.groupId]) {
      invalid(`Marker group ${update.groupId} does not exist.`);
    }
    if (replacements.has(update.groupId)) invalid(`Marker group ${update.groupId} is repeated.`);
    assertCanonicalOrderKey(update.orderKey, 'Marker group orderKey');
    replacements.set(update.groupId, update.orderKey);
  }
  assertUniqueMarkerGroupOrderKeys(context.document, replacements);
};

const applyReorderMarkerGroup = (
  document: Draft<MindMapDocumentV1>,
  command: ReorderMarkerGroupCommand,
): void => {
  for (const update of command.payload.updates) {
    document.markerGroups[update.groupId].orderKey = update.orderKey;
  }
};

const deleteMarkerDefinitionsFromDocument = (
  document: Draft<MindMapDocumentV1>,
  definitionIds: ReadonlySet<string>,
): void => {
  for (const definitionId of definitionIds) {
    delete document.markerDefinitions[definitionId as keyof typeof document.markerDefinitions];
  }
  for (const sheet of Object.values(document.sheets)) {
    for (const marker of Object.values(sheet.markerInstances)) {
      if (definitionIds.has(marker.markerDefinitionId)) delete sheet.markerInstances[marker.id];
    }
    if (sheet.markerLegend.itemOrder) {
      sheet.markerLegend.itemOrder = sheet.markerLegend.itemOrder.filter(
        (definitionId) => !definitionIds.has(definitionId),
      );
    }
  }
};

const validateDeleteMarkerGroup = (
  context: CommandValidationContext,
  command: DeleteMarkerGroupCommand,
): void => {
  const group = context.document.markerGroups[command.payload.groupId]
    ?? invalid(`Marker group ${command.payload.groupId} does not exist.`);
  if (group.kind === 'builtin') invalid('Built-in marker groups cannot be deleted.');
};

const applyDeleteMarkerGroup = (
  document: Draft<MindMapDocumentV1>,
  command: DeleteMarkerGroupCommand,
): void => {
  const definitionIds = new Set(
    Object.values(document.markerDefinitions)
      .filter((definition) => definition.groupId === command.payload.groupId)
      .map((definition) => definition.id),
  );
  deleteMarkerDefinitionsFromDocument(document, definitionIds);
  delete document.markerGroups[command.payload.groupId];
};

const validateCreateMarkerDefinition = (
  context: CommandValidationContext,
  command: CreateMarkerDefinitionCommand,
): void => {
  const { definition } = command.payload;
  const schema = validateMindMapMarkerDefinitionSchema(definition);
  if (!schema.valid) invalid(validationSummary('Marker definition', schema.errors));
  assertMarkerName(definition.name, 'Marker definition name');
  assertNewCanonicalEntityId(context.document, definition.id, 'Marker definition');
  assertMarkerDefinitionReferences(context.document, definition);
  if (context.document.markerGroups[definition.groupId]?.kind !== 'custom') {
    invalid('Marker definitions can only be added interactively to custom groups.');
  }
  assertUniqueMarkerDefinitionOrderKeys(context.document, new Map(), [definition]);
};

const applyCreateMarkerDefinition = (
  document: Draft<MindMapDocumentV1>,
  command: CreateMarkerDefinitionCommand,
): void => {
  document.markerDefinitions[command.payload.definition.id] = command.payload.definition;
};

const validateUpdateMarkerDefinition = (
  context: CommandValidationContext,
  command: UpdateMarkerDefinitionCommand,
): void => {
  const { definition } = command.payload;
  const current = context.document.markerDefinitions[definition.id]
    ?? invalid(`Marker definition ${definition.id} does not exist.`);
  const schema = validateMindMapMarkerDefinitionSchema(definition);
  if (!schema.valid) invalid(validationSummary('Marker definition', schema.errors));
  if (current.groupId !== definition.groupId) invalid('Marker definition groupId is immutable.');
  if (context.document.markerGroups[current.groupId]?.kind !== 'custom') {
    invalid('Built-in marker definitions cannot be updated.');
  }
  assertMarkerName(definition.name, 'Marker definition name');
  assertMarkerDefinitionReferences(context.document, definition);
  assertUniqueMarkerDefinitionOrderKeys(
    context.document,
    new Map([[definition.id, definition.orderKey]]),
  );
};

const applyUpdateMarkerDefinition = (
  document: Draft<MindMapDocumentV1>,
  command: UpdateMarkerDefinitionCommand,
): void => {
  document.markerDefinitions[command.payload.definition.id] = command.payload.definition;
};

const validateReorderMarkerDefinition = (
  context: CommandValidationContext,
  command: ReorderMarkerDefinitionCommand,
): void => {
  const { updates } = command.payload;
  if (!Array.isArray(updates) || updates.length === 0) {
    invalid('Marker definition reorder requires at least one update.');
  }
  const replacements = new Map<string, string>();
  for (const update of updates) {
    if (!context.document.markerDefinitions[update.definitionId]) {
      invalid(`Marker definition ${update.definitionId} does not exist.`);
    }
    const definition = context.document.markerDefinitions[update.definitionId];
    if (context.document.markerGroups[definition.groupId]?.kind !== 'custom') {
      invalid('Built-in marker definitions cannot be reordered.');
    }
    if (replacements.has(update.definitionId)) {
      invalid(`Marker definition ${update.definitionId} is repeated.`);
    }
    assertCanonicalOrderKey(update.orderKey, 'Marker definition orderKey');
    replacements.set(update.definitionId, update.orderKey);
  }
  assertUniqueMarkerDefinitionOrderKeys(context.document, replacements);
};

const applyReorderMarkerDefinition = (
  document: Draft<MindMapDocumentV1>,
  command: ReorderMarkerDefinitionCommand,
): void => {
  for (const update of command.payload.updates) {
    document.markerDefinitions[update.definitionId].orderKey = update.orderKey;
  }
};

const validateDeleteMarkerDefinition = (
  context: CommandValidationContext,
  command: DeleteMarkerDefinitionCommand,
): void => {
  const definition = context.document.markerDefinitions[command.payload.definitionId];
  if (!definition) {
    invalid(`Marker definition ${command.payload.definitionId} does not exist.`);
  }
  if (context.document.markerGroups[definition.groupId]?.kind !== 'custom') {
    invalid('Built-in marker definitions cannot be deleted.');
  }
};

const applyDeleteMarkerDefinition = (
  document: Draft<MindMapDocumentV1>,
  command: DeleteMarkerDefinitionCommand,
): void => {
  deleteMarkerDefinitionsFromDocument(document, new Set([command.payload.definitionId]));
};

const markerDefinitionGroupId = (
  document: MindMapDocumentV1,
  definitionId: string,
): string => document.markerDefinitions[definitionId as keyof typeof document.markerDefinitions]
  ?.groupId ?? invalid(`Marker definition ${definitionId} does not exist.`);

const assertMarkerCandidate = (
  context: CommandValidationContext,
  marker: AttachMarkerCommand['payload']['marker'],
  mode: 'attach' | 'update',
): void => {
  const sheet = getSheet(context);
  const schema = validateMindMapMarkerInstanceSchema(marker);
  if (!schema.valid) invalid(validationSummary('Marker instance', schema.errors));
  assertTopicExists(sheet, marker.topicId);
  const targetGroupId = markerDefinitionGroupId(context.document, marker.markerDefinitionId);
  const targetGroup = context.document.markerGroups[
    targetGroupId as keyof typeof context.document.markerGroups
  ]
    ?? invalid(`Marker group ${targetGroupId} does not exist.`);
  const current = sheet.markerInstances[marker.id];
  if (mode === 'attach') {
    assertNewCanonicalEntityId(context.document, marker.id, 'Marker instance');
  } else {
    if (!current) invalid(`Marker instance ${marker.id} does not exist in this Sheet.`);
    if (current.topicId !== marker.topicId) invalid('Marker instance topicId is immutable.');
  }

  const ignoredForFinalOrder = new Set<string>(mode === 'update' ? [marker.id] : []);
  for (const candidate of Object.values(sheet.markerInstances)) {
    if (candidate.topicId !== marker.topicId || candidate.id === marker.id) continue;
    const candidateGroupId = markerDefinitionGroupId(
      context.document,
      candidate.markerDefinitionId,
    );
    if (targetGroup.exclusive && candidateGroupId === targetGroupId) {
      ignoredForFinalOrder.add(candidate.id);
      continue;
    }
    if (candidate.markerDefinitionId === marker.markerDefinitionId) {
      invalid(`Topic ${marker.topicId} already has marker definition ${marker.markerDefinitionId}.`);
    }
  }
  assertCanonicalOrderKey(marker.orderKey, 'Marker instance orderKey');
  for (const candidate of Object.values(sheet.markerInstances)) {
    if (
      candidate.topicId === marker.topicId
      && !ignoredForFinalOrder.has(candidate.id)
      && candidate.orderKey === marker.orderKey
    ) invalid(`Topic ${marker.topicId} already uses marker orderKey ${marker.orderKey}.`);
  }
};

const applyMarkerCandidate = (
  document: Draft<MindMapDocumentV1>,
  sheetId: AttachMarkerCommand['sheetId'],
  marker: AttachMarkerCommand['payload']['marker'],
): void => {
  const sheet = document.sheets[sheetId];
  const definition = document.markerDefinitions[marker.markerDefinitionId];
  const group = document.markerGroups[definition.groupId];
  if (group.exclusive) {
    for (const candidate of Object.values(sheet.markerInstances)) {
      const candidateDefinition = document.markerDefinitions[candidate.markerDefinitionId];
      if (
        candidate.id !== marker.id
        && candidate.topicId === marker.topicId
        && candidateDefinition?.groupId === group.id
      ) delete sheet.markerInstances[candidate.id];
    }
  }
  sheet.markerInstances[marker.id] = marker;
};

const validateAttachMarker = (
  context: CommandValidationContext,
  command: AttachMarkerCommand,
): void => assertMarkerCandidate(context, command.payload.marker, 'attach');

const applyAttachMarker = (
  document: Draft<MindMapDocumentV1>,
  command: AttachMarkerCommand,
): void => applyMarkerCandidate(document, command.sheetId, command.payload.marker);

const validateUpdateMarker = (
  context: CommandValidationContext,
  command: UpdateMarkerCommand,
): void => assertMarkerCandidate(context, command.payload.marker, 'update');

const applyUpdateMarker = (
  document: Draft<MindMapDocumentV1>,
  command: UpdateMarkerCommand,
): void => applyMarkerCandidate(document, command.sheetId, command.payload.marker);

const validateDetachMarker = (
  context: CommandValidationContext,
  command: DetachMarkerCommand,
): void => {
  if (!getSheet(context).markerInstances[command.payload.markerInstanceId]) {
    invalid(`Marker instance ${command.payload.markerInstanceId} does not exist.`);
  }
};

const applyDetachMarker = (
  document: Draft<MindMapDocumentV1>,
  command: DetachMarkerCommand,
): void => {
  delete document.sheets[command.sheetId].markerInstances[command.payload.markerInstanceId];
};

const validatePatchMarkerLegend = (
  context: CommandValidationContext,
  command: PatchMarkerLegendCommand,
): void => {
  const patch = command.payload.patch as Record<string, unknown>;
  const keys = Object.keys(patch);
  if (keys.length === 0 || keys.some((key) => !['visible', 'title', 'style'].includes(key))) {
    invalid('Marker legend patch must contain only visible, title, or style.');
  }
  const candidate = { ...getSheet(context).markerLegend };
  if (patch.visible !== undefined) {
    if (typeof patch.visible !== 'boolean') invalid('Marker legend visible must be boolean.');
    candidate.visible = patch.visible as boolean;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'title')) {
    if (patch.title === null) delete candidate.title;
    else {
      assertMarkerName(patch.title, 'Marker legend title');
      candidate.title = patch.title as string;
    }
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'style')) {
    if (patch.style === null) delete candidate.style;
    else candidate.style = patch.style as typeof candidate.style;
  }
  const schema = validateMindMapMarkerLegendSchema(candidate);
  if (!schema.valid) invalid(validationSummary('Marker legend', schema.errors));
};

const applyPatchMarkerLegend = (
  document: Draft<MindMapDocumentV1>,
  command: PatchMarkerLegendCommand,
): void => {
  const legend = document.sheets[command.sheetId].markerLegend;
  const { patch } = command.payload;
  if (patch.visible !== undefined) legend.visible = patch.visible;
  if (patch.title === null) delete legend.title;
  else if (patch.title !== undefined) legend.title = patch.title;
  if (patch.style === null) delete legend.style;
  else if (patch.style !== undefined) legend.style = patch.style;
};

const validateMoveMarkerLegend = (
  context: CommandValidationContext,
  command: MoveMarkerLegendCommand,
): void => {
  const { x, y } = command.payload.position;
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    invalid('Marker legend position must contain finite x/y coordinates.');
  }
  const schema = validateMindMapMarkerLegendSchema({
    ...getSheet(context).markerLegend,
    position: { x, y },
  });
  if (!schema.valid) invalid(validationSummary('Marker legend', schema.errors));
};

const applyMoveMarkerLegend = (
  document: Draft<MindMapDocumentV1>,
  command: MoveMarkerLegendCommand,
): void => {
  document.sheets[command.sheetId].markerLegend.position = command.payload.position;
};

const validateReorderMarkerLegendItems = (
  context: CommandValidationContext,
  command: ReorderMarkerLegendItemsCommand,
): void => {
  const { itemOrder } = command.payload;
  if (!Array.isArray(itemOrder)) invalid('Marker legend itemOrder must be an array.');
  const seen = new Set<string>();
  for (const definitionId of itemOrder) {
    if (seen.has(definitionId)) invalid(`Marker legend repeats definition ${definitionId}.`);
    if (!context.document.markerDefinitions[definitionId]) {
      invalid(`Marker definition ${definitionId} does not exist.`);
    }
    seen.add(definitionId);
  }
  const schema = validateMindMapMarkerLegendSchema({
    ...getSheet(context).markerLegend,
    itemOrder,
  });
  if (!schema.valid) invalid(validationSummary('Marker legend', schema.errors));
};

const applyReorderMarkerLegendItems = (
  document: Draft<MindMapDocumentV1>,
  command: ReorderMarkerLegendItemsCommand,
): void => {
  document.sheets[command.sheetId].markerLegend.itemOrder = [...command.payload.itemOrder];
};

const validateUpsertNote = (
  context: CommandValidationContext,
  command: UpsertNoteCommand,
): void => {
  const sheet = getSheet(context);
  const { note } = command.payload;
  const schema = validateMindMapNoteSchema(note);
  if (!schema.valid) invalid(validationSummary('Note', schema.errors));
  assertTopicExists(sheet, note.topicId);
  const current = sheet.notes[note.id];
  if (current && current.topicId !== note.topicId) {
    invalid('A Note ID cannot be moved to another Topic.');
  }
  const duplicate = Object.values(sheet.notes).find(
    (candidate) => candidate.id !== note.id && candidate.topicId === note.topicId,
  );
  if (duplicate) invalid(`Topic ${note.topicId} already owns Note ${duplicate.id}.`);
  for (const candidateSheet of Object.values(context.document.sheets)) {
    if (candidateSheet.id !== sheet.id && candidateSheet.notes[note.id]) {
      invalid(`Note ID ${note.id} already exists in another Sheet.`);
    }
  }
};

const applyUpsertNote = (
  document: Draft<MindMapDocumentV1>,
  command: UpsertNoteCommand,
): void => {
  document.sheets[command.sheetId].notes[command.payload.note.id] = command.payload.note;
};

const validateDeleteNote = (
  context: CommandValidationContext,
  command: DeleteNoteCommand,
): void => {
  if (!getSheet(context).notes[command.payload.noteId]) {
    invalid(`Note ${command.payload.noteId} does not exist.`);
  }
};

const applyDeleteNote = (
  document: Draft<MindMapDocumentV1>,
  command: DeleteNoteCommand,
): void => {
  delete document.sheets[command.sheetId].notes[command.payload.noteId];
};

const CONTROL_OR_WHITESPACE_IN_SCHEME = /[\u0000-\u001f\u007f\s]/;

const assertSafeTopicLink = (
  context: CommandValidationContext,
  command: UpsertLinkCommand,
): void => {
  const { link } = command.payload;
  if (link.kind === 'web' || link.kind === 'email' || link.kind === 'file' || link.kind === 'folder') {
    const href = link.href.trim();
    const schemeEnd = href.indexOf(':');
    if (!href || schemeEnd < 1 || CONTROL_OR_WHITESPACE_IN_SCHEME.test(href.slice(0, schemeEnd + 1))) {
      invalid('Topic Link requires an absolute, allowlisted URL.');
    }
    const allowed = link.kind === 'web'
      ? /^https?:\/\//i.test(href)
      : link.kind === 'email'
        ? /^mailto:/i.test(href)
        : /^file:/i.test(href);
    if (!allowed || /^(?:javascript|data|vbscript|blob):/i.test(href)) {
      invalid(`Unsafe ${link.kind} Link URL was rejected.`);
    }
    return;
  }
  if (link.kind === 'sheet') {
    if (link.status === 'active' && !context.document.sheets[link.targetSheetId]) {
      invalid(`Active Link target Sheet ${link.targetSheetId} does not exist.`);
    }
    return;
  }
  if (link.kind === 'topic' && link.status === 'active') {
    const targetSheet = context.document.sheets[link.targetSheetId];
    if (!targetSheet?.topics[link.targetTopicId]) {
      invalid(`Active Link target Topic ${link.targetTopicId} does not exist.`);
    }
  }
};

const validateUpsertLink = (
  context: CommandValidationContext,
  command: UpsertLinkCommand,
): void => {
  const sheet = getSheet(context);
  const { link } = command.payload;
  const schema = validateMindMapTopicLinkSchema(link);
  if (!schema.valid) invalid(validationSummary('Topic Link', schema.errors));
  assertTopicExists(sheet, link.topicId);
  const existing = sheet.links[link.id];
  if (existing && existing.topicId !== link.topicId) {
    invalid('A Topic Link ID cannot be moved to another Topic.');
  }
  for (const candidateSheet of Object.values(context.document.sheets)) {
    if (candidateSheet.id !== sheet.id && candidateSheet.links[link.id]) {
      invalid(`Topic Link ID ${link.id} already exists in another Sheet.`);
    }
  }
  if (Object.values(sheet.audioClips).some((audio) => audio.topicId === link.topicId)) {
    invalid('Audio-note Topics cannot own Links.');
  }
  assertSafeTopicLink(context, command);
};

const applyUpsertLink = (
  document: Draft<MindMapDocumentV1>,
  command: UpsertLinkCommand,
): void => {
  document.sheets[command.sheetId].links[command.payload.link.id] = command.payload.link;
};

const validateDeleteLink = (
  context: CommandValidationContext,
  command: DeleteLinkCommand,
): void => {
  if (!getSheet(context).links[command.payload.linkId]) {
    invalid(`Topic Link ${command.payload.linkId} does not exist.`);
  }
};

const applyDeleteLink = (
  document: Draft<MindMapDocumentV1>,
  command: DeleteLinkCommand,
): void => {
  delete document.sheets[command.sheetId].links[command.payload.linkId];
};

const validateUpsertTodo = (
  context: CommandValidationContext,
  command: UpsertTodoCommand,
): void => {
  const sheet = getSheet(context);
  const { todo } = command.payload;
  const schema = validateMindMapTopicTodoSchema(todo);
  if (!schema.valid) invalid(validationSummary('Topic To-do', schema.errors));
  assertTopicExists(sheet, todo.topicId);
  if (!todo.completed && todo.completedAt !== undefined) {
    invalid('An incomplete Topic To-do cannot have completedAt.');
  }
  const current = sheet.todos[todo.id];
  if (current && current.topicId !== todo.topicId) {
    invalid('A Topic To-do ID cannot be moved to another Topic.');
  }
  const duplicate = Object.values(sheet.todos).find(
    (candidate) => candidate.id !== todo.id && candidate.topicId === todo.topicId,
  );
  if (duplicate) invalid(`Topic ${todo.topicId} already owns To-do ${duplicate.id}.`);
  for (const candidateSheet of Object.values(context.document.sheets)) {
    if (candidateSheet.id !== sheet.id && candidateSheet.todos[todo.id]) {
      invalid(`Topic To-do ID ${todo.id} already exists in another Sheet.`);
    }
  }
};

const applyUpsertTodo = (
  document: Draft<MindMapDocumentV1>,
  command: UpsertTodoCommand,
): void => {
  document.sheets[command.sheetId].todos[command.payload.todo.id] = command.payload.todo;
};

const validateDeleteTodo = (
  context: CommandValidationContext,
  command: DeleteTodoCommand,
): void => {
  if (!getSheet(context).todos[command.payload.todoId]) {
    invalid(`Topic To-do ${command.payload.todoId} does not exist.`);
  }
};

const applyDeleteTodo = (
  document: Draft<MindMapDocumentV1>,
  command: DeleteTodoCommand,
): void => {
  delete document.sheets[command.sheetId].todos[command.payload.todoId];
};

const validateBatchUpdateTodos = (
  context: CommandValidationContext,
  command: BatchUpdateTodosCommand,
): void => {
  const sheet = getSheet(context);
  const { upserts, deleteTodoIds } = command.payload;
  if (!Array.isArray(upserts) || !Array.isArray(deleteTodoIds)) {
    invalid('A To-do batch requires upserts and deleteTodoIds arrays.');
  }
  if (upserts.length === 0 && deleteTodoIds.length === 0) {
    invalid('A To-do batch cannot be empty.');
  }

  const deleteIds = new Set(deleteTodoIds);
  if (deleteIds.size !== deleteTodoIds.length) {
    invalid('A To-do batch cannot contain duplicate delete IDs.');
  }
  for (const todoId of deleteTodoIds) {
    if (!sheet.todos[todoId]) invalid(`Topic To-do ${todoId} does not exist.`);
  }

  const upsertIds = new Set<string>();
  const upsertTopicIds = new Set<TopicId>();
  for (const todo of upserts) {
    const schema = validateMindMapTopicTodoSchema(todo);
    if (!schema.valid) invalid(validationSummary('Topic To-do', schema.errors));
    assertTopicExists(sheet, todo.topicId);
    if (!todo.completed && todo.completedAt !== undefined) {
      invalid('An incomplete Topic To-do cannot have completedAt.');
    }
    if (upsertIds.has(todo.id)) invalid(`Duplicate To-do upsert ID ${todo.id}.`);
    if (upsertTopicIds.has(todo.topicId)) {
      invalid(`Topic ${todo.topicId} appears more than once in a To-do batch.`);
    }
    if (deleteIds.has(todo.id)) {
      invalid(`To-do ${todo.id} cannot be upserted and deleted in the same batch.`);
    }
    upsertIds.add(todo.id);
    upsertTopicIds.add(todo.topicId);

    const current = sheet.todos[todo.id];
    if (current && current.topicId !== todo.topicId) {
      invalid('A Topic To-do ID cannot be moved to another Topic.');
    }
    const duplicate = Object.values(sheet.todos).find(
      (candidate) => candidate.id !== todo.id && candidate.topicId === todo.topicId,
    );
    if (duplicate) {
      invalid(`Topic ${todo.topicId} already owns To-do ${duplicate.id}; preserve its stable ID.`);
    }
    for (const candidateSheet of Object.values(context.document.sheets)) {
      if (candidateSheet.id !== sheet.id && candidateSheet.todos[todo.id]) {
        invalid(`Topic To-do ID ${todo.id} already exists in another Sheet.`);
      }
    }
  }
};

const applyBatchUpdateTodos = (
  document: Draft<MindMapDocumentV1>,
  command: BatchUpdateTodosCommand,
): void => {
  const todos = document.sheets[command.sheetId].todos;
  for (const todoId of command.payload.deleteTodoIds) delete todos[todoId];
  for (const todo of command.payload.upserts) todos[todo.id] = todo;
};

const validateUpsertTask = (
  context: CommandValidationContext,
  command: UpsertTaskCommand,
): void => {
  const sheet = getSheet(context);
  const { task } = command.payload;
  const schema = validateMindMapTopicTaskSchema(task);
  if (!schema.valid) invalid(validationSummary('Topic Task', schema.errors));
  assertTopicExists(sheet, task.topicId);

  if (task.status === 'not-started' && task.progress !== 0) {
    invalid('A not-started Task must have exactly 0% progress.');
  }
  if (task.status === 'done' && task.progress !== 1) {
    invalid('A done Task must have exactly 100% progress.');
  }
  if (task.status === 'in-progress' && !(task.progress > 0 && task.progress < 1)) {
    invalid('An in-progress Task must have progress strictly between 0% and 100%.');
  }
  if (
    (task.status === 'blocked' || task.status === 'cancelled')
    && !(task.progress >= 0 && task.progress < 1)
  ) {
    invalid('A blocked or cancelled Task may preserve progress below 100%, but cannot appear done.');
  }
  if (task.durationMinutes !== undefined && task.durationMinutes <= 0) {
    invalid('Task durationMinutes must be a positive integer when present.');
  }
  if (task.startDate && task.dueDate && task.dueDate < task.startDate) {
    invalid('Task dueDate cannot be earlier than startDate.');
  }

  const assigneeIds = task.assigneeIds ?? [];
  const uniqueAssigneeIds = new Set(assigneeIds);
  if (uniqueAssigneeIds.size !== assigneeIds.length) {
    invalid('Task assigneeIds cannot contain duplicates.');
  }
  for (const actorId of assigneeIds) {
    if (!context.document.actors[actorId]) {
      invalid(`Task assignee ${actorId} does not exist.`);
    }
  }
  if (task.displayFields?.includes('creator')) {
    const createdBy = task.audit?.createdBy;
    if (!createdBy || !context.document.actors[createdBy]) {
      invalid('Displaying the Task creator requires a resolvable audit.createdBy actor.');
    }
  }

  const current = sheet.tasks[task.id];
  if (current && current.topicId !== task.topicId) {
    invalid('A Topic Task ID cannot be moved to another Topic.');
  }
  const duplicate = Object.values(sheet.tasks).find(
    (candidate) => candidate.id !== task.id && candidate.topicId === task.topicId,
  );
  if (duplicate) invalid(`Topic ${task.topicId} already owns Task ${duplicate.id}.`);
  for (const candidateSheet of Object.values(context.document.sheets)) {
    if (candidateSheet.id !== sheet.id && candidateSheet.tasks[task.id]) {
      invalid(`Topic Task ID ${task.id} already exists in another Sheet.`);
    }
  }
};

const applyUpsertTask = (
  document: Draft<MindMapDocumentV1>,
  command: UpsertTaskCommand,
): void => {
  document.sheets[command.sheetId].tasks[command.payload.task.id] = command.payload.task;
};

const validateDeleteTask = (
  context: CommandValidationContext,
  command: DeleteTaskCommand,
): void => {
  if (!getSheet(context).tasks[command.payload.taskId]) {
    invalid(`Topic Task ${command.payload.taskId} does not exist.`);
  }
};

const applyDeleteTask = (
  document: Draft<MindMapDocumentV1>,
  command: DeleteTaskCommand,
): void => {
  const sheet = document.sheets[command.sheetId];
  delete sheet.tasks[command.payload.taskId];
  for (const dependency of Object.values(sheet.taskDependencies)) {
    if (
      dependency.predecessorTaskId === command.payload.taskId
      || dependency.successorTaskId === command.payload.taskId
    ) {
      delete sheet.taskDependencies[dependency.id];
    }
  }
};

const taskDependencyGraphHasCycle = (
  sheet: MindMapSheet,
  candidate: TaskDependency,
): boolean => {
  const adjacency = new Map<string, string[]>();
  const addArc = (from: string, to: string): void => {
    const targets = adjacency.get(from);
    if (targets) targets.push(to);
    else adjacency.set(from, [to]);
  };
  for (const dependency of Object.values(sheet.taskDependencies)) {
    if (dependency.id === candidate.id) continue;
    addArc(dependency.predecessorTaskId, dependency.successorTaskId);
  }
  addArc(candidate.predecessorTaskId, candidate.successorTaskId);

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (taskId: string): boolean => {
    if (visiting.has(taskId)) return true;
    if (visited.has(taskId)) return false;
    visiting.add(taskId);
    for (const successorId of adjacency.get(taskId) ?? []) {
      if (visit(successorId)) return true;
    }
    visiting.delete(taskId);
    visited.add(taskId);
    return false;
  };
  return Object.keys(sheet.tasks).some(visit);
};

const validateUpsertTaskDependency = (
  context: CommandValidationContext,
  command: UpsertTaskDependencyCommand,
): void => {
  const sheet = getSheet(context);
  const { dependency } = command.payload;
  const schema = validateMindMapTaskDependencySchema(dependency);
  if (!schema.valid) invalid(validationSummary('Task dependency', schema.errors));

  if (!sheet.tasks[dependency.predecessorTaskId]) {
    invalid(`Task dependency predecessor ${dependency.predecessorTaskId} must belong to the current Sheet.`);
  }
  if (!sheet.tasks[dependency.successorTaskId]) {
    invalid(`Task dependency successor ${dependency.successorTaskId} must belong to the current Sheet.`);
  }
  if (dependency.predecessorTaskId === dependency.successorTaskId) {
    invalid('A Task cannot depend on itself.');
  }
  if (
    dependency.lagMinutes !== undefined
    && (
      !Number.isSafeInteger(dependency.lagMinutes)
      || dependency.lagMinutes < -525_960_000
      || dependency.lagMinutes > 525_960_000
    )
  ) {
    invalid('Task dependency lagMinutes must be a safe integer between -525960000 and 525960000.');
  }

  for (const candidateSheet of Object.values(context.document.sheets)) {
    if (
      candidateSheet.id !== sheet.id
      && candidateSheet.taskDependencies[dependency.id]
    ) {
      invalid(`Task dependency ID ${dependency.id} already exists in another Sheet.`);
    }
  }
  const duplicate = Object.values(sheet.taskDependencies).find(
    (candidate) => candidate.id !== dependency.id
      && candidate.predecessorTaskId === dependency.predecessorTaskId
      && candidate.successorTaskId === dependency.successorTaskId
      && candidate.type === dependency.type,
  );
  if (duplicate) {
    invalid(`Task dependency duplicates existing dependency ${duplicate.id}.`);
  }
  if (taskDependencyGraphHasCycle(sheet, dependency)) {
    invalid('Task dependency would introduce a directed cycle.');
  }
};

const applyUpsertTaskDependency = (
  document: Draft<MindMapDocumentV1>,
  command: UpsertTaskDependencyCommand,
): void => {
  const { dependency } = command.payload;
  document.sheets[command.sheetId].taskDependencies[dependency.id] = dependency;
};

const validateDeleteTaskDependency = (
  context: CommandValidationContext,
  command: DeleteTaskDependencyCommand,
): void => {
  if (!getSheet(context).taskDependencies[command.payload.dependencyId]) {
    invalid(`Task dependency ${command.payload.dependencyId} does not exist.`);
  }
};

const applyDeleteTaskDependency = (
  document: Draft<MindMapDocumentV1>,
  command: DeleteTaskDependencyCommand,
): void => {
  delete document.sheets[command.sheetId]
    .taskDependencies[command.payload.dependencyId];
};

const validateReparentTopic = (
  context: CommandValidationContext,
  command: ReparentTopicCommand,
): void => {
  const sheet = getSheet(context);
  const { edge, topicId } = command.payload;
  assertTopicExists(sheet, topicId);
  assertTopicExists(sheet, edge.parentTopicId);
  if (topicId === sheet.rootTopicId) invalid('The central root topic cannot be reparented.');
  const topic = sheet.topics[topicId];
  if (topic.role === 'central' || topic.role === 'summary-result') {
    invalid(`Topic role ${topic.role} cannot be reparented into the main tree.`);
  }
  if (edge.childTopicId !== topicId) {
    invalid(`Replacement edge ${edge.id} must target topic ${topicId}.`);
  }
  if (wouldCreateCycle(sheet, edge.parentTopicId, topicId)) {
    invalid(`Moving topic ${topicId} below ${edge.parentTopicId} would create a cycle.`);
  }
  assertNonEmptyOrderKey(edge.orderKey);

  const incoming = getIncomingTreeEdges(sheet, topicId);
  if (incoming.length > 1) {
    invalid(`Topic ${topicId} has multiple incoming tree edges.`);
  }
  const currentEdgeIds = new Set(incoming.map((candidate) => candidate.id));
  if (incoming.length === 1 && edge.id !== incoming[0].id) {
    invalid(`Reparenting topic ${topicId} must preserve incoming TreeEdge ID ${incoming[0].id}.`);
  }
  const collision = sheet.treeEdges[edge.id];
  if (collision && !currentEdgeIds.has(collision.id)) {
    invalid(`Replacement edge ID ${edge.id} belongs to another topic.`);
  }
  assertUniqueSiblingOrderKey(sheet, edge, currentEdgeIds);
  const after = simulateReparentTopic(sheet, command);
  validateSummaryScopeChanges(
    context.document,
    sheet,
    after,
    command.payload.summaryScopeChanges,
  );
  validateBoundaryScopeChanges(
    context.document,
    sheet,
    projectSummaryScopeNormalizationAfter(sheet, after),
    command.payload.boundaryScopeChanges,
  );
};

const applyReparentTopic = (
  document: Draft<MindMapDocumentV1>,
  command: ReparentTopicCommand,
): void => {
  const sheet = document.sheets[command.sheetId];
  for (const edge of Object.values(sheet.treeEdges)) {
    if (edge.childTopicId === command.payload.topicId) delete sheet.treeEdges[edge.id];
  }
  const topic = sheet.topics[command.payload.topicId];
  if (topic.role === 'floating-root') {
    topic.role = 'regular';
    topic.placement = { mode: 'auto' };
  }
  sheet.treeEdges[command.payload.edge.id] = command.payload.edge;
  applySummaryScopeChanges(sheet, command.payload.summaryScopeChanges);
  applyBoundaryScopeChanges(sheet, command.payload.boundaryScopeChanges);
  cleanupDanglingDocumentReferences(document);
};

const validateReorderTopic = (
  context: CommandValidationContext,
  command: ReorderTopicCommand,
): void => {
  const sheet = getSheet(context);
  assertTopicExists(sheet, command.payload.topicId);
  assertNonEmptyOrderKey(command.payload.orderKey);
  const incoming = getIncomingTreeEdges(sheet, command.payload.topicId);
  if (incoming.length !== 1) {
    invalid(`Topic ${command.payload.topicId} must have exactly one incoming edge to reorder.`);
  }
  const candidate = { ...incoming[0], orderKey: command.payload.orderKey };
  if (command.payload.side !== undefined) candidate.side = command.payload.side;
  if (command.payload.slot === null) delete candidate.slot;
  else if (command.payload.slot !== undefined) candidate.slot = command.payload.slot;
  assertUniqueSiblingOrderKey(sheet, candidate, new Set([incoming[0].id]));
  const after = simulateReorderTopic(sheet, command);
  validateSummaryScopeChanges(
    context.document,
    sheet,
    after,
    command.payload.summaryScopeChanges,
  );
  validateBoundaryScopeChanges(
    context.document,
    sheet,
    projectSummaryScopeNormalizationAfter(sheet, after),
    command.payload.boundaryScopeChanges,
  );
};

const applyReorderTopic = (
  document: Draft<MindMapDocumentV1>,
  command: ReorderTopicCommand,
): void => {
  const sheet = document.sheets[command.sheetId];
  const incoming = Object.values(sheet.treeEdges).find(
    (edge) => edge.childTopicId === command.payload.topicId,
  );
  if (!incoming) return;
  incoming.orderKey = command.payload.orderKey;
  if (command.payload.side !== undefined) incoming.side = command.payload.side;
  if (command.payload.slot === null) {
    delete incoming.slot;
  } else if (command.payload.slot !== undefined) {
    incoming.slot = command.payload.slot;
  }
  applySummaryScopeChanges(sheet, command.payload.summaryScopeChanges);
  applyBoundaryScopeChanges(sheet, command.payload.boundaryScopeChanges);
  cleanupDanglingDocumentReferences(document);
};

const compareTextAscii = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const compareTreeEdges = (left: TreeEdge, right: TreeEdge): number =>
  compareTextAscii(left.orderKey, right.orderKey) || compareTextAscii(left.id, right.id);

const deepEqual = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => deepEqual(value, right[index]));
  }
  if (
    typeof left !== 'object'
    || left === null
    || typeof right !== 'object'
    || right === null
  ) return false;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) =>
      key === rightKeys[index] && deepEqual(leftRecord[key], rightRecord[key]));
};

const documentContainsEntityId = (document: MindMapDocumentV1, id: string): boolean => {
  const visit = (value: unknown): boolean => {
    if (!value || typeof value !== 'object') return false;
    if (!Array.isArray(value) && (value as { id?: unknown }).id === id) return true;
    return Object.values(value).some(visit);
  };
  return visit(document);
};

const validateBoundaryScopeChanges = (
  document: MindMapDocumentV1,
  before: MindMapSheet,
  after: MindMapSheet,
  supplied: readonly BoundaryScopeChange[] | undefined,
): void => {
  const expected = planBoundaryScopeNormalizations(before, after);
  const actual = [...(supplied ?? [])];
  if (actual.length !== expected.length) {
    invalid(`Boundary normalization requires ${expected.length} change(s), received ${actual.length}.`);
  }
  const actualById = new Map(actual.map((change) => [change.boundaryId, change]));
  if (actualById.size !== actual.length) invalid('Boundary normalization repeats a source ID.');
  const allocated = new Set<string>();
  for (const plan of expected) {
    const change = actualById.get(plan.boundaryId)
      ?? invalid(`Boundary normalization is missing source ${plan.boundaryId}.`);
    if (!Array.isArray(change.replacements) || change.replacements.length !== plan.scopes.length) {
      invalid(
        `Boundary ${plan.boundaryId} requires ${plan.scopes.length} replacement range(s).`,
      );
    }
    change.replacements.forEach((replacement, index) => {
      if (index === 0 && replacement.boundaryId !== plan.boundaryId) {
        invalid(`Boundary ${plan.boundaryId} must retain its ID for the first range.`);
      }
      if (!deepEqual(replacement.scope, plan.scopes[index])) {
        invalid(`Boundary ${plan.boundaryId} replacement ${index} has a non-canonical scope.`);
      }
      if (index > 0) {
        if (allocated.has(replacement.boundaryId)) {
          invalid(`Boundary split ID ${replacement.boundaryId} is allocated more than once.`);
        }
        if (documentContainsEntityId(document, replacement.boundaryId)) {
          invalid(`Boundary split ID ${replacement.boundaryId} already exists in the document.`);
        }
        allocated.add(replacement.boundaryId);
      }
    });
  }
};

const applyBoundaryScopeChanges = (
  sheet: Draft<MindMapSheet>,
  changes: readonly BoundaryScopeChange[] | undefined,
): void => {
  for (const change of changes ?? []) {
    const source = sheet.boundaries[change.boundaryId];
    if (!source) continue;
    if (change.replacements.length === 0) {
      for (const relationship of Object.values(sheet.relationships)) {
        const sourceRef = relationship.source.element;
        const targetRef = relationship.target.element;
        if (
          (sourceRef.kind === 'boundary' && sourceRef.boundaryId === change.boundaryId)
          || (targetRef.kind === 'boundary' && targetRef.boundaryId === change.boundaryId)
        ) delete sheet.relationships[relationship.id];
      }
      delete sheet.boundaries[change.boundaryId];
      continue;
    }
    const sourceSnapshot = structuredClone(current(source) as Boundary);
    for (const replacement of change.replacements) {
      sheet.boundaries[replacement.boundaryId] = {
        ...structuredClone(sourceSnapshot),
        id: replacement.boundaryId,
        scope: structuredClone(replacement.scope),
      } as Draft<Boundary>;
    }
  }
};

const summaryCloneCollections = (clone: SummaryResultSubtreeClone): readonly (readonly {
  readonly id: string;
}[])[] => [
  clone.topics,
  clone.treeEdges,
  clone.boundaries,
  clone.summaries,
  clone.callouts,
  clone.relationships,
  clone.zones,
  clone.markerInstances,
  clone.notes,
  clone.links,
  clone.attachments,
  clone.images,
  clone.equations,
  clone.audioClips,
  clone.todos,
  clone.tasks,
  clone.taskDependencies,
];

const scopeIsInsideTopicSet = (
  sheet: MindMapSheet,
  scope: TopicScope,
  topicIds: ReadonlySet<TopicId>,
): boolean => {
  const members = expandSemanticTopicScope(sheet, scope);
  return members.length > 0 && members.every((topicId) => topicIds.has(topicId));
};

const clonedScopeMatchesSource = (
  source: TopicScope,
  cloned: TopicScope,
  topicMap: ReadonlyMap<TopicId, TopicId>,
  edgeMap: ReadonlyMap<TreeEdgeId, TreeEdgeId>,
): boolean => {
  if (source.kind !== cloned.kind) return false;
  if (source.kind === 'explicit' && cloned.kind === 'explicit') {
    return deepEqual(cloned.topicIds, source.topicIds.map((topicId) => topicMap.get(topicId)));
  }
  if (source.kind === 'subtree' && cloned.kind === 'subtree') {
    return cloned.rootTopicId === topicMap.get(source.rootTopicId)
      && cloned.depth === source.depth;
  }
  if (source.kind === 'sibling-range' && cloned.kind === 'sibling-range') {
    return cloned.parentTopicId === topicMap.get(source.parentTopicId)
      && cloned.firstEdgeId === edgeMap.get(source.firstEdgeId)
      && cloned.lastEdgeId === edgeMap.get(source.lastEdgeId)
      && cloned.includeDescendants === source.includeDescendants;
  }
  return false;
};

const validateSummaryResultSubtreeClone = (
  document: MindMapDocumentV1,
  sheet: MindMapSheet,
  sourceSummaryId: SummaryId,
  sourceResultTopicId: TopicId,
  clone: SummaryResultSubtreeClone,
  expectedResultTopicId: TopicId,
  allocated: Set<string>,
): void => {
  if (!clone || typeof clone !== 'object') invalid('Summary split requires a result subtree clone.');
  for (const [name, values] of Object.entries(clone)) {
    if (!Array.isArray(values)) invalid(`Summary result clone ${name} must be an array.`);
  }
  const closure = collectSummaryResultSemanticClosure(
    sheet,
    sourceResultTopicId,
    new Set([sourceSummaryId]),
  );
  const sourceTopics = closure.topicIds
    .map((topicId) => sheet.topics[topicId])
    .filter((topic): topic is NonNullable<typeof topic> => Boolean(topic));
  if (clone.topics.length !== sourceTopics.length || clone.topics.length === 0) {
    invalid('Summary split must clone the complete result Topic subtree.');
  }
  const topicMap = new Map<TopicId, TopicId>();
  clone.topics.forEach((topic, index) => {
    assertEntityPayload(topic, 'Cloned Summary result Topic');
    const source = sourceTopics[index];
    if (!source) invalid('Summary split Topic order does not match the source result subtree.');
    const normalized = { ...structuredClone(topic), id: source.id };
    if (!deepEqual(normalized, source)) {
      invalid(`Cloned Summary result Topic ${topic.id} does not preserve source content.`);
    }
    topicMap.set(source.id, topic.id);
  });
  if (clone.topics[0].id !== expectedResultTopicId) {
    invalid('Summary split resultTopicId must reference the cloned result root.');
  }
  const clonedTopicIds = new Set(clone.topics.map((topic) => topic.id));
  if (clonedTopicIds.size !== clone.topics.length) invalid('Summary split repeats a cloned Topic ID.');
  const sourceTopicIds = new Set(sourceTopics.map((topic) => topic.id));
  const sourceEdges = Object.values(sheet.treeEdges)
    .filter((edge) => sourceTopicIds.has(edge.parentTopicId) && sourceTopicIds.has(edge.childTopicId))
    .sort(compareTreeEdges);
  if (clone.treeEdges.length !== sourceEdges.length) {
    invalid('Summary split must clone every result subtree TreeEdge.');
  }
  const edgeMap = new Map<TreeEdgeId, TreeEdgeId>();
  clone.treeEdges.forEach((edge, index) => {
    assertEntityPayload(edge, 'Cloned Summary result TreeEdge');
    const source = sourceEdges[index];
    const normalized = {
      ...structuredClone(edge),
      id: source.id,
      parentTopicId: source.parentTopicId,
      childTopicId: source.childTopicId,
    };
    if (
      !clonedTopicIds.has(edge.parentTopicId)
      || !clonedTopicIds.has(edge.childTopicId)
      || edge.parentTopicId !== topicMap.get(source.parentTopicId)
      || edge.childTopicId !== topicMap.get(source.childTopicId)
      || !deepEqual(normalized, source)
    ) invalid(`Cloned TreeEdge ${edge.id} does not mirror its source edge.`);
    edgeMap.set(source.id, edge.id);
  });
  const incomingCounts = new Map<TopicId, number>();
  for (const edge of clone.treeEdges) {
    incomingCounts.set(edge.childTopicId, (incomingCounts.get(edge.childTopicId) ?? 0) + 1);
  }
  const clonedResultRootIds = new Set<TopicId>([
    expectedResultTopicId,
    ...clone.summaries.map((summary) => summary.resultTopicId),
  ]);
  clone.topics.forEach((topic) => {
    const expected = clonedResultRootIds.has(topic.id) ? 0 : 1;
    if ((incomingCounts.get(topic.id) ?? 0) !== expected) {
      invalid(`Cloned Summary result Topic ${topic.id} has an invalid parent count.`);
    }
  });

  const sourceNestedSummaries = closure.summaryIds.map((summaryId) => sheet.summaries[summaryId]);
  if (clone.summaries.length !== sourceNestedSummaries.length) {
    invalid('Summary split must clone every fully-contained nested Summary.');
  }
  sourceNestedSummaries.forEach((source, index) => {
    const cloned = clone.summaries[index];
    if (!cloned) invalid('Nested Summary clone order does not match its source.');
    if (
      !clonedScopeMatchesSource(source.scope, cloned.scope, topicMap, edgeMap)
      || cloned.resultTopicId !== topicMap.get(source.resultTopicId)
    ) invalid(`Nested Summary ${cloned.id} has non-remapped scope/result references.`);
    const normalized = {
      ...structuredClone(cloned),
      id: source.id,
      scope: structuredClone(source.scope),
      resultTopicId: source.resultTopicId,
    };
    if (!deepEqual(normalized, source)) {
      invalid(`Nested Summary ${cloned.id} does not preserve source content.`);
    }
  });

  const sourceBoundaries = Object.values(sheet.boundaries)
    .filter((boundary) => scopeIsInsideTopicSet(sheet, boundary.scope, sourceTopicIds))
    .sort((left, right) => compareTextAscii(left.id, right.id));
  if (clone.boundaries.length !== sourceBoundaries.length) {
    invalid('Summary split must clone every fully-contained Boundary.');
  }
  const boundaryMap = new Map<string, string>();
  sourceBoundaries.forEach((source, index) => {
    const cloned = clone.boundaries[index];
    if (!cloned) invalid('Boundary clone order does not match its source.');
    if (!clonedScopeMatchesSource(source.scope, cloned.scope, topicMap, edgeMap)) {
      invalid(`Boundary ${cloned.id} has a non-remapped scope.`);
    }
    const normalized = {
      ...structuredClone(cloned),
      id: source.id,
      scope: structuredClone(source.scope),
    };
    if (!deepEqual(normalized, source)) {
      invalid(`Boundary ${cloned.id} does not preserve source content.`);
    }
    boundaryMap.set(source.id, cloned.id);
  });

  const sourceCallouts = Object.values(sheet.callouts)
    .filter((callout) => sourceTopicIds.has(callout.targetTopicId))
    .sort((left, right) => compareTextAscii(left.id, right.id));
  if (clone.callouts.length !== sourceCallouts.length) {
    invalid('Summary split must clone every result-subtree Callout.');
  }
  const calloutMap = new Map<string, string>();
  sourceCallouts.forEach((source, index) => {
    const cloned = clone.callouts[index];
    if (!cloned) invalid('Callout clone order does not match its source.');
    const normalized = {
      ...structuredClone(cloned),
      id: source.id,
      targetTopicId: source.targetTopicId,
    };
    if (
      cloned.targetTopicId !== topicMap.get(source.targetTopicId)
      || !deepEqual(normalized, source)
    ) invalid(`Callout ${cloned.id} does not preserve/remap source content.`);
    calloutMap.set(source.id, cloned.id);
  });

  const sourceZones = Object.values(sheet.zones)
    .filter((zone) => zone.rootTopicIds.length > 0
      && zone.rootTopicIds.every((topicId) => sourceTopicIds.has(topicId)))
    .sort((left, right) => compareTextAscii(left.id, right.id));
  if (clone.zones.length !== sourceZones.length) {
    invalid('Summary split Zone payload does not match its fully-contained source Zones.');
  }
  const zoneMap = new Map<string, string>();
  sourceZones.forEach((source, index) => {
    const cloned = clone.zones[index];
    if (!cloned) invalid('Zone clone order does not match its source.');
    const normalized = {
      ...structuredClone(cloned),
      id: source.id,
      rootTopicIds: structuredClone(source.rootTopicIds),
    };
    if (
      !deepEqual(cloned.rootTopicIds, source.rootTopicIds.map((topicId) => topicMap.get(topicId)))
      || !deepEqual(normalized, source)
    ) invalid(`Zone ${cloned.id} does not preserve/remap source content.`);
    zoneMap.set(source.id, cloned.id);
  });

  const remappedTarget = (target: RelationshipTargetRef): RelationshipTargetRef | undefined => {
    if (target.kind === 'topic') {
      const topicId = topicMap.get(target.topicId);
      return topicId ? { kind: 'topic', topicId } : undefined;
    }
    if (target.kind === 'boundary') {
      const boundaryId = boundaryMap.get(target.boundaryId) as Boundary['id'] | undefined;
      return boundaryId ? { kind: 'boundary', boundaryId } : undefined;
    }
    if (target.kind === 'callout') {
      const calloutId = calloutMap.get(target.calloutId) as keyof typeof sheet.callouts | undefined;
      return calloutId ? { kind: 'callout', calloutId } : undefined;
    }
    const zoneId = zoneMap.get(target.zoneId) as Zone['id'] | undefined;
    return zoneId ? { kind: 'zone', zoneId } : undefined;
  };
  const sourceRelationships = Object.values(sheet.relationships)
    .filter((relationship) =>
      remappedTarget(relationship.source.element) !== undefined
      && remappedTarget(relationship.target.element) !== undefined)
    .sort((left, right) => compareTextAscii(left.id, right.id));
  if (clone.relationships.length !== sourceRelationships.length) {
    invalid('Summary split must clone exactly the Relationships with two contained endpoints.');
  }
  sourceRelationships.forEach((source, index) => {
    const cloned = clone.relationships[index];
    if (!cloned) invalid('Relationship clone order does not match its source.');
    if (
      !deepEqual(cloned.source.element, remappedTarget(source.source.element))
      || !deepEqual(cloned.target.element, remappedTarget(source.target.element))
    ) invalid(`Relationship ${cloned.id} does not fully remap both endpoints.`);
    const sourcePoints = source.controlPoints
      ? Object.values(source.controlPoints).sort((left, right) => compareTextAscii(left.id, right.id))
      : [];
    const clonedPoints = cloned.controlPoints ? Object.values(cloned.controlPoints) : [];
    if (sourcePoints.length !== clonedPoints.length) {
      invalid(`Relationship ${cloned.id} control-point count changed during cloning.`);
    }
    sourcePoints.forEach((point, pointIndex) => {
      const clonedPoint = clonedPoints[pointIndex];
      if (!clonedPoint || cloned.controlPoints?.[clonedPoint.id] !== clonedPoint) {
        invalid(`Relationship ${cloned.id} has a malformed control-point record.`);
      }
      if (allocated.has(clonedPoint.id) || documentContainsEntityId(document, clonedPoint.id)) {
        invalid(`Summary split control-point ID ${clonedPoint.id} is already in use.`);
      }
      allocated.add(clonedPoint.id);
      if (!deepEqual({ ...structuredClone(clonedPoint), id: point.id }, point)) {
        invalid(`Relationship ${cloned.id} control point does not preserve source geometry.`);
      }
    });
    const normalized = {
      ...structuredClone(cloned),
      id: source.id,
      source: structuredClone(source.source),
      target: structuredClone(source.target),
      ...(source.controlPoints === undefined ? { controlPoints: undefined } : {
        controlPoints: structuredClone(source.controlPoints),
      }),
    };
    if (source.controlPoints === undefined) delete normalized.controlPoints;
    if (!deepEqual(normalized, source)) {
      invalid(`Relationship ${cloned.id} does not preserve source styling/routing.`);
    }
  });

  const topicOwnedCollections = [
    clone.markerInstances,
    clone.notes,
    clone.links,
    clone.attachments,
    clone.images,
    clone.equations,
    clone.audioClips,
    clone.todos,
    clone.tasks,
  ] as const;
  for (const collection of topicOwnedCollections) {
    for (const entity of collection) {
      if (!clonedTopicIds.has(entity.topicId)) {
        invalid(`Cloned entity ${entity.id} targets a Topic outside its result subtree.`);
      }
    }
  }
  const sourceTopicOwnedCollections = [
    ['marker instance', Object.values(sheet.markerInstances), clone.markerInstances],
    ['note', Object.values(sheet.notes), clone.notes],
    ['link', Object.values(sheet.links), clone.links],
    ['attachment', Object.values(sheet.attachments), clone.attachments],
    ['image', Object.values(sheet.images), clone.images],
    ['equation', Object.values(sheet.equations), clone.equations],
    ['audio clip', Object.values(sheet.audioClips), clone.audioClips],
    ['todo', Object.values(sheet.todos), clone.todos],
    ['task', Object.values(sheet.tasks), clone.tasks],
  ] as const;
  const taskMap = new Map<string, string>();
  for (const [label, sourceValues, clonedValues] of sourceTopicOwnedCollections) {
    const sources = sourceValues
      .filter((entity) => sourceTopicIds.has(entity.topicId))
      .sort((left, right) => compareTextAscii(left.id, right.id));
    if (sources.length !== clonedValues.length) {
      invalid(`Summary split must clone every result subtree ${label}.`);
    }
    sources.forEach((source, index) => {
      const cloned = clonedValues[index] as typeof source | undefined;
      if (!cloned) {
        invalid(`Summary split ${label} order does not match its source.`);
        return;
      }
      const normalized = {
        ...structuredClone(cloned),
        id: source.id,
        topicId: source.topicId,
      } as typeof source;
      const normalizedRecord = normalized as unknown as Record<string, unknown>;
      const sourceRecord = source as unknown as Record<string, unknown>;
      if (
        label === 'link'
        && normalizedRecord.kind === 'topic'
        && normalizedRecord.targetSheetId === sheet.id
        && sourceRecord.kind === 'topic'
        && sourceRecord.targetSheetId === sheet.id
        && sourceTopicIds.has(sourceRecord.targetTopicId as TopicId)
      ) normalizedRecord.targetTopicId = sourceRecord.targetTopicId;
      if (!deepEqual(normalized, source)) {
        invalid(`Cloned ${label} ${cloned.id} does not preserve source content.`);
      }
      if (label === 'task') taskMap.set(source.id, cloned.id);
    });
  }
  const clonedTaskIds = new Set(clone.tasks.map((task) => task.id));
  for (const dependency of clone.taskDependencies) {
    if (
      !clonedTaskIds.has(dependency.predecessorTaskId)
      || !clonedTaskIds.has(dependency.successorTaskId)
    ) invalid(`Cloned task dependency ${dependency.id} escapes its result subtree.`);
  }
  const sourceDependencies = Object.values(sheet.taskDependencies)
    .filter((dependency) =>
      taskMap.has(dependency.predecessorTaskId) && taskMap.has(dependency.successorTaskId))
    .sort((left, right) => compareTextAscii(left.id, right.id));
  if (sourceDependencies.length !== clone.taskDependencies.length) {
    invalid('Summary split must clone every internal result-subtree task dependency.');
  }
  sourceDependencies.forEach((source, index) => {
    const cloned = clone.taskDependencies[index];
    const normalized = {
      ...structuredClone(cloned),
      id: source.id,
      predecessorTaskId: source.predecessorTaskId,
      successorTaskId: source.successorTaskId,
    };
    if (
      cloned.predecessorTaskId !== taskMap.get(source.predecessorTaskId)
      || cloned.successorTaskId !== taskMap.get(source.successorTaskId)
      || !deepEqual(normalized, source)
    ) invalid(`Cloned task dependency ${cloned.id} does not preserve source content.`);
  });
  for (const collection of summaryCloneCollections(clone)) {
    for (const entity of collection) {
      if (allocated.has(entity.id)) invalid(`Summary split ID ${entity.id} is allocated more than once.`);
      if (documentContainsEntityId(document, entity.id)) {
        invalid(`Summary split ID ${entity.id} already exists in the document.`);
      }
      allocated.add(entity.id);
    }
  }
};

const validateSummaryScopeChanges = (
  document: MindMapDocumentV1,
  before: MindMapSheet,
  after: MindMapSheet,
  supplied: readonly SummaryScopeChange[] | undefined,
): void => {
  const expected = planSummaryScopeNormalizations(before, after);
  const actual = [...(supplied ?? [])];
  if (actual.length !== expected.length) {
    invalid(`Summary normalization requires ${expected.length} change(s), received ${actual.length}.`);
  }
  const actualById = new Map(actual.map((change) => [change.summaryId, change]));
  if (actualById.size !== actual.length) invalid('Summary normalization repeats a source ID.');
  const allocated = new Set<string>();
  for (const plan of expected) {
    const source = before.summaries[plan.summaryId]
      ?? invalid(`Summary normalization source ${plan.summaryId} does not exist.`);
    const change = actualById.get(plan.summaryId)
      ?? invalid(`Summary normalization is missing source ${plan.summaryId}.`);
    if (!Array.isArray(change.replacements) || change.replacements.length !== plan.scopes.length) {
      invalid(`Summary ${plan.summaryId} requires ${plan.scopes.length} replacement range(s).`);
    }
    change.replacements.forEach((replacement, index) => {
      if (!replacement || typeof replacement !== 'object') {
        invalid(`Summary ${plan.summaryId} replacement ${index} must be an object.`);
      }
      const summary = replacement.summary;
      assertEntityPayload(summary, 'Summary scope replacement');
      if (!deepEqual(summary.scope, plan.scopes[index])) {
        invalid(`Summary ${plan.summaryId} replacement ${index} has a non-canonical scope.`);
      }
      const normalizedSummary = {
        ...structuredClone(summary),
        id: source.id,
        scope: structuredClone(source.scope),
        resultTopicId: source.resultTopicId,
      };
      if (!deepEqual(normalizedSummary, source)) {
        invalid(`Summary ${plan.summaryId} replacement ${index} does not preserve source styling.`);
      }
      if (index === 0) {
        if (summary.id !== source.id || summary.resultTopicId !== source.resultTopicId) {
          invalid(`Summary ${plan.summaryId} must retain its IDs for the first range.`);
        }
        if (replacement.resultSubtree !== undefined) {
          invalid(`Summary ${plan.summaryId} first range cannot replace its result subtree.`);
        }
      } else {
        if (allocated.has(summary.id) || documentContainsEntityId(document, summary.id)) {
          invalid(`Summary split ID ${summary.id} is already in use.`);
        }
        allocated.add(summary.id);
        validateSummaryResultSubtreeClone(
          document,
          before,
          source.id,
          source.resultTopicId,
          replacement.resultSubtree
            ?? invalid(`Summary ${plan.summaryId} split ${index} is missing its result subtree.`),
          summary.resultTopicId,
          allocated,
        );
      }
    });
  }
};

const deleteExactTopicEntities = (
  sheet: Draft<MindMapSheet>,
  topicIds: ReadonlySet<TopicId>,
): void => {
  if (topicIds.size === 0) return;
  const deletedCalloutIds = new Set(
    Object.values(sheet.callouts)
      .filter((callout) => topicIds.has(callout.targetTopicId))
      .map((callout) => callout.id),
  );
  const deletedZoneIds = new Set(
    Object.values(sheet.zones)
      .filter((zone) => zone.rootTopicIds.length > 0
        && zone.rootTopicIds.every((topicId) => topicIds.has(topicId)))
      .map((zone) => zone.id),
  );
  for (const topicId of topicIds) delete sheet.topics[topicId];
  for (const edge of Object.values(sheet.treeEdges)) {
    if (topicIds.has(edge.parentTopicId) || topicIds.has(edge.childTopicId)) {
      delete sheet.treeEdges[edge.id];
    }
  }
  for (const summary of Object.values(sheet.summaries)) {
    if (topicIds.has(summary.resultTopicId)) delete sheet.summaries[summary.id];
  }
  for (const calloutId of deletedCalloutIds) delete sheet.callouts[calloutId];
  for (const zone of Object.values(sheet.zones)) {
    if (deletedZoneIds.has(zone.id)) delete sheet.zones[zone.id];
    else zone.rootTopicIds = zone.rootTopicIds.filter((topicId) => !topicIds.has(topicId));
  }
  for (const relationship of Object.values(sheet.relationships)) {
    const targets = [relationship.source.element, relationship.target.element];
    if (targets.some((target) =>
      (target.kind === 'topic' && topicIds.has(target.topicId))
      || (target.kind === 'callout' && deletedCalloutIds.has(target.calloutId))
      || (target.kind === 'zone' && deletedZoneIds.has(target.zoneId)))) {
      delete sheet.relationships[relationship.id];
    }
  }
  for (const marker of Object.values(sheet.markerInstances)) {
    if (topicIds.has(marker.topicId)) delete sheet.markerInstances[marker.id];
  }
  for (const note of Object.values(sheet.notes)) {
    if (topicIds.has(note.topicId)) delete sheet.notes[note.id];
  }
  for (const link of Object.values(sheet.links)) {
    if (topicIds.has(link.topicId)) delete sheet.links[link.id];
  }
  for (const attachment of Object.values(sheet.attachments)) {
    if (topicIds.has(attachment.topicId)) delete sheet.attachments[attachment.id];
  }
  for (const image of Object.values(sheet.images)) {
    if (topicIds.has(image.topicId)) delete sheet.images[image.id];
  }
  for (const equation of Object.values(sheet.equations)) {
    if (topicIds.has(equation.topicId)) delete sheet.equations[equation.id];
  }
  for (const audio of Object.values(sheet.audioClips)) {
    if (topicIds.has(audio.topicId)) delete sheet.audioClips[audio.id];
  }
  for (const todo of Object.values(sheet.todos)) {
    if (topicIds.has(todo.topicId)) delete sheet.todos[todo.id];
  }
  const deletedTaskIds = new Set(
    Object.values(sheet.tasks)
      .filter((task) => topicIds.has(task.topicId))
      .map((task) => task.id),
  );
  for (const taskId of deletedTaskIds) delete sheet.tasks[taskId];
  for (const dependency of Object.values(sheet.taskDependencies)) {
    if (
      deletedTaskIds.has(dependency.predecessorTaskId)
      || deletedTaskIds.has(dependency.successorTaskId)
    ) delete sheet.taskDependencies[dependency.id];
  }
};

const insertSummaryResultSubtreeClone = (
  sheet: Draft<MindMapSheet>,
  clone: SummaryResultSubtreeClone,
): void => {
  for (const topic of clone.topics) sheet.topics[topic.id] = structuredClone(topic);
  for (const edge of clone.treeEdges) sheet.treeEdges[edge.id] = structuredClone(edge);
  for (const boundary of clone.boundaries) sheet.boundaries[boundary.id] = structuredClone(boundary);
  for (const summary of clone.summaries) sheet.summaries[summary.id] = structuredClone(summary);
  for (const callout of clone.callouts) sheet.callouts[callout.id] = structuredClone(callout);
  for (const relationship of clone.relationships) {
    sheet.relationships[relationship.id] = structuredClone(relationship);
  }
  for (const zone of clone.zones) sheet.zones[zone.id] = structuredClone(zone);
  for (const marker of clone.markerInstances) sheet.markerInstances[marker.id] = structuredClone(marker);
  for (const note of clone.notes) sheet.notes[note.id] = structuredClone(note);
  for (const link of clone.links) sheet.links[link.id] = structuredClone(link);
  for (const attachment of clone.attachments) sheet.attachments[attachment.id] = structuredClone(attachment);
  for (const image of clone.images) sheet.images[image.id] = structuredClone(image);
  for (const equation of clone.equations) sheet.equations[equation.id] = structuredClone(equation);
  for (const audio of clone.audioClips) sheet.audioClips[audio.id] = structuredClone(audio);
  for (const todo of clone.todos) sheet.todos[todo.id] = structuredClone(todo);
  for (const task of clone.tasks) sheet.tasks[task.id] = structuredClone(task);
  for (const dependency of clone.taskDependencies) {
    sheet.taskDependencies[dependency.id] = structuredClone(dependency);
  }
};

const applySummaryScopeChanges = (
  sheet: Draft<MindMapSheet>,
  changes: readonly SummaryScopeChange[] | undefined,
): void => {
  const readable = sheet as unknown as MindMapSheet;
  const deletedTopicIds = new Set<TopicId>();
  for (const change of changes ?? []) {
    if (change.replacements.length !== 0) continue;
    const source = readable.summaries[change.summaryId];
    if (!source || !readable.topics[source.resultTopicId]) continue;
    deletedTopicIds.add(source.resultTopicId);
    for (const topic of getDescendants(readable, source.resultTopicId)) {
      deletedTopicIds.add(topic.id);
    }
  }
  deleteExactTopicEntities(sheet, deletedTopicIds);
  for (const change of changes ?? []) {
    if (change.replacements.length === 0) {
      delete sheet.summaries[change.summaryId];
      continue;
    }
    for (const replacement of change.replacements) {
      if (replacement.resultSubtree) insertSummaryResultSubtreeClone(sheet, replacement.resultSubtree);
      sheet.summaries[replacement.summary.id] = structuredClone(replacement.summary);
    }
  }
};

const simulateReparentTopic = (
  sheet: MindMapSheet,
  command: ReparentTopicCommand,
): MindMapSheet => {
  const after = structuredClone(sheet);
  for (const edge of Object.values(after.treeEdges)) {
    if (edge.childTopicId === command.payload.topicId) delete after.treeEdges[edge.id];
  }
  after.treeEdges[command.payload.edge.id] = structuredClone(command.payload.edge);
  return after;
};

const simulateReorderTopic = (
  sheet: MindMapSheet,
  command: ReorderTopicCommand,
): MindMapSheet => {
  const after = structuredClone(sheet);
  const incoming = Object.values(after.treeEdges).find(
    (edge) => edge.childTopicId === command.payload.topicId,
  );
  if (!incoming) return after;
  incoming.orderKey = command.payload.orderKey;
  if (command.payload.side !== undefined) incoming.side = command.payload.side;
  if (command.payload.slot === null) delete incoming.slot;
  else if (command.payload.slot !== undefined) incoming.slot = command.payload.slot;
  return after;
};

const simulateDeleteCurrentTopic = (
  sheet: MindMapSheet,
  command: DeleteCurrentTopicCommand,
): MindMapSheet => {
  const after = structuredClone(sheet);
  const incoming = Object.values(after.treeEdges).find(
    (edge) => edge.childTopicId === command.payload.topicId,
  );
  if (!incoming) return after;
  for (const update of command.payload.siblingOrderUpdates) {
    if (after.treeEdges[update.edgeId]) after.treeEdges[update.edgeId].orderKey = update.orderKey;
  }
  delete after.treeEdges[incoming.id];
  for (const edge of command.payload.promotedEdges) {
    after.treeEdges[edge.id] = structuredClone(edge);
  }
  delete after.topics[command.payload.topicId];
  return after;
};

const validateDeleteCurrentTopic = (
  context: CommandValidationContext,
  command: DeleteCurrentTopicCommand,
): void => {
  const sheet = getSheet(context);
  const { promotedEdges, siblingOrderUpdates, topicId } = command.payload;
  assertTopicExists(sheet, topicId);
  const topic = sheet.topics[topicId];
  if (topicId === sheet.rootTopicId || topic.role === 'central') {
    invalid('The sheet central root cannot be deleted while preserving its children.');
  }
  if (topic.role === 'floating-root' || topic.role === 'summary-result') {
    invalid(`Topic role ${topic.role} has no structural parent for child promotion.`);
  }
  const incomingEdges = getIncomingTreeEdges(sheet, topicId);
  if (incomingEdges.length !== 1) {
    invalid(`Topic ${topicId} must have exactly one incoming edge for child promotion.`);
  }
  if (!Array.isArray(promotedEdges) || !Array.isArray(siblingOrderUpdates)) {
    invalid('Delete-current payload requires promotedEdges and siblingOrderUpdates arrays.');
  }

  const incoming = incomingEdges[0];
  const directChildren = Object.values(sheet.treeEdges)
    .filter((edge) => edge.parentTopicId === topicId)
    .sort(compareTreeEdges);
  if (promotedEdges.length !== directChildren.length) {
    invalid('Delete-current must promote every direct structural child exactly once.');
  }
  const promotedIds = new Set<TreeEdgeId>();
  promotedEdges.forEach((promoted, index) => {
    const original = directChildren[index];
    assertEntityPayload(promoted, 'Promoted tree edge');
    if (promoted.id !== original?.id || promoted.childTopicId !== original.childTopicId) {
      invalid('Promoted edges must preserve the original child-edge order, IDs, and children.');
    }
    if (promotedIds.has(promoted.id)) invalid(`Promoted edge ${promoted.id} is repeated.`);
    promotedIds.add(promoted.id);
    if (promoted.parentTopicId !== incoming.parentTopicId) {
      invalid(`Promoted edge ${promoted.id} must target the deleted topic's parent.`);
    }
    if (
      promoted.side !== incoming.side
      || !sameOptionalString(promoted.slot, incoming.slot)
    ) {
      invalid(`Promoted edge ${promoted.id} must inherit the deleted topic's side and slot.`);
    }
    assertCanonicalOrderKey(promoted.orderKey, `Promoted edge ${promoted.id} orderKey`);
    if (
      !deepEqual(promoted.style, original.style)
      || !deepEqual(promoted.audit, original.audit)
      || !deepEqual(promoted.extensions, original.extensions)
    ) {
      invalid(`Promoted edge ${promoted.id} must preserve style, audit, and extensions.`);
    }
    if (wouldCreateCycle(sheet, incoming.parentTopicId, promoted.childTopicId)) {
      invalid(`Promoting topic ${promoted.childTopicId} would create a structural cycle.`);
    }
  });

  const group = Object.values(sheet.treeEdges)
    .filter((edge) =>
      edge.parentTopicId === incoming.parentTopicId
      && edge.side === incoming.side
      && sameOptionalString(edge.slot, incoming.slot))
    .sort(compareTreeEdges);
  const groupIds = new Set(group.map((edge) => edge.id));
  const orderUpdates = new Map<TreeEdgeId, string>();
  for (const update of siblingOrderUpdates) {
    if (!update || typeof update !== 'object') invalid('Sibling order update must be an object.');
    if (orderUpdates.has(update.edgeId)) invalid(`Sibling edge ${update.edgeId} is updated twice.`);
    const edge = sheet.treeEdges[update.edgeId];
    if (!edge || !groupIds.has(update.edgeId) || update.edgeId === incoming.id) {
      invalid(`Sibling order update ${update.edgeId} is outside the affected sibling group.`);
    }
    assertCanonicalOrderKey(update.orderKey, `Sibling edge ${update.edgeId} orderKey`);
    if (update.orderKey === edge.orderKey) {
      invalid(`Sibling order update ${update.edgeId} must change its orderKey.`);
    }
    orderUpdates.set(update.edgeId, update.orderKey);
  }

  const expectedIds = group.flatMap((edge) =>
    edge.id === incoming.id ? directChildren.map((child) => child.id) : [edge.id]);
  const finalGroup = [
    ...group
      .filter((edge) => edge.id !== incoming.id)
      .map((edge) => ({ ...edge, orderKey: orderUpdates.get(edge.id) ?? edge.orderKey })),
    ...promotedEdges,
  ].sort(compareTreeEdges);
  const finalKeys = new Set<string>();
  for (const edge of finalGroup) {
    if (finalKeys.has(edge.orderKey)) {
      invalid(`Delete-current produces duplicate sibling orderKey ${edge.orderKey}.`);
    }
    finalKeys.add(edge.orderKey);
  }
  if (
    finalGroup.length !== expectedIds.length
    || finalGroup.some((edge, index) => edge.id !== expectedIds[index])
  ) {
    invalid('Delete-current replacement keys must preserve the exact sibling and child order.');
  }
  const after = simulateDeleteCurrentTopic(sheet, command);
  validateSummaryScopeChanges(
    context.document,
    sheet,
    after,
    command.payload.summaryScopeChanges,
  );
  validateBoundaryScopeChanges(
    context.document,
    sheet,
    projectSummaryScopeNormalizationAfter(sheet, after),
    command.payload.boundaryScopeChanges,
  );
};

const relationshipTouchesDeletedEntity = (
  target: RelationshipTargetRef,
  deletedTopicIds: ReadonlySet<string>,
  deletedBoundaryIds: ReadonlySet<string>,
  deletedCalloutIds: ReadonlySet<string>,
  deletedZoneIds: ReadonlySet<string>,
): boolean => {
  if (target.kind === 'topic') return deletedTopicIds.has(target.topicId);
  if (target.kind === 'boundary') return deletedBoundaryIds.has(target.boundaryId);
  if (target.kind === 'callout') return deletedCalloutIds.has(target.calloutId);
  return deletedZoneIds.has(target.zoneId);
};

const elementReferenceExists = (
  document: Draft<MindMapDocumentV1>,
  kind: string,
  id: string,
): boolean => Object.values(document.sheets).some((sheet) => {
  if (kind === 'topic') return sheet.topics[id as keyof typeof sheet.topics] !== undefined;
  if (kind === 'relationship') {
    return sheet.relationships[id as keyof typeof sheet.relationships] !== undefined;
  }
  if (kind === 'boundary') return sheet.boundaries[id as keyof typeof sheet.boundaries] !== undefined;
  if (kind === 'summary') return sheet.summaries[id as keyof typeof sheet.summaries] !== undefined;
  if (kind === 'callout') return sheet.callouts[id as keyof typeof sheet.callouts] !== undefined;
  if (kind === 'zone') return sheet.zones[id as keyof typeof sheet.zones] !== undefined;
  return false;
});

/** Keeps document-level projections canonical after sheet entities disappear. */
const cleanupDanglingDocumentReferences = (
  document: Draft<MindMapDocumentV1>,
): void => {
  for (const sourceSheet of Object.values(document.sheets)) {
    for (const link of Object.values(sourceSheet.links)) {
      if (link.kind !== 'topic' || link.status !== 'active') continue;
      const targetSheet = document.sheets[link.targetSheetId];
      if (!targetSheet?.topics[link.targetTopicId]) link.status = 'broken';
    }
  }

  for (const view of Object.values(document.savedViews)) {
    const sheet = document.sheets[view.sheetId];
    if (!sheet) continue;
    if (view.focusedBranchRootId && !sheet.topics[view.focusedBranchRootId]) {
      delete view.focusedBranchRootId;
    }
    if (view.foldOverrides) {
      for (const topicId of Object.keys(view.foldOverrides)) {
        if (!sheet.topics[topicId as keyof typeof sheet.topics]) {
          delete view.foldOverrides[topicId as keyof typeof view.foldOverrides];
        }
      }
    }
    if (view.selection) {
      view.selection = view.selection.filter((reference) =>
        elementReferenceExists(document, reference.kind, reference.id));
    }
  }

  for (const deck of Object.values(document.presentations)) {
    const sheet = document.sheets[deck.sheetId];
    if (!sheet) continue;
    if (deck.settings.includedTopicIds) {
      deck.settings.includedTopicIds = deck.settings.includedTopicIds.filter(
        (topicId) => sheet.topics[topicId] !== undefined,
      );
    }
    if (deck.settings.excludedTopicIds) {
      deck.settings.excludedTopicIds = deck.settings.excludedTopicIds.filter(
        (topicId) => sheet.topics[topicId] !== undefined,
      );
    }
    for (const slide of Object.values(deck.slides)) {
      const target = slide.target;
      const missingTarget =
        (target.kind === 'topic' && !sheet.topics[target.topicId])
        || (target.kind === 'boundary' && !sheet.boundaries[target.boundaryId])
        || (target.kind === 'zone' && !sheet.zones[target.zoneId]);
      if (missingTarget) {
        delete deck.slides[slide.id];
        continue;
      }
      if (slide.narrationAudioId && !sheet.audioClips[slide.narrationAudioId]) {
        delete slide.narrationAudioId;
      }
      if (slide.imageOverrides) {
        for (const imageId of Object.keys(slide.imageOverrides)) {
          if (!sheet.images[imageId as keyof typeof sheet.images]) {
            delete slide.imageOverrides[imageId as keyof typeof slide.imageOverrides];
          }
        }
      }
      for (const build of Object.values(slide.builds)) {
        const missingBuildTarget = build.target.kind === 'topic'
          ? !sheet.topics[build.target.topicId]
          : !sheet.relationships[build.target.relationshipId];
        if (missingBuildTarget) delete slide.builds[build.id];
      }
    }
  }

  const threads = document.collaboration?.commentThreads;
  if (threads) {
    for (const thread of Object.values(threads)) {
      if (
        thread.anchor.kind !== 'canvas'
        && !elementReferenceExists(document, thread.anchor.kind, thread.anchor.id)
      ) thread.orphaned = true;
    }
  }
};

const applyDeleteCurrentTopic = (
  document: Draft<MindMapDocumentV1>,
  command: DeleteCurrentTopicCommand,
): void => {
  const sheet = document.sheets[command.sheetId];
  const readableSheet = sheet as unknown as MindMapSheet;
  const { promotedEdges, siblingOrderUpdates, topicId } = command.payload;
  const incoming = getIncomingTreeEdges(readableSheet, topicId)[0];
  if (!incoming) return;

  for (const update of siblingOrderUpdates) {
    sheet.treeEdges[update.edgeId].orderKey = update.orderKey;
  }
  delete sheet.treeEdges[incoming.id];
  for (const edge of promotedEdges) sheet.treeEdges[edge.id] = edge;
  delete sheet.topics[topicId];

  const deletedBoundaryIds = new Set<string>(
    (command.payload.boundaryScopeChanges ?? [])
      .filter((change) => change.replacements.length === 0)
      .map((change) => change.boundaryId),
  );
  const deletedCalloutIds = new Set(
    Object.values(sheet.callouts)
      .filter((callout) => callout.targetTopicId === topicId)
      .map((callout) => callout.id),
  );
  for (const calloutId of deletedCalloutIds) delete sheet.callouts[calloutId];

  const deletedTopicIds = new Set<string>([topicId]);
  for (const relationship of Object.values(sheet.relationships)) {
    if (
      relationshipTouchesDeletedEntity(
        relationship.source.element,
        deletedTopicIds,
        deletedBoundaryIds,
        deletedCalloutIds,
        new Set(),
      )
      || relationshipTouchesDeletedEntity(
        relationship.target.element,
        deletedTopicIds,
        deletedBoundaryIds,
        deletedCalloutIds,
        new Set(),
      )
    ) delete sheet.relationships[relationship.id];
  }

  for (const marker of Object.values(sheet.markerInstances)) {
    if (marker.topicId === topicId) delete sheet.markerInstances[marker.id];
  }
  for (const note of Object.values(sheet.notes)) {
    if (note.topicId === topicId) delete sheet.notes[note.id];
  }
  for (const link of Object.values(sheet.links)) {
    if (link.topicId === topicId) delete sheet.links[link.id];
  }
  for (const attachment of Object.values(sheet.attachments)) {
    if (attachment.topicId === topicId) delete sheet.attachments[attachment.id];
  }
  for (const image of Object.values(sheet.images)) {
    if (image.topicId === topicId) delete sheet.images[image.id];
  }
  for (const equation of Object.values(sheet.equations)) {
    if (equation.topicId === topicId) delete sheet.equations[equation.id];
  }
  for (const audio of Object.values(sheet.audioClips)) {
    if (audio.topicId === topicId) delete sheet.audioClips[audio.id];
  }
  for (const todo of Object.values(sheet.todos)) {
    if (todo.topicId === topicId) delete sheet.todos[todo.id];
  }
  const deletedTaskIds = new Set(
    Object.values(sheet.tasks)
      .filter((task) => task.topicId === topicId)
      .map((task) => task.id),
  );
  for (const taskId of deletedTaskIds) delete sheet.tasks[taskId];
  for (const dependency of Object.values(sheet.taskDependencies)) {
    if (
      deletedTaskIds.has(dependency.predecessorTaskId)
      || deletedTaskIds.has(dependency.successorTaskId)
    ) delete sheet.taskDependencies[dependency.id];
  }

  applySummaryScopeChanges(sheet, command.payload.summaryScopeChanges);
  applyBoundaryScopeChanges(sheet, command.payload.boundaryScopeChanges);
  cleanupDanglingDocumentReferences(document);
};

const collectSubtreeTopicIds = (
  sheet: MindMapSheet,
  topicId: TopicId,
): Set<TopicId> => new Set([
  topicId,
  ...getDescendants(sheet, topicId).map((topic) => topic.id),
]);

const scopeTouchesDeletedTopics = (
  scope: TopicScope,
  topicIds: ReadonlySet<TopicId>,
  edgeIds: ReadonlySet<TreeEdgeId>,
): boolean => {
  if (scope.kind === 'subtree') return topicIds.has(scope.rootTopicId);
  if (scope.kind === 'explicit') {
    return scope.topicIds.some((topicId) => topicIds.has(topicId));
  }
  return topicIds.has(scope.parentTopicId)
    || edgeIds.has(scope.firstEdgeId)
    || edgeIds.has(scope.lastEdgeId);
};

const targetWasDeleted = (
  target: RelationshipTargetRef,
  topicIds: ReadonlySet<TopicId>,
  deletedBoundaryIds: ReadonlySet<string>,
  deletedCalloutIds: ReadonlySet<string>,
  deletedZoneIds: ReadonlySet<string>,
): boolean => {
  if (target.kind === 'topic') return topicIds.has(target.topicId);
  if (target.kind === 'boundary') return deletedBoundaryIds.has(target.boundaryId);
  if (target.kind === 'callout') return deletedCalloutIds.has(target.calloutId);
  return deletedZoneIds.has(target.zoneId);
};

const validateDeleteTopicSubtree = (
  context: CommandValidationContext,
  command: DeleteTopicSubtreeCommand,
): void => {
  const sheet = getSheet(context);
  assertTopicExists(sheet, command.payload.topicId);
  if (command.payload.topicId === sheet.rootTopicId) {
    invalid('The sheet central root cannot be deleted as a subtree.');
  }
  const after = structuredClone(sheet);
  const deleted = collectSubtreeTopicIds(sheet, command.payload.topicId);
  for (const topicId of deleted) delete after.topics[topicId];
  for (const edge of Object.values(after.treeEdges)) {
    if (deleted.has(edge.parentTopicId) || deleted.has(edge.childTopicId)) {
      delete after.treeEdges[edge.id];
    }
  }
  validateSummaryScopeChanges(
    context.document,
    sheet,
    after,
    command.payload.summaryScopeChanges,
  );
  validateBoundaryScopeChanges(
    context.document,
    sheet,
    projectSummaryScopeNormalizationAfter(sheet, after),
    command.payload.boundaryScopeChanges,
  );
};

const deleteTopicSubtreeFromSheet = (
  sheet: Draft<MindMapSheet>,
  topicId: TopicId,
  boundaryScopeChanges?: readonly BoundaryScopeChange[],
): void => {
  const readableSheet = sheet as unknown as MindMapSheet;
  const topicIds = collectSubtreeTopicIds(readableSheet, topicId);
  // Removing a summary or its scope also removes its result subtree so a
  // summary-result topic can never be left without an owning Summary.
  let addedSummaryResult = true;
  while (addedSummaryResult) {
    addedSummaryResult = false;
    const currentEdgeIds = new Set(
      Object.values(readableSheet.treeEdges)
        .filter((edge) => topicIds.has(edge.parentTopicId) || topicIds.has(edge.childTopicId))
        .map((edge) => edge.id),
    );
    for (const summary of Object.values(readableSheet.summaries)) {
      if (
        (topicIds.has(summary.resultTopicId)
          || scopeTouchesDeletedTopics(summary.scope, topicIds, currentEdgeIds))
        && !topicIds.has(summary.resultTopicId)
      ) {
        for (const resultTopicId of collectSubtreeTopicIds(readableSheet, summary.resultTopicId)) {
          if (!topicIds.has(resultTopicId)) {
            topicIds.add(resultTopicId);
            addedSummaryResult = true;
          }
        }
      }
    }
  }
  const edgeIds = new Set<TreeEdgeId>();
  for (const edge of Object.values(readableSheet.treeEdges)) {
    if (topicIds.has(edge.parentTopicId) || topicIds.has(edge.childTopicId)) {
      edgeIds.add(edge.id);
    }
  }

  const legacyDeletedBoundaries = Object.values(readableSheet.boundaries).filter(
    (boundary: Boundary) => scopeTouchesDeletedTopics(boundary.scope, topicIds, edgeIds),
  );
  const deletedSummaries = Object.values(readableSheet.summaries).filter(
    (summary: Summary) =>
      topicIds.has(summary.resultTopicId)
      || scopeTouchesDeletedTopics(summary.scope, topicIds, edgeIds),
  );
  const deletedBoundaryIds = new Set(
    boundaryScopeChanges
      ? boundaryScopeChanges
        .filter((change) => change.replacements.length === 0)
        .map((change) => change.boundaryId)
      : legacyDeletedBoundaries.map((boundary) => boundary.id),
  );
  const deletedCalloutIds = new Set(
    Object.values(readableSheet.callouts)
      .filter((callout) => topicIds.has(callout.targetTopicId))
      .map((callout) => callout.id),
  );
  const deletedZoneIds = new Set(
    Object.values(readableSheet.zones)
      .filter((zone) =>
        zone.rootTopicIds.length > 0
        && zone.rootTopicIds.every((topicId) => topicIds.has(topicId)))
      .map((zone) => zone.id),
  );

  for (const topicId of topicIds) delete sheet.topics[topicId];
  for (const edgeId of edgeIds) delete sheet.treeEdges[edgeId];
  if (boundaryScopeChanges) applyBoundaryScopeChanges(sheet, boundaryScopeChanges);
  else for (const boundary of legacyDeletedBoundaries) delete sheet.boundaries[boundary.id];
  for (const summary of deletedSummaries) delete sheet.summaries[summary.id];
  for (const calloutId of deletedCalloutIds) delete sheet.callouts[calloutId as keyof typeof sheet.callouts];

  for (const zone of Object.values(sheet.zones)) {
    if (deletedZoneIds.has(zone.id)) {
      delete sheet.zones[zone.id];
    } else {
      zone.rootTopicIds = zone.rootTopicIds.filter((topicId) => !topicIds.has(topicId));
    }
  }

  for (const relationship of Object.values(sheet.relationships)) {
    if (
      targetWasDeleted(
        relationship.source.element,
        topicIds,
        deletedBoundaryIds,
        deletedCalloutIds,
        deletedZoneIds,
      )
      || targetWasDeleted(
        relationship.target.element,
        topicIds,
        deletedBoundaryIds,
        deletedCalloutIds,
        deletedZoneIds,
      )
    ) {
      delete sheet.relationships[relationship.id];
    }
  }

  for (const marker of Object.values(sheet.markerInstances)) {
    if (topicIds.has(marker.topicId)) delete sheet.markerInstances[marker.id];
  }
  for (const note of Object.values(sheet.notes)) {
    if (topicIds.has(note.topicId)) delete sheet.notes[note.id];
  }
  for (const link of Object.values(sheet.links)) {
    if (topicIds.has(link.topicId)) delete sheet.links[link.id];
  }
  for (const attachment of Object.values(sheet.attachments)) {
    if (topicIds.has(attachment.topicId)) delete sheet.attachments[attachment.id];
  }
  for (const image of Object.values(sheet.images)) {
    if (topicIds.has(image.topicId)) delete sheet.images[image.id];
  }
  for (const equation of Object.values(sheet.equations)) {
    if (topicIds.has(equation.topicId)) delete sheet.equations[equation.id];
  }
  for (const audio of Object.values(sheet.audioClips)) {
    if (topicIds.has(audio.topicId)) delete sheet.audioClips[audio.id];
  }
  for (const todo of Object.values(sheet.todos)) {
    if (topicIds.has(todo.topicId)) delete sheet.todos[todo.id];
  }

  const deletedTaskIds = new Set(
    Object.values(readableSheet.tasks)
      .filter((task) => topicIds.has(task.topicId))
      .map((task) => task.id),
  );
  for (const taskId of deletedTaskIds) delete sheet.tasks[taskId];
  for (const dependency of Object.values(sheet.taskDependencies)) {
    if (
      deletedTaskIds.has(dependency.predecessorTaskId)
      || deletedTaskIds.has(dependency.successorTaskId)
    ) {
      delete sheet.taskDependencies[dependency.id];
    }
  }
};

const applyDeleteTopicSubtree = (
  document: Draft<MindMapDocumentV1>,
  command: DeleteTopicSubtreeCommand,
): void => {
  const sheet = document.sheets[command.sheetId];
  const topicIds = collectSubtreeTopicIds(
    sheet as unknown as MindMapSheet,
    command.payload.topicId,
  );
  deleteExactTopicEntities(sheet, topicIds);
  applySummaryScopeChanges(sheet, command.payload.summaryScopeChanges);
  applyBoundaryScopeChanges(sheet, command.payload.boundaryScopeChanges);
  // Topic links may originate in any sheet, so subtree deletion must perform
  // the same document-wide reference repair as delete-current. Active links
  // whose target disappeared remain recoverable as canonical `broken` links;
  // leaving them active would violate the post-command document invariants.
  cleanupDanglingDocumentReferences(document);
};

const validateToggleTopicCollapse = (
  context: CommandValidationContext,
  command: ToggleTopicCollapseCommand,
): void => {
  assertTopicExists(getSheet(context), command.payload.topicId);
  if (
    command.payload.collapsed !== undefined
    && typeof command.payload.collapsed !== 'boolean'
  ) {
    invalid('collapsed must be a boolean when provided.');
  }
};

const applyToggleTopicCollapse = (
  document: Draft<MindMapDocumentV1>,
  command: ToggleTopicCollapseCommand,
): void => {
  const topic = document.sheets[command.sheetId].topics[command.payload.topicId];
  topic.defaultCollapsed = command.payload.collapsed ?? !topic.defaultCollapsed;
};

const validateCreateRelationship = (
  context: CommandValidationContext,
  command: CreateRelationshipCommand,
): void => {
  const sheet = getSheet(context);
  const { relationship } = command.payload;
  assertEntityPayload(relationship, 'Relationship');
  if (sheet.relationships[relationship.id]) {
    invalid(`Relationship ${relationship.id} already exists.`);
  }
  assertRelationshipCandidate(sheet, relationship);
};

const applyCreateRelationship = (
  document: Draft<MindMapDocumentV1>,
  command: CreateRelationshipCommand,
): void => {
  document.sheets[command.sheetId].relationships[command.payload.relationship.id]
    = command.payload.relationship;
};

const validateUpdateRelationship = (
  context: CommandValidationContext,
  command: UpdateRelationshipCommand,
): void => {
  const sheet = getSheet(context);
  const { relationship } = command.payload;
  assertEntityPayload(relationship, 'Relationship');
  if (!sheet.relationships[relationship.id]) {
    invalid(`Relationship ${relationship.id} does not exist.`);
  }
  assertRelationshipCandidate(sheet, relationship);
};

const applyUpdateRelationship = (
  document: Draft<MindMapDocumentV1>,
  command: UpdateRelationshipCommand,
): void => {
  document.sheets[command.sheetId].relationships[command.payload.relationship.id]
    = command.payload.relationship;
};

const validateDeleteRelationship = (
  context: CommandValidationContext,
  command: DeleteRelationshipCommand,
): void => {
  const sheet = getSheet(context);
  if (!sheet.relationships[command.payload.relationshipId]) {
    invalid(`Relationship ${command.payload.relationshipId} does not exist.`);
  }
};

const applyDeleteRelationship = (
  document: Draft<MindMapDocumentV1>,
  command: DeleteRelationshipCommand,
): void => {
  delete document.sheets[command.sheetId].relationships[command.payload.relationshipId];
};

const assertBoundaryCandidate = (sheet: MindMapSheet, boundary: Boundary): void => {
  const members = resolveScopeMembers(sheet, boundary.scope);
  if ([...members].some((topicId) => sheet.topics[topicId]?.role === 'central')) {
    invalid('Boundary scope cannot contain the central Topic.');
  }
  const floatingCount = [...members].filter(
    (topicId) => sheet.topics[topicId]?.role === 'floating-root',
  ).length;
  if (floatingCount > 1) invalid('Boundary scope cannot contain multiple floating roots.');
  if (!Number.isFinite(boundary.padding) || boundary.padding < 0) {
    invalid('Boundary padding must be a non-negative finite number.');
  }
  const manualFrame = boundary.extensions?.[BOUNDARY_FRAME_EXTENSION_KEY];
  if (manualFrame !== undefined && !isBoundaryFrameExtensionV1(manualFrame)) {
    invalid('Boundary manual frame extension is invalid.');
  }
  if (boundary.title !== undefined) assertRichText(boundary.title, 'Boundary title');
};

const validateCreateBoundary = (
  context: CommandValidationContext,
  command: CreateBoundaryCommand,
): void => {
  const sheet = getSheet(context);
  if (
    command.payload.additionalBoundaries !== undefined
    && !Array.isArray(command.payload.additionalBoundaries)
  ) invalid('Boundary additionalBoundaries must be an array.');
  const boundaries = [command.payload.boundary, ...(command.payload.additionalBoundaries ?? [])];
  if (boundaries.length === 0) invalid('Boundary create requires at least one range.');
  if (boundaries.length > 1 && command.payload.selectedTopicIds === undefined) {
    invalid('Split Boundary create requires selectedTopicIds to prove the normalized groups.');
  }
  if (command.payload.selectedTopicIds !== undefined) {
    if (
      !Array.isArray(command.payload.selectedTopicIds)
      || command.payload.selectedTopicIds.length === 0
    ) invalid('Boundary selectedTopicIds must be a non-empty array.');
    const selectedTopics = command.payload.selectedTopicIds.map((topicId) => sheet.topics[topicId]);
    if (selectedTopics.some((topic) => topic?.role === 'central')) {
      invalid('Boundary selection cannot contain the central Topic.');
    }
    if (selectedTopics.filter((topic) => topic?.role === 'floating-root').length > 1) {
      invalid('A Boundary create transaction cannot select multiple floating roots.');
    }
  }
  const ids = new Set<string>();
  for (const boundary of boundaries) {
    assertEntityPayload(boundary, 'Boundary');
    if (ids.has(boundary.id)) invalid(`Boundary create repeats ID ${boundary.id}.`);
    if (documentContainsEntityId(context.document, boundary.id)) {
      invalid(`Boundary ID ${boundary.id} already exists in the document.`);
    }
    ids.add(boundary.id);
    assertBoundaryCandidate(sheet, boundary);
  }
  const primary = boundaries[0];
  for (const boundary of boundaries.slice(1)) {
    if (
      boundary.padding !== primary.padding
      || !deepEqual(boundary.title, primary.title)
      || !deepEqual(boundary.style, primary.style)
    ) invalid('All Boundary split groups must preserve identical title, padding, and style.');
  }
  if (command.payload.selectedTopicIds !== undefined) {
    const normalized = normalizeSemanticScopeSelection(
      sheet,
      command.payload.selectedTopicIds,
    );
    if (
      normalized.rejectedTopicIds.length > 0
      || normalized.groups.length !== boundaries.length
      || normalized.groups.some((group, index) => !deepEqual(group.scope, boundaries[index].scope))
    ) invalid('Boundary split payload does not match its normalized selectedTopicIds.');
  }
};

const applyCreateBoundary = (
  document: Draft<MindMapDocumentV1>,
  command: CreateBoundaryCommand,
): void => {
  const sheet = document.sheets[command.sheetId];
  for (const boundary of [
    command.payload.boundary,
    ...(command.payload.additionalBoundaries ?? []),
  ]) sheet.boundaries[boundary.id] = boundary;
};

const validateUpdateBoundary = (
  context: CommandValidationContext,
  command: UpdateBoundaryCommand,
): void => {
  const sheet = getSheet(context);
  const { boundary } = command.payload;
  assertEntityPayload(boundary, 'Boundary');
  if (!sheet.boundaries[boundary.id]) invalid(`Boundary ${boundary.id} does not exist.`);
  assertBoundaryCandidate(sheet, boundary);
};

const applyUpdateBoundary = (
  document: Draft<MindMapDocumentV1>,
  command: UpdateBoundaryCommand,
): void => {
  document.sheets[command.sheetId].boundaries[command.payload.boundary.id]
    = command.payload.boundary;
};

const relationshipReferences = (
  relationship: Relationship,
  target: RelationshipTargetRef,
): boolean => {
  const identity = targetIdentity(target);
  return targetIdentity(relationship.source.element) === identity
    || targetIdentity(relationship.target.element) === identity;
};

const deleteRelationshipsForTarget = (
  sheet: Draft<MindMapSheet>,
  target: RelationshipTargetRef,
): void => {
  for (const relationship of Object.values(sheet.relationships)) {
    if (relationshipReferences(relationship as Relationship, target)) {
      delete sheet.relationships[relationship.id];
    }
  }
};

const validateDeleteBoundary = (
  context: CommandValidationContext,
  command: DeleteBoundaryCommand,
): void => {
  if (!getSheet(context).boundaries[command.payload.boundaryId]) {
    invalid(`Boundary ${command.payload.boundaryId} does not exist.`);
  }
};

const applyDeleteBoundary = (
  document: Draft<MindMapDocumentV1>,
  command: DeleteBoundaryCommand,
): void => {
  const sheet = document.sheets[command.sheetId];
  deleteRelationshipsForTarget(sheet, {
    kind: 'boundary',
    boundaryId: command.payload.boundaryId,
  });
  delete sheet.boundaries[command.payload.boundaryId];
  cleanupDanglingDocumentReferences(document);
};

const assertSummaryCandidate = (
  sheet: MindMapSheet,
  summary: Summary,
  resultTopic = sheet.topics[summary.resultTopicId],
): void => {
  const members = resolveScopeMembers(sheet, summary.scope);
  if (!resultTopic) invalid(`Summary result topic ${summary.resultTopicId} does not exist.`);
  if (resultTopic.id !== summary.resultTopicId) {
    invalid(`Summary ${summary.id} resultTopicId must match its result topic.`);
  }
  if (resultTopic.role !== 'summary-result') {
    invalid(`Summary result ${resultTopic.id} must have role summary-result.`);
  }
  if (resultTopic.placement.mode === 'absolute') {
    invalid('Summary result topics cannot use absolute placement.');
  }
  if (resultTopic.id === sheet.rootTopicId || getIncomingTreeEdges(sheet, resultTopic.id).length > 0) {
    invalid(`Summary result ${resultTopic.id} cannot have a structural parent.`);
  }
  assertRichText(resultTopic.title);
  if (members.has(resultTopic.id)) {
    invalid(`Summary result ${resultTopic.id} cannot be inside its own scope.`);
  }
  for (const memberId of members) {
    const role = sheet.topics[memberId]?.role;
    if (role === 'central' || role === 'summary-result') {
      invalid(`Summary scope cannot contain ${role} topic ${memberId}.`);
    }
  }
  const owner = Object.values(sheet.summaries).find(
    (candidate) =>
      candidate.id !== summary.id
      && candidate.resultTopicId === summary.resultTopicId,
  );
  if (owner) {
    invalid(`Summary result ${summary.resultTopicId} is already owned by ${owner.id}.`);
  }
};

const validateCreateSummary = (
  context: CommandValidationContext,
  command: CreateSummaryCommand,
): void => {
  const sheet = getSheet(context);
  const { creations, selectedTopicIds } = command.payload;
  if (!Array.isArray(selectedTopicIds) || selectedTopicIds.length === 0) {
    invalid('Summary selectedTopicIds must be a non-empty array.');
  }
  if (!Array.isArray(creations) || creations.length === 0) {
    invalid('Summary create requires at least one normalized range.');
  }
  const selected = selectedTopicIds.map((topicId) => sheet.topics[topicId]);
  if (selected.some((topic) => !topic)) invalid('Summary selection contains a missing Topic.');
  if (selected.some((topic) => topic.role === 'central' || topic.role === 'summary-result')) {
    invalid('Summary selection cannot contain central or summary-result Topics.');
  }
  if (selected.filter((topic) => topic.role === 'floating-root').length > 1) {
    invalid('A Summary create transaction cannot select multiple floating roots.');
  }
  const normalized = normalizeSemanticScopeSelection(sheet, selectedTopicIds);
  if (
    normalized.rejectedTopicIds.length > 0
    || normalized.groups.length !== creations.length
    || normalized.groups.some((group, index) => !deepEqual(group.scope, creations[index].summary.scope))
  ) invalid('Summary create payload does not match its normalized selectedTopicIds.');
  const allocated = new Set<string>();
  for (const { resultTopic, summary } of creations) {
    assertEntityPayload(summary, 'Summary');
    assertEntityPayload(resultTopic, 'Summary result topic');
    for (const [label, id] of [['Summary', summary.id], ['Summary result Topic', resultTopic.id]] as const) {
      if (allocated.has(id)) invalid(`Summary create repeats ID ${id}.`);
      if (documentContainsEntityId(context.document, id)) invalid(`${label} ID ${id} already exists.`);
      allocated.add(id);
    }
    if (summary.resultTopicId !== resultTopic.id) {
      invalid(`Summary ${summary.id} must own result topic ${resultTopic.id}.`);
    }
    assertSummaryCandidate(sheet, summary, resultTopic);
  }
};

const applyCreateSummary = (
  document: Draft<MindMapDocumentV1>,
  command: CreateSummaryCommand,
): void => {
  const sheet = document.sheets[command.sheetId];
  for (const { resultTopic, summary } of command.payload.creations) {
    sheet.topics[resultTopic.id] = resultTopic;
    sheet.summaries[summary.id] = summary;
  }
};

const validateUpdateSummary = (
  context: CommandValidationContext,
  command: UpdateSummaryCommand,
): void => {
  const sheet = getSheet(context);
  const { summary } = command.payload;
  assertEntityPayload(summary, 'Summary');
  const current = sheet.summaries[summary.id]
    ?? invalid(`Summary ${summary.id} does not exist.`);
  if (current.resultTopicId !== summary.resultTopicId) {
    invalid('Summary resultTopicId is immutable; replace the Summary atomically instead.');
  }
  assertSummaryCandidate(sheet, summary);
};

const applyUpdateSummary = (
  document: Draft<MindMapDocumentV1>,
  command: UpdateSummaryCommand,
): void => {
  document.sheets[command.sheetId].summaries[command.payload.summary.id]
    = command.payload.summary;
};

const validateDeleteSummary = (
  context: CommandValidationContext,
  command: DeleteSummaryCommand,
): void => {
  const sheet = getSheet(context);
  const summary = sheet.summaries[command.payload.summaryId]
    ?? invalid(`Summary ${command.payload.summaryId} does not exist.`);
  assertTopicExists(sheet, summary.resultTopicId);
  const after = structuredClone(sheet);
  const deleted = collectSummaryCascadeDeletionTopicIds(
    sheet,
    collectSubtreeTopicIds(sheet, summary.resultTopicId),
  );
  for (const topicId of deleted) delete after.topics[topicId];
  for (const edge of Object.values(after.treeEdges)) {
    if (deleted.has(edge.parentTopicId) || deleted.has(edge.childTopicId)) {
      delete after.treeEdges[edge.id];
    }
  }
  validateBoundaryScopeChanges(
    context.document,
    sheet,
    after,
    command.payload.boundaryScopeChanges,
  );
};

const applyDeleteSummary = (
  document: Draft<MindMapDocumentV1>,
  command: DeleteSummaryCommand,
): void => {
  const sheet = document.sheets[command.sheetId];
  const summary = sheet.summaries[command.payload.summaryId];
  if (!summary) return;
  deleteTopicSubtreeFromSheet(
    sheet,
    summary.resultTopicId,
    command.payload.boundaryScopeChanges,
  );
  cleanupDanglingDocumentReferences(document);
};

const assertCalloutCandidate = (
  sheet: MindMapSheet,
  callout: CreateCalloutCommand['payload']['callout'],
): void => {
  assertTopicExists(sheet, callout.targetTopicId);
  assertRichText(callout.content, 'Callout content');
};

const validateCreateCallout = (
  context: CommandValidationContext,
  command: CreateCalloutCommand,
): void => {
  const sheet = getSheet(context);
  const { callout } = command.payload;
  assertEntityPayload(callout, 'Callout');
  if (sheet.callouts[callout.id]) invalid(`Callout ${callout.id} already exists.`);
  assertCalloutCandidate(sheet, callout);
};

const applyCreateCallout = (
  document: Draft<MindMapDocumentV1>,
  command: CreateCalloutCommand,
): void => {
  document.sheets[command.sheetId].callouts[command.payload.callout.id]
    = command.payload.callout;
};

const validateUpdateCallout = (
  context: CommandValidationContext,
  command: UpdateCalloutCommand,
): void => {
  const sheet = getSheet(context);
  const { callout } = command.payload;
  assertEntityPayload(callout, 'Callout');
  if (!sheet.callouts[callout.id]) invalid(`Callout ${callout.id} does not exist.`);
  assertCalloutCandidate(sheet, callout);
};

const applyUpdateCallout = (
  document: Draft<MindMapDocumentV1>,
  command: UpdateCalloutCommand,
): void => {
  document.sheets[command.sheetId].callouts[command.payload.callout.id]
    = command.payload.callout;
};

const validateDeleteCallout = (
  context: CommandValidationContext,
  command: DeleteCalloutCommand,
): void => {
  if (!getSheet(context).callouts[command.payload.calloutId]) {
    invalid(`Callout ${command.payload.calloutId} does not exist.`);
  }
};

const applyDeleteCallout = (
  document: Draft<MindMapDocumentV1>,
  command: DeleteCalloutCommand,
): void => {
  const sheet = document.sheets[command.sheetId];
  deleteRelationshipsForTarget(sheet, {
    kind: 'callout',
    calloutId: command.payload.calloutId,
  });
  delete sheet.callouts[command.payload.calloutId];
};

const assertZoneCandidate = (sheet: MindMapSheet, zone: Zone): void => {
  const schema = validateMindMapZoneSchema(zone);
  if (!schema.valid) {
    const first = schema.errors[0];
    invalid(
      `Zone ${zone.id} is invalid at ${first?.instancePath || '/'}: ${first?.message ?? 'schema validation failed'}.`,
    );
  }

  const roots = new Set<TopicId>();
  for (const topicId of zone.rootTopicIds) {
    const topic = sheet.topics[topicId]
      ?? invalid(`Zone root topic ${topicId} does not exist.`);
    if (roots.has(topicId)) invalid(`Zone ${zone.id} repeats root topic ${topicId}.`);
    roots.add(topicId);
    if (topic.role !== 'floating-root' || getIncomingTreeEdges(sheet, topicId).length !== 0) {
      invalid(`Zone member ${topicId} must be a parentless floating-root topic.`);
    }
    const owner = Object.values(sheet.zones).find(
      (candidate) => candidate.id !== zone.id && candidate.rootTopicIds.includes(topicId),
    );
    if (owner) invalid(`Floating root ${topicId} already belongs to zone ${owner.id}.`);
  }

  const duplicateOrder = Object.values(sheet.zones).find(
    (candidate) => candidate.id !== zone.id && candidate.zOrderKey === zone.zOrderKey,
  );
  if (duplicateOrder) {
    invalid(`Zone zOrderKey ${zone.zOrderKey} is already used by ${duplicateOrder.id}.`);
  }
};

const validateUpdateZone = (
  context: CommandValidationContext,
  command: UpdateZoneCommand,
): void => {
  const sheet = getSheet(context);
  const { zone } = command.payload;
  assertEntityPayload(zone, 'Zone');
  if (!sheet.zones[zone.id]) invalid(`Zone ${zone.id} does not exist.`);
  assertZoneCandidate(sheet, zone);
};

const applyUpdateZone = (
  document: Draft<MindMapDocumentV1>,
  command: UpdateZoneCommand,
): void => {
  document.sheets[command.sheetId].zones[command.payload.zone.id]
    = command.payload.zone;
};

const validateCreateImage = (
  context: CommandValidationContext,
  command: CreateImageCommand,
): void => {
  const sheet = getSheet(context);
  const { asset, image } = command.payload;
  assertEntityPayload(asset, 'Image Asset');
  assertEntityPayload(image, 'Topic image');
  assertImageAssetCandidate(asset);

  const existingIds = new Set(collectCanonicalEntityIds(context.document));
  if (String(asset.id) === String(image.id)) {
    invalid('Image Asset and Topic image must use distinct IDs.');
  }
  if (existingIds.has(asset.id)) invalid(`Image Asset ID ${asset.id} already exists.`);
  if (existingIds.has(image.id)) invalid(`Topic image ID ${image.id} already exists.`);
  assertImageCandidate(sheet, image, asset);
};

const applyCreateImage = (
  document: Draft<MindMapDocumentV1>,
  command: CreateImageCommand,
): void => {
  document.assets[command.payload.asset.id] = command.payload.asset;
  document.sheets[command.sheetId].images[command.payload.image.id] = command.payload.image;
};

const validateUpdateImage = (
  context: CommandValidationContext,
  command: UpdateImageCommand,
): void => {
  const sheet = getSheet(context);
  const { image } = command.payload;
  assertEntityPayload(image, 'Topic image');
  const currentImage = sheet.images[image.id]
    ?? invalid(`Topic image ${image.id} does not exist.`);
  if (image.topicId !== currentImage.topicId) {
    invalid('image.update cannot change immutable Topic ownership.');
  }
  if (image.assetId !== currentImage.assetId) {
    invalid('image.update cannot change immutable Asset ownership.');
  }
  const asset = context.document.assets[image.assetId]
    ?? invalid(`Image Asset ${image.assetId} does not exist.`);
  assertImageAssetCandidate(asset);
  assertImageCandidate(sheet, image, asset, image.id);
};

const applyUpdateImage = (
  document: Draft<MindMapDocumentV1>,
  command: UpdateImageCommand,
): void => {
  document.sheets[command.sheetId].images[command.payload.image.id] = command.payload.image;
};

const validateDeleteImage = (
  context: CommandValidationContext,
  command: DeleteImageCommand,
): void => {
  const sheet = getSheet(context);
  const { imageId, pruneAssetId } = command.payload;
  assertCanonicalUuidV7(imageId, 'Topic image ID');
  const image = sheet.images[imageId]
    ?? invalid(`Topic image ${imageId} does not exist.`);
  const hasRemainingReference = documentReferencesAsset(
    context.document,
    image.assetId,
    { ignoreImageId: imageId },
  );
  if (hasRemainingReference) {
    if (pruneAssetId !== undefined) {
      invalid(`Image Asset ${image.assetId} still has another document reference.`);
    }
    return;
  }
  const assetIdToPrune = pruneAssetId
    ?? invalid(`Deleting the last reference must prune orphan Image Asset ${image.assetId}.`);
  assertCanonicalUuidV7(assetIdToPrune, 'Pruned Image Asset ID');
  if (assetIdToPrune !== image.assetId) {
    invalid(`Topic image ${imageId} does not own Asset ${assetIdToPrune}.`);
  }
  if (!context.document.assets[assetIdToPrune]) {
    invalid(`Image Asset ${assetIdToPrune} does not exist.`);
  }
};

const applyDeleteImage = (
  document: Draft<MindMapDocumentV1>,
  command: DeleteImageCommand,
): void => {
  const { imageId, pruneAssetId } = command.payload;
  delete document.sheets[command.sheetId].images[imageId];
  for (const deck of Object.values(document.presentations)) {
    for (const slide of Object.values(deck.slides)) {
      const overrides = slide.imageOverrides;
      if (!overrides || overrides[imageId] === undefined) continue;
      delete overrides[imageId];
      if (Object.keys(overrides).length === 0) delete slide.imageOverrides;
    }
  }
  if (pruneAssetId !== undefined) delete document.assets[pruneAssetId];
};

const validateCreateSheet = (
  context: CommandValidationContext,
  command: CreateSheetCommand,
): void => {
  const { sheet } = command.payload;
  assertEntityPayload(sheet, 'Sheet');
  if (context.document.sheets[sheet.id]) invalid(`Sheet ${sheet.id} already exists.`);
  if (!context.document.themes[sheet.themeId]) {
    invalid(`Sheet ${sheet.id} references missing theme ${sheet.themeId}.`);
  }
  const root = sheet.topics[sheet.rootTopicId];
  if (!root || root.role !== 'central') {
    invalid(`Sheet ${sheet.id} requires a central root topic.`);
  }
  assertNonEmptyOrderKey(sheet.orderKey);
  const duplicateOrder = Object.values(context.document.sheets)
    .find((candidate) => candidate.orderKey === sheet.orderKey);
  if (duplicateOrder) {
    invalid(`Sheet orderKey ${sheet.orderKey} is already used by ${duplicateOrder.id}.`);
  }
};

const applyCreateSheet = (
  document: Draft<MindMapDocumentV1>,
  command: CreateSheetCommand,
): void => {
  document.sheets[command.payload.sheet.id] = command.payload.sheet;
};

const validateRenameSheet = (
  context: CommandValidationContext,
  command: RenameSheetCommand,
): void => {
  getSheet(context);
  if (typeof command.payload.title !== 'string' || command.payload.title.length > 500) {
    invalid('Sheet title must be a string no longer than 500 characters.');
  }
};

const applyRenameSheet = (
  document: Draft<MindMapDocumentV1>,
  command: RenameSheetCommand,
): void => {
  document.sheets[command.sheetId].title = command.payload.title;
};

const validateReorderSheet = (
  context: CommandValidationContext,
  command: ReorderSheetCommand,
): void => {
  getSheet(context);
  assertNonEmptyOrderKey(command.payload.orderKey);
  const duplicate = Object.values(context.document.sheets).find((sheet) =>
    sheet.id !== command.sheetId && sheet.orderKey === command.payload.orderKey);
  if (duplicate) {
    invalid(`Sheet orderKey ${command.payload.orderKey} is already used by ${duplicate.id}.`);
  }
};

const applyReorderSheet = (
  document: Draft<MindMapDocumentV1>,
  command: ReorderSheetCommand,
): void => {
  document.sheets[command.sheetId].orderKey = command.payload.orderKey;
};

const RESOLVED_LAYOUT_DIRECTIONS = new Set([
  'left-to-right',
  'right-to-left',
  'top-to-bottom',
  'bottom-to-top',
  'both',
  'radial',
  'clockwise',
  'counterclockwise',
]);

const validateUpdateSheetLayout = (
  context: CommandValidationContext,
  command: UpdateSheetLayoutCommand,
): void => {
  getSheet(context);
  const layout = command.payload.defaultBranchLayout;
  if (!layout || typeof layout !== 'object') invalid('Sheet layout is required.');
  if (
    typeof layout.structure !== 'string'
    || layout.structure.length === 0
    || layout.structure === 'inherit'
  ) {
    invalid('Sheet layout requires a resolved structure.');
  }
  if (!RESOLVED_LAYOUT_DIRECTIONS.has(layout.direction)) {
    invalid(`Sheet layout direction ${String(layout.direction)} is not resolved.`);
  }
  if (!['auto', 'hybrid', 'manual'].includes(layout.mode)) {
    invalid(`Sheet layout mode ${String(layout.mode)} is invalid.`);
  }
  if (layout.compact !== undefined && typeof layout.compact !== 'boolean') {
    invalid('Sheet layout compact must be boolean.');
  }
  if (
    layout.balance !== undefined
    && !['none', 'automatic', 'locked'].includes(layout.balance)
  ) {
    invalid('Sheet layout balance is invalid.');
  }
  if (
    layout.freePositioning !== undefined
    && typeof layout.freePositioning !== 'boolean'
  ) {
    invalid('Sheet layout freePositioning must be boolean.');
  }
  if (
    layout.justifyTopicAlignment !== undefined
    && typeof layout.justifyTopicAlignment !== 'boolean'
  ) {
    invalid('Sheet layout justifyTopicAlignment must be boolean.');
  }
  if (layout.spacing) {
    for (const [key, value] of Object.entries(layout.spacing)) {
      if (!Number.isFinite(value) || value < 0 || value > 10_000) {
        invalid(`Sheet layout spacing ${key} must be between 0 and 10000.`);
      }
    }
  }
  if (layout.variantId !== undefined && layout.variantId.trim().length === 0) {
    invalid('Sheet layout variantId cannot be empty.');
  }
  if (layout.options) {
    for (const [key, value] of Object.entries(layout.options)) {
      if (key.length === 0) invalid('Sheet layout option keys cannot be empty.');
      if (
        typeof value !== 'string'
        && typeof value !== 'boolean'
        && (typeof value !== 'number' || !Number.isFinite(value))
      ) {
        invalid(`Sheet layout option ${key} must be a finite primitive value.`);
      }
    }
  }
  const advanced = command.payload.advancedLayout;
  if (
    advanced !== undefined
    && (
      typeof advanced.flexibleFloatingTopics !== 'boolean'
      || typeof advanced.allowTopicOverlap !== 'boolean'
    )
  ) {
    invalid('Advanced Sheet layout flags must be boolean.');
  }
};

const applyUpdateSheetLayout = (
  document: Draft<MindMapDocumentV1>,
  command: UpdateSheetLayoutCommand,
): void => {
  const sheet = document.sheets[command.sheetId];
  const layout = command.payload.defaultBranchLayout;
  sheet.defaultBranchLayout = {
    ...layout,
    ...(layout.spacing ? { spacing: { ...layout.spacing } } : {}),
    ...(layout.options ? { options: { ...layout.options } } : {}),
  };
  if (command.payload.advancedLayout) {
    sheet.advancedLayout = { ...command.payload.advancedLayout };
  }
};

const validateDeleteSheet = (
  context: CommandValidationContext,
  _command: DeleteSheetCommand,
): void => {
  getSheet(context);
  if (Object.keys(context.document.sheets).length <= 1) {
    invalid('The final mind-map sheet cannot be deleted.');
  }
};

const applyDeleteSheet = (
  document: Draft<MindMapDocumentV1>,
  command: DeleteSheetCommand,
): void => {
  const deletedSheet = document.sheets[command.sheetId];
  if (!deletedSheet) return;
  const deletedElementIds = new Set<string>([
    ...Object.keys(deletedSheet.topics),
    ...Object.keys(deletedSheet.relationships),
    ...Object.keys(deletedSheet.boundaries),
    ...Object.keys(deletedSheet.summaries),
    ...Object.keys(deletedSheet.callouts),
    ...Object.keys(deletedSheet.zones),
  ]);

  for (const sheet of Object.values(document.sheets)) {
    if (sheet.id === command.sheetId) continue;
    for (const link of Object.values(sheet.links)) {
      if (
        (link.kind === 'sheet' || link.kind === 'topic')
        && link.targetSheetId === command.sheetId
      ) {
        link.status = 'broken';
      }
    }
  }
  for (const view of Object.values(document.savedViews)) {
    if (view.sheetId === command.sheetId) delete document.savedViews[view.id];
  }
  for (const deck of Object.values(document.presentations)) {
    if (deck.sheetId === command.sheetId) {
      delete document.presentations[deck.id];
      continue;
    }
    for (const slide of Object.values(deck.slides)) {
      if (slide.target.sheetId === command.sheetId) delete deck.slides[slide.id];
    }
  }
  const threads = document.collaboration?.commentThreads;
  if (threads) {
    for (const thread of Object.values(threads)) {
      const anchor = thread.anchor;
      if (anchor.kind === 'canvas' && anchor.sheetId === command.sheetId) {
        delete threads[thread.id];
      } else if (anchor.kind !== 'canvas' && deletedElementIds.has(anchor.id)) {
        thread.orphaned = true;
      }
    }
  }
  delete document.sheets[command.sheetId];
};

const DEFINITIONS: MindMapCommandDefinitions = {
  [MIND_MAP_COMMAND_TYPES.replaceImportedDocument]: {
    validate: validateReplaceImportedDocument,
    apply: applyReplaceImportedDocument,
    invert: cloneInversePatches,
    mergePolicy: neverMerge as CommandMergePolicy<ReplaceImportedDocumentCommand>,
  },
  [MIND_MAP_COMMAND_TYPES.pasteClipboardFragment]: {
    validate: validatePasteClipboardFragment,
    apply: applyPasteClipboardFragment,
    invert: cloneInversePatches,
    mergePolicy: neverMerge,
  },
  [MIND_MAP_COMMAND_TYPES.createTopic]: {
    validate: validateCreateTopic,
    apply: applyCreateTopic,
    invert: cloneInversePatches,
    mergePolicy: neverMerge,
  },
  [MIND_MAP_COMMAND_TYPES.insertParentTopic]: {
    validate: validateInsertParentTopic,
    apply: applyInsertParentTopic,
    invert: cloneInversePatches,
    mergePolicy: neverMerge,
  },
  [MIND_MAP_COMMAND_TYPES.updateTopicTitle]: {
    validate: validateUpdateTopicTitle,
    apply: applyUpdateTopicTitle,
    invert: cloneInversePatches,
    mergePolicy: mergeSameTitleSession,
  },
  [MIND_MAP_COMMAND_TYPES.updateTopicLabels]: {
    validate: validateUpdateTopicLabels,
    apply: applyUpdateTopicLabels,
    invert: cloneInversePatches,
    mergePolicy: neverMerge,
  },
  [MIND_MAP_COMMAND_TYPES.reparentTopic]: {
    validate: validateReparentTopic,
    apply: applyReparentTopic,
    invert: cloneInversePatches,
    mergePolicy: neverMerge,
  },
  [MIND_MAP_COMMAND_TYPES.reorderTopic]: {
    validate: validateReorderTopic,
    apply: applyReorderTopic,
    invert: cloneInversePatches,
    mergePolicy: neverMerge,
  },
  [MIND_MAP_COMMAND_TYPES.deleteCurrentTopic]: {
    validate: validateDeleteCurrentTopic,
    apply: applyDeleteCurrentTopic,
    invert: cloneInversePatches,
    mergePolicy: neverMerge,
  },
  [MIND_MAP_COMMAND_TYPES.deleteTopicSubtree]: {
    validate: validateDeleteTopicSubtree,
    apply: applyDeleteTopicSubtree,
    invert: cloneInversePatches,
    mergePolicy: mergeSameTypeAndGroup,
  },
  [MIND_MAP_COMMAND_TYPES.toggleTopicCollapse]: {
    validate: validateToggleTopicCollapse,
    apply: applyToggleTopicCollapse,
    invert: cloneInversePatches,
    mergePolicy: neverMerge,
  },
  [MIND_MAP_COMMAND_TYPES.updateStyleBindings]: {
    validate: validateUpdateStyleBindings,
    apply: applyUpdateStyleBindings,
    invert: cloneInversePatches,
    mergePolicy: neverMerge as CommandMergePolicy<UpdateStyleBindingsCommand>,
  },
  [MIND_MAP_COMMAND_TYPES.createRelationship]: {
    validate: validateCreateRelationship,
    apply: applyCreateRelationship,
    invert: cloneInversePatches,
    mergePolicy: neverMerge,
  },
  [MIND_MAP_COMMAND_TYPES.updateRelationship]: {
    validate: validateUpdateRelationship,
    apply: applyUpdateRelationship,
    invert: cloneInversePatches,
    mergePolicy: neverMerge,
  },
  [MIND_MAP_COMMAND_TYPES.deleteRelationship]: {
    validate: validateDeleteRelationship,
    apply: applyDeleteRelationship,
    invert: cloneInversePatches,
    mergePolicy: neverMerge,
  },
  [MIND_MAP_COMMAND_TYPES.createBoundary]: {
    validate: validateCreateBoundary,
    apply: applyCreateBoundary,
    invert: cloneInversePatches,
    mergePolicy: neverMerge,
  },
  [MIND_MAP_COMMAND_TYPES.updateBoundary]: {
    validate: validateUpdateBoundary,
    apply: applyUpdateBoundary,
    invert: cloneInversePatches,
    mergePolicy: neverMerge,
  },
  [MIND_MAP_COMMAND_TYPES.deleteBoundary]: {
    validate: validateDeleteBoundary,
    apply: applyDeleteBoundary,
    invert: cloneInversePatches,
    mergePolicy: neverMerge,
  },
  [MIND_MAP_COMMAND_TYPES.createSummary]: {
    validate: validateCreateSummary,
    apply: applyCreateSummary,
    invert: cloneInversePatches,
    mergePolicy: neverMerge,
  },
  [MIND_MAP_COMMAND_TYPES.updateSummary]: {
    validate: validateUpdateSummary,
    apply: applyUpdateSummary,
    invert: cloneInversePatches,
    mergePolicy: neverMerge,
  },
  [MIND_MAP_COMMAND_TYPES.deleteSummary]: {
    validate: validateDeleteSummary,
    apply: applyDeleteSummary,
    invert: cloneInversePatches,
    mergePolicy: neverMerge,
  },
  [MIND_MAP_COMMAND_TYPES.createCallout]: {
    validate: validateCreateCallout,
    apply: applyCreateCallout,
    invert: cloneInversePatches,
    mergePolicy: neverMerge,
  },
  [MIND_MAP_COMMAND_TYPES.updateCallout]: {
    validate: validateUpdateCallout,
    apply: applyUpdateCallout,
    invert: cloneInversePatches,
    mergePolicy: neverMerge,
  },
  [MIND_MAP_COMMAND_TYPES.deleteCallout]: {
    validate: validateDeleteCallout,
    apply: applyDeleteCallout,
    invert: cloneInversePatches,
    mergePolicy: neverMerge,
  },
  [MIND_MAP_COMMAND_TYPES.updateZone]: {
    validate: validateUpdateZone,
    apply: applyUpdateZone,
    invert: cloneInversePatches,
    mergePolicy: neverMerge,
  },
  [MIND_MAP_COMMAND_TYPES.createImage]: {
    validate: validateCreateImage,
    apply: applyCreateImage,
    invert: cloneInversePatches,
    mergePolicy: neverMerge,
  },
  [MIND_MAP_COMMAND_TYPES.updateImage]: {
    validate: validateUpdateImage,
    apply: applyUpdateImage,
    invert: cloneInversePatches,
    mergePolicy: neverMerge,
  },
  [MIND_MAP_COMMAND_TYPES.deleteImage]: {
    validate: validateDeleteImage,
    apply: applyDeleteImage,
    invert: cloneInversePatches,
    mergePolicy: neverMerge,
  },
  [MIND_MAP_COMMAND_TYPES.createMarkerGroup]: {
    validate: validateCreateMarkerGroup,
    apply: applyCreateMarkerGroup,
    invert: cloneInversePatches,
    mergePolicy: neverMerge,
  },
  [MIND_MAP_COMMAND_TYPES.renameMarkerGroup]: {
    validate: validateRenameMarkerGroup,
    apply: applyRenameMarkerGroup,
    invert: cloneInversePatches,
    mergePolicy: neverMerge,
  },
  [MIND_MAP_COMMAND_TYPES.reorderMarkerGroup]: {
    validate: validateReorderMarkerGroup,
    apply: applyReorderMarkerGroup,
    invert: cloneInversePatches,
    mergePolicy: neverMerge,
  },
  [MIND_MAP_COMMAND_TYPES.deleteMarkerGroup]: {
    validate: validateDeleteMarkerGroup,
    apply: applyDeleteMarkerGroup,
    invert: cloneInversePatches,
    mergePolicy: neverMerge,
  },
  [MIND_MAP_COMMAND_TYPES.createMarkerDefinition]: {
    validate: validateCreateMarkerDefinition,
    apply: applyCreateMarkerDefinition,
    invert: cloneInversePatches,
    mergePolicy: neverMerge,
  },
  [MIND_MAP_COMMAND_TYPES.updateMarkerDefinition]: {
    validate: validateUpdateMarkerDefinition,
    apply: applyUpdateMarkerDefinition,
    invert: cloneInversePatches,
    mergePolicy: neverMerge,
  },
  [MIND_MAP_COMMAND_TYPES.reorderMarkerDefinition]: {
    validate: validateReorderMarkerDefinition,
    apply: applyReorderMarkerDefinition,
    invert: cloneInversePatches,
    mergePolicy: neverMerge,
  },
  [MIND_MAP_COMMAND_TYPES.deleteMarkerDefinition]: {
    validate: validateDeleteMarkerDefinition,
    apply: applyDeleteMarkerDefinition,
    invert: cloneInversePatches,
    mergePolicy: neverMerge,
  },
  [MIND_MAP_COMMAND_TYPES.attachMarker]: {
    validate: validateAttachMarker,
    apply: applyAttachMarker,
    invert: cloneInversePatches,
    mergePolicy: neverMerge,
  },
  [MIND_MAP_COMMAND_TYPES.updateMarker]: {
    validate: validateUpdateMarker,
    apply: applyUpdateMarker,
    invert: cloneInversePatches,
    mergePolicy: neverMerge,
  },
  [MIND_MAP_COMMAND_TYPES.detachMarker]: {
    validate: validateDetachMarker,
    apply: applyDetachMarker,
    invert: cloneInversePatches,
    mergePolicy: neverMerge,
  },
  [MIND_MAP_COMMAND_TYPES.patchMarkerLegend]: {
    validate: validatePatchMarkerLegend,
    apply: applyPatchMarkerLegend,
    invert: cloneInversePatches,
    mergePolicy: neverMerge,
  },
  [MIND_MAP_COMMAND_TYPES.moveMarkerLegend]: {
    validate: validateMoveMarkerLegend,
    apply: applyMoveMarkerLegend,
    invert: cloneInversePatches,
    mergePolicy: neverMerge,
  },
  [MIND_MAP_COMMAND_TYPES.reorderMarkerLegendItems]: {
    validate: validateReorderMarkerLegendItems,
    apply: applyReorderMarkerLegendItems,
    invert: cloneInversePatches,
    mergePolicy: neverMerge,
  },
  [MIND_MAP_COMMAND_TYPES.upsertNote]: {
    validate: validateUpsertNote,
    apply: applyUpsertNote,
    invert: cloneInversePatches,
    mergePolicy: mergeSameTypeAndGroup,
  },
  [MIND_MAP_COMMAND_TYPES.deleteNote]: {
    validate: validateDeleteNote,
    apply: applyDeleteNote,
    invert: cloneInversePatches,
    mergePolicy: neverMerge,
  },
  [MIND_MAP_COMMAND_TYPES.upsertLink]: {
    validate: validateUpsertLink,
    apply: applyUpsertLink,
    invert: cloneInversePatches,
    mergePolicy: neverMerge,
  },
  [MIND_MAP_COMMAND_TYPES.deleteLink]: {
    validate: validateDeleteLink,
    apply: applyDeleteLink,
    invert: cloneInversePatches,
    mergePolicy: neverMerge,
  },
  [MIND_MAP_COMMAND_TYPES.upsertTodo]: {
    validate: validateUpsertTodo,
    apply: applyUpsertTodo,
    invert: cloneInversePatches,
    mergePolicy: neverMerge,
  },
  [MIND_MAP_COMMAND_TYPES.deleteTodo]: {
    validate: validateDeleteTodo,
    apply: applyDeleteTodo,
    invert: cloneInversePatches,
    mergePolicy: neverMerge,
  },
  [MIND_MAP_COMMAND_TYPES.batchUpdateTodos]: {
    validate: validateBatchUpdateTodos,
    apply: applyBatchUpdateTodos,
    invert: cloneInversePatches,
    mergePolicy: neverMerge,
  },
  [MIND_MAP_COMMAND_TYPES.upsertTask]: {
    validate: validateUpsertTask,
    apply: applyUpsertTask,
    invert: cloneInversePatches,
    mergePolicy: neverMerge,
  },
  [MIND_MAP_COMMAND_TYPES.deleteTask]: {
    validate: validateDeleteTask,
    apply: applyDeleteTask,
    invert: cloneInversePatches,
    mergePolicy: neverMerge,
  },
  [MIND_MAP_COMMAND_TYPES.upsertTaskDependency]: {
    validate: validateUpsertTaskDependency,
    apply: applyUpsertTaskDependency,
    invert: cloneInversePatches,
    mergePolicy: neverMerge,
  },
  [MIND_MAP_COMMAND_TYPES.deleteTaskDependency]: {
    validate: validateDeleteTaskDependency,
    apply: applyDeleteTaskDependency,
    invert: cloneInversePatches,
    mergePolicy: neverMerge,
  },
  [MIND_MAP_COMMAND_TYPES.createSheet]: {
    validate: validateCreateSheet,
    apply: applyCreateSheet,
    invert: cloneInversePatches,
    mergePolicy: neverMerge,
  },
  [MIND_MAP_COMMAND_TYPES.renameSheet]: {
    validate: validateRenameSheet,
    apply: applyRenameSheet,
    invert: cloneInversePatches,
    mergePolicy: neverMerge,
  },
  [MIND_MAP_COMMAND_TYPES.reorderSheet]: {
    validate: validateReorderSheet,
    apply: applyReorderSheet,
    invert: cloneInversePatches,
    mergePolicy: neverMerge,
  },
  [MIND_MAP_COMMAND_TYPES.updateSheetLayout]: {
    validate: validateUpdateSheetLayout,
    apply: applyUpdateSheetLayout,
    invert: cloneInversePatches,
    mergePolicy: neverMerge,
  },
  [MIND_MAP_COMMAND_TYPES.deleteSheet]: {
    validate: validateDeleteSheet,
    apply: applyDeleteSheet,
    invert: cloneInversePatches,
    mergePolicy: neverMerge,
  },
};

export class MindMapCommandRegistry {
  readonly definitions: MindMapCommandDefinitions;

  constructor(definitions: MindMapCommandDefinitions = DEFINITIONS) {
    this.definitions = definitions;
  }

  has(type: string): type is MindMapCommandType {
    return Object.prototype.hasOwnProperty.call(this.definitions, type);
  }

  get<TType extends MindMapCommandType>(
    type: TType,
  ): CommandDefinition<CommandFor<TType>>;
  get(type: string): CommandDefinition<MindMapCommand>;
  get(type: string): CommandDefinition<MindMapCommand> {
    if (!this.has(type)) throw new UnknownMindMapCommandError(type);
    return this.definitions[type] as CommandDefinition<MindMapCommand>;
  }

  shouldMerge(previous: MindMapCommand, next: MindMapCommand): boolean {
    return this.get(next.type).mergePolicy.decide(previous, next) === 'merge';
  }
}

export const CORE_MIND_MAP_COMMAND_REGISTRY = new MindMapCommandRegistry();
