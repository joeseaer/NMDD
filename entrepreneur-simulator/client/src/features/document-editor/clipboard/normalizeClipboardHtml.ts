import { normalizeSourceMatch } from './classifyClipboardSource';
import { normalizeMathElements } from './math';
import {
  normalizeChatAppHtml,
  normalizeCodeSourceHtml,
  normalizeGenericHtml,
  normalizeGoogleHtml,
  normalizeNotionHtml,
  normalizeOfficeHtml,
} from './normalizers';
import { parseHtmlDocument } from './htmlUtils';
import { RUNTIME_HTML_ATTRIBUTES, sanitizeClipboardHtml } from './sanitizeClipboardHtml';
import type {
  NormalizedClipboardHtml,
  NormalizeClipboardHtmlOptions,
} from './types';

const GENERATED_ATTRIBUTE = 'data-nmdd-generated';

const removeIncomingTrustMarkers = (root: ParentNode): void => {
  Array.from(root.querySelectorAll(`[${GENERATED_ATTRIBUTE}]`)).forEach(element => {
    element.removeAttribute(GENERATED_ATTRIBUTE);
  });
};

const removeExecutableElements = (root: ParentNode): void => {
  Array.from(root.querySelectorAll('script:not([type^="math/tex"]), iframe, object, embed, form, link, meta')).forEach(element => {
    element.remove();
  });
};

const stripExternalInternalAttributes = (root: ParentNode, allowInternalStructures: boolean): void => {
  Array.from(root.querySelectorAll('*')).forEach(element => {
    const generated = element.getAttribute(GENERATED_ATTRIBUTE);
    Array.from(element.attributes).forEach(attribute => {
      const name = attribute.name.toLowerCase();
      if (RUNTIME_HTML_ATTRIBUTES.has(name)) {
        element.removeAttribute(attribute.name);
        return;
      }
      if (name === 'id' && /^(?:block|node|comment|upload)[-_]/i.test(attribute.value)) {
        element.removeAttribute(attribute.name);
        return;
      }
      if (allowInternalStructures || !name.startsWith('data-')) return;
      const safeGeneratedAttribute = Boolean(generated) && (
        name === GENERATED_ATTRIBUTE
        || name === 'data-type'
        || name === 'data-equation'
        || name === 'data-checked'
      );
      if (!safeGeneratedAttribute) element.removeAttribute(attribute.name);
    });
  });
};

const markGeneratedTaskLists = (root: ParentNode): void => {
  Array.from(root.querySelectorAll('li[data-type="taskItem"]')).forEach(item => {
    item.setAttribute(GENERATED_ATTRIBUTE, 'task');
    if (item.parentElement?.matches('ul[data-type="taskList"]')) {
      item.parentElement.setAttribute(GENERATED_ATTRIBUTE, 'task');
    }
  });
};

export const normalizeClipboardHtml = (
  html: string,
  options: NormalizeClipboardHtmlOptions = {},
): NormalizedClipboardHtml => {
  const source = normalizeSourceMatch(options.source, {
    text: options.payload?.text,
    html: options.payload?.html || html,
    types: options.payload?.types,
  });
  if (!html.trim()) {
    return {
      html: '',
      source,
      mathNodeCount: 0,
      droppedImageCount: 0,
      diagnostics: ['empty clipboard HTML'],
    };
  }

  const allowInternalStructures = options.allowInternalStructures ?? source.source === 'internal';
  const doc = parseHtmlDocument(html);
  removeIncomingTrustMarkers(doc.body);

  switch (source.source) {
    case 'office':
      normalizeOfficeHtml(doc.body);
      break;
    case 'google-docs':
    case 'google-sheets':
      normalizeGoogleHtml(doc.body);
      break;
    case 'notion':
      normalizeNotionHtml(doc.body);
      break;
    case 'chatgpt':
    case 'codex':
      normalizeChatAppHtml(doc.body);
      break;
    case 'vscode':
    case 'terminal':
      normalizeCodeSourceHtml(doc.body);
      break;
    default:
      break;
  }

  const mathNodeCount = normalizeMathElements(doc.body);
  markGeneratedTaskLists(doc.body);
  normalizeGenericHtml(doc.body);
  removeExecutableElements(doc.body);
  stripExternalInternalAttributes(doc.body, allowInternalStructures);
  const sanitized = sanitizeClipboardHtml(doc.body.innerHTML, { allowInternalStructures });
  const diagnostics = [
    `source:${source.source}`,
    ...(mathNodeCount > 0 ? [`math:${mathNodeCount}`] : []),
    ...(sanitized.droppedImageCount > 0 ? [`dropped-images:${sanitized.droppedImageCount}`] : []),
    ...(sanitized.removedUnsafeUrlCount > 0 ? [`unsafe-urls:${sanitized.removedUnsafeUrlCount}`] : []),
  ];

  return {
    html: sanitized.html,
    source,
    mathNodeCount,
    droppedImageCount: sanitized.droppedImageCount,
    diagnostics,
  };
};
