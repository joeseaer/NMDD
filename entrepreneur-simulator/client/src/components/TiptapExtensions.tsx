
import { Node, mergeAttributes, InputRule, Extension, type JSONContent } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';
import { EditorContent, ReactRenderer, ReactNodeViewRenderer, NodeViewWrapper, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import LinkExtension from '@tiptap/extension-link';
import TiptapImage from '@tiptap/extension-image';
import { Table } from '@tiptap/extension-table';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableRow } from '@tiptap/extension-table-row';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Placeholder from '@tiptap/extension-placeholder';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Fragment } from '@tiptap/pm/model';
import tippy from 'tippy.js';
import { useState, useEffect, useMemo, useRef, forwardRef, useImperativeHandle, type ReactNode } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { 
  Bold, Heading1, Heading2, Heading3, Italic, List, ListOrdered, CheckSquare,
  Quote, Minus, Code, Layout, Image as ImageIcon, Strikethrough,
  Type, Network, ChevronRight, AlertTriangle, Bookmark, Globe,
  Paperclip, Video, Music, FileText, Sigma, RefreshCw, CalendarDays, X,
  Database, Plus, Trash2
} from 'lucide-react';
import { MindMapComponent } from './MindMapExtension';

// --- Module Augmentation for Commands ---
declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    columnList: {
      /**
       * Set the number of columns
       */
      setColumns: (cols: number) => ReturnType;
    },
    indent: {
      indent: () => ReturnType;
      outdent: () => ReturnType;
    }
  }
}

// --- Indent Extension ---

export const Indent = Extension.create({
  name: 'indent',

  addOptions() {
    return {
      types: ['paragraph', 'heading', 'blockquote'],
      indentLevels: [0, 30, 60, 90, 120, 150, 180, 210],
      defaultIndentLevel: 0,
    };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          indent: {
            default: this.options.defaultIndentLevel,
            renderHTML: attributes => ({
              style: `margin-left: ${attributes.indent}px!important;`
            }),
            parseHTML: element => parseInt(element.style.marginLeft) || this.options.defaultIndentLevel,
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      indent: () => ({ tr, state, dispatch }) => {
        const { selection } = state;
        tr.setSelection(selection);
        
        // We need to collect changes first to avoid modifying the doc while iterating
        // although setNodeMarkup is generally safe for attrs.
        // However, we only want to target top-level blocks in the selection usually, 
        // or just all matching blocks.
        
        const { from, to } = selection;
        
        state.doc.nodesBetween(from, to, (node, pos) => {
            if (this.options.types.includes(node.type.name)) {
                const currentIndent = node.attrs.indent || 0;
                const newIndent = Math.min(currentIndent + 30, 210);
                
                if (dispatch) {
                    tr.setNodeMarkup(pos, null, { ...node.attrs, indent: newIndent });
                }
                return false; // Don't traverse children of a matched block to avoid double indenting?
                              // Actually, if we indent a blockquote, do we want to indent its paragraphs?
                              // If blockquote has margin, and p has margin...
                              // Let's say yes, return false to stop drilling down.
            }
        });

        return true;
      },
      outdent: () => ({ tr, state, dispatch }) => {
        const { selection } = state;
        tr.setSelection(selection);
        const { from, to } = selection;

        state.doc.nodesBetween(from, to, (node, pos) => {
            if (this.options.types.includes(node.type.name)) {
                const currentIndent = node.attrs.indent || 0;
                const newIndent = Math.max(currentIndent - 30, 0);
                
                if (dispatch) {
                    tr.setNodeMarkup(pos, null, { ...node.attrs, indent: newIndent });
                }
                return false;
            }
        });

        return true;
      },
    };
  },

  addKeyboardShortcuts() {
    return {
      Tab: () => {
         // Check if we are in a list first
         if (this.editor.can().sinkListItem('listItem')) {
             return this.editor.chain().focus().sinkListItem('listItem').run();
         }
         if (this.editor.can().sinkListItem('taskItem')) {
             return this.editor.chain().focus().sinkListItem('taskItem').run();
         }
         // Otherwise indent
         return this.editor.chain().focus().indent().run();
      },
      'Shift-Tab': () => {
         // Check if we are in a list first
         if (this.editor.can().liftListItem('listItem')) {
             return this.editor.chain().focus().liftListItem('listItem').run();
         }
         if (this.editor.can().liftListItem('taskItem')) {
             return this.editor.chain().focus().liftListItem('taskItem').run();
         }
         // Otherwise outdent
         return this.editor.chain().focus().outdent().run();
      },
    };
  },
});

// --- Column Extension ---

export const ColumnList = Node.create({
  name: 'columnList',
  group: 'block',
  content: 'column+', // Must contain one or more columns
  isolating: true,
  
  parseHTML() {
    return [
      {
        tag: 'div[data-type="column-list"]',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'column-list', class: 'smart-doc-column-list flex flex-col md:flex-row gap-4 my-4' }), 0]
  },

  addCommands() {
    return {
      setColumns: (cols: number) => ({ commands }: any) => {
        // Create columns based on the number requested
        const width = `${Math.round((100 / cols) * 100) / 100}%`;
        const columns = Array.from({ length: cols }).map(() => ({
          type: 'column',
          attrs: { width },
          content: [{ type: 'paragraph' }]
        }));

        return commands.insertContent({
          type: 'columnList',
          content: columns
        });
      },
    }
  },

  addInputRules() {
    return [
      new InputRule({
        find: /^\/2\s$/, // Matches "/2 "
        handler: ({ state, range }) => {
          const { tr, schema } = state;
          const start = range.from;
          const end = range.to;
          
          tr.delete(start, end); // Delete the "/2 " text
          
          // Insert 2 columns
          const columns = Array.from({ length: 2 }).map(() => schema.nodes.column.create({ width: '50%' }, [
             schema.nodes.paragraph.create()
          ]));
          
          const node = this.type.create(null, columns);
          tr.replaceSelectionWith(node);
        },
      }),
      new InputRule({
        find: /^\/3\s$/, // Matches "/3 "
        handler: ({ state, range }) => {
          const { tr, schema } = state;
          const start = range.from;
          const end = range.to;
          
          tr.delete(start, end); // Delete the "/3 " text
          
          // Insert 3 columns
          const columns = Array.from({ length: 3 }).map(() => schema.nodes.column.create({ width: '33.33%' }, [
             schema.nodes.paragraph.create()
          ]));
          
          const node = this.type.create(null, columns);
          tr.replaceSelectionWith(node);
        },
      }),
    ]
  },
});

export const Column = Node.create({
  name: 'column',
  content: 'block+', // Must contain blocks (paragraphs, etc.)
  isolating: true,

  addAttributes() {
    return {
      width: {
        default: null,
        parseHTML: element => element.getAttribute('data-width') || null,
        renderHTML: attributes => {
          const width = typeof attributes.width === 'string' && attributes.width.trim()
            ? attributes.width.trim()
            : null;

          if (!width) return {};

          return {
            'data-width': width,
            style: `--smart-column-width: ${width};`,
          };
        },
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="column"]',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'column', class: 'smart-doc-column min-w-0 border border-dashed border-gray-200 p-2 rounded-lg' }), 0]
  },
});

// --- Mind Map Extension ---

export const MindMap = Node.create({
  name: 'mindMap',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      data: {
        default: null,
        parseHTML: element => {
          const raw = element.getAttribute('data-mindmap');
          if (!raw) return null;
          try {
            return decodeURIComponent(raw);
          } catch {
            return raw;
          }
        },
        renderHTML: attributes => {
          const jsonStr = typeof attributes.data === 'object'
            ? JSON.stringify(attributes.data)
            : (attributes.data || '');

          return {
            'data-mindmap': encodeURIComponent(jsonStr),
          }
        },
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="mind-map"]',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'mind-map' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(MindMapComponent)
  },
});

// --- Smart Document Blocks ---

export const ToggleBlock = Node.create({
  name: 'toggleBlock',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      title: {
        default: 'Toggle',
        parseHTML: element => element.getAttribute('data-title') || 'Toggle',
        renderHTML: attributes => ({ 'data-title': attributes.title || 'Toggle' }),
      },
      open: {
        default: true,
        parseHTML: element => element.hasAttribute('open'),
        renderHTML: attributes => attributes.open ? { open: 'open' } : {},
      },
    }
  },

  parseHTML() {
    return [{ tag: 'details[data-type="toggle"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    const title = HTMLAttributes['data-title'] || 'Toggle';
    return [
      'details',
      mergeAttributes(HTMLAttributes, { 'data-type': 'toggle', class: 'smart-doc-toggle my-3 rounded-md border border-gray-200 bg-white' }),
      ['summary', { class: 'smart-doc-toggle-summary cursor-pointer select-none px-3 py-2 text-sm font-medium text-gray-800' }, title],
      ['div', { class: 'smart-doc-toggle-content px-4 pb-3 pt-1' }, 0],
    ]
  },
});

export const CalloutBlock = Node.create({
  name: 'calloutBlock',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      icon: {
        default: '!',
        parseHTML: element => element.getAttribute('data-icon') || '!',
        renderHTML: attributes => ({ 'data-icon': attributes.icon || '!' }),
      },
      tone: {
        default: 'gray',
        parseHTML: element => element.getAttribute('data-tone') || 'gray',
        renderHTML: attributes => ({ 'data-tone': attributes.tone || 'gray' }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="callout"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    const icon = HTMLAttributes['data-icon'] || '!';
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'callout', class: 'smart-doc-callout my-3 flex gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-gray-800' }),
      ['div', { class: 'smart-doc-callout-icon mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded bg-white text-xs font-bold text-amber-700' }, icon],
      ['div', { class: 'smart-doc-callout-content min-w-0 flex-1' }, 0],
    ]
  },
});

export const BookmarkBlock = Node.create({
  name: 'bookmarkBlock',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      url: {
        default: '',
        parseHTML: element => element.getAttribute('href') || element.getAttribute('data-url') || '',
        renderHTML: attributes => ({ href: attributes.url || '#', 'data-url': attributes.url || '' }),
      },
      title: {
        default: '',
        parseHTML: element => element.getAttribute('data-title') || element.textContent?.trim() || '',
        renderHTML: attributes => ({ 'data-title': attributes.title || '' }),
      },
      description: {
        default: '',
        parseHTML: element => element.getAttribute('data-description') || '',
        renderHTML: attributes => ({ 'data-description': attributes.description || undefined }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'a[data-type="bookmark"]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const url = node.attrs.url || '#';
    const title = node.attrs.title || url || 'Bookmark';
    const description = node.attrs.description || url;
    return [
      'a',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'bookmark',
        href: url,
        target: '_blank',
        rel: 'noopener noreferrer',
        class: 'smart-doc-bookmark my-3 block rounded-md border border-gray-200 bg-white p-3 text-gray-800 no-underline hover:bg-gray-50',
      }),
      ['span', { class: 'block text-sm font-semibold text-gray-900' }, title],
      ['span', { class: 'mt-1 block truncate text-xs text-gray-500' }, description],
    ]
  },
});

export const EmbedBlock = Node.create({
  name: 'embedBlock',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      url: {
        default: '',
        parseHTML: element => element.getAttribute('data-url') || '',
        renderHTML: attributes => ({ 'data-url': attributes.url || '' }),
      },
      title: {
        default: 'Embed',
        parseHTML: element => element.getAttribute('data-title') || 'Embed',
        renderHTML: attributes => ({ 'data-title': attributes.title || 'Embed' }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="embed"]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const url = node.attrs.url || '';
    const title = node.attrs.title || 'Embed';
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'embed', class: 'smart-doc-embed my-3 overflow-hidden rounded-md border border-gray-200 bg-white' }),
      ['div', { class: 'border-b border-gray-100 px-3 py-2 text-xs font-semibold text-gray-500' }, title],
      ['iframe', { src: url, class: 'h-72 w-full bg-gray-50', loading: 'lazy', referrerpolicy: 'no-referrer-when-downgrade', allowfullscreen: 'true' }],
    ]
  },
});

export const MediaBlock = Node.create({
  name: 'mediaBlock',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      url: {
        default: '',
        parseHTML: element => element.getAttribute('data-url') || element.getAttribute('href') || '',
        renderHTML: attributes => ({ 'data-url': attributes.url || '' }),
      },
      name: {
        default: '',
        parseHTML: element => element.getAttribute('data-name') || element.textContent?.trim() || '',
        renderHTML: attributes => ({ 'data-name': attributes.name || '' }),
      },
      mime: {
        default: '',
        parseHTML: element => element.getAttribute('data-mime') || '',
        renderHTML: attributes => ({ 'data-mime': attributes.mime || '' }),
      },
      size: {
        default: 0,
        parseHTML: element => Number(element.getAttribute('data-size') || 0),
        renderHTML: attributes => ({ 'data-size': attributes.size || 0 }),
      },
      kind: {
        default: 'file',
        parseHTML: element => element.getAttribute('data-kind') || 'file',
        renderHTML: attributes => ({ 'data-kind': attributes.kind || 'file' }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="media"]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const { url, name, mime, kind } = node.attrs;
    const label = name || url || 'Attachment';
    const mediaClass = 'smart-doc-media my-3 overflow-hidden rounded-md border border-gray-200 bg-white';

    if (kind === 'video') {
      return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'media', class: mediaClass }), ['video', { src: url, controls: 'true', class: 'block max-h-[520px] w-full bg-black' }], ['div', { class: 'px-3 py-2 text-xs text-gray-500' }, label]];
    }

    if (kind === 'audio') {
      return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'media', class: `${mediaClass} p-3` }), ['div', { class: 'mb-2 text-sm font-medium text-gray-800' }, label], ['audio', { src: url, controls: 'true', class: 'w-full' }]];
    }

    if (kind === 'pdf') {
      return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'media', class: mediaClass }), ['div', { class: 'border-b border-gray-100 px-3 py-2 text-sm font-medium text-gray-800' }, label], ['iframe', { src: url, class: 'h-96 w-full bg-gray-50' }]];
    }

    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'media', class: `${mediaClass} p-3` }),
      ['a', { href: url, target: '_blank', rel: 'noopener noreferrer', class: 'flex items-center justify-between gap-3 text-sm text-gray-800 no-underline' },
        ['span', { class: 'min-w-0 truncate font-medium' }, label],
        ['span', { class: 'flex-shrink-0 text-xs text-gray-400' }, mime || 'file'],
      ],
    ]
  },
});

const DEFAULT_EQUATION = 'E = mc^2';

const blockDomId = (blockId?: string | null) => blockId ? `block-${blockId}` : undefined;

const encodeJsonAttribute = (value: unknown) => {
  try {
    return encodeURIComponent(JSON.stringify(value));
  } catch {
    return undefined;
  }
};

const decodeJsonAttribute = (value: string | null) => {
  if (!value) return null;

  const candidates = [value];
  try {
    candidates.push(decodeURIComponent(value));
  } catch {}

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {}
  }

  return null;
};

const createSmartDocumentId = (prefix: string) => {
  const randomPart = Math.random().toString(36).slice(2, 9);
  return `${prefix}_${Date.now().toString(36)}_${randomPart}`;
};

const createTemplateButtonContent = (attrs: any) => {
  const templateContent = Array.isArray(attrs?.templateContent) ? stripTemplateRuntimeAttrs(attrs.templateContent) : [];
  if (templateContent.length) return templateContent;

  const title = String(attrs?.templateTitle || '新模板条目').trim() || '新模板条目';
  const body = String(attrs?.templateBody || '').replace(/\r\n/g, '\n');
  const content: any[] = [
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: title }],
    },
  ];

  if (body.length) {
    content.push(...body.split('\n').map((line) => {
      const text = line.trim();
      return text
        ? {
          type: 'paragraph',
          content: [{ type: 'text', text }],
        }
        : { type: 'paragraph' };
    }));
  } else {
    content.push({ type: 'paragraph' });
  }

  return content;
};

const stripTemplateRuntimeAttrs = (value: any): any => {
  if (Array.isArray(value)) return value.map(stripTemplateRuntimeAttrs);
  if (!value || typeof value !== 'object') return value;

  const next: any = { ...value };
  if (next.attrs && typeof next.attrs === 'object') {
    const { blockId, blockComments, ...restAttrs } = next.attrs;
    next.attrs = restAttrs;
  }
  if (Array.isArray(next.content)) next.content = next.content.map(stripTemplateRuntimeAttrs);
  return next;
};

const normalizeTemplateButtonAttrs = (attrs: any) => ({
  label: String(attrs?.label || '新建模板').trim() || '新建模板',
  templateTitle: String(attrs?.templateTitle || '新模板条目'),
  templateBody: String(attrs?.templateBody || ''),
  templateContent: Array.isArray(attrs?.templateContent) ? stripTemplateRuntimeAttrs(attrs.templateContent) : null,
});

const TemplateButtonView = ({ node, updateAttributes, editor, getPos, selected }: any) => {
  const attrs = normalizeTemplateButtonAttrs(node.attrs);

  const insertTemplate = () => {
    if (!editor || typeof getPos !== 'function') return;
    const insertAt = getPos() + node.nodeSize;
    editor.chain().focus().insertContentAt(insertAt, createTemplateButtonContent(attrs)).run();
  };

  return (
    <NodeViewWrapper
      className={`smart-doc-template-button my-3 rounded-md border bg-white transition-colors ${
        selected ? 'border-gray-400 shadow-sm' : 'border-gray-200 hover:border-gray-300'
      }`}
      data-type="template-button"
      data-label={attrs.label}
      data-template-title={attrs.templateTitle}
      data-template-body={attrs.templateBody}
      data-template-content={attrs.templateContent ? encodeJsonAttribute(attrs.templateContent) : undefined}
      data-block-id={node.attrs.blockId || undefined}
      data-comments={Array.isArray(node.attrs.blockComments) && node.attrs.blockComments.length ? encodeJsonAttribute(node.attrs.blockComments) : undefined}
      id={blockDomId(node.attrs.blockId)}
      contentEditable={false}
    >
      <div className="flex flex-col gap-3 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={insertTemplate}
            className="inline-flex h-8 items-center gap-1.5 rounded border border-gray-200 bg-gray-900 px-3 text-xs font-semibold text-white hover:bg-gray-700"
          >
            <Plus className="h-3.5 w-3.5" />
            {attrs.label}
          </button>
          <input
            value={attrs.label}
            onChange={(event) => updateAttributes({ label: event.target.value })}
            className="h-8 min-w-44 flex-1 rounded border border-gray-200 bg-white px-2 text-xs font-medium text-gray-700 outline-none focus:border-gray-400 focus:ring-2 focus:ring-gray-100"
            aria-label="按钮文字"
          />
        </div>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <input
            value={attrs.templateTitle}
            onChange={(event) => updateAttributes({ templateTitle: event.target.value })}
            className="h-8 min-w-0 rounded border border-gray-200 bg-gray-50 px-2 text-xs font-medium text-gray-700 outline-none focus:border-gray-400 focus:bg-white"
            aria-label="模板标题"
          />
          <textarea
            value={attrs.templateBody}
            onChange={(event) => updateAttributes({ templateBody: event.target.value })}
            placeholder="模板正文"
            className="min-h-16 resize-y rounded border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs leading-5 text-gray-700 outline-none placeholder:text-gray-300 focus:border-gray-400 focus:bg-white"
            aria-label="模板正文"
          />
        </div>
      </div>
    </NodeViewWrapper>
  );
};

export const TemplateButtonBlock = Node.create({
  name: 'templateButtonBlock',
  group: 'block',
  atom: true,
  defining: true,

  addAttributes() {
    return {
      label: {
        default: '新建模板',
        parseHTML: element => element.getAttribute('data-label') || '新建模板',
        renderHTML: attributes => ({ 'data-label': attributes.label || '新建模板' }),
      },
      templateTitle: {
        default: '新模板条目',
        parseHTML: element => element.getAttribute('data-template-title') || '新模板条目',
        renderHTML: attributes => ({ 'data-template-title': attributes.templateTitle || '新模板条目' }),
      },
      templateBody: {
        default: '',
        parseHTML: element => element.getAttribute('data-template-body') || '',
        renderHTML: attributes => ({ 'data-template-body': attributes.templateBody || undefined }),
      },
      templateContent: {
        default: null,
        parseHTML: element => decodeJsonAttribute(element.getAttribute('data-template-content')),
        renderHTML: attributes => ({ 'data-template-content': attributes.templateContent ? encodeJsonAttribute(stripTemplateRuntimeAttrs(attributes.templateContent)) : undefined }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="template-button"]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const attrs = normalizeTemplateButtonAttrs(node.attrs);
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'template-button',
        'data-label': attrs.label,
        'data-template-title': attrs.templateTitle,
        'data-template-body': attrs.templateBody || undefined,
        'data-template-content': attrs.templateContent ? encodeJsonAttribute(attrs.templateContent) : undefined,
        class: 'smart-doc-template-button my-3 rounded-md border border-gray-200 bg-white p-3',
      }),
      ['button', { type: 'button', class: 'rounded bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white' }, attrs.label],
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(TemplateButtonView)
  },
});

const createSyncedBlockId = () => {
  return createSmartDocumentId('sync');
};

const syncedBlockPluginKey = new PluginKey('syncedBlockContent');

const stripSyncedRuntimeAttrs = (value: any): any => {
  if (Array.isArray(value)) return value.map(stripSyncedRuntimeAttrs);
  if (!value || typeof value !== 'object') return value;

  const next: any = { ...value };
  if (next.attrs && typeof next.attrs === 'object') {
    const { blockId, blockComments, ...restAttrs } = next.attrs;
    next.attrs = restAttrs;
  }
  if (Array.isArray(next.content)) next.content = next.content.map(stripSyncedRuntimeAttrs);
  return next;
};

const getSyncedContentJson = (node: any) => stripSyncedRuntimeAttrs(node.content.toJSON());

const getNodeContentSignature = (node: any) => JSON.stringify(getSyncedContentJson(node));

const createSyncedContentFragment = (node: any, schema: any) => {
  const contentJson = getSyncedContentJson(node);
  if (!Array.isArray(contentJson)) return Fragment.empty;
  return Fragment.fromArray(contentJson.map((child) => schema.nodeFromJSON(child)));
};

export const SyncedBlock = Node.create({
  name: 'syncedBlock',
  group: 'block',
  content: 'block+',
  defining: true,
  isolating: true,

  addAttributes() {
    return {
      syncId: {
        default: null,
        parseHTML: element => element.getAttribute('data-sync-id') || null,
        renderHTML: attributes => ({ 'data-sync-id': attributes.syncId || undefined }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="synced-block"]', contentElement: '[data-synced-content]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'synced-block',
        class: 'smart-doc-synced-block my-3 rounded-md border border-gray-200 bg-white',
      }),
      ['div', { contenteditable: 'false', class: 'border-b border-gray-100 px-3 py-1.5 text-xs font-medium text-gray-500' }, '同步块'],
      ['div', { 'data-synced-content': 'true', class: 'px-3 py-2 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0' }, 0],
    ]
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: syncedBlockPluginKey,
        appendTransaction: (transactions, oldState, newState) => {
          if (!transactions.some((transaction) => transaction.docChanged)) return null;
          if (transactions.some((transaction) => transaction.getMeta(syncedBlockPluginKey) === 'sync')) return null;

          const oldByBlockId = new Map<string, any>();
          oldState.doc.descendants((node) => {
            if (node.type.name !== 'syncedBlock') return true;
            const blockId = node.attrs.blockId;
            if (blockId) oldByBlockId.set(blockId, node);
            return true;
          });

          const groups = new Map<string, Array<{ node: any; pos: number }>>();
          newState.doc.descendants((node, pos) => {
            if (node.type.name !== 'syncedBlock') return true;

            const syncId = node.attrs.syncId;
            if (!syncId) return true;

            const entries = groups.get(syncId) || [];
            entries.push({ node, pos });
            groups.set(syncId, entries);
            return true;
          });

          const tr = newState.tr;

          for (const entries of groups.values()) {
            if (entries.length < 2) continue;

            const changedEntries = entries.filter((entry) => {
              const blockId = entry.node.attrs.blockId;
              const oldNode = blockId ? oldByBlockId.get(blockId) : null;
              if (!oldNode) return true;
              return getNodeContentSignature(oldNode) !== getNodeContentSignature(entry.node);
            });
            const source = changedEntries[changedEntries.length - 1] || entries[0];
            const sourceSignature = getNodeContentSignature(source.node);

            for (const entry of entries) {
              if (entry === source) continue;
              if (getNodeContentSignature(entry.node) === sourceSignature) continue;

              const from = tr.mapping.map(entry.pos + 1);
              const to = tr.mapping.map(entry.pos + entry.node.nodeSize - 1);
              tr.replaceWith(from, to, createSyncedContentFragment(source.node, newState.schema));
            }
          }

          if (!tr.docChanged) return null;
          tr.setMeta(syncedBlockPluginKey, 'sync');
          tr.setMeta('addToHistory', false);
          return tr;
        },
      }),
    ];
  },
});

type DatabasePropertyType = 'title' | 'text' | 'number' | 'status' | 'date' | 'checkbox' | 'url' | 'formula';
type DatabaseViewMode = 'table' | 'list' | 'board' | 'calendar' | 'timeline' | 'gallery';
type DatabaseFilterOperator = 'contains' | 'equals' | 'not_empty' | 'empty';

type DatabaseProperty = {
  id: string;
  name: string;
  type: DatabasePropertyType;
  options?: string[];
  formula?: string;
};

type DatabaseRow = {
  id: string;
  cells: Record<string, any>;
  page: {
    content: string;
    contentJson?: JSONContent | null;
    contentHtml?: string;
    contentText?: string;
    updatedAt?: string;
  };
};

type DatabaseFilter = {
  id: string;
  propertyId: string;
  operator: DatabaseFilterOperator;
  value: string;
};

type DatabaseSort = {
  propertyId: string;
  direction: 'asc' | 'desc';
};

type DatabaseViewConfig = {
  id: string;
  name: string;
  mode: DatabaseViewMode;
  filters: DatabaseFilter[];
  groupBy: string | null;
  sort?: DatabaseSort | null;
};

type SmartDocumentDatabase = {
  id: string;
  title: string;
  view: DatabaseViewMode;
  views: DatabaseViewConfig[];
  activeViewId: string | null;
  properties: DatabaseProperty[];
  rows: DatabaseRow[];
  filters: DatabaseFilter[];
  groupBy: string | null;
  sort?: DatabaseSort | null;
};

const DATABASE_PROPERTY_TYPES: Array<{ value: DatabasePropertyType; label: string }> = [
  { value: 'title', label: '标题' },
  { value: 'text', label: '文本' },
  { value: 'number', label: '数字' },
  { value: 'status', label: '状态' },
  { value: 'date', label: '日期' },
  { value: 'checkbox', label: '勾选' },
  { value: 'url', label: '链接' },
  { value: 'formula', label: '公式' },
];

const DATABASE_VIEW_OPTIONS: Array<{ value: DatabaseViewMode; label: string }> = [
  { value: 'table', label: '表格' },
  { value: 'list', label: '列表' },
  { value: 'board', label: '看板' },
  { value: 'calendar', label: '日历' },
  { value: 'timeline', label: '时间轴' },
  { value: 'gallery', label: '画廊' },
];

const DEFAULT_STATUS_OPTIONS = ['未开始', '进行中', '完成'];
const EMPTY_DATABASE_GROUP = '未填写';

const DATABASE_FILTER_OPERATORS: Array<{ value: DatabaseFilterOperator; label: string; needsValue: boolean }> = [
  { value: 'contains', label: '包含', needsValue: true },
  { value: 'equals', label: '等于', needsValue: true },
  { value: 'not_empty', label: '非空', needsValue: false },
  { value: 'empty', label: '为空', needsValue: false },
];

const getDatabaseViewModeLabel = (mode: DatabaseViewMode) => {
  return DATABASE_VIEW_OPTIONS.find((option) => option.value === mode)?.label || '视图';
};

const createDatabaseViewConfig = (mode: DatabaseViewMode = 'table', name?: string): DatabaseViewConfig => ({
  id: createSmartDocumentId('view'),
  name: name || getDatabaseViewModeLabel(mode),
  mode,
  filters: [],
  groupBy: null,
  sort: null,
});

const normalizeDatabaseViewMode = (value: unknown): DatabaseViewMode => {
  return value === 'list' || value === 'board' || value === 'calendar' || value === 'timeline' || value === 'gallery'
    ? value
    : 'table';
};

const createDefaultDatabase = (): SmartDocumentDatabase => {
  const titlePropertyId = createSmartDocumentId('prop');
  const statusPropertyId = createSmartDocumentId('prop');
  const datePropertyId = createSmartDocumentId('prop');
  const firstRowId = createSmartDocumentId('row');
  const defaultView = createDatabaseViewConfig('table');

  return {
    id: createSmartDocumentId('db'),
    title: '新数据库',
    view: defaultView.mode,
    views: [defaultView],
    activeViewId: defaultView.id,
    properties: [
      { id: titlePropertyId, name: '名称', type: 'title' },
      { id: statusPropertyId, name: '状态', type: 'status', options: DEFAULT_STATUS_OPTIONS },
      { id: datePropertyId, name: '日期', type: 'date' },
    ],
    rows: [
      {
        id: firstRowId,
        cells: {
          [titlePropertyId]: '新条目',
          [statusPropertyId]: '未开始',
          [datePropertyId]: '',
        },
        page: {
          content: '',
        },
      },
    ],
    filters: defaultView.filters,
    groupBy: defaultView.groupBy,
    sort: defaultView.sort,
  };
};

const normalizePropertyType = (value: unknown): DatabasePropertyType => {
  return DATABASE_PROPERTY_TYPES.some((item) => item.value === value) ? value as DatabasePropertyType : 'text';
};

const normalizeFilterOperator = (value: unknown): DatabaseFilterOperator => {
  return DATABASE_FILTER_OPERATORS.some((item) => item.value === value) ? value as DatabaseFilterOperator : 'contains';
};

const normalizeStatusOptions = (value: unknown) => {
  const source = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[,，\n]/)
      : [];

  const seen = new Set<string>();
  const options = source
    .map((option) => String(option).trim())
    .filter((option) => {
      if (!option || seen.has(option)) return false;
      seen.add(option);
      return true;
    });

  return options.length ? options : DEFAULT_STATUS_OPTIONS;
};

const normalizeDatabaseCellValue = (property: DatabaseProperty, value: any) => {
  if (property.type === 'formula') return '';
  if (property.type === 'checkbox') return Boolean(value);
  if (property.type === 'status') {
    const options = property.options?.length ? property.options : DEFAULT_STATUS_OPTIONS;
    const nextValue = String(value || '').trim();
    return options.includes(nextValue) ? nextValue : options[0];
  }
  if (value === null || value === undefined) return '';
  return String(value);
};

const getDefaultDatabaseCellValue = (property: DatabaseProperty) => {
  if (property.type === 'checkbox') return false;
  if (property.type === 'status') return property.options?.[0] || DEFAULT_STATUS_OPTIONS[0];
  return '';
};

const isDatabaseRowPageJson = (value: unknown): value is JSONContent => {
  return !!value && typeof value === 'object' && (value as any).type === 'doc';
};

const createEmptyDatabaseRowPageJson = (): JSONContent => ({
  type: 'doc',
  content: [{ type: 'paragraph' }],
});

const createDatabaseRowPageJsonFromText = (value: string): JSONContent => {
  const normalized = String(value || '').replace(/\r\n/g, '\n');
  if (!normalized) return createEmptyDatabaseRowPageJson();

  return {
    type: 'doc',
    content: normalized.split('\n').map((line) => (
      line
        ? { type: 'paragraph', content: [{ type: 'text', text: line }] }
        : { type: 'paragraph' }
    )),
  };
};

const getDatabaseRowPageInitialContent = (page: DatabaseRow['page']) => {
  return isDatabaseRowPageJson(page.contentJson)
    ? page.contentJson
    : createDatabaseRowPageJsonFromText(page.content || '');
};

const getDatabaseRowPageSignature = (page: DatabaseRow['page']) => {
  if (isDatabaseRowPageJson(page.contentJson)) return `json:${JSON.stringify(page.contentJson)}`;
  return `text:${page.content || ''}`;
};

type DatabaseFormulaResult = {
  value: number | string | boolean | null;
  error?: string;
};

type FormulaToken =
  | { type: 'number'; value: number }
  | { type: 'reference'; value: string }
  | { type: 'identifier'; value: string }
  | { type: 'operator' | 'paren' | 'comma'; value: string };

const isFormulaResultError = (result: DatabaseFormulaResult) => Boolean(result.error);

const tokenizeDatabaseFormula = (formula: string): FormulaToken[] => {
  const tokens: FormulaToken[] = [];
  let index = 0;

  while (index < formula.length) {
    const char = formula[index];

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (char === '{') {
      const end = formula.indexOf('}', index + 1);
      if (end === -1) throw new Error('缺少 }');
      const value = formula.slice(index + 1, end).trim();
      if (!value) throw new Error('空属性引用');
      tokens.push({ type: 'reference', value });
      index = end + 1;
      continue;
    }

    if (/[0-9.]/.test(char)) {
      const match = formula.slice(index).match(/^\d*\.?\d+/);
      if (!match) throw new Error('数字格式错误');
      tokens.push({ type: 'number', value: Number(match[0]) });
      index += match[0].length;
      continue;
    }

    if (/[a-z_]/i.test(char)) {
      const match = formula.slice(index).match(/^[a-z_][a-z0-9_]*/i);
      if (!match) throw new Error('函数名错误');
      tokens.push({ type: 'identifier', value: match[0].toLowerCase() });
      index += match[0].length;
      continue;
    }

    if ('+-*/'.includes(char)) {
      tokens.push({ type: 'operator', value: char });
      index += 1;
      continue;
    }

    if (char === '(' || char === ')') {
      tokens.push({ type: 'paren', value: char });
      index += 1;
      continue;
    }

    if (char === ',') {
      tokens.push({ type: 'comma', value: char });
      index += 1;
      continue;
    }

    throw new Error(`不支持的字符 ${char}`);
  }

  return tokens;
};

const toFormulaNumber = (value: unknown) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'boolean') return value ? 1 : 0;
  const text = String(value ?? '').trim();
  if (!text) return 0;
  const numeric = Number(text);
  return Number.isFinite(numeric) ? numeric : 0;
};

const formatDatabaseFormulaValue = (value: DatabaseFormulaResult['value']) => {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '';
    const rounded = Math.round(value * 1000000) / 1000000;
    return Number.isInteger(rounded) ? String(rounded) : String(rounded);
  }
  return String(value);
};

const evaluateDatabaseFormula = (
  database: SmartDocumentDatabase,
  row: DatabaseRow,
  property: DatabaseProperty,
  seen: Set<string> = new Set(),
): DatabaseFormulaResult => {
  const formula = String(property.formula || '').trim();
  if (!formula) return { value: '' };
  if (seen.has(property.id)) return { value: null, error: '循环引用' };

  const resolveReference = (reference: string): DatabaseFormulaResult => {
    const normalizedReference = reference.toLowerCase();
    const target = database.properties.find((item) => (
      item.id === reference ||
      item.name.toLowerCase() === normalizedReference
    ));

    if (!target) return { value: null, error: `找不到属性 ${reference}` };
    if (target.id === property.id) return { value: null, error: '循环引用' };
    if (target.type === 'formula') {
      return evaluateDatabaseFormula(database, row, target, new Set([...seen, property.id]));
    }
    if (target.type === 'checkbox') return { value: Boolean(row.cells[target.id]) };
    return { value: row.cells[target.id] ?? '' };
  };

  if (/^\{[^}]+\}$/.test(formula)) {
    return resolveReference(formula.slice(1, -1).trim());
  }

  try {
    const tokens = tokenizeDatabaseFormula(formula);
    let index = 0;

    const peek = () => tokens[index] || null;
    const consume = () => tokens[index++] || null;

    const parseExpression = (): number => {
      let value = parseTerm();

      while (peek()?.type === 'operator' && (peek()?.value === '+' || peek()?.value === '-')) {
        const operator = consume()?.value;
        const right = parseTerm();
        value = operator === '+' ? value + right : value - right;
      }

      return value;
    };

    const parseTerm = (): number => {
      let value = parseFactor();

      while (peek()?.type === 'operator' && (peek()?.value === '*' || peek()?.value === '/')) {
        const operator = consume()?.value;
        const right = parseFactor();
        value = operator === '*'
          ? value * right
          : right === 0
            ? Number.NaN
            : value / right;
      }

      return value;
    };

    const parseFunction = (name: string): number => {
      const open = consume();
      if (open?.type !== 'paren' || open.value !== '(') throw new Error('函数缺少 (');

      const args: number[] = [];
      if (peek()?.type === 'paren' && peek()?.value === ')') {
        consume();
      } else {
        while (true) {
          args.push(parseExpression());
          if (peek()?.type === 'comma') {
            consume();
            continue;
          }
          const close = consume();
          if (close?.type !== 'paren' || close.value !== ')') throw new Error('函数缺少 )');
          break;
        }
      }

      const finiteArgs = args.map((value) => Number.isFinite(value) ? value : 0);
      if (name === 'sum') return finiteArgs.reduce((total, value) => total + value, 0);
      if (name === 'avg') return finiteArgs.length ? finiteArgs.reduce((total, value) => total + value, 0) / finiteArgs.length : 0;
      if (name === 'min') return finiteArgs.length ? Math.min(...finiteArgs) : 0;
      if (name === 'max') return finiteArgs.length ? Math.max(...finiteArgs) : 0;
      if (name === 'round') return Math.round(finiteArgs[0] || 0);
      if (name === 'abs') return Math.abs(finiteArgs[0] || 0);
      if (name === 'ceil') return Math.ceil(finiteArgs[0] || 0);
      if (name === 'floor') return Math.floor(finiteArgs[0] || 0);

      throw new Error(`未知函数 ${name}`);
    };

    const parseFactor = (): number => {
      const token = consume();
      if (!token) throw new Error('公式不完整');

      if (token.type === 'operator' && token.value === '-') return -parseFactor();
      if (token.type === 'number') return token.value;
      if (token.type === 'reference') {
        const result = resolveReference(token.value);
        if (isFormulaResultError(result)) throw new Error(result.error);
        return toFormulaNumber(result.value);
      }
      if (token.type === 'identifier') return parseFunction(token.value);
      if (token.type === 'paren' && token.value === '(') {
        const value = parseExpression();
        const close = consume();
        if (close?.type !== 'paren' || close.value !== ')') throw new Error('缺少 )');
        return value;
      }

      throw new Error('公式格式错误');
    };

    const value = parseExpression();
    if (index < tokens.length) throw new Error('公式末尾有多余内容');
    if (!Number.isFinite(value)) return { value: null, error: '计算结果无效' };
    return { value };
  } catch (error: any) {
    return { value: null, error: error?.message || '公式错误' };
  }
};

const createDatabaseCells = (properties: DatabaseProperty[], existingCells: Record<string, any> = {}) => {
  return Object.fromEntries(properties.map((property) => [
    property.id,
    Object.prototype.hasOwnProperty.call(existingCells, property.id)
      ? normalizeDatabaseCellValue(property, existingCells[property.id])
      : getDefaultDatabaseCellValue(property),
  ]));
};

const normalizeDatabaseRowPage = (value: unknown): DatabaseRow['page'] => {
  const raw: any = value && typeof value === 'object' ? value : {};
  const content = String(raw.content || '');
  const contentText = raw.contentText !== undefined
    ? String(raw.contentText || '')
    : raw.text !== undefined
      ? String(raw.text || '')
      : content;
  const contentHtml = raw.contentHtml !== undefined
    ? String(raw.contentHtml || '')
    : raw.html !== undefined
      ? String(raw.html || '')
      : undefined;
  const contentJson = isDatabaseRowPageJson(raw.contentJson)
    ? raw.contentJson
    : isDatabaseRowPageJson(raw.content_json)
      ? raw.content_json
      : content
        ? createDatabaseRowPageJsonFromText(content)
        : null;

  return {
    content,
    contentJson,
    contentHtml,
    contentText,
    updatedAt: raw.updatedAt ? String(raw.updatedAt) : undefined,
  };
};

const createDatabaseRow = (properties: DatabaseProperty[], title: string = ''): DatabaseRow => {
  const titleProperty = properties.find((property) => property.type === 'title') || properties[0];
  const cells = createDatabaseCells(properties);

  if (titleProperty) cells[titleProperty.id] = title;

  return {
    id: createSmartDocumentId('row'),
    cells,
    page: normalizeDatabaseRowPage(null),
  };
};

const normalizeDatabaseSort = (value: any, properties: DatabaseProperty[]): DatabaseSort | null => {
  return value && properties.some((property) => property.id === value.propertyId)
    ? {
      propertyId: String(value.propertyId),
      direction: value.direction === 'desc' ? 'desc' : 'asc',
    }
    : null;
};

const normalizeDatabaseFilters = (value: unknown, propertyIds: Set<string>): DatabaseFilter[] => {
  return Array.isArray(value)
    ? value.map((filter: any) => {
      const propertyId = String(filter?.propertyId || '');
      if (!propertyIds.has(propertyId)) return null;

      return {
        id: String(filter?.id || createSmartDocumentId('filter')),
        propertyId,
        operator: normalizeFilterOperator(filter?.operator),
        value: String(filter?.value || ''),
      };
    }).filter(Boolean) as DatabaseFilter[]
    : [];
};

const normalizeDatabaseGroupBy = (value: unknown, propertyIds: Set<string>) => {
  const rawGroupBy = String(value || '');
  return propertyIds.has(rawGroupBy) ? rawGroupBy : null;
};

const normalizeDatabaseViews = (raw: any, properties: DatabaseProperty[], propertyIds: Set<string>): DatabaseViewConfig[] => {
  const legacyView = createDatabaseViewConfig(
    normalizeDatabaseViewMode(raw.view),
    String(raw.viewName || raw.view_name || '').trim() || getDatabaseViewModeLabel(normalizeDatabaseViewMode(raw.view)),
  );
  const legacyConfig: DatabaseViewConfig = {
    ...legacyView,
    filters: normalizeDatabaseFilters(raw.filters, propertyIds),
    groupBy: normalizeDatabaseGroupBy(raw.groupBy, propertyIds),
    sort: normalizeDatabaseSort(raw.sort, properties),
  };

  const sourceViews = Array.isArray(raw.views) && raw.views.length
    ? raw.views
    : [legacyConfig];

  const seen = new Set<string>();
  const views = sourceViews.map((view: any, index: number) => {
    const fallbackId = index === 0 ? legacyConfig.id : createSmartDocumentId('view');
    const id = String(view?.id || fallbackId);
    if (!id || seen.has(id)) return null;
    seen.add(id);

    const mode = normalizeDatabaseViewMode(view?.mode || view?.view || (index === 0 ? legacyConfig.mode : 'table'));
    const name = String(view?.name || view?.title || '').trim() || getDatabaseViewModeLabel(mode);

    return {
      id,
      name,
      mode,
      filters: normalizeDatabaseFilters(view?.filters, propertyIds),
      groupBy: normalizeDatabaseGroupBy(view?.groupBy, propertyIds),
      sort: normalizeDatabaseSort(view?.sort, properties),
    };
  }).filter(Boolean) as DatabaseViewConfig[];

  return views.length ? views : [legacyConfig];
};

const normalizeDatabase = (value: unknown): SmartDocumentDatabase => {
  const raw: any = value && typeof value === 'object' ? value : {};
  const fallback = createDefaultDatabase();
  const properties = Array.isArray(raw.properties)
    ? raw.properties.map((property: any, index: number) => {
      const type = index === 0 ? 'title' : normalizePropertyType(property?.type);
      const options = type === 'status'
        ? normalizeStatusOptions(property?.options)
        : undefined;
      const formula = type === 'formula'
        ? String(property?.formula || '').trim()
        : undefined;

      return {
        id: String(property?.id || createSmartDocumentId('prop')),
        name: String(property?.name || (index === 0 ? '名称' : '属性')).trim() || '属性',
        type,
        options,
        formula,
      };
    }).filter((property: DatabaseProperty) => property.id)
    : fallback.properties;

  if (!properties.some((property: DatabaseProperty) => property.type === 'title')) {
    properties.unshift({ id: createSmartDocumentId('prop'), name: '名称', type: 'title' });
  }

  const normalizedProperties = properties.map((property: DatabaseProperty, index: number) => ({
    ...property,
    type: index === 0 ? 'title' as DatabasePropertyType : property.type,
  }));

  const sourceRows = Array.isArray(raw.rows) && raw.rows.length ? raw.rows : fallback.rows;
  const rows = sourceRows
    .map((row: any) => {
      const existingCells = row?.cells && typeof row.cells === 'object' ? row.cells : {};
      return {
        id: String(row?.id || createSmartDocumentId('row')),
        cells: createDatabaseCells(normalizedProperties, existingCells),
        page: normalizeDatabaseRowPage(row?.page),
      };
    }).filter((row: DatabaseRow) => row.id);
  const normalizedRows = rows.length ? rows : [createDatabaseRow(normalizedProperties, '新条目')];

  const propertyIds = new Set<string>(normalizedProperties.map((property: DatabaseProperty) => property.id));
  const views = normalizeDatabaseViews(raw, normalizedProperties, propertyIds);
  const requestedActiveViewId = String(raw.activeViewId || raw.active_view_id || '');
  const activeView = views.find((item) => item.id === requestedActiveViewId) || views[0];

  return {
    id: String(raw.id || fallback.id),
    title: String(raw.title || fallback.title),
    view: activeView.mode,
    views,
    activeViewId: activeView.id,
    properties: normalizedProperties,
    rows: normalizedRows,
    filters: activeView.filters,
    groupBy: activeView.groupBy,
    sort: activeView.sort,
  };
};

const getCellDisplayValue = (database: SmartDocumentDatabase, row: DatabaseRow, property: DatabaseProperty) => {
  if (property.type === 'formula') {
    const result = evaluateDatabaseFormula(database, row, property);
    return result.error ? `#${result.error}` : formatDatabaseFormulaValue(result.value);
  }
  if (property.type === 'checkbox') return row.cells[property.id] ? 'true' : '';
  return String(row.cells[property.id] || '').trim();
};

const getCellSortValue = (database: SmartDocumentDatabase, row: DatabaseRow, property: DatabaseProperty) => {
  if (property.type === 'formula') {
    const result = evaluateDatabaseFormula(database, row, property);
    if (result.error) return `#${result.error}`.toLowerCase();
    if (typeof result.value === 'number') return result.value;
    if (typeof result.value === 'boolean') return result.value ? 1 : 0;
    return String(result.value || '').toLowerCase();
  }
  const value = row.cells[property.id];
  if (property.type === 'checkbox') return value ? 1 : 0;
  if (property.type === 'number') return Number(value || 0);
  return String(value || '').toLowerCase();
};

const getCellTextValue = (database: SmartDocumentDatabase, row: DatabaseRow, property: DatabaseProperty) => {
  return getCellDisplayValue(database, row, property);
};

const filterNeedsValue = (operator: DatabaseFilterOperator) => {
  return DATABASE_FILTER_OPERATORS.find((item) => item.value === operator)?.needsValue ?? true;
};

const rowMatchesFilter = (database: SmartDocumentDatabase, row: DatabaseRow, property: DatabaseProperty, filter: DatabaseFilter) => {
  const cellValue = getCellTextValue(database, row, property);
  const filterValue = String(filter.value || '').trim();

  if (filter.operator === 'not_empty') return Boolean(cellValue);
  if (filter.operator === 'empty') return !cellValue;
  if (filter.operator === 'equals') return cellValue.toLowerCase() === filterValue.toLowerCase();
  return cellValue.toLowerCase().includes(filterValue.toLowerCase());
};

const getFilteredDatabaseRows = (database: SmartDocumentDatabase) => {
  if (!database.filters.length) return database.rows;

  return database.rows.filter((row) => (
    database.filters.every((filter) => {
      const property = database.properties.find((item) => item.id === filter.propertyId);
      if (!property) return true;
      if (filterNeedsValue(filter.operator) && !String(filter.value || '').trim()) return true;
      return rowMatchesFilter(database, row, property, filter);
    })
  ));
};

const getSortedDatabaseRows = (database: SmartDocumentDatabase) => {
  if (!database.sort) return database.rows;

  const property = database.properties.find((item) => item.id === database.sort?.propertyId);
  if (!property) return database.rows;

  return [...database.rows].sort((left, right) => {
    const leftValue = getCellSortValue(database, left, property);
    const rightValue = getCellSortValue(database, right, property);
    if (leftValue < rightValue) return database.sort?.direction === 'desc' ? 1 : -1;
    if (leftValue > rightValue) return database.sort?.direction === 'desc' ? -1 : 1;
    return 0;
  });
};

const getVisibleDatabaseRows = (database: SmartDocumentDatabase) => {
  return getSortedDatabaseRows({ ...database, rows: getFilteredDatabaseRows(database) });
};

const getDatabaseGroupLabel = (database: SmartDocumentDatabase, row: DatabaseRow, property: DatabaseProperty) => {
  if (property.type === 'checkbox') return row.cells[property.id] ? '已勾选' : '未勾选';
  return getCellTextValue(database, row, property) || EMPTY_DATABASE_GROUP;
};

const getDatabaseGroups = (database: SmartDocumentDatabase, rows: DatabaseRow[], property: DatabaseProperty | null) => {
  if (!property) {
    return [{ label: '全部', rows }];
  }

  const labels = property.type === 'status'
    ? [...(property.options?.length ? property.options : DEFAULT_STATUS_OPTIONS)]
    : property.type === 'checkbox'
      ? ['未勾选', '已勾选']
      : [];

  for (const row of rows) {
    const label = getDatabaseGroupLabel(database, row, property);
    if (!labels.includes(label)) labels.push(label);
  }

  return labels.map((label) => ({
    label,
    rows: rows.filter((row) => getDatabaseGroupLabel(database, row, property) === label),
  }));
};

const getDatabaseDateKey = (row: DatabaseRow, property?: DatabaseProperty | null) => {
  if (!property) return '';
  const rawValue = String(row.cells[property.id] || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(rawValue) ? rawValue : '';
};

const parseDatabaseDateKey = (dateKey: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, month, day);
  return Number.isNaN(date.getTime()) ? null : date;
};

const toDatabaseDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const formatDatabaseMonth = (date: Date) => {
  return `${date.getFullYear()}年${date.getMonth() + 1}月`;
};

const shiftDatabaseMonth = (date: Date, offset: number) => {
  return new Date(date.getFullYear(), date.getMonth() + offset, 1);
};

const getDatabaseCalendarDays = (month: Date) => {
  const firstDay = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(firstDay);
  start.setDate(firstDay.getDate() - firstDay.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
};

const getDatabaseRowTitle = (row: DatabaseRow, property: DatabaseProperty) => {
  return String(row.cells[property.id] || '').trim() || '未命名';
};

const getDatabasePropertyPreview = (database: SmartDocumentDatabase, row: DatabaseRow, property?: DatabaseProperty | null) => {
  if (!property) return '';
  if (property.type === 'checkbox') return row.cells[property.id] ? '已勾选' : '未勾选';
  return getCellDisplayValue(database, row, property);
};

type DatabaseRowPageEditorValue = {
  content: string;
  contentJson: JSONContent;
  contentHtml: string;
  contentText: string;
};

type SmartDocumentStorageLike = {
  uploadImage?: (file: File) => Promise<string | null>;
  uploadFile?: (file: File) => Promise<string | null>;
  pages?: any[];
  currentDocumentId?: string | null;
};

const DatabaseRowPageImage = TiptapImage.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: '100%',
        parseHTML: element => element.getAttribute('data-width') || element.getAttribute('width') || element.style.width || '100%',
        renderHTML: attributes => ({
          width: attributes.width || '100%',
          'data-width': attributes.width || '100%',
          style: `width: ${attributes.width || '100%'}; max-width: 100%; height: auto;`,
        }),
      },
      align: {
        default: 'center',
        parseHTML: element => element.getAttribute('data-align') || 'center',
        renderHTML: attributes => ({ 'data-align': attributes.align || 'center' }),
      },
    };
  },
});

const DatabaseRowPageToolbarButton = ({
  title,
  active,
  disabled,
  onClick,
  children,
}: {
  title: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) => (
  <button
    type="button"
    title={title}
    disabled={disabled}
    onMouseDown={(event) => event.preventDefault()}
    onClick={onClick}
    className={`flex h-7 min-w-7 items-center justify-center gap-1 rounded px-1.5 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
      active ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'
    }`}
  >
    {children}
  </button>
);

const DatabaseRowPageEditor = ({
  page,
  smartDocument,
  onChange,
}: {
  page: DatabaseRow['page'];
  smartDocument?: SmartDocumentStorageLike;
  onChange: (value: DatabaseRowPageEditorValue) => void;
}) => {
  const pageSignature = getDatabaseRowPageSignature(page);
  const externalSigRef = useRef(pageSignature);
  const uploadImage = smartDocument?.uploadImage || smartDocument?.uploadFile;

  const rowPageEditor = useEditor({
    extensions: [
      StarterKit.configure({
        bulletList: {
          keepMarks: true,
          keepAttributes: false,
        },
        orderedList: {
          keepMarks: true,
          keepAttributes: false,
        },
      }),
      LinkExtension.configure({ openOnClick: false }),
      DatabaseRowPageImage.configure({
        inline: false,
        allowBase64: true,
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: '输入条目详情，或输入 / 插入块' }),
      ColumnList,
      Column,
      SlashCommand.configure({
        suggestion: {
          items: getSuggestionItems,
          render: renderItems,
        },
      }),
      Indent,
      MindMap,
      ToggleBlock,
      CalloutBlock,
      BookmarkBlock,
      EmbedBlock,
      MediaBlock,
      TemplateButtonBlock,
      SyncedBlock,
      PageLinkBlock,
      EquationBlock,
      DatabaseBlock,
      Table.configure({
        resizable: true,
      }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: getDatabaseRowPageInitialContent(page),
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none min-h-[180px] rounded-b-md bg-white px-4 py-3 text-gray-800 outline-none whitespace-pre-wrap break-words [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5 [&_ul[data-type="taskList"]]:list-none [&_ul[data-type="taskList"]]:pl-0 [&_li_p]:m-0 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-gray-200 [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-gray-200 [&_th]:bg-gray-50 [&_th]:px-2 [&_th]:py-1',
      },
      handlePaste: (view, event) => {
        const item = Array.from(event.clipboardData?.items || []).find((entry) => entry.kind === 'file' && entry.type.startsWith('image/'));
        const file = item?.getAsFile();
        if (!file || typeof uploadImage !== 'function') return false;

        event.preventDefault();
        uploadImage(file).then((url) => {
          if (!url) return;
          const node = view.state.schema.nodes.image.create({ src: url, width: '100%', align: 'center' });
          view.dispatch(view.state.tr.replaceSelectionWith(node).scrollIntoView());
        });
        return true;
      },
      handleDrop: (view, event, _slice, moved) => {
        const file = !moved && event.dataTransfer?.files?.[0];
        if (!file || !file.type.startsWith('image/') || typeof uploadImage !== 'function') return false;

        event.preventDefault();
        uploadImage(file).then((url) => {
          if (!url) return;
          const coordinates = view.posAtCoords({ left: event.clientX, top: event.clientY });
          const node = view.state.schema.nodes.image.create({ src: url, width: '100%', align: 'center' });
          const tr = coordinates
            ? view.state.tr.insert(coordinates.pos, node)
            : view.state.tr.replaceSelectionWith(node);
          view.dispatch(tr.scrollIntoView());
        });
        return true;
      },
    },
    onUpdate: ({ editor }) => {
      const contentJson = editor.getJSON();
      const contentHtml = editor.getHTML();
      const contentText = editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n');
      externalSigRef.current = `json:${JSON.stringify(contentJson)}`;
      onChange({
        content: contentText,
        contentJson,
        contentHtml,
        contentText,
      });
    },
  });

  useEffect(() => {
    if (!rowPageEditor) return;
    const storage = rowPageEditor.storage as typeof rowPageEditor.storage & {
      smartDocument?: SmartDocumentStorageLike;
    };
    storage.smartDocument = {
      ...(storage.smartDocument || {}),
      ...(smartDocument || {}),
    };
  }, [rowPageEditor, smartDocument]);

  useEffect(() => {
    if (!rowPageEditor) return;
    if (pageSignature === externalSigRef.current) return;
    if (rowPageEditor.isFocused) return;

    rowPageEditor.commands.setContent(getDatabaseRowPageInitialContent(page), { emitUpdate: false });
    externalSigRef.current = pageSignature;
  }, [page, pageSignature, rowPageEditor]);

  const addImage = () => {
    if (!rowPageEditor || typeof uploadImage !== 'function') return;

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const url = await uploadImage(file);
      if (url) rowPageEditor.chain().focus().setImage({ src: url, width: '100%', align: 'center' } as any).run();
      input.value = '';
    };
    input.click();
  };

  if (!rowPageEditor) return null;

  return (
    <div
      className="overflow-hidden rounded-md border border-gray-200 bg-white"
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      contentEditable={false}
    >
      <div className="flex flex-wrap items-center gap-1 border-b border-gray-100 bg-gray-50 px-2 py-1.5">
        <DatabaseRowPageToolbarButton title="正文" active={rowPageEditor.isActive('paragraph')} onClick={() => rowPageEditor.chain().focus().setParagraph().run()}>
          <Type className="h-3.5 w-3.5" />
        </DatabaseRowPageToolbarButton>
        <DatabaseRowPageToolbarButton title="一级标题" active={rowPageEditor.isActive('heading', { level: 1 })} onClick={() => rowPageEditor.chain().focus().toggleHeading({ level: 1 }).run()}>
          H1
        </DatabaseRowPageToolbarButton>
        <DatabaseRowPageToolbarButton title="二级标题" active={rowPageEditor.isActive('heading', { level: 2 })} onClick={() => rowPageEditor.chain().focus().toggleHeading({ level: 2 }).run()}>
          H2
        </DatabaseRowPageToolbarButton>
        <DatabaseRowPageToolbarButton title="粗体" active={rowPageEditor.isActive('bold')} onClick={() => rowPageEditor.chain().focus().toggleBold().run()}>
          <Bold className="h-3.5 w-3.5" />
        </DatabaseRowPageToolbarButton>
        <DatabaseRowPageToolbarButton title="斜体" active={rowPageEditor.isActive('italic')} onClick={() => rowPageEditor.chain().focus().toggleItalic().run()}>
          <Italic className="h-3.5 w-3.5" />
        </DatabaseRowPageToolbarButton>
        <DatabaseRowPageToolbarButton title="删除线" active={rowPageEditor.isActive('strike')} onClick={() => rowPageEditor.chain().focus().toggleStrike().run()}>
          <Strikethrough className="h-3.5 w-3.5" />
        </DatabaseRowPageToolbarButton>
        <DatabaseRowPageToolbarButton title="行内代码" active={rowPageEditor.isActive('code')} onClick={() => rowPageEditor.chain().focus().toggleCode().run()}>
          <Code className="h-3.5 w-3.5" />
        </DatabaseRowPageToolbarButton>
        <span className="mx-1 h-4 w-px bg-gray-200" />
        <DatabaseRowPageToolbarButton title="项目列表" active={rowPageEditor.isActive('bulletList')} onClick={() => rowPageEditor.chain().focus().toggleBulletList().run()}>
          <List className="h-3.5 w-3.5" />
        </DatabaseRowPageToolbarButton>
        <DatabaseRowPageToolbarButton title="编号列表" active={rowPageEditor.isActive('orderedList')} onClick={() => rowPageEditor.chain().focus().toggleOrderedList().run()}>
          <ListOrdered className="h-3.5 w-3.5" />
        </DatabaseRowPageToolbarButton>
        <DatabaseRowPageToolbarButton title="待办" active={rowPageEditor.isActive('taskList')} onClick={() => rowPageEditor.chain().focus().toggleTaskList().run()}>
          <CheckSquare className="h-3.5 w-3.5" />
        </DatabaseRowPageToolbarButton>
        <DatabaseRowPageToolbarButton title="引用" active={rowPageEditor.isActive('blockquote')} onClick={() => rowPageEditor.chain().focus().toggleBlockquote().run()}>
          <Quote className="h-3.5 w-3.5" />
        </DatabaseRowPageToolbarButton>
        <DatabaseRowPageToolbarButton title="代码块" active={rowPageEditor.isActive('codeBlock')} onClick={() => rowPageEditor.chain().focus().toggleCodeBlock().run()}>
          <Code className="h-3.5 w-3.5" />
        </DatabaseRowPageToolbarButton>
        <DatabaseRowPageToolbarButton title="分隔线" onClick={() => rowPageEditor.chain().focus().setHorizontalRule().run()}>
          <Minus className="h-3.5 w-3.5" />
        </DatabaseRowPageToolbarButton>
        <DatabaseRowPageToolbarButton title="表格" onClick={() => rowPageEditor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>
          <Database className="h-3.5 w-3.5" />
        </DatabaseRowPageToolbarButton>
        <DatabaseRowPageToolbarButton title="图片" disabled={typeof uploadImage !== 'function'} onClick={addImage}>
          <ImageIcon className="h-3.5 w-3.5" />
        </DatabaseRowPageToolbarButton>
        <span className="ml-auto hidden text-[11px] text-gray-400 sm:inline">输入 / 插入更多块</span>
      </div>
      <EditorContent editor={rowPageEditor} />
    </div>
  );
};

const DatabaseBlockView = ({ node, updateAttributes, selected, editor }: any) => {
  const database = normalizeDatabase(node.attrs.database);
  const commentsAttr = Array.isArray(node.attrs.blockComments) && node.attrs.blockComments.length
    ? encodeJsonAttribute(node.attrs.blockComments)
    : undefined;
  const titleProperty = database.properties.find((property) => property.type === 'title') || database.properties[0];
  const boardProperty = database.properties.find((property) => property.type === 'status') || database.properties.find((property) => property.type === 'text');
  const dateProperty = database.properties.find((property) => property.type === 'date') || null;
  const urlProperty = database.properties.find((property) => property.type === 'url') || null;
  const galleryMetaProperties = database.properties.filter((property) => property.id !== titleProperty.id && property.type !== 'url').slice(0, 3);
  const rows = getVisibleDatabaseRows(database);
  const visibleDateKeys = dateProperty
    ? rows.map((row) => getDatabaseDateKey(row, dateProperty)).filter(Boolean)
    : [];
  const visibleDateSignature = visibleDateKeys.join('|');
  const filteredOutCount = Math.max(0, database.rows.length - getFilteredDatabaseRows(database).length);
  const groupProperty = database.groupBy
    ? database.properties.find((property) => property.id === database.groupBy) || null
    : null;
  const boardGroupProperty = groupProperty || boardProperty || titleProperty || null;
  const statusProperties = database.properties.filter((property) => property.type === 'status');
  const activeView = database.views.find((view) => view.id === database.activeViewId) || database.views[0];
  const [filterDraft, setFilterDraft] = useState<Pick<DatabaseFilter, 'propertyId' | 'operator' | 'value'>>({
    propertyId: database.properties[0]?.id || '',
    operator: 'contains',
    value: '',
  });
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const firstDateKey = database.rows
      .map((row) => getDatabaseDateKey(row, dateProperty))
      .find(Boolean);
    return parseDatabaseDateKey(firstDateKey || '') || new Date();
  });
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  const propertySignature = database.properties.map((property) => property.id).join('|');
  const openRow = openRowId ? database.rows.find((row) => row.id === openRowId) || null : null;

  useEffect(() => {
    if (!filterDraft.propertyId || !database.properties.some((property) => property.id === filterDraft.propertyId)) {
      setFilterDraft((current) => ({
        ...current,
        propertyId: database.properties[0]?.id || '',
      }));
    }
  }, [database.properties, filterDraft.propertyId, propertySignature]);

  useEffect(() => {
    if ((database.view !== 'calendar' && database.view !== 'timeline') || !dateProperty || !visibleDateKeys.length) return;

    const hasCurrentMonthRows = visibleDateKeys.some((dateKey) => {
      const date = parseDatabaseDateKey(dateKey);
      return date && date.getFullYear() === calendarMonth.getFullYear() && date.getMonth() === calendarMonth.getMonth();
    });
    if (hasCurrentMonthRows) return;

    const firstVisibleDate = parseDatabaseDateKey(visibleDateKeys[0]);
    if (firstVisibleDate) {
      setCalendarMonth(new Date(firstVisibleDate.getFullYear(), firstVisibleDate.getMonth(), 1));
    }
  }, [calendarMonth, database.view, dateProperty, visibleDateKeys, visibleDateSignature]);

  useEffect(() => {
    if (openRowId && !database.rows.some((row) => row.id === openRowId)) {
      setOpenRowId(null);
    }
  }, [database.rows, openRowId]);

  const commit = (nextDatabase: SmartDocumentDatabase) => {
    updateAttributes({ database: normalizeDatabase(nextDatabase) });
  };

  const commitWithActiveView = (nextDatabase: SmartDocumentDatabase, nextActiveView: DatabaseViewConfig) => {
    commit({
      ...nextDatabase,
      activeViewId: nextActiveView.id,
      view: nextActiveView.mode,
      filters: nextActiveView.filters,
      groupBy: nextActiveView.groupBy,
      sort: nextActiveView.sort,
    });
  };

  const updateActiveView = (patch: Partial<DatabaseViewConfig>) => {
    if (!activeView) return;
    const nextActiveView = {
      ...activeView,
      ...patch,
      name: String((patch.name ?? activeView.name) || '').trim() || getDatabaseViewModeLabel(patch.mode || activeView.mode),
    };
    const views = database.views.map((view) => view.id === nextActiveView.id ? nextActiveView : view);
    commitWithActiveView({ ...database, views }, nextActiveView);
  };

  const selectDatabaseView = (viewId: string) => {
    const nextActiveView = database.views.find((view) => view.id === viewId);
    if (!nextActiveView) return;
    commitWithActiveView({ ...database }, nextActiveView);
  };

  const addDatabaseView = () => {
    const nextViewNumber = database.views.length + 1;
    const nextView = createDatabaseViewConfig('table', `视图 ${nextViewNumber}`);
    commitWithActiveView({ ...database, views: [...database.views, nextView] }, nextView);
  };

  const deleteActiveDatabaseView = () => {
    if (!activeView || database.views.length <= 1) return;
    const activeIndex = database.views.findIndex((view) => view.id === activeView.id);
    const views = database.views.filter((view) => view.id !== activeView.id);
    const nextActiveView = views[Math.max(0, activeIndex - 1)] || views[0];
    commitWithActiveView({ ...database, views }, nextActiveView);
  };

  const updateTitle = (title: string) => commit({ ...database, title });
  const updateView = (view: DatabaseViewMode) => updateActiveView({ mode: view });
  const updateGroupBy = (propertyId: string) => {
    updateActiveView({ groupBy: propertyId || null });
  };

  const addFilter = () => {
    const property = database.properties.find((item) => item.id === filterDraft.propertyId);
    if (!property) return;
    const operator = normalizeFilterOperator(filterDraft.operator);
    const value = filterNeedsValue(operator) ? filterDraft.value.trim() : '';
    if (filterNeedsValue(operator) && !value) return;

    updateActiveView({
      filters: [
        ...database.filters,
        {
          id: createSmartDocumentId('filter'),
          propertyId: property.id,
          operator,
          value,
        },
      ],
    });
    setFilterDraft((current) => ({ ...current, value: '' }));
  };

  const deleteFilter = (filterId: string) => {
    updateActiveView({ filters: database.filters.filter((filter) => filter.id !== filterId) });
  };

  const updateStatusOptions = (propertyId: string, value: string) => {
    const properties = database.properties.map((property) => (
      property.id === propertyId && property.type === 'status'
        ? { ...property, options: normalizeStatusOptions(value) }
        : property
    ));

    commit({
      ...database,
      properties,
      rows: database.rows.map((row) => ({ ...row, cells: createDatabaseCells(properties, row.cells) })),
    });
  };

  const formatFilterLabel = (filter: DatabaseFilter) => {
    const property = database.properties.find((item) => item.id === filter.propertyId);
    const operator = DATABASE_FILTER_OPERATORS.find((item) => item.value === filter.operator);
    return `${property?.name || '属性'} ${operator?.label || '包含'}${filterNeedsValue(filter.operator) ? ` ${filter.value}` : ''}`;
  };

  const updateSort = (propertyId: string) => {
    const current = database.sort;
    if (current?.propertyId !== propertyId) {
      updateActiveView({ sort: { propertyId, direction: 'asc' } });
      return;
    }
    if (current.direction === 'asc') {
      updateActiveView({ sort: { propertyId, direction: 'desc' } });
      return;
    }
    updateActiveView({ sort: null });
  };

  const addProperty = () => {
    const propertyId = createSmartDocumentId('prop');
    commit({
      ...database,
      properties: [...database.properties, { id: propertyId, name: '属性', type: 'text' }],
      rows: database.rows.map((row) => ({ ...row, cells: { ...row.cells, [propertyId]: '' } })),
    });
  };

  const updateProperty = (propertyId: string, patch: Partial<DatabaseProperty>) => {
    const properties = database.properties.map((property, index) => {
      if (property.id !== propertyId) return property;
      const nextType = index === 0 ? 'title' : (patch.type ? normalizePropertyType(patch.type) : property.type);
      return {
        ...property,
        ...patch,
        type: nextType,
        options: nextType === 'status' ? (property.options?.length ? property.options : DEFAULT_STATUS_OPTIONS) : undefined,
        formula: nextType === 'formula' ? String(patch.formula ?? property.formula ?? '') : undefined,
      };
    });
    commit({
      ...database,
      properties,
      rows: database.rows.map((row) => ({ ...row, cells: createDatabaseCells(properties, row.cells) })),
    });
  };

  const deleteProperty = (propertyId: string) => {
    const property = database.properties.find((item) => item.id === propertyId);
    if (!property || property.type === 'title') return;
    const views = database.views.map((view) => ({
      ...view,
      filters: view.filters.filter((filter) => filter.propertyId !== propertyId),
      groupBy: view.groupBy === propertyId ? null : view.groupBy,
      sort: view.sort?.propertyId === propertyId ? null : view.sort,
    }));
    const nextActiveView = views.find((view) => view.id === database.activeViewId) || views[0];

    commitWithActiveView({
      ...database,
      views,
      properties: database.properties.filter((item) => item.id !== propertyId),
      rows: database.rows.map((row) => {
        const { [propertyId]: _removed, ...cells } = row.cells;
        return { ...row, cells };
      }),
    }, nextActiveView);
  };

  const addRow = () => {
    const rowId = createSmartDocumentId('row');
    const cells = createDatabaseCells(database.properties);
    commit({ ...database, rows: [...database.rows, { id: rowId, cells, page: normalizeDatabaseRowPage(null) }] });
  };

  const deleteRow = (rowId: string) => {
    if (openRowId === rowId) setOpenRowId(null);
    commit({ ...database, rows: database.rows.filter((row) => row.id !== rowId) });
  };

  const updateCell = (rowId: string, propertyId: string, value: any) => {
    commit({
      ...database,
      rows: database.rows.map((row) => row.id === rowId ? { ...row, cells: { ...row.cells, [propertyId]: value } } : row),
    });
  };

  const updateRowPageContent = (rowId: string, patch: Partial<DatabaseRow['page']>) => {
    commit({
      ...database,
      rows: database.rows.map((row) => row.id === rowId
        ? {
          ...row,
          page: {
            ...normalizeDatabaseRowPage(row.page),
            ...patch,
            updatedAt: new Date().toISOString(),
          },
        }
        : row),
    });
  };

  const renderCellInput = (row: DatabaseRow, property: DatabaseProperty) => {
    const rawValue = row.cells[property.id];
    const inputClass = 'h-8 w-full min-w-0 rounded border border-transparent bg-transparent px-2 text-xs text-gray-700 outline-none hover:border-gray-200 focus:border-gray-400 focus:bg-white focus:ring-2 focus:ring-gray-100';

    if (property.type === 'checkbox') {
      return <input type="checkbox" checked={Boolean(rawValue)} onChange={(event) => updateCell(row.id, property.id, event.target.checked)} className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-400" />;
    }

    if (property.type === 'status') {
      const options = property.options?.length ? property.options : DEFAULT_STATUS_OPTIONS;
      return (
        <select value={String(rawValue || options[0] || '')} onChange={(event) => updateCell(row.id, property.id, event.target.value)} className={inputClass}>
          {options.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      );
    }

    if (property.type === 'date') return <input type="date" value={String(rawValue || '')} onInput={(event) => updateCell(row.id, property.id, (event.target as HTMLInputElement).value)} onChange={(event) => updateCell(row.id, property.id, event.target.value)} className={inputClass} />;
    if (property.type === 'number') return <input type="number" value={String(rawValue || '')} onInput={(event) => updateCell(row.id, property.id, (event.target as HTMLInputElement).value)} onChange={(event) => updateCell(row.id, property.id, event.target.value)} className={inputClass} />;
    if (property.type === 'url') return <input type="url" value={String(rawValue || '')} onInput={(event) => updateCell(row.id, property.id, (event.target as HTMLInputElement).value)} onChange={(event) => updateCell(row.id, property.id, event.target.value)} className={inputClass} placeholder="https://" />;
    if (property.type === 'formula') {
      const result = evaluateDatabaseFormula(database, row, property);
      const formulaText = String(property.formula || '').trim();
      const displayValue = result.error ? `#${result.error}` : formatDatabaseFormulaValue(result.value);
      return (
        <div
          title={formulaText || '未设置公式'}
          className={`flex h-8 min-w-0 items-center rounded px-2 text-xs ${
            result.error
              ? 'bg-red-50 text-red-600'
              : formulaText
                ? 'bg-gray-50 font-medium text-gray-700'
                : 'bg-gray-50 text-gray-400'
          }`}
        >
          <span className="truncate">{formulaText ? displayValue : '设置公式'}</span>
        </div>
      );
    }

    return <input type="text" value={String(rawValue || '')} onChange={(event) => updateCell(row.id, property.id, event.target.value)} className={`${inputClass} ${property.type === 'title' ? 'font-medium text-gray-900' : ''}`} />;
  };

  const renderDatabaseControls = () => (
    <div className="space-y-2 border-b border-gray-100 bg-gray-50/40 px-3 py-2" contentEditable={false}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold text-gray-500">筛选</span>
        <select
          value={filterDraft.propertyId}
          onChange={(event) => setFilterDraft((current) => ({ ...current, propertyId: event.target.value }))}
          className="h-7 max-w-32 rounded border border-gray-200 bg-white px-2 text-xs text-gray-600 outline-none focus:border-gray-400"
        >
          {database.properties.map((property) => <option key={property.id} value={property.id}>{property.name}</option>)}
        </select>
        <select
          value={filterDraft.operator}
          onChange={(event) => setFilterDraft((current) => ({ ...current, operator: event.target.value as DatabaseFilterOperator }))}
          className="h-7 rounded border border-gray-200 bg-white px-2 text-xs text-gray-600 outline-none focus:border-gray-400"
        >
          {DATABASE_FILTER_OPERATORS.map((operator) => <option key={operator.value} value={operator.value}>{operator.label}</option>)}
        </select>
        {filterNeedsValue(filterDraft.operator) && (
          <input
            value={filterDraft.value}
            onChange={(event) => setFilterDraft((current) => ({ ...current, value: event.target.value }))}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                addFilter();
              }
            }}
            className="h-7 w-36 rounded border border-gray-200 bg-white px-2 text-xs text-gray-700 outline-none focus:border-gray-400"
          />
        )}
        <button
          type="button"
          onClick={addFilter}
          disabled={filterNeedsValue(filterDraft.operator) && !filterDraft.value.trim()}
          className="flex h-7 items-center gap-1 rounded border border-gray-200 bg-white px-2 text-xs font-medium text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" /> 添加
        </button>

        <span className="ml-0 text-[11px] font-semibold text-gray-500 sm:ml-3">分组</span>
        <select
          value={database.groupBy || ''}
          onChange={(event) => updateGroupBy(event.target.value)}
          className="h-7 max-w-36 rounded border border-gray-200 bg-white px-2 text-xs text-gray-600 outline-none focus:border-gray-400"
        >
          <option value="">无分组</option>
          {database.properties.map((property) => <option key={property.id} value={property.id}>{property.name}</option>)}
        </select>
        {filteredOutCount > 0 && <span className="text-[11px] text-gray-400">已隐藏 {filteredOutCount} 条</span>}
      </div>

      {(database.filters.length > 0 || statusProperties.length > 0) && (
        <div className="flex flex-wrap items-center gap-2">
          {database.filters.map((filter) => (
            <button
              key={filter.id}
              type="button"
              onClick={() => deleteFilter(filter.id)}
              className="flex h-7 items-center gap-1 rounded-full border border-gray-200 bg-white px-2 text-[11px] text-gray-600 hover:border-red-200 hover:bg-red-50 hover:text-red-600"
            >
              {formatFilterLabel(filter)}
              <Trash2 className="h-3 w-3" />
            </button>
          ))}
          {statusProperties.map((property) => (
            <label key={property.id} className="flex min-w-0 items-center gap-1 text-[11px] text-gray-500">
              <span className="max-w-20 truncate">{property.name}</span>
              <input
                value={(property.options?.length ? property.options : DEFAULT_STATUS_OPTIONS).join(', ')}
                onChange={(event) => updateStatusOptions(property.id, event.target.value)}
                className="h-7 w-44 rounded border border-gray-200 bg-white px-2 text-xs text-gray-700 outline-none focus:border-gray-400"
              />
            </label>
          ))}
        </div>
      )}
    </div>
  );

  const renderOpenRowButton = (row: DatabaseRow) => (
    <button
      type="button"
      title="打开详情"
      onClick={() => setOpenRowId(row.id)}
      className={`flex h-7 w-7 items-center justify-center rounded ${
        openRowId === row.id
          ? 'bg-gray-900 text-white'
          : 'text-gray-300 hover:bg-gray-100 hover:text-gray-600'
      }`}
    >
      <FileText className="h-3.5 w-3.5" />
    </button>
  );

  const renderTableRow = (row: DatabaseRow) => (
    <tr key={row.id} className="group">
      {database.properties.map((property) => (
        <td key={property.id} className="border-b border-r border-gray-100 px-2 py-1 align-middle last:border-r-0">
          {renderCellInput(row, property)}
        </td>
      ))}
      <td className="border-b border-gray-100 px-2 py-1">
        <div className="flex items-center gap-1">
          {renderOpenRowButton(row)}
          <button type="button" onClick={() => deleteRow(row.id)} className="flex h-7 w-7 items-center justify-center rounded text-gray-300 opacity-0 hover:bg-red-50 hover:text-red-500 group-hover:opacity-100">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </td>
    </tr>
  );

  const renderTableView = () => (
    <div className="overflow-x-auto">
      <table className="min-w-full border-separate border-spacing-0 text-left">
        <thead>
          <tr>
            {database.properties.map((property, index) => (
              <th key={property.id} className="min-w-40 border-b border-r border-gray-100 bg-gray-50 px-2 py-2 align-top last:border-r-0">
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => updateSort(property.id)} className="flex min-w-0 flex-1 items-center gap-1 rounded px-1 py-0.5 text-left text-[11px] font-semibold text-gray-500 hover:bg-gray-100">
                    <span className="truncate">{property.name}</span>
                    {database.sort?.propertyId === property.id && <span className="text-[10px] text-gray-400">{database.sort.direction === 'asc' ? '↑' : '↓'}</span>}
                  </button>
                  <select value={property.type} disabled={property.type === 'title'} onChange={(event) => updateProperty(property.id, { type: event.target.value as DatabasePropertyType })} className="h-6 w-16 rounded border border-gray-200 bg-white px-1 text-[10px] font-normal text-gray-500 disabled:opacity-60">
                    {DATABASE_PROPERTY_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                  </select>
                  {index > 0 && (
                    <button type="button" onClick={() => deleteProperty(property.id)} className="rounded p-1 text-gray-300 hover:bg-red-50 hover:text-red-500">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
                <input value={property.name} onChange={(event) => updateProperty(property.id, { name: event.target.value })} className="mt-1 h-6 w-full rounded border border-transparent bg-transparent px-1 text-[11px] font-normal text-gray-600 outline-none hover:border-gray-200 focus:border-gray-400 focus:bg-white" />
                {property.type === 'formula' && (
                  <label className="mt-1 flex min-w-0 items-center gap-1 rounded border border-gray-200 bg-white px-1.5 py-1 text-[10px] font-normal text-gray-500">
                    <Sigma className="h-3 w-3 flex-shrink-0" />
                    <input
                      value={property.formula || ''}
                      onChange={(event) => updateProperty(property.id, { formula: event.target.value })}
                      placeholder="{数字} * 2"
                      className="min-w-0 flex-1 border-none bg-transparent px-0 text-[11px] text-gray-700 outline-none placeholder:text-gray-300 focus:ring-0"
                    />
                  </label>
                )}
              </th>
            ))}
            <th className="w-10 border-b border-gray-100 bg-gray-50 px-2 py-2">
              <button type="button" onClick={addProperty} className="flex h-7 w-7 items-center justify-center rounded text-gray-500 hover:bg-gray-100">
                <Plus className="h-4 w-4" />
              </button>
            </th>
          </tr>
        </thead>
        {groupProperty ? (
          getDatabaseGroups(database, rows, groupProperty).map((group) => (
            <tbody key={group.label}>
              <tr>
                <td colSpan={database.properties.length + 1} className="border-b border-gray-100 bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-500">
                  {group.label} <span className="font-normal text-gray-400">{group.rows.length}</span>
                </td>
              </tr>
              {group.rows.map(renderTableRow)}
            </tbody>
          ))
        ) : (
          <tbody>{rows.map(renderTableRow)}</tbody>
        )}
      </table>
      <button type="button" onClick={addRow} className="mt-2 flex items-center gap-1 rounded px-2 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100">
        <Plus className="h-3.5 w-3.5" /> 新建
      </button>
    </div>
  );

  const renderListRow = (row: DatabaseRow) => (
    <div key={row.id} className="group px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <input value={String(row.cells[titleProperty.id] || '')} onChange={(event) => updateCell(row.id, titleProperty.id, event.target.value)} className="min-w-0 flex-1 border-none bg-transparent px-0 text-sm font-medium text-gray-900 outline-none focus:ring-0" />
        <div className="flex items-center gap-1">
          {renderOpenRowButton(row)}
          <button type="button" onClick={() => deleteRow(row.id)} className="rounded p-1 text-gray-300 opacity-0 hover:bg-red-50 hover:text-red-500 group-hover:opacity-100">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {database.properties.filter((property) => property.id !== titleProperty.id).map((property) => (
          <label key={property.id} className="flex min-w-0 items-center gap-2 text-xs text-gray-500">
            <span className="w-16 flex-shrink-0 truncate">{property.name}</span>
            <span className="min-w-0 flex-1">{renderCellInput(row, property)}</span>
          </label>
        ))}
      </div>
    </div>
  );

  const renderListView = () => (
    <div className="divide-y divide-gray-100 rounded border border-gray-100">
      {groupProperty
        ? getDatabaseGroups(database, rows, groupProperty).map((group) => (
          <div key={group.label}>
            <div className="bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-500">
              {group.label} <span className="font-normal text-gray-400">{group.rows.length}</span>
            </div>
            {group.rows.map(renderListRow)}
          </div>
        ))
        : rows.map(renderListRow)}
      <button type="button" onClick={addRow} className="flex w-full items-center gap-1 px-3 py-2 text-xs font-medium text-gray-500 hover:bg-gray-50">
        <Plus className="h-3.5 w-3.5" /> 新建
      </button>
    </div>
  );

  const renderBoardView = () => {
    const groups = getDatabaseGroups(database, rows, boardGroupProperty);

    return (
      <div className="grid gap-3 md:grid-cols-3">
        {groups.map((group) => (
          <div key={group.label} className="min-w-0 rounded border border-gray-100 bg-gray-50/60">
            <div className="border-b border-gray-100 px-3 py-2 text-xs font-semibold text-gray-600">
              {group.label} <span className="font-normal text-gray-400">{group.rows.length}</span>
            </div>
            <div className="space-y-2 p-2">
              {group.rows.map((row) => (
                <div key={row.id} className="group rounded border border-gray-200 bg-white p-2 shadow-sm">
                  <div className="flex items-start gap-2">
                    <input value={String(row.cells[titleProperty.id] || '')} onChange={(event) => updateCell(row.id, titleProperty.id, event.target.value)} className="min-w-0 flex-1 border-none bg-transparent px-0 text-sm font-medium text-gray-900 outline-none focus:ring-0" />
                    {renderOpenRowButton(row)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderCalendarView = () => {
    if (!dateProperty) {
      return (
        <div className="flex min-h-32 flex-col items-center justify-center rounded border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center">
          <CalendarDays className="mb-2 h-5 w-5 text-gray-400" />
          <div className="text-sm font-medium text-gray-600">需要日期属性</div>
          <div className="mt-1 text-xs text-gray-400">添加或保留一个日期列后，日历视图会按日期排列条目。</div>
        </div>
      );
    }

    const todayKey = toDatabaseDateKey(new Date());
    const calendarDays = getDatabaseCalendarDays(calendarMonth);
    const rowsByDate = rows.reduce<Record<string, DatabaseRow[]>>((acc, row) => {
      const dateKey = getDatabaseDateKey(row, dateProperty);
      if (!dateKey) return acc;
      acc[dateKey] = [...(acc[dateKey] || []), row];
      return acc;
    }, {});
    const unscheduledRows = rows.filter((row) => !getDatabaseDateKey(row, dateProperty));

    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-800">
            <CalendarDays className="h-4 w-4 text-gray-500" />
            {formatDatabaseMonth(calendarMonth)}
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setCalendarMonth(shiftDatabaseMonth(calendarMonth, -1))} className="rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-600 hover:bg-gray-50">上月</button>
            <button type="button" onClick={() => setCalendarMonth(new Date())} className="rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-600 hover:bg-gray-50">今天</button>
            <button type="button" onClick={() => setCalendarMonth(shiftDatabaseMonth(calendarMonth, 1))} className="rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-600 hover:bg-gray-50">下月</button>
          </div>
        </div>

        <div className="grid grid-cols-7 overflow-hidden rounded border border-gray-100 text-xs">
          {['日', '一', '二', '三', '四', '五', '六'].map((day) => (
            <div key={day} className="border-b border-r border-gray-100 bg-gray-50 px-2 py-1 text-center font-semibold text-gray-500 last:border-r-0">{day}</div>
          ))}
          {calendarDays.map((day) => {
            const dateKey = toDatabaseDateKey(day);
            const dayRows = rowsByDate[dateKey] || [];
            const outsideMonth = day.getMonth() !== calendarMonth.getMonth();
            const isToday = dateKey === todayKey;

            return (
              <div key={dateKey} className={`min-h-24 border-b border-r border-gray-100 p-1.5 last:border-r-0 ${outsideMonth ? 'bg-gray-50/70 text-gray-300' : 'bg-white text-gray-700'}`}>
                <div className={`mb-1 flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-medium ${isToday ? 'bg-gray-900 text-white' : ''}`}>
                  {day.getDate()}
                </div>
                <div className="space-y-1">
                  {dayRows.slice(0, 3).map((row) => (
                    <div key={row.id} className="group flex items-center gap-1">
                      <input
                        value={getDatabaseRowTitle(row, titleProperty)}
                        onChange={(event) => updateCell(row.id, titleProperty.id, event.target.value)}
                        className="h-6 min-w-0 flex-1 rounded border border-gray-100 bg-gray-50 px-1.5 text-[11px] font-medium text-gray-700 outline-none focus:border-gray-400 focus:bg-white"
                      />
                      <button
                        type="button"
                        title="打开详情"
                        onClick={() => setOpenRowId(row.id)}
                        className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-gray-300 opacity-0 hover:bg-gray-100 hover:text-gray-600 group-hover:opacity-100"
                      >
                        <FileText className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                  {dayRows.length > 3 && <div className="px-1 text-[10px] text-gray-400">+{dayRows.length - 3}</div>}
                </div>
              </div>
            );
          })}
        </div>

        {unscheduledRows.length > 0 && (
          <div className="rounded border border-gray-100 bg-gray-50 px-3 py-2">
            <div className="mb-2 text-xs font-semibold text-gray-500">未排期 {unscheduledRows.length}</div>
            <div className="flex flex-wrap gap-2">
              {unscheduledRows.map((row) => (
                <div key={row.id} className="flex min-w-40 items-center gap-1 rounded border border-gray-200 bg-white px-2">
                  <input
                    value={getDatabaseRowTitle(row, titleProperty)}
                    onChange={(event) => updateCell(row.id, titleProperty.id, event.target.value)}
                    className="h-7 min-w-0 flex-1 border-none bg-transparent px-0 text-xs font-medium text-gray-700 outline-none focus:ring-0"
                  />
                  {renderOpenRowButton(row)}
                </div>
              ))}
            </div>
          </div>
        )}

        <button type="button" onClick={addRow} className="flex items-center gap-1 rounded px-2 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100">
          <Plus className="h-3.5 w-3.5" /> 新建
        </button>
      </div>
    );
  };

  const renderTimelineView = () => {
    if (!dateProperty) {
      return (
        <div className="flex min-h-32 flex-col items-center justify-center rounded border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center">
          <CalendarDays className="mb-2 h-5 w-5 text-gray-400" />
          <div className="text-sm font-medium text-gray-600">需要日期属性</div>
          <div className="mt-1 text-xs text-gray-400">添加或保留一个日期列后，时间轴视图会按日期展示条目。</div>
        </div>
      );
    }

    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const dayNumbers = Array.from({ length: daysInMonth }, (_, index) => index + 1);
    const timelineGridStyle = { gridTemplateColumns: `repeat(${daysInMonth}, minmax(56px, 1fr))` };
    const currentMonthRows = rows.filter((row) => {
      const date = parseDatabaseDateKey(getDatabaseDateKey(row, dateProperty));
      return date && date.getFullYear() === year && date.getMonth() === month;
    });
    const unscheduledRows = rows.filter((row) => !getDatabaseDateKey(row, dateProperty));
    const sortTimelineRows = (groupRows: DatabaseRow[]) => [...groupRows].sort((left, right) => (
      getDatabaseDateKey(left, dateProperty).localeCompare(getDatabaseDateKey(right, dateProperty)) ||
      getDatabaseRowTitle(left, titleProperty).localeCompare(getDatabaseRowTitle(right, titleProperty))
    ));

    const renderTimelineLane = (row: DatabaseRow) => {
      const dateKey = getDatabaseDateKey(row, dateProperty);
      const date = parseDatabaseDateKey(dateKey);
      const dayNumber = Math.max(1, Math.min(daysInMonth, date?.getDate() || 1));
      const endColumn = Math.min(daysInMonth + 1, dayNumber + 7);
      const startColumn = Math.max(1, Math.min(dayNumber, endColumn - 6));

      return (
        <div key={row.id} className="relative min-w-[900px] overflow-hidden rounded border border-gray-100 bg-white">
          <div className="grid min-h-16" style={timelineGridStyle}>
            {dayNumbers.map((day) => (
              <div key={day} className="border-r border-gray-100 bg-gray-50/40 last:border-r-0" />
            ))}
          </div>
          <div className="absolute inset-0 grid items-center px-1" style={timelineGridStyle}>
            <div
              className="group flex min-w-[360px] items-center gap-1 rounded border border-gray-200 bg-white px-2 py-1.5 shadow-sm"
              style={{ gridColumn: `${startColumn} / ${endColumn}` }}
            >
              <div className="h-2 w-2 flex-shrink-0 rounded-full bg-gray-900" />
              <input
                value={getDatabaseRowTitle(row, titleProperty)}
                onChange={(event) => updateCell(row.id, titleProperty.id, event.target.value)}
                className="min-w-0 flex-1 border-none bg-transparent px-0 text-xs font-semibold text-gray-800 outline-none focus:ring-0"
              />
              <input
                type="date"
                value={dateKey}
                onInput={(event) => updateCell(row.id, dateProperty.id, (event.target as HTMLInputElement).value)}
                onChange={(event) => updateCell(row.id, dateProperty.id, event.target.value)}
                className="h-7 w-32 rounded border border-gray-100 bg-gray-50 px-1.5 text-[11px] text-gray-500 outline-none focus:border-gray-400 focus:bg-white"
              />
              {renderOpenRowButton(row)}
              <button type="button" onClick={() => deleteRow(row.id)} className="flex h-7 w-7 items-center justify-center rounded text-gray-300 opacity-0 hover:bg-red-50 hover:text-red-500 group-hover:opacity-100">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      );
    };

    const timelineGroups = groupProperty
      ? getDatabaseGroups(database, currentMonthRows, groupProperty).filter((group) => group.rows.length > 0)
      : [{ label: '', rows: currentMonthRows }];

    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-800">
            <CalendarDays className="h-4 w-4 text-gray-500" />
            {formatDatabaseMonth(calendarMonth)}
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setCalendarMonth(shiftDatabaseMonth(calendarMonth, -1))} className="rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-600 hover:bg-gray-50">上月</button>
            <button type="button" onClick={() => setCalendarMonth(new Date())} className="rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-600 hover:bg-gray-50">今天</button>
            <button type="button" onClick={() => setCalendarMonth(shiftDatabaseMonth(calendarMonth, 1))} className="rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-600 hover:bg-gray-50">下月</button>
          </div>
        </div>

        <div className="overflow-x-auto rounded border border-gray-100 bg-gray-50/60">
          <div className="grid min-w-[900px] border-b border-gray-100 text-[10px] font-medium text-gray-400" style={timelineGridStyle}>
            {dayNumbers.map((day) => (
              <div key={day} className="border-r border-gray-100 px-1.5 py-1 last:border-r-0">
                {day === 1 || day === daysInMonth || day % 5 === 0 ? day : ''}
              </div>
            ))}
          </div>
          <div className="space-y-2 p-2">
            {currentMonthRows.length === 0 ? (
              <div className="flex min-h-20 items-center justify-center rounded border border-dashed border-gray-200 bg-white px-4 text-xs text-gray-400">
                本月暂无条目
              </div>
            ) : (
              timelineGroups.map((group) => (
                <div key={group.label || 'all'} className="space-y-2">
                  {group.label && (
                    <div className="px-1 text-xs font-semibold text-gray-500">
                      {group.label} <span className="font-normal text-gray-400">{group.rows.length}</span>
                    </div>
                  )}
                  {sortTimelineRows(group.rows).map(renderTimelineLane)}
                </div>
              ))
            )}
          </div>
        </div>

        {unscheduledRows.length > 0 && (
          <div className="rounded border border-gray-100 bg-gray-50 px-3 py-2">
            <div className="mb-2 text-xs font-semibold text-gray-500">未排期 {unscheduledRows.length}</div>
            <div className="flex flex-wrap gap-2">
              {unscheduledRows.map((row) => (
                <div key={row.id} className="flex min-w-40 items-center gap-1 rounded border border-gray-200 bg-white px-2">
                  <input
                    value={getDatabaseRowTitle(row, titleProperty)}
                    onChange={(event) => updateCell(row.id, titleProperty.id, event.target.value)}
                    className="h-7 min-w-0 flex-1 border-none bg-transparent px-0 text-xs font-medium text-gray-700 outline-none focus:ring-0"
                  />
                  {renderOpenRowButton(row)}
                </div>
              ))}
            </div>
          </div>
        )}

        <button type="button" onClick={addRow} className="flex items-center gap-1 rounded px-2 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100">
          <Plus className="h-3.5 w-3.5" /> 新建
        </button>
      </div>
    );
  };

  const renderGalleryCard = (row: DatabaseRow) => {
    const urlValue = getDatabasePropertyPreview(database, row, urlProperty);

    return (
      <div key={row.id} className="group min-w-0 rounded border border-gray-200 bg-white p-3 shadow-sm transition-colors hover:border-gray-300">
        <div className="mb-3 flex h-24 items-center justify-center rounded bg-gray-50 text-xs font-medium text-gray-400">
          {urlValue ? (
            <a href={urlValue} target="_blank" rel="noopener noreferrer" className="max-w-full truncate px-3 text-gray-500 no-underline hover:text-primary">
              {urlValue}
            </a>
          ) : (
            <span>无封面</span>
          )}
        </div>
        <div className="flex items-start gap-2">
          <input
            value={getDatabaseRowTitle(row, titleProperty)}
            onChange={(event) => updateCell(row.id, titleProperty.id, event.target.value)}
            className="min-w-0 flex-1 border-none bg-transparent px-0 text-sm font-semibold text-gray-900 outline-none focus:ring-0"
          />
          <div className="flex items-center gap-1">
            {renderOpenRowButton(row)}
            <button type="button" onClick={() => deleteRow(row.id)} className="rounded p-1 text-gray-300 opacity-0 hover:bg-red-50 hover:text-red-500 group-hover:opacity-100">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <div className="mt-2 space-y-1">
          {galleryMetaProperties.map((property) => (
            <label key={property.id} className="flex min-w-0 items-center gap-2 text-xs text-gray-500">
              <span className="w-14 flex-shrink-0 truncate">{property.name}</span>
              <span className="min-w-0 flex-1">{renderCellInput(row, property)}</span>
            </label>
          ))}
        </div>
      </div>
    );
  };

  const renderGalleryGrid = (groupRows: DatabaseRow[]) => (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {groupRows.map(renderGalleryCard)}
    </div>
  );

  const renderGalleryView = () => (
    <div className="space-y-3">
      {groupProperty
        ? getDatabaseGroups(database, rows, groupProperty).map((group) => (
          <div key={group.label} className="space-y-2">
            <div className="text-xs font-semibold text-gray-500">
              {group.label} <span className="font-normal text-gray-400">{group.rows.length}</span>
            </div>
            {renderGalleryGrid(group.rows)}
          </div>
        ))
        : renderGalleryGrid(rows)}
      <button type="button" onClick={addRow} className="flex items-center gap-1 rounded px-2 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100">
        <Plus className="h-3.5 w-3.5" /> 新建
      </button>
    </div>
  );

  const renderRowDetailPanel = () => {
    if (!openRow) return null;

    const rowPage = normalizeDatabaseRowPage(openRow.page);

    return (
      <div className="border-b border-gray-100 bg-white px-3 py-3" contentEditable={false}>
        <div className="rounded-md border border-gray-200 bg-gray-50/50">
          <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-3 py-2">
            <div className="flex min-w-0 items-center gap-2">
              <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded border border-gray-200 bg-white text-gray-500">
                <FileText className="h-3.5 w-3.5" />
              </span>
              <input
                value={getDatabaseRowTitle(openRow, titleProperty)}
                onChange={(event) => updateCell(openRow.id, titleProperty.id, event.target.value)}
                className="min-w-0 flex-1 border-none bg-transparent px-0 text-sm font-semibold text-gray-900 outline-none focus:ring-0"
              />
            </div>
            <button
              type="button"
              title="关闭"
              onClick={() => setOpenRowId(null)}
              className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid gap-2 border-b border-gray-100 px-3 py-3 sm:grid-cols-2">
            {database.properties.filter((property) => property.id !== titleProperty.id).map((property) => (
              <label key={property.id} className="flex min-w-0 items-center gap-2 text-xs text-gray-500">
                <span className="w-20 flex-shrink-0 truncate">{property.name}</span>
                <span className="min-w-0 flex-1">{renderCellInput(openRow, property)}</span>
              </label>
            ))}
          </div>

          <div className="px-3 py-3">
            <DatabaseRowPageEditor
              key={openRow.id}
              page={rowPage}
              smartDocument={editor?.storage?.smartDocument}
              onChange={(value) => updateRowPageContent(openRow.id, value)}
            />
            {rowPage.updatedAt && (
              <div className="mt-1 text-[11px] text-gray-400">
                更新于 {new Date(rowPage.updatedAt).toLocaleString('zh-CN')}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <NodeViewWrapper
      className={`smart-doc-database my-4 overflow-hidden rounded-md border bg-white transition-colors ${
        selected ? 'border-gray-400 shadow-sm' : 'border-gray-200 hover:border-gray-300'
      }`}
      data-type="database"
      data-database={encodeJsonAttribute(database)}
      data-block-id={node.attrs.blockId || undefined}
      data-comments={commentsAttr}
      id={blockDomId(node.attrs.blockId)}
      contentEditable={false}
    >
      <div className="space-y-3 border-b border-gray-100 px-3 py-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-2">
            <Database className="h-4 w-4 flex-shrink-0 text-gray-500" />
            <input value={database.title} onChange={(event) => updateTitle(event.target.value)} className="min-w-0 flex-1 border-none bg-transparent px-0 text-sm font-semibold text-gray-900 outline-none focus:ring-0" />
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {database.views.map((view) => (
              <button
                key={view.id}
                type="button"
                onClick={() => selectDatabaseView(view.id)}
                className={`flex h-7 max-w-40 items-center gap-1 rounded px-2 text-xs font-medium transition-colors ${
                  activeView?.id === view.id
                    ? 'bg-gray-900 text-white'
                    : 'text-gray-500 hover:bg-gray-100'
                }`}
                title={`${view.name} · ${getDatabaseViewModeLabel(view.mode)}`}
              >
                <span className="truncate">{view.name}</span>
              </button>
            ))}
            <button type="button" onClick={addDatabaseView} className="flex h-7 items-center gap-1 rounded border border-gray-200 bg-white px-2 text-xs font-medium text-gray-500 hover:bg-gray-100">
              <Plus className="h-3.5 w-3.5" /> 视图
            </button>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-2">
            <input
              value={activeView?.name || ''}
              onChange={(event) => updateActiveView({ name: event.target.value })}
              className="h-7 min-w-0 rounded border border-gray-200 bg-white px-2 text-xs font-medium text-gray-700 outline-none focus:border-gray-400"
              aria-label="数据库视图名称"
            />
            <button
              type="button"
              onClick={deleteActiveDatabaseView}
              disabled={database.views.length <= 1}
              className="flex h-7 w-7 items-center justify-center rounded text-gray-300 hover:bg-red-50 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-30"
              title="删除当前视图"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {DATABASE_VIEW_OPTIONS.map((view) => (
              <button key={view.value} type="button" onClick={() => updateView(view.value)} className={`rounded px-2 py-1 text-xs font-medium ${database.view === view.value ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-100'}`}>
                {view.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      {renderDatabaseControls()}
      {renderRowDetailPanel()}
      <div className="p-3">
        {database.view === 'list'
          ? renderListView()
          : database.view === 'board'
            ? renderBoardView()
            : database.view === 'calendar'
              ? renderCalendarView()
              : database.view === 'timeline'
                ? renderTimelineView()
                : database.view === 'gallery'
                  ? renderGalleryView()
                  : renderTableView()}
      </div>
    </NodeViewWrapper>
  );
};

export const DatabaseBlock = Node.create({
  name: 'databaseBlock',
  group: 'block',
  atom: true,
  defining: true,

  addAttributes() {
    return {
      database: {
        default: null,
        parseHTML: element => decodeJsonAttribute(element.getAttribute('data-database')) || createDefaultDatabase(),
        renderHTML: attributes => ({ 'data-database': encodeJsonAttribute(normalizeDatabase(attributes.database)) }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="database"]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const database = normalizeDatabase(node.attrs.database);
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'database',
        'data-database': encodeJsonAttribute(database),
        class: 'smart-doc-database my-4 overflow-hidden rounded-md border border-gray-200 bg-white',
      }),
      ['div', { class: 'border-b border-gray-100 px-3 py-2 text-sm font-semibold text-gray-900' }, database.title],
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(DatabaseBlockView)
  },
});

type SmartDocumentPageLinkOption = {
  id: string;
  title: string;
  category?: string;
};

const normalizePageTitle = (title: string | null | undefined) => {
  return (title || '').trim() || '未命名文档';
};

const getPageLinkView = (category?: string | null) => {
  return category === 'note' || !category ? 'notes' : 'sop';
};

const getPageLinkHref = (pageId?: string | null, category?: string | null) => {
  if (!pageId) return '#';
  return `/notes?view=${getPageLinkView(category)}&doc=${encodeURIComponent(pageId)}`;
};

const getPageLinkCategoryLabel = (category?: string | null) => {
  if (category === 'note' || !category) return '文档';
  if (category === 'people') return '识人 SOP';
  if (category === 'business') return '商业 SOP';
  if (category === 'brand') return '品牌 SOP';
  return 'SOP';
};

const getPageLinkOptions = (editor: any): SmartDocumentPageLinkOption[] => {
  const pages = editor?.storage?.smartDocument?.pages;
  if (!Array.isArray(pages)) return [];

  return pages
    .map((page: any) => ({
      id: String(page?.id || ''),
      title: normalizePageTitle(page?.title),
      category: typeof page?.category === 'string' ? page.category : 'note',
    }))
    .filter((page) => page.id);
};

const PageLinkBlockView = ({ node, updateAttributes, selected, editor }: any) => {
  const pageId = node.attrs.pageId || '';
  const title = normalizePageTitle(node.attrs.title);
  const category = node.attrs.category || 'note';
  const pages = getPageLinkOptions(editor);
  const currentDocumentId = editor?.storage?.smartDocument?.currentDocumentId || '';
  const selectedPage = pages.find((page) => page.id === pageId);
  const displayTitle = selectedPage?.title || title;
  const displayCategory = selectedPage?.category || category;
  const href = getPageLinkHref(pageId, displayCategory);
  const commentsAttr = Array.isArray(node.attrs.blockComments) && node.attrs.blockComments.length
    ? encodeJsonAttribute(node.attrs.blockComments)
    : undefined;
  const selectOptions = pages.filter((page) => page.id !== currentDocumentId || page.id === pageId);

  const handleSelectPage = (event: any) => {
    const nextPageId = event.target.value;
    const nextPage = pages.find((page) => page.id === nextPageId);

    if (!nextPage) {
      updateAttributes({ pageId: '', title: '', category: 'note' });
      return;
    }

    updateAttributes({
      pageId: nextPage.id,
      title: nextPage.title,
      category: nextPage.category || 'note',
    });
  };

  return (
    <NodeViewWrapper
      className={`smart-doc-page-link group my-2 rounded-md border bg-white px-3 py-2 transition-colors ${
        selected ? 'border-gray-400 shadow-sm' : 'border-gray-200 hover:border-gray-300'
      }`}
      data-type="page-link"
      data-page-id={pageId || undefined}
      data-title={displayTitle || undefined}
      data-category={displayCategory || undefined}
      data-block-id={node.attrs.blockId || undefined}
      data-comments={commentsAttr}
      id={blockDomId(node.attrs.blockId)}
      contentEditable={false}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <a
          href={href}
          className={`flex min-w-0 flex-1 items-center gap-2 text-sm font-medium no-underline ${
            pageId ? 'text-gray-800 hover:text-primary' : 'pointer-events-none text-gray-400'
          }`}
          onClick={(event) => {
            if (!pageId) event.preventDefault();
          }}
        >
          <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded border border-gray-200 bg-gray-50 text-gray-500">
            <FileText className="h-3.5 w-3.5" />
          </span>
          <span className="min-w-0 flex-1 truncate">{pageId ? displayTitle : '选择页面'}</span>
          {pageId && <span className="flex-shrink-0 text-[11px] font-normal text-gray-400">{getPageLinkCategoryLabel(displayCategory)}</span>}
        </a>

        <select
          value={pageId}
          onChange={handleSelectPage}
          className="h-8 max-w-full rounded border border-gray-200 bg-white px-2 text-xs text-gray-600 outline-none focus:border-gray-400 focus:ring-2 focus:ring-gray-100 sm:w-44"
        >
          <option value="">选择页面...</option>
          {selectOptions.map((page) => (
            <option key={page.id} value={page.id}>
              {page.title}
            </option>
          ))}
        </select>
      </div>
    </NodeViewWrapper>
  );
};

export const PageLinkBlock = Node.create({
  name: 'pageLinkBlock',
  group: 'block',
  atom: true,
  defining: true,

  addAttributes() {
    return {
      pageId: {
        default: '',
        parseHTML: element => element.getAttribute('data-page-id') || '',
        renderHTML: attributes => ({ 'data-page-id': attributes.pageId || undefined }),
      },
      title: {
        default: '',
        parseHTML: element => element.getAttribute('data-title') || element.textContent?.trim() || '',
        renderHTML: attributes => ({ 'data-title': attributes.title || undefined }),
      },
      category: {
        default: 'note',
        parseHTML: element => element.getAttribute('data-category') || 'note',
        renderHTML: attributes => ({ 'data-category': attributes.category || 'note' }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'a[data-type="page-link"]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const pageId = node.attrs.pageId || '';
    const title = normalizePageTitle(node.attrs.title);
    const category = node.attrs.category || 'note';

    return [
      'a',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'page-link',
        href: getPageLinkHref(pageId, category),
        class: 'smart-doc-page-link my-2 flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-800 no-underline hover:bg-gray-50',
      }),
      title,
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(PageLinkBlockView)
  },
});

const renderEquation = (formula: string) => {
  const source = formula.trim() || DEFAULT_EQUATION;
  try {
    return katex.renderToString(source, {
      displayMode: true,
      throwOnError: false,
      strict: false,
      output: 'html',
    });
  } catch {
    return katex.renderToString(DEFAULT_EQUATION, {
      displayMode: true,
      throwOnError: false,
      strict: false,
      output: 'html',
    });
  }
};

const decodeEquationAttribute = (value: string | null) => {
  if (!value) return '';
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const EquationBlockView = ({ node, updateAttributes, selected }: any) => {
  const formula = node.attrs.formula || DEFAULT_EQUATION;
  const [draft, setDraft] = useState(formula);
  const previewHtml = useMemo(() => renderEquation(draft), [draft]);
  const commentsAttr = Array.isArray(node.attrs.blockComments) && node.attrs.blockComments.length
    ? encodeJsonAttribute(node.attrs.blockComments)
    : undefined;

  useEffect(() => {
    setDraft(formula);
  }, [formula]);

  const commit = () => {
    const next = draft.trim() || DEFAULT_EQUATION;
    setDraft(next);
    if (next !== formula) updateAttributes({ formula: next });
  };

  return (
    <NodeViewWrapper
      className={`smart-doc-equation group my-3 rounded-md border bg-white px-4 py-3 transition-colors ${
        selected ? 'border-gray-400 shadow-sm' : 'border-gray-200 hover:border-gray-300'
      }`}
      data-type="equation"
      data-equation={encodeURIComponent(formula)}
      data-block-id={node.attrs.blockId || undefined}
      data-comments={commentsAttr}
      id={blockDomId(node.attrs.blockId)}
      contentEditable={false}
    >
      <div
        className="min-h-10 overflow-x-auto rounded bg-gray-50 px-3 py-3 text-center text-gray-900"
        aria-label={formula}
        dangerouslySetInnerHTML={{ __html: previewHtml }}
      />
      <textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault();
            commit();
          }
        }}
        placeholder="输入 LaTeX 公式"
        className="mt-2 min-h-12 w-full resize-y rounded border border-gray-200 bg-white px-3 py-2 font-mono text-xs text-gray-700 outline-none focus:border-gray-400 focus:ring-2 focus:ring-gray-100"
      />
    </NodeViewWrapper>
  );
};

export const EquationBlock = Node.create({
  name: 'equationBlock',
  group: 'block',
  atom: true,
  defining: true,

  addAttributes() {
    return {
      formula: {
        default: DEFAULT_EQUATION,
        parseHTML: element => decodeEquationAttribute(element.getAttribute('data-equation')) || element.textContent?.trim() || DEFAULT_EQUATION,
        renderHTML: attributes => ({
          'data-equation': encodeURIComponent(attributes.formula || DEFAULT_EQUATION),
        }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="equation"]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const formula = node.attrs.formula || DEFAULT_EQUATION;
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'equation',
        'data-equation': encodeURIComponent(formula),
        class: 'smart-doc-equation my-3 rounded-md border border-gray-200 bg-white px-4 py-3 text-center font-mono text-sm text-gray-800',
      }),
      formula,
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(EquationBlockView)
  },
});


// --- Slash Command Extension ---

const CommandList = forwardRef((props: any, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  const selectItem = (index: number) => {
    const item = props.items[index];

    if (item) {
      props.command(item);
    }
  };

  useEffect(() => {
    setSelectedIndex(0);
  }, [props.items]);

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }: { event: KeyboardEvent }) => {
      if (event.key === 'ArrowUp') {
        setSelectedIndex((selectedIndex + props.items.length - 1) % props.items.length);
        return true;
      }

      if (event.key === 'ArrowDown') {
        setSelectedIndex((selectedIndex + 1) % props.items.length);
        return true;
      }

      if (event.key === 'Enter') {
        selectItem(selectedIndex);
        return true;
      }

      return false;
    },
  }));

  return (
    <div className="bg-white rounded-lg shadow-xl border border-gray-100 overflow-hidden w-64 p-1 max-h-[300px] overflow-y-auto">
      {props.items.length ? (
        props.items.map((item: any, index: number) => (
          <button
            className={`flex items-center w-full px-2 py-2 text-sm text-left rounded-md transition-colors ${
              index === selectedIndex ? 'bg-gray-100 text-primary' : 'text-gray-700 hover:bg-gray-50'
            }`}
            key={index}
            onClick={() => selectItem(index)}
          >
            <div className="flex items-center justify-center w-5 h-5 mr-3 rounded bg-gray-50 border border-gray-200 text-gray-500">
                {item.icon}
            </div>
            <div className="flex flex-col flex-1">
                <span className="font-medium">{item.title}</span>
                {item.shortcut && <span className="text-[10px] text-gray-400 font-mono">{item.shortcut}</span>}
            </div>
          </button>
        ))
      ) : (
        <div className="px-2 py-2 text-sm text-gray-400">无匹配命令</div>
      )}
    </div>
  );
});

export const SlashCommand = Extension.create({
  name: 'slashCommand',

  addOptions() {
    return {
      suggestion: {
        char: '/',
        command: ({ editor, range, props }: any) => {
          props.command({ editor, range });
        },
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
      }),
    ];
  },
});

const getMediaKind = (file: File) => {
  const mime = file.type || '';
  const name = file.name || '';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime === 'application/pdf' || /\.pdf$/i.test(name)) return 'pdf';
  return 'file';
};

const insertUploadedMedia = ({ editor, range, accept, forcedKind }: any) => {
  editor.chain().focus().deleteRange(range).run();
  const uploadFile = editor.storage?.smartDocument?.uploadFile || editor.storage?.smartDocument?.uploadImage;
  if (typeof uploadFile !== 'function') return;

  const input = document.createElement('input');
  input.type = 'file';
  if (accept) input.accept = accept;
  input.onchange = async () => {
    if (!input.files?.length) return;
    const file = input.files[0];
    const url = await uploadFile(file);
    if (!url) return;

    editor.chain().focus().insertContent({
      type: 'mediaBlock',
      attrs: {
        url,
        name: file.name,
        mime: file.type || '',
        size: file.size,
        kind: forcedKind || getMediaKind(file),
      },
    }).run();
  };
  input.click();
};

const promptForUrl = (label: string) => {
  const url = window.prompt(label);
  if (!url) return '';
  return url.trim();
};

export const getSuggestionItems = ({ query }: { query: string }) => {
  return [
    {
      title: '一级标题',
      shortcut: '/bt1',
      icon: <Heading1 className="w-3 h-3" />,
      command: ({ editor, range }: any) => {
        editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run();
      },
    },
    {
      title: '二级标题',
      shortcut: '/bt2',
      icon: <Heading2 className="w-3 h-3" />,
      command: ({ editor, range }: any) => {
        editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run();
      },
    },
    {
      title: '三级标题',
      shortcut: '/bt3',
      icon: <Heading3 className="w-3 h-3" />,
      command: ({ editor, range }: any) => {
        editor.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run();
      },
    },
    {
      title: '普通文本',
      shortcut: '/wb',
      icon: <Type className="w-3 h-3" />,
      command: ({ editor, range }: any) => {
        editor.chain().focus().deleteRange(range).setParagraph().run();
      },
    },
    {
      title: '项目列表',
      shortcut: '/xmlb',
      icon: <List className="w-3 h-3" />,
      command: ({ editor, range }: any) => {
        editor.chain().focus().deleteRange(range).toggleBulletList().run();
      },
    },
    {
      title: '编号列表',
      shortcut: '/bhlb',
      icon: <ListOrdered className="w-3 h-3" />,
      command: ({ editor, range }: any) => {
        editor.chain().focus().deleteRange(range).toggleOrderedList().run();
      },
    },
    {
      title: '待办列表',
      shortcut: '/dblb',
      icon: <CheckSquare className="w-3 h-3" />,
      command: ({ editor, range }: any) => {
        editor.chain().focus().deleteRange(range).toggleTaskList().run();
      },
    },
    {
        title: '引用文字',
        shortcut: '/yywz',
        icon: <Quote className="w-3 h-3" />,
        command: ({ editor, range }: any) => {
          editor.chain().focus().deleteRange(range).toggleBlockquote().run();
        },
    },
    {
        title: '代码块',
        shortcut: '/dmk',
        icon: <Code className="w-3 h-3" />,
        command: ({ editor, range }: any) => {
            editor.chain().focus().deleteRange(range).toggleCodeBlock().run();
        },
    },
    {
      title: '分隔线',
      shortcut: '/fgx',
      icon: <Minus className="w-3 h-3" />,
      command: ({ editor, range }: any) => {
        editor.chain().focus().deleteRange(range).setHorizontalRule().run();
      },
    },
    {
        title: '插入图片',
        shortcut: '/tp',
        icon: <ImageIcon className="w-3 h-3" />,
        command: ({ editor, range }: any) => {
            editor.chain().focus().deleteRange(range).run();
            const uploadImage = editor.storage?.smartDocument?.uploadImage;
            if (typeof uploadImage !== 'function') return;

            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.onchange = async () => {
                if (!input.files?.length) return;
                const url = await uploadImage(input.files[0]);
                if (url) editor.chain().focus().setImage({ src: url, width: '100%', align: 'center' }).run();
            };
            input.click();
        },
    },
    {
        title: '2栏布局',
        shortcut: '/2',
        icon: <Layout className="w-3 h-3" />,
        command: ({ editor, range }: any) => {
            editor.chain().focus().deleteRange(range).setColumns(2).run();
        },
    },
    {
        title: '3栏布局',
        shortcut: '/3',
        icon: <Layout className="w-3 h-3" />,
        command: ({ editor, range }: any) => {
            editor.chain().focus().deleteRange(range).setColumns(3).run();
        },
    },
    {
        title: '思维导图',
        shortcut: '/swdt',
        icon: <Network className="w-3 h-3" />,
        command: ({ editor, range }: any) => {
            editor.chain().focus().deleteRange(range).insertContent({
                type: 'mindMap',
                attrs: {
                    data: { 
                        nodes: [{ id: 'root', type: 'mindMap', data: { label: '中心主题' }, position: { x: 0, y: 0 } }], 
                        edges: [] 
                    }
                }
            }).run();
        },
    },
    {
      title: 'Toggle',
      shortcut: '/toggle',
      icon: <ChevronRight className="w-3 h-3" />,
      command: ({ editor, range }: any) => {
        const title = window.prompt('Toggle title', 'Toggle') || 'Toggle';
        editor.chain().focus().deleteRange(range).insertContent({
          type: 'toggleBlock',
          attrs: { title, open: true },
          content: [{ type: 'paragraph' }],
        }).run();
      },
    },
    {
      title: 'Callout',
      shortcut: '/callout',
      icon: <AlertTriangle className="w-3 h-3" />,
      command: ({ editor, range }: any) => {
        editor.chain().focus().deleteRange(range).insertContent({
          type: 'calloutBlock',
          attrs: { icon: '!', tone: 'yellow' },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Callout' }] }],
        }).run();
      },
    },
    {
      title: 'Bookmark',
      shortcut: '/bookmark',
      icon: <Bookmark className="w-3 h-3" />,
      command: ({ editor, range }: any) => {
        const url = promptForUrl('Bookmark URL');
        if (!url) return;
        editor.chain().focus().deleteRange(range).insertContent({
          type: 'bookmarkBlock',
          attrs: { url, title: url, description: url },
        }).run();
      },
    },
    {
      title: 'Embed',
      shortcut: '/embed',
      icon: <Globe className="w-3 h-3" />,
      command: ({ editor, range }: any) => {
        const url = promptForUrl('Embed URL');
        if (!url) return;
        editor.chain().focus().deleteRange(range).insertContent({
          type: 'embedBlock',
          attrs: { url, title: 'Embed' },
        }).run();
      },
    },
    {
      title: '公式',
      shortcut: '/equation',
      icon: <Sigma className="w-3 h-3" />,
      command: ({ editor, range }: any) => {
        editor.chain().focus().deleteRange(range).insertContent({
          type: 'equationBlock',
          attrs: { formula: DEFAULT_EQUATION },
        }).run();
      },
    },
    {
      title: '数据库',
      shortcut: '/database',
      icon: <Database className="w-3 h-3" />,
      command: ({ editor, range }: any) => {
        editor.chain().focus().deleteRange(range).insertContent({
          type: 'databaseBlock',
          attrs: { database: createDefaultDatabase() },
        }).run();
      },
    },
    {
      title: '同步块',
      shortcut: '/sync',
      icon: <RefreshCw className="w-3 h-3" />,
      command: ({ editor, range }: any) => {
        editor.chain().focus().deleteRange(range).insertContent({
          type: 'syncedBlock',
          attrs: { syncId: createSyncedBlockId() },
          content: [{ type: 'paragraph' }],
        }).run();
      },
    },
    {
      title: '模板按钮',
      shortcut: '/template',
      icon: <Plus className="w-3 h-3" />,
      command: ({ editor, range }: any) => {
        editor.chain().focus().deleteRange(range).insertContent({
          type: 'templateButtonBlock',
          attrs: {
            label: '新建模板',
            templateTitle: '新模板条目',
            templateBody: '补充说明',
          },
        }).run();
      },
    },
    {
      title: '页面链接',
      shortcut: '/page',
      icon: <FileText className="w-3 h-3" />,
      command: ({ editor, range }: any) => {
        editor.chain().focus().deleteRange(range).insertContent({
          type: 'pageLinkBlock',
          attrs: {},
        }).run();
      },
    },
    {
      title: 'File',
      shortcut: '/file',
      icon: <Paperclip className="w-3 h-3" />,
      command: ({ editor, range }: any) => insertUploadedMedia({ editor, range }),
    },
    {
      title: 'Video',
      shortcut: '/video',
      icon: <Video className="w-3 h-3" />,
      command: ({ editor, range }: any) => insertUploadedMedia({ editor, range, accept: 'video/*', forcedKind: 'video' }),
    },
    {
      title: 'Audio',
      shortcut: '/audio',
      icon: <Music className="w-3 h-3" />,
      command: ({ editor, range }: any) => insertUploadedMedia({ editor, range, accept: 'audio/*', forcedKind: 'audio' }),
    },
    {
      title: 'PDF',
      shortcut: '/pdf',
      icon: <FileText className="w-3 h-3" />,
      command: ({ editor, range }: any) => insertUploadedMedia({ editor, range, accept: 'application/pdf', forcedKind: 'pdf' }),
    },
  ].filter(item => item.title.toLowerCase().includes(query.toLowerCase()) || item.shortcut.includes(query.toLowerCase()));
};

export const renderItems = () => {
  let component: any;
  let popup: any;

  return {
    onStart: (props: any) => {
      component = new ReactRenderer(CommandList, {
        props,
        editor: props.editor,
      });

      if (!props.clientRect) {
        return;
      }

      popup = tippy('body', {
        getReferenceClientRect: props.clientRect,
        appendTo: () => document.body,
        content: component.element,
        showOnCreate: true,
        interactive: true,
        trigger: 'manual',
        placement: 'bottom-start',
      });
    },

    onUpdate: (props: any) => {
      component.updateProps(props);

      if (!props.clientRect) {
        return;
      }

      popup[0].setProps({
        getReferenceClientRect: props.clientRect,
      });
    },

    onKeyDown: (props: any) => {
      if (props.event.key === 'Escape') {
        popup[0].hide();

        return true;
      }

      return component.ref?.onKeyDown(props);
    },

    onExit: () => {
      popup[0].destroy();
      component.destroy();
    },
  };
};
