// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { createSmartDocumentExtensions } from '../createEditorExtensions';
import {
  FindReplaceExtension,
  getFindReplaceState,
  replaceAllFindMatches,
  replaceCurrentFindMatch,
  selectFindMatch,
  updateFindQuery,
} from './FindReplaceExtension';

describe('FindReplaceExtension', () => {
  let editor: Editor | null = null;

  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  it('finds CJK text across mark boundaries and replaces it as one undoable edit', () => {
    editor = new Editor({
      extensions: createSmartDocumentExtensions({ custom: [FindReplaceExtension] }),
      content: {
        type: 'doc',
        content: [{
          type: 'paragraph',
          content: [
            { type: 'text', text: '跨', marks: [{ type: 'bold' }] },
            { type: 'text', text: '标记科研，科研。' },
          ],
        }],
      },
    });

    updateFindQuery(editor, '跨标记', false);
    expect(getFindReplaceState(editor).matches).toHaveLength(1);
    expect(replaceCurrentFindMatch(editor, '跨格式')).toBe(true);
    expect(editor.getText()).toContain('跨格式科研');

    updateFindQuery(editor, '科研', false);
    expect(replaceAllFindMatches(editor, '研究')).toBe(2);
    expect(editor.getText()).toContain('跨格式研究，研究。');
    expect(editor.can().undo()).toBe(true);
  });

  it('supports case sensitivity and cyclic match navigation', () => {
    editor = new Editor({
      extensions: createSmartDocumentExtensions({ custom: [FindReplaceExtension] }),
      content: '<p>Alpha alpha ALPHA</p>',
    });

    updateFindQuery(editor, 'Alpha', true);
    expect(getFindReplaceState(editor).matches).toHaveLength(1);
    updateFindQuery(editor, 'Alpha', false);
    expect(getFindReplaceState(editor).matches).toHaveLength(3);
    selectFindMatch(editor, -1);
    expect(getFindReplaceState(editor).activeIndex).toBe(2);
  });
});
