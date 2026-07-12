// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { captureClipboardPayload, parseUriList } from '../captureClipboardPayload';

describe('captureClipboardPayload', () => {
  it('normalizes text, URI comments, MIME types, and file order', () => {
    const first = new File(['a'], 'a.png', { type: 'image/png' });
    const second = new File(['b'], 'b.pdf', { type: 'application/pdf' });
    const values: Record<string, string> = {
      'text/plain': 'line 1\r\nline 2',
      'text/html': '<p>line 1</p>',
      'text/markdown': '## line 1\r\n\r\n**line 2**',
      'text/uri-list': '# source\r\nhttps://example.com/a\r\nhttps://example.com/b',
    };
    const data = {
      types: Object.keys(values),
      getData: (type: string) => values[type] || '',
      items: [
        { kind: 'file', getAsFile: () => first },
        { kind: 'string', getAsFile: () => null },
        { kind: 'file', getAsFile: () => second },
      ],
      files: [],
    } as unknown as DataTransfer;

    const payload = captureClipboardPayload(data);
    expect(payload.text).toBe('line 1\nline 2');
    expect(payload.markdown).toBe('## line 1\n\n**line 2**');
    expect(payload.uriList).toEqual(['https://example.com/a', 'https://example.com/b']);
    expect(payload.files.map(file => file.name)).toEqual(['a.png', 'b.pdf']);
  });

  it('parses URI-list comments independently', () => {
    expect(parseUriList('# comment\nmailto:test@example.com')).toEqual(['mailto:test@example.com']);
  });
});
