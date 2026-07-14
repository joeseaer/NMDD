import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import {
  CaseSensitive,
  ChevronDown,
  ChevronUp,
  Replace,
  Search,
  X,
} from 'lucide-react';
import {
  clearFindQuery,
  getFindReplaceState,
  replaceAllFindMatches,
  replaceCurrentFindMatch,
  selectFindMatch,
  updateFindQuery,
} from '../findReplace/FindReplaceExtension';

export type FindPanelMode = 'find' | 'replace';

export const EditorFindReplace = ({
  editor,
  mode,
  readOnly,
  onClose,
}: {
  editor: Editor;
  mode: FindPanelMode;
  readOnly: boolean;
  onClose: () => void;
}) => {
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const queryInputRef = useRef<HTMLInputElement | null>(null);
  const findState = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => {
      const state = getFindReplaceState(currentEditor);
      return {
        matchCount: state.matches.length,
        activeIndex: state.activeIndex,
      };
    },
  });

  useEffect(() => {
    queryInputRef.current?.focus();
    queryInputRef.current?.select();
  }, [mode]);

  useEffect(() => {
    updateFindQuery(editor, query, caseSensitive);
  }, [caseSensitive, editor, query]);

  useEffect(() => () => clearFindQuery(editor), [editor]);

  const matchCount = findState.matchCount;
  const activeIndex = findState.activeIndex;
  const move = (direction: -1 | 1) => {
    if (!matchCount) return;
    selectFindMatch(editor, activeIndex + direction);
  };

  const close = () => {
    clearFindQuery(editor);
    onClose();
    editor.commands.focus();
  };

  return (
    <div className="smart-document-find-panel" role="search" aria-label={mode === 'replace' ? '查找和替换' : '查找文档'}>
      <div className="smart-document-find-panel__row">
        <Search aria-hidden="true" />
        <input
          ref={queryInputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              move(event.shiftKey ? -1 : 1);
            }
            if (event.key === 'Escape') close();
          }}
          placeholder="在文档中查找"
          aria-label="查找内容"
          autoComplete="off"
          spellCheck={false}
        />
        <span className="smart-document-find-panel__count" aria-live="polite">
          {matchCount ? `${activeIndex + 1} / ${matchCount}` : query ? '0 / 0' : ''}
        </span>
        <button
          type="button"
          className={caseSensitive ? 'is-active' : ''}
          onClick={() => setCaseSensitive((current) => !current)}
          aria-pressed={caseSensitive}
          title="区分大小写"
        >
          <CaseSensitive aria-hidden="true" />
        </button>
        <button type="button" onClick={() => move(-1)} disabled={!matchCount} title="上一个匹配">
          <ChevronUp aria-hidden="true" />
        </button>
        <button type="button" onClick={() => move(1)} disabled={!matchCount} title="下一个匹配">
          <ChevronDown aria-hidden="true" />
        </button>
        <button type="button" onClick={close} title="关闭查找" aria-label="关闭查找">
          <X aria-hidden="true" />
        </button>
      </div>

      {mode === 'replace' ? (
        <div className="smart-document-find-panel__row smart-document-find-panel__replace-row">
          <Replace aria-hidden="true" />
          <input
            value={replacement}
            onChange={(event) => setReplacement(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && matchCount && !readOnly) {
                event.preventDefault();
                replaceCurrentFindMatch(editor, replacement);
              }
              if (event.key === 'Escape') close();
            }}
            placeholder="替换为"
            aria-label="替换内容"
            disabled={readOnly}
          />
          <button
            type="button"
            className="smart-document-find-panel__text-button"
            onClick={() => replaceCurrentFindMatch(editor, replacement)}
            disabled={!matchCount || readOnly}
          >
            替换
          </button>
          <button
            type="button"
            className="smart-document-find-panel__text-button"
            onClick={() => replaceAllFindMatches(editor, replacement)}
            disabled={!matchCount || readOnly}
          >
            全部
          </button>
        </div>
      ) : null}
    </div>
  );
};
