import { describe, expect, it } from 'vitest';
import { takeGraphemes, truncateGraphemes } from './graphemes';
import { normalizeClipboardText } from '../clipboard/htmlUtils';

describe('grapheme-safe document text', () => {
  it('keeps joined emoji and script joiners intact during clipboard normalization', () => {
    expect(normalizeClipboardText('👩‍🔬')).toBe('👩‍🔬');
    expect(normalizeClipboardText('می‌روم')).toBe('می‌روم');
    expect(normalizeClipboardText('עברית\u200f (42)')).toBe('עברית\u200f (42)');
  });

  it('never splits surrogate pairs or ZWJ emoji', () => {
    expect(takeGraphemes('👩‍🔬研究员', 1)).toBe('👩‍🔬');
    expect(truncateGraphemes('👩‍🔬科研记录', 3)).toBe('👩‍🔬科研…');
  });
});
