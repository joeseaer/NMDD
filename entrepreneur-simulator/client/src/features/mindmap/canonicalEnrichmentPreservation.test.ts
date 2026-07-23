import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { encodeMindMapClipboard } from './clipboard';
import { createMindMapSheet } from './domain/defaults';
import {
  parseMindMapAttribute,
  serializeMindMapDocument,
} from './domain/persistence';
import type * as Domain from './domain/types';
import { validateMindMapDocument } from './domain/validation';
import { exportXMind, importXMind } from './io/xmind';
import { MindMapContentStore } from './store/contentStore';
import { createMindMapElementsFixture } from './testing/fixtures';
import {
  planPasteClipboardFragmentCommand,
} from './ui/clipboardPlanning';
import {
  planDeleteTopicSubtreeCommand,
  planUpdateTopicTitleCommand,
} from './ui/commandPlanning';
import { mindMapRichTextToPlainText } from './view/text';

const uuid = <K extends string>(counter: number): Domain.Id<K> =>
  `01890f1a-0000-7000-a000-${counter.toString(16).padStart(12, '0')}` as Domain.Id<K>;

function firstSheet(document: Domain.MindMapDocumentV1): Domain.MindMapSheet {
  const sheet = Object.values(document.sheets)[0];
  if (!sheet) throw new Error('Fixture has no sheet.');
  return sheet;
}

function createFullyEnrichedDocument(): Domain.MindMapDocumentV1 {
  const document = createMindMapElementsFixture();
  const sheet = firstSheet(document);
  const note = Object.values(sheet.notes)[0];
  if (!note) throw new Error('Semantic fixture has no Note.');
  sheet.topics[note.topicId].labels = ['P1', 'launch'];

  const validation = validateMindMapDocument(document);
  expect(validation.issues, JSON.stringify(validation.issues)).toEqual([]);
  return document;
}

function canonicalEnrichmentSnapshot(document: Domain.MindMapDocumentV1): unknown {
  return structuredClone({
    assets: document.assets,
    markerDefinitions: document.markerDefinitions,
    markerGroups: document.markerGroups,
    sheets: Object.fromEntries(Object.values(document.sheets).map((sheet) => [sheet.id, {
      attachments: sheet.attachments,
      audioClips: sheet.audioClips,
      equations: sheet.equations,
      images: sheet.images,
      links: sheet.links,
      markerInstances: sheet.markerInstances,
      notes: sheet.notes,
      taskDependencies: sheet.taskDependencies,
      tasks: sheet.tasks,
      todos: sheet.todos,
      topicLabels: Object.fromEntries(Object.values(sheet.topics).map((topic) => [
        topic.id,
        topic.labels ?? [],
      ])),
    }])),
  });
}

function expectRecordApplied(
  actual: Readonly<Record<string, unknown>>,
  expected: Readonly<Record<string, unknown>>,
): void {
  for (const [id, entity] of Object.entries(expected)) {
    expect(actual[id], `Missing or changed pasted entity ${id}`).toEqual(entity);
  }
}

function expectRecordIdsAbsent(
  actual: Readonly<Record<string, unknown>>,
  removed: Readonly<Record<string, unknown>>,
): void {
  for (const id of Object.keys(removed)) {
    expect(actual[id], `Deleted subtree retained entity ${id}`).toBeUndefined();
  }
}

function deterministicClipboardIdFactory(start = 1_100_000) {
  let counter = start;
  return (): string => {
    counter += 1;
    return uuid<'ClipboardEntity'>(counter);
  };
}

function decodeZipJson<T>(bytes: Uint8Array, path: string): T {
  const file = unzipSync(bytes)[path];
  if (!file) throw new Error(`XMind export is missing ${path}.`);
  return JSON.parse(new TextDecoder().decode(file)) as T;
}

interface NativeXMindTopic extends Record<string, unknown> {
  id: string;
  children?: Record<string, NativeXMindTopic[]>;
  href?: string;
  labels?: string[];
  markers?: Array<Record<string, unknown>>;
  notes?: { plain?: { content?: string } };
}

function collectNativeXMindTopics(value: unknown, result = new Map<string, NativeXMindTopic>()) {
  if (Array.isArray(value)) {
    for (const child of value) collectNativeXMindTopics(child, result);
    return result;
  }
  if (!value || typeof value !== 'object') return result;
  const record = value as Record<string, unknown>;
  if (record.class === 'topic' && typeof record.id === 'string') {
    result.set(record.id, record as NativeXMindTopic);
  }
  for (const child of Object.values(record)) collectNativeXMindTopics(child, result);
  return result;
}

describe('canonical P1 enrichment preservation contracts', () => {
  it('ACC-SEM-022 copies all topic enrichments and deletes/restores them atomically', () => {
    const source = createFullyEnrichedDocument();
    const sourceSheet = firstSheet(source);
    const sourceJson = serializeMindMapDocument(source);
    const clipboard = encodeMindMapClipboard({
      document: source,
      selectedTopicIds: [sourceSheet.rootTopicId],
      sheetId: sourceSheet.id,
    });
    const sourceFragment = clipboard.envelope.fragment;

    // These are the complete P1 entity families promised by this regression
    // test. A missing collection is a test-fixture failure, not an optional
    // assertion that could let copy silently omit one family.
    expect(Object.keys(sourceFragment.markerInstances).length).toBeGreaterThan(0);
    expect(Object.keys(sourceFragment.notes).length).toBeGreaterThan(0);
    expect(Object.keys(sourceFragment.links).length).toBeGreaterThan(0);
    expect(Object.keys(sourceFragment.attachments).length).toBeGreaterThan(0);
    expect(Object.keys(sourceFragment.images).length).toBeGreaterThan(0);
    expect(Object.keys(sourceFragment.todos).length).toBeGreaterThan(0);
    expect(Object.keys(sourceFragment.tasks).length).toBeGreaterThan(0);
    expect(Object.values(sourceFragment.topics).some((topic) =>
      topic.labels?.join('\u0000') === 'P1\u0000launch')).toBe(true);

    const requiredIds = new Set([
      ...Object.keys(sourceFragment.markerInstances),
      ...Object.keys(sourceFragment.notes),
      ...Object.keys(sourceFragment.links),
      ...Object.keys(sourceFragment.attachments),
      ...Object.keys(sourceFragment.images),
      ...Object.keys(sourceFragment.todos),
      ...Object.keys(sourceFragment.tasks),
    ]);
    expect(clipboard.envelope.report.omissions.filter((omission) =>
      requiredIds.has(omission.entityId))).toEqual([]);

    const store = new MindMapContentStore(source, () => undefined, { debounceMs: 60_000 });
    const paste = planPasteClipboardFragmentCommand({
      document: store.getSnapshot()!,
      envelope: clipboard.envelope,
      idFactory: deterministicClipboardIdFactory(),
      attachmentEdgeIdFactory: (_rootTopicId, index) =>
        uuid<'TreeEdge'>(1_900_000 + index),
      parentTopicId: sourceSheet.rootTopicId,
      sheetId: sourceSheet.id,
      timestamp: '2026-07-20T00:00:00.000Z',
    });
    const pasted = store.dispatch(paste);
    const pastedSheet = pasted.sheets[sourceSheet.id];
    const fragment = paste.payload.fragment;

    expectRecordApplied(pastedSheet.topics, fragment.topics);
    expectRecordApplied(pastedSheet.markerInstances, fragment.markerInstances);
    expectRecordApplied(pastedSheet.notes, fragment.notes);
    expectRecordApplied(pastedSheet.links, fragment.links);
    expectRecordApplied(pastedSheet.attachments, fragment.attachments);
    expectRecordApplied(pastedSheet.images, fragment.images);
    expectRecordApplied(pastedSheet.todos, fragment.todos);
    expectRecordApplied(pastedSheet.tasks, fragment.tasks);
    expectRecordApplied(pastedSheet.taskDependencies, fragment.taskDependencies);
    expectRecordApplied(pasted.assets, fragment.assets);
    expectRecordApplied(pasted.markerGroups, fragment.markerGroups);
    expectRecordApplied(pasted.markerDefinitions, fragment.markerDefinitions);
    expect(validateMindMapDocument(pasted).valid).toBe(true);

    expect(store.undo()).toEqual(source);
    const pastedAgain = store.redo();
    expect(pastedAgain).toEqual(pasted);

    const pastedRootId = paste.payload.rootTopicIds[0];
    const removePastedSubtree = planDeleteTopicSubtreeCommand({
      document: pastedAgain!,
      sheetId: sourceSheet.id,
      topicId: pastedRootId,
      timestamp: '2026-07-20T00:00:01.000Z',
    });
    const deleted = store.dispatch(removePastedSubtree);
    const deletedSheet = deleted.sheets[sourceSheet.id];
    expectRecordIdsAbsent(deletedSheet.topics, fragment.topics);
    expectRecordIdsAbsent(deletedSheet.markerInstances, fragment.markerInstances);
    expectRecordIdsAbsent(deletedSheet.notes, fragment.notes);
    expectRecordIdsAbsent(deletedSheet.links, fragment.links);
    expectRecordIdsAbsent(deletedSheet.attachments, fragment.attachments);
    expectRecordIdsAbsent(deletedSheet.images, fragment.images);
    expectRecordIdsAbsent(deletedSheet.todos, fragment.todos);
    expectRecordIdsAbsent(deletedSheet.tasks, fragment.tasks);
    expectRecordIdsAbsent(deletedSheet.taskDependencies, fragment.taskDependencies);
    expect(validateMindMapDocument(deleted).valid).toBe(true);

    expect(store.undo()).toEqual(pasted);
    expect(store.redo()).toEqual(deleted);
    expect(store.undo()).toEqual(pasted);
    expect(serializeMindMapDocument(store.undo()!)).toBe(sourceJson);
    store.dispose();
  });

  it('ACC-SEM-022 marks same-sheet and cross-sheet topic links broken and undo restores active', () => {
    const source = createFullyEnrichedDocument();
    const targetSheet = firstSheet(source);
    const note = Object.values(targetSheet.notes)[0];
    if (!note) throw new Error('Semantic fixture has no deletion target.');

    const otherSheetId = uuid<'Sheet'>(990_001);
    const otherRootId = uuid<'Topic'>(990_002);
    const otherSheet = createMindMapSheet({
      id: otherSheetId,
      orderKey: 'z',
      rootTopicId: otherRootId,
      rootTitle: 'Cross-sheet link owner',
      themeId: targetSheet.themeId,
      title: 'References',
    });
    source.sheets[otherSheetId] = otherSheet;

    const sameSheetLinkId = uuid<'Link'>(990_003);
    const crossSheetLinkId = uuid<'Link'>(990_004);
    targetSheet.links[sameSheetLinkId] = {
      id: sameSheetLinkId,
      kind: 'topic',
      orderKey: 'same-sheet-target',
      status: 'active',
      targetSheetId: targetSheet.id,
      targetTopicId: note.topicId,
      topicId: targetSheet.rootTopicId,
    };
    otherSheet.links[crossSheetLinkId] = {
      id: crossSheetLinkId,
      kind: 'topic',
      orderKey: 'cross-sheet-target',
      status: 'active',
      targetSheetId: targetSheet.id,
      targetTopicId: note.topicId,
      topicId: otherRootId,
    };
    expect(validateMindMapDocument(source).valid).toBe(true);

    const store = new MindMapContentStore(source, () => undefined, { debounceMs: 60_000 });
    const deleted = store.dispatch(planDeleteTopicSubtreeCommand({
      document: store.getSnapshot()!,
      sheetId: targetSheet.id,
      topicId: note.topicId,
      timestamp: '2026-07-20T00:00:00.000Z',
    }));
    expect(deleted.sheets[targetSheet.id].links[sameSheetLinkId]).toMatchObject({
      status: 'broken',
      targetTopicId: note.topicId,
    });
    expect(deleted.sheets[otherSheetId].links[crossSheetLinkId]).toMatchObject({
      status: 'broken',
      targetTopicId: note.topicId,
    });
    expect(validateMindMapDocument(deleted).valid).toBe(true);

    const restored = store.undo();
    expect(restored).toEqual(source);
    expect(restored!.sheets[targetSheet.id].links[sameSheetLinkId].status).toBe('active');
    expect(restored!.sheets[otherSheetId].links[crossSheetLinkId].status).toBe('active');
    const deletedAgain = store.redo();
    expect(deletedAgain).toEqual(deleted);
    store.dispose();
  });

  it('ACC-IO-020 persists and reloads every untouched P1 enrichment through the attribute bridge', () => {
    const source = createFullyEnrichedDocument();
    const sheet = firstSheet(source);
    const beforeEnrichments = canonicalEnrichmentSnapshot(source);
    const writes: string[] = [];
    const store = new MindMapContentStore(source, (write) => writes.push(write.data), {
      debounceMs: 60_000,
    });
    const edited = store.dispatch(planUpdateTopicTitleCommand({
      document: store.getSnapshot()!,
      sheetId: sheet.id,
      topicId: sheet.rootTopicId,
      title: 'Core edit before save',
      timestamp: '2026-07-20T00:00:00.000Z',
    }));
    store.flush();

    expect(writes).toHaveLength(1);
    expect(canonicalEnrichmentSnapshot(edited)).toEqual(beforeEnrichments);
    const parsed = parseMindMapAttribute(writes[0]);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error('Expected the persisted canonical attribute to reload.');
    expect(parsed.document).toEqual(edited);
    expect(serializeMindMapDocument(parsed.document)).toBe(writes[0]);

    const reloaded = new MindMapContentStore(writes[0], () => undefined);
    expect(reloaded.getSnapshot()).toEqual(edited);
    expect(canonicalEnrichmentSnapshot(reloaded.getSnapshot()!)).toEqual(beforeEnrichments);
    reloaded.dispose();
    store.dispose();
  });

  it('ACC-IO-020 emits native XMind semantics and diagnostic-backed lossless fallbacks', () => {
    const source = createFullyEnrichedDocument();
    const sheet = firstSheet(source);
    const exported = exportXMind(source);
    expect(exported.report.success, JSON.stringify(exported.report.diagnostics)).toBe(true);
    expect(exported.bytes).not.toBeNull();
    expect(exported.report.diagnostics).toContainEqual(expect.objectContaining({
      code: 'xmind.canonical-features-in-metadata',
      disposition: 'preserved',
      path: '/metadata.json/nmdd/canonicalFallback',
    }));
    expect(exported.report.diagnostics).toContainEqual(expect.objectContaining({
      code: 'xmind.resource-bytes-unavailable',
      disposition: 'degraded',
      path: '/metadata.json/nmdd/canonicalFallback/assets',
    }));
    expect(exported.report.diagnostics.filter((diagnostic) =>
      diagnostic.disposition === 'degraded').map((diagnostic) => diagnostic.code)).toEqual([
      'xmind.image-resource-bytes-unavailable',
      'xmind.resource-bytes-unavailable',
    ]);

    const content = decodeZipJson<unknown[]>(exported.bytes!, 'content.json');
    const nativeTopics = collectNativeXMindTopics(content);
    const note = Object.values(sheet.notes)[0];
    const link = Object.values(sheet.links)[0];
    const marker = Object.values(sheet.markerInstances)[0];
    const todo = Object.values(sheet.todos)[0];
    if (!note || !link || !marker || !todo) {
      throw new Error('Semantic fixture is missing a native XMind enrichment.');
    }
    const markerDefinition = source.markerDefinitions[marker.markerDefinitionId];
    const markerGroup = source.markerGroups[markerDefinition.groupId];
    if (markerDefinition.source.kind !== 'builtin') {
      throw new Error('Semantic fixture marker must be native XMind-compatible.');
    }
    expect(nativeTopics.get(note.topicId)?.labels).toEqual(sheet.topics[note.topicId].labels);
    expect(nativeTopics.get(note.topicId)?.notes).toEqual({
      plain: { content: mindMapRichTextToPlainText(note.content) },
    });
    expect(nativeTopics.get(marker.topicId)?.markers).toContainEqual({
      groupId: markerGroup.name,
      markerId: markerDefinition.source.key,
    });
    expect(nativeTopics.get(todo.topicId)?.markers).toContainEqual({
      groupId: 'task',
      markerId: todo.completed ? 'task-done' : 'task-start',
    });
    if (link.kind !== 'web') throw new Error('Semantic fixture link must be native web href.');
    expect(nativeTopics.get(link.topicId)?.href).toBe(link.href);

    const metadata = decodeZipJson<{
      nmdd: { canonicalFallback: Domain.MindMapDocumentV1 };
    }>(exported.bytes!, 'metadata.json');
    const fallback = metadata.nmdd.canonicalFallback;
    expect(fallback.assets).toEqual(source.assets);
    expect(fallback.sheets[sheet.id].attachments).toEqual(sheet.attachments);
    expect(fallback.sheets[sheet.id].images).toEqual(sheet.images);
    expect(fallback.sheets[sheet.id].tasks).toEqual(sheet.tasks);
    expect(fallback.sheets[sheet.id].taskDependencies).toEqual(sheet.taskDependencies);

    const imported = importXMind(exported.bytes!);
    expect(imported.report.success, JSON.stringify(imported.report.diagnostics)).toBe(true);
    expect(imported.report.diagnostics).toContainEqual(expect.objectContaining({
      code: 'xmind.canonical-fallback-restored',
      disposition: 'preserved',
      path: '/metadata.json/nmdd/canonicalFallback',
    }));
    // Whole-document equality is intentional: it prevents a native projection
    // check from hiding the loss of any unsupported or future canonical field.
    expect(imported.document).toEqual(source);
  });
});
