// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { createSmartDocumentExtensions } from './createEditorExtensions';
import { ReadOnlyGuardExtension } from './ReadOnlyGuardExtension';

describe('ReadOnlyGuardExtension', () => {
  it('rejects NodeView-style document mutations while keeping selection transactions legal', () => {
    const editor = new Editor({
      editable: false,
      extensions: createSmartDocumentExtensions({ before: [ReadOnlyGuardExtension] }),
      content: '<p>只读内容</p>',
    });
    const before = editor.getJSON();

    editor.commands.insertContent('不应写入');
    expect(editor.getJSON()).toEqual(before);
    editor.commands.setTextSelection(2);
    expect(editor.state.selection.from).toBe(2);
    editor.destroy();
  });
});
