import { unzipSync, zipSync, type Zippable } from 'fflate';

export interface XMindZipSecurityLimits {
  readonly maxArchiveBytes: number;
  readonly maxCompressionRatio: number;
  readonly maxEntries: number;
  readonly maxEntryUncompressedBytes: number;
  readonly maxTotalUncompressedBytes: number;
}

export type XMindZipSecurityLimitOverrides = Partial<XMindZipSecurityLimits>;

export const DEFAULT_XMIND_ZIP_SECURITY_LIMITS: Readonly<XMindZipSecurityLimits> =
  Object.freeze({
    maxArchiveBytes: 64 * 1024 * 1024,
    maxCompressionRatio: 500,
    maxEntries: 2_048,
    maxEntryUncompressedBytes: 32 * 1024 * 1024,
    maxTotalUncompressedBytes: 128 * 1024 * 1024,
  });

export interface XMindZipEntryDescriptor {
  readonly compressedSize: number;
  readonly compressionMethod: 0 | 8;
  readonly crc32: number;
  readonly name: string;
  readonly uncompressedSize: number;
}

export interface XMindZipInspection {
  readonly entries: readonly XMindZipEntryDescriptor[];
  readonly extracted: Readonly<Record<string, Uint8Array>>;
}

export class XMindZipSecurityError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly path?: string,
  ) {
    super(message);
    this.name = 'XMindZipSecurityError';
  }
}

const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;
const MAX_EOCD_SEARCH = 65_557;
const FIXED_ZIP_MTIME = new Date(2000, 0, 1, 0, 0, 0);

function positiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 1) return fallback;
  return Math.floor(value);
}

export function resolveXMindZipSecurityLimits(
  overrides: XMindZipSecurityLimitOverrides | undefined,
): XMindZipSecurityLimits {
  return {
    maxArchiveBytes: positiveInteger(
      overrides?.maxArchiveBytes,
      DEFAULT_XMIND_ZIP_SECURITY_LIMITS.maxArchiveBytes,
    ),
    maxCompressionRatio: positiveInteger(
      overrides?.maxCompressionRatio,
      DEFAULT_XMIND_ZIP_SECURITY_LIMITS.maxCompressionRatio,
    ),
    maxEntries: positiveInteger(
      overrides?.maxEntries,
      DEFAULT_XMIND_ZIP_SECURITY_LIMITS.maxEntries,
    ),
    maxEntryUncompressedBytes: positiveInteger(
      overrides?.maxEntryUncompressedBytes,
      DEFAULT_XMIND_ZIP_SECURITY_LIMITS.maxEntryUncompressedBytes,
    ),
    maxTotalUncompressedBytes: positiveInteger(
      overrides?.maxTotalUncompressedBytes,
      DEFAULT_XMIND_ZIP_SECURITY_LIMITS.maxTotalUncompressedBytes,
    ),
  };
}

function requireRange(data: Uint8Array, offset: number, length: number): void {
  if (
    !Number.isSafeInteger(offset)
    || !Number.isSafeInteger(length)
    || offset < 0
    || length < 0
    || offset + length > data.length
  ) {
    throw new XMindZipSecurityError(
      'xmind.zip-truncated',
      'The ZIP directory points outside the archive.',
    );
  }
}

function uint16(data: Uint8Array, offset: number): number {
  requireRange(data, offset, 2);
  return data[offset] | (data[offset + 1] << 8);
}

function uint32(data: Uint8Array, offset: number): number {
  requireRange(data, offset, 4);
  return (
    data[offset]
    + data[offset + 1] * 0x100
    + data[offset + 2] * 0x1_0000
    + data[offset + 3] * 0x100_0000
  ) >>> 0;
}

function findEndOfCentralDirectory(data: Uint8Array): number {
  const minimum = Math.max(0, data.length - MAX_EOCD_SEARCH);
  for (let offset = data.length - 22; offset >= minimum; offset -= 1) {
    if (uint32(data, offset) !== END_OF_CENTRAL_DIRECTORY_SIGNATURE) continue;
    const commentLength = uint16(data, offset + 20);
    if (offset + 22 + commentLength === data.length) return offset;
  }
  throw new XMindZipSecurityError(
    'xmind.zip-invalid',
    'The input is not a complete ZIP archive.',
  );
}

function decodeEntryName(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new XMindZipSecurityError(
      'xmind.zip-filename-encoding',
      'ZIP entry names must use valid UTF-8.',
    );
  }
}

function assertSafeEntryName(name: string): void {
  const windowsDrive = /^[A-Za-z]:/;
  if (
    name === ''
    || name.includes('\0')
    || name.includes('\\')
    || name.startsWith('/')
    || windowsDrive.test(name)
  ) {
    throw new XMindZipSecurityError(
      'xmind.zip-unsafe-path',
      `Unsafe ZIP entry path: ${JSON.stringify(name)}.`,
      name,
    );
  }

  const directory = name.endsWith('/');
  const parts = name.split('/');
  if (directory) parts.pop();
  if (
    parts.length === 0
    || parts.some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw new XMindZipSecurityError(
      'xmind.zip-unsafe-path',
      `Unsafe ZIP entry path: ${JSON.stringify(name)}.`,
      name,
    );
  }
}

function inspectCentralDirectory(
  data: Uint8Array,
  limits: XMindZipSecurityLimits,
): XMindZipEntryDescriptor[] {
  if (data.length > limits.maxArchiveBytes) {
    throw new XMindZipSecurityError(
      'xmind.archive-limit',
      `The XMind archive exceeds the ${limits.maxArchiveBytes} byte limit.`,
    );
  }
  if (data.length < 22) {
    throw new XMindZipSecurityError('xmind.zip-invalid', 'The ZIP archive is too short.');
  }

  const eocd = findEndOfCentralDirectory(data);
  const diskNumber = uint16(data, eocd + 4);
  const centralDisk = uint16(data, eocd + 6);
  const entriesOnDisk = uint16(data, eocd + 8);
  const entryCount = uint16(data, eocd + 10);
  const centralSize = uint32(data, eocd + 12);
  const centralOffset = uint32(data, eocd + 16);

  if (
    diskNumber !== 0
    || centralDisk !== 0
    || entriesOnDisk !== entryCount
  ) {
    throw new XMindZipSecurityError(
      'xmind.zip-multidisk-unsupported',
      'Multi-disk ZIP archives are not supported.',
    );
  }
  if (
    entryCount === 0xffff
    || centralSize === 0xffff_ffff
    || centralOffset === 0xffff_ffff
  ) {
    throw new XMindZipSecurityError(
      'xmind.zip64-unsupported',
      'ZIP64 archives are not supported by the XMind importer.',
    );
  }
  if (entryCount > limits.maxEntries) {
    throw new XMindZipSecurityError(
      'xmind.zip-entry-limit',
      `The XMind archive contains more than ${limits.maxEntries} entries.`,
    );
  }
  requireRange(data, centralOffset, centralSize);
  if (centralOffset + centralSize > eocd) {
    throw new XMindZipSecurityError(
      'xmind.zip-directory-overlap',
      'The ZIP central directory overlaps the end record.',
    );
  }

  const entries: XMindZipEntryDescriptor[] = [];
  const names = new Set<string>();
  const localOffsets = new Set<number>();
  const localRanges: Array<{ end: number; name: string; start: number }> = [];
  let totalUncompressed = 0;
  let cursor = centralOffset;

  for (let index = 0; index < entryCount; index += 1) {
    requireRange(data, cursor, 46);
    if (uint32(data, cursor) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new XMindZipSecurityError(
        'xmind.zip-directory-invalid',
        'A ZIP central-directory record is malformed.',
      );
    }
    const flags = uint16(data, cursor + 8);
    const compressionMethod = uint16(data, cursor + 10);
    const crc = uint32(data, cursor + 16);
    const compressedSize = uint32(data, cursor + 20);
    const uncompressedSize = uint32(data, cursor + 24);
    const nameLength = uint16(data, cursor + 28);
    const extraLength = uint16(data, cursor + 30);
    const commentLength = uint16(data, cursor + 32);
    const diskStart = uint16(data, cursor + 34);
    const localOffset = uint32(data, cursor + 42);
    const recordLength = 46 + nameLength + extraLength + commentLength;
    requireRange(data, cursor, recordLength);

    if (
      compressedSize === 0xffff_ffff
      || uncompressedSize === 0xffff_ffff
      || localOffset === 0xffff_ffff
    ) {
      throw new XMindZipSecurityError(
        'xmind.zip64-unsupported',
        'ZIP64 entry metadata is not supported.',
      );
    }
    if ((flags & 0x0001) !== 0) {
      throw new XMindZipSecurityError(
        'xmind.zip-encrypted-unsupported',
        'Encrypted XMind archives are not supported.',
      );
    }
    if (diskStart !== 0) {
      throw new XMindZipSecurityError(
        'xmind.zip-multidisk-unsupported',
        'Multi-disk ZIP entries are not supported.',
      );
    }
    if (compressionMethod !== 0 && compressionMethod !== 8) {
      throw new XMindZipSecurityError(
        'xmind.zip-compression-unsupported',
        `ZIP compression method ${compressionMethod} is not supported.`,
      );
    }

    const name = decodeEntryName(data.subarray(cursor + 46, cursor + 46 + nameLength));
    assertSafeEntryName(name);
    const collisionKey = name.toLocaleLowerCase('en-US');
    if (names.has(collisionKey)) {
      throw new XMindZipSecurityError(
        'xmind.zip-duplicate-entry',
        `Duplicate or case-colliding ZIP entry: ${name}.`,
        name,
      );
    }
    names.add(collisionKey);
    if (localOffsets.has(localOffset)) {
      throw new XMindZipSecurityError(
        'xmind.zip-overlapping-entry',
        'Multiple ZIP entries point to the same local header.',
        name,
      );
    }
    localOffsets.add(localOffset);

    if (uncompressedSize > limits.maxEntryUncompressedBytes) {
      throw new XMindZipSecurityError(
        'xmind.zip-entry-size-limit',
        `ZIP entry ${name} exceeds the ${limits.maxEntryUncompressedBytes} byte limit.`,
        name,
      );
    }
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > limits.maxTotalUncompressedBytes) {
      throw new XMindZipSecurityError(
        'xmind.zip-total-size-limit',
        `ZIP contents exceed the ${limits.maxTotalUncompressedBytes} byte total limit.`,
      );
    }
    if (
      uncompressedSize >= 1_024
      && (
        compressedSize === 0
        || uncompressedSize / compressedSize > limits.maxCompressionRatio
      )
    ) {
      throw new XMindZipSecurityError(
        'xmind.zip-compression-ratio-limit',
        `ZIP entry ${name} exceeds the ${limits.maxCompressionRatio}:1 compression-ratio limit.`,
        name,
      );
    }

    requireRange(data, localOffset, 30);
    if (uint32(data, localOffset) !== LOCAL_FILE_SIGNATURE) {
      throw new XMindZipSecurityError(
        'xmind.zip-local-header-invalid',
        `ZIP entry ${name} has an invalid local header.`,
        name,
      );
    }
    const localFlags = uint16(data, localOffset + 6);
    const localCompression = uint16(data, localOffset + 8);
    const localNameLength = uint16(data, localOffset + 26);
    const localExtraLength = uint16(data, localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    requireRange(data, localOffset, 30 + localNameLength + localExtraLength);
    requireRange(data, dataOffset, compressedSize);
    const localName = decodeEntryName(
      data.subarray(localOffset + 30, localOffset + 30 + localNameLength),
    );
    if (
      localName !== name
      || localCompression !== compressionMethod
      || (localFlags & 0x0001) !== 0
      || dataOffset + compressedSize > centralOffset
    ) {
      throw new XMindZipSecurityError(
        'xmind.zip-local-header-mismatch',
        `ZIP entry ${name} has inconsistent local and central metadata.`,
        name,
      );
    }
    localRanges.push({ end: dataOffset + compressedSize, name, start: localOffset });

    entries.push({
      compressedSize,
      compressionMethod,
      crc32: crc,
      name,
      uncompressedSize,
    });
    cursor += recordLength;
  }

  if (cursor !== centralOffset + centralSize) {
    throw new XMindZipSecurityError(
      'xmind.zip-directory-size-mismatch',
      'The ZIP central-directory size does not match its records.',
    );
  }
  localRanges.sort((left, right) => left.start - right.start || left.end - right.end);
  for (let index = 1; index < localRanges.length; index += 1) {
    if (localRanges[index].start < localRanges[index - 1].end) {
      throw new XMindZipSecurityError(
        'xmind.zip-overlapping-entry',
        `ZIP entries ${localRanges[index - 1].name} and ${localRanges[index].name} overlap.`,
      );
    }
  }
  return entries;
}

let crcTable: Uint32Array | undefined;

function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) {
        value = (value & 1) !== 0
          ? 0xedb8_8320 ^ (value >>> 1)
          : value >>> 1;
      }
      crcTable[index] = value >>> 0;
    }
  }
  let value = 0xffff_ffff;
  for (const byte of data) {
    value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffff_ffff) >>> 0;
}

export function inspectAndExtractXMindZip(
  data: Uint8Array,
  limits: XMindZipSecurityLimits,
  selectedPaths: ReadonlySet<string>,
): XMindZipInspection {
  const entries = inspectCentralDirectory(data, limits);
  let extracted: Record<string, Uint8Array>;
  try {
    extracted = unzipSync(data, {
      filter: (file) => selectedPaths.has(file.name),
    });
  } catch (error) {
    throw new XMindZipSecurityError(
      'xmind.zip-decompression-failed',
      `The XMind ZIP payload could not be decompressed: ${error instanceof Error ? error.message : 'unknown error'}.`,
    );
  }

  const descriptorByName = new Map(entries.map((entry) => [entry.name, entry]));
  for (const [name, bytes] of Object.entries(extracted)) {
    const descriptor = descriptorByName.get(name);
    if (
      !descriptor
      || bytes.length !== descriptor.uncompressedSize
      || crc32(bytes) !== descriptor.crc32
    ) {
      throw new XMindZipSecurityError(
        'xmind.zip-integrity-failed',
        `ZIP entry ${name} failed its size or CRC integrity check.`,
        name,
      );
    }
  }
  return { entries, extracted };
}

export function createDeterministicXMindZip(
  files: Readonly<Record<string, Uint8Array>>,
): Uint8Array {
  const zippable: Zippable = {};
  for (const name of Object.keys(files).sort()) {
    assertSafeEntryName(name);
    // Normalize cross-realm typed arrays (notably Vitest/jsdom and iframe callers).
    zippable[name] = [Uint8Array.from(files[name]), { level: 6, mtime: FIXED_ZIP_MTIME }];
  }
  return zipSync(zippable, { level: 6, mtime: FIXED_ZIP_MTIME });
}
