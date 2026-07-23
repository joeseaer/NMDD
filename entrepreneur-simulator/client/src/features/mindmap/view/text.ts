import type {
  Paragraph,
  RichList,
  RichListItem,
  RichText,
} from '../domain/types';

const paragraphToPlainText = (paragraph: Paragraph): string => paragraph.children
  .map((inline) => inline.type === 'hardBreak' ? '\n' : inline.text)
  .join('');

const listItemToPlainText = (item: RichListItem): string => item.children
  .map((child) => child.type === 'paragraph'
    ? paragraphToPlainText(child)
    : listToPlainText(child))
  .join('\n');

const listToPlainText = (list: RichList): string => list.items
  .map(listItemToPlainText)
  .join('\n');

export const mindMapRichTextToPlainText = (richText: RichText | undefined): string => (
  richText?.blocks
    .map((block) => block.type === 'paragraph'
      ? paragraphToPlainText(block)
      : listToPlainText(block))
    .join('\n') ?? ''
);
