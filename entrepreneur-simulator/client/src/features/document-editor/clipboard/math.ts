import { escapeHtmlAttribute, normalizeClipboardText, parseHtmlDocument } from './htmlUtils';

export type MathDisplay = 'inline' | 'block';

export interface ProtectedMathToken {
  token: string;
  formula: string;
  display: MathDisplay;
}

export interface ProtectedMathText {
  text: string;
  tokens: ProtectedMathToken[];
}

const EQUATION_ATTRIBUTE_NAMES = [
  'data-equation',
  'data-latex',
  'data-tex',
  'data-value',
  'alttext',
] as const;

const LATEX_COMMAND_PATTERN = /\\(?:frac|dfrac|tfrac|sqrt|sum|prod|int|oint|lim|log|ln|sin|cos|tan|alpha|beta|gamma|delta|theta|lambda|mu|pi|sigma|phi|omega|langle|rangle|left|right|begin|end|mathbf|mathrm|mathbb|text|overline|underline|vec|hat|dot|partial|nabla|infty|times|cdot|leq?|geq?|neq|approx|to|rightarrow)\b/;

const decodeRepeatedly = (value: string): string => {
  let decoded = value;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  return decoded;
};

export const decodeEquationValue = (value: unknown): string => (
  decodeRepeatedly(String(value ?? '')).trim()
);

export const stripLatexDelimiters = (value: string): string => {
  let formula = decodeEquationValue(value);
  const delimiterPairs: Array<[string, string]> = [
    ['$$', '$$'],
    ['\\[', '\\]'],
    ['\\(', '\\)'],
    ['$', '$'],
  ];

  for (const [open, close] of delimiterPairs) {
    if (
      formula.startsWith(open)
      && formula.endsWith(close)
      && formula.length >= open.length + close.length
    ) {
      formula = formula.slice(open.length, formula.length - close.length).trim();
      break;
    }
  }
  return formula;
};

const hasBalancedPairs = (value: string): boolean => {
  const pairs: Record<string, string> = { '{': '}', '[': ']', '(': ')' };
  const stack: string[] = [];
  let escaped = false;
  for (const character of value) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (character in pairs) stack.push(pairs[character]);
    else if (character === '}' || character === ']' || character === ')') {
      if (stack.pop() !== character) return false;
    }
  }
  return stack.length === 0;
};

const isCurrencyLike = (value: string): boolean => (
  /^[$€£¥]\s*\d[\d,.]*(?:\s*[A-Z]{3})?$/i.test(value.trim())
);

/**
 * Conservative detector for *un-delimited* formula text. Explicit LaTeX
 * delimiters are handled separately, so identifiers such as foo_bar, simple
 * assignments such as a=b, and prices such as $5.00 stay ordinary text.
 */
export const isLikelyStandaloneMath = (value: string): boolean => {
  const formula = stripLatexDelimiters(normalizeClipboardText(value));
  if (!formula || formula.length > 20_000 || /[<>]|(?:javascript|data):/i.test(formula)) return false;
  if (!hasBalancedPairs(formula) || isCurrencyLike(value)) return false;
  if (/^[A-Za-z][\w.]*_[A-Za-z0-9]+$/.test(formula)) return false;
  if (/^[A-Za-z_]\w*\s*=\s*[A-Za-z0-9_.]+$/.test(formula)) return false;
  if (LATEX_COMMAND_PATTERN.test(formula)) return true;
  if (/[A-Za-z]{3,}/.test(formula)) return false;

  const hasIdentifier = /[A-Za-zα-ωΑ-Ω]/.test(formula);
  const operatorCount = (formula.match(/[+\-*/=<>±×÷∑∫√≈≤≥≠]/g) || []).length;
  const structuredScript = /(?:[_^]\{[^{}]+\})/.test(formula);
  const compactScript = /[A-Za-z0-9)]\^[A-Za-z0-9(]|[A-Za-z)]_[A-Za-z0-9]/.test(formula);
  const unicodeMath = /[∑∫√∞≈≤≥≠±×÷∂∇⟨⟩]/.test(formula);

  if (unicodeMath && hasIdentifier) return true;
  if (structuredScript && hasIdentifier && (operatorCount > 0 || /\\/.test(formula))) return true;
  if (compactScript && hasIdentifier && operatorCount > 0) return true;
  return operatorCount >= 2 && hasIdentifier && /\s/.test(formula);
};

export const getImplicitMathLineIndexes = (input: string): number[] => (
  normalizeClipboardText(input)
    .split('\n')
    .map((line, index) => ({ line: line.trim(), index }))
    .filter(({ line }) => line.length > 0 && isLikelyStandaloneMath(line))
    .map(({ index }) => index)
);

const isValidExplicitFormula = (value: string, delimiter: string): boolean => {
  const formula = stripLatexDelimiters(value);
  if (!formula || formula.length > 20_000 || /[<>]/.test(formula)) return false;
  if (!hasBalancedPairs(formula)) return false;
  if (delimiter === '$' && isCurrencyLike(`$${formula}`)) return false;
  return true;
};

const findClosingDelimiter = (
  value: string,
  from: number,
  delimiter: string,
): number => {
  let cursor = from;
  while (cursor < value.length) {
    const index = value.indexOf(delimiter, cursor);
    if (index < 0) return -1;
    let slashCount = 0;
    for (let slash = index - 1; slash >= 0 && value[slash] === '\\'; slash -= 1) slashCount += 1;
    if (slashCount % 2 === 0) return index;
    cursor = index + delimiter.length;
  }
  return -1;
};

const countRun = (value: string, index: number, character: string) => {
  let end = index;
  while (value[end] === character) end += 1;
  return end - index;
};

/** Protect math before MarkdownIt consumes backslash escapes. Fenced code and
 * inline code spans remain byte-for-byte untouched. */
export const protectMathInMarkdown = (input: string): ProtectedMathText => {
  const value = normalizeClipboardText(input);
  const tokens: ProtectedMathToken[] = [];
  let output = '';
  let cursor = 0;
  let fence: { marker: '`' | '~'; length: number } | null = null;

  const pushToken = (formula: string, display: MathDisplay) => {
    const token = `NMDDMATHTOKEN${tokens.length}END`;
    tokens.push({ token, formula: stripLatexDelimiters(formula), display });
    output += token;
  };

  while (cursor < value.length) {
    const lineStart = cursor === 0 || value[cursor - 1] === '\n';
    if (lineStart) {
      const fenceMatch = value.slice(cursor).match(/^[ \t]{0,3}(`{3,}|~{3,})/);
      if (fenceMatch) {
        const marker = fenceMatch[1][0] as '`' | '~';
        const length = fenceMatch[1].length;
        if (!fence) fence = { marker, length };
        else if (fence.marker === marker && length >= fence.length) fence = null;
        const lineEnd = value.indexOf('\n', cursor);
        const end = lineEnd < 0 ? value.length : lineEnd + 1;
        output += value.slice(cursor, end);
        cursor = end;
        continue;
      }
    }

    if (fence) {
      output += value[cursor];
      cursor += 1;
      continue;
    }

    if (value[cursor] === '`') {
      const run = countRun(value, cursor, '`');
      const delimiter = '`'.repeat(run);
      const close = value.indexOf(delimiter, cursor + run);
      if (close >= 0) {
        const end = close + run;
        output += value.slice(cursor, end);
        cursor = end;
        continue;
      }
    }

    const candidates: Array<{ open: string; close: string; display: MathDisplay }> = [
      { open: '\\[', close: '\\]', display: 'block' },
      { open: '\\(', close: '\\)', display: 'inline' },
      { open: '$$', close: '$$', display: 'block' },
      { open: '$', close: '$', display: 'inline' },
    ];
    const candidate = candidates.find(item => value.startsWith(item.open, cursor));
    if (candidate) {
      const escaped = cursor > 0 && value[cursor - 1] === '\\' && candidate.open.startsWith('$');
      if (!escaped) {
        const formulaStart = cursor + candidate.open.length;
        const close = findClosingDelimiter(value, formulaStart, candidate.close);
        if (close >= 0) {
          const formula = value.slice(formulaStart, close);
          if (isValidExplicitFormula(formula, candidate.open)) {
            pushToken(formula, candidate.display);
            cursor = close + candidate.close.length;
            continue;
          }
        }
      }
    }

    output += value[cursor];
    cursor += 1;
  }

  return { text: output, tokens };
};

const createEquationElement = (
  doc: Document,
  formula: string,
  display: MathDisplay,
): HTMLElement => {
  const element = doc.createElement(display === 'block' ? 'div' : 'span');
  element.setAttribute('data-type', display === 'block' ? 'equation' : 'inline-equation');
  element.setAttribute('data-equation', stripLatexDelimiters(formula));
  element.setAttribute('data-nmdd-generated', 'math');
  return element;
};

const replaceTokenInTextNode = (
  textNode: Text,
  tokens: readonly ProtectedMathToken[],
): number => {
  const text = textNode.data;
  const matching = tokens.filter(item => text.includes(item.token));
  if (matching.length === 0) return 0;

  const parent = textNode.parentElement;
  if (
    matching.length === 1
    && matching[0].display === 'block'
    && parent?.tagName === 'P'
    && parent.textContent?.trim() === matching[0].token
  ) {
    parent.replaceWith(createEquationElement(parent.ownerDocument, matching[0].formula, 'block'));
    return 1;
  }

  const fragment = textNode.ownerDocument.createDocumentFragment();
  let remaining = text;
  let count = 0;
  while (remaining) {
    let next: ProtectedMathToken | null = null;
    let nextIndex = Number.POSITIVE_INFINITY;
    tokens.forEach(token => {
      const index = remaining.indexOf(token.token);
      if (index >= 0 && index < nextIndex) {
        next = token;
        nextIndex = index;
      }
    });
    if (!next) {
      fragment.append(remaining);
      break;
    }
    const token: ProtectedMathToken = next;
    if (nextIndex > 0) fragment.append(remaining.slice(0, nextIndex));
    const display = token.display === 'block' && textNode.parentElement?.closest('p')
      ? 'inline'
      : token.display;
    fragment.append(createEquationElement(textNode.ownerDocument, token.formula, display));
    remaining = remaining.slice(nextIndex + token.token.length);
    count += 1;
  }
  textNode.replaceWith(fragment);
  return count;
};

export const restoreProtectedMathHtml = (
  html: string,
  tokens: readonly ProtectedMathToken[],
): { html: string; count: number } => {
  if (!tokens.length) return { html, count: 0 };
  const doc = parseHtmlDocument(html);
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text);
  let count = 0;
  textNodes.forEach(node => {
    if (node.parentElement?.closest('pre, code')) return;
    count += replaceTokenInTextNode(node, tokens);
  });
  return { html: doc.body.innerHTML, count };
};

const MATH_OPERATOR_MAP: Record<string, string> = {
  '−': '-',
  '×': '\\times ',
  '÷': '\\div ',
  '≤': '\\le ',
  '≥': '\\ge ',
  '≠': '\\ne ',
  '≈': '\\approx ',
  '→': '\\to ',
  '∞': '\\infty ',
  '∑': '\\sum ',
  '∏': '\\prod ',
  '∫': '\\int ',
  '∂': '\\partial ',
  '√': '\\sqrt ',
  '·': '\\cdot ',
};

const mathMlText = (element: Element): string => {
  const tag = element.localName.toLowerCase();
  const children = Array.from(element.children);
  const child = (index: number) => children[index] ? mathMlText(children[index]) : '';
  const allChildren = () => children.map(mathMlText).join('');

  if (tag === 'annotation') return '';
  if (tag === 'semantics') {
    const semantic = children.find(item => item.localName.toLowerCase() !== 'annotation');
    return semantic ? mathMlText(semantic) : '';
  }
  if (tag === 'math' || tag === 'mrow' || tag === 'mstyle' || tag === 'mpadded') return allChildren();
  if (tag === 'mi' || tag === 'mn') return (element.textContent || '').trim();
  if (tag === 'mo') {
    const operator = (element.textContent || '').trim();
    return MATH_OPERATOR_MAP[operator] || operator;
  }
  if (tag === 'mtext') {
    const text = (element.textContent || '').trim().replace(/[{}]/g, '');
    return text ? `\\text{${text}}` : '';
  }
  if (tag === 'mfrac') return `\\frac{${child(0)}}{${child(1)}}`;
  if (tag === 'msup') return `{${child(0)}}^{${child(1)}}`;
  if (tag === 'msub') return `{${child(0)}}_{${child(1)}}`;
  if (tag === 'msubsup') return `{${child(0)}}_{${child(1)}}^{${child(2)}}`;
  if (tag === 'msqrt') return `\\sqrt{${allChildren()}}`;
  if (tag === 'mroot') return `\\sqrt[${child(1)}]{${child(0)}}`;
  if (tag === 'mover') return `\\overset{${child(1)}}{${child(0)}}`;
  if (tag === 'munder') return `\\underset{${child(1)}}{${child(0)}}`;
  if (tag === 'munderover') return `\\overset{${child(2)}}{\\underset{${child(1)}}{${child(0)}}}`;
  if (tag === 'mfenced') {
    const open = element.getAttribute('open') || '(';
    const close = element.getAttribute('close') || ')';
    const separators = element.getAttribute('separators') || ',';
    return `${open}${children.map(mathMlText).join(separators[0] || ',')}${close}`;
  }
  if (tag === 'mtable') {
    const rows = children.map(mathMlText).join(' \\\\ ');
    return `\\begin{matrix}${rows}\\end{matrix}`;
  }
  if (tag === 'mtr') return children.map(mathMlText).join(' & ');
  if (tag === 'mtd') return allChildren();
  return allChildren() || (element.textContent || '').trim();
};

export const getLatexFromMathElement = (element: Element | null): string => {
  if (!element) return '';
  const annotation = element.querySelector(
    'annotation[encoding="application/x-tex"], annotation[encoding="application/x-latex"], annotation[encoding="application/tex"]',
  );
  if (annotation?.textContent?.trim()) return stripLatexDelimiters(annotation.textContent);

  for (const attributeName of EQUATION_ATTRIBUTE_NAMES) {
    const value = element.getAttribute(attributeName);
    if (value?.trim()) return stripLatexDelimiters(value);
  }

  const script = element.matches('script[type^="math/tex"]')
    ? element
    : element.querySelector('script[type^="math/tex"]');
  if (script?.textContent?.trim()) return stripLatexDelimiters(script.textContent);

  const math = element.matches('math') ? element : element.querySelector('math');
  if (math) return stripLatexDelimiters(mathMlText(math));

  const ariaLabel = element.getAttribute('aria-label') || '';
  return isLikelyStandaloneMath(ariaLabel) ? stripLatexDelimiters(ariaLabel) : '';
};

const replaceMathRoot = (
  element: Element,
  display: MathDisplay,
): boolean => {
  const formula = getLatexFromMathElement(element);
  if (!formula) return false;

  const replacement = createEquationElement(element.ownerDocument, formula, display);
  const parent = element.parentElement;
  if (
    display === 'block'
    && parent?.tagName === 'P'
    && parent.textContent?.trim() === element.textContent?.trim()
  ) {
    parent.replaceWith(replacement);
  } else {
    element.replaceWith(replacement);
  }
  return true;
};

const replaceDelimitedTextNodes = (root: ParentNode): number => {
  const doc = root instanceof Document ? root : root.ownerDocument;
  if (!doc) return 0;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text);
  let count = 0;

  textNodes.forEach(textNode => {
    if (textNode.parentElement?.closest('pre, code, [data-type="equation"], [data-type="inline-equation"]')) return;
    const protectedText = protectMathInMarkdown(textNode.data);
    if (!protectedText.tokens.length) return;
    textNode.data = protectedText.text;
    count += replaceTokenInTextNode(textNode, protectedText.tokens);
  });
  return count;
};

/** Converts KaTeX, MathJax, MathML, math/tex scripts, and explicit LaTeX
 * delimiters to the editor's equation nodes. Returns the number of replacements. */
export const normalizeMathElements = (root: ParentNode): number => {
  const queryRoot = root as ParentNode & { querySelectorAll(selectors: string): NodeListOf<Element> };
  let count = 0;
  const displaySelectors = [
    '.katex-display',
    '.math-display',
    'mjx-container[display="true"]',
    'math[display="block"]',
    'script[type="math/tex; mode=display"]',
    '[data-math-display="block"]',
  ].join(',');
  Array.from(queryRoot.querySelectorAll(displaySelectors)).forEach(element => {
    if (!element.isConnected || element.closest('[data-type="equation"]')) return;
    if (replaceMathRoot(element, 'block')) count += 1;
  });

  const inlineSelectors = [
    '.katex',
    '.math-inline',
    'mjx-container',
    'math',
    'script[type="math/tex"]',
    '[data-latex]',
    '[data-tex]',
  ].join(',');
  Array.from(queryRoot.querySelectorAll(inlineSelectors)).forEach(element => {
    if (
      !element.isConnected
      || element.closest('[data-type="equation"], [data-type="inline-equation"]')
      || element.closest('pre, code')
    ) return;
    if (replaceMathRoot(element, 'inline')) count += 1;
  });

  count += replaceDelimitedTextNodes(root);
  return count;
};

export const equationNodeHtml = (formula: string, display: MathDisplay): string => {
  const tag = display === 'block' ? 'div' : 'span';
  const type = display === 'block' ? 'equation' : 'inline-equation';
  return `<${tag} data-type="${type}" data-equation="${escapeHtmlAttribute(stripLatexDelimiters(formula))}"></${tag}>`;
};
