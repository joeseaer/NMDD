import { expect, type BrowserContext, type Page } from '@playwright/test';

export type EditorJsonNode = {
  type?: string;
  text?: string;
  marks?: Array<{ type?: string; attrs?: Record<string, unknown> }>;
  attrs?: Record<string, unknown>;
  content?: EditorJsonNode[];
};

export const editor = (page: Page) => page.locator('[data-testid="editor-surface"] .ProseMirror');

export const readEditorJson = async (page: Page): Promise<EditorJsonNode> => {
  const raw = (await page.getByTestId('editor-json').textContent()) || '{}';
  return JSON.parse(raw) as EditorJsonNode;
};

export const allNodes = (node: EditorJsonNode): EditorJsonNode[] => [
  node,
  ...(node.content || []).flatMap(allNodes),
];

export const nodeTypes = (node: EditorJsonNode): string[] =>
  allNodes(node).map(item => item.type).filter((type): type is string => Boolean(type));

export const markTypes = (node: EditorJsonNode): string[] =>
  allNodes(node).flatMap(item => (item.marks || []).map(mark => mark.type || '')).filter(Boolean);

export const editorTextFromJson = (node: EditorJsonNode): string =>
  allNodes(node).map(item => item.text || '').join('');

export const grantClipboardPermissions = async (context: BrowserContext) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: 'http://127.0.0.1:5173',
  });
};

export const writeClipboard = async (
  page: Page,
  payload: { text: string; html?: string },
) => {
  await page.evaluate(async ({ text, html }) => {
    const clipboardPayload: Record<string, Blob> = {
      'text/plain': new Blob([text], { type: 'text/plain' }),
    };
    if (html !== undefined) {
      clipboardPayload['text/html'] = new Blob([html], { type: 'text/html' });
    }
    await navigator.clipboard.write([new ClipboardItem(clipboardPayload)]);
  }, payload);
};

export const clearEditor = async (page: Page) => {
  const surface = editor(page);
  await surface.locator('h1, p').first().click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await expect.poll(async () => editorTextFromJson(await readEditorJson(page))).not.toContain('Editor Lab');
};

export const pasteWithShortcut = async (
  page: Page,
  payload: { text: string; html?: string },
  kind: 'rich' | 'plain' = 'rich',
) => {
  await writeClipboard(page, payload);
  await editor(page).click();
  await page.keyboard.press(kind === 'plain' ? 'Control+Shift+V' : 'Control+V');
};

export const resetEditor = async (page: Page) => {
  await page.getByTestId('reset-fixture').click();
  await expect(editor(page)).toContainText('Editor Lab');
};
