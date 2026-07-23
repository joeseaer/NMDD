import {
  BUILT_IN_STICKER_IDS,
  type BuiltInStickerId,
} from './stickerManifest.generated';

export const STICKER_CATALOG_PREFERENCES_KEY = 'nmdd.mindmap.sticker-catalog.preferences.v1';
export const STICKER_CATALOG_PREFERENCES_EVENT = 'nmdd:mindmap-sticker-catalog-preferences';
export const MAX_RECENT_STICKERS = 12;
export const MAX_FAVORITE_STICKERS = 128;

export interface StickerCatalogPreferences {
  readonly favorites: readonly BuiltInStickerId[];
  readonly recent: readonly BuiltInStickerId[];
}

const knownIds = new Set<string>(BUILT_IN_STICKER_IDS);
const EMPTY_PREFERENCES: StickerCatalogPreferences = Object.freeze({
  favorites: Object.freeze([]),
  recent: Object.freeze([]),
});

const isKnownId = (value: unknown): value is BuiltInStickerId => (
  typeof value === 'string' && knownIds.has(value)
);

const canonicalIds = (value: unknown, limit: number): readonly BuiltInStickerId[] => {
  if (!Array.isArray(value)) return [];
  const result: BuiltInStickerId[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (!isKnownId(candidate) || seen.has(candidate)) continue;
    seen.add(candidate);
    result.push(candidate);
    if (result.length >= limit) break;
  }
  return Object.freeze(result);
};

export const parseStickerCatalogPreferences = (value: unknown): StickerCatalogPreferences => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return EMPTY_PREFERENCES;
  const candidate = value as { favorites?: unknown; recent?: unknown; version?: unknown };
  if (candidate.version !== 1) return EMPTY_PREFERENCES;
  return Object.freeze({
    favorites: canonicalIds(candidate.favorites, MAX_FAVORITE_STICKERS),
    recent: canonicalIds(candidate.recent, MAX_RECENT_STICKERS),
  });
};

const browserStorage = (): Storage | undefined => {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
};

export const readStickerCatalogPreferences = (
  storage: Pick<Storage, 'getItem'> | undefined = browserStorage(),
): StickerCatalogPreferences => {
  if (!storage) return EMPTY_PREFERENCES;
  try {
    const text = storage.getItem(STICKER_CATALOG_PREFERENCES_KEY);
    if (!text || text.length > 32_768) return EMPTY_PREFERENCES;
    return parseStickerCatalogPreferences(JSON.parse(text));
  } catch {
    return EMPTY_PREFERENCES;
  }
};

const notifyPreferenceChange = (): void => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(STICKER_CATALOG_PREFERENCES_EVENT));
};

export const writeStickerCatalogPreferences = (
  preferences: StickerCatalogPreferences,
  storage: Pick<Storage, 'setItem'> | undefined = browserStorage(),
): boolean => {
  if (!storage) return false;
  const canonical = parseStickerCatalogPreferences({
    version: 1,
    favorites: preferences.favorites,
    recent: preferences.recent,
  });
  try {
    storage.setItem(STICKER_CATALOG_PREFERENCES_KEY, JSON.stringify({
      version: 1,
      favorites: canonical.favorites,
      recent: canonical.recent,
    }));
    notifyPreferenceChange();
    return true;
  } catch {
    return false;
  }
};

/** Call only after the canonical sticker command commits successfully. */
export const recordRecentlyUsedSticker = (
  stickerId: BuiltInStickerId,
  storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = browserStorage(),
): StickerCatalogPreferences => {
  const current = readStickerCatalogPreferences(storage);
  const next = Object.freeze({
    favorites: current.favorites,
    recent: Object.freeze([
      stickerId,
      ...current.recent.filter((id) => id !== stickerId),
    ].slice(0, MAX_RECENT_STICKERS)),
  });
  writeStickerCatalogPreferences(next, storage);
  return next;
};

export const setFavoriteSticker = (
  stickerId: BuiltInStickerId,
  favorite: boolean,
  storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = browserStorage(),
): StickerCatalogPreferences => {
  const current = readStickerCatalogPreferences(storage);
  const favorites = favorite
    ? [stickerId, ...current.favorites.filter((id) => id !== stickerId)]
    : current.favorites.filter((id) => id !== stickerId);
  const next = Object.freeze({
    favorites: Object.freeze(favorites.slice(0, MAX_FAVORITE_STICKERS)),
    recent: current.recent,
  });
  writeStickerCatalogPreferences(next, storage);
  return next;
};
