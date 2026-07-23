import { describe, expect, it } from 'vitest';

import {
  createMindMapSheet,
  createNewMindMapDocument,
  createTopic,
} from '../domain/defaults';
import type * as Domain from '../domain/types';
import { projectMindMapOutliner } from './outliner';
import {
  buildMindMapSearchIndex,
  projectMindMapSearchFilter,
  searchMindMapIndex,
} from './search';

const id = <K extends string>(counter: number): Domain.Id<K> => (
  `018f2000-0000-7000-8000-${counter.toString(16).padStart(12, '0')}` as Domain.Id<K>
);

interface OutlineFixture {
  readonly document: Domain.MindMapDocumentV1;
  readonly firstSheetId: Domain.SheetId;
  readonly secondSheetId: Domain.SheetId;
  readonly rootId: Domain.TopicId;
  readonly branchId: Domain.TopicId;
  readonly childId: Domain.TopicId;
  readonly siblingId: Domain.TopicId;
}

const createOutlineFixture = (): OutlineFixture => {
  const firstSheetId = id<'Sheet'>(1);
  const rootId = id<'Topic'>(2);
  const themeId = id<'Theme'>(3);
  const document = createNewMindMapDocument({
    documentId: id<'Document'>(4),
    sheetId: firstSheetId,
    rootTopicId: rootId,
    themeId,
    sheetOrderKey: 'a',
    sheetTitle: '第一 Sheet',
    rootTitle: 'Root',
  });
  const first = document.sheets[firstSheetId];
  const branchId = id<'Topic'>(5);
  const childId = id<'Topic'>(6);
  const siblingId = id<'Topic'>(7);
  first.topics[branchId] = createTopic({ id: branchId, title: 'Branch' });
  first.topics[childId] = createTopic({ id: childId, title: 'Target child' });
  first.topics[siblingId] = createTopic({ id: siblingId, title: 'Sibling' });
  first.treeEdges[id<'TreeEdge'>(8)] = {
    id: id<'TreeEdge'>(8),
    parentTopicId: rootId,
    childTopicId: branchId,
    orderKey: 'a',
    side: 'right',
  };
  first.treeEdges[id<'TreeEdge'>(9)] = {
    id: id<'TreeEdge'>(9),
    parentTopicId: branchId,
    childTopicId: childId,
    orderKey: 'a',
    side: 'right',
  };
  first.treeEdges[id<'TreeEdge'>(10)] = {
    id: id<'TreeEdge'>(10),
    parentTopicId: rootId,
    childTopicId: siblingId,
    orderKey: 'b',
    side: 'right',
  };

  const secondSheetId = id<'Sheet'>(11);
  document.sheets[secondSheetId] = createMindMapSheet({
    id: secondSheetId,
    orderKey: 'b',
    rootTopicId: id<'Topic'>(12),
    themeId,
    title: '第二 Sheet',
    rootTitle: 'Second root',
  });
  return {
    document,
    firstSheetId,
    secondSheetId,
    rootId,
    branchId,
    childId,
    siblingId,
  };
};

describe('MindMap Outliner projection', () => {
  it('projects all Sheets and topic hierarchy in deterministic order', () => {
    const fixture = createOutlineFixture();
    const projection = projectMindMapOutliner({ document: fixture.document });
    expect(projection.sheets.map((sheet) => sheet.title)).toEqual([
      '第一 Sheet',
      '第二 Sheet',
    ]);
    expect(projection.sheets[0].rows.map((row) => row.title)).toEqual([
      '第一 Sheet',
      'Root',
      'Branch',
      'Target child',
      'Sibling',
    ]);
    expect(projection.sheets[0].roots[0].children[0].children[0].topicId)
      .toBe(fixture.childId);
    expect(projection.sheets[0].rows.map((row) => row.rowDepth)).toEqual([0, 1, 2, 3, 2]);
  });

  it('keeps topic and Sheet disclosure state external to canonical content', () => {
    const fixture = createOutlineFixture();
    const before = JSON.stringify(fixture.document);
    const collapsedBranch = projectMindMapOutliner({
      document: fixture.document,
      viewState: {
        foldOverrides: {
          [fixture.firstSheetId]: { [fixture.branchId]: true },
        },
      },
    });
    expect(collapsedBranch.sheets[0].rows.map((row) => row.title)).toEqual([
      '第一 Sheet',
      'Root',
      'Branch',
      'Sibling',
    ]);
    expect(collapsedBranch.sheets[0].roots[0].children[0].children[0].title)
      .toBe('Target child');
    expect(fixture.document.sheets[fixture.firstSheetId].topics[fixture.branchId].defaultCollapsed)
      .toBe(false);

    fixture.document.sheets[fixture.firstSheetId].topics[fixture.branchId].defaultCollapsed = true;
    const explicitlyExpanded = projectMindMapOutliner({
      document: fixture.document,
      viewState: {
        foldOverrides: {
          [fixture.firstSheetId]: { [fixture.branchId]: false },
        },
      },
    });
    expect(explicitlyExpanded.sheets[0].rows.map((row) => row.title)).toContain('Target child');
    fixture.document.sheets[fixture.firstSheetId].topics[fixture.branchId].defaultCollapsed = false;

    const collapsedSheet = projectMindMapOutliner({
      document: fixture.document,
      viewState: { collapsedSheetIds: [fixture.firstSheetId] },
    });
    expect(collapsedSheet.sheets[0].rows).toHaveLength(1);
    expect(collapsedSheet.sheets[1].rows.map((row) => row.title)).toEqual([
      '第二 Sheet',
      'Second root',
    ]);
    expect(JSON.stringify(fixture.document)).toBe(before);
  });

  it('supports a branch-only outline with depth rebased below its Sheet row', () => {
    const fixture = createOutlineFixture();
    const projection = projectMindMapOutliner({
      document: fixture.document,
      branch: {
        sheetId: fixture.firstSheetId,
        rootTopicId: fixture.branchId,
      },
    });
    expect(projection.sheets).toHaveLength(1);
    expect(projection.rows.map((row) => row.title)).toEqual([
      '第一 Sheet',
      'Branch',
      'Target child',
    ]);
    expect(projection.sheets[0].roots[0]).toMatchObject({
      topicId: fixture.branchId,
      depth: 0,
    });
    expect(projection.rows.map((row) => row.rowDepth)).toEqual([0, 1, 2]);
  });

  it('reuses search filtering while retaining ancestor context and match state', () => {
    const fixture = createOutlineFixture();
    const index = buildMindMapSearchIndex(fixture.document);
    const results = searchMindMapIndex(index, {
      text: 'Target child',
      fields: ['topic'],
      scope: { kind: 'sheet', sheetId: fixture.firstSheetId },
    });
    const filter = projectMindMapSearchFilter(index, results, 'hide');
    const projection = projectMindMapOutliner({
      document: fixture.document,
      filter,
    });
    const topicRows = projection.sheets[0].rows.filter((row) => row.kind === 'topic');
    expect(topicRows.map((row) => row.topicId)).toEqual([
      fixture.rootId,
      fixture.branchId,
      fixture.childId,
    ]);
    expect(topicRows.map((row) => row.matchState)).toEqual([
      'context',
      'context',
      'match',
    ]);
    expect(topicRows.map((row) => row.topicId)).not.toContain(fixture.siblingId);
  });
});
