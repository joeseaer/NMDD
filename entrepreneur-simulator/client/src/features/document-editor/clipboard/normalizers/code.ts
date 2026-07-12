import { escapeHtml, visibleTextWithLineBreaks } from '../htmlUtils';

export const normalizeCodeSourceHtml = (root: HTMLElement): void => {
  const language = Array.from(root.querySelectorAll('[class]'))
    .flatMap(element => Array.from(element.classList))
    .find(className => /^language-[\w+-]+$/i.test(className));
  const sourceContainer = root.querySelector<HTMLElement>('[data-vscode-copy], .view-lines, .xterm, [data-terminal]')
    || Array.from(root.querySelectorAll<HTMLElement>('div')).find(element => (
      /font-family:\s*(?:Consolas|Menlo|Monaco|["']?SFMono-Regular)/i.test(element.getAttribute('style') || '')
    ));
  const directLines = sourceContainer
    ? Array.from(sourceContainer.children).filter(element => element.tagName === 'DIV')
    : [];
  const text = directLines.length
    ? directLines.map(line => line.textContent || '').join('\n')
    : visibleTextWithLineBreaks(sourceContainer || root).trim();
  root.innerHTML = `<pre><code${language ? ` class="${escapeHtml(language)}"` : ''}>${escapeHtml(text)}</code></pre>`;
};
