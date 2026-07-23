import { describe, expect, it } from 'vitest';

import { createMindMapSheet, createTopic } from '../domain/defaults';
import type { SheetId, TopicId, TreeEdgeId } from '../domain/types';
import { createMindMapV1SmallFixture } from '../testing/fixtures';
import {
  MindMapStaticExportScopeError,
  projectMindMapDocumentForStaticExport,
} from './exportScope';

const topicId = (ordinal: number): TopicId => (
  `03900000-0000-7000-8000-${String(ordinal).padStart(12, '0')}` as TopicId
);
const edgeId = (ordinal: number): TreeEdgeId => (
  `03910000-0000-7000-8000-${String(ordinal).padStart(12, '0')}` as TreeEdgeId
);

describe('static export scope projection', () => {
  it('selects one Sheet without mutating the canonical document', () => {
    const document = createMindMapV1SmallFixture();
    const sheet = Object.values(document.sheets)[0];
    const before = JSON.stringify(document);

    const projected = projectMindMapDocumentForStaticExport(document, {
      kind: 'sheet',
      sheetId: sheet.id,
    });

    expect(Object.keys(projected.sheets)).toEqual([sheet.id]);
    expect(projected.sheets[sheet.id]).toBe(sheet);
    expect(JSON.stringify(document)).toBe(before);
  });

  it('selects multiple Sheets in canonical view order without mutating the document', () => {
    const document = createMindMapV1SmallFixture();
    const firstSheet = Object.values(document.sheets)[0];
    const middleSheetId = '03920000-0000-7000-8000-000000000002' as SheetId;
    const lastSheetId = '03920000-0000-7000-8000-000000000003' as SheetId;
    const middleSheet = createMindMapSheet({
      id: middleSheetId,
      orderKey: 'm-middle',
      rootTopicId: topicId(200),
      themeId: firstSheet.themeId,
      title: 'Middle Sheet',
      rootTitle: 'Middle root',
    });
    const lastSheet = createMindMapSheet({
      id: lastSheetId,
      orderKey: 'z-last',
      rootTopicId: topicId(300),
      themeId: firstSheet.themeId,
      title: 'Last Sheet',
      rootTitle: 'Last root',
    });
    document.sheets[lastSheetId] = lastSheet;
    document.sheets[middleSheetId] = middleSheet;
    const before = JSON.stringify(document);

    const projected = projectMindMapDocumentForStaticExport(document, {
      kind: 'selected-sheets',
      sheetIds: [lastSheetId, middleSheetId],
    });

    expect(Object.keys(projected.sheets)).toEqual([middleSheetId, lastSheetId]);
    expect(projected.sheets[middleSheetId]).toBe(middleSheet);
    expect(projected.sheets[lastSheetId]).toBe(lastSheet);
    expect(projected.sheets[firstSheet.id]).toBeUndefined();
    expect(JSON.stringify(document)).toBe(before);
  });

  it('rejects empty, duplicate, and unavailable selected-Sheet lists fail-closed', () => {
    const document = createMindMapV1SmallFixture();
    const sheet = Object.values(document.sheets)[0];
    const unavailableSheetId = '03920000-0000-7000-8000-000000000099' as SheetId;

    expect(() => projectMindMapDocumentForStaticExport(document, {
      kind: 'selected-sheets',
      sheetIds: [],
    })).toThrowError(expect.objectContaining({ code: 'selected-sheets-empty' }));
    expect(() => projectMindMapDocumentForStaticExport(document, {
      kind: 'selected-sheets',
      sheetIds: [sheet.id, sheet.id],
    })).toThrowError(expect.objectContaining({ code: 'selected-sheets-duplicate' }));
    expect(() => projectMindMapDocumentForStaticExport(document, {
      kind: 'selected-sheets',
      sheetIds: [sheet.id, unavailableSheetId],
    })).toThrowError(expect.objectContaining({ code: 'sheet-unavailable' }));
  });

  it('keeps only a selected structural branch and its descendants', () => {
    const document = createMindMapV1SmallFixture();
    const sheet = Object.values(document.sheets)[0];
    const rootEdges = Object.values(sheet.treeEdges)
      .filter((edge) => edge.parentTopicId === sheet.rootTopicId);
    const branchEdge = rootEdges[0];
    if (!branchEdge) throw new Error('Fixture branch is missing.');
    const branchRootId = branchEdge.childTopicId;
    const descendantId = topicId(1);
    const siblingId = topicId(2);
    sheet.topics[descendantId] = createTopic({ id: descendantId, title: 'Included descendant' });
    sheet.treeEdges[edgeId(1)] = {
      id: edgeId(1),
      parentTopicId: branchRootId,
      childTopicId: descendantId,
      orderKey: 'branch-child',
      side: 'right',
    };
    sheet.topics[siblingId] = createTopic({ id: siblingId, title: 'Excluded sibling' });
    sheet.treeEdges[edgeId(2)] = {
      id: edgeId(2),
      parentTopicId: sheet.rootTopicId,
      childTopicId: siblingId,
      orderKey: 'root-sibling',
      side: 'right',
    };
    const attachTopicOwnedEntities = (ownerTopicId: TopicId, suffix: string): void => {
      sheet.markerInstances[`marker-${suffix}` as never] = {
        id: `marker-${suffix}`,
        topicId: ownerTopicId,
      } as never;
      sheet.notes[`note-${suffix}` as never] = { id: `note-${suffix}`, topicId: ownerTopicId } as never;
      sheet.links[`link-${suffix}` as never] = { id: `link-${suffix}`, topicId: ownerTopicId } as never;
      sheet.attachments[`attachment-${suffix}` as never] = {
        id: `attachment-${suffix}`,
        topicId: ownerTopicId,
      } as never;
      sheet.images[`image-${suffix}` as never] = { id: `image-${suffix}`, topicId: ownerTopicId } as never;
      sheet.equations[`equation-${suffix}` as never] = {
        id: `equation-${suffix}`,
        topicId: ownerTopicId,
      } as never;
      sheet.audioClips[`audio-${suffix}` as never] = { id: `audio-${suffix}`, topicId: ownerTopicId } as never;
      sheet.todos[`todo-${suffix}` as never] = { id: `todo-${suffix}`, topicId: ownerTopicId } as never;
      sheet.tasks[`task-${suffix}` as never] = { id: `task-${suffix}`, topicId: ownerTopicId } as never;
    };
    attachTopicOwnedEntities(descendantId, 'included');
    attachTopicOwnedEntities(siblingId, 'excluded');
    sheet.taskDependencies['dependency-included' as never] = {
      id: 'dependency-included',
      predecessorTaskId: 'task-included',
      successorTaskId: 'task-included',
    } as never;
    sheet.taskDependencies['dependency-cross-scope' as never] = {
      id: 'dependency-cross-scope',
      predecessorTaskId: 'task-included',
      successorTaskId: 'task-excluded',
    } as never;

    const projected = projectMindMapDocumentForStaticExport(document, {
      kind: 'branch',
      sheetId: sheet.id,
      rootTopicId: branchRootId,
    });
    const branch = projected.sheets[sheet.id];

    expect(branch.rootTopicId).toBe(branchRootId);
    expect(Object.keys(branch.topics)).toEqual(expect.arrayContaining([branchRootId, descendantId]));
    expect(branch.topics[sheet.rootTopicId]).toBeUndefined();
    expect(branch.topics[siblingId]).toBeUndefined();
    expect(Object.values(branch.treeEdges).every((edge) => (
      branch.topics[edge.parentTopicId] !== undefined
      && branch.topics[edge.childTopicId] !== undefined
    ))).toBe(true);
    const topicOwnedMaps = [
      branch.markerInstances,
      branch.notes,
      branch.links,
      branch.attachments,
      branch.images,
      branch.equations,
      branch.audioClips,
      branch.todos,
      branch.tasks,
    ];
    for (const map of topicOwnedMaps) {
      expect(Object.values(map)).toHaveLength(1);
      expect(Object.values(map)[0].topicId).toBe(descendantId);
    }
    expect(Object.keys(branch.taskDependencies)).toEqual(['dependency-included']);
  });

  it('rejects unavailable Sheet and branch targets deterministically', () => {
    const document = createMindMapV1SmallFixture();
    const sheet = Object.values(document.sheets)[0];
    expect(() => projectMindMapDocumentForStaticExport(document, {
      kind: 'sheet',
      sheetId: '03920000-0000-7000-8000-000000000001' as SheetId,
    })).toThrowError(MindMapStaticExportScopeError);
    expect(() => projectMindMapDocumentForStaticExport(document, {
      kind: 'branch',
      sheetId: sheet.id,
      rootTopicId: topicId(999),
    })).toThrowError(MindMapStaticExportScopeError);
  });
});
