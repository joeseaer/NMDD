
import { Node, mergeAttributes, InputRule, Extension } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';
import { ReactRenderer, ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import tippy from 'tippy.js';
import { useState, useEffect, useMemo, forwardRef, useImperativeHandle } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { 
  Heading1, Heading2, Heading3, List, ListOrdered, CheckSquare, 
  Quote, Minus, Code, Layout, Image as ImageIcon,
  Type, Network, ChevronRight, AlertTriangle, Bookmark, Globe,
  Paperclip, Video, Music, FileText, Sigma
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
