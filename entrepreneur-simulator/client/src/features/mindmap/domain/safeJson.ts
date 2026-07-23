export interface MindMapJsonLimits {
  maxBytes: number;
  maxDepth: number;
  maxObjectKeys: number;
  maxArrayItems: number;
  maxValues: number;
}

export const DEFAULT_MIND_MAP_JSON_LIMITS: Readonly<MindMapJsonLimits> = Object.freeze({
  maxBytes: 8 * 1024 * 1024,
  maxDepth: 128,
  maxObjectKeys: 200_000,
  maxArrayItems: 200_000,
  maxValues: 500_000,
});

export type MindMapJsonErrorCode =
  | 'json.empty'
  | 'json.invalid'
  | 'json.too-large'
  | 'json.too-deep'
  | 'json.too-many-keys'
  | 'json.too-many-array-items'
  | 'json.too-many-values'
  | 'json.non-serializable';

export class MindMapJsonError extends Error {
  readonly code: MindMapJsonErrorCode;
  readonly originalError?: unknown;

  constructor(code: MindMapJsonErrorCode, message: string, originalError?: unknown) {
    super(message);
    this.name = 'MindMapJsonError';
    this.code = code;
    this.originalError = originalError;
  }
}

export interface ConstrainedJsonResult {
  value: unknown;
  sourceText: string;
  byteLength: number;
  objectKeyCount: number;
  arrayItemCount: number;
  valueCount: number;
  maxDepth: number;
}

const byteLength = (value: string): number => new TextEncoder().encode(value).byteLength;

const assertSerializableInput = (raw: unknown): void => {
  const pending: unknown[] = [raw];
  const visited = new WeakSet<object>();

  while (pending.length > 0) {
    const value = pending.pop();
    if (
      typeof value === 'bigint'
      || typeof value === 'function'
      || typeof value === 'symbol'
      || typeof value === 'undefined'
      || (typeof value === 'number' && !Number.isFinite(value))
    ) {
      throw new MindMapJsonError(
        'json.non-serializable',
        `Mind map JSON contains an unsupported ${typeof value} value.`,
      );
    }
    if (value === null || typeof value !== 'object') continue;
    if (visited.has(value)) continue;
    visited.add(value);

    if (!Array.isArray(value)) {
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new MindMapJsonError(
          'json.non-serializable',
          'Mind map JSON must contain only plain objects and arrays.',
        );
      }
    }

    pending.push(...Object.values(value));
  }
};

const serializeObjectInput = (raw: unknown): string => {
  assertSerializableInput(raw);
  try {
    const serialized = JSON.stringify(raw, (_key, value: unknown) => {
      if (typeof value === 'number' && !Number.isFinite(value)) {
        throw new MindMapJsonError(
          'json.non-serializable',
          'Mind map JSON contains a non-finite number.',
        );
      }
      if (
        typeof value === 'bigint'
        || typeof value === 'function'
        || typeof value === 'symbol'
        || typeof value === 'undefined'
      ) {
        throw new MindMapJsonError(
          'json.non-serializable',
          `Mind map JSON contains an unsupported ${typeof value} value.`,
        );
      }
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) {
          throw new MindMapJsonError(
            'json.non-serializable',
            'Mind map JSON must contain only plain objects and arrays.',
          );
        }
      }
      return value;
    });

    if (serialized === undefined) {
      throw new MindMapJsonError('json.empty', 'Mind map JSON is empty.');
    }
    return serialized;
  } catch (error) {
    if (error instanceof MindMapJsonError) throw error;
    throw new MindMapJsonError(
      'json.non-serializable',
      'Mind map data cannot be serialized as JSON.',
      error,
    );
  }
};

export const parseConstrainedJson = (
  raw: unknown,
  limits: Readonly<MindMapJsonLimits> = DEFAULT_MIND_MAP_JSON_LIMITS,
): ConstrainedJsonResult => {
  const sourceText = typeof raw === 'string' ? raw : serializeObjectInput(raw);
  if (sourceText.trim() === '') {
    throw new MindMapJsonError('json.empty', 'Mind map JSON is empty.');
  }

  const sourceByteLength = byteLength(sourceText);
  if (sourceByteLength > limits.maxBytes) {
    throw new MindMapJsonError(
      'json.too-large',
      `Mind map JSON exceeds the ${limits.maxBytes} byte limit.`,
    );
  }

  let value: unknown;
  try {
    value = JSON.parse(sourceText.replace(/^\uFEFF/, '')) as unknown;
  } catch (error) {
    throw new MindMapJsonError('json.invalid', 'Mind map JSON is invalid.', error);
  }

  let objectKeyCount = 0;
  let arrayItemCount = 0;
  let valueCount = 0;
  let observedMaxDepth = 0;
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 1 }];

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) break;
    valueCount += 1;
    observedMaxDepth = Math.max(observedMaxDepth, current.depth);

    if (valueCount > limits.maxValues) {
      throw new MindMapJsonError(
        'json.too-many-values',
        `Mind map JSON exceeds the ${limits.maxValues} value limit.`,
      );
    }
    if (current.depth > limits.maxDepth) {
      throw new MindMapJsonError(
        'json.too-deep',
        `Mind map JSON exceeds the ${limits.maxDepth} level depth limit.`,
      );
    }

    if (Array.isArray(current.value)) {
      arrayItemCount += current.value.length;
      if (arrayItemCount > limits.maxArrayItems) {
        throw new MindMapJsonError(
          'json.too-many-array-items',
          `Mind map JSON exceeds the ${limits.maxArrayItems} array item limit.`,
        );
      }
      for (let index = current.value.length - 1; index >= 0; index -= 1) {
        pending.push({ value: current.value[index], depth: current.depth + 1 });
      }
      continue;
    }

    if (current.value !== null && typeof current.value === 'object') {
      const entries = Object.entries(current.value as Record<string, unknown>);
      objectKeyCount += entries.length;
      if (objectKeyCount > limits.maxObjectKeys) {
        throw new MindMapJsonError(
          'json.too-many-keys',
          `Mind map JSON exceeds the ${limits.maxObjectKeys} object key limit.`,
        );
      }
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        pending.push({ value: entries[index][1], depth: current.depth + 1 });
      }
    }
  }

  return {
    value,
    sourceText,
    byteLength: sourceByteLength,
    objectKeyCount,
    arrayItemCount,
    valueCount,
    maxDepth: observedMaxDepth,
  };
};
