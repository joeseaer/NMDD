import { describe, expect, it } from 'vitest';

import type { RichText } from '../domain/types';
import {
  layoutMindMapRichTextForSvg,
  safeMindMapSvgLinkHref,
} from './richTextSvgLayout';

describe('formal SVG rich-text layout', () => {
  it('preserves canonical marks, safe links, list markers, and grapheme clusters', () => {
    const richText: RichText = {
      type: 'doc',
      version: 1,
      blocks: [
        {
          type: 'paragraph',
          align: 'center',
          children: [
            {
              type: 'text',
              text: 'Bold 👩🏽‍💻 ',
              marks: [
                { type: 'bold' },
                { type: 'italic' },
                { type: 'underline' },
                { type: 'strike' },
                { type: 'color', value: '#ff0000' },
                { type: 'fontSize', value: 18 },
                { type: 'link', href: 'https://example.com/docs', title: 'Docs' },
              ],
            },
            {
              type: 'text',
              text: 'code',
              marks: [{ type: 'code' }, { type: 'textTransform', value: 'uppercase' }],
            },
          ],
        },
        {
          type: 'bulletList',
          items: [{
            type: 'listItem',
            children: [{ type: 'paragraph', children: [{ type: 'text', text: '项目' }] }],
          }],
        },
      ],
    };

    const layout = layoutMindMapRichTextForSvg(richText, {
      baseFontSize: 14,
      maximumWidth: 1_000,
    });
    const allRuns = layout.lines.flatMap((line) => line.runs);
    const marked = allRuns.find((run) => run.text.includes('Bold'))!;
    expect(marked).toMatchObject({
      href: 'https://example.com/docs',
      linkTitle: 'Docs',
      unsafeLink: false,
      style: {
        color: '#ff0000',
        fontSize: 18,
        fontStyle: 'italic',
        fontWeight: 700,
        textDecoration: 'underline line-through',
      },
    });
    expect(allRuns.some((run) => run.text.includes('👩🏽‍💻'))).toBe(true);
    expect(allRuns.some((run) => run.text.includes('CODE'))).toBe(true);
    expect(layout.lines.some((line) => line.runs.some((run) => run.text.startsWith('• '))))
      .toBe(true);
    expect(layout.lines[0].align).toBe('center');
  });

  it('never splits a ZWJ Emoji even when it exceeds the requested line width', () => {
    const richText: RichText = {
      type: 'doc',
      version: 1,
      blocks: [{
        type: 'paragraph',
        children: [{ type: 'text', text: 'A👩🏽‍💻B' }],
      }],
    };
    const layout = layoutMindMapRichTextForSvg(richText, {
      baseFontSize: 14,
      maximumWidth: 8,
    });
    expect(layout.lines.flatMap((line) => line.runs).map((run) => run.text))
      .toContain('👩🏽‍💻');
    expect(layout.lines.flatMap((line) => line.runs).some((run) => run.text === '👩')).toBe(false);
  });

  it('uses injected pinned-font metrics, cumulative kerning, and family routing', () => {
    const richText: RichText = {
      type: 'doc',
      version: 1,
      blocks: [{
        type: 'paragraph',
        children: [{
          type: 'text',
          text: 'AVX😀',
          marks: [{ type: 'fontFamily', value: 'Host-only Custom Font' }],
        }],
      }],
    };
    const measureText = (value: string): number => {
      const unkerned = Array.from(value).reduce((total, character) => (
        total + (character === '😀' ? 12 : character === 'X' ? 9 : 8)
      ), 0);
      return unkerned - (value.includes('AV') ? 2 : 0);
    };
    const layout = layoutMindMapRichTextForSvg(richText, {
      baseFontSize: 14,
      baseFontWeight: 500,
      maximumWidth: 15,
      measureText,
      resolveFontFamily: (grapheme) => grapheme === '😀' ? 'Pinned Emoji' : 'Pinned Sans',
    });

    expect(layout.lines.map((line) => line.runs.map((run) => run.text).join('')))
      .toEqual(['AV', 'X', '😀']);
    expect(layout.lines[0].width).toBe(14);
    expect(layout.lines.flatMap((line) => line.runs).map((run) => run.style.fontFamily))
      .toEqual(['Pinned Sans', 'Pinned Sans', 'Pinned Emoji']);
    expect(layout.lines.flatMap((line) => line.runs).every((run) => (
      run.style.fontFamily !== 'Host-only Custom Font' && run.style.fontWeight === 500
    ))).toBe(true);
  });

  it('gives code semantics deterministic priority over custom font mark order', () => {
    const richText: RichText = {
      type: 'doc',
      version: 1,
      blocks: [{
        type: 'paragraph',
        children: [
          {
            type: 'text',
            text: 'A',
            marks: [
              { type: 'code' },
              { type: 'fontFamily', value: 'Host Font' },
            ],
          },
          {
            type: 'text',
            text: 'B',
            marks: [
              { type: 'fontFamily', value: 'Host Font' },
              { type: 'code' },
            ],
          },
        ],
      }],
    };
    const layout = layoutMindMapRichTextForSvg(richText, {
      baseFontSize: 14,
      maximumWidth: 200,
      measureText: (value) => value.length * 7,
      resolveFontFamily: (_grapheme, _requested, role) => (
        role === 'code' ? 'Pinned Mono' : 'Pinned Sans'
      ),
    });
    const runs = layout.lines.flatMap((line) => line.runs);

    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      text: 'AB',
      style: { fontFamily: 'Pinned Mono', fontRole: 'code' },
    });
  });

  it('keeps unsafe or credential-bearing links inert', () => {
    expect(safeMindMapSvgLinkHref('javascript:alert(1)')).toBeUndefined();
    expect(safeMindMapSvgLinkHref('https://user:secret@example.com/private')).toBeUndefined();
    expect(safeMindMapSvgLinkHref('mailto:team@example.com')).toBe('mailto:team@example.com');
  });

  it('rejects duplicate mark kinds instead of applying an implicit winner', () => {
    const richText: RichText = {
      type: 'doc',
      version: 1,
      blocks: [{
        type: 'paragraph',
        children: [{
          type: 'text',
          text: 'ambiguous',
          marks: [
            { type: 'color', value: '#ff0000' },
            { type: 'color', value: '#00ff00' },
          ],
        }],
      }],
    };
    expect(() => layoutMindMapRichTextForSvg(richText, {
      baseFontSize: 14,
      maximumWidth: 200,
    })).toThrow(/Duplicate rich-text mark: color/u);
  });
});
