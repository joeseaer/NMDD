import type { JSONContent } from '@tiptap/core';

import {
  createEquation,
  createNewMindMapDocument,
  createPresentationDeck,
  createRichText,
  createTopic,
  createTopicTask,
  createTopicTodo,
} from '../domain/defaults';
import type {
  LegacyMindMapGraph,
  LegacyMindMapNode,
} from '../domain/legacy';
import type * as Domain from '../domain/types';
import { validateMindMapDocument } from '../domain/validation';

export const MIND_MAP_FIXTURE_NAMES = [
  'mindmap-v0',
  'mindmap-v1-small',
  'mindmap-v1-large',
  'mindmap-elements',
  'mindmap-mixed-structures',
] as const;

export type MindMapFixtureName = (typeof MIND_MAP_FIXTURE_NAMES)[number];

export type MindMapFixturePayload =
  | {
      readonly kind: 'canonical-v1';
      readonly document: Domain.MindMapDocumentV1;
    }
  | {
      readonly kind: 'legacy-v0';
      readonly graph: LegacyMindMapGraph;
    };

export interface MindMapFixtureDefinition {
  readonly create: () => MindMapFixturePayload;
  readonly description: string;
  readonly kind: MindMapFixturePayload['kind'];
  readonly name: MindMapFixtureName;
}

interface BaseDocumentFixture {
  readonly document: Domain.MindMapDocumentV1;
  readonly rootTopicId: Domain.TopicId;
  readonly sheet: Domain.MindMapSheet;
  readonly sheetId: Domain.SheetId;
  readonly themeId: Domain.ThemeId;
}

interface AddTopicInput {
  readonly branchLayout?: Domain.BranchLayoutSpec;
  readonly edgeId?: Domain.TreeEdgeId;
  readonly labels?: string[];
  readonly orderKey?: string;
  readonly parentTopicId?: Domain.TopicId;
  readonly placement?: Domain.TopicPlacement;
  readonly role?: Domain.TopicRole;
  readonly side?: Domain.BranchSide;
  readonly title: string;
  readonly topicId: Domain.TopicId;
}

const uuid = <K extends string>(counter: number): Domain.Id<K> => {
  const suffix = counter.toString(16).padStart(12, '0');
  return `01890f1a-0000-7000-8000-${suffix}` as Domain.Id<K>;
};

const orderKey = (prefix: string, index: number): string =>
  `${prefix}${index.toString(36).padStart(6, '0')}`;

function createBaseDocument(
  base: number,
  title: string,
  rootTitle: string,
): BaseDocumentFixture {
  const documentId = uuid<'Document'>(base + 1);
  const sheetId = uuid<'Sheet'>(base + 2);
  const rootTopicId = uuid<'Topic'>(base + 3);
  const themeId = uuid<'Theme'>(base + 4);
  const document = createNewMindMapDocument({
    documentId,
    rootTitle,
    rootTopicId,
    sheetId,
    sheetOrderKey: 'a',
    sheetTitle: '主画布',
    title,
    themeId,
  });
  return {
    document,
    rootTopicId,
    sheet: document.sheets[sheetId],
    sheetId,
    themeId,
  };
}

function addTopic(sheet: Domain.MindMapSheet, input: AddTopicInput): Domain.Topic {
  const topic = createTopic({
    id: input.topicId,
    placement: input.placement,
    role: input.role,
    title: input.title,
  });
  if (input.branchLayout !== undefined) {
    topic.branchLayout = { ...input.branchLayout };
  }
  if (input.labels !== undefined) {
    topic.labels = [...input.labels];
  }
  sheet.topics[input.topicId] = topic;

  if (
    input.parentTopicId !== undefined &&
    input.edgeId !== undefined &&
    input.orderKey !== undefined &&
    input.side !== undefined
  ) {
    const edge: Domain.TreeEdge = {
      childTopicId: input.topicId,
      id: input.edgeId,
      orderKey: input.orderKey,
      parentTopicId: input.parentTopicId,
      side: input.side,
    };
    sheet.treeEdges[input.edgeId] = edge;
  }
  return topic;
}

function assertCanonicalFixture(
  name: MindMapFixtureName,
  document: Domain.MindMapDocumentV1,
): Domain.MindMapDocumentV1 {
  const result = validateMindMapDocument(document);
  if (!result.valid) {
    const summary = result.issues
      .slice(0, 8)
      .map((issue) => `${issue.code}@${issue.path}`)
      .join(', ');
    throw new Error(`Fixture ${name} is invalid: ${summary}`);
  }
  return document;
}

export function createMindMapV0Fixture(): LegacyMindMapGraph {
  const nodes: LegacyMindMapNode[] = [
    {
      id: 'root',
      type: 'mindMap',
      position: { x: 0, y: 0 },
      data: { label: '中心主题', bold: true },
    },
    {
      id: 'left',
      type: 'mindMap',
      position: { x: -260, y: -80 },
      data: { label: '左侧主题' },
    },
    {
      id: 'right',
      type: 'mindMap',
      position: { x: 260, y: -80 },
      data: { label: '右侧主题' },
    },
    {
      id: 'right-child',
      type: 'mindMap',
      position: { x: 520, y: 40 },
      data: { label: '右侧子主题' },
    },
    {
      id: 'boundary-1',
      type: 'boundary',
      position: { x: 220, y: -120 },
      data: { memberIds: ['right', 'right-child'], padding: 20, w: 460, h: 220 },
    },
    {
      id: 'summary-1',
      type: 'summary',
      position: { x: 700, y: 20 },
      data: { memberIds: ['right', 'right-child'], padding: 12, h: 80, label: '阶段概要' },
    },
  ];
  return {
    createdAt: '2026-07-18T00:00:00.000Z',
    edges: [
      { id: 'edge-left', source: 'root', target: 'left', data: {} },
      { id: 'edge-right', source: 'root', target: 'right', data: {} },
      { id: 'edge-right-child', source: 'right', target: 'right-child', data: {} },
      {
        id: 'relationship-1',
        source: 'left',
        target: 'right-child',
        data: { kind: 'link', label: '旧版关系线' },
      },
    ],
    nodes,
  };
}

export function createLegacyMultipleParentsFixture(): LegacyMindMapGraph {
  return {
    createdAt: '2026-07-18T00:00:00.000Z',
    nodes: [
      { id: 'root', type: 'mindMap', position: { x: 0, y: 0 }, data: { label: 'Root' } },
      { id: 'a', type: 'mindMap', position: { x: 220, y: -80 }, data: { label: 'A' } },
      { id: 'b', type: 'mindMap', position: { x: 220, y: 80 }, data: { label: 'B' } },
      { id: 'child', type: 'mindMap', position: { x: 460, y: 0 }, data: { label: 'Child' } },
    ],
    edges: [
      { id: 'root-a', source: 'root', target: 'a', data: {} },
      { id: 'root-b', source: 'root', target: 'b', data: {} },
      { id: 'a-child', source: 'a', target: 'child', data: {} },
      { id: 'b-child', source: 'b', target: 'child', data: {} },
    ],
  };
}

export function createLegacyCycleFixture(): LegacyMindMapGraph {
  return {
    createdAt: '2026-07-18T00:00:00.000Z',
    nodes: [
      { id: 'root', type: 'mindMap', position: { x: 0, y: 0 }, data: { label: 'Root' } },
      { id: 'x', type: 'mindMap', position: { x: 260, y: -80 }, data: { label: 'X' } },
      { id: 'y', type: 'mindMap', position: { x: 520, y: -80 }, data: { label: 'Y' } },
    ],
    edges: [
      { id: 'x-y', source: 'x', target: 'y', data: {} },
      { id: 'y-x', source: 'y', target: 'x', data: {} },
    ],
  };
}

export const CORRUPTED_LEGACY_FIXTURE_FACTORIES = Object.freeze({
  cycle: createLegacyCycleFixture,
  multipleParents: createLegacyMultipleParentsFixture,
});

export function createMindMapV1SmallFixture(): Domain.MindMapDocumentV1 {
  const base = 100_000;
  const fixture = createBaseDocument(base, 'Small canonical mind map', '创业模拟器');
  for (let branchIndex = 0; branchIndex < 3; branchIndex += 1) {
    const branchId = uuid<'Topic'>(base + 1_000 + branchIndex);
    addTopic(fixture.sheet, {
      edgeId: uuid<'TreeEdge'>(base + 10_000 + branchIndex),
      orderKey: orderKey('r', branchIndex),
      parentTopicId: fixture.rootTopicId,
      side: branchIndex === 0 ? 'left' : 'right',
      title: `主主题 ${branchIndex + 1}`,
      topicId: branchId,
    });
    for (let childIndex = 0; childIndex < 2; childIndex += 1) {
      const ordinal = branchIndex * 2 + childIndex;
      addTopic(fixture.sheet, {
        edgeId: uuid<'TreeEdge'>(base + 11_000 + ordinal),
        orderKey: orderKey('c', childIndex),
        parentTopicId: branchId,
        side: 'inherit',
        title: `分支 ${branchIndex + 1}.${childIndex + 1}`,
        topicId: uuid<'Topic'>(base + 2_000 + ordinal),
      });
    }
  }
  return assertCanonicalFixture('mindmap-v1-small', fixture.document);
}

export function createMindMapV1LargeFixture(): Domain.MindMapDocumentV1 {
  const base = 200_000;
  const fixture = createBaseDocument(base, 'Large deterministic mind map', '1000 Topic 性能基线');
  for (let branchIndex = 0; branchIndex < 9; branchIndex += 1) {
    const branchId = uuid<'Topic'>(base + 1_000 + branchIndex);
    addTopic(fixture.sheet, {
      edgeId: uuid<'TreeEdge'>(base + 20_000 + branchIndex),
      orderKey: orderKey('r', branchIndex),
      parentTopicId: fixture.rootTopicId,
      side: branchIndex % 2 === 0 ? 'left' : 'right',
      title: `性能分支 ${branchIndex + 1}`,
      topicId: branchId,
    });
    for (let childIndex = 0; childIndex < 110; childIndex += 1) {
      const ordinal = branchIndex * 110 + childIndex;
      addTopic(fixture.sheet, {
        edgeId: uuid<'TreeEdge'>(base + 30_000 + ordinal),
        orderKey: orderKey('c', childIndex),
        parentTopicId: branchId,
        side: 'inherit',
        title: `Topic ${String(ordinal + 10).padStart(4, '0')}`,
        topicId: uuid<'Topic'>(base + 2_000 + ordinal),
      });
    }
  }
  return assertCanonicalFixture('mindmap-v1-large', fixture.document);
}

export function createMindMapElementsFixture(): Domain.MindMapDocumentV1 {
  const base = 400_000;
  const fixture = createBaseDocument(base, 'Semantic elements fixture', '产品发布计划');
  const topicA = uuid<'Topic'>(base + 1_000);
  const topicB = uuid<'Topic'>(base + 1_001);
  const topicAChild = uuid<'Topic'>(base + 1_002);
  const resourceTopic = uuid<'Topic'>(base + 1_003);
  const floatingTopic = uuid<'Topic'>(base + 1_004);
  const summaryResultTopic = uuid<'Topic'>(base + 1_005);
  const edgeA = uuid<'TreeEdge'>(base + 2_000);
  const edgeB = uuid<'TreeEdge'>(base + 2_001);
  const edgeAChild = uuid<'TreeEdge'>(base + 2_002);
  const edgeResource = uuid<'TreeEdge'>(base + 2_003);

  addTopic(fixture.sheet, {
    edgeId: edgeA,
    orderKey: 'a',
    parentTopicId: fixture.rootTopicId,
    side: 'right',
    title: '产品设计',
    topicId: topicA,
  });
  addTopic(fixture.sheet, {
    edgeId: edgeB,
    orderKey: 'b',
    parentTopicId: fixture.rootTopicId,
    side: 'right',
    title: '市场发布',
    topicId: topicB,
  });
  addTopic(fixture.sheet, {
    edgeId: edgeAChild,
    orderKey: 'a',
    parentTopicId: topicA,
    side: 'inherit',
    title: '交互验收',
    topicId: topicAChild,
  });
  addTopic(fixture.sheet, {
    edgeId: edgeResource,
    orderKey: 'a',
    parentTopicId: topicB,
    side: 'inherit',
    title: '发布资料',
    topicId: resourceTopic,
  });
  addTopic(fixture.sheet, {
    placement: { mode: 'absolute', x: 420, y: 320 },
    role: 'floating-root',
    title: '停车场',
    topicId: floatingTopic,
  });
  addTopic(fixture.sheet, {
    role: 'summary-result',
    title: '第一阶段完成',
    topicId: summaryResultTopic,
  });

  const boundaryId = uuid<'Boundary'>(base + 3_000);
  const summaryId = uuid<'Summary'>(base + 3_001);
  const calloutId = uuid<'Callout'>(base + 3_002);
  const zoneId = uuid<'Zone'>(base + 3_003);
  fixture.sheet.boundaries[boundaryId] = {
    id: boundaryId,
    padding: 24,
    scope: {
      firstEdgeId: edgeA,
      includeDescendants: true,
      kind: 'sibling-range',
      lastEdgeId: edgeB,
      parentTopicId: fixture.rootTopicId,
    },
    title: createRichText('核心范围'),
  };
  fixture.sheet.summaries[summaryId] = {
    id: summaryId,
    orientation: 'right',
    resultTopicId: summaryResultTopic,
    scope: { kind: 'explicit', topicIds: [topicAChild] },
  };
  fixture.sheet.callouts[calloutId] = {
    content: createRichText('必须通过键盘和读屏验收'),
    id: calloutId,
    placement: { mode: 'auto', preferredSide: 'top' },
    tail: 'curve',
    targetTopicId: topicA,
  };
  fixture.sheet.zones[zoneId] = {
    autoResize: false,
    collapsed: false,
    id: zoneId,
    lockAspectRatio: false,
    padding: 20,
    rect: { height: 220, width: 360, x: 360, y: 260 },
    rootTopicIds: [floatingTopic],
    title: createRichText('待讨论'),
    zOrderKey: 'a',
  };

  const relationshipA = uuid<'Relationship'>(base + 4_000);
  const relationshipB = uuid<'Relationship'>(base + 4_001);
  const relationshipC = uuid<'Relationship'>(base + 4_002);
  fixture.sheet.relationships[relationshipA] = {
    endArrow: 'triangle',
    id: relationshipA,
    routing: 'curve',
    source: { anchor: 'right', element: { kind: 'topic', topicId: topicA } },
    startArrow: 'none',
    target: { anchor: 'left', element: { kind: 'topic', topicId: topicB } },
    title: createRichText('依赖'),
  };
  fixture.sheet.relationships[relationshipB] = {
    endArrow: 'open-triangle',
    id: relationshipB,
    routing: 'orthogonal',
    source: { anchor: 'right', element: { boundaryId, kind: 'boundary' } },
    startArrow: 'none',
    target: { anchor: 'left', element: { kind: 'topic', topicId: fixture.rootTopicId } },
  };
  fixture.sheet.relationships[relationshipC] = {
    endArrow: 'none',
    id: relationshipC,
    routing: 'straight',
    source: { anchor: 'top', element: { kind: 'zone', zoneId } },
    startArrow: 'circle',
    target: { anchor: 'bottom', element: { calloutId, kind: 'callout' } },
  };

  const markerGroupId = uuid<'MarkerGroup'>(base + 5_000);
  const markerDefinitionId = uuid<'MarkerDefinition'>(base + 5_001);
  const markerInstanceId = uuid<'MarkerInstance'>(base + 5_002);
  fixture.document.markerGroups[markerGroupId] = {
    exclusive: true,
    id: markerGroupId,
    kind: 'builtin',
    name: 'Priority',
    orderKey: 'a',
  };
  fixture.document.markerDefinitions[markerDefinitionId] = {
    groupId: markerGroupId,
    id: markerDefinitionId,
    name: 'Priority 1',
    orderKey: 'a',
    semanticValue: 1,
    source: { key: 'priority-1', kind: 'builtin' },
  };
  fixture.sheet.markerInstances[markerInstanceId] = {
    id: markerInstanceId,
    markerDefinitionId,
    orderKey: 'a',
    topicId: topicA,
    value: 1,
  };
  fixture.sheet.markerLegend = {
    itemOrder: [markerDefinitionId],
    position: { x: 680, y: -220 },
    title: '图例',
    visible: true,
  };

  const imageAssetId = uuid<'Asset'>(base + 6_000);
  const documentAssetId = uuid<'Asset'>(base + 6_001);
  fixture.document.assets[imageAssetId] = {
    byteSize: 1024,
    fileName: 'launch.png',
    id: imageAssetId,
    intrinsicSize: { height: 480, width: 800 },
    mimeType: 'image/png',
    sha256: '1'.repeat(64),
    source: { kind: 'embedded', relativePath: 'assets/launch.png' },
  };
  fixture.document.assets[documentAssetId] = {
    byteSize: 2048,
    fileName: 'brief.pdf',
    id: documentAssetId,
    mimeType: 'application/pdf',
    sha256: '2'.repeat(64),
    source: { kind: 'embedded', relativePath: 'assets/brief.pdf' },
  };

  const noteId = uuid<'Note'>(base + 7_000);
  const linkId = uuid<'Link'>(base + 7_001);
  const attachmentId = uuid<'Attachment'>(base + 7_002);
  const imageId = uuid<'Image'>(base + 7_003);
  const equationId = uuid<'Equation'>(base + 7_004);
  const todoId = uuid<'Todo'>(base + 7_005);
  const taskAId = uuid<'Task'>(base + 7_006);
  const taskBId = uuid<'Task'>(base + 7_007);
  const taskDependencyId = uuid<'TaskDependency'>(base + 7_008);
  fixture.sheet.notes[noteId] = {
    content: createRichText('这是一条结构化备注。'),
    id: noteId,
    topicId: topicA,
  };
  fixture.sheet.links[linkId] = {
    href: 'https://example.com/launch',
    id: linkId,
    kind: 'web',
    orderKey: 'a',
    status: 'active',
    title: '发布站点',
    topicId: topicB,
  };
  fixture.sheet.attachments[attachmentId] = {
    assetId: documentAssetId,
    id: attachmentId,
    orderKey: 'a',
    topicId: resourceTopic,
  };
  fixture.sheet.images[imageId] = {
    alt: 'Launch illustration',
    assetId: imageAssetId,
    id: imageId,
    orderKey: 'a',
    placement: { align: 'center', offset: { x: 0, y: 8 }, side: 'top' },
    role: 'inline',
    size: { height: 180, width: 300 },
    topicId: topicA,
  };
  fixture.sheet.equations[equationId] = createEquation({
    id: equationId,
    orderKey: 'a',
    source: String.raw`ROI = \frac{收益-成本}{成本}`,
    topicId: topicAChild,
  });
  fixture.sheet.todos[todoId] = createTopicTodo({ id: todoId, topicId: topicB });
  fixture.sheet.tasks[taskAId] = createTopicTask({ id: taskAId, topicId: topicA });
  fixture.sheet.tasks[taskBId] = {
    ...createTopicTask({ id: taskBId, topicId: topicAChild }),
    dueDate: '2026-08-15',
    priority: 2,
  };
  fixture.sheet.taskDependencies[taskDependencyId] = {
    id: taskDependencyId,
    predecessorTaskId: taskAId,
    successorTaskId: taskBId,
    type: 'finish-start',
  };

  const savedViewId = uuid<'SavedView'>(base + 8_000);
  fixture.document.savedViews[savedViewId] = {
    focusedBranchRootId: topicA,
    id: savedViewId,
    name: '产品分支',
    orderKey: 'a',
    selection: [
      { id: topicA, kind: 'topic' },
      { id: boundaryId, kind: 'boundary' },
    ],
    sheetId: fixture.sheetId,
    viewport: { x: -120, y: -80, zoom: 1.25 },
  };
  fixture.sheet.defaultSavedViewId = savedViewId;

  const deckId = uuid<'Presentation'>(base + 9_000);
  const slideId = uuid<'Slide'>(base + 9_001);
  const buildId = uuid<'PresentationBuild'>(base + 9_002);
  const slide: Domain.PresentationSlide = {
    builds: {
      [buildId]: {
        animation: 'draw',
        id: buildId,
        orderKey: 'a',
        target: { kind: 'relationship', relationshipId: relationshipA },
      },
    } as Record<Domain.BuildId, Domain.PresentationBuild>,
    id: slideId,
    orderKey: 'a',
    speakerNotes: createRichText('介绍核心范围和依赖。'),
    target: { kind: 'sheet', sheetId: fixture.sheetId },
  };
  fixture.document.presentations[deckId] = createPresentationDeck({
    id: deckId,
    sheetId: fixture.sheetId,
    slides: { [slideId]: slide } as Record<Domain.SlideId, Domain.PresentationSlide>,
  });

  return assertCanonicalFixture('mindmap-elements', fixture.document);
}

export function createMindMapMixedStructuresFixture(): Domain.MindMapDocumentV1 {
  const base = 300_000;
  const fixture = createBaseDocument(base, 'Mixed structures fixture', '混合结构地图');
  const structures = [
    ['core:logic-chart', 'left-to-right', 'Logic Chart'],
    ['core:org-chart', 'top-to-bottom', 'Org Chart'],
    ['core:tree-chart', 'right-to-left', 'Tree Chart'],
    ['core:timeline', 'left-to-right', 'Timeline'],
    ['core:fishbone', 'right-to-left', 'Fishbone'],
    ['core:matrix', 'top-to-bottom', 'Matrix'],
    ['core:brace-map', 'left-to-right', 'Brace Map'],
    ['core:tree-table', 'top-to-bottom', 'Tree Table'],
    ['core:grid', 'top-to-bottom', 'Grid'],
  ] as const satisfies readonly (readonly [
    Domain.CoreStructureId,
    Domain.ResolvedLayoutDirection,
    string,
  ])[];

  structures.forEach(([structure, direction, label], structureIndex) => {
    const branchId = uuid<'Topic'>(base + 1_000 + structureIndex);
    addTopic(fixture.sheet, {
      branchLayout: { direction, mode: 'auto', structure },
      edgeId: uuid<'TreeEdge'>(base + 10_000 + structureIndex),
      orderKey: orderKey('r', structureIndex),
      parentTopicId: fixture.rootTopicId,
      side: structureIndex % 2 === 0 ? 'left' : 'right',
      title: label,
      topicId: branchId,
    });
    for (let childIndex = 0; childIndex < 2; childIndex += 1) {
      const ordinal = structureIndex * 2 + childIndex;
      addTopic(fixture.sheet, {
        edgeId: uuid<'TreeEdge'>(base + 11_000 + ordinal),
        labels: structure === 'core:matrix' ? [`Row ${childIndex + 1}`] : undefined,
        orderKey: orderKey('c', childIndex),
        parentTopicId: branchId,
        side: 'inherit',
        title: `${label} item ${childIndex + 1}`,
        topicId: uuid<'Topic'>(base + 2_000 + ordinal),
      });
    }
  });
  return assertCanonicalFixture('mindmap-mixed-structures', fixture.document);
}

const definitions: Record<MindMapFixtureName, MindMapFixtureDefinition> = {
  'mindmap-v0': {
    create: () => ({ graph: createMindMapV0Fixture(), kind: 'legacy-v0' }),
    description: 'Legacy nodes + edges compatibility and migration fixture.',
    kind: 'legacy-v0',
    name: 'mindmap-v0',
  },
  'mindmap-v1-small': {
    create: () => ({ document: createMindMapV1SmallFixture(), kind: 'canonical-v1' }),
    description: 'Small canonical keyboard-editing fixture with ten topics.',
    kind: 'canonical-v1',
    name: 'mindmap-v1-small',
  },
  'mindmap-v1-large': {
    create: () => ({ document: createMindMapV1LargeFixture(), kind: 'canonical-v1' }),
    description: 'Deterministic performance fixture containing exactly 1000 topics.',
    kind: 'canonical-v1',
    name: 'mindmap-v1-large',
  },
  'mindmap-elements': {
    create: () => ({ document: createMindMapElementsFixture(), kind: 'canonical-v1' }),
    description: 'Boundary, Summary, Callout, Zone, relationship, resource and task fixture.',
    kind: 'canonical-v1',
    name: 'mindmap-elements',
  },
  'mindmap-mixed-structures': {
    create: () => ({ document: createMindMapMixedStructuresFixture(), kind: 'canonical-v1' }),
    description: 'One sheet combining the nine non-default core structure families.',
    kind: 'canonical-v1',
    name: 'mindmap-mixed-structures',
  },
};

export const MIND_MAP_FIXTURE_REGISTRY: Readonly<
  Record<MindMapFixtureName, MindMapFixtureDefinition>
> = Object.freeze(definitions);

export function isMindMapFixtureName(value: string | null): value is MindMapFixtureName {
  return value !== null && Object.prototype.hasOwnProperty.call(MIND_MAP_FIXTURE_REGISTRY, value);
}

export function createMindMapFixture(name: MindMapFixtureName): MindMapFixturePayload {
  return MIND_MAP_FIXTURE_REGISTRY[name].create();
}

export function toMindMapTiptapDocument(
  fixture: MindMapFixturePayload,
  description = 'Mind map fixture',
): JSONContent {
  const data = fixture.kind === 'canonical-v1' ? fixture.document : fixture.graph;
  return {
    content: [
      {
        content: [{ text: description, type: 'text' }],
        type: 'paragraph',
      },
      {
        attrs: { data },
        type: 'mindMap',
      },
    ],
    type: 'doc',
  };
}

export function createMindMapFixtureTiptapDocument(name: MindMapFixtureName): JSONContent {
  const definition = MIND_MAP_FIXTURE_REGISTRY[name];
  return toMindMapTiptapDocument(
    definition.create(),
    `${definition.name}: ${definition.description}`,
  );
}
