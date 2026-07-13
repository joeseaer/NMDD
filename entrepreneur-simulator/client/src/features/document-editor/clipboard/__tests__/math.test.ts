// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  decodeEquationValue,
  isLikelyStandaloneMath,
  normalizeMathElements,
  protectMathInMarkdown,
  restoreProtectedMathHtml,
} from '../math';
import { parseHtmlDocument } from '../htmlUtils';

describe('clipboard math normalization', () => {
  it('protects explicit math while leaving fenced and inline code untouched', () => {
    const source = 'Text \\(x^2\\) `\\(code\\)`\n\n```txt\n\\[not math\\]\n```';
    const protectedValue = protectMathInMarkdown(source);
    expect(protectedValue.tokens).toHaveLength(1);
    const restored = restoreProtectedMathHtml(`<p>${protectedValue.text}</p>`, protectedValue.tokens);
    expect(restored.html).toContain('data-equation="x^2"');
    expect(restored.html).toContain('`\\(code\\)`');
  });

  it('converts MathML without a TeX annotation', () => {
    const doc = parseHtmlDocument('<p><math><mfrac><mi>a</mi><mi>b</mi></mfrac></math></p>');
    expect(normalizeMathElements(doc.body)).toBe(1);
    expect(doc.body.innerHTML).toContain('data-equation="\\frac{a}{b}"');
  });

  it('requires strong evidence for un-delimited formulas', () => {
    expect(isLikelyStandaloneMath('x^2 + y^2 = z^2')).toBe(true);
    expect(isLikelyStandaloneMath('foo_bar')).toBe(false);
    expect(isLikelyStandaloneMath('a=b')).toBe(false);
    expect(isLikelyStandaloneMath('$5.00')).toBe(false);
  });

  it('does not consume malformed delimiters', () => {
    const protectedValue = protectMathInMarkdown('before \\(x^2 after');
    expect(protectedValue.tokens).toHaveLength(0);
    expect(protectedValue.text).toBe('before \\(x^2 after');
  });

  it('decodes legacy encoded attributes without changing raw percent sequences', () => {
    expect(decodeEquationValue('%5Cfrac%7Ba%7D%7Bb%7D')).toBe('\\frac{a}{b}');
    expect(decodeEquationValue('%255Cfrac%257Ba%257D%257Bb%257D')).toBe('\\frac{a}{b}');
    expect(decodeEquationValue('\\text{产率 50\\%25}')).toBe('\\text{产率 50\\%25}');
    expect(decodeEquationValue('\\text{https://example.com/a%20b}')).toBe('\\text{https://example.com/a%20b}');
  });
});
