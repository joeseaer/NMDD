
import { Node, mergeAttributes, InputRule, Extension, type JSONContent } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';
import { EditorContent, ReactRenderer, ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent, useEditor } from '@tiptap/react';
import TiptapImage from '@tiptap/extension-image';
import { Table } from '@tiptap/extension-table';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableRow } from '@tiptap/extension-table-row';
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
  Paperclip, Video, Music, FileText, Sigma, RefreshCw, CalendarDays, X, ExternalLink, Copy, Unlink,
  Database, Plus, Trash2, Table as TableIcon, Palette
} from 'lucide-react';
import { MindMapComponent } from './MindMapExtension';
import { createMindMapBlockDocument } from '../features/mindmap/domain/createDocument';
import { isMindMapV2Enabled } from '../features/mindmap/featureFlags';
import { createMindMapStaticSvgPreview } from '../features/mindmap/export/staticSvg';
import { createSmartDocumentExtensions } from '../features/document-editor/createEditorExtensions';
import {
  WhiteboardEmbed,
  insertWhiteboardIntoEditor,
} from '../features/whiteboard/embed/WhiteboardExtension';
import { SmartClipboardExtension } from '../features/document-editor/SmartClipboardExtension';
import { decodeLegacyEncodedFormula } from '../features/document-editor/serialization/serializationUtils';
import { takeGraphemes } from '../features/document-editor/text/graphemes';
import { useNavigate } from 'react-router-dom';
import { useDocumentNavigationRequest } from '../features/document-editor/navigation/DocumentNavigationGuard';

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

  renderHTML({ node, HTMLAttributes }) {
    const preview = createMindMapStaticSvgPreview(node.attrs.data);
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'mind-map' }),
      preview.spec,
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(MindMapComponent, {
      // A clipboard image is otherwise consumed by the surrounding ProseMirror
      // editor before the interactive canvas receives its paste handler.
      stopEvent: ({ event }) => event.type === 'paste',
    })
  },
});

// --- Smart Document Blocks ---

const normalizeToggleAttrs = (attrs: any) => ({
  title: String(attrs?.title || 'Toggle').trim() || 'Toggle',
  open: attrs?.open !== false,
  level: [1, 2, 3].includes(Number(attrs?.level)) ? Number(attrs.level) : 0,
});

type CalloutTone = 'gray' | 'yellow' | 'blue' | 'green' | 'red' | 'purple';

const CALLOUT_TONE_OPTIONS: Array<{
  value: CalloutTone;
  label: string;
  className: string;
  iconClassName: string;
  swatchClassName: string;
}> = [
  {
    value: 'gray',
    label: '灰色',
    className: 'border-gray-200 bg-gray-50 text-gray-800',
    iconClassName: 'border-gray-200 bg-white text-gray-600',
    swatchClassName: 'bg-gray-300',
  },
  {
    value: 'yellow',
    label: '黄色',
    className: 'border-amber-200 bg-amber-50 text-gray-800',
    iconClassName: 'border-amber-200 bg-white text-amber-700',
    swatchClassName: 'bg-amber-300',
  },
  {
    value: 'blue',
    label: '蓝色',
    className: 'border-blue-200 bg-blue-50 text-gray-800',
    iconClassName: 'border-blue-200 bg-white text-blue-700',
    swatchClassName: 'bg-blue-300',
  },
  {
    value: 'green',
    label: '绿色',
    className: 'border-emerald-200 bg-emerald-50 text-gray-800',
    iconClassName: 'border-emerald-200 bg-white text-emerald-700',
    swatchClassName: 'bg-emerald-300',
  },
  {
    value: 'red',
    label: '红色',
    className: 'border-red-200 bg-red-50 text-gray-800',
    iconClassName: 'border-red-200 bg-white text-red-700',
    swatchClassName: 'bg-red-300',
  },
  {
    value: 'purple',
    label: '紫色',
    className: 'border-purple-200 bg-purple-50 text-gray-800',
    iconClassName: 'border-purple-200 bg-white text-purple-700',
    swatchClassName: 'bg-purple-300',
  },
];

const normalizeCalloutTone = (value: unknown): CalloutTone => {
  const token = String(value || '').trim().toLowerCase();
  return CALLOUT_TONE_OPTIONS.some((option) => option.value === token) ? token as CalloutTone : 'gray';
};

const normalizeCalloutAttrs = (attrs: any) => ({
  icon: String(attrs?.icon || '!').trim() || '!',
  tone: normalizeCalloutTone(attrs?.tone),
});

const getCalloutToneOption = (value: unknown) => (
  CALLOUT_TONE_OPTIONS.find((option) => option.value === normalizeCalloutTone(value)) || CALLOUT_TONE_OPTIONS[0]
);

const getNodeViewCommentsAttr = (attrs: any) => (
  Array.isArray(attrs?.blockComments) && attrs.blockComments.length
    ? encodeJsonAttribute(attrs.blockComments)
    : undefined
);

const ToggleBlockView = ({ node, updateAttributes, selected, editor }: any) => {
  const attrs = normalizeToggleAttrs(node.attrs);
  const commentsAttr = getNodeViewCommentsAttr(node.attrs);
  const [readOpen, setReadOpen] = useState(attrs.open);
  const effectiveOpen = editor.isEditable ? attrs.open : readOpen;

  return (
    <NodeViewWrapper
      className={`smart-doc-toggle my-3 rounded-md border bg-white transition-colors ${
        selected ? 'border-gray-400 shadow-sm' : 'border-gray-200 hover:border-gray-300'
      }`}
      data-type="toggle"
      data-title={attrs.title}
      data-open={attrs.open ? 'true' : 'false'}
      data-level={attrs.level || undefined}
      data-block-id={node.attrs.blockId || undefined}
      data-comments={commentsAttr}
      id={blockDomId(node.attrs.blockId)}
    >
      <div className="flex items-center gap-1 px-2 py-1.5" contentEditable={false}>
        <button
          type="button"
          title={effectiveOpen ? '收起' : '展开'}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (editor.isEditable) updateAttributes({ open: !attrs.open });
            else setReadOpen((current: boolean) => !current);
          }}
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded text-gray-500 hover:bg-gray-100 hover:text-gray-800"
        >
          <ChevronRight className={`h-4 w-4 transition-transform ${effectiveOpen ? 'rotate-90' : ''}`} />
        </button>
        <input
          value={attrs.title}
          onChange={(event) => updateAttributes({ title: event.target.value })}
          disabled={!editor.isEditable}
          className={`smart-doc-toggle-title min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-1 text-gray-800 outline-none hover:border-gray-200 focus:border-gray-300 focus:bg-white ${attrs.level ? `smart-doc-toggle-title--h${attrs.level}` : 'text-sm font-medium'}`}
          aria-label="Toggle 标题"
          placeholder="Toggle"
        />
      </div>
      <NodeViewContent
        className={`smart-doc-toggle-content px-4 pb-3 pt-1 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 ${effectiveOpen ? '' : 'hidden'}`}
      />
    </NodeViewWrapper>
  );
};

const CalloutBlockView = ({ node, updateAttributes, selected }: any) => {
  const attrs = normalizeCalloutAttrs(node.attrs);
  const tone = getCalloutToneOption(attrs.tone);
  const commentsAttr = getNodeViewCommentsAttr(node.attrs);

  return (
    <NodeViewWrapper
      className={`smart-doc-callout my-3 flex gap-3 rounded-md border px-3 py-3 text-sm transition-colors ${
        tone.className
      } ${selected ? 'shadow-sm ring-1 ring-gray-300' : ''}`}
      data-type="callout"
      data-icon={attrs.icon}
      data-tone={attrs.tone}
      data-block-id={node.attrs.blockId || undefined}
      data-comments={commentsAttr}
      id={blockDomId(node.attrs.blockId)}
    >
      <div className="flex flex-shrink-0 flex-col items-center gap-2" contentEditable={false}>
        <input
          value={attrs.icon}
          onChange={(event) => updateAttributes({ icon: takeGraphemes(event.target.value, 2) })}
          className={`flex h-7 w-7 rounded border px-0 text-center text-sm font-semibold outline-none focus:ring-2 focus:ring-white/70 ${tone.iconClassName}`}
          aria-label="Callout 图标"
        />
        <div className="smart-doc-callout-tone-picker flex flex-col gap-1">
          {CALLOUT_TONE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              title={`Callout ${option.label}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => updateAttributes({ tone: option.value })}
              className={`flex h-4 w-4 items-center justify-center rounded-full border ${
                option.value === attrs.tone ? 'border-gray-900' : 'border-white/70'
              }`}
            >
              <span className={`h-2.5 w-2.5 rounded-full ${option.swatchClassName}`} />
            </button>
          ))}
        </div>
      </div>
      <NodeViewContent className="smart-doc-callout-content min-w-0 flex-1 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0" />
    </NodeViewWrapper>
  );
};

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
      level: {
        default: 0,
        parseHTML: element => Number(element.getAttribute('data-level') || 0),
        renderHTML: attributes => Number(attributes.level) ? { 'data-level': Number(attributes.level) } : {},
      },
    }
  },

  parseHTML() {
    return [{ tag: 'details[data-type="toggle"]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const attrs = normalizeToggleAttrs(node.attrs);
    return [
      'details',
      mergeAttributes(HTMLAttributes, { 'data-type': 'toggle', 'data-title': attrs.title, 'data-level': attrs.level || undefined, class: 'smart-doc-toggle my-3 rounded-md border border-gray-200 bg-white' }),
      ['summary', { class: `smart-doc-toggle-summary smart-doc-toggle-title${attrs.level ? ` smart-doc-toggle-title--h${attrs.level}` : ''} cursor-pointer select-none px-3 py-2 text-sm font-medium text-gray-800` }, attrs.title],
      ['div', { class: 'smart-doc-toggle-content px-4 pb-3 pt-1' }, 0],
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(ToggleBlockView)
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

  renderHTML({ node, HTMLAttributes }) {
    const attrs = normalizeCalloutAttrs(node.attrs);
    const tone = getCalloutToneOption(attrs.tone);
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'callout',
        'data-icon': attrs.icon,
        'data-tone': attrs.tone,
        class: `smart-doc-callout my-3 flex gap-3 rounded-md border px-3 py-3 text-sm ${tone.className}`,
      }),
      ['div', { class: `smart-doc-callout-icon mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded border text-xs font-bold ${tone.iconClassName}` }, attrs.icon],
      ['div', { class: 'smart-doc-callout-content min-w-0 flex-1' }, 0],
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(CalloutBlockView)
  },
});

const normalizeBookmarkAttrs = (attrs: any) => {
  const url = String(attrs?.url || '').trim();
  const title = String(attrs?.title || '').trim() || url || 'Bookmark';
  const description = String(attrs?.description || '').trim();
  return {
    url,
    title,
    description: description || url,
  };
};

const normalizeEmbedAttrs = (attrs: any) => {
  const url = String(attrs?.url || '').trim();
  return {
    url,
    title: String(attrs?.title || '').trim() || 'Embed',
  };
};

const getUrlHostLabel = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

const openExternalUrl = (url: string) => {
  if (!url) return;
  window.open(url, '_blank', 'noopener,noreferrer');
};

const BookmarkBlockView = ({ node, updateAttributes, selected }: any) => {
  const attrs = normalizeBookmarkAttrs(node.attrs);
  const commentsAttr = getNodeViewCommentsAttr(node.attrs);
  const host = attrs.url ? getUrlHostLabel(attrs.url) : '未设置链接';

  return (
    <NodeViewWrapper
      className={`smart-doc-bookmark my-3 rounded-md border bg-white p-3 text-gray-800 transition-colors ${
        selected ? 'border-gray-400 shadow-sm' : 'border-gray-200 hover:border-gray-300'
      }`}
      data-type="bookmark"
      data-url={attrs.url}
      data-title={attrs.title}
      data-description={attrs.description || undefined}
      data-block-id={node.attrs.blockId || undefined}
      data-comments={commentsAttr}
      id={blockDomId(node.attrs.blockId)}
      contentEditable={false}
    >
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md border border-gray-200 bg-gray-50 text-gray-500">
          <Bookmark className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <input
            value={attrs.title}
            onMouseDown={(event) => event.stopPropagation()}
            onChange={(event) => updateAttributes({ title: event.target.value })}
            className="h-7 w-full border-none bg-transparent px-0 text-sm font-semibold text-gray-900 outline-none focus:ring-0"
            aria-label="书签标题"
            placeholder="Bookmark"
          />
          <input
            value={attrs.description}
            onMouseDown={(event) => event.stopPropagation()}
            onChange={(event) => updateAttributes({ description: event.target.value })}
            className="h-6 w-full border-none bg-transparent px-0 text-xs text-gray-500 outline-none focus:ring-0"
            aria-label="书签描述"
            placeholder="添加描述"
          />
          <input
            value={attrs.url}
            onMouseDown={(event) => event.stopPropagation()}
            onChange={(event) => updateAttributes({ url: event.target.value })}
            className="h-6 w-full truncate border-none bg-transparent px-0 text-xs text-gray-400 outline-none focus:ring-0"
            aria-label="书签链接"
            placeholder="https://example.com"
          />
        </div>
        <button
          type="button"
          title={attrs.url ? `打开 ${host}` : '先填写链接'}
          disabled={!attrs.url}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => openExternalUrl(attrs.url)}
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-30"
        >
          <ExternalLink className="h-4 w-4" />
        </button>
      </div>
    </NodeViewWrapper>
  );
};

const EmbedBlockView = ({ node, updateAttributes, selected }: any) => {
  const attrs = normalizeEmbedAttrs(node.attrs);
  const commentsAttr = getNodeViewCommentsAttr(node.attrs);

  return (
    <NodeViewWrapper
      className={`smart-doc-embed my-3 overflow-hidden rounded-md border bg-white transition-colors ${
        selected ? 'border-gray-400 shadow-sm' : 'border-gray-200 hover:border-gray-300'
      }`}
      data-type="embed"
      data-url={attrs.url}
      data-title={attrs.title}
      data-block-id={node.attrs.blockId || undefined}
      data-comments={commentsAttr}
      id={blockDomId(node.attrs.blockId)}
      contentEditable={false}
    >
      <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
        <Globe className="h-4 w-4 flex-shrink-0 text-gray-400" />
        <input
          value={attrs.title}
          onMouseDown={(event) => event.stopPropagation()}
          onChange={(event) => updateAttributes({ title: event.target.value })}
          className="min-w-0 flex-1 border-none bg-transparent px-0 text-xs font-semibold text-gray-600 outline-none focus:ring-0"
          aria-label="嵌入标题"
          placeholder="Embed"
        />
        <button
          type="button"
          title="打开嵌入链接"
          disabled={!attrs.url}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => openExternalUrl(attrs.url)}
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-30"
        >
          <ExternalLink className="h-4 w-4" />
        </button>
      </div>
      <div className="border-b border-gray-100 px-3 py-2">
        <input
          value={attrs.url}
          onMouseDown={(event) => event.stopPropagation()}
          onChange={(event) => updateAttributes({ url: event.target.value })}
          className="h-7 w-full border-none bg-gray-50 px-2 text-xs text-gray-500 outline-none focus:bg-white focus:ring-0"
          aria-label="嵌入链接"
          placeholder="https://example.com"
        />
      </div>
      {attrs.url ? (
        <iframe
          src={attrs.url}
          title={attrs.title}
          className="h-72 w-full bg-gray-50"
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          allowFullScreen
        />
      ) : (
        <div className="flex h-40 items-center justify-center bg-gray-50 text-xs text-gray-400">
          添加链接后显示嵌入预览
        </div>
      )}
    </NodeViewWrapper>
  );
};

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
    const attrs = normalizeBookmarkAttrs(node.attrs);
    const url = attrs.url || '#';
    return [
      'a',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'bookmark',
        'data-url': attrs.url,
        'data-title': attrs.title,
        'data-description': attrs.description || undefined,
        href: url,
        target: '_blank',
        rel: 'noopener noreferrer',
        class: 'smart-doc-bookmark my-3 block rounded-md border border-gray-200 bg-white p-3 text-gray-800 no-underline hover:bg-gray-50',
      }),
      ['span', { class: 'block text-sm font-semibold text-gray-900' }, attrs.title],
      ['span', { class: 'mt-1 block truncate text-xs text-gray-500' }, attrs.description],
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(BookmarkBlockView)
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
    const attrs = normalizeEmbedAttrs(node.attrs);
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'embed', class: 'smart-doc-embed my-3 overflow-hidden rounded-md border border-gray-200 bg-white' }),
      ['div', { class: 'border-b border-gray-100 px-3 py-2 text-xs font-semibold text-gray-500' }, attrs.title],
      ['iframe', { src: attrs.url, class: 'h-72 w-full bg-gray-50', loading: 'lazy', referrerpolicy: 'no-referrer-when-downgrade', allowfullscreen: 'true' }],
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(EmbedBlockView)
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

function blockDomId(blockId?: string | null) {
  return blockId ? `block-${blockId}` : undefined;
}

function encodeJsonAttribute(value: unknown) {
  try {
    return encodeURIComponent(JSON.stringify(value));
  } catch {
    return undefined;
  }
}

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

const refreshSyncedCloneRuntimeAttrs = (value: any): any => {
  if (Array.isArray(value)) return value.map(refreshSyncedCloneRuntimeAttrs);
  if (!value || typeof value !== 'object') return value;

  const next: any = { ...value };
  if (next.attrs && typeof next.attrs === 'object') {
    next.attrs = { ...next.attrs };
    if (next.attrs.blockId) next.attrs.blockId = createSmartDocumentId('blk');
    if (next.attrs.blockComments) delete next.attrs.blockComments;
  }
  if (Array.isArray(next.content)) next.content = next.content.map(refreshSyncedCloneRuntimeAttrs);
  return next;
};

const createSyncedBlockCloneJson = (node: any, syncIdOverride?: string) => {
  const json = refreshSyncedCloneRuntimeAttrs(node.toJSON());
  if (!json.attrs) json.attrs = {};
  json.attrs.syncId = syncIdOverride || node.attrs.syncId || createSyncedBlockId();
  return json;
};

const SyncedBlockView = ({ node, editor, getPos, updateAttributes, selected }: any) => {
  const syncId = String(node.attrs.syncId || '');
  const commentsAttr = getNodeViewCommentsAttr(node.attrs);
  const shortId = syncId ? syncId.replace(/^sync_/, '').slice(-6) : 'new';

  const copySyncedBlock = () => {
    if (!editor || typeof getPos !== 'function') return;
    const nextSyncId = syncId || createSyncedBlockId();
    if (!syncId) updateAttributes({ syncId: nextSyncId });
    const insertAt = getPos() + node.nodeSize;
    editor.chain().focus().insertContentAt(insertAt, createSyncedBlockCloneJson(node, nextSyncId)).run();
  };

  const unsyncBlock = () => {
    updateAttributes({ syncId: createSyncedBlockId() });
  };

  return (
    <NodeViewWrapper
      className={`smart-doc-synced-block my-3 rounded-md border bg-white transition-colors ${
        selected ? 'border-blue-300 shadow-sm ring-1 ring-blue-100' : 'border-gray-200 hover:border-gray-300'
      }`}
      data-type="synced-block"
      data-sync-id={syncId || undefined}
      data-block-id={node.attrs.blockId || undefined}
      data-comments={commentsAttr}
      id={blockDomId(node.attrs.blockId)}
    >
      <div className="flex items-center justify-between gap-3 border-b border-blue-100 bg-blue-50/60 px-3 py-1.5" contentEditable={false}>
        <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-blue-700">
          <RefreshCw className="h-3.5 w-3.5 flex-shrink-0" />
          <span className="truncate">同步块</span>
          <span className="rounded bg-white/80 px-1.5 py-0.5 font-mono text-[10px] text-blue-500">{shortId}</span>
        </div>
        <div className="flex flex-shrink-0 items-center gap-1">
          <button
            type="button"
            title="复制同步副本"
            onMouseDown={(event) => event.preventDefault()}
            onClick={copySyncedBlock}
            className="flex h-6 items-center gap-1 rounded px-1.5 text-[11px] font-medium text-blue-700 hover:bg-white"
          >
            <Copy className="h-3.5 w-3.5" />
            同步副本
          </button>
          <button
            type="button"
            title="解绑当前块"
            onMouseDown={(event) => event.preventDefault()}
            onClick={unsyncBlock}
            className="flex h-6 items-center gap-1 rounded px-1.5 text-[11px] font-medium text-gray-500 hover:bg-white hover:text-gray-800"
          >
            <Unlink className="h-3.5 w-3.5" />
            解绑
          </button>
        </div>
      </div>
      <NodeViewContent
        data-synced-content="true"
        className="px-3 py-2 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
      />
    </NodeViewWrapper>
  );
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

  addNodeView() {
    return ReactNodeViewRenderer(SyncedBlockView)
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

type DatabasePropertyType = 'title' | 'text' | 'number' | 'status' | 'select' | 'multi_select' | 'person' | 'date' | 'checkbox' | 'url' | 'formula' | 'relation' | 'rollup' | 'files';
type DatabaseViewMode = 'table' | 'list' | 'board' | 'calendar' | 'timeline' | 'gallery';
type DatabaseFilterOperator = 'contains' | 'equals' | 'not_empty' | 'empty';
type DatabaseRollupFunction = 'count' | 'show' | 'sum' | 'avg' | 'min' | 'max';
type DatabaseFileKind = 'image' | 'video' | 'audio' | 'pdf' | 'file';

type DatabaseFileValue = {
  id: string;
  url: string;
  name: string;
  mime: string;
  size: number;
  kind: DatabaseFileKind;
};

type DatabaseProperty = {
  id: string;
  name: string;
  type: DatabasePropertyType;
  options?: string[];
  formula?: string;
  relationPropertyId?: string;
  rollupTargetPropertyId?: string;
  rollupFunction?: DatabaseRollupFunction;
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
  { value: 'select', label: '单选' },
  { value: 'multi_select', label: '多选' },
  { value: 'person', label: '人员' },
  { value: 'date', label: '日期' },
  { value: 'checkbox', label: '勾选' },
  { value: 'url', label: '链接' },
  { value: 'formula', label: '公式' },
  { value: 'relation', label: '关系' },
  { value: 'rollup', label: '汇总' },
  { value: 'files', label: '文件' },
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
const DEFAULT_SELECT_OPTIONS = ['选项 1', '选项 2'];
const DEFAULT_PERSON_OPTIONS = ['我'];
const EMPTY_DATABASE_GROUP = '未填写';

const DATABASE_FILTER_OPERATORS: Array<{ value: DatabaseFilterOperator; label: string; needsValue: boolean }> = [
  { value: 'contains', label: '包含', needsValue: true },
  { value: 'equals', label: '等于', needsValue: true },
  { value: 'not_empty', label: '非空', needsValue: false },
  { value: 'empty', label: '为空', needsValue: false },
];

const DATABASE_ROLLUP_FUNCTIONS: Array<{ value: DatabaseRollupFunction; label: string }> = [
  { value: 'count', label: '计数' },
  { value: 'show', label: '显示原值' },
  { value: 'sum', label: '求和' },
  { value: 'avg', label: '平均值' },
  { value: 'min', label: '最小值' },
  { value: 'max', label: '最大值' },
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

const normalizeDatabaseRollupFunction = (value: unknown): DatabaseRollupFunction => {
  return DATABASE_ROLLUP_FUNCTIONS.some((item) => item.value === value) ? value as DatabaseRollupFunction : 'count';
};

const normalizeFilterOperator = (value: unknown): DatabaseFilterOperator => {
  return DATABASE_FILTER_OPERATORS.some((item) => item.value === value) ? value as DatabaseFilterOperator : 'contains';
};

const isChoiceDatabasePropertyType = (type: DatabasePropertyType) => (
  type === 'status' || type === 'select' || type === 'multi_select' || type === 'person'
);

const getDefaultDatabaseOptions = (type: DatabasePropertyType) => {
  if (type === 'status') return DEFAULT_STATUS_OPTIONS;
  if (type === 'person') return DEFAULT_PERSON_OPTIONS;
  if (type === 'select' || type === 'multi_select') return DEFAULT_SELECT_OPTIONS;
  return [];
};

const normalizeDatabaseOptions = (value: unknown, type: DatabasePropertyType) => {
  const fallback = getDefaultDatabaseOptions(type);
  const source = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[,，\n]/)
      : [];
  const seen = new Set<string>();
  const options = source
    .map((option) => String(option || '').trim())
    .filter((option) => {
      if (!option || seen.has(option)) return false;
      seen.add(option);
      return true;
    });

  return options.length ? options : fallback;
};

const normalizeChoiceCellValue = (value: unknown, options: string[], fallback = '') => {
  const nextValue = String(value || '').trim();
  if (!nextValue) return fallback;
  return options.includes(nextValue) ? nextValue : fallback;
};

const normalizeMultiChoiceCellValue = (value: unknown, options: string[]) => {
  const source = Array.isArray(value)
    ? value
    : typeof value === 'string' && value.trim()
      ? value.split(/[,，\n]/)
      : [];
  const seen = new Set<string>();

  return source
    .map((item) => String(item || '').trim())
    .filter((item) => {
      if (!item || seen.has(item) || !options.includes(item)) return false;
      seen.add(item);
      return true;
    });
};

const normalizeRelationCellValue = (value: unknown) => {
  const source = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[,，\n]/)
      : [];
  const seen = new Set<string>();

  return source
    .map((item) => String(item || '').trim())
    .filter((item) => {
      if (!item || seen.has(item)) return false;
      seen.add(item);
      return true;
    });
};

const getDatabaseFileNameFromUrl = (url: string) => {
  const rawName = url.split(/[?#]/)[0].split('/').filter(Boolean).pop() || '文件';
  try {
    return decodeURIComponent(rawName);
  } catch {
    return rawName;
  }
};

const getDatabaseFileKind = (mime: string, name: string): DatabaseFileKind => {
  const normalizedMime = String(mime || '').toLowerCase();
  const normalizedName = String(name || '').toLowerCase();
  if (normalizedMime.startsWith('image/')) return 'image';
  if (normalizedMime.startsWith('video/')) return 'video';
  if (normalizedMime.startsWith('audio/')) return 'audio';
  if (normalizedMime === 'application/pdf' || /\.pdf$/i.test(normalizedName)) return 'pdf';
  return 'file';
};

const normalizeDatabaseFileValue = (value: unknown): DatabaseFileValue[] => {
  const source = Array.isArray(value)
    ? value
    : value && typeof value === 'object'
      ? [value]
      : typeof value === 'string' && value.trim()
        ? value.split(/[,，\n]/).map((url) => ({ url: url.trim() }))
        : [];
  const seen = new Set<string>();

  return source
    .map((item: any) => {
      const url = String(item?.url || item?.src || item?.href || '').trim();
      if (!url || seen.has(url)) return null;
      seen.add(url);

      const name = String(item?.name || item?.filename || '').trim() || getDatabaseFileNameFromUrl(url);
      const mime = String(item?.mime || item?.type || '').trim();
      const size = Number(item?.size || 0);
      const kind = getDatabaseFileKind(mime, name);

      return {
        id: String(item?.id || createSmartDocumentId('file')),
        url,
        name,
        mime,
        size: Number.isFinite(size) && size > 0 ? size : 0,
        kind,
      };
    })
    .filter(Boolean) as DatabaseFileValue[];
};

const formatDatabaseFileSize = (size: number) => {
  if (!Number.isFinite(size) || size <= 0) return '';
  if (size < 1024) return `${Math.round(size)} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 102.4) / 10} KB`;
  return `${Math.round(size / 1024 / 102.4) / 10} MB`;
};

const getDatabaseFilesDisplayValue = (value: unknown) => {
  return normalizeDatabaseFileValue(value).map((file) => file.name || file.url).join(', ');
};

const normalizeDatabaseCellValue = (property: DatabaseProperty, value: any) => {
  if (property.type === 'formula' || property.type === 'rollup') return '';
  if (property.type === 'relation') return normalizeRelationCellValue(value);
  if (property.type === 'files') return normalizeDatabaseFileValue(value);
  if (property.type === 'checkbox') return Boolean(value);
  if (property.type === 'status') {
    const options = normalizeDatabaseOptions(property.options, property.type);
    return normalizeChoiceCellValue(value, options, options[0] || '');
  }
  if (property.type === 'select') {
    const options = normalizeDatabaseOptions(property.options, property.type);
    return normalizeChoiceCellValue(value, options);
  }
  if (property.type === 'multi_select' || property.type === 'person') {
    return normalizeMultiChoiceCellValue(value, normalizeDatabaseOptions(property.options, property.type));
  }
  if (value === null || value === undefined) return '';
  return String(value);
};

const getDefaultDatabaseCellValue = (property: DatabaseProperty) => {
  if (property.type === 'checkbox') return false;
  if (property.type === 'status') return normalizeDatabaseOptions(property.options, property.type)[0] || '';
  if (property.type === 'multi_select' || property.type === 'person') return [];
  if (property.type === 'relation') return [];
  if (property.type === 'files') return [];
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

const getDatabaseTitleProperty = (database: SmartDocumentDatabase) => {
  return database.properties.find((property) => property.type === 'title') || database.properties[0] || null;
};

const getDatabaseRowTitleValue = (database: SmartDocumentDatabase, row: DatabaseRow | null | undefined) => {
  if (!row) return '';
  const titleProperty = getDatabaseTitleProperty(database);
  return titleProperty ? String(row.cells[titleProperty.id] || '').trim() || '未命名' : '未命名';
};

const getRelationCellRowIds = (database: SmartDocumentDatabase, row: DatabaseRow, property: DatabaseProperty) => {
  if (property.type !== 'relation') return [];
  const rowIds = new Set(database.rows.map((item) => item.id));
  return normalizeRelationCellValue(row.cells[property.id]).filter((rowId) => rowId !== row.id && rowIds.has(rowId));
};

const getRelationRows = (database: SmartDocumentDatabase, row: DatabaseRow, property: DatabaseProperty) => {
  const relatedIds = getRelationCellRowIds(database, row, property);
  return relatedIds
    .map((rowId) => database.rows.find((item) => item.id === rowId) || null)
    .filter(Boolean) as DatabaseRow[];
};

const getRelationDisplayValue = (database: SmartDocumentDatabase, row: DatabaseRow, property: DatabaseProperty) => {
  return getRelationRows(database, row, property)
    .map((relatedRow) => getDatabaseRowTitleValue(database, relatedRow))
    .filter(Boolean)
    .join(', ');
};

const evaluateDatabaseRollup = (
  database: SmartDocumentDatabase,
  row: DatabaseRow,
  property: DatabaseProperty,
  seen: Set<string> = new Set(),
): DatabaseFormulaResult => {
  const seenKey = `${row.id}:${property.id}`;
  if (seen.has(seenKey)) return { value: null, error: '循环汇总' };

  const relationProperty = database.properties.find((item) => (
    item.id === property.relationPropertyId && item.type === 'relation'
  ));
  if (!relationProperty) return { value: '', error: '缺少关系属性' };

  const relatedRows = getRelationRows(database, row, relationProperty);
  const rollupFunction = normalizeDatabaseRollupFunction(property.rollupFunction);
  if (rollupFunction === 'count') return { value: relatedRows.length };

  const targetProperty = database.properties.find((item) => item.id === property.rollupTargetPropertyId);
  if (!targetProperty) return { value: '', error: '缺少目标属性' };

  const nextSeen = new Set([...seen, seenKey]);
  const values = relatedRows.map((relatedRow) => getCellDisplayValue(database, relatedRow, targetProperty, nextSeen));
  if (rollupFunction === 'show') return { value: values.filter(Boolean).join(', ') };

  const numericValues = values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));

  if (!numericValues.length) return { value: '' };
  if (rollupFunction === 'sum') return { value: numericValues.reduce((total, value) => total + value, 0) };
  if (rollupFunction === 'avg') return { value: numericValues.reduce((total, value) => total + value, 0) / numericValues.length };
  if (rollupFunction === 'min') return { value: Math.min(...numericValues) };
  if (rollupFunction === 'max') return { value: Math.max(...numericValues) };

  return { value: '' };
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
    if (target.type === 'rollup') return evaluateDatabaseRollup(database, row, target);
    if (target.type === 'relation') return { value: getRelationDisplayValue(database, row, target) };
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
  const properties: DatabaseProperty[] = Array.isArray(raw.properties)
    ? raw.properties.map((property: any, index: number) => {
      const type = index === 0 ? 'title' : normalizePropertyType(property?.type);
      const options = isChoiceDatabasePropertyType(type)
        ? normalizeDatabaseOptions(property?.options, type)
        : undefined;
      const formula = type === 'formula'
        ? String(property?.formula || '').trim()
        : undefined;
      const relationPropertyId = type === 'rollup'
        ? String(property?.relationPropertyId || property?.relation_property_id || '').trim()
        : undefined;
      const rollupTargetPropertyId = type === 'rollup'
        ? String(property?.rollupTargetPropertyId || property?.rollup_target_property_id || '').trim()
        : undefined;
      const rollupFunction = type === 'rollup'
        ? normalizeDatabaseRollupFunction(property?.rollupFunction || property?.rollup_function)
        : undefined;

      return {
        id: String(property?.id || createSmartDocumentId('prop')),
        name: String(property?.name || (index === 0 ? '名称' : '属性')).trim() || '属性',
        type,
        options,
        formula,
        relationPropertyId,
        rollupTargetPropertyId,
        rollupFunction,
      };
    }).filter((property: DatabaseProperty) => property.id)
    : fallback.properties;

  if (!properties.some((property: DatabaseProperty) => property.type === 'title')) {
    properties.unshift({ id: createSmartDocumentId('prop'), name: '名称', type: 'title' });
  }

  const normalizedProperties: DatabaseProperty[] = properties.map((property: DatabaseProperty, index: number): DatabaseProperty => {
    const type = index === 0 ? 'title' as DatabasePropertyType : property.type;
    if (type !== 'rollup') {
      return {
        ...property,
        type,
        options: isChoiceDatabasePropertyType(type)
          ? normalizeDatabaseOptions(property.options, type)
          : undefined,
        relationPropertyId: undefined,
        rollupTargetPropertyId: undefined,
        rollupFunction: undefined,
      };
    }

    const relationProperty = properties.find((item: DatabaseProperty) => item.id === property.relationPropertyId && item.type === 'relation')
      || properties.find((item: DatabaseProperty) => item.type === 'relation');
    const targetProperty = properties.find((item: DatabaseProperty) => item.id === property.rollupTargetPropertyId && item.id !== property.id)
      || properties.find((item: DatabaseProperty) => item.type === 'title')
      || properties.find((item: DatabaseProperty) => item.id !== property.id);

    return {
      ...property,
      type,
      options: undefined,
      formula: undefined,
      relationPropertyId: relationProperty?.id,
      rollupTargetPropertyId: targetProperty?.id,
      rollupFunction: normalizeDatabaseRollupFunction(property.rollupFunction),
    };
  });

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
  const normalizedRows: DatabaseRow[] = rows.length ? rows : [createDatabaseRow(normalizedProperties, '新条目')];
  const rowIds = new Set<string>(normalizedRows.map((row: DatabaseRow) => row.id));
  const normalizedRowsWithRelations: DatabaseRow[] = normalizedRows.map((row: DatabaseRow) => ({
    ...row,
    cells: Object.fromEntries(normalizedProperties.map((property: DatabaseProperty) => [
      property.id,
      property.type === 'relation'
        ? normalizeRelationCellValue(row.cells[property.id]).filter((rowId) => rowId !== row.id && rowIds.has(rowId))
        : row.cells[property.id],
    ])),
  }));

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
    rows: normalizedRowsWithRelations,
    filters: activeView.filters,
    groupBy: activeView.groupBy,
    sort: activeView.sort,
  };
};

const getCellDisplayValue = (
  database: SmartDocumentDatabase,
  row: DatabaseRow,
  property: DatabaseProperty,
  seen: Set<string> = new Set(),
) => {
  if (property.type === 'formula') {
    const result = evaluateDatabaseFormula(database, row, property);
    return result.error ? `#${result.error}` : formatDatabaseFormulaValue(result.value);
  }
  if (property.type === 'relation') return getRelationDisplayValue(database, row, property);
  if (property.type === 'rollup') {
    const result = evaluateDatabaseRollup(database, row, property, seen);
    return result.error ? `#${result.error}` : formatDatabaseFormulaValue(result.value);
  }
  if (property.type === 'files') return getDatabaseFilesDisplayValue(row.cells[property.id]);
  if (property.type === 'checkbox') return row.cells[property.id] ? 'true' : '';
  if (property.type === 'multi_select' || property.type === 'person') {
    return normalizeMultiChoiceCellValue(row.cells[property.id], normalizeDatabaseOptions(property.options, property.type)).join(', ');
  }
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
  if (property.type === 'rollup') {
    const result = evaluateDatabaseRollup(database, row, property);
    if (result.error) return `#${result.error}`.toLowerCase();
    if (typeof result.value === 'number') return result.value;
    if (typeof result.value === 'boolean') return result.value ? 1 : 0;
    return String(result.value || '').toLowerCase();
  }
  if (property.type === 'relation') return getRelationDisplayValue(database, row, property).toLowerCase();
  if (property.type === 'files') return getDatabaseFilesDisplayValue(row.cells[property.id]).toLowerCase();
  if (property.type === 'multi_select' || property.type === 'person') return getCellDisplayValue(database, row, property).toLowerCase();
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

  if (property.type === 'multi_select' || property.type === 'person') {
    const options = normalizeDatabaseOptions(property.options, property.type);
    const emptyRows = rows.filter((row) => normalizeMultiChoiceCellValue(row.cells[property.id], options).length === 0);
    return [
      ...options.map((label) => ({
        label,
        rows: rows.filter((row) => normalizeMultiChoiceCellValue(row.cells[property.id], options).includes(label)),
      })),
      ...(emptyRows.length ? [{ label: EMPTY_DATABASE_GROUP, rows: emptyRows }] : []),
    ];
  }

  const labels = isChoiceDatabasePropertyType(property.type)
    ? [...normalizeDatabaseOptions(property.options, property.type)]
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
  const smartDocumentRef = useRef(smartDocument);
  smartDocumentRef.current = smartDocument;
  const uploadImage = smartDocument?.uploadImage || smartDocument?.uploadFile;

  const rowPageEditor = useEditor({
    extensions: createSmartDocumentExtensions({
      placeholder: '输入条目详情，或输入 / 插入块',
      before: [SmartClipboardExtension.configure({
        uploadImage: async file => {
          const upload = smartDocumentRef.current?.uploadImage || smartDocumentRef.current?.uploadFile;
          return typeof upload === 'function' ? upload(file) : null;
        },
        uploadFile: async file => {
          const upload = smartDocumentRef.current?.uploadFile || smartDocumentRef.current?.uploadImage;
          return typeof upload === 'function' ? upload(file) : null;
        },
      })],
      image: DatabaseRowPageImage.configure({
        inline: false,
        allowBase64: true,
      }),
      custom: [
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
        WhiteboardEmbed,
        ToggleBlock,
        CalloutBlock,
        BookmarkBlock,
        EmbedBlock,
        MediaBlock,
        TemplateButtonBlock,
        SyncedBlock,
        PageLinkBlock,
        InlineEquation,
        EquationBlock,
        DatabaseBlock,
      ],
      table: {
        table: Table.configure({ resizable: true }),
        row: TableRow,
        header: TableHeader,
        cell: TableCell,
      },
    }),
    content: getDatabaseRowPageInitialContent(page),
    editorProps: {
      attributes: {
        class: 'smart-document-content smart-document-content--compact min-h-[180px] rounded-b-md outline-none',
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

  const addImageByUrl = async () => {
    if (!rowPageEditor) return;

    const url = await promptForImageUrl();
    if (!url) return;

    rowPageEditor.chain().focus().setImage({ src: url, width: '100%', align: 'center' } as any).run();
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
        <DatabaseRowPageToolbarButton title="图片 URL" onClick={addImageByUrl}>
          <Globe className="h-3.5 w-3.5" />
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
  const boardProperty = database.properties.find((property) => property.type === 'status')
    || database.properties.find((property) => property.type === 'select')
    || database.properties.find((property) => property.type === 'text');
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
  const choiceProperties = database.properties.filter((property) => isChoiceDatabasePropertyType(property.type));
  const relationProperties = database.properties.filter((property) => property.type === 'relation');
  const uploadDatabaseFile = editor?.storage?.smartDocument?.uploadFile || editor?.storage?.smartDocument?.uploadImage;
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

  const updateChoiceOptions = (propertyId: string, value: string) => {
    const properties = database.properties.map((property) => (
      property.id === propertyId && isChoiceDatabasePropertyType(property.type)
        ? { ...property, options: normalizeDatabaseOptions(value, property.type) }
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
      const nextRelationPropertyId = String(patch.relationPropertyId ?? property.relationPropertyId ?? '');
      const relationFallback = database.properties.find((item) => item.type === 'relation' && item.id !== propertyId)?.id;
      const nextTargetPropertyId = String(patch.rollupTargetPropertyId ?? property.rollupTargetPropertyId ?? '');
      const targetFallback = database.properties.find((item) => item.type === 'title' && item.id !== propertyId)?.id
        || database.properties.find((item) => item.id !== propertyId)?.id;

      return {
        ...property,
        ...patch,
        type: nextType,
        options: isChoiceDatabasePropertyType(nextType)
          ? normalizeDatabaseOptions(patch.options ?? property.options, nextType)
          : undefined,
        formula: nextType === 'formula' ? String(patch.formula ?? property.formula ?? '') : undefined,
        relationPropertyId: nextType === 'rollup' ? (nextRelationPropertyId || relationFallback) : undefined,
        rollupTargetPropertyId: nextType === 'rollup' ? (nextTargetPropertyId || targetFallback) : undefined,
        rollupFunction: nextType === 'rollup'
          ? normalizeDatabaseRollupFunction(patch.rollupFunction ?? property.rollupFunction)
          : undefined,
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
    const rows = database.rows
      .filter((row) => row.id !== rowId)
      .map((row) => ({
        ...row,
        cells: Object.fromEntries(database.properties.map((property) => [
          property.id,
          property.type === 'relation'
            ? normalizeRelationCellValue(row.cells[property.id]).filter((relatedId) => relatedId !== rowId)
            : row.cells[property.id],
        ])),
      }));
    commit({ ...database, rows });
  };

  const updateCell = (rowId: string, propertyId: string, value: any) => {
    commit({
      ...database,
      rows: database.rows.map((row) => row.id === rowId ? { ...row, cells: { ...row.cells, [propertyId]: value } } : row),
    });
  };

  const addDatabaseFiles = (row: DatabaseRow, property: DatabaseProperty) => {
    if (property.type !== 'files' || typeof uploadDatabaseFile !== 'function') return;

    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.onchange = async () => {
      const files = Array.from(input.files || []);
      if (!files.length) return;

      const currentFiles = normalizeDatabaseFileValue(row.cells[property.id]);
      const uploadedFiles: DatabaseFileValue[] = [];

      for (const file of files) {
        const url = await uploadDatabaseFile(file);
        if (!url) continue;
        uploadedFiles.push({
          id: createSmartDocumentId('file'),
          url,
          name: file.name,
          mime: file.type || '',
          size: file.size,
          kind: getDatabaseFileKind(file.type || '', file.name),
        });
      }

      if (uploadedFiles.length) {
        updateCell(row.id, property.id, [...currentFiles, ...uploadedFiles]);
      }
    };
    input.click();
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

    if (property.type === 'status' || property.type === 'select') {
      const options = normalizeDatabaseOptions(property.options, property.type);
      const isStatus = property.type === 'status';
      return (
        <select value={String(rawValue || (isStatus ? options[0] : '') || '')} onChange={(event) => updateCell(row.id, property.id, event.target.value)} className={inputClass}>
          {!isStatus && <option value="">未选择</option>}
          {options.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      );
    }

    if (property.type === 'multi_select' || property.type === 'person') {
      const options = normalizeDatabaseOptions(property.options, property.type);
      const values = normalizeMultiChoiceCellValue(rawValue, options);
      const availableOptions = options.filter((option) => !values.includes(option));
      const removeChoice = (choice: string) => {
        updateCell(row.id, property.id, values.filter((item) => item !== choice));
      };
      const isPerson = property.type === 'person';

      return (
        <div className="min-w-0 space-y-1">
          <div className="flex min-h-7 flex-wrap items-center gap-1 rounded border border-transparent px-1 py-0.5 hover:border-gray-200">
            {values.length === 0 && <span className="px-1 text-xs text-gray-400">{isPerson ? '选择人员' : '选择标签'}</span>}
            {values.map((choice) => (
              <button
                key={choice}
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  removeChoice(choice);
                }}
                className={`flex max-w-40 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                  isPerson
                    ? 'border-blue-100 bg-blue-50 text-blue-700 hover:border-red-200 hover:bg-red-50 hover:text-red-600'
                    : 'border-gray-200 bg-gray-50 text-gray-600 hover:border-red-200 hover:bg-red-50 hover:text-red-600'
                }`}
                title={isPerson ? '点击移除人员' : '点击移除选项'}
              >
                {isPerson && (
                  <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 text-[9px] font-semibold text-blue-700">
                    {takeGraphemes(choice, 1).toUpperCase()}
                  </span>
                )}
                <span className="truncate">{choice}</span>
                <X className="h-3 w-3 flex-shrink-0" />
              </button>
            ))}
          </div>
          {availableOptions.length > 0 && (
            <select
              value=""
              onChange={(event) => {
                const nextValue = event.target.value;
                if (!nextValue) return;
                updateCell(row.id, property.id, [...values, nextValue]);
              }}
              className="h-7 w-full rounded border border-gray-200 bg-white px-2 text-xs text-gray-600 outline-none focus:border-gray-400"
            >
              <option value="">{isPerson ? '添加人员...' : '添加选项...'}</option>
              {availableOptions.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          )}
        </div>
      );
    }

    if (property.type === 'date') return <input type="date" value={String(rawValue || '')} onChange={(event) => updateCell(row.id, property.id, event.target.value)} className={inputClass} />;
    if (property.type === 'number') return <input type="number" value={String(rawValue || '')} onChange={(event) => updateCell(row.id, property.id, event.target.value)} className={inputClass} />;
    if (property.type === 'url') return <input type="url" value={String(rawValue || '')} onChange={(event) => updateCell(row.id, property.id, event.target.value)} className={inputClass} placeholder="https://" />;
    if (property.type === 'files') {
      const files = normalizeDatabaseFileValue(rawValue);
      const removeFile = (fileId: string) => {
        updateCell(row.id, property.id, files.filter((file) => file.id !== fileId));
      };

      return (
        <div className="min-w-0 space-y-1">
          <div className="flex min-h-7 flex-wrap items-center gap-1 rounded border border-transparent px-1 py-0.5 hover:border-gray-200">
            {files.length === 0 && <span className="px-1 text-xs text-gray-400">未添加文件</span>}
            {files.map((file) => (
              <span key={file.id} className="flex max-w-48 items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] font-medium text-gray-600">
                <Paperclip className="h-3 w-3 flex-shrink-0 text-gray-400" />
                <a
                  href={file.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-0 truncate text-gray-600 no-underline hover:text-gray-900"
                  title={`${file.name}${formatDatabaseFileSize(file.size) ? ` · ${formatDatabaseFileSize(file.size)}` : ''}`}
                  onClick={(event) => event.stopPropagation()}
                >
                  {file.name}
                </a>
                <button
                  type="button"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    removeFile(file.id);
                  }}
                  className="rounded-full text-gray-300 hover:bg-red-100 hover:text-red-600"
                  title="移除文件"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
          <button
            type="button"
            disabled={typeof uploadDatabaseFile !== 'function'}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              addDatabaseFiles(row, property);
            }}
            className="flex h-7 items-center gap-1 rounded border border-gray-200 bg-white px-2 text-xs font-medium text-gray-500 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" /> 添加文件
          </button>
        </div>
      );
    }
    if (property.type === 'relation') {
      const relationIds = getRelationCellRowIds(database, row, property);
      const availableRows = database.rows.filter((item) => item.id !== row.id && !relationIds.includes(item.id));
      const removeRelation = (relatedId: string) => {
        updateCell(row.id, property.id, relationIds.filter((item) => item !== relatedId));
      };

      return (
        <div className="min-w-0 space-y-1">
          <div className="flex min-h-7 flex-wrap items-center gap-1 rounded border border-transparent px-1 py-0.5 hover:border-gray-200">
            {relationIds.length === 0 && <span className="px-1 text-xs text-gray-400">选择关联条目</span>}
            {relationIds.map((relatedId) => {
              const relatedRow = database.rows.find((item) => item.id === relatedId);
              if (!relatedRow) return null;
              return (
                <button
                  key={relatedId}
                  type="button"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    removeRelation(relatedId);
                  }}
                  className="flex max-w-36 items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] font-medium text-gray-600 hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                  title="点击移除关联"
                >
                  <span className="truncate">{getDatabaseRowTitleValue(database, relatedRow)}</span>
                  <X className="h-3 w-3 flex-shrink-0" />
                </button>
              );
            })}
          </div>
          {availableRows.length > 0 && (
            <select
              value=""
              onChange={(event) => {
                const nextId = event.target.value;
                if (!nextId) return;
                updateCell(row.id, property.id, [...relationIds, nextId]);
              }}
              className="h-7 w-full rounded border border-gray-200 bg-white px-2 text-xs text-gray-600 outline-none focus:border-gray-400"
            >
              <option value="">添加关联...</option>
              {availableRows.map((relatedRow) => (
                <option key={relatedRow.id} value={relatedRow.id}>{getDatabaseRowTitleValue(database, relatedRow)}</option>
              ))}
            </select>
          )}
        </div>
      );
    }
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
    if (property.type === 'rollup') {
      const result = evaluateDatabaseRollup(database, row, property);
      const displayValue = result.error ? `#${result.error}` : formatDatabaseFormulaValue(result.value);
      const isConfigured = Boolean(property.relationPropertyId && property.rollupTargetPropertyId);

      return (
        <div
          title={isConfigured ? displayValue || '无汇总值' : '未设置汇总'}
          className={`flex h-8 min-w-0 items-center rounded px-2 text-xs ${
            result.error
              ? 'bg-red-50 text-red-600'
              : isConfigured
                ? 'bg-gray-50 font-medium text-gray-700'
                : 'bg-gray-50 text-gray-400'
          }`}
        >
          <span className="truncate">{isConfigured ? displayValue : '设置汇总'}</span>
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

      {(database.filters.length > 0 || choiceProperties.length > 0) && (
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
          {choiceProperties.map((property) => (
            <label key={property.id} className="flex min-w-0 items-center gap-1 text-[11px] text-gray-500">
              <span className="max-w-20 truncate">{property.name}</span>
              <input
                value={normalizeDatabaseOptions(property.options, property.type).join(', ')}
                onChange={(event) => updateChoiceOptions(property.id, event.target.value)}
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
                {property.type === 'relation' && (
                  <div className="mt-1 rounded border border-gray-100 bg-white px-1.5 py-1 text-[10px] font-normal text-gray-400">
                    关联当前数据库条目
                  </div>
                )}
                {property.type === 'rollup' && (
                  <div className="mt-1 space-y-1 rounded border border-gray-200 bg-white px-1.5 py-1">
                    {relationProperties.length === 0 ? (
                      <div className="text-[10px] font-normal text-gray-400">先添加一个关系属性</div>
                    ) : (
                      <>
                        <select
                          value={property.relationPropertyId || relationProperties[0]?.id || ''}
                          onChange={(event) => updateProperty(property.id, { relationPropertyId: event.target.value })}
                          className="h-6 w-full rounded border border-gray-100 bg-gray-50 px-1 text-[10px] font-normal text-gray-600 outline-none focus:border-gray-300"
                          title="关系属性"
                        >
                          {relationProperties.map((relationProperty) => (
                            <option key={relationProperty.id} value={relationProperty.id}>{relationProperty.name}</option>
                          ))}
                        </select>
                        <select
                          value={property.rollupTargetPropertyId || titleProperty.id}
                          onChange={(event) => updateProperty(property.id, { rollupTargetPropertyId: event.target.value })}
                          className="h-6 w-full rounded border border-gray-100 bg-gray-50 px-1 text-[10px] font-normal text-gray-600 outline-none focus:border-gray-300"
                          title="目标属性"
                        >
                          {database.properties.filter((item) => item.id !== property.id).map((targetProperty) => (
                            <option key={targetProperty.id} value={targetProperty.id}>{targetProperty.name}</option>
                          ))}
                        </select>
                        <select
                          value={normalizeDatabaseRollupFunction(property.rollupFunction)}
                          onChange={(event) => updateProperty(property.id, { rollupFunction: event.target.value as DatabaseRollupFunction })}
                          className="h-6 w-full rounded border border-gray-100 bg-gray-50 px-1 text-[10px] font-normal text-gray-600 outline-none focus:border-gray-300"
                          title="汇总方式"
                        >
                          {DATABASE_ROLLUP_FUNCTIONS.map((rollupFunction) => (
                            <option key={rollupFunction.value} value={rollupFunction.value}>{rollupFunction.label}</option>
                          ))}
                        </select>
                      </>
                    )}
                  </div>
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

const RESEARCH_PAGE_CATEGORIES = new Set(['document', 'idea', 'meeting']);

const getPageLinkView = (category?: string | null) => {
  return category === 'note' || !category ? 'notes' : 'sop';
};

const getPageLinkHref = (pageId?: string | null, category?: string | null) => {
  if (!pageId) return '#';
  if (category && RESEARCH_PAGE_CATEGORIES.has(category)) {
    return `/research?type=${encodeURIComponent(category)}&doc=${encodeURIComponent(pageId)}`;
  }
  return `/notes?view=${getPageLinkView(category)}&doc=${encodeURIComponent(pageId)}`;
};

const getPageLinkCategoryLabel = (category?: string | null) => {
  if (category === 'note' || !category) return '文档';
  if (category === 'people') return '识人 SOP';
  if (category === 'business') return '商业 SOP';
  if (category === 'brand') return '品牌 SOP';
  if (category === 'document') return '科研文档';
  if (category === 'idea') return '科研想法';
  if (category === 'meeting') return '科研会议';
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
  const navigate = useNavigate();
  const requestNavigation = useDocumentNavigationRequest();
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
    if (!editor.isEditable) return;
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
            if (!pageId) {
              event.preventDefault();
              return;
            }
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            void requestNavigation().then((canNavigate) => {
              if (canNavigate) navigate(href);
            });
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
          disabled={!editor.isEditable}
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

const decodeEquationAttribute = (value: string | null) => decodeLegacyEncodedFormula(value);

const normalizeEquationFormula = (value: unknown) => decodeLegacyEncodedFormula(value);

const renderInlineEquation = (formula: string) => {
  const source = formula.trim() || DEFAULT_EQUATION;
  try {
    return katex.renderToString(source, {
      displayMode: false,
      throwOnError: false,
      strict: false,
      output: 'html',
    });
  } catch {
    return katex.renderToString(DEFAULT_EQUATION, {
      displayMode: false,
      throwOnError: false,
      strict: false,
      output: 'html',
    });
  }
};

const InlineEquationView = ({ node, selected }: any) => {
  const formula = normalizeEquationFormula(node.attrs.formula) || DEFAULT_EQUATION;
  const previewHtml = useMemo(() => renderInlineEquation(formula), [formula]);

  return (
    <NodeViewWrapper
      as="span"
      className={`smart-doc-inline-equation inline-flex rounded px-0.5 align-baseline ${
        selected ? 'bg-blue-50 ring-1 ring-blue-200' : ''
      }`}
      data-type="inline-equation"
      data-equation={formula}
      contentEditable={false}
    >
      <span dangerouslySetInnerHTML={{ __html: previewHtml }} />
    </NodeViewWrapper>
  );
};

export const InlineEquation = Node.create({
  name: 'inlineEquation',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      formula: {
        default: DEFAULT_EQUATION,
        parseHTML: element => decodeEquationAttribute(element.getAttribute('data-equation')) || element.textContent?.trim() || DEFAULT_EQUATION,
        renderHTML: attributes => ({
          'data-equation': encodeURIComponent(normalizeEquationFormula(attributes.formula) || DEFAULT_EQUATION),
        }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-type="inline-equation"]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const formula = normalizeEquationFormula(node.attrs.formula) || DEFAULT_EQUATION;
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'inline-equation',
        'data-equation': encodeURIComponent(formula),
        class: 'smart-doc-inline-equation',
      }),
      formula,
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(InlineEquationView)
  },
});

const EquationBlockView = ({ node, updateAttributes, selected }: any) => {
  const formula = normalizeEquationFormula(node.attrs.formula) || DEFAULT_EQUATION;
  const [draft, setDraft] = useState(formula);
  const previewHtml = useMemo(() => renderEquation(draft), [draft]);
  const commentsAttr = Array.isArray(node.attrs.blockComments) && node.attrs.blockComments.length
    ? encodeJsonAttribute(node.attrs.blockComments)
    : undefined;

  useEffect(() => {
    setDraft(formula);
  }, [formula]);

  const commit = () => {
    const next = normalizeEquationFormula(draft) || DEFAULT_EQUATION;
    setDraft(next);
    if (next !== formula) updateAttributes({ formula: next });
  };

  return (
    <NodeViewWrapper
      className={`smart-doc-equation group my-3 rounded-md border bg-white px-4 py-3 transition-colors ${
        selected ? 'border-gray-400 shadow-sm' : 'border-gray-200 hover:border-gray-300'
      }`}
      data-type="equation"
      data-equation={formula}
      data-block-id={node.attrs.blockId || undefined}
      data-comments={commentsAttr}
      id={blockDomId(node.attrs.blockId)}
      contentEditable={false}
    >
      <div
        className="min-h-10 overflow-x-auto rounded bg-gray-50 px-3 py-3 text-center text-gray-900"
        role="math"
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
    const formula = normalizeEquationFormula(node.attrs.formula) || DEFAULT_EQUATION;
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

type SlashCommandCategory = 'basic' | 'media' | 'layout' | 'data' | 'advanced';
type SlashCommandGroup = SlashCommandCategory | 'recent';

type SlashCommandItem = {
  title: string;
  shortcut: string;
  icon: ReactNode;
  category: SlashCommandCategory;
  group?: SlashCommandGroup;
  description?: string;
  aliases?: string[];
  command: (props: any) => void | Promise<void>;
};

const SLASH_COMMAND_CATEGORY_LABELS: Record<SlashCommandCategory, string> = {
  basic: '基础块',
  media: '媒体',
  layout: '布局',
  data: '数据',
  advanced: '高级块',
};

const SLASH_COMMAND_CATEGORY_ORDER: SlashCommandCategory[] = ['basic', 'media', 'layout', 'data', 'advanced'];
const SLASH_COMMAND_GROUP_LABELS: Record<SlashCommandGroup, string> = {
  recent: '最近使用',
  ...SLASH_COMMAND_CATEGORY_LABELS,
};
const SLASH_RECENT_COMMANDS_STORAGE_KEY = 'smart-document.slash.recent';
const SLASH_RECENT_COMMANDS_LIMIT = 5;

const normalizeSlashSearchValue = (value: string) => value
  .toLowerCase()
  .replace(/^\/+/, '')
  .replace(/\s+/g, '');

const readRecentSlashCommandShortcuts = () => {
  if (typeof window === 'undefined') return [];

  try {
    const parsed = JSON.parse(window.localStorage.getItem(SLASH_RECENT_COMMANDS_STORAGE_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];

    const seen = new Set<string>();
    return parsed
      .map((shortcut) => String(shortcut || '').trim())
      .filter((shortcut) => {
        if (!shortcut.startsWith('/') || seen.has(shortcut)) return false;
        seen.add(shortcut);
        return true;
      })
      .slice(0, SLASH_RECENT_COMMANDS_LIMIT);
  } catch {
    return [];
  }
};

const recordSlashCommandUsage = (item: SlashCommandItem | null | undefined) => {
  if (typeof window === 'undefined' || !item?.shortcut) return;

  const nextShortcuts = [
    item.shortcut,
    ...readRecentSlashCommandShortcuts().filter((shortcut) => shortcut !== item.shortcut),
  ].slice(0, SLASH_RECENT_COMMANDS_LIMIT);

  try {
    window.localStorage.setItem(SLASH_RECENT_COMMANDS_STORAGE_KEY, JSON.stringify(nextShortcuts));
  } catch {}
};

const getSlashCommandSearchValues = (item: SlashCommandItem) => ([
  { value: item.shortcut, weight: 100 },
  { value: item.shortcut.replace(/^\/+/, ''), weight: 100 },
  { value: item.title, weight: 90 },
  ...(item.aliases || []).map((alias) => ({ value: alias, weight: 80 })),
  { value: item.description || '', weight: 30 },
]);

const getSlashCommandMatchScore = (item: SlashCommandItem, query: string) => {
  const normalizedQuery = normalizeSlashSearchValue(query);
  if (!normalizedQuery) return 0;

  return getSlashCommandSearchValues(item).reduce((best, entry) => {
    const value = normalizeSlashSearchValue(entry.value);
    if (!value) return best;

    if (value === normalizedQuery) return Math.max(best, entry.weight + 100);
    if (value.startsWith(normalizedQuery)) return Math.max(best, entry.weight + 20);

    const index = value.indexOf(normalizedQuery);
    if (index >= 0) return Math.max(best, entry.weight + Math.max(1, 12 - index));

    return best;
  }, -1);
};

const getSlashCategoryRank = (category: SlashCommandCategory) => (
  SLASH_COMMAND_CATEGORY_ORDER.indexOf(category)
);

const getSlashCommandGroup = (item: SlashCommandItem): SlashCommandGroup => item.group || item.category;

const slashCommandMatches = (item: SlashCommandItem, query: string) => {
  if (!normalizeSlashSearchValue(query)) return true;
  return getSlashCommandMatchScore(item, query) >= 0;
};

const CommandList = forwardRef((props: any, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  const selectItem = (index: number) => {
    const item = props.items[index];

    if (item) {
      recordSlashCommandUsage(item);
      props.command(item);
    }
  };

  useEffect(() => {
    setSelectedIndex(0);
  }, [props.items]);

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }: { event: KeyboardEvent }) => {
      if (!props.items.length) return false;

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

CommandList.displayName = 'LegacyCommandList';

const GroupedCommandList = forwardRef((props: any, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  const selectItem = (index: number) => {
    const item = props.items[index];
    if (item) {
      recordSlashCommandUsage(item);
      props.command(item);
    }
  };

  useEffect(() => {
    setSelectedIndex(0);
  }, [props.items]);

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }: { event: KeyboardEvent }) => {
      if (!props.items.length) return false;

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
    <div className="max-h-[360px] w-80 overflow-y-auto overflow-x-hidden rounded-lg border border-gray-100 bg-white p-1 shadow-xl">
      {props.items.length ? (
        props.items.map((item: SlashCommandItem, index: number) => {
          const previousItem = props.items[index - 1] as SlashCommandItem | undefined;
          const group = getSlashCommandGroup(item);
          const showCategory = !previousItem || getSlashCommandGroup(previousItem) !== group;

          return (
            <div key={`${item.shortcut}-${index}`}>
              {showCategory && (
                <div className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400 first:pt-1">
                  {SLASH_COMMAND_GROUP_LABELS[group]}
                </div>
              )}
              <button
                className={`flex w-full items-center rounded-md px-2 py-2 text-left text-sm transition-colors ${
                  index === selectedIndex ? 'bg-gray-100 text-primary' : 'text-gray-700 hover:bg-gray-50'
                }`}
                onClick={() => selectItem(index)}
              >
                <div className="mr-3 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded border border-gray-200 bg-gray-50 text-gray-500">
                  {item.icon}
                </div>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium">{item.title}</span>
                  {item.description && <span className="mt-0.5 truncate text-[11px] text-gray-400">{item.description}</span>}
                </div>
                {item.shortcut && <span className="ml-3 flex-shrink-0 font-mono text-[10px] text-gray-400">{item.shortcut}</span>}
              </button>
            </div>
          );
        })
      ) : (
        <div className="px-4 py-5 text-center">
          <div className="text-sm font-medium text-gray-700">没有匹配的命令</div>
          <div className="mt-1 text-xs leading-5 text-gray-400">
            试试输入 table、image、database，或者换一个更短的关键词。
          </div>
        </div>
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

type SmartDocumentMediaKind = 'video' | 'audio' | 'pdf' | 'file';

const getMediaKindFromUrl = (url: string, forcedKind?: SmartDocumentMediaKind): SmartDocumentMediaKind => {
  if (forcedKind) return forcedKind;
  const pathname = (() => {
    try {
      return new URL(url, window.location.origin).pathname.toLowerCase();
    } catch {
      return url.toLowerCase();
    }
  })();

  if (/\.(mp4|webm|mov|m4v|ogv)$/i.test(pathname)) return 'video';
  if (/\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(pathname)) return 'audio';
  if (/\.pdf$/i.test(pathname)) return 'pdf';
  return 'file';
};

const getMediaNameFromUrl = (url: string, kind: SmartDocumentMediaKind) => {
  try {
    const parsed = new URL(url, window.location.origin);
    const lastSegment = parsed.pathname.split('/').filter(Boolean).pop();
    if (lastSegment) {
      try {
        return decodeURIComponent(lastSegment);
      } catch {
        return lastSegment;
      }
    }
    return parsed.hostname || url;
  } catch {
    return kind === 'video' ? '视频'
      : kind === 'audio' ? '音频'
        : kind === 'pdf' ? 'PDF'
          : '文件';
  }
};

const getMediaMimeFromUrl = (url: string, kind: SmartDocumentMediaKind) => {
  const lower = url.toLowerCase();
  if (kind === 'video') {
    if (lower.includes('.webm')) return 'video/webm';
    if (lower.includes('.mov')) return 'video/quicktime';
    return 'video/mp4';
  }
  if (kind === 'audio') {
    if (lower.includes('.wav')) return 'audio/wav';
    if (lower.includes('.ogg')) return 'audio/ogg';
    return 'audio/mpeg';
  }
  if (kind === 'pdf') return 'application/pdf';
  return '';
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

const insertMediaFromUrl = async ({ editor, range, forcedKind, title }: any) => {
  const url = await promptForUrl({
    title,
    placeholder: forcedKind === 'video'
      ? 'https://example.com/video.mp4'
      : forcedKind === 'audio'
        ? 'https://example.com/audio.mp3'
        : forcedKind === 'pdf'
          ? 'https://example.com/file.pdf'
          : 'https://example.com/file.pdf',
    confirmLabel: '插入',
  });
  if (!url) return;

  const kind = getMediaKindFromUrl(url, forcedKind);
  editor.chain().focus().deleteRange(range).insertContent({
    type: 'mediaBlock',
    attrs: {
      url,
      name: getMediaNameFromUrl(url, kind),
      mime: getMediaMimeFromUrl(url, kind),
      size: 0,
      kind,
    },
  }).run();
};

type PromptForTextOptions = {
  title: string;
  initialValue?: string;
  placeholder?: string;
  allowEmpty?: boolean;
  confirmLabel?: string;
  invalidMessage?: string;
  inputType?: string;
  readOnly?: boolean;
  validate?: (value: unknown) => string;
};

type PromptForUrlOptions = Omit<PromptForTextOptions, 'inputType' | 'validate'> & {
  normalize?: (value: unknown) => string;
};

export const normalizeUrlInput = (value: unknown) => {
  const raw = String(value || '').trim();
  if (!raw || /\s/.test(raw)) return '';
  if (raw.startsWith('/')) return raw.startsWith('//') ? `${window.location.protocol}${raw}` : raw;

  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;

  try {
    const url = new URL(candidate, window.location.origin);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
};

export const normalizeImageUrlInput = (value: unknown) => {
  const raw = String(value || '').trim();
  if (!raw || /\s/.test(raw)) return '';
  if (/^data:image\//i.test(raw) || /^blob:/i.test(raw)) return raw;
  return normalizeUrlInput(raw);
};

export const promptForText = ({
  title,
  initialValue = '',
  placeholder = '',
  allowEmpty = false,
  confirmLabel = '确认',
  invalidMessage = '请输入内容',
  inputType = 'text',
  readOnly = false,
  validate,
}: PromptForTextOptions): Promise<string | null> => {
  if (typeof document === 'undefined') return Promise.resolve(null);

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 z-[9999] flex items-center justify-center bg-black/30 px-4';

    const panel = document.createElement('div');
    panel.className = 'w-full max-w-md rounded-lg border border-gray-200 bg-white p-4 shadow-xl';

    const heading = document.createElement('div');
    heading.className = 'text-sm font-semibold text-gray-900';
    heading.textContent = title;

    const input = document.createElement('input');
    input.type = inputType;
    input.value = initialValue;
    input.placeholder = placeholder;
    input.readOnly = readOnly;
    input.className = 'mt-3 w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-500';

    const error = document.createElement('div');
    error.className = 'mt-2 hidden text-xs text-red-600';
    error.textContent = invalidMessage;

    const actions = document.createElement('div');
    actions.className = 'mt-4 flex justify-end gap-2';

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50';
    cancelButton.textContent = '取消';

    const confirmButton = document.createElement('button');
    confirmButton.type = 'button';
    confirmButton.className = 'rounded-md bg-gray-900 px-3 py-1.5 text-sm text-white hover:bg-gray-800';
    confirmButton.textContent = confirmLabel;

    actions.append(cancelButton, confirmButton);
    panel.append(heading, input, error, actions);
    overlay.append(panel);
    document.body.append(overlay);

    let settled = false;

    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      overlay.removeEventListener('click', handleOverlayClick);
      document.removeEventListener('keydown', handleKeyDown);
      overlay.remove();
      resolve(value);
    };

    const confirm = () => {
      if (allowEmpty && input.value.trim() === '') {
        finish('');
        return;
      }

      const value = validate ? validate(input.value) : String(input.value || '').trim();
      if (!value) {
        error.classList.remove('hidden');
        input.focus();
        return;
      }
      finish(value);
    };

    function handleOverlayClick(event: MouseEvent) {
      if (event.target === overlay) finish(null);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') finish(null);
      if (event.key === 'Enter') {
        event.preventDefault();
        confirm();
      }
    }

    overlay.addEventListener('click', handleOverlayClick);
    document.addEventListener('keydown', handleKeyDown);
    cancelButton.addEventListener('click', () => finish(null));
    confirmButton.addEventListener('click', confirm);

    window.setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
  });
};

export const promptForUrl = ({
  normalize = normalizeUrlInput,
  invalidMessage = '请输入有效的 URL',
  placeholder = 'https://example.com',
  ...options
}: PromptForUrlOptions): Promise<string | null> => (
  promptForText({
    ...options,
    placeholder,
    invalidMessage,
    inputType: 'url',
    validate: (value) => normalize(value),
  })
);

export const promptForImageUrl = (initialValue: string = ''): Promise<string | null> => (
  promptForUrl({
    title: '插入图片 URL',
    initialValue,
    placeholder: 'https://example.com/image.png',
    confirmLabel: '插入',
    invalidMessage: '请输入有效的图片 URL',
    normalize: normalizeImageUrlInput,
  })
);

const SLASH_COMMAND_METADATA: Record<string, Pick<SlashCommandItem, 'category' | 'description' | 'aliases'>> = {
  '/bt1': { category: 'basic', description: '大标题，用来分隔页面主段落', aliases: ['h1', 'heading1', 'title', '一级标题'] },
  '/bt2': { category: 'basic', description: '二级标题，用来组织章节', aliases: ['h2', 'heading2', '二级标题'] },
  '/bt3': { category: 'basic', description: '三级标题，用来组织小节', aliases: ['h3', 'heading3', '三级标题'] },
  '/wb': { category: 'basic', description: '普通正文段落', aliases: ['text', 'paragraph', '正文', '文本'] },
  '/xmlb': { category: 'basic', description: '无序项目列表', aliases: ['bullet', 'list', '项目符号', '列表'] },
  '/bhlb': { category: 'basic', description: '有序编号列表', aliases: ['numbered', 'ordered', 'ol', '编号'] },
  '/dblb': { category: 'basic', description: '可勾选待办事项', aliases: ['todo', 'task', 'checkbox', '待办'] },
  '/yywz': { category: 'basic', description: '引用一段文字', aliases: ['quote', 'blockquote', '引用'] },
  '/dmk': { category: 'basic', description: '多行代码块', aliases: ['code', 'codeblock', '代码'] },
  '/mermaid': { category: 'advanced', description: '把流程图、时序图或状态图渲染为可编辑图表', aliases: ['diagram', 'flowchart', '流程图', '图表'] },
  '/fgx': { category: 'basic', description: '页面分割线', aliases: ['divider', 'hr', '分割线'] },
  '/tp': { category: 'media', description: '上传本地图片', aliases: ['image', 'picture', 'upload image', '图片'] },
  '/tpurl': { category: 'media', description: '通过 URL 插入图片', aliases: ['image url', 'picture url', '图片链接'] },
  '/file': { category: 'media', description: '上传附件文件', aliases: ['attachment', 'upload file', '文件'] },
  '/fileurl': { category: 'media', description: '通过 URL 插入附件', aliases: ['file url', 'attachment url', '文件链接'] },
  '/video': { category: 'media', description: '上传视频块', aliases: ['movie', 'mp4', '视频'] },
  '/videourl': { category: 'media', description: '通过 URL 插入视频', aliases: ['video url', 'mp4 url', '视频链接'] },
  '/audio': { category: 'media', description: '上传音频块', aliases: ['sound', 'music', '音频'] },
  '/audiourl': { category: 'media', description: '通过 URL 插入音频', aliases: ['audio url', 'sound url', '音频链接'] },
  '/pdf': { category: 'media', description: '上传 PDF 预览块', aliases: ['document', 'pdf file'] },
  '/pdfurl': { category: 'media', description: '通过 URL 插入 PDF', aliases: ['pdf url', 'pdf链接'] },
  '/bookmark': { category: 'media', description: '生成网页书签卡片', aliases: ['web bookmark', 'link preview', '网页书签'] },
  '/embed': { category: 'media', description: '嵌入网页或外部工具', aliases: ['iframe', 'embed url', '嵌入'] },
  '/2': { category: 'layout', description: '插入两栏布局', aliases: ['columns', 'two columns', '两栏', '2栏'] },
  '/3': { category: 'layout', description: '插入三栏布局', aliases: ['columns', 'three columns', '三栏', '3栏'] },
  '/table': { category: 'layout', description: '插入普通 3x3 表格', aliases: ['simple table', '表格', 'table'] },
  '/swdt': { category: 'advanced', description: '插入可编辑思维导图', aliases: ['mindmap', 'mind map', '导图'] },
  '/whiteboard': { category: 'media', description: '插入可复用的 Excalidraw 白板', aliases: ['excalidraw', 'whiteboard', '白板', '画板'] },
  '/toggle': { category: 'advanced', description: '可折叠内容块', aliases: ['toggle list', '折叠', 'toggle'] },
  '/toggle1': { category: 'advanced', description: '可折叠的一级章节标题', aliases: ['toggle h1', '折叠一级标题'] },
  '/toggle2': { category: 'advanced', description: '可折叠的二级章节标题', aliases: ['toggle h2', '折叠二级标题'] },
  '/toggle3': { category: 'advanced', description: '可折叠的三级章节标题', aliases: ['toggle h3', '折叠三级标题'] },
  '/callout': { category: 'advanced', description: '强调提示块', aliases: ['notice', 'hint', '提示', '标注'] },
  '/equation': { category: 'advanced', description: 'LaTeX 公式块', aliases: ['math', 'formula', '公式'] },
  '/sync': { category: 'advanced', description: '同一文档内同步内容块', aliases: ['synced', 'sync block', '同步块'] },
  '/template': { category: 'advanced', description: '点击后插入预设内容', aliases: ['template button', 'button', '模板按钮'] },
  '/page': { category: 'advanced', description: '链接到已有文档或 SOP', aliases: ['page link', 'document link', '页面链接'] },
  '/database': { category: 'data', description: '插入带多视图的数据库', aliases: ['db', 'table view', '数据库'] },
};

const enrichSlashCommandItem = (item: Omit<SlashCommandItem, 'category'> & Partial<Pick<SlashCommandItem, 'category'>>) => {
  const metadata = SLASH_COMMAND_METADATA[item.shortcut] || { category: 'advanced' as SlashCommandCategory };
  return {
    ...item,
    ...metadata,
    aliases: [...(metadata.aliases || []), ...(item.aliases || [])],
  } as SlashCommandItem;
};

export const getSuggestionItems = ({ query }: { query: string }) => {
  const items = [
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
      title: 'Mermaid 图表',
      shortcut: '/mermaid',
      icon: <Network className="w-3 h-3" />,
      command: ({ editor, range }: any) => {
        editor.chain().focus().deleteRange(range).insertContent({
          type: 'codeBlock',
          attrs: { language: 'mermaid' },
          content: [{ type: 'text', text: 'flowchart TD\n  A[开始] --> B[下一步]' }],
        }).run();
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
        title: '图片 URL',
        shortcut: '/tpurl',
        icon: <Globe className="w-3 h-3" />,
        command: async ({ editor, range }: any) => {
            const url = await promptForImageUrl();
            if (!url) return;
            editor.chain().focus().deleteRange(range).setImage({ src: url, width: '100%', align: 'center' }).run();
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
                    data: isMindMapV2Enabled()
                        ? createMindMapBlockDocument({ rootTitle: '中心主题' })
                        : {
                            nodes: [{ id: 'root', type: 'mindMap', data: { label: '中心主题' }, position: { x: 0, y: 0 } }],
                            edges: [],
                        }
                }
            }).run();
        },
    },
    {
      title: '白板',
      shortcut: '/whiteboard',
      icon: <Palette className="w-3 h-3" />,
      command: ({ editor, range }: any) => {
        void insertWhiteboardIntoEditor(editor, range);
      },
    },
    {
      title: '折叠块',
      shortcut: '/toggle',
      icon: <ChevronRight className="w-3 h-3" />,
      command: ({ editor, range }: any) => {
        editor.chain().focus().deleteRange(range).insertContent({
          type: 'toggleBlock',
          attrs: { title: '折叠内容', open: true },
          content: [{ type: 'paragraph' }],
        }).run();
      },
    },
    ...([1, 2, 3] as const).map((level) => ({
      title: `折叠${['一', '二', '三'][level - 1]}级标题`,
      shortcut: `/toggle${level}`,
      icon: level === 1
        ? <Heading1 className="w-3 h-3" />
        : level === 2
          ? <Heading2 className="w-3 h-3" />
          : <Heading3 className="w-3 h-3" />,
      command: ({ editor, range }: any) => {
        editor.chain().focus().deleteRange(range).insertContent({
          type: 'toggleBlock',
          attrs: { title: '折叠标题', open: true, level },
          content: [{ type: 'paragraph' }],
        }).run();
      },
    })),
    {
      title: '提示块',
      shortcut: '/callout',
      icon: <AlertTriangle className="w-3 h-3" />,
      command: ({ editor, range }: any) => {
        editor.chain().focus().deleteRange(range).insertContent({
          type: 'calloutBlock',
          attrs: { icon: '!', tone: 'yellow' },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: '补充说明' }] }],
        }).run();
      },
    },
    {
      title: '网页书签',
      shortcut: '/bookmark',
      icon: <Bookmark className="w-3 h-3" />,
      command: async ({ editor, range }: any) => {
        const url = await promptForUrl({
          title: '插入书签',
          placeholder: 'https://example.com',
          confirmLabel: '插入',
        });
        if (!url) return;
        editor.chain().focus().deleteRange(range).insertContent({
          type: 'bookmarkBlock',
          attrs: { url, title: url, description: url },
        }).run();
      },
    },
    {
      title: '网页嵌入',
      shortcut: '/embed',
      icon: <Globe className="w-3 h-3" />,
      command: async ({ editor, range }: any) => {
        const url = await promptForUrl({
          title: '插入嵌入',
          placeholder: 'https://example.com',
          confirmLabel: '插入',
        });
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
      title: '上传文件',
      shortcut: '/file',
      icon: <Paperclip className="w-3 h-3" />,
      command: ({ editor, range }: any) => insertUploadedMedia({ editor, range }),
    },
    {
      title: '文件 URL',
      shortcut: '/fileurl',
      icon: <Globe className="w-3 h-3" />,
      command: ({ editor, range }: any) => insertMediaFromUrl({ editor, range, title: '插入文件 URL' }),
    },
    {
      title: '上传视频',
      shortcut: '/video',
      icon: <Video className="w-3 h-3" />,
      command: ({ editor, range }: any) => insertUploadedMedia({ editor, range, accept: 'video/*', forcedKind: 'video' }),
    },
    {
      title: '视频 URL',
      shortcut: '/videourl',
      icon: <Globe className="w-3 h-3" />,
      command: ({ editor, range }: any) => insertMediaFromUrl({ editor, range, forcedKind: 'video', title: '插入视频 URL' }),
    },
    {
      title: '上传音频',
      shortcut: '/audio',
      icon: <Music className="w-3 h-3" />,
      command: ({ editor, range }: any) => insertUploadedMedia({ editor, range, accept: 'audio/*', forcedKind: 'audio' }),
    },
    {
      title: '音频 URL',
      shortcut: '/audiourl',
      icon: <Globe className="w-3 h-3" />,
      command: ({ editor, range }: any) => insertMediaFromUrl({ editor, range, forcedKind: 'audio', title: '插入音频 URL' }),
    },
    {
      title: 'PDF',
      shortcut: '/pdf',
      icon: <FileText className="w-3 h-3" />,
      command: ({ editor, range }: any) => insertUploadedMedia({ editor, range, accept: 'application/pdf', forcedKind: 'pdf' }),
    },
    {
      title: 'PDF URL',
      shortcut: '/pdfurl',
      icon: <Globe className="w-3 h-3" />,
      command: ({ editor, range }: any) => insertMediaFromUrl({ editor, range, forcedKind: 'pdf', title: '插入 PDF URL' }),
    },
    {
      title: '普通表格',
      shortcut: '/table',
      icon: <TableIcon className="w-3 h-3" />,
      command: ({ editor, range }: any) => {
        editor.chain().focus().deleteRange(range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
      },
    },
  ];

  const normalizedQuery = normalizeSlashSearchValue(query);
  const enrichedItems = items.map(enrichSlashCommandItem);

  if (!normalizedQuery) {
    const recentItems = readRecentSlashCommandShortcuts()
      .map((shortcut) => enrichedItems.find((item) => item.shortcut === shortcut))
      .filter(Boolean)
      .map((item) => ({ ...(item as SlashCommandItem), group: 'recent' as const }));
    const recentShortcuts = new Set(recentItems.map((item) => item.shortcut));

    return [
      ...recentItems,
      ...enrichedItems
        .filter((item) => !recentShortcuts.has(item.shortcut))
        .map((item, index) => ({ item, index }))
        .sort((left, right) => (
          getSlashCategoryRank(left.item.category) - getSlashCategoryRank(right.item.category) || left.index - right.index
        ))
        .map(({ item }) => item),
    ];
  }

  return enrichedItems
    .map((item, index) => ({
      item,
      index,
      score: getSlashCommandMatchScore(item, query),
    }))
    .filter(({ item, score }) => !normalizedQuery || (score >= 0 && slashCommandMatches(item, query)))
    .sort((left, right) => {
      if (normalizedQuery && left.score !== right.score) return right.score - left.score;
      return getSlashCategoryRank(left.item.category) - getSlashCategoryRank(right.item.category) || left.index - right.index;
    })
    .map(({ item }) => item);
};

export const renderItems = () => {
  let component: any;
  let popup: any;

  return {
    onStart: (props: any) => {
      component = new ReactRenderer(GroupedCommandList, {
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
