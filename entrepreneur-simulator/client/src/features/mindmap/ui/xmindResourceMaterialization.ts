import type {
  Asset,
  AssetId,
  MindMapDocumentV1,
} from '../domain/types';
import { validateMindMapDocument } from '../domain/validation';
import {
  inspectXMindRaster,
  isSafeXMindPackagePath,
  XMIND_IMAGE_RESOURCE_MAX_BYTES,
  XMIND_IMAGE_RESOURCE_MAX_COUNT,
  type XMindRasterInspection,
} from '../io/xmindImages';

export const XMIND_MATERIALIZATION_TOTAL_MAX_BYTES = 128 * 1024 * 1024;

const CANONICAL_SHA256 = /^[a-f0-9]{64}$/;

export type XMindResourceMaterializationErrorCode =
  | 'invalid-candidate'
  | 'unsafe-resource-path'
  | 'missing-resource'
  | 'resource-too-large'
  | 'unsupported-raster'
  | 'mime-mismatch'
  | 'byte-size-mismatch'
  | 'sha256-mismatch'
  | 'too-many-resources'
  | 'total-bytes-exceeded'
  | 'hash-unavailable'
  | 'upload-failed'
  | 'upload-manifest-mismatch'
  | 'invalid-materialized-document';

export class XMindResourceMaterializationError extends Error {
  readonly code: XMindResourceMaterializationErrorCode;
  readonly assetId?: AssetId;
  readonly originalError?: unknown;
  readonly relativePath?: string;

  constructor(
    code: XMindResourceMaterializationErrorCode,
    message: string,
    details: {
      readonly assetId?: AssetId;
      readonly originalError?: unknown;
      readonly relativePath?: string;
    } = {},
  ) {
    super(message);
    this.name = 'XMindResourceMaterializationError';
    this.code = code;
    if (details.assetId !== undefined) this.assetId = details.assetId;
    if (details.originalError !== undefined) this.originalError = details.originalError;
    if (details.relativePath !== undefined) this.relativePath = details.relativePath;
  }
}

export interface XMindImageUploadResult {
  readonly byteSize: number;
  readonly mimeType: string;
  readonly objectKey?: string;
  readonly sha256: string;
}

export type XMindImageUpload = (
  file: File,
  options: { readonly signal: AbortSignal },
) => Promise<XMindImageUploadResult>;

export type XMindSha256 = (bytes: Uint8Array) => Promise<string>;

export interface MaterializeXMindEmbeddedResourcesInput {
  readonly candidate: MindMapDocumentV1;
  readonly resourceBytes: Readonly<Record<string, Uint8Array>>;
  readonly uploadImage: XMindImageUpload;
  readonly signal: AbortSignal;
  /** Test/runtime seam; production callers should use WebCrypto's default. */
  readonly hashSha256?: XMindSha256;
}

export interface MaterializedXMindEmbeddedResources {
  readonly document: MindMapDocumentV1;
  /** Verified copies keyed by AssetId, suitable for same-session XMind export. */
  readonly verifiedResourceBytes?: Readonly<Record<AssetId, Uint8Array>>;
}

interface VerifiedAssetResource {
  readonly assetId: AssetId;
  readonly bytes: Uint8Array;
  readonly inspection: XMindRasterInspection;
  readonly relativePath: string;
  readonly sha256: string;
}

interface UniqueVerifiedResource {
  readonly bytes: Uint8Array;
  readonly inspection: XMindRasterInspection;
  readonly sha256: string;
}

const fail = (
  code: XMindResourceMaterializationErrorCode,
  message: string,
  details?: {
    readonly assetId?: AssetId;
    readonly originalError?: unknown;
    readonly relativePath?: string;
  },
): never => {
  throw new XMindResourceMaterializationError(code, message, details);
};

const throwIfAborted = (signal: AbortSignal): void => {
  if (signal.aborted) {
    throw new DOMException('XMind image materialization was aborted.', 'AbortError');
  }
};

const sha256WithWebCrypto: XMindSha256 = async (bytes) => {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    return fail(
      'hash-unavailable',
      'WebCrypto SHA-256 is unavailable in this runtime.',
    );
  }
  const payload = Uint8Array.from(bytes).buffer;
  const digest = new Uint8Array(await subtle.digest('SHA-256', payload));
  return [...digest].map((value) => value.toString(16).padStart(2, '0')).join('');
};

const referencedImageAssetIds = (document: MindMapDocumentV1): Set<AssetId> => {
  const result = new Set<AssetId>();
  for (const sheet of Object.values(document.sheets)) {
    for (const image of Object.values(sheet.images)) result.add(image.assetId);
  }
  return result;
};

const ownResourceBytes = (
  resourceBytes: Readonly<Record<string, Uint8Array>>,
  relativePath: string,
): Uint8Array | undefined => (
  Object.prototype.hasOwnProperty.call(resourceBytes, relativePath)
    ? resourceBytes[relativePath]
    : undefined
);

const verifyAssetResource = async (
  asset: Readonly<Asset>,
  resourceBytes: Readonly<Record<string, Uint8Array>>,
  hashSha256: XMindSha256,
  signal: AbortSignal,
): Promise<VerifiedAssetResource> => {
  if (asset.source.kind !== 'embedded') {
    throw new Error('verifyAssetResource requires an embedded Asset.');
  }
  const relativePath = asset.source.relativePath;
  const details = { assetId: asset.id, relativePath };
  if (!isSafeXMindPackagePath(relativePath)) {
    return fail(
      'unsafe-resource-path',
      `Embedded image Asset ${asset.id} has an unsafe package path.`,
      details,
    );
  }

  const supplied = ownResourceBytes(resourceBytes, relativePath);
  if (!(supplied instanceof Uint8Array)) {
    return fail(
      'missing-resource',
      `Embedded image bytes are missing for Asset ${asset.id}.`,
      details,
    );
  }
  if (supplied.byteLength <= 0 || supplied.byteLength > XMIND_IMAGE_RESOURCE_MAX_BYTES) {
    return fail(
      'resource-too-large',
      `Embedded image Asset ${asset.id} exceeds the per-resource byte limit.`,
      details,
    );
  }

  // Snapshot caller-owned bytes before any await to prevent a mutable-buffer
  // time-of-check/time-of-use gap between inspection, hashing, and upload.
  const bytes = Uint8Array.from(supplied);
  const inspection = inspectXMindRaster(bytes);
  if (!inspection) {
    return fail(
      'unsupported-raster',
      `Embedded image Asset ${asset.id} is not a valid PNG, JPEG, GIF, or WebP raster.`,
      details,
    );
  }
  if (asset.mimeType !== inspection.mimeType) {
    return fail(
      'mime-mismatch',
      `Embedded image Asset ${asset.id} has a MIME mismatch.`,
      details,
    );
  }
  if (asset.byteSize !== bytes.byteLength) {
    return fail(
      'byte-size-mismatch',
      `Embedded image Asset ${asset.id} has a byte-size mismatch.`,
      details,
    );
  }
  if (!CANONICAL_SHA256.test(asset.sha256)) {
    return fail(
      'sha256-mismatch',
      `Embedded image Asset ${asset.id} does not declare a canonical SHA-256.`,
      details,
    );
  }

  throwIfAborted(signal);
  let sha256: string;
  try {
    // Hash a second copy so an injected runtime seam cannot alter the bytes
    // that were inspected and will later be uploaded.
    sha256 = await hashSha256(Uint8Array.from(bytes));
  } catch (error) {
    throwIfAborted(signal);
    return fail(
      'hash-unavailable',
      `Could not compute SHA-256 for embedded image Asset ${asset.id}.`,
      { ...details, originalError: error },
    );
  }
  throwIfAborted(signal);
  if (!CANONICAL_SHA256.test(sha256) || sha256 !== asset.sha256) {
    return fail(
      'sha256-mismatch',
      `Embedded image Asset ${asset.id} failed SHA-256 verification.`,
      details,
    );
  }
  return { assetId: asset.id, bytes, inspection, relativePath, sha256 };
};

const verifyUploadManifest = (
  upload: unknown,
  resource: UniqueVerifiedResource,
): string => {
  const expectedObjectKey = (
    `mindmap-images/sha256/${resource.sha256}.${resource.inspection.extension}`
  );
  if (
    typeof upload !== 'object'
    || upload === null
    || !('mimeType' in upload)
    || upload.mimeType !== resource.inspection.mimeType
    || !('byteSize' in upload)
    || upload.byteSize !== resource.bytes.byteLength
    || !('sha256' in upload)
    || upload.sha256 !== resource.sha256
    || !('objectKey' in upload)
    || upload.objectKey !== expectedObjectKey
  ) {
    return fail(
      'upload-manifest-mismatch',
      `Managed upload manifest does not match verified image ${resource.sha256}.`,
    );
  }
  return expectedObjectKey;
};

/**
 * Materializes validated XMind package rasters into durable managed Assets.
 *
 * The candidate and caller-owned byte arrays are never mutated. All package
 * resources are preflighted before the first upload; the cloned document is
 * changed only after every unique SHA-256 upload has returned a strict,
 * content-addressed manifest.
 */
export const materializeXMindEmbeddedResources = async (
  input: MaterializeXMindEmbeddedResourcesInput,
): Promise<MaterializedXMindEmbeddedResources> => {
  throwIfAborted(input.signal);
  const initialValidation = validateMindMapDocument(input.candidate);
  if (!initialValidation.valid) {
    return fail(
      'invalid-candidate',
      `XMind materialization candidate is invalid: ${initialValidation.issues[0]?.code ?? 'unknown'}.`,
    );
  }

  // Work from an immutable snapshot so caller changes during upload cannot
  // alter the set of references or the document eventually returned.
  const document = structuredClone(input.candidate);
  const referencedAssetIds = referencedImageAssetIds(document);
  const embeddedAssets = [...referencedAssetIds]
    .map((assetId) => document.assets[assetId])
    .filter((asset): asset is Asset => asset?.source.kind === 'embedded')
    .sort((left, right) => String(left.id).localeCompare(String(right.id), 'en-US'));

  const verifiedAssets: VerifiedAssetResource[] = [];
  const uniqueResources = new Map<string, UniqueVerifiedResource>();
  let totalBytes = 0;
  const hashSha256 = input.hashSha256 ?? sha256WithWebCrypto;

  for (const asset of embeddedAssets) {
    throwIfAborted(input.signal);
    const verified = await verifyAssetResource(
      asset,
      input.resourceBytes,
      hashSha256,
      input.signal,
    );
    verifiedAssets.push(verified);
    if (!uniqueResources.has(verified.sha256)) {
      uniqueResources.set(verified.sha256, {
        bytes: verified.bytes,
        inspection: verified.inspection,
        sha256: verified.sha256,
      });
      if (uniqueResources.size > XMIND_IMAGE_RESOURCE_MAX_COUNT) {
        return fail(
          'too-many-resources',
          `XMind image materialization exceeds ${XMIND_IMAGE_RESOURCE_MAX_COUNT} distinct resources.`,
        );
      }
      totalBytes += verified.bytes.byteLength;
      if (totalBytes > XMIND_MATERIALIZATION_TOTAL_MAX_BYTES) {
        return fail(
          'total-bytes-exceeded',
          'XMind image materialization exceeds the 128MiB aggregate byte limit.',
        );
      }
    }
  }

  const objectKeysBySha256 = new Map<string, string>();
  for (const resource of uniqueResources.values()) {
    throwIfAborted(input.signal);
    const file = new File(
      [Uint8Array.from(resource.bytes).buffer],
      `${resource.sha256}.${resource.inspection.extension}`,
      { type: resource.inspection.mimeType },
    );
    let upload: XMindImageUploadResult;
    try {
      upload = await input.uploadImage(file, { signal: input.signal });
    } catch (error) {
      throwIfAborted(input.signal);
      return fail(
        'upload-failed',
        `Failed to upload verified XMind image ${resource.sha256}.`,
        { originalError: error },
      );
    }
    throwIfAborted(input.signal);
    objectKeysBySha256.set(resource.sha256, verifyUploadManifest(upload, resource));
  }

  const verifiedResourceBytes = {} as Record<AssetId, Uint8Array>;
  for (const verified of verifiedAssets) {
    const asset = document.assets[verified.assetId];
    const objectKey = objectKeysBySha256.get(verified.sha256);
    if (!asset || asset.source.kind !== 'embedded' || objectKey === undefined) {
      return fail(
        'invalid-materialized-document',
        `Materialized image Asset ${verified.assetId} disappeared from the cloned candidate.`,
      );
    }
    asset.source = { kind: 'managed', objectKey };
    verifiedResourceBytes[verified.assetId] = Uint8Array.from(verified.bytes);
  }

  const finalValidation = validateMindMapDocument(document);
  if (!finalValidation.valid) {
    return fail(
      'invalid-materialized-document',
      `Managed XMind candidate is invalid: ${finalValidation.issues[0]?.code ?? 'unknown'}.`,
    );
  }
  return {
    document,
    ...(verifiedAssets.length === 0 ? {} : { verifiedResourceBytes }),
  };
};
