import { Extension, type Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export type FindMatch = { from: number; to: number };

export type FindReplaceState = {
  query: string;
  caseSensitive: boolean;
  matches: FindMatch[];
  activeIndex: number;
  decorations: DecorationSet;
};

type FindReplaceMeta = {
  query?: string;
  caseSensitive?: boolean;
  activeIndex?: number;
  clear?: boolean;
};

export const findReplacePluginKey = new PluginKey<FindReplaceState>('smartDocumentFindReplace');

const normalizeSearchText = (value: string, caseSensitive: boolean) => (
  caseSensitive ? value : value.toLocaleLowerCase()
);

const findMatches = (
  doc: ProseMirrorNode,
  query: string,
  caseSensitive: boolean,
): FindMatch[] => {
  if (!query) return [];
  const needle = normalizeSearchText(query, caseSensitive);
  if (!needle) return [];

  const matches: FindMatch[] = [];
  doc.descendants((node, position) => {
    if (!node.isTextblock || matches.length >= 5_000) return true;

    let blockText = '';
    const segments: Array<{ start: number; end: number; from: number }> = [];
    node.descendants((child, childPosition) => {
      if (!child.isText || !child.text) return true;
      const start = blockText.length;
      blockText += child.text;
      segments.push({
        start,
        end: blockText.length,
        from: position + 1 + childPosition,
      });
      return false;
    });

    const haystack = normalizeSearchText(blockText, caseSensitive);
    let offset = 0;
    while (offset <= haystack.length - needle.length && matches.length < 5_000) {
      const index = haystack.indexOf(needle, offset);
      if (index < 0) break;
      const endIndex = index + needle.length;
      const startSegment = segments.find((segment) => index >= segment.start && index < segment.end);
      const endSegment = [...segments].reverse().find((segment) => endIndex > segment.start && endIndex <= segment.end);
      if (startSegment && endSegment) {
        matches.push({
          from: startSegment.from + (index - startSegment.start),
          to: endSegment.from + (endIndex - endSegment.start),
        });
      }
      offset = index + Math.max(1, needle.length);
    }

    return false;
  });

  return matches;
};

const clampActiveIndex = (index: number, matchCount: number) => {
  if (matchCount === 0) return -1;
  return Math.max(0, Math.min(index, matchCount - 1));
};

const buildDecorations = (doc: ProseMirrorNode, matches: FindMatch[], activeIndex: number) => (
  DecorationSet.create(doc, matches.map((match, index) => Decoration.inline(
    match.from,
    match.to,
    {
      class: index === activeIndex
        ? 'smart-document-find-match smart-document-find-match--active'
        : 'smart-document-find-match',
      'data-find-match': String(index + 1),
    },
  )))
);

const createState = (
  doc: ProseMirrorNode,
  query = '',
  caseSensitive = false,
  activeIndex = 0,
): FindReplaceState => {
  const matches = findMatches(doc, query, caseSensitive);
  const nextActiveIndex = clampActiveIndex(activeIndex, matches.length);
  return {
    query,
    caseSensitive,
    matches,
    activeIndex: nextActiveIndex,
    decorations: buildDecorations(doc, matches, nextActiveIndex),
  };
};

export const FindReplaceExtension = Extension.create({
  name: 'smartDocumentFindReplace',

  addProseMirrorPlugins() {
    return [
      new Plugin<FindReplaceState>({
        key: findReplacePluginKey,
        state: {
          init: (_, state) => createState(state.doc),
          apply: (transaction, previous) => {
            const meta = transaction.getMeta(findReplacePluginKey) as FindReplaceMeta | undefined;
            if (!transaction.docChanged && !meta) return previous;
            if (meta?.clear) return createState(transaction.doc);

            const query = meta?.query ?? previous.query;
            const caseSensitive = meta?.caseSensitive ?? previous.caseSensitive;
            const requestedIndex = meta?.activeIndex ?? previous.activeIndex;
            return createState(transaction.doc, query, caseSensitive, requestedIndex);
          },
        },
        props: {
          decorations: (state) => findReplacePluginKey.getState(state)?.decorations || null,
        },
      }),
    ];
  },
});

export const getFindReplaceState = (editor: Editor): FindReplaceState => (
  findReplacePluginKey.getState(editor.state) || createState(editor.state.doc)
);

export const updateFindQuery = (
  editor: Editor,
  query: string,
  caseSensitive: boolean,
) => {
  const transaction = editor.state.tr
    .setMeta(findReplacePluginKey, { query, caseSensitive, activeIndex: 0 } satisfies FindReplaceMeta)
    .setMeta('addToHistory', false);
  editor.view.dispatch(transaction);
};

export const clearFindQuery = (editor: Editor) => {
  editor.view.dispatch(editor.state.tr
    .setMeta(findReplacePluginKey, { clear: true } satisfies FindReplaceMeta)
    .setMeta('addToHistory', false));
};

export const selectFindMatch = (editor: Editor, requestedIndex: number) => {
  const state = getFindReplaceState(editor);
  if (!state.matches.length) return;
  const index = (requestedIndex + state.matches.length) % state.matches.length;
  const match = state.matches[index];
  const transaction = editor.state.tr
    .setMeta(findReplacePluginKey, { activeIndex: index } satisfies FindReplaceMeta)
    .setMeta('addToHistory', false)
    .setSelection(TextSelection.create(editor.state.doc, match.from, match.to))
    .scrollIntoView();
  editor.view.dispatch(transaction);
};

const replaceRangePreservingMarks = (
  transaction: ReturnType<Editor['state']['tr']['setMeta']>,
  match: FindMatch,
  replacement: string,
) => {
  if (!replacement) return transaction.delete(match.from, match.to);
  const marks = transaction.doc.resolve(match.from).marks();
  return transaction.replaceWith(
    match.from,
    match.to,
    transaction.doc.type.schema.text(replacement, marks),
  );
};

export const replaceCurrentFindMatch = (editor: Editor, replacement: string) => {
  const state = getFindReplaceState(editor);
  const match = state.matches[state.activeIndex];
  if (!match) return false;
  const transaction = replaceRangePreservingMarks(editor.state.tr, match, replacement)
    .setMeta(findReplacePluginKey, { activeIndex: state.activeIndex } satisfies FindReplaceMeta)
    .scrollIntoView();
  editor.view.dispatch(transaction);
  return true;
};

export const replaceAllFindMatches = (editor: Editor, replacement: string) => {
  const state = getFindReplaceState(editor);
  if (!state.matches.length) return 0;
  let transaction = editor.state.tr;
  for (const match of [...state.matches].reverse()) {
    transaction = replaceRangePreservingMarks(transaction, match, replacement);
  }
  transaction.setMeta(findReplacePluginKey, { activeIndex: 0 } satisfies FindReplaceMeta);
  editor.view.dispatch(transaction);
  return state.matches.length;
};
