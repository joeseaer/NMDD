import DOMPurify from 'dompurify';
import { parseHtmlDocument, unwrapElement } from './htmlUtils';
import { isSafeImageUrl, isSafeLinkUrl } from './urlPolicy';
import type { SanitizedClipboardHtml } from './types';

export const RUNTIME_HTML_ATTRIBUTES = new Set([
  'data-block-id',
  'data-comments',
  'data-sync-id',
  'data-instance-id',
  'data-upload-id',
  'data-upload-status',
  'data-upload-error',
  'data-selected',
  'data-node-view-content',
  'data-node-view-wrapper',
]);

const ALLOWED_TAGS = [
  'p', 'br', 'div', 'span',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'pre', 'code',
  'ul', 'ol', 'li',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  'a', 'img', 'figure', 'figcaption', 'hr',
  'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'mark', 'sub', 'sup',
  'details', 'summary',
];

const BASE_ATTRIBUTES = [
  'href', 'src', 'alt', 'title', 'target', 'rel',
  'colspan', 'rowspan', 'scope',
  'start', 'reversed',
  'checked', 'disabled', 'type',
  'width', 'height',
  'class',
  'data-type', 'data-equation', 'data-checked', 'data-nmdd-generated',
];

const INTERNAL_STRUCTURE_ATTRIBUTES = [
  'data-title', 'data-icon', 'data-tone', 'data-url', 'data-description',
  'data-name', 'data-mime', 'data-size', 'data-kind', 'data-label',
  'data-template-title', 'data-template-body', 'data-template-content',
  'data-page-id', 'data-category', 'data-width', 'data-align', 'data-caption',
  'data-fit', 'data-aspect-ratio', 'data-shape', 'data-link', 'data-mindmap',
  'data-database', 'data-synced-content', 'open',
];

export interface SanitizeClipboardHtmlOptions {
  allowInternalStructures?: boolean;
}

const stripRuntimeAttributes = (root: ParentNode): void => {
  Array.from(root.querySelectorAll('*')).forEach(element => {
    Array.from(element.attributes).forEach(attribute => {
      if (RUNTIME_HTML_ATTRIBUTES.has(attribute.name.toLowerCase())) element.removeAttribute(attribute.name);
    });
    const id = element.getAttribute('id');
    if (id && /^(?:block|node|upload|comment)[-_]/i.test(id)) element.removeAttribute('id');
  });
};

const restrictClasses = (root: ParentNode): void => {
  Array.from(root.querySelectorAll('[class]')).forEach(element => {
    const allowed = Array.from(element.classList).filter(className => (
      element.tagName === 'CODE' && /^language-[A-Za-z0-9_+-]+$/.test(className)
    ));
    if (allowed.length) element.setAttribute('class', allowed.join(' '));
    else element.removeAttribute('class');
  });
};

const sanitizeUrlsAndImages = (root: ParentNode): Pick<SanitizedClipboardHtml, 'droppedImageCount' | 'removedUnsafeUrlCount'> => {
  let droppedImageCount = 0;
  let removedUnsafeUrlCount = 0;

  Array.from(root.querySelectorAll('a')).forEach(anchor => {
    const href = anchor.getAttribute('href') || '';
    if (!isSafeLinkUrl(href)) {
      removedUnsafeUrlCount += href ? 1 : 0;
      unwrapElement(anchor);
      return;
    }
    anchor.setAttribute('rel', 'noopener noreferrer');
    if (/^https?:/i.test(href)) anchor.setAttribute('target', '_blank');
    else anchor.removeAttribute('target');
  });

  Array.from(root.querySelectorAll('img')).forEach(image => {
    const src = image.getAttribute('src') || '';
    if (isSafeImageUrl(src)) return;
    const alt = image.getAttribute('alt')?.trim();
    if (alt) image.replaceWith(image.ownerDocument.createTextNode(alt));
    else image.remove();
    droppedImageCount += 1;
  });

  return { droppedImageCount, removedUnsafeUrlCount };
};

export const sanitizeClipboardHtml = (
  html: string,
  options: SanitizeClipboardHtmlOptions = {},
): SanitizedClipboardHtml => {
  const allowedAttributes = options.allowInternalStructures
    ? [...BASE_ATTRIBUTES, ...INTERNAL_STRUCTURE_ATTRIBUTES]
    : BASE_ATTRIBUTES;
  const sanitized = DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: allowedAttributes,
    ALLOW_ARIA_ATTR: false,
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'svg', 'form', 'meta', 'link'],
    FORBID_CONTENTS: ['script', 'style', 'iframe', 'object', 'embed', 'svg'],
    KEEP_CONTENT: true,
  });
  const doc = parseHtmlDocument(String(sanitized));
  stripRuntimeAttributes(doc.body);
  restrictClasses(doc.body);
  const counts = sanitizeUrlsAndImages(doc.body);
  Array.from(doc.body.querySelectorAll('input')).forEach(input => input.remove());
  Array.from(doc.body.querySelectorAll('span:not([data-type])')).reverse().forEach(span => {
    if (span.attributes.length === 0) unwrapElement(span);
  });
  Array.from(doc.body.querySelectorAll('strong > strong, em > em, u > u, s > s')).reverse().forEach(element => {
    unwrapElement(element);
  });
  Array.from(doc.body.querySelectorAll('[data-nmdd-generated]')).forEach(element => {
    element.removeAttribute('data-nmdd-generated');
  });
  return { html: doc.body.innerHTML, ...counts };
};

export const stripRuntimeAttributesFromHtml = (html: string): string => {
  const doc = parseHtmlDocument(html);
  stripRuntimeAttributes(doc.body);
  return doc.body.innerHTML;
};
