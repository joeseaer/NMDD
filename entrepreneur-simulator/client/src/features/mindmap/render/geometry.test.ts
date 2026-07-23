import { describe, expect, it } from 'vitest';

import {
  createNewMindMapDocument,
  createRichText,
  createTopic,
} from '../domain/defaults';
import type {
  BoundaryId,
  CalloutId,
  ControlPointId,
  DocumentId,
  MindMapDocumentV1,
  Rect,
  RelationshipId,
  SheetId,
  SummaryId,
  ThemeId,
  TopicId,
  TreeEdgeId,
  ZoneId,
} from '../domain/types';
import {
  CORE_LAYOUT_CAPABILITY_VERSION,
  type CoreLayoutResult,
  type TopicLayoutPosition,
} from '../layout';
import { projectMindMapToRenderModel } from './model';
import {
  buildSemanticOverlayGeometry,
  hitTestSemanticOverlayGeometry,
} from './geometry';
import { BOUNDARY_FRAME_EXTENSION_KEY } from '../domain/boundaryFrame';

const IDS = {
  document: 'geometry-document' as DocumentId,
  sheet: 'geometry-sheet' as SheetId,
  theme: 'geometry-theme' as ThemeId,
  root: 'geometry-topic-root' as TopicId,
  a: 'geometry-topic-a' as TopicId,
  b: 'geometry-topic-b' as TopicId,
  hidden: 'geometry-topic-hidden' as TopicId,
  result: 'geometry-topic-result' as TopicId,
  rootA: 'geometry-edge-root-a' as TreeEdgeId,
  rootB: 'geometry-edge-root-b' as TreeEdgeId,
  aHidden: 'geometry-edge-a-hidden' as TreeEdgeId,
  boundary: 'geometry-boundary' as BoundaryId,
  summary: 'geometry-summary' as SummaryId,
  callout: 'geometry-callout' as CalloutId,
  zone: 'geometry-zone' as ZoneId,
  manualRelationship: 'geometry-relationship-manual' as RelationshipId,
  semanticRelationship: 'geometry-relationship-semantic' as RelationshipId,
  zoneRelationship: 'geometry-relationship-zone' as RelationshipId,
  controlEarly: 'geometry-control-early' as ControlPointId,
  controlLate: 'geometry-control-late' as ControlPointId,
};

const TOPIC_RECTS: Readonly<Record<string, Readonly<Rect>>> = Object.freeze({
  [IDS.root]: { x: 0, y: 40, width: 100, height: 50 },
  [IDS.a]: { x: 200, y: 0, width: 100, height: 40 },
  [IDS.b]: { x: 200, y: 80, width: 100, height: 40 },
  [IDS.hidden]: { x: 360, y: 0, width: 90, height: 40 },
  [IDS.result]: { x: 420, y: 40, width: 100, height: 40 },
});

const makeDocument = (): MindMapDocumentV1 => {
  const document = createNewMindMapDocument({
    documentId: IDS.document,
    sheetId: IDS.sheet,
    rootTopicId: IDS.root,
    themeId: IDS.theme,
    sheetOrderKey: 'a',
    rootTitle: 'Root',
  });
  const sheet = document.sheets[IDS.sheet];
  sheet.topics[IDS.a] = createTopic({ id: IDS.a, title: 'A' });
  sheet.topics[IDS.b] = createTopic({ id: IDS.b, title: 'B' });
  sheet.topics[IDS.hidden] = createTopic({ id: IDS.hidden, title: 'Hidden' });
  sheet.topics[IDS.result] = createTopic({
    id: IDS.result,
    role: 'summary-result',
    title: 'Result',
    placement: { mode: 'absolute', x: 420, y: 40 },
  });
  sheet.treeEdges[IDS.rootA] = {
    id: IDS.rootA,
    parentTopicId: IDS.root,
    childTopicId: IDS.a,
    orderKey: 'a',
    side: 'right',
  };
  sheet.treeEdges[IDS.rootB] = {
    id: IDS.rootB,
    parentTopicId: IDS.root,
    childTopicId: IDS.b,
    orderKey: 'b',
    side: 'right',
  };
  sheet.treeEdges[IDS.aHidden] = {
    id: IDS.aHidden,
    parentTopicId: IDS.a,
    childTopicId: IDS.hidden,
    orderKey: 'a',
    side: 'inherit',
  };
  sheet.boundaries[IDS.boundary] = {
    id: IDS.boundary,
    scope: { kind: 'explicit', topicIds: [IDS.a, IDS.b] },
    title: createRichText('Scope'),
    padding: 10,
  };
  sheet.summaries[IDS.summary] = {
    id: IDS.summary,
    scope: { kind: 'explicit', topicIds: [IDS.a, IDS.b] },
    resultTopicId: IDS.result,
    orientation: 'right',
  };
  sheet.callouts[IDS.callout] = {
    id: IDS.callout,
    targetTopicId: IDS.a,
    content: createRichText('Callout'),
    placement: { mode: 'auto', preferredSide: 'top' },
    tail: 'curve',
  };
  sheet.zones[IDS.zone] = {
    id: IDS.zone,
    rootTopicIds: [IDS.a],
    rect: { x: 600, y: 0, width: 200, height: 120 },
    autoResize: false,
    lockAspectRatio: false,
    collapsed: false,
    zOrderKey: 'a',
    padding: 12,
  };
  sheet.relationships[IDS.manualRelationship] = {
    id: IDS.manualRelationship,
    source: { element: { kind: 'topic', topicId: IDS.root }, anchor: 'right' },
    target: { element: { kind: 'topic', topicId: IDS.b }, anchor: 'left' },
    routing: 'manual',
    controlPoints: {
      [IDS.controlLate]: {
        id: IDS.controlLate,
        orderKey: 'b',
        x: 180,
        y: 150,
      },
      [IDS.controlEarly]: {
        id: IDS.controlEarly,
        orderKey: 'a',
        x: 140,
        y: 150,
      },
    },
    startArrow: 'none',
    endArrow: 'triangle',
  };
  sheet.relationships[IDS.semanticRelationship] = {
    id: IDS.semanticRelationship,
    source: {
      element: { kind: 'boundary', boundaryId: IDS.boundary },
      anchor: 'auto',
    },
    target: {
      element: { kind: 'callout', calloutId: IDS.callout },
      anchor: 'auto',
    },
    routing: 'curve',
    startArrow: 'none',
    endArrow: 'none',
  };
  sheet.relationships[IDS.zoneRelationship] = {
    id: IDS.zoneRelationship,
    source: { element: { kind: 'zone', zoneId: IDS.zone }, anchor: 'left' },
    target: { element: { kind: 'topic', topicId: IDS.root }, anchor: 'right' },
    routing: 'straight',
    startArrow: 'none',
    endArrow: 'none',
  };
  return document;
};

const makeLayout = (
  topicRects: Readonly<Record<string, Readonly<Rect>>> = TOPIC_RECTS,
): CoreLayoutResult => {
  const positions: Record<string, TopicLayoutPosition> = {};
  for (const [entityId, value] of Object.entries(topicRects)) {
    positions[entityId] = {
      entityId: entityId as TopicId,
      ...value,
      placementSource: 'auto',
      derived: true,
    };
  }
  return Object.freeze({
    engineVersion: CORE_LAYOUT_CAPABILITY_VERSION,
    cacheKey: 'geometry-test-layout',
    topicOrder: Object.keys(topicRects) as TopicId[],
    positions: Object.freeze(positions),
    connectors: Object.freeze([]),
    bounds: { x: 0, y: 0, width: 520, height: 190 },
    diagnostics: Object.freeze([]),
  });
};

const geometryFor = (
  document: MindMapDocumentV1,
  collapsedTopicIds: readonly TopicId[] = [],
  layout: CoreLayoutResult = makeLayout(),
) => {
  const model = projectMindMapToRenderModel({
    document,
    activeSheetId: IDS.sheet,
    collapsedTopicIds,
  });
  if (!model) throw new Error('Expected a render model.');
  return buildSemanticOverlayGeometry({
    model,
    coreLayout: layout,
    measurements: { callouts: { [IDS.callout]: { width: 160, height: 60 } } },
  });
};

describe('renderer-neutral semantic geometry', () => {
  it('derives boundary, summary, callout and cross-semantic relationship geometry', () => {
    const document = makeDocument();
    const before = JSON.stringify(document);
    const geometry = geometryFor(document);

    expect(geometry.zones[0]).toMatchObject({
      entityId: IDS.zone,
      visibility: 'visible',
      rect: { x: 600, y: 0, width: 200, height: 120 },
      visibleRootTopicIds: [IDS.a],
      hiddenRootTopicIds: [],
    });

    expect(geometry.boundaries[0]).toMatchObject({
      entityId: IDS.boundary,
      visibility: 'visible',
      memberTopicIds: [IDS.a, IDS.b],
      hiddenTopicIds: [],
      unresolvedTopicIds: [],
      frame: { x: 190, y: -10, width: 120, height: 140 },
    });
    expect(geometry.boundaries[0].outline?.commands.map((command) => command.kind))
      .toEqual(['move', 'line', 'line', 'line', 'close']);

    expect(geometry.summaries[0]).toMatchObject({
      entityId: IDS.summary,
      visibility: 'visible',
      orientation: 'right',
      scopeBounds: { x: 196, y: -4, width: 108, height: 128 },
      resultAnchor: { x: 420, y: 60 },
    });
    expect(geometry.summaries[0].bracket?.commands).toMatchObject([
      { kind: 'move', to: { x: 308, y: -4 } },
      { kind: 'line', to: { x: 320, y: -4 } },
      { kind: 'line', to: { x: 320, y: 124 } },
      { kind: 'line', to: { x: 308, y: 124 } },
    ]);

    expect(geometry.callouts[0]).toMatchObject({
      entityId: IDS.callout,
      visibility: 'visible',
      placementSide: 'top',
      targetAnchor: { x: 250, y: 0 },
      bubbleAnchor: { x: 250, y: -36 },
      bubble: { x: 170, y: -96, width: 160, height: 60 },
    });
    expect(geometry.callouts[0].tail?.commands.map((command) => command.kind))
      .toEqual(['move', 'cubic']);

    const semanticRelationship = geometry.relationships.find(
      (item) => item.entityId === IDS.semanticRelationship,
    );
    expect(semanticRelationship).toMatchObject({
      visibility: 'visible',
      source: {
        targetKind: 'boundary',
        bounds: { x: 190, y: -10, width: 120, height: 140 },
      },
      target: {
        targetKind: 'callout',
        bounds: { x: 170, y: -96, width: 160, height: 60 },
      },
    });
    expect(semanticRelationship?.path).toBeDefined();
    expect(geometry.relationships.find((item) => item.entityId === IDS.zoneRelationship))
      .toMatchObject({
        visibility: 'visible',
        source: {
          targetKind: 'zone',
          bounds: { x: 600, y: 0, width: 200, height: 120 },
          point: { x: 600, y: 60 },
        },
      });
    expect(JSON.stringify(document)).toBe(before);
  });

  it('sorts control points, resolves fixed anchors, emits every routing family, and hit-tests paths', () => {
    const expectedCommands = {
      straight: ['move', 'line'],
      curve: ['move', 'cubic', 'cubic', 'cubic'],
      orthogonal: ['move', 'line', 'line', 'line', 'line', 'line'],
      manual: ['move', 'line', 'line', 'line'],
    } as const;

    for (const routing of ['straight', 'curve', 'orthogonal', 'manual'] as const) {
      const document = makeDocument();
      const relationship = document.sheets[IDS.sheet].relationships[IDS.manualRelationship];
      relationship.routing = routing;
      const geometry = geometryFor(document);
      const projected = geometry.relationships.find(
        (item) => item.entityId === IDS.manualRelationship,
      );
      expect(projected?.controlPoints.map((control) => control.id)).toEqual([
        IDS.controlEarly,
        IDS.controlLate,
      ]);
      expect(projected?.source.point).toEqual({ x: 100, y: 65 });
      expect(projected?.target.point).toEqual({ x: 200, y: 100 });
      expect(projected?.path?.commands.map((command) => command.kind))
        .toEqual(expectedCommands[routing]);
    }

    const ratioDocument = makeDocument();
    const ratioRelationship = ratioDocument.sheets[IDS.sheet]
      .relationships[IDS.manualRelationship];
    ratioRelationship.routing = 'straight';
    ratioRelationship.source.anchor = { xRatio: 2, yRatio: -1 };
    ratioRelationship.target.anchor = 'bottom';
    const ratioGeometry = geometryFor(ratioDocument);
    const projected = ratioGeometry.relationships.find(
      (item) => item.entityId === IDS.manualRelationship,
    );
    expect(projected?.source.point).toEqual({ x: 100, y: 40 });
    expect(projected?.target.point).toEqual({ x: 250, y: 120 });

    const document = makeDocument();
    delete document.sheets[IDS.sheet].relationships[IDS.semanticRelationship];
    delete document.sheets[IDS.sheet].relationships[IDS.zoneRelationship];
    const hitGeometry = geometryFor(document);
    expect(hitTestSemanticOverlayGeometry(hitGeometry, { x: 140, y: 150 }))
      .toEqual({ kind: 'relationship', id: IDS.manualRelationship });
    expect(hitTestSemanticOverlayGeometry(hitGeometry, { x: 250, y: -66 }))
      .toEqual({ kind: 'callout', id: IDS.callout });
    expect(hitTestSemanticOverlayGeometry(hitGeometry, { x: 190, y: 60 }))
      .toEqual({ kind: 'boundary', id: IDS.boundary });
    expect(hitTestSemanticOverlayGeometry(hitGeometry, { x: 700, y: 90 }))
      .toEqual({ kind: 'zone', id: IDS.zone });
    expect(hitTestSemanticOverlayGeometry(hitGeometry, { x: 250, y: 20 })).toBeNull();
  });

  it('uses only visible scope members and suppresses hidden endpoints after collapse', () => {
    const document = makeDocument();
    const sheet = document.sheets[IDS.sheet];
    sheet.boundaries[IDS.boundary].scope = {
      kind: 'subtree',
      rootTopicId: IDS.a,
      depth: 'all',
    };
    sheet.summaries[IDS.summary].scope = {
      kind: 'subtree',
      rootTopicId: IDS.a,
      depth: 'all',
    };
    sheet.callouts[IDS.callout].targetTopicId = IDS.hidden;
    sheet.relationships[IDS.manualRelationship].target = {
      element: { kind: 'topic', topicId: IDS.hidden },
      anchor: 'auto',
    };
    const visibleRects = {
      [IDS.root]: TOPIC_RECTS[IDS.root],
      [IDS.a]: TOPIC_RECTS[IDS.a],
      [IDS.b]: TOPIC_RECTS[IDS.b],
      [IDS.result]: TOPIC_RECTS[IDS.result],
    };

    const first = geometryFor(document, [IDS.a], makeLayout(visibleRects));
    const second = geometryFor(document, [IDS.a], makeLayout(visibleRects));

    expect(first.boundaries[0]).toMatchObject({
      visibility: 'visible',
      memberTopicIds: [IDS.a],
      hiddenTopicIds: [IDS.hidden],
      frame: { x: 190, y: -10, width: 120, height: 60 },
    });
    expect(first.summaries[0]).toMatchObject({
      visibility: 'visible',
      memberTopicIds: [IDS.a],
      hiddenTopicIds: [IDS.hidden],
    });
    expect(first.callouts[0]).toMatchObject({
      visibility: 'hidden',
      suppressionReason: 'hidden-endpoint',
      targetTopicId: IDS.hidden,
    });
    expect(first.callouts[0].tail).toBeUndefined();
    expect(first.relationships.find((item) => item.entityId === IDS.manualRelationship))
      .toMatchObject({ visibility: 'hidden', suppressionReason: 'hidden-endpoint' });
    expect(first.relationships.find((item) => item.entityId === IDS.manualRelationship)?.path)
      .toBeUndefined();
    expect(second).toEqual(first);

    const fullyHiddenDocument = makeDocument();
    fullyHiddenDocument.sheets[IDS.sheet].boundaries[IDS.boundary].scope = {
      kind: 'explicit',
      topicIds: [IDS.hidden],
    };
    const fullyHidden = geometryFor(
      fullyHiddenDocument,
      [IDS.a],
      makeLayout(visibleRects),
    );
    expect(fullyHidden.boundaries[0]).toMatchObject({
      visibility: 'hidden',
      suppressionReason: 'no-visible-members',
      memberTopicIds: [],
      hiddenTopicIds: [IDS.hidden],
      hitRegions: [],
    });
  });

  it('renders partial scopes deterministically but suppresses relationships with missing layout', () => {
    const document = makeDocument();
    const partialLayout = makeLayout({
      [IDS.root]: TOPIC_RECTS[IDS.root],
      [IDS.a]: TOPIC_RECTS[IDS.a],
      [IDS.result]: TOPIC_RECTS[IDS.result],
    });
    const geometry = geometryFor(document, [], partialLayout);

    expect(geometry.boundaries[0]).toMatchObject({
      visibility: 'visible',
      memberTopicIds: [IDS.a],
      unresolvedTopicIds: [IDS.b],
      frame: { x: 190, y: -10, width: 120, height: 60 },
    });
    expect(geometry.summaries[0]).toMatchObject({
      visibility: 'visible',
      memberTopicIds: [IDS.a],
      unresolvedTopicIds: [IDS.b],
    });
    expect(geometry.relationships.find((item) => item.entityId === IDS.manualRelationship))
      .toMatchObject({ visibility: 'hidden', suppressionReason: 'missing-layout' });
  });

  it('reflows scoped overlays with topic rectangles and preserves offset callout placement', () => {
    const document = makeDocument();
    const sheet = document.sheets[IDS.sheet];
    sheet.summaries[IDS.summary].orientation = 'auto';
    sheet.callouts[IDS.callout].placement = { mode: 'offset', dx: 50, dy: 30 };

    const initial = geometryFor(document);
    expect(initial.summaries[0].orientation).toBe('right');
    expect(initial.callouts[0]).toMatchObject({
      placementSide: 'offset',
      bubble: { x: 220, y: 20, width: 160, height: 60 },
    });

    const shiftedRects = {
      ...TOPIC_RECTS,
      [IDS.a]: { x: 250, y: 30, width: 100, height: 40 },
      [IDS.b]: { x: 250, y: 110, width: 100, height: 40 },
    };
    const shifted = geometryFor(document, [], makeLayout(shiftedRects));
    expect(shifted.boundaries[0].frame).toEqual({
      x: 240,
      y: 20,
      width: 120,
      height: 140,
    });
    expect(shifted.callouts[0].bubble).toEqual({
      x: 270,
      y: 50,
      width: 160,
      height: 60,
    });

    const tailCommands = {
      line: ['move', 'line'],
      triangle: ['move', 'line', 'line', 'close'],
      curve: ['move', 'cubic'],
    } as const;
    for (const tail of ['line', 'triangle', 'curve'] as const) {
      const tailDocument = makeDocument();
      tailDocument.sheets[IDS.sheet].callouts[IDS.callout].tail = tail;
      expect(geometryFor(tailDocument).callouts[0].tail?.commands.map((command) => command.kind))
        .toEqual(tailCommands[tail]);
    }
  });

  it('applies asymmetric manual Boundary outsets and keeps them attached after relayout', () => {
    const document = makeDocument();
    document.sheets[IDS.sheet].boundaries[IDS.boundary].extensions = {
      [BOUNDARY_FRAME_EXTENSION_KEY]: {
        version: 1,
        outsets: { top: 5, right: 30, bottom: 25, left: 20 },
      },
    };
    expect(geometryFor(document).boundaries[0]).toMatchObject({
      memberBounds: { x: 200, y: 0, width: 100, height: 120 },
      frame: { x: 180, y: -5, width: 150, height: 150 },
    });

    const shifted = geometryFor(document, [], makeLayout({
      ...TOPIC_RECTS,
      [IDS.a]: { x: 250, y: 30, width: 100, height: 40 },
      [IDS.b]: { x: 250, y: 110, width: 100, height: 40 },
    }));
    expect(shifted.boundaries[0]).toMatchObject({
      memberBounds: { x: 250, y: 30, width: 100, height: 120 },
      frame: { x: 230, y: 25, width: 150, height: 150 },
    });
  });
});
