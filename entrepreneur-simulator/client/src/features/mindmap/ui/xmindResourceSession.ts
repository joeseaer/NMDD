import type { Asset, AssetMap } from '../domain/types';

export type XMindSessionResourceBytes = Readonly<Record<string, Uint8Array>>;

export interface XMindObjectUrlApi {
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
}

const RENDERABLE_XMIND_IMAGE_MIME_TYPES = new Set([
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const defaultObjectUrlApi = (): XMindObjectUrlApi | undefined => {
  const candidate = globalThis.URL;
  return typeof candidate?.createObjectURL === 'function'
    && typeof candidate.revokeObjectURL === 'function'
    ? candidate
    : undefined;
};

/**
 * Owns validated XMind package bytes for one mounted NodeView. Bytes stay out
 * of canonical JSON; Blob URLs exist only while this session owns them.
 */
export class XMindResourceSession {
  readonly resolveEmbeddedImageUrl = (asset: Readonly<Asset>): string | undefined => {
    if (asset.source.kind !== 'embedded') return undefined;
    const mimeType = typeof asset.mimeType === 'string'
      ? asset.mimeType.toLocaleLowerCase('en-US')
      : '';
    const resolved = this.#resolvedAssets.get(String(asset.id));
    return resolved
      && resolved.relativePath === asset.source.relativePath
      && resolved.mimeType === mimeType
      ? resolved.url
      : undefined;
  };

  #resourceBytes: XMindSessionResourceBytes = Object.freeze({});
  #objectUrls = new Map<string, string>();
  #resolvedAssets = new Map<string, {
    readonly mimeType: string;
    readonly relativePath: string;
    readonly url: string;
  }>();
  readonly #objectUrlApi: XMindObjectUrlApi | undefined;

  constructor(objectUrlApi: XMindObjectUrlApi | undefined = defaultObjectUrlApi()) {
    this.#objectUrlApi = objectUrlApi;
  }

  get exportResourceBytes(): XMindSessionResourceBytes | undefined {
    return Object.keys(this.#resourceBytes).length > 0 ? this.#resourceBytes : undefined;
  }

  /**
   * Replaces an applied import atomically and creates previews at the event
   * boundary, keeping React projection and render paths side-effect free.
   */
  replace(
    resourceBytes: XMindSessionResourceBytes | undefined,
    assets: Readonly<AssetMap> = {},
  ): boolean {
    let nextResourceBytes: XMindSessionResourceBytes;
    const nextObjectUrls = new Map<string, string>();
    const nextResolvedAssets = new Map<string, {
      readonly mimeType: string;
      readonly relativePath: string;
      readonly url: string;
    }>();
    try {
      nextResourceBytes = resourceBytes
        ? Object.freeze(Object.fromEntries(
          Object.entries(resourceBytes).map(([path, bytes]) => [path, Uint8Array.from(bytes)]),
        ))
        : Object.freeze({});

      if (this.#objectUrlApi) {
        for (const asset of Object.values(assets)) {
          if (asset.source.kind !== 'embedded') continue;
          const mimeType = typeof asset.mimeType === 'string'
            ? asset.mimeType.toLocaleLowerCase('en-US')
            : '';
          if (!RENDERABLE_XMIND_IMAGE_MIME_TYPES.has(mimeType)) continue;
          const bytes = nextResourceBytes[asset.source.relativePath];
          if (!bytes || bytes.byteLength === 0) continue;
          const cacheKey = `${asset.source.relativePath}\u0000${mimeType}`;
          let url = nextObjectUrls.get(cacheKey);
          if (!url) {
            // Copy into an ordinary ArrayBuffer so the Blob does not retain a Worker
            // transfer buffer and callers cannot mutate the rendered payload in place.
            const payload = Uint8Array.from(bytes).buffer;
            url = this.#objectUrlApi.createObjectURL(new Blob([payload], { type: mimeType }));
            nextObjectUrls.set(cacheKey, url);
          }
          nextResolvedAssets.set(String(asset.id), {
            mimeType,
            relativePath: asset.source.relativePath,
            url,
          });
        }
      }
    } catch {
      this.#revokeUrls(nextObjectUrls);
      return false;
    }

    const previousObjectUrls = this.#objectUrls;
    this.#resourceBytes = nextResourceBytes;
    this.#objectUrls = nextObjectUrls;
    this.#resolvedAssets = nextResolvedAssets;
    this.#revokeUrls(previousObjectUrls);
    return true;
  }

  /** Clears an external replacement without affecting canonical command history. */
  clear(): void {
    this.#revokeObjectUrls();
    this.#resourceBytes = Object.freeze({});
  }

  dispose(): void {
    this.clear();
  }

  #revokeObjectUrls(): void {
    this.#revokeUrls(this.#objectUrls);
    this.#objectUrls.clear();
    this.#resolvedAssets.clear();
  }

  #revokeUrls(urls: ReadonlyMap<string, string>): void {
    if (!this.#objectUrlApi) return;
    for (const url of urls.values()) {
      try {
        this.#objectUrlApi.revokeObjectURL(url);
      } catch {
        // Revocation is best-effort and must never break canonical UI state.
      }
    }
  }
}
