import { describe, expect, it } from 'vitest';

import { createEquation } from '../domain/defaults';
import type { Equation } from '../domain/types';
import { renderMindMapEquationWithMathJax } from './mathJaxEquationSvgRuntime';

const equation = (source: string, overrides: Partial<Equation> = {}): Equation => ({
  ...createEquation({
    id: '018f0000-0000-7000-8000-000000000006' as Equation['id'],
    orderKey: 'a0' as Equation['orderKey'],
    source,
    topicId: '018f0000-0000-7000-8000-000000000001' as Equation['topicId'],
  }),
  ...overrides,
});

const render = (value: Equation) => renderMindMapEquationWithMathJax({
  equation: value,
  signal: new AbortController().signal,
});

describe('local MathJax equation SVG runtime', () => {
  it('renders common TeX and AMS constructs as direct paths', async () => {
    const result = await render(equation(String.raw`x={-b\pm\sqrt{b^2-4ac}\over 2a},\quad \int_0^1 t^2\,dt,\ \mathbb{R},\ \mathfrak{g}`));

    expect(result.status).toBe('vector');
    if (result.status !== 'vector') throw new Error(`Unexpected fallback: ${result.reason}`);
    const serialized = JSON.stringify(result.nodes);
    expect(result.renderer).toBe('mathjax-v4');
    expect(result.pathDataCharacters).toBeGreaterThan(100);
    expect(serialized).toContain('path');
    expect(serialized).not.toMatch(/(?:use|text|href|style|script|foreignObject)/i);
  }, 15_000);

  it('renders canonical MathML through the same path-only boundary', async () => {
    const result = await render(equation(
      '<math><mfrac><mi>a</mi><mi>b</mi></mfrac></math>',
      { syntax: 'mathml' },
    ));

    expect(result.status).toBe('vector');
    if (result.status !== 'vector') throw new Error(`Unexpected fallback: ${result.reason}`);
    expect(result.viewBox.width).toBeGreaterThan(0);
  }, 15_000);

  it('visibly falls back for unsupported host-font text and active MathML declarations', async () => {
    expect(await render(equation(String.raw`\text{中文}`))).toMatchObject({ status: 'fallback' });
    expect(await render(equation(
      '<!DOCTYPE math [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><math><mi>&xxe;</mi></math>',
      { syntax: 'mathml' },
    ))).toEqual({ reason: 'invalid-output', status: 'fallback' });
  }, 15_000);

  it('propagates cancellation instead of silently downgrading it', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(renderMindMapEquationWithMathJax({
      equation: equation('x'),
      signal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError' });
  });
});
