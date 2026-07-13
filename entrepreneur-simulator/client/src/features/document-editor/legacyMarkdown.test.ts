// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { preserveLegacyMarkdownBlankLines } from '../../components/SmartDocumentEditor';

describe('legacy Markdown blank-line recovery', () => {
  it('does not turn normal paragraph separation into an extra empty block', () => {
    expect(preserveLegacyMarkdownBlankLines('第一段\n\n第二段'))
      .toBe('第一段\n\n第二段');
  });

  it('preserves only intentional extra visual blank lines', () => {
    expect(preserveLegacyMarkdownBlankLines('第一段\n\n\n第二段'))
      .toBe('第一段\n\n<p data-preserved-blank-line></p>\n第二段');
  });

  it('never changes blank lines inside code fences', () => {
    const value = '```txt\na\n\nb\n```';
    expect(preserveLegacyMarkdownBlankLines(value)).toBe(value);
  });
});
