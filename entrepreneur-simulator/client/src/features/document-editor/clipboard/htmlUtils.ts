export const normalizeClipboardText = (value: string): string => (
  value
    .replace(/\r\n?/g, '\n')
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g, '')
    .replace(/\u00a0/g, ' ')
);

export const escapeHtml = (value: string): string => (
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
);

export const escapeHtmlAttribute = escapeHtml;

export const parseHtmlDocument = (html: string): Document => {
  if (typeof DOMParser === 'undefined') {
    throw new Error('Clipboard HTML normalization requires DOMParser.');
  }
  return new DOMParser().parseFromString(html, 'text/html');
};

export const unwrapElement = (element: Element): void => {
  const parent = element.parentNode;
  if (!parent) return;
  while (element.firstChild) parent.insertBefore(element.firstChild, element);
  parent.removeChild(element);
};

export const replaceTag = (element: Element, tagName: string): HTMLElement => {
  const replacement = element.ownerDocument.createElement(tagName);
  Array.from(element.attributes).forEach(attribute => {
    replacement.setAttribute(attribute.name, attribute.value);
  });
  while (element.firstChild) replacement.appendChild(element.firstChild);
  element.replaceWith(replacement);
  return replacement;
};

export const visibleTextWithLineBreaks = (root: ParentNode): string => {
  const blockTags = new Set([
    'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DIV', 'DL', 'FIELDSET',
    'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4',
    'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE',
    'SECTION', 'TABLE', 'TR', 'UL',
  ]);
  let output = '';

  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      output += node.textContent || '';
      return;
    }
    if (!(node instanceof Element)) return;
    if (node.tagName === 'BR') {
      output += '\n';
      return;
    }
    const isBlock = blockTags.has(node.tagName);
    if (isBlock && output && !output.endsWith('\n')) output += '\n';
    Array.from(node.childNodes).forEach(visit);
    if (isBlock && !output.endsWith('\n')) output += '\n';
  };

  Array.from(root.childNodes).forEach(visit);
  return normalizeClipboardText(output).replace(/\n{3,}/g, '\n\n').trimEnd();
};
