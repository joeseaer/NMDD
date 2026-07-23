import { describe, expect, it } from 'vitest';

import { encodeMindMapClipboard } from '../clipboard';
import { clipboardRichTextToPlainText } from '../clipboard/outline';
import type { MindMapDocumentV1, MindMapSheet } from '../domain/types';
import { MindMapContentStore } from '../store/contentStore';
import {
  createMindMapElementsFixture,
  createMindMapV1SmallFixture,
} from '../testing/fixtures';
import {
  clipboardFallbackTitle,
  planCutMindMapClipboard,
  planPasteClipboardFragmentCommand,
  planPasteTextTopicCommand,
} from './clipboardPlanning';

const firstSheet = (document: MindMapDocumentV1): MindMapSheet => {
  const sheet = Object.values(document.sheets)[0];
  if (!sheet) throw new Error('Fixture has no sheet.');
  return sheet;
};

describe('mind map clipboard command planning', () => {
  it('pastes a fully remapped semantic fragment atomically and undoes in one step', () => {
    const document = createMindMapElementsFixture();
    const sourceSheet = firstSheet(document);
    const encoded = encodeMindMapClipboard({
      document,
      sheetId: sourceSheet.id,
      selectedTopicIds: [sourceSheet.rootTopicId],
    });
    const before = JSON.stringify(document);
    const originalTopicIds = new Set(Object.keys(sourceSheet.topics));
    const originalRelationshipIds = new Set(Object.keys(sourceSheet.relationships));
    const writes: string[] = [];
    const store = new MindMapContentStore(document, (write) => writes.push(write.data), {
      debounceMs: 0,
    });

    const command = planPasteClipboardFragmentCommand({
      document,
      sheetId: sourceSheet.id,
      parentTopicId: sourceSheet.rootTopicId,
      envelope: encoded.envelope,
      timestamp: '2026-07-19T00:00:00.000Z',
    });
    const pasted = store.dispatch(command);
    const pastedSheet = pasted.sheets[sourceSheet.id];

    expect(command.payload.attachmentEdges).toHaveLength(1);
    expect(command.payload.attachmentEdges[0]).toMatchObject({
      parentTopicId: sourceSheet.rootTopicId,
      childTopicId: command.payload.rootTopicIds[0],
    });
    expect(command.payload.fragment.topics[command.payload.rootTopicIds[0]].role).toBe('regular');
    expect(Object.keys(pastedSheet.topics)).toHaveLength(
      Object.keys(sourceSheet.topics).length + Object.keys(encoded.envelope.fragment.topics).length,
    );
    expect(Object.keys(pastedSheet.relationships)).toHaveLength(
      Object.keys(sourceSheet.relationships).length
        + Object.keys(encoded.envelope.fragment.relationships).length,
    );
    expect(command.payload.rootTopicIds.every((id) => !originalTopicIds.has(id))).toBe(true);
    expect(
      Object.keys(command.payload.fragment.relationships)
        .every((id) => !originalRelationshipIds.has(id)),
    ).toBe(true);
    const pastedBoundary = Object.values(command.payload.fragment.boundaries)[0];
    expect(pastedBoundary.scope).toMatchObject({
      kind: 'sibling-range',
      includeDescendants: true,
    });
    const pastedSummary = Object.values(command.payload.fragment.summaries)[0];
    expect(pastedSummary.scope).toMatchObject({
      kind: 'sibling-range',
      includeDescendants: true,
    });

    const restored = store.undo();
    expect(restored?.contentRevision).toBe(document.contentRevision);
    expect(JSON.stringify(restored)).toBe(before);
    expect(store.canUndo).toBe(false);
    store.dispose();
  });

  it('resolves an inherit destination through its ancestor when choosing pasted root side', () => {
    const document = createMindMapV1SmallFixture();
    const sheet = firstSheet(document);
    const leftRootEdge = Object.values(sheet.treeEdges).find(
      (edge) => edge.parentTopicId === sheet.rootTopicId && edge.side === 'left',
    );
    if (!leftRootEdge) throw new Error('Fixture has no left root branch.');
    const inheritedChildren = Object.values(sheet.treeEdges)
      .filter((edge) => edge.parentTopicId === leftRootEdge.childTopicId && edge.side === 'inherit');
    if (inheritedChildren.length < 2) throw new Error('Fixture needs two inherited children.');
    const encoded = encodeMindMapClipboard({
      document,
      sheetId: sheet.id,
      selectedTopicIds: [inheritedChildren[1].childTopicId],
    });
    const command = planPasteClipboardFragmentCommand({
      document,
      sheetId: sheet.id,
      parentTopicId: inheritedChildren[0].childTopicId,
      envelope: encoded.envelope,
      timestamp: '2026-07-19T00:00:00.000Z',
    });
    expect(command.payload.attachmentEdges[0].side).toBe('left');
  });

  it('plans cut from highest-level non-central roots and rejects cutting the central root', () => {
    const document = createMindMapV1SmallFixture();
    const sheet = firstSheet(document);
    const branch = Object.values(sheet.treeEdges).find(
      (edge) => edge.parentTopicId === sheet.rootTopicId,
    );
    if (!branch) throw new Error('Fixture has no branch.');
    const descendant = Object.values(sheet.treeEdges).find(
      (edge) => edge.parentTopicId === branch.childTopicId,
    );
    if (!descendant) throw new Error('Fixture branch has no descendant.');

    const cut = planCutMindMapClipboard({
      document,
      sheetId: sheet.id,
      selectedTopicIds: [branch.childTopicId, descendant.childTopicId],
    });
    expect(cut.rootTopicIds).toEqual([branch.childTopicId]);
    expect(() => planCutMindMapClipboard({
      document,
      sheetId: sheet.id,
      selectedTopicIds: [sheet.rootTopicId],
    })).toThrow(/central topic cannot be cut/i);
  });

  it('safely degrades Markdown or plain text to one bounded topic title', () => {
    const document = createMindMapV1SmallFixture();
    const sheet = firstSheet(document);
    expect(clipboardFallbackTitle('  - External topic\n    - Child')).toBe('External topic');
    expect(clipboardFallbackTitle(' \r\n ')).toBeNull();

    const command = planPasteTextTopicCommand({
      document,
      sheetId: sheet.id,
      parentTopicId: sheet.rootTopicId,
      text: '1. Imported from text\n2. Ignored child',
      timestamp: '2026-07-19T00:00:00.000Z',
    });
    expect(clipboardRichTextToPlainText(command.payload.topic.title)).toBe('Imported from text');
    expect(command.payload.edge?.parentTopicId).toBe(sheet.rootTopicId);
  });
});
