import { describe, expect, it } from 'vitest';
import { serializeToMarkdown } from '../document-editor/serialization/toMarkdown';
import { serializeToPlainText } from '../document-editor/serialization/toPlainText';

const DOCUMENT = {
  type: 'doc',
  content: [
    {
      type: 'whiteboardEmbed',
      attrs: {
        blockId: 'block-1',
        whiteboardId: 'board-1',
        title: '增长实验画板',
        caption: '第二季度方案',
        height: 560,
        displayMode: 'preview',
        previewRevision: 7,
      },
    },
  ],
};

describe('whiteboard document serialization', () => {
  it('stores only the stable board reference and presentation metadata in Markdown', () => {
    const markdown = serializeToMarkdown(DOCUMENT);
    expect(markdown).toContain('data-type="whiteboard-embed"');
    expect(markdown).toContain('data-whiteboard-id="board-1"');
    expect(markdown).toContain('data-block-id="block-1"');
    expect(markdown).toContain('data-preview-revision="7"');
    expect(markdown).not.toContain('scene_json');
    expect(markdown).not.toContain('dataURL');
  });

  it('produces meaningful plain text without leaking scene data', () => {
    expect(serializeToPlainText(DOCUMENT)).toBe('[白板] 增长实验画板 — 第二季度方案');
  });
});
