import { Extension, getMarkRange } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { isSafeLinkUrl } from './clipboard/urlPolicy';

export const normalizeSafeDocumentUrl = (value: string): string | null => {
  const href = value.trim();
  if (!isSafeLinkUrl(href)) return null;
  if (/^(?:mailto:|tel:)/i.test(href)) return href;
  if (typeof window === 'undefined') return href;

  try {
    return new URL(href, window.location.href).toString();
  } catch {
    return null;
  }
};

export const openSafeDocumentUrl = (value: string): boolean => {
  const href = normalizeSafeDocumentUrl(value);
  if (!href || typeof window === 'undefined') return false;
  const opened = window.open(href, '_blank', 'noopener,noreferrer');
  if (opened) opened.opener = null;
  return true;
};

const findLinkRange = (view: EditorView, pos: number) => {
  const { doc, schema } = view.state;
  const linkType = schema.marks.link;
  if (!linkType) return null;

  const positions = [pos, pos - 1, pos + 1]
    .filter((candidate, index, values) => (
      candidate >= 0
      && candidate <= doc.content.size
      && values.indexOf(candidate) === index
    ));

  for (const candidate of positions) {
    const range = getMarkRange(doc.resolve(candidate), linkType);
    if (!range) continue;
    const node = doc.nodeAt(range.from);
    const mark = node?.marks.find((candidateMark) => candidateMark.type === linkType);
    if (mark) return { ...range, href: String(mark.attrs.href || '') };
  }

  return null;
};

/**
 * Editing links has two intentional gestures:
 * - click selects the complete link mark so the contextual menu can offer Open;
 * - Ctrl/Cmd+click opens the safe URL immediately in a new tab.
 *
 * Read mode is left to the native anchor behavior. Mark-range validation keeps
 * PageLink, bookmark, media and other contenteditable=false NodeViews untouched.
 */
export const DocumentLinkInteractionExtension = Extension.create({
  name: 'documentLinkInteraction',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('documentLinkInteraction'),
        props: {
          handleClick: (view, pos, event) => {
            if (event.button !== 0) return false;
            const target = event.target instanceof Element ? event.target : null;
            const anchor = target?.closest('a[href]');
            if (!anchor || !view.dom.contains(anchor)) return false;

            const range = findLinkRange(view, pos);
            if (!range) return false;

            const href = normalizeSafeDocumentUrl(range.href || anchor.getAttribute('href') || '');
            if (!href) {
              event.preventDefault();
              return true;
            }

            if (event.ctrlKey || event.metaKey) {
              event.preventDefault();
              event.stopPropagation();
              openSafeDocumentUrl(href);
              return true;
            }

            if (!view.editable) return false;

            event.preventDefault();
            const selection = TextSelection.create(view.state.doc, range.from, range.to);
            view.dispatch(view.state.tr.setSelection(selection));
            view.focus();
            return true;
          },
        },
      }),
    ];
  },
});
