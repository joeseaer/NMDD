import { describe, expect, it } from 'vitest';

import { executeMindMapCommand } from '../commands';
import { createMindMapBlockDocument } from '../domain/createDocument';
import { createRichText } from '../domain/defaults';
import { parseMindMapAttribute } from '../domain/persistence';
import { BOUNDARY_FRAME_EXTENSION_KEY } from '../domain/boundaryFrame';
import type {
  BoundaryId,
  CalloutId,
  CommandId,
  DocumentId,
  RelationshipId,
  SheetId,
  SummaryId,
  ThemeId,
  TopicId,
  TreeEdgeId,
} from '../domain/types';
import { MindMapContentStore } from '../store/contentStore';
import { planCreateTopicCommand } from './commandPlanning';
import {
  createdElementRef,
  planAdjustBoundaryRangeCommand,
  planAdjustSummaryRangeCommand,
  planCreateBoundaryCommand,
  planCreateCalloutCommand,
  planCreateRelationshipCommand,
  planCreateSummaryCommand,
  planDeleteSemanticElementCommand,
  planResizeBoundaryFrameCommand,
  planUpdateBoundaryCommand,
  planUpdateCalloutCommand,
  planUpdateRelationshipCommand,
  planUpdateSummaryCommand,
  previewSummaryCreation,
} from './semanticPlanning';

const IDS = {
  document: '018f0000-0000-7000-8000-000000000001' as DocumentId,
  sheet: '018f0000-0000-7000-8000-000000000002' as SheetId,
  root: '018f0000-0000-7000-8000-000000000003' as TopicId,
  theme: '018f0000-0000-7000-8000-000000000004' as ThemeId,
  a: '018f0000-0000-7000-8000-000000000010' as TopicId,
  b: '018f0000-0000-7000-8000-000000000011' as TopicId,
  edgeA: '018f0000-0000-7000-8000-000000000012' as TreeEdgeId,
  edgeB: '018f0000-0000-7000-8000-000000000013' as TreeEdgeId,
  c: '018f0000-0000-7000-8000-000000000014' as TopicId,
  d: '018f0000-0000-7000-8000-000000000015' as TopicId,
  edgeC: '018f0000-0000-7000-8000-000000000016' as TreeEdgeId,
  edgeD: '018f0000-0000-7000-8000-000000000017' as TreeEdgeId,
  relationship: '018f0000-0000-7000-8000-000000000020' as RelationshipId,
  boundary: '018f0000-0000-7000-8000-000000000021' as BoundaryId,
  summary: '018f0000-0000-7000-8000-000000000022' as SummaryId,
  summaryResult: '018f0000-0000-7000-8000-000000000023' as TopicId,
  callout: '018f0000-0000-7000-8000-000000000024' as CalloutId,
  summary2: '018f0000-0000-7000-8000-000000000025' as SummaryId,
  summaryResult2: '018f0000-0000-7000-8000-000000000026' as TopicId,
} as const;

const commandId = (suffix: number): CommandId =>
  `018f0000-0000-7000-8000-${String(suffix).padStart(12, '0')}` as CommandId;

const createDocumentWithTopics = () => {
  const sourceIds = [IDS.document, IDS.sheet, IDS.root, IDS.theme];
  let sourceIndex = 0;
  let document = createMindMapBlockDocument({
    idFactory: () => sourceIds[sourceIndex++],
  });
  document = executeMindMapCommand(document, planCreateTopicCommand({
    document,
    sheetId: IDS.sheet,
    parentTopicId: IDS.root,
    title: 'A',
    ids: { commandId: commandId(1), topicId: IDS.a, treeEdgeId: IDS.edgeA },
    timestamp: '2026-07-19T00:00:00.000Z',
  })).document;
  document = executeMindMapCommand(document, planCreateTopicCommand({
    document,
    sheetId: IDS.sheet,
    parentTopicId: IDS.root,
    title: 'B',
    ids: { commandId: commandId(2), topicId: IDS.b, treeEdgeId: IDS.edgeB },
    timestamp: '2026-07-19T00:00:00.000Z',
  })).document;
  return document;
};

describe('semantic command planning', () => {
  it('creates one atomic Summary group per normalized branch selection', () => {
    let document = createDocumentWithTopics();
    document = executeMindMapCommand(document, planCreateTopicCommand({
      document,
      sheetId: IDS.sheet,
      parentTopicId: IDS.root,
      title: 'D',
      ids: { commandId: commandId(60), topicId: IDS.d, treeEdgeId: IDS.edgeD },
      timestamp: '2026-07-19T00:00:00.000Z',
    })).document;
    document = structuredClone(document);
    document.sheets[IDS.sheet].treeEdges[IDS.edgeD].side = 'left';

    expect(previewSummaryCreation(document, IDS.sheet, [IDS.a, IDS.b, IDS.d]))
      .toMatchObject({ eligible: true, groupCount: 2 });
    const command = planCreateSummaryCommand({
      document,
      sheetId: IDS.sheet,
      topicIds: [IDS.a, IDS.b, IDS.d],
      summaryIds: [IDS.summary, IDS.summary2],
      resultTopicIds: [IDS.summaryResult, IDS.summaryResult2],
      commandId: commandId(61),
    });
    expect(command.payload.selectedTopicIds).toEqual([IDS.a, IDS.b, IDS.d]);
    expect(command.payload.creations).toHaveLength(2);
    expect(command.payload.creations.map((creation) => creation.summary.scope)).toEqual([
      {
        kind: 'sibling-range',
        parentTopicId: IDS.root,
        firstEdgeId: IDS.edgeA,
        lastEdgeId: IDS.edgeB,
        includeDescendants: true,
      },
      {
        kind: 'sibling-range',
        parentTopicId: IDS.root,
        firstEdgeId: IDS.edgeD,
        lastEdgeId: IDS.edgeD,
        includeDescendants: true,
      },
    ]);
    const next = executeMindMapCommand(document, command).document.sheets[IDS.sheet];
    expect(Object.keys(next.summaries).sort()).toEqual([IDS.summary, IDS.summary2].sort());
    expect(next.topics[IDS.summaryResult].role).toBe('summary-result');
    expect(next.topics[IDS.summaryResult2].role).toBe('summary-result');
    expect(() => planCreateSummaryCommand({
      document,
      sheetId: IDS.sheet,
      topicId: IDS.a,
      summaryId: IDS.a as unknown as SummaryId,
    })).toThrow('already in use');
  });

  it('adjusts a Summary sibling range by exact multi-step endpoints', () => {
    let document = createDocumentWithTopics();
    for (const [topicId, edgeId, title, suffix] of [
      [IDS.c, IDS.edgeC, 'C', 62],
      [IDS.d, IDS.edgeD, 'D', 63],
    ] as const) {
      document = executeMindMapCommand(document, planCreateTopicCommand({
        document,
        sheetId: IDS.sheet,
        parentTopicId: IDS.root,
        title,
        ids: { commandId: commandId(suffix), topicId, treeEdgeId: edgeId },
        timestamp: '2026-07-19T00:00:00.000Z',
      })).document;
    }
    document = executeMindMapCommand(document, planCreateSummaryCommand({
      document,
      sheetId: IDS.sheet,
      topicId: IDS.b,
      summaryId: IDS.summary,
      resultTopicId: IDS.summaryResult,
      commandId: commandId(64),
    })).document;
    const command = planAdjustSummaryRangeCommand({
      document,
      sheetId: IDS.sheet,
      summaryId: IDS.summary,
      endpoint: 'end',
      direction: 'outward',
      steps: 2,
      commandId: commandId(65),
    });
    expect(command.payload.summary.scope).toMatchObject({
      kind: 'sibling-range',
      firstEdgeId: IDS.edgeB,
      lastEdgeId: IDS.edgeD,
    });
    const execution = executeMindMapCommand(document, command);
    expect(execution.document.sheets[IDS.sheet].summaries[IDS.summary].scope)
      .toEqual(command.payload.summary.scope);
  });

  it('plans a multi-sibling Boundary handle drag as one final update', () => {
    let document = createDocumentWithTopics();
    document = executeMindMapCommand(document, planCreateTopicCommand({
      document,
      sheetId: IDS.sheet,
      parentTopicId: IDS.root,
      title: 'C',
      ids: { commandId: commandId(50), topicId: IDS.c, treeEdgeId: IDS.edgeC },
      timestamp: '2026-07-19T00:00:00.000Z',
    })).document;
    document = executeMindMapCommand(document, planCreateTopicCommand({
      document,
      sheetId: IDS.sheet,
      parentTopicId: IDS.root,
      title: 'D',
      ids: { commandId: commandId(51), topicId: IDS.d, treeEdgeId: IDS.edgeD },
      timestamp: '2026-07-19T00:00:00.000Z',
    })).document;
    document = executeMindMapCommand(document, planCreateBoundaryCommand({
      document,
      sheetId: IDS.sheet,
      topicId: IDS.a,
      boundaryId: IDS.boundary,
      commandId: commandId(52),
    })).document;
    const beforeRevision = document.contentRevision;
    const command = planAdjustBoundaryRangeCommand({
      document,
      sheetId: IDS.sheet,
      boundaryId: IDS.boundary,
      endpoint: 'end',
      direction: 'outward',
      steps: 2,
      commandId: commandId(53),
    });
    expect(command.payload.boundary.scope).toMatchObject({
      kind: 'sibling-range',
      firstEdgeId: IDS.edgeA,
      lastEdgeId: IDS.edgeC,
    });
    const execution = executeMindMapCommand(document, command);
    expect(execution.document.contentRevision).toBe(beforeRevision + 1);
    expect(execution.document.sheets[IDS.sheet].boundaries[IDS.boundary].scope)
      .toEqual(command.payload.boundary.scope);
  });

  it('persists one asymmetric Boundary frame resize as one validated update', () => {
    let document = createDocumentWithTopics();
    document = executeMindMapCommand(document, planCreateBoundaryCommand({
      document,
      sheetId: IDS.sheet,
      topicId: IDS.a,
      boundaryId: IDS.boundary,
      commandId: commandId(54),
    })).document;
    const beforeRevision = document.contentRevision;
    const command = planResizeBoundaryFrameCommand({
      document,
      sheetId: IDS.sheet,
      boundaryId: IDS.boundary,
      memberBounds: { x: 100, y: 80, width: 120, height: 40 },
      frame: { x: 70, y: 60, width: 200, height: 100 },
      commandId: commandId(55),
    });
    expect(command.payload.boundary.extensions?.[BOUNDARY_FRAME_EXTENSION_KEY])
      .toEqual({
        version: 1,
        outsets: { top: 20, right: 50, bottom: 40, left: 30 },
      });
    const execution = executeMindMapCommand(document, command);
    expect(execution.document.contentRevision).toBe(beforeRevision + 1);
    expect(execution.document.sheets[IDS.sheet].boundaries[IDS.boundary].extensions)
      .toEqual(command.payload.boundary.extensions);
  });

  it('plans canonical Relationship, Boundary, Summary, and Callout defaults', () => {
    const document = createDocumentWithTopics();
    const relationship = planCreateRelationshipCommand({
      document,
      sheetId: IDS.sheet,
      topicIds: [IDS.a, IDS.b],
      relationshipId: IDS.relationship,
      commandId: commandId(10),
    });
    expect(relationship.payload.relationship).toMatchObject({
      id: IDS.relationship,
      routing: 'curve',
      source: { element: { kind: 'topic', topicId: IDS.a } },
      target: { element: { kind: 'topic', topicId: IDS.b } },
      startArrow: 'none',
      endArrow: 'triangle',
    });
    expect(createdElementRef(relationship)).toEqual({
      kind: 'relationship',
      id: IDS.relationship,
    });

    const boundary = planCreateBoundaryCommand({
      document,
      sheetId: IDS.sheet,
      topicId: IDS.a,
      boundaryId: IDS.boundary,
      commandId: commandId(11),
    });
    expect(boundary.payload.boundary).toMatchObject({
      id: IDS.boundary,
      scope: {
        kind: 'sibling-range',
        parentTopicId: IDS.root,
        firstEdgeId: IDS.edgeA,
        lastEdgeId: IDS.edgeA,
        includeDescendants: true,
      },
      padding: 16,
    });

    const summary = planCreateSummaryCommand({
      document,
      sheetId: IDS.sheet,
      topicId: IDS.a,
      summaryId: IDS.summary,
      resultTopicId: IDS.summaryResult,
      commandId: commandId(12),
    });
    expect(summary.payload).toMatchObject({
      selectedTopicIds: [IDS.a],
      creations: [{
        summary: {
          id: IDS.summary,
          scope: {
            kind: 'sibling-range',
            parentTopicId: IDS.root,
            firstEdgeId: IDS.edgeA,
            lastEdgeId: IDS.edgeA,
            includeDescendants: true,
          },
          resultTopicId: IDS.summaryResult,
          orientation: 'auto',
        },
        resultTopic: { id: IDS.summaryResult, role: 'summary-result' },
      }],
    });

    const callout = planCreateCalloutCommand({
      document,
      sheetId: IDS.sheet,
      topicId: IDS.a,
      calloutId: IDS.callout,
      commandId: commandId(13),
    });
    expect(callout.payload.callout).toMatchObject({
      id: IDS.callout,
      targetTopicId: IDS.a,
      placement: { mode: 'auto', preferredSide: 'right' },
      tail: 'curve',
    });
  });

  it('uses UUIDv7 IDs and rejects invalid Relationship/Summary selections', () => {
    const document = createDocumentWithTopics();
    const command = planCreateCalloutCommand({
      document,
      sheetId: IDS.sheet,
      topicId: IDS.a,
    });
    expect(command.commandId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(command.payload.callout.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

    expect(() => planCreateRelationshipCommand({
      document,
      sheetId: IDS.sheet,
      topicIds: [IDS.a],
    })).toThrow('exactly two unique Topics');
    expect(() => planCreateRelationshipCommand({
      document,
      sheetId: IDS.sheet,
      topicIds: [IDS.a, IDS.a],
    })).toThrow('exactly two unique Topics');
    expect(() => planCreateSummaryCommand({
      document,
      sheetId: IDS.sheet,
      topicId: IDS.root,
    })).toThrow('中心主题');
  });

  it('executes all semantic create/update/delete planners through canonical commands', () => {
    let document = createDocumentWithTopics();
    const relationshipCreate = planCreateRelationshipCommand({
      document,
      sheetId: IDS.sheet,
      topicIds: [IDS.a, IDS.b],
      relationshipId: IDS.relationship,
      commandId: commandId(20),
    });
    document = executeMindMapCommand(document, relationshipCreate).document;
    const relationship = document.sheets[IDS.sheet].relationships[IDS.relationship];
    document = executeMindMapCommand(document, planUpdateRelationshipCommand({
      document,
      sheetId: IDS.sheet,
      relationship: { ...relationship, routing: 'orthogonal' },
      commandId: commandId(21),
    })).document;
    expect(document.sheets[IDS.sheet].relationships[IDS.relationship].routing)
      .toBe('orthogonal');
    document = executeMindMapCommand(document, planDeleteSemanticElementCommand({
      document,
      sheetId: IDS.sheet,
      element: { kind: 'relationship', id: IDS.relationship },
      commandId: commandId(22),
    })).document;

    document = executeMindMapCommand(document, planCreateBoundaryCommand({
      document,
      sheetId: IDS.sheet,
      topicId: IDS.a,
      boundaryId: IDS.boundary,
      commandId: commandId(23),
    })).document;
    const boundary = document.sheets[IDS.sheet].boundaries[IDS.boundary];
    document = executeMindMapCommand(document, planUpdateBoundaryCommand({
      document,
      sheetId: IDS.sheet,
      boundary: { ...boundary, padding: 24 },
      commandId: commandId(24),
    })).document;
    document = executeMindMapCommand(document, planDeleteSemanticElementCommand({
      document,
      sheetId: IDS.sheet,
      element: { kind: 'boundary', id: IDS.boundary },
      commandId: commandId(25),
    })).document;

    document = executeMindMapCommand(document, planCreateSummaryCommand({
      document,
      sheetId: IDS.sheet,
      topicId: IDS.a,
      summaryId: IDS.summary,
      resultTopicId: IDS.summaryResult,
      commandId: commandId(26),
    })).document;
    const summary = document.sheets[IDS.sheet].summaries[IDS.summary];
    document = executeMindMapCommand(document, planUpdateSummaryCommand({
      document,
      sheetId: IDS.sheet,
      summary: { ...summary, orientation: 'bottom' },
      commandId: commandId(27),
    })).document;
    document = executeMindMapCommand(document, planDeleteSemanticElementCommand({
      document,
      sheetId: IDS.sheet,
      element: { kind: 'summary', id: IDS.summary },
      commandId: commandId(28),
    })).document;

    document = executeMindMapCommand(document, planCreateCalloutCommand({
      document,
      sheetId: IDS.sheet,
      topicId: IDS.a,
      calloutId: IDS.callout,
      commandId: commandId(29),
    })).document;
    const callout = document.sheets[IDS.sheet].callouts[IDS.callout];
    document = executeMindMapCommand(document, planUpdateCalloutCommand({
      document,
      sheetId: IDS.sheet,
      callout: { ...callout, content: createRichText('已更新') },
      commandId: commandId(30),
    })).document;
    document = executeMindMapCommand(document, planDeleteSemanticElementCommand({
      document,
      sheetId: IDS.sheet,
      element: { kind: 'callout', id: IDS.callout },
      commandId: commandId(31),
    })).document;

    expect(document.sheets[IDS.sheet]).toMatchObject({
      relationships: {},
      boundaries: {},
      summaries: {},
      callouts: {},
    });
    expect(document.contentRevision).toBe(14);
  });

  it('round-trips a semantic command through MindMapContentStore undo/redo/save', () => {
    const document = createDocumentWithTopics();
    const writes: string[] = [];
    const store = new MindMapContentStore(document, (write) => writes.push(write.data), {
      debounceMs: 60_000,
    });
    const command = planCreateRelationshipCommand({
      document,
      sheetId: IDS.sheet,
      topicIds: [IDS.a, IDS.b],
      relationshipId: IDS.relationship,
      commandId: commandId(40),
    });

    store.dispatch(command);
    expect(store.getSnapshot()?.sheets[IDS.sheet].relationships[IDS.relationship]).toBeDefined();
    store.undo();
    expect(store.getSnapshot()?.sheets[IDS.sheet].relationships[IDS.relationship]).toBeUndefined();
    store.redo();
    expect(store.getSnapshot()?.sheets[IDS.sheet].relationships[IDS.relationship]).toBeDefined();
    store.flush();

    expect(writes.length).toBeGreaterThan(0);
    const parsed = parseMindMapAttribute(writes[writes.length - 1]);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.document.sheets[IDS.sheet].relationships[IDS.relationship]).toBeDefined();
    }
    store.dispose();
  });
});
