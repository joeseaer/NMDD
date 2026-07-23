import type { Id } from './types';

export interface UuidV7Source {
  now?: () => number;
  randomBytes?: (length: number) => Uint8Array;
}

const defaultRandomBytes = (length: number): Uint8Array => {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
};

const byteToHex = (value: number): string => value.toString(16).padStart(2, '0');

export const createUuidV7 = (source: UuidV7Source = {}): string => {
  const timestamp = Math.trunc((source.now ?? Date.now)());
  if (!Number.isSafeInteger(timestamp) || timestamp < 0 || timestamp > 0xffffffffffff) {
    throw new RangeError('UUIDv7 timestamp must fit in an unsigned 48-bit millisecond field.');
  }

  const entropy = (source.randomBytes ?? defaultRandomBytes)(16);
  if (!(entropy instanceof Uint8Array) || entropy.length !== 16) {
    throw new TypeError('UUIDv7 randomBytes must return exactly 16 bytes.');
  }
  const bytes = new Uint8Array(entropy);

  let remaining = timestamp;
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = remaining & 0xff;
    remaining = Math.floor(remaining / 256);
  }
  bytes[6] = 0x70 | (bytes[6] & 0x0f);
  bytes[8] = 0x80 | (bytes[8] & 0x3f);

  const hex = Array.from(bytes, byteToHex).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

export const createEntityId = <Kind extends string>(
  source?: UuidV7Source,
): Id<Kind> => createUuidV7(source) as Id<Kind>;
