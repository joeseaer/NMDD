import { describe, expect, it } from 'vitest';
import {
  MindMapJsonError,
  parseConstrainedJson,
  type MindMapJsonLimits,
} from './safeJson';

const limits = (overrides: Partial<MindMapJsonLimits> = {}): MindMapJsonLimits => ({
  maxBytes: 1_000,
  maxDepth: 10,
  maxObjectKeys: 20,
  maxArrayItems: 20,
  maxValues: 40,
  ...overrides,
});

const expectCode = (run: () => unknown, code: MindMapJsonError['code']) => {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(MindMapJsonError);
    expect((error as MindMapJsonError).code).toBe(code);
    return;
  }
  throw new Error(`Expected ${code}`);
};

describe('parseConstrainedJson', () => {
  it('parses strings and snapshots object inputs without sharing references', () => {
    const source = { nodes: [{ id: 'root' }], edges: [] };
    const result = parseConstrainedJson(source, limits());

    expect(result.value).toEqual(source);
    expect(result.value).not.toBe(source);
    expect(result.objectKeyCount).toBe(3);
    expect(result.arrayItemCount).toBe(1);
    expect(result.maxDepth).toBe(4);
  });

  it('rejects invalid, oversized and deeply nested input with stable codes', () => {
    expectCode(() => parseConstrainedJson('{', limits()), 'json.invalid');
    expectCode(
      () => parseConstrainedJson(JSON.stringify({ title: 'x'.repeat(100) }), limits({ maxBytes: 20 })),
      'json.too-large',
    );
    expectCode(
      () => parseConstrainedJson({ a: { b: { c: true } } }, limits({ maxDepth: 3 })),
      'json.too-deep',
    );
  });

  it('enforces object-key, array-item and total-value limits independently', () => {
    expectCode(
      () => parseConstrainedJson({ a: 1, b: 2 }, limits({ maxObjectKeys: 1 })),
      'json.too-many-keys',
    );
    expectCode(
      () => parseConstrainedJson([1, 2], limits({ maxArrayItems: 1 })),
      'json.too-many-array-items',
    );
    expectCode(
      () => parseConstrainedJson({ a: 1, b: 2 }, limits({ maxValues: 2 })),
      'json.too-many-values',
    );
  });

  it('does not silently coerce unsupported object values', () => {
    expectCode(
      () => parseConstrainedJson({ value: Number.NaN }, limits()),
      'json.non-serializable',
    );
    expectCode(
      () => parseConstrainedJson({ value: undefined }, limits()),
      'json.non-serializable',
    );
    expectCode(
      () => parseConstrainedJson(new Date(), limits()),
      'json.non-serializable',
    );
  });
});
