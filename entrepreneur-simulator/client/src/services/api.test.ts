// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  api,
  mindMapImageAssetUrl,
  parseApiErrorMessage,
  resolveMindMapImageResourceName,
} from './api';

describe('parseApiErrorMessage', () => {
  it('returns structured Chinese and emoji errors without exposing raw JSON', () => {
    expect(parseApiErrorMessage('{"error":"上传失败：文件过大 👩‍🔬"}', 'fallback'))
      .toBe('上传失败：文件过大 👩‍🔬');
  });

  it('turns an HTML error page into safe readable text', () => {
    expect(parseApiErrorMessage('<h1>502 Bad Gateway</h1><script>alert(1)</script>', 'fallback'))
      .toBe('502 Bad Gateway');
  });

  it('truncates by grapheme without splitting emoji', () => {
    expect(parseApiErrorMessage('甲乙👩‍🔬丙丁', 'fallback', 3)).toBe('甲乙👩‍🔬…');
  });
});

describe('upload API routing', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opts image uploads into image validation while leaving generic uploads compatible', async () => {
    const result = {
      url: 'https://assets.example.test/object',
      fileName: 'asset.png',
      mimeType: 'image/png',
      byteSize: 8,
      sha256: 'a'.repeat(64),
    };
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const image = new File(['image'], 'asset.png', { type: 'image/png' });
    const attachment = new File(['text'], 'notes.txt', { type: 'text/plain' });
    const controller = new AbortController();
    await expect(api.uploadImage(image, { signal: controller.signal })).resolves.toEqual(result);
    await expect(api.uploadFile(attachment)).resolves.toEqual(result);

    expect(fetchMock.mock.calls[0][0]).toBe('/api/upload?kind=image');
    expect(fetchMock.mock.calls[1][0]).toBe('/api/upload');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      signal: controller.signal,
    });
    expect(fetchMock.mock.calls[0][1]?.body).toBeInstanceOf(FormData);
    expect(fetchMock.mock.calls[1][1]).not.toHaveProperty('signal');
  });

  it('reads a managed resource by strict object key or resource name with same-origin credentials', async () => {
    const sha256 = 'a'.repeat(64);
    const resourceName = `${sha256}.png`;
    const objectKey = `mindmap-images/sha256/${resourceName}`;
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const fetchMock = vi.fn().mockImplementation(async () => new Response(bytes, {
      status: 200,
      headers: {
        'content-length': String(bytes.byteLength),
        'content-type': 'image/png',
      },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();

    await expect(api.getMindMapImageAssetBytes(objectKey, { signal: controller.signal }))
      .resolves.toEqual(bytes);
    await expect(api.getMindMapImageAssetBytes(resourceName)).resolves.toEqual(bytes);

    expect(resolveMindMapImageResourceName(objectKey)).toBe(resourceName);
    expect(mindMapImageAssetUrl(objectKey))
      .toBe(`/api/mindmap/image-assets/${resourceName}`);
    expect(fetchMock.mock.calls[0]).toEqual([
      `/api/mindmap/image-assets/${resourceName}`,
      { credentials: 'same-origin', signal: controller.signal },
    ]);
    expect(fetchMock.mock.calls[1]).toEqual([
      `/api/mindmap/image-assets/${resourceName}`,
      { credentials: 'same-origin' },
    ]);
  });

  it('rejects unsafe managed image identifiers before fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const invalid = [
      '../secret.png',
      'mindmap-images/sha256/../secret.png',
      `mindmap-images/sha256/${'A'.repeat(64)}.png`,
      `mindmap-images/sha256/${'a'.repeat(64)}.svg`,
      'https://private.example/image.png?token=secret',
    ];

    for (const value of invalid) {
      await expect(api.getMindMapImageAssetBytes(value))
        .rejects.toThrow('Invalid managed image resource name');
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('bounds managed image reads and sanitizes server errors', async () => {
    const resourceName = `${'b'.repeat(64)}.webp`;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('private detail', {
        status: 500,
        headers: { 'content-type': 'text/plain' },
      }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1]), {
        status: 200,
        headers: { 'content-length': String(15 * 1024 * 1024 + 1) },
      }))
      .mockResolvedValueOnce(new Response(new Uint8Array(), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.getMindMapImageAssetBytes(resourceName))
      .rejects.toThrow('private detail');
    await expect(api.getMindMapImageAssetBytes(resourceName))
      .rejects.toThrow('15MB read limit');
    await expect(api.getMindMapImageAssetBytes(resourceName))
      .rejects.toThrow('invalid byte length');
  });
});
