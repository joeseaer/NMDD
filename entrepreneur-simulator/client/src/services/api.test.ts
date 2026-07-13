// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseApiErrorMessage } from './api';

describe('parseApiErrorMessage', () => {
  it('returns structured Chinese and emoji errors without exposing raw JSON', () => {
    expect(parseApiErrorMessage('{"error":"上传失败：文件过大 👩‍🔬"}', 'fallback'))
      .toBe('上传失败：文件过大 👩‍🔬');
  });

  it('turns an HTML error page into safe readable text', () => {
    expect(parseApiErrorMessage('<h1>502 Bad Gateway</h1><script>alert(1)</script>', 'fallback'))
      .toBe('502 Bad Gateway');
  });

  it('truncates by grapheme without splitting emoji', () => {
    expect(parseApiErrorMessage('甲乙👩‍🔬丙丁', 'fallback', 3)).toBe('甲乙👩‍🔬…');
  });
});
