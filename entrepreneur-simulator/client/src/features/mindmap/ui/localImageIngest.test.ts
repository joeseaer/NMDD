// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMindMapBlockDocument } from '../domain/createDocument';
import type { AssetId, ImageId, SheetId } from '../domain/types';
import {
  LOCAL_IMAGE_MAX_BYTES,
  LocalImageIngestError,
  decodeLocalImageDimensions,
  fitLocalImageDisplaySize,
  planLocalImageIngest,
  sanitizeLocalImageAlt,
} from './localImageIngest';

afterEach(() => vi.unstubAllGlobals());

const ASSET_ID = '018f0000-0000-7000-8000-00000000f101' as AssetId;
const IMAGE_ID = '018f0000-0000-7000-8000-00000000f102' as ImageId;

const setup = () => {
  const document = createMindMapBlockDocument();
  const sheetId = Object.keys(document.sheets)[0] as SheetId;
  const topicId = document.sheets[sheetId].rootTopicId;
  return { document, sheetId, topicId };
};

const manifest = {
  url: 'https://assets.example.test/local-image.png',
  fileName: 'local-image.png',
  mimeType: 'image/png',
  byteSize: 8,
  sha256: 'a'.repeat(64),
};

describe('Local Image ingest', () => {
  it('decodes intrinsic dimensions with createImageBitmap and releases the decoder resource', async () => {
    const close = vi.fn();
    const createImageBitmap = vi.fn(async () => ({ width: 300, height: 200, close }));
    vi.stubGlobal('createImageBitmap', createImageBitmap);
    const file = new File(['png-data'], 'decoded.png', { type: 'image/png' });

    await expect(decodeLocalImageDimensions(file)).resolves.toEqual({ width: 300, height: 200 });
    expect(createImageBitmap).toHaveBeenCalledWith(file);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('decodes before upload and returns one undispatched atomic create command', async () => {
    const { document, sheetId, topicId } = setup();
    const before = structuredClone(document);
    const order: string[] = [];
    const decode = vi.fn(async () => {
      order.push('decode');
      return { width: 640, height: 360 };
    });
    const upload = vi.fn(async () => {
      order.push('upload');
      return manifest;
    });
    const file = new File(['png-data'], '  C:\\private\\Quarterly\u0000 plan.png  ', {
      type: 'image/png',
    });

    const planned = await planLocalImageIngest({
      file,
      readOnly: false,
      sheetId,
      topicId,
      getDocument: () => document,
      decode,
      upload,
      createAssetId: () => ASSET_ID,
      createImageId: () => IMAGE_ID,
    });

    expect(order).toEqual(['decode', 'upload']);
    expect(planned.command.type).toBe('image.create');
    expect(planned.command.payload).toEqual({ asset: planned.asset, image: planned.image });
    expect(planned.asset).toMatchObject({
      id: ASSET_ID,
      source: { kind: 'remote', url: manifest.url },
      intrinsicSize: { width: 640, height: 360 },
    });
    expect(planned.image).toMatchObject({
      id: IMAGE_ID,
      topicId,
      assetId: ASSET_ID,
      role: 'inline',
      placement: { side: 'top', align: 'center', offset: { x: 0, y: 0 } },
      size: { width: 320, height: 180 },
      alt: 'Quarterly plan.png',
    });
    expect(document).toEqual(before);
  });

  it('keeps intrinsic metadata while fitting large images into a 320×240 display box', () => {
    expect(fitLocalImageDisplaySize({ width: 1_981, height: 1_377 }))
      .toEqual({ width: 320, height: 222 });
    expect(fitLocalImageDisplaySize({ width: 120, height: 90 }))
      .toEqual({ width: 120, height: 90 });
  });

  it('prefers a verified managed object key so a new image survives reload', async () => {
    const { document, sheetId, topicId } = setup();
    const objectKey = `mindmap-images/sha256/${manifest.sha256}.png`;
    const file = new File(['png-data'], 'managed.png', { type: 'image/png' });

    const planned = await planLocalImageIngest({
      file,
      readOnly: false,
      sheetId,
      topicId,
      getDocument: () => document,
      decode: vi.fn(async () => ({ width: 300, height: 200 })),
      upload: vi.fn(async () => ({ ...manifest, objectKey })),
      createAssetId: () => ASSET_ID,
      createImageId: () => IMAGE_ID,
    });

    expect(planned.asset.source).toEqual({ kind: 'managed', objectKey });
  });

  it('accepts an explicit trusted sticker intent without widening ordinary image placement', async () => {
    const { document, sheetId, topicId } = setup();
    const file = new File(['png-data'], 'bundled-lightbulb.png', { type: 'image/png' });
    const assetExtensions = { 'app.nmdd.catalog-item-id': 'idea-lightbulb' };

    const planned = await planLocalImageIngest({
      file,
      readOnly: false,
      sheetId,
      topicId,
      getDocument: () => document,
      decode: vi.fn(async () => ({ width: 1_254, height: 1_254 })),
      upload: vi.fn(async () => manifest),
      createAssetId: () => ASSET_ID,
      createImageId: () => IMAGE_ID,
      imageIntent: {
        role: 'sticker',
        side: 'right',
        displaySize: { width: 84, height: 84 },
        alt: '灵感灯泡',
        origin: 'mindmap-v2-sticker-catalog',
        assetExtensions,
      },
    });

    expect(planned.image).toMatchObject({
      role: 'sticker',
      placement: { side: 'right', align: 'center', offset: { x: 0, y: 0 } },
      size: { width: 84, height: 84 },
      alt: '灵感灯泡',
    });
    expect(planned.command.origin).toBe('mindmap-v2-sticker-catalog');
    expect(planned.asset.extensions).toEqual(assetExtensions);
    assetExtensions['app.nmdd.catalog-item-id'] = 'mutated-after-planning';
    expect(planned.asset.extensions).toEqual({
      'app.nmdd.catalog-item-id': 'idea-lightbulb',
    });
  });

  it.each([
    ['empty-file', new File([], 'empty.png', { type: 'image/png' })],
    ['unsupported-type', new File(['svg'], 'vector.svg', { type: 'image/svg+xml' })],
    ['file-too-large', new File([new Uint8Array(LOCAL_IMAGE_MAX_BYTES + 1)], 'large.png', {
      type: 'image/png',
    })],
  ] as const)('rejects %s before decode/upload', async (code, file) => {
    const { document, sheetId, topicId } = setup();
    const decode = vi.fn(async () => ({ width: 1, height: 1 }));
    const upload = vi.fn(async () => manifest);

    await expect(planLocalImageIngest({
      file,
      readOnly: false,
      sheetId,
      topicId,
      getDocument: () => document,
      decode,
      upload,
    })).rejects.toMatchObject({ code });
    expect(decode).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it('blocks read-only ingest before decode/upload and leaves canonical content untouched', async () => {
    const { document, sheetId, topicId } = setup();
    const before = structuredClone(document);
    const decode = vi.fn(async () => ({ width: 320, height: 200 }));
    const upload = vi.fn(async () => manifest);

    await expect(planLocalImageIngest({
      file: new File(['png'], 'read-only.png', { type: 'image/png' }),
      readOnly: true,
      sheetId,
      topicId,
      getDocument: () => document,
      decode,
      upload,
    })).rejects.toEqual(expect.objectContaining<Partial<LocalImageIngestError>>({
      code: 'read-only',
      message: '只读模式不能添加图片。',
    }));
    expect(decode).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(document).toEqual(before);
  });

  it('maps decode, upload, and planner failures deterministically with no command', async () => {
    const { document, sheetId, topicId } = setup();
    const file = new File(['png'], 'failure.png', { type: 'image/png' });
    const input = {
      file,
      readOnly: false,
      sheetId,
      topicId,
      getDocument: () => document,
    };

    await expect(planLocalImageIngest({
      ...input,
      decode: vi.fn(async () => { throw new Error('private decoder detail'); }),
      upload: vi.fn(async () => manifest),
    })).rejects.toMatchObject({ code: 'decode-failed', message: '无法读取图片尺寸。' });

    await expect(planLocalImageIngest({
      ...input,
      decode: vi.fn(async () => ({ width: 320, height: 180 })),
      upload: vi.fn(async () => { throw new Error('signed storage detail'); }),
    })).rejects.toMatchObject({ code: 'upload-failed', message: '图片上传失败。' });

    await expect(planLocalImageIngest({
      ...input,
      decode: vi.fn(async () => ({ width: 320, height: 180 })),
      upload: vi.fn(async () => ({
        ...manifest,
        byteSize: file.size,
        url: 'javascript:alert(1)',
      })),
    })).rejects.toMatchObject({ code: 'planning-failed', message: '无法添加该图片。' });
  });

  it('returns planning-failed when the target disappears during upload', async () => {
    const { document, sheetId, topicId } = setup();
    const afterDeletion = structuredClone(document);
    delete afterDeletion.sheets[sheetId].topics[topicId];
    const file = new File(['png-data'], 'deleted-target.png', { type: 'image/png' });

    await expect(planLocalImageIngest({
      file,
      readOnly: false,
      sheetId,
      topicId,
      getDocument: () => afterDeletion,
      decode: vi.fn(async () => ({ width: 300, height: 200 })),
      upload: vi.fn(async () => manifest),
    })).rejects.toMatchObject({
      code: 'planning-failed',
      message: '无法添加该图片。',
    });
    expect(Object.keys(document.sheets[sheetId].images)).toHaveLength(0);
    expect(Object.keys(document.assets)).toHaveLength(0);
  });

  it.each([
    ['non-raster MIME', { ...manifest, mimeType: 'image/svg+xml' }],
    ['byte-size mismatch', { ...manifest, byteSize: 7 }],
    ['malformed digest', { ...manifest, sha256: 'NOT-A-SHA256' }],
    ['managed key digest mismatch', {
      ...manifest,
      objectKey: `mindmap-images/sha256/${'b'.repeat(64)}.png`,
    }],
    ['managed key MIME mismatch', {
      ...manifest,
      objectKey: `mindmap-images/sha256/${manifest.sha256}.jpg`,
    }],
  ])('rejects an invalid upload manifest (%s) before planning', async (_label, uploaded) => {
    const { document, sheetId, topicId } = setup();
    const before = structuredClone(document);
    const file = new File(['png-data'], 'manifest.png', { type: 'image/png' });

    await expect(planLocalImageIngest({
      file,
      readOnly: false,
      sheetId,
      topicId,
      getDocument: () => document,
      decode: vi.fn(async () => ({ width: 300, height: 200 })),
      upload: vi.fn(async () => uploaded),
    })).rejects.toMatchObject({
      code: 'upload-failed',
      message: '图片上传失败。',
    });
    expect(document).toEqual(before);
  });

  it('sanitizes path, control, bidi, and blank names for accessible alt text', () => {
    expect(sanitizeLocalImageAlt('C:\\users\\me\\road\u0000 map\u202e.png'))
      .toBe('road map.png');
    expect(sanitizeLocalImageAlt('\u0000\u202e')).toBe('本地图片');
  });
});
