import { unwrapElement } from '../htmlUtils';

const COPY_BUTTON_TEXT = /^(?:copy|copy code|复制|复制代码|拷贝|拷贝代码)$/i;

export const normalizeChatAppHtml = (root: ParentNode): void => {
  Array.from(root.querySelectorAll('button, [role="button"]')).forEach(element => {
    if (COPY_BUTTON_TEXT.test(element.textContent?.trim() || '')) element.remove();
  });
  Array.from(root.querySelectorAll('pre > div')).forEach(wrapper => {
    if (wrapper.querySelector('code')) unwrapElement(wrapper);
  });
};
