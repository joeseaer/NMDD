import { describe, expect, it } from 'vitest';
import { calculateAnchoredMenuPosition } from './anchoredMenuPosition';

describe('calculateAnchoredMenuPosition', () => {
  it('places the menu above the toolbar when space is available', () => {
    expect(calculateAnchoredMenuPosition({
      anchor: { top: 500, bottom: 544, left: 96 },
      menuWidth: 168,
      menuHeight: 224,
      viewportWidth: 1024,
      viewportHeight: 768,
    })).toEqual({ side: 'top', left: 96, top: 268 });
  });

  it('flips below when the top cannot fit and the bottom has more room', () => {
    expect(calculateAnchoredMenuPosition({
      anchor: { top: 40, bottom: 84, left: 96 },
      menuWidth: 168,
      menuHeight: 224,
      viewportWidth: 1024,
      viewportHeight: 768,
    })).toEqual({ side: 'bottom', left: 96, top: 92 });
  });

  it('keeps the menu inside the viewport on every edge', () => {
    expect(calculateAnchoredMenuPosition({
      anchor: { top: 12, bottom: 56, left: 390 },
      menuWidth: 320,
      menuHeight: 96,
      viewportWidth: 430,
      viewportHeight: 180,
    })).toEqual({ side: 'bottom', left: 102, top: 64 });
  });
});
