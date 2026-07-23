import { describe, expect, it } from 'vitest';

import {
  MAX_RECENT_STICKERS,
  parseStickerCatalogPreferences,
  readStickerCatalogPreferences,
  recordRecentlyUsedSticker,
  setFavoriteSticker,
  STICKER_CATALOG_PREFERENCES_KEY,
} from './stickerRecentStore';
import { BUILT_IN_STICKER_IDS } from './stickerManifest.generated';

const memoryStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    values,
  };
};

describe('sticker catalog preference store', () => {
  it('sanitizes unknown IDs, duplicates, invalid versions, and oversized recent lists', () => {
    expect(parseStickerCatalogPreferences({ version: 99, recent: BUILT_IN_STICKER_IDS })).toEqual({
      favorites: [],
      recent: [],
    });
    const parsed = parseStickerCatalogPreferences({
      version: 1,
      favorites: [BUILT_IN_STICKER_IDS[0], 'unknown', BUILT_IN_STICKER_IDS[0]],
      recent: [...BUILT_IN_STICKER_IDS.slice(0, 20), 'unknown'],
    });
    expect(parsed.favorites).toEqual([BUILT_IN_STICKER_IDS[0]]);
    expect(parsed.recent).toEqual(BUILT_IN_STICKER_IDS.slice(0, MAX_RECENT_STICKERS));
  });

  it('keeps a successful-use LRU and independent favorites outside canonical content', () => {
    const storage = memoryStorage();
    const first = BUILT_IN_STICKER_IDS[0];
    const second = BUILT_IN_STICKER_IDS[1];
    recordRecentlyUsedSticker(first, storage);
    recordRecentlyUsedSticker(second, storage);
    recordRecentlyUsedSticker(first, storage);
    expect(readStickerCatalogPreferences(storage).recent).toEqual([first, second]);

    setFavoriteSticker(second, true, storage);
    setFavoriteSticker(first, true, storage);
    expect(readStickerCatalogPreferences(storage)).toEqual({
      favorites: [first, second],
      recent: [first, second],
    });
    setFavoriteSticker(first, false, storage);
    expect(readStickerCatalogPreferences(storage).favorites).toEqual([second]);
    expect(JSON.parse(storage.values.get(STICKER_CATALOG_PREFERENCES_KEY) ?? '{}'))
      .toMatchObject({ version: 1 });
  });

  it('fails closed on malformed or oversized persisted JSON', () => {
    const storage = memoryStorage();
    storage.setItem(STICKER_CATALOG_PREFERENCES_KEY, '{bad-json');
    expect(readStickerCatalogPreferences(storage)).toEqual({ favorites: [], recent: [] });
    storage.setItem(STICKER_CATALOG_PREFERENCES_KEY, 'x'.repeat(40_000));
    expect(readStickerCatalogPreferences(storage)).toEqual({ favorites: [], recent: [] });
  });
});
