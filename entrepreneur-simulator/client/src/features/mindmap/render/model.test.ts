import { describe, expect, it } from 'vitest';

import {
  createNewMindMapDocument,
  createRichText,
  createTopic,
} from '../domain/defaults';
import type {
  BoundaryId,
  CalloutId,
  DocumentId,
  MindMapDocumentV1,
  RelationshipId,
  SheetId,
  SummaryId,
  ThemeId,
  TopicId,
  TopicScope,
  TreeEdgeId,
  ZoneId,
} from '../domain/types';
import {
  expandTopicScope,
  projectMindMapToRenderModel,
} from './model';

const documentId = (value: string) => value as DocumentId;
const sheetId = (value: string) => value as SheetId;
const themeId = (value: string) => value as ThemeId;
const topicId = (value: string) => value as TopicId;
const edgeId = (value: string) => value as TreeEdgeId;
const relationshipId = (value: string) => value as RelationshipId;
const boundaryId = (value: string) => value as BoundaryId;
const summaryId = (value: string) => value as SummaryId;
const calloutId = (value: string) => value as CalloutId;
const zoneId = (value: string) => value as ZoneId;

const IDS = {
  document: documentId('document'),
  sheet: sheetId('sheet-main'),
  missingSheet: sheetId('sheet-missing'),
  theme: themeId('theme'),
  root: topicId('topic-root'),
  a: topicId('topic-a'),
  a1: topicId('topic-a1'),
  b: topicId('topic-b'),
  floating: topicId('topic-floating'),
  summaryResult: topicId('topic-summary-result'),
  rootA: edgeId('edge-root-a'),
  rootB: edgeId('edge-root-b'),
  aA1: edgeId('edge-a-a1'),
  relHidden: relationshipId('relationship-a1-floating'),
  relVisible: relationshipId('relationship-root-floating'),
  relBoundary: relationshipId('relationship-boundary-root'),
  relZone: relationshipId('relationship-zone-callout'),
  boundaryA: boundaryId('boundary-a'),
  boundaryExplicit: boundaryId('boundary-explicit'),
  summary: summaryId('summary-ab'),
  callout: calloutId('callout-a1'),
  zone: zoneId('zone-a-floating'),
} as const;

const subtreeA: TopicScope = {
  kind: 'subtree',
  rootTopicId: IDS.a,
  depth: 'all',
};

const siblingRangeAB: TopicScope = {
  kind: 'sibling-range',
  parentTopicId: IDS.root,
  firstEdgeId: IDS.rootA,
  lastEdgeId: IDS.rootB,
  includeDescendants: false,
};

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
  sheet.topics = {
    // Deliberately not visual order: projection must use TreeEdge and root semantics.
    [IDS.summaryResult]: createTopic({
      id: IDS.summaryResult,
      role: 'summary-result',
      title: 'Summary result',
      placement: { mode: 'offset', dx: 30, dy: 10 },
    }),
    [IDS.b]: createTopic({ id: IDS.b, title: 'B' }),
    [IDS.floating]: createTopic({
      id: IDS.floating,
      role: 'floating-root',
      title: 'Floating',
      placement: { mode: 'absolute', x: 900, y: 200 },
    }),
    [IDS.a1]: createTopic({
      id: IDS.a1,
      title: 'A1',
      placement: { mode: 'offset', dx: 12, dy: -4 },
    }),
    [IDS.root]: createTopic({
      id: IDS.root,
      role: 'central',
      title: 'Root',
      placement: { mode: 'absolute', x: 100, y: 100 },
    }),
    [IDS.a]: createTopic({ id: IDS.a, title: 'A' }),
  };
  sheet.treeEdges = {
    [IDS.rootB]: {
      id: IDS.rootB,
      parentTopicId: IDS.root,
      childTopicId: IDS.b,
      orderKey: 'b',
      side: 'right',
    },
    [IDS.aA1]: {
      id: IDS.aA1,
      parentTopicId: IDS.a,
      childTopicId: IDS.a1,
      orderKey: 'a',
      side: 'inherit',
    },
    [IDS.rootA]: {
      id: IDS.rootA,
      parentTopicId: IDS.root,
      childTopicId: IDS.a,
      orderKey: 'a',
      side: 'right',
    },
  };
  sheet.boundaries = {
    [IDS.boundaryExplicit]: {
      id: IDS.boundaryExplicit,
      padding: 8,
      scope: { kind: 'explicit', topicIds: [IDS.floating, IDS.b, IDS.a1, IDS.b] },
    },
    [IDS.boundaryA]: {
      id: IDS.boundaryA,
      padding: 12,
      scope: subtreeA,
    },
  };
  sheet.summaries = {
    [IDS.summary]: {
      id: IDS.summary,
      scope: siblingRangeAB,
      resultTopicId: IDS.summaryResult,
      orientation: 'right',
    },
  };
  sheet.callouts = {
    [IDS.callout]: {
      id: IDS.callout,
      targetTopicId: IDS.a1,
      content: createRichText('Callout'),
      placement: { mode: 'auto' },
      tail: 'curve',
    },
  };
  sheet.zones = {
    [IDS.zone]: {
      id: IDS.zone,
      rootTopicIds: [IDS.a, IDS.floating],
      rect: { x: 0, y: 0, width: 500, height: 300 },
      autoResize: true,
      lockAspectRatio: false,
      collapsed: false,
      zOrderKey: 'a',
      padding: 16,
    },
  };
  sheet.relationships = {
    [IDS.relZone]: {
      id: IDS.relZone,
      source: { element: { kind: 'zone', zoneId: IDS.zone }, anchor: 'auto' },
      target: { element: { kind: 'callout', calloutId: IDS.callout }, anchor: 'auto' },
      routing: 'curve',
      startArrow: 'none',
      endArrow: 'none',
    },
    [IDS.relVisible]: {
      id: IDS.relVisible,
      source: { element: { kind: 'topic', topicId: IDS.root }, anchor: 'auto' },
      target: { element: { kind: 'topic', topicId: IDS.floating }, anchor: 'auto' },
      routing: 'straight',
      startArrow: 'none',
      endArrow: 'triangle',
    },
    [IDS.relBoundary]: {
      id: IDS.relBoundary,
      source: {
        element: { kind: 'boundary', boundaryId: IDS.boundaryA },
        anchor: 'auto',
      },
      target: { element: { kind: 'topic', topicId: IDS.root }, anchor: 'auto' },
      routing: 'curve',
      startArrow: 'none',
      endArrow: 'none',
    },
    [IDS.relHidden]: {
      id: IDS.relHidden,
      source: { element: { kind: 'topic', topicId: IDS.a1 }, anchor: 'auto' },
      target: { element: { kind: 'topic', topicId: IDS.floating }, anchor: 'auto' },
      routing: 'curve',
      startArrow: 'none',
      endArrow: 'none',
    },
  };
  return document;
};

describe('semantic scope expansion', () => {
  it('expands subtree depth, sibling ranges, descendants, and explicit scope stably', () => {
    const sheet = makeDocument().sheets[IDS.sheet];

    expect(expandTopicScope(sheet, subtreeA)).toEqual([IDS.a, IDS.a1]);
    expect(expandTopicScope(sheet, {
      kind: 'subtree',
      rootTopicId: IDS.a,
      depth: 0,
    })).toEqual([IDS.a]);
    expect(expandTopicScope(sheet, siblingRangeAB)).toEqual([IDS.a, IDS.b]);
    expect(expandTopicScope(sheet, {
      ...siblingRangeAB,
      includeDescendants: true,
    })).toEqual([IDS.a, IDS.a1, IDS.b]);
    expect(expandTopicScope(sheet, {
      kind: 'explicit',
      topicIds: [IDS.floating, IDS.b, IDS.a1, IDS.b],
    })).toEqual([IDS.a1, IDS.b, IDS.floating]);
  });
});

describe('canonical render projection', () => {
  it('builds a stable visible forest and treats collapsed Topics structurally', () => {
    const document = makeDocument();
    const model = projectMindMapToRenderModel({
      document,
      activeSheetId: IDS.sheet,
      collapsedTopicIds: [IDS.a],
      derivedAutoTopicPositions: {
        [IDS.a]: { x: 320, y: 80 },
      },
    })!;

    expect(model.visibleTopicForest.rootTopicIds).toEqual([
      IDS.root,
      IDS.floating,
      IDS.summaryResult,
    ]);
    expect(model.topics.map((item) => item.entityId)).toEqual([
      IDS.root,
      IDS.a,
      IDS.b,
      IDS.floating,
      IDS.summaryResult,
    ]);
    expect(model.hiddenTopicIds).toEqual([IDS.a1]);
    expect(model.treeEdges.map((item) => item.entityId)).toEqual([
      IDS.rootA,
      IDS.rootB,
    ]);
    expect(model.visibleTopicForest.childrenByTopicId[IDS.root]).toEqual([IDS.a, IDS.b]);
    expect(model.visibleTopicForest.childrenByTopicId[IDS.a]).toEqual([]);

    const root = model.topics.find((item) => item.entityId === IDS.root)!;
    const a = model.topics.find((item) => item.entityId === IDS.a)!;
    const b = model.topics.find((item) => item.entityId === IDS.b)!;
    expect(root.persistedPlacement).toEqual({ mode: 'absolute', x: 100, y: 100 });
    expect(root.autoPlacement).toEqual({ status: 'not-applicable' });
    expect(a.persistedPlacement).toEqual({ mode: 'auto' });
    expect(a.autoPlacement).toEqual({ status: 'resolved', position: { x: 320, y: 80 } });
    expect(b.autoPlacement).toEqual({ status: 'pending' });
  });

  it('keeps floating and summary-result roots independent from Relationship topology', () => {
    const model = projectMindMapToRenderModel({
      document: makeDocument(),
      activeSheetId: IDS.sheet,
      collapsedTopicIds: [],
    })!;

    expect(model.visibleTopicForest.rootTopicIds).toEqual([
      IDS.root,
      IDS.floating,
      IDS.summaryResult,
    ]);
    expect(model.visibleTopicForest.parentByTopicId[IDS.floating]).toBeNull();
    expect(model.treeEdges.map((item) => item.entityId)).not.toContain(IDS.relVisible);
    expect(model.topics.map((item) => item.entityId)).toEqual([
      IDS.root,
      IDS.a,
      IDS.a1,
      IDS.b,
      IDS.floating,
      IDS.summaryResult,
    ]);
    expect(model.relationships.map((item) => item.entityId)).toEqual([
      IDS.relHidden,
      IDS.relBoundary,
      IDS.relVisible,
      IDS.relZone,
    ]);
  });

  it('projects every semantic collection and reports endpoint visibility', () => {
    const model = projectMindMapToRenderModel({
      document: makeDocument(),
      activeSheetId: IDS.sheet,
      collapsedTopicIds: [IDS.a],
    })!;

    expect(model.boundaries.map((item) => item.entityId)).toEqual([
      IDS.boundaryA,
      IDS.boundaryExplicit,
    ]);
    expect(model.boundaries[0]).toMatchObject({
      kind: 'boundary',
      entityId: IDS.boundaryA,
      visibility: 'visible',
      membership: {
        topicIds: [IDS.a, IDS.a1],
        visibleTopicIds: [IDS.a],
        hiddenTopicIds: [IDS.a1],
      },
    });
    expect(model.summaries[0]).toMatchObject({
      kind: 'summary',
      entityId: IDS.summary,
      resultTopicVisibility: 'visible',
      visibility: 'visible',
    });
    expect(model.callouts[0]).toMatchObject({
      kind: 'callout',
      entityId: IDS.callout,
      targetTopicVisibility: 'hidden',
      visibility: 'hidden',
    });
    expect(model.zones[0]).toMatchObject({
      kind: 'zone',
      entityId: IDS.zone,
      visibleRootTopicIds: [IDS.a, IDS.floating],
      visibility: 'visible',
    });

    const hiddenRelationship = model.relationships.find(
      (item) => item.entityId === IDS.relHidden,
    )!;
    expect(hiddenRelationship).toMatchObject({
      visibility: 'hidden',
      source: {
        targetKind: 'topic',
        entityId: IDS.a1,
        visibility: 'hidden',
      },
      target: {
        targetKind: 'topic',
        entityId: IDS.floating,
        visibility: 'visible',
      },
    });
    expect(model.relationships.find((item) => item.entityId === IDS.relVisible))
      .toMatchObject({ visibility: 'visible' });

    const collections = [
      model.topics,
      model.treeEdges,
      model.relationships,
      model.boundaries,
      model.summaries,
      model.callouts,
      model.zones,
    ];
    expect(collections.every((items) => items.every((item) => Boolean(item.entityId))))
      .toBe(true);
  });

  it('focuses a branch with ancestor context without leaking siblings or Relationship-connected Topics', () => {
    const model = projectMindMapToRenderModel({
      document: makeDocument(),
      activeSheetId: IDS.sheet,
      focusRootTopicId: IDS.a,
      collapsedTopicIds: [],
    })!;

    expect(model.focusRootTopicId).toBe(IDS.a);
    expect(model.visibleTopicForest.rootTopicIds).toEqual([IDS.root]);
    expect(model.topics.map((item) => item.entityId)).toEqual([IDS.root, IDS.a, IDS.a1]);
    expect(model.treeEdges.map((item) => item.entityId)).toEqual([IDS.rootA, IDS.aA1]);
    expect(model.hiddenTopicIds).toEqual([
      IDS.b,
      IDS.floating,
      IDS.summaryResult,
    ]);
    expect(model.callouts[0].visibility).toBe('visible');
    expect(model.summaries[0].visibility).toBe('hidden');
    expect(model.relationships.find((item) => item.entityId === IDS.relHidden))
      .toMatchObject({
        visibility: 'hidden',
        source: { visibility: 'visible' },
        target: { visibility: 'hidden' },
      });
  });

  it('forces collapsed ancestors open while preserving collapse inside the focused branch', () => {
    const model = projectMindMapToRenderModel({
      document: makeDocument(),
      activeSheetId: IDS.sheet,
      focusRootTopicId: IDS.a,
      collapsedTopicIds: [IDS.root, IDS.a],
    })!;

    expect(model.topics.map((item) => item.entityId)).toEqual([IDS.root, IDS.a]);
    expect(model.topics.find((item) => item.entityId === IDS.root)?.collapsed).toBe(false);
    expect(model.topics.find((item) => item.entityId === IDS.a)?.collapsed).toBe(true);
    expect(model.collapsedTopicIds).toEqual([IDS.a]);
  });

  it('does not mutate canonical or derived inputs and fails closed for a missing sheet', () => {
    const document = makeDocument();
    const derived = { [IDS.a]: { x: 50, y: 75 } };
    const documentBefore = JSON.stringify(document);
    const derivedBefore = JSON.stringify(derived);
    const model = projectMindMapToRenderModel({
      document,
      activeSheetId: IDS.sheet,
      collapsedTopicIds: [],
      derivedAutoTopicPositions: derived,
    });

    expect(JSON.stringify(document)).toBe(documentBefore);
    expect(JSON.stringify(derived)).toBe(derivedBefore);
    expect(Object.isFrozen(model)).toBe(true);
    expect(Object.isFrozen(model?.topics)).toBe(true);
    expect(projectMindMapToRenderModel({
      document,
      activeSheetId: IDS.missingSheet,
    })).toBeNull();
  });
});
