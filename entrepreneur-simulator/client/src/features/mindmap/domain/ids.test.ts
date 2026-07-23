import { describe, expect, it } from 'vitest';
import { createEntityId, createUuidV7 } from './ids';

describe('UUIDv7 entity IDs', () => {
  it('encodes injected time, version and RFC variant deterministically', () => {
    const id = createUuidV7({
      now: () => 0x018f00000000,
      randomBytes: () => Uint8Array.from({ length: 16 }, (_, index) => index),
    });

    expect(id).toBe('018f0000-0000-7607-8809-0a0b0c0d0e0f');
    expect(id[14]).toBe('7');
    expect(['8', '9', 'a', 'b']).toContain(id[19]);
  });

  it('returns branded entity IDs without changing the wire format', () => {
    const id = createEntityId<'Topic'>({
      now: () => 0,
      randomBytes: () => new Uint8Array(16),
    });
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('rejects invalid time and entropy providers', () => {
    expect(() => createUuidV7({ now: () => -1 })).toThrow(RangeError);
    expect(() => createUuidV7({ randomBytes: () => new Uint8Array(15) })).toThrow(TypeError);
  });
});

