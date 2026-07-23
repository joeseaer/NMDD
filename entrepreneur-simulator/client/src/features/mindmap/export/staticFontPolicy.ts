import { isMindMapSvgEmojiGrapheme } from './richTextSvgLayout';

export const MIND_MAP_STATIC_SANS_FAMILY = 'NMDD Noto Sans SC Export';
export const MIND_MAP_STATIC_EMOJI_FAMILY = 'NMDD Noto Emoji Export';
export const MIND_MAP_STATIC_MONO_FAMILY = 'NMDD Noto Sans Mono Export';
export const MIND_MAP_STATIC_SANS_STACK = `"${MIND_MAP_STATIC_SANS_FAMILY}"`;
export const MIND_MAP_STATIC_EMOJI_STACK =
  `"${MIND_MAP_STATIC_EMOJI_FAMILY}","${MIND_MAP_STATIC_SANS_FAMILY}"`;
export const MIND_MAP_STATIC_MONO_STACK =
  `"${MIND_MAP_STATIC_MONO_FAMILY}","${MIND_MAP_STATIC_SANS_FAMILY}"`;
export const MIND_MAP_STATIC_TEXT_STACK =
  `"${MIND_MAP_STATIC_SANS_FAMILY}","${MIND_MAP_STATIC_EMOJI_FAMILY}"`;
export const MIND_MAP_STATIC_FONT_POLICY = 'pinned-fontsource-noto-common-v2' as const;

export class MindMapStaticFontError extends Error {
  readonly codePoints?: readonly number[];

  constructor(message: string, codePoints?: readonly number[]) {
    super(message);
    this.name = 'MindMapStaticFontError';
    this.codePoints = codePoints;
  }
}

export const resolveMindMapStaticFontFamily = (
  grapheme: string,
  _requestedFontFamily?: string,
  fontRole: 'code' | 'text' = 'text',
): string => {
  if (isMindMapSvgEmojiGrapheme(grapheme)) return MIND_MAP_STATIC_EMOJI_STACK;
  return fontRole === 'code' ? MIND_MAP_STATIC_MONO_STACK : MIND_MAP_STATIC_SANS_STACK;
};
