// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { detectPlainText } from '../detectPlainText';
import { parsePlainText } from '../parsePlainText';
import { CODEX_MARKDOWN_FIXTURE } from '../__fixtures__/clipboardSources';

describe('parsePlainText', () => {
  it('renders Codex/GFM Markdown with semantic structures and formulas', () => {
    const parsed = parsePlainText(CODEX_MARKDOWN_FIXTURE, { source: 'codex' });
    expect(parsed.kind).toBe('markdown');
    expect(parsed.html).toContain('<h1>Paste upgrade</h1>');
    expect(parsed.html).toContain('<strong>bold text</strong>');
    expect(parsed.html).toContain('data-type="inline-equation"');
    expect(parsed.html).toContain('<table>');
    expect(parsed.html).toContain('<pre><code class="language-ts">');
  });

  it('keeps raw external HTML visible instead of executing it', () => {
    const parsed = parsePlainText('# Safe\n\n<script>alert(1)</script>');
    expect(parsed.kind).toBe('markdown');
    expect(parsed.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(parsed.html).not.toContain('<script>');
  });

  it('uses a strict literal path for Ctrl+Shift+V', () => {
    const parsed = parsePlainText('# Heading\n\n**bold**\n\n\\(x^2\\)', { plain: true });
    expect(parsed.kind).toBe('text');
    expect(parsed.html).toContain('# Heading');
    expect(parsed.html).toContain('**bold**');
    expect(parsed.html).not.toContain('<h1>');
    expect(parsed.html).not.toContain('data-type="inline-equation"');
  });

  it('never creates nested rich structures inside an existing code block', () => {
    const parsed = parsePlainText('# Heading\n**bold**\n\\(x^2\\)', { codeContext: true });
    expect(parsed.kind).toBe('text');
    expect(parsed.html).not.toMatch(/<h1|<strong|data-type="inline-equation"|<pre/);
    expect(parsed.text).toContain('**bold**');
  });

  it('converts consistent TSV to a semantic table', () => {
    const parsed = parsePlainText('Name\tStatus\nAlpha\tDone');
    expect(parsed.kind).toBe('tsv');
    expect(parsed.html).toContain('<th>Name</th>');
    expect(parsed.html).toContain('<td>Done</td>');
  });

  it('keeps a populated one-row spreadsheet selection as a table', () => {
    expect(parsePlainText('Alpha\tDone').kind).toBe('tsv');
    expect(parsePlainText('\tindented').kind).not.toBe('tsv');
  });

  it('renders GFM task items as Tiptap task-list semantics', () => {
    const parsed = parsePlainText('- [x] shipped\n- [ ] pending');
    expect(parsed.html).toContain('data-type="taskList"');
    expect(parsed.html).toContain('data-type="taskItem" data-checked="true"');
  });

  it('linkifies only a single safe URL', () => {
    const parsed = parsePlainText('https://example.com/docs');
    expect(parsed.kind).toBe('url');
    expect(parsed.html).toContain('rel="noopener noreferrer"');
  });

  it('recognizes plain source code without treating a Python comment as a heading', () => {
    const text = '# comment\nprint("hello")';
    expect(detectPlainText(text).kind).toBe('code');
    expect(parsePlainText(text).html).toContain('<pre><code class="language-python">');
  });

  it.each(['foo_bar', 'a=b', '$5.00'])('does not misclassify %s as math', value => {
    expect(detectPlainText(value).kind).not.toBe('math');
    expect(parsePlainText(value).html).not.toContain('data-type="equation"');
  });

  it('does not treat a standalone Python comment as a Markdown heading', () => {
    expect(detectPlainText('# comment').kind).not.toBe('markdown');
  });

  it('recovers a high-confidence un-delimited formula line without flattening prose', () => {
    const parsed = parsePlainText('The relation is\n\nx^2 + y^2 = z^2\n\nThat is all.');
    expect(parsed.kind).toBe('math');
    expect(parsed.html).toContain('<p>The relation is</p>');
    expect(parsed.html).toContain('data-type="equation" data-equation="x^2 + y^2 = z^2"');
    expect(parsed.html).toContain('<p>That is all.</p>');
  });
});
