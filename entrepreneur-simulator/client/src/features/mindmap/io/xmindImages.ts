import type { Size } from '../domain/types';

export const XMIND_IMAGE_RESOURCE_MAX_BYTES = 15 * 1024 * 1024;
export const XMIND_IMAGE_RESOURCE_MAX_COUNT = 512;
export const XMIND_IMAGE_RESOURCE_MAX_EDGE = 32_768;
export const XMIND_IMAGE_RESOURCE_MAX_PIXELS = 40_000_000;

export type XMindRasterMimeType =
  | 'image/gif'
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp';

export interface XMindRasterInspection {
  readonly extension: 'gif' | 'jpg' | 'png' | 'webp';
  readonly intrinsicSize?: Size;
  readonly mimeType: XMindRasterMimeType;
}

const SIGNED_QUERY_PARAMETER_NAMES = new Set([
  'access_token',
  'api_key',
  'apikey',
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

function uint16BigEndian(bytes: Uint8Array, offset: number): number {
  return bytes[offset] * 0x100 + bytes[offset + 1];
}

function uint16LittleEndian(bytes: Uint8Array, offset: number): number {
  return bytes[offset] + bytes[offset + 1] * 0x100;
}

function uint24LittleEndian(bytes: Uint8Array, offset: number): number {
  return bytes[offset] + bytes[offset + 1] * 0x100 + bytes[offset + 2] * 0x1_0000;
}

function uint32BigEndian(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 0x100_0000
    + bytes[offset + 1] * 0x1_0000
    + bytes[offset + 2] * 0x100
    + bytes[offset + 3]
  ) >>> 0;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function validSize(width: number, height: number): Size | undefined {
  return Number.isSafeInteger(width)
    && Number.isSafeInteger(height)
    && width > 0
    && height > 0
    && width <= XMIND_IMAGE_RESOURCE_MAX_EDGE
    && height <= XMIND_IMAGE_RESOURCE_MAX_EDGE
    && width * height <= XMIND_IMAGE_RESOURCE_MAX_PIXELS
    ? { height, width }
    : undefined;
}

function jpegSize(bytes: Uint8Array): Size | undefined {
  let offset = 2;
  const startOfFrameMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ]);
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) break;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01) continue;
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    if (offset + 2 > bytes.length) break;
    const length = uint16BigEndian(bytes, offset);
    if (length < 2 || offset + length > bytes.length) break;
    if (startOfFrameMarkers.has(marker) && length >= 7) {
      return validSize(
        uint16BigEndian(bytes, offset + 5),
        uint16BigEndian(bytes, offset + 3),
      );
    }
    offset += length;
  }
  return undefined;
}

function webpSize(bytes: Uint8Array): Size | undefined {
  if (bytes.length < 20) return undefined;
  const chunk = ascii(bytes, 12, 4);
  if (chunk === 'VP8X' && bytes.length >= 30) {
    return validSize(
      uint24LittleEndian(bytes, 24) + 1,
      uint24LittleEndian(bytes, 27) + 1,
    );
  }
  if (chunk === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
    return validSize(
      1 + bytes[21] + ((bytes[22] & 0x3f) << 8),
      1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10),
    );
  }
  if (
    chunk === 'VP8 '
    && bytes.length >= 30
    && bytes[23] === 0x9d
    && bytes[24] === 0x01
    && bytes[25] === 0x2a
  ) {
    return validSize(
      uint16LittleEndian(bytes, 26) & 0x3fff,
      uint16LittleEndian(bytes, 28) & 0x3fff,
    );
  }
  return undefined;
}

/**
 * Identifies the four raster formats accepted by Local Image from magic bytes.
 * Extensions and manifest media types are deliberately not trusted.
 */
export function inspectXMindRaster(bytes: Uint8Array): XMindRasterInspection | null {
  if (
    bytes.length >= 24
    && bytes[0] === 0x89
    && ascii(bytes, 1, 3) === 'PNG'
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a
    && uint32BigEndian(bytes, 8) === 13
    && ascii(bytes, 12, 4) === 'IHDR'
  ) {
    const intrinsicSize = validSize(uint32BigEndian(bytes, 16), uint32BigEndian(bytes, 20));
    if (!intrinsicSize) return null;
    return {
      extension: 'png',
      intrinsicSize,
      mimeType: 'image/png',
    };
  }
  if (
    bytes.length >= 10
    && (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a')
  ) {
    const intrinsicSize = validSize(
      uint16LittleEndian(bytes, 6),
      uint16LittleEndian(bytes, 8),
    );
    if (!intrinsicSize) return null;
    return {
      extension: 'gif',
      intrinsicSize,
      mimeType: 'image/gif',
    };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    const intrinsicSize = jpegSize(bytes);
    return intrinsicSize
      ? { extension: 'jpg', intrinsicSize, mimeType: 'image/jpeg' }
      : null;
  }
  if (
    bytes.length >= 16
    && ascii(bytes, 0, 4) === 'RIFF'
    && ascii(bytes, 8, 4) === 'WEBP'
  ) {
    const intrinsicSize = webpSize(bytes);
    return intrinsicSize
      ? { extension: 'webp', intrinsicSize, mimeType: 'image/webp' }
      : null;
  }
  return null;
}

export function isSafeXMindPackagePath(path: string): boolean {
  if (
    path === ''
    || path.includes('\0')
    || path.includes('\\')
    || path.startsWith('/')
    || /^[A-Za-z]:/.test(path)
  ) return false;
  const parts = path.split('/');
  return parts.length > 0
    && parts.every((part) => part !== '' && part !== '.' && part !== '..');
}

/** Maps an XMind xap resource URI to its package-relative entry name. */
export function xmindImageSourceToPackagePath(source: unknown): string | null {
  if (typeof source !== 'string' || source.length === 0 || source.length > 4_096) return null;
  let path = source;
  if (/^xap:/i.test(path)) path = path.slice(4);
  if (path.startsWith('//')) return null;
  try {
    path = decodeURIComponent(path);
  } catch {
    return null;
  }
  path = path.replace(/^\.\//, '');
  if (!isSafeXMindPackagePath(path)) return null;
  const firstSegment = path.split('/')[0]?.toLocaleLowerCase('en-US');
  return firstSegment === 'resources' ? path : null;
}

export function xmindPackagePathToImageSource(path: string): string {
  if (!isSafeXMindPackagePath(path)) throw new Error(`Unsafe XMind resource path ${path}.`);
  return `xap:${path}`;
}

export function safeXMindResourceFileName(
  packagePath: string,
  extension: XMindRasterInspection['extension'],
): string {
  const parts = packagePath.split('/');
  const last = parts[parts.length - 1] ?? `image.${extension}`;
  const withoutControls = last.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  const stem = withoutControls.replace(/\.[^.]*$/, '').replace(/[^\p{L}\p{N}._ -]+/gu, '_')
    .slice(0, 180) || 'image';
  return `${stem}.${extension}`;
}

export function hasSignedRemoteCredential(urlValue: string): boolean {
  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    return true;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return true;
  if (url.username !== '' || url.password !== '') return true;
  for (const key of url.searchParams.keys()) {
    if (SIGNED_QUERY_PARAMETER_NAMES.has(key.toLocaleLowerCase('en-US'))) return true;
  }
  return false;
}

export function redactSensitiveRemoteUrl(urlValue: string): string {
  try {
    const url = new URL(urlValue);
    url.username = '';
    url.password = '';
    for (const key of [...url.searchParams.keys()]) {
      if (SIGNED_QUERY_PARAMETER_NAMES.has(key.toLocaleLowerCase('en-US'))) {
        url.searchParams.set(key, '[redacted]');
      }
    }
    url.hash = '';
    return url.toString();
  } catch {
    return 'https://redacted.invalid/resource';
  }
}
