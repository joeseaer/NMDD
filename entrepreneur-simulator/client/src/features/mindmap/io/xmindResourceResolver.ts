import type { Asset, AssetId, MindMapDocumentV1 } from '../domain/types';
import {
  hasSignedRemoteCredential,
  inspectXMindRaster,
  XMIND_IMAGE_RESOURCE_MAX_BYTES,
  XMIND_IMAGE_RESOURCE_MAX_COUNT,
} from './xmindImages';

export const XMIND_EXPORT_RESOURCE_TOTAL_MAX_BYTES = 128 * 1024 * 1024;

export class XMindManagedResourceUnavailableError extends Error {
  readonly assetId: AssetId;

  constructor(assetId: AssetId) {
    super(`Managed image resource ${assetId} is unavailable or failed integrity validation.`);
    this.name = 'XMindManagedResourceUnavailableError';
    this.assetId = assetId;
  }
}

export type XMindResourceSha256 = (bytes: Uint8Array) => Promise<string>;
export type XMindManagedResourceReader = (
  objectKey: string,
  options: { readonly signal: AbortSignal },
) => Promise<Uint8Array>;

export interface ResolveXMindExportResourceBytesInput {
  readonly document: MindMapDocumentV1;
  readonly signal: AbortSignal;
  /** Extra canonical image uses (for example a static-export canvas background). */
  readonly additionalAssetIds?: readonly AssetId[];
  readonly resourceBytes?: Readonly<Record<string, Uint8Array>>;
  readonly readManagedResource: XMindManagedResourceReader;
  readonly fetchRemote?: typeof fetch;
  /** Deterministic test seam; production uses WebCrypto SHA-256. */
  readonly hashSha256?: XMindResourceSha256;
}

const throwIfAborted = (signal: AbortSignal): void => {
  if (signal.aborted) throw new DOMException('XMind export resource resolution was aborted.', 'AbortError');
};

const hashWithWebCrypto: XMindResourceSha256 = async (bytes) => {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('WebCrypto SHA-256 is unavailable.');
  const digest = new Uint8Array(await subtle.digest('SHA-256', Uint8Array.from(bytes).buffer));
  return [...digest].map((value) => value.toString(16).padStart(2, '0')).join('');
};

const referencedImageAssets = (
  document: MindMapDocumentV1,
  additionalAssetIds: readonly AssetId[] = [],
): readonly Asset[] => {
  const ids = new Set<AssetId>();
  for (const sheet of Object.values(document.sheets)) {
    for (const image of Object.values(sheet.images)) ids.add(image.assetId);
  }
  for (const assetId of additionalAssetIds) ids.add(assetId);
  return [...ids]
    .map((id) => document.assets[id])
    .filter((asset): asset is Asset => asset !== undefined)
    .sort((left, right) => String(left.id).localeCompare(String(right.id), 'en-US'));
};

const sidecarBytesForAsset = (
  resourceBytes: Readonly<Record<string, Uint8Array>> | undefined,
  asset: Readonly<Asset>,
): Uint8Array | undefined => {
  if (!resourceBytes) return undefined;
  const byId = resourceBytes[asset.id];
  if (byId instanceof Uint8Array) return byId;
  if (asset.source.kind === 'embedded') {
    const byPath = resourceBytes[asset.source.relativePath];
    if (byPath instanceof Uint8Array) return byPath;
  }
  return undefined;
};

const verifiedAssetBytes = async (
  asset: Readonly<Asset>,
  candidate: Uint8Array,
  hashSha256: XMindResourceSha256,
  signal: AbortSignal,
): Promise<Uint8Array | undefined> => {
  if (
    candidate.byteLength <= 0
    || candidate.byteLength > XMIND_IMAGE_RESOURCE_MAX_BYTES
    || candidate.byteLength !== asset.byteSize
  ) return undefined;
  const bytes = Uint8Array.from(candidate);
  const inspection = inspectXMindRaster(bytes);
  if (!inspection || inspection.mimeType !== asset.mimeType) return undefined;
  if (
    asset.intrinsicSize
    && (
      inspection.intrinsicSize?.width !== asset.intrinsicSize.width
      || inspection.intrinsicSize?.height !== asset.intrinsicSize.height
    )
  ) return undefined;
  throwIfAborted(signal);
  const sha256 = await hashSha256(bytes);
  throwIfAborted(signal);
  return sha256 === asset.sha256 ? bytes : undefined;
};

const remoteBytes = async (
  asset: Readonly<Asset>,
  fetchRemote: typeof fetch | undefined,
  signal: AbortSignal,
): Promise<Uint8Array | undefined> => {
  if (
    asset.source.kind !== 'remote'
    || !fetchRemote
    || hasSignedRemoteCredential(asset.source.url)
  ) return undefined;
  try {
    const response = await fetchRemote(asset.source.url, {
      credentials: 'omit',
      mode: 'cors',
      redirect: 'follow',
      referrerPolicy: 'no-referrer',
      signal,
    });
    if (!response.ok) return undefined;
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > XMIND_IMAGE_RESOURCE_MAX_BYTES) {
      return undefined;
    }
    const reader = response.body?.getReader();
    if (!reader) return undefined;
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    try {
      while (true) {
        throwIfAborted(signal);
        const chunk = await reader.read();
        if (chunk.done) break;
        totalBytes += chunk.value.byteLength;
        if (totalBytes > XMIND_IMAGE_RESOURCE_MAX_BYTES) {
          await reader.cancel('Mind-map image resource exceeded the byte limit.');
          return undefined;
        }
        chunks.push(Uint8Array.from(chunk.value));
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    throwIfAborted(signal);
    return bytes;
  } catch (error) {
    throwIfAborted(signal);
    // Remote resources are best effort: CORS, offline, and HTTP failures are
    // represented by the existing XMind export degradation report.
    void error;
    return undefined;
  }
};

/**
 * Resolves only image Assets actually referenced by TopicImage entities plus
 * explicitly requested canonical image uses.
 * Managed resources are mandatory and integrity checked; arbitrary remotes are
 * browser-CORS best effort and are never proxied through the application server.
 */
export const resolveXMindExportResourceBytes = async (
  input: ResolveXMindExportResourceBytesInput,
): Promise<Readonly<Record<string, Uint8Array>> | undefined> => {
  throwIfAborted(input.signal);
  const assets = referencedImageAssets(input.document, input.additionalAssetIds);
  if (assets.length > XMIND_IMAGE_RESOURCE_MAX_COUNT) {
    throw new Error(`XMind export exceeds ${XMIND_IMAGE_RESOURCE_MAX_COUNT} image resources.`);
  }
  const hashSha256 = input.hashSha256 ?? hashWithWebCrypto;
  const result: Record<string, Uint8Array> = {};
  let totalBytes = 0;

  for (const asset of assets) {
    throwIfAborted(input.signal);
    let bytes: Uint8Array | undefined;
    const sidecar = sidecarBytesForAsset(input.resourceBytes, asset);
    if (sidecar) {
      bytes = await verifiedAssetBytes(asset, sidecar, hashSha256, input.signal);
    }

    if (!bytes && asset.source.kind === 'managed') {
      try {
        const managed = await input.readManagedResource(asset.source.objectKey, {
          signal: input.signal,
        });
        bytes = await verifiedAssetBytes(asset, managed, hashSha256, input.signal);
      } catch (error) {
        throwIfAborted(input.signal);
        void error;
      }
      if (!bytes) throw new XMindManagedResourceUnavailableError(asset.id);
    }

    if (!bytes && asset.source.kind === 'remote') {
      const remote = await remoteBytes(asset, input.fetchRemote, input.signal);
      if (remote) bytes = await verifiedAssetBytes(asset, remote, hashSha256, input.signal);
    }

    // Embedded resources without a mounted sidecar and unavailable remote
    // resources remain absent so the codec emits its explicit degradation.
    if (!bytes) continue;
    totalBytes += bytes.byteLength;
    if (totalBytes > XMIND_EXPORT_RESOURCE_TOTAL_MAX_BYTES) {
      throw new Error('XMind export image resources exceed the 128MiB aggregate limit.');
    }
    result[asset.id] = bytes;
  }

  return Object.keys(result).length === 0 ? undefined : Object.freeze(result);
};
