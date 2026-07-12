// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { normalizeClipboardHtml } from '../normalizeClipboardHtml';
import {
  CHATGPT_MATH_HTML_FIXTURE,
  GOOGLE_DOCS_HTML_FIXTURE,
  GOOGLE_SHEETS_HTML_FIXTURE,
  MALICIOUS_HTML_FIXTURE,
  NOTION_HTML_FIXTURE,
  OFFICE_HTML_FIXTURE,
  VSCODE_HTML_FIXTURE,
} from '../__fixtures__/clipboardSources';

describe('normalizeClipboardHtml', () => {
  it('rebuilds Office headings and list semantics', () => {
    const result = normalizeClipboardHtml(OFFICE_HTML_FIXTURE);
    expect(result.source.source).toBe('office');
    expect(result.html).toContain('<h1>Office heading</h1>');
    expect(result.html).toContain('<ul>');
    expect(result.html).toContain('<strong>First</strong> item');
  });

  it('keeps Google Docs formatting without importing style garbage', () => {
    const result = normalizeClipboardHtml(GOOGLE_DOCS_HTML_FIXTURE);
    expect(result.html).toContain('<strong>Google title</strong>');
    expect(result.html).toContain('normal text');
    expect(result.html).toContain('<em>italic text</em>');
    expect(result.html).not.toContain('style=');
    expect(result.html).not.toContain('docs-internal-guid');
  });

  it('unwraps Google Sheets origin while preserving its table', () => {
    const result = normalizeClipboardHtml(GOOGLE_SHEETS_HTML_FIXTURE);
    expect(result.source.source).toBe('google-sheets');
    expect(result.html).toContain('<table>');
    expect(result.html).not.toContain('google-sheets-html-origin');
  });

  it('normalizes Notion tasks and strips runtime identity', () => {
    const result = normalizeClipboardHtml(NOTION_HTML_FIXTURE);
    expect(result.html).toContain('data-type="taskItem"');
    expect(result.html).toContain('data-checked="true"');
    expect(result.html).not.toContain('data-block-id');
    expect(result.html).not.toContain('data-comments');
  });

  it('turns ChatGPT KaTeX into editor equation nodes without duplicate MathML', () => {
    const result = normalizeClipboardHtml(CHATGPT_MATH_HTML_FIXTURE);
    expect(result.mathNodeCount).toBe(2);
    expect(result.html).toContain('data-type="inline-equation"');
    expect(result.html).toContain('data-type="equation"');
    expect(result.html).not.toContain('<math');
  });

  it('preserves VS Code whitespace as a code block', () => {
    const result = normalizeClipboardHtml(VSCODE_HTML_FIXTURE);
    expect(result.source.source).toBe('vscode');
    expect(result.html).toContain('<pre><code>const value = 1;\nconsole.log(value);</code></pre>');
  });

  it('removes script, handlers, unsafe URLs, forged internal attrs, and data images', () => {
    const result = normalizeClipboardHtml(MALICIOUS_HTML_FIXTURE);
    expect(result.html).toContain('Safe text');
    expect(result.html).toContain('bad link');
    expect(result.html).toContain('embedded image');
    expect(result.html).not.toMatch(/script|javascript:|onclick|onerror/i);
    expect(result.html).not.toMatch(/data-block-id|data-comments|data-database|data-type="database"/i);
    expect(result.droppedImageCount).toBe(1);
  });

  it('preserves trusted internal structures but still removes runtime identity', () => {
    const html = '<div data-nmdd-clipboard-version="2" data-type="database" data-database="%7B%22id%22%3A%22db-1%22%7D" data-block-id="block-1" data-sync-id="sync-1"><p>Database</p></div>';
    const result = normalizeClipboardHtml(html);
    expect(result.source.source).toBe('internal');
    expect(result.html).toContain('data-type="database"');
    expect(result.html).toContain('data-database=');
    expect(result.html).not.toMatch(/data-block-id|data-sync-id/);
  });
});
