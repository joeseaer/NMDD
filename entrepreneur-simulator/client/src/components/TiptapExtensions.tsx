
import { Node, mergeAttributes, InputRule, Extension } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';
import { ReactRenderer } from '@tiptap/react';
import tippy from 'tippy.js';
import { useState, useEffect, forwardRef, useImperativeHandle } from 'react';
import { 
  Heading1, Heading2, Heading3, List, ListOrdered, CheckSquare, 
  Quote, Minus, Code, Layout, Image as ImageIcon,
  Type
} from 'lucide-react';

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
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'column-list', class: 'flex gap-4 my-4' }), 0]
  },

  addCommands() {
    return {
      setColumns: (cols: number) => ({ commands }: any) => {
        // Create columns based on the number requested
        const columns = Array.from({ length: cols }).map(() => ({
          type: 'column',
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
          const columns = Array.from({ length: 2 }).map(() => schema.nodes.column.create(null, [
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
          const columns = Array.from({ length: 3 }).map(() => schema.nodes.column.create(null, [
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

  parseHTML() {
    return [
      {
        tag: 'div[data-type="column"]',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'column', class: 'flex-1 min-w-0 border border-dashed border-gray-200 p-2 rounded-lg' }), 0]
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
            // Trigger image upload dialog
             const input = document.createElement('input');
             input.type = 'file';
             input.accept = 'image/*';
             input.onchange = async () => {
                 if (input.files?.length) {
                    // Note: We need to access the uploadImage function from the editor context
                    // For now, we'll dispatch a custom event or rely on the parent component
                    // This is a limitation of this decoupled implementation
                    alert("请点击工具栏图片按钮上传");
                 }
             };
             // Ideally we would trigger the parent's upload handler
             editor.chain().focus().deleteRange(range).run();
             // input.click(); // Removed for now as we need async upload logic
             
             // Alternative: just delete range and let user click toolbar
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
