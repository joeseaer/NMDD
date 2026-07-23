import { describe, expect, it } from 'vitest';

import {
  equationSourceWithinVectorLimit,
  sanitizeMathJaxSvgElement,
} from './equationSvg';

const svg = (source: string): SVGSVGElement => {
  const parsed = new DOMParser().parseFromString(source, 'image/svg+xml');
  return parsed.documentElement as unknown as SVGSVGElement;
};

describe('equation SVG sanitizer', () => {
  it('keeps the path-only MathJax subset and strips inert metadata', () => {
    const result = sanitizeMathJaxSvgElement(svg(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -700 1200 900">
        <g data-mml-node="math" fill="currentColor" stroke="currentColor" stroke-width="0">
          <g data-latex="x" transform="translate(25 0)">
            <path data-c="1D465" d="M 0 0 L 100 0 L 50 -100 Z" />
          </g>
          <rect x="500" y="-20" width="400" height="12" />
        </g>
      </svg>
    `));

    expect(result.status).toBe('vector');
    if (result.status !== 'vector') throw new Error('Expected vector output.');
    expect(result.viewBox).toEqual({ x: 0, y: -700, width: 1200, height: 900 });
    expect(result.elementCount).toBe(4);
    expect(JSON.stringify(result.nodes)).not.toContain('data-mml-node');
    expect(JSON.stringify(result.nodes)).not.toContain('data-latex');
    expect(JSON.stringify(result.nodes)).toContain('currentColor');
  });

  it.each([
    '<script>alert(1)</script>',
    '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml">unsafe</div></foreignObject>',
    '<use href="https://example.com/glyph.svg#x" />',
    '<path d="M0 0L1 1" onclick="alert(1)" />',
    '<path d="M0 0L1 1" fill="url(https://example.com/a.svg#x)" />',
  ])('fails closed for active or external SVG content: %s', (child) => {
    expect(sanitizeMathJaxSvgElement(svg(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><g>${child}</g></svg>`,
    ))).toEqual({ reason: 'invalid-output', status: 'fallback' });
  });

  it('rejects missing, non-finite, and unbounded view boxes', () => {
    for (const viewBox of ['', '0 0 NaN 10', '0 0 0 10', '0 0 10000001 10']) {
      expect(sanitizeMathJaxSvgElement(svg(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"><path d="M0 0L1 1" /></svg>`,
      ))).toEqual({ reason: 'invalid-output', status: 'fallback' });
    }
  });

  it('uses Unicode code points for the source ceiling', () => {
    expect(equationSourceWithinVectorLimit('x + 😀')).toBe(true);
    expect(equationSourceWithinVectorLimit('x'.repeat(8_193))).toBe(false);
  });
});
