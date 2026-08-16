import { Node, mergeAttributes, type Editor } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { CURRENT_USER_ID } from '../../../config/currentUser';
import { WhiteboardNodeView } from './WhiteboardNodeView';
import { requestWhiteboardSelection } from './WhiteboardPickerHost';

const safeHeight = (value: unknown) => Math.max(240, Math.min(900, Number(value) || 420));

export const createWhiteboardBlockId = () => (
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `whiteboard-${Date.now()}-${Math.random().toString(36).slice(2)}`
);

export const insertWhiteboardIntoEditor = async (
  editor: Editor,
  range?: { from: number; to: number },
): Promise<boolean> => {
  const whiteboard = await requestWhiteboardSelection();
  if (!whiteboard || editor.isDestroyed) return false;

  let chain = editor.chain().focus();
  if (range) chain = chain.deleteRange(range);
  return chain.insertContent({
    type: 'whiteboardEmbed',
    attrs: {
      blockId: createWhiteboardBlockId(),
      whiteboardId: whiteboard.id,
      title: whiteboard.title,
      caption: '',
      height: 420,
      displayMode: 'preview',
      previewRevision: whiteboard.preview_revision || null,
    },
  }).run();
};

export const WhiteboardEmbed = Node.create({
  name: 'whiteboardEmbed',
  group: 'block',
  atom: true,
  draggable: true,
  isolating: true,

  addAttributes() {
    return {
      blockId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-block-id'),
        renderHTML: (attributes) => attributes.blockId ? { 'data-block-id': attributes.blockId } : {},
      },
      whiteboardId: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-whiteboard-id') || '',
        renderHTML: (attributes) => ({ 'data-whiteboard-id': attributes.whiteboardId || '' }),
      },
      title: {
        default: '白板',
        parseHTML: (element) => element.getAttribute('data-whiteboard-title') || '白板',
        renderHTML: (attributes) => ({ 'data-whiteboard-title': attributes.title || '白板' }),
      },
      caption: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-caption') || '',
        renderHTML: (attributes) => attributes.caption ? { 'data-caption': attributes.caption } : {},
      },
      height: {
        default: 420,
        parseHTML: (element) => safeHeight(element.getAttribute('data-height')),
        renderHTML: (attributes) => ({ 'data-height': String(safeHeight(attributes.height)) }),
      },
      displayMode: {
        default: 'preview',
        parseHTML: (element) => element.getAttribute('data-display-mode') || 'preview',
        renderHTML: (attributes) => ({ 'data-display-mode': attributes.displayMode || 'preview' }),
      },
      previewRevision: {
        default: null,
        parseHTML: (element) => Number(element.getAttribute('data-preview-revision')) || null,
        renderHTML: (attributes) => attributes.previewRevision
          ? { 'data-preview-revision': String(attributes.previewRevision) }
          : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'figure[data-type="whiteboard-embed"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const id = String(node.attrs.whiteboardId || '');
    const previewRevision = Number(node.attrs.previewRevision) || null;
    const query = new URLSearchParams({ userId: CURRENT_USER_ID });
    if (previewRevision) query.set('revision', String(previewRevision));
    const previewUrl = id
      ? `/api/whiteboards/${encodeURIComponent(id)}/preview?${query}`
      : '';
    const image = previewUrl
      ? ['img', {
          src: previewUrl,
          alt: `${node.attrs.title || '白板'} 缩略图`,
          loading: 'lazy',
          style: `display:block;width:100%;height:${safeHeight(node.attrs.height)}px;object-fit:contain;background:#f8fafc`,
        }]
      : ['div', {}, '白板预览不可用'];
    return [
      'figure',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'whiteboard-embed',
        class: 'whiteboard-embed-static',
      }),
      image,
      ['figcaption', {}, node.attrs.caption || node.attrs.title || '白板'],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(WhiteboardNodeView);
  },
});
