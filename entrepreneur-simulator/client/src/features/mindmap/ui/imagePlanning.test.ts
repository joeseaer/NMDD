import { describe, expect, it } from 'vitest';

import type {
  Asset,
  AssetId,
  CommandId,
  ImageId,
  SheetId,
  TopicImage,
  TopicId,
} from '../domain/types';
import { createMindMapElementsFixture } from '../testing/fixtures';
import {
  planCreateImageCommand,
  planDeleteImageCommand,
  planResetImageSizeCommand,
  planUpdateImageCommand,
} from './imagePlanning';

const IDS = {
  asset: '018f0000-0000-7000-8000-00000000d001' as AssetId,
  image: '018f0000-0000-7000-8000-00000000d002' as ImageId,
  sharedImage: '018f0000-0000-7000-8000-00000000d003' as ImageId,
  command: '018f0000-0000-7000-8000-00000000d004' as CommandId,
};

const setup = () => {
  const document = createMindMapElementsFixture();
  const sheetId = Object.keys(document.sheets)[0] as SheetId;
  const sheet = document.sheets[sheetId];
  const existingImage = Object.values(sheet.images)[0];
  const topicId = existingImage.topicId;
  return { document, existingImage, sheet, sheetId, topicId };
};

const localAsset = (): Asset => ({
  id: IDS.asset,
  fileName: 'planned-image.png',
  mimeType: 'image/png',
  byteSize: 4_096,
  sha256: 'a'.repeat(64),
  source: { kind: 'embedded', relativePath: 'assets/planned-image.png' },
  intrinsicSize: { width: 1_200, height: 800 },
});

const localImage = (topicId: TopicId): TopicImage => ({
  id: IDS.image,
  topicId,
  assetId: IDS.asset,
  orderKey: 'z',
  role: 'inline',
  placement: { side: 'top', align: 'center', offset: { x: 0, y: 8 } },
  size: { width: 480, height: 320 },
  alt: 'Planned image',
});

describe('local image planning', () => {
  it('builds an atomic create envelope from injected entities without mutating caller state', () => {
    const { document, sheetId, topicId } = setup();
    const asset = localAsset();
    const image = localImage(topicId);
    const snapshot = structuredClone({ document, asset, image });

    const command = planCreateImageCommand({
      document,
      sheetId,
      asset,
      image,
      commandId: IDS.command,
      timestamp: '2026-07-21T00:00:00.000Z',
    });

    expect(command).toMatchObject({
      commandId: IDS.command,
      type: 'image.create',
      payload: { asset: { id: IDS.asset }, image: { id: IDS.image } },
    });
    expect(command.payload.asset).not.toBe(asset);
    expect(command.payload.image).not.toBe(image);
    expect({ document, asset, image }).toEqual(snapshot);
  });

  it('plans Reset Size as an immutable full replacement with intrinsic size and no crop', () => {
    const { document, existingImage, sheetId } = setup();
    existingImage.size = { width: 300, height: 180 };
    existingImage.crop = { x: 10, y: 20, width: 400, height: 240 };
    const before = structuredClone(document);
    const intrinsic = document.assets[existingImage.assetId].intrinsicSize!;

    const command = planResetImageSizeCommand({
      document,
      sheetId,
      imageId: existingImage.id,
    });

    expect(command.type).toBe('image.update');
    expect(command.payload.image.size).toEqual(intrinsic);
    expect(command.payload.image.crop).toBeUndefined();
    expect(command.payload.image.id).toBe(existingImage.id);
    expect(command.payload.image.topicId).toBe(existingImage.topicId);
    expect(document).toEqual(before);
  });

  it('keeps background compatibility while enforcing XMind local-image placement roles', () => {
    const { document, existingImage, sheetId } = setup();
    expect(() => planUpdateImageCommand({
      document,
      sheetId,
      image: {
        ...existingImage,
        role: 'background',
        placement: { ...existingImage.placement, side: 'bottom' },
      },
    })).not.toThrow();
    expect(() => planUpdateImageCommand({
      document,
      sheetId,
      image: {
        ...existingImage,
        role: 'sticker',
        placement: { ...existingImage.placement, side: 'overlay' },
      },
    })).not.toThrow();
    expect(() => planUpdateImageCommand({
      document,
      sheetId,
      image: {
        ...existingImage,
        role: 'inline',
        placement: { ...existingImage.placement, side: 'left' },
      },
    })).toThrow(/Only sticker images/);
  });

  it('rejects malformed MIME, size, crop, offset, order, and global IDs with zero mutation', () => {
    const { document, existingImage, sheetId, topicId } = setup();
    const before = structuredClone(document);
    const asset = localAsset();
    const image = localImage(topicId);

    expect(() => planCreateImageCommand({
      document,
      sheetId,
      asset: { ...asset, mimeType: 'application/octet-stream' },
      image,
    })).toThrow(/image\/\*/);
    expect(() => planCreateImageCommand({
      document,
      sheetId,
      asset: {
        ...asset,
        source: { kind: 'remote', url: 'javascript:alert(1)' },
      },
      image,
    })).toThrow(/http\(s\)/);
    expect(() => planCreateImageCommand({
      document,
      sheetId,
      asset: {
        ...asset,
        source: { kind: 'remote', url: 'https://user:secret@example.test/image.png' },
      },
      image,
    })).toThrow(/credentials/);
    expect(() => planCreateImageCommand({
      document,
      sheetId,
      asset: {
        ...asset,
        source: {
          kind: 'remote',
          url: 'https://cdn.example.test/image.png?X-Amz-Signature=do-not-persist',
        },
      },
      image,
    })).toThrow(/credentials/);
    expect(() => planCreateImageCommand({
      document,
      sheetId,
      asset: {
        ...asset,
        source: { kind: 'embedded', relativePath: '../private/image.png' },
      },
      image,
    })).toThrow(/relativePath/);
    expect(() => planCreateImageCommand({
      document,
      sheetId,
      asset: {
        ...asset,
        source: { kind: 'managed', objectKey: 'C:/private/image.png' },
      },
      image,
    })).toThrow(/objectKey/);
    expect(() => planCreateImageCommand({
      document,
      sheetId,
      asset: { ...asset, intrinsicSize: { width: Number.POSITIVE_INFINITY, height: 800 } },
      image,
    })).toThrow(/intrinsicSize\.width/);
    expect(() => planCreateImageCommand({
      document,
      sheetId,
      asset,
      image: { ...image, size: { width: 0, height: 100 } },
    })).toThrow(/size\.width/);
    expect(() => planCreateImageCommand({
      document,
      sheetId,
      asset,
      image: { ...image, crop: { x: 1_100, y: 0, width: 200, height: 100 } },
    })).toThrow(/within Asset intrinsicSize/);
    expect(() => planCreateImageCommand({
      document,
      sheetId,
      asset,
      image: {
        ...image,
        placement: {
          ...image.placement,
          offset: { x: Number.NaN, y: 0 },
        },
      },
    })).toThrow(/offset\.x/);
    expect(() => planCreateImageCommand({
      document,
      sheetId,
      asset,
      image: { ...image, orderKey: existingImage.orderKey },
    })).toThrow(/reuses orderKey/);
    expect(() => planCreateImageCommand({
      document,
      sheetId,
      asset: { ...asset, id: existingImage.id as unknown as AssetId },
      image: { ...image, assetId: existingImage.id as unknown as AssetId },
    })).toThrow(/already exists/);

    expect(document).toEqual(before);
    expect(asset).toEqual(localAsset());
    expect(image).toEqual(localImage(topicId));
  });

  it('requests orphan pruning but retains Assets shared by another image or canvas background', () => {
    const orphanCase = setup();
    expect(planDeleteImageCommand({
      document: orphanCase.document,
      sheetId: orphanCase.sheetId,
      imageId: orphanCase.existingImage.id,
    }).payload.pruneAssetId).toBe(orphanCase.existingImage.assetId);

    const sharedCase = setup();
    sharedCase.sheet.images[IDS.sharedImage] = {
      ...sharedCase.existingImage,
      id: IDS.sharedImage,
      topicId: Object.keys(sharedCase.sheet.topics)
        .find((id) => id !== sharedCase.existingImage.topicId)! as TopicId,
    };
    expect(planDeleteImageCommand({
      document: sharedCase.document,
      sheetId: sharedCase.sheetId,
      imageId: sharedCase.existingImage.id,
    }).payload.pruneAssetId).toBeUndefined();

    const backgroundCase = setup();
    backgroundCase.sheet.canvas.background = {
      kind: 'image',
      assetId: backgroundCase.existingImage.assetId,
      fit: 'contain',
    };
    expect(planDeleteImageCommand({
      document: backgroundCase.document,
      sheetId: backgroundCase.sheetId,
      imageId: backgroundCase.existingImage.id,
    }).payload.pruneAssetId).toBeUndefined();
  });
});
