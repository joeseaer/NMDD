import '@testing-library/jest-dom/vitest';

if (!globalThis.crypto?.randomUUID) {
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: {
      ...(globalThis.crypto || {}),
      randomUUID: () => `test-${Math.random().toString(36).slice(2)}`,
    },
  });
}
