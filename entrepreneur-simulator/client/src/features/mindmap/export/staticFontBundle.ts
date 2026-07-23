import type { SvgFontFamilyResolver, SvgTextMeasurer } from './richTextSvgLayout';
import {
  isMindMapSvgEmojiGrapheme,
  iterateMindMapSvgGraphemes,
} from './richTextSvgLayout';
import {
  MIND_MAP_STATIC_EMOJI_FAMILY,
  MIND_MAP_STATIC_EMOJI_STACK,
  MIND_MAP_STATIC_FONT_POLICY,
  MIND_MAP_STATIC_MONO_FAMILY,
  MIND_MAP_STATIC_MONO_STACK,
  MIND_MAP_STATIC_SANS_FAMILY,
  MIND_MAP_STATIC_SANS_STACK,
  MIND_MAP_STATIC_TEXT_STACK,
  MindMapStaticFontError,
} from './staticFontPolicy';
import {
  MIND_MAP_STATIC_FONT_FACE_ASSETS,
  MIND_MAP_STATIC_FONT_SOURCE_VERSION,
} from './staticFontManifest.generated';

export {
  MIND_MAP_STATIC_EMOJI_FAMILY,
  MIND_MAP_STATIC_EMOJI_STACK,
  MIND_MAP_STATIC_FONT_POLICY,
  MIND_MAP_STATIC_MONO_FAMILY,
  MIND_MAP_STATIC_MONO_STACK,
  MIND_MAP_STATIC_SANS_FAMILY,
  MIND_MAP_STATIC_SANS_STACK,
  MIND_MAP_STATIC_TEXT_STACK,
  MindMapStaticFontError,
  resolveMindMapStaticFontFamily,
} from './staticFontPolicy';

const STATIC_EXPORT_SENTINEL_TEXT =
  'Mind map Untitled topic Untitled sheet Equation Empty equation';
const MAX_FACE_BYTES = 1024 * 1024;
const MAX_TOTAL_FONT_BYTES = 8 * 1024 * 1024;
const FONT_FETCH_CONCURRENCY = 6;

type StaticFontFaceAsset = (typeof MIND_MAP_STATIC_FONT_FACE_ASSETS)[number];
type StaticFontKind = StaticFontFaceAsset['kind'];
type CodePointRange = readonly [start: number, end: number];

interface ParsedStaticFontFaceAsset {
  readonly asset: StaticFontFaceAsset;
  readonly ranges: readonly CodePointRange[];
  readonly selectionRanges: readonly CodePointRange[];
}

interface LoadedStaticFontFace extends ParsedStaticFontFaceAsset {
  readonly bytes: Uint8Array;
}

export interface MindMapStaticFontBundle {
  readonly cssText: string;
  readonly embeddedFontBytes: number;
  readonly embeddedSerializedBytes: number;
  readonly faceCount: number;
  readonly fontFamily: typeof MIND_MAP_STATIC_SANS_STACK;
  readonly fontPolicy: typeof MIND_MAP_STATIC_FONT_POLICY;
  readonly measureText: SvgTextMeasurer;
  readonly release: () => void;
  readonly resolveFontFamily: SvgFontFamilyResolver;
  readonly sourceVersion: typeof MIND_MAP_STATIC_FONT_SOURCE_VERSION;
}

export interface MindMapStaticFontUsage {
  readonly role: 'code' | 'text';
  readonly text: string;
}

export type MindMapStaticFontBytesFetcher = (
  url: string,
  signal: AbortSignal,
) => Promise<Uint8Array>;

export interface LoadMindMapStaticFontBundleInput {
  readonly fetchFontBytes?: MindMapStaticFontBytesFetcher;
  /** Test seam; production creates a measurer from the pinned browser FontFace objects. */
  readonly measureText?: SvgTextMeasurer;
  readonly ownerDocument?: Document;
  readonly signal: AbortSignal;
  readonly usages: readonly Readonly<MindMapStaticFontUsage>[];
}

export type MindMapStaticFontBundleLoader = (
  input: Readonly<LoadMindMapStaticFontBundleInput>,
) => Promise<MindMapStaticFontBundle>;

const throwIfAborted = (signal: AbortSignal): void => {
  if (signal.aborted) throw new DOMException('Static font loading was aborted.', 'AbortError');
};

export const parseMindMapStaticFontCmapRanges = (value: string): readonly CodePointRange[] => {
  if (!value || value.length > 250_000) throw new MindMapStaticFontError('Pinned font cmap is invalid.');
  const ranges: CodePointRange[] = [];
  let previousEnd = -1;
  for (const token of value.split(',')) {
    const match = /^([0-9a-f]{1,6})(?:-([0-9a-f]{1,6}))?$/u.exec(token);
    if (!match) throw new MindMapStaticFontError('Pinned font cmap is invalid.');
    const start = Number.parseInt(match[1], 16);
    const end = Number.parseInt(match[2] ?? match[1], 16);
    if (start > end || end > 0x10ffff || start <= previousEnd) {
      throw new MindMapStaticFontError('Pinned font cmap is invalid.');
    }
    ranges.push(Object.freeze([start, end] as const));
    previousEnd = end;
  }
  return Object.freeze(ranges);
};

const PARSED_FACE_ASSETS: readonly ParsedStaticFontFaceAsset[] = Object.freeze(
  MIND_MAP_STATIC_FONT_FACE_ASSETS.map((asset) => Object.freeze({
    asset,
    ranges: parseMindMapStaticFontCmapRanges(asset.cmapRanges),
    selectionRanges: parseMindMapStaticFontCmapRanges(asset.declaredRanges),
  })),
);

type FaceIndex = Readonly<Record<StaticFontKind, ReadonlyMap<number, readonly ParsedStaticFontFaceAsset[]>>>;

const buildFaceIndex = (rangeKind: 'ranges' | 'selectionRanges'): FaceIndex => {
  const mutable = {
    emoji: new Map<number, ParsedStaticFontFaceAsset[]>(),
    mono: new Map<number, ParsedStaticFontFaceAsset[]>(),
    sans: new Map<number, ParsedStaticFontFaceAsset[]>(),
  };
  for (const face of PARSED_FACE_ASSETS) {
    const index = mutable[face.asset.kind];
    for (const [start, end] of face[rangeKind]) {
      for (let codePoint = start; codePoint <= end; codePoint += 1) {
        const candidates = index.get(codePoint);
        if (candidates) candidates.push(face);
        else index.set(codePoint, [face]);
      }
    }
  }
  return Object.freeze({
    emoji: new Map([...mutable.emoji].map(([codePoint, faces]) => (
      [codePoint, Object.freeze(faces)] as const
    ))),
    mono: new Map([...mutable.mono].map(([codePoint, faces]) => (
      [codePoint, Object.freeze(faces)] as const
    ))),
    sans: new Map([...mutable.sans].map(([codePoint, faces]) => (
      [codePoint, Object.freeze(faces)] as const
    ))),
  });
};

const ACTUAL_FACE_INDEX = buildFaceIndex('ranges');
const DECLARED_FACE_INDEX = buildFaceIndex('selectionRanges');

const isIgnoredControl = (codePoint: number): boolean => (
  (codePoint >= 0 && codePoint <= 0x1f) || codePoint === 0x7f
);

const requiredCodePoints = (
  usages: readonly Readonly<MindMapStaticFontUsage>[],
  signal?: AbortSignal,
): {
  readonly emoji: ReadonlySet<number>;
  readonly mono: ReadonlySet<number>;
  readonly sans: ReadonlySet<number>;
} => {
  const emoji = new Set<number>();
  const mono = new Set<number>();
  const sans = new Set<number>();
  let inspectedGraphemes = 0;
  const effectiveUsages = [
    ...usages,
    Object.freeze({ role: 'text' as const, text: STATIC_EXPORT_SENTINEL_TEXT }),
  ];
  for (const usage of effectiveUsages) {
    for (const grapheme of iterateMindMapSvgGraphemes(usage.text)) {
      inspectedGraphemes += 1;
      if ((inspectedGraphemes & 0xfff) === 0 && signal?.aborted) throwIfAborted(signal);
      const codePoints = Array.from(grapheme, (character) => character.codePointAt(0) ?? 0)
        .filter((codePoint) => !isIgnoredControl(codePoint));
      if (isMindMapSvgEmojiGrapheme(grapheme)) {
        for (const codePoint of codePoints) emoji.add(codePoint);
        continue;
      }
      for (const codePoint of codePoints) sans.add(codePoint);
      const monoEligible = usage.role === 'code' && codePoints.every((codePoint) => (
        (ACTUAL_FACE_INDEX.mono.get(codePoint)?.length ?? 0) > 0
      ));
      if (monoEligible) {
        for (const codePoint of codePoints) mono.add(codePoint);
      }
    }
  }
  if (signal?.aborted) throwIfAborted(signal);
  return { emoji, mono, sans };
};

export const selectMindMapStaticFontFaceAssets = (
  usages: readonly Readonly<MindMapStaticFontUsage>[],
  signal?: AbortSignal,
): readonly StaticFontFaceAsset[] => {
  const required = requiredCodePoints(usages, signal);
  const selectedSet = new Set<ParsedStaticFontFaceAsset>();
  const addDeclaredFaces = (codePoints: ReadonlySet<number>, kind: StaticFontKind): void => {
    for (const codePoint of codePoints) {
      for (const face of DECLARED_FACE_INDEX[kind].get(codePoint) ?? []) selectedSet.add(face);
    }
  };
  addDeclaredFaces(required.sans, 'sans');
  addDeclaredFaces(required.emoji, 'emoji');
  addDeclaredFaces(required.mono, 'mono');
  const missingSamples = new Set<number>();
  let missingCount = 0;
  const ensureActualCoverage = (
    codePoints: ReadonlySet<number>,
    kind: StaticFontKind,
    failWhenMissing: boolean,
  ): void => {
    for (const codePoint of codePoints) {
      const actualFaces = ACTUAL_FACE_INDEX[kind].get(codePoint) ?? [];
      if (actualFaces.some((face) => selectedSet.has(face))) continue;
      if (actualFaces.length === 0 && failWhenMissing) {
        missingCount += 1;
        if (missingSamples.size < 16) missingSamples.add(codePoint);
      } else {
        for (const face of actualFaces) selectedSet.add(face);
      }
    }
  };
  ensureActualCoverage(required.sans, 'sans', true);
  ensureActualCoverage(required.emoji, 'emoji', true);
  ensureActualCoverage(required.mono, 'mono', false);
  if (missingCount > 0) {
    const sorted = Object.freeze([...missingSamples].sort((left, right) => left - right));
    const labels = sorted.map((value) => `U+${value.toString(16).toUpperCase()}`);
    throw new MindMapStaticFontError(
      `Pinned static fonts do not cover ${labels.join(', ')}${missingCount > sorted.length ? ` and ${missingCount - sorted.length} more` : ''}.`,
      sorted,
    );
  }
  const selected = PARSED_FACE_ASSETS.filter((face) => selectedSet.has(face));
  return Object.freeze(selected.map((face) => face.asset));
};

const preparedStaticFontFamilyResolver: SvgFontFamilyResolver = (
  grapheme,
  _requestedFontFamily,
  fontRole,
) => {
  if (isMindMapSvgEmojiGrapheme(grapheme)) return MIND_MAP_STATIC_EMOJI_STACK;
  const codePoints = Array.from(grapheme, (character) => character.codePointAt(0) ?? 0)
    .filter((codePoint) => !isIgnoredControl(codePoint));
  if (fontRole === 'code' && codePoints.length > 0 && codePoints.every((codePoint) => (
    (ACTUAL_FACE_INDEX.mono.get(codePoint)?.length ?? 0) > 0
  ))) return MIND_MAP_STATIC_MONO_STACK;
  return MIND_MAP_STATIC_SANS_STACK;
};

const encodeBase64 = (bytes: Uint8Array): string => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    const block = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);
    result += alphabet[(block >>> 18) & 63];
    result += alphabet[(block >>> 12) & 63];
    result += second === undefined ? '=' : alphabet[(block >>> 6) & 63];
    result += third === undefined ? '=' : alphabet[block & 63];
  }
  return result;
};

const decodeBase64 = (value: string): Uint8Array => {
  if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(value) || value.length % 4 !== 0) {
    throw new MindMapStaticFontError('Bundled font data URL is invalid.');
  }
  const decoded = globalThis.atob(value);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
};

const bytesFromDataUrl = (value: string): Uint8Array | undefined => {
  const match = /^data:font\/woff2;base64,([A-Za-z0-9+/]+=*)$/u.exec(value);
  return match ? decodeBase64(match[1]) : undefined;
};

const defaultFetchFontBytes: MindMapStaticFontBytesFetcher = async (source, signal) => {
  const embedded = bytesFromDataUrl(source);
  if (embedded) return embedded;
  let resolved: URL;
  try {
    resolved = new URL(source, globalThis.location?.href ?? import.meta.url);
  } catch {
    throw new MindMapStaticFontError('Bundled font URL is invalid.');
  }
  if (!['http:', 'https:', 'file:'].includes(resolved.protocol)) {
    throw new MindMapStaticFontError('Bundled font URL uses an unsafe protocol.');
  }
  if (globalThis.location?.origin && resolved.origin !== globalThis.location.origin) {
    throw new MindMapStaticFontError('Bundled font URL is not same-origin.');
  }
  const response = await fetch(resolved, {
    credentials: 'same-origin',
    redirect: 'error',
    signal,
  });
  if (!response.ok) throw new MindMapStaticFontError('A bundled static font could not be loaded.');
  return new Uint8Array(await response.arrayBuffer());
};

const sha256Hex = async (bytes: Uint8Array): Promise<string> => {
  if (!globalThis.crypto?.subtle) {
    throw new MindMapStaticFontError('The browser cannot verify bundled font integrity.');
  }
  const copy = Uint8Array.from(bytes);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', copy.buffer);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
};

const loadFaces = async (
  assets: readonly StaticFontFaceAsset[],
  fetchBytes: MindMapStaticFontBytesFetcher,
  signal: AbortSignal,
): Promise<readonly LoadedStaticFontFace[]> => {
  const linkedController = new AbortController();
  const abortFromCaller = (): void => linkedController.abort(signal.reason);
  if (signal.aborted) abortFromCaller();
  else signal.addEventListener('abort', abortFromCaller, { once: true });
  const workSignal = linkedController.signal;
  const result = new Array<LoadedStaticFontFace>(assets.length);
  let cursor = 0;
  let totalBytes = 0;
  const workers = Array.from(
    { length: Math.min(FONT_FETCH_CONCURRENCY, Math.max(1, assets.length)) },
    async () => {
      while (true) {
        const index = cursor;
        cursor += 1;
        if (index >= assets.length) return;
        throwIfAborted(workSignal);
        const asset = assets[index];
        const bytes = await fetchBytes(asset.url, workSignal);
        throwIfAborted(workSignal);
        if (bytes.length === 0 || bytes.length > MAX_FACE_BYTES) {
          throw new MindMapStaticFontError('A bundled static font has an invalid byte length.');
        }
        totalBytes += bytes.length;
        if (totalBytes > MAX_TOTAL_FONT_BYTES) {
          throw new MindMapStaticFontError('Bundled static fonts exceed the export byte budget.');
        }
        if (await sha256Hex(bytes) !== asset.sha256) {
          throw new MindMapStaticFontError('A bundled static font failed integrity verification.');
        }
        result[index] = Object.freeze({
          asset,
          bytes,
          ranges: parseMindMapStaticFontCmapRanges(asset.cmapRanges),
          selectionRanges: parseMindMapStaticFontCmapRanges(asset.declaredRanges),
        });
      }
    },
  );
  try {
    await Promise.all(workers);
    return Object.freeze(result);
  } catch (error) {
    linkedController.abort(error);
    await Promise.allSettled(workers);
    throw error;
  } finally {
    signal.removeEventListener('abort', abortFromCaller);
  }
};

const cssUnicodeRange = (ranges: string): string => ranges
  .split(',')
  .map((value) => `U+${value.toUpperCase()}`)
  .join(',');

const fontFamilyForKind = (kind: StaticFontKind): string => {
  if (kind === 'emoji') return MIND_MAP_STATIC_EMOJI_FAMILY;
  if (kind === 'mono') return MIND_MAP_STATIC_MONO_FAMILY;
  return MIND_MAP_STATIC_SANS_FAMILY;
};

const faceCss = (face: LoadedStaticFontFace): string => {
  const { asset, bytes } = face;
  return [
    '@font-face{',
    `font-family:"${fontFamilyForKind(asset.kind)}";`,
    'font-style:normal;',
    `font-stretch:${asset.stretchMin}% ${asset.stretchMax}%;`,
    `font-weight:${asset.weightMin} ${asset.weightMax};`,
    'font-display:block;',
    `src:url(data:font/woff2;base64,${encodeBase64(bytes)}) format("woff2-variations");`,
    `unicode-range:${cssUnicodeRange(asset.cmapRanges)};`,
    '}',
  ].join('');
};

const createBrowserTextMeasurer = async (
  faces: readonly LoadedStaticFontFace[],
  ownerDocument: Document,
  signal: AbortSignal,
): Promise<{ readonly measureText: SvgTextMeasurer; readonly release: () => void }> => {
  const ownerWindow = ownerDocument.defaultView;
  const FontFaceConstructor = ownerWindow?.FontFace ?? globalThis.FontFace;
  const fontSet = ownerDocument.fonts;
  if (!FontFaceConstructor || !fontSet) {
    throw new MindMapStaticFontError('The browser cannot prepare pinned font measurements.');
  }
  const registered: FontFace[] = [];
  try {
    for (const face of faces) {
      throwIfAborted(signal);
      const buffer = face.bytes.buffer.slice(
        face.bytes.byteOffset,
        face.bytes.byteOffset + face.bytes.byteLength,
      ) as ArrayBuffer;
      const fontFace = new FontFaceConstructor(fontFamilyForKind(face.asset.kind), buffer, {
        style: 'normal',
        stretch: `${face.asset.stretchMin}% ${face.asset.stretchMax}%`,
        unicodeRange: cssUnicodeRange(face.asset.cmapRanges),
        weight: `${face.asset.weightMin} ${face.asset.weightMax}`,
      });
      await fontFace.load();
      throwIfAborted(signal);
      fontSet.add(fontFace);
      registered.push(fontFace);
    }
    const canvas = ownerDocument.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new MindMapStaticFontError('The browser cannot measure pinned fonts.');
    const stretchContext = context as CanvasRenderingContext2D & { fontStretch?: string };
    if (faces.some((face) => face.asset.kind === 'mono') && !('fontStretch' in stretchContext)) {
      throw new MindMapStaticFontError('The browser cannot measure pinned monospace font width.');
    }
    const measureText: SvgTextMeasurer = (value, style) => {
      const fontSize = Math.min(256, Math.max(6, style.fontSize));
      const fontWeight = Math.min(900, Math.max(100, Math.round(style.fontWeight ?? 400)));
      const family = style.fontFamily === MIND_MAP_STATIC_EMOJI_STACK
        ? MIND_MAP_STATIC_EMOJI_STACK
        : style.fontFamily === MIND_MAP_STATIC_MONO_STACK
          ? MIND_MAP_STATIC_MONO_STACK
        : style.fontFamily === MIND_MAP_STATIC_TEXT_STACK
          ? MIND_MAP_STATIC_TEXT_STACK
          : MIND_MAP_STATIC_SANS_STACK;
      // All pinned packages contain normal outlines. Italic is an explicit SVG
      // shear and therefore does not change the measured advance.
      context.font = `normal ${fontWeight} ${fontSize}px ${family}`;
      if ('fontStretch' in stretchContext) {
        stretchContext.fontStretch = family === MIND_MAP_STATIC_MONO_STACK
          ? 'extra-condensed'
          : 'normal';
        if (family === MIND_MAP_STATIC_MONO_STACK
          && stretchContext.fontStretch !== 'extra-condensed') {
          throw new MindMapStaticFontError('The browser rejected the pinned monospace width axis.');
        }
      }
      return context.measureText(value).width;
    };
    let released = false;
    return Object.freeze({
      measureText,
      release: () => {
        if (released) return;
        released = true;
        for (const fontFace of registered) fontSet.delete(fontFace);
        canvas.width = 0;
        canvas.height = 0;
      },
    });
  } catch (error) {
    for (const fontFace of registered) fontSet.delete(fontFace);
    throw error;
  }
};

export const loadMindMapStaticFontBundle: MindMapStaticFontBundleLoader = async (input) => {
  throwIfAborted(input.signal);
  const assets = selectMindMapStaticFontFaceAssets(input.usages, input.signal);
  const faces = await loadFaces(
    assets,
    input.fetchFontBytes ?? defaultFetchFontBytes,
    input.signal,
  );
  throwIfAborted(input.signal);
  // Finish every allocation/serialization step that can fail before registering
  // FontFace objects in the caller's document. Once registered, ownership is
  // transferred through the returned release callback.
  const cssText = faces.map(faceCss).join('');
  const embeddedFontBytes = faces.reduce((total, face) => total + face.bytes.length, 0);
  const embeddedSerializedBytes = new TextEncoder().encode(cssText).byteLength;
  const browserMetrics = input.measureText
    ? Object.freeze({ measureText: input.measureText, release: () => undefined })
    : await createBrowserTextMeasurer(
        faces,
        input.ownerDocument ?? globalThis.document,
        input.signal,
      );
  try {
    return Object.freeze({
      cssText,
      embeddedFontBytes,
      embeddedSerializedBytes,
      faceCount: faces.length,
      fontFamily: MIND_MAP_STATIC_SANS_STACK,
      fontPolicy: MIND_MAP_STATIC_FONT_POLICY,
      measureText: browserMetrics.measureText,
      release: browserMetrics.release,
      resolveFontFamily: preparedStaticFontFamilyResolver,
      sourceVersion: MIND_MAP_STATIC_FONT_SOURCE_VERSION,
    });
  } catch (error) {
    browserMetrics.release();
    throw error;
  }
};
