// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMindMapBlockDocument } from '../domain/createDocument';
import type { AssetId, ImageId, SheetId } from '../domain/types';
import { builtInStickerById } from './stickerCatalog';
import {
  planBuiltInStickerIngest,
  StickerIngestError,
  verifyBuiltInStickerAsset,
} from './stickerIngest';

const ASSET_ID = '018f0000-0000-7000-8000-00000000fa01' as AssetId;
const IMAGE_ID = '018f0000-0000-7000-8000-00000000fa02' as ImageId;

const setup = () => {
  const document = createMindMapBlockDocument();
  const sheetId = Object.keys(document.sheets)[0] as SheetId;
  return { document, sheetId, topicId: document.sheets[sheetId].rootTopicId };
};

const pngResponse = () => new Response(new Blob(['png-data'], { type: 'image/png' }), {
  status: 200,
  headers: { 'content-type': 'image/png' },
});

afterEach(() => vi.unstubAllGlobals());

describe('built-in sticker ingest', () => {
  it('fetches the first-party asset and produces one managed sticker create command', async () => {
    const { document, sheetId, topicId } = setup();
    const before = structuredClone(document);
    const fetchAsset = vi.fn(async () => pngResponse());
    const verifyAsset = vi.fn(async () => undefined);
    const upload = vi.fn(async (file: File) => ({
      url: 'https://assets.example.test/sticker.png',
      objectKey: `mindmap-images/sha256/${'a'.repeat(64)}.png`,
      fileName: file.name,
      mimeType: file.type,
      byteSize: file.size,
      sha256: 'a'.repeat(64),
    }));

    const planned = await planBuiltInStickerIngest({
      stickerId: 'idea-lightbulb',
      readOnly: false,
      sheetId,
      topicId,
      getDocument: () => document,
      fetchAsset,
      verifyAsset,
      upload,
      decode: vi.fn(async () => ({ width: 1_254, height: 1_254 })),
      createAssetId: () => ASSET_ID,
      createImageId: () => IMAGE_ID,
    });

    expect(fetchAsset).toHaveBeenCalledWith('/mindmap/stickers/lightbulb-84.png', {
      credentials: 'same-origin',
      signal: undefined,
    });
    expect(verifyAsset).toHaveBeenCalledOnce();
    expect(planned.command.type).toBe('image.create');
    expect(planned.asset.source).toEqual({
      kind: 'managed',
      objectKey: `mindmap-images/sha256/${'a'.repeat(64)}.png`,
    });
    expect(planned.asset.extensions).toMatchObject({
      'app.nmdd.catalog-item-id': 'idea-lightbulb',
      'app.nmdd.catalog-manifest-version': 1,
      'app.nmdd.catalog-license-spdx': 'ISC',
      'app.nmdd.catalog-provenance': 'licensed-lucide-isc-derived',
      'app.nmdd.catalog-xmind-compatibility': 'canonical-fallback-only',
    });
    expect(planned.asset.extensions?.['app.nmdd.catalog-manifest-sha256'])
      .toMatch(/^[a-f0-9]{64}$/u);
    expect(planned.image).toMatchObject({
      id: IMAGE_ID,
      role: 'sticker',
      placement: { side: 'top', align: 'center', offset: { x: 0, y: 0 } },
      size: { width: 84, height: 84 },
      alt: '灵感灯泡',
    });
    expect(document).toEqual(before);
  });

  it('rejects read-only before fetching or uploading', async () => {
    const { document, sheetId, topicId } = setup();
    const fetchAsset = vi.fn(async () => pngResponse());
    const upload = vi.fn();

    await expect(planBuiltInStickerIngest({
      stickerId: 'idea-lightbulb',
      readOnly: true,
      sheetId,
      topicId,
      getDocument: () => document,
      fetchAsset,
      upload,
    })).rejects.toEqual(expect.objectContaining<Partial<StickerIngestError>>({
      code: 'read-only',
    }));
    expect(fetchAsset).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it('rejects non-PNG catalog responses before upload and preserves canonical data', async () => {
    const { document, sheetId, topicId } = setup();
    const before = structuredClone(document);
    const upload = vi.fn();

    await expect(planBuiltInStickerIngest({
      stickerId: 'idea-lightbulb',
      readOnly: false,
      sheetId,
      topicId,
      getDocument: () => document,
      fetchAsset: vi.fn(async () => new Response('<svg/>', {
        status: 200,
        headers: { 'content-type': 'image/svg+xml' },
      })),
      upload,
    })).rejects.toMatchObject({ code: 'asset-invalid' });
    expect(upload).not.toHaveBeenCalled();
    expect(document).toEqual(before);
  });

  it('verifies release byte size, PNG dimensions, and SHA-256 before upload', async () => {
    const descriptor = builtInStickerById('idea-lightbulb');
    if (!descriptor) throw new Error('Missing lightbulb catalog fixture.');
    const expectedDigest = Uint8Array.from(
      descriptor.sha256.match(/.{2}/gu) ?? [],
      (pair) => Number.parseInt(pair, 16),
    );
    const digest = vi.fn()
      .mockResolvedValueOnce(expectedDigest.buffer)
      .mockResolvedValueOnce(new Uint8Array(32).buffer);
    vi.stubGlobal('crypto', { subtle: { digest } });
    const bytes = new Uint8Array(descriptor.byteSize);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    bytes.set([0x49, 0x48, 0x44, 0x52], 12);
    const view = new DataView(bytes.buffer);
    view.setUint32(16, descriptor.intrinsicSize.width);
    view.setUint32(20, descriptor.intrinsicSize.height);
    await expect(verifyBuiltInStickerAsset(
      new Blob([bytes], { type: 'image/png' }),
      descriptor,
    )).resolves.toBeUndefined();

    const tampered = Uint8Array.from(bytes);
    tampered[tampered.length - 1] ^= 0xff;
    await expect(verifyBuiltInStickerAsset(
      new Blob([tampered], { type: 'image/png' }),
      descriptor,
    )).rejects.toMatchObject({ code: 'asset-invalid' });
    expect(digest).toHaveBeenCalledTimes(2);
  });
});
