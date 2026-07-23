import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { editor, markTypes, readEditorJson } from './editorTestUtils';

test.describe('Editor Lab interaction and layout', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/editor-lab');
    await expect(page.getByTestId('editor-lab')).toBeVisible();
    await expect(editor(page)).toContainText('Editor Lab');
  });

  test('mode, theme and keyboard formatting controls expose deterministic state', async ({ page }) => {
    await page.getByTestId('mode-read').click();
    await expect(page.getByTestId('editor-lab')).toHaveAttribute('data-mode', 'read');
    await expect(editor(page)).toHaveAttribute('contenteditable', 'false');
    await expect(page.locator('.smart-document-toolbar')).toHaveCount(0);

    await page.getByTestId('theme-dark').click();
    await expect(page.getByTestId('editor-lab')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('.smart-document')).toHaveAttribute('data-theme', 'dark');

    await page.getByTestId('mode-edit').click();
    await expect(editor(page)).toHaveAttribute('contenteditable', 'true');
    await editor(page).locator('p').last().click();
    await page.keyboard.press('Control+B');
    await page.keyboard.type('KeyboardBold');
    await expect(editor(page)).toContainText('KeyboardBold');
    await expect.poll(async () => markTypes(await readEditorJson(page))).toContain('bold');

    await page.getByTestId('theme-system').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('editor-lab')).toHaveAttribute('data-theme', 'system');
    await expect(page.getByTestId('theme-system')).toHaveAttribute('aria-pressed', 'true');
  });

  test('mobile viewport keeps the document and controls inside the canvas', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId('editor-lab')).toBeVisible();
    await expect(page.getByTestId('mode-edit')).toBeVisible();
    await expect(editor(page)).toBeVisible();

    const metrics = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    }));
    expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1);

    const editorBox = await page.getByTestId('editor-surface').boundingBox();
    expect(editorBox).not.toBeNull();
    expect(editorBox!.x).toBeGreaterThanOrEqual(0);
    expect(editorBox!.x + editorBox!.width).toBeLessThanOrEqual(391);
  });

  test('inline links expose an Open action and Ctrl+click opens directly', async ({ page }) => {
    await page.evaluate(() => {
      const opened: Array<[string, string, string]> = [];
      (window as typeof window & { __editorLinkOpens?: typeof opened }).__editorLinkOpens = opened;
      window.open = ((url?: string | URL, target?: string, features?: string) => {
        opened.push([String(url || ''), String(target || ''), String(features || '')]);
        return null;
      }) as typeof window.open;
    });

    const link = editor(page).getByRole('link', { name: 'NMDD 示例' });
    await link.click();
    const openAction = page.getByRole('button', { name: /打开链接/ });
    await expect(openAction).toBeVisible();
    await expect.poll(() => page.evaluate(() => (
      (window as typeof window & { __editorLinkOpens?: unknown[] }).__editorLinkOpens?.length || 0
    ))).toBe(0);

    await openAction.click();
    await expect.poll(() => page.evaluate(() => (
      (window as typeof window & { __editorLinkOpens?: unknown[] }).__editorLinkOpens?.length || 0
    ))).toBe(1);

    await link.click({ modifiers: ['Control'] });
    const calls = await page.evaluate(() => (
      (window as typeof window & { __editorLinkOpens?: Array<[string, string, string]> }).__editorLinkOpens || []
    ));
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual(['https://example.com/nmdd', '_blank', 'noopener,noreferrer']);
    await expect(page.getByTestId('editor-change-count')).toHaveText('0');
  });

  test('tables and Mermaid render as legible semantic content', async ({ page }) => {
    await page.goto('/editor-lab?fixture=mermaid');
    await expect(editor(page)).toContainText('Editor Lab');
    const table = editor(page).locator('.tableWrapper table');
    await expect(table).toHaveCount(1);
    await expect(table.locator('tr')).toHaveCount(2);
    await expect(table.locator('th, td')).toHaveCount(4);
    await expect(table).toContainText('Codex / ChatGPT');
    const tableLayout = await table.evaluate((element) => {
      const wrapper = element.closest<HTMLElement>('.tableWrapper');
      const editorElement = element.closest<HTMLElement>('.ProseMirror');
      return {
        wrapperWidth: wrapper?.getBoundingClientRect().width || 0,
        editorWidth: editorElement?.getBoundingClientRect().width || 0,
      };
    });
    expect(Math.abs(tableLayout.wrapperWidth - tableLayout.editorWidth)).toBeLessThanOrEqual(2);

    const preview = page.getByTestId('mermaid-preview');
    await expect(preview).toBeVisible({ timeout: 15_000 });
    const diagramSvg = preview.locator('.smart-doc-mermaid-stage svg');
    await expect(diagramSvg).toHaveCount(1);
    await expect(diagramSvg).toContainText('复制网页内容');
    await expect(diagramSvg.locator('foreignObject')).toHaveCount(0);

    const metrics = await preview.evaluate((element) => {
      const viewport = element.querySelector<HTMLElement>('.smart-doc-mermaid-svg');
      const svg = element.querySelector<SVGElement>('.smart-doc-mermaid-stage svg');
      return {
        viewportWidth: viewport?.clientWidth || 0,
        viewportHeight: viewport?.clientHeight || 0,
        scrollHeight: viewport?.scrollHeight || 0,
        svgWidth: svg?.getBoundingClientRect().width || 0,
        viewBoxWidth: svg?.viewBox.baseVal.width || 0,
        labelFontSize: svg?.querySelector('text')
          ? Number.parseFloat(window.getComputedStyle(svg.querySelector('text')!).fontSize)
          : 0,
        textCount: svg?.querySelectorAll('text, tspan').length || 0,
      };
    });
    expect(metrics.textCount).toBeGreaterThan(0);
    expect(metrics.svgWidth).toBeGreaterThanOrEqual(metrics.viewBoxWidth * 0.95);
    expect(metrics.labelFontSize).toBeGreaterThanOrEqual(12);
    expect(metrics.scrollHeight).toBeGreaterThanOrEqual(metrics.viewportHeight);
  });

  test('edit and read surfaces have no WCAG A/AA violations', async ({ page }) => {
    const editResults = await new AxeBuilder({ page })
      .include('[data-testid="editor-lab"]')
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    expect(editResults.violations).toEqual([]);

    await page.getByTestId('mode-read').click();
    await expect(editor(page)).toHaveAttribute('contenteditable', 'false');
    const readResults = await new AxeBuilder({ page })
      .include('[data-testid="editor-lab"]')
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    expect(readResults.violations).toEqual([]);
  });

  test('invalid legacy JSON falls back to the Markdown recovery copy instead of an empty document', async ({ page }) => {
    await page.goto('/editor-lab?fixture=invalid-json');
    await expect(page.locator('.smart-document-recovery-warning')).toContainText('Markdown 备份');
    await expect(editor(page)).toContainText('Markdown 恢复副本');
    await expect(editor(page)).toContainText('旧文档正文已从安全备份恢复');
    await expect(editor(page)).not.toContainText('Editor Lab：结构化文档验收');
  });

  test('opening legacy content does not autosave solely to hydrate missing block IDs', async ({ page }) => {
    await expect(page.getByTestId('editor-change-count')).toHaveText('0');
    await page.waitForTimeout(400);
    await expect(page.getByTestId('editor-change-count')).toHaveText('0');
  });
});
