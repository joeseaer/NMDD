import type { UploadResult } from '../../../services/api';
import type {
  AssetId,
  ImageId,
  MindMapDocumentV1,
  SheetId,
  Size,
  TopicId,
} from '../domain/types';
import {
  LocalImageIngestError,
  planLocalImageIngest,
  type PlannedLocalImageIngest,
} from './localImageIngest';
import {
  builtInStickerById,
  STICKER_CATALOG_MANIFEST_FINGERPRINT,
  STICKER_CATALOG_VERSION,
  type BuiltInStickerDescriptor,
  type BuiltInStickerId,
} from './stickerCatalog';

export type StickerIngestErrorCode =
  | 'read-only'
  | 'unknown-sticker'
  | 'asset-fetch-failed'
  | 'asset-invalid'
  | 'ingest-failed';

const MESSAGES: Readonly<Record<StickerIngestErrorCode, string>> = {
  'read-only': '只读模式不能添加贴纸。',
  'unknown-sticker': '找不到该贴纸素材。',
  'asset-fetch-failed': '无法读取贴纸素材。',
  'asset-invalid': '贴纸素材格式无效。',
  'ingest-failed': '无法添加该贴纸。',
};

export class StickerIngestError extends Error {
  readonly code: StickerIngestErrorCode;
  readonly originalError?: unknown;

  constructor(code: StickerIngestErrorCode, originalError?: unknown) {
    super(MESSAGES[code]);
    this.name = 'StickerIngestError';
    this.code = code;
    if (originalError !== undefined) this.originalError = originalError;
  }
}

export const stickerIngestErrorMessage = (error: unknown): string => {
  if (error instanceof StickerIngestError) return error.message;
  if (error instanceof LocalImageIngestError) {
    return error.code === 'read-only' ? MESSAGES['read-only'] : MESSAGES['ingest-failed'];
  }
  return MESSAGES['ingest-failed'];
};

export interface PlanBuiltInStickerIngestInput {
  readonly stickerId: BuiltInStickerId;
  readonly readOnly: boolean;
  readonly sheetId: SheetId;
  readonly topicId: TopicId;
  readonly getDocument: () => MindMapDocumentV1 | null;
  readonly upload: (file: File) => Promise<UploadResult>;
  readonly signal?: AbortSignal;
  readonly fetchAsset?: typeof fetch;
  readonly decode?: (file: File) => Promise<Size>;
  readonly createAssetId?: () => AssetId;
  readonly createImageId?: () => ImageId;
  readonly verifyAsset?: typeof verifyBuiltInStickerAsset;
}

const bytesToHex = (bytes: Uint8Array): string => [...bytes]
  .map((value) => value.toString(16).padStart(2, '0'))
  .join('');

const pngIntrinsicSize = (bytes: Uint8Array): Size | undefined => {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (
    bytes.byteLength < 24
    || !signature.every((value, index) => bytes[index] === value)
    || String.fromCharCode(...bytes.slice(12, 16)) !== 'IHDR'
  ) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
};

const readBlobBytes = async (blob: Blob): Promise<Uint8Array> => {
  const arrayBuffer = (blob as Blob & { arrayBuffer?: () => Promise<ArrayBuffer> }).arrayBuffer;
  if (typeof arrayBuffer === 'function') {
    return new Uint8Array(await arrayBuffer.call(blob));
  }
  if (typeof FileReader === 'undefined') throw new Error('Blob reader is unavailable.');
  return new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Blob read failed.'));
    reader.onabort = () => reject(new DOMException('The operation was aborted.', 'AbortError'));
    reader.onload = () => reader.result instanceof ArrayBuffer
      ? resolve(new Uint8Array(reader.result))
      : reject(new Error('Blob reader returned an invalid result.'));
    reader.readAsArrayBuffer(blob);
  });
};

/** Runtime defense for the generated release manifest; upload never sees unchecked bytes. */
export const verifyBuiltInStickerAsset = async (
  blob: Blob,
  descriptor: BuiltInStickerDescriptor,
  signal?: AbortSignal,
): Promise<void> => {
  try {
    signal?.throwIfAborted();
    if (blob.type.toLowerCase() !== descriptor.mimeType || blob.size !== descriptor.byteSize) {
      throw new Error('Catalog asset size or MIME mismatch.');
    }
    const bytes = await readBlobBytes(blob);
    signal?.throwIfAborted();
    const size = pngIntrinsicSize(bytes);
    if (
      !size
      || size.width !== descriptor.intrinsicSize.width
      || size.height !== descriptor.intrinsicSize.height
    ) throw new Error('Catalog asset dimensions mismatch.');
    if (!globalThis.crypto?.subtle) throw new Error('Web Crypto is unavailable.');
    const digestInput = new Uint8Array(bytes.byteLength);
    digestInput.set(bytes);
    const digest = new Uint8Array(await globalThis.crypto.subtle.digest(
      'SHA-256',
      digestInput.buffer,
    ));
    signal?.throwIfAborted();
    if (bytesToHex(digest) !== descriptor.sha256) {
      throw new Error('Catalog asset digest mismatch.');
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new StickerIngestError('asset-invalid', error);
  }
};

/**
 * Loads one immutable first-party catalog asset, then reuses the exact same
 * decode/upload/manifest/atomic-command pipeline as Local Image.
 */
export const planBuiltInStickerIngest = async (
  input: PlanBuiltInStickerIngestInput,
): Promise<PlannedLocalImageIngest> => {
  if (input.readOnly) throw new StickerIngestError('read-only');
  const descriptor = builtInStickerById(input.stickerId);
  if (!descriptor) throw new StickerIngestError('unknown-sticker');

  let response: Response;
  try {
    response = await (input.fetchAsset ?? globalThis.fetch)(descriptor.publicUrl, {
      credentials: 'same-origin',
      signal: input.signal,
    });
  } catch (error) {
    throw new StickerIngestError('asset-fetch-failed', error);
  }
  if (!response.ok) throw new StickerIngestError('asset-fetch-failed');
  const contentType = (response.headers.get('content-type') ?? '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase();
  if (contentType !== descriptor.mimeType) {
    throw new StickerIngestError('asset-invalid');
  }

  let blob: Blob;
  try {
    blob = await response.blob();
  } catch (error) {
    throw new StickerIngestError('asset-fetch-failed', error);
  }
  if (blob.type.toLowerCase() !== descriptor.mimeType) {
    throw new StickerIngestError('asset-invalid');
  }
  await (input.verifyAsset ?? verifyBuiltInStickerAsset)(blob, descriptor, input.signal);

  try {
    return await planLocalImageIngest({
      file: new File([blob], descriptor.fileName, { type: descriptor.mimeType }),
      readOnly: input.readOnly,
      sheetId: input.sheetId,
      topicId: input.topicId,
      getDocument: input.getDocument,
      upload: input.upload,
      decode: input.decode,
      createAssetId: input.createAssetId,
      createImageId: input.createImageId,
      imageIntent: {
        role: 'sticker',
        side: 'top',
        displaySize: descriptor.defaultDisplaySize,
        alt: descriptor.label,
        origin: 'mindmap-v2-sticker-catalog',
        assetExtensions: {
          'app.nmdd.catalog-item-id': descriptor.id,
          'app.nmdd.catalog-manifest-version': STICKER_CATALOG_VERSION,
          'app.nmdd.catalog-manifest-sha256': STICKER_CATALOG_MANIFEST_FINGERPRINT,
          'app.nmdd.catalog-license-spdx': descriptor.license.spdxId,
          'app.nmdd.catalog-provenance': descriptor.provenance,
          'app.nmdd.catalog-xmind-compatibility': descriptor.xmindCompatibility,
        },
      },
    });
  } catch (error) {
    if (error instanceof LocalImageIngestError) throw error;
    throw new StickerIngestError('ingest-failed', error);
  }
};
