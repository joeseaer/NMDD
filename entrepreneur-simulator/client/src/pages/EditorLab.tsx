import { useRef, useState } from 'react';
import type { JSONContent } from '@tiptap/react';
import {
  SmartDocumentEditor,
  type SmartDocumentValue,
} from '../components/SmartDocumentEditor';

type EditorMode = 'edit' | 'read';
type EditorTheme = 'light' | 'dark' | 'system';

const PLACEHOLDER_IMAGE =
  'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%221200%22 height=%22480%22 viewBox=%220 0 1200 480%22%3E%3Crect width=%221200%22 height=%22480%22 rx=%2232%22 fill=%22%23eef2ff%22/%3E%3Cpath d=%22M180 350l180-190 125 125 110-95 220 160H180z%22 fill=%22%23a5b4fc%22/%3E%3Ccircle cx=%22835%22 cy=%22135%22 r=%2255%22 fill=%22%23fbbf24%22/%3E%3Ctext x=%22600%22 y=%22425%22 text-anchor=%22middle%22 font-family=%22system-ui,sans-serif%22 font-size=%2232%22 fill=%22%23475569%22%3ENMDD local image placeholder%3C/text%3E%3C/svg%3E';

export const EDITOR_LAB_FIXTURE: JSONContent = {
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 1 },
      content: [{ type: 'text', text: 'Editor Lab：结构化文档验收' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: '这是一份完全本地的测试文档，覆盖 ' },
        { type: 'text', marks: [{ type: 'bold' }], text: '粗体' },
        { type: 'text', text: '、' },
        { type: 'text', marks: [{ type: 'italic' }], text: '斜体' },
        { type: 'text', text: '、安全链接与行内公式 ' },
        { type: 'inlineEquation', attrs: { formula: 'x^2 + y^2 = z^2' } },
        { type: 'text', text: '。访问 ' },
        {
          type: 'text',
          marks: [
            {
              type: 'link',
              attrs: {
                href: 'https://example.com/nmdd',
                target: '_blank',
                rel: 'noopener noreferrer nofollow',
              },
            },
          ],
          text: 'NMDD 示例',
        },
        { type: 'text', text: '。' },
      ],
    },
    {
      type: 'calloutBlock',
      attrs: { icon: '💡', tone: 'blue' },
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: '普通粘贴保留语义；Ctrl+Shift+V 始终只保留文字。' }],
        },
      ],
    },
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: '列表与引用' }],
    },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: '无序列表第一项' }] }],
        },
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: '无序列表第二项' }] }],
        },
      ],
    },
    {
      type: 'orderedList',
      attrs: { start: 1 },
      content: [
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: '有序步骤' }] }],
        },
      ],
    },
    {
      type: 'taskList',
      content: [
        {
          type: 'taskItem',
          attrs: { checked: true },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: '已完成的验收项' }] }],
        },
        {
          type: 'taskItem',
          attrs: { checked: false },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: '等待验证的验收项' }] }],
        },
      ],
    },
    {
      type: 'blockquote',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: '好的编辑器应让结构清楚，同时不打断写作。' }],
        },
      ],
    },
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: '表格' }],
    },
    {
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [
            {
              type: 'tableHeader',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: '来源' }] }],
            },
            {
              type: 'tableHeader',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: '预期结果' }] }],
            },
          ],
        },
        {
          type: 'tableRow',
          content: [
            {
              type: 'tableCell',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Codex / ChatGPT' }] }],
            },
            {
              type: 'tableCell',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: '标题、列表、代码与公式被保留' }] }],
            },
          ],
        },
      ],
    },
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: '代码与公式' }],
    },
    {
      type: 'codeBlock',
      attrs: { language: 'typescript' },
      content: [{ type: 'text', text: "const pasteMode: 'rich' | 'plain' = 'rich';\nconsole.log(pasteMode);" }],
    },
    {
      type: 'equationBlock',
      attrs: { formula: String.raw`\int_{-\infty}^{\infty} e^{-x^2}\,dx = \sqrt{\pi}` },
    },
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: '本地图片占位' }],
    },
    {
      type: 'image',
      attrs: {
        src: PLACEHOLDER_IMAGE,
        alt: 'NMDD deterministic local placeholder',
        title: 'Local fixture image',
        width: '100%',
        align: 'center',
        caption: '这是用于视觉回归的本地确定性图片占位，不依赖网络。',
      },
    },
    { type: 'paragraph' },
  ],
};

const EDITOR_LAB_MERMAID_FIXTURE: JSONContent = {
  ...EDITOR_LAB_FIXTURE,
  content: [
    ...(EDITOR_LAB_FIXTURE.content || []),
    {
      type: 'codeBlock',
      attrs: { language: 'mermaid' },
      content: [{
        type: 'text',
        text: [
          'flowchart TD',
          '  A["复制网页内容"] --> B["识别结构"]',
          '  B --> C["保留标题与列表"]',
          '  C --> D["保留表格"]',
          '  D --> E["保留公式"]',
          '  E --> F["生成流程图"]',
          '  F --> G["安全清洗"]',
          '  G --> H["完成粘贴"]',
        ].join('\n'),
      }],
    },
  ],
};

const initialValue = (fixture: JSONContent = EDITOR_LAB_FIXTURE): SmartDocumentValue => ({
  markdown: '',
  json: fixture,
  html: '',
  text: '',
});

const controlClass = (active: boolean) =>
  `rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
    active
      ? 'border-slate-900 bg-slate-900 text-white'
      : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400'
  }`;

const diagnosticsStyle = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  padding: 0,
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'pre',
  border: 0,
} as const;

const EditorLab = () => {
  const fixtureName = new URLSearchParams(window.location.search).get('fixture');
  const shouldRecoverInvalidJson = fixtureName === 'invalid-json';
  const selectedFixture = fixtureName === 'mermaid' ? EDITOR_LAB_MERMAID_FIXTURE : EDITOR_LAB_FIXTURE;
  const [mode, setMode] = useState<EditorMode>('edit');
  const [theme, setTheme] = useState<EditorTheme>('light');
  const [fixtureVersion, setFixtureVersion] = useState(0);
  const [value, setValue] = useState<SmartDocumentValue>(() => initialValue(selectedFixture));
  const [changeCount, setChangeCount] = useState(0);
  const [flushState, setFlushState] = useState<'idle' | 'waiting' | 'done' | 'error'>('idle');
  const editorFlushRef = useRef<(() => Promise<void>) | null>(null);

  const resetFixture = () => {
    setValue(initialValue(selectedFixture));
    setFixtureVersion(version => version + 1);
  };

  const flushEditorForTest = async () => {
    setFlushState('waiting');
    try {
      await editorFlushRef.current?.();
      setFlushState('done');
    } catch {
      setFlushState('error');
    }
  };

  return (
    <main
      data-testid="editor-lab"
      data-mode={mode}
      data-theme={theme}
      className="min-h-screen bg-slate-100 px-3 py-4 text-slate-950 sm:px-6 sm:py-7"
    >
      <section className="mx-auto max-w-[1180px]">
        <header className="mb-4 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-600">NMDD Editor v2</p>
            <h1 className="mt-1 text-xl font-semibold tracking-tight text-slate-950">Editor Lab</h1>
            <p className="mt-1 text-sm text-slate-500">本地、无后端依赖的剪贴板与排版验收页</p>
          </div>

          <div className="flex flex-wrap items-center gap-2" aria-label="编辑器实验室控制项">
            <div className="flex gap-1" role="group" aria-label="编辑模式">
              <button
                type="button"
                data-testid="mode-edit"
                aria-pressed={mode === 'edit'}
                className={controlClass(mode === 'edit')}
                onClick={() => setMode('edit')}
              >
                编辑
              </button>
              <button
                type="button"
                data-testid="mode-read"
                aria-pressed={mode === 'read'}
                className={controlClass(mode === 'read')}
                onClick={() => setMode('read')}
              >
                阅读
              </button>
            </div>

            <div className="flex gap-1" role="group" aria-label="主题">
              {(['light', 'dark', 'system'] as EditorTheme[]).map(option => (
                <button
                  key={option}
                  type="button"
                  data-testid={`theme-${option}`}
                  aria-pressed={theme === option}
                  className={controlClass(theme === option)}
                  onClick={() => setTheme(option)}
                >
                  {option === 'light' ? '浅色' : option === 'dark' ? '深色' : '跟随系统'}
                </button>
              ))}
            </div>

            <button
              type="button"
              data-testid="reset-fixture"
              className={controlClass(false)}
              onClick={resetFixture}
            >
              重置内容
            </button>
          </div>
        </header>

        <div data-testid="editor-surface">
          <SmartDocumentEditor
            key={fixtureVersion}
            content={shouldRecoverInvalidJson ? '# Markdown 恢复副本\n\n旧文档正文已从安全备份恢复。' : ''}
            contentJson={shouldRecoverInvalidJson
              ? ({ type: 'doc', content: [{ type: 'legacyUnknownBlock' }] } as JSONContent)
              : selectedFixture}
            mode={mode}
            theme={theme}
            serializationFlushRef={editorFlushRef}
            onChange={(nextValue) => {
              setValue(nextValue);
              setChangeCount(count => count + 1);
            }}
          />
        </div>

        <output aria-live="polite" aria-atomic="true" style={diagnosticsStyle}>
          <pre data-testid="editor-json">{JSON.stringify(value.json)}</pre>
          <pre data-testid="editor-html">{value.html}</pre>
          <pre data-testid="editor-markdown">{value.markdown}</pre>
          <pre data-testid="editor-text">{value.text}</pre>
          <span data-testid="editor-flush-state">{flushState}</span>
          <span data-testid="editor-change-count">{changeCount}</span>
          <button type="button" data-testid="editor-flush" onClick={flushEditorForTest}>Flush editor</button>
        </output>
      </section>
    </main>
  );
};

export default EditorLab;
