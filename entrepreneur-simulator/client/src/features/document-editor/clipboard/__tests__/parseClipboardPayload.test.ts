// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { classifyClipboardSource } from '../classifyClipboardSource';
import { parseClipboardPayload } from '../parseClipboardPayload';
import type { ClipboardPayload } from '../types';

const payload = (overrides: Partial<ClipboardPayload> = {}): ClipboardPayload => {
  const base = {
    text: 'Codex MIME title\nBold answer',
    html: '',
    markdown: '',
    uriList: [],
    files: [],
    types: ['text/plain'],
  };
  const input = { ...base, ...overrides };
  return {
    ...input,
    source: overrides.source || classifyClipboardSource(input),
  };
};

describe('parseClipboardPayload rich MIME selection', () => {
  it('renders explicit text/markdown when HTML is absent', () => {
    const result = parseClipboardPayload(payload({
      markdown: '## Codex MIME title\n\n**Bold answer**',
      types: ['text/plain', 'text/markdown'],
    }));

    expect(result.kind).toBe('markdown');
    expect(result.html).toContain('<h2>Codex MIME title</h2>');
    expect(result.html).toContain('<strong>Bold answer</strong>');
  });

  it('prefers richer Markdown over wrapper-only external HTML', () => {
    const result = parseClipboardPayload(payload({
      html: '<div><span>Codex MIME title</span><div>Bold answer</div></div>',
      markdown: '## Codex MIME title\n\n**Bold answer**\n\n- One\n- Two',
      types: ['text/plain', 'text/html', 'text/markdown'],
    }));

    expect(result.kind).toBe('markdown');
    expect(result.html).toContain('<h2>Codex MIME title</h2>');
    expect(result.html).toContain('<ul>');
    expect(result.diagnostics).toContain(
      'explicit text/markdown preferred over impoverished HTML',
    );
  });

  it('keeps complete semantic external HTML when it is richer', () => {
    const result = parseClipboardPayload(payload({
      html: '<h2>HTML title</h2><ul><li><strong>HTML wins</strong></li></ul>',
      markdown: 'Plain Markdown fallback',
      types: ['text/plain', 'text/html', 'text/markdown'],
    }));

    expect(result.kind).toBe('html');
    expect(result.html).toContain('HTML wins');
  });

  it('always prefers trusted internal rich HTML', () => {
    const internalHtml = '<div data-nmdd-document-fragment="2"><h2>Internal HTML</h2></div>';
    const result = parseClipboardPayload(payload({
      html: internalHtml,
      markdown: '# Richer Markdown\n\n- One\n- Two\n\n| A | B |\n| --- | --- |\n| 1 | 2 |',
      types: ['text/plain', 'text/html', 'text/markdown'],
    }));

    expect(result.kind).toBe('html');
    expect(result.html).toContain('Internal HTML');
    expect(result.diagnostics).toContain('trusted internal HTML preferred');
  });

  it('uses only text/plain for strict and code-context paste', () => {
    const richPayload = payload({
      text: '## literal text',
      html: '<h2>HTML heading</h2>',
      markdown: '# Markdown heading',
      types: ['text/plain', 'text/html', 'text/markdown'],
    });

    const strict = parseClipboardPayload(richPayload, { plain: true });
    const codeContext = parseClipboardPayload(richPayload, { codeContext: true });
    expect(strict.kind).toBe('text');
    expect(strict.html).toContain('## literal text');
    expect(strict.html).not.toContain('<h2>');
    expect(codeContext.kind).toBe('text');
    expect(codeContext.html).toContain('## literal text');
    expect(codeContext.html).not.toContain('<h1>');
  });
});
