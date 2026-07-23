import type { UploadResult } from '../../../services/api';
import {
  managedMindMapImageMimeType,
  resolveMindMapImageResourceName,
} from '../assets/managedImageTransport';
import { createEntityId } from '../domain/ids';
import type {
  Asset,
  AssetId,
  ExtensionBag,
  ImageId,
  MindMapDocumentV1,
  OrderKey,
  SheetId,
  Size,
  TopicId,
  TopicImage,
} from '../domain/types';
import type { CreateImageCommand } from '../commands/types';
import { createAvailableOrderKey } from './commandPlanning';
import { planCreateImageCommand } from './imagePlanning';

export const LOCAL_IMAGE_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp';
export const LOCAL_IMAGE_MAX_BYTES = 15 * 1024 * 1024;
export const LOCAL_IMAGE_MAX_DISPLAY_SIZE: Readonly<Size> = Object.freeze({
  width: 320,
  height: 240,
});

const LOCAL_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);

export type LocalImageIngestErrorCode =
  | 'read-only'
  | 'empty-file'
  | 'unsupported-type'
  | 'file-too-large'
  | 'decode-failed'
  | 'upload-failed'
  | 'planning-failed';

const ERROR_MESSAGES: Readonly<Record<LocalImageIngestErrorCode, string>> = {
  'read-only': '只读模式不能添加图片。',
  'empty-file': '图片文件为空。',
  'unsupported-type': '仅支持 PNG、JPEG、GIF 或 WebP 图片。',
  'file-too-large': '图片不能超过 15MB。',
  'decode-failed': '无法读取图片尺寸。',
  'upload-failed': '图片上传失败。',
  'planning-failed': '无法添加该图片。',
};

export class LocalImageIngestError extends Error {
  readonly code: LocalImageIngestErrorCode;
  readonly originalError?: unknown;

  constructor(code: LocalImageIngestErrorCode, originalError?: unknown) {
    super(ERROR_MESSAGES[code]);
    this.name = 'LocalImageIngestError';
    this.code = code;
    if (originalError !== undefined) this.originalError = originalError;
  }
}

export const localImageIngestErrorMessage = (error: unknown): string =>
  error instanceof LocalImageIngestError
    ? error.message
    : ERROR_MESSAGES['planning-failed'];

const validDimension = (value: number): boolean =>
  Number.isFinite(value) && value > 0 && value <= 1_000_000;

const assertIntrinsicSize = (size: Size): Size => {
  if (!validDimension(size.width) || !validDimension(size.height)) {
    throw new LocalImageIngestError('decode-failed');
  }
  return {
    width: Math.round(size.width),
    height: Math.round(size.height),
  };
};

/** Preserve original asset metadata while keeping a newly inserted raster
 * comfortably visible inside the embedded canvas. Small images are not
 * enlarged and large images retain their aspect ratio. */
export const fitLocalImageDisplaySize = (intrinsicSize: Size): Size => {
  const size = assertIntrinsicSize(intrinsicSize);
  const scale = Math.min(
    1,
    LOCAL_IMAGE_MAX_DISPLAY_SIZE.width / size.width,
    LOCAL_IMAGE_MAX_DISPLAY_SIZE.height / size.height,
  );
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  };
};

/**
 * Decodes dimensions without retaining a Blob URL. createImageBitmap is the
 * preferred path; the Image fallback keeps Safari/older browsers compatible.
 */
export const decodeLocalImageDimensions = async (file: File): Promise<Size> => {
  if (typeof globalThis.createImageBitmap === 'function') {
    try {
      const bitmap = await globalThis.createImageBitmap(file);
      try {
        return assertIntrinsicSize({ width: bitmap.width, height: bitmap.height });
      } finally {
        bitmap.close();
      }
    } catch (error) {
      if (error instanceof LocalImageIngestError) throw error;
      throw new LocalImageIngestError('decode-failed', error);
    }
  }

  if (typeof Image === 'undefined' || typeof URL.createObjectURL !== 'function') {
    throw new LocalImageIngestError('decode-failed');
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    return await new Promise<Size>((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        try {
          resolve(assertIntrinsicSize({
            width: image.naturalWidth,
            height: image.naturalHeight,
          }));
        } catch (error) {
          reject(error);
        }
      };
      image.onerror = () => reject(new LocalImageIngestError('decode-failed'));
      image.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};

/** A path/control-character-free accessible label derived from the client name. */
export const sanitizeLocalImageAlt = (fileName: string): string => {
  const leafName = fileName.split(/[\\/]/).pop() ?? '';
  const cleaned = leafName
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/[\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return [...cleaned].slice(0, 240).join('') || '本地图片';
};

const validateFile = (file: File, readOnly: boolean): void => {
  if (readOnly) throw new LocalImageIngestError('read-only');
  if (file.size <= 0) throw new LocalImageIngestError('empty-file');
  if (!LOCAL_IMAGE_MIME_TYPES.has(file.type.toLowerCase())) {
    throw new LocalImageIngestError('unsupported-type');
  }
  if (file.size > LOCAL_IMAGE_MAX_BYTES) {
    throw new LocalImageIngestError('file-too-large');
  }
};

const validateUploadManifest = (file: File, uploaded: UploadResult): void => {
  const mimeType = String(uploaded.mimeType).toLowerCase();
  if (!LOCAL_IMAGE_MIME_TYPES.has(mimeType)) {
    throw new LocalImageIngestError('upload-failed');
  }
  if (
    !Number.isSafeInteger(uploaded.byteSize)
    || uploaded.byteSize <= 0
    || uploaded.byteSize > LOCAL_IMAGE_MAX_BYTES
    || uploaded.byteSize !== file.size
  ) throw new LocalImageIngestError('upload-failed');
  if (typeof uploaded.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(uploaded.sha256)) {
    throw new LocalImageIngestError('upload-failed');
  }
  if (uploaded.objectKey !== undefined) {
    try {
      const resourceName = resolveMindMapImageResourceName(uploaded.objectKey);
      if (
        resourceName.slice(0, 64) !== uploaded.sha256
        || managedMindMapImageMimeType(uploaded.objectKey) !== mimeType
      ) throw new Error('Managed upload metadata mismatch.');
    } catch (error) {
      throw new LocalImageIngestError('upload-failed', error);
    }
  }
};

export interface PlanLocalImageIngestInput {
  readonly file: File;
  readonly readOnly: boolean;
  readonly sheetId: SheetId;
  readonly topicId: TopicId;
  /** Read only after upload so concurrent content edits use the latest revision. */
  readonly getDocument: () => MindMapDocumentV1 | null;
  readonly upload: (file: File) => Promise<UploadResult>;
  readonly decode?: (file: File) => Promise<Size>;
  readonly createAssetId?: () => AssetId;
  readonly createImageId?: () => ImageId;
  /** Trusted product intent; ordinary file insertion omits this entirely. */
  readonly imageIntent?: {
    readonly role: 'inline' | 'sticker';
    readonly side: 'top' | 'bottom' | 'left' | 'right';
    readonly displaySize?: Size;
    readonly alt?: string;
    readonly origin?: string;
    readonly assetExtensions?: ExtensionBag;
  };
}

export interface PlannedLocalImageIngest {
  readonly command: CreateImageCommand;
  readonly asset: Asset;
  readonly image: TopicImage;
}

/**
 * Prepares, but never dispatches, one atomic Asset + TopicImage transaction.
 * Decode always finishes before upload, and planning always finishes before
 * the caller is allowed to mutate canonical content.
 */
export const planLocalImageIngest = async (
  input: PlanLocalImageIngestInput,
): Promise<PlannedLocalImageIngest> => {
  validateFile(input.file, input.readOnly);

  let intrinsicSize: Size;
  try {
    intrinsicSize = assertIntrinsicSize(
      await (input.decode ?? decodeLocalImageDimensions)(input.file),
    );
  } catch (error) {
    if (error instanceof LocalImageIngestError) throw error;
    throw new LocalImageIngestError('decode-failed', error);
  }

  let uploaded: UploadResult;
  try {
    uploaded = await input.upload(input.file);
    validateUploadManifest(input.file, uploaded);
  } catch (error) {
    if (error instanceof LocalImageIngestError) throw error;
    throw new LocalImageIngestError('upload-failed', error);
  }

  try {
    const document = input.getDocument();
    const sheet = document?.sheets[input.sheetId];
    if (!document || !sheet?.topics[input.topicId]) {
      throw new Error('The target topic no longer exists.');
    }
    const existingKeys = Object.values(sheet.images)
      .filter((image) => image.topicId === input.topicId)
      .map((image) => image.orderKey);
    const assetId = input.createAssetId?.() ?? createEntityId<'Asset'>() as AssetId;
    const imageId = input.createImageId?.() ?? createEntityId<'Image'>() as ImageId;
    const intent = input.imageIntent;
    const asset: Asset = {
      id: assetId,
      fileName: uploaded.fileName,
      mimeType: uploaded.mimeType,
      byteSize: uploaded.byteSize,
      sha256: uploaded.sha256,
      source: uploaded.objectKey === undefined
        ? { kind: 'remote', url: uploaded.url }
        : { kind: 'managed', objectKey: uploaded.objectKey },
      intrinsicSize,
      ...(intent?.assetExtensions === undefined
        ? {}
        : { extensions: structuredClone(intent.assetExtensions) }),
    };
    const image: TopicImage = {
      id: imageId,
      topicId: input.topicId,
      assetId,
      orderKey: createAvailableOrderKey(existingKeys) as OrderKey,
      role: intent?.role ?? 'inline',
      placement: {
        side: intent?.side ?? 'top',
        align: 'center',
        offset: { x: 0, y: 0 },
      },
      size: {
        ...(intent?.displaySize ?? fitLocalImageDisplaySize(intrinsicSize)),
      },
      alt: intent?.alt === undefined
        ? sanitizeLocalImageAlt(input.file.name)
        : sanitizeLocalImageAlt(intent.alt),
    };
    return {
      asset,
      image,
      command: planCreateImageCommand({
        document,
        sheetId: input.sheetId,
        asset,
        image,
        origin: intent?.origin ?? 'mindmap-v2-local-image-ingest',
      }),
    };
  } catch (error) {
    throw new LocalImageIngestError('planning-failed', error);
  }
};
