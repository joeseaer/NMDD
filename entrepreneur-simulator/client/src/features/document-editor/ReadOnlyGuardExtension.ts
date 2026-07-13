import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

/**
 * NodeView controls can dispatch transactions even when ProseMirror's content
 * DOM is non-editable. Reject every document-changing transaction in read mode
 * so a forgotten button handler can never mutate persisted content.
 */
export const ReadOnlyGuardExtension = Extension.create({
  name: 'smartDocumentReadOnlyGuard',
  priority: 10_000,

  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: new PluginKey('smartDocumentReadOnlyGuard'),
        filterTransaction: (transaction) => !transaction.docChanged || editor.isEditable,
      }),
    ];
  },
});
