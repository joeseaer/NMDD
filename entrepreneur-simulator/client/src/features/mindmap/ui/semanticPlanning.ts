import {
  createRichText,
  createTopic,
} from '../domain/defaults';
import { createEntityId } from '../domain/ids';
import type {
  Boundary,
  BoundaryId,
  Callout,
  CalloutId,
  CommandId,
  ElementRef,
  MindMapDocumentV1,
  Relationship,
  RelationshipId,
  Rect,
  SheetId,
  Summary,
  SummaryId,
  TopicId,
  Zone,
} from '../domain/types';
import { withBoundaryFrame, withUniformBoundaryFrameOutsets } from '../domain/boundaryFrame';
import {
  MIND_MAP_COMMAND_TYPES,
  type CreateBoundaryCommand,
  type CreateCalloutCommand,
  type CreateRelationshipCommand,
  type CreateSummaryCommand,
  type DeleteBoundaryCommand,
  type DeleteCalloutCommand,
  type DeleteRelationshipCommand,
  type DeleteSummaryCommand,
  type UpdateBoundaryCommand,
  type UpdateCalloutCommand,
  type UpdateRelationshipCommand,
  type UpdateSummaryCommand,
  type UpdateZoneCommand,
} from '../commands/types';
import { getDescendants } from '../domain/tree';
import {
  normalizeSemanticScopeSelection,
  collectSummaryCascadeDeletionTopicIds,
  semanticSiblingEdges,
} from '../domain/semanticScope';
import { materializeBoundaryScopeChanges } from './boundaryScopePlanning';

export type SemanticCreateKind =
  | 'relationship'
  | 'boundary'
  | 'summary'
  | 'callout';

export type DeletableSemanticElementRef = Extract<
  ElementRef,
  { kind: SemanticCreateKind }
>;

export type CreateSemanticElementCommand =
  | CreateRelationshipCommand
  | CreateBoundaryCommand
  | CreateSummaryCommand
  | CreateCalloutCommand;

export type UpdateSemanticElementCommand =
  | UpdateRelationshipCommand
  | UpdateBoundaryCommand
  | UpdateSummaryCommand
  | UpdateCalloutCommand
  | UpdateZoneCommand;

export type DeleteSemanticElementCommand =
  | DeleteRelationshipCommand
  | DeleteBoundaryCommand
  | DeleteSummaryCommand
  | DeleteCalloutCommand;

interface SemanticCommandInput {
  readonly document: MindMapDocumentV1;
  readonly sheetId: SheetId;
  readonly commandId?: CommandId;
  readonly groupId?: string;
  readonly origin?: string;
  readonly timestamp?: string;
}

const commandMetadata = (input: SemanticCommandInput) => ({
  commandId: input.commandId ?? createEntityId<'Command'>(),
  sheetId: input.sheetId,
  baseRevision: input.document.contentRevision,
  ...(input.groupId ? { groupId: input.groupId } : {}),
  origin: input.origin ?? 'mindmap-v2-ui',
  timestamp: input.timestamp ?? new Date().toISOString(),
});

const getSheet = (input: SemanticCommandInput) => {
  const sheet = input.document.sheets[input.sheetId];
  if (!sheet) throw new Error(`Sheet ${input.sheetId} does not exist.`);
  return sheet;
};

const assertTopic = (input: SemanticCommandInput, topicId: TopicId): void => {
  if (!getSheet(input).topics[topicId]) {
    throw new Error(`Topic ${topicId} does not exist.`);
  }
};

export interface PlanCreateRelationshipInput extends SemanticCommandInput {
  /** Selection order is preserved as source -> target. Exactly two unique Topics are required. */
  readonly topicIds: readonly [TopicId, TopicId] | readonly TopicId[];
  readonly relationshipId?: RelationshipId;
  readonly title?: string;
}

export const planCreateRelationshipCommand = (
  input: PlanCreateRelationshipInput,
): CreateRelationshipCommand => {
  const topicIds = [...new Set(input.topicIds)];
  if (topicIds.length !== 2) {
    throw new Error('Creating a Relationship requires exactly two unique Topics.');
  }
  assertTopic(input, topicIds[0]);
  assertTopic(input, topicIds[1]);
  const relationship: Relationship = {
    id: input.relationshipId ?? createEntityId<'Relationship'>(),
    source: {
      element: { kind: 'topic', topicId: topicIds[0] },
      anchor: 'auto',
    },
    target: {
      element: { kind: 'topic', topicId: topicIds[1] },
      anchor: 'auto',
    },
    ...(input.title === undefined ? {} : { title: createRichText(input.title) }),
    routing: 'curve',
    startArrow: 'none',
    endArrow: 'triangle',
  };
  return {
    ...commandMetadata(input),
    type: MIND_MAP_COMMAND_TYPES.createRelationship,
    payload: { relationship },
  };
};

export interface PlanCreateBoundaryInput extends SemanticCommandInput {
  readonly topicId?: TopicId;
  readonly topicIds?: readonly TopicId[];
  readonly boundaryId?: BoundaryId;
  /** Complete deterministic ID list, useful for replay/tests. */
  readonly boundaryIds?: readonly BoundaryId[];
  readonly title?: string;
  readonly padding?: number;
}

export interface BoundaryCreationPreview {
  readonly eligible: boolean;
  readonly groupCount: number;
  readonly reason?: string;
  readonly splitPreview?: string;
}

const selectedBoundaryTopicIds = (input: PlanCreateBoundaryInput): TopicId[] =>
  [...new Set(input.topicIds ?? (input.topicId ? [input.topicId] : []))];

export const previewBoundaryCreation = (
  document: MindMapDocumentV1,
  sheetId: SheetId,
  topicIds: readonly TopicId[],
): BoundaryCreationPreview => {
  const sheet = document.sheets[sheetId];
  if (!sheet) return { eligible: false, groupCount: 0, reason: '当前 Sheet 不存在。' };
  const selected = [...new Set(topicIds)];
  if (selected.length === 0) {
    return { eligible: false, groupCount: 0, reason: '请至少选择一个普通主题。' };
  }
  const missing = selected.find((topicId) => !sheet.topics[topicId]);
  if (missing) return { eligible: false, groupCount: 0, reason: `主题 ${missing} 不存在。` };
  const central = selected.find((topicId) => sheet.topics[topicId].role === 'central');
  if (central) {
    return {
      eligible: false,
      groupCount: 0,
      reason: '中心主题不能加入边界范围。',
    };
  }
  const floatingCount = selected.filter(
    (topicId) => sheet.topics[topicId].role === 'floating-root',
  ).length;
  if (floatingCount > 1) {
    return {
      eligible: false,
      groupCount: 0,
      reason: '多个浮动主题不能合并创建边界，请分别创建。',
    };
  }
  const normalization = normalizeSemanticScopeSelection(sheet, selected);
  if (normalization.groups.length === 0 || normalization.rejectedTopicIds.length > 0) {
    return { eligible: false, groupCount: 0, reason: '选择无法归一化为合法连续范围。' };
  }
  const reasons = normalization.splitReasons.map((reason) =>
    reason === 'cross-branch' ? '跨分支' : '存在不连续主题');
  return {
    eligible: true,
    groupCount: normalization.groups.length,
    ...(normalization.groups.length > 1
      ? { splitPreview: `将因${reasons.join('且')}拆分为 ${normalization.groups.length} 个边界。` }
      : {}),
  };
};

export const planCreateBoundaryCommand = (
  input: PlanCreateBoundaryInput,
): CreateBoundaryCommand => {
  const topicIds = selectedBoundaryTopicIds(input);
  const preview = previewBoundaryCreation(input.document, input.sheetId, topicIds);
  if (!preview.eligible) throw new Error(preview.reason ?? 'Boundary selection is invalid.');
  const sheet = getSheet(input);
  const normalization = normalizeSemanticScopeSelection(sheet, topicIds);
  const suppliedIds = input.boundaryIds ? [...input.boundaryIds] : [];
  if (input.boundaryId) {
    if (suppliedIds.length > 0 && suppliedIds[0] !== input.boundaryId) {
      throw new Error('boundaryId must equal the first boundaryIds entry.');
    }
    if (suppliedIds.length === 0) suppliedIds.push(input.boundaryId);
  }
  if (input.boundaryIds && suppliedIds.length !== normalization.groups.length) {
    throw new Error(
      `Boundary creation needs ${normalization.groups.length} IDs; received ${suppliedIds.length}.`,
    );
  }
  const used = new Set<string>();
  const boundaries = normalization.groups.map<Boundary>((group, index) => {
    const id = suppliedIds[index] ?? createEntityId<'Boundary'>();
    if (used.has(id) || sheet.boundaries[id]) throw new Error(`Boundary ID ${id} is already in use.`);
    used.add(id);
    return {
      id,
      scope: group.scope,
      title: createRichText(input.title ?? '边界'),
      padding: input.padding ?? 16,
    };
  });
  const [boundary, ...additionalBoundaries] = boundaries;
  return {
    ...commandMetadata(input),
    type: MIND_MAP_COMMAND_TYPES.createBoundary,
    payload: {
      selectedTopicIds: topicIds,
      boundary,
      ...(additionalBoundaries.length === 0 ? {} : { additionalBoundaries }),
    },
  };
};

export type BoundaryRangeEndpoint = 'start' | 'end';
export type BoundaryRangeDirection = 'outward' | 'inward';

export const planAdjustBoundaryRangeCommand = (
  input: SemanticCommandInput & {
    readonly boundaryId: BoundaryId;
    readonly endpoint: BoundaryRangeEndpoint;
    readonly direction: BoundaryRangeDirection;
    readonly steps?: number;
  },
): UpdateBoundaryCommand => {
  const sheet = getSheet(input);
  const current = sheet.boundaries[input.boundaryId];
  if (!current) throw new Error(`Boundary ${input.boundaryId} does not exist.`);
  if (current.scope.kind !== 'sibling-range') {
    throw new Error('只有连续兄弟范围支持调整起止位置。');
  }
  const first = sheet.treeEdges[current.scope.firstEdgeId];
  const last = sheet.treeEdges[current.scope.lastEdgeId];
  if (!first || !last) throw new Error('Boundary range endpoints are missing.');
  const siblings = semanticSiblingEdges(sheet, first);
  const firstIndex = siblings.findIndex((edge) => edge.id === first.id);
  const lastIndex = siblings.findIndex((edge) => edge.id === last.id);
  if (firstIndex < 0 || lastIndex < firstIndex) throw new Error('Boundary range is invalid.');
  const steps = input.steps ?? 1;
  if (!Number.isSafeInteger(steps) || steps < 1) {
    throw new Error('Boundary range steps must be a positive safe integer.');
  }
  let nextFirst = firstIndex;
  let nextLast = lastIndex;
  if (input.endpoint === 'start') {
    nextFirst += input.direction === 'outward' ? -steps : steps;
  } else {
    nextLast += input.direction === 'outward' ? steps : -steps;
  }
  if (nextFirst < 0 || nextLast >= siblings.length) {
    throw new Error('边界范围已经到达当前分组边缘。');
  }
  if (nextFirst > nextLast) throw new Error('边界范围至少需要包含一个主题。');
  const boundary = structuredClone(current);
  boundary.scope = {
    ...current.scope,
    firstEdgeId: siblings[nextFirst].id,
    lastEdgeId: siblings[nextLast].id,
  };
  return planUpdateBoundaryCommand({ ...input, boundary });
};

export const planUpdateBoundaryPaddingCommand = (
  input: SemanticCommandInput & { readonly boundaryId: BoundaryId; readonly padding: number },
): UpdateBoundaryCommand => {
  if (!Number.isFinite(input.padding) || input.padding < 0 || input.padding > 10_000) {
    throw new Error('边界内边距必须是 0 到 10000 的有限数值。');
  }
  const current = getSheet(input).boundaries[input.boundaryId];
  if (!current) throw new Error(`Boundary ${input.boundaryId} does not exist.`);
  if (current.padding === input.padding) throw new Error('边界内边距没有变化。');
  return planUpdateBoundaryCommand({
    ...input,
    boundary: withUniformBoundaryFrameOutsets(current, input.padding),
  });
};

export const planResizeBoundaryFrameCommand = (
  input: SemanticCommandInput & {
    readonly boundaryId: BoundaryId;
    readonly memberBounds: Readonly<Rect>;
    readonly frame: Readonly<Rect>;
  },
): UpdateBoundaryCommand => {
  const current = getSheet(input).boundaries[input.boundaryId];
  if (!current) throw new Error(`Boundary ${input.boundaryId} does not exist.`);
  for (const [label, value] of Object.entries({
    memberX: input.memberBounds.x,
    memberY: input.memberBounds.y,
    memberWidth: input.memberBounds.width,
    memberHeight: input.memberBounds.height,
    frameX: input.frame.x,
    frameY: input.frame.y,
    frameWidth: input.frame.width,
    frameHeight: input.frame.height,
  })) {
    if (!Number.isFinite(value)) throw new Error(`Boundary frame ${label} must be finite.`);
  }
  if (
    input.memberBounds.width <= 0
    || input.memberBounds.height <= 0
    || input.frame.width <= 0
    || input.frame.height <= 0
  ) throw new Error('Boundary frame dimensions must be positive.');
  const epsilon = 0.000_001;
  if (
    input.frame.x > input.memberBounds.x + epsilon
    || input.frame.y > input.memberBounds.y + epsilon
    || input.frame.x + input.frame.width
      < input.memberBounds.x + input.memberBounds.width - epsilon
    || input.frame.y + input.frame.height
      < input.memberBounds.y + input.memberBounds.height - epsilon
  ) throw new Error('Boundary frame must contain every scoped topic.');
  return planUpdateBoundaryCommand({
    ...input,
    boundary: withBoundaryFrame(current, input.memberBounds, input.frame),
  });
};

export interface PlanCreateSummaryInput extends SemanticCommandInput {
  readonly topicId?: TopicId;
  readonly topicIds?: readonly TopicId[];
  readonly summaryId?: SummaryId;
  /** Complete deterministic Summary ID list, useful for replay/tests. */
  readonly summaryIds?: readonly SummaryId[];
  readonly resultTopicId?: TopicId;
  /** Complete deterministic result Topic ID list, useful for replay/tests. */
  readonly resultTopicIds?: readonly TopicId[];
  readonly resultTitle?: string;
}

export interface SummaryCreationPreview {
  readonly eligible: boolean;
  readonly groupCount: number;
  readonly reason?: string;
  readonly splitPreview?: string;
}

const selectedSummaryTopicIds = (input: PlanCreateSummaryInput): TopicId[] =>
  [...new Set(input.topicIds ?? (input.topicId ? [input.topicId] : []))];

export const previewSummaryCreation = (
  document: MindMapDocumentV1,
  sheetId: SheetId,
  topicIds: readonly TopicId[],
): SummaryCreationPreview => {
  const sheet = document.sheets[sheetId];
  if (!sheet) return { eligible: false, groupCount: 0, reason: '当前 Sheet 不存在。' };
  const selected = [...new Set(topicIds)];
  if (selected.length === 0) {
    return { eligible: false, groupCount: 0, reason: '请至少选择一个普通主题。' };
  }
  const missing = selected.find((topicId) => !sheet.topics[topicId]);
  if (missing) return { eligible: false, groupCount: 0, reason: `主题 ${missing} 不存在。` };
  const invalidRole = selected.find((topicId) => {
    const role = sheet.topics[topicId].role;
    return role === 'central' || role === 'summary-result';
  });
  if (invalidRole) {
    return {
      eligible: false,
      groupCount: 0,
      reason: '中心主题和概要结果主题不能加入概要范围。',
    };
  }
  const floatingCount = selected.filter(
    (topicId) => sheet.topics[topicId].role === 'floating-root',
  ).length;
  if (floatingCount > 1) {
    return {
      eligible: false,
      groupCount: 0,
      reason: '多个浮动主题不能合并创建概要，请分别创建。',
    };
  }
  const normalization = normalizeSemanticScopeSelection(sheet, selected);
  if (normalization.groups.length === 0 || normalization.rejectedTopicIds.length > 0) {
    return { eligible: false, groupCount: 0, reason: '选择无法归一化为合法概要范围。' };
  }
  const reasons = normalization.splitReasons.map((reason) =>
    reason === 'cross-branch' ? '跨分支' : '存在不连续主题');
  return {
    eligible: true,
    groupCount: normalization.groups.length,
    ...(normalization.groups.length > 1
      ? { splitPreview: `将因${reasons.join('且')}拆分为 ${normalization.groups.length} 个概要。` }
      : {}),
  };
};

const containsEntityId = (value: unknown, id: string): boolean => {
  if (!value || typeof value !== 'object') return false;
  if (!Array.isArray(value) && (value as { id?: unknown }).id === id) return true;
  return Object.values(value).some((child) => containsEntityId(child, id));
};

export const planCreateSummaryCommand = (
  input: PlanCreateSummaryInput,
): CreateSummaryCommand => {
  const topicIds = selectedSummaryTopicIds(input);
  const preview = previewSummaryCreation(input.document, input.sheetId, topicIds);
  if (!preview.eligible) throw new Error(preview.reason ?? 'Summary selection is invalid.');
  const sheet = getSheet(input);
  const normalization = normalizeSemanticScopeSelection(sheet, topicIds);
  const summaryIds = input.summaryIds ? [...input.summaryIds] : [];
  const resultTopicIds = input.resultTopicIds ? [...input.resultTopicIds] : [];
  if (input.summaryId) {
    if (summaryIds.length > 0 && summaryIds[0] !== input.summaryId) {
      throw new Error('summaryId must equal the first summaryIds entry.');
    }
    if (summaryIds.length === 0) summaryIds.push(input.summaryId);
  }
  if (input.resultTopicId) {
    if (resultTopicIds.length > 0 && resultTopicIds[0] !== input.resultTopicId) {
      throw new Error('resultTopicId must equal the first resultTopicIds entry.');
    }
    if (resultTopicIds.length === 0) resultTopicIds.push(input.resultTopicId);
  }
  if (input.summaryIds && summaryIds.length !== normalization.groups.length) {
    throw new Error(
      `Summary creation needs ${normalization.groups.length} Summary IDs; received ${summaryIds.length}.`,
    );
  }
  if (input.resultTopicIds && resultTopicIds.length !== normalization.groups.length) {
    throw new Error(
      `Summary creation needs ${normalization.groups.length} result Topic IDs; received ${resultTopicIds.length}.`,
    );
  }
  const plannedIds = new Set<string>();
  const assertFresh = (id: string, label: string): void => {
    if (plannedIds.has(id) || containsEntityId(input.document, id)) {
      throw new Error(`${label} ID ${id} is already in use.`);
    }
    plannedIds.add(id);
  };
  const creations = normalization.groups.map((group, index) => {
    const summaryId = summaryIds[index] ?? createEntityId<'Summary'>();
    const resultTopicId = resultTopicIds[index] ?? createEntityId<'Topic'>();
    assertFresh(summaryId, 'Summary');
    assertFresh(resultTopicId, 'Summary result Topic');
    const resultTopic = createTopic({
      id: resultTopicId,
      role: 'summary-result',
      title: input.resultTitle ?? '概要',
    });
    const summary: Summary = {
      id: summaryId,
      scope: group.scope,
      resultTopicId,
      orientation: 'auto',
    };
    return { summary, resultTopic };
  });
  return {
    ...commandMetadata(input),
    type: MIND_MAP_COMMAND_TYPES.createSummary,
    payload: { selectedTopicIds: topicIds, creations },
  };
};

export type SummaryRangeEndpoint = 'start' | 'end';
export type SummaryRangeDirection = 'outward' | 'inward';

export const planAdjustSummaryRangeCommand = (
  input: SemanticCommandInput & {
    readonly summaryId: SummaryId;
    readonly endpoint: SummaryRangeEndpoint;
    readonly direction: SummaryRangeDirection;
    readonly steps?: number;
  },
): UpdateSummaryCommand => {
  const sheet = getSheet(input);
  const current = sheet.summaries[input.summaryId];
  if (!current) throw new Error(`Summary ${input.summaryId} does not exist.`);
  if (current.scope.kind !== 'sibling-range') {
    throw new Error('只有连续兄弟范围支持调整概要起止位置。');
  }
  const first = sheet.treeEdges[current.scope.firstEdgeId];
  const last = sheet.treeEdges[current.scope.lastEdgeId];
  if (!first || !last) throw new Error('Summary range endpoints are missing.');
  const siblings = semanticSiblingEdges(sheet, first);
  const firstIndex = siblings.findIndex((edge) => edge.id === first.id);
  const lastIndex = siblings.findIndex((edge) => edge.id === last.id);
  if (firstIndex < 0 || lastIndex < firstIndex) throw new Error('Summary range is invalid.');
  const steps = input.steps ?? 1;
  if (!Number.isSafeInteger(steps) || steps < 1) {
    throw new Error('Summary range steps must be a positive safe integer.');
  }
  let nextFirst = firstIndex;
  let nextLast = lastIndex;
  if (input.endpoint === 'start') {
    nextFirst += input.direction === 'outward' ? -steps : steps;
  } else {
    nextLast += input.direction === 'outward' ? steps : -steps;
  }
  if (nextFirst < 0 || nextLast >= siblings.length) {
    throw new Error('概要范围已经到达当前分组边缘。');
  }
  if (nextFirst > nextLast) throw new Error('概要范围至少需要包含一个主题。');
  const summary = structuredClone(current);
  summary.scope = {
    ...current.scope,
    firstEdgeId: siblings[nextFirst].id,
    lastEdgeId: siblings[nextLast].id,
  };
  return planUpdateSummaryCommand({ ...input, summary });
};

export interface PlanCreateCalloutInput extends SemanticCommandInput {
  readonly topicId: TopicId;
  readonly calloutId?: CalloutId;
  readonly content?: string;
}

export const planCreateCalloutCommand = (
  input: PlanCreateCalloutInput,
): CreateCalloutCommand => {
  assertTopic(input, input.topicId);
  const callout: Callout = {
    id: input.calloutId ?? createEntityId<'Callout'>(),
    targetTopicId: input.topicId,
    content: createRichText(input.content ?? '标注'),
    placement: { mode: 'auto', preferredSide: 'right' },
    tail: 'curve',
  };
  return {
    ...commandMetadata(input),
    type: MIND_MAP_COMMAND_TYPES.createCallout,
    payload: { callout },
  };
};

export const planUpdateRelationshipCommand = (
  input: SemanticCommandInput & { readonly relationship: Relationship },
): UpdateRelationshipCommand => ({
  ...commandMetadata(input),
  type: MIND_MAP_COMMAND_TYPES.updateRelationship,
  payload: { relationship: input.relationship },
});

export const planUpdateBoundaryCommand = (
  input: SemanticCommandInput & { readonly boundary: Boundary },
): UpdateBoundaryCommand => ({
  ...commandMetadata(input),
  type: MIND_MAP_COMMAND_TYPES.updateBoundary,
  payload: { boundary: input.boundary },
});

export const planUpdateSummaryCommand = (
  input: SemanticCommandInput & { readonly summary: Summary },
): UpdateSummaryCommand => ({
  ...commandMetadata(input),
  type: MIND_MAP_COMMAND_TYPES.updateSummary,
  payload: { summary: input.summary },
});

export const planUpdateCalloutCommand = (
  input: SemanticCommandInput & { readonly callout: Callout },
): UpdateCalloutCommand => ({
  ...commandMetadata(input),
  type: MIND_MAP_COMMAND_TYPES.updateCallout,
  payload: { callout: input.callout },
});

export const planUpdateZoneCommand = (
  input: SemanticCommandInput & { readonly zone: Zone },
): UpdateZoneCommand => ({
  ...commandMetadata(input),
  type: MIND_MAP_COMMAND_TYPES.updateZone,
  payload: { zone: input.zone },
});

export const isDeletableSemanticElementRef = (
  reference: ElementRef | null,
): reference is DeletableSemanticElementRef =>
  reference?.kind === 'relationship'
  || reference?.kind === 'boundary'
  || reference?.kind === 'summary'
  || reference?.kind === 'callout';

export interface PlanDeleteSemanticElementInput extends SemanticCommandInput {
  readonly element: DeletableSemanticElementRef;
}

export const planDeleteSemanticElementCommand = (
  input: PlanDeleteSemanticElementInput,
): DeleteSemanticElementCommand => {
  const metadata = commandMetadata(input);
  if (input.element.kind === 'relationship') {
    return {
      ...metadata,
      type: MIND_MAP_COMMAND_TYPES.deleteRelationship,
      payload: { relationshipId: input.element.id },
    };
  }
  if (input.element.kind === 'boundary') {
    return {
      ...metadata,
      type: MIND_MAP_COMMAND_TYPES.deleteBoundary,
      payload: { boundaryId: input.element.id },
    };
  }
  if (input.element.kind === 'summary') {
    const sheet = getSheet(input);
    const summary = sheet.summaries[input.element.id];
    if (!summary) throw new Error(`Summary ${input.element.id} does not exist.`);
    const deletedTopicIds = collectSummaryCascadeDeletionTopicIds(sheet, new Set<TopicId>([
      summary.resultTopicId,
      ...getDescendants(sheet, summary.resultTopicId).map((topic) => topic.id),
    ]));
    const after = structuredClone(sheet);
    for (const topicId of deletedTopicIds) delete after.topics[topicId];
    for (const edge of Object.values(after.treeEdges)) {
      if (deletedTopicIds.has(edge.parentTopicId) || deletedTopicIds.has(edge.childTopicId)) {
        delete after.treeEdges[edge.id];
      }
    }
    const boundaryScopeChanges = materializeBoundaryScopeChanges({ before: sheet, after });
    return {
      ...metadata,
      type: MIND_MAP_COMMAND_TYPES.deleteSummary,
      payload: {
        summaryId: input.element.id,
        ...(boundaryScopeChanges.length === 0 ? {} : { boundaryScopeChanges }),
      },
    };
  }
  return {
    ...metadata,
    type: MIND_MAP_COMMAND_TYPES.deleteCallout,
    payload: { calloutId: input.element.id },
  };
};

export const createdElementRef = (
  command: CreateSemanticElementCommand,
): DeletableSemanticElementRef => {
  if (command.type === MIND_MAP_COMMAND_TYPES.createRelationship) {
    return { kind: 'relationship', id: command.payload.relationship.id };
  }
  if (command.type === MIND_MAP_COMMAND_TYPES.createBoundary) {
    return { kind: 'boundary', id: command.payload.boundary.id };
  }
  if (command.type === MIND_MAP_COMMAND_TYPES.createSummary) {
    return { kind: 'summary', id: command.payload.creations[0].summary.id };
  }
  return { kind: 'callout', id: command.payload.callout.id };
};
