import { replaceTag, unwrapElement } from '../htmlUtils';

const BLOCK_SELECTOR = [
  'address', 'article', 'aside', 'blockquote', 'details', 'div', 'dl', 'figure',
  'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr',
  'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'ul',
].join(',');

const wrapContents = (element: Element, tagName: string): void => {
  const wrapper = element.ownerDocument.createElement(tagName);
  while (element.firstChild) wrapper.appendChild(element.firstChild);
  element.appendChild(wrapper);
};

const hasFontWeight = (style: string) => {
  const match = style.match(/font-weight\s*:\s*([^;]+)/i)?.[1]?.trim().toLowerCase();
  if (!match || match === 'normal' || match === '400') return false;
  return match === 'bold' || match === 'bolder' || Number.parseInt(match, 10) >= 600;
};

const isHidden = (element: Element) => {
  const style = element.getAttribute('style') || '';
  return /(?:display\s*:\s*none|visibility\s*:\s*hidden|mso-hide\s*:\s*all)/i.test(style)
    || element.getAttribute('aria-hidden') === 'true'
    || element.hasAttribute('hidden');
};

const normalizeStyledElement = (element: Element): void => {
  if (isHidden(element)) {
    element.remove();
    return;
  }
  const style = element.getAttribute('style') || '';
  const tag = element.tagName.toLowerCase();
  if ((tag === 'b' || tag === 'strong') && /font-weight\s*:\s*(?:normal|400)/i.test(style)) {
    unwrapElement(element);
    return;
  }
  if (hasFontWeight(style) && !element.matches('strong, b')) wrapContents(element, 'strong');
  if (/font-style\s*:\s*italic/i.test(style) && !element.matches('em, i')) wrapContents(element, 'em');
  if (/text-decoration(?:-line)?\s*:[^;]*underline/i.test(style) && !element.matches('u')) wrapContents(element, 'u');
  if (/text-decoration(?:-line)?\s*:[^;]*line-through/i.test(style) && !element.matches('s, strike, del')) wrapContents(element, 's');
};

const normalizeRoleSemantics = (root: ParentNode): void => {
  Array.from(root.querySelectorAll('[role="heading"]')).forEach(element => {
    const level = Math.max(1, Math.min(6, Number(element.getAttribute('aria-level') || 2)));
    replaceTag(element, `h${level}`);
  });
  Array.from(root.querySelectorAll('[role="list"]')).forEach(element => replaceTag(element, 'ul'));
  Array.from(root.querySelectorAll('[role="listitem"]')).forEach(element => replaceTag(element, 'li'));
};

const normalizeEquivalentTags = (root: ParentNode): void => {
  Array.from(root.querySelectorAll('b')).forEach(element => replaceTag(element, 'strong'));
  Array.from(root.querySelectorAll('i')).forEach(element => replaceTag(element, 'em'));
  Array.from(root.querySelectorAll('strike')).forEach(element => replaceTag(element, 's'));
};

const normalizeLeafDivs = (root: ParentNode): void => {
  const divs = Array.from(root.querySelectorAll('div')).reverse();
  divs.forEach(div => {
    if (div.hasAttribute('data-type') || div.closest('pre, code, table')) return;
    if (div.querySelector(`:scope > ${BLOCK_SELECTOR.replace(/, /g, ', :scope > ')}`)) return;
    replaceTag(div, 'p');
  });
};

const removeEmptyFormattingElements = (root: ParentNode): void => {
  Array.from(root.querySelectorAll('span, font')).reverse().forEach(element => {
    if (element.attributes.length === 0) unwrapElement(element);
  });
};

export const normalizeGenericHtml = (root: ParentNode): void => {
  normalizeRoleSemantics(root);
  Array.from(root.querySelectorAll('*')).forEach(normalizeStyledElement);
  normalizeEquivalentTags(root);
  Array.from(root.querySelectorAll('font')).forEach(unwrapElement);
  normalizeLeafDivs(root);
  removeEmptyFormattingElements(root);
};
