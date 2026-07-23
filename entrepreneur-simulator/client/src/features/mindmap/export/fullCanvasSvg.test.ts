import { DOMSerializer, type DOMOutputSpec } from '@tiptap/pm/model';
import { describe, expect, it, vi } from 'vitest';

import {
  createEquation,
  createMindMapSheet,
  createTopic,
} from '../domain/defaults';
import type {
  AssetId,
  EquationId,
  ImageId,
  LinkId,
  MarkerDefinitionId,
  MarkerGroupId,
  MarkerInstanceId,
  SheetId,
  TopicId,
  TreeEdgeId,
} from '../domain/types';
import { projectMindMapToRenderModel } from '../render/model';
import {
  createMindMapElementsFixture,
  createMindMapV1SmallFixture,
} from '../testing/fixtures';
import { buildMindMapFlowProjection } from '../ui/projection';
import {
  assertFullMindMapSvgSerializedByteLength,
  createFullMindMapSvgExport,
  type CreateFullMindMapSvgExportOptions,
  FullMindMapSvgExportError,
} from './fullCanvasSvg';
import { splitMindMapSvgGraphemes } from './richTextSvgLayout';
import {
  MIND_MAP_STATIC_FONT_POLICY,
  MIND_MAP_STATIC_SANS_STACK,
  resolveMindMapStaticFontFamily,
  type MindMapStaticFontBundle,
} from './staticFontBundle';

const PNG_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
]);

const renderSpec = (spec: DOMOutputSpec): SVGSVGElement => (
  DOMSerializer.renderSpec(document, spec).dom as unknown as SVGSVGElement
);

const topicId = (ordinal: number): TopicId => (
  `02900000-0000-7000-8000-${String(ordinal).padStart(12, '0')}` as TopicId
);

const edgeId = (ordinal: number): TreeEdgeId => (
  `02910000-0000-7000-8000-${String(ordinal).padStart(12, '0')}` as TreeEdgeId
);

const sheetId = (ordinal: number): SheetId => (
  `02920000-0000-7000-8000-${String(ordinal).padStart(12, '0')}` as SheetId
);

const assetId = (ordinal: number): AssetId => (
  `02930000-0000-7000-8000-${String(ordinal).padStart(12, '0')}` as AssetId
);

const imageId = (ordinal: number): ImageId => (
  `02940000-0000-7000-8000-${String(ordinal).padStart(12, '0')}` as ImageId
);

const exportOptions = (): CreateFullMindMapSvgExportOptions => ({
  signal: new AbortController().signal,
  readManagedResource: vi.fn(async () => new Uint8Array()),
  loadStaticFontBundle: vi.fn(async (): Promise<MindMapStaticFontBundle> => ({
    cssText: '@font-face{font-family:"NMDD Noto Sans SC Export";src:url(data:font/woff2;base64,AA==)}',
    embeddedFontBytes: 1,
    embeddedSerializedBytes: 96,
    faceCount: 1,
    fontFamily: MIND_MAP_STATIC_SANS_STACK,
    fontPolicy: MIND_MAP_STATIC_FONT_POLICY,
    measureText: (value: string, style: { readonly fontSize: number }) => (
      splitMindMapSvgGraphemes(value).reduce((total, character) => (
        total + style.fontSize * (/\s/u.test(character)
          ? 0.5
          : /[^\u0000-\u00ff]/u.test(character) ? 1 : 0.56)
      ), 0)
    ),
    release: vi.fn(),
    resolveFontFamily: resolveMindMapStaticFontFamily,
    sourceVersion: '5.3.0' as const,
  })),
});

describe('full canonical mind-map SVG export', () => {
  it('checks the serializer\'s actual UTF-8 byte length after preflight', () => {
    expect(assertFullMindMapSvgSerializedByteLength('\u56fe', 3)).toBe(3);
    expect(() => assertFullMindMapSvgSerializedByteLength('\u56fe', 2)).toThrowError(
      expect.objectContaining({
        code: 'serialized-size-limit',
        actual: 3,
        limit: 2,
      }),
    );
  });

  it('exports every Topic beyond the preview 32-topic limit and every Sheet', async () => {
    const mindMap = createMindMapV1SmallFixture();
    const firstSheet = Object.values(mindMap.sheets)[0];
    for (let index = 0; index < 40; index += 1) {
      const childId = topicId(index + 1);
      const childEdgeId = edgeId(index + 1);
      firstSheet.topics[childId] = createTopic({
        id: childId,
        title: `Full topic ${index + 1}`,
      });
      firstSheet.treeEdges[childEdgeId] = {
        id: childEdgeId,
        parentTopicId: firstSheet.rootTopicId,
        childTopicId: childId,
        orderKey: `full-${String(index).padStart(4, '0')}`,
        side: index % 2 === 0 ? 'left' : 'right',
      };
    }
    const secondSheetId = sheetId(1);
    const secondRootId = topicId(1000);
    const secondSheet = createMindMapSheet({
      id: secondSheetId,
      orderKey: 'z-second',
      rootTopicId: secondRootId,
      themeId: firstSheet.themeId,
      title: 'Second export sheet',
      rootTitle: 'Second-sheet root',
      rootPlacement: { mode: 'absolute', x: -420, y: 260 },
    });
    mindMap.sheets[secondSheetId] = secondSheet;

    const result = await createFullMindMapSvgExport(mindMap, exportOptions());
    const svg = renderSpec(result.spec);
    const expectedTopicCount = Object.values(mindMap.sheets)
      .reduce((total, sheet) => total + Object.keys(sheet.topics).length, 0);

    expect(expectedTopicCount).toBeGreaterThan(32);
    expect(result.status).toBe('ready');
    expect(result.sheetCount).toBe(2);
    expect(result.topicCount).toBe(expectedTopicCount);
    expect(svg.querySelectorAll('.mindmap-full-sheet')).toHaveLength(2);
    expect(svg.querySelectorAll('.mindmap-full-topic')).toHaveLength(expectedTopicCount);
    expect(svg.textContent).toContain('Full topic 40');
    expect(svg.textContent).toContain('Second-sheet root');
    expect(svg.querySelector('[data-mindmap-static-preview]')).toBeNull();
  });

  it('uses the exact Core-layout Topic coordinates and tree connector geometry', async () => {
    const mindMap = createMindMapV1SmallFixture();
    const sheet = Object.values(mindMap.sheets)[0];
    const root = sheet.topics[sheet.rootTopicId];
    root.placement = { mode: 'absolute', x: -275.5, y: 413.25 };
    const model = projectMindMapToRenderModel({
      document: mindMap,
      activeSheetId: sheet.id,
      collapsedTopicIds: [],
    });
    if (!model) throw new Error('Fixture model was not projected.');
    const expected = buildMindMapFlowProjection(mindMap, model);
    const expectedRoot = expected.nodes.find((node) => node.id === root.id);
    const expectedConnector = expected.treeEdges[0].data?.layout;
    if (!expectedRoot || !expectedConnector) throw new Error('Fixture layout is incomplete.');

    const result = await createFullMindMapSvgExport(mindMap, exportOptions());
    const svg = renderSpec(result.spec);
    const rootGroup = svg.querySelector<SVGGElement>(`[data-topic-id="${root.id}"]`);
    const connector = svg.querySelector<SVGPathElement>(
      `[data-tree-edge-id="${expected.treeEdges[0].id}"]`,
    );

    expect(Number(rootGroup?.getAttribute('data-layout-x'))).toBe(expectedRoot.position.x);
    expect(Number(rootGroup?.getAttribute('data-layout-y'))).toBe(expectedRoot.position.y);
    expect(Number(rootGroup?.getAttribute('data-layout-width'))).toBe(expectedRoot.width);
    expect(Number(rootGroup?.getAttribute('data-layout-height'))).toBe(expectedRoot.height);
    expect(connector?.getAttribute('d')).toBe(
      `M ${expectedConnector.points[0].x} ${expectedConnector.points[0].y} C ${expectedConnector.points[1].x} ${expectedConnector.points[1].y} ${expectedConnector.points[2].x} ${expectedConnector.points[2].y} ${expectedConnector.points[3].x} ${expectedConnector.points[3].y}`,
    );
  });

  it('renders Marker instances and the canvas legend from shared deterministic paths', async () => {
    const mindMap = createMindMapV1SmallFixture();
    const sheet = Object.values(mindMap.sheets)[0];
    const root = sheet.topics[sheet.rootTopicId];
    const groupId = '02950000-0000-7000-8000-000000000001' as MarkerGroupId;
    const definitionId = '02950000-0000-7000-8000-000000000002' as MarkerDefinitionId;
    const instanceId = '02950000-0000-7000-8000-000000000003' as MarkerInstanceId;
    mindMap.markerGroups[groupId] = {
      id: groupId,
      kind: 'builtin',
      name: '优先级',
      orderKey: 'marker-group',
      exclusive: true,
    };
    mindMap.markerDefinitions[definitionId] = {
      id: definitionId,
      groupId,
      name: '优先级 3',
      orderKey: 'marker-definition',
      source: { kind: 'builtin', key: 'priority-3' },
      semanticValue: 3,
    };
    sheet.markerInstances[instanceId] = {
      id: instanceId,
      topicId: root.id,
      markerDefinitionId: definitionId,
      orderKey: 'marker-instance',
      value: 3,
    };
    sheet.markerLegend = {
      visible: true,
      position: { x: -260, y: -120 },
      title: '项目标记',
      itemOrder: [definitionId],
    };

    const result = await createFullMindMapSvgExport(mindMap, exportOptions());
    const svg = renderSpec(result.spec);
    const topicMarker = svg.querySelector<SVGGElement>(
      `.mindmap-full-topic-marker[data-marker-id="${instanceId}"]`,
    );
    const legendMarker = svg.querySelector<SVGGElement>(
      `.mindmap-full-marker-legend-icon[data-marker-id="${definitionId}"]`,
    );
    expect(result.markerCount).toBe(1);
    expect(svg).toHaveAttribute('data-marker-count', '1');
    expect(svg).toHaveAttribute('data-marker-legend-count', '1');
    expect(svg).toHaveAttribute('data-marker-legend-item-count', '1');
    expect(topicMarker).toHaveAttribute('data-marker-render', 'deterministic-paths-v1');
    expect(topicMarker).toHaveAttribute('data-marker-visual-key', 'priority-3');
    expect(topicMarker?.querySelector('text')).toBeNull();
    expect(topicMarker?.querySelectorAll('path')).toHaveLength(2);
    expect(legendMarker?.querySelectorAll('path')).toHaveLength(2);
    expect(Array.from(legendMarker?.querySelectorAll('path') ?? [], (path) => path.getAttribute('d')))
      .toEqual(Array.from(topicMarker?.querySelectorAll('path') ?? [], (path) => path.getAttribute('d')));
    expect(svg.querySelector('.mindmap-full-marker-legend')?.textContent).toContain('项目标记');
    expect(svg.textContent).not.toMatch(/[◆⚑★☆↑↓←→]/u);
  });

  it('inlines integrity-checked managed Sticker bytes without leaking the object key', async () => {
    const mindMap = createMindMapV1SmallFixture();
    const sheet = Object.values(mindMap.sheets)[0];
    const root = sheet.topics[sheet.rootTopicId];
    const managedAssetId = assetId(1);
    const managedImageId = imageId(1);
    const sha256 = 'a'.repeat(64);
    const objectKey = `mindmap-images/sha256/${sha256}.png`;
    mindMap.assets[managedAssetId] = {
      id: managedAssetId,
      fileName: 'original-sticker.png',
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
      orderKey: 'managed-sticker',
      role: 'sticker',
      placement: { side: 'right', align: 'center', offset: { x: 7, y: -3 } },
      size: { width: 84, height: 84 },
      alt: 'Portable original sticker',
    };
    const readManagedResource = vi.fn(async () => PNG_BYTES);

    const result = await createFullMindMapSvgExport(mindMap, {
      ...exportOptions(),
      readManagedResource,
      hashSha256: async () => sha256,
    });
    const svg = renderSpec(result.spec);
    const sticker = svg.querySelector<SVGImageElement>(
      '.mindmap-full-image[data-image-role="sticker"] image',
    );
    const href = sticker?.getAttribute('href') ?? '';

    expect(readManagedResource).toHaveBeenCalledWith(objectKey, {
      signal: expect.any(AbortSignal),
    });
    expect(href).toMatch(/^data:image\/png;base64,/u);
    expect(svg.outerHTML).not.toContain(objectKey);
    expect(svg.outerHTML).not.toContain('objectKey');
    expect(Uint8Array.from(atob(href.split(',', 2)[1]), (value) => value.charCodeAt(0)))
      .toEqual(PNG_BYTES);
  });

  it('exports a managed canvas image background as verified inline data', async () => {
    const mindMap = createMindMapV1SmallFixture();
    const sheet = Object.values(mindMap.sheets)[0];
    const managedAssetId = assetId(2);
    const sha256 = 'b'.repeat(64);
    const objectKey = `mindmap-images/sha256/${sha256}.png`;
    mindMap.assets[managedAssetId] = {
      id: managedAssetId,
      fileName: 'canvas-background.png',
      mimeType: 'image/png',
      byteSize: PNG_BYTES.byteLength,
      sha256,
      source: { kind: 'managed', objectKey },
      intrinsicSize: { width: 1, height: 1 },
    };
    sheet.canvas.background = { kind: 'image', assetId: managedAssetId, fit: 'cover' };

    const result = await createFullMindMapSvgExport(mindMap, {
      ...exportOptions(),
      readManagedResource: vi.fn(async () => PNG_BYTES),
      hashSha256: async () => sha256,
    });
    const svg = renderSpec(result.spec);
    const background = svg.querySelector<SVGImageElement>(
      '.mindmap-full-sheet-background-image',
    );

    expect(background?.getAttribute('data-canvas-background-fit')).toBe('cover');
    expect(background?.getAttribute('href')).toMatch(/^data:image\/png;base64,/u);
    expect(svg.outerHTML).not.toContain(objectKey);
    expect(result.imageCount).toBe(1);
  });

  it('fails closed when a remote visual resource cannot be verified and inlined', async () => {
    const mindMap = createMindMapV1SmallFixture();
    const sheet = Object.values(mindMap.sheets)[0];
    const remoteAssetId = assetId(3);
    const remoteImageId = imageId(3);
    mindMap.assets[remoteAssetId] = {
      id: remoteAssetId,
      fileName: 'remote.png',
      mimeType: 'image/png',
      byteSize: PNG_BYTES.byteLength,
      sha256: 'c'.repeat(64),
      source: { kind: 'remote', url: 'https://cdn.example.test/remote.png' },
      intrinsicSize: { width: 1, height: 1 },
    };
    sheet.images[remoteImageId] = {
      id: remoteImageId,
      topicId: sheet.rootTopicId,
      assetId: remoteAssetId,
      orderKey: 'remote-image',
      role: 'inline',
      placement: { side: 'top', align: 'center', offset: { x: 0, y: 0 } },
    };

    await expect(createFullMindMapSvgExport(mindMap, exportOptions())).rejects.toMatchObject({
      name: 'FullMindMapSvgExportError',
      code: 'resource-unavailable',
    } satisfies Partial<FullMindMapSvgExportError>);
  });

  it('rejects a crop outside the verified raster dimensions', async () => {
    const mindMap = createMindMapV1SmallFixture();
    const sheet = Object.values(mindMap.sheets)[0];
    const managedAssetId = assetId(4);
    const managedImageId = imageId(4);
    const sha256 = 'd'.repeat(64);
    mindMap.assets[managedAssetId] = {
      id: managedAssetId,
      fileName: 'cropped.png',
      mimeType: 'image/png',
      byteSize: PNG_BYTES.byteLength,
      sha256,
      source: {
        kind: 'managed',
        objectKey: `mindmap-images/sha256/${sha256}.png`,
      },
      intrinsicSize: { width: 1, height: 1 },
    };
    sheet.images[managedImageId] = {
      id: managedImageId,
      topicId: sheet.rootTopicId,
      assetId: managedAssetId,
      orderKey: 'invalid-crop',
      role: 'inline',
      placement: { side: 'top', align: 'center', offset: { x: 0, y: 0 } },
      crop: { x: 0, y: 0, width: 2, height: 1 },
    };

    await expect(createFullMindMapSvgExport(mindMap, {
      ...exportOptions(),
      readManagedResource: vi.fn(async () => PNG_BYTES),
      hashSha256: async () => sha256,
    })).rejects.toMatchObject({
      name: 'FullMindMapSvgExportError',
      code: 'projection-incomplete',
    } satisfies Partial<FullMindMapSvgExportError>);
  });

  it('returns actual packed content bounds and matching numeric root dimensions', async () => {
    const mindMap = createMindMapV1SmallFixture();
    const sheet = Object.values(mindMap.sheets)[0];
    sheet.title = 'A sheet title whose width contributes to the real export bounds';
    const floatingId = topicId(2000);
    sheet.topics[floatingId] = createTopic({
      id: floatingId,
      role: 'floating-root',
      title: 'Far negative floating Topic',
      placement: { mode: 'absolute', x: -1_250, y: -860 },
    });

    const result = await createFullMindMapSvgExport(mindMap, exportOptions());
    const svg = renderSpec(result.spec);
    const [viewX, viewY, viewWidth, viewHeight] = (svg.getAttribute('viewBox') ?? '')
      .split(/\s+/u)
      .map(Number);
    const packed = result.sheetBounds[0];

    expect(viewX).toBe(0);
    expect(viewY).toBe(0);
    expect(viewWidth).toBe(result.width);
    expect(viewHeight).toBe(result.height);
    expect(Number(svg.getAttribute('width'))).toBe(result.width);
    expect(Number(svg.getAttribute('height'))).toBe(result.height);
    expect(result.bounds).toEqual({ x: 0, y: 0, width: result.width, height: result.height });
    expect(svg.getAttribute('data-mindmap-static-export')).toBe('ready');
    expect(packed.sourceBounds.x).toBeLessThanOrEqual(-1_250);
    expect(packed.bounds.x + packed.bounds.width).toBeLessThanOrEqual(result.width);
    expect(packed.bounds.y + packed.bounds.height).toBeLessThanOrEqual(result.height);
    expect(packed.translateX + packed.sourceBounds.x).toBeGreaterThanOrEqual(packed.bounds.x);
    expect(packed.translateY + packed.sourceBounds.y).toBeGreaterThanOrEqual(packed.bounds.y);
    expect(result.width).not.toBe(960);
  });

  it('applies transparent/solid background, padding, and frame settings deterministically', async () => {
    const mindMap = createMindMapV1SmallFixture();
    const transparent = await createFullMindMapSvgExport(mindMap, {
      ...exportOptions(),
      appearance: { background: { kind: 'transparent' }, frame: 'none', padding: 0 },
    });
    const padded = await createFullMindMapSvgExport(mindMap, {
      ...exportOptions(),
      appearance: { background: { kind: 'transparent' }, frame: 'none', padding: 40 },
    });
    const solid = await createFullMindMapSvgExport(mindMap, {
      ...exportOptions(),
      appearance: { background: { kind: 'solid', color: '#123456' }, frame: 'sheet-card' },
    });
    const transparentSvg = renderSpec(transparent.spec);
    const solidSvg = renderSpec(solid.spec);

    expect(padded.width - transparent.width).toBe(80);
    expect(padded.height - transparent.height).toBe(80);
    expect(transparentSvg.getAttribute('data-export-padding')).toBe('0');
    expect(transparentSvg.getAttribute('data-export-background')).toBe('transparent');
    expect(transparentSvg.querySelector('.mindmap-full-sheet-title')).toBeNull();
    expect(transparentSvg.querySelector('.mindmap-full-sheet-background')?.getAttribute('fill'))
      .toBe('none');
    expect(transparentSvg.querySelector('.mindmap-full-sheet-background')?.getAttribute('stroke'))
      .toBe('none');
    expect(solidSvg.querySelector('.mindmap-full-export-background')?.getAttribute('fill'))
      .toBe('#123456');
    expect(solidSvg.querySelector('.mindmap-full-sheet-title')).not.toBeNull();
  });

  it('does not load glyphs for a Sheet header when the selected frame does not paint it', async () => {
    const mindMap = createMindMapV1SmallFixture();
    const sheet = Object.values(mindMap.sheets)[0];
    const unpaintedTitle = `Hidden ${String.fromCodePoint(0x20000)}`;
    sheet.title = unpaintedTitle;
    const options = exportOptions();

    await createFullMindMapSvgExport(mindMap, {
      ...options,
      appearance: { background: { kind: 'transparent' }, frame: 'none', padding: 0 },
    });

    expect(options.loadStaticFontBundle).toHaveBeenCalledTimes(1);
    const input = vi.mocked(options.loadStaticFontBundle!).mock.calls[0][0];
    expect(input.usages.some((usage) => usage.text.includes(unpaintedTitle))).toBe(false);
  });

  it('compiles branch scope before resource reads, counts, and layout', async () => {
    const mindMap = createMindMapV1SmallFixture();
    const sheet = Object.values(mindMap.sheets)[0];
    const branchEdge = Object.values(sheet.treeEdges)
      .find((edge) => edge.parentTopicId === sheet.rootTopicId);
    if (!branchEdge) throw new Error('Fixture branch is missing.');
    const excludedAssetId = assetId(20);
    const excludedImageId = imageId(20);
    const excludedSha = 'e'.repeat(64);
    mindMap.assets[excludedAssetId] = {
      id: excludedAssetId,
      fileName: 'excluded.png',
      mimeType: 'image/png',
      byteSize: PNG_BYTES.byteLength,
      sha256: excludedSha,
      source: {
        kind: 'managed',
        objectKey: `mindmap-images/sha256/${excludedSha}.png`,
      },
      intrinsicSize: { width: 1, height: 1 },
    };
    sheet.images[excludedImageId] = {
      id: excludedImageId,
      topicId: sheet.rootTopicId,
      assetId: excludedAssetId,
      orderKey: 'excluded-root-image',
      role: 'inline',
      placement: { side: 'top', align: 'center', offset: { x: 0, y: 0 } },
    };
    const readManagedResource = vi.fn(async () => {
      throw new Error('Out-of-scope resource must not be read.');
    });

    const result = await createFullMindMapSvgExport(mindMap, {
      ...exportOptions(),
      readManagedResource,
      scope: {
        kind: 'branch',
        sheetId: sheet.id,
        rootTopicId: branchEdge.childTopicId,
      },
    });
    const svg = renderSpec(result.spec);

    expect(readManagedResource).not.toHaveBeenCalled();
    expect(result.sheetCount).toBe(1);
    expect(result.imageCount).toBe(0);
    expect(svg.querySelector(`[data-topic-id="${branchEdge.childTopicId}"]`)).not.toBeNull();
    expect(svg.querySelector(`[data-topic-id="${sheet.rootTopicId}"]`)).toBeNull();
    expect(svg.outerHTML).not.toContain(String(excludedAssetId));
  });

  it('compiles selected-Sheet scope before reading resources from excluded Sheets', async () => {
    const mindMap = createMindMapV1SmallFixture();
    const firstSheet = Object.values(mindMap.sheets)[0];
    const secondSheet = createMindMapSheet({
      id: sheetId(21),
      orderKey: 'b-selected',
      rootTopicId: topicId(2_100),
      themeId: firstSheet.themeId,
      title: 'Selected second Sheet',
      rootTitle: 'Selected second root',
    });
    const excludedSheet = createMindMapSheet({
      id: sheetId(22),
      orderKey: 'c-excluded',
      rootTopicId: topicId(2_200),
      themeId: firstSheet.themeId,
      title: 'Excluded resource Sheet',
      rootTitle: 'Excluded resource root',
    });
    mindMap.sheets[secondSheet.id] = secondSheet;
    mindMap.sheets[excludedSheet.id] = excludedSheet;
    const excludedAssetId = assetId(22);
    const excludedImageId = imageId(22);
    const excludedSha = 'f'.repeat(64);
    mindMap.assets[excludedAssetId] = {
      id: excludedAssetId,
      fileName: 'excluded-sheet.png',
      mimeType: 'image/png',
      byteSize: PNG_BYTES.byteLength,
      sha256: excludedSha,
      source: {
        kind: 'managed',
        objectKey: `mindmap-images/sha256/${excludedSha}.png`,
      },
      intrinsicSize: { width: 1, height: 1 },
    };
    excludedSheet.images[excludedImageId] = {
      id: excludedImageId,
      topicId: excludedSheet.rootTopicId,
      assetId: excludedAssetId,
      orderKey: 'excluded-sheet-image',
      role: 'inline',
      placement: { side: 'top', align: 'center', offset: { x: 0, y: 0 } },
    };
    const readManagedResource = vi.fn(async () => {
      throw new Error('A resource owned by an excluded Sheet must not be read.');
    });

    const result = await createFullMindMapSvgExport(mindMap, {
      ...exportOptions(),
      readManagedResource,
      scope: {
        kind: 'selected-sheets',
        sheetIds: [secondSheet.id, firstSheet.id],
      },
    });
    const svg = renderSpec(result.spec);

    expect(readManagedResource).not.toHaveBeenCalled();
    expect(result.sheetCount).toBe(2);
    expect(result.imageCount).toBe(0);
    expect(svg.textContent).toContain(firstSheet.title);
    expect(svg.textContent).toContain(secondSheet.title);
    expect(svg.textContent).not.toContain(excludedSheet.title);
    expect(svg.outerHTML).not.toContain(String(excludedAssetId));
  });

  it('renders every canonical semantic entity from semanticGeometry with resolved paint', async () => {
    const mindMap = createMindMapElementsFixture();
    const sheet = Object.values(mindMap.sheets)[0];
    // Resource portability is covered independently above; keep this case
    // focused on the complete semanticGeometry paint contract.
    for (const id of Object.keys(sheet.images) as ImageId[]) delete sheet.images[id];
    const expectedCount = Object.keys(sheet.boundaries).length
      + Object.keys(sheet.summaries).length
      + Object.keys(sheet.callouts).length
      + Object.keys(sheet.zones).length
      + Object.keys(sheet.relationships).length;

    const result = await createFullMindMapSvgExport(mindMap, exportOptions());
    const svg = renderSpec(result.spec);

    expect(result.semanticElementCount).toBe(expectedCount);
    expect(svg.querySelectorAll('[data-semantic-kind]')).toHaveLength(expectedCount);
    expect(svg.querySelector('[data-semantic-kind="boundary"]')).not.toBeNull();
    expect(svg.querySelector('[data-semantic-kind="summary"]')).not.toBeNull();
    expect(svg.querySelector('[data-semantic-kind="callout"]')).not.toBeNull();
    expect(svg.querySelector('[data-semantic-kind="zone"]')).not.toBeNull();
    expect(svg.querySelector('[data-semantic-kind="relationship"]')).not.toBeNull();
    expect(svg.querySelector('[data-semantic-kind="boundary"] path, [data-semantic-kind="boundary"] rect, [data-semantic-kind="boundary"] ellipse'))
      .not.toBeNull();
  });

  it('ACC-IO-010 preserves rich marks, safe links, equations, and TopicLinks in layout', async () => {
    const mindMap = createMindMapElementsFixture();
    const sheet = Object.values(mindMap.sheets)[0];
    for (const id of Object.keys(sheet.images) as ImageId[]) delete sheet.images[id];
    const root = sheet.topics[sheet.rootTopicId];
    root.title = {
      type: 'doc',
      version: 1,
      blocks: [{
        type: 'paragraph',
        align: 'right',
        children: [
          {
            type: 'text',
            text: '中文 👩🏽‍💻 Rich',
            marks: [
              { type: 'bold' },
              { type: 'italic' },
              { type: 'underline' },
              { type: 'strike' },
              { type: 'color', value: '#ef4444' },
              { type: 'fontFamily', value: 'Host-only Custom Font' },
              { type: 'fontSize', value: 20 },
              { type: 'link', href: 'https://example.com/rich', title: 'Rich link' },
            ],
          },
          {
            type: 'text',
            text: ' unsafe',
            marks: [{ type: 'link', href: 'javascript:alert(1)' }],
          },
          {
            type: 'text',
            text: ' A中',
            marks: [{ type: 'code' }],
          },
        ],
      }],
    };
    const privateLinkId = '02950000-0000-7000-8000-000000000001' as LinkId;
    sheet.links[privateLinkId] = {
      id: privateLinkId,
      topicId: root.id,
      orderKey: 'z-private',
      kind: 'file',
      href: String.raw`C:\Users\Alice\Private\strategy.pdf`,
      status: 'active',
    };
    const model = projectMindMapToRenderModel({ document: mindMap, activeSheetId: sheet.id });
    const baseProjection = buildMindMapFlowProjection(mindMap, model!);
    const baseRootHeight = baseProjection.nodes.find((node) => node.id === root.id)!.height!;

    const options = exportOptions();
    const result = await createFullMindMapSvgExport(mindMap, options);
    const svg = renderSpec(result.spec);
    const html = svg.outerHTML;

    expect(result.equationCount).toBe(Object.keys(sheet.equations).length);
    expect(result.equationVectorCount).toBe(result.equationCount);
    expect(result.equationFallbackCount).toBe(0);
    expect(result.linkCount).toBe(Object.keys(sheet.links).length);
    expect(result.fontPolicy).toBe(MIND_MAP_STATIC_FONT_POLICY);
    expect(result.equationPolicy).toBe('mathjax-svg-paths-v1');
    expect(svg).toHaveAttribute('data-font-policy', MIND_MAP_STATIC_FONT_POLICY);
    expect(result.embeddedFontBytes).toBe(1);
    expect(result.fontFaceCount).toBe(1);
    expect(result.fontSourceVersion).toBe('5.3.0');
    expect(svg.querySelectorAll('[data-mindmap-static-font-definitions="true"]')).toHaveLength(1);
    expect(svg.querySelector('defs > style')?.textContent).toContain('data:font/woff2;base64,');
    expect(html).not.toMatch(/system-ui|ui-monospace|Host-only Custom Font/iu);
    expect([...svg.querySelectorAll('[font-family]')].every((element) => (
      element.getAttribute('font-family')?.includes('NMDD Noto') === true
    ))).toBe(true);
    expect(svg.querySelector('[font-family*="Noto Sans Mono"]'))
      .toHaveAttribute('font-stretch', 'extra-condensed');
    expect(options.loadStaticFontBundle).toHaveBeenCalledWith(expect.objectContaining({
      usages: expect.arrayContaining([
        expect.objectContaining({ role: 'code', text: ' A中' }),
      ]),
    }));
    expect(svg).toHaveAttribute('data-equation-policy', 'mathjax-svg-paths-v1');
    expect(svg).toHaveAttribute('data-equation-vector-count', String(result.equationCount));
    expect(svg).toHaveAttribute('data-equation-fallback-count', '0');
    expect(svg.querySelectorAll('[data-equation-id]')).toHaveLength(result.equationCount);
    expect(svg.querySelectorAll('[data-link-id]')).toHaveLength(result.linkCount);
    const renderedEquation = svg.querySelector('[data-equation-render="svg-paths"]');
    expect(renderedEquation).toHaveAttribute('data-equation-renderer', 'mathjax-v4');
    expect(renderedEquation?.querySelector('svg path')).not.toBeNull();
    expect(renderedEquation?.querySelector('.mindmap-full-equation-text')).toBeNull();
    expect(renderedEquation?.querySelector('desc')?.textContent).toContain('ROI');
    const richLink = svg.querySelector('a[href="https://example.com/rich"]');
    expect(richLink).not.toBeNull();
    expect(richLink).toHaveAttribute('rel', 'noopener noreferrer nofollow');
    const markedRun = richLink?.querySelector('text');
    expect(markedRun).toHaveAttribute('font-weight', '700');
    expect(markedRun).toHaveAttribute('font-style', 'normal');
    expect(markedRun?.closest('[data-static-italic="skew-minus-12-v1"]'))
      .toHaveAttribute('transform', expect.stringContaining('skewX(-12)'));
    expect(svg.querySelector('[font-style="italic"]')).toBeNull();
    expect(svg).toHaveAttribute('font-synthesis', 'none');
    expect(svg).toHaveAttribute('data-font-style-policy', 'explicit-skew-minus-12-v1');
    expect(markedRun).toHaveAttribute('fill', '#ef4444');
    expect(markedRun).toHaveAttribute('font-size', '20');
    expect(markedRun?.getAttribute('text-decoration')).toContain('line-through');
    expect(svg.querySelector('[data-unsafe-link="true"]')).not.toBeNull();
    expect(svg.querySelector('[data-link-kind="web"] a[href^="https://"]')).not.toBeNull();
    expect(svg.querySelector(`[data-link-id="${privateLinkId}"] a`)).toBeNull();
    expect(html).not.toContain('C:\\Users\\Alice\\Private');
    expect(html).not.toMatch(/javascript:/iu);
    const renderedRootHeight = Number(
      svg.querySelector(`[data-topic-id="${root.id}"]`)?.getAttribute('data-layout-height'),
    );
    expect(renderedRootHeight).toBeGreaterThan(baseRootHeight);
    expect(svg.textContent).toContain('👩🏽‍💻');
    expect(svg.textContent).not.toContain('\uFFFD');
  });

  it('keeps a visible literal fallback when one equation cannot produce safe paths', async () => {
    const mindMap = createMindMapElementsFixture();
    const sheet = Object.values(mindMap.sheets)[0];
    for (const id of Object.keys(sheet.images) as ImageId[]) delete sheet.images[id];
    const fallbackId = '02960000-0000-7000-8000-000000000001' as EquationId;
    sheet.equations[fallbackId] = createEquation({
      id: fallbackId,
      orderKey: 'z-fallback',
      source: '',
      topicId: sheet.rootTopicId,
    });

    const result = await createFullMindMapSvgExport(mindMap, exportOptions());
    const svg = renderSpec(result.spec);

    expect(result.equationVectorCount).toBeGreaterThan(0);
    expect(result.equationFallbackCount).toBe(1);
    expect(result.equationPolicy).toBe('mathjax-svg-paths-v1-with-fallback');
    const fallback = svg.querySelector(`[data-equation-id="${fallbackId}"]`);
    expect(fallback).toHaveAttribute('data-equation-render', 'literal-fallback');
    expect(fallback).toHaveAttribute('data-equation-fallback-reason', 'empty-source');
    expect(fallback?.querySelector('.mindmap-full-equation-text')?.textContent)
      .toContain('Empty equation');
  });

  it('applies Equation scale to vector geometry and block display alignment', async () => {
    const mindMap = createMindMapElementsFixture();
    const sheet = Object.values(mindMap.sheets)[0];
    for (const id of Object.keys(sheet.images) as ImageId[]) delete sheet.images[id];
    const equation = Object.values(sheet.equations)[0];
    equation.source = 'x';
    equation.scale = 1;
    const initial = renderSpec((await createFullMindMapSvgExport(mindMap, exportOptions())).spec);
    const initialVector = initial.querySelector(
      `[data-equation-id="${equation.id}"] .mindmap-full-equation-vector`,
    );
    const initialWidth = Number(initialVector?.getAttribute('width'));
    const initialHeight = Number(initialVector?.getAttribute('height'));

    equation.scale = 2;
    equation.display = 'block';
    const scaled = renderSpec((await createFullMindMapSvgExport(mindMap, exportOptions())).spec);
    const scaledVector = scaled.querySelector(
      `[data-equation-id="${equation.id}"] .mindmap-full-equation-vector`,
    );

    expect(Number(scaledVector?.getAttribute('width'))).toBeCloseTo(initialWidth * 2, 6);
    expect(Number(scaledVector?.getAttribute('height'))).toBeCloseTo(initialHeight * 2, 6);
    expect(scaledVector).toHaveAttribute('preserveAspectRatio', 'xMidYMid meet');
  });

  it('rejects an exceeded safety budget instead of returning a truncated SVG', async () => {
    const mindMap = createMindMapV1SmallFixture();

    await expect(createFullMindMapSvgExport(mindMap, {
      ...exportOptions(),
      limits: { maxTopics: 2 },
    })).rejects.toMatchObject({
      name: 'FullMindMapSvgExportError',
      code: 'topic-limit',
      limit: 2,
    } satisfies Partial<FullMindMapSvgExportError>);
  });

  it('stops text-line allocation at the element budget during rendering', async () => {
    const mindMap = createMindMapV1SmallFixture();
    const sheet = Object.values(mindMap.sheets)[0];
    sheet.topics[sheet.rootTopicId].title = createTopic({
      id: sheet.rootTopicId,
      title: 'W'.repeat(20_000),
    }).title;

    await expect(createFullMindMapSvgExport(mindMap, {
      ...exportOptions(),
      limits: { maxElements: 100 },
    })).rejects.toMatchObject({
      name: 'FullMindMapSvgExportError',
      code: 'element-limit',
      limit: 100,
    } satisfies Partial<FullMindMapSvgExportError>);
  });

  it('charges embedded font data against a caller-lowered serialized byte limit', async () => {
    const mindMap = createMindMapV1SmallFixture();

    await expect(createFullMindMapSvgExport(mindMap, {
      ...exportOptions(),
      limits: { maxSerializedBytes: 80 },
    })).rejects.toMatchObject({
      name: 'FullMindMapSvgExportError',
      code: 'serialized-size-limit',
      actual: 96,
      limit: 80,
    } satisfies Partial<FullMindMapSvgExportError>);
  });

  it('normalizes every non-abort font preparation failure without leaking its details', async () => {
    const mindMap = createMindMapV1SmallFixture();
    const underlying = new TypeError('https://private-font.example.test/signed?token=secret');

    await expect(createFullMindMapSvgExport(mindMap, {
      ...exportOptions(),
      loadStaticFontBundle: vi.fn(async () => {
        throw underlying;
      }),
    })).rejects.toMatchObject({
      name: 'FullMindMapSvgExportError',
      code: 'resource-unavailable',
      message: 'Pinned static fonts could not be prepared.',
      cause: underlying,
    } satisfies Partial<FullMindMapSvgExportError>);
  });

  it('releases registered font faces on success and every post-load failure path', async () => {
    const mindMap = createMindMapV1SmallFixture();
    const successRelease = vi.fn();
    const successDefaults = exportOptions();
    const successLoader = successDefaults.loadStaticFontBundle!;

    await createFullMindMapSvgExport(mindMap, {
      ...successDefaults,
      loadStaticFontBundle: vi.fn(async (input) => ({
        ...(await successLoader(input)),
        release: successRelease,
      })),
    });
    expect(successRelease).toHaveBeenCalledTimes(1);

    const failureRelease = vi.fn();
    const failureDefaults = exportOptions();
    const failureLoader = failureDefaults.loadStaticFontBundle!;
    await expect(createFullMindMapSvgExport(mindMap, {
      ...failureDefaults,
      limits: { maxSerializedBytes: 80 },
      loadStaticFontBundle: vi.fn(async (input) => ({
        ...(await failureLoader(input)),
        release: failureRelease,
      })),
    })).rejects.toMatchObject({
      name: 'FullMindMapSvgExportError',
      code: 'serialized-size-limit',
    } satisfies Partial<FullMindMapSvgExportError>);
    expect(failureRelease).toHaveBeenCalledTimes(1);
  });

  it('does not let cleanup failure replace the real export failure', async () => {
    const mindMap = createMindMapV1SmallFixture();
    const defaults = exportOptions();
    const baseLoader = defaults.loadStaticFontBundle!;

    await expect(createFullMindMapSvgExport(mindMap, {
      ...defaults,
      limits: { maxSerializedBytes: 80 },
      loadStaticFontBundle: vi.fn(async (input) => ({
        ...(await baseLoader(input)),
        release: () => {
          throw new Error('cleanup failed');
        },
      })),
    })).rejects.toMatchObject({
      name: 'FullMindMapSvgExportError',
      code: 'serialized-size-limit',
      actual: 96,
      limit: 80,
    } satisfies Partial<FullMindMapSvgExportError>);
  });
});
