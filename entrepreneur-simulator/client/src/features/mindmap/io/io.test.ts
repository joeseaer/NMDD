import { describe, expect, it } from 'vitest';

import type { LinkId, TopicLink } from '../domain/types';
import { validateMindMapDocument } from '../domain/validation';
import { createMindMapElementsFixture } from '../testing/fixtures';
import { mindMapRichTextToPlainText } from '../view/text';
import {
  OPML_ATTRIBUTES_EXTENSION_KEY,
  exportMindMapToMarkdown,
  exportMindMapToOpml,
  importMindMapFromMarkdown,
  importMindMapFromOpml,
  projectMindMapToNormalizedOutline,
  utf8ByteLength,
  type MindMapImportIdFactory,
  type NormalizedOutlineNode,
} from './index';

function deterministicIdFactory(start = 1): MindMapImportIdFactory {
  let counter = start;
  return () => {
    const suffix = counter.toString(16).padStart(12, '0');
    counter += 1;
    return `01890f1a-0000-7000-8000-${suffix}`;
  };
}

function isSafeExternalLink(
  link: TopicLink,
): link is TopicLink & { href: string; kind: 'email' | 'web' } {
  return (link.kind === 'web' || link.kind === 'email') && link.status === 'active';
}

function nodeShape(node: NormalizedOutlineNode): unknown {
  return {
    children: node.children.map(nodeShape),
    title: node.title,
  };
}

function documentShape(document: NonNullable<ReturnType<typeof importMindMapFromMarkdown>['document']>): unknown {
  const outline = projectMindMapToNormalizedOutline(document);
  return {
    sheets: outline.sheets.map((sheet) => ({
      roots: sheet.roots.map(nodeShape),
      title: sheet.title,
    })),
    title: outline.title,
  };
}

describe('Markdown outline I/O', () => {
  it('round-trips ordered multi-sheet Unicode hierarchy and escaped Markdown text', () => {
    const source = [
      '# 创业 & Strategy 🚀',
      '',
      '## 产品图',
      '',
      '- 根节点 🌱',
      '  - A & B',
      '  - 路径 C:\\项目',
      '    - 星号 \\* 与方括号 \\[x\\]',
      '',
      '## 财务图',
      '',
      '- 现金流',
      '  1. 收入',
      '  2. 成本',
      '',
    ].join('\n');
    const imported = importMindMapFromMarkdown(source, {
      idFactory: deterministicIdFactory(),
    });

    expect(imported.report.success).toBe(true);
    expect(imported.report.importedSheets).toBe(2);
    expect(imported.report.importedTopics).toBe(7);
    expect(imported.document).not.toBeNull();
    expect(validateMindMapDocument(imported.document).valid).toBe(true);

    const markdown = exportMindMapToMarkdown(imported.document!);
    expect(markdown).toContain('# 创业 & Strategy 🚀');
    expect(markdown.indexOf('## 产品图')).toBeLessThan(markdown.indexOf('## 财务图'));
    expect(markdown).toContain('    - 星号 \\* 与方括号 \\[x\\]');

    const roundTrip = importMindMapFromMarkdown(markdown, {
      idFactory: deterministicIdFactory(1_000),
    });
    expect(roundTrip.report.success).toBe(true);
    expect(documentShape(roundTrip.document!)).toEqual(documentShape(imported.document!));
  });

  it('uses canonical order keys instead of record insertion or renderer state', () => {
    const imported = importMindMapFromMarkdown(
      '# Order\n\n## First\n\n- Root A\n  - Later\n  - Earlier\n\n## Second\n\n- Root B\n',
      { idFactory: deterministicIdFactory() },
    );
    const document = imported.document!;
    const sheets = Object.values(document.sheets);
    sheets[0].orderKey = 'z';
    sheets[1].orderKey = 'a';
    const firstEdges = Object.values(sheets[0].treeEdges);
    firstEdges[0].orderKey = 'z';
    firstEdges[1].orderKey = 'a';

    const markdown = exportMindMapToMarkdown(document);
    expect(markdown.indexOf('## Second')).toBeLessThan(markdown.indexOf('## First'));
    expect(markdown.indexOf('  - Earlier')).toBeLessThan(markdown.indexOf('  - Later'));
  });

  // @covers ACC-IO-022
  it('ACC-IO-022 exports hierarchy, Notes, and safe Links as readable Markdown without private payloads', () => {
    const document = createMindMapElementsFixture();
    const markdown = exportMindMapToMarkdown(document);

    expect(markdown).toContain('> **Note:** 这是一条结构化备注。');
    expect(markdown).toContain('> **Link:** [发布站点](https://example.com/launch)');
    expect(markdown).toContain('- 产品设计');
    expect(markdown).toContain('    - 交互验收');
    expect(markdown).not.toMatch(/```|data-mindmap|canonicalFallback|"sheets"\s*:/);
  });

  it('ACC-IO-015/022 omits local paths and emits broken internal Links as inert readable text', () => {
    const document = createMindMapElementsFixture();
    const sheet = Object.values(document.sheets)[0];
    const topicId = sheet.rootTopicId;
    const fileLinkId = '018f0000-0000-7000-8000-00000000f101' as LinkId;
    const brokenLinkId = '018f0000-0000-7000-8000-00000000f102' as LinkId;
    sheet.links[fileLinkId] = {
      href: String.raw`C:\Users\Alice\Private\strategy.pdf`,
      id: fileLinkId,
      kind: 'file',
      orderKey: 'x',
      status: 'active',
      topicId,
    };
    sheet.links[brokenLinkId] = {
      id: brokenLinkId,
      kind: 'topic',
      orderKey: 'y',
      status: 'broken',
      targetSheetId: sheet.id,
      targetTopicId: '018f0000-0000-7000-8000-00000000ffff' as typeof topicId,
      title: '已删除的主题',
      topicId,
    };

    const markdown = exportMindMapToMarkdown(document);
    expect(markdown).toContain('> **Link:** 本地文件（路径已省略）');
    expect(markdown).toContain('> **Topic link (broken):** 已删除的主题');
    expect(markdown).not.toContain('Alice');
    expect(markdown).not.toContain('strategy.pdf');
  });

  it('ACC-IO-005/022 safely round-trips exported Notes and active web Links without parser extensions', () => {
    const sourceDocument = createMindMapElementsFixture();
    const markdown = exportMindMapToMarkdown(sourceDocument);
    const imported = importMindMapFromMarkdown(markdown, {
      idFactory: deterministicIdFactory(5_000),
    });

    expect(imported.report.success).toBe(true);
    expect(imported.document).not.toBeNull();
    expect(validateMindMapDocument(imported.document).valid).toBe(true);

    const importedDocument = imported.document!;
    const sourceSheet = Object.values(sourceDocument.sheets)[0];
    const importedSheet = Object.values(importedDocument.sheets)
      .find((sheet) => sheet.title === sourceSheet.title)!;
    expect(importedSheet).toBeDefined();

    for (const sourceNote of Object.values(sourceSheet.notes)) {
      const sourceTopicTitle = mindMapRichTextToPlainText(
        sourceSheet.topics[sourceNote.topicId].title,
      );
      const importedTopic = Object.values(importedSheet.topics)
        .find((topic) => mindMapRichTextToPlainText(topic.title) === sourceTopicTitle)!;
      const importedNote = Object.values(importedSheet.notes)
        .find((note) => note.topicId === importedTopic.id)!;
      expect(mindMapRichTextToPlainText(importedNote.content))
        .toBe(mindMapRichTextToPlainText(sourceNote.content));
    }

    const sourceSafeLinks = Object.values(sourceSheet.links).filter(isSafeExternalLink);
    expect(Object.values(importedSheet.links)).toHaveLength(sourceSafeLinks.length);
    for (const sourceLink of sourceSafeLinks) {
      const sourceTopicTitle = mindMapRichTextToPlainText(
        sourceSheet.topics[sourceLink.topicId].title,
      );
      const importedTopic = Object.values(importedSheet.topics)
        .find((topic) => mindMapRichTextToPlainText(topic.title) === sourceTopicTitle)!;
      expect(Object.values(importedSheet.links)).toContainEqual(
        expect.objectContaining({
          href: sourceLink.href,
          kind: sourceLink.kind,
          status: 'active',
          title: sourceLink.title,
          topicId: importedTopic.id,
        }),
      );
    }

    for (const sheet of Object.values(importedDocument.sheets)) {
      for (const topic of Object.values(sheet.topics)) {
        expect(topic.extensions ?? {}).not.toHaveProperty('io.markdown.parsed-metadata');
      }
    }
  });

  it('ACC-IO-005 deterministically imports multi-paragraph Notes and safe Links across hierarchy and Sheets', () => {
    const source = [
      '# Enriched',
      '',
      '## One',
      '',
      '- Root',
      '  > **Note:** First paragraph',
      '  > ',
      '  > Third with \\*literal stars\\*',
      '  > **Link:** [Docs](https://example.com/docs)',
      '  > **Link:** [team@example.com](mailto:team@example.com)',
      '  - Child',
      '    > **Note:** Child note',
      '',
      '## Two',
      '',
      '- Second root',
      '  > **Note:** Other Sheet',
      '',
    ].join('\n');

    const first = importMindMapFromMarkdown(source, {
      idFactory: deterministicIdFactory(6_000),
    });
    const second = importMindMapFromMarkdown(source, {
      idFactory: deterministicIdFactory(6_000),
    });
    expect(first.report.success).toBe(true);
    expect(second.report.success).toBe(true);
    expect(second.document).toEqual(first.document);

    const sheets = Object.values(first.document!.sheets);
    expect(sheets.map((sheet) => sheet.title)).toEqual(['One', 'Two']);
    const firstSheet = sheets[0];
    const root = Object.values(firstSheet.topics)
      .find((topic) => mindMapRichTextToPlainText(topic.title) === 'Root')!;
    const child = Object.values(firstSheet.topics)
      .find((topic) => mindMapRichTextToPlainText(topic.title) === 'Child')!;
    expect(mindMapRichTextToPlainText(
      Object.values(firstSheet.notes).find((note) => note.topicId === root.id)!.content,
    )).toBe('First paragraph\n\nThird with *literal stars*');
    expect(mindMapRichTextToPlainText(
      Object.values(firstSheet.notes).find((note) => note.topicId === child.id)!.content,
    )).toBe('Child note');
    expect(Object.values(firstSheet.links)
      .filter(isSafeExternalLink)
      .filter((link) => link.topicId === root.id)
      .map((link) => ({ href: link.href, kind: link.kind, title: link.title })))
      .toEqual([
        { href: 'https://example.com/docs', kind: 'web', title: 'Docs' },
        { href: 'mailto:team@example.com', kind: 'email', title: 'team@example.com' },
      ]);
    const secondSheetNote = Object.values(sheets[1].notes)[0];
    expect(mindMapRichTextToPlainText(secondSheetNote.content)).toBe('Other Sheet');
  });

  it('ACC-IO-005 keeps ordinary, local-path, and dangerous Markdown Links inert', () => {
    const imported = importMindMapFromMarkdown([
      '# Safe',
      '',
      '## Sheet',
      '',
      '- [ordinary](https://ordinary.example)',
      '  > **Link:** [Safe](https://safe.example/docs)',
      '  > **Link:** [Script](javascript:alert%281%29)',
      '  > **Link:** [Local file](file:///Users/alice/private.txt)',
      '  > **Link:** [Windows path](C:\\Users\\alice\\private.txt)',
      '',
    ].join('\n'), { idFactory: deterministicIdFactory(7_000) });

    expect(imported.report.success).toBe(true);
    const sheet = Object.values(imported.document!.sheets)[0];
    expect(mindMapRichTextToPlainText(sheet.topics[sheet.rootTopicId].title))
      .toBe('[ordinary](https://ordinary.example)');
    expect(Object.values(sheet.links)).toEqual([
      expect.objectContaining({
        href: 'https://safe.example/docs',
        kind: 'web',
        status: 'active',
        title: 'Safe',
      }),
    ]);
    expect(imported.report.diagnostics.map((item) => item.code))
      .toContain('markdown.link-as-plain-text');
  });

  it.each([
    { code: 'outline.id-factory-invalid', failure: 'invalid' as const },
    { code: 'outline.id-factory-duplicate', failure: 'duplicate' as const },
  ])('ACC-IO-005 rejects $failure enrichment IDs from idFactory', ({ code, failure }) => {
    const validFactory = deterministicIdFactory(8_000);
    let calls = 0;
    let firstId = '';
    const imported = importMindMapFromMarkdown(
      '# IDs\n\n## Sheet\n\n- Root\n  > **Note:** Note',
      {
        idFactory: (kind) => {
          calls += 1;
          if (calls === 5) return failure === 'invalid' ? 'not-a-uuid' : firstId;
          const value = validFactory(kind);
          if (calls === 1) firstId = value;
          return value;
        },
      },
    );

    expect(imported.document).toBeNull();
    expect(imported.report.success).toBe(false);
    expect(imported.report.diagnostics.map((item) => item.code)).toContain(code);
  });

  it('keeps HTML and external-link syntax inert and reports the degradation', () => {
    const imported = importMindMapFromMarkdown(
      '# Safe\n\n## Sheet\n\n- <script>alert(1)</script>\n  - [site](https://example.com)\n<div>ignored</div>',
      { idFactory: deterministicIdFactory() },
    );
    expect(imported.report.success).toBe(true);
    expect(imported.report.diagnostics.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        'markdown.html-as-plain-text',
        'markdown.link-as-plain-text',
        'markdown.html-line-ignored',
      ]),
    );
    const sheet = Object.values(imported.document!.sheets)[0];
    const titles = Object.values(sheet.topics).map((topic) =>
      mindMapRichTextToPlainText(topic.title));
    expect(titles).toContain('<script>alert(1)</script>');
    expect(Object.keys(sheet.links)).toHaveLength(0);
  });

  it('rejects byte, node, and depth limit violations', () => {
    const byteLimited = importMindMapFromMarkdown('# D\n\n- 根', {
      idFactory: deterministicIdFactory(),
      limits: { maxInputBytes: 5 },
    });
    expect(byteLimited.document).toBeNull();
    expect(byteLimited.report.diagnostics[0].code).toBe('markdown.input-limit');

    const nodeLimited = importMindMapFromMarkdown('# D\n\n- A\n- B', {
      idFactory: deterministicIdFactory(),
      limits: { maxNodes: 1 },
    });
    expect(nodeLimited.document).toBeNull();
    expect(
      nodeLimited.report.diagnostics[nodeLimited.report.diagnostics.length - 1]?.code,
    ).toBe('markdown.node-limit');

    const depthLimited = importMindMapFromMarkdown('# D\n\n- A\n  - B\n    - C', {
      idFactory: deterministicIdFactory(),
      limits: { maxDepth: 1 },
    });
    expect(depthLimited.document).toBeNull();
    expect(
      depthLimited.report.diagnostics[depthLimited.report.diagnostics.length - 1]?.code,
    ).toBe('markdown.depth-limit');
  });
});

describe('OPML 2.0 I/O', () => {
  it('round-trips multiple sheets, hierarchy, Unicode, and XML special characters', () => {
    const markdown = [
      '# R&D <规划> & “路线”',
      '',
      '## Sheet & One',
      '',
      '- Root <A> & "quoted" \'apostrophe\'',
      '  - 子主题 😀',
      '',
      '## 第二张',
      '',
      '- 根二',
      '  - A > B',
    ].join('\n');
    const canonical = importMindMapFromMarkdown(markdown, {
      idFactory: deterministicIdFactory(),
    }).document!;

    const opml = exportMindMapToOpml(canonical);
    expect(opml).toContain('version="2.0"');
    expect(opml).toContain('R&amp;D &lt;规划&gt;');
    expect(opml).toContain('Sheet &amp; One');
    expect(opml).toContain('&quot;quoted&quot; &apos;apostrophe&apos;');

    const imported = importMindMapFromOpml(opml, {
      idFactory: deterministicIdFactory(2_000),
    });
    expect(imported.report.success).toBe(true);
    expect(imported.report.importedSheets).toBe(2);
    expect(validateMindMapDocument(imported.document).valid).toBe(true);
    expect(documentShape(imported.document!)).toEqual(documentShape(canonical));
  });

  it('preserves unknown attributes in namespaced extensions and drops external URLs visibly', () => {
    const source = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0" xmlns:nmdd="https://schemas.nmdd.app/opml/1" xmlns:foo="urn:foo" vendor="v1">
  <head owner="ignored"><title>Attrs</title></head>
  <body vendorBody="ignored">
    <outline text="Sheet" nmdd:kind="sheet" custom="sheet-value" htmlUrl="https://example.com/sheet">
      <outline text="Root &amp; &lt;safe&gt;" foo:priority="1" xmlUrl="https://example.com/feed"/>
    </outline>
  </body>
</opml>`;
    const imported = importMindMapFromOpml(source, {
      idFactory: deterministicIdFactory(),
    });

    expect(imported.report.success).toBe(true);
    expect(imported.report.preservedAttributes).toBe(4);
    expect(imported.report.ignoredItems).toBe(4);
    expect(
      imported.report.diagnostics.some(
        (item) => item.code === 'opml.container-attributes-ignored',
      ),
    ).toBe(true);
    const sheet = Object.values(imported.document!.sheets)[0];
    const root = sheet.topics[sheet.rootTopicId];
    expect(root.extensions?.[OPML_ATTRIBUTES_EXTENSION_KEY]).toEqual([
      { name: 'foo:priority', value: '1' },
    ]);
    expect(sheet.extensions?.[OPML_ATTRIBUTES_EXTENSION_KEY]).toEqual([
      { name: 'custom', value: 'sheet-value' },
    ]);
    expect(Object.keys(sheet.links)).toHaveLength(0);

    const exported = exportMindMapToOpml(imported.document!);
    expect(exported).toContain('xmlns:foo="urn:foo"');
    expect(exported).toContain('vendor="v1"');
    expect(exported).toContain('custom="sheet-value"');
    expect(exported).toContain('foo:priority="1"');
    expect(exported).not.toContain('example.com');
  });

  it('never executes or imports non-outline elements', () => {
    const source = `<opml version="2.0">
      <head><title>Safe</title></head>
      <body>
        <script src="https://example.com/x.js">alert(1)</script>
        <outline text="&lt;script&gt;plain text&lt;/script&gt;"/>
      </body>
    </opml>`;
    const imported = importMindMapFromOpml(source, {
      idFactory: deterministicIdFactory(),
    });
    expect(imported.report.success).toBe(true);
    expect(imported.report.diagnostics.some((item) => item.code === 'opml.body-element-ignored'))
      .toBe(true);
    const sheet = Object.values(imported.document!.sheets)[0];
    expect(mindMapRichTextToPlainText(sheet.topics[sheet.rootTopicId].title))
      .toBe('<script>plain text</script>');
    expect(Object.keys(sheet.links)).toHaveLength(0);
  });

  it.each([
    {
      code: 'xml.dtd-entity-forbidden',
      source: '<!DOCTYPE opml [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><opml version="2.0"><body><outline text="&xxe;"/></body></opml>',
    },
    {
      code: 'xml.unknown-entity',
      source: '<opml version="2.0"><body><outline text="&unknown;"/></body></opml>',
    },
    {
      code: 'opml.unsupported-version',
      source: '<opml version="1.0"><body><outline text="Root"/></body></opml>',
    },
  ])('rejects malicious or unsupported XML with $code', ({ code, source }) => {
    const imported = importMindMapFromOpml(source, {
      idFactory: deterministicIdFactory(),
    });
    expect(imported.document).toBeNull();
    expect(imported.report.success).toBe(false);
    expect(imported.report.diagnostics.some((item) => item.code === code)).toBe(true);
  });

  it('enforces UTF-8 input, outline node, and outline depth limits', () => {
    expect(utf8ByteLength('根😀')).toBe(7);
    const byteLimited = importMindMapFromOpml(
      '<opml version="2.0"><body><outline text="根"/></body></opml>',
      { idFactory: deterministicIdFactory(), limits: { maxInputBytes: 10 } },
    );
    expect(byteLimited.report.diagnostics[0].code).toBe('opml.input-limit');

    const nodeLimited = importMindMapFromOpml(
      '<opml version="2.0"><body><outline text="A"/><outline text="B"/></body></opml>',
      { idFactory: deterministicIdFactory(), limits: { maxNodes: 1 } },
    );
    expect(nodeLimited.document).toBeNull();
    expect(nodeLimited.report.diagnostics.some((item) => item.code === 'opml.node-limit'))
      .toBe(true);

    const depthLimited = importMindMapFromOpml(
      '<opml version="2.0"><body><outline text="A"><outline text="B"><outline text="C"/></outline></outline></body></opml>',
      { idFactory: deterministicIdFactory(), limits: { maxDepth: 1 } },
    );
    expect(depthLimited.document).toBeNull();
    expect(depthLimited.report.diagnostics.some((item) => item.code === 'opml.depth-limit'))
      .toBe(true);
  });
});
