// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  normalizeSafeDocumentUrl,
  openSafeDocumentUrl,
} from './DocumentLinkInteractionExtension';

describe('document link URL policy', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('normalizes safe external and relative URLs', () => {
    expect(normalizeSafeDocumentUrl('https://example.com/docs')).toBe('https://example.com/docs');
    expect(normalizeSafeDocumentUrl('/research?doc=one')).toBe('http://localhost:3000/research?doc=one');
    expect(normalizeSafeDocumentUrl('mailto:hello@example.com')).toBe('mailto:hello@example.com');
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    '//evil.example/path',
  ])('rejects unsafe URL %s', value => {
    expect(normalizeSafeDocumentUrl(value)).toBeNull();
  });

  it('opens a safe URL in an isolated new tab', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);

    expect(openSafeDocumentUrl('https://example.com/docs')).toBe(true);
    expect(open).toHaveBeenCalledWith(
      'https://example.com/docs',
      '_blank',
      'noopener,noreferrer',
    );
  });

  it('never opens an unsafe URL', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);

    expect(openSafeDocumentUrl('javascript:alert(1)')).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });
});
