import { replaceTag } from '../htmlUtils';

export const normalizeNotionHtml = (root: ParentNode): void => {
  Array.from(root.querySelectorAll('input[type="checkbox"]')).forEach(input => {
    const item = input.closest('li');
    if (item) {
      item.setAttribute('data-type', 'taskItem');
      item.setAttribute('data-checked', (input as HTMLInputElement).checked || input.hasAttribute('checked') ? 'true' : 'false');
      item.setAttribute('data-nmdd-generated', 'task');
      if (item.parentElement?.tagName === 'UL') {
        item.parentElement.setAttribute('data-type', 'taskList');
        item.parentElement.setAttribute('data-nmdd-generated', 'task');
      }
    }
    input.remove();
  });

  Array.from(root.querySelectorAll('div[data-block-id], div[data-notion-block-id]')).reverse().forEach(block => {
    if (block.querySelector('div, p, h1, h2, h3, ul, ol, table, pre, blockquote')) return;
    replaceTag(block, 'p');
  });
};
