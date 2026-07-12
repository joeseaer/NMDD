import { describe, expect, it } from 'vitest';
import { classifyClipboardSource } from '../classifyClipboardSource';
import {
  CHATGPT_MATH_HTML_FIXTURE,
  GOOGLE_DOCS_HTML_FIXTURE,
  GOOGLE_SHEETS_HTML_FIXTURE,
  NOTION_HTML_FIXTURE,
  OFFICE_HTML_FIXTURE,
  VSCODE_HTML_FIXTURE,
} from '../__fixtures__/clipboardSources';

describe('classifyClipboardSource', () => {
  it.each([
    [OFFICE_HTML_FIXTURE, 'office'],
    [GOOGLE_DOCS_HTML_FIXTURE, 'google-docs'],
    [GOOGLE_SHEETS_HTML_FIXTURE, 'google-sheets'],
    [NOTION_HTML_FIXTURE, 'notion'],
    [CHATGPT_MATH_HTML_FIXTURE, 'chatgpt'],
    [VSCODE_HTML_FIXTURE, 'vscode'],
  ] as const)('identifies a source fixture', (html, source) => {
    expect(classifyClipboardSource({ html }).source).toBe(source);
  });

  it('only claims Codex from a weak text/markdown signal at low confidence', () => {
    expect(classifyClipboardSource({ types: ['text/markdown'] })).toMatchObject({
      source: 'codex',
      confidence: 'low',
    });
  });

  it('does not pretend plain Markdown proves its source', () => {
    expect(classifyClipboardSource({ text: '# A title' }).source).toBe('generic');
  });
});
