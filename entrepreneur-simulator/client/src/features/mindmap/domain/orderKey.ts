import type { OrderKey } from './types';

const ORDER_KEY_PREFIX = 'K';
const ORDER_KEY_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const ORDER_KEY_WIDTH = 32;
const BASE = BigInt(ORDER_KEY_ALPHABET.length);
const MAX_VALUE = BASE ** BigInt(ORDER_KEY_WIDTH) - 1n;

export class InvalidOrderKeyError extends Error {
  constructor(key: string) {
    super(`Invalid NMDD order key: ${key}`);
    this.name = 'InvalidOrderKeyError';
  }
}

export class OrderKeySpaceExhaustedError extends Error {
  constructor() {
    super('No order key exists between the requested neighbors; rebalance is required.');
    this.name = 'OrderKeySpaceExhaustedError';
  }
}

const encode = (value: bigint): OrderKey => {
  if (value < 0n || value > MAX_VALUE) {
    throw new InvalidOrderKeyError(value.toString());
  }

  let remaining = value;
  let encoded = '';
  for (let index = 0; index < ORDER_KEY_WIDTH; index += 1) {
    const digit = Number(remaining % BASE);
    encoded = ORDER_KEY_ALPHABET[digit] + encoded;
    remaining /= BASE;
  }
  return `${ORDER_KEY_PREFIX}${encoded}`;
};

const decode = (key: OrderKey): bigint => {
  if (
    key.length !== ORDER_KEY_WIDTH + ORDER_KEY_PREFIX.length
    || !key.startsWith(ORDER_KEY_PREFIX)
  ) {
    throw new InvalidOrderKeyError(key);
  }

  let value = 0n;
  for (const character of key.slice(ORDER_KEY_PREFIX.length)) {
    const digit = ORDER_KEY_ALPHABET.indexOf(character);
    if (digit < 0) throw new InvalidOrderKeyError(key);
    value = value * BASE + BigInt(digit);
  }
  return value;
};

export const isGeneratedOrderKey = (key: string): key is OrderKey => {
  try {
    decode(key as OrderKey);
    return true;
  } catch {
    return false;
  }
};

export const createOrderKeyBetween = (
  before?: OrderKey | null,
  after?: OrderKey | null,
): OrderKey => {
  const lower = before == null ? 0n : decode(before);
  const upper = after == null ? MAX_VALUE : decode(after);

  if (lower >= upper || upper - lower <= 1n) {
    throw new OrderKeySpaceExhaustedError();
  }

  return encode(lower + (upper - lower) / 2n);
};

export const rebalanceOrderKeys = <Id extends string>(
  orderedIds: readonly Id[],
): Record<Id, OrderKey> => {
  const result = {} as Record<Id, OrderKey>;
  if (orderedIds.length === 0) return result;

  const step = MAX_VALUE / BigInt(orderedIds.length + 1);
  if (step <= 0n) throw new OrderKeySpaceExhaustedError();

  orderedIds.forEach((id, index) => {
    result[id] = encode(step * BigInt(index + 1));
  });
  return result;
};

export const compareOrderKeys = (left: OrderKey, right: OrderKey): number => {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
};

export const compareOrderedEntities = (
  left: { orderKey: OrderKey; id: string },
  right: { orderKey: OrderKey; id: string },
): number => {
  const order = compareOrderKeys(left.orderKey, right.orderKey);
  if (order !== 0) return order;
  if (left.id < right.id) return -1;
  if (left.id > right.id) return 1;
  return 0;
};

