import {
  BUILT_IN_STICKER_IDS,
  BUILT_IN_STICKERS,
  STICKER_CATEGORIES,
  STICKER_CATALOG_MANIFEST_FINGERPRINT,
  STICKER_CATALOG_VERSION,
  type BuiltInStickerId,
} from '../catalog/stickerManifest.generated';
import type {
  StickerCatalogFilter,
  StickerCatalogItem,
} from '../catalog/types';

export {
  BUILT_IN_STICKER_IDS,
  BUILT_IN_STICKERS,
  STICKER_CATEGORIES,
  STICKER_CATALOG_MANIFEST_FINGERPRINT,
  STICKER_CATALOG_VERSION,
};
export type { BuiltInStickerId };
export type BuiltInStickerDescriptor = StickerCatalogItem & { readonly id: BuiltInStickerId };

const stickerIds = new Set<string>(BUILT_IN_STICKER_IDS);
const stickerById = new Map<string, BuiltInStickerDescriptor>(
  BUILT_IN_STICKERS.map((sticker) => [sticker.id, sticker as BuiltInStickerDescriptor]),
);
const categoryLabelById: ReadonlyMap<string, string> = new Map(STICKER_CATEGORIES.map((category) => [
  category.id,
  category.label,
]));

const normalizeSearchText = (value: string): string => value
  .normalize('NFKC')
  .trim()
  .toLocaleLowerCase('zh-CN');

const searchTokens = (query: string): readonly string[] => normalizeSearchText(query)
  .split(/\s+/u)
  .filter(Boolean)
  .slice(0, 16);

const stickerSearchText = (sticker: StickerCatalogItem): string => normalizeSearchText([
  sticker.id,
  sticker.label,
  categoryLabelById.get(sticker.categoryId) ?? '',
  ...sticker.tags,
].join(' '));

export const isBuiltInStickerId = (value: string): value is BuiltInStickerId => stickerIds.has(value);

export const builtInStickerById = (
  id: string,
): BuiltInStickerDescriptor | undefined => stickerById.get(id);

/** Stable catalog order is preserved after filtering; search never mutates the manifest. */
export const filterBuiltInStickers = (
  filter: StickerCatalogFilter,
): readonly BuiltInStickerDescriptor[] => {
  const tokens = searchTokens(filter.query ?? '');
  return BUILT_IN_STICKERS.filter((sticker) => (
    (!filter.categoryId || sticker.categoryId === filter.categoryId)
    && (!filter.kind || filter.kind === 'all' || sticker.kind === filter.kind)
    && (tokens.length === 0 || tokens.every((token) => stickerSearchText(sticker).includes(token)))
  )) as readonly BuiltInStickerDescriptor[];
};
