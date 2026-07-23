import { Position, type Edge, type Node } from 'reactflow';

import type {
  BranchSide,
  ElementRef,
  MindMapDocumentV1,
  MindMapSheet,
  Relationship,
  RichList,
  RichText,
  Size,
  SummaryId,
  Topic,
  TopicId,
  TreeEdge,
} from '../domain/types';
import {
  layoutCoreMindMap,
  type CardinalLayoutDirection,
  type CoreLayoutResult,
  type TreeConnectorLayout,
} from '../layout';
import type {
  MindMapRenderModel,
  RenderEndpointVisibility,
  RenderVisibility,
  TopicRenderItem,
} from '../render/model';
import {
  buildSemanticOverlayGeometry,
  type SemanticOverlayGeometryModel,
} from '../render/geometry';
import {
  resolveConnectorStyle as resolveCanonicalConnectorStyle,
  resolveSemanticStyle as resolveCanonicalSemanticStyle,
  resolveTopicStyle as resolveCanonicalTopicStyle,
} from '../style';
import type {
  ConnectorVisualStyle,
  SemanticVisualStyle,
  TopicVisualStyle,
} from '../style';
import {
  buildTopicEnrichmentsProjection,
  type EmbeddedImageUrlResolver,
  type ImageEnrichmentProjection,
  type TopicBadgeProjection,
} from './enrichmentProjection';

export type { ConnectorVisualStyle, SemanticVisualStyle, TopicVisualStyle } from '../style';

export const TOPIC_NODE_TYPE = 'mindMapV2Topic' as const;
export const TOPIC_NODE_WIDTH = 184;
export const TOPIC_NODE_HEIGHT = 58;
export const CENTRAL_TOPIC_NODE_WIDTH = 220;
export const CENTRAL_TOPIC_NODE_HEIGHT = 68;

export interface MindMapTopicNodeData {
  readonly kind: 'topic';
  readonly entityId: TopicId;
  readonly label: string;
  /** Canonical title retained for mark/list aware rendering and editing. */
  readonly title: RichText;
  readonly role: Topic['role'];
  /** Renderer-only ownership metadata for canonical Summary result Topics. */
  readonly summaryOwnerId?: SummaryId;
  readonly depth: number;
  readonly collapsed: boolean;
  readonly childCount: number;
  readonly sourcePosition: Position;
  readonly targetPosition: Position;
  readonly editing?: boolean;
  /** View-only search/filter state; never serialized into canonical content. */
  readonly searchState?: 'normal' | 'match' | 'context' | 'dimmed';
  /** Optional renderer-only enrichment indicators; never persisted by React Flow. */
  readonly badges?: readonly TopicBadgeProjection[];
  /** Canonical Local Image projections; renderer-only and never serialized by React Flow. */
  readonly localImages: readonly ImageEnrichmentProjection[];
  readonly visualStyle: TopicVisualStyle;
}

export interface MindMapTreeEdgeData {
  readonly kind: 'tree-edge';
  readonly entityId: TreeEdge['id'];
  /** Renderer-neutral connector geometry emitted by the Core layout engine. */
  readonly layout?: TreeConnectorLayout;
}

export interface MindMapRelationshipEdgeData {
  readonly kind: 'relationship';
  readonly entityId: Relationship['id'];
  readonly title?: string;
}

export type MindMapFlowEdgeData = MindMapTreeEdgeData | MindMapRelationshipEdgeData;

export type SemanticOverlayKind =
  | 'boundary'
  | 'summary'
  | 'callout'
  | 'zone'
  | 'relationship';

export interface SemanticOverlayListItem {
  readonly kind: SemanticOverlayKind;
  readonly entityId: string;
  readonly label: string;
  readonly detail: string;
  readonly visibility: RenderVisibility | RenderEndpointVisibility;
}

export interface MindMapFlowProjection {
  readonly nodes: readonly Node<MindMapTopicNodeData>[];
  readonly treeEdges: readonly Edge<MindMapTreeEdgeData>[];
  readonly relationshipEdges: readonly Edge<MindMapRelationshipEdgeData>[];
  readonly edges: readonly Edge<MindMapFlowEdgeData>[];
  readonly overlays: readonly SemanticOverlayListItem[];
  /** Renderer-neutral geometry for custom semantic overlays and hit testing. */
  readonly semanticGeometry: SemanticOverlayGeometryModel;
  /** Fully resolved, token-free visual styles for semantic SVG entities. */
  readonly semanticStyles: Readonly<Record<string, SemanticVisualStyle | ConnectorVisualStyle>>;
  readonly derivedAutoTopicPositions: Readonly<Record<string, { x: number; y: number }>>;
  /** Exposed for diagnostics, cache reuse, and future custom connector rendering. */
  readonly coreLayout: CoreLayoutResult;
}

export interface MindMapFlowProjectionOptions {
  readonly resolveEmbeddedImageUrl?: EmbeddedImageUrlResolver;
  /**
   * Renderer-only minimum boxes for content that is not part of the base Topic
   * measurement (for example formal-export annotations). Values may expand,
   * but never shrink, the deterministic canonical measurement.
   */
  readonly minimumTopicSizes?: Readonly<Partial<Record<TopicId, Readonly<Size>>>>;
}

const paragraphText = (block: RichText['blocks'][number]): string => {
  if (block.type === 'paragraph') {
    return block.children
      .map((child) => child.type === 'hardBreak' ? '\n' : child.text)
      .join('');
  }
  return listText(block);
};

const listText = (list: RichList): string => list.items
  .map((item) => item.children.map(paragraphText).join('\n'))
  .join('\n');

export const richTextToPlainText = (richText: RichText | undefined): string =>
  richText?.blocks.map(paragraphText).join('\n').trim() ?? '';

const topicSide = (
  model: MindMapRenderModel,
  item: TopicRenderItem,
): BranchSide | undefined => item.incomingTreeEdgeId
  ? model.sheet.treeEdges[item.incomingTreeEdgeId]?.side
  : undefined;

export const resolveTopicVisualStyle = (
  document: Readonly<MindMapDocumentV1>,
  model: MindMapRenderModel,
  item: TopicRenderItem,
): TopicVisualStyle => resolveCanonicalTopicStyle({
  document,
  themeId: model.sheet.themeId,
  role: item.entity.role,
  binding: item.entity.style,
  level: item.depth,
  side: topicSide(model, item),
  structure: model.sheet.defaultBranchLayout.structure === 'inherit'
    ? undefined
    : model.sheet.defaultBranchLayout.structure,
}).visual;

export const resolveTreeEdgeVisualStyle = (
  document: Readonly<MindMapDocumentV1>,
  model: MindMapRenderModel,
  edge: Readonly<TreeEdge>,
): ConnectorVisualStyle => resolveCanonicalConnectorStyle({
  document,
  themeId: model.sheet.themeId,
  scope: 'tree-edge',
  binding: edge.style,
  level: model.treeEdges.find((item) => item.entityId === edge.id)?.childDepth,
  side: edge.side,
  structure: model.sheet.defaultBranchLayout.structure === 'inherit'
    ? undefined
    : model.sheet.defaultBranchLayout.structure,
}).visual;

export const resolveRelationshipVisualStyle = (
  document: Readonly<MindMapDocumentV1>,
  model: MindMapRenderModel,
  relationship: Readonly<Relationship>,
): ConnectorVisualStyle => resolveCanonicalConnectorStyle({
  document,
  themeId: model.sheet.themeId,
  scope: 'relationship',
  binding: relationship.style,
  structure: model.sheet.defaultBranchLayout.structure === 'inherit'
    ? undefined
    : model.sheet.defaultBranchLayout.structure,
}).visual;

const directionSettings = (
  direction: MindMapRenderModel['sheet']['defaultBranchLayout']['direction'],
): { source: Position; target: Position } => {
  if (direction === 'right-to-left') {
    return { source: Position.Left, target: Position.Right };
  }
  if (direction === 'top-to-bottom') {
    return { source: Position.Bottom, target: Position.Top };
  }
  if (direction === 'bottom-to-top') {
    return { source: Position.Top, target: Position.Bottom };
  }
  return { source: Position.Right, target: Position.Left };
};

const visualTextUnits = (value: string): number => [...value].reduce(
  (total, character) => total + (/[^\u0000-\u00ff]/.test(character) ? 1 : 0.56),
  0,
);

/**
 * Deterministic text measurement used before React Flow mounts. It deliberately
 * avoids DOM/font metrics so layout, export and tests share the same geometry.
 */
export const isOrdinaryStackedTopicImage = (
  image: Readonly<ImageEnrichmentProjection>,
): boolean => image.role !== 'sticker'
  && image.role !== 'background'
  && (image.placement.side === 'top' || image.placement.side === 'bottom');

const TOPIC_IMAGE_HORIZONTAL_PADDING = 32;
const TOPIC_IMAGE_VERTICAL_GAP = 8;

export interface TopicStickerLayoutMetrics {
  readonly topHeight: number;
  readonly topWidth: number;
  readonly bottomHeight: number;
  readonly bottomWidth: number;
  readonly leftWidth: number;
  readonly leftHeight: number;
  readonly rightWidth: number;
  readonly rightHeight: number;
}

const imageStackLength = (
  images: readonly ImageEnrichmentProjection[],
  dimension: 'height' | 'width',
): number => images.length === 0
  ? 0
  : images.reduce((total, image) => total + image.displaySize[dimension], 0)
    + TOPIC_IMAGE_VERTICAL_GAP * images.length;

/** Public Sticker positions reserve deterministic layout space; overlay is migration-only. */
export const measureTopicStickerLayout = (
  images: readonly ImageEnrichmentProjection[] = [],
): TopicStickerLayoutMetrics => {
  const stickers = (side: 'top' | 'bottom' | 'left' | 'right') => images.filter(
    (image) => image.role === 'sticker' && image.placement.side === side,
  );
  const top = stickers('top');
  const bottom = stickers('bottom');
  const left = stickers('left');
  const right = stickers('right');
  return {
    topHeight: imageStackLength(top, 'height'),
    topWidth: top.reduce((maximum, image) => Math.max(maximum, image.displaySize.width), 0),
    bottomHeight: imageStackLength(bottom, 'height'),
    bottomWidth: bottom.reduce((maximum, image) => Math.max(maximum, image.displaySize.width), 0),
    leftWidth: left.reduce((maximum, image) => Math.max(maximum, image.displaySize.width), 0)
      + (left.length > 0 ? TOPIC_IMAGE_VERTICAL_GAP : 0),
    leftHeight: imageStackLength(left, 'height'),
    rightWidth: right.reduce((maximum, image) => Math.max(maximum, image.displaySize.width), 0)
      + (right.length > 0 ? TOPIC_IMAGE_VERTICAL_GAP : 0),
    rightHeight: imageStackLength(right, 'height'),
  };
};

/**
 * Shared deterministic measurement for canvas layout and renderer/export
 * adapters. Top/bottom ordinary images stack around the text box; Sticker and
 * deferred left/right/overlay placements never reserve ordinary topic space.
 */
export const measureMindMapTopicNode = (
  topic: Readonly<Topic>,
  images: readonly ImageEnrichmentProjection[] = [],
): { width: number; height: number } => {
  const central = topic.role === 'central';
  const minimumWidth = central ? CENTRAL_TOPIC_NODE_WIDTH : 120;
  const baseHeight = central ? CENTRAL_TOPIC_NODE_HEIGHT : TOPIC_NODE_HEIGHT;
  const text = richTextToPlainText(topic.title) || '未命名主题';
  const sourceLines = text.split('\n');
  const widestUnits = Math.max(1, ...sourceLines.map(visualTextUnits));
  const width = topic.sizing.width.mode === 'fixed'
    ? Math.round(Math.min(640, Math.max(80, topic.sizing.width.value)))
    : Math.round(Math.min(360, Math.max(minimumWidth, widestUnits * 14 + 40)));
  const usableUnits = Math.max(1, (width - 32) / 14);
  const visualLineCount = sourceLines.reduce(
    (total, line) => total + Math.max(1, Math.ceil(visualTextUnits(line) / usableUnits)),
    0,
  );
  const textHeight = Math.min(260, baseHeight + Math.max(0, visualLineCount - 1) * 18);
  const stackedImages = images.filter(isOrdinaryStackedTopicImage);
  const imageWidth = stackedImages.reduce(
    (maximum, image) => Math.max(maximum, image.displaySize.width),
    0,
  );
  const imageHeight = stackedImages.reduce(
    (total, image) => total + image.displaySize.height + TOPIC_IMAGE_VERTICAL_GAP,
    0,
  );
  const stickerLayout = measureTopicStickerLayout(images);
  const centerWidth = Math.max(
    width,
    imageWidth > 0 ? imageWidth + TOPIC_IMAGE_HORIZONTAL_PADDING : 0,
    stickerLayout.topWidth,
    stickerLayout.bottomWidth,
  );
  const centerHeight = textHeight + imageHeight;
  return {
    width: stickerLayout.leftWidth + centerWidth + stickerLayout.rightWidth,
    height: stickerLayout.topHeight
      + Math.max(centerHeight, stickerLayout.leftHeight, stickerLayout.rightHeight)
      + stickerLayout.bottomHeight,
  };
};

const measureMindMapTopicNodeWithMinimum = (
  topic: Readonly<Topic>,
  images: readonly ImageEnrichmentProjection[],
  minimum: Readonly<Size> | undefined,
): { width: number; height: number } => {
  const base = measureMindMapTopicNode(topic, images);
  if (!minimum) return base;
  const minimumWidth = Number.isFinite(minimum.width) && minimum.width > 0
    ? minimum.width
    : base.width;
  const minimumHeight = Number.isFinite(minimum.height) && minimum.height > 0
    ? minimum.height
    : base.height;
  return {
    width: Math.max(base.width, Math.round(minimumWidth)),
    height: Math.max(base.height, Math.round(minimumHeight)),
  };
};

const edgeTypeForRelationship = (
  routing: Relationship['routing'],
): 'default' | 'straight' | 'smoothstep' => {
  if (routing === 'straight') return 'straight';
  if (routing === 'orthogonal') return 'smoothstep';
  return 'default';
};

const focusLayoutSheet = (model: MindMapRenderModel): Readonly<MindMapSheet> => {
  if (!model.focusRootTopicId) return model.sheet;
  const visibleTopicIds = new Set(model.topics.map((item) => item.entityId));
  const topics = Object.fromEntries(
    Object.entries(model.sheet.topics).filter(([topicId]) => visibleTopicIds.has(topicId as TopicId)),
  ) as MindMapSheet['topics'];
  const treeEdges = Object.fromEntries(
    Object.entries(model.sheet.treeEdges).filter(([, edge]) =>
      visibleTopicIds.has(edge.parentTopicId) && visibleTopicIds.has(edge.childTopicId)),
  ) as MindMapSheet['treeEdges'];
  return { ...model.sheet, topics, treeEdges };
};

const buildCoreLayout = (
  model: MindMapRenderModel,
  imageByTopicId: Readonly<Record<TopicId, readonly ImageEnrichmentProjection[]>>,
  minimumTopicSizes: MindMapFlowProjectionOptions['minimumTopicSizes'],
): CoreLayoutResult =>
  layoutCoreMindMap({
    // A focused branch gets a compact derived layout. Hidden siblings must not
    // reserve space or influence Fit; canonical Sheet entities stay untouched.
    sheet: focusLayoutSheet(model),
    measurements: Object.values(model.sheet.topics).map((topic) => ({
      entityId: topic.id,
      ...measureMindMapTopicNodeWithMinimum(
        topic,
        imageByTopicId[topic.id] ?? [],
        minimumTopicSizes?.[topic.id],
      ),
    })),
    collapsedTopicIds: model.collapsedTopicIds,
  });

const positionsForDirection = (
  direction: CardinalLayoutDirection,
): { source: Position; target: Position } => {
  if (direction === 'right-to-left') {
    return { source: Position.Left, target: Position.Right };
  }
  if (direction === 'top-to-bottom') {
    return { source: Position.Bottom, target: Position.Top };
  }
  if (direction === 'bottom-to-top') {
    return { source: Position.Top, target: Position.Bottom };
  }
  return { source: Position.Right, target: Position.Left };
};

const connectorIndexes = (
  connectors: readonly TreeConnectorLayout[],
): {
  incoming: ReadonlyMap<TopicId, TreeConnectorLayout>;
  outgoing: ReadonlyMap<TopicId, readonly TreeConnectorLayout[]>;
} => {
  const incoming = new Map<TopicId, TreeConnectorLayout>();
  const outgoing = new Map<TopicId, TreeConnectorLayout[]>();
  for (const connector of connectors) {
    incoming.set(connector.targetTopicId, connector);
    const group = outgoing.get(connector.sourceTopicId) ?? [];
    group.push(connector);
    outgoing.set(connector.sourceTopicId, group);
  }
  return { incoming, outgoing };
};

const singleOutgoingDirection = (
  connectors: readonly TreeConnectorLayout[] | undefined,
): CardinalLayoutDirection | undefined => {
  if (!connectors || connectors.length === 0) return undefined;
  const direction = connectors[0].direction;
  return connectors.every((connector) => connector.direction === direction)
    ? direction
    : undefined;
};

const overlayItems = (model: MindMapRenderModel): SemanticOverlayListItem[] => [
  ...model.boundaries.map((item) => ({
    kind: 'boundary' as const,
    entityId: item.entityId,
    label: richTextToPlainText(item.entity.title) || '边界',
    detail: `${item.membership.topicIds.length} 个主题`,
    visibility: item.visibility,
  })),
  ...model.summaries.map((item) => ({
    kind: 'summary' as const,
    entityId: item.entityId,
    label: richTextToPlainText(model.sheet.topics[item.entity.resultTopicId]?.title) || '概要',
    detail: `${item.membership.topicIds.length} 个主题 · 结果主题`,
    visibility: item.visibility,
  })),
  ...model.callouts.map((item) => ({
    kind: 'callout' as const,
    entityId: item.entityId,
    label: richTextToPlainText(item.entity.content) || '标注',
    detail: `锚点 ${item.entity.targetTopicId}`,
    visibility: item.targetTopicVisibility,
  })),
  ...model.zones.map((item) => ({
    kind: 'zone' as const,
    entityId: item.entityId,
    label: richTextToPlainText(item.entity.title) || '区域',
    detail: `${item.entity.rootTopicIds.length} 个根主题`,
    visibility: item.visibility,
  })),
  ...model.relationships.map((item) => ({
    kind: 'relationship' as const,
    entityId: item.entityId,
    label: richTextToPlainText(item.entity.title) || '关系线',
    detail: `${item.source.targetKind}:${item.source.entityId} → ${item.target.targetKind}:${item.target.entityId}`,
    visibility: item.visibility,
  })),
];

const selectedTopicId = (selection: ElementRef | null | undefined): TopicId | undefined =>
  selection?.kind === 'topic' ? selection.id : undefined;

/**
 * Adapts a read-only canonical render model to React Flow. Core layout output
 * remains derived UI state and is never written into Topic.placement.
 */
export const buildMindMapFlowProjection = (
  document: Readonly<MindMapDocumentV1>,
  model: MindMapRenderModel,
  selection?: ElementRef | null,
  options: MindMapFlowProjectionOptions = {},
): MindMapFlowProjection => {
  const enrichments = buildTopicEnrichmentsProjection({
    document: document as MindMapDocumentV1,
    sheetId: model.sheet.id,
    ...(options.resolveEmbeddedImageUrl
      ? { resolveEmbeddedImageUrl: options.resolveEmbeddedImageUrl }
      : {}),
  });
  const imageByTopicId = Object.freeze(Object.fromEntries(
    enrichments.topicIds.map((topicId) => [
      topicId,
      enrichments.byTopicId[topicId]?.images ?? [],
    ]),
  )) as Readonly<Record<TopicId, readonly ImageEnrichmentProjection[]>>;
  const coreLayout = buildCoreLayout(model, imageByTopicId, options.minimumTopicSizes);
  const connectorById = new Map(
    coreLayout.connectors.map((connector) => [connector.entityId, connector] as const),
  );
  const connectorIndex = connectorIndexes(coreLayout.connectors);
  const defaultSettings = directionSettings(model.sheet.defaultBranchLayout.direction);
  const selectedId = selectedTopicId(selection);
  const summaryOwnerByResultTopicId = new Map<TopicId, SummaryId>(
    model.summaries.map((item) => [item.entity.resultTopicId, item.entityId]),
  );
  const derivedAutoTopicPositions: Record<string, { x: number; y: number }> = {};
  const nodes: Node<MindMapTopicNodeData>[] = model.topics.map((item) => {
    const layout = coreLayout.positions[item.entityId];
    const position = layout
      ? { x: layout.x, y: layout.y }
      : item.persistedPlacement.mode === 'absolute'
        ? { x: item.persistedPlacement.x, y: item.persistedPlacement.y }
        : { x: 0, y: 0 };
    if (item.persistedPlacement.mode === 'auto') {
      derivedAutoTopicPositions[item.entityId] = { ...position };
    }
    const incomingDirection = connectorIndex.incoming.get(item.entityId)?.direction;
    const outgoingDirection = singleOutgoingDirection(
      connectorIndex.outgoing.get(item.entityId),
    );
    const sourcePosition = outgoingDirection
      ? positionsForDirection(outgoingDirection).source
      : defaultSettings.source;
    const targetPosition = incomingDirection
      ? positionsForDirection(incomingDirection).target
      : defaultSettings.target;
    const localImages = imageByTopicId[item.entityId] ?? [];
    const size = measureMindMapTopicNodeWithMinimum(
      item.entity,
      localImages,
      options.minimumTopicSizes?.[item.entityId],
    );
    return {
      id: item.entityId,
      type: TOPIC_NODE_TYPE,
      position,
      sourcePosition,
      targetPosition,
      draggable: false,
      selectable: true,
      selected: selectedId === item.entityId,
      width: size.width,
      height: size.height,
      data: {
        kind: 'topic',
        entityId: item.entityId,
        label: richTextToPlainText(item.entity.title) || '未命名主题',
        title: item.entity.title,
        role: item.entity.role,
        ...(summaryOwnerByResultTopicId.has(item.entityId)
          ? { summaryOwnerId: summaryOwnerByResultTopicId.get(item.entityId) }
          : {}),
        depth: item.depth,
        collapsed: item.collapsed,
        childCount: Object.values(model.sheet.treeEdges)
          .filter((edge) => edge.parentTopicId === item.entityId).length,
        badges: enrichments.byTopicId[item.entityId]?.badges ?? [],
        sourcePosition,
        targetPosition,
        localImages,
        visualStyle: resolveTopicVisualStyle(document, model, item),
      },
    };
  });

  const treeEdges: Edge<MindMapTreeEdgeData>[] = model.treeEdges.map((item) => {
    const connector = connectorById.get(item.entityId);
    return {
      id: item.entityId,
      source: item.entity.parentTopicId,
      target: item.entity.childTopicId,
      type: item.entity.style?.overrides?.connector?.shape === 'straight'
        ? 'straight'
        : connector?.routing === 'orthogonal' ? 'smoothstep' : 'default',
      selectable: false,
      data: {
        kind: 'tree-edge',
        entityId: item.entityId,
        ...(connector ? { layout: connector } : {}),
      },
      style: resolveTreeEdgeVisualStyle(document, model, item.entity),
    };
  });

  const relationshipEdges: Edge<MindMapRelationshipEdgeData>[] = model.relationships
    .filter((item) =>
      item.visibility === 'visible'
      && item.source.targetKind === 'topic'
      && item.target.targetKind === 'topic')
    .map((item) => ({
      id: item.entityId,
      source: item.source.entityId,
      target: item.target.entityId,
      type: edgeTypeForRelationship(item.entity.routing),
      selectable: false,
      data: {
        kind: 'relationship',
        entityId: item.entityId,
        ...(item.entity.title
          ? { title: richTextToPlainText(item.entity.title) }
          : {}),
      },
      label: richTextToPlainText(item.entity.title) || undefined,
      style: resolveRelationshipVisualStyle(document, model, item.entity),
    }));

  const semanticGeometry = buildSemanticOverlayGeometry({ model, coreLayout });
  const structure = model.sheet.defaultBranchLayout.structure;
  const semanticStyles: Record<string, SemanticVisualStyle | ConnectorVisualStyle> = {};
  for (const item of model.boundaries) {
    semanticStyles[item.entityId] = resolveCanonicalSemanticStyle({
      document,
      themeId: model.sheet.themeId,
      scope: 'boundary',
      binding: item.entity.style,
      structure,
    }).visual;
  }
  for (const item of model.summaries) {
    semanticStyles[item.entityId] = resolveCanonicalSemanticStyle({
      document,
      themeId: model.sheet.themeId,
      scope: 'summary',
      binding: item.entity.style,
      structure,
    }).visual;
  }
  for (const item of model.callouts) {
    semanticStyles[item.entityId] = resolveCanonicalSemanticStyle({
      document,
      themeId: model.sheet.themeId,
      scope: 'callout',
      binding: item.entity.style,
      structure,
    }).visual;
  }
  for (const item of model.zones) {
    semanticStyles[item.entityId] = resolveCanonicalSemanticStyle({
      document,
      themeId: model.sheet.themeId,
      scope: 'zone',
      binding: item.entity.style,
      structure,
    }).visual;
  }
  for (const item of model.relationships) {
    semanticStyles[item.entityId] = resolveRelationshipVisualStyle(
      document,
      model,
      item.entity,
    );
  }

  return Object.freeze({
    nodes: Object.freeze(nodes),
    treeEdges: Object.freeze(treeEdges),
    relationshipEdges: Object.freeze(relationshipEdges),
    edges: Object.freeze([...treeEdges, ...relationshipEdges]),
    overlays: Object.freeze(overlayItems(model)),
    semanticGeometry,
    semanticStyles: Object.freeze(semanticStyles),
    derivedAutoTopicPositions: Object.freeze(derivedAutoTopicPositions),
    coreLayout,
  });
};
