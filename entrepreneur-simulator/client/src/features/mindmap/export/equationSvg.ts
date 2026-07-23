import type { DOMOutputSpec } from '@tiptap/pm/model';

import type { Equation } from '../domain/types';

export const MIND_MAP_EQUATION_SVG_LIMITS = Object.freeze({
  maxElements: 2_500,
  maxPathDataCharacters: 1_000_000,
  maxSourceCodePoints: 8_192,
  maxViewBoxDimension: 10_000_000,
});

export type EquationSvgFallbackReason =
  | 'empty-source'
  | 'invalid-output'
  | 'output-budget'
  | 'render-error'
  | 'renderer-unavailable'
  | 'source-limit'
  | 'timeout';

export interface EquationSvgVectorRender {
  readonly elementCount: number;
  readonly nodes: readonly DOMOutputSpec[];
  readonly pathDataCharacters: number;
  readonly renderer: 'mathjax-v4';
  readonly status: 'vector';
  readonly viewBox: Readonly<{
    readonly height: number;
    readonly width: number;
    readonly x: number;
    readonly y: number;
  }>;
}

export interface EquationSvgFallbackRender {
  readonly reason: EquationSvgFallbackReason;
  readonly status: 'fallback';
}

export type EquationSvgRender = EquationSvgVectorRender | EquationSvgFallbackRender;

export interface EquationSvgRendererInput {
  readonly equation: Readonly<Equation>;
  readonly signal: AbortSignal;
}

export type EquationSvgRenderer = (
  input: Readonly<EquationSvgRendererInput>,
) => Promise<EquationSvgRender>;

interface MutableSanitizerBudget {
  elements: number;
  pathDataCharacters: number;
}

const PATH_DATA_PATTERN = /^[0-9a-zA-Z+.,\-\s]*$/;
const TRANSFORM_PATTERN = /^(?:\s*(?:matrix|translate|scale|rotate|skewX|skewY)\(\s*[0-9eE+.,\-\s]+\)\s*)+$/;
const SAFE_PAINT_VALUES = new Set(['currentColor', 'none']);

const finiteNumber = (value: string): number | undefined => {
  if (!/^[+\-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+\-]?\d+)?$/i.test(value.trim())) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const normalizedNumber = (value: string): string | undefined => {
  const parsed = finiteNumber(value);
  if (parsed === undefined || Math.abs(parsed) > MIND_MAP_EQUATION_SVG_LIMITS.maxViewBoxDimension) {
    return undefined;
  }
  return Object.is(parsed, -0) ? '0' : String(parsed);
};

const safeTransform = (value: string): string | undefined => {
  const normalized = value.trim();
  if (!normalized || normalized.length > 4_096 || !TRANSFORM_PATTERN.test(normalized)) {
    return undefined;
  }
  return normalized;
};

const safePaint = (value: string): string | undefined => {
  const normalized = value.trim();
  if (SAFE_PAINT_VALUES.has(normalized)) return normalized;
  if (/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(normalized)) return normalized.toLowerCase();
  return undefined;
};

const commonAttributes = (element: Element): Record<string, string> | undefined => {
  const attributes: Record<string, string> = {};
  for (const attribute of Array.from(element.attributes)) {
    const name = attribute.name.toLowerCase();
    if (
      name.startsWith('on')
      || name === 'href'
      || name === 'xlink:href'
      || name === 'clip-path'
      || name === 'filter'
      || name === 'mask'
    ) {
      return undefined;
    }
    if (name === 'transform') {
      const transform = safeTransform(attribute.value);
      if (!transform) return undefined;
      attributes.transform = transform;
    } else if (name === 'fill' || name === 'stroke') {
      const paint = safePaint(attribute.value);
      if (!paint) return undefined;
      attributes[name] = paint;
    } else if (name === 'stroke-width' || name === 'opacity') {
      const number = normalizedNumber(attribute.value);
      if (number === undefined) return undefined;
      attributes[name] = number;
    }
  }
  return attributes;
};

const numericAttributes = (
  element: Element,
  names: readonly string[],
  target: Record<string, string>,
): boolean => {
  for (const name of names) {
    const value = element.getAttribute(name);
    if (value === null) continue;
    const number = normalizedNumber(value);
    if (number === undefined) return false;
    target[name] = number;
  }
  return true;
};

const sanitizeElement = (
  element: Element,
  budget: MutableSanitizerBudget,
): DOMOutputSpec | undefined => {
  const tagName = element.localName.toLowerCase();
  if (tagName !== 'g' && tagName !== 'path' && tagName !== 'rect') return undefined;
  budget.elements += 1;
  if (budget.elements > MIND_MAP_EQUATION_SVG_LIMITS.maxElements) return undefined;
  const attributes = commonAttributes(element);
  if (!attributes) return undefined;

  if (tagName === 'path') {
    const pathData = element.getAttribute('d')?.trim() ?? '';
    if (!pathData || !PATH_DATA_PATTERN.test(pathData)) return undefined;
    budget.pathDataCharacters += pathData.length;
    if (budget.pathDataCharacters > MIND_MAP_EQUATION_SVG_LIMITS.maxPathDataCharacters) {
      return undefined;
    }
    attributes.d = pathData;
  } else if (tagName === 'rect') {
    if (!numericAttributes(element, ['height', 'rx', 'ry', 'width', 'x', 'y'], attributes)) {
      return undefined;
    }
    const width = finiteNumber(attributes.width ?? '');
    const height = finiteNumber(attributes.height ?? '');
    if (width === undefined || height === undefined || width < 0 || height < 0) return undefined;
  }

  const children: DOMOutputSpec[] = [];
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      if (child.textContent?.trim()) return undefined;
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) return undefined;
    if (tagName !== 'g') return undefined;
    const sanitized = sanitizeElement(child as Element, budget);
    if (!sanitized) return undefined;
    children.push(sanitized);
  }
  if (tagName === 'g' && children.length === 0) return undefined;
  return [tagName, attributes, ...children] as DOMOutputSpec;
};

const parseViewBox = (
  value: string | null,
): EquationSvgVectorRender['viewBox'] | undefined => {
  if (!value) return undefined;
  const parts = value.trim().split(/[\s,]+/);
  if (parts.length !== 4) return undefined;
  const [x, y, width, height] = parts.map((part) => finiteNumber(part));
  if (
    x === undefined
    || y === undefined
    || width === undefined
    || height === undefined
    || width <= 0
    || height <= 0
    || Math.abs(x) > MIND_MAP_EQUATION_SVG_LIMITS.maxViewBoxDimension
    || Math.abs(y) > MIND_MAP_EQUATION_SVG_LIMITS.maxViewBoxDimension
    || width > MIND_MAP_EQUATION_SVG_LIMITS.maxViewBoxDimension
    || height > MIND_MAP_EQUATION_SVG_LIMITS.maxViewBoxDimension
  ) {
    return undefined;
  }
  return Object.freeze({ x, y, width, height });
};

/**
 * Converts MathJax output into a deliberately tiny, URL-free SVG subset.
 * MathJax must run with `fontCache: 'none'`; `<use>`, CSS, links, filters,
 * event handlers and all other active/external constructs fail closed.
 */
export const sanitizeMathJaxSvgElement = (svg: SVGSVGElement): EquationSvgRender => {
  const viewBox = parseViewBox(svg.getAttribute('viewBox'));
  if (!viewBox) return Object.freeze({ reason: 'invalid-output', status: 'fallback' });
  const budget: MutableSanitizerBudget = { elements: 0, pathDataCharacters: 0 };
  const nodes: DOMOutputSpec[] = [];
  for (const child of Array.from(svg.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      if (child.textContent?.trim()) {
        return Object.freeze({ reason: 'invalid-output', status: 'fallback' });
      }
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) {
      return Object.freeze({ reason: 'invalid-output', status: 'fallback' });
    }
    const sanitized = sanitizeElement(child as Element, budget);
    if (!sanitized) return Object.freeze({ reason: 'invalid-output', status: 'fallback' });
    nodes.push(sanitized);
  }
  if (nodes.length === 0 || budget.pathDataCharacters === 0) {
    return Object.freeze({ reason: 'invalid-output', status: 'fallback' });
  }
  return Object.freeze({
    elementCount: budget.elements,
    nodes: Object.freeze(nodes),
    pathDataCharacters: budget.pathDataCharacters,
    renderer: 'mathjax-v4' as const,
    status: 'vector' as const,
    viewBox,
  });
};

export const equationSourceWithinVectorLimit = (source: string): boolean => (
  Array.from(source).length <= MIND_MAP_EQUATION_SVG_LIMITS.maxSourceCodePoints
);
