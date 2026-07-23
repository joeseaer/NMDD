import { describe, expect, it } from 'vitest';

import {
  BUILT_IN_STICKERS,
  filterBuiltInStickers,
  isBuiltInStickerId,
  STICKER_CATEGORIES,
  STICKER_CATALOG_MANIFEST_FINGERPRINT,
} from '../ui/stickerCatalog';

describe('licensed sticker catalog manifest', () => {
  it('exposes the complete deterministic 13-category release inventory', () => {
    expect(STICKER_CATEGORIES).toHaveLength(13);
    expect(BUILT_IN_STICKERS).toHaveLength(468);
    expect(new Set(BUILT_IN_STICKERS.map(({ id }) => id)).size).toBe(468);
    expect(new Set(BUILT_IN_STICKERS.map(({ publicUrl }) => publicUrl)).size).toBe(468);
    expect(BUILT_IN_STICKERS.filter(({ kind }) => kind === 'illustration')).toHaveLength(39);
    expect(STICKER_CATALOG_MANIFEST_FINGERPRINT).toMatch(/^[a-f0-9]{64}$/u);

    for (const category of STICKER_CATEGORIES) {
      const items = BUILT_IN_STICKERS.filter((item) => item.categoryId === category.id);
      expect(category.itemCount).toBe(36);
      expect(items).toHaveLength(36);
      expect(items.map(({ categoryPosition }) => categoryPosition)).toEqual(
        Array.from({ length: 36 }, (_, index) => index),
      );
      expect(items.filter(({ kind }) => kind === 'illustration')).toHaveLength(3);
    }
  });

  it('keeps every asset same-origin, integrity-bound, licensed, and honest about XMind fallback', () => {
    for (const item of BUILT_IN_STICKERS) {
      expect(item.publicUrl).toMatch(/^\/mindmap\/stickers\//u);
      expect(item.byteSize).toBeGreaterThan(0);
      expect(item.byteSize).toBeLessThanOrEqual(64 * 1024);
      expect(item.sha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(item.provenance).toBe('licensed-lucide-isc-derived');
      expect(item.license).toMatchObject({
        spdxId: 'ISC',
        sourcePackage: 'lucide-react',
        sourceVersion: '0.358.0',
      });
      expect(item.xmindCompatibility).toBe('canonical-fallback-only');
      expect(isBuiltInStickerId(item.id)).toBe(true);
    }
    expect(isBuiltInStickerId('not-in-the-release-manifest')).toBe(false);
  });

  it('searches normalized labels, tags, aliases, kind, and category without changing release order', () => {
    expect(filterBuiltInStickers({ query: ' 灵感　LIGHTBULB ' }).map(({ id }) => id))
      .toContain('idea-lightbulb');
    expect(filterBuiltInStickers({ query: '火箭', categoryId: 'ideas' }).map(({ id }) => id))
      .toContain('ideas-rocket');
    expect(filterBuiltInStickers({ query: 'rocket', categoryId: 'business' })).toEqual([]);
    const illustrations = filterBuiltInStickers({ kind: 'illustration' });
    expect(illustrations).toHaveLength(39);
    expect(illustrations.every(({ kind }) => kind === 'illustration')).toBe(true);
    const category = filterBuiltInStickers({ categoryId: 'travel' });
    expect(category).toHaveLength(36);
    expect(category.map(({ categoryPosition }) => categoryPosition)).toEqual(
      Array.from({ length: 36 }, (_, index) => index),
    );
  });
});
