import { describe, expect, it } from 'vitest';
import { createClipboardCopyPayload } from '../../clipboard/copySerializer';
import type { DocumentNodeJson } from '../../schema/documentSchema';
import { serializeToMarkdown } from '../toMarkdown';
import { serializeToPlainText } from '../toPlainText';

const DOCUMENT: DocumentNodeJson = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1, blockId: 'heading-1' }, content: [{ type: 'text', text: 'Title' }] },
    {
      type: 'paragraph',
      attrs: { blockId: 'p-1', blockComments: [{ id: 'comment' }] },
      content: [
        { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
        { type: 'text', text: ' and ' },
        { type: 'inlineEquation', attrs: { formula: 'x^2' } },
      ],
    },
    {
      type: 'table',
      content: [
        { type: 'tableRow', content: [{ type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }] }, { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'B' }] }] }] },
        { type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '1' }] }] }, { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '2' }] }] }] },
      ],
    },
    { type: 'equationBlock', attrs: { formula: '\\frac{a}{b}', blockId: 'eq-1' } },
    { type: 'calloutBlock', attrs: { icon: '💡' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Remember this' }] }] },
    { type: 'pageLinkBlock', attrs: { pageId: 'page-1', title: 'Linked page', category: 'note' } },
  ],
};

describe('copy serializers', () => {
  it('emits stable Markdown for marks, equations, tables, and custom nodes', () => {
    const markdown = serializeToMarkdown(DOCUMENT);
    expect(markdown).toContain('# Title');
    expect(markdown).toContain('**bold** and \\(x^2\\)');
    expect(markdown).toContain('| A | B |');
    expect(markdown).toContain('\\[\n\\frac{a}{b}\n\\]');
    expect(markdown).toContain('> 💡 Remember this');
    expect(markdown).toContain('[Linked page](/notes?view=notes&doc=page-1)');
  });

  it('emits readable plain text without Markdown syntax', () => {
    const plain = serializeToPlainText(DOCUMENT);
    expect(plain).toContain('Title');
    expect(plain).toContain('bold and x^2');
    expect(plain).toContain('A\tB\n1\t2');
    expect(plain).not.toContain('**bold**');
  });

  it('cleans runtime attrs before producing a clipboard payload', () => {
    const payload = createClipboardCopyPayload(DOCUMENT);
    expect(payload.fragment.content?.[0].attrs).not.toHaveProperty('blockId');
    expect(payload.fragment.content?.[1].attrs).not.toHaveProperty('blockComments');
    expect(payload.markdown).toBe(serializeToMarkdown(DOCUMENT));
  });

  it('regenerates sync groups while preserving links inside the copied selection', () => {
    const fragment: DocumentNodeJson = {
      type: 'doc',
      content: [
        { type: 'syncedBlock', attrs: { blockId: 'b1', syncId: 'shared' }, content: [{ type: 'paragraph' }] },
        { type: 'syncedBlock', attrs: { blockId: 'b2', syncId: 'shared' }, content: [{ type: 'paragraph' }] },
      ],
    };
    const payload = createClipboardCopyPayload(fragment, {
      createId: (kind, previousId) => `${kind}:copy:${previousId}`,
    });
    expect(payload.fragment.content?.[0].attrs?.syncId).toBe('sync:copy:shared');
    expect(payload.fragment.content?.[1].attrs?.syncId).toBe('sync:copy:shared');
    expect(payload.fragment.content?.[0].attrs).not.toHaveProperty('blockId');
  });

  it('decodes legacy URL-encoded formulas when copying out', () => {
    const encoded: DocumentNodeJson = {
      type: 'doc',
      content: [{ type: 'equationBlock', attrs: { formula: '%255Cfrac%257Ba%257D%257Bb%257D' } }],
    };
    expect(serializeToMarkdown(encoded)).toBe('\\[\n\\frac{a}{b}\n\\]');
    expect(serializeToPlainText(encoded)).toBe('\\frac{a}{b}');
  });
});
