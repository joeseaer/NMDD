import type {
  Paragraph,
  RichList,
  RichMark,
  RichText,
} from '../domain/types';

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;
const SAFE_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);

export interface SvgRichTextRunStyle {
  readonly color?: string;
  readonly fontFamily?: string;
  readonly fontRole?: 'code' | 'text';
  readonly fontSize: number;
  readonly fontStyle?: 'italic' | 'normal';
  readonly fontWeight?: number;
  readonly textDecoration?: string;
}

export interface SvgRichTextRun {
  readonly href?: string;
  readonly linkTitle?: string;
  readonly style: SvgRichTextRunStyle;
  readonly text: string;
  readonly unsafeLink: boolean;
}

export interface SvgRichTextLine {
  readonly align: 'left' | 'center' | 'right';
  readonly height: number;
  readonly runs: readonly SvgRichTextRun[];
  readonly width: number;
}

export interface SvgRichTextLayout {
  readonly height: number;
  readonly lines: readonly SvgRichTextLine[];
  readonly width: number;
}

export interface SvgRichTextLayoutOptions {
  readonly baseFontSize: number;
  readonly baseFontStyle?: 'italic' | 'normal';
  readonly baseFontWeight?: number;
  readonly maximumWidth: number;
  readonly maximumLines?: number;
  readonly maximumRuns?: number;
  /** Export-only resolver used to replace host fonts with pinned font families. */
  readonly resolveFontFamily?: SvgFontFamilyResolver;
  /** A prepared pinned-font measurer. When omitted, the legacy safe estimate is used. */
  readonly measureText?: SvgTextMeasurer;
}

export interface SvgTextMeasurementStyle {
  readonly fontFamily?: string;
  readonly fontSize: number;
  readonly fontStyle?: 'italic' | 'normal';
  readonly fontWeight?: number;
}

export type SvgTextMeasurer = (
  value: string,
  style: Readonly<SvgTextMeasurementStyle>,
) => number;

export type SvgFontFamilyResolver = (
  grapheme: string,
  requestedFontFamily: string | undefined,
  fontRole: 'code' | 'text',
) => string;

interface SourceRun {
  readonly marks?: readonly RichMark[];
  readonly text: string;
}

interface SourceLine {
  readonly align: SvgRichTextLine['align'];
  readonly runs: readonly SourceRun[];
}

const isGraphemeExtender = (value: string): boolean => {
  const codePoint = value.codePointAt(0) ?? 0;
  return /\p{Mark}/u.test(value)
    || (codePoint >= 0xfe00 && codePoint <= 0xfe0f)
    || (codePoint >= 0xe0100 && codePoint <= 0xe01ef)
    || (codePoint >= 0x1f3fb && codePoint <= 0x1f3ff)
    || codePoint === 0x20e3;
};

const isRegionalIndicator = (value: string): boolean => {
  const codePoint = value.codePointAt(0) ?? 0;
  return codePoint >= 0x1f1e6 && codePoint <= 0x1f1ff;
};

/** Streaming, runtime-independent grouping for marks, Emoji modifiers, flags, and ZWJ sequences. */
export function* iterateMindMapSvgGraphemes(value: string): IterableIterator<string> {
  let current = '';
  let regionalIndicatorCount = 0;
  for (const codePoint of value) {
    if (
      current !== ''
      && (
        isGraphemeExtender(codePoint)
        || codePoint === '\u200d'
        || current.endsWith('\u200d')
        || (isRegionalIndicator(codePoint)
          && regionalIndicatorCount % 2 === 1)
      )
    ) {
      current += codePoint;
      if (isRegionalIndicator(codePoint)) regionalIndicatorCount += 1;
    } else {
      if (current !== '') yield current;
      current = codePoint;
      regionalIndicatorCount = isRegionalIndicator(codePoint) ? 1 : 0;
    }
  }
  if (current !== '') yield current;
}

/** Array convenience wrapper for layout call sites that need random access. */
export const splitMindMapSvgGraphemes = (value: string): readonly string[] => (
  Object.freeze([...iterateMindMapSvgGraphemes(value)])
);

const EMOJI_PRESENTATION = /\p{Emoji_Presentation}/u;
const EXTENDED_PICTOGRAPHIC = /\p{Extended_Pictographic}/u;

/** Deterministic routing hint for the pinned monochrome Emoji export face. */
export const isMindMapSvgEmojiGrapheme = (value: string): boolean => (
  value.includes('\ufe0f')
  || value.includes('\u200d')
  || value.includes('\u20e3')
  || Array.from(value).some((character) => (
    isRegionalIndicator(character)
    || EMOJI_PRESENTATION.test(character)
    || EXTENDED_PICTOGRAPHIC.test(character)
  ))
);

const clamp = (value: number, minimum: number, maximum: number): number => (
  Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum))
);

/** Only standalone, credential-free links survive into a portable SVG. */
export const safeMindMapSvgLinkHref = (value: string): string | undefined => {
  const candidate = value.trim();
  if (!candidate || candidate.length > 4_096 || CONTROL_CHARACTERS.test(candidate)) return undefined;
  try {
    const parsed = new URL(candidate);
    if (!SAFE_LINK_PROTOCOLS.has(parsed.protocol.toLowerCase())) return undefined;
    if ((parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && (parsed.username !== '' || parsed.password !== '')) return undefined;
    return parsed.href;
  } catch {
    return undefined;
  }
};

const paragraphSourceLines = (
  paragraph: Readonly<Paragraph>,
  prefix = '',
): SourceLine[] => {
  const lines: Array<{ align: SvgRichTextLine['align']; runs: SourceRun[] }> = [{
    align: paragraph.align ?? 'left',
    runs: prefix ? [{ text: prefix }] : [],
  }];
  for (const inline of paragraph.children) {
    if (inline.type === 'hardBreak') {
      lines.push({ align: paragraph.align ?? 'left', runs: [] });
      continue;
    }
    const normalized = inline.text.replace(/\r\n?/gu, '\n');
    const chunks = normalized.split('\n');
    chunks.forEach((chunk, index) => {
      if (index > 0) lines.push({ align: paragraph.align ?? 'left', runs: [] });
      if (chunk !== '') lines[lines.length - 1].runs.push({ text: chunk, marks: inline.marks });
    });
  }
  return lines;
};

const listSourceLines = (list: Readonly<RichList>, depth: number): SourceLine[] => {
  const lines: SourceLine[] = [];
  const requestedStart = list.start ?? 1;
  const start = list.type === 'orderedList' && Number.isFinite(requestedStart)
    ? Math.trunc(requestedStart)
    : 1;
  list.items.forEach((item, itemIndex) => {
    let firstParagraph = true;
    for (const child of item.children) {
      if (child.type === 'paragraph') {
        const marker = firstParagraph
          ? `${'  '.repeat(Math.min(depth, 16))}${list.type === 'orderedList'
            ? `${start + itemIndex}. `
            : '• '}`
          : `${'  '.repeat(Math.min(depth + 1, 16))}`;
        lines.push(...paragraphSourceLines(child, marker));
        firstParagraph = false;
      } else {
        lines.push(...listSourceLines(child, Math.min(depth + 1, 64)));
      }
    }
    if (item.children.length === 0) {
      lines.push({ align: 'left', runs: [{ text: '• ' }] });
    }
  });
  return lines;
};

const sourceLines = (richText: Readonly<RichText>): readonly SourceLine[] => {
  const result: SourceLine[] = [];
  for (const block of richText.blocks) {
    if (block.type === 'paragraph') result.push(...paragraphSourceLines(block));
    else if (block.type === 'table') {
      block.rows.forEach((row) => result.push({
        align: 'left',
        runs: [{ text: row.cells.map((cell) => cell.text).join(' | ') }],
      }));
    } else result.push(...listSourceLines(block, 0));
  }
  return result.length > 0 ? result : [{ align: 'left', runs: [] }];
};

const textTransform = (
  value: string,
  marks: readonly RichMark[] | undefined,
): string => {
  const transform = marks?.find((mark) => mark.type === 'textTransform');
  if (!transform || transform.type !== 'textTransform' || transform.value === 'none') return value;
  if (transform.value === 'uppercase') {
    return value.replace(/[a-z]/gu, (letter) => letter.toUpperCase());
  }
  if (transform.value === 'lowercase') {
    return value.replace(/[A-Z]/gu, (letter) => letter.toLowerCase());
  }
  return value.replace(/(^|\s)([a-z])/gu, (_match, spacing: string, letter: string) => (
    `${spacing}${letter.toUpperCase()}`
  ));
};

const runStyle = (
  marks: readonly RichMark[] | undefined,
  baseFontSize: number,
  baseFontStyle: 'italic' | 'normal' | undefined,
  baseFontWeight: number | undefined,
): SvgRichTextRunStyle => {
  let color: string | undefined;
  let fontFamily: string | undefined;
  let fontSize = baseFontSize;
  let fontStyle = baseFontStyle;
  let fontWeight = baseFontWeight === undefined
    ? undefined
    : clamp(baseFontWeight, 100, 900);
  const decoration = new Set<string>();
  const fontRole = marks?.some((mark) => mark.type === 'code') ? 'code' : 'text';
  for (const mark of marks ?? []) {
    if (mark.type === 'bold') fontWeight = 700;
    else if (mark.type === 'italic') fontStyle = 'italic';
    else if (mark.type === 'underline') decoration.add('underline');
    else if (mark.type === 'strike') decoration.add('line-through');
    else if (mark.type === 'code') continue;
    else if (mark.type === 'color') color = mark.value;
    else if (mark.type === 'fontFamily') fontFamily = mark.value;
    else if (mark.type === 'fontSize') fontSize = clamp(mark.value, 6, 256);
  }
  if (fontRole === 'code') fontFamily = 'ui-monospace, SFMono-Regular, Menlo, monospace';
  return {
    fontRole,
    fontSize,
    ...(color ? { color } : {}),
    ...(fontFamily ? { fontFamily } : {}),
    ...(fontStyle ? { fontStyle } : {}),
    ...(fontWeight ? { fontWeight } : {}),
    ...(decoration.size > 0 ? { textDecoration: [...decoration].join(' ') } : {}),
  };
};

const assertUniqueMarks = (marks: readonly RichMark[] | undefined): void => {
  const seen = new Set<RichMark['type']>();
  for (const mark of marks ?? []) {
    if (seen.has(mark.type)) throw new Error(`Duplicate rich-text mark: ${mark.type}.`);
    seen.add(mark.type);
  }
};

const styleKey = (run: SvgRichTextRun): string => JSON.stringify([
  run.href,
  run.linkTitle,
  run.unsafeLink,
  run.style,
]);

const characterWidth = (character: string, fontSize: number): number => {
  if (/\s/u.test(character)) return fontSize * 0.5;
  return fontSize * (/[^\u0000-\u00ff]/u.test(character) ? 1 : 0.56);
};

const measuredTextWidth = (
  value: string,
  style: Readonly<SvgRichTextRunStyle>,
  measureText: SvgTextMeasurer | undefined,
): number => {
  if (!measureText) return characterWidth(value, style.fontSize);
  const measured = measureText(value, style);
  if (!Number.isFinite(measured) || measured < 0) {
    throw new Error('Pinned-font text measurement returned an invalid width.');
  }
  return measured;
};

/**
 * Produces a deterministic SVG-text layout while preserving every supported
 * canonical mark, paragraph alignment, list marker, hard break, and safe link.
 */
export const layoutMindMapRichTextForSvg = (
  richText: Readonly<RichText>,
  options: Readonly<SvgRichTextLayoutOptions>,
): SvgRichTextLayout => {
  const baseFontSize = clamp(options.baseFontSize, 6, 256);
  const maximumWidth = Math.max(1, Number.isFinite(options.maximumWidth)
    ? options.maximumWidth
    : 1);
  const maximumLines = Math.max(1, Math.floor(options.maximumLines ?? 100_000));
  const maximumRuns = Math.max(1, Math.floor(options.maximumRuns ?? 200_000));
  const result: SvgRichTextLine[] = [];
  let runCount = 0;

  const pushLine = (
    align: SvgRichTextLine['align'],
    mutableRuns: SvgRichTextRun[],
    width: number,
  ): void => {
    if (result.length >= maximumLines) throw new Error('Rich-text SVG line limit exceeded.');
    const maximumFontSize = Math.max(baseFontSize, ...mutableRuns.map((run) => run.style.fontSize));
    result.push(Object.freeze({
      align,
      height: maximumFontSize * 1.25,
      runs: Object.freeze(mutableRuns.map((run) => Object.freeze(run))),
      width,
    }));
  };

  for (const sourceLine of sourceLines(richText)) {
    let mutableRuns: SvgRichTextRun[] = [];
    let width = 0;
    const appendCharacter = (character: string, run: SvgRichTextRun): void => {
      const previous = mutableRuns[mutableRuns.length - 1];
      const joinsPrevious = previous !== undefined && styleKey(previous) === styleKey(run);
      let nextWidth = joinsPrevious
        ? measuredTextWidth(previous.text + character, run.style, options.measureText)
          - measuredTextWidth(previous.text, run.style, options.measureText)
        : measuredTextWidth(character, run.style, options.measureText);
      nextWidth = Math.max(0, nextWidth);
      if (mutableRuns.length > 0 && width + nextWidth > maximumWidth) {
        pushLine(sourceLine.align, mutableRuns, width);
        mutableRuns = [];
        width = 0;
        nextWidth = measuredTextWidth(character, run.style, options.measureText);
      }
      const linePrevious = mutableRuns[mutableRuns.length - 1];
      if (linePrevious && styleKey(linePrevious) === styleKey(run)) {
        mutableRuns[mutableRuns.length - 1] = {
          ...linePrevious,
          text: linePrevious.text + character,
        };
      } else {
        runCount += 1;
        if (runCount > maximumRuns) throw new Error('Rich-text SVG run limit exceeded.');
        mutableRuns.push({ ...run, text: character });
      }
      width += nextWidth;
    };

    for (const sourceRun of sourceLine.runs) {
      const marks = sourceRun.marks;
      assertUniqueMarks(marks);
      const link = marks?.find((mark) => mark.type === 'link');
      const href = link?.type === 'link' ? safeMindMapSvgLinkHref(link.href) : undefined;
      const style = runStyle(
        marks,
        baseFontSize,
        options.baseFontStyle,
        options.baseFontWeight,
      );
      const linkedStyle = href
        ? {
            ...style,
            color: style.color ?? '#2563eb',
            textDecoration: style.textDecoration?.split(/\s+/u).includes('underline')
              ? style.textDecoration
              : style.textDecoration
                ? `${style.textDecoration} underline`
                : 'underline',
          }
        : style;
      const baseRun: SvgRichTextRun = {
        style: linkedStyle,
        text: '',
        unsafeLink: link?.type === 'link' && href === undefined,
        ...(href ? { href } : {}),
        ...(link?.type === 'link' && link.title ? { linkTitle: link.title } : {}),
      };
      for (const character of splitMindMapSvgGraphemes(textTransform(sourceRun.text, marks))) {
        const resolvedFontFamily = options.resolveFontFamily?.(
          character,
          linkedStyle.fontFamily,
          linkedStyle.fontRole ?? 'text',
        );
        appendCharacter(character, {
          ...baseRun,
          style: resolvedFontFamily
            ? { ...linkedStyle, fontFamily: resolvedFontFamily }
            : linkedStyle,
        });
      }
    }
    pushLine(sourceLine.align, mutableRuns, width);
  }

  return Object.freeze({
    height: result.reduce((total, line) => total + line.height, 0),
    lines: Object.freeze(result),
    width: Math.max(0, ...result.map((line) => line.width)),
  });
};
