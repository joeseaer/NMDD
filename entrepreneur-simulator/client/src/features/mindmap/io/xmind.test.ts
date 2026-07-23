import { unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { createEntityId } from '../domain/ids';
import { createTopic } from '../domain/defaults';
import type { MindMapSheet, Topic } from '../domain/types';
import { validateMindMapDocument } from '../domain/validation';
import { createMindMapElementsFixture } from '../testing/fixtures';
import { compareMindMapViewOrderedEntities } from '../view/ordering';
import { mindMapRichTextToPlainText } from '../view/text';
import {
  XMIND_CONTENT_JSON_FIXTURE,
  createHandcraftedXMindFixtureZip,
} from './__fixtures__/xmind';
import {
  XMIND_METADATA_EXTENSION_KEY,
  XMIND_RAW_SHEET_EXTENSION_KEY,
  XMIND_RAW_TITLE_EXTENSION_KEY,
  XMIND_RESOURCE_MANIFEST_EXTENSION_KEY,
  XMIND_SOURCE_ID_EXTENSION_KEY,
  exportXMind,
  importXMind,
  type MindMapImportIdFactory,
} from './index';

function deterministicIdFactory(start = 1): MindMapImportIdFactory {
  let counter = start;
  return () => {
    const suffix = counter.toString(16).padStart(12, '0');
    counter += 1;
    return `01890f1a-0000-7000-8000-${suffix}`;
  };
}

function topicBySource(sheet: MindMapSheet, sourceId: string): Topic {
  const topic = Object.values(sheet.topics).find(
    (candidate) => candidate.extensions?.[XMIND_SOURCE_ID_EXTENSION_KEY] === sourceId,
  );
  if (!topic) throw new Error(`Missing imported topic ${sourceId}`);
  return topic;
}

function decodeJsonFile(bytes: Uint8Array, name: string): unknown {
  const unzipped = unzipSync(bytes);
  const file = unzipped[name];
  if (!file) throw new Error(`Missing ${name}`);
  return JSON.parse(new TextDecoder().decode(file));
}

function fixtureWithContent(content: unknown, extraFiles: Record<string, Uint8Array> = {}): Uint8Array {
  const encoder = new TextEncoder();
  const mtime = new Date(2000, 0, 1, 0, 0, 0);
  return zipSync({
    'content.json': [Uint8Array.from(encoder.encode(JSON.stringify(content))), { level: 6, mtime }],
    'manifest.json': [Uint8Array.from(encoder.encode('{"file-entries":{"content.json":{}}}')), { level: 6, mtime }],
    ...Object.fromEntries(Object.entries(extraFiles).map(([name, value]) =>
      [name, [Uint8Array.from(value), { level: 6, mtime }]])),
  }, { level: 6, mtime });
}

function repackXMindFiles(files: Readonly<Record<string, Uint8Array>>): Uint8Array {
  const mtime = new Date(2000, 0, 1, 0, 0, 0);
  return zipSync(Object.fromEntries(Object.entries(files).map(([name, bytes]) => [
    name,
    [Uint8Array.from(bytes), { level: 6 as const, mtime }],
  ])), { level: 6, mtime });
}

const PNG_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x03,
]);
const GIF_BYTES = Uint8Array.from([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x04, 0x00, 0x05, 0x00,
]);
const JPEG_BYTES = Uint8Array.from([
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00,
  0x06, 0x00, 0x07, 0x03, 0x01, 0x11, 0x00,
]);
const WEBP_BYTES = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 0x16, 0x00, 0x00, 0x00,
  0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58,
  0x0a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x07, 0x00, 0x00, 0x08, 0x00, 0x00,
]);

function rawTopicById(value: unknown, id: string): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.id === id) return record;
  if (typeof record.children !== 'object' || record.children === null) return null;
  for (const children of Object.values(record.children as Record<string, unknown>)) {
    if (!Array.isArray(children)) continue;
    for (const child of children) {
      const found = rawTopicById(child, id);
      if (found) return found;
    }
  }
  return null;
}

describe('XMind ZIP/content.json import', () => {
  it('imports allowed raster resources as canonical Assets and topic-owned Images with deduplication', () => {
    const result = importXMind(fixtureWithContent([{
      id: 'images-sheet',
      title: 'Images',
      rootTopic: {
        id: 'root',
        title: 'Root',
        children: {
          attached: [
            { id: 'png', title: 'PNG', image: { src: 'xap:Resources/pixel.png', width: 20, height: 30, placement: 'bottom', alt: 'Pixel' } },
            { id: 'png-copy', title: 'PNG copy', image: { src: 'xap:Resources/pixel.png' } },
            { id: 'jpeg', title: 'JPEG', image: { src: 'xap:resources/photo.jpg', width: 70, height: 60 } },
            { id: 'gif', title: 'GIF', image: { src: 'xap:resources/anim.gif' } },
            { id: 'webp', title: 'WebP', image: { src: 'xap:resources/modern.webp' } },
          ],
        },
      },
    }], {
      'Resources/pixel.png': PNG_BYTES,
      'resources/photo.jpg': JPEG_BYTES,
      'resources/anim.gif': GIF_BYTES,
      'resources/modern.webp': WEBP_BYTES,
    }), { idFactory: deterministicIdFactory() });

    expect(result.report.success, JSON.stringify(result.report.diagnostics)).toBe(true);
    expect(result.report.diagnostics.filter(({ code }) => code === 'xmind.topic-image-imported'))
      .toHaveLength(5);
    const document = result.document!;
    const sheet = Object.values(document.sheets)[0];
    expect(Object.values(document.assets)).toHaveLength(4);
    expect(Object.values(sheet.images)).toHaveLength(5);
    expect(result.resourceBytes).toEqual(expect.objectContaining({
      'Resources/pixel.png': PNG_BYTES,
      'resources/photo.jpg': JPEG_BYTES,
      'resources/anim.gif': GIF_BYTES,
      'resources/modern.webp': WEBP_BYTES,
    }));

    const pngTopic = topicBySource(sheet, 'png');
    const pngCopyTopic = topicBySource(sheet, 'png-copy');
    const pngImage = Object.values(sheet.images).find((image) => image.topicId === pngTopic.id)!;
    const pngCopyImage = Object.values(sheet.images).find(
      (image) => image.topicId === pngCopyTopic.id,
    )!;
    expect(pngImage).toEqual(expect.objectContaining({
      alt: 'Pixel',
      placement: { align: 'center', offset: { x: 0, y: 0 }, side: 'bottom' },
      size: { height: 30, width: 20 },
    }));
    expect(pngCopyImage.assetId).toBe(pngImage.assetId);
    expect(document.assets[pngImage.assetId]).toEqual(expect.objectContaining({
      byteSize: PNG_BYTES.byteLength,
      intrinsicSize: { height: 3, width: 2 },
      mimeType: 'image/png',
      sha256: 'db42d7b740a36256f694172427189b90e7d94a9abebab81435bf4bb3d7b9bf9d',
      source: { kind: 'embedded', relativePath: 'Resources/pixel.png' },
    }));
    expect(new Set(Object.values(sheet.images).map((image) => image.orderKey)).size).toBe(1);
    expect(validateMindMapDocument(document).valid).toBe(true);
  });

  it('keeps missing, traversal, external, and spoofed topic-image sources inert', () => {
    const result = importXMind(fixtureWithContent([{
      id: 'unsafe-images-sheet',
      rootTopic: {
        id: 'root',
        title: 'Root',
        children: { attached: [
          { id: 'missing', title: 'Missing', image: { src: 'xap:resources/missing.png' } },
          { id: 'traversal', title: 'Traversal', image: { src: 'xap:resources/../secret.png' } },
          { id: 'external', title: 'External', image: { src: 'https://private.example/image.png?token=secret' } },
          { id: 'spoofed', title: 'Spoofed', image: { src: 'xap:resources/spoofed.png' } },
        ] },
      },
    }], {
      'resources/spoofed.png': new TextEncoder().encode('not a png'),
    }), { idFactory: deterministicIdFactory() });

    expect(result.report.success).toBe(true);
    expect(result.report.diagnostics.map(({ code }) => code)).toEqual(expect.arrayContaining([
      'xmind.topic-image-resource-missing',
      'xmind.topic-image-source-unsafe',
      'xmind.topic-image-resource-spoofed',
    ]));
    expect(Object.keys(result.document!.assets)).toHaveLength(0);
    expect(Object.keys(Object.values(result.document!.sheets)[0].images)).toHaveLength(0);
    expect(result.resourceBytes).toBeUndefined();

    const reexported = exportXMind(result.document!);
    expect(reexported.report.diagnostics.map(({ code }) => code)).toContain(
      'xmind.sensitive-resource-source-redacted',
    );
    const reexportedFiles = unzipSync(reexported.bytes!);
    for (const name of ['content.json', 'manifest.json', 'metadata.json']) {
      expect(new TextDecoder().decode(reexportedFiles[name])).not.toContain('secret');
    }
  });

  it('bounds distinct decoded image resources and per-image uncompressed bytes', () => {
    const resourceCount = 513;
    const topics = Array.from({ length: resourceCount }, (_, index) => ({
      id: `image-${index}`,
      title: `Image ${index}`,
      image: { src: `xap:resources/image-${index}.gif` },
    }));
    const resources = Object.fromEntries(
      topics.map((_, index) => [`resources/image-${index}.gif`, GIF_BYTES]),
    );
    const countLimited = importXMind(fixtureWithContent([{
      id: 'count-limit-sheet',
      rootTopic: { id: 'root', title: 'Root', children: { attached: topics } },
    }], resources), { idFactory: deterministicIdFactory() });
    expect(countLimited.report.success, JSON.stringify(countLimited.report.diagnostics)).toBe(true);
    expect(countLimited.report.diagnostics.map(({ code }) => code)).toContain(
      'xmind.topic-image-resource-count-limit',
    );
    expect(Object.keys(Object.values(countLimited.document!.sheets)[0].images)).toHaveLength(512);
    // Identical validated bytes are represented by one canonical Asset.
    expect(Object.keys(countLimited.document!.assets)).toHaveLength(1);

    const oversizedBytes = new Uint8Array(15 * 1024 * 1024 + 1);
    oversizedBytes.set(GIF_BYTES);
    const sizeLimited = importXMind(fixtureWithContent([{
      id: 'size-limit-sheet',
      rootTopic: {
        id: 'root',
        title: 'Root',
        image: { src: 'xap:resources/oversized.gif' },
      },
    }], { 'resources/oversized.gif': oversizedBytes }), {
      idFactory: deterministicIdFactory(80_000),
      zipLimits: { maxCompressionRatio: 2_000_000 },
    });
    expect(sizeLimited.report.success, JSON.stringify(sizeLimited.report.diagnostics)).toBe(true);
    expect(sizeLimited.report.diagnostics.map(({ code }) => code)).toContain(
      'xmind.topic-image-resource-size-limit',
    );
    expect(Object.keys(sizeLimited.document!.assets)).toHaveLength(0);
    expect(Object.keys(Object.values(sizeLimited.document!.sheets)[0].images)).toHaveLength(0);
  });

  it('degrades mixed-side native ranges to an explicit descendant closure', () => {
    const result = importXMind(fixtureWithContent([{
      id: 'mixed-range-sheet',
      title: 'Mixed range',
      rootTopic: {
        id: 'root',
        title: 'Root',
        boundaries: [{ id: 'boundary', range: '(0,1)' }],
        children: {
          attached: [{
            id: 'a',
            title: 'A',
            extensions: [{ provider: 'app.nmdd.branch-side', content: { side: 'right' } }],
            children: { attached: [{ id: 'a1', title: 'A1' }] },
          }, {
            id: 'b',
            title: 'B',
            extensions: [{ provider: 'app.nmdd.branch-side', content: { side: 'left' } }],
          }],
        },
      },
    }]), { idFactory: deterministicIdFactory() });
    expect(result.report.success, JSON.stringify(result.report.diagnostics)).toBe(true);
    expect(result.report.diagnostics.map((diagnostic) => diagnostic.code))
      .toContain('xmind.boundary-range-degraded');
    const sheet = Object.values(result.document!.sheets)[0];
    const boundary = Object.values(sheet.boundaries)[0];
    expect(boundary.scope.kind).toBe('explicit');
    if (boundary.scope.kind === 'explicit') {
      expect(boundary.scope.topicIds.map((topicId) =>
        mindMapRichTextToPlainText(sheet.topics[topicId].title)))
        .toEqual(['A', 'A1', 'B']);
    }
  });

  it('imports a handcrafted multi-sheet 2026-style package and reconstructs common semantics', () => {
    const result = importXMind(createHandcraftedXMindFixtureZip({ includeResource: true }), {
      idFactory: deterministicIdFactory(),
    });

    expect(result.report.success, JSON.stringify(result.report.diagnostics)).toBe(true);
    expect(result.report.format).toBe('xmind-content-json');
    expect(result.report.importedSheets).toBe(2);
    expect(result.report.importedTopics).toBe(9);
    expect(result.report.diagnostics.map((item) => item.code)).toContain(
      'xmind.resources-not-embedded',
    );
    const document = result.document!;
    expect(document.title).toBe('2026 Product Workbook');
    expect(validateMindMapDocument(document).valid).toBe(true);

    const sheets = Object.values(document.sheets);
    const product = sheets.find(
      (sheet) => sheet.extensions?.[XMIND_SOURCE_ID_EXTENSION_KEY] === 'sheet-product',
    )!;
    const finance = sheets.find(
      (sheet) => sheet.extensions?.[XMIND_SOURCE_ID_EXTENSION_KEY] === 'sheet-finance',
    )!;
    const research = topicBySource(product, 'topic-research');
    const launch = topicBySource(product, 'topic-launch');
    const floating = topicBySource(product, 'topic-floating');
    const summaryResult = topicBySource(product, 'topic-summary-result');

    expect(research.labels).toEqual(['discovery', 'Q1']);
    expect(Object.values(product.notes).map((note) =>
      mindMapRichTextToPlainText(note.content))).toContain('Evidence first.');
    expect(Object.values(product.links)).toEqual([
      expect.objectContaining({ href: 'https://example.com/research', kind: 'web', topicId: research.id }),
    ]);
    expect(Object.values(product.markerInstances).some(
      (marker) => marker.topicId === research.id,
    )).toBe(true);
    expect(Object.values(product.todos)).toEqual([
      expect.objectContaining({ completed: true, topicId: launch.id }),
    ]);
    expect(Object.values(product.boundaries)).toHaveLength(1);
    expect(Object.values(product.summaries)).toEqual([
      expect.objectContaining({ resultTopicId: summaryResult.id }),
    ]);
    expect(Object.values(product.relationships)).toEqual([
      expect.objectContaining({ routing: 'manual' }),
    ]);
    expect(floating.role).toBe('floating-root');
    expect(summaryResult.role).toBe('summary-result');
    expect(Object.values(product.treeEdges).some((edge) => edge.childTopicId === floating.id)).toBe(false);
    expect(Object.values(product.treeEdges).find((edge) => edge.childTopicId === launch.id)?.side).toBe('left');
    const orderedRootTitles = Object.values(product.treeEdges)
      .filter((edge) => edge.parentTopicId === product.rootTopicId)
      .sort(compareMindMapViewOrderedEntities)
      .map((edge) => mindMapRichTextToPlainText(product.topics[edge.childTopicId].title));
    expect(orderedRootTitles).toEqual(['Research 🔎', 'Launch']);
    expect(product.defaultBranchLayout.structure).toBe('core:mind-map');
    expect(product.defaultBranchLayout.direction).toBe('clockwise');
    expect(finance.defaultBranchLayout.structure).toBe('core:logic-chart');
    expect(finance.defaultBranchLayout.direction).toBe('right-to-left');
    const revenue = topicBySource(finance, 'topic-revenue');
    expect(Object.values(finance.links)).toEqual([
      expect.objectContaining({
        kind: 'topic',
        targetSheetId: product.id,
        targetTopicId: research.id,
        topicId: revenue.id,
      }),
    ]);
    expect(document.extensions?.[XMIND_RESOURCE_MANIFEST_EXTENSION_KEY]).toEqual([
      expect.objectContaining({ name: 'Resources/pixel.png', uncompressedSize: 4 }),
    ]);
  });

  it('converts a native Summary result position into a relative canonical offset', () => {
    const content = JSON.parse(JSON.stringify(XMIND_CONTENT_JSON_FIXTURE)) as Array<{
      rootTopic: {
        children: { summary: Array<Record<string, unknown>> };
      };
    }>;
    content[0].rootTopic.children.summary[0].position = { x: 36, y: -14 };

    const result = importXMind(fixtureWithContent(content), {
      idFactory: deterministicIdFactory(),
    });

    expect(result.report.success, JSON.stringify(result.report.diagnostics)).toBe(true);
    expect(result.report.diagnostics.map((diagnostic) => diagnostic.code))
      .toContain('xmind.summary-position-as-offset');
    const sheet = Object.values(result.document!.sheets).find(
      (candidate) => candidate.title === 'Product 产品',
    )!;
    const summaryResult = topicBySource(sheet, 'topic-summary-result');
    expect(summaryResult.role).toBe('summary-result');
    expect(summaryResult.placement).toEqual({ mode: 'offset', dx: 36, dy: -14 });
    expect(validateMindMapDocument(result.document!).valid).toBe(true);
  });

  it('keeps unsafe links inert while retaining their raw source value', () => {
    const content = JSON.parse(JSON.stringify(XMIND_CONTENT_JSON_FIXTURE)) as Array<Record<string, unknown>>;
    const first = content[0];
    const root = first.rootTopic as Record<string, unknown>;
    const children = root.children as { attached: Array<Record<string, unknown>> };
    children.attached[0].href = 'javascript:alert(1)';
    const result = importXMind(fixtureWithContent(content), {
      idFactory: deterministicIdFactory(),
    });
    expect(result.report.success).toBe(true);
    expect(result.report.diagnostics.map((item) => item.code)).toContain(
      'xmind.href-preserved-only',
    );
    expect(Object.values(Object.values(result.document!.sheets)[0].links)).toHaveLength(0);
  });

  it('flattens foreign rich-title shapes to plain text and preserves their source JSON', () => {
    const richTitle = {
      spans: [
        { style: { bold: true }, text: 'Rich ' },
        { style: { color: '#f00' }, text: '标题' },
      ],
    };
    const result = importXMind(fixtureWithContent([{
      id: 'rich-sheet',
      rootTopic: { id: 'rich-root', title: richTitle },
      title: 'Rich sheet',
    }]), { idFactory: deterministicIdFactory() });
    expect(result.report.success, JSON.stringify(result.report.diagnostics)).toBe(true);
    expect(result.report.diagnostics.map((item) => item.code)).toContain(
      'xmind.rich-title-plain-fallback',
    );
    const sheet = Object.values(result.document!.sheets)[0];
    const root = sheet.topics[sheet.rootTopicId];
    expect(mindMapRichTextToPlainText(root.title)).toBe('Rich 标题');
    expect(root.extensions?.[XMIND_RAW_TITLE_EXTENSION_KEY]).toEqual(richTitle);
  });
});

describe('XMind deterministic export and round trip', () => {
  it('packages caller-supplied verified image bytes with deterministic native references', () => {
    const source = createMindMapElementsFixture();
    const sheet = Object.values(source.sheets)[0];
    const image = Object.values(sheet.images)[0];
    const asset = source.assets[image.assetId];
    asset.byteSize = PNG_BYTES.byteLength;
    asset.fileName = 'managed-secret-name.png';
    asset.intrinsicSize = { height: 3, width: 2 };
    asset.mimeType = 'image/png';
    asset.sha256 = 'db42d7b740a36256f694172427189b90e7d94a9abebab81435bf4bb3d7b9bf9d';
    asset.source = { kind: 'managed', objectKey: 'tenant/private/top-secret-object-key' };
    image.alt = 'Launch visual';
    image.placement = { align: 'end', offset: { x: 4, y: -2 }, side: 'bottom' };
    image.size = { height: 30, width: 20 };
    expect(validateMindMapDocument(source).valid).toBe(true);

    const options = { resourceBytes: { [asset.id]: PNG_BYTES } };
    const first = exportXMind(source, options);
    const second = exportXMind(source, options);
    expect(first.report.success, JSON.stringify(first.report.diagnostics)).toBe(true);
    expect(first.bytes).toEqual(second.bytes);
    const files = unzipSync(first.bytes!);
    const resourcePath = `resources/${asset.sha256}.png`;
    expect(files[resourcePath]).toEqual(PNG_BYTES);
    const content = JSON.parse(new TextDecoder().decode(files['content.json'])) as Array<{
      rootTopic: Record<string, unknown>;
    }>;
    const rawTopic = rawTopicById(content[0].rootTopic, image.topicId)!;
    expect(rawTopic.image).toEqual({
      align: 'end',
      alt: 'Launch visual',
      height: 30,
      offset: { x: 4, y: -2 },
      placement: 'bottom',
      src: `xap:${resourcePath}`,
      width: 20,
    });
    const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json'])) as {
      'file-entries': Record<string, unknown>;
    };
    expect(manifest['file-entries']).toHaveProperty(resourcePath);
    const metadata = JSON.parse(new TextDecoder().decode(files['metadata.json'])) as {
      nmdd: { canonicalFallback: Record<string, unknown> };
    };
    expect(metadata.nmdd.canonicalFallback).not.toHaveProperty('resourceBytes');
    expect(JSON.stringify(metadata.nmdd.canonicalFallback)).not.toContain(
      Array.from(PNG_BYTES).join(','),
    );
    expect(new TextDecoder().decode(files['metadata.json']))
      .not.toContain('tenant/private/top-secret-object-key');
    expect(new TextDecoder().decode(files['content.json']))
      .not.toContain('tenant/private/top-secret-object-key');
    expect(new TextDecoder().decode(files['manifest.json']))
      .not.toContain('tenant/private/top-secret-object-key');

    const imported = importXMind(first.bytes!, { idFactory: deterministicIdFactory(50_000) });
    expect(imported.report.success, JSON.stringify(imported.report.diagnostics)).toBe(true);
    expect(imported.report.diagnostics.map(({ code }) => code)).toContain(
      'xmind.canonical-fallback-restored',
    );
    expect(imported.document!.assets[asset.id].source).toEqual({
      kind: 'embedded',
      relativePath: resourcePath,
    });
    expect(imported.resourceBytes?.[resourcePath]).toEqual(PNG_BYTES);
    expect(validateMindMapDocument(imported.document).valid).toBe(true);
  });

  it('packages managed Sticker bytes for a lossless, credential-free canonical round trip', () => {
    const source = createMindMapElementsFixture();
    const sheet = Object.values(source.sheets)[0];
    const sticker = Object.values(sheet.images)[0];
    const asset = source.assets[sticker.assetId];
    const objectKey = 'tenant/private/stickers/original-lightbulb.png';
    asset.byteSize = PNG_BYTES.byteLength;
    asset.fileName = 'original-lightbulb.png';
    asset.intrinsicSize = { height: 3, width: 2 };
    asset.mimeType = 'image/png';
    asset.sha256 = 'db42d7b740a36256f694172427189b90e7d94a9abebab81435bf4bb3d7b9bf9d';
    asset.source = { kind: 'managed', objectKey };
    sticker.role = 'sticker';
    sticker.alt = 'Original lightbulb';
    sticker.placement = { align: 'center', offset: { x: 7, y: -5 }, side: 'right' };
    sticker.size = { height: 84, width: 84 };
    expect(validateMindMapDocument(source).valid).toBe(true);

    const exported = exportXMind(source, {
      resourceBytes: { [asset.id]: PNG_BYTES },
    });
    expect(exported.report.success, JSON.stringify(exported.report.diagnostics)).toBe(true);
    expect(exported.report.diagnostics.map(({ code }) => code)).toContain(
      'xmind.sticker-preserved-in-fallback',
    );
    const files = unzipSync(exported.bytes!);
    const resourcePath = `resources/${asset.sha256}.png`;
    expect(files[resourcePath]).toEqual(PNG_BYTES);
    const content = JSON.parse(new TextDecoder().decode(files['content.json'])) as Array<{
      rootTopic: Record<string, unknown>;
    }>;
    expect(rawTopicById(content[0].rootTopic, sticker.topicId)).not.toHaveProperty('image');
    const metadata = JSON.parse(new TextDecoder().decode(files['metadata.json'])) as {
      nmdd: {
        canonicalFallback: {
          assets: Record<string, { source: unknown }>;
        };
        canonicalFallbackRestorable: boolean;
        nativeImageResources: Record<string, string>;
      };
    };
    expect(metadata.nmdd.canonicalFallbackRestorable).toBe(true);
    expect(metadata.nmdd.canonicalFallback.assets[asset.id].source).toEqual({
      kind: 'embedded',
      relativePath: resourcePath,
    });
    expect(metadata.nmdd.nativeImageResources).not.toHaveProperty(sticker.id);
    for (const name of ['content.json', 'manifest.json', 'metadata.json']) {
      expect(new TextDecoder().decode(files[name])).not.toContain(objectKey);
    }

    const imported = importXMind(exported.bytes!, {
      idFactory: deterministicIdFactory(55_000),
    });
    expect(imported.report.success, JSON.stringify(imported.report.diagnostics)).toBe(true);
    expect(imported.report.diagnostics.map(({ code }) => code)).toContain(
      'xmind.canonical-fallback-restored',
    );
    expect(imported.document!.sheets[sheet.id].images[sticker.id]).toEqual(sticker);
    expect(imported.document!.assets[asset.id]).toEqual({
      ...asset,
      source: { kind: 'embedded', relativePath: resourcePath },
    });
    expect(imported.resourceBytes?.[resourcePath]).toEqual(PNG_BYTES);

    const reexported = exportXMind(imported.document!, {
      resourceBytes: imported.resourceBytes,
    });
    const reimported = importXMind(reexported.bytes!, {
      idFactory: deterministicIdFactory(56_000),
    });
    expect(reimported.report.success, JSON.stringify(reimported.report.diagnostics)).toBe(true);
    expect(reimported.document!.sheets[sheet.id].images[sticker.id]).toEqual(sticker);
    expect(reimported.resourceBytes?.[resourcePath]).toEqual(PNG_BYTES);
  });

  it('does not fabricate native images for missing or mismatched bytes and redacts signed URLs', () => {
    const source = createMindMapElementsFixture();
    const sheet = Object.values(source.sheets)[0];
    const image = Object.values(sheet.images)[0];
    const asset = source.assets[image.assetId];
    asset.source = {
      kind: 'remote',
      url: 'https://private.example/image.png?token=raw-secret-value&width=300',
    };
    expect(validateMindMapDocument(source).valid).toBe(true);

    const unavailable = exportXMind(source);
    expect(unavailable.report.diagnostics.map(({ code }) => code)).toEqual(expect.arrayContaining([
      'xmind.remote-image-credential-not-exported',
      'xmind.image-resource-bytes-unavailable',
      'xmind.sensitive-resource-source-redacted',
    ]));
    const unavailableFiles = unzipSync(unavailable.bytes!);
    for (const name of ['content.json', 'manifest.json', 'metadata.json']) {
      expect(new TextDecoder().decode(unavailableFiles[name])).not.toContain('raw-secret-value');
    }
    const unavailableContent = JSON.parse(
      new TextDecoder().decode(unavailableFiles['content.json']),
    ) as Array<{ rootTopic: Record<string, unknown> }>;
    expect(rawTopicById(unavailableContent[0].rootTopic, image.topicId)).not.toHaveProperty('image');
    const imported = importXMind(unavailable.bytes!, {
      idFactory: deterministicIdFactory(60_000),
    });
    expect(imported.report.diagnostics.map(({ code }) => code)).toContain(
      'xmind.canonical-fallback-sensitive-source-redacted',
    );
    expect(Object.keys(imported.document!.assets)).toHaveLength(0);

    const mismatched = exportXMind(source, {
      resourceBytes: { [asset.id]: PNG_BYTES },
    });
    expect(mismatched.report.diagnostics.map(({ code }) => code)).toContain(
      'xmind.image-resource-integrity-mismatch',
    );
    const mismatchedFiles = unzipSync(mismatched.bytes!);
    expect(Object.keys(mismatchedFiles).filter((name) => name.startsWith('resources/')))
      .toHaveLength(0);
  });

  it.each(['apikey', 'api_key', 'authorization'])(
    'redacts %s remote credentials from the XMind fallback envelope',
    (parameter) => {
      const source = createMindMapElementsFixture();
      const sheet = Object.values(source.sheets)[0];
      const image = Object.values(sheet.images)[0];
      const asset = source.assets[image.assetId];
      asset.source = {
        kind: 'remote',
        url: `https://private.example/image.png?${parameter}=do-not-export-this`,
      };

      const exported = exportXMind(source);
      expect(exported.report.diagnostics.map(({ code }) => code)).toContain(
        'xmind.sensitive-resource-source-redacted',
      );
      const files = unzipSync(exported.bytes!);
      for (const name of ['content.json', 'manifest.json', 'metadata.json']) {
        expect(new TextDecoder().decode(files[name])).not.toContain('do-not-export-this');
      }
      const imported = importXMind(exported.bytes!, {
        idFactory: deterministicIdFactory(70_000),
      });
      expect(imported.report.diagnostics.map(({ code }) => code)).toContain(
        'xmind.canonical-fallback-sensitive-source-redacted',
      );
    },
  );

  it('writes native range indices against the emitted attached array and rejects lossy scopes', () => {
    const document = createMindMapElementsFixture();
    const sheet = Object.values(document.sheets)[0];
    const leftTopicId = createEntityId<'Topic'>();
    const leftEdgeId = createEntityId<'TreeEdge'>();
    sheet.topics[leftTopicId] = createTopic({ id: leftTopicId, title: 'Left' });
    sheet.treeEdges[leftEdgeId] = {
      id: leftEdgeId,
      parentTopicId: sheet.rootTopicId,
      childTopicId: leftTopicId,
      orderKey: '0',
      side: 'left',
    };
    const boundary = Object.values(sheet.boundaries)[0];
    const exported = exportXMind(document);
    const content = decodeJsonFile(exported.bytes!, 'content.json') as Array<Record<string, unknown>>;
    const root = content[0].rootTopic as Record<string, unknown>;
    expect(root.boundaries).toEqual([
      expect.objectContaining({ range: '(1,2)' }),
    ]);

    if (boundary.scope.kind !== 'sibling-range') throw new Error('Fixture scope changed.');
    boundary.scope = { ...boundary.scope, includeDescendants: false };
    const lossy = exportXMind(document);
    expect(lossy.report.diagnostics.map((diagnostic) => diagnostic.code))
      .toContain('xmind.boundary-scope-preserved-only');
    const lossyRoot = (decodeJsonFile(lossy.bytes!, 'content.json') as Array<Record<string, unknown>>)[0]
      .rootTopic as Record<string, unknown>;
    expect(lossyRoot.boundaries).toBeUndefined();

    boundary.scope = { ...boundary.scope, includeDescendants: true };
    sheet.treeEdges[leftEdgeId].orderKey = 'aa';
    const mixedInterior = exportXMind(document);
    expect(mixedInterior.report.diagnostics.map((diagnostic) => diagnostic.code))
      .toContain('xmind.boundary-scope-preserved-only');
  });

  it('emits deterministic native content and round-trips tree order plus semantics', () => {
    const imported = importXMind(createHandcraftedXMindFixtureZip(), {
      idFactory: deterministicIdFactory(),
    });
    const first = exportXMind(imported.document!);
    const second = exportXMind(imported.document!);

    expect(first.report.success).toBe(true);
    expect(first.report.exportedSheets).toBe(2);
    expect(first.report.exportedTopics).toBe(9);
    expect(first.bytes).not.toBeNull();
    expect([...first.bytes!]).toEqual([...second.bytes!]);

    const content = decodeJsonFile(first.bytes!, 'content.json') as Array<Record<string, unknown>>;
    expect(content).toHaveLength(2);
    expect(content[0].title).toBe('Product 产品');
    expect((content[0].vendorSheetFlag as Record<string, unknown>).retained).toBe(true);
    const root = content[0].rootTopic as Record<string, unknown>;
    expect(root.structureClass).toBe('org.xmind.ui.map.clockwise');
    expect(root.boundaries).toBeUndefined();
    expect(root.summaries).toBeUndefined();
    expect(first.report.diagnostics.map((diagnostic) => diagnostic.code))
      .toEqual(expect.arrayContaining([
        'xmind.boundary-scope-preserved-only',
        'xmind.summary-scope-preserved-only',
      ]));
    expect(content[0].relationships).toEqual([
      expect.objectContaining({ title: 'enables' }),
    ]);

    const roundTrip = importXMind(first.bytes!, {
      idFactory: deterministicIdFactory(1_000),
    });
    expect(roundTrip.report.success).toBe(true);
    expect(roundTrip.report.importedSheets).toBe(2);
    const product = Object.values(roundTrip.document!.sheets).find(
      (sheet) => sheet.title === 'Product 产品',
    )!;
    const titles = Object.values(product.topics).map((topic) =>
      mindMapRichTextToPlainText(topic.title));
    expect(titles).toEqual(expect.arrayContaining([
      '产品路线图 🚀',
      'Research 🔎',
      '访谈 10 位用户',
      'Launch',
      'Parking lot',
      'Ready to ship',
    ]));
    expect(Object.values(product.boundaries)).toHaveLength(1);
    expect(Object.values(product.summaries)).toHaveLength(1);
    expect(Object.values(product.relationships)).toHaveLength(1);
    expect(Object.values(product.notes)).toHaveLength(1);
    expect(Object.values(product.links)).toHaveLength(1);
  });

  it('uses a plain native title while round-tripping canonical rich-text marks', () => {
    const imported = importXMind(createHandcraftedXMindFixtureZip(), {
      idFactory: deterministicIdFactory(),
    });
    const product = Object.values(imported.document!.sheets).find(
      (sheet) => sheet.title === 'Product 产品',
    )!;
    const research = topicBySource(product, 'topic-research');
    research.title = {
      blocks: [{
        children: [
          { marks: [{ type: 'bold' }], text: 'Bold', type: 'text' },
          { type: 'hardBreak' },
          { marks: [{ type: 'color', value: '#ff0000' }], text: '彩色', type: 'text' },
        ],
        type: 'paragraph',
      }],
      type: 'doc',
      version: 1,
    };

    const exported = exportXMind(imported.document!);
    expect(exported.report.diagnostics.map((item) => item.code)).toContain(
      'xmind.rich-text-preserved-in-extension',
    );
    const content = decodeJsonFile(exported.bytes!, 'content.json') as Array<Record<string, unknown>>;
    const root = content[0].rootTopic as { children: { attached: Array<Record<string, unknown>> } };
    expect(root.children.attached[0].title).toBe('Bold\n彩色');

    const roundTrip = importXMind(exported.bytes!, {
      idFactory: deterministicIdFactory(2_000),
    });
    expect(roundTrip.report.success, JSON.stringify(roundTrip.report.diagnostics)).toBe(true);
    const roundTripProduct = Object.values(roundTrip.document!.sheets).find(
      (sheet) => sheet.title === 'Product 产品',
    )!;
    const restored = Object.values(roundTripProduct.topics).find(
      (topic) => mindMapRichTextToPlainText(topic.title) === 'Bold\n彩色',
    )!;
    expect(restored.title).toEqual(research.title);
  });

  it('stores unsupported source fields and canonical fallbacks structurally instead of dropping them', () => {
    const imported = importXMind(createHandcraftedXMindFixtureZip(), {
      idFactory: deterministicIdFactory(),
    });
    const product = Object.values(imported.document!.sheets)[0];
    expect(product.extensions?.[XMIND_RAW_SHEET_EXTENSION_KEY]).toEqual(
      expect.objectContaining({ vendorSheetFlag: { retained: true } }),
    );
    const exported = exportXMind(imported.document!);
    const metadata = decodeJsonFile(exported.bytes!, 'metadata.json') as Record<string, unknown>;
    expect(metadata).toEqual(expect.objectContaining({
      nmdd: expect.objectContaining({
        canonicalFallback: expect.any(Object),
        documentTitle: '2026 Product Workbook',
      }),
    }));
  });

  it('exports every standard marker group with stable native IDs instead of localized names', () => {
    const source = createMindMapElementsFixture();
    const sheet = Object.values(source.sheets)[0];
    source.markerGroups = {};
    source.markerDefinitions = {};
    sheet.markerInstances = {};
    sheet.markerLegend.itemOrder = [];

    const standardMarkers = [
      { groupId: 'priority', markerId: 'priority-1', name: '优先级' },
      { groupId: 'progress', markerId: 'progress-25', name: '进度' },
      { groupId: 'flag', markerId: 'flag-red', name: '旗帜' },
      { groupId: 'star', markerId: 'star-filled', name: '星标' },
      { groupId: 'arrow', markerId: 'arrow-up', name: '箭头' },
    ] as const;
    standardMarkers.forEach((marker, index) => {
      const groupId = createEntityId<'MarkerGroup'>();
      const definitionId = createEntityId<'MarkerDefinition'>();
      const instanceId = createEntityId<'MarkerInstance'>();
      source.markerGroups[groupId] = {
        exclusive: true,
        extensions: { 'app.nmdd.marker-library-key': marker.groupId },
        id: groupId,
        kind: 'builtin',
        name: marker.name,
        orderKey: String.fromCharCode(97 + index),
      };
      source.markerDefinitions[definitionId] = {
        groupId,
        id: definitionId,
        name: marker.markerId,
        orderKey: 'a',
        source: { key: marker.markerId, kind: 'builtin' },
      };
      sheet.markerInstances[instanceId] = {
        id: instanceId,
        markerDefinitionId: definitionId,
        orderKey: String.fromCharCode(97 + index),
        topicId: sheet.rootTopicId,
      };
    });
    expect(validateMindMapDocument(source).valid).toBe(true);

    const exported = exportXMind(source);
    expect(exported.report.success, JSON.stringify(exported.report.diagnostics)).toBe(true);
    const content = decodeJsonFile(exported.bytes!, 'content.json') as Array<Record<string, unknown>>;
    const root = content[0].rootTopic as Record<string, unknown>;
    expect(root.markers).toEqual(standardMarkers.map(({ groupId, markerId }) => ({
      groupId,
      markerId,
    })));
  });

  it('preserves imported XMind marker source IDs when exporting again', () => {
    const sourceMarker = {
      groupId: 'vendor.priority/source-v2',
      markerId: 'vendor.priority/source-v2/value-01',
    };
    const imported = importXMind(fixtureWithContent([{
      id: 'marker-source-sheet',
      rootTopic: {
        id: 'marker-source-root',
        markers: [sourceMarker],
        title: 'Marker source',
      },
      title: 'Marker source',
    }]), { idFactory: deterministicIdFactory(5_000) });
    expect(imported.report.success, JSON.stringify(imported.report.diagnostics)).toBe(true);
    const group = Object.values(imported.document!.markerGroups)[0];
    const definition = Object.values(imported.document!.markerDefinitions)[0];
    expect(group.extensions?.[XMIND_SOURCE_ID_EXTENSION_KEY]).toBe(sourceMarker.groupId);
    expect(definition.extensions?.[XMIND_SOURCE_ID_EXTENSION_KEY]).toBe(sourceMarker.markerId);
    // The source-id extension is the foreign round-trip authority even if an
    // application migration later normalizes its own built-in vocabulary.
    definition.source = { kind: 'builtin', key: 'normalized-priority-1' };

    const exported = exportXMind(imported.document!);
    expect(exported.report.success, JSON.stringify(exported.report.diagnostics)).toBe(true);
    const content = decodeJsonFile(exported.bytes!, 'content.json') as Array<Record<string, unknown>>;
    const root = content[0].rootTopic as Record<string, unknown>;
    expect(root.markers).toEqual([sourceMarker]);
  });

  it('keeps custom and asset markers out of native content while restoring their exact canonical IDs', () => {
    const source = createMindMapElementsFixture();
    const sheet = Object.values(source.sheets)[0];
    source.markerGroups = {};
    source.markerDefinitions = {};
    sheet.markerInstances = {};
    sheet.markerLegend.itemOrder = [];

    const customGroupId = createEntityId<'MarkerGroup'>();
    const assetGroupId = createEntityId<'MarkerGroup'>();
    const customDefinitionId = createEntityId<'MarkerDefinition'>();
    const assetDefinitionId = createEntityId<'MarkerDefinition'>();
    const customInstanceId = createEntityId<'MarkerInstance'>();
    const assetInstanceId = createEntityId<'MarkerInstance'>();
    const assetId = Object.keys(source.assets)[0] as keyof typeof source.assets;
    source.markerGroups[customGroupId] = {
      exclusive: false,
      extensions: { [XMIND_SOURCE_ID_EXTENSION_KEY]: 'priority' },
      id: customGroupId,
      kind: 'custom',
      name: 'Custom native-looking group',
      orderKey: 'a',
    };
    source.markerGroups[assetGroupId] = {
      exclusive: false,
      extensions: { [XMIND_SOURCE_ID_EXTENSION_KEY]: 'flag' },
      id: assetGroupId,
      kind: 'custom',
      name: 'Asset native-looking group',
      orderKey: 'b',
    };
    source.markerDefinitions[customDefinitionId] = {
      groupId: customGroupId,
      id: customDefinitionId,
      name: 'Custom diamond',
      orderKey: 'a',
      source: { key: 'custom-diamond', kind: 'builtin' },
    };
    source.markerDefinitions[assetDefinitionId] = {
      groupId: assetGroupId,
      id: assetDefinitionId,
      name: 'Asset icon',
      orderKey: 'a',
      source: { assetId, kind: 'asset' },
    };
    sheet.markerInstances[customInstanceId] = {
      id: customInstanceId,
      markerDefinitionId: customDefinitionId,
      orderKey: 'a',
      topicId: sheet.rootTopicId,
    };
    sheet.markerInstances[assetInstanceId] = {
      id: assetInstanceId,
      markerDefinitionId: assetDefinitionId,
      orderKey: 'b',
      topicId: sheet.rootTopicId,
    };
    sheet.markerLegend.itemOrder = [customDefinitionId, assetDefinitionId];
    expect(validateMindMapDocument(source).valid).toBe(true);

    const exported = exportXMind(source);
    expect(exported.report.success, JSON.stringify(exported.report.diagnostics)).toBe(true);
    expect(exported.report.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'xmind.custom-marker-preserved-only',
        disposition: 'preserved',
        path: expect.stringContaining(customInstanceId),
      }),
      expect.objectContaining({
        code: 'xmind.asset-marker-preserved-only',
        disposition: 'preserved',
        path: expect.stringContaining(assetInstanceId),
      }),
    ]));
    const content = decodeJsonFile(exported.bytes!, 'content.json') as Array<Record<string, unknown>>;
    const root = content[0].rootTopic as Record<string, unknown>;
    expect(root).not.toHaveProperty('markers');
    const metadata = decodeJsonFile(exported.bytes!, 'metadata.json') as {
      nmdd: { canonicalFallback: typeof source };
    };
    expect(metadata.nmdd.canonicalFallback.markerDefinitions[customDefinitionId])
      .toEqual(source.markerDefinitions[customDefinitionId]);
    expect(metadata.nmdd.canonicalFallback.markerDefinitions[assetDefinitionId])
      .toEqual(source.markerDefinitions[assetDefinitionId]);

    const restored = importXMind(exported.bytes!, {
      idFactory: deterministicIdFactory(6_000),
    });
    expect(restored.report.success, JSON.stringify(restored.report.diagnostics)).toBe(true);
    expect(restored.report.diagnostics.map(({ code }) => code)).toContain(
      'xmind.canonical-fallback-restored',
    );
    expect(restored.document).toEqual(source);
  });
});

describe('XMind trusted canonical fallback', () => {
  it('rejects an unsafe packaged-image metadata path without extracting or restoring it', () => {
    const source = createMindMapElementsFixture();
    const sheet = Object.values(source.sheets)[0];
    const sticker = Object.values(sheet.images)[0];
    const asset = source.assets[sticker.assetId];
    asset.byteSize = PNG_BYTES.byteLength;
    asset.intrinsicSize = { height: 3, width: 2 };
    asset.mimeType = 'image/png';
    asset.sha256 = 'db42d7b740a36256f694172427189b90e7d94a9abebab81435bf4bb3d7b9bf9d';
    asset.source = { kind: 'managed', objectKey: 'tenant/private/sticker.png' };
    sticker.role = 'sticker';
    sticker.placement = { align: 'center', offset: { x: 0, y: 0 }, side: 'left' };
    const exported = exportXMind(source, { resourceBytes: { [asset.id]: PNG_BYTES } });
    const files = unzipSync(exported.bytes!);
    const metadata = JSON.parse(new TextDecoder().decode(files['metadata.json'])) as {
      nmdd: { packagedImageAssets: Record<string, string> };
    };
    metadata.nmdd.packagedImageAssets[asset.id] = '../content.json';
    files['metadata.json'] = Uint8Array.from(
      new TextEncoder().encode(JSON.stringify(metadata)),
    );

    const imported = importXMind(repackXMindFiles(files), {
      idFactory: deterministicIdFactory(9_000),
    });
    expect(imported.report.success).toBe(true);
    expect(imported.report.diagnostics.map(({ code }) => code)).toContain(
      'xmind.canonical-fallback-packaged-image-envelope-invalid',
    );
    expect(imported.report.diagnostics.map(({ code }) => code)).not.toContain(
      'xmind.canonical-fallback-restored',
    );
    expect(Object.keys(imported.document!.assets)).toHaveLength(0);
    expect(imported.resourceBytes).toBeUndefined();
  });

  it('restores callouts, zones, non-topic relationships, and resource metadata exactly', () => {
    const source = createMindMapElementsFixture();
    const exported = exportXMind(source);
    expect(exported.report.success).toBe(true);
    expect(exported.report.diagnostics.map((item) => item.code)).toContain(
      'xmind.resource-bytes-unavailable',
    );

    const imported = importXMind(exported.bytes!, {
      idFactory: deterministicIdFactory(10_000),
    });
    expect(imported.report.success, JSON.stringify(imported.report.diagnostics)).toBe(true);
    expect(imported.report.diagnostics.map((item) => item.code)).toContain(
      'xmind.canonical-fallback-restored',
    );
    expect(validateMindMapDocument(imported.document).valid).toBe(true);
    expect(imported.document).toEqual(source);

    const sourceSheet = Object.values(source.sheets)[0];
    const restoredSheet = Object.values(imported.document!.sheets)[0];
    expect(restoredSheet.callouts).toEqual(sourceSheet.callouts);
    expect(restoredSheet.zones).toEqual(sourceSheet.zones);
    expect(Object.values(restoredSheet.relationships).filter((relationship) =>
      relationship.source.element.kind !== 'topic'
      || relationship.target.element.kind !== 'topic')).toEqual(
      Object.values(sourceSheet.relationships).filter((relationship) =>
        relationship.source.element.kind !== 'topic'
        || relationship.target.element.kind !== 'topic'),
    );
    expect(imported.document!.assets).toEqual(source.assets);
    expect(restoredSheet.attachments).toEqual(sourceSheet.attachments);
    expect(restoredSheet.images).toEqual(sourceSheet.images);
  });

  it('rejects a valid-shape but integrity-tampered fallback and keeps it only as metadata', () => {
    const source = createMindMapElementsFixture();
    const exported = exportXMind(source);
    const files = unzipSync(exported.bytes!);
    const metadata = JSON.parse(new TextDecoder().decode(files['metadata.json'])) as Record<string, unknown>;
    const nmdd = metadata.nmdd as Record<string, unknown>;
    const fallback = nmdd.canonicalFallback as Record<string, unknown>;
    const sheets = fallback.sheets as Record<string, Record<string, unknown>>;
    const sheet = Object.values(sheets)[0];
    const callouts = sheet.callouts as Record<string, Record<string, unknown>>;
    Object.values(callouts)[0].tail = 'line';
    files['metadata.json'] = Uint8Array.from(
      new TextEncoder().encode(JSON.stringify(metadata)),
    );

    const imported = importXMind(repackXMindFiles(files), {
      idFactory: deterministicIdFactory(20_000),
    });
    expect(imported.report.success).toBe(true);
    expect(imported.report.diagnostics.map((item) => item.code)).toContain(
      'xmind.canonical-fallback-integrity-mismatch',
    );
    const importedSheet = Object.values(imported.document!.sheets)[0];
    expect(Object.keys(importedSheet.callouts)).toHaveLength(0);
    expect(imported.document!.extensions?.[XMIND_METADATA_EXTENSION_KEY]).toEqual(metadata);
  });

  it('does not let a stale fallback overwrite changed content.json', () => {
    const source = createMindMapElementsFixture();
    const exported = exportXMind(source);
    const files = unzipSync(exported.bytes!);
    const content = JSON.parse(new TextDecoder().decode(files['content.json'])) as Array<Record<string, unknown>>;
    const root = content[0].rootTopic as Record<string, unknown>;
    root.title = 'Edited in XMind';
    files['content.json'] = Uint8Array.from(new TextEncoder().encode(JSON.stringify(content)));

    const imported = importXMind(repackXMindFiles(files), {
      idFactory: deterministicIdFactory(30_000),
    });
    expect(imported.report.success).toBe(true);
    expect(imported.report.diagnostics.map((item) => item.code)).toContain(
      'xmind.canonical-fallback-content-changed',
    );
    const sheet = Object.values(imported.document!.sheets)[0];
    expect(mindMapRichTextToPlainText(sheet.topics[sheet.rootTopicId].title)).toBe(
      'Edited in XMind',
    );
    expect(Object.keys(sheet.callouts)).toHaveLength(0);
  });

  it('leaves ordinary external XMind metadata on the normal import path', () => {
    const imported = importXMind(createHandcraftedXMindFixtureZip(), {
      idFactory: deterministicIdFactory(40_000),
    });
    expect(imported.report.success).toBe(true);
    expect(imported.report.diagnostics.some((item) =>
      item.code.startsWith('xmind.canonical-fallback'))).toBe(false);
    expect(validateMindMapDocument(imported.document).valid).toBe(true);
  });
});

describe('XMind ZIP security', () => {
  it.each([
    '../content.json',
    '/absolute/content.json',
    'C:/absolute/content.json',
    'resources\\backslash.png',
  ])('rejects unsafe ZIP path %s before extraction', (unsafePath) => {
    const encoder = new TextEncoder();
    const archive = zipSync({
      [unsafePath]: Uint8Array.from(encoder.encode(JSON.stringify(XMIND_CONTENT_JSON_FIXTURE))),
    });
    const result = importXMind(archive, { idFactory: deterministicIdFactory() });
    expect(result.document).toBeNull();
    expect(result.report.diagnostics[0].code).toBe('xmind.zip-unsafe-path');
  });

  it('rejects archive size and suspicious compression ratios', () => {
    const archive = createHandcraftedXMindFixtureZip();
    const sizeLimited = importXMind(archive, {
      idFactory: deterministicIdFactory(),
      limits: { maxInputBytes: 16 },
    });
    expect(sizeLimited.report.diagnostics[0].code).toBe('xmind.archive-limit');

    const repeated = [{
      id: 'sheet',
      rootTopic: {
        id: 'root',
        title: 'A'.repeat(20_000),
      },
      title: 'Sheet',
    }];
    const ratioLimited = importXMind(fixtureWithContent(repeated), {
      idFactory: deterministicIdFactory(),
      limits: { maxInputBytes: 64 * 1024 },
      zipLimits: { maxCompressionRatio: 2 },
    });
    expect(ratioLimited.report.diagnostics[0].code).toBe(
      'xmind.zip-compression-ratio-limit',
    );
  });

  it('checks CRC integrity after bounded extraction', () => {
    const encoder = new TextEncoder();
    const content = Uint8Array.from(encoder.encode(JSON.stringify(XMIND_CONTENT_JSON_FIXTURE)));
    const archive = zipSync({ 'content.json': [content, { level: 0 }] }, { level: 0 });
    const damaged = new Uint8Array(archive);
    const needle = encoder.encode('Product');
    let offset = -1;
    for (let index = 0; index <= damaged.length - needle.length; index += 1) {
      if (needle.every((byte, needleIndex) => damaged[index + needleIndex] === byte)) {
        offset = index;
        break;
      }
    }
    expect(offset).toBeGreaterThan(0);
    damaged[offset] ^= 0x01;
    const result = importXMind(damaged, { idFactory: deterministicIdFactory() });
    expect(result.document).toBeNull();
    expect(result.report.diagnostics[0].code).toBe('xmind.zip-integrity-failed');
  });
});
