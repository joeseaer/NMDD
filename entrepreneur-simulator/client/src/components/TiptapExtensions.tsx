
import { Node, mergeAttributes, InputRule } from '@tiptap/core';

// --- Module Augmentation for Commands ---
declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    columnList: {
      /**
       * Set the number of columns
       */
      setColumns: (cols: number) => ReturnType;
    }
  }
}

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
        handler: ({ state, range, match }) => {
          const { tr } = state;
          const start = range.from;
          const end = range.to;
          
          tr.delete(start, end); // Delete the "/2 " text
          
          // Insert 2 columns
          const columns = Array.from({ length: 2 }).map(() => ({
            type: 'column',
            content: [{ type: 'paragraph' }]
          }));
          
          const node = this.type.create(null, columns);
          tr.replaceSelectionWith(node);
        },
      }),
      new InputRule({
        find: /^\/3\s$/, // Matches "/3 "
        handler: ({ state, range, match }) => {
          const { tr } = state;
          const start = range.from;
          const end = range.to;
          
          tr.delete(start, end); // Delete the "/3 " text
          
          // Insert 3 columns
          const columns = Array.from({ length: 3 }).map(() => ({
            type: 'column',
            content: [{ type: 'paragraph' }]
          }));
          
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
