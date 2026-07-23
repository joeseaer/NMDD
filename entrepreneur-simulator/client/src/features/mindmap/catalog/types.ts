import type { Size } from '../domain/types';

export type StickerCatalogKind = 'illustration' | 'sticker';

export interface StickerCatalogCategory {
  readonly id: string;
  readonly label: string;
  readonly itemCount: number;
}

export interface CatalogLicenseMetadata {
  readonly spdxId: string;
  readonly attribution: string;
  readonly noticePath: string;
  readonly sourceUrl: string;
  readonly sourcePackage: string;
  readonly sourceVersion: string;
}

/**
 * Immutable release manifest entry. Runtime code may only ingest a bundled
 * asset through one of these integrity-bound records.
 */
export interface StickerCatalogItem {
  readonly id: string;
  readonly label: string;
  readonly kind: StickerCatalogKind;
  readonly categoryId: string;
  readonly categoryPosition: number;
  readonly tags: readonly string[];
  readonly fileName: string;
  readonly mimeType: 'image/png';
  readonly publicUrl: string;
  readonly defaultDisplaySize: Size;
  readonly intrinsicSize: Size;
  readonly byteSize: number;
  readonly sha256: string;
  readonly provenance: 'licensed-lucide-isc-derived';
  readonly license: CatalogLicenseMetadata;
  /** Native XMind Sticker encoding is not yet verified against 26.04 golden files. */
  readonly xmindCompatibility: 'canonical-fallback-only';
}

export interface StickerCatalogFilter {
  readonly categoryId?: string;
  readonly kind?: StickerCatalogKind | 'all';
  readonly query?: string;
}
