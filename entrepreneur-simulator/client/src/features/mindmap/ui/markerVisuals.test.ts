import { describe, expect, it } from 'vitest';

import { markerVisualForSource } from './markerVisuals';

const BUILTIN_KEYS = [
  'priority-1',
  'priority-2',
  'priority-3',
  'priority-4',
  'priority-5',
  'progress-0',
  'progress-25',
  'progress-50',
  'progress-75',
  'progress-100',
  'flag-red',
  'flag-yellow',
  'flag-green',
  'flag-blue',
  'star-filled',
  'star-outline',
  'arrow-up',
  'arrow-right',
  'arrow-down',
  'arrow-left',
] as const;

describe('deterministic Marker visuals', () => {
  it('defines path-only geometry for every standard marker key', () => {
    const visuals = BUILTIN_KEYS.map((key) => markerVisualForSource('builtin', key));
    expect(visuals.map(({ key }) => key)).toEqual(BUILTIN_KEYS);
    for (const visual of visuals) {
      expect(visual.viewBox).toBe('0 0 24 24');
      expect(visual.paths.length).toBeGreaterThan(0);
      expect(visual.paths.every(({ d, fill }) => d.length > 0 && fill.length > 0)).toBe(true);
      expect(JSON.stringify(visual)).not.toMatch(/[◆⚑★☆↑↓←→]/u);
    }
  });

  it('uses deterministic vector fallbacks for custom, unknown, and asset markers', () => {
    expect(markerVisualForSource('builtin', 'custom-circle').key).toBe('custom-circle');
    expect(markerVisualForSource('builtin', 'unknown-shape').key).toBe('unknown-shape');
    expect(markerVisualForSource('asset', undefined).key).toBe('asset-marker');
  });
});
