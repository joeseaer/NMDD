import { describe, expect, it } from 'vitest';

import { validateMindMapInvariants } from './invariants';
import {
  validateMindMapDocument,
  validateMindMapSchemaIssues,
} from './validation';

const id = (suffix: number): string =>
  `01890f1a-0000-7000-8000-${String(suffix).padStart(12, '0')}`;

const IDS = {
  actor: id(20),
  asset: id(34),
  attachment: id(21),
  boundary: id(22),
  build: id(23),
  callout: id(24),
  child: id(4),
  child2: id(5),
  deck: id(25),
  dependency1: id(26),
  dependency2: id(27),
  document: id(1),
  edge: id(6),
  edge2: id(7),
  edge3: id(8),
  image: id(35),
  image2: id(36),
  missing: id(99),
  parent: id(9),
  relationship: id(28),
  root: id(3),
  sheet: id(2),
  slide: id(29),
  summary: id(30),
  task1: id(31),
  task2: id(32),
  theme: id(10),
  todo: id(33),
};

const richText = {
  blocks: [{ children: [], type: 'paragraph' }],
  type: 'doc',
  version: 1,
};

// Tests intentionally use a mutable structural fixture: production callers
// receive generated canonical types, while these cases exercise invalid states.
function createValidDocument(): any {
  return {
    actors: {},
    assets: {},
    contentRevision: 0,
    id: IDS.document,
    markerDefinitions: {},
    markerGroups: {},
    minimumReaderVersion: 1,
    presentations: {},
    savedViews: {},
    schema: 'app.nmdd.mindmap',
    schemaVersion: 1,
    sheets: {
      [IDS.sheet]: {
        advancedLayout: {
          allowTopicOverlap: false,
          flexibleFloatingTopics: false,
        },
        attachments: {},
        audioClips: {},
        boundaries: {},
        callouts: {},
        canvas: {
          background: {
            color: { kind: 'literal', value: '#FFFFFF' },
            kind: 'solid',
          },
        },
        defaultBranchLayout: {
          direction: 'both',
          mode: 'auto',
          structure: 'core:mind-map',
        },
        equations: {},
        id: IDS.sheet,
        images: {},
        links: {},
        markerInstances: {},
        markerLegend: { position: { x: 0, y: 0 }, visible: false },
        notes: {},
        orderKey: 'a',
        relationships: {},
        rootTopicId: IDS.root,
        summaries: {},
        taskDependencies: {},
        tasks: {},
        themeId: IDS.theme,
        title: 'Sheet',
        todos: {},
        topics: {
          [IDS.child]: {
            defaultCollapsed: false,
            id: IDS.child,
            placement: { mode: 'auto' },
            role: 'regular',
            sizing: { width: { mode: 'fit' } },
            title: richText,
          },
          [IDS.root]: {
            defaultCollapsed: false,
            id: IDS.root,
            placement: { mode: 'auto' },
            role: 'central',
            sizing: { width: { mode: 'fit' } },
            title: richText,
          },
        },
        treeEdges: {
          [IDS.edge]: {
            childTopicId: IDS.child,
            id: IDS.edge,
            orderKey: 'a',
            parentTopicId: IDS.root,
            side: 'right',
          },
        },
        workCalendar: {
          exceptions: {},
          skipNonWorkingDays: false,
          timeZone: 'Etc/UTC',
          weekStartsOn: 1,
          workdayMinutes: 480,
          workingWeekdays: [1, 2, 3, 4, 5],
        },
        zones: {},
      },
    },
    styles: {},
    themes: {
      [IDS.theme]: {
        defaultStyles: {},
        id: IDS.theme,
        name: 'Default',
        rules: {},
        tokens: {},
      },
    },
    title: 'Document',
  };
}

function issueCodes(document: unknown): string[] {
  return validateMindMapInvariants(document).map((issue) => issue.code);
}

function addTopicImage(
  document: any,
  input: {
    id?: string;
    orderKey?: string;
    role?: 'inline' | 'thumbnail' | 'background' | 'sticker';
    side?: 'top' | 'bottom' | 'left' | 'right' | 'overlay';
    topicId?: string;
  } = {},
): any {
  document.assets[IDS.asset] ??= {
    byteSize: 16,
    fileName: 'topic-image.png',
    id: IDS.asset,
    intrinsicSize: { height: 16, width: 16 },
    mimeType: 'image/png',
    sha256: 'a'.repeat(64),
    source: { kind: 'managed', objectKey: 'mindmaps/topic-image.png' },
  };
  const imageId = input.id ?? IDS.image;
  const image = {
    assetId: IDS.asset,
    id: imageId,
    orderKey: input.orderKey ?? 'image-a',
    placement: {
      align: 'center',
      offset: { x: 0, y: 0 },
      side: input.side ?? 'top',
    },
    role: input.role ?? 'inline',
    topicId: input.topicId ?? IDS.root,
  };
  document.sheets[IDS.sheet].images[imageId] = image;
  return image;
}

describe('schema validation', () => {
  it('accepts a canonical minimal document', () => {
    const result = validateMindMapDocument(createValidDocument());

    expect(result).toMatchObject({
      invariantValid: true,
      issues: [],
      schemaValid: true,
      valid: true,
    });
  });

  it('accepts portable table cells in a topic Note', () => {
    const document = createValidDocument();
    document.sheets[IDS.sheet].notes[IDS.todo] = {
      id: IDS.todo,
      topicId: IDS.root,
      content: {
        type: 'doc',
        version: 1,
        blocks: [{
          type: 'table',
          rows: [{
            type: 'tableRow',
            cells: [
              { type: 'tableHeader', text: '项目' },
              { type: 'tableCell', text: '完成' },
            ],
          }],
        }],
      },
    };

    expect(validateMindMapDocument(document)).toMatchObject({ valid: true, issues: [] });
  });

  it('normalizes required and additional-property paths as JSON Pointers', () => {
    const missing = createValidDocument();
    delete missing.actors;
    expect(validateMindMapSchemaIssues(missing)).toContainEqual(
      expect.objectContaining({ code: 'schema.required', path: '/actors' }),
    );

    const additional = createValidDocument();
    additional.sheets[IDS.sheet].topics[IDS.root].unexpected = true;
    expect(validateMindMapSchemaIssues(additional)).toContainEqual(
      expect.objectContaining({
        code: 'schema.additionalProperties',
        path: `/sheets/${IDS.sheet}/topics/${IDS.root}/unexpected`,
      }),
    );
  });

  it('enforces date formats through ajv-formats', () => {
    const document = createValidDocument();
    document.sheets[IDS.sheet].todos[IDS.todo] = {
      completed: true,
      completedAt: 'not-a-date',
      id: IDS.todo,
      topicId: IDS.root,
    };

    expect(validateMindMapSchemaIssues(document)).toContainEqual(
      expect.objectContaining({
        code: 'schema.format',
        path: `/sheets/${IDS.sheet}/todos/${IDS.todo}/completedAt`,
      }),
    );
  });
});

describe('tree invariants', () => {
  it('requires exactly one central topic', () => {
    const document = createValidDocument();
    document.sheets[IDS.sheet].topics[IDS.parent] = {
      defaultCollapsed: false,
      id: IDS.parent,
      placement: { mode: 'auto' },
      role: 'central',
      sizing: { width: { mode: 'fit' } },
      title: richText,
    };

    expect(issueCodes(document)).toContain('invariant.tree.central-count');
  });

  it('detects missing parents, multiple parents, duplicate order keys, and cycles', () => {
    const missingParent = createValidDocument();
    missingParent.sheets[IDS.sheet].treeEdges[IDS.edge].parentTopicId = IDS.missing;
    expect(issueCodes(missingParent)).toContain('invariant.tree.parent-missing');

    const multipleParents = createValidDocument();
    multipleParents.sheets[IDS.sheet].topics[IDS.parent] = {
      defaultCollapsed: false,
      id: IDS.parent,
      placement: { mode: 'absolute', x: 10, y: 10 },
      role: 'floating-root',
      sizing: { width: { mode: 'fit' } },
      title: richText,
    };
    multipleParents.sheets[IDS.sheet].treeEdges[IDS.edge2] = {
      childTopicId: IDS.child,
      id: IDS.edge2,
      orderKey: 'b',
      parentTopicId: IDS.parent,
      side: 'inherit',
    };
    expect(issueCodes(multipleParents)).toContain('invariant.tree.multiple-parents');

    const duplicateOrder = createValidDocument();
    duplicateOrder.sheets[IDS.sheet].topics[IDS.child2] = {
      defaultCollapsed: false,
      id: IDS.child2,
      placement: { mode: 'auto' },
      role: 'regular',
      sizing: { width: { mode: 'fit' } },
      title: richText,
    };
    duplicateOrder.sheets[IDS.sheet].treeEdges[IDS.edge2] = {
      childTopicId: IDS.child2,
      id: IDS.edge2,
      orderKey: 'a',
      parentTopicId: IDS.root,
      side: 'right',
    };
    expect(issueCodes(duplicateOrder)).toContain('invariant.tree.order-key');

    const cycle = createValidDocument();
    cycle.sheets[IDS.sheet].treeEdges[IDS.edge2] = {
      childTopicId: IDS.root,
      id: IDS.edge2,
      orderKey: 'b',
      parentTopicId: IDS.child,
      side: 'inherit',
    };
    expect(issueCodes(cycle)).toContain('invariant.tree.cycle');
  });
});

describe('topic image invariants', () => {
  it.each([
    ['inline', 'top'],
    ['inline', 'bottom'],
    ['thumbnail', 'top'],
    ['thumbnail', 'bottom'],
    ['sticker', 'top'],
    ['sticker', 'bottom'],
    ['sticker', 'left'],
    ['sticker', 'right'],
    // Canonical compatibility only: product UI must not expose overlay.
    ['sticker', 'overlay'],
  ] as const)('accepts the canonical %s × %s placement combination', (role, side) => {
    const document = createValidDocument();
    addTopicImage(document, { role, side });

    expect(validateMindMapDocument(document)).toMatchObject({
      invariantValid: true,
      issues: [],
      schemaValid: true,
      valid: true,
    });
  });

  it.each([
    ['inline', 'left'],
    ['inline', 'right'],
    ['inline', 'overlay'],
    ['thumbnail', 'left'],
    ['thumbnail', 'right'],
    ['thumbnail', 'overlay'],
  ] as const)('rejects the ordinary %s × %s placement combination', (role, side) => {
    const document = createValidDocument();
    addTopicImage(document, { role, side });

    expect(validateMindMapDocument(document)).toMatchObject({
      invariantValid: false,
      schemaValid: true,
      valid: false,
    });
    expect(validateMindMapDocument(document).issues).toContainEqual(expect.objectContaining({
      code: 'invariant.image.placement',
      path: `/sheets/${IDS.sheet}/images/${IDS.image}/placement/side`,
    }));
  });

  it('keeps background direction compatibility without treating it as an ordinary image rule', () => {
    const document = createValidDocument();
    addTopicImage(document, { role: 'background', side: 'bottom' });

    expect(validateMindMapDocument(document)).toMatchObject({
      invariantValid: true,
      schemaValid: true,
      valid: true,
    });
  });

  it('requires unique image order keys within one topic but permits the same key on another topic', () => {
    const duplicate = createValidDocument();
    addTopicImage(duplicate, { id: IDS.image, orderKey: 'image-order', topicId: IDS.root });
    addTopicImage(duplicate, { id: IDS.image2, orderKey: 'image-order', topicId: IDS.root });
    expect(validateMindMapDocument(duplicate).issues).toContainEqual(expect.objectContaining({
      code: 'invariant.image.order-key',
      path: `/sheets/${IDS.sheet}/images/${IDS.image2}/orderKey`,
    }));

    const separatelyScoped = createValidDocument();
    addTopicImage(separatelyScoped, {
      id: IDS.image,
      orderKey: 'image-order',
      topicId: IDS.root,
    });
    addTopicImage(separatelyScoped, {
      id: IDS.image2,
      orderKey: 'image-order',
      topicId: IDS.child,
    });
    expect(validateMindMapDocument(separatelyScoped)).toMatchObject({ valid: true });
  });

  it.each([
    ['', 'schema.minLength'],
    ['contains whitespace', 'schema.pattern'],
    ['A'.repeat(257), 'schema.maxLength'],
  ])('rejects a non-persistent image order key without rewriting it', (orderKey, schemaCode) => {
    const document = createValidDocument();
    const image = addTopicImage(document, { orderKey });
    const before = structuredClone(document);

    expect(validateMindMapInvariants(document)).toContainEqual(expect.objectContaining({
      code: 'invariant.image.order-key-format',
      path: `/sheets/${IDS.sheet}/images/${IDS.image}/orderKey`,
    }));
    expect(validateMindMapDocument(document).issues).toContainEqual(expect.objectContaining({
      code: schemaCode,
      path: `/sheets/${IDS.sheet}/images/${IDS.image}/orderKey`,
    }));
    expect(image.orderKey).toBe(orderKey);
    expect(document).toEqual(before);
  });

  it('accepts the 256-character order-key boundary and rejects out-of-range placement data', () => {
    const boundary = createValidDocument();
    addTopicImage(boundary, { orderKey: 'A'.repeat(256) });
    expect(validateMindMapDocument(boundary)).toMatchObject({ valid: true });

    const outOfRange = createValidDocument();
    const image = addTopicImage(outOfRange);
    image.placement.offset.x = 1_000_001;
    const result = validateMindMapDocument(outOfRange);
    expect(result).toMatchObject({ schemaValid: false, valid: false });
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: 'schema.maximum',
      path: `/sheets/${IDS.sheet}/images/${IDS.image}/placement/offset/x`,
    }));
  });
});

describe('reference and graph invariants', () => {
  it('validates Record ids and document/sheet/topic references', () => {
    const document = createValidDocument();
    const sheet = document.sheets[IDS.sheet];
    sheet.topics[IDS.child].id = IDS.root;
    sheet.themeId = IDS.missing;
    sheet.attachments[IDS.attachment] = {
      assetId: IDS.missing,
      id: IDS.attachment,
      orderKey: 'a',
      topicId: IDS.missing,
    };
    document.savedViews[IDS.deck] = {
      id: IDS.deck,
      name: 'Missing sheet',
      orderKey: 'a',
      sheetId: IDS.missing,
      viewport: { x: 0, y: 0, zoom: 1 },
    };

    const codes = issueCodes(document);
    expect(codes).toEqual(
      expect.arrayContaining([
        'invariant.entity.map-key-id',
        'invariant.entity.duplicate-id',
        'invariant.reference.theme',
        'invariant.reference.topic',
        'invariant.saved-view.sheet-missing',
      ]),
    );
  });

  it('validates relationships and semantic-element references', () => {
    const document = createValidDocument();
    const sheet = document.sheets[IDS.sheet];
    sheet.relationships[IDS.relationship] = {
      endArrow: 'none',
      id: IDS.relationship,
      routing: 'curve',
      source: {
        anchor: 'auto',
        element: { kind: 'topic', topicId: IDS.root },
      },
      startArrow: 'none',
      target: {
        anchor: 'auto',
        element: { kind: 'topic', topicId: IDS.missing },
      },
    };
    sheet.boundaries[IDS.boundary] = {
      id: IDS.boundary,
      padding: 10,
      scope: { kind: 'explicit', topicIds: [IDS.missing] },
    };
    sheet.summaries[IDS.summary] = {
      id: IDS.summary,
      orientation: 'right',
      resultTopicId: IDS.missing,
      scope: { kind: 'explicit', topicIds: [IDS.child] },
    };
    sheet.callouts[IDS.callout] = {
      content: richText,
      id: IDS.callout,
      placement: { mode: 'auto' },
      tail: 'line',
      targetTopicId: IDS.missing,
    };

    const codes = issueCodes(document);
    expect(codes).toEqual(
      expect.arrayContaining([
        'invariant.relationship.endpoint-missing',
        'invariant.scope.topic-missing',
        'invariant.summary.result-missing',
        'invariant.callout.target-missing',
      ]),
    );
  });

  it('validates attachment and task dependency references', () => {
    const document = createValidDocument();
    const sheet = document.sheets[IDS.sheet];
    sheet.attachments[IDS.attachment] = {
      assetId: IDS.missing,
      id: IDS.attachment,
      orderKey: 'a',
      topicId: IDS.root,
    };
    sheet.tasks[IDS.task1] = {
      id: IDS.task1,
      progress: 0,
      status: 'not-started',
      topicId: IDS.root,
    };
    sheet.tasks[IDS.task2] = {
      id: IDS.task2,
      progress: 0,
      status: 'not-started',
      topicId: IDS.child,
    };
    sheet.taskDependencies[IDS.dependency1] = {
      id: IDS.dependency1,
      predecessorTaskId: IDS.task1,
      successorTaskId: IDS.task2,
      type: 'finish-start',
    };
    sheet.taskDependencies[IDS.dependency2] = {
      id: IDS.dependency2,
      predecessorTaskId: IDS.task2,
      successorTaskId: IDS.task1,
      type: 'finish-start',
    };

    const codes = issueCodes(document);
    expect(codes).toContain('invariant.reference.asset');
    expect(codes).toContain('invariant.task.dependency-cycle');
  });

  it('validates deck sheet/topic/slide/build/media references', () => {
    const document = createValidDocument();
    document.presentations[IDS.deck] = {
      aspectRatio: '16:9',
      id: IDS.deck,
      name: 'Presentation',
      settings: {
        animationsEnabled: true,
        delivery: 'walk-through',
        generationMode: 'auto',
        includedTopicIds: [IDS.missing],
        layout: 'auto',
        transition: 'fade',
      },
      sheetId: IDS.sheet,
      slides: {
        [IDS.slide]: {
          builds: {
            [IDS.build]: {
              animation: 'appear',
              id: IDS.build,
              orderKey: 'a',
              target: { kind: 'relationship', relationshipId: IDS.missing },
            },
          },
          id: IDS.slide,
          imageOverrides: {
            [IDS.missing]: { position: { xRatio: 0.5, yRatio: 0.5 } },
          },
          narrationAudioId: IDS.missing,
          orderKey: 'a',
          target: {
            includeDescendants: true,
            kind: 'topic',
            sheetId: IDS.sheet,
            topicId: IDS.missing,
          },
        },
      },
    };

    const codes = issueCodes(document);
    expect(codes).toEqual(
      expect.arrayContaining([
        'invariant.presentation.topic-missing',
        'invariant.presentation.target-missing',
        'invariant.presentation.audio-missing',
        'invariant.presentation.image-missing',
        'invariant.presentation.build-target-missing',
      ]),
    );
  });
});
