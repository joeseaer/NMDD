import { describe, expect, it } from 'vitest';

import {
  createNewMindMapDocument,
  createRichText,
  createTopic,
} from '../domain/defaults';
import { createOrderKeyBetween } from '../domain/orderKey';
import type {
  Boundary,
  BoundaryId,
  Callout,
  CalloutId,
  CommandId,
  DocumentId,
  MindMapDocumentV1,
  Relationship,
  RelationshipId,
  SheetId,
  Summary,
  SummaryId,
  ThemeId,
  Topic,
  TopicId,
  TreeEdgeId,
  ZoneId,
} from '../domain/types';
import { CommandValidationError } from './errors';
import { executeMindMapCommand } from './engine';
import { PatchCommandHistory } from './history';
import {
  MIND_MAP_COMMAND_TYPES,
  type CreateBoundaryCommand,
  type CreateCalloutCommand,
  type CreateRelationshipCommand,
  type CreateSummaryCommand,
  type CreateTopicCommand,
  type DeleteBoundaryCommand,
  type DeleteCalloutCommand,
  type DeleteRelationshipCommand,
  type DeleteSummaryCommand,
  type MindMapCommandExecution,
  type UpdateBoundaryCommand,
  type UpdateCalloutCommand,
  type UpdateRelationshipCommand,
  type UpdateSummaryCommand,
} from './types';

const IDS = {
  document: '018f0000-0000-7000-8000-000000000101' as DocumentId,
  sheet: '018f0000-0000-7000-8000-000000000102' as SheetId,
  theme: '018f0000-0000-7000-8000-000000000103' as ThemeId,
  root: '018f0000-0000-7000-8000-000000000104' as TopicId,
  a: '018f0000-0000-7000-8000-000000000105' as TopicId,
  b: '018f0000-0000-7000-8000-000000000106' as TopicId,
  edgeA: '018f0000-0000-7000-8000-000000000107' as TreeEdgeId,
  edgeB: '018f0000-0000-7000-8000-000000000108' as TreeEdgeId,
  relationship: '018f0000-0000-7000-8000-000000000109' as RelationshipId,
  boundary: '018f0000-0000-7000-8000-000000000110' as BoundaryId,
  summary: '018f0000-0000-7000-8000-000000000111' as SummaryId,
  summaryResult: '018f0000-0000-7000-8000-000000000112' as TopicId,
  summaryChild: '018f0000-0000-7000-8000-000000000113' as TopicId,
  summaryChildEdge: '018f0000-0000-7000-8000-000000000114' as TreeEdgeId,
  callout: '018f0000-0000-7000-8000-000000000115' as CalloutId,
  zone: '018f0000-0000-7000-8000-000000000116' as ZoneId,
  missingTopic: '018f0000-0000-7000-8000-000000000117' as TopicId,
  floatingA: '018f0000-0000-7000-8000-000000000118' as TopicId,
  floatingB: '018f0000-0000-7000-8000-000000000119' as TopicId,
  splitBoundary: '018f0000-0000-7000-8000-000000000120' as BoundaryId,
};

const timestamp = '2026-07-18T12:00:00.000Z';
const centerKey = createOrderKeyBetween();
const afterKey = createOrderKeyBetween(centerKey, null);

const commandId = (name: string): CommandId => `semantic-${name}` as CommandId;

const createDocument = (): MindMapDocumentV1 => {
  const document = createNewMindMapDocument({
    documentId: IDS.document,
    sheetId: IDS.sheet,
    rootTopicId: IDS.root,
    themeId: IDS.theme,
    sheetOrderKey: centerKey,
    rootTitle: 'Root',
  });
  const sheet = document.sheets[IDS.sheet];
  sheet.topics[IDS.a] = createTopic({ id: IDS.a, title: 'A' });
  sheet.topics[IDS.b] = createTopic({ id: IDS.b, title: 'B' });
  sheet.treeEdges[IDS.edgeA] = {
    id: IDS.edgeA,
    parentTopicId: IDS.root,
    childTopicId: IDS.a,
    orderKey: centerKey,
    side: 'right',
  };
  sheet.treeEdges[IDS.edgeB] = {
    id: IDS.edgeB,
    parentTopicId: IDS.root,
    childTopicId: IDS.b,
    orderKey: afterKey,
    side: 'right',
  };
  return document;
};

const relationship = (
  overrides: Partial<Relationship> = {},
): Relationship => ({
  id: IDS.relationship,
  source: { element: { kind: 'topic', topicId: IDS.a }, anchor: 'auto' },
  target: { element: { kind: 'topic', topicId: IDS.b }, anchor: 'auto' },
  routing: 'curve',
  startArrow: 'none',
  endArrow: 'triangle',
  ...overrides,
});

const boundary = (overrides: Partial<Boundary> = {}): Boundary => ({
  id: IDS.boundary,
  scope: { kind: 'explicit', topicIds: [IDS.a] },
  padding: 12,
  ...overrides,
});

const callout = (overrides: Partial<Callout> = {}): Callout => ({
  id: IDS.callout,
  targetTopicId: IDS.a,
  content: createRichText('Callout'),
  placement: { mode: 'auto', preferredSide: 'right' },
  tail: 'curve',
  ...overrides,
});

const summaryResult = (): Topic => createTopic({
  id: IDS.summaryResult,
  role: 'summary-result',
  title: 'Summary result',
});

const summary = (overrides: Partial<Summary> = {}): Summary => ({
  id: IDS.summary,
  scope: {
    kind: 'sibling-range',
    parentTopicId: IDS.root,
    firstEdgeId: IDS.edgeA,
    lastEdgeId: IDS.edgeA,
    includeDescendants: true,
  },
  resultTopicId: IDS.summaryResult,
  orientation: 'right',
  ...overrides,
});

const expectUndoRedoRoundTrip = <TCommand extends Parameters<typeof executeMindMapCommand>[1]>(
  before: MindMapDocumentV1,
  execution: MindMapCommandExecution<TCommand>,
): void => {
  const history = new PatchCommandHistory();
  history.record(execution.applied);
  const undone = history.undo(execution.document);
  expect(JSON.stringify(undone?.document)).toBe(JSON.stringify(before));
  const redone = history.redo(undone!.document);
  expect(JSON.stringify(redone?.document)).toBe(JSON.stringify(execution.document));
};

describe('semantic element commands', () => {
  it('creates, updates, and deletes Relationship without touching TreeEdge', () => {
    const initial = createDocument();
    const treeBefore = JSON.stringify(initial.sheets[IDS.sheet].treeEdges);
    const create: CreateRelationshipCommand = {
      commandId: commandId('relationship-create'),
      type: MIND_MAP_COMMAND_TYPES.createRelationship,
      sheetId: IDS.sheet,
      payload: { relationship: relationship() },
      baseRevision: 0,
      origin: 'test',
      timestamp,
    };
    const created = executeMindMapCommand(initial, create);
    expect(created.document.sheets[IDS.sheet].relationships[IDS.relationship]).toBeDefined();
    expect(JSON.stringify(created.document.sheets[IDS.sheet].treeEdges)).toBe(treeBefore);
    expectUndoRedoRoundTrip(initial, created);

    const update: UpdateRelationshipCommand = {
      ...create,
      commandId: commandId('relationship-update'),
      type: MIND_MAP_COMMAND_TYPES.updateRelationship,
      payload: {
        relationship: relationship({
          routing: 'orthogonal',
          title: createRichText('Depends on'),
          endArrow: 'diamond',
        }),
      },
      baseRevision: 1,
    };
    const updated = executeMindMapCommand(created.document, update);
    expect(updated.document.sheets[IDS.sheet].relationships[IDS.relationship])
      .toMatchObject({ routing: 'orthogonal', endArrow: 'diamond' });
    expectUndoRedoRoundTrip(created.document, updated);

    const remove: DeleteRelationshipCommand = {
      ...create,
      commandId: commandId('relationship-delete'),
      type: MIND_MAP_COMMAND_TYPES.deleteRelationship,
      payload: { relationshipId: IDS.relationship },
      baseRevision: 2,
    };
    const deleted = executeMindMapCommand(updated.document, remove);
    expect(deleted.document.sheets[IDS.sheet].relationships[IDS.relationship]).toBeUndefined();
    expect(JSON.stringify(deleted.document.sheets[IDS.sheet].treeEdges)).toBe(treeBefore);
    expectUndoRedoRoundTrip(updated.document, deleted);
  });

  it('creates/updates Boundary and cascades only its endpoint Relationships on delete', () => {
    const initial = createDocument();
    const create: CreateBoundaryCommand = {
      commandId: commandId('boundary-create'),
      type: MIND_MAP_COMMAND_TYPES.createBoundary,
      sheetId: IDS.sheet,
      payload: { boundary: boundary() },
      baseRevision: 0,
      origin: 'test',
      timestamp,
    };
    const created = executeMindMapCommand(initial, create);
    expectUndoRedoRoundTrip(initial, created);

    const update: UpdateBoundaryCommand = {
      ...create,
      commandId: commandId('boundary-update'),
      type: MIND_MAP_COMMAND_TYPES.updateBoundary,
      payload: { boundary: boundary({ padding: 24, title: createRichText('Group') }) },
      baseRevision: 1,
    };
    const updated = executeMindMapCommand(created.document, update);
    expect(updated.document.sheets[IDS.sheet].boundaries[IDS.boundary].padding).toBe(24);
    expectUndoRedoRoundTrip(created.document, updated);

    const withRelationship = executeMindMapCommand(updated.document, {
      commandId: commandId('boundary-relationship'),
      type: MIND_MAP_COMMAND_TYPES.createRelationship,
      sheetId: IDS.sheet,
      payload: {
        relationship: relationship({
          source: {
            element: { kind: 'boundary', boundaryId: IDS.boundary },
            anchor: 'right',
          },
        }),
      },
      baseRevision: 2,
      origin: 'test',
      timestamp,
    }).document;
    const remove: DeleteBoundaryCommand = {
      ...create,
      commandId: commandId('boundary-delete'),
      type: MIND_MAP_COMMAND_TYPES.deleteBoundary,
      payload: { boundaryId: IDS.boundary },
      baseRevision: 3,
    };
    const deleted = executeMindMapCommand(withRelationship, remove);
    const deletedSheet = deleted.document.sheets[IDS.sheet];
    expect(deletedSheet.boundaries[IDS.boundary]).toBeUndefined();
    expect(deletedSheet.relationships[IDS.relationship]).toBeUndefined();
    expect(deletedSheet.topics[IDS.a]).toBeDefined();
    expect(deletedSheet.treeEdges[IDS.edgeA]).toBeDefined();
    expectUndoRedoRoundTrip(withRelationship, deleted);
  });

  it('rejects split-create payloads that bypass whole-selection Boundary rules', () => {
    const initial = createDocument();
    const sheet = initial.sheets[IDS.sheet];
    sheet.topics[IDS.floatingA] = createTopic({
      id: IDS.floatingA,
      role: 'floating-root',
      title: 'Floating A',
      placement: { mode: 'absolute', x: 700, y: 100 },
    });
    sheet.topics[IDS.floatingB] = createTopic({
      id: IDS.floatingB,
      role: 'floating-root',
      title: 'Floating B',
      placement: { mode: 'absolute', x: 700, y: 300 },
    });
    const malicious: CreateBoundaryCommand = {
      commandId: commandId('boundary-multiple-floating-bypass'),
      type: MIND_MAP_COMMAND_TYPES.createBoundary,
      sheetId: IDS.sheet,
      payload: {
        selectedTopicIds: [IDS.floatingA, IDS.floatingB],
        boundary: boundary({
          scope: { kind: 'subtree', rootTopicId: IDS.floatingA, depth: 'all' },
        }),
        additionalBoundaries: [{
          ...boundary({
            scope: { kind: 'subtree', rootTopicId: IDS.floatingB, depth: 'all' },
          }),
          id: IDS.splitBoundary,
        }],
      },
      baseRevision: 0,
      origin: 'test',
      timestamp,
    };
    expect(() => executeMindMapCommand(initial, malicious))
      .toThrow(/multiple floating roots/i);
    expect(initial.contentRevision).toBe(0);

    const unprovableSplit: CreateBoundaryCommand = {
      ...malicious,
      commandId: commandId('boundary-unprovable-split'),
      payload: {
        boundary: boundary(),
        additionalBoundaries: [{
          ...boundary({ scope: { kind: 'explicit', topicIds: [IDS.b] } }),
          id: IDS.splitBoundary,
        }],
      },
    };
    expect(() => executeMindMapCommand(initial, unprovableSplit))
      .toThrow(/requires selectedTopicIds/i);
    expect(initial.contentRevision).toBe(0);
  });

  it('creates/updates Callout and cascades its Zone Relationship on delete', () => {
    const initial = createDocument();
    initial.sheets[IDS.sheet].zones[IDS.zone] = {
      id: IDS.zone,
      rootTopicIds: [],
      rect: { x: 0, y: 0, width: 400, height: 300 },
      autoResize: false,
      lockAspectRatio: false,
      collapsed: false,
      zOrderKey: centerKey,
      padding: 20,
    };
    const create: CreateCalloutCommand = {
      commandId: commandId('callout-create'),
      type: MIND_MAP_COMMAND_TYPES.createCallout,
      sheetId: IDS.sheet,
      payload: { callout: callout() },
      baseRevision: 0,
      origin: 'test',
      timestamp,
    };
    const created = executeMindMapCommand(initial, create);
    expectUndoRedoRoundTrip(initial, created);

    const update: UpdateCalloutCommand = {
      ...create,
      commandId: commandId('callout-update'),
      type: MIND_MAP_COMMAND_TYPES.updateCallout,
      payload: {
        callout: callout({
          content: createRichText('Updated callout'),
          placement: { mode: 'offset', dx: 20, dy: -10 },
          tail: 'triangle',
        }),
      },
      baseRevision: 1,
    };
    const updated = executeMindMapCommand(created.document, update);
    expect(updated.document.sheets[IDS.sheet].callouts[IDS.callout].tail).toBe('triangle');
    expectUndoRedoRoundTrip(created.document, updated);

    const withRelationship = executeMindMapCommand(updated.document, {
      commandId: commandId('callout-zone-relationship'),
      type: MIND_MAP_COMMAND_TYPES.createRelationship,
      sheetId: IDS.sheet,
      payload: {
        relationship: relationship({
          source: {
            element: { kind: 'callout', calloutId: IDS.callout },
            anchor: 'auto',
          },
          target: { element: { kind: 'zone', zoneId: IDS.zone }, anchor: 'auto' },
        }),
      },
      baseRevision: 2,
      origin: 'test',
      timestamp,
    }).document;
    const remove: DeleteCalloutCommand = {
      ...create,
      commandId: commandId('callout-delete'),
      type: MIND_MAP_COMMAND_TYPES.deleteCallout,
      payload: { calloutId: IDS.callout },
      baseRevision: 3,
    };
    const deleted = executeMindMapCommand(withRelationship, remove);
    const deletedSheet = deleted.document.sheets[IDS.sheet];
    expect(deletedSheet.callouts[IDS.callout]).toBeUndefined();
    expect(deletedSheet.relationships[IDS.relationship]).toBeUndefined();
    expect(deletedSheet.zones[IDS.zone]).toBeDefined();
    expect(deletedSheet.topics[IDS.a]).toBeDefined();
    expectUndoRedoRoundTrip(withRelationship, deleted);
  });

  it('creates/updates Summary atomically and deletes its complete result subtree', () => {
    const initial = createDocument();
    const create: CreateSummaryCommand = {
      commandId: commandId('summary-create'),
      type: MIND_MAP_COMMAND_TYPES.createSummary,
      sheetId: IDS.sheet,
      payload: {
        selectedTopicIds: [IDS.a],
        creations: [{ summary: summary(), resultTopic: summaryResult() }],
      },
      baseRevision: 0,
      origin: 'test',
      timestamp,
    };
    const created = executeMindMapCommand(initial, create);
    expect(created.document.sheets[IDS.sheet].topics[IDS.summaryResult].role)
      .toBe('summary-result');
    expectUndoRedoRoundTrip(initial, created);

    const update: UpdateSummaryCommand = {
      ...create,
      commandId: commandId('summary-update'),
      type: MIND_MAP_COMMAND_TYPES.updateSummary,
      payload: { summary: summary({ orientation: 'bottom' }) },
      baseRevision: 1,
    };
    const updated = executeMindMapCommand(created.document, update);
    expect(updated.document.sheets[IDS.sheet].summaries[IDS.summary].orientation).toBe('bottom');
    expectUndoRedoRoundTrip(created.document, updated);

    const createChild: CreateTopicCommand = {
      commandId: commandId('summary-child-create'),
      type: MIND_MAP_COMMAND_TYPES.createTopic,
      sheetId: IDS.sheet,
      payload: {
        topic: createTopic({ id: IDS.summaryChild, title: 'Summary child' }),
        edge: {
          id: IDS.summaryChildEdge,
          parentTopicId: IDS.summaryResult,
          childTopicId: IDS.summaryChild,
          orderKey: centerKey,
          side: 'right',
        },
      },
      baseRevision: 2,
      origin: 'test',
      timestamp,
    };
    const withChild = executeMindMapCommand(updated.document, createChild).document;
    const withRelationship = executeMindMapCommand(withChild, {
      commandId: commandId('summary-relationship'),
      type: MIND_MAP_COMMAND_TYPES.createRelationship,
      sheetId: IDS.sheet,
      payload: {
        relationship: relationship({
          source: {
            element: { kind: 'topic', topicId: IDS.summaryResult },
            anchor: 'auto',
          },
        }),
      },
      baseRevision: 3,
      origin: 'test',
      timestamp,
    }).document;
    const remove: DeleteSummaryCommand = {
      ...create,
      commandId: commandId('summary-delete'),
      type: MIND_MAP_COMMAND_TYPES.deleteSummary,
      payload: { summaryId: IDS.summary },
      baseRevision: 4,
    };
    const deleted = executeMindMapCommand(withRelationship, remove);
    const deletedSheet = deleted.document.sheets[IDS.sheet];
    expect(deletedSheet.summaries[IDS.summary]).toBeUndefined();
    expect(deletedSheet.topics[IDS.summaryResult]).toBeUndefined();
    expect(deletedSheet.topics[IDS.summaryChild]).toBeUndefined();
    expect(deletedSheet.treeEdges[IDS.summaryChildEdge]).toBeUndefined();
    expect(deletedSheet.relationships[IDS.relationship]).toBeUndefined();
    expect(deletedSheet.topics[IDS.a]).toBeDefined();
    expectUndoRedoRoundTrip(withRelationship, deleted);
  });

  it('rejects missing references and illegal Relationship endpoint pairs before mutation', () => {
    const initial = createDocument();
    const commands = [
      {
        commandId: commandId('bad-relationship-reference'),
        type: MIND_MAP_COMMAND_TYPES.createRelationship,
        sheetId: IDS.sheet,
        payload: {
          relationship: relationship({
            target: {
              element: { kind: 'topic', topicId: IDS.missingTopic },
              anchor: 'auto',
            },
          }),
        },
        baseRevision: 0,
        origin: 'test',
        timestamp,
      } satisfies CreateRelationshipCommand,
      {
        commandId: commandId('bad-boundary-reference'),
        type: MIND_MAP_COMMAND_TYPES.createBoundary,
        sheetId: IDS.sheet,
        payload: {
          boundary: boundary({
            scope: { kind: 'explicit', topicIds: [IDS.missingTopic] },
          }),
        },
        baseRevision: 0,
        origin: 'test',
        timestamp,
      } satisfies CreateBoundaryCommand,
      {
        commandId: commandId('bad-summary-result-role'),
        type: MIND_MAP_COMMAND_TYPES.createSummary,
        sheetId: IDS.sheet,
        payload: {
          selectedTopicIds: [IDS.a],
          creations: [{
            summary: summary(),
            resultTopic: createTopic({ id: IDS.summaryResult, role: 'regular' }),
          }],
        },
        baseRevision: 0,
        origin: 'test',
        timestamp,
      } satisfies CreateSummaryCommand,
      {
        commandId: commandId('bad-callout-reference'),
        type: MIND_MAP_COMMAND_TYPES.createCallout,
        sheetId: IDS.sheet,
        payload: { callout: callout({ targetTopicId: IDS.missingTopic }) },
        baseRevision: 0,
        origin: 'test',
        timestamp,
      } satisfies CreateCalloutCommand,
    ];

    for (const command of commands) {
      expect(() => executeMindMapCommand(initial, command)).toThrow(CommandValidationError);
      expect(initial.contentRevision).toBe(0);
    }

    const withCallout = executeMindMapCommand(initial, {
      commandId: commandId('legal-callout'),
      type: MIND_MAP_COMMAND_TYPES.createCallout,
      sheetId: IDS.sheet,
      payload: { callout: callout() },
      baseRevision: 0,
      origin: 'test',
      timestamp,
    }).document;
    const illegalPair: CreateRelationshipCommand = {
      commandId: commandId('illegal-callout-topic'),
      type: MIND_MAP_COMMAND_TYPES.createRelationship,
      sheetId: IDS.sheet,
      payload: {
        relationship: relationship({
          source: {
            element: { kind: 'callout', calloutId: IDS.callout },
            anchor: 'auto',
          },
        }),
      },
      baseRevision: 1,
      origin: 'test',
      timestamp,
    };
    expect(() => executeMindMapCommand(withCallout, illegalPair))
      .toThrow(CommandValidationError);
    expect(withCallout.contentRevision).toBe(1);
  });
});
