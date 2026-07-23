import { describe, expect, it } from 'vitest';
import { Position } from 'reactflow';

import {
  createNewMindMapDocument,
  createRichText,
  createTopic,
} from '../domain/defaults';
import type {
  AssetId,
  BoundaryId,
  CalloutId,
  DocumentId,
  ImageId,
  MindMapDocumentV1,
  RelationshipId,
  SheetId,
  SummaryId,
  ThemeId,
  TopicId,
  TreeEdgeId,
  ZoneId,
} from '../domain/types';
import { projectMindMapToRenderModel } from '../render/model';
import {
  buildMindMapFlowProjection,
  TOPIC_NODE_HEIGHT,
  TOPIC_NODE_WIDTH,
  richTextToPlainText,
} from './projection';

const IDS = {
  document: 'document-ui' as DocumentId,
  sheet: 'sheet-ui' as SheetId,
  theme: 'theme-ui' as ThemeId,
  root: 'topic-root' as TopicId,
  child: 'topic-child' as TopicId,
  summaryResult: 'topic-summary-result' as TopicId,
  treeEdge: 'tree-edge-child' as TreeEdgeId,
  relationship: 'relationship-root-child' as RelationshipId,
  boundary: 'boundary-child' as BoundaryId,
  summary: 'summary-child' as SummaryId,
  callout: 'callout-child' as CalloutId,
  zone: 'zone-child' as ZoneId,
};

const makeDocument = (): MindMapDocumentV1 => {
  const document = createNewMindMapDocument({
    documentId: IDS.document,
    sheetId: IDS.sheet,
    rootTopicId: IDS.root,
    themeId: IDS.theme,
    sheetOrderKey: 'sheet-a',
    rootTitle: 'Root',
  });
  const sheet = document.sheets[IDS.sheet];
  sheet.topics[IDS.child] = createTopic({ id: IDS.child, title: 'Child' });
  sheet.topics[IDS.summaryResult] = createTopic({
    id: IDS.summaryResult,
    role: 'summary-result',
    title: 'Result',
    placement: { mode: 'absolute', x: 640, y: 80 },
  });
  sheet.treeEdges[IDS.treeEdge] = {
    id: IDS.treeEdge,
    parentTopicId: IDS.root,
    childTopicId: IDS.child,
    orderKey: 'edge-a',
    side: 'right',
    style: {
      overrides: {
        connector: {
          color: { kind: 'literal', value: '#EF4444' },
          width: 3,
        },
      },
    },
  };
  sheet.relationships[IDS.relationship] = {
    id: IDS.relationship,
    source: { element: { kind: 'topic', topicId: IDS.root }, anchor: 'auto' },
    target: { element: { kind: 'topic', topicId: IDS.child }, anchor: 'auto' },
    title: createRichText('Related'),
    routing: 'curve',
    startArrow: 'none',
    endArrow: 'triangle',
    style: {
      overrides: {
        connector: { color: { kind: 'literal', value: '#2563EB' } },
      },
    },
  };
  sheet.boundaries[IDS.boundary] = {
    id: IDS.boundary,
    scope: { kind: 'explicit', topicIds: [IDS.child] },
    title: createRichText('Boundary'),
    padding: 12,
    style: {
      overrides: {
        fill: { color: { kind: 'literal', value: '#ECFCCB' }, opacity: 0.5 },
        border: { color: { kind: 'literal', value: '#65A30D' }, width: 4 },
      },
    },
  };
  sheet.summaries[IDS.summary] = {
    id: IDS.summary,
    scope: { kind: 'explicit', topicIds: [IDS.child] },
    resultTopicId: IDS.summaryResult,
    orientation: 'right',
  };
  sheet.callouts[IDS.callout] = {
    id: IDS.callout,
    targetTopicId: IDS.child,
    content: createRichText('Callout'),
    placement: { mode: 'auto' },
    tail: 'line',
    style: {
      overrides: {
        typography: { color: { kind: 'literal', value: '#7C2D12' }, fontSize: 15 },
      },
    },
  };
  sheet.zones[IDS.zone] = {
    id: IDS.zone,
    rootTopicIds: [IDS.child],
    title: createRichText('Zone'),
    rect: { x: 0, y: 0, width: 200, height: 120 },
    autoResize: true,
    lockAspectRatio: false,
    collapsed: false,
    zOrderKey: 'zone-a',
    padding: 16,
  };
  document.themes[IDS.theme].tokens = { topicFill: '#F0F9FF' };
  document.themes[IDS.theme].defaultStyles.topic = {
    overrides: { fill: { color: { kind: 'token', token: 'topicFill' } } },
  };
  return document;
};

describe('MindMap V2 flow projection', () => {
  it('expands renderer-only minimum Topic boxes without mutating canonical sizing', () => {
    const document = makeDocument();
    const before = JSON.stringify(document);
    const model = projectMindMapToRenderModel({ document, activeSheetId: IDS.sheet });
    const flow = buildMindMapFlowProjection(document, model!, undefined, {
      minimumTopicSizes: {
        [IDS.root]: { width: 420, height: 180 },
      },
    });

    const root = flow.nodes.find((node) => node.id === IDS.root)!;
    expect({ width: root.width, height: root.height }).toEqual({ width: 420, height: 180 });
    expect(flow.coreLayout.positions[IDS.root]).toMatchObject({ width: 420, height: 180 });
    expect(JSON.stringify(document)).toBe(before);
  });

  it('uses canonical IDs, theme styles, and separate edge semantics without mutating placement', () => {
    const document = makeDocument();
    const before = JSON.stringify(document);
    const model = projectMindMapToRenderModel({
      document,
      activeSheetId: IDS.sheet,
    });
    expect(model).not.toBeNull();
    const flow = buildMindMapFlowProjection(
      document,
      model!,
      { kind: 'topic', id: IDS.child },
    );

    expect(flow.nodes.map((node) => node.id)).toEqual([
      IDS.root,
      IDS.child,
      IDS.summaryResult,
    ]);
    expect(flow.nodes.find((node) => node.id === IDS.child)?.selected).toBe(true);
    expect(flow.nodes[0].data.visualStyle.backgroundColor).toBe('#F0F9FF');
    expect(flow.nodes.every((node) => Number.isFinite(node.position.x))).toBe(true);
    expect(flow.nodes.find((node) => node.id === IDS.child)?.position).toEqual({
      x: flow.coreLayout.positions[IDS.child].x,
      y: flow.coreLayout.positions[IDS.child].y,
    });
    expect(flow.nodes.find((node) => node.id === IDS.summaryResult)?.position)
      .toEqual({
        x: flow.coreLayout.positions[IDS.summaryResult].x,
        y: flow.coreLayout.positions[IDS.summaryResult].y,
      });
    expect(flow.coreLayout.positions[IDS.summaryResult].x).toBeGreaterThan(
      flow.coreLayout.positions[IDS.child].x + flow.coreLayout.positions[IDS.child].width,
    );
    expect(flow.nodes.find((node) => node.id === IDS.summaryResult)?.data.summaryOwnerId)
      .toBe(IDS.summary);
    expect(flow.derivedAutoTopicPositions[IDS.root]).toBeDefined();
    expect(flow.derivedAutoTopicPositions[IDS.child]).toBeDefined();
    expect(flow.derivedAutoTopicPositions[IDS.summaryResult]).toBeUndefined();

    expect(flow.treeEdges).toHaveLength(1);
    expect(flow.treeEdges[0]).toMatchObject({
      id: IDS.treeEdge,
      source: IDS.root,
      target: IDS.child,
      type: 'default',
      data: {
        kind: 'tree-edge',
        entityId: IDS.treeEdge,
        layout: {
          entityId: IDS.treeEdge,
          sourceTopicId: IDS.root,
          targetTopicId: IDS.child,
          direction: 'left-to-right',
          routing: 'curve',
        },
      },
      style: { stroke: '#EF4444' },
    });
    expect(flow.relationshipEdges[0]).toMatchObject({
      id: IDS.relationship,
      data: { kind: 'relationship', entityId: IDS.relationship },
      style: { stroke: '#2563EB' },
    });
    expect(flow.overlays.map((item) => item.kind)).toEqual([
      'boundary',
      'summary',
      'callout',
      'zone',
      'relationship',
    ]);
    expect(flow.overlays.find((item) => item.kind === 'summary')).toMatchObject({
      label: 'Result',
      detail: '1 个主题 · 结果主题',
    });
    expect(flow.overlays.find((item) => item.kind === 'summary')?.detail)
      .not.toContain(IDS.summaryResult);
    expect(flow.semanticGeometry.boundaries[0]).toMatchObject({
      entityId: IDS.boundary,
      visibility: 'visible',
    });
    expect(flow.semanticGeometry.zones[0]).toMatchObject({
      entityId: IDS.zone,
      visibility: 'visible',
      rect: { x: 0, y: 0, width: 200, height: 120 },
    });
    expect(flow.semanticGeometry.summaries[0].bracket).toBeDefined();
    expect(flow.semanticGeometry.callouts[0].bubble).toBeDefined();
    expect(flow.semanticGeometry.relationships[0].path).toBeDefined();
    expect(flow.semanticStyles[IDS.boundary]).toMatchObject({
      fill: '#ECFCCB',
      fillOpacity: 0.5,
      stroke: '#65A30D',
      strokeWidth: 4,
    });
    expect(flow.semanticStyles[IDS.callout]).toMatchObject({
      color: '#7C2D12',
      fontSize: 15,
    });
    expect(flow.semanticStyles[IDS.relationship]).toMatchObject({
      stroke: '#2563EB',
    });
    expect(JSON.stringify(document)).toBe(before);
  });

  it('projects Timeline deterministically and only normalizes unsupported directions', () => {
    const document = makeDocument();
    document.sheets[IDS.sheet].defaultBranchLayout = {
      ...document.sheets[IDS.sheet].defaultBranchLayout,
      structure: 'core:timeline',
      direction: 'radial',
    };
    const model = projectMindMapToRenderModel({
      document,
      activeSheetId: IDS.sheet,
    });
    expect(model).not.toBeNull();

    const first = buildMindMapFlowProjection(document, model!);
    const second = buildMindMapFlowProjection(document, model!);

    expect(first.coreLayout.diagnostics.map((item) => item.code)).toContain(
      'unsupported-direction',
    );
    expect(first.coreLayout.diagnostics.map((item) => item.code)).not.toContain(
      'unsupported-structure',
    );
    expect(second.coreLayout.cacheKey).toBe(first.coreLayout.cacheKey);
    expect(second.coreLayout.positions).toEqual(first.coreLayout.positions);
    expect(second.coreLayout.connectors).toEqual(first.coreLayout.connectors);
    expect(first.nodes.find((node) => node.id === IDS.child)!.position.x)
      .toBeGreaterThan(first.nodes.find((node) => node.id === IDS.root)!.position.x);
  });

  it('projects Core direction and connector routing into React Flow semantics', () => {
    const document = makeDocument();
    document.sheets[IDS.sheet].defaultBranchLayout = {
      ...document.sheets[IDS.sheet].defaultBranchLayout,
      structure: 'core:org-chart',
      direction: 'top-to-bottom',
    };
    const model = projectMindMapToRenderModel({
      document,
      activeSheetId: IDS.sheet,
    });
    expect(model).not.toBeNull();
    const flow = buildMindMapFlowProjection(document, model!);
    const root = flow.nodes.find((node) => node.id === IDS.root)!;
    const child = flow.nodes.find((node) => node.id === IDS.child)!;

    expect(child.position.y).toBeGreaterThan(root.position.y);
    expect(root.data.sourcePosition).toBe(Position.Bottom);
    expect(child.data.targetPosition).toBe(Position.Top);
    expect(flow.treeEdges[0]).toMatchObject({
      type: 'smoothstep',
      data: {
        layout: {
          direction: 'top-to-bottom',
          routing: 'orthogonal',
        },
      },
    });
  });

  it('keeps Relationship outside canonical tree layout and connector traversal', () => {
    const withRelationship = makeDocument();
    const withModel = projectMindMapToRenderModel({
      document: withRelationship,
      activeSheetId: IDS.sheet,
    });
    expect(withModel).not.toBeNull();
    const first = buildMindMapFlowProjection(withRelationship, withModel!);

    const withoutRelationship = makeDocument();
    delete withoutRelationship.sheets[IDS.sheet].relationships[IDS.relationship];
    const withoutModel = projectMindMapToRenderModel({
      document: withoutRelationship,
      activeSheetId: IDS.sheet,
    });
    expect(withoutModel).not.toBeNull();
    const second = buildMindMapFlowProjection(withoutRelationship, withoutModel!);

    expect(first.coreLayout.cacheKey).toBe(second.coreLayout.cacheKey);
    expect(first.coreLayout.positions).toEqual(second.coreLayout.positions);
    expect(first.coreLayout.connectors).toEqual(second.coreLayout.connectors);
    expect(first.treeEdges).toHaveLength(1);
    expect(second.treeEdges).toHaveLength(1);
    expect(first.relationshipEdges).toHaveLength(1);
    expect(second.relationshipEdges).toHaveLength(0);
  });

  it('lays out only the focused branch and its ancestor context', () => {
    const document = makeDocument();
    const model = projectMindMapToRenderModel({
      document,
      activeSheetId: IDS.sheet,
      focusRootTopicId: IDS.child,
      collapsedTopicIds: [],
    })!;
    const flow = buildMindMapFlowProjection(document, model);

    expect(flow.nodes.map((node) => node.id)).toEqual([IDS.root, IDS.child]);
    expect(flow.coreLayout.topicOrder).toEqual([IDS.root, IDS.child]);
    expect(Object.keys(flow.coreLayout.positions)).toEqual([IDS.root, IDS.child]);
    expect(flow.coreLayout.connectors.map((edge) => edge.entityId)).toEqual([IDS.treeEdge]);
    expect(flow.coreLayout.positions).not.toHaveProperty(IDS.summaryResult);
  });

  it('converts canonical rich text to a compact node label', () => {
    expect(richTextToPlainText(createRichText('Canonical title')))
      .toBe('Canonical title');
  });

  it('derives deterministic fit and fixed topic dimensions from multiline text', () => {
    const document = makeDocument();
    const child = document.sheets[IDS.sheet].topics[IDS.child];
    child.title = createRichText('一段明显更长的中文主题标题，用来触发确定性的自动宽度\n第二行');
    const fittedModel = projectMindMapToRenderModel({
      document,
      activeSheetId: IDS.sheet,
    })!;
    const fitted = buildMindMapFlowProjection(document, fittedModel)
      .nodes.find((node) => node.id === IDS.child)!;
    expect(fitted.width).toBeGreaterThan(TOPIC_NODE_WIDTH);
    expect(fitted.width).toBeLessThanOrEqual(360);
    expect(fitted.height).toBeGreaterThan(TOPIC_NODE_HEIGHT);

    child.sizing.width = { mode: 'fixed', value: 260 };
    const fixedModel = projectMindMapToRenderModel({
      document,
      activeSheetId: IDS.sheet,
    })!;
    const fixed = buildMindMapFlowProjection(document, fixedModel)
      .nodes.find((node) => node.id === IDS.child)!;
    expect(fixed.width).toBe(260);
  });

  it('uses projected Local Image and public Sticker boxes in node/Core layout geometry', () => {
    const document = makeDocument();
    const sheet = document.sheets[IDS.sheet];
    const assetTop = 'asset-image-top' as AssetId;
    const assetBottom = 'asset-image-bottom' as AssetId;
    const imageTop = 'image-top' as ImageId;
    const imageBottom = 'image-bottom' as ImageId;
    const sticker = 'image-sticker' as ImageId;
    const deferredLeft = 'image-left' as ImageId;
    document.assets[assetTop] = {
      id: assetTop,
      fileName: 'top.png',
      mimeType: 'image/png',
      byteSize: 10,
      sha256: 'a'.repeat(64),
      source: { kind: 'remote', url: 'https://cdn.example.test/top.png' },
      intrinsicSize: { width: 10, height: 10 },
    };
    document.assets[assetBottom] = {
      id: assetBottom,
      fileName: 'bottom.png',
      mimeType: 'image/png',
      byteSize: 20,
      sha256: 'b'.repeat(64),
      source: { kind: 'remote', url: 'https://cdn.example.test/bottom.png' },
      intrinsicSize: { width: 500, height: 300 },
    };
    sheet.images[imageTop] = {
      id: imageTop,
      topicId: IDS.child,
      assetId: assetTop,
      orderKey: 'image-a',
      role: 'inline',
      placement: { side: 'top', align: 'center', offset: { x: 0, y: 0 } },
      size: { width: 250, height: 100 },
    };
    sheet.images[imageBottom] = {
      id: imageBottom,
      topicId: IDS.child,
      assetId: assetBottom,
      orderKey: 'image-b',
      role: 'thumbnail',
      placement: { side: 'bottom', align: 'center', offset: { x: 0, y: 0 } },
    };
    sheet.images[sticker] = {
      id: sticker,
      topicId: IDS.child,
      assetId: assetBottom,
      orderKey: 'image-c',
      role: 'sticker',
      placement: { side: 'top', align: 'center', offset: { x: 0, y: 0 } },
      size: { width: 90, height: 90 },
    };
    sheet.images[deferredLeft] = {
      id: deferredLeft,
      topicId: IDS.child,
      assetId: assetBottom,
      orderKey: 'image-d',
      role: 'inline',
      placement: { side: 'left', align: 'center', offset: { x: 0, y: 0 } },
      size: { width: 900, height: 900 },
    };

    const model = projectMindMapToRenderModel({
      document,
      activeSheetId: IDS.sheet,
    })!;
    const flow = buildMindMapFlowProjection(document, model);
    const node = flow.nodes.find((item) => item.id === IDS.child)!;

    expect(node.data.localImages.map((image) => image.id)).toEqual([
      imageTop,
      imageBottom,
      sticker,
      deferredLeft,
    ]);
    expect(node.width).toBe(532);
    expect(node.height).toBe(572);
    expect(flow.coreLayout.positions[IDS.child]).toMatchObject({
      width: node.width,
      height: node.height,
    });

    document.assets[assetTop].source = {
      kind: 'embedded',
      relativePath: 'resources/top.png',
    };
    let resolverCalls = 0;
    const resolvedFlow = buildMindMapFlowProjection(document, model, undefined, {
      resolveEmbeddedImageUrl: (asset) => {
        resolverCalls += 1;
        return asset.id === assetTop ? 'blob:https://nmdd.test/top' : undefined;
      },
    });
    expect(resolvedFlow.nodes.find((item) => item.id === IDS.child)?.data.localImages[0]
      .rendererSource).toEqual({
      status: 'ready',
      url: 'blob:https://nmdd.test/top',
    });
    expect(resolverCalls).toBe(1);
  });
});
