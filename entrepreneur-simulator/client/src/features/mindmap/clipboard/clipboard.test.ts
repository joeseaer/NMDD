import { describe, expect, it } from 'vitest';

import type * as Domain from '../domain/types';
import {
  createMindMapElementsFixture,
  createMindMapV1SmallFixture,
} from '../testing/fixtures';
import {
  DEFAULT_MIND_MAP_CLIPBOARD_LIMITS,
  MIND_MAP_CLIPBOARD_HTML_MIME,
  MIND_MAP_CLIPBOARD_MARKDOWN_MIME,
  MIND_MAP_CLIPBOARD_MIME,
  MIND_MAP_CLIPBOARD_TEXT_MIME,
  MindMapClipboardError,
  clipboardRichTextToPlainText,
  decodeMindMapClipboard,
  encodeMindMapClipboard,
  remapMindMapClipboard,
} from './index';

const uuid = <K extends string>(suffix: number): Domain.Id<K> =>
  `01890f1a-0000-7000-a000-${suffix.toString(16).padStart(12, '0')}` as Domain.Id<K>;

function firstSheet(document: Domain.MindMapDocumentV1): Domain.MindMapSheet {
  const sheet = Object.values(document.sheets)[0];
  if (!sheet) throw new Error('Fixture has no sheet.');
  return sheet;
}

function expectClipboardError(
  action: () => unknown,
  code: MindMapClipboardError['code'],
): MindMapClipboardError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(MindMapClipboardError);
    expect((error as MindMapClipboardError).code).toBe(code);
    return error as MindMapClipboardError;
  }
  throw new Error(`Expected ${code}.`);
}

describe('canonical mind map clipboard codec', () => {
  it('round-trips a highest-level selected subtree and emits readable outline fallbacks', () => {
    const document = createMindMapV1SmallFixture();
    const sheet = firstSheet(document);
    const branchEdge = Object.values(sheet.treeEdges)
      .filter((edge) => edge.parentTopicId === sheet.rootTopicId)
      .sort((left, right) => left.orderKey.localeCompare(right.orderKey))[0];
    if (!branchEdge) throw new Error('Fixture has no branch.');
    const childEdge = Object.values(sheet.treeEdges).find(
      (edge) => edge.parentTopicId === branchEdge.childTopicId,
    );
    if (!childEdge) throw new Error('Fixture branch has no child.');

    const encoded = encodeMindMapClipboard({
      document,
      selectedTopicIds: [childEdge.childTopicId, branchEdge.childTopicId],
      sheetId: sheet.id,
    });

    expect(encoded.envelope.rootTopicIds).toEqual([branchEdge.childTopicId]);
    expect(Object.keys(encoded.envelope.fragment.topics)).toHaveLength(3);
    expect(Object.keys(encoded.envelope.fragment.treeEdges)).toHaveLength(2);
    expect(encoded.mimeData[MIND_MAP_CLIPBOARD_MIME]).toBeTruthy();

    const decoded = decodeMindMapClipboard(encoded.mimeData);
    expect(decoded).toEqual(encoded.envelope);

    const plainLines = encoded.mimeData[MIND_MAP_CLIPBOARD_TEXT_MIME].split('\n');
    const markdownLines = encoded.mimeData[MIND_MAP_CLIPBOARD_MARKDOWN_MIME].split('\n');
    const html = encoded.mimeData[MIND_MAP_CLIPBOARD_HTML_MIME];
    expect(plainLines).toHaveLength(3);
    expect(plainLines[0]).toBe(
      clipboardRichTextToPlainText(sheet.topics[branchEdge.childTopicId].title),
    );
    expect(plainLines[1].startsWith('\t')).toBe(true);
    expect(markdownLines[0].startsWith('- ')).toBe(true);
    expect(markdownLines[1].startsWith('  - ')).toBe(true);
    expect(html).toContain('<ul data-nmdd-mindmap-outline="1">');
    expect(html).toContain('<ul><li>');
  });

  it('emits a safely escaped hierarchical HTML outline', () => {
    const document = createMindMapV1SmallFixture();
    const sheet = firstSheet(document);
    sheet.topics[sheet.rootTopicId].title = {
      blocks: [{
        children: [{
          text: '<img src=x onerror="alert(1)"> & \'quoted\'',
          type: 'text',
        }],
        type: 'paragraph',
      }],
      type: 'doc',
      version: 1,
    };

    const encoded = encodeMindMapClipboard({
      document,
      selectedTopicIds: [sheet.rootTopicId],
      sheetId: sheet.id,
    });
    const html = encoded.mimeData[MIND_MAP_CLIPBOARD_HTML_MIME];

    expect(html).toContain(
      '&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;quoted&#39;',
    );
    expect(html).not.toContain('<img');
    expect(html).not.toContain('onerror="alert(1)"');
    expect(html).toMatch(/^<ul data-nmdd-mindmap-outline="1"><li>.+<ul><li>.+<\/li>/u);
  });

  it('collects internal semantic entities, styles and resource references without mixing edge kinds', () => {
    const document = createMindMapElementsFixture();
    const sheet = firstSheet(document);
    const styledTopic = Object.values(sheet.topics).find((topic) => topic.role === 'regular');
    if (!styledTopic) throw new Error('Fixture has no regular topic.');
    const styleId = uuid<'Style'>(900_001);
    document.styles[styleId] = {
      id: styleId,
      name: 'Clipboard topic style',
      properties: { fill: { color: { kind: 'literal', value: '#f0f5ff' } } },
      scope: 'topic',
    };
    styledTopic.style = { styleId };

    const encoded = encodeMindMapClipboard({
      document,
      selectedTopicIds: [sheet.rootTopicId],
      sheetId: sheet.id,
    });
    const fragment = encoded.envelope.fragment;

    expect(Object.keys(fragment.relationships)).toHaveLength(2);
    expect(Object.keys(fragment.treeEdges)).toHaveLength(4);
    expect(Object.keys(fragment.boundaries)).toHaveLength(1);
    expect(Object.keys(fragment.summaries)).toHaveLength(1);
    expect(Object.keys(fragment.callouts)).toHaveLength(1);
    expect(Object.keys(fragment.markerInstances)).toHaveLength(1);
    expect(Object.keys(fragment.taskDependencies)).toHaveLength(1);
    expect(Object.keys(fragment.assets)).toHaveLength(2);
    expect(fragment.styles[styleId]).toBeDefined();
    for (const relationshipId of Object.keys(fragment.relationships)) {
      expect(fragment.treeEdges[relationshipId as Domain.TreeEdgeId]).toBeUndefined();
    }
  });

  it('rejects malformed Summary ownership, result roots, and illegal scopes', () => {
    const document = createMindMapElementsFixture();
    const sheet = firstSheet(document);
    const encoded = encodeMindMapClipboard({
      document,
      selectedTopicIds: [sheet.rootTopicId],
      sheetId: sheet.id,
    });
    const summary = Object.values(encoded.envelope.fragment.summaries)[0];
    if (!summary) throw new Error('Fixture has no Summary.');

    const wrongRole = structuredClone(encoded.envelope);
    wrongRole.fragment.topics[summary.resultTopicId].role = 'regular';
    const wrongRoleError = expectClipboardError(
      () => decodeMindMapClipboard(JSON.stringify(wrongRole)),
      'clipboard.invalid-reference',
    );
    expect(wrongRoleError.details.some((detail) => detail.includes('role summary-result')))
      .toBe(true);

    const incomingResult = structuredClone(encoded.envelope);
    const resultEdgeId = uuid<'TreeEdge'>(940_001);
    incomingResult.fragment.treeEdges[resultEdgeId] = {
      id: resultEdgeId,
      parentTopicId: sheet.rootTopicId,
      childTopicId: summary.resultTopicId,
      orderKey: 'summary-result-malformed',
      side: 'right',
    };
    const incomingError = expectClipboardError(
      () => decodeMindMapClipboard(JSON.stringify(incomingResult)),
      'clipboard.invalid-reference',
    );
    expect(incomingError.details.some((detail) => detail.includes('incoming TreeEdge')))
      .toBe(true);

    const duplicateOwner = structuredClone(encoded.envelope);
    const duplicateSummaryId = uuid<'Summary'>(940_002);
    duplicateOwner.fragment.summaries[duplicateSummaryId] = {
      ...structuredClone(summary),
      id: duplicateSummaryId,
    };
    const ownerError = expectClipboardError(
      () => decodeMindMapClipboard(JSON.stringify(duplicateOwner)),
      'clipboard.invalid-reference',
    );
    expect(ownerError.details.some((detail) => detail.includes('multiple owners'))).toBe(true);

    const selfScoped = structuredClone(encoded.envelope);
    selfScoped.fragment.summaries[summary.id].scope = {
      kind: 'explicit',
      topicIds: [summary.resultTopicId],
    };
    const selfScopeError = expectClipboardError(
      () => decodeMindMapClipboard(JSON.stringify(selfScoped)),
      'clipboard.invalid-reference',
    );
    expect(selfScopeError.details.some((detail) => detail.includes('own scope'))).toBe(true);

    const centralScoped = structuredClone(encoded.envelope);
    centralScoped.fragment.summaries[summary.id].scope = {
      kind: 'explicit',
      topicIds: [sheet.rootTopicId],
    };
    const centralScopeError = expectClipboardError(
      () => decodeMindMapClipboard(JSON.stringify(centralScoped)),
      'clipboard.invalid-reference',
    );
    expect(centralScopeError.details.some((detail) => detail.includes('illegal topic'))).toBe(true);
  });

  it('remaps every copied entity ID, preserves Relationships separately, and rewrites internal links', () => {
    const document = createMindMapElementsFixture();
    const sheet = firstSheet(document);
    const rootChildren = Object.values(sheet.treeEdges)
      .filter((edge) => edge.parentTopicId === sheet.rootTopicId)
      .sort((left, right) => left.orderKey.localeCompare(right.orderKey));
    const sourceRoot = rootChildren[0]?.childTopicId;
    const internalTarget = sourceRoot
      ? Object.values(sheet.treeEdges).find((edge) => edge.parentTopicId === sourceRoot)?.childTopicId
      : undefined;
    const externalTarget = rootChildren[1]?.childTopicId;
    if (!sourceRoot || !internalTarget || !externalTarget) {
      throw new Error('Fixture is missing link test topics.');
    }
    const internalLinkId = uuid<'Link'>(910_001);
    const externalLinkId = uuid<'Link'>(910_002);
    const internalRelationshipId = uuid<'Relationship'>(910_003);
    sheet.links[internalLinkId] = {
      id: internalLinkId,
      kind: 'topic',
      orderKey: 'internal',
      status: 'active',
      targetSheetId: sheet.id,
      targetTopicId: internalTarget,
      topicId: sourceRoot,
    };
    sheet.links[externalLinkId] = {
      id: externalLinkId,
      kind: 'topic',
      orderKey: 'external',
      status: 'active',
      targetSheetId: sheet.id,
      targetTopicId: externalTarget,
      topicId: sourceRoot,
    };
    sheet.relationships[internalRelationshipId] = {
      endArrow: 'triangle',
      id: internalRelationshipId,
      routing: 'curve',
      source: { anchor: 'right', element: { kind: 'topic', topicId: sourceRoot } },
      startArrow: 'none',
      target: { anchor: 'left', element: { kind: 'topic', topicId: internalTarget } },
    };

    const envelope = encodeMindMapClipboard({
      document,
      selectedTopicIds: [sourceRoot],
      sheetId: sheet.id,
    }).envelope;
    expect(envelope.fragment.links[internalLinkId]).toBeDefined();
    expect(envelope.fragment.links[externalLinkId]).toBeUndefined();
    expect(envelope.fragment.relationships[internalRelationshipId]).toBeDefined();
    expect(envelope.report.omissions).toContainEqual({
      entityId: externalLinkId,
      entityType: 'link',
      reason: 'external-topic-link',
    });

    let counter = 0;
    const destinationDocumentId = uuid<'Document'>(920_001);
    const destinationSheetId = uuid<'Sheet'>(920_002);
    const occupiedId = '01890f1a-0000-7000-b000-000000000001';
    const remapped = remapMindMapClipboard(envelope, {
      destinationDocumentId,
      destinationSheetId,
      existingIds: [occupiedId],
      idFactory: () => {
        counter += 1;
        return `01890f1a-0000-7000-b000-${counter.toString(16).padStart(12, '0')}`;
      },
    });

    const oldIds = Object.keys(remapped.idMap);
    const newIds = Object.values(remapped.idMap);
    expect(new Set(newIds).size).toBe(newIds.length);
    expect(newIds).not.toContain(occupiedId);
    expect(oldIds.every((id) => remapped.idMap[id] !== id)).toBe(true);
    const serializedFragment = JSON.stringify(remapped.fragment);
    expect(oldIds.every((id) => !serializedFragment.includes(id))).toBe(true);

    const remappedLinkId = remapped.idMap[internalLinkId] as Domain.LinkId;
    const remappedLink = remapped.fragment.links[remappedLinkId];
    expect(remappedLink.kind).toBe('topic');
    if (remappedLink.kind !== 'topic') throw new Error('Expected topic link.');
    expect(remappedLink.targetSheetId).toBe(destinationSheetId);
    expect(remappedLink.targetTopicId).toBe(remapped.idMap[internalTarget]);

    expect(Object.keys(remapped.fragment.relationships)).toHaveLength(
      Object.keys(envelope.fragment.relationships).length,
    );
    expect(Object.keys(remapped.fragment.treeEdges)).toHaveLength(
      Object.keys(envelope.fragment.treeEdges).length,
    );
    for (const relationshipId of Object.keys(remapped.fragment.relationships)) {
      expect(remapped.fragment.treeEdges[relationshipId as Domain.TreeEdgeId]).toBeUndefined();
    }
  });

  it('rejects oversized, over-deep, prototype-polluting, unsafe-URL and dangling payloads', () => {
    const document = createMindMapV1SmallFixture();
    const sheet = firstSheet(document);
    const encoded = encodeMindMapClipboard({
      document,
      selectedTopicIds: [sheet.rootTopicId],
      sheetId: sheet.id,
    });
    const raw = encoded.mimeData[MIND_MAP_CLIPBOARD_MIME];

    const oversized = expectClipboardError(
      () => decodeMindMapClipboard(raw, {
        limits: { ...DEFAULT_MIND_MAP_CLIPBOARD_LIMITS, maxBytes: 64 },
      }),
      'clipboard.invalid-envelope',
    );
    expect(oversized.details).toContain('json.too-large');

    const deep = structuredClone(encoded.envelope) as unknown as Record<string, unknown>;
    let nested: Record<string, unknown> = {};
    const topic = Object.values((deep.fragment as { topics: Record<string, Domain.Topic> }).topics)[0];
    topic.extensions = { 'app.nmdd.deep': nested };
    for (let index = 0; index < 80; index += 1) {
      nested.next = {};
      nested = nested.next as Record<string, unknown>;
    }
    const overDeep = expectClipboardError(
      () => decodeMindMapClipboard(JSON.stringify(deep)),
      'clipboard.invalid-envelope',
    );
    expect(overDeep.details).toContain('json.too-deep');

    const polluted = raw.replace('"fragment":', '"__proto__":{},"fragment":');
    expectClipboardError(() => decodeMindMapClipboard(polluted), 'clipboard.unsafe-key');

    const unsafe = structuredClone(encoded.envelope);
    const unsafeTopic = Object.values(unsafe.fragment.topics)[0];
    const paragraph = unsafeTopic.title.blocks[0];
    if (paragraph.type !== 'paragraph') throw new Error('Expected paragraph title.');
    paragraph.children[0] = {
      marks: [{ href: 'javascript:alert(1)', type: 'link' }],
      text: 'unsafe',
      type: 'text',
    };
    expectClipboardError(
      () => decodeMindMapClipboard(JSON.stringify(unsafe)),
      'clipboard.unsafe-url',
    );

    const dangling = structuredClone(encoded.envelope);
    const relationshipId = uuid<'Relationship'>(930_001);
    dangling.fragment.relationships[relationshipId] = {
      endArrow: 'triangle',
      id: relationshipId,
      routing: 'curve',
      source: {
        anchor: 'auto',
        element: { kind: 'topic', topicId: sheet.rootTopicId },
      },
      startArrow: 'none',
      target: {
        anchor: 'auto',
        element: { kind: 'topic', topicId: uuid<'Topic'>(930_002) },
      },
    };
    expectClipboardError(
      () => decodeMindMapClipboard(JSON.stringify(dangling)),
      'clipboard.invalid-reference',
    );
  });

  it('rejects credentialed URLs and unsafe embedded or managed image paths', () => {
    const document = createMindMapElementsFixture();
    const sheet = firstSheet(document);
    const encoded = encodeMindMapClipboard({
      document,
      selectedTopicIds: [sheet.rootTopicId],
      sheetId: sheet.id,
    });
    const firstAsset = Object.values(encoded.envelope.fragment.assets)[0];
    if (!firstAsset) throw new Error('Fixture has no copied Asset.');

    const credentialed = structuredClone(encoded.envelope);
    credentialed.fragment.assets[firstAsset.id].source = {
      kind: 'remote',
      url: 'https://cdn.example.test/image.png?X-Amz-Signature=do-not-copy',
    };
    const credentialError = expectClipboardError(
      () => decodeMindMapClipboard(JSON.stringify(credentialed)),
      'clipboard.unsafe-url',
    );
    expect(credentialError.details.some((detail) => detail.endsWith('/url'))).toBe(true);

    const traversing = structuredClone(encoded.envelope);
    traversing.fragment.assets[firstAsset.id].source = {
      kind: 'embedded',
      relativePath: 'assets/%2e%2e/private.png',
    };
    const traversalError = expectClipboardError(
      () => decodeMindMapClipboard(JSON.stringify(traversing)),
      'clipboard.invalid-reference',
    );
    expect(traversalError.details.some((detail) => detail.includes('unsafe embedded path')))
      .toBe(true);

    const managed = structuredClone(encoded.envelope);
    managed.fragment.assets[firstAsset.id].source = {
      kind: 'managed',
      objectKey: 'C:/private/image.png',
    };
    const managedError = expectClipboardError(
      () => decodeMindMapClipboard(JSON.stringify(managed)),
      'clipboard.invalid-reference',
    );
    expect(managedError.details.some((detail) => detail.includes('unsafe managed object key')))
      .toBe(true);
  });
});
