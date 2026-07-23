import type { DOMOutputSpec } from '@tiptap/pm/model';

import { parseMindMapAttribute } from '../domain/persistence';
import { expandSemanticTopicScope } from '../domain/semanticScope';
import type {
  AssetId,
  MindMapDocumentV1,
  MindMapSheet,
  Rect,
  SheetId,
  TopicId,
} from '../domain/types';
import { inspectXMindRaster, XMIND_IMAGE_RESOURCE_MAX_BYTES } from '../io/xmindImages';
import {
  resolveXMindExportResourceBytes,
  type ResolveXMindExportResourceBytesInput,
} from '../io/xmindResourceResolver';
import { resolveSemanticStyle, type SemanticVisualStyle } from '../style/resolver';
import {
  buildTopicEnrichmentsProjection,
  type ImageEnrichmentProjection,
} from '../ui/enrichmentProjection';
import {
  isOrdinaryStackedTopicImage,
  measureMindMapTopicNode,
  measureTopicStickerLayout,
} from '../ui/projection';
import {
  collectSheetTopicTraversal,
  getMindMapSheetsInViewOrder,
} from '../view/ordering';
import { mindMapRichTextToPlainText } from '../view/text';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

export const MIND_MAP_STATIC_SVG_LIMITS = Object.freeze({
  maxHeight: 1_200,
  maxLayoutRows: 34,
  maxTopicDepth: 16,
  maxVisibleBoundaries: 16,
  maxVisibleSummaries: 16,
  maxVisibleTopics: 32,
  width: 960,
});

const ROW_HEIGHT = 30;
const FOOTER_HEIGHT = 34;
const HORIZONTAL_PADDING = 20;
const VERTICAL_PADDING = 18;
const TOPIC_INDENT = 23;
const TOPIC_CARD_BASE_HEIGHT = 24;
const TOPIC_CARD_TOP_INSET = 4;
const TOPIC_ROW_GAP = ROW_HEIGHT - TOPIC_CARD_BASE_HEIGHT;
const TOPIC_IMAGE_GAP = 8;
const TOPIC_IMAGE_INSET = TOPIC_IMAGE_GAP / 2;

type StaticSvgStatus = 'ready' | 'error';

export interface MindMapStaticSvgPreview {
  readonly height: number;
  readonly spec: DOMOutputSpec;
  readonly status: StaticSvgStatus;
  readonly totalBoundaryCount: number;
  readonly totalSummaryCount: number;
  readonly totalTopicCount: number;
  readonly visibleBoundaryCount: number;
  readonly visibleSummaryCount: number;
  readonly visibleTopicCount: number;
  readonly width: number;
}

export interface MindMapStaticSvgPreviewOptions {
  /**
   * AssetId-keyed bytes that have already passed canonical SHA-256 validation.
   * Raster signatures, MIME type, and declared byte length are rechecked before
   * any bytes are embedded into the SVG.
   */
  readonly verifiedResourceBytes?: Readonly<Record<string, Uint8Array>>;
}

export type MindMapPortableStaticSvgPreviewOptions = Omit<
  ResolveXMindExportResourceBytesInput,
  'document'
>;

interface StaticSvgRenderingOptions extends MindMapStaticSvgPreviewOptions {
  readonly allowRemoteImages: boolean;
}

interface SheetRow {
  readonly kind: 'sheet';
  readonly sheetId: SheetId;
  readonly title: string;
  readonly y: number;
}

interface TopicRow {
  readonly kind: 'topic';
  readonly sheetId: SheetId;
  readonly topicId: TopicId;
  readonly parentTopicId?: TopicId;
  readonly depth: number;
  readonly title: string;
  readonly images: readonly ImageEnrichmentProjection[];
  readonly cardHeight: number;
  readonly x: number;
  readonly y: number;
}

type PreviewRow = SheetRow | TopicRow;

const STATIC_BOUNDARY_SHAPES = [
  'rectangle',
  'rounded-rectangle',
  'capsule',
  'ellipse',
  'scallop',
  'wave',
  'tension',
  'bracket',
  'none',
] as const;

type StaticBoundaryShape = (typeof STATIC_BOUNDARY_SHAPES)[number];

interface StaticBoundaryPreview {
  readonly frame: Readonly<Rect>;
  readonly scopeTruncated: boolean;
  readonly shape: StaticBoundaryShape;
  readonly shapeFallback: boolean;
  readonly style: Readonly<SemanticVisualStyle>;
  readonly title?: string;
}

type StaticSummaryOrientation = 'left' | 'right' | 'top' | 'bottom';

interface StaticSummaryPreview {
  readonly orientation: StaticSummaryOrientation;
  readonly resultFrame: Readonly<Rect>;
  readonly scopeFrame: Readonly<Rect>;
  readonly scopeTruncated: boolean;
  readonly style: Readonly<SemanticVisualStyle>;
}

const svgElement = (
  tagName: string,
  attributes: Record<string, string | number>,
  ...children: Array<DOMOutputSpec | string>
): DOMOutputSpec => [tagName, attributes, ...children];

/**
 * Keep XML text nodes valid without interpreting document content as markup.
 * DOMOutputSpec serialization performs the final XML escaping for <, >, &, and
 * quotes. This pass only removes characters XML 1.0 cannot represent.
 */
const normalizeXmlText = (value: string): string => Array.from(value, (character) => {
  const codePoint = character.codePointAt(0) ?? 0;
  if (codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d) return ' ';
  if (
    (codePoint >= 0x20 && codePoint <= 0xd7ff)
    || (codePoint >= 0xe000 && codePoint <= 0xfffd)
    || (codePoint >= 0x10000 && codePoint <= 0x10ffff)
  ) return character;
  return '\ufffd';
}).join('').replace(/\s+/gu, ' ').trim();

const truncateText = (value: string, maxCodePoints: number): string => {
  const normalized = normalizeXmlText(value);
  const codePoints = Array.from(normalized);
  if (codePoints.length <= maxCodePoints) return normalized;
  return `${codePoints.slice(0, Math.max(1, maxCodePoints - 1)).join('')}\u2026`;
};

const topicTextLimit = (x: number): number => Math.max(
  8,
  Math.min(56, Math.floor((MIND_MAP_STATIC_SVG_LIMITS.width - x - 42) / 14)),
);

const topicRowKey = (sheetId: SheetId, topicId: TopicId): string => (
  `${sheetId}\u0000${topicId}`
);

const compareAscii = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum));

const svgNumber = (value: number): string => {
  const rounded = Math.round(value * 1_000) / 1_000;
  return String(Object.is(rounded, -0) ? 0 : rounded);
};

const safeHexColor = (value: string, fallback: string): string =>
  /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/iu.test(value) ? value : fallback;

const safeDashArray = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  const parts = value.split(/\s+/u);
  if (
    parts.length === 0
    || parts.length > 32
    || parts.some((part) => !/^\d+(?:\.\d+)?$/u.test(part))
  ) return undefined;
  return parts.map((part) => svgNumber(clamp(Number(part), 0, 10_000))).join(' ');
};

const SENSITIVE_REMOTE_IMAGE_QUERY_KEYS = new Set([
  'access_token',
  'apikey',
  'api_key',
  'authorization',
  'key-pair-id',
  'sig',
  'signature',
  'token',
  'x-amz-credential',
  'x-amz-security-token',
  'x-amz-signature',
  'x-goog-credential',
  'x-goog-signature',
]);

const STATIC_SAFE_IMAGE_MIME_TYPES = new Set([
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

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
      const value = (first << 16) | (second << 8) | third;
      chunk += BASE64_ALPHABET[(value >>> 18) & 0x3f]
        + BASE64_ALPHABET[(value >>> 12) & 0x3f]
        + (hasSecond ? BASE64_ALPHABET[(value >>> 6) & 0x3f] : '=')
        + (hasThird ? BASE64_ALPHABET[value & 0x3f] : '=');
    }
    chunks.push(chunk);
  }
  return chunks.join('');
};

const buildInlineImageUrls = (
  document: MindMapDocumentV1,
  resourceBytes: Readonly<Record<string, Uint8Array>> | undefined,
): Readonly<Record<string, string>> => {
  if (!resourceBytes) return {};
  const urls: Record<string, string> = {};
  for (const [candidateAssetId, candidate] of Object.entries(resourceBytes)) {
    const asset = document.assets[candidateAssetId as AssetId];
    if (
      !asset
      || !(candidate instanceof Uint8Array)
      || candidate.byteLength <= 0
      || candidate.byteLength > XMIND_IMAGE_RESOURCE_MAX_BYTES
      || candidate.byteLength !== asset.byteSize
    ) continue;
    const inspection = inspectXMindRaster(candidate);
    if (
      !inspection
      || inspection.mimeType !== asset.mimeType.toLowerCase()
      || !STATIC_SAFE_IMAGE_MIME_TYPES.has(inspection.mimeType)
    ) continue;
    urls[asset.id] = `data:${inspection.mimeType};base64,${encodeBase64(candidate)}`;
  }
  return Object.freeze(urls);
};

const safeRemoteImageUrl = (image: Readonly<ImageEnrichmentProjection>): string | undefined => {
  if (image.rendererSource.status !== 'ready') return undefined;
  if (!image.mimeType || !STATIC_SAFE_IMAGE_MIME_TYPES.has(image.mimeType.toLowerCase())) {
    return undefined;
  }
  try {
    const parsed = new URL(image.rendererSource.url);
    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
      || parsed.username.length > 0
      || parsed.password.length > 0
    ) return undefined;
    for (const key of parsed.searchParams.keys()) {
      if (SENSITIVE_REMOTE_IMAGE_QUERY_KEYS.has(key.toLowerCase())) return undefined;
    }
    return parsed.href;
  } catch {
    return undefined;
  }
};

const safeImageCrop = (crop: Readonly<Rect> | undefined): Readonly<Rect> | undefined => {
  if (!crop) return undefined;
  if (
    !Number.isFinite(crop.x)
    || !Number.isFinite(crop.y)
    || !Number.isFinite(crop.width)
    || !Number.isFinite(crop.height)
    || crop.x < 0
    || crop.y < 0
    || crop.width <= 0
    || crop.height <= 0
  ) return undefined;
  return crop;
};

const staticImageLabel = (image: Readonly<ImageEnrichmentProjection>): string => {
  const alt = image.alt?.trim();
  return truncateText(alt || 'Topic image', 160);
};

const staticTopicImageSpec = (
  image: Readonly<ImageEnrichmentProjection>,
  frame: Readonly<Rect>,
  inlineImageUrls: Readonly<Record<string, string>>,
  allowRemoteImages: boolean,
): DOMOutputSpec => {
  const label = staticImageLabel(image);
  const inlineUrl = inlineImageUrls[image.assetId];
  const safeUrl = inlineUrl ?? (allowRemoteImages ? safeRemoteImageUrl(image) : undefined);
  const crop = safeImageCrop(image.crop);
  const groupAttributes: Record<string, string | number> = {
    'aria-label': 'Topic image',
    class: safeUrl
      ? 'mindmap-static-topic-image mindmap-static-topic-image-ready'
      : 'mindmap-static-topic-image mindmap-static-topic-image-unavailable',
    'data-image-align': image.placement.align,
    'data-image-role': image.role,
    'data-image-side': image.placement.side,
    'data-image-size-source': image.displaySizeSource,
    'data-image-source': inlineUrl ? 'inline' : safeUrl ? 'remote' : 'unavailable',
    role: 'img',
  };
  if (crop) {
    groupAttributes['data-image-cropped'] = 'true';
    groupAttributes['data-image-crop-x'] = svgNumber(crop.x);
    groupAttributes['data-image-crop-y'] = svgNumber(crop.y);
    groupAttributes['data-image-crop-width'] = svgNumber(crop.width);
    groupAttributes['data-image-crop-height'] = svgNumber(crop.height);
  }

  if (!safeUrl) {
    groupAttributes['data-image-unavailable-reason'] = image.rendererSource.status === 'unavailable'
      ? image.rendererSource.reason
      : !image.mimeType || !STATIC_SAFE_IMAGE_MIME_TYPES.has(image.mimeType.toLowerCase())
        ? 'unsupported-mime-type'
        : 'unsafe-remote-url';
    const children: Array<DOMOutputSpec | string> = [
      svgElement('title', {}, label),
      svgElement('rect', {
        fill: '#f1f5f9',
        height: frame.height,
        rx: Math.min(6, frame.width / 4, frame.height / 4),
        stroke: '#94a3b8',
        'stroke-dasharray': '4 3',
        'stroke-width': 1,
        width: frame.width,
        x: frame.x,
        y: frame.y,
      }),
    ];
    if (frame.width >= 72 && frame.height >= 24) {
      children.push(svgElement('text', {
        fill: '#64748b',
        'font-family': 'system-ui, sans-serif',
        'font-size': 11,
        'text-anchor': 'middle',
        x: frame.x + frame.width / 2,
        y: frame.y + frame.height / 2 + 4,
      }, 'Image unavailable'));
    }
    return svgElement('g', groupAttributes, ...children);
  }

  const commonImageAttributes: Record<string, string | number> = {
    'aria-hidden': 'true',
    focusable: 'false',
    href: safeUrl,
  };
  const content = crop
    ? svgElement(
        `${SVG_NAMESPACE} svg`,
        {
          class: 'mindmap-static-topic-image-crop',
          height: frame.height,
          overflow: 'hidden',
          preserveAspectRatio: 'none',
          viewBox: `${svgNumber(crop.x)} ${svgNumber(crop.y)} ${svgNumber(crop.width)} ${svgNumber(crop.height)}`,
          width: frame.width,
          x: frame.x,
          y: frame.y,
        },
        svgElement(`${SVG_NAMESPACE} image`, {
          ...commonImageAttributes,
          height: image.intrinsicSize?.height ?? crop.y + crop.height,
          preserveAspectRatio: 'none',
          width: image.intrinsicSize?.width ?? crop.x + crop.width,
          x: 0,
          y: 0,
        }),
      )
    : svgElement(`${SVG_NAMESPACE} image`, {
        ...commonImageAttributes,
        height: frame.height,
        preserveAspectRatio: 'xMidYMid meet',
        width: frame.width,
        x: frame.x,
        y: frame.y,
      });

  return svgElement(
    'g',
    groupAttributes,
    svgElement('title', {}, label),
    content,
  );
};

const ordinaryImagesForSide = (
  row: Readonly<TopicRow>,
  side: 'top' | 'bottom',
): readonly ImageEnrichmentProjection[] => row.images.filter(
  (image) => isOrdinaryStackedTopicImage(image) && image.placement.side === side,
);

const stackedImageHeight = (images: readonly ImageEnrichmentProjection[]): number =>
  images.reduce((total, image) => total + image.displaySize.height + TOPIC_IMAGE_GAP, 0);

const alignedImageX = (
  image: Readonly<ImageEnrichmentProjection>,
  topicFrame: Readonly<Rect>,
): number => {
  const insetLeft = topicFrame.x + 16;
  const insetRight = topicFrame.x + topicFrame.width - 16;
  if (image.placement.align === 'start') return insetLeft + image.placement.offset.x;
  if (image.placement.align === 'end') {
    return insetRight - image.displaySize.width + image.placement.offset.x;
  }
  return topicFrame.x + (topicFrame.width - image.displaySize.width) / 2
    + image.placement.offset.x;
};

const stickerImagesForSide = (
  row: Readonly<TopicRow>,
  side: 'top' | 'bottom' | 'left' | 'right',
): readonly ImageEnrichmentProjection[] => row.images.filter(
  (image) => image.role === 'sticker' && image.placement.side === side,
);

const topicRowImageSpecs = (
  row: Readonly<TopicRow>,
  topicFrame: Readonly<Rect>,
  inlineImageUrls: Readonly<Record<string, string>>,
  allowRemoteImages: boolean,
): {
  readonly bottom: readonly DOMOutputSpec[];
  readonly stickers: readonly DOMOutputSpec[];
  readonly textY: number;
  readonly top: readonly DOMOutputSpec[];
} => {
  const topImages = ordinaryImagesForSide(row, 'top');
  const bottomImages = ordinaryImagesForSide(row, 'bottom');
  const specsFor = (
    images: readonly ImageEnrichmentProjection[],
    stackY: number,
  ): DOMOutputSpec[] => {
    let offsetY = 0;
    return images.map((image) => {
      const spec = staticTopicImageSpec(image, {
        x: alignedImageX(image, topicFrame),
        y: stackY + offsetY + TOPIC_IMAGE_INSET + image.placement.offset.y,
        width: image.displaySize.width,
        height: image.displaySize.height,
      }, inlineImageUrls, allowRemoteImages);
      offsetY += image.displaySize.height + TOPIC_IMAGE_GAP;
      return spec;
    });
  };
  const stickerLayout = measureTopicStickerLayout(row.images);
  const stickerSpecs: DOMOutputSpec[] = [];
  const topStickers = stickerImagesForSide(row, 'top');
  const bottomStickers = stickerImagesForSide(row, 'bottom');
  stickerSpecs.push(
    ...specsFor(topStickers, topicFrame.y),
    ...specsFor(
      bottomStickers,
      topicFrame.y + topicFrame.height - stickerLayout.bottomHeight,
    ),
  );
  const middleTop = topicFrame.y + stickerLayout.topHeight;
  const middleHeight = topicFrame.height
    - stickerLayout.topHeight
    - stickerLayout.bottomHeight;
  for (const side of ['left', 'right'] as const) {
    const images = stickerImagesForSide(row, side);
    const stackHeight = stackedImageHeight(images);
    let offsetY = Math.max(0, (middleHeight - stackHeight) / 2);
    for (const image of images) {
      stickerSpecs.push(staticTopicImageSpec(image, {
        x: side === 'left'
          ? topicFrame.x + TOPIC_IMAGE_INSET + image.placement.offset.x
          : topicFrame.x + topicFrame.width - image.displaySize.width
            - TOPIC_IMAGE_INSET + image.placement.offset.x,
        y: middleTop + offsetY + TOPIC_IMAGE_INSET + image.placement.offset.y,
        width: image.displaySize.width,
        height: image.displaySize.height,
      }, inlineImageUrls, allowRemoteImages));
      offsetY += image.displaySize.height + TOPIC_IMAGE_GAP;
    }
  }
  const topHeight = stackedImageHeight(topImages);
  const ordinaryTopY = topicFrame.y + stickerLayout.topHeight;
  const textY = ordinaryTopY + topHeight + 16;
  return {
    top: specsFor(topImages, ordinaryTopY),
    textY,
    bottom: specsFor(bottomImages, ordinaryTopY + topHeight + TOPIC_CARD_BASE_HEIGHT),
    stickers: stickerSpecs,
  };
};

const topicRowRect = (row: TopicRow, width: number): Readonly<Rect> => ({
  height: row.cardHeight,
  width: Math.max(
    120,
    width - row.x - HORIZONTAL_PADDING,
    row.images
      .filter(isOrdinaryStackedTopicImage)
      .reduce((maximum, image) => Math.max(maximum, image.displaySize.width + 32), 0),
  ),
  x: row.x,
  y: row.y + TOPIC_CARD_TOP_INSET,
});

const staticContentWidth = (rows: readonly TopicRow[], minimumWidth: number): number =>
  rows.reduce((requiredWidth, row) => {
    const imageWidth = row.images
      .filter(isOrdinaryStackedTopicImage)
      .reduce((maximum, image) => Math.max(maximum, image.displaySize.width + 32), 0);
    return Math.max(requiredWidth, row.x + imageWidth + HORIZONTAL_PADDING);
  }, minimumWidth);

const unionRects = (rects: readonly Readonly<Rect>[]): Readonly<Rect> | undefined => {
  if (rects.length === 0) return undefined;
  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
};

const resolveStaticBoundaryShape = (
  requested: string | undefined,
): { readonly shape: StaticBoundaryShape; readonly fallback: boolean } => {
  if (requested === undefined) return { shape: 'rounded-rectangle', fallback: false };
  if ((STATIC_BOUNDARY_SHAPES as readonly string[]).includes(requested)) {
    return { shape: requested as StaticBoundaryShape, fallback: false };
  }
  return { shape: 'rounded-rectangle', fallback: true };
};

const customBoundaryPath = (
  frame: Readonly<Rect>,
  shape: Extract<StaticBoundaryShape, 'scallop' | 'wave' | 'tension' | 'bracket'>,
): string => {
  const { x, y, width, height } = frame;
  const right = x + width;
  const bottom = y + height;
  const dx = Math.max(4, width / 8);
  const dy = Math.max(4, height / 6);
  const n = svgNumber;
  if (shape === 'scallop') {
    return `M ${n(x)} ${n(y)} Q ${n(x + dx / 2)} ${n(y - dy)} ${n(x + dx)} ${n(y)} Q ${n(x + width / 2)} ${n(y - dy)} ${n(right - dx)} ${n(y)} Q ${n(right + dx / 2)} ${n(y)} ${n(right)} ${n(y + dy)} Q ${n(right + dx)} ${n(y + height / 2)} ${n(right)} ${n(bottom - dy)} Q ${n(right)} ${n(bottom + dy)} ${n(right - dx)} ${n(bottom)} Q ${n(x + width / 2)} ${n(bottom + dy)} ${n(x + dx)} ${n(bottom)} Q ${n(x - dx / 2)} ${n(bottom)} ${n(x)} ${n(bottom - dy)} Q ${n(x - dx)} ${n(y + height / 2)} ${n(x)} ${n(y + dy)} Z`;
  }
  if (shape === 'wave') {
    return `M ${n(x)} ${n(y + dy)} C ${n(x + width * 0.25)} ${n(y - dy)} ${n(x + width * 0.25)} ${n(y + dy)} ${n(x + width * 0.5)} ${n(y)} C ${n(x + width * 0.75)} ${n(y - dy)} ${n(x + width * 0.75)} ${n(y + dy)} ${n(right)} ${n(y)} L ${n(right)} ${n(bottom - dy)} C ${n(x + width * 0.75)} ${n(bottom + dy)} ${n(x + width * 0.75)} ${n(bottom - dy)} ${n(x + width * 0.5)} ${n(bottom)} C ${n(x + width * 0.25)} ${n(bottom + dy)} ${n(x + width * 0.25)} ${n(bottom - dy)} ${n(x)} ${n(bottom)} Z`;
  }
  if (shape === 'tension') {
    return `M ${n(x + dx)} ${n(y)} Q ${n(x)} ${n(y)} ${n(x)} ${n(y + dy)} Q ${n(x + dx)} ${n(y + height / 2)} ${n(x)} ${n(bottom - dy)} Q ${n(x)} ${n(bottom)} ${n(x + dx)} ${n(bottom)} Q ${n(x + width / 2)} ${n(bottom - dy)} ${n(right - dx)} ${n(bottom)} Q ${n(right)} ${n(bottom)} ${n(right)} ${n(bottom - dy)} Q ${n(right - dx)} ${n(y + height / 2)} ${n(right)} ${n(y + dy)} Q ${n(right)} ${n(y)} ${n(right - dx)} ${n(y)} Q ${n(x + width / 2)} ${n(y + dy)} ${n(x + dx)} ${n(y)} Z`;
  }
  return `M ${n(x + dx)} ${n(y)} H ${n(x)} V ${n(bottom)} H ${n(x + dx)} M ${n(right - dx)} ${n(y)} H ${n(right)} V ${n(bottom)} H ${n(right - dx)}`;
};

const boundaryOutlineSpec = (preview: StaticBoundaryPreview): DOMOutputSpec | undefined => {
  const { frame, shape, style } = preview;
  if (shape === 'none') return undefined;
  const common: Record<string, string | number> = {
    fill: shape === 'bracket' ? 'none' : safeHexColor(style.fill, '#EFF6FF'),
    'fill-opacity': clamp(style.fillOpacity, 0, 1),
    stroke: safeHexColor(style.stroke, '#60A5FA'),
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'stroke-width': clamp(style.strokeWidth, 0, 32),
    'vector-effect': 'non-scaling-stroke',
  };
  const dash = safeDashArray(style.strokeDasharray);
  if (dash !== undefined) common['stroke-dasharray'] = dash;

  if (shape === 'ellipse') {
    return svgElement('ellipse', {
      ...common,
      cx: frame.x + frame.width / 2,
      cy: frame.y + frame.height / 2,
      rx: frame.width / 2,
      ry: frame.height / 2,
    });
  }
  if (shape === 'scallop' || shape === 'wave' || shape === 'tension' || shape === 'bracket') {
    return svgElement('path', { ...common, d: customBoundaryPath(frame, shape) });
  }
  const rx = shape === 'capsule'
    ? Math.min(frame.width, frame.height) / 2
    : shape === 'rounded-rectangle'
      ? clamp(style.borderRadius, 0, Math.min(frame.width, frame.height) / 2)
      : 0;
  return svgElement('rect', {
    ...common,
    height: frame.height,
    rx,
    width: frame.width,
    x: frame.x,
    y: frame.y,
  });
};

const boundarySpec = (preview: StaticBoundaryPreview): DOMOutputSpec => {
  const outline = boundaryOutlineSpec(preview);
  const groupAttributes: Record<string, string | number> = {
    class: 'mindmap-static-boundary',
    'data-boundary-shape': preview.shape,
    opacity: clamp(preview.style.opacity, 0, 1),
  };
  if (preview.shapeFallback) {
    groupAttributes['data-boundary-shape-fallback'] = 'unsupported-to-rounded-rectangle';
  }
  if (preview.scopeTruncated) groupAttributes['data-boundary-scope-truncated'] = 'true';

  const children: DOMOutputSpec[] = [];
  if (outline) children.push(outline);
  if (preview.title) {
    children.push(svgElement('text', {
      fill: safeHexColor(preview.style.color, '#1D4ED8'),
      'font-family': 'system-ui, sans-serif',
      'font-size': clamp(preview.style.fontSize ?? 12, 8, 32),
      'font-style': preview.style.fontStyle === 'italic' ? 'italic' : 'normal',
      'font-weight': clamp(preview.style.fontWeight ?? 600, 100, 900),
      x: preview.frame.x + 10,
      y: preview.frame.y + 16,
    }, preview.title));
  }
  return svgElement('g', groupAttributes, ...children);
};

const summaryPathGeometry = (
  preview: StaticSummaryPreview,
): { readonly bracket: string; readonly connector: string } => {
  const { orientation, resultFrame, scopeFrame } = preview;
  const n = svgNumber;
  const scopeLeft = scopeFrame.x;
  const scopeRight = scopeFrame.x + scopeFrame.width;
  const scopeTop = scopeFrame.y;
  const scopeBottom = scopeFrame.y + scopeFrame.height;
  const scopeCenterX = scopeLeft + scopeFrame.width / 2;
  const scopeCenterY = scopeTop + scopeFrame.height / 2;
  const resultLeft = resultFrame.x;
  const resultRight = resultFrame.x + resultFrame.width;
  const resultTop = resultFrame.y;
  const resultBottom = resultFrame.y + resultFrame.height;
  const resultCenterX = resultLeft + resultFrame.width / 2;
  const resultCenterY = resultTop + resultFrame.height / 2;
  const tick = 9;
  const gap = 6;

  if (orientation === 'left') {
    const x = scopeLeft - gap;
    return {
      bracket: `M ${n(x + tick)} ${n(scopeTop)} H ${n(x)} V ${n(scopeBottom)} H ${n(x + tick)}`,
      connector: `M ${n(x)} ${n(scopeCenterY)} H ${n(x - gap)} L ${n(resultRight)} ${n(resultCenterY)}`,
    };
  }
  if (orientation === 'top') {
    const y = scopeTop - gap;
    return {
      bracket: `M ${n(scopeLeft)} ${n(y + tick)} V ${n(y)} H ${n(scopeRight)} V ${n(y + tick)}`,
      connector: `M ${n(scopeCenterX)} ${n(y)} V ${n(y - gap)} L ${n(resultCenterX)} ${n(resultBottom)}`,
    };
  }
  if (orientation === 'bottom') {
    const y = scopeBottom + gap;
    return {
      bracket: `M ${n(scopeLeft)} ${n(y - tick)} V ${n(y)} H ${n(scopeRight)} V ${n(y - tick)}`,
      connector: `M ${n(scopeCenterX)} ${n(y)} V ${n(y + gap)} L ${n(resultCenterX)} ${n(resultTop)}`,
    };
  }
  const x = scopeRight + gap;
  return {
    bracket: `M ${n(x - tick)} ${n(scopeTop)} H ${n(x)} V ${n(scopeBottom)} H ${n(x - tick)}`,
    connector: `M ${n(x)} ${n(scopeCenterY)} H ${n(x + gap)} L ${n(resultLeft)} ${n(resultCenterY)}`,
  };
};

const summarySpec = (preview: StaticSummaryPreview): DOMOutputSpec => {
  const geometry = summaryPathGeometry(preview);
  const common: Record<string, string | number> = {
    fill: 'none',
    stroke: safeHexColor(preview.style.stroke, '#2563EB'),
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'stroke-width': clamp(preview.style.strokeWidth, 0, 32),
    'vector-effect': 'non-scaling-stroke',
  };
  const dash = safeDashArray(preview.style.strokeDasharray);
  if (dash !== undefined) common['stroke-dasharray'] = dash;
  const groupAttributes: Record<string, string | number> = {
    class: 'mindmap-static-summary',
    'data-summary-orientation': preview.orientation,
    opacity: clamp(preview.style.opacity, 0, 1),
  };
  if (preview.scopeTruncated) groupAttributes['data-summary-scope-truncated'] = 'true';
  return svgElement(
    'g',
    groupAttributes,
    svgElement('path', { ...common, 'data-summary-part': 'bracket', d: geometry.bracket }),
    svgElement('path', { ...common, 'data-summary-part': 'connector', d: geometry.connector }),
  );
};

const collectBoundaryPreviews = (
  document: MindMapDocumentV1,
  topicRows: readonly TopicRow[],
  width: number,
): {
  readonly previews: readonly StaticBoundaryPreview[];
  readonly totalBoundaryCount: number;
} => {
  const sheets = getMindMapSheetsInViewOrder(document);
  const totalBoundaryCount = sheets.reduce(
    (count, sheet) => count + Object.keys(sheet.boundaries).length,
    0,
  );
  const rowsByTopic = new Map(
    topicRows.map((row) => [topicRowKey(row.sheetId, row.topicId), row] as const),
  );
  const previews: StaticBoundaryPreview[] = [];

  const addSheetBoundaries = (sheet: MindMapSheet): void => {
    for (const boundary of Object.values(sheet.boundaries)
      .sort((left, right) => compareAscii(left.id, right.id))) {
      if (previews.length >= MIND_MAP_STATIC_SVG_LIMITS.maxVisibleBoundaries) return;
      const memberTopicIds = expandSemanticTopicScope(sheet, boundary.scope);
      const memberRows = memberTopicIds.flatMap((topicId) => {
        const row = rowsByTopic.get(topicRowKey(sheet.id, topicId));
        return row ? [row] : [];
      });
      const memberBounds = unionRects(memberRows.map((row) => topicRowRect(row, width)));
      if (!memberBounds) continue;
      const frame: Readonly<Rect> = {
        x: memberBounds.x - boundary.padding,
        y: memberBounds.y - boundary.padding,
        width: memberBounds.width + boundary.padding * 2,
        height: memberBounds.height + boundary.padding * 2,
      };
      const style = resolveSemanticStyle({
        document,
        themeId: sheet.themeId,
        scope: 'boundary',
        binding: boundary.style,
        structure: sheet.defaultBranchLayout.structure,
      }).visual;
      const resolvedShape = resolveStaticBoundaryShape(style.shape);
      const title = boundary.title
        ? truncateText(mindMapRichTextToPlainText(boundary.title), 48)
        : '';
      previews.push({
        frame,
        scopeTruncated: memberRows.length < memberTopicIds.length,
        shape: resolvedShape.shape,
        shapeFallback: resolvedShape.fallback,
        style,
        ...(title ? { title } : {}),
      });
    }
  };

  for (const sheet of sheets) {
    addSheetBoundaries(sheet);
    if (previews.length >= MIND_MAP_STATIC_SVG_LIMITS.maxVisibleBoundaries) break;
  }
  return { previews, totalBoundaryCount };
};

const defaultSummaryOrientation = (sheet: MindMapSheet): StaticSummaryOrientation => {
  switch (sheet.defaultBranchLayout.direction) {
    case 'right-to-left': return 'left';
    case 'top-to-bottom': return 'bottom';
    case 'bottom-to-top': return 'top';
    default: return 'right';
  }
};

const collectSummaryPreviews = (
  document: MindMapDocumentV1,
  topicRows: readonly TopicRow[],
  width: number,
): {
  readonly previews: readonly StaticSummaryPreview[];
  readonly totalSummaryCount: number;
} => {
  const sheets = getMindMapSheetsInViewOrder(document);
  const totalSummaryCount = sheets.reduce(
    (count, sheet) => count + Object.keys(sheet.summaries).length,
    0,
  );
  const rowsByTopic = new Map(
    topicRows.map((row) => [topicRowKey(row.sheetId, row.topicId), row] as const),
  );
  const previews: StaticSummaryPreview[] = [];

  for (const sheet of sheets) {
    for (const summary of Object.values(sheet.summaries)
      .sort((left, right) => compareAscii(left.id, right.id))) {
      if (previews.length >= MIND_MAP_STATIC_SVG_LIMITS.maxVisibleSummaries) break;
      const memberTopicIds = expandSemanticTopicScope(sheet, summary.scope);
      const memberRows = memberTopicIds.flatMap((topicId) => {
        const row = rowsByTopic.get(topicRowKey(sheet.id, topicId));
        return row ? [row] : [];
      });
      const resultRow = rowsByTopic.get(topicRowKey(sheet.id, summary.resultTopicId));
      const memberBounds = unionRects(memberRows.map((row) => topicRowRect(row, width)));
      if (!memberBounds || !resultRow) continue;
      const style = resolveSemanticStyle({
        document,
        themeId: sheet.themeId,
        scope: 'summary',
        binding: summary.style,
        structure: sheet.defaultBranchLayout.structure,
      }).visual;
      previews.push({
        orientation: summary.orientation === 'auto'
          ? defaultSummaryOrientation(sheet)
          : summary.orientation,
        resultFrame: topicRowRect(resultRow, width),
        scopeFrame: memberBounds,
        scopeTruncated: memberRows.length < memberTopicIds.length,
        style,
      });
    }
    if (previews.length >= MIND_MAP_STATIC_SVG_LIMITS.maxVisibleSummaries) break;
  }
  return { previews, totalSummaryCount };
};

const collectPreviewRows = (document: MindMapDocumentV1): {
  contentHeight: number;
  rows: PreviewRow[];
  totalTopicCount: number;
  visibleTopicCount: number;
} => {
  const sheets = getMindMapSheetsInViewOrder(document);
  const totalTopicCount = sheets.reduce(
    (count, sheet) => count + Object.keys(sheet.topics).length,
    0,
  );
  const rows: PreviewRow[] = [];
  let visibleTopicCount = 0;
  let contentHeight = 0;
  let layoutFull = false;
  const maximumContentHeight = MIND_MAP_STATIC_SVG_LIMITS.maxHeight
    - VERTICAL_PADDING * 2
    - FOOTER_HEIGHT;
  const canAppendRow = (layoutHeight: number): boolean =>
    rows.length < MIND_MAP_STATIC_SVG_LIMITS.maxLayoutRows
      && contentHeight + layoutHeight <= maximumContentHeight;

  for (const sheet of sheets) {
    if (!canAppendRow(ROW_HEIGHT)) break;
    rows.push({
      kind: 'sheet',
      sheetId: sheet.id,
      title: truncateText(sheet.title || '未命名画布', 64),
      y: VERTICAL_PADDING + contentHeight,
    });
    contentHeight += ROW_HEIGHT;
    const enrichments = buildTopicEnrichmentsProjection({
      document,
      sheetId: sheet.id,
    });

    for (const entry of collectSheetTopicTraversal(sheet)) {
      if (
        rows.length >= MIND_MAP_STATIC_SVG_LIMITS.maxLayoutRows
        || visibleTopicCount >= MIND_MAP_STATIC_SVG_LIMITS.maxVisibleTopics
      ) {
        layoutFull = true;
        break;
      }
      const x = HORIZONTAL_PADDING + Math.min(
        entry.depth,
        MIND_MAP_STATIC_SVG_LIMITS.maxTopicDepth,
      ) * TOPIC_INDENT;
      const images = enrichments.byTopicId[entry.topic.id]?.images ?? [];
      const baseMeasurement = measureMindMapTopicNode(entry.topic);
      const enrichedMeasurement = measureMindMapTopicNode(entry.topic, images);
      const cardHeight = TOPIC_CARD_BASE_HEIGHT + Math.max(
        0,
        enrichedMeasurement.height - baseMeasurement.height,
      );
      const layoutHeight = cardHeight + TOPIC_ROW_GAP;
      if (!canAppendRow(layoutHeight) && visibleTopicCount > 0) {
        layoutFull = true;
        break;
      }
      rows.push({
        kind: 'topic',
        sheetId: sheet.id,
        topicId: entry.topic.id,
        ...(entry.parentTopicId ? { parentTopicId: entry.parentTopicId } : {}),
        depth: entry.depth,
        images,
        cardHeight,
        title: truncateText(
          mindMapRichTextToPlainText(entry.topic.title) || '未命名主题',
          topicTextLimit(x),
        ),
        x,
        y: VERTICAL_PADDING + contentHeight,
      });
      contentHeight += layoutHeight;
      visibleTopicCount += 1;
    }

    if (
      layoutFull
      || rows.length >= MIND_MAP_STATIC_SVG_LIMITS.maxLayoutRows
      || visibleTopicCount >= MIND_MAP_STATIC_SVG_LIMITS.maxVisibleTopics
    ) break;
  }

  return { contentHeight, rows, totalTopicCount, visibleTopicCount };
};

const createErrorPreview = (): MindMapStaticSvgPreview => {
  const width = MIND_MAP_STATIC_SVG_LIMITS.width;
  const height = 136;
  return {
    height,
    spec: svgElement(
      `${SVG_NAMESPACE} svg`,
      {
        'aria-label': '思维导图无法预览',
        'data-mindmap-static-preview': 'error',
        focusable: 'false',
        height,
        preserveAspectRatio: 'xMinYMin meet',
        role: 'img',
        viewBox: `0 0 ${width} ${height}`,
        width: '100%',
        xmlns: SVG_NAMESPACE,
      },
      svgElement('title', {}, '思维导图无法预览'),
      svgElement('rect', {
        fill: '#f8fafc',
        height: height - 2,
        rx: 12,
        stroke: '#cbd5e1',
        width: width - 2,
        x: 1,
        y: 1,
      }),
      svgElement('text', {
        fill: '#475569',
        'font-family': 'system-ui, sans-serif',
        'font-size': 18,
        'font-weight': 600,
        x: 32,
        y: 76,
      }, '思维导图无法预览'),
    ),
    status: 'error',
    totalBoundaryCount: 0,
    totalSummaryCount: 0,
    totalTopicCount: 0,
    visibleBoundaryCount: 0,
    visibleSummaryCount: 0,
    visibleTopicCount: 0,
    width,
  };
};

const createReadyPreview = (
  document: MindMapDocumentV1,
  options: StaticSvgRenderingOptions,
): MindMapStaticSvgPreview => {
  const {
    contentHeight,
    rows,
    totalTopicCount,
    visibleTopicCount,
  } = collectPreviewRows(document);
  const omittedTopicCount = Math.max(0, totalTopicCount - visibleTopicCount);
  const width = MIND_MAP_STATIC_SVG_LIMITS.width;
  const topicRows = rows.filter((row): row is TopicRow => row.kind === 'topic');
  const viewBoxWidth = staticContentWidth(topicRows, width);
  const { previews: boundaryPreviews, totalBoundaryCount } = collectBoundaryPreviews(
    document,
    topicRows,
    viewBoxWidth,
  );
  const visibleBoundaryCount = boundaryPreviews.length;
  const omittedBoundaryCount = Math.max(0, totalBoundaryCount - visibleBoundaryCount);
  const { previews: summaryPreviews, totalSummaryCount } = collectSummaryPreviews(
    document,
    topicRows,
    viewBoxWidth,
  );
  const visibleSummaryCount = summaryPreviews.length;
  const omittedSummaryCount = Math.max(0, totalSummaryCount - visibleSummaryCount);
  const isTruncated = omittedTopicCount > 0
    || omittedBoundaryCount > 0
    || omittedSummaryCount > 0;
  const rawHeight = VERTICAL_PADDING * 2
    + contentHeight
    + (isTruncated ? FOOTER_HEIGHT : 0);
  const viewBoxHeight = Math.max(136, rawHeight);
  const height = Math.min(
    MIND_MAP_STATIC_SVG_LIMITS.maxHeight,
    viewBoxHeight,
  );
  const topicPositions = new Map(
    topicRows.map((row) => [topicRowKey(row.sheetId, row.topicId), row]),
  );
  const boundarySpecs = boundaryPreviews.map(boundarySpec);
  const summarySpecs = summaryPreviews.map(summarySpec);
  const inlineImageUrls = buildInlineImageUrls(document, options.verifiedResourceBytes);

  const connectors: DOMOutputSpec[] = [];
  for (const row of topicRows) {
    if (!row.parentTopicId) continue;
    const parent = topicPositions.get(topicRowKey(row.sheetId, row.parentTopicId));
    if (!parent) continue;
    const parentRect = topicRowRect(parent, viewBoxWidth);
    const childRect = topicRowRect(row, viewBoxWidth);
    const childX = row.x;
    const guideX = Math.max(parent.x + 8, childX - 11);
    const parentY = parentRect.y + parentRect.height / 2;
    const childY = childRect.y + childRect.height / 2;
    connectors.push(svgElement('path', {
      d: `M ${parent.x + 8} ${parentY} H ${guideX} V ${childY} H ${childX}`,
      fill: 'none',
      stroke: '#94a3b8',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'stroke-width': 1.5,
      'vector-effect': 'non-scaling-stroke',
    }));
  }

  const rowSpecs: DOMOutputSpec[] = [];
  for (const row of rows) {
    if (row.kind === 'sheet') {
      rowSpecs.push(
        svgElement('line', {
          stroke: '#cbd5e1',
          'stroke-width': 1,
          x1: HORIZONTAL_PADDING,
          x2: viewBoxWidth - HORIZONTAL_PADDING,
          y1: row.y + 27,
          y2: row.y + 27,
        }),
        svgElement('text', {
          fill: '#334155',
          'font-family': 'system-ui, sans-serif',
          'font-size': 13,
          'font-weight': 700,
          x: HORIZONTAL_PADDING,
          y: row.y + 19,
        }, row.title),
      );
      continue;
    }

    const isRoot = row.depth === 0;
    const rowRect = topicRowRect(row, viewBoxWidth);
    const imageSpecs = topicRowImageSpecs(
      row,
      rowRect,
      inlineImageUrls,
      options.allowRemoteImages,
    );
    rowSpecs.push(
      svgElement('rect', {
        class: 'mindmap-static-topic',
        fill: isRoot ? '#dbeafe' : '#ffffff',
        height: rowRect.height,
        rx: 7,
        stroke: isRoot ? '#60a5fa' : '#cbd5e1',
        'stroke-width': isRoot ? 1.5 : 1,
        width: rowRect.width,
        x: rowRect.x,
        y: rowRect.y,
      }),
      ...imageSpecs.stickers,
      ...imageSpecs.top,
      svgElement('text', {
        fill: '#0f172a',
        'font-family': 'system-ui, sans-serif',
        'font-size': 13,
        'font-weight': isRoot ? 700 : 500,
        x: row.x + 10,
        y: imageSpecs.textY,
      }, row.title),
      ...imageSpecs.bottom,
    );
  }

  const footerParts = [
    ...(omittedTopicCount > 0 ? [`还有 ${omittedTopicCount} 个主题未显示`] : []),
    ...(omittedBoundaryCount > 0 ? [`还有 ${omittedBoundaryCount} 个边界未显示`] : []),
    ...(omittedSummaryCount > 0 ? [`还有 ${omittedSummaryCount} 个概要未显示`] : []),
  ];
  const footer = isTruncated
    ? [svgElement('text', {
        fill: '#64748b',
        'font-family': 'system-ui, sans-serif',
        'font-size': 12,
        x: HORIZONTAL_PADDING,
        y: VERTICAL_PADDING + contentHeight + 23,
      }, `预览已截断：${footerParts.join('，')}`)]
    : [];

  return {
    height,
    spec: svgElement(
      `${SVG_NAMESPACE} svg`,
      {
        'aria-label': `思维导图静态预览，共 ${totalTopicCount} 个主题`,
        'data-mindmap-static-preview': 'ready',
        'data-total-boundary-count': totalBoundaryCount,
        'data-total-summary-count': totalSummaryCount,
        'data-total-topic-count': totalTopicCount,
        'data-visible-boundary-count': visibleBoundaryCount,
        'data-visible-summary-count': visibleSummaryCount,
        'data-visible-topic-count': visibleTopicCount,
        focusable: 'false',
        height,
        preserveAspectRatio: 'xMinYMin meet',
        role: 'img',
        viewBox: `0 0 ${viewBoxWidth} ${viewBoxHeight}`,
        width: '100%',
        xmlns: SVG_NAMESPACE,
      },
      svgElement('title', {}, '思维导图静态预览'),
      svgElement('rect', {
        fill: '#f8fafc',
        height: viewBoxHeight - 2,
        rx: 12,
        stroke: '#cbd5e1',
        width: viewBoxWidth - 2,
        x: 1,
        y: 1,
      }),
      ...boundarySpecs,
      ...summarySpecs,
      ...connectors,
      ...rowSpecs,
      ...footer,
    ),
    status: 'ready',
    totalBoundaryCount,
    totalSummaryCount,
    totalTopicCount,
    visibleBoundaryCount,
    visibleSummaryCount,
    visibleTopicCount,
    width,
  };
};

/**
 * Creates a script-free SVG DOMOutputSpec suitable for a Tiptap atom's
 * renderHTML result. The SVG contains visible sheet/topic/Boundary titles,
 * Summary geometry, bounded visual paint, and credential-free HTTP(S) raster
 * image URLs. Managed/embedded paths, signed URLs, extensions, entity IDs, and
 * all other private fields remain excluded; the full canonical payload lives
 * exclusively on the surrounding data-mindmap attribute for round-trip reads.
 */
export const createMindMapStaticSvgPreview = (
  raw: unknown,
  options: MindMapStaticSvgPreviewOptions = {},
): MindMapStaticSvgPreview => {
  try {
    const parsed = parseMindMapAttribute(raw);
    if (!parsed.ok) return createErrorPreview();
    return createReadyPreview(parsed.document, { ...options, allowRemoteImages: true });
  } catch {
    return createErrorPreview();
  }
};

/**
 * Resolves and integrity-checks referenced image resources before producing a
 * self-contained SVG. Managed resources are mandatory: an unavailable or
 * altered managed object rejects the export instead of writing a non-portable
 * authenticated URL. Remote resources remain best-effort placeholders when
 * CORS/offline access prevents embedding.
 *
 * PNG exporters should rasterize this returned SVG so they consume the same
 * inlined bytes rather than attempting a second network read from the canvas.
 */
export const createPortableMindMapStaticSvgPreview = async (
  raw: unknown,
  options: MindMapPortableStaticSvgPreviewOptions,
): Promise<MindMapStaticSvgPreview> => {
  const parsed = parseMindMapAttribute(raw);
  if (!parsed.ok) return createErrorPreview();
  const verifiedResourceBytes = await resolveXMindExportResourceBytes({
    ...options,
    document: parsed.document,
  });
  return createReadyPreview(parsed.document, {
    allowRemoteImages: false,
    ...(verifiedResourceBytes === undefined ? {} : { verifiedResourceBytes }),
  });
};
