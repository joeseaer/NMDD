import type { AnyExtension, Extensions } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import LinkExtension from '@tiptap/extension-link';
import Heading from '@tiptap/extension-heading';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Placeholder from '@tiptap/extension-placeholder';
import Highlight from '@tiptap/extension-highlight';
import TextAlign from '@tiptap/extension-text-align';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { TextStyle } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import { common, createLowlight } from 'lowlight';
import { DocumentLinkInteractionExtension } from './DocumentLinkInteractionExtension';
import { isSafeLinkUrl } from './clipboard/urlPolicy';

const lowlight = createLowlight(common);

export type SmartDocumentTableExtensions = {
  table: AnyExtension;
  row: AnyExtension;
  header: AnyExtension;
  cell: AnyExtension;
};

export type CreateSmartDocumentExtensionsOptions = {
  placeholder?: string;
  codeBlock?: AnyExtension | null;
  image?: AnyExtension | null;
  table?: SmartDocumentTableExtensions | null;
  before?: Extensions;
  custom?: Extensions;
  after?: Extensions;
};

/**
 * The single schema factory shared by the main document editor and nested
 * database-row editor. Callers provide their NodeView-specific image/table
 * variants, while marks, text blocks, clipboard-facing semantics and keyboard
 * behavior stay identical everywhere.
 */
export const createSmartDocumentExtensions = ({
  placeholder = '开始输入内容… 输入 / 唤起命令菜单',
  codeBlock,
  image = null,
  table = null,
  before = [],
  custom = [],
  after = [],
}: CreateSmartDocumentExtensionsOptions): Extensions => [
  ...before,
  StarterKit.configure({
    heading: false,
    link: false,
    codeBlock: false,
    bulletList: {
      keepMarks: true,
      keepAttributes: false,
    },
    orderedList: {
      keepMarks: true,
      keepAttributes: false,
    },
  }),
  LinkExtension.configure({
    openOnClick: false,
    autolink: true,
    linkOnPaste: true,
    defaultProtocol: 'https',
    isAllowedUri: url => isSafeLinkUrl(url),
    shouldAutoLink: url => isSafeLinkUrl(url),
    HTMLAttributes: {
      target: '_blank',
      rel: 'noopener noreferrer',
    },
  }),
  DocumentLinkInteractionExtension,
  Heading.configure({ levels: [1, 2, 3, 4, 5, 6] }),
  TaskList,
  TaskItem.configure({
    nested: true,
    HTMLAttributes: {
      class: 'smart-document-task-item',
      'data-type': 'taskItem',
    },
  }),
  Placeholder.configure({ placeholder }),
  TextStyle,
  Color,
  Highlight.configure({ multicolor: true }),
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  Subscript,
  Superscript,
  ...(codeBlock === null ? [] : [codeBlock || CodeBlockLowlight.configure({ lowlight })]),
  ...(image ? [image] : []),
  ...custom,
  ...(table ? [table.table, table.row, table.header, table.cell] : []),
  ...after,
];

export { lowlight as smartDocumentLowlight };
