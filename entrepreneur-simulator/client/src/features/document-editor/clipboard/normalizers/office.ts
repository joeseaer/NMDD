import { replaceTag, unwrapElement } from '../htmlUtils';

const firstTextNode = (root: Element): Text | null => {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  return walker.nextNode() ? walker.currentNode as Text : null;
};

const stripOfficeListMarker = (paragraph: Element): { ordered: boolean } => {
  Array.from(paragraph.querySelectorAll('span')).forEach(span => {
    const style = span.getAttribute('style') || '';
    if (/mso-list\s*:\s*ignore/i.test(style)) span.remove();
  });
  const text = firstTextNode(paragraph);
  const marker = text?.data.match(/^\s*((?:\d+|[A-Za-z]|[ivxlcdmIVXLCDM]+)[.)]|[•·▪◦o\-*+])\s+/);
  if (text && marker) text.data = text.data.slice(marker[0].length);
  return { ordered: Boolean(marker && /[.)]$/.test(marker[1])) };
};

const normalizeOfficeLists = (root: ParentNode): void => {
  const paragraphs = Array.from(root.querySelectorAll('p')).filter(paragraph => {
    const signature = `${paragraph.className} ${paragraph.getAttribute('style') || ''}`;
    return /MsoListParagraph|mso-list\s*:/i.test(signature);
  });

  paragraphs.forEach(paragraph => {
    if (!paragraph.isConnected || paragraph.closest('li')) return;
    const { ordered } = stripOfficeListMarker(paragraph);
    const list = paragraph.ownerDocument.createElement(ordered ? 'ol' : 'ul');
    const item = paragraph.ownerDocument.createElement('li');
    while (paragraph.firstChild) item.appendChild(paragraph.firstChild);
    list.appendChild(item);
    paragraph.replaceWith(list);

    let sibling = list.nextElementSibling;
    while (sibling?.matches('p.MsoListParagraph, p[class*="MsoListParagraph"]')) {
      const next = sibling.nextElementSibling;
      const nextKind = stripOfficeListMarker(sibling).ordered;
      if (nextKind !== ordered) break;
      const nextItem = sibling.ownerDocument.createElement('li');
      while (sibling.firstChild) nextItem.appendChild(sibling.firstChild);
      list.appendChild(nextItem);
      sibling.remove();
      sibling = next;
    }
  });
};

const normalizeOfficeHeadings = (root: ParentNode): void => {
  Array.from(root.querySelectorAll('p')).forEach(paragraph => {
    const signature = `${paragraph.className} ${paragraph.getAttribute('style') || ''}`;
    const heading = signature.match(/(?:MsoHeading|heading\s*)([1-6])/i);
    if (heading) replaceTag(paragraph, `h${heading[1]}`);
    else if (/MsoTitle|mso-style-name\s*:\s*title/i.test(signature)) replaceTag(paragraph, 'h1');
    else if (/MsoSubtitle|mso-style-name\s*:\s*subtitle/i.test(signature)) replaceTag(paragraph, 'h2');
  });
};

export const normalizeOfficeHtml = (root: ParentNode): void => {
  normalizeOfficeHeadings(root);
  normalizeOfficeLists(root);
  Array.from(root.querySelectorAll('o\\:p, w\\:sdt, xml')).forEach(unwrapElement);
  Array.from(root.querySelectorAll('v\\:shape, v\\:imagedata')).forEach(element => element.remove());
};
