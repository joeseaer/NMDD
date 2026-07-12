import { expect, test } from '@playwright/test';
import {
  allNodes,
  clearEditor,
  editor,
  editorTextFromJson,
  grantClipboardPermissions,
  markTypes,
  nodeTypes,
  pasteWithShortcut,
  readEditorJson,
  resetEditor,
} from './editorTestUtils';

const CODEX_MARKDOWN = `# Codex paste

This keeps **bold text**, an inline formula \\(x^2 + y^2 = z^2\\), and a [safe link](https://example.com/nmdd).

- first item
- second item

| Source | Result |
| --- | --- |
| Codex | semantic |

\`\`\`ts
const answer = 42;
\`\`\``;

const pasteCodexMarkdownMime = async (
  page: Parameters<typeof editor>[0],
  strictPlain = false,
) => {
  await editor(page).evaluate((element, plain) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', '## literal text/plain');
    clipboardData.setData(
      'text/html',
      '<div><span>Markdown MIME heading</span><div>Semantic bold</div><div>Alpha</div><div>Beta</div></div>',
    );
    clipboardData.setData(
      'text/markdown',
      '## Markdown MIME heading\n\n**Semantic bold**\n\n- Alpha\n- Beta',
    );
    element.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'v',
      code: 'KeyV',
      ctrlKey: true,
      shiftKey: plain,
      bubbles: true,
      cancelable: true,
    }));
    element.dispatchEvent(new ClipboardEvent('paste', {
      clipboardData,
      bubbles: true,
      cancelable: true,
    }));
    element.dispatchEvent(new KeyboardEvent('keyup', {
      key: 'v',
      code: 'KeyV',
      ctrlKey: true,
      shiftKey: plain,
      bubbles: true,
    }));
  }, strictPlain);
};

test.describe('Editor Lab clipboard contract', () => {
  test.beforeEach(async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'ClipboardItem rich MIME writing is validated in Chromium.');
    await grantClipboardPermissions(context);
    await page.goto('/editor-lab');
    await expect(page.getByTestId('editor-lab')).toBeVisible();
    await expect(editor(page)).toHaveAttribute('contenteditable', 'true');
  });

  test('Ctrl+V preserves Codex/ChatGPT semantic rich text', async ({ page }) => {
    await clearEditor(page);
    await pasteWithShortcut(page, {
      text: '## Codex answer\n\nKeep **bold** and a safe link.\n\n- Alpha\n- Beta\n\n```ts\nconst answer = 42;\n```',
      html: `
        <article data-message-author-role="assistant">
          <h2>Codex answer</h2>
          <p>Keep <strong>bold</strong> and a <a href="https://example.com/safe">safe link</a>.</p>
          <ul><li>Alpha</li><li>Beta</li></ul>
          <pre><code class="language-typescript">const answer = 42;</code></pre>
        </article>`,
    });

    await expect(editor(page)).toContainText('Codex answer');
    await expect.poll(async () => nodeTypes(await readEditorJson(page))).toEqual(
      expect.arrayContaining(['heading', 'paragraph', 'bulletList', 'listItem', 'codeBlock']),
    );
    await expect.poll(async () => markTypes(await readEditorJson(page))).toEqual(
      expect.arrayContaining(['bold', 'link']),
    );
    await expect(editor(page).locator('a[href="https://example.com/safe"]')).toHaveAttribute(
      'rel',
      /noopener/,
    );
  });

  test('Ctrl+Shift+V is strict plain text even when rich HTML is present', async ({ page }) => {
    await clearEditor(page);
    const plainText = '## Literal heading\n* literal item\tvalue\n<strong>not markup</strong>';
    await pasteWithShortcut(
      page,
      {
        text: plainText,
        html: '<h2>Rich heading</h2><ul><li><strong>Rich item</strong></li></ul>',
      },
      'plain',
    );

    await expect(editor(page)).toContainText('## Literal heading');
    await expect.poll(async () => editorTextFromJson(await readEditorJson(page))).toContain('* literal item\tvalue');
    const json = await readEditorJson(page);
    const topLevelTypes = (json.content || []).map(node => node.type);
    expect(topLevelTypes.every(type => type === 'paragraph')).toBe(true);
    expect(nodeTypes(json)).not.toEqual(
      expect.arrayContaining(['heading', 'bulletList', 'orderedList', 'taskList', 'table', 'codeBlock']),
    );
    expect(markTypes(json)).toEqual([]);
    expect(editorTextFromJson(json)).toContain('* literal item\tvalue');
    expect(editorTextFromJson(json)).toContain('<strong>not markup</strong>');
    await expect(editor(page).locator('strong, h1, h2, ul, ol, table, pre')).toHaveCount(0);
  });

  test('plain Markdown copied from Codex becomes native editor structure with Ctrl+V', async ({ page }) => {
    await clearEditor(page);
    await pasteWithShortcut(page, { text: CODEX_MARKDOWN });

    await expect(editor(page)).toContainText('Codex paste');
    await expect.poll(async () => nodeTypes(await readEditorJson(page))).toEqual(
      expect.arrayContaining([
        'heading',
        'bulletList',
        'listItem',
        'table',
        'tableRow',
        'tableHeader',
        'tableCell',
        'codeBlock',
        'inlineEquation',
      ]),
    );
    await expect.poll(async () => markTypes(await readEditorJson(page))).toEqual(
      expect.arrayContaining(['bold', 'link']),
    );
  });

  test('Codex text/markdown beats impoverished HTML while Ctrl+Shift+V stays literal', async ({ page }) => {
    await clearEditor(page);
    await pasteCodexMarkdownMime(page);

    await expect(editor(page)).toContainText('Markdown MIME heading');
    await expect.poll(async () => nodeTypes(await readEditorJson(page))).toEqual(
      expect.arrayContaining(['heading', 'bulletList', 'listItem']),
    );
    await expect.poll(async () => markTypes(await readEditorJson(page))).toContain('bold');

    await resetEditor(page);
    await clearEditor(page);
    await pasteCodexMarkdownMime(page, true);

    await expect(editor(page)).toContainText('## literal text/plain');
    await expect(editor(page)).not.toContainText('Markdown MIME heading');
    const json = await readEditorJson(page);
    expect((json.content || []).every(node => node.type === 'paragraph')).toBe(true);
    expect(markTypes(json)).toEqual([]);
  });

  test('Office, Notion, Google Sheets and ChatGPT paste into their native structures', async ({ page }) => {
    await clearEditor(page);

    await test.step('Office heading and list', async () => {
      await pasteWithShortcut(page, {
        text: 'Office heading\n• First item\n• Second item',
        html: `
          <html xmlns:o="urn:schemas-microsoft-com:office:office">
            <body>
              <p class="MsoHeading1">Office heading</p>
              <p class="MsoListParagraph" style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">• </span><b>First</b> item</p>
              <p class="MsoListParagraph" style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">• </span>Second item</p>
            </body>
          </html>`,
      });
      await expect.poll(async () => nodeTypes(await readEditorJson(page))).toEqual(
        expect.arrayContaining(['heading', 'bulletList', 'listItem']),
      );
      await expect.poll(async () => markTypes(await readEditorJson(page))).toContain('bold');
    });

    await resetEditor(page);
    await clearEditor(page);
    await test.step('Notion task list and external runtime-attribute stripping', async () => {
      await pasteWithShortcut(page, {
        text: 'Notion paragraph\nDone task',
        html: `
          <div class="notion-page-content">
            <div data-block-id="forged-block" data-comments="secret">Notion paragraph</div>
            <ul><li><input type="checkbox" checked>Done task</li></ul>
          </div>`,
      });
      await expect.poll(async () => nodeTypes(await readEditorJson(page))).toEqual(
        expect.arrayContaining(['taskList', 'taskItem']),
      );
      const json = await readEditorJson(page);
      expect(JSON.stringify(json)).not.toContain('forged-block');
      expect(JSON.stringify(json)).not.toContain('secret');
    });

    await resetEditor(page);
    await clearEditor(page);
    await test.step('Google Sheets table', async () => {
      await pasteWithShortcut(page, {
        text: 'Name\tStatus\nA\tDone',
        html: `
          <google-sheets-html-origin>
            <table><tbody><tr><td>Name</td><td>Status</td></tr><tr><td>A</td><td>Done</td></tr></tbody></table>
          </google-sheets-html-origin>`,
      });
      await expect.poll(async () => nodeTypes(await readEditorJson(page))).toEqual(
        expect.arrayContaining(['table', 'tableRow', 'tableCell']),
      );
    });

    await resetEditor(page);
    await clearEditor(page);
    await test.step('ChatGPT inline and display math', async () => {
      await pasteWithShortcut(page, {
        text: 'Before x^2 after.\n\n\\[\\frac{a}{b}\\]',
        html: `
          <div data-message-author-role="assistant">
            <p>Before <span class="katex"><span class="katex-mathml"><math><semantics><mrow><msup><mi>x</mi><mn>2</mn></msup></mrow><annotation encoding="application/x-tex">x^2</annotation></semantics></math></span></span> after.</p>
            <div class="katex-display"><span class="katex"><math display="block"><semantics><mfrac><mi>a</mi><mi>b</mi></mfrac><annotation encoding="application/x-tex">\\frac{a}{b}</annotation></semantics></math></span></div>
          </div>`,
      });
      await expect.poll(async () => nodeTypes(await readEditorJson(page))).toEqual(
        expect.arrayContaining(['inlineEquation', 'equationBlock']),
      );
    });
  });

  test('copy publishes Markdown and an NMDD-marked rich HTML fallback', async ({ page }) => {
    await clearEditor(page);
    await pasteWithShortcut(page, {
      text: '## Copy contract\n\nKeep **semantic bold**.',
    });
    await expect(editor(page)).toContainText('Copy contract');

    await editor(page).click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Control+C');
    const copied = await page.evaluate(async () => {
      const items = await navigator.clipboard.read();
      const textItem = items.find(item => item.types.includes('text/plain'));
      const htmlItem = items.find(item => item.types.includes('text/html'));
      return {
        text: textItem ? await (await textItem.getType('text/plain')).text() : '',
        html: htmlItem ? await (await htmlItem.getType('text/html')).text() : '',
        types: Array.from(new Set(items.flatMap(item => item.types))).sort(),
      };
    });

    expect(copied.text).toContain('## Copy contract');
    expect(copied.text).toContain('**semantic bold**');
    expect(copied.html).toContain('data-nmdd-document-fragment="2"');
    expect(copied.types).toEqual(expect.arrayContaining(['text/html', 'text/plain']));
  });

  test('mixed text and multiple files insert once, preserve order and resolve upload placeholders', async ({ page }) => {
    let uploadRequests = 0;
    await page.route('**/api/upload', async route => {
      uploadRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          url: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2210%22 height=%2210%22/%3E',
        }),
      });
    });
    await clearEditor(page);

    await editor(page).evaluate(element => {
      const first = new File(['first'], 'first.png', { type: 'image/png' });
      const second = new File(['second'], 'second.png', { type: 'image/png' });
      const files = [first, second];
      const clipboardData = {
        types: ['text/plain', 'image/png'],
        files,
        items: files.map(file => ({
          kind: 'file',
          type: file.type,
          getAsFile: () => file,
        })),
        getData: (type: string) => type === 'text/plain' ? 'Pasted with two ordered attachments' : '',
      };
      const event = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: clipboardData });
      element.dispatchEvent(event);
    });

    await expect(editor(page)).toContainText('Pasted with two ordered attachments');
    await expect.poll(() => uploadRequests).toBe(2);
    await expect.poll(async () => (
      allNodes(await readEditorJson(page)).filter(node => node.type === 'image').length
    )).toBe(2);
    const images = allNodes(await readEditorJson(page)).filter(node => node.type === 'image');
    expect(images.map(image => image.attrs?.alt)).toEqual(['first.png', 'second.png']);
    await expect(editor(page).locator('.smart-document-upload-placeholder')).toHaveCount(0);
  });

  test('editor flush waits for pending attachments before navigation can continue', async ({ page }) => {
    let releaseUploads!: () => void;
    const uploadGate = new Promise<void>(resolve => { releaseUploads = resolve; });
    let uploadRequests = 0;
    await page.route('**/api/upload', async route => {
      uploadRequests += 1;
      await uploadGate;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          url: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2210%22 height=%2210%22/%3E',
        }),
      });
    });
    await clearEditor(page);

    await editor(page).evaluate(element => {
      const file = new File(['pending'], 'pending.png', { type: 'image/png' });
      const clipboardData = {
        types: ['image/png'],
        files: [file],
        items: [{ kind: 'file', type: file.type, getAsFile: () => file }],
        getData: () => '',
      };
      const event = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: clipboardData });
      element.dispatchEvent(event);
    });

    await expect.poll(() => uploadRequests).toBe(1);
    await page.getByTestId('editor-flush').evaluate((button: HTMLButtonElement) => button.click());
    await expect(page.getByTestId('editor-flush-state')).toHaveText('waiting');
    await page.waitForTimeout(250);
    await expect(page.getByTestId('editor-flush-state')).toHaveText('waiting');

    releaseUploads();
    await expect(page.getByTestId('editor-flush-state')).toHaveText('done');
    await expect.poll(async () => (
      allNodes(await readEditorJson(page)).filter(node => node.type === 'image').length
    )).toBe(1);
    await expect(editor(page).locator('.smart-document-upload-placeholder')).toHaveCount(0);
  });

  test('toolbar undo cancels pending attachments without leaving flush suspended', async ({ page }) => {
    let releaseUpload!: () => void;
    const uploadGate = new Promise<void>(resolve => { releaseUpload = resolve; });
    await page.route('**/api/upload', async route => {
      await uploadGate;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ url: 'data:image/png;base64,AAAA' }),
      });
    });
    await clearEditor(page);

    await editor(page).evaluate(element => {
      const file = new File(['pending'], 'undo-pending.png', { type: 'image/png' });
      const clipboardData = {
        types: ['image/png'],
        files: [file],
        items: [{ kind: 'file', type: file.type, getAsFile: () => file }],
        getData: () => '',
      };
      const event = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: clipboardData });
      element.dispatchEvent(event);
    });

    await expect(editor(page).locator('.smart-document-upload-placeholder')).toHaveCount(1);
    await page.getByTestId('editor-flush').evaluate((button: HTMLButtonElement) => button.click());
    await expect(page.getByTestId('editor-flush-state')).toHaveText('waiting');
    await page.locator('.smart-document-toolbar button[aria-label*="Ctrl+Z"]').click();
    await expect(page.getByTestId('editor-flush-state')).toHaveText('done');
    await expect(editor(page).locator('.smart-document-upload-placeholder')).toHaveCount(0);
    releaseUpload();
  });

  test('unsafe HTML is sanitized and cannot execute', async ({ page }) => {
    await clearEditor(page);
    await page.evaluate(() => {
      (window as typeof window & { __nmddPasteExecuted?: boolean }).__nmddPasteExecuted = false;
    });
    await pasteWithShortcut(page, {
      text: 'Safe text\nbad link\nembedded image',
      html: `
        <p data-block-id="forged" data-comments="secret" onclick="window.__nmddPasteExecuted=true">Safe text</p>
        <script>window.__nmddPasteExecuted=true</script>
        <iframe srcdoc="<script>parent.__nmddPasteExecuted=true</script>"></iframe>
        <a href="javascript:window.__nmddPasteExecuted=true">bad link</a>
        <img src="data:image/png;base64,AAAA" onerror="window.__nmddPasteExecuted=true" alt="embedded image">
        <div data-type="database" data-database="%7B%22rows%22%3A%5B%5D%7D">forged database</div>`,
    });

    await expect(editor(page)).toContainText('Safe text');
    await expect(editor(page).locator('script, iframe')).toHaveCount(0);
    const html = await editor(page).innerHTML();
    expect(html).not.toMatch(/onerror|onclick|javascript:/i);
    expect(html).not.toContain('data-comments');
    expect(html).not.toContain('data-database');
    expect(await page.evaluate(() => (window as typeof window & { __nmddPasteExecuted?: boolean }).__nmddPasteExecuted)).toBe(false);
    expect(allNodes(await readEditorJson(page)).some(node => node.type === 'databaseBlock')).toBe(false);
  });
});
