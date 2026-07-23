import type {
  BranchLayoutSpec,
  LayoutDirection,
  MindMapSheet,
  Point,
  StructureId,
  Summary,
  Topic,
  TopicId,
  TreeEdge,
  TreeEdgeId,
} from '../domain/types';
import {
  expandSemanticTopicScope,
  resolveSemanticEdgeSide,
} from '../domain/semanticScope';
import {
  CORE_LAYOUT_CAPABILITIES,
  CORE_LAYOUT_CAPABILITY_VERSION,
  type CardinalLayoutDirection,
  getCoreLayoutCapability,
  isSupportedCoreLayoutStructure,
  type SupportedCoreLayoutStructure,
} from './registry';

export interface TopicMeasurementInput {
  readonly entityId: TopicId;
  readonly width: number;
  readonly height: number;
}

export interface CoreLayoutRequest {
  readonly sheet: Readonly<MindMapSheet>;
  readonly measurements: readonly TopicMeasurementInput[];
  /** Effective collapsed IDs; Topic.defaultCollapsed is used when omitted. */
  readonly collapsedTopicIds?: readonly TopicId[] | ReadonlySet<TopicId>;
  readonly origin?: Readonly<Point>;
  readonly forestGap?: number;
}

export type LayoutDiagnosticSeverity = 'info' | 'warning';

export interface LayoutDiagnostic {
  readonly code: string;
  readonly severity: LayoutDiagnosticSeverity;
  readonly message: string;
  readonly entityId?: string;
}

export interface TopicLayoutPosition {
  readonly entityId: TopicId;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly placementSource: Topic['placement']['mode'];
  readonly derived: boolean;
  readonly appliedOffset?: Readonly<Point>;
}

export interface TreeConnectorLayout {
  readonly entityId: TreeEdgeId;
  readonly sourceTopicId: TopicId;
  readonly targetTopicId: TopicId;
  readonly direction: CardinalLayoutDirection;
  readonly routing: 'curve' | 'orthogonal';
  readonly points: readonly Readonly<Point>[];
}

export interface LayoutBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface CoreLayoutResult {
  readonly engineVersion: typeof CORE_LAYOUT_CAPABILITY_VERSION;
  readonly cacheKey: string;
  readonly topicOrder: readonly TopicId[];
  readonly positions: Readonly<Record<string, TopicLayoutPosition>>;
  readonly connectors: readonly TreeConnectorLayout[];
  readonly bounds: LayoutBounds;
  readonly diagnostics: readonly LayoutDiagnostic[];
}

interface Size {
  width: number;
  height: number;
}

interface InternalBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface InternalPosition extends TopicLayoutPosition {}

interface ResolvedLayout {
  structure: SupportedCoreLayoutStructure;
  direction: CardinalLayoutDirection | 'both';
  mode: BranchLayoutSpec['mode'];
  spacing: { sibling: number; level: number };
  compact: boolean;
  variantId?: string;
  options: Readonly<Record<string, string | number | boolean>>;
  /** Derived-only row slots shared by all columns of one Matrix branch. */
  matrixColumnPlan?: MatrixColumnPlan;
}

interface MatrixColumnPlan {
  readonly topicOffsets: Readonly<Record<string, number>>;
  readonly totalHeight: number;
}

interface EdgeLayoutMetadata {
  direction: CardinalLayoutDirection;
  structure: SupportedCoreLayoutStructure;
}

interface LayoutFragment {
  normal: Map<TopicId, InternalPosition>;
  fixed: Map<TopicId, InternalPosition>;
  bounds: InternalBounds;
  edgeOrder: TreeEdge[];
  edgeMetadata: Map<TreeEdgeId, EdgeLayoutMetadata>;
  topicOrder: TopicId[];
}

interface EngineState {
  sheet: MindMapSheet;
  measurements: Map<TopicId, Size>;
  childrenByParent: Map<TopicId, TreeEdge[]>;
  collapsed: Set<TopicId>;
  diagnostics: LayoutDiagnostic[];
  balanceWeightMemo: Map<TopicId, number>;
}

const DEFAULT_MEASUREMENT: Readonly<Size> = Object.freeze({ width: 160, height: 48 });
const MAX_MEASUREMENT = 10_000;
const DEFAULT_FOREST_GAP = 120;
/** Gap from a Summary member range to its result Topic root. */
const SUMMARY_RESULT_GAP = 56;

const compareAscii = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const compareEdges = (left: TreeEdge, right: TreeEdge): number =>
  compareAscii(left.orderKey, right.orderKey) || compareAscii(left.id, right.id);

const compareTopics = (left: Topic, right: Topic): number => compareAscii(left.id, right.id);

const finiteNonNegative = (value: number, fallback: number): number =>
  Number.isFinite(value) && value >= 0 ? value : fallback;

const rounded = (value: number): number => {
  const result = Math.round(value * 1_000_000) / 1_000_000;
  return Object.is(result, -0) ? 0 : result;
};

const rectBounds = (position: Pick<InternalPosition, 'x' | 'y' | 'width' | 'height'>): InternalBounds => ({
  minX: position.x,
  minY: position.y,
  maxX: position.x + position.width,
  maxY: position.y + position.height,
});

const unionBounds = (left: InternalBounds, right: InternalBounds): InternalBounds => ({
  minX: Math.min(left.minX, right.minX),
  minY: Math.min(left.minY, right.minY),
  maxX: Math.max(left.maxX, right.maxX),
  maxY: Math.max(left.maxY, right.maxY),
});

const translatedBounds = (bounds: InternalBounds, x: number, y: number): InternalBounds => ({
  minX: bounds.minX + x,
  minY: bounds.minY + y,
  maxX: bounds.maxX + x,
  maxY: bounds.maxY + y,
});

const addDiagnostic = (
  state: EngineState,
  code: string,
  message: string,
  entityId?: string,
  severity: LayoutDiagnosticSeverity = 'warning',
): void => {
  state.diagnostics.push({ code, severity, message, ...(entityId ? { entityId } : {}) });
};

const normalizeMeasurement = (
  input: TopicMeasurementInput,
  state: EngineState,
): Size => {
  const valid = Number.isFinite(input.width)
    && Number.isFinite(input.height)
    && input.width > 0
    && input.height > 0;
  if (!valid) {
    addDiagnostic(
      state,
      'invalid-measurement',
      'Invalid measurement replaced with the deterministic default size',
      input.entityId,
    );
    return { ...DEFAULT_MEASUREMENT };
  }
  const width = Math.min(input.width, MAX_MEASUREMENT);
  const height = Math.min(input.height, MAX_MEASUREMENT);
  if (width !== input.width || height !== input.height) {
    addDiagnostic(
      state,
      'measurement-clamped',
      `Measurement was clamped to ${MAX_MEASUREMENT}`,
      input.entityId,
    );
  }
  return { width, height };
};

const buildMeasurements = (
  inputs: readonly TopicMeasurementInput[],
  state: EngineState,
): Map<TopicId, Size> => {
  const sorted = [...inputs].sort((left, right) =>
    compareAscii(left.entityId, right.entityId)
    || left.width - right.width
    || left.height - right.height);
  const result = new Map<TopicId, Size>();
  for (const input of sorted) {
    if (!state.sheet.topics[input.entityId]) {
      addDiagnostic(
        state,
        'unknown-measurement-topic',
        'Measurement references a Topic outside the active Sheet and was ignored',
        input.entityId,
        'info',
      );
      continue;
    }
    if (result.has(input.entityId)) {
      addDiagnostic(
        state,
        'duplicate-measurement',
        'Duplicate measurement ignored after deterministic size ordering',
        input.entityId,
      );
      continue;
    }
    result.set(input.entityId, normalizeMeasurement(input, state));
  }
  return result;
};

const measurementFor = (state: EngineState, topicId: TopicId): Size => {
  const value = state.measurements.get(topicId);
  if (value) return value;
  addDiagnostic(
    state,
    'missing-measurement',
    'Topic uses the deterministic default measurement',
    topicId,
    'info',
  );
  const fallback = { ...DEFAULT_MEASUREMENT };
  state.measurements.set(topicId, fallback);
  return fallback;
};

const buildChildrenIndex = (sheet: MindMapSheet): Map<TopicId, TreeEdge[]> => {
  const result = new Map<TopicId, TreeEdge[]>();
  for (const edge of Object.values(sheet.treeEdges)) {
    if (!sheet.topics[edge.parentTopicId] || !sheet.topics[edge.childTopicId]) continue;
    const children = result.get(edge.parentTopicId) ?? [];
    children.push(edge);
    result.set(edge.parentTopicId, children);
  }
  for (const children of result.values()) children.sort(compareEdges);
  return result;
};

const normalizedSpacing = (
  requested: BranchLayoutSpec['spacing'] | undefined,
  fallback: Readonly<{ sibling: number; level: number }>,
  compact: boolean,
): { sibling: number; level: number } => {
  const scale = compact && requested === undefined ? 0.75 : 1;
  return {
    sibling: finiteNonNegative(requested?.sibling ?? fallback.sibling * scale, fallback.sibling),
    level: finiteNonNegative(requested?.level ?? fallback.level * scale, fallback.level),
  };
};

const normalizeResolvedLayout = (
  structure: StructureId,
  direction: Exclude<LayoutDirection, 'inherit'>,
  mode: BranchLayoutSpec['mode'],
  spacing: BranchLayoutSpec['spacing'] | undefined,
  compact: boolean,
  variantId: string | undefined,
  options: BranchLayoutSpec['options'] | undefined,
  state: EngineState,
  entityId: string,
): ResolvedLayout => {
  let supportedStructure: SupportedCoreLayoutStructure;
  if (isSupportedCoreLayoutStructure(structure)) {
    supportedStructure = structure;
  } else {
    supportedStructure = 'core:logic-chart';
    addDiagnostic(
      state,
      'unsupported-structure',
      `${structure} is not implemented by ${CORE_LAYOUT_CAPABILITY_VERSION}; core:logic-chart fallback was used`,
      entityId,
    );
  }
  const capability = CORE_LAYOUT_CAPABILITIES[supportedStructure];
  const resolvedDirection = capability.allowedDirections.includes(direction)
    ? direction as ResolvedLayout['direction']
    : capability.defaultDirection;
  if (resolvedDirection !== direction) {
    addDiagnostic(
      state,
      'unsupported-direction',
      `${direction} is not supported for ${supportedStructure}; ${resolvedDirection} was used`,
      entityId,
    );
  }
  let resolvedVariantId = variantId;
  if (resolvedVariantId && !capability.variantIds.includes(resolvedVariantId)) {
    addDiagnostic(
      state,
      'unsupported-variant',
      `${resolvedVariantId} is not supported for ${supportedStructure}; ${capability.variantIds[0] ?? 'the default variant'} was used`,
      entityId,
    );
    resolvedVariantId = capability.variantIds[0];
  }
  if (!resolvedVariantId) resolvedVariantId = capability.variantIds[0];
  const normalizedOptions: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(options ?? {}).sort(([left], [right]) =>
    compareAscii(left, right))) {
    if (!capability.optionKeys.includes(key)) {
      addDiagnostic(
        state,
        'unsupported-layout-option',
        `${key} is not supported for ${supportedStructure} and was ignored`,
        entityId,
        'info',
      );
      continue;
    }
    if (typeof value === 'number' && !Number.isFinite(value)) {
      addDiagnostic(
        state,
        'invalid-layout-option',
        `${key} must be finite and was ignored`,
        entityId,
      );
      continue;
    }
    normalizedOptions[key] = value;
  }
  return {
    structure: supportedStructure,
    direction: resolvedDirection,
    mode,
    spacing: normalizedSpacing(spacing, capability.defaultSpacing, compact),
    compact,
    ...(resolvedVariantId ? { variantId: resolvedVariantId } : {}),
    options: Object.freeze(normalizedOptions),
  };
};

const initialLayout = (sheet: MindMapSheet, state: EngineState): ResolvedLayout =>
  normalizeResolvedLayout(
    sheet.defaultBranchLayout.structure,
    sheet.defaultBranchLayout.direction,
    sheet.defaultBranchLayout.mode,
    sheet.defaultBranchLayout.spacing,
    sheet.defaultBranchLayout.compact === true,
    sheet.defaultBranchLayout.variantId,
    sheet.defaultBranchLayout.options,
    state,
    sheet.id,
  );

const resolveTopicLayout = (
  topic: Topic,
  inherited: ResolvedLayout,
  state: EngineState,
): ResolvedLayout => {
  const override = topic.branchLayout;
  if (!override && topic.role === 'summary-result') {
    const owner = Object.values(state.sheet.summaries)
      .find((summary) => summary.resultTopicId === topic.id);
    if (owner) {
      const orientation = summaryLayoutOrientation(
        state.sheet,
        owner,
        incomingTreeEdges(state.sheet),
      );
      const direction: CardinalLayoutDirection = orientation === 'left'
        ? 'right-to-left'
        : orientation === 'right'
          ? 'left-to-right'
          : orientation === 'top'
            ? 'bottom-to-top'
            : 'top-to-bottom';
      return normalizeResolvedLayout(
        'core:logic-chart',
        direction,
        'auto',
        inherited.spacing,
        inherited.compact,
        undefined,
        undefined,
        state,
        topic.id,
      );
    }
  }
  if (!override) return inherited;
  const structure = override.structure === 'inherit'
    ? inherited.structure
    : override.structure;
  const direction = override.direction === 'inherit'
    ? inherited.direction
    : override.direction;
  return normalizeResolvedLayout(
    structure,
    direction,
    override.mode,
    override.spacing ?? inherited.spacing,
    override.compact ?? inherited.compact,
    override.variantId ?? (structure === inherited.structure ? inherited.variantId : undefined),
    structure === inherited.structure
      ? { ...inherited.options, ...override.options }
      : override.options,
    state,
    topic.id,
  );
};

const cardinalForOneWay = (layout: ResolvedLayout): CardinalLayoutDirection =>
  layout.direction === 'both'
    ? getCoreLayoutCapability(layout.structure)?.defaultDirection === 'both'
      ? 'left-to-right'
      : getCoreLayoutCapability(layout.structure)?.defaultDirection as CardinalLayoutDirection
    : layout.direction;

const placementPosition = (
  topic: Topic,
  size: Size,
): InternalPosition => ({
  entityId: topic.id,
  x: 0,
  y: 0,
  width: size.width,
  height: size.height,
  placementSource: topic.placement.mode,
  derived: topic.placement.mode !== 'absolute',
  ...(topic.placement.mode === 'offset'
    ? { appliedOffset: Object.freeze({ x: topic.placement.dx, y: topic.placement.dy }) }
    : {}),
});

const translatedPosition = (
  position: InternalPosition,
  x: number,
  y: number,
): InternalPosition => ({
  ...position,
  x: position.x + x,
  y: position.y + y,
});

const mergeNormalFragment = (
  parent: LayoutFragment,
  child: LayoutFragment,
  x: number,
  y: number,
): void => {
  for (const [id, position] of child.normal) {
    parent.normal.set(id, translatedPosition(position, x, y));
  }
  for (const [id, position] of child.fixed) parent.fixed.set(id, position);
  parent.bounds = unionBounds(parent.bounds, translatedBounds(child.bounds, x, y));
};

const mergeAbsoluteFragment = (
  parent: LayoutFragment,
  child: LayoutFragment,
  anchor: Readonly<Point>,
): void => {
  for (const [id, position] of child.normal) {
    parent.fixed.set(id, translatedPosition(position, anchor.x, anchor.y));
  }
  for (const [id, position] of child.fixed) parent.fixed.set(id, position);
};

const balanceWeight = (
  state: EngineState,
  topicId: TopicId,
  active: Set<TopicId> = new Set(),
): number => {
  const memoized = state.balanceWeightMemo.get(topicId);
  if (memoized !== undefined) return memoized;
  if (active.has(topicId)) return 0;
  active.add(topicId);
  const size = measurementFor(state, topicId);
  let weight = size.height;
  if (!state.collapsed.has(topicId)) {
    for (const edge of state.childrenByParent.get(topicId) ?? []) {
      weight += balanceWeight(state, edge.childTopicId, active) + 16;
    }
  }
  active.delete(topicId);
  state.balanceWeightMemo.set(topicId, weight);
  return weight;
};

const assignMindMapSides = (
  state: EngineState,
  edges: readonly TreeEdge[],
): Map<TreeEdgeId, CardinalLayoutDirection> => {
  const result = new Map<TreeEdgeId, CardinalLayoutDirection>();
  let leftWeight = 0;
  let rightWeight = 0;
  for (const edge of edges) {
    const weight = balanceWeight(state, edge.childTopicId);
    if (edge.side === 'left') {
      result.set(edge.id, 'right-to-left');
      leftWeight += weight;
    } else if (edge.side === 'right') {
      result.set(edge.id, 'left-to-right');
      rightWeight += weight;
    }
  }
  for (const edge of edges) {
    if (result.has(edge.id)) continue;
    const weight = balanceWeight(state, edge.childTopicId);
    if (leftWeight < rightWeight) {
      result.set(edge.id, 'right-to-left');
      leftWeight += weight;
    } else {
      result.set(edge.id, 'left-to-right');
      rightWeight += weight;
    }
  }
  return result;
};

interface ChildFragment {
  edge: TreeEdge;
  topic: Topic;
  fragment: LayoutFragment;
  direction: CardinalLayoutDirection;
}

const layoutChildGroup = (
  parent: LayoutFragment,
  parentSize: Size,
  children: readonly ChildFragment[],
  direction: CardinalLayoutDirection,
  spacing: Readonly<{ sibling: number; level: number }>,
): void => {
  const movable = children.filter((child) => child.topic.placement.mode !== 'absolute');
  const horizontal = direction === 'left-to-right' || direction === 'right-to-left';
  const crossSizes = movable.map((child) => horizontal
    ? child.fragment.bounds.maxY - child.fragment.bounds.minY
    : child.fragment.bounds.maxX - child.fragment.bounds.minX);
  const totalCross = crossSizes.reduce((sum, value) => sum + value, 0)
    + Math.max(0, movable.length - 1) * spacing.sibling;
  let cursor = horizontal
    ? parentSize.height / 2 - totalCross / 2
    : parentSize.width / 2 - totalCross / 2;

  for (let index = 0; index < movable.length; index += 1) {
    const child = movable[index];
    const bounds = child.fragment.bounds;
    let x: number;
    let y: number;
    switch (direction) {
      case 'left-to-right':
        x = parentSize.width + spacing.level - bounds.minX;
        y = cursor - bounds.minY;
        break;
      case 'right-to-left':
        x = -spacing.level - bounds.maxX;
        y = cursor - bounds.minY;
        break;
      case 'top-to-bottom':
        x = cursor - bounds.minX;
        y = parentSize.height + spacing.level - bounds.minY;
        break;
      case 'bottom-to-top':
        x = cursor - bounds.minX;
        y = -spacing.level - bounds.maxY;
        break;
    }
    if (child.topic.placement.mode === 'offset') {
      x += child.topic.placement.dx;
      y += child.topic.placement.dy;
    }
    mergeNormalFragment(parent, child.fragment, x, y);
    cursor += crossSizes[index] + spacing.sibling;
  }

  for (const child of children) {
    if (child.topic.placement.mode === 'absolute') {
      mergeAbsoluteFragment(parent, child.fragment, child.topic.placement);
    }
  }
};

const numericLayoutOption = (
  layout: ResolvedLayout,
  key: string,
  fallback: number,
  minimum = 0,
  maximum = 10_000,
): number => {
  const value = layout.options[key];
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback;
};

const booleanLayoutOption = (
  layout: ResolvedLayout,
  key: string,
  fallback = false,
): boolean => typeof layout.options[key] === 'boolean'
  ? layout.options[key] as boolean
  : fallback;

const matrixRowKey = (topic: Topic): string => {
  const first = topic.labels?.find((label) => label.trim().length > 0)?.trim();
  return first ? `label:${first}` : 'label:__unlabeled__';
};

const buildMatrixColumnPlan = (
  state: EngineState,
  headerEdges: readonly TreeEdge[],
  layout: ResolvedLayout,
): MatrixColumnPlan => {
  const rowOrder: string[] = [];
  const rowSeen = new Set<string>();
  const rowMaximumMultiplicity = new Map<string, number>();
  const cellsByHeader = new Map<TopicId, TreeEdge[]>();
  let maximumCellHeight = numericLayoutOption(layout, 'rowHeight', 0, 0, 4_000);

  for (const headerEdge of headerEdges) {
    const cells = state.childrenByParent.get(headerEdge.childTopicId) ?? [];
    cellsByHeader.set(headerEdge.childTopicId, cells);
    const counts = new Map<string, number>();
    for (const cellEdge of cells) {
      const topic = state.sheet.topics[cellEdge.childTopicId];
      const rowKey = matrixRowKey(topic);
      if (!rowSeen.has(rowKey)) {
        rowSeen.add(rowKey);
        rowOrder.push(rowKey);
      }
      counts.set(rowKey, (counts.get(rowKey) ?? 0) + 1);
      maximumCellHeight = Math.max(maximumCellHeight, balanceWeight(state, topic.id));
      if (!topic.labels || topic.labels.every((label) => label.trim().length === 0)) {
        addDiagnostic(
          state,
          'matrix-unlabeled-row',
          'Unlabeled Matrix cell was assigned to the deterministic unlabeled row',
          topic.id,
          'info',
        );
      } else if (topic.labels.filter((label) => label.trim().length > 0).length > 1) {
        addDiagnostic(
          state,
          'matrix-multi-label-primary',
          'Matrix cell has multiple labels; the first non-empty label determines its row',
          topic.id,
          'info',
        );
      }
    }
    for (const [rowKey, count] of counts) {
      rowMaximumMultiplicity.set(
        rowKey,
        Math.max(rowMaximumMultiplicity.get(rowKey) ?? 0, count),
      );
      if (count > 1) {
        addDiagnostic(
          state,
          'matrix-duplicate-label-stacked',
          'Duplicate Matrix row labels in one column are stacked deterministically',
          headerEdge.childTopicId,
          'info',
        );
      }
    }
  }

  maximumCellHeight = Math.max(maximumCellHeight, DEFAULT_MEASUREMENT.height);
  const slotStride = maximumCellHeight + layout.spacing.sibling;
  const rowBase = new Map<string, number>();
  let cursor = 0;
  for (const rowKey of rowOrder) {
    rowBase.set(rowKey, cursor);
    cursor += Math.max(1, rowMaximumMultiplicity.get(rowKey) ?? 1) * slotStride;
  }

  const topicOffsets: Record<string, number> = {};
  for (const headerEdge of headerEdges) {
    const duplicateIndex = new Map<string, number>();
    for (const cellEdge of cellsByHeader.get(headerEdge.childTopicId) ?? []) {
      const topic = state.sheet.topics[cellEdge.childTopicId];
      const rowKey = matrixRowKey(topic);
      const occurrence = duplicateIndex.get(rowKey) ?? 0;
      duplicateIndex.set(rowKey, occurrence + 1);
      topicOffsets[topic.id] = (rowBase.get(rowKey) ?? 0) + occurrence * slotStride;
    }
  }
  return Object.freeze({
    topicOffsets: Object.freeze(topicOffsets),
    totalHeight: Math.max(0, cursor - layout.spacing.sibling),
  });
};

const fragmentWidth = (fragment: LayoutFragment): number =>
  fragment.bounds.maxX - fragment.bounds.minX;

const fragmentHeight = (fragment: LayoutFragment): number =>
  fragment.bounds.maxY - fragment.bounds.minY;

const placeMovableChild = (
  parent: LayoutFragment,
  child: ChildFragment,
  x: number,
  y: number,
): void => {
  const offsetX = child.topic.placement.mode === 'offset' ? child.topic.placement.dx : 0;
  const offsetY = child.topic.placement.mode === 'offset' ? child.topic.placement.dy : 0;
  mergeNormalFragment(parent, child.fragment, x + offsetX, y + offsetY);
};

const mergeAbsoluteChildren = (
  parent: LayoutFragment,
  children: readonly ChildFragment[],
): void => {
  for (const child of children) {
    if (child.topic.placement.mode === 'absolute') {
      mergeAbsoluteFragment(parent, child.fragment, child.topic.placement);
    }
  }
};

/** Places event branches along a stable time axis without mutating chronology. */
const layoutTimelineGroup = (
  parent: LayoutFragment,
  parentSize: Size,
  children: readonly ChildFragment[],
  layout: ResolvedLayout,
): void => {
  const movable = children.filter((child) => child.topic.placement.mode !== 'absolute');
  const direction = cardinalForOneWay(layout);
  const horizontal = direction === 'left-to-right' || direction === 'right-to-left';
  const offAxis = layout.variantId === 'horizontal-off-axis'
    || booleanLayoutOption(layout, 'alternate');
  const axisGap = numericLayoutOption(layout, 'axisGap', layout.spacing.sibling, 4, 1_000);

  if (horizontal) {
    const forward = direction === 'left-to-right' ? 1 : -1;
    let cursor = forward > 0 ? parentSize.width + layout.spacing.level : -layout.spacing.level;
    for (let index = 0; index < movable.length; index += 1) {
      const child = movable[index];
      const bounds = child.fragment.bounds;
      const above = offAxis && index % 2 === 0;
      const x = forward > 0 ? cursor - bounds.minX : cursor - bounds.maxX;
      const y = above
        ? -axisGap - bounds.maxY
        : parentSize.height + axisGap - bounds.minY;
      placeMovableChild(parent, child, x, y);
      cursor += forward * (fragmentWidth(child.fragment) + layout.spacing.level);
    }
  } else {
    const forward = direction === 'top-to-bottom' ? 1 : -1;
    let cursor = forward > 0 ? parentSize.height + layout.spacing.level : -layout.spacing.level;
    const alternate = booleanLayoutOption(layout, 'alternate');
    for (let index = 0; index < movable.length; index += 1) {
      const child = movable[index];
      const bounds = child.fragment.bounds;
      const left = alternate && index % 2 === 0;
      const x = left
        ? -axisGap - bounds.maxX
        : parentSize.width + axisGap - bounds.minX;
      const y = forward > 0 ? cursor - bounds.minY : cursor - bounds.maxY;
      placeMovableChild(parent, child, x, y);
      cursor += forward * (fragmentHeight(child.fragment) + layout.spacing.level);
    }
  }
  mergeAbsoluteChildren(parent, children);
};

/** Places primary causes on alternating bones along a horizontal spine. */
const layoutFishboneGroup = (
  parent: LayoutFragment,
  parentSize: Size,
  children: readonly ChildFragment[],
  layout: ResolvedLayout,
): void => {
  const movable = children.filter((child) => child.topic.placement.mode !== 'absolute');
  const direction = cardinalForOneWay(layout);
  const forward = direction === 'left-to-right' ? 1 : -1;
  const alternate = booleanLayoutOption(layout, 'alternate', true);
  const boneGap = numericLayoutOption(layout, 'boneAngle', layout.spacing.sibling, 12, 240);
  let cursor = forward > 0 ? parentSize.width + layout.spacing.level : -layout.spacing.level;
  for (let index = 0; index < movable.length; index += 1) {
    const child = movable[index];
    const bounds = child.fragment.bounds;
    const above = !alternate || index % 2 === 0;
    const x = forward > 0 ? cursor - bounds.minX : cursor - bounds.maxX;
    const y = above
      ? -boneGap - bounds.maxY
      : parentSize.height + boneGap - bounds.minY;
    placeMovableChild(parent, child, x, y);
    cursor += forward * (fragmentWidth(child.fragment) + Math.max(24, layout.spacing.level / 2));
  }
  mergeAbsoluteChildren(parent, children);
};

/** Aligns hierarchical rows/columns so the result reads like a nested table. */
const layoutTreeTableGroup = (
  parent: LayoutFragment,
  parentSize: Size,
  children: readonly ChildFragment[],
  layout: ResolvedLayout,
): void => {
  const movable = children.filter((child) => child.topic.placement.mode !== 'absolute');
  const direction = cardinalForOneWay(layout);
  const horizontal = direction === 'left-to-right' || direction === 'right-to-left';
  const rowGap = numericLayoutOption(layout, 'rowGap', layout.spacing.sibling, 0, 1_000);
  const columnWidth = numericLayoutOption(
    layout,
    'columnWidth',
    horizontal ? Math.max(parentSize.width, 180) : Math.max(parentSize.height, 80),
    horizontal ? parentSize.width : parentSize.height,
    4_000,
  );
  let cursor = 0;
  for (const child of movable) {
    const bounds = child.fragment.bounds;
    let x: number;
    let y: number;
    if (direction === 'left-to-right') {
      x = columnWidth + layout.spacing.level - bounds.minX;
      y = cursor - bounds.minY;
      cursor += fragmentHeight(child.fragment) + rowGap;
    } else if (direction === 'right-to-left') {
      x = -columnWidth - layout.spacing.level - bounds.maxX + parentSize.width;
      y = cursor - bounds.minY;
      cursor += fragmentHeight(child.fragment) + rowGap;
    } else if (direction === 'top-to-bottom') {
      x = cursor - bounds.minX;
      y = columnWidth + layout.spacing.level - bounds.minY;
      cursor += fragmentWidth(child.fragment) + rowGap;
    } else {
      x = cursor - bounds.minX;
      y = -columnWidth - layout.spacing.level - bounds.maxY + parentSize.height;
      cursor += fragmentWidth(child.fragment) + rowGap;
    }
    placeMovableChild(parent, child, x, y);
  }
  mergeAbsoluteChildren(parent, children);
};

/** Packs direct children in deterministic cells; Matrix uses one column per header. */
const layoutGridGroup = (
  parent: LayoutFragment,
  parentSize: Size,
  children: readonly ChildFragment[],
  layout: ResolvedLayout,
  forceSingleRow = false,
): void => {
  const movable = children.filter((child) => child.topic.placement.mode !== 'absolute');
  if (movable.length === 0) {
    mergeAbsoluteChildren(parent, children);
    return;
  }
  const requestedColumns = forceSingleRow
    ? movable.length
    : Math.round(numericLayoutOption(
        layout,
        'columns',
        Math.ceil(Math.sqrt(movable.length)),
        1,
        Math.max(1, movable.length),
      ));
  const columns = Math.max(1, Math.min(movable.length, requestedColumns));
  const rows = Math.ceil(movable.length / columns);
  const columnWidths = Array.from({ length: columns }, () => 0);
  const rowHeights = Array.from({ length: rows }, () => 0);
  for (let index = 0; index < movable.length; index += 1) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    columnWidths[column] = Math.max(
      columnWidths[column],
      fragmentWidth(movable[index].fragment),
      numericLayoutOption(layout, 'cellWidth', 0),
    );
    rowHeights[row] = Math.max(
      rowHeights[row],
      fragmentHeight(movable[index].fragment),
      numericLayoutOption(layout, 'cellHeight', 0),
      numericLayoutOption(layout, 'rowHeight', 0),
    );
  }
  const xOffsets: number[] = [];
  const yOffsets: number[] = [];
  let offset = 0;
  for (const width of columnWidths) {
    xOffsets.push(offset);
    offset += width + layout.spacing.sibling;
  }
  const gridWidth = Math.max(0, offset - layout.spacing.sibling);
  offset = 0;
  for (const height of rowHeights) {
    yOffsets.push(offset);
    offset += height + layout.spacing.sibling;
  }
  const gridHeight = Math.max(0, offset - layout.spacing.sibling);
  const direction = cardinalForOneWay(layout);
  for (let index = 0; index < movable.length; index += 1) {
    const child = movable[index];
    const bounds = child.fragment.bounds;
    const column = index % columns;
    const row = Math.floor(index / columns);
    const localX = xOffsets[column] - bounds.minX;
    const localY = yOffsets[row] - bounds.minY;
    let x: number;
    let y: number;
    if (direction === 'top-to-bottom') {
      x = parentSize.width / 2 - gridWidth / 2 + localX;
      y = parentSize.height + layout.spacing.level + localY;
    } else if (direction === 'bottom-to-top') {
      x = parentSize.width / 2 - gridWidth / 2 + localX;
      y = -layout.spacing.level - gridHeight + localY;
    } else if (direction === 'left-to-right') {
      x = parentSize.width + layout.spacing.level + localY;
      y = parentSize.height / 2 - gridWidth / 2 + localX;
    } else {
      x = -layout.spacing.level - gridHeight + localY;
      y = parentSize.height / 2 - gridWidth / 2 + localX;
    }
    placeMovableChild(parent, child, x, y);
  }
  mergeAbsoluteChildren(parent, children);
};

const layoutMatrixColumnGroup = (
  parent: LayoutFragment,
  parentSize: Size,
  children: readonly ChildFragment[],
  layout: ResolvedLayout,
): void => {
  const plan = layout.matrixColumnPlan;
  if (!plan) {
    layoutGridGroup(parent, parentSize, children, layout);
    return;
  }
  const movable = children.filter((child) => child.topic.placement.mode !== 'absolute');
  const direction = cardinalForOneWay(layout);
  for (const child of movable) {
    const bounds = child.fragment.bounds;
    const offset = plan.topicOffsets[child.topic.id] ?? 0;
    const x = parentSize.width / 2 - fragmentWidth(child.fragment) / 2 - bounds.minX;
    const y = direction === 'bottom-to-top'
      ? -layout.spacing.level - plan.totalHeight + offset - bounds.minY
      : parentSize.height + layout.spacing.level + offset - bounds.minY;
    placeMovableChild(parent, child, x, y);
  }
  mergeAbsoluteChildren(parent, children);
};

const layoutChildrenForStructure = (
  parent: LayoutFragment,
  parentSize: Size,
  children: readonly ChildFragment[],
  layout: ResolvedLayout,
): void => {
  switch (layout.structure) {
    case 'core:timeline':
      layoutTimelineGroup(parent, parentSize, children, layout);
      return;
    case 'core:fishbone':
      layoutFishboneGroup(parent, parentSize, children, layout);
      return;
    case 'core:matrix':
      layoutGridGroup(parent, parentSize, children, layout, true);
      return;
    case 'core:grid':
      if (layout.matrixColumnPlan) {
        layoutMatrixColumnGroup(parent, parentSize, children, layout);
      } else {
        layoutGridGroup(parent, parentSize, children, layout);
      }
      return;
    case 'core:tree-table':
    case 'core:brace-map':
      layoutTreeTableGroup(parent, parentSize, children, layout);
      return;
    default:
      layoutChildGroup(
        parent,
        parentSize,
        children,
        cardinalForOneWay(layout),
        layout.spacing,
      );
  }
};

const inheritedLayoutForChild = (
  layout: ResolvedLayout,
  childIndex: number,
  matrixColumnPlan?: MatrixColumnPlan,
): ResolvedLayout => {
  const direction = cardinalForOneWay(layout);
  const base: ResolvedLayout = {
    structure: layout.structure,
    direction: layout.direction,
    mode: layout.mode,
    spacing: layout.spacing,
    compact: layout.compact,
    ...(layout.variantId ? { variantId: layout.variantId } : {}),
    options: layout.options,
  };
  if (layout.structure === 'core:timeline') {
    const horizontal = direction === 'left-to-right' || direction === 'right-to-left';
    const alternating = layout.variantId === 'horizontal-off-axis'
      || booleanLayoutOption(layout, 'alternate');
    const branchDirection: CardinalLayoutDirection = horizontal
      ? alternating && childIndex % 2 === 0 ? 'bottom-to-top' : 'top-to-bottom'
      : alternating && childIndex % 2 === 0 ? 'right-to-left' : 'left-to-right';
    return {
      ...base,
      structure: 'core:logic-chart',
      direction: branchDirection,
      variantId: 'standard',
      options: Object.freeze({}),
    };
  }
  if (layout.structure === 'core:fishbone') {
    return {
      ...base,
      structure: 'core:logic-chart',
      direction: childIndex % 2 === 0 ? 'bottom-to-top' : 'top-to-bottom',
      variantId: 'standard',
      options: Object.freeze({}),
    };
  }
  if (layout.structure === 'core:matrix') {
    return {
      ...base,
      structure: 'core:grid',
      direction: direction === 'bottom-to-top' ? 'bottom-to-top' : 'top-to-bottom',
      variantId: 'standard',
      options: Object.freeze({
        columns: 1,
        cellHeight: numericLayoutOption(layout, 'rowHeight', 0, 0, 1_000),
      }),
      ...(matrixColumnPlan ? { matrixColumnPlan } : {}),
    };
  }
  if (layout.structure === 'core:grid') {
    return {
      ...base,
      structure: 'core:logic-chart',
      direction: direction === 'bottom-to-top' ? 'bottom-to-top' : 'top-to-bottom',
      variantId: 'standard',
      options: Object.freeze({}),
    };
  }
  return base;
};

const buildFragment = (
  topicId: TopicId,
  inherited: ResolvedLayout,
  state: EngineState,
  active: Set<TopicId>,
): LayoutFragment => {
  const topic = state.sheet.topics[topicId];
  const size = measurementFor(state, topicId);
  const rootPosition = placementPosition(topic, size);
  const fragment: LayoutFragment = {
    normal: new Map([[topicId, rootPosition]]),
    fixed: new Map(),
    bounds: rectBounds(rootPosition),
    edgeOrder: [],
    edgeMetadata: new Map(),
    topicOrder: [topicId],
  };
  if (active.has(topicId)) {
    addDiagnostic(state, 'tree-cycle', 'Cycle edge was excluded from layout traversal', topicId);
    return fragment;
  }
  if (state.collapsed.has(topicId)) return fragment;

  active.add(topicId);
  const layout = resolveTopicLayout(topic, inherited, state);
  const edges = state.childrenByParent.get(topicId) ?? [];
  const matrixColumnPlan = layout.structure === 'core:matrix'
    ? buildMatrixColumnPlan(state, edges, layout)
    : undefined;
  const sideAssignments = layout.structure === 'core:mind-map' && layout.direction === 'both'
    ? assignMindMapSides(state, edges)
    : undefined;
  const childFragments: ChildFragment[] = [];

  for (let edgeIndex = 0; edgeIndex < edges.length; edgeIndex += 1) {
    const edge = edges[edgeIndex];
    if (active.has(edge.childTopicId)) {
      addDiagnostic(state, 'tree-cycle', 'Cycle TreeEdge was excluded from layout', edge.id);
      continue;
    }
    const direction = sideAssignments?.get(edge.id) ?? cardinalForOneWay(layout);
    const directionalLayout: ResolvedLayout = layout.direction === 'both'
      ? { ...layout, direction }
      : layout;
    const childInherited = inheritedLayoutForChild(
      directionalLayout,
      edgeIndex,
      matrixColumnPlan,
    );
    const childTopic = state.sheet.topics[edge.childTopicId];
    const childFragment = buildFragment(edge.childTopicId, childInherited, state, active);
    childFragments.push({ edge, topic: childTopic, fragment: childFragment, direction });
  }

  if (sideAssignments) {
    const left = childFragments.filter((child) => child.direction === 'right-to-left');
    const right = childFragments.filter((child) => child.direction === 'left-to-right');
    layoutChildGroup(fragment, size, left, 'right-to-left', layout.spacing);
    layoutChildGroup(fragment, size, right, 'left-to-right', layout.spacing);
  } else {
    layoutChildrenForStructure(fragment, size, childFragments, layout);
  }

  for (const child of childFragments) {
    fragment.edgeOrder.push(child.edge, ...child.fragment.edgeOrder);
    fragment.edgeMetadata.set(child.edge.id, {
      direction: child.direction,
      structure: layout.structure,
    });
    for (const [edgeId, metadata] of child.fragment.edgeMetadata) {
      fragment.edgeMetadata.set(edgeId, metadata);
    }
    fragment.topicOrder.push(...child.fragment.topicOrder);
  }
  active.delete(topicId);
  return fragment;
};

const stableRoots = (state: EngineState): TopicId[] => {
  const incoming = new Set<TopicId>();
  for (const edges of state.childrenByParent.values()) {
    for (const edge of edges) incoming.add(edge.childTopicId);
  }
  const roleRank: Record<Topic['role'], number> = {
    central: 0,
    'floating-root': 1,
    'summary-result': 2,
    regular: 3,
  };
  return Object.values(state.sheet.topics)
    .filter((topic) => !incoming.has(topic.id))
    .sort((left, right) => {
      if (left.id === state.sheet.rootTopicId) return -1;
      if (right.id === state.sheet.rootTopicId) return 1;
      return roleRank[left.role] - roleRank[right.role] || compareAscii(left.id, right.id);
    })
    .map((topic) => topic.id);
};

type SummaryLayoutOrientation = Exclude<Summary['orientation'], 'auto'>;

const defaultSummaryLayoutOrientation = (
  sheet: MindMapSheet,
): SummaryLayoutOrientation => {
  switch (sheet.defaultBranchLayout.direction) {
    case 'right-to-left': return 'left';
    case 'top-to-bottom': return 'bottom';
    case 'bottom-to-top': return 'top';
    default: return 'right';
  }
};

const incomingTreeEdges = (sheet: MindMapSheet): Map<TopicId, TreeEdge> => {
  const result = new Map<TopicId, TreeEdge>();
  for (const edge of Object.values(sheet.treeEdges).sort(compareEdges)) {
    if (!result.has(edge.childTopicId)) result.set(edge.childTopicId, edge);
  }
  return result;
};

const summaryLayoutOrientation = (
  sheet: MindMapSheet,
  summary: Summary,
  incoming: ReadonlyMap<TopicId, TreeEdge>,
): SummaryLayoutOrientation => {
  if (summary.orientation !== 'auto') return summary.orientation;
  const scopeEdge = summary.scope.kind === 'sibling-range'
    ? sheet.treeEdges[summary.scope.firstEdgeId]
    : expandSemanticTopicScope(sheet, summary.scope)
        .map((topicId) => incoming.get(topicId))
        .find((edge): edge is TreeEdge => edge !== undefined);
  if (scopeEdge) {
    const side = resolveSemanticEdgeSide(sheet, scopeEdge);
    if (side !== 'center') return side;
  }
  return defaultSummaryLayoutOrientation(sheet);
};

const structuralRootTopicId = (
  topicId: TopicId,
  incoming: ReadonlyMap<TopicId, TreeEdge>,
): TopicId => {
  const visited = new Set<TopicId>();
  let cursor = topicId;
  let edge = incoming.get(cursor);
  while (edge && !visited.has(edge.parentTopicId)) {
    visited.add(cursor);
    cursor = edge.parentTopicId;
    edge = incoming.get(cursor);
  }
  return cursor;
};

/**
 * A Summary may itself summarize Topics below another Summary result. Place
 * owners before dependants so every result root is derived from final scope
 * coordinates. Cycles are tolerated with a stable ID fallback.
 */
const summaryPlacementOrder = (
  sheet: MindMapSheet,
  incoming: ReadonlyMap<TopicId, TreeEdge>,
): Summary[] => {
  const summaries = Object.values(sheet.summaries)
    .sort((left, right) => compareAscii(left.id, right.id));
  const ownerByResultRoot = new Map(
    summaries.map((summary) => [summary.resultTopicId, summary] as const),
  );
  const visited = new Set<string>();
  const active = new Set<string>();
  const ordered: Summary[] = [];
  const visit = (summary: Summary): void => {
    if (visited.has(summary.id)) return;
    if (active.has(summary.id)) return;
    active.add(summary.id);
    const dependencies = [...new Set(
      expandSemanticTopicScope(sheet, summary.scope)
        .map((topicId) => ownerByResultRoot.get(structuralRootTopicId(topicId, incoming)))
        .filter((candidate): candidate is Summary => Boolean(candidate))
        .filter((candidate) => candidate.id !== summary.id),
    )].sort((left, right) => compareAscii(left.id, right.id));
    for (const dependency of dependencies) visit(dependency);
    active.delete(summary.id);
    visited.add(summary.id);
    ordered.push(summary);
  };
  for (const summary of summaries) visit(summary);
  return ordered;
};

const topicIdsInSubtree = (state: EngineState, rootTopicId: TopicId): TopicId[] => {
  const result: TopicId[] = [];
  const visited = new Set<TopicId>();
  const visit = (topicId: TopicId): void => {
    if (visited.has(topicId)) return;
    visited.add(topicId);
    result.push(topicId);
    for (const edge of state.childrenByParent.get(topicId) ?? []) visit(edge.childTopicId);
  };
  visit(rootTopicId);
  return result;
};

const boundsForPositionIds = (
  positions: ReadonlyMap<TopicId, InternalPosition>,
  topicIds: readonly TopicId[],
): InternalBounds | null => topicIds.reduce<InternalBounds | null>((bounds, topicId) => {
  const position = positions.get(topicId);
  if (!position) return bounds;
  const topicBounds = rectBounds(position);
  return bounds ? unionBounds(bounds, topicBounds) : topicBounds;
}, null);

/**
 * Summary result Topics are semantic roots, not unrelated floating roots.
 * The normal forest pass lays out each result subtree internally; this pass
 * translates that complete subtree next to its resolved bracket anchor.
 */
const placeSummaryResultSubtrees = (
  state: EngineState,
  positions: Map<TopicId, InternalPosition>,
): void => {
  const incoming = incomingTreeEdges(state.sheet);
  for (const summary of summaryPlacementOrder(state.sheet, incoming)) {
    const resultPosition = positions.get(summary.resultTopicId);
    const scopeBounds = boundsForPositionIds(
      positions,
      expandSemanticTopicScope(state.sheet, summary.scope),
    );
    if (!resultPosition || !scopeBounds) continue;
    const orientation = summaryLayoutOrientation(state.sheet, summary, incoming);
    const scopeCenterX = (scopeBounds.minX + scopeBounds.maxX) / 2;
    const scopeCenterY = (scopeBounds.minY + scopeBounds.maxY) / 2;
    let desiredX = resultPosition.x;
    let desiredY = resultPosition.y;
    switch (orientation) {
      case 'left':
        desiredX = scopeBounds.minX - SUMMARY_RESULT_GAP - resultPosition.width;
        desiredY = scopeCenterY - resultPosition.height / 2;
        break;
      case 'right':
        desiredX = scopeBounds.maxX + SUMMARY_RESULT_GAP;
        desiredY = scopeCenterY - resultPosition.height / 2;
        break;
      case 'top':
        desiredX = scopeCenterX - resultPosition.width / 2;
        desiredY = scopeBounds.minY - SUMMARY_RESULT_GAP - resultPosition.height;
        break;
      case 'bottom':
        desiredX = scopeCenterX - resultPosition.width / 2;
        desiredY = scopeBounds.maxY + SUMMARY_RESULT_GAP;
        break;
    }
    const resultTopic = state.sheet.topics[summary.resultTopicId];
    if (resultTopic?.placement.mode === 'offset') {
      desiredX += resultTopic.placement.dx;
      desiredY += resultTopic.placement.dy;
    }
    const dx = desiredX - resultPosition.x;
    const dy = desiredY - resultPosition.y;
    if (dx === 0 && dy === 0) continue;
    for (const topicId of topicIdsInSubtree(state, summary.resultTopicId)) {
      const current = positions.get(topicId);
      if (current) positions.set(topicId, translatedPosition(current, dx, dy));
    }
  }
};

const stableStringify = (value: unknown): string => {
  const serialize = (current: unknown): string => {
    if (current === null || typeof current !== 'object') return JSON.stringify(current) ?? 'null';
    if (Array.isArray(current)) return `[${current.map(serialize).join(',')}]`;
    const record = current as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${serialize(record[key])}`).join(',')}}`;
  };
  return serialize(value);
};

const hashCachePayload = (payload: string): string => {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < payload.length; index += 1) {
    const code = payload.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = Math.imul(second ^ code, 0x85ebca6b) >>> 0;
    second ^= second >>> 13;
  }
  return `${first.toString(16).padStart(8, '0')}${second.toString(16).padStart(8, '0')}`;
};

const cacheKeyFor = (
  request: CoreLayoutRequest,
  state: EngineState,
  origin: Point,
  forestGap: number,
): string => {
  const topics = Object.values(state.sheet.topics).sort(compareTopics).map((topic) => ({
    id: topic.id,
    role: topic.role,
    placement: topic.placement,
    branchLayout: topic.branchLayout,
    defaultCollapsed: topic.defaultCollapsed,
    labels: topic.labels,
  }));
  const edges = Object.values(state.sheet.treeEdges)
    .sort((left, right) => compareAscii(left.id, right.id))
    .map((edge) => ({
      id: edge.id,
      parentTopicId: edge.parentTopicId,
      childTopicId: edge.childTopicId,
      orderKey: edge.orderKey,
      side: edge.side,
      slot: edge.slot,
    }));
  const measurements = [...state.measurements.entries()]
    .sort(([left], [right]) => compareAscii(left, right))
    .map(([id, size]) => ({ id, ...size }));
  const payload = stableStringify({
    version: CORE_LAYOUT_CAPABILITY_VERSION,
    sheetId: state.sheet.id,
    defaultBranchLayout: state.sheet.defaultBranchLayout,
    topics,
    edges,
    measurements,
    collapsedTopicIds: [...state.collapsed].sort(compareAscii),
    origin,
    forestGap,
    measurementInputCount: request.measurements.length,
  });
  return `${CORE_LAYOUT_CAPABILITY_VERSION}:${hashCachePayload(payload)}`;
};

const connectorFor = (
  edge: TreeEdge,
  metadata: EdgeLayoutMetadata,
  positions: ReadonlyMap<TopicId, InternalPosition>,
): TreeConnectorLayout | null => {
  const source = positions.get(edge.parentTopicId);
  const target = positions.get(edge.childTopicId);
  if (!source || !target) return null;
  let start: Point;
  let end: Point;
  let controls: Point[];
  switch (metadata.direction) {
    case 'left-to-right': {
      start = { x: source.x + source.width, y: source.y + source.height / 2 };
      end = { x: target.x, y: target.y + target.height / 2 };
      const middle = (start.x + end.x) / 2;
      controls = [{ x: middle, y: start.y }, { x: middle, y: end.y }];
      break;
    }
    case 'right-to-left': {
      start = { x: source.x, y: source.y + source.height / 2 };
      end = { x: target.x + target.width, y: target.y + target.height / 2 };
      const middle = (start.x + end.x) / 2;
      controls = [{ x: middle, y: start.y }, { x: middle, y: end.y }];
      break;
    }
    case 'top-to-bottom': {
      start = { x: source.x + source.width / 2, y: source.y + source.height };
      end = { x: target.x + target.width / 2, y: target.y };
      const middle = (start.y + end.y) / 2;
      controls = [{ x: start.x, y: middle }, { x: end.x, y: middle }];
      break;
    }
    case 'bottom-to-top': {
      start = { x: source.x + source.width / 2, y: source.y };
      end = { x: target.x + target.width / 2, y: target.y + target.height };
      const middle = (start.y + end.y) / 2;
      controls = [{ x: start.x, y: middle }, { x: end.x, y: middle }];
      break;
    }
  }
  const routing = CORE_LAYOUT_CAPABILITIES[metadata.structure].connectorRouting;
  const points = [start, ...controls, end].map((point) => Object.freeze({
    x: rounded(point.x),
    y: rounded(point.y),
  }));
  return Object.freeze({
    entityId: edge.id,
    sourceTopicId: edge.parentTopicId,
    targetTopicId: edge.childTopicId,
    direction: metadata.direction,
    routing,
    points: Object.freeze(points),
  });
};

const sortedDiagnostics = (diagnostics: readonly LayoutDiagnostic[]): readonly LayoutDiagnostic[] =>
  Object.freeze([...diagnostics].sort((left, right) =>
    compareAscii(left.entityId ?? '', right.entityId ?? '')
    || compareAscii(left.code, right.code)
    || compareAscii(left.message, right.message)));

/** Deterministic renderer-neutral Core layout. Relationship is never read. */
export const layoutCoreMindMap = (request: CoreLayoutRequest): CoreLayoutResult => {
  const sheet = request.sheet as MindMapSheet;
  const state: EngineState = {
    sheet,
    measurements: new Map(),
    childrenByParent: buildChildrenIndex(sheet),
    collapsed: request.collapsedTopicIds === undefined
      ? new Set(Object.values(sheet.topics)
          .filter((topic) => topic.defaultCollapsed)
          .map((topic) => topic.id))
      : new Set(request.collapsedTopicIds),
    diagnostics: [],
    balanceWeightMemo: new Map(),
  };
  state.measurements = buildMeasurements(request.measurements, state);
  const inherited = initialLayout(sheet, state);
  const origin: Point = {
    x: Number.isFinite(request.origin?.x) ? request.origin!.x : 0,
    y: Number.isFinite(request.origin?.y) ? request.origin!.y : 0,
  };
  const forestGap = finiteNonNegative(request.forestGap ?? DEFAULT_FOREST_GAP, DEFAULT_FOREST_GAP);
  const cacheKey = cacheKeyFor(request, state, origin, forestGap);

  const finalPositions = new Map<TopicId, InternalPosition>();
  const topicOrder: TopicId[] = [];
  const edgeOrder: TreeEdge[] = [];
  const edgeMetadata = new Map<TreeEdgeId, EdgeLayoutMetadata>();
  let finalBounds: InternalBounds | null = null;
  let packedBottom = origin.y;
  let hasPlacedRoot = false;

  for (const rootId of stableRoots(state)) {
    const topic = sheet.topics[rootId];
    const fragment = buildFragment(rootId, inherited, state, new Set());
    let anchor: Point;
    if (topic.placement.mode === 'absolute') {
      anchor = { x: topic.placement.x, y: topic.placement.y };
    } else if (!hasPlacedRoot) {
      anchor = {
        x: origin.x + (topic.placement.mode === 'offset' ? topic.placement.dx : 0),
        y: origin.y + (topic.placement.mode === 'offset' ? topic.placement.dy : 0),
      };
    } else {
      anchor = {
        x: origin.x - fragment.bounds.minX
          + (topic.placement.mode === 'offset' ? topic.placement.dx : 0),
        y: packedBottom + forestGap - fragment.bounds.minY
          + (topic.placement.mode === 'offset' ? topic.placement.dy : 0),
      };
    }

    for (const [id, position] of fragment.normal) {
      const translated = translatedPosition(position, anchor.x, anchor.y);
      finalPositions.set(id, translated);
      const rect = rectBounds(translated);
      finalBounds = finalBounds ? unionBounds(finalBounds, rect) : rect;
    }
    for (const [id, position] of fragment.fixed) {
      finalPositions.set(id, position);
      const rect = rectBounds(position);
      finalBounds = finalBounds ? unionBounds(finalBounds, rect) : rect;
    }
    if (finalBounds) packedBottom = finalBounds.maxY;
    hasPlacedRoot = true;
    topicOrder.push(...fragment.topicOrder);
    edgeOrder.push(...fragment.edgeOrder);
    for (const [id, metadata] of fragment.edgeMetadata) edgeMetadata.set(id, metadata);
  }

  placeSummaryResultSubtrees(state, finalPositions);
  finalBounds = null;
  for (const position of finalPositions.values()) {
    const positionBounds = rectBounds(position);
    finalBounds = finalBounds ? unionBounds(finalBounds, positionBounds) : positionBounds;
  }

  const positions: Record<string, TopicLayoutPosition> = {};
  for (const topicId of topicOrder) {
    const position = finalPositions.get(topicId);
    if (!position || positions[topicId]) continue;
    positions[topicId] = Object.freeze({
      ...position,
      x: rounded(position.x),
      y: rounded(position.y),
      width: rounded(position.width),
      height: rounded(position.height),
      ...(position.appliedOffset
        ? { appliedOffset: Object.freeze({
            x: position.appliedOffset.x,
            y: position.appliedOffset.y,
          }) }
        : {}),
    });
  }
  const readonlyPositionMap = new Map(
    Object.values(positions).map((position) => [position.entityId, position] as const),
  );
  const connectors = edgeOrder
    .map((edge) => {
      const metadata = edgeMetadata.get(edge.id);
      return metadata ? connectorFor(edge, metadata, readonlyPositionMap) : null;
    })
    .filter((connector): connector is TreeConnectorLayout => connector !== null);
  const bounds: LayoutBounds = finalBounds
    ? Object.freeze({
        x: rounded(finalBounds.minX),
        y: rounded(finalBounds.minY),
        width: rounded(finalBounds.maxX - finalBounds.minX),
        height: rounded(finalBounds.maxY - finalBounds.minY),
      })
    : Object.freeze({ x: origin.x, y: origin.y, width: 0, height: 0 });

  return Object.freeze({
    engineVersion: CORE_LAYOUT_CAPABILITY_VERSION,
    cacheKey,
    topicOrder: Object.freeze([...new Set(topicOrder)]),
    positions: Object.freeze(positions),
    connectors: Object.freeze(connectors),
    bounds,
    diagnostics: sortedDiagnostics(state.diagnostics),
  });
};
