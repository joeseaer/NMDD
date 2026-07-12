import { unwrapElement } from '../htmlUtils';

export const normalizeGoogleHtml = (root: ParentNode): void => {
  Array.from(root.querySelectorAll('google-sheets-html-origin')).forEach(unwrapElement);
  Array.from(root.querySelectorAll('[id^="docs-internal-guid-"]')).forEach(element => element.removeAttribute('id'));
  Array.from(root.querySelectorAll('b[style], strong[style]')).forEach(element => {
    if (/font-weight\s*:\s*(?:normal|400)/i.test(element.getAttribute('style') || '')) unwrapElement(element);
  });
};
