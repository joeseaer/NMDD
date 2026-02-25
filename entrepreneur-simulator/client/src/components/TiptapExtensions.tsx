
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent } from '@tiptap/react';
import React from 'react';

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
        // This is a simplified implementation. 
        // Real implementation might need to wrap current selection.
        // For now, we insert a new column block.
        
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

// --- Slash Command Helper (Input Rules) ---
// We will add input rules in the main editor config, 
// but we can export the regex helpers here if needed.
