import type { DOMOutputSpec } from '@tiptap/pm/model';

import type {
  AssetId,
  ColorValue,
  Equation,
  MarkerDefinitionId,
  MindMapDocumentV1,
  MindMapSheet,
  Rect,
  RichText,
  SheetId,
  TopicId,
  TopicLink,
} from '../domain/types';
import { inspectXMindRaster } from '../io/xmindImages';
import {
  resolveXMindExportResourceBytes,
  type ResolveXMindExportResourceBytesInput,
} from '../io/xmindResourceResolver';
import type {
  SemanticGeometryPath,
  SemanticOverlayGeometry,
} from '../render/geometry';
import { projectMindMapToRenderModel } from '../render/model';
import type {
  ConnectorVisualStyle,
  SemanticVisualStyle,
} from '../style';
import type { ImageEnrichmentProjection } from '../ui/enrichmentProjection';
import {
  markerVisualForSource,
  type MarkerVisual,
} from '../ui/markerVisuals';
import {
  buildMindMapFlowProjection,
  isOrdinaryStackedTopicImage,
  measureTopicStickerLayout,
  type MindMapFlowProjection,
} from '../ui/projection';
import {
  compareMindMapViewOrderedEntities,
  getMindMapSheetsInViewOrder,
} from '../view/ordering';
import { mindMapRichTextToPlainText } from '../view/text';
import {
  MindMapStaticExportScopeError,
  projectMindMapDocumentForStaticExport,
  type MindMapStaticExportScope,
} from './exportScope';
import type { EquationSvgRender } from './equationSvg';
import { renderMindMapEquationToSvg } from './mathJaxEquationSvgRenderer';
import {
  layoutMindMapRichTextForSvg,
  safeMindMapSvgLinkHref,
  splitMindMapSvgGraphemes,
  type SvgRichTextLayout,
  type SvgRichTextRun,
  type SvgFontFamilyResolver,
  type SvgTextMeasurementStyle,
  type SvgTextMeasurer,
} from './richTextSvgLayout';
import type {
  MindMapStaticFontBundleLoader,
  MindMapStaticFontUsage,
} from './staticFontBundle';
import {
  MIND_MAP_STATIC_EMOJI_STACK,
  MIND_MAP_STATIC_FONT_POLICY,
  MIND_MAP_STATIC_MONO_STACK,
  MIND_MAP_STATIC_TEXT_STACK,
  MindMapStaticFontError,
} from './staticFontPolicy';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const DEFAULT_EXPORT_PADDING = 24;
const SHEET_HEADER_HEIGHT = 48;
const IMAGE_GAP = 8;
const TOPIC_HORIZONTAL_PADDING = 16;
const TOPIC_VERTICAL_PADDING = 8;
const TOPIC_MARKER_ICON_SIZE = 16;
const TOPIC_MARKER_GAP = 3;
const TOPIC_MARKER_SECTION_GAP = 4;
const SEMANTIC_STROKE_PADDING = 18;
const MATHJAX_SVG_UNITS_PER_EM = 1_000;
const EQUATION_VECTOR_BUDGET_RATIO = 0.5;
const STATIC_ITALIC_SKEW_DEGREES = -12;
const EXTERNAL_LINK_PREFIX = '↗';
const INTERNAL_LINK_PREFIX = '→';

export const FULL_MIND_MAP_SVG_LIMITS = Object.freeze({
  maxElements: 250_000,
  maxEquations: 40_000,
  maxHeight: 4_000_000,
  maxImages: 4_096,
  maxLinks: 40_000,
  maxSemanticElements: 40_000,
  maxSerializedBytes: 64 * 1024 * 1024,
  maxSheets: 256,
  maxTextCodePoints: 500_000,
  maxTopics: 20_000,
  maxTreeEdges: 40_000,
  maxWidth: 4_000_000,
});

export type FullMindMapSvgExportLimitCode =
  | 'appearance-invalid'
  | 'element-limit'
  | 'equation-limit'
  | 'height-limit'
  | 'image-limit'
  | 'link-limit'
  | 'projection-incomplete'
  | 'resource-unavailable'
  | 'semantic-element-limit'
  | 'serialized-size-limit'
  | 'sheet-limit'
  | 'text-limit'
  | 'topic-limit'
  | 'tree-edge-limit'
  | 'width-limit';

export class FullMindMapSvgExportError extends Error {
  readonly actual?: number;
  readonly cause?: unknown;
  readonly code: FullMindMapSvgExportLimitCode;
  readonly limit?: number;

  constructor(
    code: FullMindMapSvgExportLimitCode,
    message: string,
    details: {
      readonly actual?: number;
      readonly cause?: unknown;
      readonly limit?: number;
    } = {},
  ) {
    super(message);
    this.name = 'FullMindMapSvgExportError';
    this.code = code;
    this.actual = details.actual;
    this.cause = details.cause;
    this.limit = details.limit;
  }
}

export interface FullMindMapSvgLimits {
  readonly maxElements: number;
  readonly maxEquations: number;
  readonly maxHeight: number;
  readonly maxImages: number;
  readonly maxLinks: number;
  readonly maxSemanticElements: number;
  readonly maxSerializedBytes: number;
  readonly maxSheets: number;
  readonly maxTextCodePoints: number;
  readonly maxTopics: number;
  readonly maxTreeEdges: number;
  readonly maxWidth: number;
}

export interface FullMindMapSvgSheetBounds {
  /** Export-space frame including the sheet header and padding. */
  readonly bounds: Readonly<Rect>;
  /** Original renderer-neutral coordinates before sheet packing. */
  readonly sourceBounds: Readonly<Rect>;
  readonly sheetId: SheetId;
  /** Add these values to a Core-layout coordinate to get export-space coordinates. */
  readonly translateX: number;
  readonly translateY: number;
}

export interface FullMindMapSvgExport {
  readonly bounds: Readonly<Rect>;
  readonly elementCount: number;
  readonly equationCount: number;
  readonly equationFallbackCount: number;
  readonly equationPolicy:
    | 'literal-fallback-v0'
    | 'mathjax-svg-paths-v1'
    | 'mathjax-svg-paths-v1-with-fallback';
  readonly equationVectorCount: number;
  readonly embeddedFontBytes: number;
  readonly fontFaceCount: number;
  readonly fontPolicy: typeof MIND_MAP_STATIC_FONT_POLICY;
  readonly fontSourceVersion: string;
  readonly estimatedSerializedBytes: number;
  readonly height: number;
  readonly imageCount: number;
  readonly linkCount: number;
  readonly markerCount: number;
  readonly semanticElementCount: number;
  readonly serializedByteLimit: number;
  readonly sheetBounds: readonly FullMindMapSvgSheetBounds[];
  readonly sheetCount: number;
  readonly spec: DOMOutputSpec;
  readonly status: 'ready';
  readonly topicCount: number;
  readonly treeEdgeCount: number;
  readonly width: number;
}

export interface CreateFullMindMapSvgExportOptions extends Omit<
  ResolveXMindExportResourceBytesInput,
  'additionalAssetIds' | 'document'
> {
  /** Callers may lower, but never raise, the built-in safety ceilings. */
  readonly limits?: Partial<FullMindMapSvgLimits>;
  /** Selection is compiled before counts, resource resolution, and layout. */
  readonly scope?: Readonly<MindMapStaticExportScope>;
  readonly appearance?: Partial<FullMindMapSvgAppearance>;
  /** Deterministic test seam; production always uses the pinned packaged fonts. */
  readonly loadStaticFontBundle?: MindMapStaticFontBundleLoader;
}

export type FullMindMapSvgBackground =
  | { readonly kind: 'source' }
  | { readonly kind: 'transparent' }
  | { readonly color: string; readonly kind: 'solid' };

export type FullMindMapSvgFrame = 'none' | 'sheet-card';

export interface FullMindMapSvgAppearance {
  /** Logical pixels around each selected scene; raster scale is applied later. */
  readonly padding: number;
  readonly background: FullMindMapSvgBackground;
  readonly frame: FullMindMapSvgFrame;
}

export const DEFAULT_FULL_MIND_MAP_SVG_APPEARANCE: Readonly<FullMindMapSvgAppearance> =
  Object.freeze({
    padding: DEFAULT_EXPORT_PADDING,
    background: Object.freeze({ kind: 'source' as const }),
    frame: 'sheet-card' as const,
  });

interface MutableBounds {
  maxX: number;
  maxY: number;
  minX: number;
  minY: number;
}

interface TopicRenderResult {
  readonly bounds: Readonly<Rect>;
  readonly spec: DOMOutputSpec;
}

interface TopicEquationLayout {
  readonly equation: Readonly<Equation>;
  readonly fallbackLayout?: Readonly<SvgRichTextLayout>;
  readonly height: number;
  readonly render: Readonly<EquationSvgRender>;
  readonly width: number;
}

interface TopicLinkLayout {
  readonly external: boolean;
  readonly href?: string;
  readonly label: string;
  readonly layout: Readonly<SvgRichTextLayout>;
  readonly link: Readonly<TopicLink>;
}

interface TopicMarkerLayout {
  readonly id: string;
  readonly label: string;
  readonly visual: Readonly<MarkerVisual>;
}

interface TopicContentLayout {
  readonly additionalHeight: number;
  readonly additionalWidth: number;
  readonly equations: readonly TopicEquationLayout[];
  readonly links: readonly TopicLinkLayout[];
  readonly markerColumns: number;
  readonly markerHeight: number;
  readonly markers: readonly TopicMarkerLayout[];
  readonly title: Readonly<SvgRichTextLayout>;
  readonly totalHeight: number;
}

interface SheetRenderPlan {
  readonly contentSpecs: readonly DOMOutputSpec[];
  readonly projection: MindMapFlowProjection;
  readonly sheet: Readonly<MindMapSheet>;
  readonly sourceBounds: Readonly<Rect>;
}

interface PackedSheetPlan extends SheetRenderPlan {
  readonly frame: Readonly<Rect>;
  readonly translateX: number;
  readonly translateY: number;
}

interface SpecBudget {
  readonly elements: number;
  readonly serializedBytes: number;
}

interface RenderAllocationBudget {
  readonly elementLimit: number;
  readonly fontFamily: string;
  readonly measureText: SvgTextMeasurer;
  readonly resolveFontFamily: SvgFontFamilyResolver;
  readonly reservedElements: number;
  readonly signal: AbortSignal;
  textElements: number;
}

interface EquationRenderCompilation {
  readonly fallbackCount: number;
  readonly policy: FullMindMapSvgExport['equationPolicy'];
  readonly renders: Readonly<Record<string, EquationSvgRender>>;
  readonly vectorCount: number;
}

const svgElement = (
  tagName: string,
  attributes: Record<string, string | number>,
  ...children: Array<DOMOutputSpec | string>
): DOMOutputSpec => [tagName, attributes, ...children];

const throwIfAborted = (signal: AbortSignal): void => {
  if (signal.aborted) {
    throw new DOMException('Mind-map SVG export was aborted.', 'AbortError');
  }
};

const finite = (value: number, fallback: number): number =>
  Number.isFinite(value) ? value : fallback;

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, finite(value, minimum)));

const rounded = (value: number): number => {
  const result = Math.round(value * 1_000) / 1_000;
  return Object.is(result, -0) ? 0 : result;
};

const number = (value: number): string => String(rounded(value));

const emptyBounds = (): MutableBounds => ({
  maxX: Number.NEGATIVE_INFINITY,
  maxY: Number.NEGATIVE_INFINITY,
  minX: Number.POSITIVE_INFINITY,
  minY: Number.POSITIVE_INFINITY,
});

const includePoint = (bounds: MutableBounds, x: number, y: number): void => {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new FullMindMapSvgExportError(
      'projection-incomplete',
      'The renderer-neutral layout produced a non-finite coordinate.',
    );
  }
  bounds.minX = Math.min(bounds.minX, x);
  bounds.minY = Math.min(bounds.minY, y);
  bounds.maxX = Math.max(bounds.maxX, x);
  bounds.maxY = Math.max(bounds.maxY, y);
};

const includeRect = (bounds: MutableBounds, rect: Readonly<Rect>): void => {
  if (
    !Number.isFinite(rect.x)
    || !Number.isFinite(rect.y)
    || !Number.isFinite(rect.width)
    || !Number.isFinite(rect.height)
    || rect.width < 0
    || rect.height < 0
  ) {
    throw new FullMindMapSvgExportError(
      'projection-incomplete',
      'The renderer-neutral layout produced an invalid rectangle.',
    );
  }
  includePoint(bounds, rect.x, rect.y);
  includePoint(bounds, rect.x + rect.width, rect.y + rect.height);
};

const boundsRect = (bounds: MutableBounds): Readonly<Rect> => {
  if (
    !Number.isFinite(bounds.minX)
    || !Number.isFinite(bounds.minY)
    || !Number.isFinite(bounds.maxX)
    || !Number.isFinite(bounds.maxY)
  ) {
    throw new FullMindMapSvgExportError(
      'projection-incomplete',
      'The renderer-neutral projection did not produce paint bounds.',
    );
  }
  return Object.freeze({
    x: rounded(bounds.minX),
    y: rounded(bounds.minY),
    width: rounded(Math.max(0, bounds.maxX - bounds.minX)),
    height: rounded(Math.max(0, bounds.maxY - bounds.minY)),
  });
};

const expandedRect = (rect: Readonly<Rect>, amount: number): Readonly<Rect> => ({
  x: rect.x - amount,
  y: rect.y - amount,
  width: rect.width + amount * 2,
  height: rect.height + amount * 2,
});

const normalizeXmlText = (value: string): string => Array.from(value, (character) => {
  const codePoint = character.codePointAt(0) ?? 0;
  if (codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d) return character;
  if (
    (codePoint >= 0x20 && codePoint <= 0xd7ff)
    || (codePoint >= 0xe000 && codePoint <= 0xfffd)
    || (codePoint >= 0x10000 && codePoint <= 0x10ffff)
  ) return character;
  return '\ufffd';
}).join('');

const codePointLength = (value: string): number => {
  let length = 0;
  for (const _character of value) length += 1;
  return length;
};

const safeColor = (value: string | undefined, fallback: string): string => {
  const candidate = value?.trim();
  if (!candidate || candidate.length > 96) return fallback;
  if (/^#[0-9a-f]{3,8}$/iu.test(candidate)) return candidate;
  if (/^[a-z]{1,32}$/iu.test(candidate)) return candidate;
  if (/^(?:rgb|rgba|hsl|hsla)\([0-9.%+\-\s,]+\)$/iu.test(candidate)) return candidate;
  return fallback;
};

const normalizedAppearance = (
  requested: Partial<FullMindMapSvgAppearance> | undefined,
): Readonly<FullMindMapSvgAppearance> => {
  const padding = requested?.padding ?? DEFAULT_FULL_MIND_MAP_SVG_APPEARANCE.padding;
  const frame = requested?.frame ?? DEFAULT_FULL_MIND_MAP_SVG_APPEARANCE.frame;
  const background = requested?.background ?? DEFAULT_FULL_MIND_MAP_SVG_APPEARANCE.background;
  if (!Number.isInteger(padding) || padding < 0 || padding > 512) {
    throw new FullMindMapSvgExportError(
      'appearance-invalid',
      'Static-export padding must be an integer from 0 through 512 logical pixels.',
    );
  }
  if (frame !== 'none' && frame !== 'sheet-card') {
    throw new FullMindMapSvgExportError('appearance-invalid', 'Static-export frame is invalid.');
  }
  if (
    background.kind !== 'source'
    && background.kind !== 'transparent'
    && (
      background.kind !== 'solid'
      || !/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/iu.test(
        background.color,
      )
    )
  ) {
    throw new FullMindMapSvgExportError(
      'appearance-invalid',
      'Static-export background is invalid.',
    );
  }
  return Object.freeze({
    padding,
    frame,
    background: Object.freeze({ ...background }),
  });
};

const safeDashArray = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  const parts = value.trim().split(/\s+/u);
  if (
    parts.length === 0
    || parts.length > 32
    || parts.some((part) => !/^\d+(?:\.\d+)?$/u.test(part))
  ) return undefined;
  return parts.map((part) => number(clamp(Number(part), 0, 10_000))).join(' ');
};

const consumeDynamicElements = (budget: RenderAllocationBudget, count = 1): void => {
  budget.textElements += count;
  const actual = budget.reservedElements + budget.textElements;
  if (actual > budget.elementLimit) {
    throw new FullMindMapSvgExportError(
      'element-limit',
      `Mind-map SVG export element allocation (${actual}) exceeds the explicit safety limit (${budget.elementLimit}).`,
      { actual, limit: budget.elementLimit },
    );
  }
  throwIfAborted(budget.signal);
};

const consumeTextElement = (budget: RenderAllocationBudget): void => {
  consumeDynamicElements(budget);
};

const wrapText = (
  value: string,
  maximumWidth: number,
  style: Readonly<SvgTextMeasurementStyle>,
  budget: RenderAllocationBudget,
): readonly string[] => {
  const normalized = normalizeXmlText(value);
  const lines: string[] = [];
  const pushLine = (line: string): void => {
    consumeTextElement(budget);
    lines.push(line);
  };
  let line = '';
  let previousWasCarriageReturn = false;
  for (const character of splitMindMapSvgGraphemes(normalized)) {
    if (character === '\r' || character === '\n') {
      if (character === '\n' && previousWasCarriageReturn) {
        previousWasCarriageReturn = false;
        continue;
      }
      pushLine(line);
      line = '';
      previousWasCarriageReturn = character === '\r';
      continue;
    }
    previousWasCarriageReturn = false;
    const candidate = line + character;
    const candidateWidth = budget.measureText(candidate, style);
    if (!Number.isFinite(candidateWidth) || candidateWidth < 0) {
      throw new FullMindMapSvgExportError(
        'projection-incomplete',
        'Pinned-font text measurement returned an invalid width.',
      );
    }
    if (line.length > 0 && candidateWidth > maximumWidth) {
      pushLine(line);
      line = character;
    } else {
      line = candidate;
    }
  }
  pushLine(line);
  return Object.freeze(lines);
};

const textBounds = (
  lines: readonly string[],
  x: number,
  firstBaselineY: number,
  fontSize: number,
  lineHeight: number,
  style: Readonly<SvgTextMeasurementStyle>,
  measureText: SvgTextMeasurer,
  anchor: 'start' | 'middle' = 'start',
): Readonly<Rect> => {
  const width = Math.max(0, ...lines.map((line) => measureText(line, style)));
  const left = anchor === 'middle' ? x - width / 2 : x;
  return {
    x: left,
    y: firstBaselineY - fontSize,
    width,
    height: Math.max(fontSize, (lines.length - 1) * lineHeight + fontSize),
  };
};

const textSpec = (
  lines: readonly string[],
  attributes: Record<string, string | number>,
  firstBaselineY: number,
  lineHeight: number,
): DOMOutputSpec => {
  const italic = attributes['font-style'] === 'italic';
  const normalizedAttributes = {
    ...attributes,
    'font-style': 'normal',
    'font-synthesis': 'none',
  };
  if (!italic) {
    return svgElement(
      'text',
      normalizedAttributes,
      ...lines.map((line, index) => svgElement(
        'tspan',
        {
          x: attributes.x,
          y: firstBaselineY + index * lineHeight,
        },
        line,
      )),
    );
  }
  return svgElement(
    'g',
    { 'data-static-italic': 'skew-minus-12-v1' },
    ...lines.map((line, index) => {
      const baseline = firstBaselineY + index * lineHeight;
      return svgElement(
        'g',
        { transform: `translate(${number(Number(attributes.x))} ${number(baseline)}) skewX(${STATIC_ITALIC_SKEW_DEGREES})` },
        svgElement('text', {
          ...normalizedAttributes,
          x: 0,
          y: 0,
        }, line),
      );
    }),
  );
};

const TOPIC_CONTENT_SECTION_GAP = 6;
const TOPIC_CONTENT_ROW_GAP = 3;

const plainRichText = (text: string): RichText => ({
  type: 'doc',
  version: 1,
  blocks: [{
    type: 'paragraph',
    children: [{ type: 'text', text }],
  }],
});

const fragmentToken = (value: string): string => Array.from(value, (character) => (
  (character.codePointAt(0) ?? 0).toString(16)
)).join('-') || 'empty';

const sheetFragmentId = (sheetId: SheetId): string => `mindmap-sheet-${fragmentToken(sheetId)}`;
const topicFragmentId = (topicId: TopicId): string => `mindmap-topic-${fragmentToken(topicId)}`;

const linkPresentation = (
  document: Readonly<MindMapDocumentV1>,
  link: Readonly<TopicLink>,
): { readonly external: boolean; readonly href?: string; readonly label: string } => {
  const requestedTitle = normalizeXmlText(link.title?.trim() ?? '');
  if (link.kind === 'web' || link.kind === 'email') {
    const href = link.status === 'active' ? safeMindMapSvgLinkHref(link.href) : undefined;
    let protocol = '';
    try {
      protocol = href ? new URL(href).protocol.toLowerCase() : '';
    } catch {
      protocol = '';
    }
    const kindMatches = link.kind === 'web'
      ? protocol === 'http:' || protocol === 'https:'
      : protocol === 'mailto:';
    const safeHref = kindMatches ? href : undefined;
    return {
      external: safeHref !== undefined,
      ...(safeHref ? { href: safeHref } : {}),
      label: requestedTitle || (safeHref ?? (link.kind === 'web' ? '网页链接' : '邮件链接')),
    };
  }
  if (link.kind === 'sheet') {
    const target = document.sheets[link.targetSheetId];
    const href = link.status === 'active' && target
      ? `#${sheetFragmentId(target.id)}`
      : undefined;
    return {
      external: false,
      ...(href ? { href } : {}),
      label: requestedTitle || target?.title.trim() || '目标 Sheet 不在导出范围',
    };
  }
  if (link.kind === 'topic') {
    const targetSheet = document.sheets[link.targetSheetId];
    const target = targetSheet?.topics[link.targetTopicId];
    const href = link.status === 'active' && target
      ? `#${topicFragmentId(target.id)}`
      : undefined;
    return {
      external: false,
      ...(href ? { href } : {}),
      label: requestedTitle
        || (target ? mindMapRichTextToPlainText(target.title).trim() : '')
        || '目标主题不在导出范围',
    };
  }
  return {
    external: false,
    label: requestedTitle || (link.kind === 'file'
      ? '文件链接'
      : link.kind === 'folder'
        ? '文件夹链接'
        : '文档页面链接'),
  };
};

const topicContentLayout = (
  document: Readonly<MindMapDocumentV1>,
  sheet: Readonly<MindMapSheet>,
  node: MindMapFlowProjection['nodes'][number],
  equationRenders: Readonly<Record<string, EquationSvgRender>>,
  budget: RenderAllocationBudget,
): TopicContentLayout => {
  const width = finite(node.width ?? 0, 0);
  const height = finite(node.height ?? 0, 0);
  const card = topicCardFrame({ x: 0, y: 0, width, height }, node.data.localImages);
  const maximumWidth = Math.max(1, card.width - TOPIC_HORIZONTAL_PADDING * 2);
  const fontSize = clamp(node.data.visualStyle.fontSize ?? 14, 6, 256);
  const fontWeight = clamp(
    node.data.visualStyle.fontWeight ?? (node.data.role === 'central' ? 700 : 500),
    100,
    900,
  );
  const titleLayoutOptions = {
    baseFontSize: fontSize,
    baseFontStyle: node.data.visualStyle.fontStyle ?? 'normal' as const,
    baseFontWeight: fontWeight,
    maximumWidth,
    measureText: budget.measureText,
    resolveFontFamily: budget.resolveFontFamily,
  };
  const flattenedTitle = mindMapRichTextToPlainText(node.data.title).trim();
  const sourceTitle = flattenedTitle ? node.data.title : plainRichText('Untitled topic');
  const title = layoutMindMapRichTextForSvg(sourceTitle, titleLayoutOptions);
  const flatTitle = layoutMindMapRichTextForSvg(
    plainRichText(flattenedTitle || 'Untitled topic'),
    titleLayoutOptions,
  );
  const markers = Object.values(sheet.markerInstances)
    .filter((instance) => instance.topicId === node.id)
    .sort(compareMindMapViewOrderedEntities)
    .map((instance): TopicMarkerLayout => {
      const definition = document.markerDefinitions[instance.markerDefinitionId];
      return Object.freeze({
        id: instance.id,
        label: definition?.name.trim() || 'Missing marker',
        visual: markerVisualForSource(
          definition?.source.kind,
          definition?.source.kind === 'builtin' ? definition.source.key : undefined,
        ),
      });
    });
  const markerColumns = Math.max(
    1,
    Math.floor((maximumWidth + TOPIC_MARKER_GAP) / (TOPIC_MARKER_ICON_SIZE + TOPIC_MARKER_GAP)),
  );
  const markerRows = markers.length === 0 ? 0 : Math.ceil(markers.length / markerColumns);
  const markerHeight = markerRows === 0
    ? 0
    : markerRows * TOPIC_MARKER_ICON_SIZE + (markerRows - 1) * TOPIC_MARKER_GAP;
  const markerWidth = Math.min(markers.length, markerColumns) * TOPIC_MARKER_ICON_SIZE
    + Math.max(0, Math.min(markers.length, markerColumns) - 1) * TOPIC_MARKER_GAP;
  const equations = Object.values(sheet.equations)
    .filter((equation) => equation.topicId === node.id)
    .sort(compareMindMapViewOrderedEntities)
    .map((equation): TopicEquationLayout => {
      const render = equationRenders[equation.id]
        ?? Object.freeze({ reason: 'renderer-unavailable' as const, status: 'fallback' as const });
      const equationFontSize = 12 * clamp(equation.scale, 0.01, 100);
      if (render.status === 'vector') {
        const naturalWidth = Math.max(
          1,
          render.viewBox.width / MATHJAX_SVG_UNITS_PER_EM * equationFontSize,
        );
        const naturalHeight = Math.max(
          1,
          render.viewBox.height / MATHJAX_SVG_UNITS_PER_EM * equationFontSize,
        );
        return Object.freeze({
          equation,
          height: naturalHeight,
          render,
          width: naturalWidth,
        });
      }
      const fallbackLayout = layoutMindMapRichTextForSvg(
        plainRichText(`ƒ ${equation.source || 'Empty equation'}`),
        {
          baseFontSize: clamp(equationFontSize, 8, 256),
          baseFontWeight: 500,
          maximumWidth,
          measureText: budget.measureText,
          resolveFontFamily: budget.resolveFontFamily,
        },
      );
      return Object.freeze({
        equation,
        fallbackLayout,
        height: fallbackLayout.height,
        render,
        width: maximumWidth,
      });
    });
  const links = Object.values(sheet.links)
    .filter((link) => link.topicId === node.id)
    .sort(compareMindMapViewOrderedEntities)
    .map((link) => {
      const presentation = linkPresentation(document, link);
      const label = `${presentation.href ? EXTERNAL_LINK_PREFIX : INTERNAL_LINK_PREFIX} ${presentation.label}`;
      return Object.freeze({
        external: presentation.external,
        ...(presentation.href ? { href: presentation.href } : {}),
        label,
        layout: layoutMindMapRichTextForSvg(plainRichText(label), {
          baseFontSize: 11,
          baseFontWeight: 500,
          maximumWidth,
          measureText: budget.measureText,
          resolveFontFamily: budget.resolveFontFamily,
        }),
        link,
      });
    });
  const supplementaryCount = equations.length + links.length;
  const markerSectionHeight = markers.length > 0
    ? TOPIC_MARKER_SECTION_GAP + markerHeight
    : 0;
  const supplementaryHeight = markerSectionHeight
    + equations.reduce((total, row) => total + row.height, 0)
    + links.reduce((total, row) => total + row.layout.height, 0)
    + Math.max(0, equations.length - 1) * TOPIC_CONTENT_ROW_GAP
    + Math.max(0, links.length - 1) * TOPIC_CONTENT_ROW_GAP
    + (equations.length > 0 && links.length > 0 ? TOPIC_CONTENT_SECTION_GAP : 0)
    + (supplementaryCount > 0 ? TOPIC_CONTENT_SECTION_GAP : 0);
  const totalHeight = title.height + supplementaryHeight;
  const requiredSupplementWidth = equations.reduce(
    (required, equation) => Math.max(required, equation.width),
    Math.max(maximumWidth, markerWidth),
  );
  return Object.freeze({
    additionalHeight: Math.ceil(Math.max(0, title.height - flatTitle.height) + supplementaryHeight),
    additionalWidth: Math.ceil(Math.max(0, requiredSupplementWidth - maximumWidth)),
    equations: Object.freeze(equations),
    links: Object.freeze(links),
    markerColumns,
    markerHeight,
    markers: Object.freeze(markers),
    title,
    totalHeight,
  });
};

const runSpec = (
  run: Readonly<SvgRichTextRun>,
  defaults: {
    readonly fill: string;
    readonly fontFamily: string;
    readonly fontSize: number;
    readonly fontStyle?: string;
    readonly fontWeight: number;
    readonly textDecoration?: string;
  },
  x: number,
  baseline: number,
): DOMOutputSpec => {
  const fontFamily = run.style.fontFamily === MIND_MAP_STATIC_EMOJI_STACK
    ? MIND_MAP_STATIC_EMOJI_STACK
    : run.style.fontFamily === MIND_MAP_STATIC_MONO_STACK
      ? MIND_MAP_STATIC_MONO_STACK
      : defaults.fontFamily;
  const italic = (run.style.fontStyle ?? defaults.fontStyle ?? 'normal') === 'italic';
  const attributes: Record<string, string | number> = {
    fill: safeColor(run.style.color, defaults.fill),
    'font-family': fontFamily,
    'font-size': clamp(run.style.fontSize, 6, 256),
    'font-style': 'normal',
    'font-synthesis': 'none',
    'font-weight': run.style.fontWeight ?? defaults.fontWeight,
    ...(fontFamily === MIND_MAP_STATIC_MONO_STACK
      ? { 'font-stretch': 'extra-condensed' }
      : {}),
    ...(run.unsafeLink ? { 'data-unsafe-link': 'true' } : {}),
    'xml:space': 'preserve',
    x: italic ? 0 : x,
    y: italic ? 0 : baseline,
  };
  const decoration = run.style.textDecoration ?? defaults.textDecoration;
  if (decoration) attributes['text-decoration'] = decoration;
  const text = svgElement('text', attributes, normalizeXmlText(run.text));
  const painted = italic
    ? svgElement('g', {
        'data-static-italic': 'skew-minus-12-v1',
        transform: `translate(${number(x)} ${number(baseline)}) skewX(${STATIC_ITALIC_SKEW_DEGREES})`,
      }, text)
    : text;
  return run.href
    ? svgElement('a', {
        href: run.href,
        referrerpolicy: 'no-referrer',
        rel: 'noopener noreferrer nofollow',
        target: '_blank',
        ...(run.linkTitle ? { title: normalizeXmlText(run.linkTitle) } : {}),
      }, painted)
    : painted;
};

const richTextLayoutSpec = (
  layout: Readonly<SvgRichTextLayout>,
  frame: Readonly<Rect>,
  className: string,
  defaults: Parameters<typeof runSpec>[1],
  budget: RenderAllocationBudget,
): DOMOutputSpec => {
  let y = frame.y;
  const lines = layout.lines.map((line) => {
    const x = line.align === 'center'
      ? frame.x + (frame.width - line.width) / 2
      : line.align === 'right'
        ? frame.x + frame.width - line.width
        : frame.x;
    const baseline = y + line.height * 0.8;
    y += line.height;
    consumeDynamicElements(
      budget,
      1
        + line.runs.length
        + line.runs.filter((run) => run.href !== undefined).length
        + line.runs.filter((run) => (
          (run.style.fontStyle ?? defaults.fontStyle ?? 'normal') === 'italic'
        )).length,
    );
    let runX = x;
    const runSpecs = line.runs.map((run) => {
      const spec = runSpec(run, {
        ...defaults,
        fontFamily: budget.fontFamily,
      }, runX, baseline);
      const advance = budget.measureText(run.text, run.style);
      if (!Number.isFinite(advance) || advance < 0) {
        throw new FullMindMapSvgExportError(
          'projection-incomplete',
          'Pinned-font text measurement returned an invalid run width.',
        );
      }
      runX += advance;
      return spec;
    });
    return svgElement(
      'g',
      {
        class: `${className}-line`,
      },
      ...runSpecs,
    );
  });
  consumeDynamicElements(budget);
  return svgElement('g', { class: className }, ...lines);
};

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_CHUNK_BYTES = 12_288;

const encodeBase64 = (bytes: Uint8Array): string => {
  const chunks: string[] = [];
  for (let chunkStart = 0; chunkStart < bytes.byteLength; chunkStart += BASE64_CHUNK_BYTES) {
    const chunkEnd = Math.min(bytes.byteLength, chunkStart + BASE64_CHUNK_BYTES);
    let chunk = '';
    for (let index = chunkStart; index < chunkEnd; index += 3) {
      const first = bytes[index];
      const hasSecond = index + 1 < bytes.byteLength;
      const hasThird = index + 2 < bytes.byteLength;
      const second = hasSecond ? bytes[index + 1] : 0;
      const third = hasThird ? bytes[index + 2] : 0;
      const combined = (first << 16) | (second << 8) | third;
      chunk += BASE64_ALPHABET[(combined >>> 18) & 0x3f]
        + BASE64_ALPHABET[(combined >>> 12) & 0x3f]
        + (hasSecond ? BASE64_ALPHABET[(combined >>> 6) & 0x3f] : '=')
        + (hasThird ? BASE64_ALPHABET[combined & 0x3f] : '=');
    }
    chunks.push(chunk);
  }
  return chunks.join('');
};

const inlineImageUrls = (
  document: Readonly<MindMapDocumentV1>,
  resourceBytes: Readonly<Record<string, Uint8Array>> | undefined,
): Readonly<Record<string, string>> => {
  const result: Record<string, string> = {};
  for (const [candidateAssetId, bytes] of Object.entries(resourceBytes ?? {})) {
    const asset = document.assets[candidateAssetId as AssetId];
    if (!asset || !(bytes instanceof Uint8Array) || bytes.byteLength !== asset.byteSize) continue;
    const inspection = inspectXMindRaster(bytes);
    if (!inspection || inspection.mimeType !== asset.mimeType.toLowerCase()) continue;
    result[asset.id] = `data:${inspection.mimeType};base64,${encodeBase64(bytes)}`;
  }
  return Object.freeze(result);
};

const imageLabel = (image: Readonly<ImageEnrichmentProjection>): string =>
  normalizeXmlText(image.alt?.trim() || image.fileName.trim() || (
    image.role === 'sticker' ? 'Topic sticker' : 'Topic image'
  ));

const validCrop = (
  crop: Readonly<Rect> | undefined,
  intrinsicSize: Readonly<{ readonly width: number; readonly height: number }> | undefined,
): Readonly<Rect> | undefined =>
  crop
  && intrinsicSize
  && Number.isFinite(crop.x)
  && Number.isFinite(crop.y)
  && Number.isFinite(crop.width)
  && Number.isFinite(crop.height)
  && crop.x >= 0
  && crop.y >= 0
  && crop.width > 0
  && crop.height > 0
  && crop.x + crop.width <= intrinsicSize.width
  && crop.y + crop.height <= intrinsicSize.height
    ? crop
    : undefined;

const imageSpec = (
  image: Readonly<ImageEnrichmentProjection>,
  frame: Readonly<Rect>,
  imageUrls: Readonly<Record<string, string>>,
): DOMOutputSpec => {
  const url = imageUrls[image.assetId];
  const label = imageLabel(image);
  const groupAttributes: Record<string, string | number> = {
    'aria-label': label,
    class: url ? 'mindmap-full-image mindmap-full-image-ready' : 'mindmap-full-image mindmap-full-image-unavailable',
    'data-image-align': image.placement.align,
    'data-image-id': image.id,
    'data-image-role': image.role,
    'data-image-side': image.placement.side,
    'data-image-size-source': image.displaySizeSource,
    role: 'img',
  };
  if (!url) {
    return svgElement(
      'g',
      groupAttributes,
      svgElement('title', {}, label),
      svgElement('rect', {
        fill: '#f1f5f9',
        height: frame.height,
        rx: Math.min(8, frame.width / 4, frame.height / 4),
        stroke: '#94a3b8',
        'stroke-dasharray': '4 3',
        'stroke-width': 1,
        width: frame.width,
        x: frame.x,
        y: frame.y,
      }),
    );
  }

  const crop = validCrop(image.crop, image.intrinsicSize);
  if (image.crop && !crop) {
    throw new FullMindMapSvgExportError(
      'projection-incomplete',
      `TopicImage ${image.id} has a crop outside its verified raster bounds.`,
    );
  }
  const content = crop
    ? svgElement(
        `${SVG_NAMESPACE} svg`,
        {
          class: 'mindmap-full-image-crop',
          height: frame.height,
          overflow: 'hidden',
          preserveAspectRatio: 'none',
          viewBox: `${number(crop.x)} ${number(crop.y)} ${number(crop.width)} ${number(crop.height)}`,
          width: frame.width,
          x: frame.x,
          y: frame.y,
        },
        svgElement(`${SVG_NAMESPACE} image`, {
          'aria-hidden': 'true',
          focusable: 'false',
          height: image.intrinsicSize?.height ?? crop.y + crop.height,
          href: url,
          preserveAspectRatio: 'none',
          width: image.intrinsicSize?.width ?? crop.x + crop.width,
          x: 0,
          y: 0,
        }),
      )
    : svgElement(`${SVG_NAMESPACE} image`, {
        'aria-hidden': 'true',
        focusable: 'false',
        height: frame.height,
        href: url,
        preserveAspectRatio: image.role === 'background' ? 'xMidYMid slice' : 'xMidYMid meet',
        width: frame.width,
        x: frame.x,
        y: frame.y,
      });
  return svgElement('g', groupAttributes, svgElement('title', {}, label), content);
};

const alignedX = (
  image: Readonly<ImageEnrichmentProjection>,
  cell: Readonly<Rect>,
): number => {
  if (image.placement.align === 'start') return cell.x;
  if (image.placement.align === 'end') return cell.x + cell.width - image.displaySize.width;
  return cell.x + (cell.width - image.displaySize.width) / 2;
};

const alignedY = (
  image: Readonly<ImageEnrichmentProjection>,
  cell: Readonly<Rect>,
): number => {
  if (image.placement.align === 'start') return cell.y;
  if (image.placement.align === 'end') return cell.y + cell.height - image.displaySize.height;
  return cell.y + (cell.height - image.displaySize.height) / 2;
};

const stackHeight = (images: readonly ImageEnrichmentProjection[]): number =>
  images.length === 0
    ? 0
    : images.reduce((total, image) => total + image.displaySize.height, 0)
      + IMAGE_GAP * Math.max(0, images.length - 1);

const imageFramesForTopic = (
  images: readonly ImageEnrichmentProjection[],
  nodeFrame: Readonly<Rect>,
): ReadonlyMap<ImageEnrichmentProjection, Readonly<Rect>> => {
  const result = new Map<ImageEnrichmentProjection, Readonly<Rect>>();
  const stickerLayout = measureTopicStickerLayout(images);
  const card: Readonly<Rect> = {
    x: nodeFrame.x + stickerLayout.leftWidth,
    y: nodeFrame.y + stickerLayout.topHeight,
    width: Math.max(1, nodeFrame.width - stickerLayout.leftWidth - stickerLayout.rightWidth),
    height: Math.max(1, nodeFrame.height - stickerLayout.topHeight - stickerLayout.bottomHeight),
  };
  const stickerCell = (side: 'top' | 'bottom' | 'left' | 'right'): Readonly<Rect> => {
    if (side === 'top') {
      return { x: card.x, y: nodeFrame.y, width: card.width, height: stickerLayout.topHeight };
    }
    if (side === 'bottom') {
      return {
        x: card.x,
        y: card.y + card.height,
        width: card.width,
        height: stickerLayout.bottomHeight,
      };
    }
    if (side === 'left') {
      return { x: nodeFrame.x, y: card.y, width: stickerLayout.leftWidth, height: card.height };
    }
    return {
      x: card.x + card.width,
      y: card.y,
      width: stickerLayout.rightWidth,
      height: card.height,
    };
  };

  for (const side of ['top', 'bottom', 'left', 'right'] as const) {
    const sideImages = images.filter((image) =>
      image.role === 'sticker' && image.placement.side === side);
    const cell = stickerCell(side);
    let cursorY = side === 'left' || side === 'right'
      ? cell.y + Math.max(0, (cell.height - stackHeight(sideImages)) / 2)
      : cell.y;
    for (const image of sideImages) {
      const x = alignedX(image, cell) + image.placement.offset.x;
      const y = cursorY + image.placement.offset.y;
      result.set(image, {
        x,
        y,
        width: image.displaySize.width,
        height: image.displaySize.height,
      });
      cursorY += image.displaySize.height + IMAGE_GAP;
    }
  }

  const topImages = images.filter((image) =>
    isOrdinaryStackedTopicImage(image) && image.placement.side === 'top');
  const bottomImages = images.filter((image) =>
    isOrdinaryStackedTopicImage(image) && image.placement.side === 'bottom');
  let topY = card.y + TOPIC_VERTICAL_PADDING;
  for (const image of topImages) {
    result.set(image, {
      x: alignedX(image, {
        x: card.x + TOPIC_HORIZONTAL_PADDING,
        y: card.y,
        width: Math.max(1, card.width - TOPIC_HORIZONTAL_PADDING * 2),
        height: card.height,
      }) + image.placement.offset.x,
      y: topY + image.placement.offset.y,
      width: image.displaySize.width,
      height: image.displaySize.height,
    });
    topY += image.displaySize.height + IMAGE_GAP;
  }
  let bottomY = card.y + card.height - TOPIC_VERTICAL_PADDING - stackHeight(bottomImages);
  for (const image of bottomImages) {
    result.set(image, {
      x: alignedX(image, {
        x: card.x + TOPIC_HORIZONTAL_PADDING,
        y: card.y,
        width: Math.max(1, card.width - TOPIC_HORIZONTAL_PADDING * 2),
        height: card.height,
      }) + image.placement.offset.x,
      y: bottomY + image.placement.offset.y,
      width: image.displaySize.width,
      height: image.displaySize.height,
    });
    bottomY += image.displaySize.height + IMAGE_GAP;
  }

  for (const image of images) {
    if (result.has(image)) continue;
    if (image.role === 'background') {
      result.set(image, {
        x: card.x + image.placement.offset.x,
        y: card.y + image.placement.offset.y,
        width: card.width,
        height: card.height,
      });
      continue;
    }
    const side = image.placement.side;
    const baseX = side === 'left'
      ? card.x - image.displaySize.width
      : side === 'right'
        ? card.x + card.width
        : alignedX(image, card);
    const baseY = side === 'top'
      ? card.y - image.displaySize.height
      : side === 'bottom'
        ? card.y + card.height
        : alignedY(image, card);
    result.set(image, {
      x: baseX + image.placement.offset.x,
      y: baseY + image.placement.offset.y,
      width: image.displaySize.width,
      height: image.displaySize.height,
    });
  }
  return result;
};

const topicCardFrame = (
  frame: Readonly<Rect>,
  images: readonly ImageEnrichmentProjection[],
): Readonly<Rect> => {
  const stickerLayout = measureTopicStickerLayout(images);
  return {
    x: frame.x + stickerLayout.leftWidth,
    y: frame.y + stickerLayout.topHeight,
    width: Math.max(1, frame.width - stickerLayout.leftWidth - stickerLayout.rightWidth),
    height: Math.max(1, frame.height - stickerLayout.topHeight - stickerLayout.bottomHeight),
  };
};

const markerIconSpec = (
  marker: Readonly<TopicMarkerLayout>,
  x: number,
  y: number,
  className = 'mindmap-full-topic-marker',
): DOMOutputSpec => svgElement(
  'g',
  {
    class: className,
    'data-marker-id': marker.id,
    'data-marker-render': 'deterministic-paths-v1',
    'data-marker-visual-key': marker.visual.key,
  },
  svgElement('title', {}, normalizeXmlText(marker.label)),
  svgElement(
    `${SVG_NAMESPACE} svg`,
    {
      height: TOPIC_MARKER_ICON_SIZE,
      preserveAspectRatio: 'xMidYMid meet',
      viewBox: marker.visual.viewBox,
      width: TOPIC_MARKER_ICON_SIZE,
      x,
      y,
    },
    svgElement('rect', {
      fill: marker.visual.surfaceColor,
      height: 23,
      rx: 5,
      stroke: marker.visual.borderColor,
      'stroke-width': 1,
      width: 23,
      x: 0.5,
      y: 0.5,
    }),
    ...marker.visual.paths.map((item) => svgElement('path', {
      d: item.d,
      fill: item.fill,
      ...(item.opacity === undefined ? {} : { opacity: item.opacity }),
      ...(item.stroke === undefined ? {} : { stroke: item.stroke }),
      ...(item.strokeLinecap === undefined ? {} : { 'stroke-linecap': item.strokeLinecap }),
      ...(item.strokeLinejoin === undefined ? {} : { 'stroke-linejoin': item.strokeLinejoin }),
      ...(item.strokeWidth === undefined ? {} : { 'stroke-width': item.strokeWidth }),
    })),
  ),
);

const markerLegendDefinitionIds = (
  document: Readonly<MindMapDocumentV1>,
  sheet: Readonly<MindMapSheet>,
): readonly MarkerDefinitionId[] => {
  if (sheet.markerLegend.itemOrder !== undefined) return sheet.markerLegend.itemOrder;
  const used = new Set(Object.values(sheet.markerInstances).map(({ markerDefinitionId }) => (
    markerDefinitionId
  )));
  return Object.values(document.markerGroups)
    .sort(compareMindMapViewOrderedEntities)
    .flatMap((group) => Object.values(document.markerDefinitions)
      .filter((definition) => definition.groupId === group.id && used.has(definition.id))
      .sort(compareMindMapViewOrderedEntities)
      .map(({ id }) => id));
};

const renderMarkerLegend = (
  document: Readonly<MindMapDocumentV1>,
  sheet: Readonly<MindMapSheet>,
  budget: RenderAllocationBudget,
): TopicRenderResult | null => {
  if (!sheet.markerLegend.visible) return null;
  const definitionIds = markerLegendDefinitionIds(document, sheet);
  const title = normalizeXmlText(sheet.markerLegend.title?.trim() || '标记图例');
  const rowLabels = definitionIds.map((definitionId) => normalizeXmlText(
    document.markerDefinitions[definitionId]?.name.trim() || 'Missing marker',
  ));
  const titleWidth = budget.measureText(title, {
    fontFamily: budget.fontFamily,
    fontSize: 12,
    fontWeight: 700,
  });
  const labelWidth = rowLabels.reduce((maximum, label) => Math.max(
    maximum,
    budget.measureText(label, {
      fontFamily: budget.fontFamily,
      fontSize: 10,
      fontWeight: 500,
    }),
  ), 0);
  const width = clamp(Math.max(148, titleWidth + 24, labelWidth + 48), 148, 512);
  const headerHeight = 30;
  const rowHeight = 24;
  const height = headerHeight + Math.max(1, definitionIds.length) * rowHeight + 8;
  const x = finite(sheet.markerLegend.position.x, 0);
  const y = finite(sheet.markerLegend.position.y, 0);
  const markerSpecs = definitionIds.map((definitionId, index) => {
    const definition = document.markerDefinitions[definitionId];
    const marker: TopicMarkerLayout = {
      id: definitionId,
      label: rowLabels[index],
      visual: markerVisualForSource(
        definition?.source.kind,
        definition?.source.kind === 'builtin' ? definition.source.key : undefined,
      ),
    };
    const rowY = y + headerHeight + 4 + index * rowHeight;
    return svgElement(
      'g',
      {
        class: 'mindmap-full-marker-legend-item',
        'data-marker-definition-id': definitionId,
      },
      markerIconSpec(marker, x + 10, rowY + 3, 'mindmap-full-marker-legend-icon'),
      svgElement('text', {
        fill: '#334155',
        'font-family': budget.fontFamily,
        'font-size': 10,
        'font-weight': 500,
        x: x + 34,
        y: rowY + 15,
      }, rowLabels[index]),
    );
  });
  return {
    bounds: Object.freeze({ x, y, width, height }),
    spec: svgElement(
      'g',
      {
        'aria-label': title,
        class: 'mindmap-full-marker-legend',
        'data-marker-legend-render': 'deterministic-paths-v1',
        role: 'group',
      },
      svgElement('title', {}, title),
      svgElement('rect', {
        fill: '#ffffff',
        height,
        rx: 8,
        stroke: '#cbd5e1',
        'stroke-width': 1,
        width,
        x,
        y,
      }),
      svgElement('rect', {
        fill: '#f8fafc',
        height: headerHeight,
        rx: 8,
        width,
        x,
        y,
      }),
      svgElement('path', {
        d: `M ${number(x)} ${number(y + headerHeight)} H ${number(x + width)}`,
        fill: 'none',
        stroke: '#e2e8f0',
        'stroke-width': 1,
      }),
      svgElement('text', {
        fill: '#0f172a',
        'font-family': budget.fontFamily,
        'font-size': 12,
        'font-weight': 700,
        x: x + 10,
        y: y + 19,
      }, title),
      ...markerSpecs,
      ...(definitionIds.length === 0 ? [svgElement('text', {
        fill: '#94a3b8',
        'font-family': budget.fontFamily,
        'font-size': 10,
        x: x + 10,
        y: y + headerHeight + 19,
      }, '暂无图例项目')] : []),
    ),
  };
};

const renderTopic = (
  node: MindMapFlowProjection['nodes'][number],
  content: Readonly<TopicContentLayout>,
  imageUrls: Readonly<Record<string, string>>,
  instanceKey: string,
  budget: RenderAllocationBudget,
): TopicRenderResult => {
  const width = finite(node.width ?? 0, 0);
  const height = finite(node.height ?? 0, 0);
  if (width <= 0 || height <= 0) {
    throw new FullMindMapSvgExportError(
      'projection-incomplete',
      `Topic ${node.id} does not have a valid renderer-neutral measurement.`,
    );
  }
  const frame: Readonly<Rect> = {
    x: node.position.x,
    y: node.position.y,
    width,
    height,
  };
  const images = node.data.localImages;
  const card = topicCardFrame(frame, images);
  const imageFrames = imageFramesForTopic(images, frame);
  const style = node.data.visualStyle;
  const fontSize = clamp(style.fontSize ?? 14, 6, 256);
  const title = normalizeXmlText(mindMapRichTextToPlainText(node.data.title) || 'Untitled topic');
  const topImages = images.filter((image) =>
    isOrdinaryStackedTopicImage(image) && image.placement.side === 'top');
  const bottomImages = images.filter((image) =>
    isOrdinaryStackedTopicImage(image) && image.placement.side === 'bottom');
  const textRegionTop = card.y + TOPIC_VERTICAL_PADDING + (
    topImages.length > 0 ? stackHeight(topImages) + IMAGE_GAP : 0
  );
  const textRegionBottom = card.y + card.height - TOPIC_VERTICAL_PADDING - (
    bottomImages.length > 0 ? stackHeight(bottomImages) + IMAGE_GAP : 0
  );
  const contentTop = (textRegionTop + textRegionBottom - content.totalHeight) / 2;
  const contentFrame: Readonly<Rect> = {
    x: card.x + TOPIC_HORIZONTAL_PADDING,
    y: contentTop,
    width: Math.max(1, card.width - TOPIC_HORIZONTAL_PADDING * 2),
    height: content.totalHeight,
  };
  const defaultFontWeight = clamp(
    style.fontWeight ?? (node.data.role === 'central' ? 700 : 500),
    100,
    900,
  );
  const defaultDecoration = style.textDecoration === 'underline'
    || style.textDecoration === 'line-through'
    || style.textDecoration === 'underline line-through'
    ? style.textDecoration
    : undefined;
  const titleSpec = richTextLayoutSpec(
    content.title,
    { ...contentFrame, height: content.title.height },
    'mindmap-full-topic-title',
    {
      fill: safeColor(style.color, '#0f172a'),
      fontFamily: budget.fontFamily,
      fontSize,
      fontStyle: style.fontStyle,
      fontWeight: defaultFontWeight,
      textDecoration: defaultDecoration,
    },
    budget,
  );
  let supplementY = contentTop + content.title.height;
  const markerSpecs: DOMOutputSpec[] = [];
  if (content.markers.length > 0) {
    supplementY += TOPIC_MARKER_SECTION_GAP;
    content.markers.forEach((marker, index) => {
      const row = Math.floor(index / content.markerColumns);
      const column = index % content.markerColumns;
      const rowStart = row * content.markerColumns;
      const rowItems = Math.min(content.markerColumns, content.markers.length - rowStart);
      const rowWidth = rowItems * TOPIC_MARKER_ICON_SIZE
        + Math.max(0, rowItems - 1) * TOPIC_MARKER_GAP;
      const rowX = contentFrame.x + (contentFrame.width - rowWidth) / 2;
      markerSpecs.push(markerIconSpec(
        marker,
        rowX + column * (TOPIC_MARKER_ICON_SIZE + TOPIC_MARKER_GAP),
        supplementY + row * (TOPIC_MARKER_ICON_SIZE + TOPIC_MARKER_GAP),
      ));
    });
    supplementY += content.markerHeight;
  }
  const equationSpecs: DOMOutputSpec[] = [];
  content.equations.forEach((item, index) => {
    supplementY += index === 0 ? TOPIC_CONTENT_SECTION_GAP : TOPIC_CONTENT_ROW_GAP;
    const equationVisual = item.render.status === 'vector'
      ? svgElement(
          `${SVG_NAMESPACE} svg`,
          {
            class: 'mindmap-full-equation-vector',
            color: '#334155',
            height: item.height,
            preserveAspectRatio: item.equation.display === 'block'
              ? 'xMidYMid meet'
              : 'xMinYMid meet',
            viewBox: [
              item.render.viewBox.x,
              item.render.viewBox.y,
              item.render.viewBox.width,
              item.render.viewBox.height,
            ].map(number).join(' '),
            width: item.width,
            x: item.equation.display === 'block'
              ? contentFrame.x + (contentFrame.width - item.width) / 2
              : contentFrame.x,
            y: supplementY,
          },
          ...item.render.nodes,
        )
      : richTextLayoutSpec(
          item.fallbackLayout ?? layoutMindMapRichTextForSvg(
            plainRichText(`ƒ ${item.equation.source || 'Empty equation'}`),
            {
              baseFontSize: clamp(12 * item.equation.scale, 8, 256),
              baseFontWeight: 500,
              maximumWidth: contentFrame.width,
              measureText: budget.measureText,
              resolveFontFamily: budget.resolveFontFamily,
            },
          ),
          {
            x: contentFrame.x,
            y: supplementY,
            width: contentFrame.width,
            height: item.height,
          },
          'mindmap-full-equation-text',
          {
            fill: '#334155',
            fontFamily: budget.fontFamily,
            fontSize: clamp(12 * item.equation.scale, 8, 256),
            fontWeight: 500,
          },
          budget,
        );
    equationSpecs.push(svgElement(
      'g',
      {
        'aria-label': normalizeXmlText(item.equation.alt?.trim() || item.equation.source),
        'data-equation-display': item.equation.display,
        ...(item.render.status === 'fallback'
          ? { 'data-equation-fallback-reason': item.render.reason }
          : { 'data-equation-renderer': item.render.renderer }),
        'data-equation-id': item.equation.id,
        'data-equation-render': item.render.status === 'vector'
          ? 'svg-paths'
          : 'literal-fallback',
        'data-equation-scale': item.equation.scale,
        'data-equation-syntax': item.equation.syntax,
        role: 'math',
      },
      svgElement('title', {}, normalizeXmlText(item.equation.alt?.trim() || 'Equation')),
      svgElement('desc', {}, normalizeXmlText(item.equation.source)),
      equationVisual,
    ));
    supplementY += item.height;
  });
  const linkSpecs: DOMOutputSpec[] = [];
  content.links.forEach((item, index) => {
    supplementY += index === 0
      ? TOPIC_CONTENT_SECTION_GAP
      : TOPIC_CONTENT_ROW_GAP;
    const linkFrame = {
      x: contentFrame.x,
      y: supplementY,
      width: contentFrame.width,
      height: item.layout.height,
    };
    const linkText = richTextLayoutSpec(
      item.layout,
      linkFrame,
      'mindmap-full-topic-link-text',
      {
        fill: item.href ? '#2563eb' : '#64748b',
        fontFamily: budget.fontFamily,
        fontSize: 11,
        fontWeight: 500,
        ...(item.href ? { textDecoration: 'underline' } : {}),
      },
      budget,
    );
    const renderedLink = item.href
      ? svgElement('a', {
          href: item.href,
          ...(item.external ? {
            referrerpolicy: 'no-referrer',
            rel: 'noopener noreferrer nofollow',
            target: '_blank',
          } : {}),
        }, linkText)
      : linkText;
    linkSpecs.push(svgElement(
      'g',
      {
        'data-link-active': item.href ? 'true' : 'false',
        'data-link-id': item.link.id,
        'data-link-kind': item.link.kind,
        'data-link-status': item.link.status,
      },
      svgElement('title', {}, normalizeXmlText(item.label)),
      renderedLink,
    ));
    supplementY += item.layout.height;
  });

  const paintBounds = emptyBounds();
  includeRect(paintBounds, frame);
  includeRect(paintBounds, contentFrame);
  for (const imageFrame of imageFrames.values()) includeRect(paintBounds, imageFrame);

  const backgroundSpecs: DOMOutputSpec[] = [];
  const cardForegroundSpecs: DOMOutputSpec[] = [];
  const stickerSpecs: DOMOutputSpec[] = [];
  for (const image of images) {
    const imageFrame = imageFrames.get(image);
    if (!imageFrame) continue;
    const spec = imageSpec(image, imageFrame, imageUrls);
    if (image.role === 'background') backgroundSpecs.push(spec);
    else if (image.role === 'sticker') stickerSpecs.push(spec);
    else cardForegroundSpecs.push(spec);
  }

  const topicAttributes: Record<string, string | number> = {
    class: 'mindmap-full-topic',
    'data-layout-height': height,
    'data-layout-width': width,
    'data-layout-x': node.position.x,
    'data-layout-y': node.position.y,
    'data-topic-id': node.id,
    'data-topic-role': node.data.role,
    id: topicFragmentId(node.id as TopicId),
  };
  const borderRadius = clamp(
    style.borderRadius,
    0,
    Math.min(card.width, card.height) / 2,
  );
  const clipId = `mindmap-full-topic-${instanceKey}-clip`;

  return {
    bounds: boundsRect(paintBounds),
    spec: svgElement(
      'g',
      topicAttributes,
      svgElement('title', {}, title),
      svgElement(
        'g',
        {
          class: 'mindmap-full-topic-card-content',
          opacity: clamp(style.opacity, 0, 1),
        },
        svgElement(
          'defs',
          {},
          svgElement(
            'clipPath',
            { id: clipId },
            svgElement('rect', {
              height: card.height,
              rx: borderRadius,
              width: card.width,
              x: card.x,
              y: card.y,
            }),
          ),
        ),
        svgElement('rect', {
          class: 'mindmap-full-topic-card',
          fill: safeColor(style.backgroundColor, '#ffffff'),
          height: card.height,
          rx: borderRadius,
          stroke: 'none',
          width: card.width,
          x: card.x,
          y: card.y,
        }),
        svgElement(
          'g',
          { 'clip-path': `url(#${clipId})` },
          ...backgroundSpecs,
        ),
        ...cardForegroundSpecs,
        titleSpec,
        ...markerSpecs,
        ...equationSpecs,
        ...linkSpecs,
        svgElement('rect', {
          class: 'mindmap-full-topic-card-border',
          fill: 'none',
          height: card.height,
          rx: borderRadius,
          stroke: safeColor(style.borderColor, '#cbd5e1'),
          'stroke-width': clamp(style.borderWidth, 0, 32),
          width: card.width,
          x: card.x,
          y: card.y,
        }),
      ),
      ...stickerSpecs,
    ),
  };
};

const connectorPath = (
  connector: NonNullable<MindMapFlowProjection['treeEdges'][number]['data']>['layout'],
): string => {
  if (!connector || connector.points.length === 0) return '';
  const [start, ...remaining] = connector.points;
  if (connector.routing === 'curve' && connector.points.length === 4) {
    return `M ${number(start.x)} ${number(start.y)} C ${number(connector.points[1].x)} ${number(connector.points[1].y)} ${number(connector.points[2].x)} ${number(connector.points[2].y)} ${number(connector.points[3].x)} ${number(connector.points[3].y)}`;
  }
  return `M ${number(start.x)} ${number(start.y)} ${remaining
    .map((point) => `L ${number(point.x)} ${number(point.y)}`)
    .join(' ')}`;
};

const connectorStyle = (
  value: MindMapFlowProjection['treeEdges'][number]['style'],
): ConnectorVisualStyle => {
  const record = value as Readonly<Record<string, unknown>> | undefined;
  return {
    opacity: typeof record?.opacity === 'number' ? record.opacity : 1,
    stroke: typeof record?.stroke === 'string' ? record.stroke : '#64748b',
    strokeWidth: typeof record?.strokeWidth === 'number' ? record.strokeWidth : 2,
    ...(typeof record?.strokeDasharray === 'string'
      ? { strokeDasharray: record.strokeDasharray }
      : {}),
  };
};

const renderTreeConnector = (
  edge: MindMapFlowProjection['treeEdges'][number],
): DOMOutputSpec => {
  const layout = edge.data?.layout;
  if (!layout) {
    throw new FullMindMapSvgExportError(
      'projection-incomplete',
      `TreeEdge ${edge.id} does not have renderer-neutral connector geometry.`,
    );
  }
  const style = connectorStyle(edge.style);
  const attributes: Record<string, string | number> = {
    class: 'mindmap-full-tree-connector',
    d: connectorPath(layout),
    'data-tree-edge-id': edge.id,
    fill: 'none',
    opacity: clamp(style.opacity, 0, 1),
    stroke: safeColor(style.stroke, '#64748b'),
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'stroke-width': clamp(style.strokeWidth, 0, 32),
  };
  const dash = safeDashArray(style.strokeDasharray);
  if (dash) attributes['stroke-dasharray'] = dash;
  return svgElement('path', attributes);
};

const semanticPathToSvg = (path: Readonly<SemanticGeometryPath>): string =>
  path.commands.map((command) => {
    if (command.kind === 'close') return 'Z';
    if (command.kind === 'move') return `M ${number(command.to.x)} ${number(command.to.y)}`;
    if (command.kind === 'line') return `L ${number(command.to.x)} ${number(command.to.y)}`;
    if (command.kind === 'quadratic') {
      return `Q ${number(command.control.x)} ${number(command.control.y)} ${number(command.to.x)} ${number(command.to.y)}`;
    }
    return `C ${number(command.control1.x)} ${number(command.control1.y)} ${number(command.control2.x)} ${number(command.control2.y)} ${number(command.to.x)} ${number(command.to.y)}`;
  }).join(' ');

const semanticStyle = (
  projection: Readonly<MindMapFlowProjection>,
  entityId: string,
): SemanticVisualStyle | undefined => {
  const value = projection.semanticStyles[entityId];
  return value && 'fill' in value ? value : undefined;
};

const relationshipStyle = (
  projection: Readonly<MindMapFlowProjection>,
  entityId: string,
): ConnectorVisualStyle | undefined => {
  const value = projection.semanticStyles[entityId];
  return value && !('fill' in value) ? value : undefined;
};

const semanticCommonAttributes = (
  visual: Readonly<SemanticVisualStyle> | undefined,
  fallback: {
    readonly fill: string;
    readonly fillOpacity: number;
    readonly stroke: string;
  },
): Record<string, string | number> => {
  const attributes: Record<string, string | number> = {
    fill: safeColor(visual?.fill, fallback.fill),
    'fill-opacity': clamp(visual?.fillOpacity ?? fallback.fillOpacity, 0, 1),
    opacity: clamp(visual?.opacity ?? 1, 0, 1),
    stroke: safeColor(visual?.stroke, fallback.stroke),
    'stroke-width': clamp(visual?.strokeWidth ?? 1, 0, 32),
  };
  const dash = safeDashArray(visual?.strokeDasharray);
  if (dash) attributes['stroke-dasharray'] = dash;
  return attributes;
};

const semanticLabelSpec = (
  label: string,
  frame: Readonly<Rect>,
  visual: Readonly<SemanticVisualStyle> | undefined,
  options: { readonly centered?: boolean; readonly fallbackColor: string },
  budget: RenderAllocationBudget,
): { readonly bounds: Readonly<Rect>; readonly spec: DOMOutputSpec } | undefined => {
  const normalized = normalizeXmlText(label).trim();
  if (!normalized) return undefined;
  const fontSize = clamp(visual?.fontSize ?? 12, 6, 128);
  const lineHeight = fontSize * 1.25;
  const measurementStyle: SvgTextMeasurementStyle = {
    fontFamily: MIND_MAP_STATIC_TEXT_STACK,
    fontSize,
    fontStyle: visual?.fontStyle ?? 'normal',
    fontWeight: clamp(visual?.fontWeight ?? 600, 100, 900),
  };
  const lines = wrapText(
    normalized,
    Math.max(1, frame.width - 20),
    measurementStyle,
    budget,
  );
  const textHeight = Math.max(fontSize, (lines.length - 1) * lineHeight + fontSize);
  const x = options.centered ? frame.x + frame.width / 2 : frame.x + 10;
  const firstBaselineY = options.centered
    ? frame.y + (frame.height - textHeight) / 2 + fontSize
    : frame.y + fontSize + 4;
  const anchor = options.centered ? 'middle' as const : 'start' as const;
  const attributes: Record<string, string | number> = {
    fill: safeColor(visual?.color, options.fallbackColor),
    'font-family': MIND_MAP_STATIC_TEXT_STACK,
    'font-size': fontSize,
    'font-style': visual?.fontStyle ?? 'normal',
    'font-weight': clamp(visual?.fontWeight ?? 600, 100, 900),
    'text-anchor': anchor,
    x,
  };
  return {
    bounds: textBounds(
      lines,
      x,
      firstBaselineY,
      fontSize,
      lineHeight,
      measurementStyle,
      budget.measureText,
      anchor,
    ),
    spec: textSpec(lines, attributes, firstBaselineY, lineHeight),
  };
};

const customBoundaryPath = (frame: Readonly<Rect>, shape: string): string | undefined => {
  const { x, y, width, height } = frame;
  const right = x + width;
  const bottom = y + height;
  const dx = Math.max(4, width / 8);
  const dy = Math.max(4, height / 6);
  const n = number;
  if (shape === 'scallop') {
    return `M ${n(x)} ${n(y)} Q ${n(x + dx / 2)} ${n(y - dy)} ${n(x + dx)} ${n(y)} Q ${n(x + width / 2)} ${n(y - dy)} ${n(right - dx)} ${n(y)} Q ${n(right + dx / 2)} ${n(y)} ${n(right)} ${n(y + dy)} Q ${n(right + dx)} ${n(y + height / 2)} ${n(right)} ${n(bottom - dy)} Q ${n(right)} ${n(bottom + dy)} ${n(right - dx)} ${n(bottom)} Q ${n(x + width / 2)} ${n(bottom + dy)} ${n(x + dx)} ${n(bottom)} Q ${n(x - dx / 2)} ${n(bottom)} ${n(x)} ${n(bottom - dy)} Q ${n(x - dx)} ${n(y + height / 2)} ${n(x)} ${n(y + dy)} Z`;
  }
  if (shape === 'wave') {
    return `M ${n(x)} ${n(y + dy)} C ${n(x + width * 0.25)} ${n(y - dy)} ${n(x + width * 0.25)} ${n(y + dy)} ${n(x + width * 0.5)} ${n(y)} C ${n(x + width * 0.75)} ${n(y - dy)} ${n(x + width * 0.75)} ${n(y + dy)} ${n(right)} ${n(y)} L ${n(right)} ${n(bottom - dy)} C ${n(x + width * 0.75)} ${n(bottom + dy)} ${n(x + width * 0.75)} ${n(bottom - dy)} ${n(x + width * 0.5)} ${n(bottom)} C ${n(x + width * 0.25)} ${n(bottom + dy)} ${n(x + width * 0.25)} ${n(bottom - dy)} ${n(x)} ${n(bottom)} Z`;
  }
  if (shape === 'tension') {
    return `M ${n(x + dx)} ${n(y)} Q ${n(x)} ${n(y)} ${n(x)} ${n(y + dy)} Q ${n(x + dx)} ${n(y + height / 2)} ${n(x)} ${n(bottom - dy)} Q ${n(x)} ${n(bottom)} ${n(x + dx)} ${n(bottom)} Q ${n(x + width / 2)} ${n(bottom - dy)} ${n(right - dx)} ${n(bottom)} Q ${n(right)} ${n(bottom)} ${n(right)} ${n(bottom - dy)} Q ${n(right - dx)} ${n(y + height / 2)} ${n(right)} ${n(y + dy)} Q ${n(right)} ${n(y)} ${n(right - dx)} ${n(y)} Q ${n(x + width / 2)} ${n(y + dy)} ${n(x + dx)} ${n(y)} Z`;
  }
  if (shape === 'bracket') {
    return `M ${n(x + dx)} ${n(y)} H ${n(x)} V ${n(bottom)} H ${n(x + dx)} M ${n(right - dx)} ${n(y)} H ${n(right)} V ${n(bottom)} H ${n(right - dx)}`;
  }
  return undefined;
};

const renderZone = (
  item: MindMapFlowProjection['semanticGeometry']['zones'][number],
  projection: Readonly<MindMapFlowProjection>,
  sheet: Readonly<MindMapSheet>,
  budget: RenderAllocationBudget,
): { readonly bounds: readonly Readonly<Rect>[]; readonly spec?: DOMOutputSpec } => {
  if (item.visibility !== 'visible' || !item.rect) return { bounds: [] };
  const visual = semanticStyle(projection, item.entityId);
  const title = sheet.zones[item.entityId]?.title;
  const label = title ? semanticLabelSpec(
    mindMapRichTextToPlainText(title),
    item.rect,
    visual,
    { fallbackColor: '#475569' },
    budget,
  ) : undefined;
  return {
    bounds: [expandedRect(item.rect, SEMANTIC_STROKE_PADDING), ...(label ? [label.bounds] : [])],
    spec: svgElement(
      'g',
      { 'data-entity-id': item.entityId, 'data-semantic-kind': 'zone' },
      svgElement('rect', {
        ...semanticCommonAttributes(visual, {
          fill: '#f8fafc',
          fillOpacity: 0.12,
          stroke: '#94a3b8',
        }),
        height: item.rect.height,
        rx: clamp(visual?.borderRadius ?? 12, 0, Math.min(item.rect.width, item.rect.height) / 2),
        width: item.rect.width,
        x: item.rect.x,
        y: item.rect.y,
      }),
      ...(label ? [label.spec] : []),
    ),
  };
};

const renderBoundary = (
  item: MindMapFlowProjection['semanticGeometry']['boundaries'][number],
  projection: Readonly<MindMapFlowProjection>,
  sheet: Readonly<MindMapSheet>,
  budget: RenderAllocationBudget,
): { readonly bounds: readonly Readonly<Rect>[]; readonly spec?: DOMOutputSpec } => {
  if (item.visibility !== 'visible' || !item.frame || !item.outline) return { bounds: [] };
  const visual = semanticStyle(projection, item.entityId);
  const shape = visual?.shape ?? 'rounded-rectangle';
  const common = semanticCommonAttributes(visual, {
    fill: '#eff6ff',
    fillOpacity: 0.08,
    stroke: '#60a5fa',
  });
  if (shape === 'none') common.stroke = 'transparent';
  if (shape === 'bracket') common.fill = 'none';
  const customPath = customBoundaryPath(item.frame, shape);
  const outline = shape === 'ellipse'
    ? svgElement('ellipse', {
        ...common,
        cx: item.frame.x + item.frame.width / 2,
        cy: item.frame.y + item.frame.height / 2,
        rx: item.frame.width / 2,
        ry: item.frame.height / 2,
      })
    : customPath
      ? svgElement('path', { ...common, d: customPath })
      : svgElement('rect', {
          ...common,
          height: item.frame.height,
          rx: shape === 'capsule'
            ? Math.min(item.frame.width, item.frame.height) / 2
            : shape === 'rounded-rectangle'
              ? clamp(visual?.borderRadius ?? 18, 0, Math.min(item.frame.width, item.frame.height) / 2)
              : 0,
          width: item.frame.width,
          x: item.frame.x,
          y: item.frame.y,
        });
  const title = sheet.boundaries[item.entityId]?.title;
  const label = title ? semanticLabelSpec(
    mindMapRichTextToPlainText(title),
    item.frame,
    visual,
    { fallbackColor: '#1d4ed8' },
    budget,
  ) : undefined;
  const shapeExpansion = customPath && shape !== 'bracket'
    ? Math.max(item.frame.width / 8, item.frame.height / 6)
    : 0;
  return {
    bounds: [
      expandedRect(item.frame, SEMANTIC_STROKE_PADDING + shapeExpansion),
      ...(label ? [label.bounds] : []),
    ],
    spec: svgElement(
      'g',
      {
        'data-boundary-shape': shape,
        'data-entity-id': item.entityId,
        'data-semantic-kind': 'boundary',
      },
      outline,
      ...(label ? [label.spec] : []),
    ),
  };
};

const renderSummary = (
  item: MindMapFlowProjection['semanticGeometry']['summaries'][number],
  projection: Readonly<MindMapFlowProjection>,
): { readonly bounds: readonly Readonly<Rect>[]; readonly spec?: DOMOutputSpec } => {
  if (item.visibility !== 'visible' || !item.bracket || !item.resultConnector) {
    return { bounds: [] };
  }
  const visual = semanticStyle(projection, item.entityId);
  const common: Record<string, string | number> = {
    fill: 'none',
    opacity: clamp(visual?.opacity ?? 1, 0, 1),
    stroke: safeColor(visual?.stroke, '#8b5cf6'),
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'stroke-width': clamp(visual?.strokeWidth ?? 2, 0, 32),
  };
  const dash = safeDashArray(visual?.strokeDasharray);
  if (dash) common['stroke-dasharray'] = dash;
  return {
    bounds: [
      expandedRect(item.bracket.bounds, SEMANTIC_STROKE_PADDING),
      expandedRect(item.resultConnector.bounds, SEMANTIC_STROKE_PADDING),
    ],
    spec: svgElement(
      'g',
      {
        'data-entity-id': item.entityId,
        'data-semantic-kind': 'summary',
        'data-summary-orientation': item.orientation ?? 'auto',
      },
      svgElement('path', {
        ...common,
        'data-summary-part': 'bracket',
        d: semanticPathToSvg(item.bracket),
      }),
      svgElement('path', {
        ...common,
        'data-summary-part': 'connector',
        d: semanticPathToSvg(item.resultConnector),
      }),
    ),
  };
};

const renderCallout = (
  item: MindMapFlowProjection['semanticGeometry']['callouts'][number],
  projection: Readonly<MindMapFlowProjection>,
  sheet: Readonly<MindMapSheet>,
  budget: RenderAllocationBudget,
): { readonly bounds: readonly Readonly<Rect>[]; readonly spec?: DOMOutputSpec } => {
  if (item.visibility !== 'visible' || !item.bubble) return { bounds: [] };
  const visual = semanticStyle(projection, item.entityId);
  const common = semanticCommonAttributes(visual, {
    fill: '#fffbeb',
    fillOpacity: 1,
    stroke: '#f59e0b',
  });
  const callout = sheet.callouts[item.entityId];
  const label = callout ? semanticLabelSpec(
    mindMapRichTextToPlainText(callout.content),
    item.bubble,
    visual,
    { centered: true, fallbackColor: '#92400e' },
    budget,
  ) : undefined;
  return {
    bounds: [
      expandedRect(item.bubble, SEMANTIC_STROKE_PADDING),
      ...(item.tail ? [expandedRect(item.tail.bounds, SEMANTIC_STROKE_PADDING)] : []),
      ...(label ? [label.bounds] : []),
    ],
    spec: svgElement(
      'g',
      { 'data-entity-id': item.entityId, 'data-semantic-kind': 'callout' },
      ...(item.tail ? [svgElement('path', {
        ...common,
        d: semanticPathToSvg(item.tail),
      })] : []),
      svgElement('rect', {
        ...common,
        height: item.bubble.height,
        rx: clamp(visual?.borderRadius ?? 12, 0, Math.min(item.bubble.width, item.bubble.height) / 2),
        width: item.bubble.width,
        x: item.bubble.x,
        y: item.bubble.y,
      }),
      ...(label ? [label.spec] : []),
    ),
  };
};

const safeMarkerId = (
  sheetIndex: number,
  relationshipIndex: number,
  suffix: string,
): string => `mindmap-full-${sheetIndex}-${relationshipIndex}-${suffix}`;

const arrowMarkerSpec = (
  id: string,
  arrow: MindMapFlowProjection['semanticGeometry']['relationships'][number]['startArrow'],
  color: string,
): DOMOutputSpec | undefined => {
  if (arrow === 'none') return undefined;
  const open = arrow.startsWith('open-');
  const common: Record<string, string | number> = {
    fill: open ? 'white' : color,
    stroke: color,
    'stroke-width': 1.5,
  };
  let shape: DOMOutputSpec;
  if (arrow === 'triangle' || arrow === 'open-triangle') {
    shape = svgElement('path', { ...common, d: 'M 1 1 L 11 6 L 1 11 Z' });
  } else if (arrow === 'diamond' || arrow === 'open-diamond') {
    shape = svgElement('path', { ...common, d: 'M 1 6 L 6 1 L 11 6 L 6 11 Z' });
  } else if (arrow === 'circle' || arrow === 'open-circle') {
    shape = svgElement('circle', { ...common, cx: 6, cy: 6, r: 4.5 });
  } else if (arrow === 'square' || arrow === 'open-square') {
    shape = svgElement('rect', { ...common, height: 8, width: 8, x: 2, y: 2 });
  } else if (arrow === 'double-bar') {
    shape = svgElement('path', {
      d: 'M 7 1 L 7 11 M 11 1 L 11 11',
      fill: 'none',
      stroke: color,
      'stroke-width': 1.8,
    });
  } else {
    shape = svgElement('path', {
      d: 'M 10 1 L 10 11',
      fill: 'none',
      stroke: color,
      'stroke-width': 1.8,
    });
  }
  return svgElement(
    'marker',
    {
      id,
      markerHeight: 12,
      markerUnits: 'userSpaceOnUse',
      markerWidth: 14,
      orient: 'auto-start-reverse',
      refX: 11,
      refY: 6,
      viewBox: '-1 0 14 12',
    },
    shape,
  );
};

const renderRelationship = (
  item: MindMapFlowProjection['semanticGeometry']['relationships'][number],
  projection: Readonly<MindMapFlowProjection>,
  sheet: Readonly<MindMapSheet>,
  sheetIndex: number,
  relationshipIndex: number,
  budget: RenderAllocationBudget,
): { readonly bounds: readonly Readonly<Rect>[]; readonly spec?: DOMOutputSpec } => {
  if (item.visibility !== 'visible' || !item.path) return { bounds: [] };
  const visual = relationshipStyle(projection, item.entityId);
  const color = safeColor(visual?.stroke, '#64748b');
  const startMarkerId = safeMarkerId(sheetIndex, relationshipIndex, 'start');
  const endMarkerId = safeMarkerId(sheetIndex, relationshipIndex, 'end');
  const startMarker = arrowMarkerSpec(startMarkerId, item.startArrow, color);
  const endMarker = arrowMarkerSpec(endMarkerId, item.endArrow, color);
  const pathAttributes: Record<string, string | number> = {
    d: semanticPathToSvg(item.path),
    fill: 'none',
    opacity: clamp(visual?.opacity ?? 1, 0, 1),
    stroke: color,
    'stroke-width': clamp(visual?.strokeWidth ?? 2, 0, 32),
  };
  if (startMarker) pathAttributes['marker-start'] = `url(#${startMarkerId})`;
  if (endMarker) pathAttributes['marker-end'] = `url(#${endMarkerId})`;
  const dash = safeDashArray(visual?.strokeDasharray);
  if (dash) pathAttributes['stroke-dasharray'] = dash;
  const relationship = sheet.relationships[item.entityId];
  const labelText = relationship?.title ? mindMapRichTextToPlainText(relationship.title) : '';
  const labelFrame: Readonly<Rect> = {
    x: item.path.bounds.x,
    y: item.path.bounds.y + item.path.bounds.height / 2 - 16,
    width: Math.max(120, item.path.bounds.width),
    height: 32,
  };
  const label = labelText ? semanticLabelSpec(
    labelText,
    labelFrame,
    undefined,
    { centered: true, fallbackColor: '#475569' },
    budget,
  ) : undefined;
  return {
    bounds: [
      expandedRect(item.path.bounds, SEMANTIC_STROKE_PADDING),
      ...(label ? [label.bounds] : []),
    ],
    spec: svgElement(
      'g',
      { 'data-entity-id': item.entityId, 'data-semantic-kind': 'relationship' },
      ...((startMarker || endMarker)
        ? [svgElement('defs', {}, ...[startMarker, endMarker].filter(
            (candidate): candidate is DOMOutputSpec => candidate !== undefined,
          ))]
        : []),
      svgElement('path', pathAttributes),
      ...(label ? [label.spec] : []),
    ),
  };
};

const renderSemanticItem = (
  item: SemanticOverlayGeometry,
  projection: Readonly<MindMapFlowProjection>,
  sheet: Readonly<MindMapSheet>,
  sheetIndex: number,
  semanticIndex: number,
  budget: RenderAllocationBudget,
): { readonly bounds: readonly Readonly<Rect>[]; readonly spec?: DOMOutputSpec } => {
  switch (item.kind) {
    case 'zone': return renderZone(item, projection, sheet, budget);
    case 'boundary': return renderBoundary(item, projection, sheet, budget);
    case 'summary': return renderSummary(item, projection);
    case 'callout': return renderCallout(item, projection, sheet, budget);
    case 'relationship': return renderRelationship(
      item,
      projection,
      sheet,
      sheetIndex,
      semanticIndex,
      budget,
    );
  }
};

const resolvedColorValue = (
  document: Readonly<MindMapDocumentV1>,
  sheet: Readonly<MindMapSheet>,
  color: Readonly<ColorValue>,
  fallback: string,
): string => color.kind === 'literal'
  ? safeColor(color.value, fallback)
  : safeColor(
      typeof document.themes[sheet.themeId]?.tokens[color.token] === 'string'
        ? String(document.themes[sheet.themeId]?.tokens[color.token])
        : undefined,
      fallback,
    );

const sheetBackground = (
  document: Readonly<MindMapDocumentV1>,
  sheet: Readonly<MindMapSheet>,
  sheetIndex: number,
  imageUrls: Readonly<Record<string, string>>,
  frame: Readonly<Rect>,
  appearance: Readonly<FullMindMapSvgAppearance>,
  frameRadius: number,
): { readonly defs?: DOMOutputSpec; readonly fill: string; readonly image?: DOMOutputSpec } => {
  if (appearance.background.kind === 'transparent') return { fill: 'none' };
  if (appearance.background.kind === 'solid') {
    return { fill: appearance.background.color };
  }
  const background = sheet.canvas.background;
  if (background.kind === 'solid') {
    return { fill: resolvedColorValue(document, sheet, background.color, '#ffffff') };
  }
  if (background.kind === 'image') {
    const asset = document.assets[background.assetId];
    const url = imageUrls[background.assetId];
    if (!asset || !url) {
      throw new FullMindMapSvgExportError(
        'resource-unavailable',
        'A canvas image background is unavailable or failed integrity validation.',
      );
    }
    const paintId = `mindmap-full-sheet-image-${sheetIndex}`;
    if (background.fit === 'tile') {
      const tileWidth = clamp(asset.intrinsicSize?.width ?? 128, 1, 32_768);
      const tileHeight = clamp(asset.intrinsicSize?.height ?? 128, 1, 32_768);
      return {
        fill: `url(#${paintId})`,
        defs: svgElement(
          'defs',
          {},
          svgElement(
            'pattern',
            {
              height: tileHeight,
              id: paintId,
              patternUnits: 'userSpaceOnUse',
              width: tileWidth,
              x: frame.x,
              y: frame.y,
            },
            svgElement(`${SVG_NAMESPACE} image`, {
              'aria-hidden': 'true',
              focusable: 'false',
              height: tileHeight,
              href: url,
              preserveAspectRatio: 'none',
              width: tileWidth,
              x: 0,
              y: 0,
            }),
          ),
        ),
      };
    }
    const clipId = `${paintId}-clip`;
    return {
      fill: '#ffffff',
      defs: svgElement(
        'defs',
        {},
        svgElement(
          'clipPath',
          { id: clipId },
          svgElement('rect', {
            height: frame.height,
            rx: frameRadius,
            width: frame.width,
            x: frame.x,
            y: frame.y,
          }),
        ),
      ),
      image: svgElement(`${SVG_NAMESPACE} image`, {
        'aria-hidden': 'true',
        class: 'mindmap-full-sheet-background-image',
        'clip-path': `url(#${clipId})`,
        'data-canvas-background-fit': background.fit,
        focusable: 'false',
        height: frame.height,
        href: url,
        preserveAspectRatio: background.fit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet',
        width: frame.width,
        x: frame.x,
        y: frame.y,
      }),
    };
  }
  if (background.kind !== 'gradient') return { fill: '#ffffff' };
  const gradientId = `mindmap-full-sheet-gradient-${sheetIndex}`;
  const angle = finite(background.angle, 0) * Math.PI / 180;
  const dx = Math.cos(angle) * 50;
  const dy = Math.sin(angle) * 50;
  return {
    fill: `url(#${gradientId})`,
    defs: svgElement(
      'defs',
      {},
      svgElement(
        'linearGradient',
        {
          id: gradientId,
          x1: `${number(50 - dx)}%`,
          x2: `${number(50 + dx)}%`,
          y1: `${number(50 - dy)}%`,
          y2: `${number(50 + dy)}%`,
        },
        svgElement('stop', {
          offset: '0%',
          'stop-color': resolvedColorValue(document, sheet, background.from, '#ffffff'),
        }),
        svgElement('stop', {
          offset: '100%',
          'stop-color': resolvedColorValue(document, sheet, background.to, '#f8fafc'),
        }),
      ),
    ),
  };
};

const compileEquationRenders = async (
  document: Readonly<MindMapDocumentV1>,
  limits: Readonly<FullMindMapSvgLimits>,
  reservedElements: number,
  preexistingInlineSerializedBytes: number,
  signal: AbortSignal,
): Promise<EquationRenderCompilation> => {
  const equations = getMindMapSheetsInViewOrder(document).flatMap((sheet) => (
    Object.values(sheet.equations).sort(compareMindMapViewOrderedEntities)
  ));
  if (equations.length === 0) {
    return Object.freeze({
      fallbackCount: 0,
      policy: 'mathjax-svg-paths-v1' as const,
      renders: Object.freeze({}),
      vectorCount: 0,
    });
  }
  const vectorElementLimit = Math.max(
    0,
    Math.floor((limits.maxElements - reservedElements) * EQUATION_VECTOR_BUDGET_RATIO),
  );
  const vectorCharacterLimit = Math.max(
    0,
    Math.floor(
      (limits.maxSerializedBytes - preexistingInlineSerializedBytes) * EQUATION_VECTOR_BUDGET_RATIO,
    ),
  );
  let vectorElements = 0;
  let vectorCharacters = 0;
  let vectorCount = 0;
  let fallbackCount = 0;
  const renders: Record<string, EquationSvgRender> = {};
  for (const equation of equations) {
    throwIfAborted(signal);
    let render: EquationSvgRender;
    try {
      render = await renderMindMapEquationToSvg({ equation, signal });
    } catch (error) {
      if (signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
        throw error;
      }
      render = Object.freeze({ reason: 'renderer-unavailable', status: 'fallback' });
    }
    if (
      render.status === 'vector'
      && (
        vectorElements + render.elementCount > vectorElementLimit
        || vectorCharacters + render.pathDataCharacters > vectorCharacterLimit
      )
    ) {
      render = Object.freeze({ reason: 'output-budget', status: 'fallback' });
    }
    renders[equation.id] = render;
    if (render.status === 'vector') {
      vectorCount += 1;
      vectorElements += render.elementCount;
      vectorCharacters += render.pathDataCharacters;
    } else {
      fallbackCount += 1;
    }
  }
  const policy: FullMindMapSvgExport['equationPolicy'] = vectorCount === 0
    ? 'literal-fallback-v0'
    : fallbackCount === 0
      ? 'mathjax-svg-paths-v1'
      : 'mathjax-svg-paths-v1-with-fallback';
  return Object.freeze({
    fallbackCount,
    policy,
    renders: Object.freeze(renders),
    vectorCount,
  });
};

const renderSheetPlan = (
  document: Readonly<MindMapDocumentV1>,
  sheet: Readonly<MindMapSheet>,
  sheetIndex: number,
  imageUrls: Readonly<Record<string, string>>,
  equationRenders: Readonly<Record<string, EquationSvgRender>>,
  budget: RenderAllocationBudget,
): SheetRenderPlan => {
  throwIfAborted(budget.signal);
  const model = projectMindMapToRenderModel({
    document,
    activeSheetId: sheet.id,
    // Formal export always expands the complete canonical tree.
    collapsedTopicIds: [],
  });
  const expectedTopicCount = Object.keys(sheet.topics).length;
  const expectedTreeEdgeCount = Object.keys(sheet.treeEdges).length;
  if (!model || model.topics.length !== expectedTopicCount || model.treeEdges.length !== expectedTreeEdgeCount) {
    throw new FullMindMapSvgExportError(
      'projection-incomplete',
      `Sheet ${sheet.id} could not project every canonical Topic and TreeEdge.`,
    );
  }
  const baseProjection = buildMindMapFlowProjection(document, model);
  const contentLayouts = Object.freeze(Object.fromEntries(
    baseProjection.nodes.map((node) => [
      node.id,
      topicContentLayout(document, sheet, node, equationRenders, budget),
    ]),
  )) as Readonly<Record<string, TopicContentLayout>>;
  const minimumTopicSizes = Object.fromEntries(baseProjection.nodes
    .filter((node) => (
      contentLayouts[node.id].additionalHeight > 0
      || contentLayouts[node.id].additionalWidth > 0
    ))
    .map((node) => [node.id, {
      width: finite(node.width ?? 0, 0) + contentLayouts[node.id].additionalWidth,
      height: finite(node.height ?? 0, 0) + contentLayouts[node.id].additionalHeight,
    }]));
  const projection = Object.keys(minimumTopicSizes).length > 0
    ? buildMindMapFlowProjection(document, model, undefined, { minimumTopicSizes })
    : baseProjection;
  if (
    projection.nodes.length !== expectedTopicCount
    || projection.treeEdges.length !== expectedTreeEdgeCount
    || projection.coreLayout.topicOrder.length !== expectedTopicCount
  ) {
    throw new FullMindMapSvgExportError(
      'projection-incomplete',
      `Sheet ${sheet.id} renderer-neutral layout is incomplete.`,
    );
  }
  const canonicalImageIds = Object.keys(sheet.images);
  const projectedImageIds = new Set(
    projection.nodes.flatMap((node) => node.data.localImages.map((image) => String(image.id))),
  );
  if (
    projectedImageIds.size !== canonicalImageIds.length
    || canonicalImageIds.some((imageId) => !projectedImageIds.has(imageId))
  ) {
    throw new FullMindMapSvgExportError(
      'projection-incomplete',
      `Sheet ${sheet.id} could not project every canonical TopicImage.`,
    );
  }

  const bounds = emptyBounds();
  const zoneSpecs: DOMOutputSpec[] = [];
  const boundarySpecs: DOMOutputSpec[] = [];
  const summarySpecs: DOMOutputSpec[] = [];
  const calloutSpecs: DOMOutputSpec[] = [];
  const relationshipSpecs: DOMOutputSpec[] = [];
  if (projection.semanticGeometry.ordered.length !== (
    Object.keys(sheet.boundaries).length
    + Object.keys(sheet.summaries).length
    + Object.keys(sheet.callouts).length
    + Object.keys(sheet.zones).length
    + Object.keys(sheet.relationships).length
  )) {
    throw new FullMindMapSvgExportError(
      'projection-incomplete',
      `Sheet ${sheet.id} semantic geometry projection is incomplete.`,
    );
  }
  for (const [semanticIndex, item] of projection.semanticGeometry.ordered.entries()) {
    throwIfAborted(budget.signal);
    const rendered = renderSemanticItem(
      item,
      projection,
      sheet,
      sheetIndex,
      semanticIndex,
      budget,
    );
    for (const itemBounds of rendered.bounds) includeRect(bounds, itemBounds);
    if (!rendered.spec) {
      throw new FullMindMapSvgExportError(
        'projection-incomplete',
        `Semantic ${item.kind} ${item.entityId} has no complete renderer-neutral geometry.`,
      );
    }
    if (item.kind === 'zone') zoneSpecs.push(rendered.spec);
    else if (item.kind === 'boundary') boundarySpecs.push(rendered.spec);
    else if (item.kind === 'summary') summarySpecs.push(rendered.spec);
    else if (item.kind === 'callout') calloutSpecs.push(rendered.spec);
    else relationshipSpecs.push(rendered.spec);
  }

  const connectorSpecs = projection.treeEdges.map((edge) => {
    throwIfAborted(budget.signal);
    const layout = edge.data?.layout;
    if (!layout) {
      throw new FullMindMapSvgExportError(
        'projection-incomplete',
        `TreeEdge ${edge.id} is missing layout points.`,
      );
    }
    for (const point of layout.points) includePoint(bounds, point.x, point.y);
    return renderTreeConnector(edge);
  });
  const topicSpecs = projection.nodes.map((node, nodeIndex) => {
    const rendered = renderTopic(
      node,
      contentLayouts[node.id],
      imageUrls,
      `${sheetIndex}-${nodeIndex}`,
      budget,
    );
    includeRect(bounds, rendered.bounds);
    return rendered.spec;
  });
  const markerLegend = renderMarkerLegend(document, sheet, budget);
  if (markerLegend) includeRect(bounds, markerLegend.bounds);

  return Object.freeze({
    contentSpecs: Object.freeze([
      ...zoneSpecs,
      ...boundarySpecs,
      ...connectorSpecs,
      ...summarySpecs,
      ...topicSpecs,
      ...calloutSpecs,
      ...relationshipSpecs,
      ...(markerLegend ? [markerLegend.spec] : []),
    ]),
    projection,
    sheet,
    sourceBounds: boundsRect(bounds),
  });
};

const normalizedLimits = (
  requested: Partial<FullMindMapSvgLimits> | undefined,
): FullMindMapSvgLimits => {
  const defaults = FULL_MIND_MAP_SVG_LIMITS;
  const resolve = (key: keyof FullMindMapSvgLimits): number => {
    const candidate = requested?.[key];
    return candidate !== undefined && Number.isFinite(candidate) && candidate > 0
      ? Math.min(defaults[key], Math.floor(candidate))
      : defaults[key];
  };
  return {
    maxElements: resolve('maxElements'),
    maxEquations: resolve('maxEquations'),
    maxHeight: resolve('maxHeight'),
    maxImages: resolve('maxImages'),
    maxLinks: resolve('maxLinks'),
    maxSemanticElements: resolve('maxSemanticElements'),
    maxSerializedBytes: resolve('maxSerializedBytes'),
    maxSheets: resolve('maxSheets'),
    maxTextCodePoints: resolve('maxTextCodePoints'),
    maxTopics: resolve('maxTopics'),
    maxTreeEdges: resolve('maxTreeEdges'),
    maxWidth: resolve('maxWidth'),
  };
};

const assertLimit = (
  code: FullMindMapSvgExportLimitCode,
  actual: number,
  limit: number,
  label: string,
): void => {
  if (actual <= limit) return;
  throw new FullMindMapSvgExportError(
    code,
    `Mind-map SVG export ${label} (${actual}) exceeds the explicit safety limit (${limit}).`,
    { actual, limit },
  );
};

const codeMarkedRichText = (richText: Readonly<RichText>): string => {
  const parts: string[] = [];
  const visit = (blocks: readonly Readonly<RichText['blocks'][number]>[]): void => {
    for (const block of blocks) {
      if (block.type === 'paragraph') {
        for (const inline of block.children) {
          if (inline.type === 'text' && inline.marks?.some((mark) => mark.type === 'code')) {
            parts.push(inline.text);
          }
        }
      } else {
        for (const item of block.items) visit(item.children);
      }
    }
  };
  visit(richText.blocks);
  return parts.join('\n');
};

const documentCounts = (
  document: Readonly<MindMapDocumentV1>,
  includeCanvasBackground: boolean,
  includeSheetHeaders: boolean,
): {
  readonly equations: number;
  readonly fontUsages: readonly Readonly<MindMapStaticFontUsage>[];
  readonly images: number;
  readonly legendItems: number;
  readonly legends: number;
  readonly links: number;
  readonly markers: number;
  readonly semantics: number;
  readonly sheets: number;
  readonly textCodePoints: number;
  readonly topics: number;
  readonly treeEdges: number;
} => {
  let equations = 0;
  let images = 0;
  let legendItems = 0;
  let legends = 0;
  let links = 0;
  let markers = 0;
  let semantics = 0;
  let textCodePoints = 0;
  const fontUsages: MindMapStaticFontUsage[] = [];
  const includeFontUsage = (value: string | undefined, role: 'code' | 'text'): void => {
    if (value !== undefined && value !== '') fontUsages.push(Object.freeze({ role, text: value }));
  };
  const includeText = (value: string | undefined, visible = true): void => {
    if (value === undefined || value === '') return;
    textCodePoints += codePointLength(value);
    if (visible) includeFontUsage(value, 'text');
  };
  const includeRichText = (value: Readonly<RichText>): void => {
    includeText(mindMapRichTextToPlainText(value));
    includeFontUsage(codeMarkedRichText(value), 'code');
  };
  includeText(document.title, false);
  let topics = 0;
  let treeEdges = 0;
  const sheets = Object.values(document.sheets);
  for (const sheet of sheets) {
    topics += Object.keys(sheet.topics).length;
    treeEdges += Object.keys(sheet.treeEdges).length;
    images += Object.keys(sheet.images).length
      + (includeCanvasBackground && sheet.canvas.background.kind === 'image' ? 1 : 0);
    equations += Object.keys(sheet.equations).length;
    links += Object.keys(sheet.links).length;
    markers += Object.keys(sheet.markerInstances).length;
    if (sheet.markerLegend.visible) {
      legends += 1;
      const definitionIds = markerLegendDefinitionIds(document, sheet);
      legendItems += definitionIds.length;
      includeText(sheet.markerLegend.title?.trim() || '标记图例');
      for (const definitionId of definitionIds) {
        includeText(document.markerDefinitions[definitionId]?.name || 'Missing marker');
      }
      if (definitionIds.length === 0) includeText('暂无图例项目');
    }
    semantics += Object.keys(sheet.boundaries).length
      + Object.keys(sheet.summaries).length
      + Object.keys(sheet.callouts).length
      + Object.keys(sheet.zones).length
      + Object.keys(sheet.relationships).length;
    if (includeSheetHeaders) includeText(sheet.title);
    for (const topic of Object.values(sheet.topics)) {
      includeRichText(topic.title);
    }
    for (const marker of Object.values(sheet.markerInstances)) {
      includeText(document.markerDefinitions[marker.markerDefinitionId]?.name, false);
    }
    for (const image of Object.values(sheet.images)) {
      const asset = document.assets[image.assetId];
      includeText(
        image.alt?.trim() || asset?.fileName?.trim() || (
          image.role === 'sticker' ? 'Topic sticker' : 'Topic image'
        ),
        false,
      );
    }
    for (const boundary of Object.values(sheet.boundaries)) {
      if (boundary.title) {
        includeRichText(boundary.title);
      }
    }
    for (const callout of Object.values(sheet.callouts)) {
      includeRichText(callout.content);
    }
    for (const relationship of Object.values(sheet.relationships)) {
      if (relationship.title) {
        includeRichText(relationship.title);
      }
    }
    for (const zone of Object.values(sheet.zones)) {
      if (zone.title) includeRichText(zone.title);
    }
    for (const equation of Object.values(sheet.equations)) {
      includeText(`ƒ ${equation.source || 'Empty equation'}`);
      includeText(equation.alt, false);
    }
    for (const link of Object.values(sheet.links)) {
      includeText(link.title, false);
      if ('href' in link && (link.kind === 'web' || link.kind === 'email')) {
        includeText(link.href, false);
      }
      const presentation = linkPresentation(document, link);
      includeText(
        `${presentation.href ? EXTERNAL_LINK_PREFIX : INTERNAL_LINK_PREFIX} ${presentation.label}`,
      );
    }
  }
  return {
    equations,
    fontUsages: Object.freeze(fontUsages),
    images,
    legendItems,
    legends,
    links,
    markers,
    semantics,
    sheets: sheets.length,
    textCodePoints,
    topics,
    treeEdges,
  };
};

const unicodeByteLength = (value: string, attribute: boolean): number => {
  let bytes = 0;
  for (const character of value) {
    if (character === '&') {
      bytes += 5;
      continue;
    }
    if (character === '<') {
      bytes += 4;
      continue;
    }
    if (character === '>' && !attribute) {
      bytes += 4;
      continue;
    }
    if (character === '"' && attribute) {
      bytes += 6;
      continue;
    }
    const codePoint = character.codePointAt(0) ?? 0;
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return bytes;
};

const utf8ByteLength = (value: string): number => {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return bytes;
};

/** Re-checks the serializer's real UTF-8 output; the DOMOutputSpec budget is only preflight. */
export const assertFullMindMapSvgSerializedByteLength = (
  svg: string,
  maximumBytes = FULL_MIND_MAP_SVG_LIMITS.maxSerializedBytes,
): number => {
  const safeMaximum = Number.isFinite(maximumBytes) && maximumBytes > 0
    ? Math.min(FULL_MIND_MAP_SVG_LIMITS.maxSerializedBytes, Math.floor(maximumBytes))
    : FULL_MIND_MAP_SVG_LIMITS.maxSerializedBytes;
  const actual = utf8ByteLength(svg);
  assertLimit(
    'serialized-size-limit',
    actual,
    safeMaximum,
    'serialized UTF-8 size in bytes',
  );
  return actual;
};

const inspectSpecBudget = (spec: DOMOutputSpec): SpecBudget => {
  let elements = 0;
  let serializedBytes = 0;
  const visit = (candidate: DOMOutputSpec | string): void => {
    if (typeof candidate === 'string') {
      serializedBytes += unicodeByteLength(candidate, false);
      return;
    }
    if (!Array.isArray(candidate) || typeof candidate[0] !== 'string') return;
    elements += 1;
    const rawTag = candidate[0];
    const tagName = rawTag.includes(' ') ? rawTag.slice(rawTag.lastIndexOf(' ') + 1) : rawTag;
    // Conservative reserve covers namespace declarations and serializer-owned
    // whitespace/markup not represented directly in DOMOutputSpec.
    serializedBytes += 69 + tagName.length * 2;
    const attributes = candidate[1];
    const hasAttributes = attributes !== null
      && typeof attributes === 'object'
      && !Array.isArray(attributes);
    if (hasAttributes) {
      for (const [key, value] of Object.entries(attributes as Record<string, unknown>)) {
        serializedBytes += key.length + unicodeByteLength(String(value), true) + 4;
      }
    }
    const childStart = hasAttributes ? 2 : 1;
    for (const child of candidate.slice(childStart)) {
      if (typeof child === 'string' || Array.isArray(child)) visit(child as DOMOutputSpec | string);
    }
  };
  visit(spec);
  return { elements, serializedBytes };
};

const referencedVisualAssetsHaveBytes = (
  document: Readonly<MindMapDocumentV1>,
  imageUrls: Readonly<Record<string, string>>,
  includeCanvasBackground: boolean,
): void => {
  for (const sheet of Object.values(document.sheets)) {
    if (includeCanvasBackground && sheet.canvas.background.kind === 'image') {
      const asset = document.assets[sheet.canvas.background.assetId];
      if (!asset || !imageUrls[asset.id]) {
        throw new FullMindMapSvgExportError(
          'resource-unavailable',
          'A canvas image background is unavailable or failed integrity validation.',
        );
      }
    }
    for (const image of Object.values(sheet.images)) {
      const asset = document.assets[image.assetId];
      if (!asset) {
        throw new FullMindMapSvgExportError(
          'resource-unavailable',
          `TopicImage ${image.id} references a missing Asset.`,
        );
      }
      if (!imageUrls[asset.id]) {
        throw new FullMindMapSvgExportError(
          'resource-unavailable',
          `Image Asset ${asset.id} is unavailable or failed integrity validation.`,
        );
      }
    }
  }
};

/**
 * Builds a complete, script-free SVG from canonical content and the shared
 * renderer-neutral projection/layout pipeline. Unlike the atom preview, this
 * function never reads the mounted DOM/viewport and never silently truncates.
 */
export const createFullMindMapSvgExport = async (
  document: Readonly<MindMapDocumentV1>,
  options: CreateFullMindMapSvgExportOptions,
): Promise<FullMindMapSvgExport> => {
  throwIfAborted(options.signal);
  let scopedDocument: MindMapDocumentV1;
  try {
    scopedDocument = projectMindMapDocumentForStaticExport(document, options.scope);
  } catch (error) {
    if (error instanceof MindMapStaticExportScopeError) {
      throw new FullMindMapSvgExportError(
        'projection-incomplete',
        'The requested static-export scope is unavailable.',
      );
    }
    throw error;
  }
  const appearance = normalizedAppearance(options.appearance);
  const includeCanvasBackground = appearance.background.kind === 'source';
  const limits = normalizedLimits(options.limits);
  const counts = documentCounts(
    scopedDocument,
    includeCanvasBackground,
    appearance.frame === 'sheet-card',
  );
  assertLimit('sheet-limit', counts.sheets, limits.maxSheets, 'Sheet count');
  assertLimit('topic-limit', counts.topics, limits.maxTopics, 'Topic count');
  assertLimit('tree-edge-limit', counts.treeEdges, limits.maxTreeEdges, 'TreeEdge count');
  assertLimit('image-limit', counts.images, limits.maxImages, 'TopicImage count');
  assertLimit('equation-limit', counts.equations, limits.maxEquations, 'Equation count');
  assertLimit('link-limit', counts.links, limits.maxLinks, 'TopicLink count');
  assertLimit(
    'semantic-element-limit',
    counts.semantics,
    limits.maxSemanticElements,
    'semantic element count',
  );
  assertLimit('text-limit', counts.textCodePoints, limits.maxTextCodePoints, 'text code-point count');
  if (counts.sheets === 0 || counts.topics === 0) {
    throw new FullMindMapSvgExportError(
      'projection-incomplete',
      'A full mind-map SVG export requires at least one Sheet and one Topic.',
    );
  }
  const reservedElements = 4
    + counts.sheets * 12
    + counts.topics * 10
    + counts.treeEdges
    + counts.images * 5
    + counts.legends * 7
    + counts.legendItems * 7
    + counts.equations * 8
    + counts.links * 6
    + counts.markers * 7
    + counts.semantics * 10;
  assertLimit(
    'element-limit',
    reservedElements,
    limits.maxElements,
    'preflight non-text SVG element reserve',
  );
  let fontBundle;
  try {
    const fontLoader = options.loadStaticFontBundle
      ?? (await import('./staticFontBundle')).loadMindMapStaticFontBundle;
    fontBundle = await fontLoader({
      signal: options.signal,
      usages: counts.fontUsages,
    });
  } catch (error) {
    if (options.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
      throw error;
    }
    throw new FullMindMapSvgExportError(
      'resource-unavailable',
      error instanceof MindMapStaticFontError
        ? error.message
        : 'Pinned static fonts could not be prepared.',
      { cause: error },
    );
  }
  let exportFailed = false;
  try {
    assertLimit(
      'serialized-size-limit',
      fontBundle.embeddedSerializedBytes,
      limits.maxSerializedBytes,
      'embedded static font data',
    );
    const renderBudget: RenderAllocationBudget = {
      elementLimit: limits.maxElements,
      fontFamily: fontBundle.fontFamily,
      measureText: fontBundle.measureText,
      resolveFontFamily: fontBundle.resolveFontFamily,
      reservedElements,
      signal: options.signal,
      textElements: 0,
    };

    const verifiedResourceBytes = await resolveXMindExportResourceBytes({
      ...options,
      document: scopedDocument,
      additionalAssetIds: Object.values(scopedDocument.sheets).flatMap((sheet) => (
        includeCanvasBackground && sheet.canvas.background.kind === 'image'
          ? [sheet.canvas.background.assetId]
          : []
      )),
    });
    throwIfAborted(options.signal);
    const imageUrls = inlineImageUrls(scopedDocument, verifiedResourceBytes);
    referencedVisualAssetsHaveBytes(scopedDocument, imageUrls, includeCanvasBackground);
  let repeatedInlineImageBytes = 0;
  for (const sheet of Object.values(scopedDocument.sheets)) {
    if (includeCanvasBackground && sheet.canvas.background.kind === 'image') {
      repeatedInlineImageBytes += imageUrls[sheet.canvas.background.assetId]?.length ?? 0;
      assertLimit(
        'serialized-size-limit',
        repeatedInlineImageBytes,
        limits.maxSerializedBytes,
        'repeated inline image data',
      );
    }
    for (const image of Object.values(sheet.images)) {
      repeatedInlineImageBytes += imageUrls[image.assetId]?.length ?? 0;
      assertLimit(
        'serialized-size-limit',
        repeatedInlineImageBytes,
        limits.maxSerializedBytes,
        'repeated inline image data',
      );
    }
  }
  assertLimit(
    'serialized-size-limit',
    repeatedInlineImageBytes + fontBundle.embeddedSerializedBytes,
    limits.maxSerializedBytes,
    'embedded image and font data',
  );

  const equationCompilation = await compileEquationRenders(
    scopedDocument,
    limits,
    reservedElements,
    repeatedInlineImageBytes + fontBundle.embeddedSerializedBytes,
    options.signal,
  );
  throwIfAborted(options.signal);

  const plans = getMindMapSheetsInViewOrder(scopedDocument).map(
    (sheet, sheetIndex) => renderSheetPlan(
      scopedDocument,
      sheet,
      sheetIndex,
      imageUrls,
      equationCompilation.renders,
      renderBudget,
    ),
  );
  throwIfAborted(options.signal);

  const packed: PackedSheetPlan[] = [];
  const frameEnabled = appearance.frame === 'sheet-card';
  const frameRadius = frameEnabled ? 14 : 0;
  const headerHeight = frameEnabled ? SHEET_HEADER_HEIGHT : 0;
  const sheetGap = counts.sheets > 1 ? Math.max(8, appearance.padding) : 0;
  let nextY = 0;
  let maximumRight = 0;
  for (const plan of plans) {
    const titleWidth = fontBundle.measureText(
      normalizeXmlText(plan.sheet.title || 'Untitled sheet'),
      {
        fontFamily: MIND_MAP_STATIC_TEXT_STACK,
        fontSize: 16,
        fontWeight: 700,
      },
    );
    const contentWidth = plan.sourceBounds.width + appearance.padding * 2;
    const frameWidth = rounded(frameEnabled
      ? Math.max(320, contentWidth, titleWidth + appearance.padding * 2)
      : contentWidth);
    const frameHeight = rounded(
      headerHeight + plan.sourceBounds.height + appearance.padding * 2,
    );
    const frame: Readonly<Rect> = Object.freeze({
      x: 0,
      y: rounded(nextY),
      width: frameWidth,
      height: frameHeight,
    });
    const translateX = rounded(frame.x + appearance.padding - plan.sourceBounds.x);
    const translateY = rounded(
      frame.y + headerHeight + appearance.padding - plan.sourceBounds.y,
    );
    packed.push(Object.freeze({ ...plan, frame, translateX, translateY }));
    maximumRight = Math.max(maximumRight, frame.x + frame.width);
    nextY = frame.y + frame.height + sheetGap;
  }
  const width = Math.ceil(maximumRight);
  const height = Math.ceil(nextY - sheetGap);
  assertLimit('width-limit', width, limits.maxWidth, 'vector width');
  assertLimit('height-limit', height, limits.maxHeight, 'vector height');

  const sheetSpecs = packed.map((plan, sheetIndex) => {
    const background = sheetBackground(
      scopedDocument,
      plan.sheet,
      sheetIndex,
      imageUrls,
      plan.frame,
      appearance,
      frameRadius,
    );
    const title = normalizeXmlText(plan.sheet.title || 'Untitled sheet');
    return svgElement(
      'g',
      {
        class: 'mindmap-full-sheet',
        'data-sheet-id': plan.sheet.id,
        'data-sheet-source-height': plan.sourceBounds.height,
        'data-sheet-source-width': plan.sourceBounds.width,
        'data-sheet-source-x': plan.sourceBounds.x,
        'data-sheet-source-y': plan.sourceBounds.y,
        'data-sheet-translate-x': plan.translateX,
        'data-sheet-translate-y': plan.translateY,
        id: sheetFragmentId(plan.sheet.id),
      },
      ...(background.defs ? [background.defs] : []),
      svgElement('rect', {
        class: 'mindmap-full-sheet-background',
        fill: background.fill,
        height: plan.frame.height,
        rx: frameRadius,
        stroke: frameEnabled ? '#cbd5e1' : 'none',
        'stroke-width': frameEnabled ? 1 : 0,
        width: plan.frame.width,
        x: plan.frame.x,
        y: plan.frame.y,
      }),
      ...(background.image ? [background.image] : []),
      ...(frameEnabled ? [
        svgElement('text', {
          class: 'mindmap-full-sheet-title',
          fill: '#334155',
          'font-family': MIND_MAP_STATIC_TEXT_STACK,
          'font-size': 16,
          'font-weight': 700,
          x: plan.frame.x + appearance.padding,
          y: plan.frame.y + 30,
        }, title),
        svgElement('line', {
          stroke: '#e2e8f0',
          'stroke-width': 1,
          x1: plan.frame.x,
          x2: plan.frame.x + plan.frame.width,
          y1: plan.frame.y + SHEET_HEADER_HEIGHT,
          y2: plan.frame.y + SHEET_HEADER_HEIGHT,
        }),
      ] : []),
      svgElement(
        'g',
        {
          class: 'mindmap-full-sheet-content',
          transform: `translate(${number(plan.translateX)} ${number(plan.translateY)})`,
        },
        ...plan.contentSpecs,
      ),
    );
  });

  const spec = svgElement(
    `${SVG_NAMESPACE} svg`,
    {
      'aria-label': normalizeXmlText(scopedDocument.title || 'Mind map'),
      'data-mindmap-static-export': 'ready',
      'data-equation-count': counts.equations,
      'data-equation-fallback-count': equationCompilation.fallbackCount,
      'data-equation-vector-count': equationCompilation.vectorCount,
      'data-link-count': counts.links,
      'data-marker-legend-count': counts.legends,
      'data-marker-legend-item-count': counts.legendItems,
      'data-marker-count': counts.markers,
      'data-sheet-count': counts.sheets,
      'data-topic-count': counts.topics,
      'data-tree-edge-count': counts.treeEdges,
      'data-export-background': appearance.background.kind,
      'data-export-frame': appearance.frame,
      'data-export-padding': appearance.padding,
      'data-embedded-font-bytes': fontBundle.embeddedFontBytes,
      'data-font-face-count': fontBundle.faceCount,
      'data-font-policy': fontBundle.fontPolicy,
      'data-font-source-version': fontBundle.sourceVersion,
      'data-font-style-policy': 'explicit-skew-minus-12-v1',
      'data-equation-policy': equationCompilation.policy,
      'data-rich-text-policy': 'svg-runs-v1',
      'data-grapheme-policy': 'deterministic-emoji-v1',
      'data-text-transform-policy': 'ascii-v1',
      focusable: 'false',
      'font-family': MIND_MAP_STATIC_TEXT_STACK,
      'font-synthesis': 'none',
      height,
      preserveAspectRatio: 'xMinYMin meet',
      role: 'graphics-document',
      viewBox: `0 0 ${number(width)} ${number(height)}`,
      width,
      xmlns: SVG_NAMESPACE,
    },
    svgElement('title', {}, normalizeXmlText(scopedDocument.title || 'Mind map')),
    svgElement(
      'defs',
      { 'data-mindmap-static-font-definitions': 'true' },
      svgElement('style', { type: 'text/css' }, fontBundle.cssText),
    ),
    ...(appearance.background.kind === 'solid'
      ? [svgElement('rect', {
          class: 'mindmap-full-export-background',
          fill: appearance.background.color,
          height,
          width,
          x: 0,
          y: 0,
        })]
      : []),
    ...sheetSpecs,
  );
  const budget = inspectSpecBudget(spec);
  assertLimit('element-limit', budget.elements, limits.maxElements, 'SVG element count');
  assertLimit(
    'serialized-size-limit',
    budget.serializedBytes,
    limits.maxSerializedBytes,
    'estimated serialized size in bytes',
  );

  const exportBounds: Readonly<Rect> = Object.freeze({ x: 0, y: 0, width, height });
  return Object.freeze({
    bounds: exportBounds,
    elementCount: budget.elements,
    equationCount: counts.equations,
    equationFallbackCount: equationCompilation.fallbackCount,
    equationPolicy: equationCompilation.policy,
    equationVectorCount: equationCompilation.vectorCount,
    embeddedFontBytes: fontBundle.embeddedFontBytes,
    fontFaceCount: fontBundle.faceCount,
    fontPolicy: fontBundle.fontPolicy,
    fontSourceVersion: fontBundle.sourceVersion,
    estimatedSerializedBytes: budget.serializedBytes,
    height,
    imageCount: counts.images,
    linkCount: counts.links,
    markerCount: counts.markers,
    semanticElementCount: counts.semantics,
    serializedByteLimit: limits.maxSerializedBytes,
    sheetBounds: Object.freeze(packed.map((plan) => Object.freeze({
      bounds: plan.frame,
      sheetId: plan.sheet.id,
      sourceBounds: plan.sourceBounds,
      translateX: plan.translateX,
      translateY: plan.translateY,
    }))),
    sheetCount: counts.sheets,
    spec,
    status: 'ready' as const,
    topicCount: counts.topics,
    treeEdgeCount: counts.treeEdges,
    width,
  });
  } catch (error) {
    exportFailed = true;
    throw error;
  } finally {
    try {
      fontBundle.release();
    } catch (error) {
      // Never replace the real export failure with a best-effort cleanup error.
      if (!exportFailed) {
        throw new FullMindMapSvgExportError(
          'resource-unavailable',
          'Pinned static font resources could not be released.',
          { cause: error },
        );
      }
    }
  }
};
