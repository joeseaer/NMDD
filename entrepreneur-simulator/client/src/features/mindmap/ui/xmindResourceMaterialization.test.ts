// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMindMapBlockDocument } from '../domain/createDocument';
import type {
  Asset,
  AssetId,
  Id,
  ImageId,
  MindMapDocumentV1,
  OrderKey,
  SheetId,
} from '../domain/types';
import { validateMindMapDocument } from '../domain/validation';
import { XMIND_IMAGE_RESOURCE_MAX_BYTES } from '../io/xmindImages';
import {
  materializeXMindEmbeddedResources,
  XMIND_MATERIALIZATION_TOTAL_MAX_BYTES,
  type XMindImageUpload,
} from './xmindResourceMaterialization';

afterEach(() => vi.unstubAllGlobals());

interface RasterCase {
  readonly bytes: Uint8Array;
  readonly extension: 'gif' | 'jpg' | 'png' | 'webp';
  readonly mimeType: 'image/gif' | 'image/jpeg' | 'image/png' | 'image/webp';
  readonly sha256: string;
}

const RASTERS: readonly RasterCase[] = [
  {
    bytes: Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 2, 0, 0, 0, 3,
    ]),
    extension: 'png',
    mimeType: 'image/png',
    sha256: 'db42d7b740a36256f694172427189b90e7d94a9abebab81435bf4bb3d7b9bf9d',
  },
  {
    bytes: Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 4, 0, 5, 0]),
    extension: 'gif',
    mimeType: 'image/gif',
    sha256: '1f9fbbeb7ec4b69e2fb495cd955d94adb0471e7f85084cf9888a21b9c668b981',
  },
  {
    bytes: Uint8Array.from([
      0xff, 0xd8, 0xff, 0xc0, 0, 11, 8, 0, 6, 0, 7, 3, 1, 0x11, 0,
    ]),
    extension: 'jpg',
    mimeType: 'image/jpeg',
    sha256: '3734c41d97c44b32cc03ceb03a088725cf85d9c98d4815bf7ae1da768929ac8a',
  },
  {
    bytes: Uint8Array.from([
      0x52, 0x49, 0x46, 0x46, 22, 0, 0, 0,
      0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58,
      10, 0, 0, 0, 0, 0, 0, 0, 7, 0, 0, 8, 0, 0,
    ]),
    extension: 'webp',
    mimeType: 'image/webp',
    sha256: 'fef115ed9347735d48b4dcba75ad62d7f9f59972b0a0d745b32c9236b6b8a42a',
  },
];

const id = <K extends string>(counter: number): Id<K> => (
  `018f1000-0000-7000-8000-${counter.toString(16).padStart(12, '0')}` as Id<K>
);

interface Fixture {
  readonly document: MindMapDocumentV1;
  readonly sheetId: SheetId;
}

const createFixture = (): Fixture => {
  const document = createMindMapBlockDocument();
  const sheetId = Object.keys(document.sheets)[0] as SheetId;
  return { document, sheetId };
};

interface AddAssetInput {
  readonly assetCounter: number;
  readonly bytes: Uint8Array;
  readonly imageCounter?: number;
  readonly mimeType: string;
  readonly path: string;
  readonly referenced?: boolean;
  readonly sha256: string;
}

const addEmbeddedAsset = (fixture: Fixture, input: AddAssetInput): AssetId => {
  const assetId = id<'Asset'>(input.assetCounter) as AssetId;
  const asset: Asset = {
    id: assetId,
    fileName: input.path.split('/').slice(-1)[0] ?? 'image.png',
    mimeType: input.mimeType,
    byteSize: input.bytes.byteLength,
    sha256: input.sha256,
    source: { kind: 'embedded', relativePath: input.path },
  };
  fixture.document.assets[assetId] = asset;
  if (input.referenced !== false) {
    const sheet = fixture.document.sheets[fixture.sheetId];
    const imageId = id<'Image'>(input.imageCounter ?? input.assetCounter + 10_000) as ImageId;
    sheet.images[imageId] = {
      id: imageId,
      topicId: sheet.rootTopicId,
      assetId,
      orderKey: `image-${input.assetCounter.toString(36).padStart(6, '0')}` as OrderKey,
      role: 'inline',
      placement: { side: 'top', align: 'center', offset: { x: 0, y: 0 } },
    };
  }
  return assetId;
};

const successfulUpload = (): XMindImageUpload => vi.fn(async (file) => {
  const match = /^([a-f0-9]{64})\.(gif|jpg|png|webp)$/.exec(file.name);
  if (!match) throw new Error('Unexpected content-addressed file name.');
  return {
    objectKey: `mindmap-images/sha256/${file.name}`,
    mimeType: file.type,
    byteSize: file.size,
    sha256: match[1],
  };
});

const hashFromRasterCases = async (bytes: Uint8Array): Promise<string> => {
  const match = RASTERS.find((item) => (
    item.bytes.length === bytes.length
    && item.bytes.every((value, index) => value === bytes[index])
  ));
  if (!match) throw new Error('Unexpected test bytes.');
  return match.sha256;
};

describe('XMind embedded image materialization', () => {
  it('materializes PNG, JPEG, GIF, and WebP with verified AssetId export bytes', async () => {
    const fixture = createFixture();
    const resourceBytes: Record<string, Uint8Array> = {};
    const assetIds: AssetId[] = [];
    for (const [index, raster] of RASTERS.entries()) {
      const path = `Resources/materialize-${index}.${raster.extension}`;
      assetIds.push(addEmbeddedAsset(fixture, {
        assetCounter: 100 + index,
        bytes: raster.bytes,
        mimeType: raster.mimeType,
        path,
        sha256: raster.sha256,
      }));
      resourceBytes[path] = raster.bytes;
    }
    expect(validateMindMapDocument(fixture.document).valid).toBe(true);
    const before = structuredClone(fixture.document);
    const uploadImage = successfulUpload();
    const controller = new AbortController();

    const result = await materializeXMindEmbeddedResources({
      candidate: fixture.document,
      resourceBytes,
      uploadImage,
      signal: controller.signal,
      hashSha256: hashFromRasterCases,
    });

    expect(uploadImage).toHaveBeenCalledTimes(4);
    expect(result.document).not.toBe(fixture.document);
    expect(validateMindMapDocument(result.document).valid).toBe(true);
    for (const [index, assetId] of assetIds.entries()) {
      const raster = RASTERS[index];
      expect(result.document.assets[assetId].source).toEqual({
        kind: 'managed',
        objectKey: `mindmap-images/sha256/${raster.sha256}.${raster.extension}`,
      });
      expect(result.verifiedResourceBytes?.[assetId]).toEqual(raster.bytes);
      expect(result.verifiedResourceBytes?.[assetId]).not.toBe(raster.bytes);
    }
    expect(fixture.document).toEqual(before);
  });

  it('uses WebCrypto SHA-256 when no hash seam is supplied', async () => {
    const fixture = createFixture();
    const raster = RASTERS[0];
    const path = 'Resources/webcrypto.png';
    addEmbeddedAsset(fixture, {
      assetCounter: 200,
      bytes: raster.bytes,
      mimeType: raster.mimeType,
      path,
      sha256: raster.sha256,
    });
    const digest = Uint8Array.from(
      raster.sha256.match(/.{2}/g)?.map((part) => Number.parseInt(part, 16)) ?? [],
    );
    const subtleDigest = vi.fn(async () => Uint8Array.from(digest).buffer);
    vi.stubGlobal('crypto', { subtle: { digest: subtleDigest } });

    await materializeXMindEmbeddedResources({
      candidate: fixture.document,
      resourceBytes: { [path]: raster.bytes },
      uploadImage: successfulUpload(),
      signal: new AbortController().signal,
    });

    expect(subtleDigest).toHaveBeenCalledWith('SHA-256', expect.any(ArrayBuffer));
  });

  it('deduplicates uploads by canonical SHA while preserving bytes for both Asset IDs', async () => {
    const fixture = createFixture();
    const raster = RASTERS[0];
    const firstPath = 'Resources/duplicate-a.png';
    const secondPath = 'Resources/duplicate-b.png';
    const firstId = addEmbeddedAsset(fixture, {
      assetCounter: 300,
      bytes: raster.bytes,
      mimeType: raster.mimeType,
      path: firstPath,
      sha256: raster.sha256,
    });
    const secondId = addEmbeddedAsset(fixture, {
      assetCounter: 301,
      bytes: raster.bytes,
      mimeType: raster.mimeType,
      path: secondPath,
      sha256: raster.sha256,
    });
    const uploadImage = successfulUpload();

    const result = await materializeXMindEmbeddedResources({
      candidate: fixture.document,
      resourceBytes: {
        [firstPath]: raster.bytes,
        [secondPath]: Uint8Array.from(raster.bytes),
      },
      uploadImage,
      signal: new AbortController().signal,
      hashSha256: async () => raster.sha256,
    });

    expect(uploadImage).toHaveBeenCalledTimes(1);
    expect(result.document.assets[firstId].source)
      .toEqual(result.document.assets[secondId].source);
    expect(result.verifiedResourceBytes?.[firstId]).toEqual(raster.bytes);
    expect(result.verifiedResourceBytes?.[secondId]).toEqual(raster.bytes);
  });

  it('ignores unreferenced embedded Assets and referenced non-embedded Assets', async () => {
    const fixture = createFixture();
    const raster = RASTERS[0];
    const usedPath = 'Resources/used.png';
    const usedId = addEmbeddedAsset(fixture, {
      assetCounter: 400,
      bytes: raster.bytes,
      mimeType: raster.mimeType,
      path: usedPath,
      sha256: raster.sha256,
    });
    const unusedId = addEmbeddedAsset(fixture, {
      assetCounter: 401,
      bytes: raster.bytes,
      mimeType: raster.mimeType,
      path: 'Resources/not-supplied.png',
      referenced: false,
      sha256: raster.sha256,
    });
    const remoteId = addEmbeddedAsset(fixture, {
      assetCounter: 402,
      bytes: raster.bytes,
      mimeType: raster.mimeType,
      path: 'Resources/remote.png',
      sha256: raster.sha256,
    });
    fixture.document.assets[remoteId].source = {
      kind: 'remote',
      url: 'https://assets.example.test/image.png',
    };
    const uploadImage = successfulUpload();

    const result = await materializeXMindEmbeddedResources({
      candidate: fixture.document,
      resourceBytes: { [usedPath]: raster.bytes },
      uploadImage,
      signal: new AbortController().signal,
      hashSha256: async () => raster.sha256,
    });

    expect(uploadImage).toHaveBeenCalledTimes(1);
    expect(result.document.assets[usedId].source.kind).toBe('managed');
    expect(result.document.assets[unusedId].source).toEqual({
      kind: 'embedded',
      relativePath: 'Resources/not-supplied.png',
    });
    expect(result.document.assets[remoteId].source.kind).toBe('remote');
    expect(result.verifiedResourceBytes).toEqual({ [usedId]: raster.bytes });
  });

  it.each([
    ['missing-resource', 'missing bytes', (fixture: Fixture, assetId: AssetId) => {
      const path = (fixture.document.assets[assetId].source as { relativePath: string }).relativePath;
      return { resourceBytes: { [`${path}.near-match`]: RASTERS[0].bytes } };
    }],
    ['unsupported-raster', 'spoofed raster', (fixture: Fixture, assetId: AssetId) => {
      const asset = fixture.document.assets[assetId];
      const path = (asset.source as { relativePath: string }).relativePath;
      const spoof = Uint8Array.from([0x3c, 0x73, 0x76, 0x67, 0x3e]);
      asset.byteSize = spoof.byteLength;
      return { resourceBytes: { [path]: spoof } };
    }],
    ['mime-mismatch', 'MIME mismatch', (fixture: Fixture, assetId: AssetId) => {
      fixture.document.assets[assetId].mimeType = 'image/gif';
      const path = (fixture.document.assets[assetId].source as { relativePath: string }).relativePath;
      return { resourceBytes: { [path]: RASTERS[0].bytes } };
    }],
    ['byte-size-mismatch', 'byte-size mismatch', (fixture: Fixture, assetId: AssetId) => {
      fixture.document.assets[assetId].byteSize += 1;
      const path = (fixture.document.assets[assetId].source as { relativePath: string }).relativePath;
      return { resourceBytes: { [path]: RASTERS[0].bytes } };
    }],
    ['sha256-mismatch', 'SHA mismatch', (fixture: Fixture, assetId: AssetId) => {
      fixture.document.assets[assetId].sha256 = 'a'.repeat(64);
      const path = (fixture.document.assets[assetId].source as { relativePath: string }).relativePath;
      return { resourceBytes: { [path]: RASTERS[0].bytes } };
    }],
  ] as const)('rejects %s for %s before upload', async (code, _label, mutate) => {
    const fixture = createFixture();
    const raster = RASTERS[0];
    const assetId = addEmbeddedAsset(fixture, {
      assetCounter: 500,
      bytes: raster.bytes,
      mimeType: raster.mimeType,
      path: 'Resources/strict.png',
      sha256: raster.sha256,
    });
    const { resourceBytes } = mutate(fixture, assetId);
    const before = structuredClone(fixture.document);
    const uploadImage = successfulUpload();

    await expect(materializeXMindEmbeddedResources({
      candidate: fixture.document,
      resourceBytes,
      uploadImage,
      signal: new AbortController().signal,
      hashSha256: async () => raster.sha256,
    })).rejects.toMatchObject({ code });
    expect(uploadImage).not.toHaveBeenCalled();
    expect(fixture.document).toEqual(before);
  });

  it('rejects an unsafe embedded path instead of normalizing it to supplied bytes', async () => {
    const fixture = createFixture();
    const raster = RASTERS[0];
    addEmbeddedAsset(fixture, {
      assetCounter: 600,
      bytes: raster.bytes,
      mimeType: raster.mimeType,
      path: 'Resources/../secret.png',
      sha256: raster.sha256,
    });
    expect(validateMindMapDocument(fixture.document).valid).toBe(true);

    await expect(materializeXMindEmbeddedResources({
      candidate: fixture.document,
      resourceBytes: { 'Resources/secret.png': raster.bytes },
      uploadImage: successfulUpload(),
      signal: new AbortController().signal,
      hashSha256: async () => raster.sha256,
    })).rejects.toMatchObject({ code: 'unsafe-resource-path' });
  });

  it('rejects oversized individual resources before copying, hashing, or uploading', async () => {
    const fixture = createFixture();
    const bytes = new Uint8Array(XMIND_IMAGE_RESOURCE_MAX_BYTES + 1);
    bytes.set(RASTERS[0].bytes);
    const path = 'Resources/oversized.png';
    addEmbeddedAsset(fixture, {
      assetCounter: 700,
      bytes,
      mimeType: 'image/png',
      path,
      sha256: 'a'.repeat(64),
    });
    const hashSha256 = vi.fn(async () => 'a'.repeat(64));
    const uploadImage = successfulUpload();

    await expect(materializeXMindEmbeddedResources({
      candidate: fixture.document,
      resourceBytes: { [path]: bytes },
      uploadImage,
      signal: new AbortController().signal,
      hashSha256,
    })).rejects.toMatchObject({ code: 'resource-too-large' });
    expect(hashSha256).not.toHaveBeenCalled();
    expect(uploadImage).not.toHaveBeenCalled();
  });

  it('enforces 512 distinct verified SHA resources before upload', async () => {
    const fixture = createFixture();
    const raster = RASTERS[0];
    const resourceBytes: Record<string, Uint8Array> = {};
    const hashes: string[] = [];
    for (let index = 0; index < 513; index += 1) {
      const path = `Resources/count-${index}.png`;
      const sha256 = (index + 1).toString(16).padStart(64, '0');
      hashes.push(sha256);
      addEmbeddedAsset(fixture, {
        assetCounter: 10_000 + index,
        imageCounter: 20_000 + index,
        bytes: raster.bytes,
        mimeType: raster.mimeType,
        path,
        sha256,
      });
      resourceBytes[path] = raster.bytes;
    }
    let hashIndex = 0;
    const uploadImage = successfulUpload();

    await expect(materializeXMindEmbeddedResources({
      candidate: fixture.document,
      resourceBytes,
      uploadImage,
      signal: new AbortController().signal,
      hashSha256: async () => hashes[hashIndex++],
    })).rejects.toMatchObject({ code: 'too-many-resources' });
    expect(uploadImage).not.toHaveBeenCalled();
  });

  it('enforces the 128MiB aggregate limit across distinct SHA resources', async () => {
    const fixture = createFixture();
    const resourceLength = Math.floor(XMIND_MATERIALIZATION_TOTAL_MAX_BYTES / 9) + 1;
    expect(resourceLength).toBeLessThanOrEqual(XMIND_IMAGE_RESOURCE_MAX_BYTES);
    const sharedBytes = new Uint8Array(resourceLength);
    sharedBytes.set(RASTERS[0].bytes);
    const resourceBytes: Record<string, Uint8Array> = {};
    const hashes: string[] = [];
    for (let index = 0; index < 9; index += 1) {
      const path = `Resources/aggregate-${index}.png`;
      const sha256 = (index + 100).toString(16).padStart(64, '0');
      hashes.push(sha256);
      addEmbeddedAsset(fixture, {
        assetCounter: 30_000 + index,
        imageCounter: 40_000 + index,
        bytes: sharedBytes,
        mimeType: 'image/png',
        path,
        sha256,
      });
      resourceBytes[path] = sharedBytes;
    }
    let hashIndex = 0;
    const uploadImage = successfulUpload();

    await expect(materializeXMindEmbeddedResources({
      candidate: fixture.document,
      resourceBytes,
      uploadImage,
      signal: new AbortController().signal,
      hashSha256: async () => hashes[hashIndex++],
    })).rejects.toMatchObject({ code: 'total-bytes-exceeded' });
    expect(uploadImage).not.toHaveBeenCalled();
  });

  it.each([
    ['MIME', (manifest: Record<string, unknown>) => ({ ...manifest, mimeType: 'image/gif' })],
    ['byte size', (manifest: Record<string, unknown>) => ({ ...manifest, byteSize: 1 })],
    ['SHA', (manifest: Record<string, unknown>) => ({ ...manifest, sha256: 'a'.repeat(64) })],
    ['object key', (manifest: Record<string, unknown>) => ({
      ...manifest,
      objectKey: `mindmap-images/sha256/${RASTERS[0].sha256}.svg`,
    })],
  ] as const)('rejects an upload %s mismatch without mutating input', async (_label, mutate) => {
    const fixture = createFixture();
    const raster = RASTERS[0];
    const path = 'Resources/manifest.png';
    addEmbeddedAsset(fixture, {
      assetCounter: 800,
      bytes: raster.bytes,
      mimeType: raster.mimeType,
      path,
      sha256: raster.sha256,
    });
    const before = structuredClone(fixture.document);
    const baseManifest = {
      objectKey: `mindmap-images/sha256/${raster.sha256}.png`,
      mimeType: raster.mimeType,
      byteSize: raster.bytes.byteLength,
      sha256: raster.sha256,
    };

    await expect(materializeXMindEmbeddedResources({
      candidate: fixture.document,
      resourceBytes: { [path]: raster.bytes },
      uploadImage: vi.fn(async () => mutate(baseManifest) as never),
      signal: new AbortController().signal,
      hashSha256: async () => raster.sha256,
    })).rejects.toMatchObject({ code: 'upload-manifest-mismatch' });
    expect(fixture.document).toEqual(before);
  });

  it('maps a hashing runtime failure without uploading or mutating input', async () => {
    const fixture = createFixture();
    const raster = RASTERS[0];
    const path = 'Resources/hash-runtime.png';
    addEmbeddedAsset(fixture, {
      assetCounter: 850,
      bytes: raster.bytes,
      mimeType: raster.mimeType,
      path,
      sha256: raster.sha256,
    });
    const before = structuredClone(fixture.document);
    const uploadImage = successfulUpload();

    await expect(materializeXMindEmbeddedResources({
      candidate: fixture.document,
      resourceBytes: { [path]: raster.bytes },
      uploadImage,
      signal: new AbortController().signal,
      hashSha256: vi.fn(async () => { throw new Error('hash provider unavailable'); }),
    })).rejects.toMatchObject({ code: 'hash-unavailable' });
    expect(uploadImage).not.toHaveBeenCalled();
    expect(fixture.document).toEqual(before);
  });

  it('rejects a missing upload manifest object deterministically', async () => {
    const fixture = createFixture();
    const raster = RASTERS[0];
    const path = 'Resources/missing-manifest.png';
    addEmbeddedAsset(fixture, {
      assetCounter: 875,
      bytes: raster.bytes,
      mimeType: raster.mimeType,
      path,
      sha256: raster.sha256,
    });

    await expect(materializeXMindEmbeddedResources({
      candidate: fixture.document,
      resourceBytes: { [path]: raster.bytes },
      uploadImage: vi.fn(async () => null as never),
      signal: new AbortController().signal,
      hashSha256: async () => raster.sha256,
    })).rejects.toMatchObject({ code: 'upload-manifest-mismatch' });
  });

  it('honors abort before work and after an in-flight upload resolves', async () => {
    const fixture = createFixture();
    const raster = RASTERS[0];
    const path = 'Resources/abort.png';
    addEmbeddedAsset(fixture, {
      assetCounter: 900,
      bytes: raster.bytes,
      mimeType: raster.mimeType,
      path,
      sha256: raster.sha256,
    });
    const before = structuredClone(fixture.document);

    const preAborted = new AbortController();
    preAborted.abort();
    const neverUpload = successfulUpload();
    await expect(materializeXMindEmbeddedResources({
      candidate: fixture.document,
      resourceBytes: { [path]: raster.bytes },
      uploadImage: neverUpload,
      signal: preAborted.signal,
      hashSha256: async () => raster.sha256,
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(neverUpload).not.toHaveBeenCalled();

    const duringUpload = new AbortController();
    const uploadImage: XMindImageUpload = vi.fn(async (file) => {
      duringUpload.abort();
      return {
        objectKey: `mindmap-images/sha256/${file.name}`,
        mimeType: file.type,
        byteSize: file.size,
        sha256: raster.sha256,
      };
    });
    await expect(materializeXMindEmbeddedResources({
      candidate: fixture.document,
      resourceBytes: { [path]: raster.bytes },
      uploadImage,
      signal: duringUpload.signal,
      hashSha256: async () => raster.sha256,
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(fixture.document).toEqual(before);
  });

  it('rejects an invalid initial candidate before hashing or upload', async () => {
    const fixture = createFixture();
    delete fixture.document.sheets[fixture.sheetId]
      .topics[fixture.document.sheets[fixture.sheetId].rootTopicId];
    const hashSha256 = vi.fn(async () => RASTERS[0].sha256);
    const uploadImage = successfulUpload();

    await expect(materializeXMindEmbeddedResources({
      candidate: fixture.document,
      resourceBytes: {},
      uploadImage,
      signal: new AbortController().signal,
      hashSha256,
    })).rejects.toMatchObject({ code: 'invalid-candidate' });
    expect(hashSha256).not.toHaveBeenCalled();
    expect(uploadImage).not.toHaveBeenCalled();
  });
});
