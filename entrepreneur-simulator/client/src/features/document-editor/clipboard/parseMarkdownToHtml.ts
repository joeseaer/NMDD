import MarkdownIt from 'markdown-it';
import { normalizeClipboardText, parseHtmlDocument } from './htmlUtils';
import { protectMathInMarkdown, restoreProtectedMathHtml } from './math';

const externalMarkdownParser = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
  typographer: false,
});

const findFirstTextNode = (root: Element): Text | null => {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  return walker.nextNode() ? walker.currentNode as Text : null;
};

const normalizeTaskLists = (html: string): string => {
  const doc = parseHtmlDocument(html);
  Array.from(doc.body.querySelectorAll('li')).forEach(item => {
    const firstText = findFirstTextNode(item);
    const match = firstText?.data.match(/^\s*\[([ xX])\]\s+/);
    if (!firstText || !match) return;
    firstText.data = firstText.data.slice(match[0].length);
    item.setAttribute('data-type', 'taskItem');
    item.setAttribute('data-checked', match[1].toLowerCase() === 'x' ? 'true' : 'false');
    if (item.parentElement?.tagName === 'UL') item.parentElement.setAttribute('data-type', 'taskList');
  });
  return doc.body.innerHTML;
};

/** External paste parser. Raw HTML is intentionally disabled. */
export const renderExternalMarkdown = (
  input: string,
): { html: string; mathNodeCount: number } => {
  const protectedMath = protectMathInMarkdown(normalizeClipboardText(input));
  const rendered = externalMarkdownParser.render(protectedMath.text);
  const taskHtml = normalizeTaskLists(rendered);
  const restored = restoreProtectedMathHtml(taskHtml, protectedMath.tokens);
  return { html: restored.html, mathNodeCount: restored.count };
};

export const getExternalMarkdownParser = () => externalMarkdownParser;
