import { DOMSerializer, type DOMOutputSpec } from '@tiptap/pm/model';

const SVG_MIME = 'image/svg+xml;charset=utf-8';
const MAX_RASTER_PIXELS = 40_000_000;
const MAX_RASTER_EDGE = 16_384;

export type MindMapRasterFormat = 'jpeg' | 'png';
export type MindMapRasterScale = 1 | 2 | 3;

export interface RasterizeMindMapSvgOptions {
  readonly format: MindMapRasterFormat;
  /** JPEG requires an explicit opaque background; PNG may omit it. */
  readonly backgroundColor?: string;
  readonly quality?: number;
  readonly scale: MindMapRasterScale;
  readonly signal?: AbortSignal;
}

export interface MindMapRasterResult {
  readonly blob: Blob;
  readonly height: number;
  readonly mimeType: 'image/jpeg' | 'image/png';
  readonly width: number;
}

export interface SerializeMindMapSvgOptions {
  readonly ownerDocument?: Document;
  readonly scale?: MindMapRasterScale;
}

export const serializeMindMapSvgSpec = (
  spec: DOMOutputSpec,
  options: Readonly<SerializeMindMapSvgOptions> = {},
): string => {
  const ownerDocument = options.ownerDocument ?? globalThis.document;
  const rendered = DOMSerializer.renderSpec(ownerDocument, spec).dom;
  const ownerWindow = ownerDocument.defaultView;
  if (!ownerWindow || !(rendered instanceof ownerWindow.SVGElement)) {
    throw new Error('静态导出没有生成有效的 SVG。');
  }
  if (!rendered.getAttribute('xmlns')) {
    rendered.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  }
  const scale = options.scale ?? 1;
  if (![1, 2, 3].includes(scale)) throw new Error('SVG 导出倍率无效。');
  if (scale !== 1) {
    const width = Number(rendered.getAttribute('width'));
    const height = Number(rendered.getAttribute('height'));
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      throw new Error('SVG 导出没有有效的固有尺寸。');
    }
    rendered.setAttribute('width', String(width * scale));
    rendered.setAttribute('height', String(height * scale));
  }
  rendered.setAttribute('data-export-scale', String(scale));
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new ownerWindow.XMLSerializer().serializeToString(rendered)}`;
};

export const rasterizeMindMapSvg = async (
  svg: string,
  width: number,
  height: number,
  options: Readonly<RasterizeMindMapSvgOptions>,
): Promise<MindMapRasterResult> => {
  const { signal } = options;
  if (signal?.aborted) {
    throw new DOMException('静态图片导出已取消。', 'AbortError');
  }
  if (
    !Number.isFinite(width)
    || !Number.isFinite(height)
    || !Number.isInteger(width)
    || !Number.isInteger(height)
    || width <= 0
    || height <= 0
    || ![1, 2, 3].includes(options.scale)
  ) throw new Error('静态图片尺寸超过安全栅格化上限。');
  const outputWidth = width * options.scale;
  const outputHeight = height * options.scale;
  if (
    outputWidth > MAX_RASTER_EDGE
    || outputHeight > MAX_RASTER_EDGE
    || outputWidth * outputHeight > MAX_RASTER_PIXELS
  ) throw new Error('静态图片尺寸超过安全栅格化上限。');
  const mimeType = options.format === 'jpeg' ? 'image/jpeg' : 'image/png';
  const backgroundColor = options.backgroundColor;
  if (
    options.format === 'jpeg'
    && (
      !backgroundColor
      || !/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/iu.test(backgroundColor)
    )
  ) throw new Error('JPEG 导出需要明确的不透明背景色。');
  if (
    backgroundColor
    && !/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/iu.test(backgroundColor)
  ) throw new Error('静态图片背景色无效。');
  const quality = options.quality ?? 0.92;
  if (options.format === 'jpeg' && (!Number.isFinite(quality) || quality < 0 || quality > 1)) {
    throw new Error('JPEG 导出质量参数无效。');
  }
  if (typeof URL.createObjectURL !== 'function') {
    throw new Error('当前浏览器不支持静态图片导出。');
  }

  const sourceUrl = URL.createObjectURL(new Blob([svg], { type: SVG_MIME }));
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const candidate = new Image();
      const cleanup = (): void => signal?.removeEventListener('abort', abortRasterization);
      const abortRasterization = (): void => {
        candidate.onload = null;
        candidate.onerror = null;
        candidate.src = '';
        cleanup();
        reject(new DOMException('静态图片导出已取消。', 'AbortError'));
      };
      candidate.onload = () => {
        cleanup();
        resolve(candidate);
      };
      candidate.onerror = () => {
        cleanup();
        reject(new Error('无法栅格化静态 SVG。'));
      };
      signal?.addEventListener('abort', abortRasterization, { once: true });
      candidate.src = sourceUrl;
    });
    if (signal?.aborted) {
      throw new DOMException('静态图片导出已取消。', 'AbortError');
    }
    const canvas = globalThis.document.createElement('canvas');
    canvas.width = outputWidth;
    canvas.height = outputHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('当前浏览器不支持 PNG 画布导出。');
    if (backgroundColor) {
      context.fillStyle = backgroundColor;
      context.fillRect(0, 0, outputWidth, outputHeight);
    }
    context.drawImage(image, 0, 0, outputWidth, outputHeight);
    if (signal?.aborted) {
      throw new DOMException('静态图片导出已取消。', 'AbortError');
    }
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (signal?.aborted) {
            reject(new DOMException('静态图片导出已取消。', 'AbortError'));
          } else if (blob) resolve(blob);
          else reject(new Error('无法生成 PNG 文件。'));
        },
        mimeType,
        options.format === 'jpeg' ? quality : undefined,
      );
    });
    return { blob, height: outputHeight, mimeType, width: outputWidth };
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
};

export const rasterizeMindMapSvgToPng = async (
  svg: string,
  width: number,
  height: number,
  signal?: AbortSignal,
): Promise<Blob> => (
  rasterizeMindMapSvg(svg, width, height, { format: 'png', scale: 1, signal })
    .then((result) => result.blob)
);
