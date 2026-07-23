import { describe, expect, it } from 'vitest';

import {
  createMindMapSheet,
  createNewMindMapDocument,
  createRichText,
  createTopic,
} from '../domain/defaults';
import { getChildEdgesSorted } from '../domain/tree';
import type * as Domain from '../domain/types';
import { createMindMapV1SmallFixture } from '../testing/fixtures';
import {
  buildMindMapSearchIndex,
  findMindMapSearchRanges,
  navigateMindMapSearchResults,
  projectMindMapSearchFilter,
  searchMindMapIndex,
  updateMindMapSearchIndex,
} from './search';

const id = <K extends string>(counter: number): Domain.Id<K> => (
  `018f1000-0000-7000-8000-${counter.toString(16).padStart(12, '0')}` as Domain.Id<K>
);

interface RichSearchFixture {
  readonly document: Domain.MindMapDocumentV1;
  readonly sheetId: Domain.SheetId;
  readonly secondSheetId: Domain.SheetId;
  readonly rootId: Domain.TopicId;
  readonly branchId: Domain.TopicId;
  readonly grandchildId: Domain.TopicId;
  readonly siblingId: Domain.TopicId;
  readonly markerDefinitionId: Domain.MarkerDefinitionId;
}

const createRichSearchFixture = (): RichSearchFixture => {
  const document = createMindMapV1SmallFixture();
  const sheet = Object.values(document.sheets)[0];
  const rootId = sheet.rootTopicId;
  const rootChildren = getChildEdgesSorted(sheet, rootId);
  const branchId = rootChildren[0].childTopicId;
  const siblingId = rootChildren[1].childTopicId;
  const grandchildId = getChildEdgesSorted(sheet, branchId)[0].childTopicId;

  sheet.topics[branchId].title = createRichText('Road roadmap Roadster [draft](v2)+?');
  sheet.topics[branchId].labels = ['高优先级', 'Growth'];
  sheet.topics[grandchildId].title = createRichText('阶段计划：预算审查');

  const noteId = id<'Note'>(1);
  sheet.notes[noteId] = {
    id: noteId,
    topicId: branchId,
    content: createRichText('私人 Note：现金流预算审查'),
  };

  const markerGroupId = id<'MarkerGroup'>(2);
  const markerDefinitionId = id<'MarkerDefinition'>(3);
  const markerInstanceId = id<'MarkerInstance'>(4);
  document.markerGroups[markerGroupId] = {
    id: markerGroupId,
    orderKey: 'a',
    name: 'Priority markers',
    kind: 'custom',
    exclusive: false,
  };
  document.markerDefinitions[markerDefinitionId] = {
    id: markerDefinitionId,
    groupId: markerGroupId,
    orderKey: 'a',
    name: 'Urgent',
    source: { kind: 'builtin', key: 'priority-1' },
    semanticValue: 'P1',
  };
  sheet.markerInstances[markerInstanceId] = {
    id: markerInstanceId,
    topicId: branchId,
    markerDefinitionId,
    orderKey: 'a',
    value: 'red flag',
  };

  const todoId = id<'Todo'>(5);
  sheet.todos[todoId] = {
    id: todoId,
    topicId: siblingId,
    completed: true,
    completedAt: '2026-07-19T00:00:00.000Z',
  };

  const actorId = id<'Actor'>(6);
  document.actors[actorId] = {
    id: actorId,
    displayName: 'Ada Lovelace',
    email: 'ada@example.test',
    status: 'active',
  };
  const taskId = id<'Task'>(7);
  sheet.tasks[taskId] = {
    id: taskId,
    topicId: grandchildId,
    status: 'blocked',
    progress: 50,
    priority: 2,
    startDate: '2026-07-20',
    dueDate: '2026-07-25',
    durationMinutes: 240,
    milestone: true,
    assigneeIds: [actorId],
    displayFields: ['status', 'progress', 'assignees'],
  };

  const secondSheetId = id<'Sheet'>(8);
  const secondRootId = id<'Topic'>(9);
  document.sheets[secondSheetId] = createMindMapSheet({
    id: secondSheetId,
    orderKey: 'z',
    rootTopicId: secondRootId,
    themeId: sheet.themeId,
    title: '第二 Sheet',
    rootTitle: 'Second Road',
  });

  return {
    document,
    sheetId: sheet.id,
    secondSheetId,
    rootId,
    branchId,
    grandchildId,
    siblingId,
    markerDefinitionId,
  };
};

describe('MindMap search index', () => {
  it('indexes Topic, Note, Label, Marker, To-do and Task fields', () => {
    const fixture = createRichSearchFixture();
    const index = buildMindMapSearchIndex(fixture.document);
    const cases = [
      ['预算审查', 'note', fixture.branchId],
      ['Growth', 'label', fixture.branchId],
      ['Urgent', 'marker', fixture.branchId],
      ['completed', 'todo', fixture.siblingId],
      ['blocked', 'task', fixture.grandchildId],
      ['Ada Lovelace', 'task', fixture.grandchildId],
    ] as const;

    for (const [text, field, topicId] of cases) {
      const results = searchMindMapIndex(index, { text, fields: [field] });
      expect(results.matches.map((match) => match.topicId), text).toContain(topicId);
      expect(results.matches.flatMap((match) => match.fields).every((match) => (
        match.field === field
      ))).toBe(true);
    }
  });

  it('matches Chinese, case/whole-word options and regex metacharacters literally', () => {
    const fixture = createRichSearchFixture();
    const index = buildMindMapSearchIndex(fixture.document);
    const scope = { kind: 'sheet', sheetId: fixture.sheetId } as const;

    expect(searchMindMapIndex(index, {
      text: '阶段计划',
      fields: ['topic'],
      scope,
    }).matches.map((match) => match.topicId)).toEqual([fixture.grandchildId]);

    const wholeWord = searchMindMapIndex(index, {
      text: 'road',
      fields: ['topic'],
      scope,
      wholeWord: true,
    });
    expect(wholeWord.matches.map((match) => match.topicId)).toEqual([fixture.branchId]);
    expect(wholeWord.matches[0].fields[0].ranges).toEqual([{ start: 0, end: 4 }]);
    expect(searchMindMapIndex(index, {
      text: 'road',
      caseSensitive: true,
      fields: ['topic'],
      scope,
      wholeWord: true,
    }).total).toBe(0);

    expect(searchMindMapIndex(index, {
      text: '[draft](v2)+?',
      fields: ['topic'],
      scope,
    }).matches.map((match) => match.topicId)).toEqual([fixture.branchId]);
    expect(findMindMapSearchRanges('a+b? [x]', 'a+b?')).toEqual([{ start: 0, end: 4 }]);
  });

  it('applies branch/Sheet/all-Sheet scope and navigates in stable outline order', () => {
    const fixture = createRichSearchFixture();
    const index = buildMindMapSearchIndex(fixture.document);
    const all = searchMindMapIndex(index, { text: 'Road', fields: ['topic'] });
    expect(all.matches.map((match) => match.topicId)).toEqual([
      fixture.branchId,
      fixture.document.sheets[fixture.secondSheetId].rootTopicId,
    ]);
    expect(searchMindMapIndex(index, {
      text: '预算审查',
      scope: {
        kind: 'branch',
        sheetId: fixture.sheetId,
        rootTopicId: fixture.branchId,
      },
    }).matches.map((match) => match.topicId)).toEqual([
      fixture.branchId,
      fixture.grandchildId,
    ]);
    expect(searchMindMapIndex(index, {
      text: 'Road',
      fields: ['topic'],
      scope: { kind: 'sheet', sheetId: fixture.secondSheetId },
    }).matches).toHaveLength(1);

    const first = navigateMindMapSearchResults(all, undefined, 'next');
    const second = navigateMindMapSearchResults(all, first, 'next');
    expect(first?.topicId).toBe(fixture.branchId);
    expect(second?.sheetId).toBe(fixture.secondSheetId);
    expect(navigateMindMapSearchResults(all, second, 'next')?.topicId).toBe(fixture.branchId);
    expect(navigateMindMapSearchResults(all, first, 'previous')?.sheetId)
      .toBe(fixture.secondSheetId);
    expect(navigateMindMapSearchResults(all, second, 'next', false)).toBeUndefined();
  });

  it('projects match ancestors as context without mutating canonical content', () => {
    const fixture = createRichSearchFixture();
    const before = JSON.stringify(fixture.document);
    const index = buildMindMapSearchIndex(fixture.document);
    const results = searchMindMapIndex(index, {
      text: '阶段计划',
      fields: ['topic'],
      scope: { kind: 'sheet', sheetId: fixture.sheetId },
    });
    const hidden = projectMindMapSearchFilter(index, results, 'hide');
    const sheet = hidden.sheets[fixture.sheetId];
    expect(sheet?.matchedTopicIds).toEqual([fixture.grandchildId]);
    expect(sheet?.contextTopicIds).toEqual([fixture.rootId, fixture.branchId]);
    expect(sheet?.includedTopicIds).toEqual([
      fixture.rootId,
      fixture.branchId,
      fixture.grandchildId,
    ]);
    expect(sheet?.hiddenTopicIds).toContain(fixture.siblingId);

    const dimmed = projectMindMapSearchFilter(index, results, 'dim');
    expect(dimmed.sheets[fixture.sheetId]?.hiddenTopicIds).toEqual([]);
    expect(dimmed.sheets[fixture.sheetId]?.dimmedTopicIds).toContain(fixture.siblingId);
    expect(JSON.stringify(fixture.document)).toBe(before);
  });

  it('incrementally replaces affected entries and retains unaffected searchable values', () => {
    const fixture = createRichSearchFixture();
    const initial = buildMindMapSearchIndex(fixture.document);
    const branchKey = `${fixture.sheetId}:${fixture.branchId}`;
    const siblingKey = `${fixture.sheetId}:${fixture.siblingId}`;
    const previousSibling = initial.entryByTopicKey[siblingKey];

    fixture.document.sheets[fixture.sheetId].topics[fixture.branchId].title = createRichText(
      'Renamed launch branch',
    );
    fixture.document.contentRevision += 1;
    const renamed = updateMindMapSearchIndex(initial, fixture.document, {
      topics: [{ sheetId: fixture.sheetId, topicId: fixture.branchId }],
    });
    expect(renamed.entryByTopicKey[branchKey]).not.toBe(initial.entryByTopicKey[branchKey]);
    expect(renamed.entryByTopicKey[siblingKey]).toBe(previousSibling);
    expect(searchMindMapIndex(renamed, { text: 'Renamed', fields: ['topic'] }).total).toBe(1);

    fixture.document.markerDefinitions[fixture.markerDefinitionId].name = 'Critical marker';
    fixture.document.contentRevision += 1;
    const markerUpdated = updateMindMapSearchIndex(renamed, fixture.document, {
      markerDefinitions: [fixture.markerDefinitionId],
    });
    expect(searchMindMapIndex(markerUpdated, {
      text: 'Critical marker',
      fields: ['marker'],
    }).matches.map((match) => match.topicId)).toEqual([fixture.branchId]);
  });

  it('handles a 10K-topic index and exact query within a basic performance budget', () => {
    const document = createNewMindMapDocument({
      documentId: id<'Document'>(20_000),
      sheetId: id<'Sheet'>(20_001),
      rootTopicId: id<'Topic'>(20_002),
      themeId: id<'Theme'>(20_003),
      sheetOrderKey: 'a',
      rootTitle: 'Root',
    });
    const sheet = Object.values(document.sheets)[0];
    for (let index = 1; index < 10_000; index += 1) {
      const topicId = id<'Topic'>(30_000 + index);
      const edgeId = id<'TreeEdge'>(50_000 + index);
      sheet.topics[topicId] = createTopic({
        id: topicId,
        title: index === 9_999 ? 'unique-needle-9999' : `Topic ${index}`,
      });
      sheet.treeEdges[edgeId] = {
        id: edgeId,
        parentTopicId: sheet.rootTopicId,
        childTopicId: topicId,
        orderKey: index.toString().padStart(6, '0'),
        side: 'right',
      };
    }

    const buildStarted = performance.now();
    const searchIndex = buildMindMapSearchIndex(document);
    const buildDuration = performance.now() - buildStarted;
    const queryStarted = performance.now();
    const results = searchMindMapIndex(searchIndex, { text: 'unique-needle-9999' });
    const queryDuration = performance.now() - queryStarted;

    expect(searchIndex.entries).toHaveLength(10_000);
    expect(results.total).toBe(1);
    expect(buildDuration).toBeLessThan(3_000);
    expect(queryDuration).toBeLessThan(500);
  }, 15_000);
});
