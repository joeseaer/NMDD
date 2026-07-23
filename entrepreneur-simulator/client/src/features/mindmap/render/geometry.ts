import type {
  ArrowHead,
  BoundaryId,
  BranchSide,
  CalloutId,
  ElementRef,
  Point,
  Rect,
  RelationshipAnchor,
  RelationshipControlPoint,
  RelationshipId,
  RelationshipTargetRef,
  Size,
  SummaryId,
  TopicId,
  ZoneId,
} from '../domain/types';
import { deriveBoundaryFrame } from '../domain/boundaryFrame';
import type { CoreLayoutResult } from '../layout/engine';
import type {
  MindMapRenderModel,
  RelationshipEndpointRenderState,
} from './model';

export const DEFAULT_CALLOUT_SIZE: Readonly<Size> = Object.freeze({
  width: 180,
  height: 72,
});

const CALLOUT_GAP = 36;
const SUMMARY_SCOPE_PADDING = 4;
const SUMMARY_BRACKET_GAP = 16;
const SUMMARY_BRACKET_TICK = 12;
const PATH_HIT_TOLERANCE = 8;
const CURVE_SAMPLE_COUNT = 12;

export type SemanticGeometrySuppressionReason =
  | 'hidden-endpoint'
  | 'missing-endpoint'
  | 'missing-layout'
  | 'no-visible-members';

export type SemanticGeometryPathCommand =
  | { readonly kind: 'move'; readonly to: Readonly<Point> }
  | { readonly kind: 'line'; readonly to: Readonly<Point> }
  | {
      readonly kind: 'quadratic';
      readonly control: Readonly<Point>;
      readonly to: Readonly<Point>;
    }
  | {
      readonly kind: 'cubic';
      readonly control1: Readonly<Point>;
      readonly control2: Readonly<Point>;
      readonly to: Readonly<Point>;
    }
  | { readonly kind: 'close' };

export interface SemanticGeometryPath {
  readonly commands: readonly SemanticGeometryPathCommand[];
  /** Deterministically flattened geometry for renderer-independent hit tests. */
  readonly hitPolyline: readonly Readonly<Point>[];
  readonly bounds: Readonly<Rect>;
}

export type SemanticGeometryHitRegion =
  | { readonly kind: 'rect'; readonly rect: Readonly<Rect> }
  | {
      readonly kind: 'path';
      readonly polyline: readonly Readonly<Point>[];
      readonly tolerance: number;
    };

interface SemanticOverlayGeometryBase<TKind extends string, TId extends string> {
  readonly kind: TKind;
  readonly entityId: TId;
  readonly visibility: 'visible' | 'hidden';
  readonly suppressionReason?: SemanticGeometrySuppressionReason;
  readonly bounds?: Readonly<Rect>;
  readonly hitRegions: readonly SemanticGeometryHitRegion[];
}

export interface BoundaryOverlayGeometry extends SemanticOverlayGeometryBase<
  'boundary',
  BoundaryId
> {
  readonly memberTopicIds: readonly TopicId[];
  readonly hiddenTopicIds: readonly TopicId[];
  readonly unresolvedTopicIds: readonly TopicId[];
  readonly memberBounds?: Readonly<Rect>;
  readonly frame?: Readonly<Rect>;
  readonly outline?: SemanticGeometryPath;
}

export type SummaryGeometryOrientation = 'left' | 'right' | 'top' | 'bottom';

export interface SummaryOverlayGeometry extends SemanticOverlayGeometryBase<
  'summary',
  SummaryId
> {
  readonly memberTopicIds: readonly TopicId[];
  readonly hiddenTopicIds: readonly TopicId[];
  readonly unresolvedTopicIds: readonly TopicId[];
  readonly resultTopicId: TopicId;
  readonly orientation?: SummaryGeometryOrientation;
  readonly scopeBounds?: Readonly<Rect>;
  readonly bracket?: SemanticGeometryPath;
  readonly resultAnchor?: Readonly<Point>;
  readonly resultConnector?: SemanticGeometryPath;
}

export type CalloutGeometrySide =
  | 'left'
  | 'right'
  | 'top'
  | 'bottom'
  | 'offset';

export interface CalloutOverlayGeometry extends SemanticOverlayGeometryBase<
  'callout',
  CalloutId
> {
  readonly targetTopicId: TopicId;
  readonly placementSide?: CalloutGeometrySide;
  readonly targetAnchor?: Readonly<Point>;
  readonly bubbleAnchor?: Readonly<Point>;
  readonly bubble?: Readonly<Rect>;
  readonly tail?: SemanticGeometryPath;
}

export interface ZoneOverlayGeometry extends SemanticOverlayGeometryBase<'zone', ZoneId> {
  readonly visibleRootTopicIds: readonly TopicId[];
  readonly hiddenRootTopicIds: readonly TopicId[];
  readonly rect?: Readonly<Rect>;
}

export interface RelationshipEndpointGeometry {
  readonly targetKind: RelationshipTargetRef['kind'];
  readonly entityId: string;
  readonly visibility: RelationshipEndpointRenderState['visibility'];
  readonly requestedAnchor: Readonly<RelationshipAnchor>;
  readonly bounds?: Readonly<Rect>;
  readonly point?: Readonly<Point>;
}

export interface RelationshipOverlayGeometry extends SemanticOverlayGeometryBase<
  'relationship',
  RelationshipId
> {
  readonly routing: MindMapRenderModel['relationships'][number]['entity']['routing'];
  readonly startArrow: ArrowHead;
  readonly endArrow: ArrowHead;
  readonly source: RelationshipEndpointGeometry;
  readonly target: RelationshipEndpointGeometry;
  readonly controlPoints: readonly Readonly<RelationshipControlPoint>[];
  readonly path?: SemanticGeometryPath;
}

export type SemanticOverlayGeometry =
  | ZoneOverlayGeometry
  | BoundaryOverlayGeometry
  | SummaryOverlayGeometry
  | CalloutOverlayGeometry
  | RelationshipOverlayGeometry;

export interface SemanticOverlayMeasurements {
  readonly callouts?: Readonly<Record<string, Readonly<Size>>>;
}

export interface SemanticOverlayGeometryInput {
  readonly model: MindMapRenderModel;
  readonly coreLayout: CoreLayoutResult;
  readonly measurements?: SemanticOverlayMeasurements;
}

export interface SemanticOverlayGeometryModel {
  readonly topicRects: Readonly<Record<string, Readonly<Rect>>>;
  readonly zones: readonly ZoneOverlayGeometry[];
  readonly boundaries: readonly BoundaryOverlayGeometry[];
  readonly summaries: readonly SummaryOverlayGeometry[];
  readonly callouts: readonly CalloutOverlayGeometry[];
  readonly relationships: readonly RelationshipOverlayGeometry[];
  /** Stable paint order. Hit testing walks this list in reverse. */
  readonly ordered: readonly SemanticOverlayGeometry[];
}

const round = (value: number): number => {
  const result = Math.round(value * 1_000_000) / 1_000_000;
  return Object.is(result, -0) ? 0 : result;
};

const point = (x: number, y: number): Readonly<Point> => Object.freeze({
  x: round(x),
  y: round(y),
});

const rect = (x: number, y: number, width: number, height: number): Readonly<Rect> =>
  Object.freeze({ x: round(x), y: round(y), width: round(width), height: round(height) });

const finiteRect = (value: Readonly<Rect> | undefined): Readonly<Rect> | undefined => {
  if (!value
    || !Number.isFinite(value.x)
    || !Number.isFinite(value.y)
    || !Number.isFinite(value.width)
    || !Number.isFinite(value.height)
    || value.width <= 0
    || value.height <= 0) return undefined;
  return rect(value.x, value.y, value.width, value.height);
};

const freezeArray = <T>(items: T[]): readonly T[] => Object.freeze(items);

const centerOf = (value: Readonly<Rect>): Readonly<Point> => point(
  value.x + value.width / 2,
  value.y + value.height / 2,
);

const unionRects = (
  values: readonly Readonly<Rect>[],
): Readonly<Rect> | undefined => {
  if (values.length === 0) return undefined;
  let minX = values[0].x;
  let minY = values[0].y;
  let maxX = values[0].x + values[0].width;
  let maxY = values[0].y + values[0].height;
  for (const value of values.slice(1)) {
    minX = Math.min(minX, value.x);
    minY = Math.min(minY, value.y);
    maxX = Math.max(maxX, value.x + value.width);
    maxY = Math.max(maxY, value.y + value.height);
  }
  return rect(minX, minY, maxX - minX, maxY - minY);
};

const expandRect = (value: Readonly<Rect>, padding: number): Readonly<Rect> => {
  const safePadding = Number.isFinite(padding) ? Math.max(0, padding) : 0;
  return rect(
    value.x - safePadding,
    value.y - safePadding,
    value.width + safePadding * 2,
    value.height + safePadding * 2,
  );
};

const boundsForPoints = (values: readonly Readonly<Point>[]): Readonly<Rect> => {
  if (values.length === 0) return rect(0, 0, 0, 0);
  let minX = values[0].x;
  let minY = values[0].y;
  let maxX = values[0].x;
  let maxY = values[0].y;
  for (const value of values.slice(1)) {
    minX = Math.min(minX, value.x);
    minY = Math.min(minY, value.y);
    maxX = Math.max(maxX, value.x);
    maxY = Math.max(maxY, value.y);
  }
  return rect(minX, minY, maxX - minX, maxY - minY);
};

const interpolateQuadratic = (
  start: Readonly<Point>,
  control: Readonly<Point>,
  end: Readonly<Point>,
  t: number,
): Readonly<Point> => {
  const inverse = 1 - t;
  return point(
    inverse * inverse * start.x + 2 * inverse * t * control.x + t * t * end.x,
    inverse * inverse * start.y + 2 * inverse * t * control.y + t * t * end.y,
  );
};

const interpolateCubic = (
  start: Readonly<Point>,
  control1: Readonly<Point>,
  control2: Readonly<Point>,
  end: Readonly<Point>,
  t: number,
): Readonly<Point> => {
  const inverse = 1 - t;
  return point(
    inverse ** 3 * start.x
      + 3 * inverse ** 2 * t * control1.x
      + 3 * inverse * t ** 2 * control2.x
      + t ** 3 * end.x,
    inverse ** 3 * start.y
      + 3 * inverse ** 2 * t * control1.y
      + 3 * inverse * t ** 2 * control2.y
      + t ** 3 * end.y,
  );
};

const createPath = (
  commands: readonly SemanticGeometryPathCommand[],
): SemanticGeometryPath => {
  const flattened: Readonly<Point>[] = [];
  let current: Readonly<Point> | undefined;
  let first: Readonly<Point> | undefined;
  for (const command of commands) {
    if (command.kind === 'move') {
      current = command.to;
      first = command.to;
      flattened.push(command.to);
      continue;
    }
    if (!current) continue;
    if (command.kind === 'line') {
      current = command.to;
      flattened.push(command.to);
      continue;
    }
    if (command.kind === 'quadratic') {
      const start = current;
      for (let sample = 1; sample <= CURVE_SAMPLE_COUNT; sample += 1) {
        flattened.push(interpolateQuadratic(
          start,
          command.control,
          command.to,
          sample / CURVE_SAMPLE_COUNT,
        ));
      }
      current = command.to;
      continue;
    }
    if (command.kind === 'cubic') {
      const start = current;
      for (let sample = 1; sample <= CURVE_SAMPLE_COUNT; sample += 1) {
        flattened.push(interpolateCubic(
          start,
          command.control1,
          command.control2,
          command.to,
          sample / CURVE_SAMPLE_COUNT,
        ));
      }
      current = command.to;
      continue;
    }
    if (first) {
      flattened.push(first);
      current = first;
    }
  }
  return Object.freeze({
    commands: Object.freeze([...commands]),
    hitPolyline: freezeArray(flattened),
    bounds: boundsForPoints(flattened),
  });
};

const pathHitRegion = (path: SemanticGeometryPath): SemanticGeometryHitRegion =>
  Object.freeze({
    kind: 'path' as const,
    polyline: path.hitPolyline,
    tolerance: PATH_HIT_TOLERANCE,
  });

const rectanglePath = (value: Readonly<Rect>): SemanticGeometryPath => {
  const topLeft = point(value.x, value.y);
  return createPath([
    { kind: 'move', to: topLeft },
    { kind: 'line', to: point(value.x + value.width, value.y) },
    { kind: 'line', to: point(value.x + value.width, value.y + value.height) },
    { kind: 'line', to: point(value.x, value.y + value.height) },
    { kind: 'close' },
  ]);
};

const topicRectsFromLayout = (
  model: MindMapRenderModel,
  coreLayout: CoreLayoutResult,
): Readonly<Record<string, Readonly<Rect>>> => {
  const result: Record<string, Readonly<Rect>> = {};
  for (const topic of model.topics) {
    const layout = coreLayout.positions[topic.entityId];
    const value = layout
      ? finiteRect(layout)
      : undefined;
    if (value) result[topic.entityId] = value;
  }
  return Object.freeze(result);
};

const memberRects = (
  topicIds: readonly TopicId[],
  topicRects: Readonly<Record<string, Readonly<Rect>>>,
): {
  ids: readonly TopicId[];
  unresolved: readonly TopicId[];
  rects: readonly Readonly<Rect>[];
} => {
  const ids: TopicId[] = [];
  const unresolved: TopicId[] = [];
  const values: Readonly<Rect>[] = [];
  for (const topicId of topicIds) {
    const topicRect = topicRects[topicId];
    if (!topicRect) {
      unresolved.push(topicId);
      continue;
    }
    ids.push(topicId);
    values.push(topicRect);
  }
  return {
    ids: freezeArray(ids),
    unresolved: freezeArray(unresolved),
    rects: freezeArray(values),
  };
};

const buildZones = (
  model: MindMapRenderModel,
): readonly ZoneOverlayGeometry[] => freezeArray(model.zones.map((item) => {
  const zoneRect = finiteRect(item.entity.rect);
  if (item.visibility !== 'visible' || !zoneRect) {
    return Object.freeze({
      kind: 'zone' as const,
      entityId: item.entityId,
      visibility: 'hidden' as const,
      suppressionReason: item.visibleRootTopicIds.length === 0
        ? 'no-visible-members' as const
        : 'missing-layout' as const,
      visibleRootTopicIds: item.visibleRootTopicIds,
      hiddenRootTopicIds: item.hiddenRootTopicIds,
      hitRegions: freezeArray<SemanticGeometryHitRegion>([]),
    });
  }
  return Object.freeze({
    kind: 'zone' as const,
    entityId: item.entityId,
    visibility: 'visible' as const,
    visibleRootTopicIds: item.visibleRootTopicIds,
    hiddenRootTopicIds: item.hiddenRootTopicIds,
    rect: zoneRect,
    bounds: zoneRect,
    hitRegions: freezeArray<SemanticGeometryHitRegion>([
      Object.freeze({ kind: 'rect' as const, rect: zoneRect }),
    ]),
  });
}));

const buildBoundaries = (
  model: MindMapRenderModel,
  topicRects: Readonly<Record<string, Readonly<Rect>>>,
): readonly BoundaryOverlayGeometry[] => freezeArray(model.boundaries.map((item) => {
  const members = memberRects(item.membership.visibleTopicIds, topicRects);
  const memberBounds = unionRects(members.rects);
  if (item.visibility !== 'visible' || !memberBounds) {
    return Object.freeze({
      kind: 'boundary' as const,
      entityId: item.entityId,
      visibility: 'hidden' as const,
      suppressionReason: item.membership.visibleTopicIds.length === 0
        ? 'no-visible-members' as const
        : 'missing-layout' as const,
      memberTopicIds: members.ids,
      hiddenTopicIds: item.membership.hiddenTopicIds,
      unresolvedTopicIds: members.unresolved,
      hitRegions: freezeArray<SemanticGeometryHitRegion>([]),
    });
  }
  const frame = deriveBoundaryFrame(memberBounds, item.entity);
  const outline = rectanglePath(frame);
  return Object.freeze({
    kind: 'boundary' as const,
    entityId: item.entityId,
    visibility: 'visible' as const,
    memberTopicIds: members.ids,
    hiddenTopicIds: item.membership.hiddenTopicIds,
    unresolvedTopicIds: members.unresolved,
    memberBounds,
    frame,
    outline,
    bounds: frame,
    hitRegions: freezeArray([pathHitRegion(outline)]),
  });
}));

const defaultSummaryOrientation = (
  model: MindMapRenderModel,
): SummaryGeometryOrientation => {
  switch (model.sheet.defaultBranchLayout.direction) {
    case 'right-to-left': return 'left';
    case 'top-to-bottom': return 'bottom';
    case 'bottom-to-top': return 'top';
    default: return 'right';
  }
};

const summaryOrientation = (
  model: MindMapRenderModel,
  requested: MindMapRenderModel['summaries'][number]['entity']['orientation'],
  scope: Readonly<Rect>,
  result: Readonly<Rect>,
): SummaryGeometryOrientation => {
  if (requested !== 'auto') return requested;
  const scopeCenter = centerOf(scope);
  const resultCenter = centerOf(result);
  const dx = resultCenter.x - scopeCenter.x;
  const dy = resultCenter.y - scopeCenter.y;
  const normalizedX = Math.abs(dx) / Math.max(scope.width, 1);
  const normalizedY = Math.abs(dy) / Math.max(scope.height, 1);
  if (normalizedX === 0 && normalizedY === 0) return defaultSummaryOrientation(model);
  if (normalizedX >= normalizedY) return dx < 0 ? 'left' : 'right';
  return dy < 0 ? 'top' : 'bottom';
};

const summaryBracket = (
  scope: Readonly<Rect>,
  orientation: SummaryGeometryOrientation,
): { path: SemanticGeometryPath; connectorStart: Readonly<Point> } => {
  const center = centerOf(scope);
  if (orientation === 'left' || orientation === 'right') {
    const x = orientation === 'left'
      ? scope.x - SUMMARY_BRACKET_GAP
      : scope.x + scope.width + SUMMARY_BRACKET_GAP;
    const tickX = orientation === 'left'
      ? x + SUMMARY_BRACKET_TICK
      : x - SUMMARY_BRACKET_TICK;
    return {
      path: createPath([
        { kind: 'move', to: point(tickX, scope.y) },
        { kind: 'line', to: point(x, scope.y) },
        { kind: 'line', to: point(x, scope.y + scope.height) },
        { kind: 'line', to: point(tickX, scope.y + scope.height) },
      ]),
      connectorStart: point(x, center.y),
    };
  }
  const y = orientation === 'top'
    ? scope.y - SUMMARY_BRACKET_GAP
    : scope.y + scope.height + SUMMARY_BRACKET_GAP;
  const tickY = orientation === 'top'
    ? y + SUMMARY_BRACKET_TICK
    : y - SUMMARY_BRACKET_TICK;
  return {
    path: createPath([
      { kind: 'move', to: point(scope.x, tickY) },
      { kind: 'line', to: point(scope.x, y) },
      { kind: 'line', to: point(scope.x + scope.width, y) },
      { kind: 'line', to: point(scope.x + scope.width, tickY) },
    ]),
    connectorStart: point(center.x, y),
  };
};

const fixedAnchor = (
  bounds: Readonly<Rect>,
  anchor: Exclude<RelationshipAnchor, 'auto'>,
): Readonly<Point> => {
  if (typeof anchor === 'object') {
    const xRatio = Math.min(1, Math.max(0, anchor.xRatio));
    const yRatio = Math.min(1, Math.max(0, anchor.yRatio));
    return point(bounds.x + bounds.width * xRatio, bounds.y + bounds.height * yRatio);
  }
  switch (anchor) {
    case 'left': return point(bounds.x, bounds.y + bounds.height / 2);
    case 'right': return point(bounds.x + bounds.width, bounds.y + bounds.height / 2);
    case 'top': return point(bounds.x + bounds.width / 2, bounds.y);
    case 'bottom': return point(bounds.x + bounds.width / 2, bounds.y + bounds.height);
  }
};

const automaticAnchor = (
  bounds: Readonly<Rect>,
  toward: Readonly<Point>,
  zeroVectorSide: 'left' | 'right',
): Readonly<Point> => {
  const center = centerOf(bounds);
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  if (dx === 0 && dy === 0) return fixedAnchor(bounds, zeroVectorSide);
  const normalizedX = Math.abs(dx) / Math.max(bounds.width, 1);
  const normalizedY = Math.abs(dy) / Math.max(bounds.height, 1);
  if (normalizedX >= normalizedY) return fixedAnchor(bounds, dx < 0 ? 'left' : 'right');
  return fixedAnchor(bounds, dy < 0 ? 'top' : 'bottom');
};

const anchorPoint = (
  bounds: Readonly<Rect>,
  anchor: RelationshipAnchor,
  toward: Readonly<Point>,
  zeroVectorSide: 'left' | 'right',
): Readonly<Point> => anchor === 'auto'
  ? automaticAnchor(bounds, toward, zeroVectorSide)
  : fixedAnchor(bounds, anchor);

const buildSummaries = (
  model: MindMapRenderModel,
  topicRects: Readonly<Record<string, Readonly<Rect>>>,
): readonly SummaryOverlayGeometry[] => freezeArray(model.summaries.map((item) => {
  const members = memberRects(item.membership.visibleTopicIds, topicRects);
  const rawScopeBounds = unionRects(members.rects);
  const resultBounds = topicRects[item.entity.resultTopicId];
  let suppressionReason: SemanticGeometrySuppressionReason | undefined;
  if (item.membership.visibleTopicIds.length === 0) suppressionReason = 'no-visible-members';
  else if (item.resultTopicVisibility === 'missing') suppressionReason = 'missing-endpoint';
  else if (item.resultTopicVisibility === 'hidden') suppressionReason = 'hidden-endpoint';
  else if (!rawScopeBounds || !resultBounds) suppressionReason = 'missing-layout';
  if (item.visibility !== 'visible' || suppressionReason || !rawScopeBounds || !resultBounds) {
    return Object.freeze({
      kind: 'summary' as const,
      entityId: item.entityId,
      visibility: 'hidden' as const,
      suppressionReason: suppressionReason ?? 'hidden-endpoint' as const,
      memberTopicIds: members.ids,
      hiddenTopicIds: item.membership.hiddenTopicIds,
      unresolvedTopicIds: members.unresolved,
      resultTopicId: item.entity.resultTopicId,
      hitRegions: freezeArray<SemanticGeometryHitRegion>([]),
    });
  }
  const scopeBounds = expandRect(rawScopeBounds, SUMMARY_SCOPE_PADDING);
  const orientation = summaryOrientation(model, item.entity.orientation, scopeBounds, resultBounds);
  const bracket = summaryBracket(scopeBounds, orientation);
  const resultAnchor = automaticAnchor(
    resultBounds,
    bracket.connectorStart,
    orientation === 'left' ? 'right' : 'left',
  );
  const resultConnector = createPath([
    { kind: 'move', to: bracket.connectorStart },
    { kind: 'line', to: resultAnchor },
  ]);
  const bounds = unionRects([bracket.path.bounds, resultConnector.bounds]);
  return Object.freeze({
    kind: 'summary' as const,
    entityId: item.entityId,
    visibility: 'visible' as const,
    memberTopicIds: members.ids,
    hiddenTopicIds: item.membership.hiddenTopicIds,
    unresolvedTopicIds: members.unresolved,
    resultTopicId: item.entity.resultTopicId,
    orientation,
    scopeBounds,
    bracket: bracket.path,
    resultAnchor,
    resultConnector,
    ...(bounds ? { bounds } : {}),
    hitRegions: freezeArray([
      pathHitRegion(bracket.path),
      pathHitRegion(resultConnector),
    ]),
  });
}));

const incomingSideForTopic = (
  model: MindMapRenderModel,
  topicId: TopicId,
): BranchSide | undefined => {
  const item = model.topics.find((topic) => topic.entityId === topicId);
  if (!item?.incomingTreeEdgeId) return undefined;
  return model.sheet.treeEdges[item.incomingTreeEdgeId]?.side;
};

const defaultCalloutSide = (model: MindMapRenderModel): Exclude<CalloutGeometrySide, 'offset'> => {
  switch (model.sheet.defaultBranchLayout.direction) {
    case 'right-to-left': return 'left';
    case 'top-to-bottom': return 'bottom';
    case 'bottom-to-top': return 'top';
    default: return 'right';
  }
};

const normalizeCalloutSide = (
  model: MindMapRenderModel,
  topicId: TopicId,
  preferred: BranchSide | undefined,
): Exclude<CalloutGeometrySide, 'offset'> => {
  if (preferred === 'left'
    || preferred === 'right'
    || preferred === 'top'
    || preferred === 'bottom') return preferred;
  const incoming = incomingSideForTopic(model, topicId);
  if (incoming === 'left'
    || incoming === 'right'
    || incoming === 'top'
    || incoming === 'bottom') return incoming;
  return defaultCalloutSide(model);
};

const calloutSize = (
  value: Readonly<Size> | undefined,
): Readonly<Size> => {
  if (!value
    || !Number.isFinite(value.width)
    || !Number.isFinite(value.height)
    || value.width <= 0
    || value.height <= 0) return DEFAULT_CALLOUT_SIZE;
  return Object.freeze({ width: round(value.width), height: round(value.height) });
};

const calloutBubble = (
  target: Readonly<Rect>,
  size: Readonly<Size>,
  side: CalloutGeometrySide,
  offset?: { readonly dx: number; readonly dy: number },
): Readonly<Rect> => {
  const center = centerOf(target);
  if (side === 'offset' && offset) {
    return rect(
      center.x + offset.dx - size.width / 2,
      center.y + offset.dy - size.height / 2,
      size.width,
      size.height,
    );
  }
  switch (side) {
    case 'left':
      return rect(target.x - CALLOUT_GAP - size.width, center.y - size.height / 2, size.width, size.height);
    case 'top':
      return rect(center.x - size.width / 2, target.y - CALLOUT_GAP - size.height, size.width, size.height);
    case 'bottom':
      return rect(center.x - size.width / 2, target.y + target.height + CALLOUT_GAP, size.width, size.height);
    case 'right':
    case 'offset':
      return rect(target.x + target.width + CALLOUT_GAP, center.y - size.height / 2, size.width, size.height);
  }
};

const calloutTail = (
  kind: MindMapRenderModel['callouts'][number]['entity']['tail'],
  target: Readonly<Point>,
  bubble: Readonly<Point>,
): SemanticGeometryPath => {
  if (kind === 'line') {
    return createPath([{ kind: 'move', to: target }, { kind: 'line', to: bubble }]);
  }
  if (kind === 'triangle') {
    const dx = bubble.x - target.x;
    const dy = bubble.y - target.y;
    const length = Math.max(Math.hypot(dx, dy), 1);
    const perpendicularX = -dy / length * 7;
    const perpendicularY = dx / length * 7;
    return createPath([
      { kind: 'move', to: target },
      { kind: 'line', to: point(bubble.x + perpendicularX, bubble.y + perpendicularY) },
      { kind: 'line', to: point(bubble.x - perpendicularX, bubble.y - perpendicularY) },
      { kind: 'close' },
    ]);
  }
  const dx = bubble.x - target.x;
  const dy = bubble.y - target.y;
  const perpendicularScale = Math.min(24, Math.hypot(dx, dy) / 5);
  const length = Math.max(Math.hypot(dx, dy), 1);
  const perpendicular = point(-dy / length * perpendicularScale, dx / length * perpendicularScale);
  return createPath([
    { kind: 'move', to: target },
    {
      kind: 'cubic',
      control1: point(target.x + dx / 3 + perpendicular.x, target.y + dy / 3 + perpendicular.y),
      control2: point(target.x + dx * 2 / 3 + perpendicular.x, target.y + dy * 2 / 3 + perpendicular.y),
      to: bubble,
    },
  ]);
};

const buildCallouts = (
  model: MindMapRenderModel,
  topicRects: Readonly<Record<string, Readonly<Rect>>>,
  measurements: SemanticOverlayMeasurements | undefined,
): readonly CalloutOverlayGeometry[] => freezeArray(model.callouts.map((item) => {
  const targetBounds = topicRects[item.entity.targetTopicId];
  let suppressionReason: SemanticGeometrySuppressionReason | undefined;
  if (item.targetTopicVisibility === 'missing') suppressionReason = 'missing-endpoint';
  else if (item.targetTopicVisibility === 'hidden') suppressionReason = 'hidden-endpoint';
  else if (!targetBounds) suppressionReason = 'missing-layout';
  if (item.visibility !== 'visible' || suppressionReason || !targetBounds) {
    return Object.freeze({
      kind: 'callout' as const,
      entityId: item.entityId,
      visibility: 'hidden' as const,
      suppressionReason: suppressionReason ?? 'hidden-endpoint' as const,
      targetTopicId: item.entity.targetTopicId,
      hitRegions: freezeArray<SemanticGeometryHitRegion>([]),
    });
  }
  const placementSide: CalloutGeometrySide = item.entity.placement.mode === 'offset'
    ? 'offset'
    : normalizeCalloutSide(model, item.entity.targetTopicId, item.entity.placement.preferredSide);
  const size = calloutSize(measurements?.callouts?.[item.entityId]);
  const bubble = calloutBubble(
    targetBounds,
    size,
    placementSide,
    item.entity.placement.mode === 'offset' ? item.entity.placement : undefined,
  );
  const targetAnchor = automaticAnchor(targetBounds, centerOf(bubble), 'right');
  const bubbleAnchor = automaticAnchor(bubble, centerOf(targetBounds), 'left');
  const tail = calloutTail(item.entity.tail, targetAnchor, bubbleAnchor);
  const bounds = unionRects([bubble, tail.bounds]);
  return Object.freeze({
    kind: 'callout' as const,
    entityId: item.entityId,
    visibility: 'visible' as const,
    targetTopicId: item.entity.targetTopicId,
    placementSide,
    targetAnchor,
    bubbleAnchor,
    bubble,
    tail,
    ...(bounds ? { bounds } : {}),
    hitRegions: freezeArray([
      Object.freeze({ kind: 'rect' as const, rect: bubble }),
      pathHitRegion(tail),
    ]),
  });
}));

const compareAscii = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const orderedControlPoints = (
  points: Readonly<Record<string, RelationshipControlPoint>> | undefined,
): readonly Readonly<RelationshipControlPoint>[] => freezeArray(Object.values(points ?? {})
  .sort((left, right) => compareAscii(left.orderKey, right.orderKey) || compareAscii(left.id, right.id))
  .map((value) => Object.freeze({ ...value })));

const move = (to: Readonly<Point>): SemanticGeometryPathCommand => ({ kind: 'move', to });
const line = (to: Readonly<Point>): SemanticGeometryPathCommand => ({ kind: 'line', to });

const automaticCurvePath = (
  source: Readonly<Point>,
  target: Readonly<Point>,
): SemanticGeometryPath => {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  const control1 = horizontal
    ? point(source.x + dx / 2, source.y)
    : point(source.x, source.y + dy / 2);
  const control2 = horizontal
    ? point(target.x - dx / 2, target.y)
    : point(target.x, target.y - dy / 2);
  return createPath([
    move(source),
    { kind: 'cubic', control1, control2, to: target },
  ]);
};

const controlPointCurvePath = (
  source: Readonly<Point>,
  controlPoints: readonly Readonly<RelationshipControlPoint>[],
  target: Readonly<Point>,
): SemanticGeometryPath => {
  const values = [source, ...controlPoints.map((value) => point(value.x, value.y)), target];
  const commands: SemanticGeometryPathCommand[] = [move(source)];
  for (let index = 0; index < values.length - 1; index += 1) {
    const previous = values[Math.max(0, index - 1)];
    const start = values[index];
    const end = values[index + 1];
    const next = values[Math.min(values.length - 1, index + 2)];
    commands.push({
      kind: 'cubic',
      control1: point(start.x + (end.x - previous.x) / 6, start.y + (end.y - previous.y) / 6),
      control2: point(end.x - (next.x - start.x) / 6, end.y - (next.y - start.y) / 6),
      to: end,
    });
  }
  return createPath(commands);
};

const orthogonalPath = (
  source: Readonly<Point>,
  waypoints: readonly Readonly<Point>[],
  target: Readonly<Point>,
): SemanticGeometryPath => {
  const commands: SemanticGeometryPathCommand[] = [move(source)];
  let current = source;
  for (const next of [...waypoints, target]) {
    if (current.x !== next.x && current.y !== next.y) {
      const horizontalFirst = Math.abs(next.x - current.x) >= Math.abs(next.y - current.y);
      commands.push(line(horizontalFirst
        ? point(next.x, current.y)
        : point(current.x, next.y)));
    }
    commands.push(line(next));
    current = next;
  }
  return createPath(commands);
};

const relationshipPath = (
  routing: RelationshipOverlayGeometry['routing'],
  source: Readonly<Point>,
  controlPoints: readonly Readonly<RelationshipControlPoint>[],
  target: Readonly<Point>,
): SemanticGeometryPath => {
  const waypoints = controlPoints.map((value) => point(value.x, value.y));
  if (routing === 'straight') return createPath([move(source), line(target)]);
  if (routing === 'orthogonal') return orthogonalPath(source, waypoints, target);
  if (routing === 'manual') {
    return createPath([move(source), ...waypoints.map(line), line(target)]);
  }
  return controlPoints.length === 0
    ? automaticCurvePath(source, target)
    : controlPointCurvePath(source, controlPoints, target);
};

const endpointTargetId = (target: RelationshipTargetRef): string => {
  switch (target.kind) {
    case 'topic': return target.topicId;
    case 'boundary': return target.boundaryId;
    case 'callout': return target.calloutId;
    case 'zone': return target.zoneId;
  }
};

const buildRelationships = (
  model: MindMapRenderModel,
  topicRects: Readonly<Record<string, Readonly<Rect>>>,
  boundaries: readonly BoundaryOverlayGeometry[],
  callouts: readonly CalloutOverlayGeometry[],
): readonly RelationshipOverlayGeometry[] => {
  const boundaryRects = new Map(boundaries
    .filter((value): value is BoundaryOverlayGeometry & { frame: Readonly<Rect> } => Boolean(value.frame))
    .map((value) => [value.entityId, value.frame] as const));
  const calloutRects = new Map(callouts
    .filter((value): value is CalloutOverlayGeometry & { bubble: Readonly<Rect> } => Boolean(value.bubble))
    .map((value) => [value.entityId, value.bubble] as const));
  const zoneRects = new Map(model.zones.flatMap((item) => {
    const value = item.visibility === 'visible' ? finiteRect(item.entity.rect) : undefined;
    return value ? [[item.entityId, value] as const] : [];
  }));

  const endpointBounds = (target: RelationshipTargetRef): Readonly<Rect> | undefined => {
    switch (target.kind) {
      case 'topic': return topicRects[target.topicId];
      case 'boundary': return boundaryRects.get(target.boundaryId);
      case 'callout': return calloutRects.get(target.calloutId);
      case 'zone': return zoneRects.get(target.zoneId);
    }
  };

  return freezeArray(model.relationships.map((item) => {
    const controls = orderedControlPoints(item.entity.controlPoints);
    const sourceBounds = endpointBounds(item.entity.source.element);
    const targetBounds = endpointBounds(item.entity.target.element);
    const source: RelationshipEndpointGeometry = Object.freeze({
      targetKind: item.source.targetKind,
      entityId: endpointTargetId(item.entity.source.element),
      visibility: item.source.visibility,
      requestedAnchor: item.entity.source.anchor,
      ...(sourceBounds ? { bounds: sourceBounds } : {}),
    });
    const target: RelationshipEndpointGeometry = Object.freeze({
      targetKind: item.target.targetKind,
      entityId: endpointTargetId(item.entity.target.element),
      visibility: item.target.visibility,
      requestedAnchor: item.entity.target.anchor,
      ...(targetBounds ? { bounds: targetBounds } : {}),
    });
    let suppressionReason: SemanticGeometrySuppressionReason | undefined;
    if (item.source.visibility === 'missing' || item.target.visibility === 'missing') {
      suppressionReason = 'missing-endpoint';
    } else if (item.source.visibility === 'hidden' || item.target.visibility === 'hidden') {
      suppressionReason = 'hidden-endpoint';
    } else if (!sourceBounds || !targetBounds) {
      suppressionReason = 'missing-layout';
    }
    if (item.visibility !== 'visible' || suppressionReason || !sourceBounds || !targetBounds) {
      return Object.freeze({
        kind: 'relationship' as const,
        entityId: item.entityId,
        visibility: 'hidden' as const,
        suppressionReason: suppressionReason ?? 'hidden-endpoint' as const,
        routing: item.entity.routing,
        startArrow: item.entity.startArrow,
        endArrow: item.entity.endArrow,
        source,
        target,
        controlPoints: controls,
        hitRegions: freezeArray<SemanticGeometryHitRegion>([]),
      });
    }
    const firstControl = controls[0];
    const lastControl = controls[controls.length - 1];
    const sourceToward = firstControl
      ? point(firstControl.x, firstControl.y)
      : centerOf(targetBounds);
    const targetToward = lastControl
      ? point(lastControl.x, lastControl.y)
      : centerOf(sourceBounds);
    const sourcePoint = anchorPoint(
      sourceBounds,
      item.entity.source.anchor,
      sourceToward,
      'right',
    );
    const targetPoint = anchorPoint(
      targetBounds,
      item.entity.target.anchor,
      targetToward,
      'left',
    );
    const resolvedSource = Object.freeze({ ...source, point: sourcePoint });
    const resolvedTarget = Object.freeze({ ...target, point: targetPoint });
    const path = relationshipPath(item.entity.routing, sourcePoint, controls, targetPoint);
    return Object.freeze({
      kind: 'relationship' as const,
      entityId: item.entityId,
      visibility: 'visible' as const,
      routing: item.entity.routing,
      startArrow: item.entity.startArrow,
      endArrow: item.entity.endArrow,
      source: resolvedSource,
      target: resolvedTarget,
      controlPoints: controls,
      path,
      bounds: path.bounds,
      hitRegions: freezeArray([pathHitRegion(path)]),
    });
  }));
};

/**
 * Projects canonical semantic entities onto Core layout rectangles. It never
 * adds edges to the Topic tree and never mutates canonical placement.
 */
export const buildSemanticOverlayGeometry = (
  input: SemanticOverlayGeometryInput,
): SemanticOverlayGeometryModel => {
  const topicRects = topicRectsFromLayout(input.model, input.coreLayout);
  const zones = buildZones(input.model);
  const boundaries = buildBoundaries(input.model, topicRects);
  const summaries = buildSummaries(input.model, topicRects);
  const callouts = buildCallouts(input.model, topicRects, input.measurements);
  const relationships = buildRelationships(
    input.model,
    topicRects,
    boundaries,
    callouts,
  );
  const ordered = freezeArray<SemanticOverlayGeometry>([
    ...zones,
    ...boundaries,
    ...summaries,
    ...callouts,
    ...relationships,
  ]);
  return Object.freeze({
    topicRects,
    zones,
    boundaries,
    summaries,
    callouts,
    relationships,
    ordered,
  });
};

const pointInRect = (value: Readonly<Point>, bounds: Readonly<Rect>): boolean =>
  value.x >= bounds.x
  && value.y >= bounds.y
  && value.x <= bounds.x + bounds.width
  && value.y <= bounds.y + bounds.height;

const distanceToSegment = (
  value: Readonly<Point>,
  start: Readonly<Point>,
  end: Readonly<Point>,
): number => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return Math.hypot(value.x - start.x, value.y - start.y);
  const projection = Math.min(1, Math.max(0,
    ((value.x - start.x) * dx + (value.y - start.y) * dy) / (dx * dx + dy * dy),
  ));
  return Math.hypot(
    value.x - (start.x + projection * dx),
    value.y - (start.y + projection * dy),
  );
};

const hitRegionContains = (
  region: SemanticGeometryHitRegion,
  value: Readonly<Point>,
): boolean => {
  if (region.kind === 'rect') return pointInRect(value, region.rect);
  for (let index = 1; index < region.polyline.length; index += 1) {
    if (distanceToSegment(value, region.polyline[index - 1], region.polyline[index])
      <= region.tolerance) return true;
  }
  return false;
};

/** Returns the topmost semantic element at a canvas point. */
export const hitTestSemanticOverlayGeometry = (
  geometry: SemanticOverlayGeometryModel,
  value: Readonly<Point>,
): ElementRef | null => {
  for (let index = geometry.ordered.length - 1; index >= 0; index -= 1) {
    const item = geometry.ordered[index];
    if (item.visibility !== 'visible') continue;
    if (!item.hitRegions.some((region) => hitRegionContains(region, value))) continue;
    switch (item.kind) {
      case 'zone': return { kind: 'zone', id: item.entityId };
      case 'boundary': return { kind: 'boundary', id: item.entityId };
      case 'summary': return { kind: 'summary', id: item.entityId };
      case 'callout': return { kind: 'callout', id: item.entityId };
      case 'relationship': return { kind: 'relationship', id: item.entityId };
    }
  }
  return null;
};
