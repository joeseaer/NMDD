import { MathJaxTexFont } from '@mathjax/mathjax-tex-font/js/svg.js';
import { liteAdaptor } from '@mathjax/src/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from '@mathjax/src/js/handlers/html.js';
import { MathML } from '@mathjax/src/js/input/mathml.js';
import { TeX } from '@mathjax/src/js/input/tex.js';
import '@mathjax/src/js/input/tex/ams/AmsConfiguration.js';
import '@mathjax/src/js/input/tex/newcommand/NewcommandConfiguration.js';
import '@mathjax/src/js/input/tex/noundefined/NoUndefinedConfiguration.js';
import '@mathjax/src/js/input/tex/textmacros/TextMacrosConfiguration.js';
import { mathjax } from '@mathjax/src/js/mathjax.js';
import { SVG } from '@mathjax/src/js/output/svg.js';

import {
  equationSourceWithinVectorLimit,
  sanitizeMathJaxSvgElement,
  type EquationSvgRender,
  type EquationSvgRendererInput,
} from './equationSvg';

const MATHML_ACTIVE_DECLARATION = /<[!?]/;

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);

const texInput = new TeX({
  maxBuffer: 16_384,
  maxTemplateSubtitutions: 1_000,
  packages: ['base', 'ams', 'newcommand', 'textmacros', 'noundefined'],
});
const mathmlInput = new MathML({
  forceReparse: true,
  parseAs: 'xml',
});
const svgOutputOptions = Object.freeze({
  fontCache: 'none',
  fontData: MathJaxTexFont,
  useXlink: false,
});
const texDocument = mathjax.document('', {
  InputJax: texInput,
  OutputJax: new SVG(svgOutputOptions),
});
const mathmlDocument = mathjax.document('', {
  InputJax: mathmlInput,
  OutputJax: new SVG(svgOutputOptions),
});

const fallback = (reason: Extract<EquationSvgRender, { status: 'fallback' }>['reason']) => (
  Object.freeze({ reason, status: 'fallback' as const })
);

const aborted = (): DOMException => (
  new DOMException('Mind-map equation rendering was aborted.', 'AbortError')
);

/** Heavy implementation loaded by a separate Vite chunk only when equations exist. */
export const renderMindMapEquationWithMathJax = async (
  input: Readonly<EquationSvgRendererInput>,
): Promise<EquationSvgRender> => {
  if (input.signal.aborted) throw aborted();
  const source = input.equation.source.trim();
  if (!source) return fallback('empty-source');
  if (!equationSourceWithinVectorLimit(source)) return fallback('source-limit');
  if (input.equation.syntax === 'mathml' && MATHML_ACTIVE_DECLARATION.test(source)) {
    return fallback('invalid-output');
  }
  try {
    // Reset TeX labels/macros between entities so output depends only on canonical
    // Equation fields and not on which other equations were exported first.
    if (input.equation.syntax === 'latex') texInput.reset(0);
    const document = input.equation.syntax === 'mathml' ? mathmlDocument : texDocument;
    const container = await document.convertPromise(source, {
      containerWidth: 80 * 16,
      display: input.equation.display === 'block',
      em: 16,
      ex: 8,
    });
    if (input.signal.aborted) throw aborted();
    const outputSvg = adaptor.tags(container, 'svg')[0];
    if (!outputSvg) return fallback('invalid-output');
    const serialized = adaptor.outerHTML(outputSvg);
    const parsed = new DOMParser().parseFromString(serialized, 'image/svg+xml');
    if (parsed.querySelector('parsererror') || parsed.documentElement.localName !== 'svg') {
      return fallback('invalid-output');
    }
    return sanitizeMathJaxSvgElement(parsed.documentElement as unknown as SVGSVGElement);
  } catch (error) {
    if (input.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
      throw aborted();
    }
    return fallback('render-error');
  }
};
