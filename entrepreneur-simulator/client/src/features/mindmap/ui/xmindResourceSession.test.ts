import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createNewMindMapDocument } from '../domain/defaults';
import type { Asset, AssetId, Id, ImageId, SheetId, TopicId } from '../domain/types';
import { buildTopicEnrichmentsProjection } from './enrichmentProjection';
import { TopicImages } from './TopicImages';
import { XMindResourceSession, type XMindObjectUrlApi } from './xmindResourceSession';

const id = <K extends string>(counter: number): Id<K> => (
  `018f7100-0000-7000-8000-${counter.toString(16).padStart(12, '0')}` as Id<K>
);

const createEmbeddedFixture = (relativePath = 'resources/pixel.png') => {
  const documentId = id<'Document'>(1);
  const sheetId = id<'Sheet'>(2) as SheetId;
  const topicId = id<'Topic'>(3) as TopicId;
  const themeId = id<'Theme'>(4);
  const assetId = id<'Asset'>(5) as AssetId;
  const imageId = id<'Image'>(6) as ImageId;
  const document = createNewMindMapDocument({
    documentId,
    sheetId,
    rootTopicId: topicId,
    themeId,
    sheetOrderKey: 'a',
    title: 'Imported',
    sheetTitle: 'Sheet',
    rootTitle: 'Topic',
  });
  const asset: Asset = {
    id: assetId,
    fileName: 'pixel.png',
    mimeType: 'image/png',
    byteSize: 8,
    sha256: '1'.repeat(64),
    source: { kind: 'embedded', relativePath },
    intrinsicSize: { width: 20, height: 30 },
  };
  document.assets[assetId] = asset;
  document.sheets[sheetId].images[imageId] = {
    id: imageId,
    topicId,
    assetId,
    orderKey: 'a',
    role: 'inline',
    placement: { side: 'top', align: 'center', offset: { x: 0, y: 0 } },
    size: { width: 20, height: 30 },
    alt: 'Imported pixel',
  };
  return { asset, document, imageId, relativePath, sheetId, topicId };
};

const createUrlApi = () => {
  const createObjectURL = vi.fn((_blob: Blob) => (
    `blob:https://nmdd.test/${createObjectURL.mock.calls.length}`
  ));
  const revokeObjectURL = vi.fn();
  return {
    api: { createObjectURL, revokeObjectURL } satisfies XMindObjectUrlApi,
    createObjectURL,
    revokeObjectURL,
  };
};

afterEach(cleanup);

describe('XMindResourceSession', () => {
  it('activates applied import bytes as one reusable Blob URL and renders immediately', () => {
    const fixture = createEmbeddedFixture();
    const canonicalBefore = JSON.stringify(fixture.document);
    const urls = createUrlApi();
    const session = new XMindResourceSession(urls.api);
    const importedResourceBytes = {
      [fixture.relativePath]: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]),
    };

    // This is the post-confirmation apply boundary used by the NodeView.
    session.replace(importedResourceBytes, fixture.document.assets);
    const projection = buildTopicEnrichmentsProjection({
      document: fixture.document,
      sheetId: fixture.sheetId,
      resolveEmbeddedImageUrl: session.resolveEmbeddedImageUrl,
    });
    const image = projection.byTopicId[fixture.topicId].images[0];

    expect(image.rendererSource).toEqual({
      status: 'ready',
      url: 'blob:https://nmdd.test/1',
    });
    render(createElement(TopicImages, { images: [image], side: 'top', readOnly: true }));
    expect(screen.getByTestId(`topic-image-content-${fixture.imageId}`))
      .toHaveAttribute('src', 'blob:https://nmdd.test/1');
    expect(session.resolveEmbeddedImageUrl(fixture.asset)).toBe('blob:https://nmdd.test/1');
    expect(urls.createObjectURL).toHaveBeenCalledTimes(1);
    buildTopicEnrichmentsProjection({
      document: fixture.document,
      sheetId: fixture.sheetId,
      resolveEmbeddedImageUrl: session.resolveEmbeddedImageUrl,
    });
    expect(urls.createObjectURL).toHaveBeenCalledTimes(1);
    expect(session.exportResourceBytes?.[fixture.relativePath]).toEqual(
      importedResourceBytes[fixture.relativePath],
    );
    expect(JSON.stringify(fixture.document)).toBe(canonicalBefore);
    expect(JSON.stringify(fixture.document)).not.toContain('137,80,78,71');
  });

  it('revokes cached URLs on replacement and disposal without leaking old resources', () => {
    const first = createEmbeddedFixture('resources/first.png');
    const second = createEmbeddedFixture('resources/second.png');
    const urls = createUrlApi();
    const session = new XMindResourceSession(urls.api);

    session.replace({ [first.relativePath]: Uint8Array.of(1) }, first.document.assets);
    expect(session.resolveEmbeddedImageUrl(first.asset)).toBe('blob:https://nmdd.test/1');

    session.replace({ [second.relativePath]: Uint8Array.of(2) }, second.document.assets);
    expect(urls.revokeObjectURL).toHaveBeenNthCalledWith(1, 'blob:https://nmdd.test/1');
    expect(session.resolveEmbeddedImageUrl(first.asset)).toBeUndefined();
    expect(session.resolveEmbeddedImageUrl(second.asset)).toBe('blob:https://nmdd.test/2');

    session.dispose();
    expect(urls.revokeObjectURL).toHaveBeenNthCalledWith(2, 'blob:https://nmdd.test/2');
    expect(session.exportResourceBytes).toBeUndefined();
    session.dispose();
    expect(urls.revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it('keeps an embedded Asset without a MIME type inert and never throws in projection', () => {
    const fixture = createEmbeddedFixture();
    const malformedAsset = fixture.document.assets[fixture.asset.id];
    (malformedAsset as { mimeType?: string }).mimeType = undefined;
    const urls = createUrlApi();
    const session = new XMindResourceSession(urls.api);

    expect(() => session.replace(
      { [fixture.relativePath]: Uint8Array.of(1, 2, 3) },
      fixture.document.assets,
    )).not.toThrow();
    expect(() => buildTopicEnrichmentsProjection({
      document: fixture.document,
      sheetId: fixture.sheetId,
      resolveEmbeddedImageUrl: session.resolveEmbeddedImageUrl,
    })).not.toThrow();
    expect(session.resolveEmbeddedImageUrl(malformedAsset)).toBeUndefined();
    expect(urls.createObjectURL).not.toHaveBeenCalled();
  });

  it('keeps the previous session and revokes temporary URLs when replacement preparation fails', () => {
    const first = createEmbeddedFixture('resources/first.png');
    const replacement = createEmbeddedFixture('resources/replacement.png');
    const extraAsset: Asset = {
      ...replacement.asset,
      id: id<'Asset'>(7) as AssetId,
      source: { kind: 'embedded', relativePath: 'resources/extra.png' },
    };
    replacement.document.assets[extraAsset.id] = extraAsset;
    const createObjectURL = vi.fn((_blob: Blob) => {
      if (createObjectURL.mock.calls.length === 3) throw new Error('Blob URL unavailable');
      return `blob:https://nmdd.test/${createObjectURL.mock.calls.length}`;
    });
    const revokeObjectURL = vi.fn();
    const session = new XMindResourceSession({ createObjectURL, revokeObjectURL });

    expect(session.replace(
      { [first.relativePath]: Uint8Array.of(1) },
      first.document.assets,
    )).toBe(true);
    expect(session.resolveEmbeddedImageUrl(first.asset)).toBe('blob:https://nmdd.test/1');

    expect(session.replace({
      [replacement.relativePath]: Uint8Array.of(2),
      'resources/extra.png': Uint8Array.of(3),
    }, replacement.document.assets)).toBe(false);

    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:https://nmdd.test/2');
    expect(session.resolveEmbeddedImageUrl(first.asset)).toBe('blob:https://nmdd.test/1');
    expect(session.exportResourceBytes?.[first.relativePath]).toEqual(Uint8Array.of(1));
  });
});
