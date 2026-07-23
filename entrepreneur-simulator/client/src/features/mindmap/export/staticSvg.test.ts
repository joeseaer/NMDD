import { generateHTML, generateJSON } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { DOMSerializer, type DOMOutputSpec } from '@tiptap/pm/model';
import { describe, expect, it, vi } from 'vitest';

import { MindMap } from '../../../components/TiptapExtensions';
import { createRichText } from '../domain/defaults';
import type { LegacyMindMapGraph } from '../domain/legacy';
import type { AssetId, BoundaryId, ImageId } from '../domain/types';
import {
  createMindMapElementsFixture,
  createMindMapV1SmallFixture,
} from '../testing/fixtures';
import {
  buildTopicEnrichmentsProjection,
  type ImageEnrichmentProjection,
} from '../ui/enrichmentProjection';
import { measureMindMapTopicNode } from '../ui/projection';
import {
  createPortableMindMapStaticSvgPreview,
  createMindMapStaticSvgPreview,
  MIND_MAP_STATIC_SVG_LIMITS,
} from './staticSvg';

const PNG_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
]);

const renderSpec = (spec: DOMOutputSpec): SVGSVGElement => (
  DOMSerializer.renderSpec(document, spec).dom as unknown as SVGSVGElement
);

const boundaryId = (ordinal: number): BoundaryId => (
  `01900000-0000-7000-8000-${String(ordinal).padStart(12, '0')}` as BoundaryId
);

const assetId = (ordinal: number): AssetId => (
  `01910000-0000-7000-8000-${String(ordinal).padStart(12, '0')}` as AssetId
);

const imageId = (ordinal: number): ImageId => (
  `01920000-0000-7000-8000-${String(ordinal).padStart(12, '0')}` as ImageId
);

const topicRectByTitle = (svg: SVGSVGElement, title: string): SVGRectElement => {
  const titleElement = Array.from(svg.querySelectorAll('text'))
    .find((element) => element.textContent === title);
  const rect = titleElement?.previousElementSibling;
  if (rect?.tagName.toLowerCase() !== 'rect' || !rect.classList.contains('mindmap-static-topic')) {
    throw new Error(`Static topic row for ${title} was not rendered.`);
  }
  return rect as SVGRectElement;
};

const createLargeLegacyGraph = (topicCount: number): LegacyMindMapGraph => {
  const nodes: LegacyMindMapGraph['nodes'] = [{
    data: { label: 'Root' },
    id: 'root',
    position: { x: 0, y: 0 },
    type: 'mindMap',
  }];
  const edges: LegacyMindMapGraph['edges'] = [];
  for (let index = 1; index < topicCount; index += 1) {
    const id = `topic-${String(index).padStart(5, '0')}`;
    nodes.push({
      data: { label: `Topic ${index}` },
      id,
      position: { x: 240, y: index },
      type: 'mindMap',
    });
    edges.push({ id: `edge-${index}`, source: 'root', target: id });
  }
  return { edges, nodes };
};

// @covers ACC-IO-019
describe('mind-map static SVG fallback (ACC-IO-019)', () => {
  it('serializes canonical V1 titles in tree order as escaped XML text with connectors', () => {
    const mindMap = createMindMapV1SmallFixture();
    const sheet = Object.values(mindMap.sheets)[0];
    const root = sheet.topics[sheet.rootTopicId];
    const firstChildEdge = Object.values(sheet.treeEdges)
      .filter((edge) => edge.parentTopicId === root.id)
      .sort((left, right) => left.orderKey.localeCompare(right.orderKey))[0];
    const firstChild = sheet.topics[firstChildEdge.childTopicId];
    const unsafeTitle = '研发 <计划> & "上线" 😄 </text><script>pwn()</script>';
    root.title = createRichText(unsafeTitle);
    firstChild.title = createRichText('第一分支 🚀');
    root.extensions = {
      'app.nmdd.private-preview-test': {
        privateToken: 'TOP_SECRET_DO_NOT_RENDER',
        remoteUrl: 'https://private.example.test/document',
      },
    };

    const first = createMindMapStaticSvgPreview(mindMap);
    const second = createMindMapStaticSvgPreview(mindMap);
    const svg = renderSpec(first.spec);
    const html = svg.outerHTML;

    expect(first.status).toBe('ready');
    expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.querySelector('path')).not.toBeNull();
    expect(svg.querySelector('script, image, a, foreignObject')).toBeNull();
    expect(svg.textContent).toContain(unsafeTitle);
    expect(svg.textContent?.indexOf(unsafeTitle)).toBeLessThan(
      svg.textContent?.indexOf('第一分支 🚀') ?? -1,
    );
    expect(html).toContain('&lt;计划&gt; &amp; "上线" 😄');
    expect(html).toContain('&lt;/text&gt;&lt;script&gt;pwn()&lt;/script&gt;');
    expect(html).not.toContain('TOP_SECRET_DO_NOT_RENDER');
    expect(html).not.toContain('private.example.test');
    expect(html).not.toContain('data-mindmap=');
    expect(renderSpec(second.spec).outerHTML).toBe(html);
  });

  it('renders top/bottom Local Images at projection sizes and reserves their measured layout', () => {
    const baselineDocument = createMindMapV1SmallFixture();
    const baselineSheet = Object.values(baselineDocument.sheets)[0];
    const baselineRoot = baselineSheet.topics[baselineSheet.rootTopicId];
    const firstChildEdge = Object.values(baselineSheet.treeEdges)
      .filter((edge) => edge.parentTopicId === baselineRoot.id)
      .sort((left, right) => left.orderKey.localeCompare(right.orderKey))[0];
    baselineRoot.title = createRichText('Root with Local Images');
    baselineSheet.topics[firstChildEdge.childTopicId].title = createRichText('Next topic');

    const document = structuredClone(baselineDocument);
    const sheet = Object.values(document.sheets)[0];
    const root = sheet.topics[sheet.rootTopicId];
    const croppedAssetId = assetId(1);
    const intrinsicAssetId = assetId(2);
    const croppedImageId = imageId(1);
    const intrinsicImageId = imageId(2);
    document.assets[croppedAssetId] = {
      id: croppedAssetId,
      fileName: 'architecture.png',
      mimeType: 'image/png',
      byteSize: 4_096,
      sha256: 'a'.repeat(64),
      source: { kind: 'remote', url: 'https://cdn.example.test/architecture.png' },
      intrinsicSize: { width: 640, height: 360 },
    };
    document.assets[intrinsicAssetId] = {
      id: intrinsicAssetId,
      fileName: 'detail.webp',
      mimeType: 'image/webp',
      byteSize: 2_048,
      sha256: 'b'.repeat(64),
      source: { kind: 'remote', url: 'https://cdn.example.test/detail.webp?v=1&theme=dark' },
      intrinsicSize: { width: 96, height: 54 },
    };
    sheet.images[croppedImageId] = {
      id: croppedImageId,
      topicId: root.id,
      assetId: croppedAssetId,
      orderKey: 'static-image-a',
      role: 'inline',
      placement: { side: 'top', align: 'end', offset: { x: 12, y: -4 } },
      size: { width: 180, height: 100 },
      crop: { x: 40, y: 20, width: 320, height: 180 },
      alt: 'Architecture "A&B" <overview>',
    };
    sheet.images[intrinsicImageId] = {
      id: intrinsicImageId,
      topicId: root.id,
      assetId: intrinsicAssetId,
      orderKey: 'static-image-b',
      role: 'thumbnail',
      placement: { side: 'bottom', align: 'start', offset: { x: 0, y: 0 } },
      alt: 'Detail image',
    };

    const projection = buildTopicEnrichmentsProjection({
      document,
      sheetId: sheet.id,
    });
    const projectedImages = projection.byTopicId[root.id].images;
    const croppedProjection = projectedImages.find((image) => image.id === croppedImageId)!;
    const intrinsicProjection = projectedImages.find((image) => image.id === intrinsicImageId)!;
    const expectedImageHeight = measureMindMapTopicNode(root, projectedImages).height
      - measureMindMapTopicNode(root).height;

    const baselineSvg = renderSpec(createMindMapStaticSvgPreview(baselineDocument).spec);
    const preview = createMindMapStaticSvgPreview(document);
    const svg = renderSpec(preview.spec);
    const baselineTopicRects = baselineSvg.querySelectorAll<SVGRectElement>(
      'rect.mindmap-static-topic',
    );
    const topicRects = svg.querySelectorAll<SVGRectElement>('rect.mindmap-static-topic');
    const rootHeight = Number(topicRects[0].getAttribute('height'));
    const baselineRootHeight = Number(baselineTopicRects[0].getAttribute('height'));

    expect(preview.status).toBe('ready');
    expect(rootHeight - baselineRootHeight).toBe(expectedImageHeight);
    expect(
      Number(topicRects[1].getAttribute('y')) - Number(baselineTopicRects[1].getAttribute('y')),
    ).toBe(expectedImageHeight);

    const croppedGroup = svg.querySelector<SVGGElement>(
      '.mindmap-static-topic-image[data-image-side="top"]',
    );
    const cropViewport = croppedGroup?.querySelector<SVGSVGElement>(
      'svg.mindmap-static-topic-image-crop',
    );
    const croppedImage = cropViewport?.querySelector<SVGImageElement>('image');
    expect(croppedGroup?.getAttribute('aria-label')).toBe('Topic image');
    expect(croppedGroup?.querySelector(':scope > title')?.textContent).toBe(
      'Architecture "A&B" <overview>',
    );
    expect(croppedGroup?.getAttribute('data-image-size-source')).toBe(
      croppedProjection.displaySizeSource,
    );
    expect(croppedGroup?.getAttribute('data-image-cropped')).toBe('true');
    expect(Number(cropViewport?.getAttribute('width'))).toBe(croppedProjection.displaySize.width);
    expect(Number(cropViewport?.getAttribute('height'))).toBe(croppedProjection.displaySize.height);
    expect(cropViewport?.getAttribute('viewBox')).toBe('40 20 320 180');
    expect(croppedImage?.getAttribute('href')).toBe(
      'https://cdn.example.test/architecture.png',
    );
    expect(croppedImage?.getAttribute('width')).toBe('640');
    expect(croppedImage?.getAttribute('height')).toBe('360');

    const bottomGroup = svg.querySelector<SVGGElement>(
      '.mindmap-static-topic-image[data-image-side="bottom"]',
    );
    const bottomImage = bottomGroup?.querySelector<SVGImageElement>(':scope > image');
    expect(bottomGroup?.getAttribute('data-image-size-source')).toBe(
      intrinsicProjection.displaySizeSource,
    );
    expect(Number(bottomImage?.getAttribute('width'))).toBe(intrinsicProjection.displaySize.width);
    expect(Number(bottomImage?.getAttribute('height'))).toBe(intrinsicProjection.displaySize.height);
    expect(bottomImage?.getAttribute('href')).toBe(
      'https://cdn.example.test/detail.webp?v=1&theme=dark',
    );
    expect(svg.outerHTML).toContain('Architecture "A&amp;B" &lt;overview&gt;');
    expect(svg.outerHTML).toContain('detail.webp?v=1&amp;theme=dark');
  });

  it('inlines validated managed image bytes so exported SVG/PNG sources remain portable offline', async () => {
    const document = createMindMapV1SmallFixture();
    const sheet = Object.values(document.sheets)[0];
    const root = sheet.topics[sheet.rootTopicId];
    const managedAssetId = assetId(7);
    const managedImageId = imageId(7);
    const sha256 = '7'.repeat(64);
    const objectKey = `mindmap-images/sha256/${sha256}.png`;
    document.assets[managedAssetId] = {
      id: managedAssetId,
      fileName: 'portable.png',
      mimeType: 'image/png',
      byteSize: PNG_BYTES.byteLength,
      sha256,
      source: { kind: 'managed', objectKey },
      intrinsicSize: { width: 1, height: 1 },
    };
    sheet.images[managedImageId] = {
      id: managedImageId,
      topicId: root.id,
      assetId: managedAssetId,
      orderKey: 'portable-managed-image',
      role: 'inline',
      placement: { side: 'top', align: 'center', offset: { x: 0, y: 0 } },
      alt: 'Portable managed image',
    };
    sheet.images[imageId(8)] = {
      id: imageId(8),
      topicId: root.id,
      assetId: managedAssetId,
      orderKey: 'portable-managed-sticker',
      role: 'sticker',
      placement: { side: 'right', align: 'center', offset: { x: 3, y: -2 } },
      size: { width: 48, height: 48 },
      alt: 'Portable managed sticker',
    };
    const readManagedResource = vi.fn(async () => PNG_BYTES);

    const preview = await createPortableMindMapStaticSvgPreview(document, {
      signal: new AbortController().signal,
      readManagedResource,
      hashSha256: async () => sha256,
    });
    const svg = renderSpec(preview.spec);
    const image = svg.querySelector<SVGImageElement>('.mindmap-static-topic-image image');
    const sticker = svg.querySelector<SVGImageElement>(
      '.mindmap-static-topic-image[data-image-role="sticker"] image',
    );
    const href = image?.getAttribute('href') ?? '';

    expect(preview.status).toBe('ready');
    expect(readManagedResource).toHaveBeenCalledWith(objectKey, {
      signal: expect.any(AbortSignal),
    });
    expect(href).toMatch(/^data:image\/png;base64,/u);
    expect(sticker?.getAttribute('href')).toBe(href);
    expect(Uint8Array.from(atob(href.split(',', 2)[1]), (character) => character.charCodeAt(0)))
      .toEqual(PNG_BYTES);
    expect(svg.outerHTML).not.toContain(objectKey);
    expect(svg.querySelector('image[href^="http:"], image[href^="https:"], image[href^="blob:"]'))
      .toBeNull();
  });

  it('keeps an oversized projected image in a bounded viewport without clipping its SVG geometry', () => {
    const document = createMindMapV1SmallFixture();
    const sheet = Object.values(document.sheets)[0];
    const root = sheet.topics[sheet.rootTopicId];
    const largeAssetId = assetId(8);
    const largeImageId = imageId(8);
    document.assets[largeAssetId] = {
      id: largeAssetId,
      fileName: 'large.png',
      mimeType: 'image/png',
      byteSize: 32_768,
      sha256: '8'.repeat(64),
      source: { kind: 'remote', url: 'https://cdn.example.test/large.png' },
      intrinsicSize: { width: 1_500, height: 1_400 },
    };
    sheet.images[largeImageId] = {
      id: largeImageId,
      topicId: root.id,
      assetId: largeAssetId,
      orderKey: 'large-static-image',
      role: 'inline',
      placement: { side: 'top', align: 'center', offset: { x: 0, y: 0 } },
      size: { width: 1_500, height: 1_400 },
      alt: 'Large image',
    };
    const projectedImage = buildTopicEnrichmentsProjection({
      document,
      sheetId: sheet.id,
    }).byTopicId[root.id].images[0];

    const preview = createMindMapStaticSvgPreview(document);
    const svg = renderSpec(preview.spec);
    const image = svg.querySelector<SVGImageElement>('.mindmap-static-topic-image image');
    const [viewBoxX, viewBoxY, viewBoxWidth, viewBoxHeight] = (svg.getAttribute('viewBox') ?? '')
      .split(/\s+/u)
      .map(Number);

    expect(preview.status).toBe('ready');
    expect(preview.height).toBe(MIND_MAP_STATIC_SVG_LIMITS.maxHeight);
    expect(preview.width).toBe(MIND_MAP_STATIC_SVG_LIMITS.width);
    expect(Number(image?.getAttribute('width'))).toBe(projectedImage.displaySize.width);
    expect(Number(image?.getAttribute('height'))).toBe(projectedImage.displaySize.height);
    expect(viewBoxX).toBe(0);
    expect(viewBoxY).toBe(0);
    expect(viewBoxWidth).toBeGreaterThanOrEqual(
      Number(image?.getAttribute('x')) + projectedImage.displaySize.width,
    );
    expect(viewBoxHeight).toBeGreaterThanOrEqual(
      Number(image?.getAttribute('y')) + projectedImage.displaySize.height,
    );
    expect(preview.visibleTopicCount).toBeGreaterThanOrEqual(1);
  });

  it('uses deterministic non-leaking placeholders, renders Sticker sides, and excludes backgrounds', () => {
    const baselineDocument = createMindMapV1SmallFixture();
    const baselineSheet = Object.values(baselineDocument.sheets)[0];
    const baselineRoot = baselineSheet.topics[baselineSheet.rootTopicId];
    baselineRoot.title = createRichText('Placeholder root');

    const document = structuredClone(baselineDocument);
    const sheet = Object.values(document.sheets)[0];
    const root = sheet.topics[sheet.rootTopicId];
    const managedAssetId = assetId(10);
    const embeddedAssetId = assetId(11);
    const credentialAssetId = assetId(12);
    const deferredAssetId = assetId(14);
    document.assets[managedAssetId] = {
      id: managedAssetId,
      fileName: 'managed.png',
      mimeType: 'image/png',
      byteSize: 10,
      sha256: 'c'.repeat(64),
      source: {
        kind: 'managed',
        objectKey: `mindmap-images/sha256/${'c'.repeat(64)}.png`,
      },
      intrinsicSize: { width: 60, height: 32 },
    };
    document.assets[embeddedAssetId] = {
      id: embeddedAssetId,
      fileName: 'embedded.png',
      mimeType: 'image/png',
      byteSize: 11,
      sha256: 'd'.repeat(64),
      source: { kind: 'embedded', relativePath: 'resources/SECRET_EMBEDDED_PATH.png' },
      intrinsicSize: { width: 64, height: 36 },
    };
    document.assets[credentialAssetId] = {
      id: credentialAssetId,
      fileName: 'credentials.png',
      mimeType: 'image/png',
      byteSize: 12,
      sha256: 'e'.repeat(64),
      source: {
        kind: 'remote',
        url: 'https://cdn.example.test/credentials.png?signature=SECRET_SIGNED_QUERY',
      },
    };
    document.assets[deferredAssetId] = {
      id: deferredAssetId,
      fileName: 'deferred.png',
      mimeType: 'image/png',
      byteSize: 14,
      sha256: '1'.repeat(64),
      source: { kind: 'remote', url: 'https://cdn.example.test/DEFERRED_SECRET.png' },
      intrinsicSize: { width: 200, height: 120 },
    };

    const placeholderInputs = [
      { id: imageId(10), assetId: managedAssetId, side: 'top' as const },
      { id: imageId(11), assetId: embeddedAssetId, side: 'bottom' as const },
      { id: imageId(12), assetId: credentialAssetId, side: 'top' as const },
    ];
    for (const [index, input] of placeholderInputs.entries()) {
      sheet.images[input.id] = {
        id: input.id,
        topicId: root.id,
        assetId: input.assetId,
        orderKey: `placeholder-${index}`,
        role: 'inline',
        placement: { side: input.side, align: 'center', offset: { x: 0, y: 0 } },
        ...(index === 0 ? { size: { width: 72, height: 40 } } : {}),
        alt: `Unavailable ${index}`,
      };
    }
    sheet.images[imageId(14)] = {
      id: imageId(14),
      topicId: root.id,
      assetId: managedAssetId,
      orderKey: 'deferred-sticker',
      role: 'sticker',
      placement: { side: 'top', align: 'center', offset: { x: 0, y: 0 } },
      size: { width: 200, height: 120 },
      alt: 'Sticker placeholder',
    };
    sheet.images[imageId(15)] = {
      id: imageId(15),
      topicId: root.id,
      assetId: deferredAssetId,
      orderKey: 'deferred-left',
      role: 'background',
      placement: { side: 'left', align: 'center', offset: { x: 0, y: 0 } },
      size: { width: 200, height: 120 },
    };

    const projection = buildTopicEnrichmentsProjection({
      document,
      sheetId: sheet.id,
    });
    const projectedImages = projection.byTopicId[root.id].images;
    const expectedImageHeight = measureMindMapTopicNode(root, projectedImages).height
      - measureMindMapTopicNode(root).height;
    const baselineSvg = renderSpec(createMindMapStaticSvgPreview(baselineDocument).spec);
    const first = renderSpec(createMindMapStaticSvgPreview(document).spec);
    const second = renderSpec(createMindMapStaticSvgPreview(document).spec);
    const baselineRootRect = baselineSvg.querySelector<SVGRectElement>(
      'rect.mindmap-static-topic',
    );
    const rootRect = first.querySelector<SVGRectElement>('rect.mindmap-static-topic');
    const html = first.outerHTML;

    expect(
      Number(rootRect?.getAttribute('height')) - Number(baselineRootRect?.getAttribute('height')),
    ).toBe(expectedImageHeight);
    expect(first.querySelectorAll('.mindmap-static-topic-image-unavailable')).toHaveLength(4);
    expect(first.querySelector('.mindmap-static-topic-image-ready, image')).toBeNull();
    for (const image of projectedImages.filter((item) =>
      (item.role === 'inline'
        && (item.placement.side === 'top' || item.placement.side === 'bottom'))
        || item.role === 'sticker')) {
      const group = Array.from(first.querySelectorAll<SVGGElement>(
        '.mindmap-static-topic-image-unavailable',
      )).find((item) => item.querySelector(':scope > title')?.textContent === image.alt);
      const placeholder = group?.querySelector<SVGRectElement>(':scope > rect');
      expect(group?.getAttribute('data-image-size-source')).toBe(image.displaySizeSource);
      expect(Number(placeholder?.getAttribute('width'))).toBe(image.displaySize.width);
      expect(Number(placeholder?.getAttribute('height'))).toBe(image.displaySize.height);
      expect(group?.getAttribute('data-image-role')).toBe(image.role);
    }
    expect(html).not.toContain('mindmap-images/sha256/');
    expect(html).not.toContain('SECRET_EMBEDDED_PATH');
    expect(html).not.toContain('SECRET_SIGNED_QUERY');
    expect(html).not.toContain('DEFERRED_SECRET');
    expect(html).not.toMatch(/javascript:|data:|file:/iu);
    expect(second.outerHTML).toBe(html);
  });

  it('defensively renders missing/non-image projections without leaking their file paths', async () => {
    const document = createMindMapV1SmallFixture();
    const sheet = Object.values(document.sheets)[0];
    const root = sheet.topics[sheet.rootTopicId];
    root.title = createRichText('Defensive placeholder root');
    const missingProjection: ImageEnrichmentProjection = {
      id: imageId(30),
      assetId: assetId(30),
      fileName: 'private/SECRET_MISSING_FILE_PATH.png',
      missingAsset: true,
      role: 'inline',
      placement: { side: 'top', align: 'center', offset: { x: 0, y: 0 } },
      displaySize: { width: 80, height: 48 },
      displaySizeSource: 'fallback',
      rendererSource: { status: 'unavailable', reason: 'missing-asset' },
    };
    const nonImageProjection: ImageEnrichmentProjection = {
      id: imageId(31),
      assetId: assetId(31),
      fileName: 'private/SECRET_NON_IMAGE_PATH.pdf',
      mimeType: 'application/pdf',
      byteSize: 256,
      missingAsset: false,
      role: 'inline',
      placement: { side: 'bottom', align: 'center', offset: { x: 0, y: 0 } },
      displaySize: { width: 90, height: 54 },
      displaySizeSource: 'explicit',
      size: { width: 90, height: 54 },
      rendererSource: {
        status: 'ready',
        url: 'https://cdn.example.test/private/SECRET_NON_IMAGE_PATH.pdf',
      },
    };
    const unsafeRemoteProjections: ImageEnrichmentProjection[] = [
      'javascript:alert(SECRET_JAVASCRIPT_URL)',
      'data:image/png;base64,SECRET_DATA_URL',
      'file:///private/SECRET_FILE_URL.png',
      'https://user:SECRET_URL_PASSWORD@cdn.example.test/private.png',
    ].map((url, index) => ({
      id: imageId(40 + index),
      assetId: assetId(40 + index),
      fileName: `private/SECRET_UNSAFE_FILE_${index}.png`,
      mimeType: 'image/png',
      byteSize: 128,
      missingAsset: false,
      role: 'inline',
      placement: { side: 'top', align: 'center', offset: { x: 0, y: 0 } },
      displaySize: { width: 72, height: 40 },
      displaySizeSource: 'explicit',
      size: { width: 72, height: 40 },
      rendererSource: { status: 'ready', url },
    }));

    vi.resetModules();
    vi.doMock('../ui/enrichmentProjection', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../ui/enrichmentProjection')>();
      return {
        ...actual,
        buildTopicEnrichmentsProjection: (
          input: Parameters<typeof actual.buildTopicEnrichmentsProjection>[0],
        ) => {
          const projection = actual.buildTopicEnrichmentsProjection(input);
          const rootProjection = projection.byTopicId[root.id];
          return {
            ...projection,
            byTopicId: {
              ...projection.byTopicId,
              [root.id]: {
                ...rootProjection,
                images: [missingProjection, ...unsafeRemoteProjections, nonImageProjection],
              },
            },
          };
        },
      };
    });

    try {
      const dynamicExporter = await import('./staticSvg');
      const first = renderSpec(dynamicExporter.createMindMapStaticSvgPreview(document).spec);
      const second = renderSpec(dynamicExporter.createMindMapStaticSvgPreview(document).spec);
      const placeholders = first.querySelectorAll<SVGGElement>(
        '.mindmap-static-topic-image-unavailable',
      );

      expect(placeholders).toHaveLength(6);
      expect(Array.from(placeholders, (element) =>
        element.getAttribute('data-image-unavailable-reason'))).toEqual([
        'missing-asset',
        'unsafe-remote-url',
        'unsafe-remote-url',
        'unsafe-remote-url',
        'unsafe-remote-url',
        'unsupported-mime-type',
      ]);
      expect(first.querySelector('image')).toBeNull();
      expect(first.outerHTML).not.toContain('SECRET_MISSING_FILE_PATH');
      expect(first.outerHTML).not.toContain('SECRET_NON_IMAGE_PATH');
      expect(first.outerHTML).not.toContain('SECRET_JAVASCRIPT_URL');
      expect(first.outerHTML).not.toContain('SECRET_DATA_URL');
      expect(first.outerHTML).not.toContain('SECRET_FILE_URL');
      expect(first.outerHTML).not.toContain('SECRET_URL_PASSWORD');
      expect(first.outerHTML).not.toContain('SECRET_UNSAFE_FILE_');
      expect(second.outerHTML).toBe(first.outerHTML);
    } finally {
      vi.doUnmock('../ui/enrichmentProjection');
      vi.resetModules();
    }
  });

  it.each([
    'token',
    'access_token',
    'apikey',
    'api_key',
    'authorization',
    'sig',
    'signature',
    'X-Amz-Signature',
    'X-Amz-Credential',
    'X-Amz-Security-Token',
    'X-Goog-Signature',
    'X-Goog-Credential',
    'Key-Pair-Id',
  ])('does not emit remote image URLs carrying the %s query credential', (queryKey) => {
    const document = createMindMapV1SmallFixture();
    const sheet = Object.values(document.sheets)[0];
    const root = sheet.topics[sheet.rootTopicId];
    const remoteAssetId = assetId(100);
    const remoteImageId = imageId(100);
    document.assets[remoteAssetId] = {
      id: remoteAssetId,
      fileName: 'signed.png',
      mimeType: 'image/png',
      byteSize: 100,
      sha256: '2'.repeat(64),
      source: {
        kind: 'remote',
        url: `https://cdn.example.test/signed.png?${queryKey}=SIGNED_CREDENTIAL_SECRET`,
      },
      intrinsicSize: { width: 80, height: 48 },
    };
    sheet.images[remoteImageId] = {
      id: remoteImageId,
      topicId: root.id,
      assetId: remoteAssetId,
      orderKey: 'signed-image',
      role: 'inline',
      placement: { side: 'top', align: 'center', offset: { x: 0, y: 0 } },
    };

    const svg = renderSpec(createMindMapStaticSvgPreview(document).spec);

    expect(svg.querySelector('image')).toBeNull();
    expect(svg.querySelector('.mindmap-static-topic-image-unavailable')).not.toBeNull();
    expect(svg.outerHTML).not.toContain(queryKey);
    expect(svg.outerHTML).not.toContain('SIGNED_CREDENTIAL_SECRET');
  });

  it('renders canonical Boundary scope geometry, cascaded paint, title escaping, and no private fields', () => {
    const mindMap = createMindMapV1SmallFixture();
    const sheet = Object.values(mindMap.sheets)[0];
    const rootEdges = Object.values(sheet.treeEdges)
      .filter((edge) => edge.parentTopicId === sheet.rootTopicId)
      .sort((left, right) => left.orderKey.localeCompare(right.orderKey));
    const branchId = rootEdges[0].childTopicId;
    const childEdges = Object.values(sheet.treeEdges)
      .filter((edge) => edge.parentTopicId === branchId)
      .sort((left, right) => left.orderKey.localeCompare(right.orderKey));
    const id = boundaryId(1);
    const unsafeTitle = '范围 <核心> & "发布" <script>x()</script>';
    sheet.boundaries[id] = {
      id,
      padding: 11,
      scope: {
        kind: 'sibling-range',
        parentTopicId: branchId,
        firstEdgeId: childEdges[0].id,
        lastEdgeId: childEdges[1].id,
        includeDescendants: false,
      },
      title: createRichText(unsafeTitle),
      style: {
        overrides: {
          shape: 'rounded-rectangle',
          fill: { color: { kind: 'literal', value: '#112233' }, opacity: 0.35 },
          border: {
            color: { kind: 'literal', value: '#445566' },
            dash: [4, 2],
            radius: 13,
            width: 3,
          },
          typography: {
            color: { kind: 'literal', value: '#778899' },
            fontFamily: 'https://private.font.example/secret',
            fontSize: 14,
            fontWeight: 700,
          },
        },
      },
      extensions: {
        'app.nmdd.private-boundary-preview-test': {
          privateToken: 'BOUNDARY_TOP_SECRET',
          remoteUrl: 'https://private.example.test/boundary',
        },
      },
    };

    const preview = createMindMapStaticSvgPreview(mindMap);
    const svg = renderSpec(preview.spec);
    const html = svg.outerHTML;
    const group = svg.querySelector<SVGGElement>('g.mindmap-static-boundary');
    const outline = group?.querySelector<SVGRectElement>('rect');
    const firstMember = topicRectByTitle(svg, '分支 1.1');
    const lastMember = topicRectByTitle(svg, '分支 1.2');

    expect(preview.status).toBe('ready');
    expect(preview.totalBoundaryCount).toBe(1);
    expect(preview.visibleBoundaryCount).toBe(1);
    expect(group?.getAttribute('data-boundary-shape')).toBe('rounded-rectangle');
    expect(group?.getAttribute('data-boundary-scope-truncated')).toBeNull();
    expect(outline?.getAttribute('x')).toBe(String(Number(firstMember.getAttribute('x')) - 11));
    expect(outline?.getAttribute('y')).toBe(String(Number(firstMember.getAttribute('y')) - 11));
    expect(Number(outline?.getAttribute('height'))).toBe(
      Number(lastMember.getAttribute('y'))
        + Number(lastMember.getAttribute('height'))
        - Number(firstMember.getAttribute('y'))
        + 22,
    );
    expect(outline?.getAttribute('fill')).toBe('#112233');
    expect(outline?.getAttribute('fill-opacity')).toBe('0.35');
    expect(outline?.getAttribute('stroke')).toBe('#445566');
    expect(outline?.getAttribute('stroke-width')).toBe('3');
    expect(outline?.getAttribute('stroke-dasharray')).toBe('4 2');
    expect(outline?.getAttribute('rx')).toBe('13');
    expect(group?.querySelector('text')?.textContent).toBe(unsafeTitle);
    expect(group?.querySelector('text')?.getAttribute('fill')).toBe('#778899');
    expect(group?.querySelector('text')?.getAttribute('font-size')).toBe('14');
    expect(group?.querySelector('text')?.getAttribute('font-weight')).toBe('700');
    expect(group?.querySelector('text')?.getAttribute('font-family')).toBe('system-ui, sans-serif');
    expect(html).toContain('&lt;核心&gt; &amp; "发布"');
    expect(html).toContain('&lt;script&gt;x()&lt;/script&gt;');
    expect(svg.querySelector('script, image, a, foreignObject')).toBeNull();
    expect(html).not.toContain('BOUNDARY_TOP_SECRET');
    expect(html).not.toContain('private.example.test');
    expect(html).not.toContain('private.font.example');
    expect(html).not.toContain(id);
  });

  it('renders canonical Summary bracket/connector geometry and omits private fields', () => {
    const mindMap = createMindMapElementsFixture();
    const sheet = Object.values(mindMap.sheets)[0];
    const summary = Object.values(sheet.summaries)[0];
    const memberTopicId = summary.scope.kind === 'explicit'
      ? summary.scope.topicIds[0]
      : undefined;
    if (!memberTopicId) throw new Error('Summary fixture has no explicit member.');
    sheet.topics[memberTopicId].title = createRichText('Summary <member> & scope');
    sheet.topics[summary.resultTopicId].title = createRichText('Summary result <safe>');
    summary.orientation = 'bottom';
    summary.style = {
      overrides: {
        opacity: 0.65,
        border: {
          color: { kind: 'literal', value: '#123456' },
          dash: [5, 3],
          width: 4,
        },
      },
    };
    summary.extensions = {
      'app.nmdd.private-summary-preview-test': {
        privateToken: 'SUMMARY_TOP_SECRET',
        remoteUrl: 'https://private.example.test/summary',
      },
    };

    const preview = createMindMapStaticSvgPreview(mindMap);
    const svg = renderSpec(preview.spec);
    const html = svg.outerHTML;
    const group = svg.querySelector<SVGGElement>('g.mindmap-static-summary');
    const bracket = group?.querySelector<SVGPathElement>('[data-summary-part="bracket"]');
    const connector = group?.querySelector<SVGPathElement>('[data-summary-part="connector"]');

    expect(preview.status).toBe('ready');
    expect(preview.totalSummaryCount).toBe(1);
    expect(preview.visibleSummaryCount).toBe(1);
    expect(svg.getAttribute('data-total-summary-count')).toBe('1');
    expect(svg.getAttribute('data-visible-summary-count')).toBe('1');
    expect(group?.getAttribute('data-summary-orientation')).toBe('bottom');
    expect(group?.getAttribute('data-summary-scope-truncated')).toBeNull();
    expect(group?.getAttribute('opacity')).toBe('0.65');
    expect(bracket?.getAttribute('stroke')).toBe('#123456');
    expect(bracket?.getAttribute('stroke-width')).toBe('4');
    expect(bracket?.getAttribute('stroke-dasharray')).toBe('5 3');
    expect(connector?.getAttribute('stroke')).toBe('#123456');
    expect(bracket?.getAttribute('d')).toBeTruthy();
    expect(connector?.getAttribute('d')).toBeTruthy();
    expect(topicRectByTitle(svg, 'Summary <member> & scope')).not.toBeNull();
    expect(topicRectByTitle(svg, 'Summary result <safe>')).not.toBeNull();
    expect(html).toContain('Summary &lt;member&gt; &amp; scope');
    expect(svg.querySelector('script, image, a, foreignObject')).toBeNull();
    expect(html).not.toContain('SUMMARY_TOP_SECRET');
    expect(html).not.toContain('private.example.test');
    expect(html).not.toContain(summary.id);
  });

  it('maps all nine Boundary shapes and marks an unknown shape with a non-leaking fallback', () => {
    const mindMap = createMindMapV1SmallFixture();
    const sheet = Object.values(mindMap.sheets)[0];
    const scopedTopicId = Object.values(sheet.treeEdges)
      .sort((left, right) => left.orderKey.localeCompare(right.orderKey))[0].childTopicId;
    const shapes = [
      'rectangle',
      'rounded-rectangle',
      'capsule',
      'ellipse',
      'scallop',
      'wave',
      'tension',
      'bracket',
      'none',
    ] as const;
    for (const [index, shape] of shapes.entries()) {
      const id = boundaryId(100 + index);
      sheet.boundaries[id] = {
        id,
        padding: 2 + index,
        scope: { kind: 'explicit', topicIds: [scopedTopicId] },
        style: { overrides: { shape } },
      };
    }
    const fallbackId = boundaryId(200);
    sheet.boundaries[fallbackId] = {
      id: fallbackId,
      padding: 4,
      scope: { kind: 'explicit', topicIds: [scopedTopicId] },
      style: { overrides: { shape: 'https://private.example/unsupported-shape' } },
      extensions: {
        'app.nmdd.private-boundary-shape': { secret: 'UNSUPPORTED_SHAPE_SECRET' },
      },
    };

    const preview = createMindMapStaticSvgPreview(mindMap);
    const svg = renderSpec(preview.spec);
    const groups = Array.from(svg.querySelectorAll<SVGGElement>('g.mindmap-static-boundary'));
    const groupFor = (shape: string): SVGGElement | undefined => groups.find(
      (group) => group.getAttribute('data-boundary-shape') === shape
        && group.getAttribute('data-boundary-shape-fallback') === null,
    );

    expect(preview.totalBoundaryCount).toBe(10);
    expect(preview.visibleBoundaryCount).toBe(10);
    expect(groupFor('rectangle')?.querySelector('rect')).not.toBeNull();
    expect(groupFor('rounded-rectangle')?.querySelector('rect')).not.toBeNull();
    expect(groupFor('capsule')?.querySelector('rect')).not.toBeNull();
    expect(groupFor('ellipse')?.querySelector('ellipse')).not.toBeNull();
    for (const shape of ['scallop', 'wave', 'tension', 'bracket'] as const) {
      expect(groupFor(shape)?.querySelector('path')).not.toBeNull();
    }
    expect(groupFor('bracket')?.querySelector('path')?.getAttribute('fill')).toBe('none');
    expect(groupFor('none')?.querySelector('rect, ellipse, path')).toBeNull();

    const fallback = groups.find(
      (group) => group.getAttribute('data-boundary-shape-fallback') !== null,
    );
    expect(fallback?.getAttribute('data-boundary-shape')).toBe('rounded-rectangle');
    expect(fallback?.getAttribute('data-boundary-shape-fallback')).toBe(
      'unsupported-to-rounded-rectangle',
    );
    expect(fallback?.querySelector('rect')).not.toBeNull();
    expect(svg.outerHTML).not.toContain('unsupported-shape');
    expect(svg.outerHTML).not.toContain('private.example');
    expect(svg.outerHTML).not.toContain('UNSUPPORTED_SHAPE_SECRET');
    expect(svg.outerHTML).not.toContain(fallbackId);
  });

  it('caps rendered Boundaries, reports omissions, and keeps serialized output bounded', () => {
    const mindMap = createMindMapV1SmallFixture();
    const sheet = Object.values(mindMap.sheets)[0];
    const scopedTopicId = Object.values(sheet.treeEdges)
      .sort((left, right) => left.orderKey.localeCompare(right.orderKey))[0].childTopicId;
    const boundaryCount = MIND_MAP_STATIC_SVG_LIMITS.maxVisibleBoundaries + 7;
    for (let index = 0; index < boundaryCount; index += 1) {
      const id = boundaryId(1_000 + index);
      sheet.boundaries[id] = {
        id,
        padding: index,
        scope: { kind: 'explicit', topicIds: [scopedTopicId] },
        style: { overrides: { shape: 'rectangle' } },
        extensions: {
          'app.nmdd.private-boundary-limit-test': {
            privateToken: `LIMIT_SECRET_${index}`,
            remoteUrl: `https://private.example.test/${index}`,
          },
        },
      };
    }

    const preview = createMindMapStaticSvgPreview(mindMap);
    const svg = renderSpec(preview.spec);

    expect(preview.status).toBe('ready');
    expect(preview.totalBoundaryCount).toBe(boundaryCount);
    expect(preview.visibleBoundaryCount).toBe(MIND_MAP_STATIC_SVG_LIMITS.maxVisibleBoundaries);
    expect(svg.querySelectorAll('.mindmap-static-boundary')).toHaveLength(
      MIND_MAP_STATIC_SVG_LIMITS.maxVisibleBoundaries,
    );
    expect(svg.getAttribute('data-total-boundary-count')).toBe(String(boundaryCount));
    expect(svg.getAttribute('data-visible-boundary-count')).toBe(
      String(MIND_MAP_STATIC_SVG_LIMITS.maxVisibleBoundaries),
    );
    expect(svg.textContent).toContain('个边界未显示');
    expect(svg.outerHTML).not.toContain('LIMIT_SECRET_');
    expect(svg.outerHTML).not.toContain('private.example.test');
    expect(svg.outerHTML.length).toBeLessThan(30_000);
  });

  it('migrates legacy V0 before rendering its readable tree', () => {
    const legacy: LegacyMindMapGraph = {
      nodes: [
        { id: 'root', type: 'mindMap', position: { x: 0, y: 0 }, data: { label: '中心主题' } },
        { id: 'one', type: 'mindMap', position: { x: 220, y: -40 }, data: { label: '分支一 🌱' } },
        { id: 'two', type: 'mindMap', position: { x: 440, y: -40 }, data: { label: '子主题' } },
      ],
      edges: [
        { id: 'root-one', source: 'root', target: 'one' },
        { id: 'one-two', source: 'one', target: 'two' },
      ],
    };

    const preview = createMindMapStaticSvgPreview(legacy);
    const svg = renderSpec(preview.spec);

    expect(preview.status).toBe('ready');
    expect(preview.totalTopicCount).toBe(3);
    expect(svg.textContent).toContain('中心主题');
    expect(svg.textContent).toContain('分支一 🌱');
    expect(svg.textContent).toContain('子主题');
    expect(svg.querySelectorAll('path')).toHaveLength(2);
  });

  it('renders a visible generic fallback for malformed or unsupported data', () => {
    const preview = createMindMapStaticSvgPreview('{not valid JSON');
    const svg = renderSpec(preview.spec);

    expect(preview.status).toBe('error');
    expect(svg.getAttribute('data-mindmap-static-preview')).toBe('error');
    expect(svg.getAttribute('aria-label')).toBe('思维导图无法预览');
    expect(svg.textContent).toContain('思维导图无法预览');
    expect(svg.querySelector('script, a, image, foreignObject')).toBeNull();
  });

  it('keeps a 10K-topic fallback bounded in dimensions and serialized size', { timeout: 30_000 }, () => {
    const preview = createMindMapStaticSvgPreview(createLargeLegacyGraph(10_000));
    const svg = renderSpec(preview.spec);

    expect(preview.status).toBe('ready');
    expect(preview.totalTopicCount).toBe(10_000);
    expect(preview.visibleTopicCount).toBeLessThanOrEqual(
      MIND_MAP_STATIC_SVG_LIMITS.maxVisibleTopics,
    );
    expect(preview.height).toBeLessThanOrEqual(MIND_MAP_STATIC_SVG_LIMITS.maxHeight);
    expect(Number(svg.getAttribute('height'))).toBeLessThanOrEqual(
      MIND_MAP_STATIC_SVG_LIMITS.maxHeight,
    );
    expect(svg.querySelectorAll('.mindmap-static-topic').length).toBe(
      preview.visibleTopicCount,
    );
    expect(svg.textContent).toContain('预览已截断');
    expect(svg.outerHTML.length).toBeLessThan(30_000);
  });

  it('keeps the atom payload/readback and surrounding body order while adding SVG HTML', () => {
    const mindMap = createMindMapV1SmallFixture();
    const html = generateHTML({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Before map' }] },
        { type: 'mindMap', attrs: { data: mindMap } },
        { type: 'paragraph', content: [{ type: 'text', text: 'After map' }] },
      ],
    }, [StarterKit, MindMap]);
    const body = new DOMParser().parseFromString(html, 'text/html').body;
    const block = body.querySelector<HTMLDivElement>('div[data-type="mind-map"]');
    const svg = block?.querySelector('svg');

    expect(Array.from(body.children).map((element) => element.tagName)).toEqual([
      'P',
      'DIV',
      'P',
    ]);
    expect(body.children[0].textContent).toBe('Before map');
    expect(body.children[2].textContent).toBe('After map');
    expect(block?.getAttribute('data-mindmap')).toBeTruthy();
    expect(svg?.getAttribute('data-mindmap-static-preview')).toBe('ready');
    expect(svg?.querySelector('script, a, image, foreignObject')).toBeNull();

    const roundTripped = generateJSON(html, [StarterKit, MindMap]);
    const roundTripData = roundTripped.content?.[1]?.attrs?.data;
    expect(JSON.parse(String(roundTripData))).toEqual(mindMap);
  });
});
