import { describe, expect, it } from 'vitest';

import {
  createNewMindMapDocument,
  createTopic,
} from '../domain/defaults';
import type {
  DocumentId,
  MindMapDocumentV1,
  MindMapSheet,
  RelationshipId,
  ResolvedLayoutDirection,
  SheetId,
  SummaryId,
  ThemeId,
  TopicId,
  TreeEdgeId,
} from '../domain/types';
import {
  layoutCoreMindMap,
  type CoreLayoutResult,
  type TopicMeasurementInput,
} from './engine';
import {
  CORE_LAYOUT_CAPABILITIES,
  CORE_LAYOUT_CAPABILITY_VERSION,
  SUPPORTED_CORE_LAYOUT_STRUCTURES,
} from './registry';

const documentId = (value: string) => value as DocumentId;
const sheetId = (value: string) => value as SheetId;
const themeId = (value: string) => value as ThemeId;
const topicId = (value: string) => value as TopicId;
const edgeId = (value: string) => value as TreeEdgeId;
const relationshipId = (value: string) => value as RelationshipId;
const summaryId = (value: string) => value as SummaryId;

const IDS = {
  document: documentId('document'),
  sheet: sheetId('sheet'),
  theme: themeId('theme'),
  root: topicId('root'),
} as const;

const createDocument = (
  direction: ResolvedLayoutDirection = 'left-to-right',
  structure: MindMapSheet['defaultBranchLayout']['structure'] = 'core:logic-chart',
): MindMapDocumentV1 => {
  const document = createNewMindMapDocument({
    documentId: IDS.document,
    sheetId: IDS.sheet,
    rootTopicId: IDS.root,
    themeId: IDS.theme,
    sheetOrderKey: 'a',
  });
  document.sheets[IDS.sheet].defaultBranchLayout = {
    structure,
    direction,
    mode: 'auto',
  };
  return document;
};

const addTopic = (
  sheet: MindMapSheet,
  input: {
    id: TopicId;
    parentId?: TopicId;
    edgeId?: TreeEdgeId;
    orderKey?: string;
    side?: 'left' | 'right' | 'top' | 'bottom' | 'center' | 'inherit';
    placement?: Parameters<typeof createTopic>[0]['placement'];
    role?: Parameters<typeof createTopic>[0]['role'];
    branchLayout?: Parameters<typeof createTopic>[0] extends infer _T
      ? MindMapSheet['topics'][TopicId]['branchLayout']
      : never;
  },
): void => {
  const topic = createTopic({
    id: input.id,
    role: input.role,
    placement: input.placement,
  });
  if (input.branchLayout) topic.branchLayout = { ...input.branchLayout };
  sheet.topics[input.id] = topic;
  if (input.parentId && input.edgeId) {
    sheet.treeEdges[input.edgeId] = {
      id: input.edgeId,
      parentTopicId: input.parentId,
      childTopicId: input.id,
      orderKey: input.orderKey ?? 'a',
      side: input.side ?? 'inherit',
    };
  }
};

const measurementsFor = (
  sheet: MindMapSheet,
  width = 100,
  height = 40,
): TopicMeasurementInput[] => Object.values(sheet.topics).map((topic) => ({
  entityId: topic.id,
  width,
  height,
}));

const rectanglesOverlap = (
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
): boolean => left.x < right.x + right.width
  && left.x + left.width > right.x
  && left.y < right.y + right.height
  && left.y + left.height > right.y;

const expectNoOverlap = (result: CoreLayoutResult): void => {
  const positions = Object.values(result.positions);
  for (let left = 0; left < positions.length; left += 1) {
    for (let right = left + 1; right < positions.length; right += 1) {
      expect(
        rectanglesOverlap(positions[left], positions[right]),
        `${positions[left].entityId} overlaps ${positions[right].entityId}`,
      ).toBe(false);
    }
  }
};

describe('Core layout capability registry', () => {
  it('publishes all XMind structure families plus the Grid built-in style', () => {
    expect(CORE_LAYOUT_CAPABILITY_VERSION).toBe('xmind-layout@2026-07-19');
    expect(SUPPORTED_CORE_LAYOUT_STRUCTURES).toEqual([
      'core:mind-map',
      'core:logic-chart',
      'core:org-chart',
      'core:tree-chart',
      'core:timeline',
      'core:fishbone',
      'core:matrix',
      'core:brace-map',
      'core:tree-table',
      'core:grid',
    ]);
    expect(CORE_LAYOUT_CAPABILITIES['core:mind-map'].allowedDirections)
      .toEqual(expect.arrayContaining([
        'both',
        'left-to-right',
        'right-to-left',
        'top-to-bottom',
        'bottom-to-top',
      ]));
    expect(Object.isFrozen(CORE_LAYOUT_CAPABILITIES)).toBe(true);
    expect(CORE_LAYOUT_CAPABILITIES['core:timeline'].variantIds).toEqual([
      'horizontal',
      'vertical',
      'horizontal-off-axis',
    ]);
    expect(CORE_LAYOUT_CAPABILITIES['core:matrix'].optionKeys).toContain('rowHeight');
  });
});

describe('deterministic Core layout engine', () => {
  it('balances bidirectional Mind Map children while honoring explicit side first', () => {
    const document = createDocument('both', 'core:mind-map');
    const sheet = document.sheets[IDS.sheet];
    const explicitLeft = topicId('explicit-left');
    const explicitRight = topicId('explicit-right');
    const automaticA = topicId('automatic-a');
    const automaticB = topicId('automatic-b');
    addTopic(sheet, {
      id: automaticB,
      parentId: IDS.root,
      edgeId: edgeId('edge-d'),
      orderKey: 'd',
    });
    addTopic(sheet, {
      id: explicitRight,
      parentId: IDS.root,
      edgeId: edgeId('edge-b'),
      orderKey: 'b',
      side: 'right',
    });
    addTopic(sheet, {
      id: automaticA,
      parentId: IDS.root,
      edgeId: edgeId('edge-c'),
      orderKey: 'c',
    });
    addTopic(sheet, {
      id: explicitLeft,
      parentId: IDS.root,
      edgeId: edgeId('edge-a'),
      orderKey: 'a',
      side: 'left',
    });

    const result = layoutCoreMindMap({
      sheet,
      measurements: measurementsFor(sheet),
    });
    const root = result.positions[IDS.root];
    const leftIds = Object.values(result.positions)
      .filter((position) => position.entityId !== IDS.root && position.x < root.x)
      .map((position) => position.entityId);
    const rightIds = Object.values(result.positions)
      .filter((position) => position.entityId !== IDS.root && position.x > root.x)
      .map((position) => position.entityId);

    expect(leftIds).toContain(explicitLeft);
    expect(rightIds).toContain(explicitRight);
    expect(leftIds).toHaveLength(2);
    expect(rightIds).toHaveLength(2);
    expect(result.connectors.find((item) => item.targetTopicId === explicitLeft)?.direction)
      .toBe('right-to-left');
    expect(result.connectors.find((item) => item.targetTopicId === explicitRight)?.direction)
      .toBe('left-to-right');
    expectNoOverlap(result);
  });

  it.each([
    ['left-to-right', 'x', 1],
    ['right-to-left', 'x', -1],
    ['top-to-bottom', 'y', 1],
    ['bottom-to-top', 'y', -1],
  ] as const)(
    'supports one-way Mind Map direction %s',
    (direction, axis, sign) => {
      const document = createDocument(direction, 'core:mind-map');
      const sheet = document.sheets[IDS.sheet];
      const child = topicId('child');
      addTopic(sheet, {
        id: child,
        parentId: IDS.root,
        edgeId: edgeId('edge-child'),
      });
      const result = layoutCoreMindMap({
        sheet,
        measurements: measurementsFor(sheet),
      });

      expect(Math.sign(result.positions[child][axis] - result.positions[IDS.root][axis]))
        .toBe(sign);
      expect(result.connectors[0].direction).toBe(direction);
      expectNoOverlap(result);
    },
  );

  it('recursively applies mixed logic, org, and tree branch structures', () => {
    const document = createDocument('left-to-right', 'core:logic-chart');
    const sheet = document.sheets[IDS.sheet];
    const org = topicId('org-branch');
    const orgA = topicId('org-a');
    const orgB = topicId('org-b');
    const tree = topicId('tree-branch');
    const treeChild = topicId('tree-child');
    addTopic(sheet, {
      id: tree,
      parentId: IDS.root,
      edgeId: edgeId('edge-root-tree'),
      orderKey: 'b',
      branchLayout: {
        structure: 'core:tree-chart',
        direction: 'right-to-left',
        mode: 'auto',
      },
    });
    addTopic(sheet, {
      id: org,
      parentId: IDS.root,
      edgeId: edgeId('edge-root-org'),
      orderKey: 'a',
      branchLayout: {
        structure: 'core:org-chart',
        direction: 'top-to-bottom',
        mode: 'auto',
      },
    });
    addTopic(sheet, {
      id: orgB,
      parentId: org,
      edgeId: edgeId('edge-org-b'),
      orderKey: 'b',
    });
    addTopic(sheet, {
      id: orgA,
      parentId: org,
      edgeId: edgeId('edge-org-a'),
      orderKey: 'a',
    });
    addTopic(sheet, {
      id: treeChild,
      parentId: tree,
      edgeId: edgeId('edge-tree-child'),
    });

    const result = layoutCoreMindMap({
      sheet,
      measurements: measurementsFor(sheet, 110, 44),
    });

    expect(result.positions[org].x).toBeGreaterThan(result.positions[IDS.root].x);
    expect(result.positions[orgA].y).toBeGreaterThan(result.positions[org].y);
    expect(result.positions[orgB].y).toBeGreaterThan(result.positions[org].y);
    expect(result.positions[treeChild].x).toBeLessThan(result.positions[tree].x);
    expect(result.connectors.find((item) => item.targetTopicId === orgA)?.direction)
      .toBe('top-to-bottom');
    expect(result.connectors.find((item) => item.targetTopicId === treeChild)?.direction)
      .toBe('right-to-left');
    expectNoOverlap(result);
  });

  it('aligns Matrix cells by label without rewriting labels into Topic text', () => {
    const document = createDocument('top-to-bottom', 'core:matrix');
    const sheet = document.sheets[IDS.sheet];
    sheet.defaultBranchLayout.options = { rowHeight: 48 };
    const headerA = topicId('matrix-header-a');
    const headerB = topicId('matrix-header-b');
    addTopic(sheet, {
      id: headerA,
      parentId: IDS.root,
      edgeId: edgeId('edge-matrix-header-a'),
      orderKey: 'a',
    });
    addTopic(sheet, {
      id: headerB,
      parentId: IDS.root,
      edgeId: edgeId('edge-matrix-header-b'),
      orderKey: 'b',
    });
    const cells = [
      [topicId('a-alpha'), headerA, 'a', ['Alpha']],
      [topicId('a-beta'), headerA, 'b', ['Beta']],
      [topicId('b-beta'), headerB, 'a', ['Beta', 'Secondary']],
      [topicId('b-alpha'), headerB, 'b', ['Alpha']],
      [topicId('b-unlabeled'), headerB, 'c', []],
    ] as const;
    for (const [id, parentId, orderKey, labels] of cells) {
      addTopic(sheet, {
        id,
        parentId,
        edgeId: edgeId(`edge-${id}`),
        orderKey,
      });
      sheet.topics[id].labels = [...labels];
    }
    const before = JSON.stringify(document);

    const result = layoutCoreMindMap({ sheet, measurements: measurementsFor(sheet) });

    expect(result.positions[topicId('a-alpha')].y).toBe(result.positions[topicId('b-alpha')].y);
    expect(result.positions[topicId('a-beta')].y).toBe(result.positions[topicId('b-beta')].y);
    expect(result.positions[topicId('b-unlabeled')].y)
      .toBeGreaterThan(result.positions[topicId('b-beta')].y);
    expect(result.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining([
      'matrix-multi-label-primary',
      'matrix-unlabeled-row',
    ]));
    expect(JSON.stringify(document)).toBe(before);
    expectNoOverlap(result);
  });

  it('includes Matrix row labels in the layout cache key', () => {
    const document = createDocument('top-to-bottom', 'core:matrix');
    const sheet = document.sheets[IDS.sheet];
    const header = topicId('cache-header');
    const cell = topicId('cache-cell');
    addTopic(sheet, {
      id: header,
      parentId: IDS.root,
      edgeId: edgeId('edge-cache-header'),
    });
    addTopic(sheet, {
      id: cell,
      parentId: header,
      edgeId: edgeId('edge-cache-cell'),
    });
    sheet.topics[cell].labels = ['First'];
    const first = layoutCoreMindMap({ sheet, measurements: measurementsFor(sheet) });

    sheet.topics[cell].labels = ['Second'];
    const second = layoutCoreMindMap({ sheet, measurements: measurementsFor(sheet) });

    expect(second.cacheKey).not.toBe(first.cacheKey);
  });

  it('removes collapsed descendants and never traverses Relationship', () => {
    const document = createDocument();
    const sheet = document.sheets[IDS.sheet];
    const branch = topicId('branch');
    const descendant = topicId('descendant');
    const floating = topicId('floating');
    addTopic(sheet, {
      id: branch,
      parentId: IDS.root,
      edgeId: edgeId('edge-branch'),
    });
    addTopic(sheet, {
      id: descendant,
      parentId: branch,
      edgeId: edgeId('edge-descendant'),
    });
    addTopic(sheet, {
      id: floating,
      role: 'floating-root',
      placement: { mode: 'absolute', x: 700, y: 100 },
    });
    sheet.relationships[relationshipId('relationship-hidden-floating')] = {
      id: relationshipId('relationship-hidden-floating'),
      source: { element: { kind: 'topic', topicId: descendant }, anchor: 'auto' },
      target: { element: { kind: 'topic', topicId: floating }, anchor: 'auto' },
      routing: 'curve',
      startArrow: 'none',
      endArrow: 'none',
    };

    const withRelationship = layoutCoreMindMap({
      sheet,
      measurements: measurementsFor(sheet),
      collapsedTopicIds: [branch],
    });
    const relationshipSnapshot = sheet.relationships;
    sheet.relationships = {};
    const withoutRelationship = layoutCoreMindMap({
      sheet,
      measurements: measurementsFor(sheet),
      collapsedTopicIds: [branch],
    });
    sheet.relationships = relationshipSnapshot;

    expect(withRelationship.positions[descendant]).toBeUndefined();
    expect(withRelationship.connectors.map((item) => item.targetTopicId))
      .not.toContain(descendant);
    expect(withRelationship.positions).toEqual(withoutRelationship.positions);
    expect(withRelationship.connectors).toEqual(withoutRelationship.connectors);
    expect(withRelationship.cacheKey).toBe(withoutRelationship.cacheKey);
  });

  it('packs floating and summary roots while preserving absolute roots', () => {
    const document = createDocument();
    const sheet = document.sheets[IDS.sheet];
    const child = topicId('child');
    const floating = topicId('floating');
    const floatingChild = topicId('floating-child');
    const summaryResult = topicId('summary-result');
    addTopic(sheet, {
      id: child,
      parentId: IDS.root,
      edgeId: edgeId('edge-child'),
    });
    addTopic(sheet, {
      id: floating,
      role: 'floating-root',
      placement: { mode: 'absolute', x: 700, y: 200 },
    });
    addTopic(sheet, {
      id: floatingChild,
      parentId: floating,
      edgeId: edgeId('edge-floating-child'),
    });
    addTopic(sheet, {
      id: summaryResult,
      role: 'summary-result',
      placement: { mode: 'offset', dx: 20, dy: 10 },
    });

    const result = layoutCoreMindMap({
      sheet,
      measurements: measurementsFor(sheet),
    });

    expect(result.topicOrder).toEqual([
      IDS.root,
      child,
      floating,
      floatingChild,
      summaryResult,
    ]);
    expect(result.positions[floating]).toMatchObject({ x: 700, y: 200, derived: false });
    expect(result.positions[summaryResult].placementSource).toBe('offset');
    expect(result.positions[summaryResult].appliedOffset).toEqual({ x: 20, y: 10 });
    expectNoOverlap(result);
  });

  it.each(['left', 'right', 'top', 'bottom'] as const)(
    'anchors an owned Summary result subtree beside its %s bracket instead of forest-packing it',
    (orientation) => {
      const document = createDocument(
        orientation === 'left'
          ? 'right-to-left'
          : orientation === 'top'
            ? 'bottom-to-top'
            : orientation === 'bottom'
              ? 'top-to-bottom'
              : 'left-to-right',
      );
      const sheet = document.sheets[IDS.sheet];
      const member = topicId(`summary-member-${orientation}`);
      const memberEdge = edgeId(`edge-summary-member-${orientation}`);
      const resultRoot = topicId(`summary-result-${orientation}`);
      const resultChild = topicId(`summary-result-child-${orientation}`);
      addTopic(sheet, {
        id: member,
        parentId: IDS.root,
        edgeId: memberEdge,
        side: orientation,
      });
      addTopic(sheet, {
        id: resultRoot,
        role: 'summary-result',
        placement: { mode: 'offset', dx: 7, dy: -3 },
      });
      addTopic(sheet, {
        id: resultChild,
        parentId: resultRoot,
        edgeId: edgeId(`edge-summary-result-child-${orientation}`),
      });
      sheet.summaries[summaryId(`summary-${orientation}`)] = {
        id: summaryId(`summary-${orientation}`),
        scope: {
          kind: 'sibling-range',
          parentTopicId: IDS.root,
          firstEdgeId: memberEdge,
          lastEdgeId: memberEdge,
          includeDescendants: true,
        },
        resultTopicId: resultRoot,
        orientation,
      };

      const result = layoutCoreMindMap({
        sheet,
        measurements: measurementsFor(sheet),
      });
      const memberPosition = result.positions[member];
      const resultPosition = result.positions[resultRoot];
      const childPosition = result.positions[resultChild];

      expect(resultPosition.placementSource).toBe('offset');
      expect(resultPosition.appliedOffset).toEqual({ x: 7, y: -3 });
      expect(childPosition).toBeDefined();
      if (orientation === 'left') {
        expect(resultPosition.x + resultPosition.width).toBeLessThan(memberPosition.x);
      } else if (orientation === 'right') {
        expect(resultPosition.x).toBeGreaterThan(memberPosition.x + memberPosition.width);
      } else if (orientation === 'top') {
        expect(resultPosition.y + resultPosition.height).toBeLessThan(memberPosition.y);
      } else {
        expect(resultPosition.y).toBeGreaterThan(memberPosition.y + memberPosition.height);
      }
      expectNoOverlap(result);
    },
  );

  it('keeps absolute positions and applies offset only to derived output', () => {
    const makePlacementDocument = (placement: { mode: 'auto' } | {
      mode: 'offset'; dx: number; dy: number;
    }): MindMapDocumentV1 => {
      const document = createDocument();
      const sheet = document.sheets[IDS.sheet];
      sheet.topics[IDS.root].placement = { mode: 'absolute', x: 42, y: 77 };
      addTopic(sheet, {
        id: topicId('derived-child'),
        parentId: IDS.root,
        edgeId: edgeId('edge-derived'),
        placement,
      });
      addTopic(sheet, {
        id: topicId('absolute-child'),
        parentId: IDS.root,
        edgeId: edgeId('edge-absolute'),
        orderKey: 'b',
        placement: { mode: 'absolute', x: 555, y: 444 },
      });
      return document;
    };
    const autoDocument = makePlacementDocument({ mode: 'auto' });
    const offsetDocument = makePlacementDocument({ mode: 'offset', dx: 25, dy: -15 });
    const autoSheet = autoDocument.sheets[IDS.sheet];
    const offsetSheet = offsetDocument.sheets[IDS.sheet];
    const offsetBefore = JSON.stringify(offsetDocument);
    const auto = layoutCoreMindMap({
      sheet: autoSheet,
      measurements: measurementsFor(autoSheet),
    });
    const offset = layoutCoreMindMap({
      sheet: offsetSheet,
      measurements: measurementsFor(offsetSheet),
    });

    expect(offset.positions[IDS.root]).toMatchObject({ x: 42, y: 77, derived: false });
    expect(offset.positions[topicId('absolute-child')]).toMatchObject({
      x: 555,
      y: 444,
      derived: false,
    });
    expect(offset.positions[topicId('derived-child')].x
      - auto.positions[topicId('derived-child')].x).toBe(25);
    expect(offset.positions[topicId('derived-child')].y
      - auto.positions[topicId('derived-child')].y).toBe(-15);
    expect(offset.positions[topicId('derived-child')]).toMatchObject({
      placementSource: 'offset',
      appliedOffset: { x: 25, y: -15 },
      derived: true,
    });
    expect(JSON.stringify(offsetDocument)).toBe(offsetBefore);
  });

  it('is input-order independent and emits a stable cache key', () => {
    const document = createDocument('top-to-bottom', 'core:org-chart');
    const sheet = document.sheets[IDS.sheet];
    for (let index = 0; index < 8; index += 1) {
      addTopic(sheet, {
        id: topicId(`child-${index}`),
        parentId: IDS.root,
        edgeId: edgeId(`edge-${index}`),
        orderKey: String(index).padStart(2, '0'),
      });
    }
    const measurements = measurementsFor(sheet).map((value, index) => ({
      ...value,
      width: 80 + index,
    }));
    const reordered = structuredClone(document) as MindMapDocumentV1;
    const reorderedSheet = reordered.sheets[IDS.sheet];
    reorderedSheet.topics = Object.fromEntries(
      Object.entries(reorderedSheet.topics).reverse(),
    ) as MindMapSheet['topics'];
    reorderedSheet.treeEdges = Object.fromEntries(
      Object.entries(reorderedSheet.treeEdges).reverse(),
    ) as MindMapSheet['treeEdges'];

    const first = layoutCoreMindMap({ sheet, measurements });
    const second = layoutCoreMindMap({
      sheet: reorderedSheet,
      measurements: [...measurements].reverse(),
    });

    expect(second).toEqual(first);
    expect(second.cacheKey).toBe(first.cacheKey);
    expectNoOverlap(first);
  });

  it('supports Timeline while diagnosing an unsupported direction deterministically', () => {
    const document = createDocument('clockwise', 'core:timeline');
    const sheet = document.sheets[IDS.sheet];
    addTopic(sheet, {
      id: topicId('child'),
      parentId: IDS.root,
      edgeId: edgeId('edge-child'),
    });

    const result = layoutCoreMindMap({
      sheet,
      measurements: measurementsFor(sheet),
    });

    expect(result.positions[topicId('child')].x).toBeGreaterThan(result.positions[IDS.root].x);
    expect(result.diagnostics.map((item) => item.code)).toContain('unsupported-direction');
    expect(result.diagnostics.map((item) => item.code)).not.toContain('unsupported-structure');
  });

  it('keeps extension structures safe through an explicit deterministic fallback', () => {
    const document = createDocument(
      'radial',
      'extension:spiral' as MindMapSheet['defaultBranchLayout']['structure'],
    );
    const sheet = document.sheets[IDS.sheet];
    addTopic(sheet, {
      id: topicId('extension-child'),
      parentId: IDS.root,
      edgeId: edgeId('edge-extension-child'),
    });

    const result = layoutCoreMindMap({ sheet, measurements: measurementsFor(sheet) });
    expect(result.diagnostics.map((item) => item.code)).toEqual(
      expect.arrayContaining(['unsupported-structure', 'unsupported-direction']),
    );
    expect(result.positions[topicId('extension-child')].x)
      .toBeGreaterThan(result.positions[IDS.root].x);
  });

  it('lays out horizontal off-axis Timeline events in chronological alternating lanes', () => {
    const document = createDocument('left-to-right', 'core:timeline');
    const sheet = document.sheets[IDS.sheet];
    sheet.defaultBranchLayout.variantId = 'horizontal-off-axis';
    const eventIds = Array.from({ length: 4 }, (_, index) => topicId(`event-${index}`));
    eventIds.forEach((id, index) => addTopic(sheet, {
      id,
      parentId: IDS.root,
      edgeId: edgeId(`edge-event-${index}`),
      orderKey: String(index),
    }));

    const result = layoutCoreMindMap({ sheet, measurements: measurementsFor(sheet) });
    const root = result.positions[IDS.root];
    const events = eventIds.map((id) => result.positions[id]);

    expect(events.map((event) => event.x)).toEqual([...events.map((event) => event.x)].sort((a, b) => a - b));
    expect(events[0].y).toBeLessThan(root.y);
    expect(events[1].y).toBeGreaterThan(root.y);
    expect(events[2].y).toBeLessThan(root.y);
    expect(events[3].y).toBeGreaterThan(root.y);
    expectNoOverlap(result);
  });

  it('lays out vertical Timeline events along one stable axis', () => {
    const document = createDocument('top-to-bottom', 'core:timeline');
    const sheet = document.sheets[IDS.sheet];
    sheet.defaultBranchLayout.variantId = 'vertical';
    const eventIds = Array.from({ length: 3 }, (_, index) => topicId(`vertical-${index}`));
    eventIds.forEach((id, index) => addTopic(sheet, {
      id,
      parentId: IDS.root,
      edgeId: edgeId(`edge-vertical-${index}`),
      orderKey: String(index),
    }));

    const result = layoutCoreMindMap({ sheet, measurements: measurementsFor(sheet) });
    const positions = eventIds.map((id) => result.positions[id]);
    expect(positions[0].y).toBeGreaterThan(result.positions[IDS.root].y);
    expect(positions[1].y).toBeGreaterThan(positions[0].y);
    expect(positions[2].y).toBeGreaterThan(positions[1].y);
    expectNoOverlap(result);
  });

  it('lays out Fishbone causes from the head along alternating bones', () => {
    const document = createDocument('right-to-left', 'core:fishbone');
    const sheet = document.sheets[IDS.sheet];
    const causeIds = Array.from({ length: 4 }, (_, index) => topicId(`cause-${index}`));
    causeIds.forEach((id, index) => addTopic(sheet, {
      id,
      parentId: IDS.root,
      edgeId: edgeId(`edge-cause-${index}`),
      orderKey: String(index),
    }));

    const result = layoutCoreMindMap({ sheet, measurements: measurementsFor(sheet) });
    const causes = causeIds.map((id) => result.positions[id]);
    expect(causes[0].x).toBeLessThan(result.positions[IDS.root].x);
    expect(causes[1].x).toBeLessThan(causes[0].x);
    expect(causes[0].y).toBeLessThan(result.positions[IDS.root].y);
    expect(causes[1].y).toBeGreaterThan(result.positions[IDS.root].y);
    expectNoOverlap(result);
  });

  it.each([
    ['core:matrix', 'top-to-bottom'],
    ['core:grid', 'top-to-bottom'],
    ['core:brace-map', 'left-to-right'],
    ['core:tree-table', 'left-to-right'],
  ] as const)('uses distinct non-fallback geometry for %s', (structure, direction) => {
    const document = createDocument(direction, structure);
    const sheet = document.sheets[IDS.sheet];
    if (structure === 'core:grid') sheet.defaultBranchLayout.options = { columns: 2 };
    const childIds = Array.from({ length: 5 }, (_, index) => topicId(`${structure}-${index}`));
    childIds.forEach((id, index) => addTopic(sheet, {
      id,
      parentId: IDS.root,
      edgeId: edgeId(`${structure}-edge-${index}`),
      orderKey: String(index),
    }));

    const result = layoutCoreMindMap({ sheet, measurements: measurementsFor(sheet) });
    expect(result.diagnostics.map((item) => item.code)).not.toContain('unsupported-structure');
    expect(new Set(childIds.map((id) => result.positions[id].x)).size).toBeGreaterThan(0);
    expect(new Set(childIds.map((id) => result.positions[id].y)).size).toBeGreaterThan(0);
    expectNoOverlap(result);
  });

  it('lays out 1000 Topics within a bounded performance smoke budget', () => {
    const document = createDocument();
    const sheet = document.sheets[IDS.sheet];
    for (let index = 0; index < 999; index += 1) {
      addTopic(sheet, {
        id: topicId(`topic-${String(index).padStart(4, '0')}`),
        parentId: IDS.root,
        edgeId: edgeId(`edge-${String(index).padStart(4, '0')}`),
        orderKey: String(index).padStart(4, '0'),
      });
    }
    const measurements = measurementsFor(sheet, 80, 30);
    const startedAt = performance.now();
    const result = layoutCoreMindMap({ sheet, measurements });
    const elapsed = performance.now() - startedAt;

    expect(result.topicOrder).toHaveLength(1_000);
    expect(Object.keys(result.positions)).toHaveLength(1_000);
    expect(result.connectors).toHaveLength(999);
    // Product gate: 1,000 topics must complete in under two seconds on the
    // baseline Windows Chromium development machine.
    expect(elapsed).toBeLessThan(2_000);
    const children = result.topicOrder.slice(1).map((id) => result.positions[id]);
    for (let index = 1; index < children.length; index += 1) {
      expect(children[index].y).toBeGreaterThanOrEqual(
        children[index - 1].y + children[index - 1].height,
      );
    }
  });
});
