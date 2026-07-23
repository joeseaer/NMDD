import { describe, expect, it } from 'vitest';

import {
  createNewMindMapDocument,
  createRichText,
  createTopic,
} from '../domain/defaults';
import { createOrderKeyBetween } from '../domain/orderKey';
import { getChildEdgesSorted } from '../domain/tree';
import type {
  BoundaryId,
  CalloutId,
  CommandId,
  DocumentId,
  Id,
  MindMapDocumentV1,
  NoteId,
  RelationshipId,
  SheetId,
  SummaryId,
  ThemeId,
  TopicId,
  TreeEdgeId,
  ZoneId,
} from '../domain/types';
import {
  planDeleteCurrentTopicCommand,
  planDeleteTopicSubtreeCommand,
  planInsertParentTopicCommand,
} from '../ui/commandPlanning';
import { planReorderTopicCommand, planReparentTopicCommand } from '../ui/dragPlanning';
import { createMindMapElementsFixture } from '../testing/fixtures';
import { executeMindMapCommand } from './engine';
import { CommandValidationError } from './errors';
import { PatchCommandHistory } from './history';
import {
  MIND_MAP_COMMAND_TYPES,
  type DeleteCurrentTopicCommand,
} from './types';

const id = <Kind extends string>(suffix: string): Id<Kind> =>
  `019b0000-0000-7000-8000-${suffix.padStart(12, '0')}` as Id<Kind>;

const IDS = {
  document: id<'Document'>('1') as DocumentId,
  sheet: id<'Sheet'>('2') as SheetId,
  theme: id<'Theme'>('3') as ThemeId,
  root: id<'Topic'>('4') as TopicId,
  before: id<'Topic'>('5') as TopicId,
  target: id<'Topic'>('6') as TopicId,
  after: id<'Topic'>('7') as TopicId,
  childA: id<'Topic'>('8') as TopicId,
  childB: id<'Topic'>('9') as TopicId,
  grandchild: id<'Topic'>('10') as TopicId,
  insertedParent: id<'Topic'>('11') as TopicId,
  edgeBefore: id<'TreeEdge'>('12') as TreeEdgeId,
  edgeTarget: id<'TreeEdge'>('13') as TreeEdgeId,
  edgeAfter: id<'TreeEdge'>('14') as TreeEdgeId,
  edgeChildA: id<'TreeEdge'>('15') as TreeEdgeId,
  edgeChildB: id<'TreeEdge'>('16') as TreeEdgeId,
  edgeGrandchild: id<'TreeEdge'>('17') as TreeEdgeId,
  insertedChildEdge: id<'TreeEdge'>('18') as TreeEdgeId,
  boundary: id<'Boundary'>('19') as BoundaryId,
  relationship: id<'Relationship'>('20') as RelationshipId,
  callout: id<'Callout'>('21') as CalloutId,
  childNote: id<'Note'>('22') as NoteId,
  targetNote: id<'Note'>('23') as NoteId,
  insertCommand: id<'Command'>('24') as CommandId,
  deleteCommand: id<'Command'>('25') as CommandId,
  reorderCommand: id<'Command'>('26') as CommandId,
  summary: id<'Summary'>('27') as SummaryId,
  summaryResult: id<'Topic'>('28') as TopicId,
  summaryResultChild: id<'Topic'>('29') as TopicId,
  summaryResultChildEdge: id<'TreeEdge'>('30') as TreeEdgeId,
  summaryResultNote: id<'Note'>('31') as NoteId,
  nestedSummary: id<'Summary'>('35') as SummaryId,
  nestedSummaryResult: id<'Topic'>('36') as TopicId,
  resultBoundary: id<'Boundary'>('39') as BoundaryId,
  resultCallout: id<'Callout'>('40') as CalloutId,
  internalResultRelationship: id<'Relationship'>('41') as RelationshipId,
  crossResultRelationship: id<'Relationship'>('42') as RelationshipId,
  externalFloating: id<'Topic'>('43') as TopicId,
  externalZone: id<'Zone'>('44') as ZoneId,
  zoneResultRelationship: id<'Relationship'>('45') as RelationshipId,
};

const keys = {
  before: createOrderKeyBetween(null, createOrderKeyBetween()),
  target: createOrderKeyBetween(),
  after: createOrderKeyBetween(createOrderKeyBetween(), null),
  childA: createOrderKeyBetween(null, createOrderKeyBetween()),
  childB: createOrderKeyBetween(createOrderKeyBetween(), null),
};

const timestamp = '2026-07-19T08:00:00.000Z';

const createDocument = (): MindMapDocumentV1 => {
  const document = createNewMindMapDocument({
    documentId: IDS.document,
    sheetId: IDS.sheet,
    rootTopicId: IDS.root,
    themeId: IDS.theme,
    sheetOrderKey: createOrderKeyBetween(),
    rootTitle: 'Root',
  });
  const sheet = document.sheets[IDS.sheet];
  for (const [topicId, title] of [
    [IDS.before, 'Before'],
    [IDS.target, 'Target'],
    [IDS.after, 'After'],
    [IDS.childA, 'Child A'],
    [IDS.childB, 'Child B'],
    [IDS.grandchild, 'Grandchild'],
  ] as const) sheet.topics[topicId] = createTopic({ id: topicId, title });
  sheet.treeEdges[IDS.edgeBefore] = {
    id: IDS.edgeBefore,
    parentTopicId: IDS.root,
    childTopicId: IDS.before,
    orderKey: keys.before,
    side: 'left',
    slot: 'lane-a',
  };
  sheet.treeEdges[IDS.edgeTarget] = {
    id: IDS.edgeTarget,
    parentTopicId: IDS.root,
    childTopicId: IDS.target,
    orderKey: keys.target,
    side: 'left',
    slot: 'lane-a',
    style: { inheritance: 'break', overrides: { shape: 'rounded-rectangle' } },
  };
  sheet.treeEdges[IDS.edgeAfter] = {
    id: IDS.edgeAfter,
    parentTopicId: IDS.root,
    childTopicId: IDS.after,
    orderKey: keys.after,
    side: 'left',
    slot: 'lane-a',
  };
  sheet.treeEdges[IDS.edgeChildA] = {
    id: IDS.edgeChildA,
    parentTopicId: IDS.target,
    childTopicId: IDS.childA,
    orderKey: keys.childA,
    side: 'right',
    style: { overrides: { shape: 'ellipse' } },
  };
  sheet.treeEdges[IDS.edgeChildB] = {
    id: IDS.edgeChildB,
    parentTopicId: IDS.target,
    childTopicId: IDS.childB,
    orderKey: keys.childB,
    side: 'bottom',
    slot: 'old-slot',
  };
  sheet.treeEdges[IDS.edgeGrandchild] = {
    id: IDS.edgeGrandchild,
    parentTopicId: IDS.childA,
    childTopicId: IDS.grandchild,
    orderKey: createOrderKeyBetween(),
    side: 'inherit',
  };
  return document;
};

describe('P0 structural topic commands', () => {
  it('splits a Summary atomically and clones its complete result subtree/content', () => {
    const document = createDocument();
    const sheet = document.sheets[IDS.sheet];
    sheet.topics[IDS.summaryResult] = createTopic({
      id: IDS.summaryResult,
      role: 'summary-result',
      title: 'Summary result',
    });
    sheet.topics[IDS.summaryResult].style = {
      inheritance: 'break',
      overrides: { shape: 'rounded-rectangle' },
    };
    sheet.topics[IDS.summaryResult].extensions = { 'app.nmdd.vendor': { retained: true } };
    sheet.topics[IDS.summaryResultChild] = createTopic({
      id: IDS.summaryResultChild,
      title: 'Result child',
    });
    sheet.treeEdges[IDS.summaryResultChildEdge] = {
      id: IDS.summaryResultChildEdge,
      parentTopicId: IDS.summaryResult,
      childTopicId: IDS.summaryResultChild,
      orderKey: createOrderKeyBetween(),
      side: 'right',
    };
    sheet.notes[IDS.summaryResultNote] = {
      id: IDS.summaryResultNote,
      topicId: IDS.summaryResultChild,
      content: createRichText('Cloned note'),
    };
    sheet.topics[IDS.nestedSummaryResult] = createTopic({
      id: IDS.nestedSummaryResult,
      role: 'summary-result',
      title: 'Nested result',
    });
    sheet.summaries[IDS.nestedSummary] = {
      id: IDS.nestedSummary,
      scope: { kind: 'explicit', topicIds: [IDS.summaryResultChild] },
      resultTopicId: IDS.nestedSummaryResult,
      orientation: 'bottom',
      extensions: { 'app.nmdd.nested': { retained: true } },
    };
    sheet.boundaries[IDS.resultBoundary] = {
      id: IDS.resultBoundary,
      scope: { kind: 'subtree', rootTopicId: IDS.summaryResultChild, depth: 'all' },
      title: createRichText('Result boundary'),
      padding: 14,
    };
    sheet.callouts[IDS.resultCallout] = {
      id: IDS.resultCallout,
      targetTopicId: IDS.summaryResultChild,
      content: createRichText('Result callout'),
      placement: { mode: 'auto', preferredSide: 'bottom' },
      tail: 'curve',
    };
    const controlPointId = id<'RelationshipControlPoint'>('46');
    sheet.relationships[IDS.internalResultRelationship] = {
      id: IDS.internalResultRelationship,
      source: { element: { kind: 'boundary', boundaryId: IDS.resultBoundary }, anchor: 'right' },
      target: { element: { kind: 'topic', topicId: IDS.summaryResultChild }, anchor: 'left' },
      routing: 'manual',
      controlPoints: {
        [controlPointId]: { id: controlPointId, orderKey: createOrderKeyBetween(), x: 12, y: 24 },
      },
      startArrow: 'none',
      endArrow: 'triangle',
    };
    sheet.relationships[IDS.crossResultRelationship] = {
      id: IDS.crossResultRelationship,
      source: { element: { kind: 'topic', topicId: IDS.summaryResultChild }, anchor: 'right' },
      target: { element: { kind: 'topic', topicId: IDS.root }, anchor: 'left' },
      routing: 'curve',
      startArrow: 'none',
      endArrow: 'open-triangle',
    };
    sheet.topics[IDS.externalFloating] = createTopic({
      id: IDS.externalFloating,
      role: 'floating-root',
      title: 'External zone root',
      placement: { mode: 'absolute', x: 800, y: 200 },
    });
    sheet.zones[IDS.externalZone] = {
      id: IDS.externalZone,
      rootTopicIds: [IDS.externalFloating],
      rect: { x: 760, y: 160, width: 320, height: 220 },
      autoResize: false,
      lockAspectRatio: false,
      collapsed: false,
      zOrderKey: 'z',
      padding: 20,
    };
    sheet.relationships[IDS.zoneResultRelationship] = {
      id: IDS.zoneResultRelationship,
      source: { element: { kind: 'topic', topicId: IDS.summaryResultChild }, anchor: 'right' },
      target: { element: { kind: 'zone', zoneId: IDS.externalZone }, anchor: 'left' },
      routing: 'straight',
      startArrow: 'none',
      endArrow: 'triangle',
    };
    sheet.summaries[IDS.summary] = {
      id: IDS.summary,
      scope: {
        kind: 'sibling-range',
        parentTopicId: IDS.root,
        firstEdgeId: IDS.edgeBefore,
        lastEdgeId: IDS.edgeAfter,
        includeDescendants: true,
      },
      resultTopicId: IDS.summaryResult,
      orientation: 'right',
      style: { overrides: { border: { width: 3 } } },
      extensions: { 'app.nmdd.vendor': { retained: true } },
    };
    const before = JSON.stringify(document);
    const command = planReorderTopicCommand({
      document,
      sheetId: IDS.sheet,
      topicId: IDS.target,
      index: 1,
      side: 'right',
      commandId: IDS.reorderCommand,
      timestamp,
      origin: 'test',
    });
    const change = command.payload.summaryScopeChanges?.[0];
    expect(change?.summaryId).toBe(IDS.summary);
    expect(change?.replacements).toHaveLength(2);
    expect(change?.replacements[0].summary).toMatchObject({
      id: IDS.summary,
      resultTopicId: IDS.summaryResult,
      scope: {
        kind: 'sibling-range',
        firstEdgeId: IDS.edgeBefore,
        lastEdgeId: IDS.edgeAfter,
      },
    });
    const split = change!.replacements[1];
    expect(split.resultSubtree?.topics).toHaveLength(3);
    expect(split.resultSubtree?.treeEdges).toHaveLength(1);
    expect(split.resultSubtree?.notes).toHaveLength(1);
    expect(split.resultSubtree?.summaries).toHaveLength(1);
    expect(split.resultSubtree?.boundaries).toHaveLength(1);
    expect(split.resultSubtree?.callouts).toHaveLength(1);
    expect(split.resultSubtree?.relationships).toHaveLength(1);
    expect(split.resultSubtree?.zones).toEqual([]);
    expect(split.summary.resultTopicId).toBe(split.resultSubtree!.topics[0].id);

    const execution = executeMindMapCommand(document, command);
    const nextSheet = execution.document.sheets[IDS.sheet];
    expect(Object.keys(nextSheet.summaries)).toHaveLength(4);
    expect(Object.keys(nextSheet.summaries)).toEqual(expect.arrayContaining([
      IDS.summary,
      IDS.nestedSummary,
      split.summary.id,
    ]));
    expect(nextSheet.topics[split.summary.resultTopicId]).toMatchObject({
      role: 'summary-result',
      title: sheet.topics[IDS.summaryResult].title,
      style: sheet.topics[IDS.summaryResult].style,
      extensions: sheet.topics[IDS.summaryResult].extensions,
    });
    const clonedChild = split.resultSubtree!.topics[1];
    const clonedNestedResult = split.resultSubtree!.topics[2];
    expect(nextSheet.notes[split.resultSubtree!.notes[0].id]).toMatchObject({
      topicId: clonedChild.id,
      content: sheet.notes[IDS.summaryResultNote].content,
    });
    const clonedNestedSummary = split.resultSubtree!.summaries[0];
    expect(nextSheet.summaries[clonedNestedSummary.id]).toMatchObject({
      id: clonedNestedSummary.id,
      scope: { kind: 'explicit', topicIds: [clonedChild.id] },
      resultTopicId: clonedNestedResult.id,
      orientation: 'bottom',
      extensions: { 'app.nmdd.nested': { retained: true } },
    });
    expect(nextSheet.topics[clonedNestedResult.id].role).toBe('summary-result');
    const clonedBoundary = split.resultSubtree!.boundaries[0];
    expect(nextSheet.boundaries[clonedBoundary.id].scope).toEqual({
      kind: 'subtree',
      rootTopicId: clonedChild.id,
      depth: 'all',
    });
    const clonedCallout = split.resultSubtree!.callouts[0];
    expect(nextSheet.callouts[clonedCallout.id].targetTopicId).toBe(clonedChild.id);
    const clonedRelationship = split.resultSubtree!.relationships[0];
    expect(nextSheet.relationships[clonedRelationship.id]).toMatchObject({
      source: { element: { kind: 'boundary', boundaryId: clonedBoundary.id } },
      target: { element: { kind: 'topic', topicId: clonedChild.id } },
    });
    expect(Object.values(nextSheet.relationships[clonedRelationship.id].controlPoints ?? {}))
      .toHaveLength(1);
    expect(Object.keys(nextSheet.relationships[clonedRelationship.id].controlPoints ?? {}))
      .not.toContain(controlPointId);
    expect(Object.keys(nextSheet.relationships).sort()).toEqual([
      IDS.internalResultRelationship,
      IDS.crossResultRelationship,
      IDS.zoneResultRelationship,
      clonedRelationship.id,
    ].sort());
    expect(Object.keys(nextSheet.zones)).toEqual([IDS.externalZone]);
    const clonedRelationshipTargets = [
      nextSheet.relationships[clonedRelationship.id].source.element,
      nextSheet.relationships[clonedRelationship.id].target.element,
    ];
    expect(clonedRelationshipTargets).not.toContainEqual({ kind: 'topic', topicId: IDS.root });
    expect(clonedRelationshipTargets).not.toContainEqual({ kind: 'zone', zoneId: IDS.externalZone });
    expect(nextSheet.topics[split.summary.resultTopicId].style)
      .not.toBe(nextSheet.topics[IDS.summaryResult].style);
    expect(nextSheet.summaries[split.summary.id].extensions)
      .not.toBe(nextSheet.summaries[IDS.summary].extensions);

    const history = new PatchCommandHistory();
    history.record(execution.applied);
    expect(JSON.stringify(history.undo(execution.document)?.document)).toBe(before);

    const malformed = structuredClone(command);
    delete malformed.payload.summaryScopeChanges;
    expect(() => executeMindMapCommand(document, malformed)).toThrow(CommandValidationError);
    const incompleteSemanticClone = structuredClone(command);
    incompleteSemanticClone.payload.summaryScopeChanges![0].replacements[1]
      .resultSubtree!.boundaries = [];
    expect(() => executeMindMapCommand(document, incompleteSemanticClone))
      .toThrow(CommandValidationError);
  });

  it('shrinks a Summary without deleting its result when one scoped member is removed', () => {
    const document = createDocument();
    const sheet = document.sheets[IDS.sheet];
    sheet.topics[IDS.summaryResult] = createTopic({
      id: IDS.summaryResult,
      role: 'summary-result',
      title: 'Surviving result',
    });
    sheet.summaries[IDS.summary] = {
      id: IDS.summary,
      scope: {
        kind: 'sibling-range',
        parentTopicId: IDS.root,
        firstEdgeId: IDS.edgeBefore,
        lastEdgeId: IDS.edgeAfter,
        includeDescendants: true,
      },
      resultTopicId: IDS.summaryResult,
      orientation: 'left',
    };
    const command = planDeleteTopicSubtreeCommand({
      document,
      sheetId: IDS.sheet,
      topicId: IDS.target,
      commandId: IDS.deleteCommand,
      timestamp,
      origin: 'test',
    });
    // The same endpoint IDs naturally encode the exact surviving Before/After
    // range after Target disappears, so no replacement payload is necessary.
    expect(command.payload.summaryScopeChanges).toBeUndefined();
    const next = executeMindMapCommand(document, command).document.sheets[IDS.sheet];
    expect(next.summaries[IDS.summary]).toBeDefined();
    expect(next.topics[IDS.summaryResult]).toMatchObject({ role: 'summary-result' });
    expect(next.topics[IDS.target]).toBeUndefined();
  });

  it('deletes an empty Summary/result tree and normalizes reparent/delete-current atomically', () => {
    let document = createDocument();
    let sheet = document.sheets[IDS.sheet];
    sheet.topics[IDS.summaryResult] = createTopic({
      id: IDS.summaryResult,
      role: 'summary-result',
      title: 'Owned result',
    });
    sheet.summaries[IDS.summary] = {
      id: IDS.summary,
      scope: {
        kind: 'sibling-range',
        parentTopicId: IDS.root,
        firstEdgeId: IDS.edgeTarget,
        lastEdgeId: IDS.edgeTarget,
        includeDescendants: true,
      },
      resultTopicId: IDS.summaryResult,
      orientation: 'auto',
    };

    const reparent = planReparentTopicCommand({
      document,
      sheetId: IDS.sheet,
      topicId: IDS.target,
      parentTopicId: IDS.after,
      commandId: id<'Command'>('32'),
      timestamp,
      origin: 'test',
    });
    expect(reparent.payload.summaryScopeChanges?.[0].replacements[0].summary).toMatchObject({
      id: IDS.summary,
      resultTopicId: IDS.summaryResult,
      scope: { kind: 'sibling-range', parentTopicId: IDS.after },
    });
    document = executeMindMapCommand(document, reparent).document;
    expect(document.sheets[IDS.sheet].topics[IDS.summaryResult]).toBeDefined();

    const deleteCurrent = planDeleteCurrentTopicCommand({
      document,
      sheetId: IDS.sheet,
      topicId: IDS.target,
      commandId: id<'Command'>('33'),
      timestamp,
      origin: 'test',
    });
    expect(deleteCurrent.payload.summaryScopeChanges?.[0].replacements).toHaveLength(1);
    document = executeMindMapCommand(document, deleteCurrent).document;
    sheet = document.sheets[IDS.sheet];
    expect(sheet.topics[IDS.target]).toBeUndefined();
    expect(sheet.topics[IDS.summaryResult]).toBeDefined();
    expect(Object.keys(sheet.summaries)).toHaveLength(1);

    const fresh = createDocument();
    const freshSheet = fresh.sheets[IDS.sheet];
    freshSheet.topics[IDS.summaryResult] = createTopic({
      id: IDS.summaryResult,
      role: 'summary-result',
      title: 'Deleted result',
    });
    freshSheet.summaries[IDS.summary] = {
      id: IDS.summary,
      scope: {
        kind: 'sibling-range',
        parentTopicId: IDS.root,
        firstEdgeId: IDS.edgeTarget,
        lastEdgeId: IDS.edgeTarget,
        includeDescendants: true,
      },
      resultTopicId: IDS.summaryResult,
      orientation: 'auto',
    };
    const deleteOnlyMember = planDeleteTopicSubtreeCommand({
      document: fresh,
      sheetId: IDS.sheet,
      topicId: IDS.target,
      commandId: id<'Command'>('34'),
      timestamp,
      origin: 'test',
    });
    expect(deleteOnlyMember.payload.summaryScopeChanges).toEqual([{
      summaryId: IDS.summary,
      replacements: [],
    }]);
    const emptied = executeMindMapCommand(fresh, deleteOnlyMember).document.sheets[IDS.sheet];
    expect(emptied.summaries[IDS.summary]).toBeUndefined();
    expect(emptied.topics[IDS.summaryResult]).toBeUndefined();
  });

  it('splits a Boundary with planner-owned stable IDs in one reorder history unit', () => {
    const document = createDocument();
    const sheet = document.sheets[IDS.sheet];
    sheet.boundaries[IDS.boundary] = {
      id: IDS.boundary,
      scope: {
        kind: 'sibling-range',
        parentTopicId: IDS.root,
        firstEdgeId: IDS.edgeBefore,
        lastEdgeId: IDS.edgeAfter,
        includeDescendants: true,
      },
      title: createRichText('Stable split'),
      padding: 18,
      style: { overrides: { shape: 'ellipse' } },
      extensions: { 'app.nmdd.vendor': { retained: true } },
    };
    sheet.relationships[IDS.relationship] = {
      id: IDS.relationship,
      source: { element: { kind: 'boundary', boundaryId: IDS.boundary }, anchor: 'auto' },
      target: { element: { kind: 'topic', topicId: IDS.root }, anchor: 'auto' },
      routing: 'curve',
      startArrow: 'none',
      endArrow: 'triangle',
    };
    const before = JSON.stringify(document);
    const command = planReorderTopicCommand({
      document,
      sheetId: IDS.sheet,
      topicId: IDS.target,
      index: 1,
      side: 'right',
      commandId: IDS.reorderCommand,
      timestamp,
      origin: 'test',
    });
    const change = command.payload.boundaryScopeChanges?.[0];
    expect(change?.boundaryId).toBe(IDS.boundary);
    expect(change?.replacements).toHaveLength(2);
    expect(change?.replacements[0].boundaryId).toBe(IDS.boundary);
    const splitBoundaryId = change!.replacements[1].boundaryId;

    const execution = executeMindMapCommand(document, command);
    expect(execution.document.contentRevision).toBe(document.contentRevision + 1);
    const nextSheet = execution.document.sheets[IDS.sheet];
    expect(Object.keys(nextSheet.boundaries).sort()).toEqual(
      [IDS.boundary, splitBoundaryId].sort(),
    );
    expect(nextSheet.boundaries[splitBoundaryId]).toMatchObject({
      id: splitBoundaryId,
      padding: 18,
      style: { overrides: { shape: 'ellipse' } },
      extensions: { 'app.nmdd.vendor': { retained: true } },
    });
    expect(nextSheet.boundaries[splitBoundaryId].title)
      .toEqual(nextSheet.boundaries[IDS.boundary].title);
    expect(nextSheet.boundaries[splitBoundaryId].title)
      .not.toBe(nextSheet.boundaries[IDS.boundary].title);
    expect(nextSheet.boundaries[splitBoundaryId].extensions)
      .not.toBe(nextSheet.boundaries[IDS.boundary].extensions);
    expect(nextSheet.boundaries[splitBoundaryId].style)
      .not.toBe(nextSheet.boundaries[IDS.boundary].style);
    expect(Object.keys(nextSheet.relationships)).toEqual([IDS.relationship]);
    expect(nextSheet.relationships[IDS.relationship].source.element).toEqual({
      kind: 'boundary',
      boundaryId: IDS.boundary,
    });

    const history = new PatchCommandHistory();
    history.record(execution.applied);
    expect(history.undoDepth).toBe(1);
    const undone = history.undo(execution.document);
    expect(JSON.stringify(undone?.document)).toBe(before);
    const redone = history.redo(undone!.document);
    expect(redone?.document.sheets[IDS.sheet].boundaries[splitBoundaryId]).toBeDefined();
    expect(redone?.document.sheets[IDS.sheet].relationships[IDS.relationship].source.element)
      .toEqual({ kind: 'boundary', boundaryId: IDS.boundary });

    const malformed = structuredClone(command);
    delete malformed.payload.boundaryScopeChanges;
    expect(() => executeMindMapCommand(document, malformed)).toThrow(CommandValidationError);
    expect(JSON.stringify(document)).toBe(before);
    expect(document.contentRevision).toBe(0);
  });

  it('deletes an empty normalized Boundary and cleans every document-level reference', () => {
    const document = createMindMapElementsFixture();
    const sheet = Object.values(document.sheets)[0];
    const boundary = Object.values(sheet.boundaries)[0];
    if (boundary.scope.kind !== 'sibling-range') throw new Error('Fixture Boundary changed.');
    const topicId = sheet.treeEdges[boundary.scope.firstEdgeId].childTopicId;
    boundary.scope = { kind: 'subtree', rootTopicId: topicId, depth: 'all' };
    const deck = Object.values(document.presentations)[0];
    const slide = Object.values(deck.slides)[0];
    slide.target = { kind: 'boundary', sheetId: sheet.id, boundaryId: boundary.id };
    const threadId = id<'CommentThread'>('92');
    document.collaboration = {
      mode: 'single-user',
      commentThreads: {
        [threadId]: {
          id: threadId,
          anchor: { kind: 'boundary', id: boundary.id },
          resolved: false,
          orphaned: false,
          comments: {},
        },
      },
    };
    const command = planDeleteTopicSubtreeCommand({
      document,
      sheetId: sheet.id,
      topicId,
      commandId: id<'Command'>('93'),
      timestamp,
      origin: 'test',
    });
    expect(command.payload.boundaryScopeChanges).toEqual([{
      boundaryId: boundary.id,
      replacements: [],
    }]);

    const execution = executeMindMapCommand(document, command);
    const nextSheet = execution.document.sheets[sheet.id];
    expect(nextSheet.boundaries[boundary.id]).toBeUndefined();
    expect(Object.values(nextSheet.relationships).some((relationship) =>
      relationship.source.element.kind === 'boundary'
      || relationship.target.element.kind === 'boundary')).toBe(false);
    expect(Object.values(execution.document.savedViews).flatMap((view) => view.selection ?? [])
      .some((reference) => reference.kind === 'boundary' && reference.id === boundary.id)).toBe(false);
    expect(execution.document.presentations[deck.id].slides[slide.id]).toBeUndefined();
    expect(execution.document.collaboration?.commentThreads?.[threadId].orphaned).toBe(true);

    const history = new PatchCommandHistory();
    history.record(execution.applied);
    expect(history.undo(execution.document)?.document).toEqual(document);
  });


  it('inserts a parent by retargeting the original incoming edge as one undo unit', () => {
    const document = createDocument();
    const sheet = document.sheets[IDS.sheet];
    sheet.boundaries[IDS.boundary] = {
      id: IDS.boundary,
      scope: {
        kind: 'sibling-range',
        parentTopicId: IDS.root,
        firstEdgeId: IDS.edgeTarget,
        lastEdgeId: IDS.edgeTarget,
        includeDescendants: true,
      },
      padding: 12,
    };
    const before = JSON.stringify(document);
    const command = planInsertParentTopicCommand({
      document,
      sheetId: IDS.sheet,
      topicId: IDS.target,
      title: 'Inserted parent',
      ids: {
        commandId: IDS.insertCommand,
        topicId: IDS.insertedParent,
        treeEdgeId: IDS.insertedChildEdge,
      },
      timestamp,
      origin: 'test',
    });

    expect(JSON.stringify(document)).toBe(before);
    expect(command).toMatchObject({
      commandId: IDS.insertCommand,
      type: MIND_MAP_COMMAND_TYPES.insertParentTopic,
      timestamp,
      payload: {
        topicId: IDS.target,
        parentTopic: { id: IDS.insertedParent, role: 'regular' },
        childEdge: {
          id: IDS.insertedChildEdge,
          parentTopicId: IDS.insertedParent,
          childTopicId: IDS.target,
          orderKey: keys.target,
          side: 'left',
          slot: 'lane-a',
        },
      },
    });

    const execution = executeMindMapCommand(document, command);
    const nextSheet = execution.document.sheets[IDS.sheet];
    expect(nextSheet.treeEdges[IDS.edgeTarget]).toEqual({
      ...sheet.treeEdges[IDS.edgeTarget],
      childTopicId: IDS.insertedParent,
    });
    expect(nextSheet.treeEdges[IDS.insertedChildEdge]).toEqual(command.payload.childEdge);
    expect(getChildEdgesSorted(nextSheet, IDS.root).map((edge) => edge.childTopicId))
      .toEqual([IDS.before, IDS.insertedParent, IDS.after]);
    expect(nextSheet.boundaries[IDS.boundary].scope).toMatchObject({
      firstEdgeId: IDS.edgeTarget,
      lastEdgeId: IDS.edgeTarget,
    });

    const history = new PatchCommandHistory();
    history.record(execution.applied);
    expect(history.undoDepth).toBe(1);
    expect(history.undo(execution.document)?.document).toEqual(document);
  });

  it('deletes only the current topic, promotes children in order, and preserves descendants', () => {
    const document = createDocument();
    const sheet = document.sheets[IDS.sheet];
    sheet.notes[IDS.childNote] = {
      id: IDS.childNote,
      topicId: IDS.childA,
      content: createRichText('Child note'),
    };
    sheet.notes[IDS.targetNote] = {
      id: IDS.targetNote,
      topicId: IDS.target,
      content: createRichText('Deleted with target'),
    };
    sheet.callouts[IDS.callout] = {
      id: IDS.callout,
      targetTopicId: IDS.childB,
      content: createRichText('Keep me'),
      placement: { mode: 'auto' },
      tail: 'curve',
    };
    sheet.relationships[IDS.relationship] = {
      id: IDS.relationship,
      source: { element: { kind: 'topic', topicId: IDS.childA }, anchor: 'auto' },
      target: { element: { kind: 'topic', topicId: IDS.childB }, anchor: 'auto' },
      routing: 'curve',
      startArrow: 'none',
      endArrow: 'triangle',
    };
    sheet.boundaries[IDS.boundary] = {
      id: IDS.boundary,
      scope: { kind: 'subtree', rootTopicId: IDS.target, depth: 'all' },
      padding: 12,
    };
    const before = JSON.stringify(document);
    const command = planDeleteCurrentTopicCommand({
      document,
      sheetId: IDS.sheet,
      topicId: IDS.target,
      commandId: IDS.deleteCommand,
      timestamp,
      origin: 'test',
    });

    expect(JSON.stringify(document)).toBe(before);
    expect(command.payload.promotedEdges.map((edge) => edge.id))
      .toEqual([IDS.edgeChildA, IDS.edgeChildB]);
    expect(command.payload.promotedEdges.every((edge) =>
      edge.parentTopicId === IDS.root
      && edge.side === 'left'
      && edge.slot === 'lane-a')).toBe(true);

    const execution = executeMindMapCommand(document, command);
    const nextSheet = execution.document.sheets[IDS.sheet];
    expect(nextSheet.topics[IDS.target]).toBeUndefined();
    expect(nextSheet.topics[IDS.childA]).toBeDefined();
    expect(nextSheet.topics[IDS.childB]).toBeDefined();
    expect(nextSheet.topics[IDS.grandchild]).toBeDefined();
    expect(nextSheet.treeEdges[IDS.edgeGrandchild]).toMatchObject({
      parentTopicId: IDS.childA,
      childTopicId: IDS.grandchild,
    });
    expect(getChildEdgesSorted(nextSheet, IDS.root).map((edge) => edge.childTopicId))
      .toEqual([IDS.before, IDS.childA, IDS.childB, IDS.after]);
    expect(nextSheet.treeEdges[IDS.edgeChildA].style)
      .toEqual(sheet.treeEdges[IDS.edgeChildA].style);
    expect(nextSheet.notes[IDS.childNote]).toBeDefined();
    expect(nextSheet.notes[IDS.targetNote]).toBeUndefined();
    expect(nextSheet.callouts[IDS.callout]).toBeDefined();
    expect(nextSheet.relationships[IDS.relationship]).toBeDefined();
    expect(nextSheet.boundaries[IDS.boundary].scope).toEqual({
      kind: 'sibling-range',
      parentTopicId: IDS.root,
      firstEdgeId: IDS.edgeChildA,
      lastEdgeId: IDS.edgeChildB,
      includeDescendants: true,
    });

    const history = new PatchCommandHistory();
    history.record(execution.applied);
    expect(history.undoDepth).toBe(1);
    expect(history.undo(execution.document)?.document).toEqual(document);
  });

  it('strictly rejects illegal roles and malformed promotion plans', () => {
    const document = createDocument();
    expect(() => planInsertParentTopicCommand({
      document,
      sheetId: IDS.sheet,
      topicId: IDS.root,
    })).toThrow(/central root/);
    expect(() => planDeleteCurrentTopicCommand({
      document,
      sheetId: IDS.sheet,
      topicId: IDS.root,
    })).toThrow(/central root/);

    const floating = id<'Topic'>('90') as TopicId;
    document.sheets[IDS.sheet].topics[floating] = createTopic({
      id: floating,
      role: 'floating-root',
      title: 'Floating',
      placement: { mode: 'absolute', x: 10, y: 20 },
    });
    expect(() => planInsertParentTopicCommand({
      document,
      sheetId: IDS.sheet,
      topicId: floating,
    })).toThrow(/floating-root/);
    expect(() => planDeleteCurrentTopicCommand({
      document,
      sheetId: IDS.sheet,
      topicId: floating,
    })).toThrow(/floating-root/);

    const summaryResult = id<'Topic'>('91') as TopicId;
    document.sheets[IDS.sheet].topics[summaryResult] = createTopic({
      id: summaryResult,
      role: 'summary-result',
      title: 'Summary result',
    });
    expect(() => planInsertParentTopicCommand({
      document,
      sheetId: IDS.sheet,
      topicId: summaryResult,
    })).toThrow(/summary-result/);
    expect(() => planDeleteCurrentTopicCommand({
      document,
      sheetId: IDS.sheet,
      topicId: summaryResult,
    })).toThrow(/summary-result/);

    const malformed = planDeleteCurrentTopicCommand({
      document,
      sheetId: IDS.sheet,
      topicId: IDS.target,
      commandId: IDS.deleteCommand,
      timestamp,
    }) as DeleteCurrentTopicCommand;
    malformed.payload.promotedEdges[0] = {
      ...malformed.payload.promotedEdges[0],
      orderKey: 'contains space',
    };
    expect(() => executeMindMapCommand(document, malformed)).toThrow(CommandValidationError);
    expect(document.sheets[IDS.sheet].topics[IDS.target]).toBeDefined();
  });
});
