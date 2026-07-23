import { describe, expect, it } from 'vitest';

import {
  MindMapStaticFontError,
  parseMindMapStaticFontCmapRanges,
  resolveMindMapStaticFontFamily,
  selectMindMapStaticFontFaceAssets,
  MIND_MAP_STATIC_EMOJI_STACK,
  MIND_MAP_STATIC_MONO_STACK,
  MIND_MAP_STATIC_SANS_STACK,
} from './staticFontBundle';
import {
  MIND_MAP_STATIC_FONT_FACE_ASSETS,
  MIND_MAP_STATIC_FONT_SOURCE_VERSION,
} from './staticFontManifest.generated';

describe('pinned static export fonts', () => {
  it('locks the exact Fontsource inputs and generated cmap inventory', () => {
    const sans = MIND_MAP_STATIC_FONT_FACE_ASSETS.filter((face) => face.kind === 'sans');
    const emoji = MIND_MAP_STATIC_FONT_FACE_ASSETS.filter((face) => face.kind === 'emoji');
    const mono = MIND_MAP_STATIC_FONT_FACE_ASSETS.filter((face) => face.kind === 'mono');

    expect(MIND_MAP_STATIC_FONT_SOURCE_VERSION).toBe('5.3.0');
    expect(sans).toHaveLength(101);
    expect(emoji).toHaveLength(10);
    expect(mono).toHaveLength(7);
    expect(mono.every((face) => (
      face.fileName.endsWith('-standard-normal.woff2')
      && face.stretchMin === 62.5
      && face.stretchMax === 100
    ))).toBe(true);
    expect(new Set(MIND_MAP_STATIC_FONT_FACE_ASSETS.map((face) => face.fileName)).size)
      .toBe(118);
    expect(MIND_MAP_STATIC_FONT_FACE_ASSETS.every((face) => (
      /^[a-f0-9]{64}$/u.test(face.sha256)
      && face.cmapRanges.length > 0
      && face.declaredRanges.length > 0
      && /\.woff2$/u.test(face.fileName)
    ))).toBe(true);
  });

  it('selects only intersecting Sans SC shards instead of embedding all 101 faces', () => {
    const ascii = selectMindMapStaticFontFaceAssets([{ role: 'text', text: 'Alpha 123' }]);
    const chinese = selectMindMapStaticFontFaceAssets([{ role: 'text', text: '中文思维导图' }]);

    expect(ascii.some((face) => face.fileName === 'noto-sans-sc-119-wght-normal.woff2'))
      .toBe(true);
    expect(ascii.some((face) => face.fileName === 'noto-sans-sc-latin-wght-normal.woff2'))
      .toBe(true);
    expect(ascii.every((face) => face.kind === 'sans')).toBe(true);
    expect(ascii.length).toBeLessThan(12);
    expect(chinese.some((face) => face.kind === 'sans')).toBe(true);
    expect(chinese.length).toBeLessThan(20);
  });

  it('routes Emoji graphemes to pinned monochrome Emoji shards', () => {
    const selected = selectMindMapStaticFontFaceAssets([{
      role: 'text',
      text: 'Launch 😀 👩‍💻',
    }]);

    expect(selected.some((face) => face.fileName === 'noto-emoji-9-wght-normal.woff2'))
      .toBe(true);
    expect(selected.some((face) => face.kind === 'emoji')).toBe(true);
    expect(resolveMindMapStaticFontFamily('A')).toBe(MIND_MAP_STATIC_SANS_STACK);
    expect(resolveMindMapStaticFontFamily('😀')).toBe(MIND_MAP_STATIC_EMOJI_STACK);
  });

  it('loads Mono only for code-marked supported graphemes and keeps CJK on Sans SC', () => {
    const plain = selectMindMapStaticFontFaceAssets([{ role: 'text', text: 'const value = 1' }]);
    const code = selectMindMapStaticFontFaceAssets([{ role: 'code', text: 'A中' }]);

    expect(plain.some((face) => face.kind === 'mono')).toBe(false);
    expect(code.some((face) => (
      face.kind === 'mono' && face.fileName === 'noto-sans-mono-latin-standard-normal.woff2'
    ))).toBe(true);
    expect(code.some((face) => face.kind === 'sans')).toBe(true);
    expect(resolveMindMapStaticFontFamily('A', undefined, 'code'))
      .toBe(MIND_MAP_STATIC_MONO_STACK);
    expect(resolveMindMapStaticFontFamily('中', undefined, 'text'))
      .toBe(MIND_MAP_STATIC_SANS_STACK);
  });

  it('fails closed when the pinned CJK/Latin/Emoji scope cannot cover a glyph', () => {
    expect(() => selectMindMapStaticFontFaceAssets([{
      role: 'text',
      text: '\u{20000}',
    }])).toThrowError(
      expect.objectContaining({
        name: 'MindMapStaticFontError',
        codePoints: expect.arrayContaining([0x20000]),
      } satisfies Partial<MindMapStaticFontError>),
    );
  });

  it('bounds unsupported-glyph diagnostics and honors cancellation during large scans', () => {
    const unsupported = Array.from(
      { length: 40 },
      (_value, index) => String.fromCodePoint(0x20000 + index),
    ).join('');
    try {
      selectMindMapStaticFontFaceAssets([{ role: 'text', text: unsupported }]);
      throw new Error('Expected unsupported glyph selection to fail.');
    } catch (error) {
      expect(error).toMatchObject({
        name: 'MindMapStaticFontError',
        codePoints: expect.any(Array),
      });
      expect((error as MindMapStaticFontError).codePoints).toHaveLength(16);
      expect((error as Error).message).toContain('and 24 more');
    }

    const controller = new AbortController();
    controller.abort();
    expect(() => selectMindMapStaticFontFaceAssets(
      [{ role: 'text', text: 'A'.repeat(500_000) }],
      controller.signal,
    )).toThrowError(expect.objectContaining({ name: 'AbortError' }));
  });

  it('rejects malformed generated cmap ranges', () => {
    expect(parseMindMapStaticFontCmapRanges('20-7e,4e00')).toEqual([[0x20, 0x7e], [0x4e00, 0x4e00]]);
    expect(() => parseMindMapStaticFontCmapRanges('U+20')).toThrow(MindMapStaticFontError);
    expect(() => parseMindMapStaticFontCmapRanges('110000')).toThrow(MindMapStaticFontError);
    expect(() => parseMindMapStaticFontCmapRanges('7e-20')).toThrow(MindMapStaticFontError);
  });
});
