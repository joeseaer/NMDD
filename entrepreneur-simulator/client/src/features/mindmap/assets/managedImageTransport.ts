export const MANAGED_MIND_MAP_IMAGE_OBJECT_PREFIX = 'mindmap-images/sha256/';

const MANAGED_IMAGE_OBJECT_KEY = (
  /^mindmap-images\/sha256\/([a-f0-9]{64}\.(?:gif|jpg|png|webp))$/
);
const MANAGED_IMAGE_RESOURCE_NAME = /^[a-f0-9]{64}\.(?:gif|jpg|png|webp)$/;

const MIME_TYPE_BY_EXTENSION: Readonly<Record<string, string>> = Object.freeze({
  gif: 'image/gif',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
});

/** Accepts only the application-owned managed keyspace or its leaf name. */
export const resolveMindMapImageResourceName = (value: string): string => {
  if (MANAGED_IMAGE_RESOURCE_NAME.test(value)) return value;
  const objectKey = MANAGED_IMAGE_OBJECT_KEY.exec(value);
  if (objectKey) return objectKey[1];
  throw new Error('Invalid managed image resource name.');
};

export const managedMindMapImageMimeType = (
  resourceNameOrObjectKey: string,
): string => {
  const resourceName = resolveMindMapImageResourceName(resourceNameOrObjectKey);
  const extension = resourceName.slice(resourceName.lastIndexOf('.') + 1);
  const mimeType = MIME_TYPE_BY_EXTENSION[extension];
  if (!mimeType) throw new Error('Invalid managed image resource name.');
  return mimeType;
};

export const mindMapImageAssetUrl = (
  resourceNameOrObjectKey: string,
  apiBaseUrl = '/api',
): string => (
  `${apiBaseUrl}/mindmap/image-assets/${resolveMindMapImageResourceName(resourceNameOrObjectKey)}`
);
