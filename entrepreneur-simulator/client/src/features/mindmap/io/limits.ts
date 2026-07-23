import type { MindMapImportLimits } from './types';

export const DEFAULT_MIND_MAP_IMPORT_LIMITS: Readonly<MindMapImportLimits> =
  Object.freeze({
    maxDepth: 64,
    maxInputBytes: 2 * 1024 * 1024,
    maxNodes: 10_000,
    maxTitleLength: 4_096,
  });

function positiveIntegerOrDefault(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 1) return fallback;
  return Math.floor(value);
}

export function resolveMindMapImportLimits(
  limits: Partial<MindMapImportLimits> | undefined,
): MindMapImportLimits {
  return {
    maxDepth: positiveIntegerOrDefault(
      limits?.maxDepth,
      DEFAULT_MIND_MAP_IMPORT_LIMITS.maxDepth,
    ),
    maxInputBytes: positiveIntegerOrDefault(
      limits?.maxInputBytes,
      DEFAULT_MIND_MAP_IMPORT_LIMITS.maxInputBytes,
    ),
    maxNodes: positiveIntegerOrDefault(
      limits?.maxNodes,
      DEFAULT_MIND_MAP_IMPORT_LIMITS.maxNodes,
    ),
    maxTitleLength: positiveIntegerOrDefault(
      limits?.maxTitleLength,
      DEFAULT_MIND_MAP_IMPORT_LIMITS.maxTitleLength,
    ),
  };
}

/** UTF-8 byte length without allocating an input-sized Blob or encoded buffer. */
export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x7f) {
      bytes += 1;
    } else if (codeUnit <= 0x7ff) {
      bytes += 2;
    } else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}
