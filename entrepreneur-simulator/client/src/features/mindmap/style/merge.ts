import type { StyleProperties } from '../domain/types';

type JsonLikeRecord = Record<string, unknown>;

const isPlainObject = (value: unknown): value is JsonLikeRecord => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const cloneValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (!isPlainObject(value)) return value;

  const result: JsonLikeRecord = {};
  for (const key of Object.keys(value)) {
    result[key] = cloneValue(value[key]);
  }
  return result;
};

const mergeRecords = (
  base: Readonly<JsonLikeRecord>,
  next: Readonly<JsonLikeRecord>,
): JsonLikeRecord => {
  // ColorValue and future canonical unions are discriminated by `kind`.
  // Switching variants must replace the object instead of retaining fields
  // that are only legal on the previous variant.
  if (
    typeof base.kind === 'string'
    && typeof next.kind === 'string'
    && base.kind !== next.kind
  ) {
    return cloneValue(next) as JsonLikeRecord;
  }
  const result = cloneValue(base) as JsonLikeRecord;
  for (const key of Object.keys(next)) {
    const nextValue = next[key];
    if (nextValue === undefined) continue;
    const baseValue = result[key];
    result[key] = isPlainObject(baseValue) && isPlainObject(nextValue)
      ? mergeRecords(baseValue, nextValue)
      : cloneValue(nextValue);
  }
  return result;
};

/**
 * Canonical style data is JSON-shaped. Recursively merging plain objects while
 * replacing arrays preserves schema fields and forward-compatible extension
 * fields without allowing a renderer to mutate the document.
 */
export const mergeStyleProperties = (
  base: Readonly<StyleProperties>,
  next: Readonly<StyleProperties> | undefined,
): StyleProperties => {
  if (!next) return cloneValue(base) as StyleProperties;
  return mergeRecords(
    base as Readonly<JsonLikeRecord>,
    next as Readonly<JsonLikeRecord>,
  ) as StyleProperties;
};

export const cloneStyleProperties = (
  properties: Readonly<StyleProperties>,
): StyleProperties => cloneValue(properties) as StyleProperties;

export const deepFreezeStyleValue = <T>(value: T): Readonly<T> => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as JsonLikeRecord)) {
      deepFreezeStyleValue(child);
    }
    Object.freeze(value);
  }
  return value;
};
