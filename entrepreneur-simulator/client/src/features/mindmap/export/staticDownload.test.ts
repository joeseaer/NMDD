// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { createMindMapBlockDocument } from '../domain/createDocument';
import { createMindMapStaticSvgPreview } from './staticSvg';
import {
  rasterizeMindMapSvg,
  rasterizeMindMapSvgToPng,
  serializeMindMapSvgSpec,
} from './staticDownload';

describe('static mind-map downloads', () => {
  it('serializes a script-free standalone SVG document', () => {
    const preview = createMindMapStaticSvgPreview(createMindMapBlockDocument());
    const serialized = serializeMindMapSvgSpec(preview.spec);

    expect(serialized).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/u);
    expect(serialized).toContain('<svg');
    expect(serialized).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(serialized).toContain('data-mindmap-static-preview="ready"');
    expect(serialized).not.toMatch(/<script|javascript:/iu);
  });

  it('scales declared SVG dimensions without changing its logical viewBox', () => {
    const serialized = serializeMindMapSvgSpec([
      'http://www.w3.org/2000/svg svg',
      { height: 50, viewBox: '0 0 100 50', width: 100 },
    ], { scale: 3 });
    expect(serialized).toContain('width="300"');
    expect(serialized).toContain('height="150"');
    expect(serialized).toContain('viewBox="0 0 100 50"');
    expect(serialized).toContain('data-export-scale="3"');
  });

  it('rejects invalid or unsafe raster dimensions before creating an image', async () => {
    await expect(rasterizeMindMapSvgToPng('<svg/>', Number.NaN, 100))
      .rejects.toThrow('静态图片尺寸超过安全栅格化上限');
    await expect(rasterizeMindMapSvgToPng('<svg/>', 0, 100))
      .rejects.toThrow('静态图片尺寸超过安全栅格化上限');
    await expect(rasterizeMindMapSvgToPng('<svg/>', -1, 100))
      .rejects.toThrow('静态图片尺寸超过安全栅格化上限');
    await expect(rasterizeMindMapSvgToPng('<svg/>', 100.5, 100))
      .rejects.toThrow('静态图片尺寸超过安全栅格化上限');
    await expect(rasterizeMindMapSvgToPng('<svg/>', 10_000, 10_000))
      .rejects.toThrow('静态图片尺寸超过安全栅格化上限');
    await expect(rasterizeMindMapSvgToPng('<svg/>', 20_000, 1))
      .rejects.toThrow('静态图片尺寸超过安全栅格化上限');
  });

  it('honors an already-aborted PNG export without allocating a Blob URL', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(rasterizeMindMapSvgToPng('<svg/>', 100, 100, controller.signal))
      .rejects.toMatchObject({ name: 'AbortError' });
  });

  it('applies scale before raster safety checks and requires an opaque JPEG background', async () => {
    await expect(rasterizeMindMapSvg('<svg/>', 6_000, 100, {
      format: 'png',
      scale: 3,
    })).rejects.toThrow('静态图片尺寸超过安全栅格化上限');
    await expect(rasterizeMindMapSvg('<svg/>', 100, 100, {
      format: 'jpeg',
      scale: 2,
    })).rejects.toThrow('JPEG 导出需要明确的不透明背景色');
    await expect(rasterizeMindMapSvg('<svg/>', 100, 100, {
      backgroundColor: '#ffffff',
      format: 'jpeg',
      quality: 2,
      scale: 1,
    })).rejects.toThrow('JPEG 导出质量参数无效');
  });
});
