import type { JSONContent } from '@tiptap/core';

export const collectLinkedPageIds = (content: JSONContent | null | undefined): Set<string> => {
  const ids = new Set<string>();
  const visit = (node: JSONContent | null | undefined) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'pageLinkBlock' && typeof node.attrs?.pageId === 'string' && node.attrs.pageId) {
      ids.add(node.attrs.pageId);
    }
    node.content?.forEach(visit);
  };
  visit(content);
  return ids;
};

export const documentLinksToPage = (
  content: JSONContent | null | undefined,
  pageId: string,
) => collectLinkedPageIds(content).has(pageId);
