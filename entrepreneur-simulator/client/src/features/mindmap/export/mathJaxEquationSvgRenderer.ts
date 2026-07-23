import type { EquationSvgRender, EquationSvgRenderer } from './equationSvg';

const DEFAULT_LOAD_TIMEOUT_MS = 15_000;

const fallback = (reason: 'renderer-unavailable' | 'timeout'): EquationSvgRender => (
  Object.freeze({ reason, status: 'fallback' as const })
);

const abortError = (): DOMException => (
  new DOMException('Mind-map equation rendering was aborted.', 'AbortError')
);

let runtimePromise: Promise<typeof import('./mathJaxEquationSvgRuntime')> | undefined;

const loadRuntime = (): Promise<typeof import('./mathJaxEquationSvgRuntime')> => {
  runtimePromise ??= import('./mathJaxEquationSvgRuntime');
  return runtimePromise;
};

/** Lazy local renderer: no CDN, script injection, remote fonts, or host-font glyphs. */
export const renderMindMapEquationToSvg: EquationSvgRenderer = async (input) => {
  if (input.signal.aborted) throw abortError();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutId = setTimeout(() => reject(new Error('mathjax-load-timeout')), DEFAULT_LOAD_TIMEOUT_MS);
    });
    const runtime = await Promise.race([loadRuntime(), timeout]);
    if (input.signal.aborted) throw abortError();
    return await runtime.renderMindMapEquationWithMathJax(input);
  } catch (error) {
    if (input.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
      throw abortError();
    }
    return fallback(error instanceof Error && error.message === 'mathjax-load-timeout'
      ? 'timeout'
      : 'renderer-unavailable');
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
};
