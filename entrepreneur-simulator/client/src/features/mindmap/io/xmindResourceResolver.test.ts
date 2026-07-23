import { describe, expect, it, vi } from 'vitest';

import { createMindMapBlockDocument } from '../domain/createDocument';
import type { AssetId, ImageId, SheetId } from '../domain/types';
import {
  resolveXMindExportResourceBytes,
  XMindManagedResourceUnavailableError,
} from './xmindResourceResolver';
import { XMIND_IMAGE_RESOURCE_MAX_BYTES } from './xmindImages';

const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
]);
const SHA = 'a'.repeat(64);

const fixture = (kind: 'embedded' | 'managed' | 'remote') => {
  const document = createMindMapBlockDocument();
  const sheetId = Object.keys(document.sheets)[0] as SheetId;
  const topicId = document.sheets[sheetId].rootTopicId;
  const assetId = '018f0000-0000-7000-8000-00000000fa01' as AssetId;
  const imageId = '018f0000-0000-7000-8000-00000000fa02' as ImageId;
  const resourceName = `${SHA}.png`;
  document.assets[assetId] = {
    id: assetId,
    fileName: 'pixel.png',
    mimeType: 'image/png',
    byteSize: PNG.byteLength,
    sha256: SHA,
    source: kind === 'embedded'
      ? { kind, relativePath: 'resources/pixel.png' }
      : kind === 'managed'
        ? { kind, objectKey: `mindmap-images/sha256/${resourceName}` }
        : { kind, url: 'https://cdn.example.test/pixel.png' },
    intrinsicSize: { width: 1, height: 1 },
  };
  document.sheets[sheetId].images[imageId] = {
    id: imageId,
    topicId,
    assetId,
    orderKey: 'z',
    role: 'inline',
    placement: { side: 'top', align: 'center', offset: { x: 0, y: 0 } },
  };
  return { assetId, document };
};

const options = () => ({
  signal: new AbortController().signal,
  hashSha256: vi.fn(async () => SHA),
});

describe('resolveXMindExportResourceBytes', () => {
  it('uses verified AssetId sidecar bytes without rereading managed storage', async () => {
    const { assetId, document } = fixture('managed');
    const readManagedResource = vi.fn();
    const result = await resolveXMindExportResourceBytes({
      document,
      resourceBytes: { [assetId]: PNG },
      readManagedResource,
      ...options(),
    });

    expect(result?.[assetId]).toEqual(PNG);
    expect(readManagedResource).not.toHaveBeenCalled();
  });

  it('reads and verifies managed bytes, but blocks export when integrity fails', async () => {
    const { assetId, document } = fixture('managed');
    await expect(resolveXMindExportResourceBytes({
      document,
      readManagedResource: vi.fn(async () => PNG),
      ...options(),
    })).resolves.toMatchObject({ [assetId]: PNG });

    await expect(resolveXMindExportResourceBytes({
      document,
      readManagedResource: vi.fn(async () => Uint8Array.of(1, 2, 3)),
      ...options(),
    })).rejects.toBeInstanceOf(XMindManagedResourceUnavailableError);

    document.assets[assetId].intrinsicSize = { width: 2, height: 1 };
    await expect(resolveXMindExportResourceBytes({
      document,
      readManagedResource: vi.fn(async () => PNG),
      ...options(),
    })).rejects.toBeInstanceOf(XMindManagedResourceUnavailableError);
  });

  it('uses embedded relative-path sidecar bytes and never serializes unrelated entries', async () => {
    const { assetId, document } = fixture('embedded');
    const result = await resolveXMindExportResourceBytes({
      document,
      resourceBytes: {
        'resources/pixel.png': PNG,
        'resources/unreferenced.png': PNG,
      },
      readManagedResource: vi.fn(),
      ...options(),
    });
    expect(result).toEqual({ [assetId]: PNG });
  });

  it('resolves a canvas image background even when it is not a TopicImage', async () => {
    const { assetId, document } = fixture('embedded');
    const sheet = Object.values(document.sheets)[0];
    for (const imageId of Object.keys(sheet.images) as ImageId[]) delete sheet.images[imageId];
    sheet.canvas.background = { kind: 'image', assetId, fit: 'cover' };

    await expect(resolveXMindExportResourceBytes({
      document,
      additionalAssetIds: [assetId],
      resourceBytes: { [assetId]: PNG },
      readManagedResource: vi.fn(),
      ...options(),
    })).resolves.toEqual({ [assetId]: PNG });
  });

  it('fetches safe remotes without credentials and degrades CORS/signed failures', async () => {
    const safe = fixture('remote');
    const fetchRemote = vi.fn(async () => new Response(PNG, {
      status: 200,
      headers: { 'content-length': String(PNG.byteLength) },
    }));
    await expect(resolveXMindExportResourceBytes({
      document: safe.document,
      readManagedResource: vi.fn(),
      fetchRemote,
      ...options(),
    })).resolves.toMatchObject({ [safe.assetId]: PNG });
    expect(fetchRemote).toHaveBeenCalledWith(
      'https://cdn.example.test/pixel.png',
      expect.objectContaining({ credentials: 'omit', mode: 'cors' }),
    );

    const signed = fixture('remote');
    const asset = signed.document.assets[signed.assetId];
    if (asset.source.kind === 'remote') asset.source.url += '?token=secret';
    const noProxy = vi.fn();
    await expect(resolveXMindExportResourceBytes({
      document: signed.document,
      readManagedResource: vi.fn(),
      fetchRemote: noProxy,
      ...options(),
    })).resolves.toBeUndefined();
    expect(noProxy).not.toHaveBeenCalled();

    await expect(resolveXMindExportResourceBytes({
      document: safe.document,
      readManagedResource: vi.fn(),
      fetchRemote: vi.fn(async () => { throw new TypeError('CORS'); }),
      ...options(),
    })).resolves.toBeUndefined();
  });

  it('cancels a streaming remote response as soon as its real body exceeds 15 MiB', async () => {
    const remote = fixture('remote');
    const cancel = vi.fn();
    let pullIndex = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(pullIndex === 0
          ? PNG
          : new Uint8Array(XMIND_IMAGE_RESOURCE_MAX_BYTES));
        pullIndex += 1;
      },
      cancel,
    });

    await expect(resolveXMindExportResourceBytes({
      document: remote.document,
      readManagedResource: vi.fn(),
      fetchRemote: vi.fn(async () => new Response(stream, {
        status: 200,
        headers: { 'content-length': '1' },
      })),
      ...options(),
    })).resolves.toBeUndefined();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('propagates cancellation before any resource read', async () => {
    const { document } = fixture('managed');
    const controller = new AbortController();
    controller.abort();
    const readManagedResource = vi.fn();
    await expect(resolveXMindExportResourceBytes({
      document,
      signal: controller.signal,
      hashSha256: vi.fn(async () => SHA),
      readManagedResource,
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(readManagedResource).not.toHaveBeenCalled();
  });
});
