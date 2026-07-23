import type MarkdownIt from 'markdown-it';

export const MIND_MAP_MARKDOWN_FENCE = 'mindmap';

const isMindMapFence = (info: string): boolean => (
  info === MIND_MAP_MARKDOWN_FENCE
  || info.startsWith(`${MIND_MAP_MARKDOWN_FENCE} `)
);

/**
 * Installs the private Markdown fence used by persisted smart documents.
 *
 * The returned HTML is intentionally the same `data-mindmap` element consumed
 * by the Tiptap MindMap extension. Keeping this codec outside the editor React
 * component gives autosave/reload integration tests one authoritative path to
 * exercise instead of a test-only parser.
 */
export const installMindMapMarkdownFence = (parser: MarkdownIt): void => {
  const defaultFence = parser.renderer.rules.fence;

  parser.renderer.rules.fence = (tokens, index, options, environment, renderer) => {
    const token = tokens[index];
    const info = (token.info || '').trim();
    if (isMindMapFence(info)) {
      const json = (token.content || '').trim();
      return `<div data-type="mind-map" data-mindmap="${encodeURIComponent(json)}"></div>`;
    }
    if (defaultFence) {
      return defaultFence(tokens, index, options, environment, renderer);
    }
    return renderer.renderToken(tokens, index, options);
  };
};

