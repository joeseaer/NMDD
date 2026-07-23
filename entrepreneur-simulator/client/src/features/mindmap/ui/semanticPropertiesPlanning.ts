import type {
  ArrowHead,
  BoundaryId,
  CalloutId,
  ColorValue,
  CommandId,
  ElementRef,
  MindMapDocumentV1,
  RelationshipId,
  RichText,
  SheetId,
  SummaryId,
  Summary,
  StyleProperties,
  TopicId,
  ZoneId,
} from '../domain/types';
import { createRichText } from '../domain/defaults';
import { validateMindMapRichTextSchema } from '../domain/schema';
import type {
  UpdateBoundaryCommand,
  UpdateCalloutCommand,
  UpdateRelationshipCommand,
  UpdateSummaryCommand,
  UpdateStyleBindingsCommand,
  UpdateTopicTitleCommand,
  UpdateZoneCommand,
} from '../commands/types';
import { mindMapRichTextToPlainText } from '../view/text';
import { planUpdateTopicTitleCommand } from './commandPlanning';
import {
  planResetStyleBindingsCommand,
  planUpdateStyleBindingsCommand,
} from './formatPlanning';
import {
  planAdjustBoundaryRangeCommand,
  planUpdateBoundaryCommand,
  planUpdateBoundaryPaddingCommand,
  planUpdateCalloutCommand,
  planUpdateRelationshipCommand,
  planUpdateSummaryCommand,
  planUpdateZoneCommand,
} from './semanticPlanning';
import { semanticSiblingEdges } from '../domain/semanticScope';

export const BOUNDARY_SHAPE_VALUES = [
  'rectangle',
  'rounded-rectangle',
  'capsule',
  'ellipse',
  'scallop',
  'wave',
  'tension',
  'bracket',
  'none',
] as const;

export type BoundaryShape = (typeof BOUNDARY_SHAPE_VALUES)[number];

export const RELATIONSHIP_ROUTING_VALUES = [
  'straight',
  'curve',
  'orthogonal',
  'manual',
] as const;

export const RELATIONSHIP_ARROW_HEAD_VALUES = [
  'none',
  'triangle',
  'open-triangle',
  'diamond',
  'open-diamond',
  'circle',
  'open-circle',
  'square',
  'open-square',
  'bar',
  'double-bar',
] as const satisfies readonly ArrowHead[];

export const RELATIONSHIP_LINE_STYLE_VALUES = [
  'default',
  'solid',
  'dashed',
  'dotted',
] as const;

export type RelationshipRouting = (typeof RELATIONSHIP_ROUTING_VALUES)[number];
export type RelationshipLineStyle =
  | (typeof RELATIONSHIP_LINE_STYLE_VALUES)[number]
  | 'custom';
export type EditableRelationshipLineStyle = Exclude<RelationshipLineStyle, 'custom'>;

export const SUMMARY_ORIENTATION_VALUES = [
  'auto',
  'left',
  'right',
  'top',
  'bottom',
] as const satisfies readonly Summary['orientation'][];

export type SummaryOrientation = (typeof SUMMARY_ORIENTATION_VALUES)[number];

export type SemanticPropertiesElementRef = Extract<
  ElementRef,
  { kind: 'relationship' | 'boundary' | 'summary' | 'callout' | 'zone' }
>;

export type SemanticPropertiesCommand =
  | UpdateRelationshipCommand
  | UpdateBoundaryCommand
  | UpdateSummaryCommand
  | UpdateCalloutCommand
  | UpdateZoneCommand
  | UpdateTopicTitleCommand
  | UpdateStyleBindingsCommand;

interface SemanticPropertiesModelBase {
  readonly content: RichText;
  readonly contentLabel: string;
}

export type SemanticPropertiesModel =
  | (SemanticPropertiesModelBase & {
      readonly kind: 'relationship';
      readonly id: RelationshipId;
      readonly routing: RelationshipRouting;
      readonly lineStyle: RelationshipLineStyle;
      readonly lineColor?: ColorValue;
      readonly lineWidth?: number;
      readonly startArrow: ArrowHead;
      readonly endArrow: ArrowHead;
    })
  | (SemanticPropertiesModelBase & {
      readonly kind: 'boundary';
      readonly id: BoundaryId;
      readonly padding: number;
      readonly shape: BoundaryShape;
      readonly fillColor?: ColorValue;
      readonly borderColor?: ColorValue;
      readonly borderWidth?: number;
      readonly textColor?: ColorValue;
      readonly rangeAdjustable: boolean;
      readonly canExpandStart: boolean;
      readonly canShrinkStart: boolean;
      readonly canShrinkEnd: boolean;
      readonly canExpandEnd: boolean;
    })
  | (SemanticPropertiesModelBase & {
      readonly kind: 'summary';
      readonly id: SummaryId;
      readonly resultTopicId: TopicId;
      readonly orientation: SummaryOrientation;
      readonly lineStyle: RelationshipLineStyle;
      readonly lineColor?: ColorValue;
      readonly lineWidth?: number;
    })
  | (SemanticPropertiesModelBase & {
      readonly kind: 'callout';
      readonly id: CalloutId;
    })
  | (SemanticPropertiesModelBase & {
      readonly kind: 'zone';
      readonly id: ZoneId;
    });

interface BaseSemanticPropertiesPlanningInput {
  readonly document: MindMapDocumentV1;
  readonly sheetId: SheetId;
  readonly element: SemanticPropertiesElementRef;
  readonly commandId?: CommandId;
  readonly groupId?: string;
  readonly origin?: string;
  readonly timestamp?: string;
}

const planningMetadata = (input: BaseSemanticPropertiesPlanningInput) => ({
  ...(input.commandId === undefined ? {} : { commandId: input.commandId }),
  ...(input.groupId === undefined ? {} : { groupId: input.groupId }),
  ...(input.origin === undefined ? { origin: 'mindmap-v2-semantic-properties' } : { origin: input.origin }),
  ...(input.timestamp === undefined ? {} : { timestamp: input.timestamp }),
});

export const isSemanticPropertiesElementRef = (
  value: ElementRef | null,
): value is SemanticPropertiesElementRef => value?.kind === 'relationship'
  || value?.kind === 'boundary'
  || value?.kind === 'summary'
  || value?.kind === 'callout'
  || value?.kind === 'zone';

const lineStyleForDash = (dash: readonly number[] | undefined): RelationshipLineStyle => {
  if (dash === undefined) return 'default';
  if (dash.length === 0) return 'solid';
  if (dash.length === 2 && dash[0] === 6 && dash[1] === 4) return 'dashed';
  if (dash.length === 2 && dash[0] === 2 && dash[1] === 3) return 'dotted';
  return 'custom';
};

const emptyRichText = (): RichText => createRichText('');

/** Resolves one canonical semantic selection into a stable, renderer-free form model. */
export const buildSemanticPropertiesModel = (
  document: MindMapDocumentV1,
  sheetId: SheetId,
  element: ElementRef | null,
): SemanticPropertiesModel | null => {
  if (!isSemanticPropertiesElementRef(element)) return null;
  const sheet = document.sheets[sheetId];
  if (!sheet) return null;

  if (element.kind === 'relationship') {
    const relationship = sheet.relationships[element.id];
    if (!relationship) return null;
    return {
      kind: 'relationship',
      id: relationship.id,
      content: relationship.title ?? emptyRichText(),
      contentLabel: '关系标题',
      routing: relationship.routing,
      lineStyle: lineStyleForDash(relationship.style?.overrides?.connector?.dash),
      ...(relationship.style?.overrides?.connector?.color === undefined
        ? {}
        : { lineColor: structuredClone(relationship.style.overrides.connector.color) }),
      ...(relationship.style?.overrides?.connector?.width === undefined
        ? {}
        : { lineWidth: relationship.style.overrides.connector.width }),
      startArrow: relationship.startArrow,
      endArrow: relationship.endArrow,
    };
  }
  if (element.kind === 'boundary') {
    const boundary = sheet.boundaries[element.id];
    const scope = boundary?.scope;
    const first = scope?.kind === 'sibling-range' ? sheet.treeEdges[scope.firstEdgeId] : undefined;
    const siblings = first ? semanticSiblingEdges(sheet, first) : [];
    const firstIndex = scope?.kind === 'sibling-range'
      ? siblings.findIndex((edge) => edge.id === scope.firstEdgeId)
      : -1;
    const lastIndex = scope?.kind === 'sibling-range'
      ? siblings.findIndex((edge) => edge.id === scope.lastEdgeId)
      : -1;
    const rawShape = boundary?.style?.overrides?.shape;
    const shape = BOUNDARY_SHAPE_VALUES.includes(rawShape as BoundaryShape)
      ? rawShape as BoundaryShape
      : 'rounded-rectangle';
    return boundary ? {
      kind: 'boundary',
      id: boundary.id,
      content: boundary.title ?? emptyRichText(),
      contentLabel: '边界标题',
      padding: boundary.padding,
      shape,
      ...(boundary.style?.overrides?.fill?.color === undefined
        ? {} : { fillColor: boundary.style.overrides.fill.color }),
      ...(boundary.style?.overrides?.border?.color === undefined
        ? {} : { borderColor: boundary.style.overrides.border.color }),
      ...(boundary.style?.overrides?.border?.width === undefined
        ? {} : { borderWidth: boundary.style.overrides.border.width }),
      ...(boundary.style?.overrides?.typography?.color === undefined
        ? {} : { textColor: boundary.style.overrides.typography.color }),
      rangeAdjustable: firstIndex >= 0 && lastIndex >= firstIndex,
      canExpandStart: firstIndex > 0,
      canShrinkStart: firstIndex >= 0 && firstIndex < lastIndex,
      canShrinkEnd: firstIndex >= 0 && firstIndex < lastIndex,
      canExpandEnd: lastIndex >= 0 && lastIndex < siblings.length - 1,
    } : null;
  }
  if (element.kind === 'summary') {
    const summary = sheet.summaries[element.id];
    const resultTopic = summary && sheet.topics[summary.resultTopicId];
    return summary && resultTopic ? {
      kind: 'summary',
      id: summary.id,
      content: resultTopic.title,
      contentLabel: '概要内容',
      resultTopicId: resultTopic.id,
      orientation: summary.orientation,
      lineStyle: lineStyleForDash(summary.style?.overrides?.border?.dash),
      ...(summary.style?.overrides?.border?.color === undefined
        ? {} : { lineColor: structuredClone(summary.style.overrides.border.color) }),
      ...(summary.style?.overrides?.border?.width === undefined
        ? {} : { lineWidth: summary.style.overrides.border.width }),
    } : null;
  }
  if (element.kind === 'callout') {
    const callout = sheet.callouts[element.id];
    return callout ? {
      kind: 'callout',
      id: callout.id,
      content: callout.content,
      contentLabel: '标注内容',
    } : null;
  }
  const zone = sheet.zones[element.id];
  return zone ? {
    kind: 'zone',
    id: zone.id,
    content: zone.title ?? emptyRichText(),
    contentLabel: '区域标题',
  } : null;
};

export const planUpdateBoundaryStyleCommand = (
  input: BaseSemanticPropertiesPlanningInput & {
    readonly overrides: Pick<StyleProperties, 'shape' | 'fill' | 'border' | 'typography'>;
  },
): UpdateStyleBindingsCommand => {
  const model = requireModel(input);
  if (model.kind !== 'boundary') {
    throw new Error('Boundary style can only be updated for a Boundary.');
  }
  if (
    input.overrides.shape !== undefined
    && !BOUNDARY_SHAPE_VALUES.includes(input.overrides.shape as BoundaryShape)
  ) throw new Error(`Boundary shape ${input.overrides.shape} is not supported.`);
  return planUpdateStyleBindingsCommand({
    document: input.document,
    sheetId: input.sheetId,
    targets: [{ scope: 'boundary', id: model.id }],
    overrides: structuredClone(input.overrides),
    ...planningMetadata(input),
  });
};

export const planUpdateSummaryOrientationCommand = (
  input: BaseSemanticPropertiesPlanningInput & { readonly orientation: SummaryOrientation },
): UpdateSummaryCommand => {
  if (!SUMMARY_ORIENTATION_VALUES.includes(input.orientation)) {
    throw new Error(`Summary orientation ${String(input.orientation)} is not supported.`);
  }
  const model = requireModel(input);
  if (model.kind !== 'summary') throw new Error('Summary orientation requires a Summary.');
  if (model.orientation === input.orientation) {
    throw new Error('The Summary orientation update does not change the selected element.');
  }
  const summary = structuredClone(input.document.sheets[input.sheetId].summaries[model.id]);
  summary.orientation = input.orientation;
  return planUpdateSummaryCommand({
    ...input,
    ...planningMetadata(input),
    summary,
  });
};

export const planUpdateSummaryStyleCommand = (
  input: BaseSemanticPropertiesPlanningInput & {
    readonly border: NonNullable<StyleProperties['border']>;
  },
): UpdateStyleBindingsCommand => {
  const model = requireModel(input);
  if (model.kind !== 'summary') throw new Error('Summary line style requires a Summary.');
  return planUpdateStyleBindingsCommand({
    document: input.document,
    sheetId: input.sheetId,
    targets: [{ scope: 'summary', id: model.id }],
    overrides: { border: structuredClone(input.border) },
    ...planningMetadata(input),
  });
};

export const planUpdateSummaryLineStyleCommand = (
  input: BaseSemanticPropertiesPlanningInput & {
    readonly lineStyle: EditableRelationshipLineStyle;
  },
): UpdateStyleBindingsCommand => {
  if (!RELATIONSHIP_LINE_STYLE_VALUES.includes(input.lineStyle)) {
    throw new Error(`Summary line style ${String(input.lineStyle)} is not supported.`);
  }
  const model = requireModel(input);
  if (model.kind !== 'summary') throw new Error('Summary line style requires a Summary.');
  if (model.lineStyle === input.lineStyle) {
    throw new Error('The Summary line-style update does not change the selected element.');
  }
  if (input.lineStyle === 'default') {
    return planResetStyleBindingsCommand({
      document: input.document,
      sheetId: input.sheetId,
      targets: [{ scope: 'summary', id: model.id }],
      paths: ['border.dash'],
      ...planningMetadata(input),
    });
  }
  return planUpdateSummaryStyleCommand({
    ...input,
    border: { dash: input.lineStyle === 'solid'
      ? []
      : input.lineStyle === 'dashed' ? [6, 4] : [2, 3] },
  });
};

export const planUpdateBoundaryPadding = (
  input: BaseSemanticPropertiesPlanningInput & { readonly padding: number },
): UpdateBoundaryCommand => {
  const model = requireModel(input);
  if (model.kind !== 'boundary') throw new Error('Boundary padding requires a Boundary.');
  return planUpdateBoundaryPaddingCommand({
    ...input,
    ...planningMetadata(input),
    boundaryId: model.id,
    padding: input.padding,
  });
};

export const planAdjustBoundaryRange = (
  input: BaseSemanticPropertiesPlanningInput & {
    readonly endpoint: 'start' | 'end';
    readonly direction: 'outward' | 'inward';
  },
): UpdateBoundaryCommand => {
  const model = requireModel(input);
  if (model.kind !== 'boundary') throw new Error('Boundary range requires a Boundary.');
  return planAdjustBoundaryRangeCommand({
    ...input,
    ...planningMetadata(input),
    boundaryId: model.id,
    endpoint: input.endpoint,
    direction: input.direction,
  });
};

const requireModel = (
  input: BaseSemanticPropertiesPlanningInput,
): SemanticPropertiesModel => {
  const model = buildSemanticPropertiesModel(
    input.document,
    input.sheetId,
    input.element,
  );
  if (!model) {
    throw new Error(
      `Semantic element ${input.element.kind}:${input.element.id} does not exist in sheet ${input.sheetId}.`,
    );
  }
  return model;
};

const cloneValidatedRichText = (content: RichText): RichText => {
  const validation = validateMindMapRichTextSchema(content);
  if (!validation.valid) {
    const first = validation.errors[0];
    throw new Error(
      `Semantic content is invalid at ${first?.instancePath || '/'}: ${first?.message ?? 'schema validation failed'}.`,
    );
  }
  return structuredClone(content);
};

const sameJson = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

export interface PlanUpdateSemanticContentInput
  extends BaseSemanticPropertiesPlanningInput {
  readonly content: RichText;
}

/**
 * Plans one title/content commit. Summary text intentionally updates its owned
 * result Topic because Summary itself has no title field in the canonical schema.
 */
export const planUpdateSemanticContentCommand = (
  input: PlanUpdateSemanticContentInput,
): Exclude<SemanticPropertiesCommand, UpdateStyleBindingsCommand> => {
  const model = requireModel(input);
  const content = cloneValidatedRichText(input.content);
  if (sameJson(model.content, content)) {
    throw new Error('The semantic content update does not change the selected element.');
  }
  const metadata = planningMetadata(input);
  const sheet = input.document.sheets[input.sheetId];

  if (model.kind === 'relationship') {
    const relationship = structuredClone(sheet.relationships[model.id]);
    if (mindMapRichTextToPlainText(content) === '') delete relationship.title;
    else relationship.title = content;
    return planUpdateRelationshipCommand({
      ...input,
      ...metadata,
      relationship,
    });
  }
  if (model.kind === 'boundary') {
    const boundary = structuredClone(sheet.boundaries[model.id]);
    if (mindMapRichTextToPlainText(content) === '') delete boundary.title;
    else boundary.title = content;
    return planUpdateBoundaryCommand({ ...input, ...metadata, boundary });
  }
  if (model.kind === 'summary') {
    return planUpdateTopicTitleCommand({
      ...input,
      ...metadata,
      topicId: model.resultTopicId,
      title: content,
    });
  }
  if (model.kind === 'callout') {
    const callout = structuredClone(sheet.callouts[model.id]);
    callout.content = content;
    return planUpdateCalloutCommand({ ...input, ...metadata, callout });
  }
  const zone = structuredClone(sheet.zones[model.id]);
  if (mindMapRichTextToPlainText(content) === '') delete zone.title;
  else zone.title = content;
  return planUpdateZoneCommand({ ...input, ...metadata, zone });
};

export interface PlanUpdateRelationshipRoutingInput
  extends BaseSemanticPropertiesPlanningInput {
  readonly routing: RelationshipRouting;
}

export const planUpdateRelationshipRoutingCommand = (
  input: PlanUpdateRelationshipRoutingInput,
): UpdateRelationshipCommand => {
  if (!RELATIONSHIP_ROUTING_VALUES.includes(input.routing)) {
    throw new Error(`Relationship routing ${String(input.routing)} is not supported.`);
  }
  const model = requireModel(input);
  if (model.kind !== 'relationship') {
    throw new Error('Relationship routing can only be updated for a Relationship.');
  }
  if (model.routing === input.routing) {
    throw new Error('The relationship routing update does not change the selected element.');
  }
  const relationship = structuredClone(
    input.document.sheets[input.sheetId].relationships[model.id],
  );
  relationship.routing = input.routing;
  return planUpdateRelationshipCommand({
    ...input,
    ...planningMetadata(input),
    relationship,
  });
};

export interface PlanUpdateRelationshipArrowInput
  extends BaseSemanticPropertiesPlanningInput {
  readonly endpoint: 'start' | 'end';
  readonly arrow: ArrowHead;
}

export const planUpdateRelationshipArrowCommand = (
  input: PlanUpdateRelationshipArrowInput,
): UpdateRelationshipCommand => {
  if (input.endpoint !== 'start' && input.endpoint !== 'end') {
    throw new Error(`Relationship endpoint ${String(input.endpoint)} is not supported.`);
  }
  if (!RELATIONSHIP_ARROW_HEAD_VALUES.includes(input.arrow)) {
    throw new Error(`Relationship arrow ${String(input.arrow)} is not supported.`);
  }
  const model = requireModel(input);
  if (model.kind !== 'relationship') {
    throw new Error('Relationship arrows can only be updated for a Relationship.');
  }
  const current = input.endpoint === 'start' ? model.startArrow : model.endArrow;
  if (current === input.arrow) {
    throw new Error('The relationship arrow update does not change the selected element.');
  }
  const relationship = structuredClone(
    input.document.sheets[input.sheetId].relationships[model.id],
  );
  if (input.endpoint === 'start') relationship.startArrow = input.arrow;
  else relationship.endArrow = input.arrow;
  return planUpdateRelationshipCommand({
    ...input,
    ...planningMetadata(input),
    relationship,
  });
};

const dashForLineStyle = (
  lineStyle: Exclude<EditableRelationshipLineStyle, 'default'>,
): number[] => lineStyle === 'solid' ? [] : lineStyle === 'dashed' ? [6, 4] : [2, 3];

export interface PlanUpdateRelationshipLineStyleInput
  extends BaseSemanticPropertiesPlanningInput {
  readonly lineStyle: EditableRelationshipLineStyle;
}

/** Uses the established style-binding command so named Style and Theme state survive. */
export const planUpdateRelationshipLineStyleCommand = (
  input: PlanUpdateRelationshipLineStyleInput,
): UpdateStyleBindingsCommand => {
  if (!RELATIONSHIP_LINE_STYLE_VALUES.includes(input.lineStyle)) {
    throw new Error(`Relationship line style ${String(input.lineStyle)} is not supported.`);
  }
  const model = requireModel(input);
  if (model.kind !== 'relationship') {
    throw new Error('Relationship line style can only be updated for a Relationship.');
  }
  if (model.lineStyle === input.lineStyle) {
    throw new Error('The relationship line-style update does not change the selected element.');
  }
  const common = {
    document: input.document,
    sheetId: input.sheetId,
    targets: [{ scope: 'relationship' as const, id: model.id }],
    ...planningMetadata(input),
  };
  return input.lineStyle === 'default'
    ? planResetStyleBindingsCommand({ ...common, paths: ['connector.dash'] })
    : planUpdateStyleBindingsCommand({
        ...common,
        overrides: { connector: { dash: dashForLineStyle(input.lineStyle) } },
      });
};

const assertColorValue = (color: ColorValue): void => {
  if (!color || typeof color !== 'object' || Array.isArray(color)) {
    throw new Error('Relationship line color must be a canonical ColorValue.');
  }
  if (color.kind === 'literal') {
    if (
      Object.keys(color).length !== 2
      || !/^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color.value)
    ) {
      throw new Error('Relationship literal line color must be #RRGGBB or #RRGGBBAA.');
    }
    return;
  }
  if (
    color.kind !== 'token'
    || Object.keys(color).length !== 2
    || color.token.length < 1
    || color.token.length > 128
  ) {
    throw new Error('Relationship token line color must contain a 1-128 character token.');
  }
};

export interface PlanUpdateRelationshipLineColorInput
  extends BaseSemanticPropertiesPlanningInput {
  /** null clears the local override and resumes the named Style/Theme cascade. */
  readonly color: ColorValue | null;
}

export const planUpdateRelationshipLineColorCommand = (
  input: PlanUpdateRelationshipLineColorInput,
): UpdateStyleBindingsCommand => {
  const model = requireModel(input);
  if (model.kind !== 'relationship') {
    throw new Error('Relationship line color can only be updated for a Relationship.');
  }
  if (input.color !== null) assertColorValue(input.color);
  if (sameJson(model.lineColor, input.color ?? undefined)) {
    throw new Error('The relationship line-color update does not change the selected element.');
  }
  const common = {
    document: input.document,
    sheetId: input.sheetId,
    targets: [{ scope: 'relationship' as const, id: model.id }],
    ...planningMetadata(input),
  };
  return input.color === null
    ? planResetStyleBindingsCommand({ ...common, paths: ['connector.color'] })
    : planUpdateStyleBindingsCommand({
        ...common,
        overrides: { connector: { color: structuredClone(input.color) } },
      });
};

export interface PlanUpdateRelationshipLineWidthInput
  extends BaseSemanticPropertiesPlanningInput {
  /** null clears the local override and resumes the named Style/Theme cascade. */
  readonly width: number | null;
}

export const planUpdateRelationshipLineWidthCommand = (
  input: PlanUpdateRelationshipLineWidthInput,
): UpdateStyleBindingsCommand => {
  const model = requireModel(input);
  if (model.kind !== 'relationship') {
    throw new Error('Relationship line width can only be updated for a Relationship.');
  }
  if (
    input.width !== null
    && (!Number.isFinite(input.width) || input.width < 0 || input.width > 1000)
  ) {
    throw new Error('Relationship line width must be a finite number from 0 to 1000.');
  }
  if (model.lineWidth === (input.width ?? undefined)) {
    throw new Error('The relationship line-width update does not change the selected element.');
  }
  const common = {
    document: input.document,
    sheetId: input.sheetId,
    targets: [{ scope: 'relationship' as const, id: model.id }],
    ...planningMetadata(input),
  };
  return input.width === null
    ? planResetStyleBindingsCommand({ ...common, paths: ['connector.width'] })
    : planUpdateStyleBindingsCommand({
        ...common,
        overrides: { connector: { width: input.width } },
      });
};
